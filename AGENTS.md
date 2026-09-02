# ScreenYard — Guía para agentes

## Qué es ScreenYard

Extensión de navegador (Chrome/Brave, Manifest V3) que abre una pestaña con un
"escenario" donde se superponen ventanas (texto, imágenes, formas) sobre un fondo
de webcam. El escenario se controla con gestos de mano mediante MediaPipe Tasks
Vision. Está pensada para compartir la pestaña en videollamadas (StreamYard,
Zoom, Meet, etc.).

## Stack

- **React 18** + **TypeScript** (strict)
- **Vite 6** como bundler
- **Vitest 2** para tests (entorno jsdom)
- **MediaPipe Tasks Vision** (`@mediapipe/tasks-vision`) para tracking de manos
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
│   ├── App.tsx             # Componente raíz: orquesta Toolbar + Stage
│   └── App.css
├── components/
│   ├── Stage.tsx           # Escenario: webcam + ventanas + gestos + trash + emojis
│   ├── Stage.css
│   ├── Toolbar.tsx         # Barra superior: añadir ventanas, modo presentación, debug
│   ├── Toolbar.css
│   ├── WindowWrapper.tsx   # Wrapper draggable/resizable para cada ventana
│   ├── TextWindow.tsx      # Ventana de texto editable (doble-clic o gesto 1 dedo)
│   ├── ImageWindow.tsx     # Ventana de imagen (URL)
│   ├── ShapeWindow.tsx     # Ventana de forma (rect/circle/triangle)
│   ├── VirtualCursor.tsx   # Cursor virtual que sigue al dedo índice
│   ├── TrashZone.tsx       # Zona de eliminación en la parte inferior
│   ├── EmojiBurst.tsx      # Emojis animados (reacción a thumb_up)
│   └── DebugPanel.tsx      # Panel de debug de gestos (toggleable)
├── gestures/
│   ├── types.ts            # Tipos: GestureEvent, GestureState, HandOrientation...
│   ├── HandTracker.ts      # Wrapper de MediaPipe HandLandmarker (hasta 2 manos)
│   ├── GestureRecognizer.ts# Convierte landmarks en eventos (pinch, finger-count...)
│   ├── GestureSmoother.ts  # Suavizado EMA con predicción de velocidad
│   └── __tests__/          # Tests de GestureRecognizer, GestureSmoother, coords
├── windows/
│   ├── types.ts            # Tipos: WindowData, WindowType, TextData, ImageData...
│   ├── WindowManager.ts    # Reducers puros: add/remove/move/resize/select/lock/edit
│   ├── WindowModel.ts      # Factory: createWindow + defaults por tipo
│   └── __tests__/          # Tests de WindowManager y WindowModel
└── test/
    └── setup.ts            # Setup de Vitest (jest-dom matchers)

public/
├── manifest.json           # Manifest V3 de la extensión
├── background.js           # Service worker: abre pestaña al clicar el icono
└── icons/                  # Iconos 16/48/128px (generados por scripts/generate-icons.mjs)

scripts/
├── build-extension.mjs     # Build + copia manifest/background/icons a dist/
└── generate-icons.mjs      # Genera PNGs desde SVG inline usando sharp
```

## Flujo de datos

1. **Estado de ventanas**: `WindowManagerState` (`{ windows: WindowData[], selectedId }`)
   vive en `App.tsx` via `useState`. Todas las mutaciones pasan por reducers puros
   en `WindowManager.ts` (inmutables, testeables).

2. **Gestos**: `HandTracker` procesa frames de webcam con MediaPipe →
   `GestureRecognizer` emite `GestureEvent`s (pinch-start, pointer-move, finger-count,
   gesture-detected...) → `Stage.tsx` escucha y traduce a acciones sobre ventanas.

3. **Drag**: mouse (vía `WindowWrapper`) o gesto (pinch). Ambos actualizan posición
   via `moveWindow`. La `TrashZone` aparece durante el drag; soltar ahí elimina.

## Tipos de ventana

| Tipo | Componente | Estado |
|---|---|---|
| `text` | `TextWindow` | Implementado — editable con doble-clic o gesto 1 dedo |
| `image` | `ImageWindow` | Implementado — muestra imagen desde URL |
| `shape` | `ShapeWindow` | Implementado — rect/circle/triangle |
| `browser` | — | **Definido en types pero NO implementado** (fallback) |
| `counter` | — | **Definido en types pero NO implementado** (fallback) |

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

## Testing

- Tests en `__tests__/` adyacentes al código que testean.
- Entorno jsdom; setup en `src/test/setup.ts` (jest-dom matchers).
- 39 tests actuales cubren: WindowManager (14), WindowModel (5),
  GestureRecognizer (8), GestureSmoother (7), coordinateConversion (5).
- **Sin cobertura**: componentes de UI (Stage, WindowWrapper, TextWindow...),
  HandTracker (requiere MediaPipe + cámara).

## Notas importantes

- **MediaPipe se carga desde CDN**: `HandTracker.initialize` descarga WASM y modelo
  desde `cdn.jsdelivr.net` y `storage.googleapis.com`. La extensión no funciona
  offline. Para uso offline, empaquetar WASM y modelo en `dist/`.
- **Cámara obligatoria**: `Stage` pide `getUserMedia` al montar. Sin permiso de
  cámara, muestra error pero la app no es funcional.
- **Manifest V3**: `public/manifest.json` solo pide permiso `activeTab`. El
  service worker (`background.js`) abre `index.html` al clicar el icono.
- **Build de extensión**: `npm run build:ext` genera `dist/` listo para cargar
  como extensión desempaquetada en `chrome://extensions/`.

## Bugs conocidos / limitaciones

- Tipos `browser` y `counter` definidos pero sin componente UI (fallback).
- `HandTracker`, `GestureRecognizer` y smoothers se instancian a nivel de módulo
  en `Stage.tsx` (fuera del componente). Si `Stage` se desmonta/remonta, las
  instancias persisten y los smoothers no se reinician.
- El `useEffect` de gestos en `Stage.tsx` se re-registra en cada cambio de
  `state` (frecuente durante drag). Podría optimizarse con un `ref` para `state`.
- `nextZIndex` es mutable global en `WindowModel.ts` — acoplado al ciclo de vida
  del módulo.
