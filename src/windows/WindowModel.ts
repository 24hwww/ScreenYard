import {
  WindowData,
  WindowType,
  WindowDataPayload,
  TextData,
  ImageData,
  ShapeData,
  BrowserData,
  CounterData,
} from './types';

let nextZIndex = 1;

export function createWindow(
  type: WindowType,
  position: { x: number; y: number },
  data?: Partial<WindowDataPayload>,
): WindowData {
  const defaults = getWindowDefaults(type);
  const z = nextZIndex++;

  const base: WindowData = {
    id: `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type,
    position,
    size: getDefaultSize(type),
    zIndex: z,
    locked: false,
    selected: false,
    data: defaults,
  };

  if (data) {
    base.data = { ...defaults, ...data } as WindowDataPayload;
  }

  return base;
}

function getWindowDefaults(type: WindowType): WindowDataPayload {
  switch (type) {
    case 'text':
      return {
        kind: 'text',
        content: 'Double-click to edit',
        fontSize: 24,
        color: '#ffffff',
        fontFamily: 'Arial',
      } as TextData;
    case 'image':
      return { kind: 'image', src: '', alt: 'Image' } as ImageData;
    case 'shape':
      return {
        kind: 'shape',
        shapeType: 'rect',
        fill: '#3b82f6',
        stroke: '#1d4ed8',
        strokeWidth: 2,
      } as ShapeData;
    case 'browser':
      return { kind: 'browser', url: 'https://example.com' } as BrowserData;
    case 'counter':
      return { kind: 'counter', value: 0, label: 'Count' } as CounterData;
  }
}

function getDefaultSize(type: WindowType): { width: number; height: number } {
  switch (type) {
    case 'text':
      return { width: 280, height: 80 };
    case 'image':
      return { width: 300, height: 200 };
    case 'shape':
      return { width: 150, height: 150 };
    case 'browser':
      return { width: 640, height: 480 };
    case 'counter':
      return { width: 160, height: 80 };
  }
}
