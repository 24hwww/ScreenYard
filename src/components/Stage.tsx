import React, { useRef, useEffect, useState, useCallback } from 'react';
import { AnimatePresence } from 'framer-motion';
import {
  WindowManagerState,
  addWindow,
  removeWindow,
  moveWindow,
  resizeWindow,
  selectWindow,
  bringToFront,
  toggleLock,
  setEditing,
  updateWindowData,
} from '../windows/WindowManager';
import { WindowType } from '../windows/types';
import { WindowWrapper } from './WindowWrapper';
import { VirtualCursor } from './VirtualCursor';
import { TrashZone } from './TrashZone';
import { EmojiBurst, EmojiItem } from './EmojiBurst';
import { DebugPanel } from './DebugPanel';
import { BarcodeScanner } from './BarcodeScanner';
import { VirtualCameraOutput } from './VirtualCamera';
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
  scannerVisible: boolean;
  onScannerClose: () => void;
  vcamActive: boolean;
}

const handTracker = new HandTracker();
const primarySmoother = new GestureSmoother(0.55, 0.001, 0.3);
const secondarySmoother = new GestureSmoother(0.55, 0.001, 0.3);
const gestureRecognizer = new GestureRecognizer(primarySmoother, secondarySmoother);

const TRASH_STRIP_HEIGHT = 70;

/** Clamp a window position so it stays within the stage bounds.
 *  The window can reach the edges but never go past them. */
function clampToStage(
  x: number,
  y: number,
  w: number,
  h: number,
  stageW: number,
  stageH: number,
): { x: number; y: number } {
  return {
    x: Math.max(0, Math.min(x, stageW - w)),
    y: Math.max(0, Math.min(y, stageH - h)),
  };
}

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
  scannerVisible,
  onScannerClose,
  vcamActive,
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

  // Available video devices and current index (for camera switching)
  const videoDevicesRef = useRef<MediaDeviceInfo[]>([]);
  const currentDeviceIndexRef = useRef(0);

  // Barcode/QR scanner — controlled by parent (toolbar button)
  // Toast notification for scanned codes
  const [scanToast, setScanToast] = useState<string | null>(null);
  const scanToastTimerRef = useRef<number | null>(null);

  // Track last finger count to detect changes
  const lastFingerCountRef = useRef(0);

  // Hold timer for finger-count gestures (spawn elements / switch camera)
  const fingerHoldTimerRef = useRef<number | null>(null);
  const [fingerHoldProgress, setFingerHoldProgress] = useState(0);
  const fingerHoldStartRef = useRef<{ x: number; y: number } | null>(null);
  const FINGER_HOLD_MS = 2000;

  // Map finger count → element type (1=Text, 2=Image, 3=Shape)
  // 4 fingers = camera switch (special, no element spawn)
  const FINGER_TO_ELEMENT: Record<number, WindowType> = {
    1: 'text',
    2: 'image',
    3: 'shape',
  };
  const FINGER_LABELS: Record<number, string> = {
    1: 'Text',
    2: 'Image',
    3: 'Shape',
    4: 'Switch Camera',
  };

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

  // ─── Camera management ───
  // Start camera with a specific device ID. If no ID given, uses default.
  const startCameraWithDevice = useCallback(async (deviceId?: string) => {
    setCameraStatus('loading');

    try {
      // Enumerate video devices (only works after permission is granted)
      const devices = await navigator.mediaDevices.enumerateDevices();
      videoDevicesRef.current = devices.filter((d) => d.kind === 'videoinput');

      const constraints: MediaStreamConstraints = {
        video: deviceId
          ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
          : { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
        audio: false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      return stream;
    } catch (err) {
      console.warn('Camera failed:', err);
      setCameraStatus('error');
      return null;
    }
  }, []);

  // Attach a stream to bg + tracking video, then (re)initialize HandTracker
  const attachStream = useCallback(async (stream: MediaStream) => {
    // Stop old stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
    }
    // Remove old tracking video
    if (trackingVideoRef.current) {
      trackingVideoRef.current.srcObject = null;
      trackingVideoRef.current.remove();
    }

    streamRef.current = stream;

    if (bgVideoRef.current) {
      bgVideoRef.current.srcObject = stream;
      await bgVideoRef.current.play().catch(() => {});
    }
    setCameraStatus('ready');

    const trackingVideo = document.createElement('video');
    trackingVideo.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;top:-1px;left:-1px;';
    trackingVideo.autoplay = true;
    trackingVideo.playsInline = true;
    trackingVideo.muted = true;
    trackingVideo.srcObject = stream;
    await trackingVideo.play().catch(() => {});
    document.body.appendChild(trackingVideo);
    trackingVideoRef.current = trackingVideo;

    // Re-initialize HandTracker with new video element
    const fgEl = foregroundRef.current;
    await handTracker.initialize(trackingVideo, fgEl?.clientWidth ?? 1280, fgEl?.clientHeight ?? 720);
    handTracker.start((results) => gestureRecognizer.processAllHands(results));
    setTrackingStatus('ready');
  }, []);

  // Switch to the next available camera
  const switchCamera = useCallback(async () => {
    const devices = videoDevicesRef.current;
    if (devices.length <= 1) {
      console.warn('No other cameras available');
      return;
    }

    currentDeviceIndexRef.current = (currentDeviceIndexRef.current + 1) % devices.length;
    const nextDevice = devices[currentDeviceIndexRef.current];

    setTrackingStatus('loading');
    handTracker.stop();

    const stream = await startCameraWithDevice(nextDevice.deviceId);
    if (stream) {
      await attachStream(stream);
    } else {
      setTrackingStatus('error');
    }
  }, [startCameraWithDevice, attachStream]);

  // ─── Start webcam on mount ───
  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      setTrackingStatus('loading');
      const stream = await startCameraWithDevice();
      if (!stream || cancelled) {
        if (stream) stream.getTracks().forEach((t) => t.stop());
        return;
      }
      await attachStream(stream);
    };

    const cleanup = () => {
      handTracker.destroy();
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (trackingVideoRef.current) {
        trackingVideoRef.current.srcObject = null;
        trackingVideoRef.current.remove();
        trackingVideoRef.current = null;
      }
      if (bgVideoRef.current) {
        bgVideoRef.current.srcObject = null;
      }
    };

    init();
    return () => { cancelled = true; cleanup(); };
  }, [startCameraWithDevice, attachStream]);

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
      const win = state.windows.find((w) => w.id === id);
      const fgEl = foregroundRef.current;
      const rect = fgEl?.getBoundingClientRect();
      const clamped = win && rect
        ? clampToStage(x, y, win.size.width, win.size.height, rect.width, rect.height)
        : { x, y };
      onStateChange(moveWindow(state, id, clamped));
      if (draggingWindowId === id && dragSource === 'mouse') {
        if (win) setTrashProgress(calculateTrashOverlap(clamped.x, clamped.y, win.size.width, win.size.height));
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
  const gestureDragStateRef = useRef<Map<number, {
    windowId: string;
    offset: { x: number; y: number };
    startX: number;
    startY: number;
    startTime: number;
  }>>(new Map());

  // Swipe-to-delete thresholds
  const SWIPE_MIN_DISTANCE = 200; // px — minimum horizontal travel
  const SWIPE_RATIO = 2; // horizontal distance must be 2x vertical
  const SWIPE_MAX_TIME = 800; // ms — must be a quick swipe, not a slow drag

  // Track swipe progress for visual feedback (0-1)
  const [swipeProgress, setSwipeProgress] = useState(0);
  const [swipingWindowId, setSwipingWindowId] = useState<string | null>(null);

  // Track which windows were fist-deleted to avoid repeated deletes
  const fistDeletedRef = useRef<Set<string>>(new Set());

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
            const win = state.windows.find((w) => w.id === dragState.windowId);
            const newX = stageX - dragState.offset.x;
            const newY = stageY - dragState.offset.y;
            const clamped = win
              ? clampToStage(newX, newY, win.size.width, win.size.height, rect.width, rect.height)
              : { x: newX, y: newY };
            onStateChange(moveWindow(state, dragState.windowId, clamped));
            if (win) setTrashProgress(calculateTrashOverlap(clamped.x, clamped.y, win.size.width, win.size.height));

            // Track swipe progress for visual feedback
            const dx = Math.abs(stageX - dragState.startX);
            const dy = Math.abs(stageY - dragState.startY);
            if (dx > dy * SWIPE_RATIO && dx > 50) {
              const progress = Math.min(1, dx / SWIPE_MIN_DISTANCE);
              setSwipeProgress(progress);
              setSwipingWindowId(dragState.windowId);
            } else {
              setSwipeProgress(0);
              setSwipingWindowId(null);
            }
          }

          // Fist gesture: delete the selected element under the fist
          if (event.pose === 'fist' && !event.isPinching) {
            const sorted = [...state.windows].sort((a, b) => b.zIndex - a.zIndex);
            for (const win of sorted) {
              if (win.locked) continue;
              if (win.selected &&
                  stageX >= win.position.x && stageX <= win.position.x + win.size.width &&
                  stageY >= win.position.y && stageY <= win.position.y + win.size.height) {
                if (!fistDeletedRef.current.has(win.id)) {
                  fistDeletedRef.current.add(win.id);
                  onStateChange(removeWindow(state, win.id));
                }
                break;
              }
            }
          } else {
            // Reset fist-deleted tracking when not making a fist
            fistDeletedRef.current.clear();
          }
          break;
        }

        case 'pinch-start': {
          // Hit test with expanded padding for easier grabbing
          const HIT_PADDING = 40; // px — expand the grab area around elements
          const sorted = [...state.windows].sort((a, b) => b.zIndex - a.zIndex);
          let bestWin: typeof sorted[0] | null = null;
          let bestDist = Infinity;

          for (const win of sorted) {
            if (win.locked) continue;
            // Check if pinch is inside the element (with padding)
            const inside =
              stageX >= win.position.x - HIT_PADDING &&
              stageX <= win.position.x + win.size.width + HIT_PADDING &&
              stageY >= win.position.y - HIT_PADDING &&
              stageY <= win.position.y + win.size.height + HIT_PADDING;

            if (inside) {
              // Prefer the element whose center is closest to the pinch point
              const cx = win.position.x + win.size.width / 2;
              const cy = win.position.y + win.size.height / 2;
              const dist = Math.hypot(stageX - cx, stageY - cy);
              // Strongly prefer elements where the pinch is actually inside (no padding)
              const isExactlyInside =
                stageX >= win.position.x && stageX <= win.position.x + win.size.width &&
                stageY >= win.position.y && stageY <= win.position.y + win.size.height;
              const effectiveDist = isExactlyInside ? dist - 1000 : dist;
              if (effectiveDist < bestDist) {
                bestDist = effectiveDist;
                bestWin = win;
              }
            }
          }

          if (bestWin) {
            const win = bestWin;
            gestureDragStateRef.current.set(handIdx, {
              windowId: win.id,
              offset: { x: stageX - win.position.x, y: stageY - win.position.y },
              startX: stageX,
              startY: stageY,
              startTime: performance.now(),
            });
            if (handIdx === 0) {
              setDraggingWindowId(win.id);
              setDragSource('gesture');
              gestureDragOffset.current = { x: stageX - win.position.x, y: stageY - win.position.y };
            }
            setTrashVisible(true);
            setTrashProgress(0);
            onStateChange(selectWindow(bringToFront(state, win.id), win.id));
          }
          break;
        }

        case 'pinch-end': {
          const dragState = gestureDragStateRef.current.get(handIdx);
          if (dragState) {
            const win = state.windows.find((w) => w.id === dragState.windowId);
            if (win) {
              // Check for horizontal swipe-to-delete
              const dx = Math.abs(stageX - dragState.startX);
              const dy = Math.abs(stageY - dragState.startY);
              const elapsed = performance.now() - dragState.startTime;
              const isHorizontalSwipe =
                dx > SWIPE_MIN_DISTANCE &&
                dx > dy * SWIPE_RATIO &&
                elapsed < SWIPE_MAX_TIME;

              if (isHorizontalSwipe) {
                // Swipe detected — remove the element
                onStateChange(removeWindow(state, dragState.windowId));
              } else {
                // Normal drop — check trash zone overlap
                const overlap = calculateTrashOverlap(win.position.x, win.position.y, win.size.width, win.size.height);
                if (overlap > 0.5) onStateChange(removeWindow(state, dragState.windowId));
              }
            }
            gestureDragStateRef.current.delete(handIdx);
          }
          if (handIdx === 0) {
            setDraggingWindowId(null);
            setDragSource(null);
          }
          if (gestureDragStateRef.current.size === 0) {
            setTrashVisible(false);
            setTrashProgress(0);
          }
          setSwipeProgress(0);
          setSwipingWindowId(null);
          break;
        }

        case 'finger-count': {
          // Only process finger-count from the primary hand (handIndex 0)
          if (handIdx !== 0) break;

          // Pose is the authority: if the hand is making a fist, ignore
          // finger count entirely (fist can misreport 1 finger due to noise)
          if (event.pose === 'fist') {
            if (fingerHoldTimerRef.current !== null) {
              clearTimeout(fingerHoldTimerRef.current);
              fingerHoldTimerRef.current = null;
            }
            setFingerHoldProgress(0);
            fingerHoldStartRef.current = null;
            lastFingerCountRef.current = 0;
            break;
          }

          const prevCount = lastFingerCountRef.current;
          const newCount = event.fingerCount;

          // Cancel any pending hold timer when finger count changes
          if (fingerHoldTimerRef.current !== null) {
            clearTimeout(fingerHoldTimerRef.current);
            fingerHoldTimerRef.current = null;
          }

          // 1-3 fingers → start hold timer to spawn corresponding element
          // 4 fingers → start hold timer to switch camera
          // 0 fingers → cancel
          // Block spawning if an element is already selected (avoid conflicts)
          const hasSelected = state.windows.some((w) => w.selected);
          if (hasSelected && newCount >= 1 && newCount <= 3) {
            lastFingerCountRef.current = newCount;
            break;
          }
          if (newCount >= 1 && newCount <= 4 && newCount !== prevCount) {
            fingerHoldStartRef.current = { x: stageX, y: stageY };
            setFingerHoldProgress(0);

            // Animate progress ring
            const startTime = performance.now();
            const animateProgress = () => {
              const elapsed = performance.now() - startTime;
              const progress = Math.min(elapsed / FINGER_HOLD_MS, 1);
              setFingerHoldProgress(progress);
              if (progress < 1 && fingerHoldTimerRef.current !== null) {
                requestAnimationFrame(animateProgress);
              }
            };
            requestAnimationFrame(animateProgress);

            fingerHoldTimerRef.current = window.setTimeout(() => {
              const startPos = fingerHoldStartRef.current;
              if (!startPos) return;

              if (newCount === 4) {
                // 4 fingers → switch camera
                switchCamera();
              } else if (newCount === 1) {
                // 1 finger → if near a text element, edit it; otherwise spawn new text
                const nearestTextId = findNearestText(state.windows, startPos.x, startPos.y);
                if (nearestTextId) {
                  onStateChange(selectWindow(setEditing(state, nearestTextId, true), nearestTextId));
                } else {
                  onStateChange(addWindow(state, 'text', { x: startPos.x - 140, y: startPos.y - 40 }));
                }
              } else {
                // 2-4 fingers → spawn corresponding element
                const elementType = FINGER_TO_ELEMENT[newCount];
                if (elementType) {
                  onStateChange(addWindow(state, elementType, { x: startPos.x - 75, y: startPos.y - 50 }));
                }
              }

              fingerHoldTimerRef.current = null;
              setFingerHoldProgress(0);
            }, FINGER_HOLD_MS);
          } else if (newCount === 0) {
            setFingerHoldProgress(0);
            fingerHoldStartRef.current = null;
          }

          lastFingerCountRef.current = newCount;
          break;
        }
      }
    };

    gestureRecognizer.addListener(handleGestureEvent);
    return () => gestureRecognizer.removeListener(handleGestureEvent);
  }, [state, onStateChange, calculateTrashOverlap, spawnEmoji, switchCamera]);

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
        <AnimatePresence>
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
              swipeProgress={swipingWindowId === win.id ? swipeProgress : 0}
            />
          ))}
        </AnimatePresence>
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
        pinchProximity={Math.max(0, Math.min(1, 1 - (gestureState.pinchDistance - 0.55) / 0.35))}
        handIndex={0}
        holdProgress={fingerHoldProgress}
        holdLabel={fingerHoldProgress > 0 && fingerHoldProgress < 1 ? FINGER_LABELS[lastFingerCountRef.current] : undefined}
      />
      {gestureState.secondHand && (
        <VirtualCursor
          position={gestureState.secondHand.indexPosition}
          visible={true}
          isPinching={gestureState.secondHand.isPinching}
          pinchProximity={Math.max(0, Math.min(1, 1 - (gestureState.secondHand.pinchDistance - 0.55) / 0.35))}
          handIndex={1}
        />
      )}

      {/* Debug panel */}
      <DebugPanel gestureState={gestureState} visible={isDebugVisible} />

      {/* Barcode / QR scanner */}
      <BarcodeScanner
        videoRef={bgVideoRef}
        visible={scannerVisible}
        onClose={onScannerClose}
        onResult={(text, format) => {
          // Spawn a text window with the scanned content at center of stage
          const fgEl = foregroundRef.current;
          const rect = fgEl?.getBoundingClientRect();
          const x = rect ? rect.width / 2 - 140 : 100;
          const y = rect ? rect.height / 2 - 40 : 100;
          const newState = addWindow(state, 'text', { x, y });
          const added = newState.windows[newState.windows.length - 1];
          onStateChange(updateWindowData(newState, added.id, {
            kind: 'text',
            content: text,
          } as any));
          // Show toast notification
          setScanToast(`✅ ${format}: ${text.length > 40 ? text.slice(0, 40) + '…' : text}  —  copiado al portapapeles`);
          if (scanToastTimerRef.current) clearTimeout(scanToastTimerRef.current);
          scanToastTimerRef.current = window.setTimeout(() => setScanToast(null), 4000);
        }}
      />

      {/* Scan result toast */}
      {scanToast && (
        <div className="scan-toast" onClick={() => setScanToast(null)}>
          {scanToast}
        </div>
      )}

      {/* Virtual camera output */}
      <VirtualCameraOutput
        bgVideoRef={bgVideoRef}
        stageRef={stageRef}
        active={vcamActive}
        windows={state.windows}
      />
    </div>
  );
};
