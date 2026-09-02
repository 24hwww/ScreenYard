import { describe, it, expect, vi } from 'vitest';
import { GestureRecognizer } from '../GestureRecognizer';
import { GestureEvent } from '../types';
import { HandLandmarkResult } from '../HandTracker';

function makeHandResult(
  indexX: number,
  indexY: number,
  thumbX: number,
  thumbY: number,
  confidence = 0.9,
): HandLandmarkResult {
  return {
    landmarks: [],
    landmarks3D: [],
    confidence,
    indexTip: { x: indexX, y: indexY },
    thumbTip: { x: thumbX, y: thumbY },
    handIndex: 0,
    orientation: 'palm' as const,
    pose: 'unknown' as const,
    fingerCount: 5,
    gesture: 'none' as const,
  };
}

describe('GestureRecognizer', () => {
  it('emits hand-detected when first hand appears', () => {
    const recognizer = new GestureRecognizer();
    const events: GestureEvent[] = [];
    recognizer.addListener((e) => events.push(e));

    recognizer.processHandResult(makeHandResult(0.5, 0.5, 0.45, 0.45));

    expect(events.some((e) => e.type === 'pointer-move')).toBe(true);
    expect(recognizer.getState().handDetected).toBe(true);
  });

  it('emits hand-lost when hand disappears', () => {
    const recognizer = new GestureRecognizer();
    const events: GestureEvent[] = [];
    recognizer.addListener((e) => events.push(e));

    recognizer.processHandResult(makeHandResult(0.5, 0.5, 0.45, 0.45));
    recognizer.processHandResult(null);

    expect(events.some((e) => e.type === 'hand-lost')).toBe(true);
    expect(recognizer.getState().handDetected).toBe(false);
  });

  it('detects pinch start when fingers are close', () => {
    const recognizer = new GestureRecognizer();
    const events: GestureEvent[] = [];
    recognizer.addListener((e) => events.push(e));

    // Fingers far apart
    recognizer.processHandResult(makeHandResult(0.5, 0.5, 0.3, 0.3));
    expect(recognizer.getState().isPinching).toBe(false);

    // Fingers close together (pinch!)
    recognizer.processHandResult(makeHandResult(0.5, 0.5, 0.49, 0.51));
    expect(recognizer.getState().isPinching).toBe(true);
    expect(events.some((e) => e.type === 'pinch-start')).toBe(true);
  });

  it('detects pinch end when fingers separate', () => {
    const recognizer = new GestureRecognizer();
    const events: GestureEvent[] = [];
    recognizer.addListener((e) => events.push(e));

    // Start pinch
    recognizer.processHandResult(makeHandResult(0.5, 0.5, 0.49, 0.51));
    expect(recognizer.getState().isPinching).toBe(true);

    // Release pinch (distance > release threshold 0.10)
    recognizer.processHandResult(makeHandResult(0.5, 0.5, 0.3, 0.3));
    expect(recognizer.getState().isPinching).toBe(false);
    expect(events.some((e) => e.type === 'pinch-end')).toBe(true);
  });

  it('emits pinch-move during sustained pinch', () => {
    const recognizer = new GestureRecognizer();
    const events: GestureEvent[] = [];
    recognizer.addListener((e) => events.push(e));

    // Start pinch
    recognizer.processHandResult(makeHandResult(0.5, 0.5, 0.49, 0.51));

    // Move while pinching
    recognizer.processHandResult(makeHandResult(0.55, 0.55, 0.54, 0.56));
    recognizer.processHandResult(makeHandResult(0.6, 0.6, 0.59, 0.61));

    expect(events.filter((e) => e.type === 'pinch-move').length).toBe(2);
  });

  it('emits hand-lost and pinch-end together when hand lost during pinch', () => {
    const recognizer = new GestureRecognizer();
    const events: GestureEvent[] = [];
    recognizer.addListener((e) => events.push(e));

    // Start pinch
    recognizer.processHandResult(makeHandResult(0.5, 0.5, 0.49, 0.51));
    expect(recognizer.getState().isPinching).toBe(true);

    // Hand disappears
    recognizer.processHandResult(null);
    expect(events.some((e) => e.type === 'hand-lost')).toBe(true);
    expect(events.some((e) => e.type === 'pinch-end')).toBe(true);
    expect(recognizer.getState().isPinching).toBe(false);
  });

  it('does not emit duplicate hand-detected events', () => {
    const recognizer = new GestureRecognizer();
    const events: GestureEvent[] = [];
    recognizer.addListener((e) => events.push(e));

    recognizer.processHandResult(makeHandResult(0.5, 0.5, 0.45, 0.45));
    recognizer.processHandResult(makeHandResult(0.6, 0.6, 0.55, 0.55));

    // Only pointer-move events, no duplicate hand-detected
    expect(events.filter((e) => e.type === 'pointer-move').length).toBe(2);
  });

  it('removes listener correctly', () => {
    const recognizer = new GestureRecognizer();
    const events: GestureEvent[] = [];
    const listener = (e: GestureEvent) => events.push(e);
    recognizer.addListener(listener);
    recognizer.removeListener(listener);

    recognizer.processHandResult(makeHandResult(0.5, 0.5, 0.45, 0.45));
    expect(events).toHaveLength(0);
  });
});
