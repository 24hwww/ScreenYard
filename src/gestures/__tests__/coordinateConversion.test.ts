import { describe, it, expect } from 'vitest';

/**
 * Coordinate normalization tests.
 * Hand tracking gives 0-1 coordinates; the stage converts them
 * to pixel positions using stage dimensions.
 */

function normalizeToStage(
  handX: number,
  handY: number,
  stageWidth: number,
  stageHeight: number,
): { x: number; y: number } {
  return {
    x: handX * stageWidth,
    y: handY * stageHeight,
  };
}

function stageToHand(
  stageX: number,
  stageY: number,
  stageWidth: number,
  stageHeight: number,
): { x: number; y: number } {
  return {
    x: stageX / stageWidth,
    y: stageY / stageHeight,
  };
}

describe('Coordinate conversion', () => {
  const STAGE_W = 1280;
  const STAGE_H = 720;

  it('converts normalized (0,0) to top-left pixel', () => {
    const result = normalizeToStage(0, 0, STAGE_W, STAGE_H);
    expect(result).toEqual({ x: 0, y: 0 });
  });

  it('converts normalized (1,1) to bottom-right pixel', () => {
    const result = normalizeToStage(1, 1, STAGE_W, STAGE_H);
    expect(result).toEqual({ x: STAGE_W, y: STAGE_H });
  });

  it('converts normalized (0.5, 0.5) to center', () => {
    const result = normalizeToStage(0.5, 0.5, STAGE_W, STAGE_H);
    expect(result.x).toBe(640);
    expect(result.y).toBe(360);
  });

  it('roundtrips stage -> hand -> stage', () => {
    const original = { x: 320, y: 180 };
    const hand = stageToHand(original.x, original.y, STAGE_W, STAGE_H);
    const back = normalizeToStage(hand.x, hand.y, STAGE_W, STAGE_H);
    expect(back.x).toBeCloseTo(original.x, 5);
    expect(back.y).toBeCloseTo(original.y, 5);
  });

  it('handles different aspect ratios', () => {
    const result = normalizeToStage(0.75, 0.25, 1920, 1080);
    expect(result.x).toBe(1440);
    expect(result.y).toBe(270);
  });
});
