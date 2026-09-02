# Auditoría de precisión del reconocimiento de gestos

## Resumen ejecutivo

Se analizó la pipeline completa de reconocimiento de gestos de ScreenYard,
desde la captura de webcam hasta la traducción de eventos en acciones de UI.
Se identificaron **7 problemas de precisión** y se implementaron **6 mejoras**
usando APIs del navegador y técnicas modernas de filtrado.

---

## Pipeline actual (antes de las mejoras)

```
getUserMedia → <video> oculto → MediaPipe HandLandmarker (GPU, rAF)
  → landmarks 3D → GestureRecognizer → GestureSmoother (EMA + predicción)
  → GestureEvent → Stage.tsx → acciones (drag, edit, emoji)
```

---

## Problemas identificados

### 1. Suavizado EMA fijo (GestureSmoother)

**Problema:** El suavizado usaba un EMA (Exponential Moving Average) con `alpha`
fijo (0.55). Esto significa que el nivel de suavizado es el mismo sin importar
la velocidad del movimiento. A baja velocidad, EMA con alpha=0.55 deja demasiado
jitter. A alta velocidad, introduce demasiado lag.

**Solución implementada:** **One Euro Filter** — filtro adaptativo que ajusta
el suavizado según la velocidad: a baja velocidad suaviza mucho (elimina jitter),
a alta velocidad suaviza poco (elimina lag). Es el estándar para tracking de
punteros ruidosos en HCI (Casiez et al., CHI 2012).

**Archivo:** `src/gestures/GestureSmoother.ts` — reescrito completamente.

**Parámetros:**
- `minCutoff`: frecuencia de corte mínima (más bajo = más suavizado a baja velocidad)
- `beta`: coeficiente de velocidad (más alto = menos suavizado a alta velocidad)
- `dCutoff`: corte del derivado (fijo en 1.0)

Los parámetros legacy (`alpha`, `deadZone`, `predictionStrength`) se mapean
automáticamente a parámetros One Euro para mantener compatibilidad.

### 2. Pinch detection con distancia 2D absoluta

**Problema:** El pinch se detectaba con `sqrt(dx² + dy²)` en coordenadas
normalizadas 0-1, con thresholds fijos (0.07 para activar, 0.10 para liberar).
Esto falla cuando:
- La mano está cerca de la cámara (parece grande → pinch difícil de activar)
- La mano está lejos (parece pequeña → pinch se activa demasiado fácil)
- Diferentes usuarios con diferentes tamaños de mano

**Solución implementada:** **Pinch distance normalizada por tamaño de mano**.
Se calcula `handSize = dist3D(wrist, middle_mcp)` como referencia estable del
tamaño de la mano en el frame actual. Luego `normalizedPinch = pinchDist / handSize`.
Los nuevos thresholds (0.45 activar, 0.60 liberar) son unitless y funcionan
independientemente de la distancia a la cámara o el tamaño de la mano.

**Archivos:** `src/gestures/HandTracker.ts` (cálculo), `src/gestures/GestureRecognizer.ts` (thresholds).

### 3. Finger counting con comparación de coordenada Y

**Problema:** `countFingers` determinaba si un dedo estaba extendido comparando
`tip.y < pip.y` (la punta está "más arriba" que la articulación PIP). Esto falla cuando:
- La mano está rotada o de lado
- El ángulo de la cámara no es frontal
- La mano está invertida (dedos apuntando hacia abajo)

**Solución implementada:** **Ángulos 3D entre articulaciones**. Para cada dedo
(índice, medio, anular, meñique), se calcula el ángulo en la articulación PIP
(MCP-PIP-DIP) usando coordenadas 3D (x, y, z). Si el ángulo > 160°, el dedo
está extendido; si < 110°, está doblado. Esto es invariante a la rotación de
la mano y al ángulo de la cámara.

Para el pulgar, se usa el ángulo en la articulación IP (MCP-IP-TIP) más una
verificación de distancia desde el centro de la palma, ya que el pulgar se
mueve en un plano diferente.

**Archivo:** `src/gestures/HandTracker.ts` — `countFingers()`, `detectGesture()`.

### 4. Sin filtrado por confianza (confidence)

**Problema:** Todas las detecciones de MediaPipe se procesaban igual, incluso
las de baja confianza (visibility < 0.5). Esto causaba falsos positivos y
jitter cuando la mano estaba parcialmente ocluida o en el borde del frame.

**Solución implementada:** **Filtrado por confianza**. Las detecciones con
`wrist.visibility < 0.5` se descartan antes de procesarlas. Esto reduce falsos
positivos sin perder detecciones válidas.

**Archivo:** `src/gestures/HandTracker.ts` — bucle `detect()`.

### 5. requestAnimationFrame para procesamiento de video

**Problema:** El bucle de detección usaba `requestAnimationFrame`, que dispara
en cada refresh del display (típicamente 60 Hz). Pero si la webcam produce
frames a 30 Hz, la mitad de las invocaciones procesan el mismo frame (trabajo
inútil + consumo de CPU/GPU).

**Solución implementada:** **requestVideoFrameCallback** (W3C, disponible en
Chrome/Brave). Esta API solo dispara cuando hay un nuevo frame de video
disponible, alineando la inferencia con la tasa real de frames de la webcam.
Fallback automático a `requestAnimationFrame` si no está disponible.

**Archivo:** `src/gestures/HandTracker.ts` — `detect()`, `stop()`.

### 6. Sin fallback GPU→CPU

**Problema:** `delegate: 'GPU'` se usaba sin manejo de errores. Si el dispositivo
no soporta WebGPU o la inferencia GPU falla (drivers, modo incógnito, etc.),
la inicialización fallaba y la app no funcionaba.

**Solución implementada:** **Try/catch con fallback a CPU**. Si la creación
con `delegate: 'GPU'` falla, se reintenta con `delegate: 'CPU'`. Más lento pero
funcional en todos los dispositivos.

**Archivo:** `src/gestures/HandTracker.ts` — `initialize()`.

### 7. Gesto de 1 finger sin retardo ni feedback

**Problema:** El evento `finger-count` disparaba inmediatamente al detectar
1 dedo, sin retardo. Durante transiciones (5→4→3→2→1), el conteo pasa por
1 brevemente, causando activaciones accidentales. Además, no había feedback
visual del progreso.

**Solución implementada:** **Hold delay de 600ms con anillo de progreso SVG**.
El usuario debe sostener 1 dedo durante 600ms para activar la edición de texto.
Un anillo azul se llena progresivamente alrededor del cursor virtual durante
el hold. Si el conteo de dedos cambia antes de completarse, se cancela.

**Archivos:** `src/components/Stage.tsx` (lógica del hold), `src/components/VirtualCursor.tsx` (anillo SVG).

---

## Mejoras adicionales identificadas (no implementadas aún)

### A. ~~Empaquetar WASM y modelo de MediaPipe localmente~~ ✅ Implementado

**Antes:** El WASM se cargaba desde `cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm`
y el modelo desde `storage.googleapis.com`.

**Ahora:** WASM y modelo se sirven desde `public/mediapipe/wasm/` y
`public/mediapipe/hand_landmarker.task`. La versión está pineada a `0.10.35`.
El script `build:ext` copia estos archivos a `dist/mediapipe/` automáticamente.

### B. Web Worker para inferencia

**Actual:** Toda la inferencia de MediaPipe corre en el main thread.

**Problema:** Puede causar jank en el render de React durante la inferencia,
especialmente en dispositivos lentos.

**Recomendación:** Mover `HandTracker` a un Web Worker con `OffscreenCanvas`.
MediaPipe Tasks Vision soporta ejecución en Workers. Comunicar resultados via
`postMessage` con `Transferable` para evitar copias.

### C. ~~Handedness estable (izquierda/derecha)~~ ✅ Implementado

**Antes:** `handIndex` (0, 1) se basaba en el orden de detección, que podía
cambiar frame a frame. La "mano primaria" podía cambiar impredeciblemente.

**Ahora:** Se usa `handednesses` de MediaPipe (Left/Right con score) para
asignar stablemente handIndex=0 → izquierda (mano primaria), handIndex=1 →
derecha. Se tiene en cuenta el mirrorX para que la asignación sea consistente
con la posición en pantalla.

### D. Kalman Filter como alternativa

**One Euro Filter** es excelente para punteros 2D, pero si se necesita tracking
3D completo (incluyendo z), un **Kalman Filter** modela la dinámica del
movimiento más formalmente. Librería: `kalmanjs` (npm).

**Recomendación:** Considerar solo si se añade interacción 3D (ej. depth-based
scaling de ventanas). Para uso actual 2D, One Euro es suficiente y más simple.

### E. TensorFlow.js HandPose como alternativa

**MediaPipe** es excelente pero depende de CDN externo. **TensorFlow.js**
con el modelo `hand-pose-detection` corre enteramente en-browser con
WebGL/WebGPU, sin dependencias de CDN.

**Trade-off:** TF.js es ligeramente menos preciso que MediaPipe pero más
fácil de empaquetar offline. Considerar como alternativa si el empaquetado
offline de MediaPipe resulta problemático.

### F. Tuning de parámetros con datos reales

**Actual:** Los thresholds (ángulos de dedos, pinch normalizado, minConfidence)
se estimaron basándose en valores típicos de MediaPipe.

**Recomendación:** Recolectar muestras de landmarks con diferentes usuarios,
distancias de cámara, y iluminación. Ajustar thresholds con percentiles
(ej. pinch threshold = percentil 5 de distancia normalizada durante pinch real).

### G. ~~Frame skipping adaptativo~~ ✅ Implementado

**Antes:** Se procesaba cada frame de video, sin importar cuánto tardara la inferencia.

**Ahora:** Se mide el tiempo de inferencia con `performance.now()`. Si excede
33ms (budget de 30fps), se calcula cuántos frames saltar
(`ceil(inferenceTime / budget) - 1`) para mantener el pipeline en tiempo real.
Esto previene acumulación de lag en dispositivos lentos.

---

## APIs del navegador utilizadas

| API | Uso | Disponibilidad |
|---|---|---|
| `getUserMedia` | Captura de webcam | Todos los navegadores modernos |
| `requestVideoFrameCallback` | Sincronizar inferencia con frames de video | Chrome/Brave 83+, Firefox 110+ |
| `requestAnimationFrame` | Fallback para bucle de detección | Universal |
| WebGPU (via MediaPipe) | Aceleración GPU de inferencia | Chrome 113+, fallback a CPU |
| `performance.now()` | Timestamps de alta resolución para filtros | Universal |

## Librerías JS consideradas

| Librería | Propósito | Estado |
|---|---|---|
| One Euro Filter (implementación propia) | Suavizado adaptativo de puntero | **Implementado** |
| `kalmanjs` (npm) | Filtro de Kalman para tracking 3D | Considerado, no necesario para 2D |
| `@mediapipe/tasks-vision` | Detección de hand landmarks | En uso |
| `@tensorflow-models/hand-pose-detection` | Alternativa a MediaPipe | Considerado como alternativa |
| `one-euro-filter` (npm) | Implementación One Euro como paquete | Implementación propia, sin dependencia extra |

---

## Resumen de cambios implementados

| # | Mejora | Archivo(s) | Impacto |
|---|---|---|---|
| 1 | One Euro Filter | `GestureSmoother.ts` | Menos jitter a baja velocidad, menos lag a alta velocidad |
| 2 | Pinch normalizado por tamaño de mano | `HandTracker.ts`, `GestureRecognizer.ts` | Pinch consistente independientemente de distancia/usuario |
| 3 | Finger counting con ángulos 3D | `HandTracker.ts` | Robusto a rotación de mano y ángulo de cámara |
| 4 | Filtrado por confianza | `HandTracker.ts` | Menos falsos positivos |
| 5 | requestVideoFrameCallback + fallback rAF | `HandTracker.ts`, `Stage.tsx` | Menos CPU/GPU, alineado con tasa de frames |
| 6 | Fallback GPU→CPU | `HandTracker.ts` | Funciona en dispositivos sin GPU |
| 7 | Hold delay + feedback visual para 1 finger | `Stage.tsx`, `VirtualCursor.tsx` | Menos activaciones accidentales, UX clara |
| 8 | Handedness estable (izquierda/derecha) | `HandTracker.ts` | handIndex consistente, no cambia frame a frame |
| 9 | Frame skipping adaptativo | `HandTracker.ts` | Mantiene pipeline en tiempo real en dispositivos lentos |
| 10 | MediaPipe local (offline) | `public/mediapipe/`, `build-extension.mjs` | Funciona sin internet, versión pineada |
| 11 | Tracking video visible (no display:none) | `Stage.tsx` | rVFC funciona correctamente, frames se decodifican |

**Tests:** 40 tests pasan (8 nuevos/actualizados para One Euro Filter y pinch normalizado).

### Mejoras pendientes (no implementadas)

| # | Mejora | Razón de no implementar |
|---|---|---|
| B | Web Worker para inferencia | Complejidad alta, requiere refactor del pipeline |
| D | Kalman Filter | One Euro es suficiente para tracking 2D |
| E | TensorFlow.js como alternativa | MediaPipe local ya resuelve el problema offline |
| F | Tuning con datos reales | Requiere recolección de datos de usuarios |
