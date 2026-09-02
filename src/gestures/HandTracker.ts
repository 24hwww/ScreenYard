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
const INDEX_TIP = 8;
const MIDDLE_MCP = 9;
const MIDDLE_PIP = 10;
const MIDDLE_TIP = 12;
const RING_MCP = 13;
const RING_PIP = 14;
const RING_TIP = 16;
const PINKY_MCP = 17;
const PINKY_PIP = 18;
const PINKY_TIP = 20;

type Point3D = { x: number; y: number; z: number };

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

  /** Mirror X to make interaction feel natural (like a mirror) */
  private mirrorX = true;

  async initialize(
    videoElement: HTMLVideoElement,
    _stageWidth: number,
    _stageHeight: number,
  ): Promise<void> {
    this.videoElement = videoElement;

    const { HandLandmarker, FilesetResolver } = await import(
      '@mediapipe/tasks-vision'
    );

    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm',
    );

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

  private detectPose(landmarks3D: Point3D[]): HandPose {
    const wrist = landmarks3D[WRIST];
    const middleMcp = landmarks3D[MIDDLE_MCP];
    const palmCenter: Point3D = {
      x: (wrist.x + middleMcp.x) / 2,
      y: (wrist.y + middleMcp.y) / 2,
      z: (wrist.z + middleMcp.z) / 2,
    };

    const dist3D = (a: Point3D, b: Point3D) =>
      Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);

    const tipDistances = [
      dist3D(landmarks3D[INDEX_TIP], palmCenter),
      dist3D(landmarks3D[MIDDLE_TIP], palmCenter),
      dist3D(landmarks3D[RING_TIP], palmCenter),
      dist3D(landmarks3D[PINKY_TIP], palmCenter),
    ];

    const avgTipDist = tipDistances.reduce((a, b) => a + b, 0) / tipDistances.length;
    const thumbIndexDist = dist3D(landmarks3D[THUMB_TIP], landmarks3D[INDEX_TIP]);

    if (thumbIndexDist < 0.06) return 'pinch';
    if (avgTipDist < 0.10) return 'fist';

    const indexExtended = tipDistances[0] > 0.15;
    const othersCurled = tipDistances[1] < 0.12 && tipDistances[2] < 0.12 && tipDistances[3] < 0.12;
    if (indexExtended && othersCurled) return 'point';

    if (avgTipDist > 0.14) return 'open';

    return 'unknown';
  }

  // ─── Finger Counting ───

  /**
   * Count extended fingers (0-5).
   *
   * For thumb: check if tip is farther from palm center than the IP joint.
   * For other fingers: check if tip y is above (less than) PIP y (finger extended).
   * This works because in screen coords, y=0 is top.
   */
  private countFingers(landmarks3D: Point3D[]): number {
    let count = 0;

    // Thumb: extended if tip is significantly to the side of IP joint
    // (use x-axis distance from wrist for horizontal thumb extension)
    const wrist = landmarks3D[WRIST];
    const thumbTip = landmarks3D[THUMB_TIP];
    const thumbIp = landmarks3D[THUMB_IP];
    const thumbMcp = landmarks3D[THUMB_MCP];

    // Thumb extended: tip is farther from palm center than IP joint
    const palmCenterX = (wrist.x + landmarks3D[MIDDLE_MCP].x) / 2;
    const tipDistX = Math.abs(thumbTip.x - palmCenterX);
    const ipDistX = Math.abs(thumbIp.x - palmCenterX);
    if (tipDistX > ipDistX + 0.02) count++;

    // Index: tip above PIP (lower y value = higher on screen)
    if (landmarks3D[INDEX_TIP].y < landmarks3D[INDEX_PIP].y) count++;

    // Middle: tip above PIP
    if (landmarks3D[MIDDLE_TIP].y < landmarks3D[MIDDLE_PIP].y) count++;

    // Ring: tip above PIP
    if (landmarks3D[RING_TIP].y < landmarks3D[RING_PIP].y) count++;

    // Pinky: tip above PIP
    if (landmarks3D[PINKY_TIP].y < landmarks3D[PINKY_PIP].y) count++;

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

    const indexExtended = landmarks3D[INDEX_TIP].y < landmarks3D[INDEX_PIP].y;
    const middleExtended = landmarks3D[MIDDLE_TIP].y < landmarks3D[MIDDLE_PIP].y;
    const ringExtended = landmarks3D[RING_TIP].y < landmarks3D[RING_PIP].y;
    const pinkyExtended = landmarks3D[PINKY_TIP].y < landmarks3D[PINKY_PIP].y;

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
        for (let i = 0; i < results.landmarks.length; i++) {
          const hand = results.landmarks[i];
          const wrist = hand[0];

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

          const confidence = wrist.visibility ?? 0.8;
          const orientation = this.detectOrientation(landmarks3D);
          const pose = this.detectPose(landmarks3D);
          const fingerCount = this.countFingers(landmarks3D);
          const gesture = this.detectGesture(landmarks3D, fingerCount);

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
          });
        }
      }

      this.callback?.(handResults);
    }

    this.animationFrameId = requestAnimationFrame(this.detect);
  };
}
