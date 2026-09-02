import { GesturePoint, HandOrientation, HandPose, RecognizedGesture } from './types';

export interface HandLandmarkResult {
  landmarks: GesturePoint[];
  /** Raw 3D landmarks from MediaPipe (x, y, z) */
  landmarks3D: Array<{ x: number; y: number; z: number }>;
  confidence: number;
  indexTip: GesturePoint;
  thumbTip: GesturePoint;
  handIndex: number;
  orientation: HandOrientation;
  pose: HandPose;
  /** Number of extended fingers (0-5) */
  fingerCount: number;
  /** Recognized gesture */
  gesture: RecognizedGesture;
  /** Hand size (wrist→middle_mcp distance in normalized units) */
  handSize: number;
  /** Pinch distance normalized by hand size (unitless, ~0.3-1.5) */
  normalizedPinchDistance: number;
}

/** Callback receives an array of all detected hands per frame */
export type HandTrackerCallback = (results: HandLandmarkResult[]) => void;

/**
 * MediaPipe hand landmark indices:
 *  0: WRIST
 *  1: THUMB_CMC    2: THUMB_MCP    3: THUMB_IP    4: THUMB_TIP
 *  5: INDEX_MCP    6: INDEX_PIP    7: INDEX_DIP   8: INDEX_TIP
 *  9: MIDDLE_MCP  10: MIDDLE_PIP  11: MIDDLE_DIP 12: MIDDLE_TIP
 * 13: RING_MCP    14: RING_PIP    15: RING_DIP   16: RING_TIP
 * 17: PINKY_MCP   18: PINKY_PIP   19: PINKY_DIP  20: PINKY_TIP
 */
const WRIST = 0;
const THUMB_CMC = 1;
const THUMB_MCP = 2;
const THUMB_IP = 3;
const THUMB_TIP = 4;
const INDEX_MCP = 5;
const INDEX_PIP = 6;
const INDEX_DIP = 7;
const INDEX_TIP = 8;
const MIDDLE_MCP = 9;
const MIDDLE_PIP = 10;
const MIDDLE_DIP = 11;
const MIDDLE_TIP = 12;
const RING_MCP = 13;
const RING_PIP = 14;
const RING_DIP = 15;
const RING_TIP = 16;
const PINKY_MCP = 17;
const PINKY_PIP = 18;
const PINKY_DIP = 19;
const PINKY_TIP = 20;

type Point3D = { x: number; y: number; z: number };

// ─── 3D Geometry Helpers ───

function dist3D(a: Point3D, b: Point3D): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

function dist2D(a: Point3D, b: Point3D): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

/**
 * Angle at vertex B formed by points A-B-C, in degrees (0-180).
 * Uses 3D coordinates for robustness against hand rotation.
 */
function angle3D(a: Point3D, b: Point3D, c: Point3D): number {
  const ba = { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
  const bc = { x: c.x - b.x, y: c.y - b.y, z: c.z - b.z };
  const dot = ba.x * bc.x + ba.y * bc.y + ba.z * bc.z;
  const magBA = Math.sqrt(ba.x ** 2 + ba.y ** 2 + ba.z ** 2);
  const magBC = Math.sqrt(bc.x ** 2 + bc.y ** 2 + bc.z ** 2);
  if (magBA === 0 || magBC === 0) return 180;
  const cos = Math.max(-1, Math.min(1, dot / (magBA * magBC)));
  return (Math.acos(cos) * 180) / Math.PI;
}

/**
 * Compute hand size as the 2D distance from wrist to middle MCP.
 * Uses 2D (x, y) because MediaPipe's z-coordinate for hand landmarks
 * is relative and noisy. This is a stable reference for normalizing
 * measurements across different hand distances from the camera.
 */
function computeHandSize(landmarks3D: Point3D[]): number {
  return dist2D(landmarks3D[WRIST], landmarks3D[MIDDLE_MCP]);
}

/**
 * Wraps MediaPipe HandLandmarker for hand detection.
 * Supports up to 2 hands simultaneously.
 * Detects: orientation, pose, finger count, and gestures (thumb_up, etc.)
 * All processing happens locally in the browser.
 */
export class HandTracker {
  private handLandmarker: any | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private animationFrameId: number | null = null;
  private callback: HandTrackerCallback | null = null;
  private running = false;
  private initialized = false;

  /** Mirror X to make interaction feel natural (like a mirror) */
  private mirrorX = true;

  /** Minimum confidence to accept a hand detection (0-1).
   * Uses handedness score from MediaPipe, not wrist visibility
   * (which is always 0 for hand landmarks). */
  private minConfidence = 0.3;

  async initialize(
    videoElement: HTMLVideoElement,
    _stageWidth: number,
    _stageHeight: number,
  ): Promise<void> {
    // Guard: if already initialized, destroy the old landmarker first
    // to prevent multiple MediaPipe instances accumulating in memory
    if (this.initialized) {
      this.destroy();
    }

    this.videoElement = videoElement;

    const { HandLandmarker, FilesetResolver } = await import(
      '@mediapipe/tasks-vision'
    );

    const vision = await FilesetResolver.forVisionTasks(
      '/mediapipe/wasm',
    );

    // Model path: local file in public/mediapipe/ (works offline, no CDN dependency)
    const modelPath = '/mediapipe/hand_landmarker.task';

    // Try GPU first, fall back to CPU if GPU delegate fails
    // (not all browsers/devices support WebGPU or GPU-accelerated inference)
    try {
      this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: modelPath,
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
    } catch (gpuErr) {
      console.warn('GPU delegate failed, falling back to CPU:', gpuErr);
      this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: modelPath,
          delegate: 'CPU',
        },
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
    }
    this.initialized = true;
  }

  start(callback: HandTrackerCallback): void {
    if (this.running) return;
    if (!this.handLandmarker || !this.videoElement) {
      console.warn('HandTracker.start() called before initialize()');
      return;
    }
    this.running = true;
    this.callback = callback;
    this.detect();
  }

  stop(): void {
    this.running = false;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    this.callback = null;
  }

  /** Full teardown: stop loop + destroy MediaPipe landmarker + release GPU memory */
  destroy(): void {
    this.stop();
    if (this.handLandmarker) {
      try {
        this.handLandmarker.close?.();
      } catch (e) {
        // close() may throw if already closed — ignore
      }
      this.handLandmarker = null;
    }
    this.videoElement = null;
    this.initialized = false;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  // ─── Orientation Detection ───

  private detectOrientation(landmarks3D: Point3D[]): HandOrientation {
    const wrist = landmarks3D[WRIST];
    const indexMcp = landmarks3D[INDEX_MCP];
    const middleMcp = landmarks3D[MIDDLE_MCP];

    const avgMcpZ = (indexMcp.z + middleMcp.z) / 2;
    const relativeZ = avgMcpZ - wrist.z;

    if (relativeZ < -0.02) return 'palm';
    if (relativeZ > 0.02) return 'back';
    return 'side';
  }

  // ─── Pose Detection ───

  private detectPose(landmarks3D: Point3D[], handSize: number): HandPose {
    const wrist = landmarks3D[WRIST];
    const middleMcp = landmarks3D[MIDDLE_MCP];
    const palmCenter: Point3D = {
      x: (wrist.x + middleMcp.x) / 2,
      y: (wrist.y + middleMcp.y) / 2,
      z: (wrist.z + middleMcp.z) / 2,
    };

    // Use 2D distances for reliability (z is noisy in MediaPipe hand landmarks)
    const tipDistances = [
      dist2D(landmarks3D[INDEX_TIP], palmCenter),
      dist2D(landmarks3D[MIDDLE_TIP], palmCenter),
      dist2D(landmarks3D[RING_TIP], palmCenter),
      dist2D(landmarks3D[PINKY_TIP], palmCenter),
    ];

    const avgTipDist = tipDistances.reduce((a, b) => a + b, 0) / tipDistances.length;
    const handSize2D = dist2D(wrist, middleMcp) || 0.0001;
    const thumbIndexDist = dist2D(landmarks3D[THUMB_TIP], landmarks3D[INDEX_TIP]);
    const normalizedThumbIndex = thumbIndexDist / handSize2D;

    // Pinch: normalized distance small
    if (normalizedThumbIndex < 0.35) return 'pinch';
    // Fist: all fingertips close to palm center (normalized)
    if (avgTipDist / handSize2D < 0.6) return 'fist';

    const indexExtended = tipDistances[0] / handSize2D > 0.9;
    const othersCurled = tipDistances[1] / handSize2D < 0.7 && tipDistances[2] / handSize2D < 0.7 && tipDistances[3] / handSize2D < 0.7;
    if (indexExtended && othersCurled) return 'point';

    if (avgTipDist / handSize2D > 0.85) return 'open';

    return 'unknown';
  }

  // ─── Finger Counting ───

  /**
   * Count extended fingers (0-5) using 3D joint angles.
   *
   * For each finger (index, middle, ring, pinky): compute the angle at the PIP
   * joint (MCP-PIP-DIP). If the angle is > 160° the finger is extended; if
   * < 110° it's curled. This is robust to hand rotation and camera angle,
   * unlike pure y-coordinate comparison.
   *
   * For the thumb: use the angle at the IP joint (MCP-IP-TIP) plus a
   * distance check from the palm center, since the thumb moves differently.
   */
  private countFingers(landmarks3D: Point3D[], handSize: number): number {
    let count = 0;

    // Use 2D distances (x, y) from the WRIST as the primary signal.
    // MediaPipe's z-coordinate for hand landmarks is relative and noisy,
    // so 3D distances and angles are unreliable for finger counting.
    //
    // When a finger is EXTENDED: the tip is farther from the wrist than the PIP joint.
    // When a finger is CURLED: the tip comes back toward the palm, closer to the wrist.
    //
    // This is rotation-invariant in 2D and works regardless of hand orientation.

    const wrist = landmarks3D[WRIST];

    // ── Thumb ──
    // Thumb moves differently — compare tip distance from INDEX_MCP vs
    // THUMB_MCP distance from INDEX_MCP. When extended, the thumb tip is
    // farther from the index knuckle than the thumb base is.
    const indexMcp = landmarks3D[INDEX_MCP];
    const thumbTipDist = dist2D(landmarks3D[THUMB_TIP], indexMcp);
    const thumbMcpDist = dist2D(landmarks3D[THUMB_MCP], indexMcp);
    if (thumbTipDist > thumbMcpDist * 0.8) count++;

    // ── Index ──
    const indexTipWrist = dist2D(landmarks3D[INDEX_TIP], wrist);
    const indexPipWrist = dist2D(landmarks3D[INDEX_PIP], wrist);
    if (indexTipWrist > indexPipWrist) count++;

    // ── Middle ──
    const middleTipWrist = dist2D(landmarks3D[MIDDLE_TIP], wrist);
    const middlePipWrist = dist2D(landmarks3D[MIDDLE_PIP], wrist);
    if (middleTipWrist > middlePipWrist) count++;

    // ── Ring ──
    const ringTipWrist = dist2D(landmarks3D[RING_TIP], wrist);
    const ringPipWrist = dist2D(landmarks3D[RING_PIP], wrist);
    if (ringTipWrist > ringPipWrist) count++;

    // ── Pinky ──
    const pinkyTipWrist = dist2D(landmarks3D[PINKY_TIP], wrist);
    const pinkyPipWrist = dist2D(landmarks3D[PINKY_PIP], wrist);
    if (pinkyTipWrist > pinkyPipWrist) count++;

    return count;
  }

  // ─── Gesture Recognition ───

  /**
   * Detect specific gestures from finger count and hand state.
   *
   * Thumb up: thumb extended (count includes thumb), all other fingers curled,
   *          and thumb tip is above the thumb MCP (pointing up).
   */
  private detectGesture(landmarks3D: Point3D[], fingerCount: number): RecognizedGesture {
    const thumbTip = landmarks3D[THUMB_TIP];
    const thumbMcp = landmarks3D[THUMB_MCP];
    const thumbIp = landmarks3D[THUMB_IP];
    const wrist = landmarks3D[WRIST];

    // Use 2D distance from wrist for finger extension (same as countFingers)
    const indexExtended = dist2D(landmarks3D[INDEX_TIP], wrist) > dist2D(landmarks3D[INDEX_PIP], wrist);
    const middleExtended = dist2D(landmarks3D[MIDDLE_TIP], wrist) > dist2D(landmarks3D[MIDDLE_PIP], wrist);
    const ringExtended = dist2D(landmarks3D[RING_TIP], wrist) > dist2D(landmarks3D[RING_PIP], wrist);
    const pinkyExtended = dist2D(landmarks3D[PINKY_TIP], wrist) > dist2D(landmarks3D[PINKY_PIP], wrist);

    // Thumb up: thumb extended upward, all other fingers curled
    const thumbPointsUp = thumbTip.y < thumbIp.y - 0.03 && thumbTip.y < thumbMcp.y - 0.05;
    const othersCurled = !indexExtended && !middleExtended && !ringExtended && !pinkyExtended;

    if (thumbPointsUp && othersCurled) {
      return 'thumb_up';
    }

    // Peace sign: index + middle extended, others curled
    if (indexExtended && middleExtended && !ringExtended && !pinkyExtended) {
      return 'peace';
    }

    return 'none';
  }

  // ─── Main Detection Loop ───

  private detect = (): void => {
    if (!this.running || !this.videoElement || !this.handLandmarker) return;

    if (this.videoElement.readyState >= 2) {
      const results = this.handLandmarker.detectForVideo(
        this.videoElement,
        performance.now(),
      );

      const handResults: HandLandmarkResult[] = [];

      if (results.landmarks && results.landmarks.length > 0) {
        // MediaPipe returns handednesses (Left/Right with confidence score) per hand.
        const handednesses: any[] = results.handednesses || results.handedness || [];

        for (let i = 0; i < results.landmarks.length; i++) {
          const hand = results.landmarks[i];
          const wrist = hand[0];

          // Confidence: MediaPipe HandLandmarker does NOT populate visibility
          // on landmarks (that's PoseLandmarker). Use handedness score instead,
          // or default to 0.8 if not available.
          const handH = handednesses[i]?.[0];
          const confidence = handH?.score ?? 0.8;
          if (confidence < this.minConfidence) continue;

          // Determine stable handIndex from handedness label.
          // MediaPipe sees the RAW (unmirrored) video. In the raw frame:
          //   - User's LEFT hand is on the RIGHT side → MediaPipe labels it "Left"
          //   - User's RIGHT hand is on the LEFT side → MediaPipe labels it "Right"
          // After mirrorX, the screen flips like a mirror:
          //   - "Left" (user's left hand) appears on the LEFT side of screen
          //   - "Right" (user's right hand) appears on the RIGHT side of screen
          // We want handIndex 0 = left side of screen, handIndex 1 = right side.
          let handIndex = i; // fallback to detection order
          if (handednesses[i] && handednesses[i].length > 0) {
            const label = handednesses[i][0].categoryName || handednesses[i][0].label;
            if (this.mirrorX) {
              // Mirrored: "Left" → left side of screen → handIndex 0
              handIndex = label === 'Left' ? 0 : 1;
            } else {
              // Not mirrored: "Left" → right side of screen → handIndex 1
              handIndex = label === 'Left' ? 1 : 0;
            }
          }

          const landmarks3D: Point3D[] = hand.map((l: any) => ({
            x: this.mirrorX ? 1 - l.x : l.x,
            y: l.y,
            z: l.z,
          }));

          const rawIndexTip = hand[INDEX_TIP];
          const rawThumbTip = hand[THUMB_TIP];

          let indexX = rawIndexTip.x;
          let indexY = rawIndexTip.y;
          let thumbX = rawThumbTip.x;
          let thumbY = rawThumbTip.y;

          if (this.mirrorX) {
            indexX = 1 - indexX;
            thumbX = 1 - thumbX;
          }

          const indexTip: GesturePoint = { x: indexX, y: indexY };
          const thumbTip: GesturePoint = { x: thumbX, y: thumbY };

          const handSize = computeHandSize(landmarks3D);
          const orientation = this.detectOrientation(landmarks3D);
          const pose = this.detectPose(landmarks3D, handSize);
          const fingerCount = this.countFingers(landmarks3D, handSize);
          const gesture = this.detectGesture(landmarks3D, fingerCount);

          // Normalized pinch distance (by hand size)
          const pinchDist2D = dist2D(landmarks3D[INDEX_TIP], landmarks3D[THUMB_TIP]);
          const normalizedPinchDistance = handSize > 0 ? pinchDist2D / handSize : pinchDist2D;

          handResults.push({
            landmarks: landmarks3D.map((l) => ({ x: l.x, y: l.y })),
            landmarks3D,
            confidence,
            indexTip,
            thumbTip,
            handIndex,
            orientation,
            pose,
            fingerCount,
            gesture,
            handSize,
            normalizedPinchDistance,
          });
        }
      }

      // ALWAYS call callback, even with empty results (so GestureRecognizer
      // can emit hand-lost events). Never skip this.
      this.callback?.(handResults);
    }

    // Always use requestAnimationFrame for reliable continuous detection.
    // requestVideoFrameCallback can stop firing when the video element is
    // very small or throttled by the browser, causing detection to freeze.
    this.animationFrameId = requestAnimationFrame(this.detect);
  };
}
