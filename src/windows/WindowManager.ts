import { WindowData, WindowPosition, WindowDataPayload } from './types';
import { createWindow } from './WindowModel';
import { WindowType } from './types';

export interface WindowManagerState {
  windows: WindowData[];
  selectedId: string | null;
}

export function getInitialState(): WindowManagerState {
  return {
    windows: [],
    selectedId: null,
  };
}

export function addWindow(
  state: WindowManagerState,
  type: WindowType,
  position?: WindowPosition,
): WindowManagerState {
  const pos = position ?? { x: 100 + Math.random() * 200, y: 100 + Math.random() * 100 };
  const newWindow = createWindow(type, pos);
  return {
    ...state,
    windows: [...state.windows, newWindow],
    selectedId: newWindow.id,
  };
}

export function removeWindow(
  state: WindowManagerState,
  id: string,
): WindowManagerState {
  return {
    ...state,
    windows: state.windows.filter((w) => w.id !== id),
    selectedId: state.selectedId === id ? null : state.selectedId,
  };
}

export function moveWindow(
  state: WindowManagerState,
  id: string,
  position: WindowPosition,
): WindowManagerState {
  return {
    ...state,
    windows: state.windows.map((w) =>
      w.id === id ? { ...w, position } : w,
    ),
  };
}

export function resizeWindow(
  state: WindowManagerState,
  id: string,
  size: { width: number; height: number },
): WindowManagerState {
  return {
    ...state,
    windows: state.windows.map((w) =>
      w.id === id ? { ...w, size } : w,
    ),
  };
}

export function selectWindow(
  state: WindowManagerState,
  id: string | null,
): WindowManagerState {
  if (id === null) {
    return {
      ...state,
      selectedId: null,
      windows: state.windows.map((w) => ({ ...w, selected: false })),
    };
  }
  return {
    ...state,
    selectedId: id,
    windows: state.windows.map((w) => ({
      ...w,
      selected: w.id === id,
    })),
  };
}

export function bringToFront(
  state: WindowManagerState,
  id: string,
): WindowManagerState {
  const maxZ = Math.max(0, ...state.windows.map((w) => w.zIndex));
  return {
    ...state,
    windows: state.windows.map((w) =>
      w.id === id ? { ...w, zIndex: maxZ + 1 } : w,
    ),
  };
}

export function toggleLock(
  state: WindowManagerState,
  id: string,
): WindowManagerState {
  return {
    ...state,
    windows: state.windows.map((w) =>
      w.id === id ? { ...w, locked: !w.locked } : w,
    ),
  };
}

export function setEditing(
  state: WindowManagerState,
  id: string,
  editing: boolean,
): WindowManagerState {
  return {
    ...state,
    windows: state.windows.map((w) =>
      w.id === id ? { ...w, editing } : w,
    ),
  };
}

export function updateWindowData(
  state: WindowManagerState,
  id: string,
  data: Partial<WindowDataPayload>,
): WindowManagerState {
  return {
    ...state,
    windows: state.windows.map((w) =>
      w.id === id
        ? { ...w, data: { ...w.data, ...data } as WindowDataPayload }
        : w,
    ),
  };
}

export function getWindowAtPosition(
  windows: WindowData[],
  x: number,
  y: number,
): WindowData | null {
  // Sort by zIndex descending to pick topmost
  const sorted = [...windows].sort((a, b) => b.zIndex - a.zIndex);
  for (const win of sorted) {
    if (
      x >= win.position.x &&
      x <= win.position.x + win.size.width &&
      y >= win.position.y &&
      y <= win.position.y + win.size.height
    ) {
      return win;
    }
  }
  return null;
}
