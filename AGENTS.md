# ScreenYard — Guía para agentes

## Qué es ScreenYard

Extensión de navegador (Chrome/Brave, Manifest V3) que abre una pestaña con un
"escenario" donde se superponen ventanas (texto, imágenes, formas) sobre un fondo
de webcam. El escenario se controla con gestos de mano mediante MediaPipe Tasks
Vision. La extensión **inyecta una virtual camera** en las páginas de videollamadas
(Meet, Zoom, Teams, Discord, etc.) interceptando `navigator.mediaDevices`, por lo
que ScreenYard aparece como una cámara más — sin OBS, sin drivers nativos.

## Stack

- **React 18** + **TypeScript** (strict)
- **Vite 6** como bundler
- **Vitest 2** para tests (entorno jsdom)
- **MediaPipe Tasks Vision** (`@mediapipe/tasks-vision`) para tracking de manos
- **framer-motion** para animaciones de elementos (spawn, select, drag, edit, delete)
- **@zxing/library** para escaneo de códigos de barras/QR (lazy-loaded)
- **@types/chrome** para tipos de la extension API
- **sharp** para generar iconos PNG desde SVG (dev dependency)

## Comandos

| Comando | Descripción |
|---|---|
| `npm run dev` | Servidor de desarrollo Vite |
| `npm run build` | `tsc -b && vite build` — build de producción a `dist/` |
| `npm run build:ext` | Genera iconos + build + copia assets de extensión a `dist/` |
| `npm run preview` | Previsualiza el build de producción |
| `npm test` | `vitest run` — ejecuta los tests una vez |
| `npm run test:watch` | Vitest en modo watch |
| `npm run typecheck` | `tsc --noEmit` — verificación de tipos sin emitir |
| `npm run icons` | Regenera los iconos PNG en `public/icons/` |

### Verificación antes de considerar una tarea completa

Siempre ejecutar antes de entregar:

```bash
npm run typecheck && npm test && npm run build
```

Los tres deben pasar sin errores.

## Arquitectura

```
src/
├── main.tsx                # Entry point de React
├── app/
│   ├── App.tsx             # Componente raíz: orquesta Toolbar + Stage + VCam
│   └── App.css
├── components/
│   ├── Stage.tsx           # Escenario: webcam + ventanas + gestos + trash + emojis + VCam
│   ├── Stage.css
│   ├── Toolbar.tsx         # Barra superior: add, scan, vcam, clear, presentación, debug
│   ├── Toolbar.css
│   ├── WindowWrapper.tsx   # Wrapper draggable/resizable con framer-motion (3D tilt, anims)
│   ├── TextWindow.tsx      # Ventana de texto editable (doble-clic o gesto 1 dedo)
│   ├── ImageWindow.tsx     # Ventana de imagen (URL)
│   ├── ShapeWindow.tsx     # Ventana de forma (rect/circle/triangle)
│   ├── VirtualCursor.tsx   # Cursor virtual que sigue al dedo índice
│   ├── TrashZone.tsx       # Zona de eliminación en la parte inferior
│   ├── EmojiBurst.tsx      # Emojis animados (reacción a thumb_up)
│   ├── DebugPanel.tsx      # Panel de debug de gestos (toggleable)
│   ├── BarcodeScanner.tsx  # Escáner de códigos de barras/QR (BarcodeDetector + ZXing fallback)
│   ├── BarcodeScanner.css
│   ├── VirtualCamera.tsx   # Modo Virtual Camera: composite canvas + WebRTC sender
│   └── VirtualCamera.css
├── gestures/
│   ├── types.ts            # Tipos: GestureEvent, GestureState, HandOrientation...
│   ├── HandTracker.ts      # Wrapper de MediaPipe HandLandmarker (hasta 2 manos)
│   ├── GestureRecognizer.ts# Convierte landmarks en eventos (pinch, finger-count...)
│   ├── GestureSmoother.ts  # One Euro Filter para suavizado adaptativo de puntero
│   └── __tests__/          # Tests de GestureRecognizer, GestureSmoother, coords
├── windows/
│   ├── types.ts            # Tipos: WindowData, WindowType, TextData, ImageData...
│   ├── WindowManager.ts    # Reducers puros: add/remove/move/resize/select/lock/edit
│   ├── WindowModel.ts      # Factory: createWindow + defaults por tipo
│   └── __tests__/          # Tests de WindowManager y WindowModel
└── test/
    └── setup.ts            # Setup de Vitest (jest-dom matchers)

public/
├── manifest.json           # Manifest V3: content_scripts + permissions + host_permissions
├── background.js           # Service worker: routing de mensajes entre tabs (ScreenYard ↔ Meet)
├── content_script.js       # Intercepta enumerateDevices + getUserMedia en sites de videollamadas
└── icons/                  # Iconos 16/48/128px (generados por scripts/generate-icons.mjs)

scripts/
├── build-extension.mjs     # Build + copia manifest/background/content_script/icons a dist/
└── generate-icons.mjs      # Genera PNGs desde SVG inline usando sharp
```

## Virtual Camera — arquitectura

ScreenYard aparece como "ScreenYard Virtual Camera" en Google Meet, Zoom, Teams,
Discord, Webex, y cualquier WebRTC video call — sin OBS, sin drivers, sin permisos
de admin.

### Flujo

```
1. ScreenYard tab activa VCam → canvas.captureStream(30)
2. ScreenYard registra con background.js (screenyard-register + stream-ready)
3. Usuario abre Meet → content_script.js se inyecta (document_start, MAIN world)
4. Meet llama enumerateDevices() → ve "ScreenYard Virtual Camera"
5. Usuario selecciona ScreenYard en Settings → Video → Camera
6. Meet llama getUserMedia({deviceId: 'screenyard-virtual-camera'})
7. Content script intercepta → pide stream via background
8. Background reenvía a ScreenYard tab (screenyard-start-webrtc)
9. ScreenYard crea RTCPeerConnection, añade canvas tracks, envía offer
10. Background relaya offer al content script
11. Content script crea answer → recibe track via WebRTC loopback
12. getUserMedia devuelve el MediaStream → Meet muestra el stage como webcam
```

### Componentes

- **`content_script.js`**: inyectado en `meet.google.com`, `*.zoom.us`,
  `teams.microsoft.com`, `teams.live.com`, `*.webex.com`, `*.discord.com`,
  `*.slack.com`, `*.whereby.com`, `*.jitsi.org`, `*.8x8.vc`. Intercepta
  `navigator.mediaDevices.enumerateDevices()` y `getUserMedia()`.
- **`background.js`**: service worker que enruta mensajes entre tabs. Mantiene
  `screenyardTabId`, relaya offers/answers/ICE candidates.
- **`VirtualCamera.tsx`**: composita cámara + elementos en canvas 1280×720 a 30fps,
  crea RTCPeerConnection con canvas tracks, envía offer al content script.

### Canvas composition

El canvas compone:
- Cámara de fondo (cover-fit, espejado)
- Text elements (con fuente, color, word-wrap)
- Shape elements (rect, circle, con stroke)
- Image elements (placeholder)
- Bordes de selección azules

## Mapeo de gestos

| Dedos (hold 2s) | Acción |
|---|---|
| 1 | Text (o editar texto cercano) |
| 2 | Image |
| 3 | Shape |
| 4 | Switch camera |
| 5 | (sin acción) |

| Gesto | Acción |
|---|---|
| Pinch (thumb + index) | Agarrar y arrastrar ventana |
| Pinch + swipe horizontal | Eliminar ventana (swipe-to-delete) |
| Fist (sobre elemento seleccionado) | Eliminar elemento |
| Thumb up | Spawn emoji reactions |

**Pose es la autoridad**: si la pose es `fist`, los eventos `finger-count` se
ignoran completamente (evita falsos positivos de 1 dedo durante un puño cerrado).

**No spawn cuando hay selección**: si un elemento está seleccionado, los gestos
1-3 no crean nuevos elementos (evita conflictos). 4 (switch camera) sí funciona.

## Animaciones (framer-motion)

`WindowWrapper` usa `motion.div` con:

| Estado | Animación |
|---|---|
| Spawn | Scale 0.5→1 + rotateY -90°→0 (3D flip in) |
| Select | Scale 1.03 + blue glow + selection border fade-in |
| Drag | 3D tilt (rotateX -8°) + elevated shadow |
| Hover | Scale 1.02 + shadow |
| Edit | Brightness pulse (1.5s loop) |
| Swipe delete | Red glow + hue rotate + scale down |
| Delete/exit | Scale 0.3 + rotateX 90° + fade out (3D flip out) |
| Controls | Spring slide-in from top |

Setup 3D: `.stage-foreground` con `perspective: 1000px`, `.window-wrapper` con
`transform-style: preserve-3d`. `AnimatePresence` envuelve la lista de ventanas
para que las animaciones de exit se reproduzcan antes de remover del DOM.

## Tipos de ventana

| Tipo | Componente | Estado |
|---|---|---|
| `text` | `TextWindow` | Implementado — editable con doble-clic o gesto 1 dedo |
| `image` | `ImageWindow` | Implementado — muestra imagen desde URL |
| `shape` | `ShapeWindow` | Implementado — rect/circle/triangle |
| `browser` | — | **Definido en types pero NO implementado** (fallback) |

## Patrones y convenciones

- **Reducers puros**: Todas las operaciones de estado en `WindowManager.ts` son
  funciones puras que reciben estado y devuelven nuevo estado. No hay side effects.
- **Inmutabilidad**: Siempre spread (`{...state, windows: state.windows.map(...)}`).
  Nunca mutar `state` directamente.
- **Composición de operaciones**: Al encadenar múltiples operaciones en un solo
  `onStateChange`, componerlas: `onStateChange(bringToFront(selectWindow(state, id), id))`.
  No llamar `onStateChange` dos veces seguidas con el mismo `state` del closure,
  porque la segunda sobrescribe la primera.
- **CSS modules por componente**: Cada componente tiene su `.css` adyacente.
- **IDs únicos**: `${type}-${Date.now()}-${random}` en `WindowModel.createWindow`.
- **zIndex incremental**: `nextZIndex` global en `WindowModel.ts`. `bringToFront`
  calcula `maxZ + 1`.
- **Lazy loading**: ZXing se carga con dynamic import solo cuando se abre el escáner.

## Testing

- Tests en `__tests__/` adyacentes al código que testean.
- Entorno jsdom; setup en `src/test/setup.ts` (jest-dom matchers).
- 40 tests actuales cubren: WindowManager (14), WindowModel (5),
  GestureRecognizer (8), GestureSmoother (8), coordinateConversion (5).
- **Sin cobertura**: componentes de UI (Stage, WindowWrapper, TextWindow...),
  HandTracker (requiere MediaPipe + cámara), VirtualCamera (requiere WebRTC).

## Pipeline de reconocimiento de gestos

```
getUserMedia → <video> oculto → MediaPipe HandLandmarker
  → landmarks 3D → HandTracker (geometría 3D, ángulos, handSize)
  → GestureRecognizer (pinch normalizado, finger-count, gesture-detected)
  → GestureSmoother (One Euro Filter adaptativo)
  → GestureEvent → Stage.tsx → acciones (drag, edit, emoji)
```

### Mejoras de precisión implementadas

- **One Euro Filter** (`GestureSmoother.ts`): suavizado adaptativo que reduce
  jitter a baja velocidad y lag a alta velocidad. Reemplaza el EMA fijo.
- **Pinch normalizado por tamaño de mano**: `normalizedPinch = pinchDist / handSize`
  donde `handSize = dist3D(wrist, middle_mcp)`. Thresholds unitless (0.45/0.60).
- **Finger counting con ángulos 3D**: usa `angle3D(MCP, PIP, DIP) > 160°` en
  lugar de comparar coordenadas Y. Robusto a rotación y ángulo de cámara.
- **Filtrado por confianza**: detecciones con `visibility < 0.5` se descartan.
- **requestVideoFrameCallback**: sincroniza la inferencia con los frames reales
  de la webcam (más eficiente que `requestAnimationFrame`). Fallback automático
  a rAF si rVFC no dispara en 500ms (ej. video oculto con display:none).
- **Fallback GPU→CPU**: si la inicialización con `delegate: 'GPU'` falla,
  reintenta con `delegate: 'CPU'`.
- **Hold delay de 600ms para 1-finger**: el gesto de 1 dedo requiere sostenerse
  600ms para activar edición de texto, con anillo de progreso SVG visible.
- **Handedness estable**: usa `handednesses` de MediaPipe para asignar
  handIndex consistente (0=izquierda, 1=derecha) en lugar del orden de detección.
- **Frame skipping adaptativo**: mide el tiempo de inferencia; si excede 33ms
  (30fps budget), salta frames para mantener el pipeline en tiempo real.
- **MediaPipe local (offline)**: WASM y modelo se sirven desde `public/mediapipe/`
  en lugar de CDN. La extensión funciona sin conexión a internet.
- **Pose como autoridad**: si la pose es `fist`, finger-count se ignora. Evita
  falsos positivos cuando MediaPipe reporta 1 dedo durante un puño cerrado.

Ver `docs/gesture-precision-audit.md` para el análisis completo.

## Notas importantes

- **MediaPipe se carga localmente**: WASM y modelo se sirven desde `public/mediapipe/`
  (no CDN). La extensión funciona offline. El script `build:ext` copia estos archivos
  a `dist/mediapipe/` automáticamente.
- **Cámara obligatoria**: `Stage` pide `getUserMedia` al montar. Sin permiso de
  cámara, muestra error pero la app no es funcional.
- **Manifest V3**: `public/manifest.json` pide `activeTab`, `tabs`, `scripting`,
  `storage` + `host_permissions: <all_urls>`. El content script se inyecta en
  sites de videollamadas (Meet, Zoom, Teams, etc.) en `document_start` + `world: MAIN`.
- **Build de extensión**: `npm run build:ext` genera `dist/` listo para cargar
  como extensión desempaquetada en `chrome://extensions/`. Copia manifest,
  background.js, content_script.js, icons, y mediapipe.
- **Virtual Camera**: el modo VCam compone el stage en un canvas 1280×720 a 30fps
  y lo envía vía WebRTC loopback al content script de la videollamada. Sin OBS.

## Bugs conocidos / limitaciones

- Tipo `browser` definido pero sin componente UI (fallback).
- `HandTracker`, `GestureRecognizer` y smoothers se instancian a nivel de módulo
  en `Stage.tsx` (fuera del componente). Si `Stage` se desmonta/remonta, las
  instancias persisten y los smoothers no se reinician.
- El `useEffect` de gestos en `Stage.tsx` se re-registra en cada cambio de
  `state` (frecuente durante drag). Podría optimizarse con un `ref` para `state`.
- `nextZIndex` es mutable global en `WindowModel.ts` — acoplado al ciclo de vida
  del módulo.
- Virtual Camera: los elementos `image` se renderizan como placeholder en el
  canvas composite (no se dibuja la imagen real).
- Virtual Camera: el content script en `world: MAIN` puede no tener acceso a
  `chrome.runtime` en algunos navegadores. Hay fallback via CustomEvent.
