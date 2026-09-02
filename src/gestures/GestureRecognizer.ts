import {
  GestureEvent, GesturePoint, GestureState,
  HandOrientation, HandPose, RecognizedGesture,
} from './types';
import { HandLandmarkResult } from './HandTracker';
import { GestureSmoother } from './GestureSmoother';

export type GestureEventListener = (event: GestureEvent) => void;

/** Normalized pinch thresholds (relative to hand size, unitless) */
const PINCH_THRESHOLD = 0.45;
const PINCH_RELEASE_THRESHOLD = 0.60;

/** How many consecutive frames a gesture must be detected before emitting */
const GESTURE_CONFIRM_FRAMES = 3;

interface PerHandState {
  handDetected: boolean;
  isPinching: boolean;
  indexPosition: GesturePoint;
  pinchDistance: number;
  confidence: number;
  orientation: HandOrientation;
  pose: HandPose;
  fingerCount: number;
  gesture: RecognizedGesture;
  /** Frame counter for gesture debouncing */
  gestureFrames: number;
  lastEmittedGesture: RecognizedGesture;
}

/**
 * Converts hand landmark data into gesture events.
 * Supports up to 2 hands simultaneously.
 * Tracks: position, pinch, orientation, pose, finger count, gestures.
 */
export class GestureRecognizer {
  private listeners: GestureEventListener[] = [];
  private primarySmoother: GestureSmoother;
  private secondarySmoother: GestureSmoother;
  private hands: Map<number, PerHandState> = new Map();

  constructor(primarySmoother?: GestureSmoother, secondarySmoother?: GestureSmoother) {
    this.primarySmoother = primarySmoother ?? new GestureSmoother();
    this.secondarySmoother = secondarySmoother ?? new GestureSmoother(0.55, 0.001, 0.3);
  }

  addListener(listener: GestureEventListener): void {
    this.listeners.push(listener);
  }

  removeListener(listener: GestureEventListener): void {
    this.listeners = this.listeners.filter((l) => l !== listener);
  }

  getState(): GestureState {
    const primary = this.hands.get(0);
    const secondary = this.hands.get(1);

    return {
      handDetected: primary?.handDetected ?? false,
      isPinching: primary?.isPinching ?? false,
      indexPosition: primary?.indexPosition ?? { x: 0, y: 0 },
      pinchDistance: primary?.pinchDistance ?? 0,
      confidence: primary?.confidence ?? 0,
      orientation: primary?.orientation ?? 'side',
      pose: primary?.pose ?? 'unknown',
      fingerCount: primary?.fingerCount ?? 0,
      gesture: primary?.gesture ?? 'none',
      secondHand: secondary?.handDetected
        ? {
            indexPosition: secondary.indexPosition,
            isPinching: secondary.isPinching,
            pinchDistance: secondary.pinchDistance,
            confidence: secondary.confidence,
            orientation: secondary.orientation,
            pose: secondary.pose,
            fingerCount: secondary.fingerCount,
            gesture: secondary.gesture,
          }
        : null,
    };
  }

  processAllHands(results: HandLandmarkResult[]): void {
    const activeHandIndices = new Set(results.map((r) => r.handIndex));

    for (const result of results) {
      this.processSingleHand(result);
    }

    for (const [idx, state] of this.hands) {
      if (!activeHandIndices.has(idx) && state.handDetected) {
        this.emitHandLost(idx, state);
      }
    }
  }

  processHandResult(result: HandLandmarkResult | null): void {
    if (!result) {
      const state = this.hands.get(0);
      if (state?.handDetected) {
        this.emitHandLost(0, state);
      }
      return;
    }
    this.processSingleHand(result);
  }

  private processSingleHand(result: HandLandmarkResult): void {
    const {
      indexTip, thumbTip, confidence, handIndex,
      orientation, pose, fingerCount, gesture,
      normalizedPinchDistance,
    } = result;

    let state = this.hands.get(handIndex);
    if (!state) {
      state = {
        handDetected: false,
        isPinching: false,
        indexPosition: { x: 0, y: 0 },
        pinchDistance: 0,
        confidence: 0,
        orientation: 'side',
        pose: 'unknown',
        fingerCount: 0,
        gesture: 'none',
        gestureFrames: 0,
        lastEmittedGesture: 'none',
      };
      this.hands.set(handIndex, state);
    }

    if (!state.handDetected) {
      state.handDetected = true;
      this.emit({
        type: 'hand-detected',
        handIndex,
        position: indexTip,
        confidence,
        isPinching: false,
        orientation,
        pose,
        fingerCount,
        gesture,
        timestamp: performance.now(),
      });
    }

    state.confidence = confidence;
    state.orientation = orientation;
    state.pose = pose;

    // Smooth position
    const smoother = handIndex === 0 ? this.primarySmoother : this.secondarySmoother;
    const smoothed = smoother.smooth(indexTip);
    state.indexPosition = smoothed;

    // Pinch distance (normalized by hand size for robustness)
    const pinchDistance = normalizedPinchDistance;
    state.pinchDistance = pinchDistance;

    // Emit pointer-move
    this.emit({
      type: 'pointer-move',
      handIndex,
      position: smoothed,
      confidence,
      isPinching: state.isPinching,
      orientation,
      pose,
      fingerCount,
      gesture,
      timestamp: performance.now(),
    });

    // Pinch state transitions
    if (!state.isPinching && pinchDistance < PINCH_THRESHOLD) {
      state.isPinching = true;
      this.emit({
        type: 'pinch-start',
        handIndex,
        position: smoothed,
        confidence,
        isPinching: true,
        orientation,
        pose,
        fingerCount,
        gesture,
        timestamp: performance.now(),
      });
    } else if (state.isPinching && pinchDistance > PINCH_RELEASE_THRESHOLD) {
      state.isPinching = false;
      this.emit({
        type: 'pinch-end',
        handIndex,
        position: smoothed,
        confidence,
        isPinching: false,
        orientation,
        pose,
        fingerCount,
        gesture,
        timestamp: performance.now(),
      });
    } else if (state.isPinching) {
      this.emit({
        type: 'pinch-move',
        handIndex,
        position: smoothed,
        confidence,
        isPinching: true,
        orientation,
        pose,
        fingerCount,
        gesture,
        timestamp: performance.now(),
      });
    }

    // Finger count change event
    if (fingerCount !== state.fingerCount) {
      state.fingerCount = fingerCount;
      this.emit({
        type: 'finger-count',
        handIndex,
        position: smoothed,
        confidence,
        isPinching: state.isPinching,
        orientation,
        pose,
        fingerCount,
        gesture,
        timestamp: performance.now(),
      });
    }

    // Gesture detection with debouncing (must hold for N frames)
    if (gesture !== 'none' && gesture === state.gesture) {
      state.gestureFrames++;
      if (state.gestureFrames >= GESTURE_CONFIRM_FRAMES && gesture !== state.lastEmittedGesture) {
        state.lastEmittedGesture = gesture;
        this.emit({
          type: 'gesture-detected',
          handIndex,
          position: smoothed,
          confidence,
          isPinching: state.isPinching,
          orientation,
          pose,
          fingerCount,
          gesture,
          timestamp: performance.now(),
        });
      }
    } else {
      state.gestureFrames = 0;
      state.gesture = gesture;
      if (gesture === 'none') {
        state.lastEmittedGesture = 'none';
      }
    }
  }

  private emitHandLost(handIndex: number, state: PerHandState): void {
    state.handDetected = false;
    this.emit({
      type: 'hand-lost',
      handIndex,
      position: state.indexPosition,
      confidence: 0,
      isPinching: false,
      orientation: state.orientation,
      pose: state.pose,
      fingerCount: state.fingerCount,
      gesture: state.gesture,
      timestamp: performance.now(),
    });
    if (state.isPinching) {
      state.isPinching = false;
      this.emit({
        type: 'pinch-end',
        handIndex,
        position: state.indexPosition,
        confidence: 0,
        isPinching: false,
        orientation: state.orientation,
        pose: state.pose,
        fingerCount: 0,
        gesture: 'none',
        timestamp: performance.now(),
      });
    }
  }

  private emit(event: GestureEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
