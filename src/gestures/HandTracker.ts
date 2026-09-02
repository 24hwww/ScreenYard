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
 * Compute hand size as the distance from wrist to middle MCP.
 * This is a stable reference for normalizing measurements across
 * different hand distances from the camera.
 */
function computeHandSize(landmarks3D: Point3D[]): number {
  return dist3D(landmarks3D[WRIST], landmarks3D[MIDDLE_MCP]);
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
  private videoFrameCallbackId: number | null = null;
  private callback: HandTrackerCallback | null = null;
  private running = false;

  /** Mirror X to make interaction feel natural (like a mirror) */
  private mirrorX = true;

  /** Minimum confidence to accept a hand detection (0-1) */
  private minConfidence = 0.5;

  /** Whether the browser supports requestVideoFrameCallback */
  private useVideoFrameCallback = false;

  async initialize(
    videoElement: HTMLVideoElement,
    _stageWidth: number,
    _stageHeight: number,
  ): Promise<void> {
    this.videoElement = videoElement;

    // Check if requestVideoFrameCallback is available (more efficient than rAF
    // for video processing — only fires when a new frame is ready)
    this.useVideoFrameCallback =
      typeof (videoElement as any).requestVideoFrameCallback === 'function';

    const { HandLandmarker, FilesetResolver } = await import(
      '@mediapipe/tasks-vision'
    );

    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm',
    );

    // Try GPU first, fall back to CPU if GPU delegate fails
    // (not all browsers/devices support WebGPU or GPU-accelerated inference)
    try {
      this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
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
          modelAssetPath:
            'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
          delegate: 'CPU',
        },
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
    }
  }

  start(callback: HandTrackerCallback): void {
    if (this.running) return;
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
    if (this.videoFrameCallbackId !== null && this.videoElement) {
      (this.videoElement as any).cancelVideoFrameCallback?.(this.videoFrameCallbackId);
      this.videoFrameCallbackId = null;
    }
    this.callback = null;
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

    const tipDistances = [
      dist3D(landmarks3D[INDEX_TIP], palmCenter),
      dist3D(landmarks3D[MIDDLE_TIP], palmCenter),
      dist3D(landmarks3D[RING_TIP], palmCenter),
      dist3D(landmarks3D[PINKY_TIP], palmCenter),
    ];

    const avgTipDist = tipDistances.reduce((a, b) => a + b, 0) / tipDistances.length;
    // Normalize by hand size for robustness across distances
    const thumbIndexDist = dist3D(landmarks3D[THUMB_TIP], landmarks3D[INDEX_TIP]);
    const normalizedThumbIndex = thumbIndexDist / handSize;

    // Pinch: normalized distance small (works regardless of hand distance from camera)
    if (normalizedThumbIndex < 0.35) return 'pinch';
    // Fist: all fingertips close to palm center (normalized)
    if (avgTipDist / handSize < 0.6) return 'fist';

    const indexExtended = tipDistances[0] / handSize > 0.9;
    const othersCurled = tipDistances[1] / handSize < 0.7 && tipDistances[2] / handSize < 0.7 && tipDistances[3] / handSize < 0.7;
    if (indexExtended && othersCurled) return 'point';

    if (avgTipDist / handSize > 0.85) return 'open';

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

    // ── Thumb ──
    // Use angle at IP joint + distance from palm center
    const thumbAngle = angle3D(landmarks3D[THUMB_MCP], landmarks3D[THUMB_IP], landmarks3D[THUMB_TIP]);
    const palmCenter: Point3D = {
      x: (landmarks3D[WRIST].x + landmarks3D[MIDDLE_MCP].x) / 2,
      y: (landmarks3D[WRIST].y + landmarks3D[MIDDLE_MCP].y) / 2,
      z: (landmarks3D[WRIST].z + landmarks3D[MIDDLE_MCP].z) / 2,
    };
    const thumbTipDist = dist3D(landmarks3D[THUMB_TIP], palmCenter);
    const thumbIpDist = dist3D(landmarks3D[THUMB_IP], palmCenter);
    // Thumb is extended if: angle is relatively straight AND tip is farther from palm than IP
    if (thumbAngle > 140 && thumbTipDist > thumbIpDist + handSize * 0.05) count++;

    // ── Index ──
    const indexAngle = angle3D(landmarks3D[INDEX_MCP], landmarks3D[INDEX_PIP], landmarks3D[INDEX_DIP]);
    if (indexAngle > 160) count++;

    // ── Middle ──
    const middleAngle = angle3D(landmarks3D[MIDDLE_MCP], landmarks3D[MIDDLE_PIP], landmarks3D[MIDDLE_DIP]);
    if (middleAngle > 160) count++;

    // ── Ring ──
    const ringAngle = angle3D(landmarks3D[RING_MCP], landmarks3D[RING_PIP], landmarks3D[RING_DIP]);
    if (ringAngle > 160) count++;

    // ── Pinky ──
    const pinkyAngle = angle3D(landmarks3D[PINKY_MCP], landmarks3D[PINKY_PIP], landmarks3D[PINKY_DIP]);
    if (pinkyAngle > 160) count++;

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

    // Use 3D angles for finger extension detection
    const indexAngle = angle3D(landmarks3D[INDEX_MCP], landmarks3D[INDEX_PIP], landmarks3D[INDEX_DIP]);
    const middleAngle = angle3D(landmarks3D[MIDDLE_MCP], landmarks3D[MIDDLE_PIP], landmarks3D[MIDDLE_DIP]);
    const ringAngle = angle3D(landmarks3D[RING_MCP], landmarks3D[RING_PIP], landmarks3D[RING_DIP]);
    const pinkyAngle = angle3D(landmarks3D[PINKY_MCP], landmarks3D[PINKY_PIP], landmarks3D[PINKY_DIP]);

    const indexExtended = indexAngle > 160;
    const middleExtended = middleAngle > 160;
    const ringExtended = ringAngle > 160;
    const pinkyExtended = pinkyAngle > 160;

    // Thumb up: thumb extended upward, all other fingers curled
    // Use y-comparison for "up" direction (still needed for orientation)
    // but add angle check for thumb straightness
    const thumbAngle = angle3D(landmarks3D[THUMB_MCP], landmarks3D[THUMB_IP], landmarks3D[THUMB_TIP]);
    const thumbPointsUp = thumbTip.y < thumbIp.y - 0.03 && thumbTip.y < thumbMcp.y - 0.05 && thumbAngle > 140;
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
        // Use handedness data from MediaPipe if available for stable left/right
        const handednesses = results.handednesses || results.handedness || [];

        for (let i = 0; i < results.landmarks.length; i++) {
          const hand = results.landmarks[i];
          const wrist = hand[0];

          // Confidence filtering: skip low-confidence detections
          const confidence = wrist.visibility ?? 0.8;
          if (confidence < this.minConfidence) continue;

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
            handIndex: i,
            orientation,
            pose,
            fingerCount,
            gesture,
            handSize,
            normalizedPinchDistance,
          });
        }
      }

      this.callback?.(handResults);
    }

    // Use requestVideoFrameCallback when available (fires only on new video frames,
    // more efficient than rAF which fires on every display refresh)
    if (this.useVideoFrameCallback && this.videoElement) {
      this.videoFrameCallbackId = (this.videoElement as any).requestVideoFrameCallback(
        this.detect,
      );
    } else {
      this.animationFrameId = requestAnimationFrame(this.detect);
    }
  };
}
