import { describe, it, expect } from 'vitest';
import {
  getInitialState,
  addWindow,
  removeWindow,
  moveWindow,
  resizeWindow,
  selectWindow,
  bringToFront,
  toggleLock,
  setEditing,
  updateWindowData,
  getWindowAtPosition,
} from '../WindowManager';

describe('WindowManager', () => {
  it('returns empty initial state', () => {
    const state = getInitialState();
    expect(state.windows).toEqual([]);
    expect(state.selectedId).toBeNull();
  });

  it('adds a window', () => {
    const state = getInitialState();
    const next = addWindow(state, 'text', { x: 100, y: 100 });
    expect(next.windows).toHaveLength(1);
    expect(next.windows[0].type).toBe('text');
    expect(next.windows[0].position).toEqual({ x: 100, y: 100 });
    expect(next.selectedId).toBe(next.windows[0].id);
  });

  it('removes a window', () => {
    let state = addWindow(getInitialState(), 'text', { x: 0, y: 0 });
    const id = state.windows[0].id;
    state = removeWindow(state, id);
    expect(state.windows).toHaveLength(0);
    expect(state.selectedId).toBeNull();
  });

  it('moves a window', () => {
    let state = addWindow(getInitialState(), 'text', { x: 0, y: 0 });
    const id = state.windows[0].id;
    state = moveWindow(state, id, { x: 200, y: 300 });
    expect(state.windows[0].position).toEqual({ x: 200, y: 300 });
  });

  it('resizes a window', () => {
    let state = addWindow(getInitialState(), 'text', { x: 0, y: 0 });
    const id = state.windows[0].id;
    state = resizeWindow(state, id, { width: 400, height: 300 });
    expect(state.windows[0].size).toEqual({ width: 400, height: 300 });
  });

  it('selects and deselects windows', () => {
    let state = addWindow(getInitialState(), 'text', { x: 0, y: 0 });
    const id = state.windows[0].id;
    state = selectWindow(state, id);
    expect(state.selectedId).toBe(id);
    expect(state.windows[0].selected).toBe(true);

    state = selectWindow(state, null);
    expect(state.selectedId).toBeNull();
    expect(state.windows[0].selected).toBe(false);
  });

  it('brings window to front', () => {
    let state = getInitialState();
    state = addWindow(state, 'text', { x: 0, y: 0 });
    const id1 = state.windows[0].id;
    state = addWindow(state, 'shape', { x: 100, y: 100 });
    const id2 = state.windows[1].id;

    expect(state.windows[1].zIndex).toBeGreaterThan(state.windows[0].zIndex);

    state = bringToFront(state, id1);
    const win1 = state.windows.find((w) => w.id === id1)!;
    expect(win1.zIndex).toBeGreaterThan(
      state.windows.find((w) => w.id === id2)!.zIndex,
    );
  });

  it('toggles lock', () => {
    let state = addWindow(getInitialState(), 'text', { x: 0, y: 0 });
    const id = state.windows[0].id;
    expect(state.windows[0].locked).toBe(false);

    state = toggleLock(state, id);
    expect(state.windows[0].locked).toBe(true);

    state = toggleLock(state, id);
    expect(state.windows[0].locked).toBe(false);
  });

  it('finds window at position (topmost first)', () => {
    let state = getInitialState();
    state = addWindow(state, 'text', { x: 0, y: 0 });
    state = addWindow(state, 'shape', { x: 50, y: 50 });

    // Both overlap at (60, 60), shape is on top
    const found = getWindowAtPosition(state.windows, 60, 60);
    expect(found).not.toBeNull();
    expect(found!.type).toBe('shape');
  });

  it('returns null when no window at position', () => {
    const state = addWindow(getInitialState(), 'text', { x: 0, y: 0 });
    const found = getWindowAtPosition(state.windows, 500, 500);
    expect(found).toBeNull();
  });

  it('does not break selectedId when removing unselected window', () => {
    let state = getInitialState();
    state = addWindow(state, 'text', { x: 0, y: 0 });
    const id1 = state.windows[0].id;
    state = addWindow(state, 'shape', { x: 100, y: 100 });
    const id2 = state.windows[1].id;

    state = selectWindow(state, id1);
    state = removeWindow(state, id2);

    expect(state.selectedId).toBe(id1);
    expect(state.windows).toHaveLength(1);
  });

  it('sets and clears editing flag', () => {
    let state = addWindow(getInitialState(), 'text', { x: 0, y: 0 });
    const id = state.windows[0].id;
    expect(state.windows[0].editing).toBeUndefined();

    state = setEditing(state, id, true);
    expect(state.windows[0].editing).toBe(true);

    state = setEditing(state, id, false);
    expect(state.windows[0].editing).toBe(false);
  });

  it('updates window data (text content) via updateWindowData', () => {
    let state = addWindow(getInitialState(), 'text', { x: 0, y: 0 });
    const id = state.windows[0].id;
    expect(state.windows[0].data.kind).toBe('text');
    if (state.windows[0].data.kind === 'text') {
      expect(state.windows[0].data.content).toBe('Double-click to edit');
    }

    state = updateWindowData(state, id, { kind: 'text', content: 'Hello world' } as any);
    if (state.windows[0].data.kind === 'text') {
      expect(state.windows[0].data.content).toBe('Hello world');
    }
  });

  it('does not mutate other windows when updating data', () => {
    let state = getInitialState();
    state = addWindow(state, 'text', { x: 0, y: 0 });
    state = addWindow(state, 'shape', { x: 100, y: 100 });
    const textId = state.windows[0].id;
    const shapeDataBefore = state.windows[1].data;

    state = updateWindowData(state, textId, { kind: 'text', content: 'Edited' } as any);
    expect(state.windows[1].data).toBe(shapeDataBefore);
  });
});
