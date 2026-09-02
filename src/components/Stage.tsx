import React, { useRef, useEffect, useState, useCallback } from 'react';
import {
  WindowManagerState,
  removeWindow,
  moveWindow,
  resizeWindow,
  selectWindow,
  bringToFront,
  toggleLock,
  setEditing,
  updateWindowData,
} from '../windows/WindowManager';
import { WindowWrapper } from './WindowWrapper';
import { VirtualCursor } from './VirtualCursor';
import { TrashZone } from './TrashZone';
import { EmojiBurst, EmojiItem } from './EmojiBurst';
import { DebugPanel } from './DebugPanel';
import { GestureState, GestureEvent } from '../gestures/types';
import { HandTracker } from '../gestures/HandTracker';
import { GestureRecognizer } from '../gestures/GestureRecognizer';
import { GestureSmoother } from '../gestures/GestureSmoother';
import './Stage.css';

interface StageProps {
  state: WindowManagerState;
  onStateChange: (state: WindowManagerState) => void;
  isPresentationMode: boolean;
  isDebugVisible: boolean;
}

const handTracker = new HandTracker();
const primarySmoother = new GestureSmoother(0.55, 0.001, 0.3);
const secondarySmoother = new GestureSmoother(0.55, 0.001, 0.3);
const gestureRecognizer = new GestureRecognizer(primarySmoother, secondarySmoother);

const TRASH_STRIP_HEIGHT = 70;

/** Find the text element closest to a given point */
function findNearestText(
  windows: WindowManagerState['windows'],
  x: number,
  y: number,
): string | null {
  let bestId: string | null = null;
  let bestDist = Infinity;

  for (const win of windows) {
    if (win.type !== 'text' || win.locked) continue;
    const cx = win.position.x + win.size.width / 2;
    const cy = win.position.y + win.size.height / 2;
    const dist = Math.sqrt((cx - x) ** 2 + (cy - y) ** 2);
    if (dist < bestDist) {
      bestDist = dist;
      bestId = win.id;
    }
  }

  // Only if within reasonable range (300px)
  return bestDist < 300 ? bestId : null;
}

export const Stage: React.FC<StageProps> = ({
  state,
  onStateChange,
  isPresentationMode,
  isDebugVisible,
}) => {
  const stageRef = useRef<HTMLDivElement>(null);
  const foregroundRef = useRef<HTMLDivElement>(null);
  const bgVideoRef = useRef<HTMLVideoElement>(null);
  const trackingVideoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [gestureState, setGestureState] = useState<GestureState>({
    handDetected: false,
    isPinching: false,
    indexPosition: { x: 0, y: 0 },
    pinchDistance: 0,
    confidence: 0,
    orientation: 'side',
    pose: 'unknown',
    fingerCount: 0,
    gesture: 'none',
    secondHand: null,
  });

  // Drag state
  const [draggingWindowId, setDraggingWindowId] = useState<string | null>(null);
  const [dragSource, setDragSource] = useState<'mouse' | 'gesture' | null>(null);
  const gestureDragOffset = useRef({ x: 0, y: 0 });

  // Trash zone
  const [trashVisible, setTrashVisible] = useState(false);
  const [trashProgress, setTrashProgress] = useState(0);

  // Emoji reactions
  const [emojis, setEmojis] = useState<EmojiItem[]>([]);
  const emojiIdRef = useRef(0);

  // Camera status
  const [cameraStatus, setCameraStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [trackingStatus, setTrackingStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');

  // Track last 1-finger state to avoid repeated triggers
  const lastFingerCountRef = useRef(0);

  // 1-finger hold timer for text editing activation
  const oneFingerHoldTimerRef = useRef<number | null>(null);
  const [oneFingerHoldProgress, setOneFingerHoldProgress] = useState(0);
  const oneFingerHoldStartRef = useRef<{ x: number; y: number } | null>(null);
  const ONE_FINGER_HOLD_MS = 600;

  // Spawn an emoji at a position
  const spawnEmoji = useCallback((emoji: string, x: number, y: number) => {
    const id = `emoji-${++emojiIdRef.current}`;
    setEmojis((prev) => [...prev, { id, emoji, x, y, createdAt: Date.now() }]);
  }, []);

  const removeEmoji = useCallback((id: string) => {
    setEmojis((prev) => prev.filter((e) => e.id !== id));
  }, []);

  // ─── Calculate trash overlap ───
  const calculateTrashOverlap = useCallback(
    (elemX: number, elemY: number, elemW: number, elemH: number) => {
      const fgEl = foregroundRef.current;
      if (!fgEl) return 0;
      const rect = fgEl.getBoundingClientRect();
      const stageHeight = rect.height;
      const elemBottom = elemY + elemH;
      return Math.max(0, Math.min(1,
        (elemBottom - (stageHeight - TRASH_STRIP_HEIGHT)) / TRASH_STRIP_HEIGHT,
      ));
    },
    [],
  );

  // ─── Start webcam on mount ───
  // This effect runs once on mount. In React StrictMode (dev), effects run
  // twice (mount → cleanup → mount). The `cancelled` flag + `destroy()` in
  // cleanup ensures no duplicate MediaPipe instances or camera streams.
  useEffect(() => {
    let cancelled = false;

    const startCamera = async () => {
      setCameraStatus('loading');
      setTrackingStatus('loading');

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
          audio: false,
        });

        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;

        if (bgVideoRef.current) {
          bgVideoRef.current.srcObject = stream;
          await bgVideoRef.current.play();
        }
        setCameraStatus('ready');

        const trackingVideo = document.createElement('video');
        // Visually hidden but still rendered (NOT display:none) so the browser
        // decodes frames. display:none prevents frame composition.
        trackingVideo.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;top:-1px;left:-1px;';
        trackingVideo.autoplay = true;
        trackingVideo.playsInline = true;
        trackingVideo.muted = true;
        trackingVideo.srcObject = stream;
        await trackingVideo.play();
        document.body.appendChild(trackingVideo);
        trackingVideoRef.current = trackingVideo;

        if (cancelled) { cleanup(); return; }

        // Guard: if HandTracker was already initialized (e.g. StrictMode remount),
        // destroy() is called inside initialize() to clean up the old instance.
        const fgEl = foregroundRef.current;
        await handTracker.initialize(trackingVideo, fgEl?.clientWidth ?? 1280, fgEl?.clientHeight ?? 720);
        handTracker.start((results) => gestureRecognizer.processAllHands(results));

        setTrackingStatus('ready');
      } catch (err) {
        console.warn('Camera/Hand tracking failed:', err);
        if (!cancelled) { setCameraStatus('error'); setTrackingStatus('error'); }
      }
    };

    const cleanup = () => {
      // Full teardown: stop rAF loop + destroy MediaPipe landmarker + release GPU
      handTracker.destroy();
      // Stop all camera tracks
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      // Remove tracking video from DOM
      if (trackingVideoRef.current) {
        trackingVideoRef.current.srcObject = null;
        trackingVideoRef.current.remove();
        trackingVideoRef.current = null;
      }
      // Clear background video srcObject
      if (bgVideoRef.current) {
        bgVideoRef.current.srcObject = null;
      }
    };

    startCamera();
    return () => { cancelled = true; cleanup(); };
  }, []);

  // ─── Click background to deselect ───
  const handleStageClick = useCallback(
    (e: React.MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t === stageRef.current || t.classList.contains('stage-webcam') || t.classList.contains('stage-foreground')) {
        onStateChange(selectWindow(state, null));
      }
    },
    [state, onStateChange],
  );

  // ─── Mouse drag callbacks ───
  const handleMouseDragStart = useCallback((id: string) => {
    setDraggingWindowId(id);
    setDragSource('mouse');
    setTrashVisible(true);
    setTrashProgress(0);
  }, []);

  const handleMouseDragEnd = useCallback(
    (id: string) => {
      const win = state.windows.find((w) => w.id === id);
      if (win) {
        const overlap = calculateTrashOverlap(win.position.x, win.position.y, win.size.width, win.size.height);
        if (overlap > 0.5) onStateChange(removeWindow(state, id));
      }
      setDraggingWindowId(null);
      setDragSource(null);
      setTrashVisible(false);
      setTrashProgress(0);
    },
    [state, onStateChange, calculateTrashOverlap],
  );

  // ─── Mouse handlers ───
  const handleWindowSelect = useCallback(
    (id: string) => { onStateChange(bringToFront(selectWindow(state, id), id)); },
    [state, onStateChange],
  );

  const handleWindowMove = useCallback(
    (id: string, x: number, y: number) => {
      onStateChange(moveWindow(state, id, { x, y }));
      if (draggingWindowId === id && dragSource === 'mouse') {
        const win = state.windows.find((w) => w.id === id);
        if (win) setTrashProgress(calculateTrashOverlap(x, y, win.size.width, win.size.height));
      }
    },
    [state, onStateChange, draggingWindowId, dragSource, calculateTrashOverlap],
  );

  const handleWindowResize = useCallback(
    (id: string, w: number, h: number) => onStateChange(resizeWindow(state, id, { width: w, height: h })),
    [state, onStateChange],
  );

  const handleWindowRemove = useCallback(
    (id: string) => onStateChange(removeWindow(state, id)),
    [state, onStateChange],
  );

  const handleToggleLock = useCallback(
    (id: string) => onStateChange(toggleLock(state, id)),
    [state, onStateChange],
  );

  const handleEditEnd = useCallback(
    (id: string, content: string) => {
      onStateChange(setEditing(updateWindowData(state, id, { kind: 'text', content } as any), id, false));
    },
    [state, onStateChange],
  );

  // ─── Gesture events → actions ───
  // Track drag state per hand so both hands can interact independently
  const gestureDragStateRef = useRef<Map<number, { windowId: string; offset: { x: number; y: number } }>>(new Map());

  useEffect(() => {
    const handleGestureEvent = (event: GestureEvent) => {
      // Update debug state for both hands
      setGestureState(gestureRecognizer.getState());

      const fgEl = foregroundRef.current;
      if (!fgEl) return;
      const rect = fgEl.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      const stageX = event.position.x * rect.width;
      const stageY = event.position.y * rect.height;
      const handIdx = event.handIndex;

      switch (event.type) {
        case 'pointer-move': {
          const dragState = gestureDragStateRef.current.get(handIdx);
          if (dragState && event.isPinching) {
            const newX = stageX - dragState.offset.x;
            const newY = stageY - dragState.offset.y;
            onStateChange(moveWindow(state, dragState.windowId, { x: newX, y: newY }));
            const win = state.windows.find((w) => w.id === dragState.windowId);
            if (win) setTrashProgress(calculateTrashOverlap(newX, newY, win.size.width, win.size.height));
          }
          break;
        }

        case 'pinch-start': {
          const sorted = [...state.windows].sort((a, b) => b.zIndex - a.zIndex);
          for (const win of sorted) {
            if (win.locked) continue;
            if (stageX >= win.position.x && stageX <= win.position.x + win.size.width &&
                stageY >= win.position.y && stageY <= win.position.y + win.size.height) {
              gestureDragStateRef.current.set(handIdx, {
                windowId: win.id,
                offset: { x: stageX - win.position.x, y: stageY - win.position.y },
              });
              // Also set the legacy drag state for the primary hand (handIndex 0)
              // so mouse-based drag tracking stays compatible
              if (handIdx === 0) {
                setDraggingWindowId(win.id);
                setDragSource('gesture');
                gestureDragOffset.current = { x: stageX - win.position.x, y: stageY - win.position.y };
              }
              setTrashVisible(true);
              setTrashProgress(0);
              onStateChange(selectWindow(bringToFront(state, win.id), win.id));
              break;
            }
          }
          break;
        }

        case 'pinch-end': {
          const dragState = gestureDragStateRef.current.get(handIdx);
          if (dragState) {
            const win = state.windows.find((w) => w.id === dragState.windowId);
            if (win) {
              const overlap = calculateTrashOverlap(win.position.x, win.position.y, win.size.width, win.size.height);
              if (overlap > 0.5) onStateChange(removeWindow(state, dragState.windowId));
            }
            gestureDragStateRef.current.delete(handIdx);
          }
          // Clear legacy drag state if primary hand
          if (handIdx === 0) {
            setDraggingWindowId(null);
            setDragSource(null);
          }
          // Hide trash if no hands are dragging
          if (gestureDragStateRef.current.size === 0) {
            setTrashVisible(false);
            setTrashProgress(0);
          }
          break;
        }

        case 'finger-count': {
          // Only process finger-count from the primary hand (handIndex 0)
          // to avoid confusion when both hands change finger counts
          if (handIdx !== 0) break;

          const prevCount = lastFingerCountRef.current;
          const newCount = event.fingerCount;

          // Cancel any pending hold timer when finger count changes
          if (oneFingerHoldTimerRef.current !== null) {
            clearTimeout(oneFingerHoldTimerRef.current);
            oneFingerHoldTimerRef.current = null;
          }

          // 1 finger → start hold timer to open nearest text element for editing
          if (newCount === 1 && prevCount !== 1) {
            oneFingerHoldStartRef.current = { x: stageX, y: stageY };
            setOneFingerHoldProgress(0);

            // Animate progress
            const startTime = performance.now();
            const animateProgress = () => {
              const elapsed = performance.now() - startTime;
              const progress = Math.min(elapsed / ONE_FINGER_HOLD_MS, 1);
              setOneFingerHoldProgress(progress);
              if (progress < 1 && oneFingerHoldTimerRef.current !== null) {
                requestAnimationFrame(animateProgress);
              }
            };
            requestAnimationFrame(animateProgress);

            oneFingerHoldTimerRef.current = window.setTimeout(() => {
              const startPos = oneFingerHoldStartRef.current;
              if (!startPos) return;
              const nearestTextId = findNearestText(state.windows, startPos.x, startPos.y);
              if (nearestTextId) {
                onStateChange(selectWindow(setEditing(state, nearestTextId, true), nearestTextId));
              }
              oneFingerHoldTimerRef.current = null;
              setOneFingerHoldProgress(0);
            }, ONE_FINGER_HOLD_MS);
          } else if (newCount !== 1) {
            setOneFingerHoldProgress(0);
            oneFingerHoldStartRef.current = null;
          }

          lastFingerCountRef.current = newCount;
          break;
        }

        case 'gesture-detected': {
          // Thumb up → spawn smile emoji at hand position
          if (event.gesture === 'thumb_up') {
            spawnEmoji('👍', stageX, stageY);
            // Also spawn a smile nearby as visual feedback
            setTimeout(() => spawnEmoji('😊', stageX + 40, stageY - 30), 200);
          }
          break;
        }
      }
    };

    gestureRecognizer.addListener(handleGestureEvent);
    return () => gestureRecognizer.removeListener(handleGestureEvent);
  }, [state, onStateChange, calculateTrashOverlap, spawnEmoji]);

  return (
    <div
      ref={stageRef}
      className={`stage ${isPresentationMode ? 'stage--presentation' : ''}`}
      onClick={handleStageClick}
    >
      {/* Layer 1: Webcam background */}
      <video ref={bgVideoRef} className="stage-webcam" autoPlay playsInline muted />

      {/* Camera status */}
      {cameraStatus === 'loading' && (
        <div className="stage-status">
          <div className="stage-status-spinner" />
          <span>Activating camera…</span>
        </div>
      )}
      {cameraStatus === 'error' && (
        <div className="stage-status stage-status--error">
          <span>⚠️ Camera access denied or unavailable</span>
          <span className="stage-status-hint">Allow camera permission and reload</span>
        </div>
      )}

      {/* Layer 2: Foreground elements */}
      <div ref={foregroundRef} className="stage-foreground">
        {state.windows.map((win) => (
          <WindowWrapper
            key={win.id}
            window={win}
            onSelect={handleWindowSelect}
            onMove={handleWindowMove}
            onResize={handleWindowResize}
            onBringToFront={(id) => onStateChange(bringToFront(state, id))}
            onToggleLock={handleToggleLock}
            onRemove={handleWindowRemove}
            onEditEnd={handleEditEnd}
            onDragStart={handleMouseDragStart}
            onDragEnd={handleMouseDragEnd}
          />
        ))}
      </div>

      {/* Trash zone */}
      <TrashZone visible={trashVisible} progress={trashProgress} />

      {/* Emoji reactions */}
      <EmojiBurst emojis={emojis} onDone={removeEmoji} />

      {/* Virtual cursors */}
      <VirtualCursor
        position={gestureState.indexPosition}
        visible={gestureState.handDetected}
        isPinching={gestureState.isPinching}
        handIndex={0}
        holdProgress={oneFingerHoldProgress}
      />
      {gestureState.secondHand && (
        <VirtualCursor
          position={gestureState.secondHand.indexPosition}
          visible={true}
          isPinching={gestureState.secondHand.isPinching}
          handIndex={1}
        />
      )}

      {/* Debug panel */}
      <DebugPanel gestureState={gestureState} visible={isDebugVisible} />
    </div>
  );
};
