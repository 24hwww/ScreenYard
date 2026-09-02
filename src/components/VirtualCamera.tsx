import React, { useRef, useEffect, useState } from 'react';
import { usePictureInPicture } from '../hooks/usePictureInPicture';
import './VirtualCamera.css';

interface VirtualCameraOutputProps {
  /** Background video element (camera feed) */
  bgVideoRef: React.RefObject<HTMLVideoElement | null>;
  /** The stage element containing all windows to capture */
  stageRef: React.RefObject<HTMLDivElement | null>;
  /** Whether virtual camera mode is active */
  active: boolean;
  /** Window state to know what to composite */
  windows: Array<{
    id: string;
    type: string;
    position: { x: number; y: number };
    size: { width: number; height: number };
    selected: boolean;
    data: any;
  }>;
}

/**
 * Virtual Camera Output mode.
 *
 * Composites the camera feed + all stage elements onto a single 1280x720 canvas
 * at 30fps, then exposes it via canvas.captureStream().
 *
 * The resulting MediaStream can be:
 * - Used in OBS as a Browser Source (most efficient)
 * - Sent via WebRTC to a native virtual camera daemon
 * - Recorded with MediaRecorder
 *
 * In Google Meet, you still need OBS Virtual Camera as the bridge:
 * 1. Install OBS Studio
 * 2. Add Browser Source → http://localhost:5173
 * 3. Start Virtual Camera
 * 4. In Meet: Settings → Video → OBS Virtual Camera
 */
export const VirtualCameraOutput: React.FC<VirtualCameraOutputProps> = ({
  bgVideoRef,
  stageRef,
  active,
  windows,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const canvasStreamRef = useRef<MediaStream | null>(null);
  const [streamActive, setStreamActive] = useState(false);
  const [fps, setFps] = useState(0);
  const [connectedCalls, setConnectedCalls] = useState(0);

  // Detect if running as extension (chrome.runtime available) or dev server
  const isExtension = typeof chrome !== 'undefined' && !!chrome.runtime && !!chrome.runtime.id;

  // Picture-in-Picture floating window
  const pip = usePictureInPicture();

  // WebRTC peer connections (one per video call tab that requests the stream)
  const peerConnectionsRef = useRef<Map<number, RTCPeerConnection>>(new Map());

  const OUTPUT_WIDTH = 1280;
  const OUTPUT_HEIGHT = 720;
  const TARGET_FPS = 30;

  useEffect(() => {
    if (!active) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      setStreamActive(false);
      // Close all peer connections
      peerConnectionsRef.current.forEach((pc) => { try { pc.close(); } catch {} });
      peerConnectionsRef.current.clear();
      setConnectedCalls(0);
      // Notify background that stream is gone
      try { chrome.runtime.sendMessage({ type: 'screenyard-stream-stopped' }); } catch {}
      delete (window as any).__screenYardVirtualCameraStream;
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = OUTPUT_WIDTH;
    canvas.height = OUTPUT_HEIGHT;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Start captureStream
    const stream = canvas.captureStream(TARGET_FPS);
    canvasStreamRef.current = stream;
    setStreamActive(true);

    // Expose stream globally for OBS / external access
    (window as any).__screenYardVirtualCameraStream = stream;

    // Register with background service worker
    try {
      chrome.runtime.sendMessage({ type: 'screenyard-register' });
      chrome.runtime.sendMessage({ type: 'screenyard-stream-ready' });
    } catch {}

    let lastFpsTime = performance.now();
    let frameCount = 0;

    const render = () => {
      const video = bgVideoRef.current;
      const stage = stageRef.current;

      // Clear
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT);

      // The stage displays the camera mirrored (scaleX(-1)) and elements
      // in mirrored coordinates. To make the VCam output match exactly
      // what the user sees in the ScreenYard tab, we mirror the entire
      // canvas: draw the camera mirrored, then draw elements in mirrored
      // coordinates too.

      // Draw camera background (cover fit, mirrored to match stage)
      if (video && video.readyState >= 2) {
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        if (vw > 0 && vh > 0) {
          const scale = Math.max(OUTPUT_WIDTH / vw, OUTPUT_HEIGHT / vh);
          const dw = vw * scale;
          const dh = vh * scale;
          const dx = (OUTPUT_WIDTH - dw) / 2;
          const dy = (OUTPUT_HEIGHT - dh) / 2;
          // Mirror to match the stage display
          ctx.save();
          ctx.scale(-1, 1);
          ctx.drawImage(video, -dx - dw, dy, dw, dh);
          ctx.restore();
        }
      }

      // Draw elements on top — in mirrored coordinates to match the stage
      // The stage CSS mirrors the video but NOT the foreground layer.
      // Elements are positioned in screen coordinates (not mirrored).
      // So we draw them WITHOUT mirroring, matching the stage's foreground.
      if (stage) {
        const stageRect = stage.getBoundingClientRect();
        const scaleX = OUTPUT_WIDTH / stageRect.width;
        const scaleY = OUTPUT_HEIGHT / stageRect.height;

        for (const win of windows) {
          const x = win.position.x * scaleX;
          const y = win.position.y * scaleY;
          const w = win.size.width * scaleX;
          const h = win.size.height * scaleY;

          // Draw based on type
          if (win.type === 'text') {
            const data = win.data;
            if (data?.content) {
              ctx.fillStyle = data.color || '#ffffff';
              const fontSize = (data.fontSize || 16) * scaleX;
              ctx.font = `${fontSize}px ${data.fontFamily || 'sans-serif'}`;
              ctx.textBaseline = 'top';
              // Word wrap
              const lines = data.content.split('\n');
              let cy = y + 4;
              for (const line of lines) {
                ctx.fillText(line, x + 8, cy);
                cy += fontSize * 1.3;
              }
            }
          } else if (win.type === 'shape') {
            const data = win.data;
            ctx.fillStyle = data?.fill || '#3b82f6';
            if (data?.shapeType === 'circle') {
              ctx.beginPath();
              ctx.arc(x + w / 2, y + h / 2, Math.min(w, h) / 2, 0, Math.PI * 2);
              ctx.fill();
              if (data?.stroke) {
                ctx.strokeStyle = data.stroke;
                ctx.lineWidth = (data.strokeWidth || 2) * scaleX;
                ctx.stroke();
              }
            } else {
              ctx.fillRect(x, y, w, h);
              if (data?.stroke) {
                ctx.strokeStyle = data.stroke;
                ctx.lineWidth = (data.strokeWidth || 2) * scaleX;
                ctx.strokeRect(x, y, w, h);
              }
            }
          } else if (win.type === 'image') {
            // Images are complex to composite from DOM; draw a placeholder
            ctx.fillStyle = 'rgba(100, 100, 100, 0.5)';
            ctx.fillRect(x, y, w, h);
            ctx.fillStyle = '#fff';
            ctx.font = `${12 * scaleX}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.fillText('[image]', x + w / 2, y + h / 2);
            ctx.textAlign = 'left';
          }

          // Selection border
          if (win.selected) {
            ctx.strokeStyle = '#3b82f6';
            ctx.lineWidth = 2 * scaleX;
            ctx.strokeRect(x, y, w, h);
          }
        }
      }

      // FPS counter
      frameCount++;
      const now = performance.now();
      if (now - lastFpsTime >= 1000) {
        setFps(Math.round((frameCount * 1000) / (now - lastFpsTime)));
        frameCount = 0;
        lastFpsTime = now;
      }

      rafRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      setStreamActive(false);
      delete (window as any).__screenYardVirtualCameraStream;
    };
  }, [active, bgVideoRef, stageRef, windows]);

  // ─── WebRTC sender: listen for stream requests from video call tabs ───
  useEffect(() => {
    if (!active) return;

    const handleRuntimeMessage = (message: any, sender: any, sendResponse: (r: any) => void) => {
      // Video call tab is requesting the stream — create RTCPeerConnection and send offer
      if (message.type === 'screenyard-start-webrtc') {
        const callerTabId = message.callerTabId;
        const stream = canvasStreamRef.current;
        if (!stream) {
          sendResponse({ error: 'No canvas stream available' });
          return;
        }

        // Close existing PC for this caller if any
        const existingPc = peerConnectionsRef.current.get(callerTabId);
        if (existingPc) { try { existingPc.close(); } catch {} }

        const pc = new RTCPeerConnection({ iceServers: [] });
        peerConnectionsRef.current.set(callerTabId, pc);

        // Add canvas tracks to the PC
        stream.getTracks().forEach((track) => {
          pc.addTrack(track, stream);
        });

        // Send ICE candidates to the caller via background
        pc.onicecandidate = (event) => {
          if (event.candidate) {
            try {
              chrome.runtime.sendMessage({
                type: 'screenyard-ice-candidate',
                callerTabId,
                candidate: event.candidate.candidate,
              });
            } catch {}
          }
        };

        // Create offer and send to caller via background (async — answer comes separately)
        pc.createOffer()
          .then((offer) => pc.setLocalDescription(offer))
          .then(() => {
            // Send offer to background — background relays to content script
            // Answer will come back as a separate "content-webrtc-answer" message
            try {
              chrome.runtime.sendMessage({
                type: 'screenyard-webrtc-offer',
                callerTabId,
                sdp: pc.localDescription?.sdp,
              });
            } catch (err) {
              console.warn('[ScreenYard VCam] Failed to send offer:', err);
            }
          })
          .catch((err) => {
            console.warn('[ScreenYard VCam] createOffer failed:', err);
          });

        sendResponse({ ok: true });
      }

      // WebRTC answer from content script (caller) — relayed by background
      if (message.type === 'content-webrtc-answer') {
        const answer = message.answer;
        // Find the PC that's waiting for an answer (typically only one)
        peerConnectionsRef.current.forEach((pc) => {
          if (pc.connectionState === 'connecting' || pc.remoteDescription === null) {
            pc.setRemoteDescription({ type: 'answer', sdp: answer })
              .then(() => {
                setConnectedCalls(peerConnectionsRef.current.size);
                console.log('[ScreenYard VCam] WebRTC connection established');
              })
              .catch((err) => console.warn('[ScreenYard VCam] setRemoteDescription failed:', err));
          }
        });
      }

      // ICE candidates from content script (caller)
      if (message.type === 'content-ice-candidate') {
        const candidates = message.candidates;
        if (Array.isArray(candidates)) {
          peerConnectionsRef.current.forEach((pc) => {
            candidates.forEach((c: string) => {
              pc.addIceCandidate({ candidate: c }).catch(() => {});
            });
          });
        }
      }
    };

    // Register listener
    try {
      chrome.runtime.onMessage.addListener(handleRuntimeMessage);
    } catch {}

    return () => {
      try {
        chrome.runtime.onMessage.removeListener(handleRuntimeMessage);
      } catch {}
    };
  }, [active]);

  if (!active) return null;

  return (
    <div className="vcam-overlay">
      <div className="vcam-panel">
        <div className="vcam-header">
          <span className="vcam-title">🎥 ScreenYard Virtual Camera</span>
          <span className={`vcam-status ${streamActive ? 'vcam-status--active' : ''}`}>
            {streamActive ? '● LIVE' : '○ Starting…'}
          </span>
        </div>

        <div className="vcam-preview">
          <canvas ref={canvasRef} className="vcam-canvas" />
        </div>

        {/* Floating window controls */}
        {pip.isSupported && (
          <div className="vcam-pip-controls">
            {pip.isActive ? (
              <button className="vcam-pip-btn vcam-pip-btn--active" onClick={pip.closePiP}>
                🪟 Close floating window
              </button>
            ) : (
              <button
                className="vcam-pip-btn"
                onClick={() => {
                  // Move both the stage and the hidden VCam canvas into PiP.
                  // The canvas needs to be in the same window as the stage
                  // so requestAnimationFrame doesn't get throttled when
                  // the main tab goes to the background.
                  const stage = stageRef.current;
                  const canvas = canvasRef.current;
                  if (stage && canvas) {
                    // Create a wrapper to hold both elements
                    const wrapper = document.createElement('div');
                    wrapper.style.width = '100%';
                    wrapper.style.height = '100%';
                    wrapper.style.position = 'relative';
                    wrapper.appendChild(stage);
                    // Canvas is hidden but needs to render
                    canvas.style.position = 'absolute';
                    canvas.style.top = '0';
                    canvas.style.left = '0';
                    canvas.style.width = '100%';
                    canvas.style.height = '100%';
                    canvas.style.opacity = '0'; // hidden but rendering
                    canvas.style.pointerEvents = 'none';
                    wrapper.appendChild(canvas);
                    pip.openPiP(wrapper, 480, 270);
                  }
                }}
              >
                🪟 Open floating window
              </button>
            )}
            {pip.error && <div className="vcam-pip-error">{pip.error}</div>}
          </div>
        )}

        <div className="vcam-info">
          <div className="vcam-info-row">
            <span className="vcam-info-label">Mode:</span>
            <span className="vcam-info-value">
              {isExtension ? 'Extension (full)' : 'Dev server (preview only)'}
            </span>
          </div>
          <div className="vcam-info-row">
            <span className="vcam-info-label">Resolution:</span>
            <span className="vcam-info-value">{OUTPUT_WIDTH}×{OUTPUT_HEIGHT}</span>
          </div>
          <div className="vcam-info-row">
            <span className="vcam-info-label">FPS:</span>
            <span className="vcam-info-value">{fps}</span>
          </div>
          {isExtension && (
            <div className="vcam-info-row">
              <span className="vcam-info-label">Calls connected:</span>
              <span className="vcam-info-value">{connectedCalls}</span>
            </div>
          )}
        </div>

        {isExtension ? (
          <div className="vcam-instructions">
            <div className="vcam-instructions-title">📋 Sin OBS — directo en Meet:</div>
            <ol>
              <li>Abre ScreenYard (esta pestaña) y activa VCam</li>
              <li>Click <strong>🪟 Open floating window</strong> para despegar el stage</li>
              <li>Abre <strong>Google Meet</strong> (o Zoom/Teams) en otra pestaña</li>
              <li>Meet → Settings → Video → Camera</li>
              <li>Selecciona <strong>ScreenYard Virtual Camera</strong></li>
              <li>¡Listo! Tu stage con gestos aparece como cámara</li>
            </ol>
            <div style={{ marginTop: 8, fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>
              La ventana flotante mantiene el stream activo aunque cambies de pestaña.
              La extensión intercepta getUserMedia y envía el stream vía WebRTC loopback.
              Sin OBS, sin drivers, sin permisos de admin.
            </div>
          </div>
        ) : (
          <div className="vcam-instructions">
            <div className="vcam-instructions-title">⚠ Dev server — VCam preview only</div>
            <div style={{ color: 'rgba(255,255,255,0.7)', lineHeight: 1.6 }}>
              Estás en <code>npm run dev</code>. El canvas composite funciona y puedes
              ver el preview, pero la virtual camera <strong>no aparece en Meet</strong>
              porque el content script solo se inyecta cuando ScreenYard se carga como
              extensión.
            </div>
            <div style={{ marginTop: 8, color: 'rgba(255,255,255,0.5)', lineHeight: 1.6 }}>
              Para usar en Meet:
              <ol style={{ marginTop: 4 }}>
                <li><code>npm run build:ext</code></li>
                <li>Chrome → <code>chrome://extensions/</code> → Developer mode</li>
                <li>Load unpacked → selecciona <code>dist/</code></li>
                <li>Click icono ScreenYard → activa VCam → abre Meet</li>
              </ol>
            </div>
            <div style={{ marginTop: 8, fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>
              El stream está disponible en <code>window.__screenYardVirtualCameraStream</code>
              para testing manual o OBS Browser Source.
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
