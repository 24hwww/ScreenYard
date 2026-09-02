# ScreenYard

ScreenYard is a browser extension that creates a tab where you can add other
micro windows, with resources, counters, cameras, or texts, and share the tab
in StreamYard, Zoom, Meet, or other video calling or video conferencing tools.

The tab acts as an interactive presentation stage: a live webcam background with
movable overlays (text, images, shapes) that you can drag, resize, lock, and
delete — either with the mouse or with **hand gestures** tracked locally via
MediaPipe.

## Features

- **Live webcam background** — mirror view, fills the whole stage.
- **Movable overlays** — text, images, and shapes. Drag, resize, lock, and delete.
- **Text editing** — double-click any text window (or use a one-finger gesture)
  to edit its content inline.
- **Hand gesture control** (via MediaPipe Tasks Vision, processed locally):
  - **Pinch** to grab and drag windows.
  - **One finger** to open the nearest text window for editing.
  - **Thumb up** to spawn emoji reactions.
  - Up to **two hands** tracked simultaneously with virtual cursors.
- **Trash zone** — drag any window to the bottom strip to delete it.
- **Presentation mode** — fullscreen stage, exit with `Escape`.
- **Debug panel** — toggleable overlay showing hand state, pinch, finger count,
  orientation, pose, and recognized gestures.
- **Chrome extension (Manifest V3)** — click the toolbar icon to open the stage
  in a new tab, ready to share in any video call.

## Tech stack

- React 18 + TypeScript (strict)
- Vite 6 (bundler)
- Vitest 2 (testing, jsdom)
- MediaPipe Tasks Vision (hand landmark detection)
- sharp (icon generation, dev only)

## Getting started

### Prerequisites

- Node.js 18+ (tested on Node 26)
- npm 9+

### Install

```bash
npm install
```

### Development

```bash
npm run dev
```

Open the Vite dev server URL. Grant camera permission when prompted.

### Build the extension

```bash
npm run build:ext
```

This runs Vite build, generates icons, and copies `manifest.json`,
`background.js`, and icons into `dist/`.

### Load the extension in Chrome/Brave

1. Run `npm run build:ext`.
2. Open `chrome://extensions/` (or `brave://extensions/`).
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked**.
5. Select the `dist/` folder.
6. Click the ScreenYard toolbar icon to open the stage tab.
7. In your video call tool, share this tab.

## Commands

| Command | Description |
|---|---|
| `npm run dev` | Start Vite dev server |
| `npm run build` | Type-check + Vite production build to `dist/` |
| `npm run build:ext` | Generate icons + build + copy extension assets to `dist/` |
| `npm run preview` | Preview the production build |
| `npm test` | Run all tests once |
| `npm run test:watch` | Run tests in watch mode |
| `npm run typecheck` | Type-check without emitting |
| `npm run icons` | Regenerate extension icons |

## Usage

1. Open the ScreenYard tab (via the extension icon or dev server).
2. Grant camera permission.
3. Use the **toolbar** to add text, image, or shape windows.
4. **Drag** windows to position them; **resize** via the bottom-right handle.
5. **Double-click** a text window to edit its content.
6. **Lock** (🔒) or **delete** (✕) windows via the controls that appear when
   selected.
7. Use **hand gestures** in front of the camera:
   - Pinch (thumb + index) to grab and drag a window.
   - Hold up one finger to edit the nearest text window.
   - Thumb up to spawn emoji reactions.
8. Drag a window to the **bottom trash strip** to delete it.
9. Click **Present** for fullscreen presentation mode (exit with `Escape`).

## Project structure

```
src/
├── app/            # Root App component
├── components/     # Stage, Toolbar, windows, cursors, trash, emojis, debug
├── gestures/       # HandTracker, GestureRecognizer, GestureSmoother, types
├── windows/        # WindowManager (reducers), WindowModel (factory), types
└── test/           # Vitest setup
public/             # Extension manifest, background worker, icons
scripts/            # Build + icon generation scripts
```

See [`AGENTS.md`](./AGENTS.md) for detailed architecture, conventions, and
guidance for contributing.

## Testing

```bash
npm test
```

39 tests cover the window management reducers, window model factory, gesture
recognition, gesture smoothing, and coordinate conversion.

## Browser support

- Chrome / Brave (Manifest V3 extension)
- Requires camera access (`getUserMedia`)
- Hand tracking requires WebGPU/WebGL and loads MediaPipe WASM from CDN
  (internet connection required on first load)

## License

See [`LICENSE`](./LICENSE).
