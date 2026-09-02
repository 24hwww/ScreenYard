import { GesturePoint } from './types';

/**
 * One Euro Filter for 2D pointer tracking.
 *
 * Adaptively smooths noisy input: at low speed it applies heavy smoothing
 * (removes jitter), at high speed it applies light smoothing (removes lag).
 * This is the standard filter for noisy interactive pointer tracking,
 * outperforming simple EMA which uses a fixed alpha.
 *
 * Reference: Casiez, Roussel, Vogel (CHI 2012) — "1€ Filter"
 *
 * Parameters:
 *   minCutoff: minimum cutoff frequency (lower = more smoothing at low speed)
 *   beta: speed coefficient (higher = less smoothing at high speed)
 *   dCutoff: cutoff for derivative estimation (usually 1.0)
 */
class LowPassFilter {
  private hasPrevious = false;
  private prev: number = 0;

  reset(): void {
    this.hasPrevious = false;
    this.prev = 0;
  }

  filter(x: number, alpha: number): number {
    if (!this.hasPrevious) {
      this.prev = x;
      this.hasPrevious = true;
      return x;
    }
    const result = this.prev + alpha * (x - this.prev);
    this.prev = result;
    return result;
  }

  hasValue(): boolean {
    return this.hasPrevious;
  }

  lastValue(): number {
    return this.prev;
  }
}

function alphaFromCutoff(cutoff: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

export class GestureSmoother {
  private initialized = false;
  private lastTime = 0;

  /** Minimum cutoff frequency — controls smoothing at low speed */
  private minCutoff: number;
  /** Speed coefficient — controls smoothing reduction at high speed */
  private beta: number;
  /** Derivative cutoff — usually fixed at 1.0 */
  private dCutoff: number;

  // Per-axis filters: x, y, dx, dy
  private xFilter = new LowPassFilter();
  private yFilter = new LowPassFilter();
  private dxFilter = new LowPassFilter();
  private dyFilter = new LowPassFilter();

  // Backwards-compat fields (unused by One Euro but kept for API compat)
  private alpha: number;
  private deadZone: number;
  private predictionStrength: number;

  constructor(alpha = 0.55, deadZone = 0.001, predictionStrength = 0.3) {
    // Store legacy params for API compatibility
    this.alpha = alpha;
    this.deadZone = deadZone;
    this.predictionStrength = predictionStrength;

    // Map legacy alpha to One Euro parameters:
    // Higher alpha = more responsive → higher minCutoff + higher beta
    // Lower alpha = smoother → lower minCutoff + lower beta
    this.minCutoff = 0.8 + alpha * 2.5;   // ~1.2 to ~3.3 Hz
    this.beta = 0.5 + alpha * 3.0;         // ~0.8 to ~2.2
    this.dCutoff = 1.0;
  }

  /**
   * Smooth a new point using the One Euro Filter.
   * Returns the filtered position.
   */
  smooth(input: GesturePoint): GesturePoint {
    const now = performance.now();

    if (!this.initialized) {
      this.lastTime = now;
      this.xFilter.reset();
      this.yFilter.reset();
      this.dxFilter.reset();
      this.dyFilter.reset();
      this.initialized = true;

      const xFiltered = this.xFilter.filter(input.x, 1);
      const yFiltered = this.yFilter.filter(input.y, 1);
      return { x: xFiltered, y: yFiltered };
    }

    // Clamp dt to avoid huge jumps after pauses
    const dt = Math.max(0.001, Math.min(0.1, (now - this.lastTime) / 1000));
    this.lastTime = now;

    // Apply dead zone in raw input space
    const prevX = this.xFilter.hasValue() ? this.xFilter.lastValue() : input.x;
    const prevY = this.yFilter.hasValue() ? this.yFilter.lastValue() : input.y;
    const rawDx = input.x - prevX;
    const rawDy = input.y - prevY;

    if (Math.abs(rawDx) < this.deadZone && Math.abs(rawDy) < this.deadZone) {
      return { x: prevX, y: prevY };
    }

    // Filter the derivative to estimate speed
    const dAlpha = alphaFromCutoff(this.dCutoff, dt);
    const dxFiltered = this.dxFilter.filter(rawDx / dt, dAlpha);
    const dyFiltered = this.dyFilter.filter(rawDy / dt, dAlpha);

    // Compute speed-dependent cutoff
    const speed = Math.sqrt(dxFiltered * dxFiltered + dyFiltered * dyFiltered);
    const cutoff = this.minCutoff + this.beta * speed;

    // Filter position with adaptive alpha
    const posAlpha = alphaFromCutoff(cutoff, dt);
    const xFiltered = this.xFilter.filter(input.x, posAlpha);
    const yFiltered = this.yFilter.filter(input.y, posAlpha);

    return { x: xFiltered, y: yFiltered };
  }

  reset(): void {
    this.initialized = false;
    this.lastTime = 0;
    this.xFilter.reset();
    this.yFilter.reset();
    this.dxFilter.reset();
    this.dyFilter.reset();
  }

  setAlpha(alpha: number): void {
    this.alpha = Math.max(0, Math.min(1, alpha));
    this.minCutoff = 0.8 + this.alpha * 2.5;
    this.beta = 0.5 + this.alpha * 3.0;
  }
}
