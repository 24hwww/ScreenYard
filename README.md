# ScreenYard

ScreenYard is a Chrome/Brave extension that creates an interactive presentation
stage in a browser tab — a live webcam background with movable overlays (text,
images, shapes) that you can drag, resize, lock, and delete with **hand gestures**
tracked locally via MediaPipe.

ScreenYard also works as a **virtual camera**: it appears as "ScreenYard Virtual
Camera" in Google Meet, Zoom, Teams, Discord, Webex, and any WebRTC video call —
**without OBS, without drivers, without admin permissions**. The extension
intercepts `navigator.mediaDevices` on video call sites and pipes the composited
stage via WebRTC loopback.

A **floating window** (Document Picture-in-Picture) keeps the stream active even
when the ScreenYard tab is in the background.

## Features

- **Virtual camera** — appears as a camera in Meet/Zoom/Teams/Discord. No OBS needed.
- **Floating window** — detach the stage into an always-on-top window (Chrome 116+).
  The stream stays active even when the main tab is backgrounded.
- **Live webcam background** — mirror view, fills the whole stage.
- **Movable overlays** — text, images, and shapes. Drag, resize, lock, and delete.
- **3D animations** — elements spawn with a 3D flip, tilt when dragged, and flip
  out when deleted (powered by framer-motion).
- **Hand gesture control** (via MediaPipe Tasks Vision, processed locally):
  - **Pinch** to grab and drag windows (with visual proximity indicator).
  - **Pinch + horizontal swipe** to delete a window (swipe-to-delete).
  - **Fist** over a selected element to delete it.
  - **1 finger** (hold 2s) to spawn a text window or edit the nearest one.
  - **2 fingers** (hold 2s) to spawn an image window.
  - **3 fingers** (hold 2s) to spawn a shape window.
  - **4 fingers** (hold 2s) to switch camera.
  - **Thumb up** to spawn emoji reactions.
  - Up to **two hands** tracked simultaneously with virtual cursors.
  - **Hands only** — face/body false positives are filtered out.
- **Barcode/QR scanner** — scan codes with the camera, auto-copy to clipboard.
  Uses native `BarcodeDetector` API with `@zxing/library` fallback.
- **Trash zone** — drag any window to the bottom strip to delete it.
- **Presentation mode** — fullscreen stage, exit with `Escape`.
- **Debug panel** — toggleable overlay showing hand state, pinch, finger count,
  orientation, pose, and recognized gestures.
- **Chrome extension (Manifest V3)** — click the toolbar icon to open the stage
  in a new tab.

## Tech stack

- React 18 + TypeScript (strict)
- Vite 6 (bundler, `base: './'` for extension compatibility)
- Vitest 2 (testing, jsdom)
- MediaPipe Tasks Vision (hand landmark detection, loaded locally)
- framer-motion (3D element animations)
- @zxing/library (barcode/QR scanning, lazy-loaded)
- @types/chrome (extension API types)
- sharp (icon generation, dev only)
- Bun (runtime, optional — faster than npm)

## Getting started

### Prerequisites

- Node.js 18+ or Bun 1+
- Chrome or Brave browser (116+ for floating window)

### Install

```bash
# With Bun (recommended)
bun install

# Or with npm
npm install
```

### Development

```bash
bun run dev
# or: npm run dev
```

Open the Vite dev server URL. Grant camera permission when prompted.

> **Note:** In dev mode, the VCam preview works but the virtual camera does NOT
> appear in Meet (the content script only injects when loaded as an extension).
> The stream is available at `window.__screenYardVirtualCameraStream` for testing.

### Build the extension

```bash
bun run build:ext
# or: npm run build:ext
```

This runs Vite build, generates icons, and copies `manifest.json`, `background.js`,
`content_script.js`, `injected.js`, icons, and MediaPipe WASM into `dist/`.

### Load the extension in Chrome/Brave

1. Run `bun run build:ext`.
2. Open `chrome://extensions/` (or `brave://extensions/`).
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked**.
5. Select the `dist/` folder.
6. Click the ScreenYard toolbar icon to open the stage tab.

## Using the virtual camera in Google Meet

1. Open the ScreenYard tab (via the extension icon).
2. Grant camera permission.
3. Click the **VCam** button (teal) in the toolbar to enable virtual camera mode.
4. (Optional) Click **🪟 Open floating window** to detach the stage — the stream
   stays active even when you switch tabs.
5. Open **Google Meet** in another tab (same browser).
6. In Meet, go to **Settings → Video → Camera**.
7. Select **ScreenYard Virtual Camera**.
8. Your ScreenYard stage (webcam + overlays) now appears as your camera feed.

The same steps work for Zoom, Teams, Discord, Webex, Whereby, Jitsi, and 8x8.

> **Brave users:** If ScreenYard doesn't appear in Meet's camera list, Brave
> Shields may be blocking the `navigator.mediaDevices` override. Lower the shield
> for `meet.google.com` (click the Brave lion icon → lower shield) and reload Meet.

### How it works (no OBS)

The extension declares **two content scripts** in the manifest:

1. **`injected.js`** (`world: MAIN`) — runs in the page's main world at
   `document_start`, before Meet's own scripts load. Overrides
   `MediaDevices.prototype.enumerateDevices` to add "ScreenYard Virtual Camera"
   to the device list, and `getUserMedia` to return the ScreenYard stream.
2. **`content_script.js`** (ISOLATED world) — has `chrome.runtime` access,
   bridges `window.postMessage` ↔ `chrome.runtime.sendMessage` to route
   WebRTC offers/answers/ICE candidates through the background service worker.

```
ScreenYard tab → canvas.captureStream(30) → RTCPeerConnection
  → background.js (message routing)
  → content_script.js (bridge)
  → injected.js (intercepts getUserMedia)
  → Meet receives the stream as a "webcam"
```

## Commands

| Command | Description |
|---|---|
| `bun run dev` | Start Vite dev server |
| `bun run build` | Type-check + Vite production build to `dist/` |
| `bun run build:ext` | Generate icons + build + copy extension assets to `dist/` |
| `bun run preview` | Preview the production build |
| `bun run test` | Run all tests once |
| `bun run test:watch` | Run tests in watch mode |
| `bun run typecheck` | Type-check without emitting |
| `bun run icons` | Regenerate extension icons |

All commands also work with `npm run` instead of `bun run`.

## Usage

1. Open the ScreenYard tab (via the extension icon or dev server).
2. Grant camera permission.
3. Use the **toolbar** to add text, image, or shape windows.
4. **Drag** windows to position them; **resize** via the bottom-right handle.
5. **Double-click** a text window to edit its content.
6. **Lock** (🔒) or **delete** (✕) windows via the controls that appear when
   selected.
7. Use **hand gestures** in front of the camera:
   - Pinch (thumb + index) to grab and drag a window. A yellow ring appears
     when your fingers are approaching the pinch threshold.
   - Pinch + horizontal swipe to delete (swipe-to-delete).
   - Make a fist over a selected element to delete it.
   - Hold up 1 finger for 2s to spawn/edit text.
   - Hold up 2 fingers for 2s to spawn an image.
   - Hold up 3 fingers for 2s to spawn a shape.
   - Hold up 4 fingers for 2s to switch camera.
   - Thumb up to spawn emoji reactions.
8. Drag a window to the **bottom trash strip** to delete it.
9. Click **VCam** to enable virtual camera mode for Meet/Zoom/Teams.
10. Click **🪟 Open floating window** to detach the stage (keeps stream active
    in background).
11. Click **Present** for fullscreen presentation mode (exit with `Escape`).

## Project structure

```
src/
├── app/            # Root App component
├── components/     # Stage, Toolbar, windows, cursors, trash, emojis, debug,
│                   # BarcodeScanner, VirtualCamera
├── gestures/       # HandTracker, GestureRecognizer, GestureSmoother, types
├── hooks/          # usePictureInPicture (Document PiP)
├── windows/        # WindowManager (reducers), WindowModel (factory), types
└── test/           # Vitest setup
public/             # Extension manifest, background worker, content scripts,
                    # injected script, icons
scripts/            # Build + icon generation scripts
```

See [`AGENTS.md`](./AGENTS.md) for detailed architecture, conventions, and
guidance for contributing.

## Testing

```bash
bun run test
# or: npm test
```

40 tests cover the window management reducers, window model factory, gesture
recognition, gesture smoothing, and coordinate conversion.

## Browser support

- Chrome / Brave 116+ (Manifest V3 extension)
- Requires camera access (`getUserMedia`)
- Hand tracking requires WebGPU/WebGL and loads MediaPipe WASM from local
  extension files (works offline after first build)
- Virtual camera feature requires the extension to be loaded (content script
  injection). The dev server alone does not inject into video call sites.
- Floating window requires Document Picture-in-Picture API (Chrome/Brave 116+)
- **Brave Shields** may block `navigator.mediaDevices` override. If ScreenYard
  doesn't appear in Meet, lower the shield for the video call site.

## License

See [`LICENSE`](./LICENSE).
