import { describe, it, expect } from 'vitest';
import { createWindow } from '../WindowModel';

describe('WindowModel', () => {
  it('creates a text window with correct defaults', () => {
    const win = createWindow('text', { x: 10, y: 20 });
    expect(win.type).toBe('text');
    expect(win.position).toEqual({ x: 10, y: 20 });
    expect(win.size.width).toBe(280);
    expect(win.size.height).toBe(80);
    expect(win.locked).toBe(false);
    expect(win.selected).toBe(false);
    expect(win.data.kind).toBe('text');
    if (win.data.kind === 'text') {
      expect(win.data.fontSize).toBe(24);
      expect(win.data.color).toBe('#ffffff');
    }
  });

  it('creates an image window', () => {
    const win = createWindow('image', { x: 0, y: 0 });
    expect(win.type).toBe('image');
    expect(win.data.kind).toBe('image');
    expect(win.size.width).toBe(300);
    expect(win.size.height).toBe(200);
  });

  it('creates a shape window', () => {
    const win = createWindow('shape', { x: 0, y: 0 });
    expect(win.type).toBe('shape');
    expect(win.data.kind).toBe('shape');
    if (win.data.kind === 'shape') {
      expect(win.data.shapeType).toBe('rect');
    }
    expect(win.size.width).toBe(150);
    expect(win.size.height).toBe(150);
  });

  it('each window gets a unique id', () => {
    const win1 = createWindow('text', { x: 0, y: 0 });
    const win2 = createWindow('text', { x: 0, y: 0 });
    expect(win1.id).not.toBe(win2.id);
  });

  it('z-index increments', () => {
    const win1 = createWindow('text', { x: 0, y: 0 });
    const win2 = createWindow('text', { x: 0, y: 0 });
    expect(win2.zIndex).toBeGreaterThan(win1.zIndex);
  });
});
