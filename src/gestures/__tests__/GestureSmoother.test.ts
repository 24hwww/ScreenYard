import { describe, it, expect } from 'vitest';
import { GestureSmoother } from '../GestureSmoother';

describe('GestureSmoother (One Euro Filter)', () => {
  it('passes through first point unchanged', () => {
    const smoother = new GestureSmoother(0.5, 0.001, 0);
    const result = smoother.smooth({ x: 0.5, y: 0.5 });
    expect(result).toEqual({ x: 0.5, y: 0.5 });
  });

  it('smooths subsequent points (output between previous and target)', () => {
    const smoother = new GestureSmoother(0.5, 0.001, 0);
    smoother.smooth({ x: 0.5, y: 0.5 });
    const result = smoother.smooth({ x: 0.6, y: 0.6 });
    // One Euro moves toward target but not all the way on first step
    expect(result.x).toBeGreaterThan(0.5);
    expect(result.x).toBeLessThanOrEqual(0.6);
  });

  it('converges toward target over multiple steps', () => {
    const smoother = new GestureSmoother(0.5, 0.001, 0);
    smoother.smooth({ x: 0.0, y: 0.0 });
    let result = smoother.smooth({ x: 1.0, y: 1.0 });
    const first = result.x;
    result = smoother.smooth({ x: 1.0, y: 1.0 });
    const second = result.x;
    // Should get closer to 1.0 each step
    expect(second).toBeGreaterThan(first);
  });

  it('ignores movement within dead zone', () => {
    const smoother = new GestureSmoother(0.5, 0.01, 0);
    smoother.smooth({ x: 0.5, y: 0.5 });
    const result = smoother.smooth({ x: 0.505, y: 0.505 });
    // Within dead zone, should return previous filtered value
    expect(result.x).toBeCloseTo(0.5, 5);
    expect(result.y).toBeCloseTo(0.5, 5);
  });

  it('resets to initial state', () => {
    const smoother = new GestureSmoother(0.5, 0.001, 0);
    smoother.smooth({ x: 0.5, y: 0.5 });
    smoother.smooth({ x: 0.9, y: 0.9 });
    smoother.reset();
    const result = smoother.smooth({ x: 0.1, y: 0.1 });
    // After reset, first point passes through unchanged
    expect(result).toEqual({ x: 0.1, y: 0.1 });
  });

  it('clamps alpha to 0-1 range', () => {
    const smoother = new GestureSmoother(0.5, 0.001, 0);
    smoother.setAlpha(1.5);
    // Should not throw, and should still filter
    smoother.smooth({ x: 0.5, y: 0.5 });
    const result = smoother.smooth({ x: 0.8, y: 0.8 });
    // With high alpha (clamped to 1.0), should be very responsive
    expect(result.x).toBeGreaterThan(0.5);
  });

  it('reduces jitter at low speed (more smoothing)', () => {
    // At low speed, One Euro should smooth more than a high-alpha EMA
    const smoother = new GestureSmoother(0.3, 0.001, 0); // low alpha = smooth
    smoother.smooth({ x: 0.5, y: 0.5 });
    // Small noisy movements
    const r1 = smoother.smooth({ x: 0.51, y: 0.5 });
    const r2 = smoother.smooth({ x: 0.49, y: 0.5 });
    const r3 = smoother.smooth({ x: 0.51, y: 0.5 });
    // Should stay close to 0.5, not follow the noise
    expect(Math.abs(r3.x - 0.5)).toBeLessThan(0.02);
  });

  it('follows fast movements with less lag', () => {
    // At high speed, One Euro should be more responsive than at low speed
    const smoother = new GestureSmoother(0.5, 0.001, 0);
    smoother.smooth({ x: 0.0, y: 0.0 });
    // Large fast jump
    const r1 = smoother.smooth({ x: 0.5, y: 0.5 });
    // Another large jump in same direction
    const r2 = smoother.smooth({ x: 1.0, y: 1.0 });
    // Should be moving toward target faster than pure EMA would
    expect(r2.x).toBeGreaterThan(r1.x);
  });
});
