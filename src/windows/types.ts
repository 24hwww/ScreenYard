export type WindowType = 'text' | 'image' | 'shape' | 'browser' | 'tab';

export interface WindowPosition {
  x: number;
  y: number;
}

export interface WindowSize {
  width: number;
  height: number;
}

export interface WindowData {
  id: string;
  type: WindowType;
  position: WindowPosition;
  size: WindowSize;
  zIndex: number;
  locked: boolean;
  selected: boolean;
  /** Whether this window is in editing mode (e.g. text input open) */
  editing?: boolean;
  /** Type-specific data */
  data: WindowDataPayload;
}

export type WindowDataPayload =
  | TextData
  | ImageData
  | ShapeData
  | BrowserData
  | TabData;

export interface TextData {
  kind: 'text';
  content: string;
  fontSize: number;
  color: string;
  fontFamily: string;
}

export interface ImageData {
  kind: 'image';
  src: string;
  alt: string;
}

export interface ShapeData {
  kind: 'shape';
  shapeType: 'rect' | 'circle' | 'triangle';
  fill: string;
  stroke?: string;
  strokeWidth?: number;
}

export interface BrowserData {
  kind: 'browser';
  url: string;
}

export interface TabData {
  kind: 'tab';
  /** Chrome tab ID being captured */
  tabId: number;
  /** Tab title for display */
  title: string;
  /** Tab URL for display */
  url: string;
  /** Tab favicon URL */
  favIconUrl?: string;
  /** MediaStream from chrome.tabCapture (stored externally, not in state) */
  streamId?: string;
}
