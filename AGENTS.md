# ScreenYard — Guía para agentes

## Qué es ScreenYard

Extensión de navegador (Chrome/Brave, Manifest V3) que abre una pestaña con un
"escenario" donde se superponen ventanas (texto, imágenes, formas) sobre un fondo
de webcam. El escenario se controla con gestos de mano mediante MediaPipe Tasks
Vision. La extensión **inyecta una virtual camera** en las páginas de videollamadas
(Meet, Zoom, Teams, Discord, etc.) interceptando `navigator.mediaDevices`, por lo
que ScreenYard aparece como una cámara más — sin OBS, sin drivers nativos.

También soporta **ventana flotante** (Document Picture-in-Picture) para mantener
el stream activo aunque la pestaña principal quede en background.

## Stack

- **React 18** + **TypeScript** (strict)
- **Vite 6** como bundler
- **Vitest 2** para tests (entorno jsdom)
- **MediaPipe Tasks Vision** (`@mediapipe/tasks-vision`) para tracking de manos
- **framer-motion** para animaciones de elementos (spawn, select, drag, edit, delete)
- **@zxing/library** para escaneo de códigos de barras/QR (lazy-loaded)
- **@types/chrome** para tipos de la extension API
- **sharp** para generar iconos PNG desde SVG (dev dependency)
- **Bun** como runtime y package manager (opcional, más rápido que npm)

## Comandos

Los comandos funcionan con `bun run` o `npm run`:

| Comando | Descripción |
|---|---|
| `bun run dev` | Servidor de desarrollo Vite |
| `bun run build` | `tsc -b && vite build` — build de producción a `dist/` |
| `bun run build:ext` | Genera iconos + build + copia assets de extensión a `dist/` |
| `bun run preview` | Previsualiza el build de producción |
| `bun run test` | `vitest run` — ejecuta los tests una vez |
| `bun run test:watch` | Vitest en modo watch |
| `bun run typecheck` | `tsc --noEmit` — verificación de tipos sin emitir |
| `bun run icons` | Regenera los iconos PNG en `public/icons/` |

### Verificación antes de considerar una tarea completa

Siempre ejecutar antes de entregar:

```bash
bun run typecheck && bun run test && bun run build:ext
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
│   ├── VirtualCursor.tsx   # Cursor virtual con anillo de proximidad de pinch
│   ├── TrashZone.tsx       # Zona de eliminación en la parte inferior
│   ├── EmojiBurst.tsx      # Emojis animados (reacción a thumb_up)
│   ├── DebugPanel.tsx      # Panel de debug de gestos (toggleable)
│   ├── BarcodeScanner.tsx  # Escáner de códigos de barras/QR (BarcodeDetector + ZXing fallback)
│   ├── BarcodeScanner.css
│   ├── VirtualCamera.tsx   # Modo Virtual Camera: composite canvas + WebRTC + PiP
│   └── VirtualCamera.css
├── gestures/
│   ├── types.ts            # Tipos: GestureEvent, GestureState, HandOrientation...
│   ├── HandTracker.ts      # Wrapper de MediaPipe HandLandmarker (hasta 2 manos)
│   ├── GestureRecognizer.ts# Convierte landmarks en eventos (pinch, finger-count...)
│   ├── GestureSmoother.ts  # One Euro Filter para suavizado adaptativo de puntero
│   └── __tests__/          # Tests de GestureRecognizer, GestureSmoother, coords
├── hooks/
│   └── usePictureInPicture.ts # Hook para Document PiP (ventana flotante)
├── windows/
│   ├── types.ts            # Tipos: WindowData, WindowType, TextData, ImageData...
│   ├── WindowManager.ts    # Reducers puros: add/remove/move/resize/select/lock/edit
│   ├── WindowModel.ts      # Factory: createWindow + defaults por tipo
│   └── __tests__/          # Tests de WindowManager y WindowModel
└── test/
    └── setup.ts            # Setup de Vitest (jest-dom matchers)

public/
├── manifest.json           # Manifest V3: content_scripts (MAIN+ISOLATED) + CSP + permissions
├── background.js           # Service worker: routing de mensajes entre tabs (ScreenYard ↔ Meet)
├── content_script.js       # Bridge ISOLATED world: postMessage ↔ chrome.runtime
├── injected.js             # MAIN world: intercepta MediaDevices prototype + instance
└── icons/                  # Iconos 16/48/128px (generados por scripts/generate-icons.mjs)

scripts/
├── build-extension.mjs     # Build + copia manifest/background/content_script/injected/icons a dist/
└── generate-icons.mjs      # Genera PNGs desde SVG inline usando sharp
```

## Virtual Camera — arquitectura

ScreenYard aparece como "ScreenYard Virtual Camera" en Google Meet, Zoom, Teams,
Discord, Webex, y cualquier WebRTC video call — sin OBS, sin drivers, sin permisos
de admin.

### Arquitectura de dos content scripts

Manifest V3 declara **dos content scripts** que Chrome inyecta directamente
(no via `<script>` tag, que sería bloqueado por el CSP de Meet):

1. **`injected.js`** (`"world": "MAIN"`) — corre en el mundo de la página
   - Intercepta `MediaDevices.prototype.enumerateDevices` y `getUserMedia`
   - Añade "ScreenYard Virtual Camera" a la lista de dispositivos
   - Crea RTCPeerConnection, recibe el canvas track vía WebRTC
   - NO tiene acceso a `chrome.runtime`
   - Estrategia de override: prototype → instance (defineProperty) → direct assignment

2. **`content_script.js`** (ISOLATED world, default) — corre en mundo aislado
   - Tiene acceso a `chrome.runtime` para mensajería con el background
   - Bridge: `window.postMessage` ↔ `chrome.runtime.sendMessage`
   - Relaya offers/answers/ICE candidates entre injected.js y background.js

Comunicación: `window.postMessage` entre MAIN e ISOLATED world.

### Flujo

```
 1. ScreenYard tab activa VCam → canvas.captureStream(30)
 2. ScreenYard registra con background.js (screenyard-register + stream-ready)
 3. Usuario abre Meet → injected.js + content_script.js se inyectan (document_start)
 4. injected.js overridea MediaDevices.prototype (enumerateDevices + getUserMedia)
 5. Meet llama enumerateDevices() → ve "ScreenYard Virtual Camera"
 6. Usuario selecciona ScreenYard en Settings → Video → Camera
 7. Meet llama getUserMedia({deviceId: 'screenyard-virtual-camera'})
 8. injected.js intercepta → postMessage → content_script.js → background.js
 9. Background reenvía a ScreenYard tab (screenyard-start-webrtc)
10. ScreenYard crea RTCPeerConnection, añade canvas tracks, envía offer
11. Background → content_script.js → postMessage → injected.js
12. injected.js crea answer → postMessage → content_script.js → background → ScreenYard
13. WebRTC conectado → stream fluye → getUserMedia devuelve el MediaStream
14. Meet muestra el stage como webcam
```

### Ventana flotante (Document Picture-in-Picture)

Cuando VCam está activo, el panel muestra un botón "🪟 Open floating window"
(requiere Chrome/Brave 116+). Al clickar:

- Se abre una ventana always-on-top via `document.documentPictureInPicture.requestWindow()`
- El stage + canvas oculto se mueven a la ventana PiP
- Cámara, MediaPipe, canvas y gesture tracking siguen funcionando
- `requestAnimationFrame` de la ventana PiP no se throttlea en background
- El stream WebRTC se mantiene activo aunque la pestaña principal quede en background
- Al cerrar la ventana, los elementos se restauran a su posición original

Hook: `src/hooks/usePictureInPicture.ts`

### Canvas composition

El canvas compone:
- Cámara de fondo (cover-fit, espejado con `ctx.scale(-1, 1)`)
- Text elements (con fuente, color, word-wrap)
- Shape elements (rect, circle, con stroke)
- Image elements (placeholder)
- Bordes de selección azules

**Espejado**: la cámara se espeja para coincidir con el display del stage
(`scaleX(-1)` en CSS). Los elementos se dibujan en coordenadas de pantalla
(no espejadas), igual que el foreground del stage. El output del VCam coincide
exactamente con lo que el usuario ve en la pestaña de ScreenYard.

**windowsRef**: el render loop lee `windowsRef.current` (un ref) en vez de
`windows` del estado, para que el stream no se recrea cada vez que se mueve
un elemento.

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

## Pinch gesture — refinamiento

### Thresholds

| Parámetro | Valor | Descripción |
|---|---|---|
| `PINCH_THRESHOLD` | 0.55 | Distancia normalizada para activar pinch |
| `PINCH_RELEASE_THRESHOLD` | 0.75 | Distancia para soltar (hysteresis) |
| `PINCH_CONFIRM_FRAMES` | 2 | Frames consecutivos para confirmar pinch-start |

### Hit area expandida

El pinch-start usa 40px de padding alrededor de los elementos para facilitar
agarrarlos. Si hay overlap, se selecciona el elemento cuyo centro está más cerca
del pinch. Los elementos donde el pinch cae exactamente dentro tienen prioridad.

### Indicador visual de proximidad

`VirtualCursor` muestra un **anillo amarillo** cuando los dedos se acercan al
threshold del pinch (proximity > 0.3). El anillo crece y se opacifica conforme
se acerca el pinch. Funciona para ambas manos.

## Filtrado de falsos positivos (solo manos)

MediaPipe HandLandmarker está entrenado para manos, pero con thresholds bajos
puede detectar falsos positivos en rostros u otras partes del cuerpo. Tres capas
de filtrado:

1. **Thresholds de MediaPipe altos**: `minHandDetectionConfidence: 0.7`,
   `minHandPresenceConfidence: 0.7`, `minTrackingConfidence: 0.6`
2. **Validación de handSize**: rechaza detecciones donde wrist→middle-MCP
   es < 0.05 o > 0.5 en coords normalizadas (manos reales: 0.08-0.25)
3. **Validación de estructura**: index tip debe estar más lejos del wrist
   que index MCP (los dedos se extienden desde la palma)

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
- **Refs para datos frescos en loops**: El render loop del VCam usa `windowsRef`
  en vez de `windows` como dependencia del useEffect, para evitar recrear el
  stream en cada cambio de estado.
- **CSS modules por componente**: Cada componente tiene su `.css` adyacente.
- **IDs únicos**: `${type}-${Date.now()}-${random}` en `WindowModel.createWindow`.
- **zIndex incremental**: `nextZIndex` global en `WindowModel.ts`. `bringToFront`
  calcula `maxZ + 1`.
- **Lazy loading**: ZXing se carga con dynamic import solo cuando se abre el escáner.
- **Paths relativos**: Vite config usa `base: './'` para que los assets funcionen
  tanto en dev (`localhost`) como en extensión (`chrome-extension://ID/`).

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
  → landmarks 3D → HandTracker (geometría 3D, ángulos, handSize, filtrado)
  → GestureRecognizer (pinch normalizado, finger-count, gesture-detected)
  → GestureSmoother (One Euro Filter adaptativo)
  → GestureEvent → Stage.tsx → acciones (drag, edit, emoji)
```

### Mejoras de precisión implementadas

- **One Euro Filter** (`GestureSmoother.ts`): suavizado adaptativo que reduce
  jitter a baja velocidad y lag a alta velocidad. Reemplaza el EMA fijo.
- **Pinch normalizado por tamaño de mano**: `normalizedPinch = pinchDist / handSize`
  donde `handSize = dist3D(wrist, middle_mcp)`. Thresholds unitless (0.55/0.75).
- **Pinch con confirmación de frames**: pinch debe sostenerse 2 frames antes
  de emitir pinch-start (reduce falsos positivos de MediaPipe noise).
- **Finger counting con ángulos 3D**: usa `angle3D(MCP, PIP, DIP) > 160°` en
  lugar de comparar coordenadas Y. Robusto a rotación y ángulo de cámara.
- **Filtrado por confianza**: detecciones con `confidence < 0.5` se descartan.
  Thresholds de MediaPipe: `minHandDetectionConfidence: 0.7`.
- **Filtrado de falsos positivos**: handSize sanity check (0.05-0.5) +
  validación de estructura de dedos (index tip más lejos del wrist que index MCP).
- **requestVideoFrameCallback**: sincroniza la inferencia con los frames reales
  de la webcam. Fallback automático a rAF si rVFC no dispara en 500ms.
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
- **CSP de la extensión**: `manifest.json` declara
  `"content_security_policy": { "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'" }`
  para permitir que MediaPipe cargue WebAssembly.
- **Cámara obligatoria**: `Stage` pide `getUserMedia` al montar. Sin permiso de
  cámara, muestra error pero la app no es funcional.
- **Manifest V3**: `public/manifest.json` pide `activeTab`, `tabs`, `scripting`,
  `storage` + `host_permissions: <all_urls>`. Dos content scripts: `injected.js`
  en `world: MAIN` + `content_script.js` en ISOLATED world. Ambos en `document_start`,
  `all_frames: false` (solo top-level frame).
- **Build de extensión**: `bun run build:ext` genera `dist/` listo para cargar
  como extensión desempaquetada en `chrome://extensions/`. Copia manifest,
  background.js, content_script.js, injected.js, icons, y mediapipe.
- **Virtual Camera**: el modo VCam compone el stage en un canvas 1280×720 a 30fps
  y lo envía vía WebRTC loopback al content script de la videollamada. Sin OBS.
- **Ventana flotante**: Document PiP (Chrome 116+) mantiene el stream activo
  cuando la pestaña principal va a background. El render loop usa el RAF de la
  ventana PiP (no se throttlea).
- **Dev vs extensión**: `VirtualCamera.tsx` detecta si corre como extensión
  (`chrome.runtime.id`) o dev server. En dev, el VCam preview funciona pero la
  cámara virtual no aparece en Meet (el content script solo se inyecta como
  extensión). El stream está disponible en `window.__screenYardVirtualCameraStream`.

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
- Virtual Camera: **Brave Shields** puede bloquear la modificación de
  `MediaDevices.prototype`. Si ScreenYard no aparece en Meet, desactivar
  Shields para `meet.google.com` o probar en Chrome.
- Virtual Camera: el ID de la extensión cambia cada vez que se hace "Load
  unpacked" sin clave RSA. Para un ID determinístico, generar un par de claves
  y añadir `"key"` al manifest.
