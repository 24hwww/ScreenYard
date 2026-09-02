/** Normalized coordinates in stage space (0-1 range) */
export interface GesturePoint {
  x: number;
  y: number;
}

/**
 * Hand orientation detected from landmark z-depth values.
 */
export type HandOrientation = 'palm' | 'back' | 'side';

/**
 * Hand pose detected from finger positions.
 */
export type HandPose = 'open' | 'pinch' | 'fist' | 'point' | 'unknown';

/**
 * Recognized gesture types for triggering actions.
 */
export type RecognizedGesture =
  | 'none'
  | 'thumb_up'
  | 'thumbs_up_both'
  | 'peace'
  | 'wave';

export type GestureEventType =
  | 'pointer-move'
  | 'pinch-start'
  | 'pinch-move'
  | 'pinch-end'
  | 'hand-detected'
  | 'hand-lost'
  | 'finger-count'
  | 'gesture-detected';

export interface GestureEvent {
  type: GestureEventType;
  /** Which hand triggered this event (0 = primary, 1 = secondary) */
  handIndex: number;
  /** Normalized stage coordinates (0-1) */
  position: GesturePoint;
  /** Raw confidence from MediaPipe */
  confidence: number;
  /** Whether pinch is currently active */
  isPinching: boolean;
  /** Hand orientation */
  orientation: HandOrientation;
  /** Detected hand pose */
  pose: HandPose;
  /** Number of extended fingers (0-5) */
  fingerCount: number;
  /** Recognized gesture (thumb_up, peace, etc.) */
  gesture: RecognizedGesture;
  /** Timestamp */
  timestamp: number;
}

export interface GestureState {
  handDetected: boolean;
  isPinching: boolean;
  indexPosition: GesturePoint;
  pinchDistance: number;
  confidence: number;
  orientation: HandOrientation;
  pose: HandPose;
  fingerCount: number;
  gesture: RecognizedGesture;
  /** Secondary hand state (null if only one hand visible) */
  secondHand: {
    indexPosition: GesturePoint;
    isPinching: boolean;
    pinchDistance: number;
    confidence: number;
    orientation: HandOrientation;
    pose: HandPose;
    fingerCount: number;
    gesture: RecognizedGesture;
  } | null;
}
