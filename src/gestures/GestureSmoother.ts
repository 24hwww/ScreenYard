import { GesturePoint } from './types';

/**
 * Smooths gesture coordinates using EMA with velocity-based prediction.
 * Predicts where the hand is going for more fluid, responsive movement.
 */
export class GestureSmoother {
  private smoothed: GesturePoint = { x: 0, y: 0 };
  private velocity: GesturePoint = { x: 0, y: 0 };
  private initialized = false;
  private lastTime = 0;

  /** Smoothing factor: higher = more responsive but noisier */
  private alpha: number;

  /** Dead zone: movements smaller than this are ignored */
  private deadZone: number;

  /** How much velocity influences prediction (0 = no prediction) */
  private predictionStrength: number;

  constructor(alpha = 0.55, deadZone = 0.001, predictionStrength = 0.3) {
    this.alpha = alpha;
    this.deadZone = deadZone;
    this.predictionStrength = predictionStrength;
  }

  /**
   * Smooth a new point with velocity prediction.
   * Returns the predicted smoothed position.
   */
  smooth(input: GesturePoint): GesturePoint {
    const now = performance.now();

    if (!this.initialized) {
      this.smoothed = { ...input };
      this.velocity = { x: 0, y: 0 };
      this.lastTime = now;
      this.initialized = true;
      return this.smoothed;
    }

    const dt = Math.max(1, now - this.lastTime) / 16; // normalize to ~60fps
    this.lastTime = now;

    const dx = input.x - this.smoothed.x;
    const dy = input.y - this.smoothed.y;

    // Apply dead zone
    if (Math.abs(dx) < this.deadZone && Math.abs(dy) < this.deadZone) {
      // Still update velocity to zero when stationary
      this.velocity = {
        x: this.velocity.x * 0.8,
        y: this.velocity.y * 0.8,
      };
      return this.smoothed;
    }

    // Update velocity with EMA (smooth velocity too)
    const rawVx = dx / dt;
    const rawVy = dy / dt;
    this.velocity = {
      x: this.velocity.x * 0.7 + rawVx * 0.3,
      y: this.velocity.y * 0.7 + rawVy * 0.3,
    };

    // EMA smoothing on position
    const smoothedX = this.smoothed.x + this.alpha * dx;
    const smoothedY = this.smoothed.y + this.alpha * dy;

    // Predict ahead based on velocity
    const predX = smoothedX + this.velocity.x * this.predictionStrength;
    const predY = smoothedY + this.velocity.y * this.predictionStrength;

    this.smoothed = { x: predX, y: predY };
    return this.smoothed;
  }

  reset(): void {
    this.initialized = false;
    this.smoothed = { x: 0, y: 0 };
    this.velocity = { x: 0, y: 0 };
    this.lastTime = 0;
  }

  setAlpha(alpha: number): void {
    this.alpha = Math.max(0, Math.min(1, alpha));
  }
}
