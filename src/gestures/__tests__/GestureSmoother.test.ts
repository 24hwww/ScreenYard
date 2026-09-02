import { describe, it, expect } from 'vitest';
import { GestureSmoother } from '../GestureSmoother';

describe('GestureSmoother', () => {
  it('passes through first point unchanged', () => {
    const smoother = new GestureSmoother(0.5, 0.001, 0);
    const result = smoother.smooth({ x: 0.5, y: 0.5 });
    expect(result).toEqual({ x: 0.5, y: 0.5 });
  });

  it('smooths subsequent points with EMA (no prediction)', () => {
    const smoother = new GestureSmoother(0.5, 0.001, 0);
    smoother.smooth({ x: 0.5, y: 0.5 });
    const result = smoother.smooth({ x: 0.6, y: 0.6 });
    // EMA without prediction: position moves toward target
    expect(result.x).toBeGreaterThan(0.5);
    expect(result.x).toBeLessThan(0.6);
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
    expect(result.x).toBe(0.5);
    expect(result.y).toBe(0.5);
  });

  it('resets to initial state', () => {
    const smoother = new GestureSmoother(0.5, 0.001, 0);
    smoother.smooth({ x: 0.5, y: 0.5 });
    smoother.smooth({ x: 0.9, y: 0.9 });
    smoother.reset();
    const result = smoother.smooth({ x: 0.1, y: 0.1 });
    expect(result).toEqual({ x: 0.1, y: 0.1 });
  });

  it('clamps alpha to 0-1 range', () => {
    const smoother = new GestureSmoother(0.5, 0.001, 0);
    smoother.setAlpha(1.5);
    smoother.smooth({ x: 0.5, y: 0.5 });
    const result = smoother.smooth({ x: 0.8, y: 0.8 });
    // Alpha clamped to 1.0, should jump to new position
    expect(result.x).toBeCloseTo(0.8, 3);
  });

  it('prediction pushes result ahead of pure EMA', () => {
    // Compare prediction=0 vs prediction=0.5
    const noPred = new GestureSmoother(0.55, 0.001, 0);
    const withPred = new GestureSmoother(0.55, 0.001, 0.5);

    noPred.smooth({ x: 0.3, y: 0.3 });
    withPred.smooth({ x: 0.3, y: 0.3 });

    // Give both some velocity by moving
    const r1 = noPred.smooth({ x: 0.5, y: 0.5 });
    const r2 = withPred.smooth({ x: 0.5, y: 0.5 });

    // With prediction, the result should be further along
    expect(r2.x).toBeGreaterThanOrEqual(r1.x);
  });
});
