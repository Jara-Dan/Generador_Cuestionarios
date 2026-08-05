# Creador de Evaluaciones · Praxis Pedagógica

Herramienta web para que docentes creen preguntas y las exporten como **XML del banco
de preguntas de Moodle**. También genera un prompt tipo ICFES para crear preguntas con
IA, importa respuestas en formato Aiken, y exporta la evaluación a Word.

## Rebranding a Praxis Pedagógica (2026-08-04)

El proyecto se llamaba **Trendi** (empresa "Trendi · Trends & Innovation") y ahora es
parte de **Praxis Pedagógica**, un proyecto más grande de Daniel. Se eliminó toda
referencia a Trendi de la interfaz, el código y la documentación:

- Título de la pestaña / SEO: «Creador de Evaluaciones — Exportación a Moodle».
- El logo del header (`.praxis-logo`) ya se había reemplazado antes (commit
  `4b602c4`); ahora también el favicon (`assets/favicon.svg`) usa el mismo ícono
  geométrico azul/naranja en vez del cuadrado naranja con la "T".
- **Claves de `localStorage` renombradas** (`trendi_quizgen_v1` →
  `praxis_quizgen_v1`, `trendi_whatsnew_seen` → `praxis_whatsnew_seen`), con
  **migración automática de un solo uso** (`migrateOldStorageKeys()` /
  `migrateOldWhatsNewKey()`, junto a `KEY`/`WN_SEEN_KEY` en `js/main.js`): copian el
  valor de la clave vieja a la nueva la primera vez que un docente con trabajo
  guardado abre la versión nueva, sin borrar la clave vieja. Decisión de Daniel:
  prioriza no perder el trabajo de docentes que ya usaban la herramienta por sobre
  dejar el código 100 % libre del nombre viejo desde el día uno.
- Nombres de archivo por defecto (respaldo JSON, XML, Word) y el asunto del correo
  del buzón de sugerencias pasaron de "…trendi"/"…Trendi" a "…praxis"/"Praxis
  Pedagógica".

## Invariante principal (no negociable)

**Todo lo que se genere tiene que poder importarse en Moodle como XML sin errores.**
Antes de agregar cualquier funcionalidad nueva hay que verificar que el tipo de pregunta
de Moodle la soporte de verdad — no basta con que se vea bien en la interfaz.

## Arquitectura

- **Sin dependencias ni build.** HTML + CSS + JS puro. Toda la lógica vive en
  `js/main.js` (~3300 líneas, un solo IIFE). El único recurso externo es Google Fonts (CSS).
- **100 % en el navegador.** No hay servidor ni backend. El trabajo se guarda en
  `localStorage`.
- Archivos: `index.html` (markup + textos de ayuda), `css/style.css`, `js/main.js`.

### Zonas de `js/main.js`

| Zona | Qué hace |
|---|---|
| Estado + `save()` | Modelo de la pregunta en edición y persistencia en localStorage |
| Rich text | Editor del enunciado (negrita/cursiva/listas/fórmula) |
| Type switch | Muestra el bloque del formulario según el tipo |
| Bloques por tipo | `renderOpts`, `renderSA`, `renderMatch`, etc. |
| `renderPreview()` | Vista previa — debe imitar cómo Moodle renderiza de verdad |
| `renderTray()` / `editQ()` | Lista "Mis preguntas" y carga al editar |
| `buildXML()` + `commonXML()` | Generación del XML de Moodle |
| `latexToPng()` + `serializeMathWord()` | Fórmulas como imagen para el Word (Fase 5) |
| `writeWordFile()` + `examHeaderHTML()` | El `.doc` de examen impreso (Fase 6) |

## Al agregar o cambiar un tipo de pregunta, tocar SIEMPRE estos 6 puntos

Es fácil olvidar uno y que el bug aparezca después:

1. Estado inicial (`freshPairs()`, `freshOpts()`, …) y `resetForm()`
2. Render del bloque en el formulario
3. Validación en `$('addBtn').onclick`
4. Guardado del objeto en `questions` (el mismo `onclick`)
5. Recarga al editar en `editQ()`
6. **`buildXML()` y la exportación a Word** — los dos, o quedan desincronizados

## Imágenes

- Se guardan en base64 dentro del objeto de la pregunta. Límite de 1 MB por imagen
  (localStorage son ~5 MB en total y las imágenes lo llenan rápido). Desde la Fase 3
  las que se pasan **se reescalan solas** en vez de rechazarse; ver más abajo.
- Hay **dos productores** del objeto imagen: el `<input type="file">` y el lienzo de
  dibujo. Los dos pasan por `makeImage()` y entregan la misma forma, así que el resto
  de la app no distingue de dónde vino.
- En el XML van con la ruta mágica `@@PLUGINFILE@@/<archivo>` en el HTML **más** una
  etiqueta `<file name="…" path="/" encoding="base64">` hermana, dentro del mismo
  elemento (`<questiontext>` para la imagen general, `<subquestion>` para las de
  emparejamiento). Si falta el `<file>`, Moodle importa la pregunta con la imagen rota.

## Limitaciones reales de Moodle (ya verificadas)

- **Emparejamiento:** el elemento de la izquierda admite HTML (por eso puede llevar
  imagen), pero **la respuesta de la derecha siempre es texto plano** — Moodle la
  renderiza en un `<select>`, y un `<option>` no puede contener imágenes. Para
  imagen ↔ imagen haría falta el tipo "arrastrar y soltar sobre una imagen", que es
  un tipo distinto con imagen de fondo y coordenadas.
- La vista previa muestra la **respuesta correcta resaltada** (es para el docente),
  mientras que el estudiante en Moodle vería el control vacío. Es intencional.

## Matemáticas (rediseño en curso, por fases)

### El grupo "Matemáticas"

El botón **Matemáticas** de `#types` no es un tipo de pregunta: es un **agrupador** que
despliega una segunda fila (`#mathTypes`) con sus subtipos. La lógica vive en el arreglo
`MATH_TYPES` de `js/main.js`. Para agregar un subtipo hacen falta dos cosas:

1. Un `<button data-type="…">` dentro de `#mathTypes` en `index.html`.
2. El mismo identificador dentro de `MATH_TYPES`.

A partir de ahí sigue aplicando el checklist de 6 puntos de arriba.

`lastMathType` recuerda el último subtipo usado, para que al volver a pulsar el
agrupador no se pierda la selección.

### Estado por fases

| Fase | Alcance | Estado |
|---|---|---|
| 1 | Grupo "Matemáticas" + `numerical` completo (varias respuestas con crédito parcial, tolerancia por respuesta, unidades, comodín `*`) | **Hecho** |
| 2 | Editor de fórmulas con cuadros vacíos (MathLive) + vista previa que renderice | **Hecho** |
| 3 | Lienzo de dibujo (6 fondos) + reescalado automático de fotos. **Sin cámara propia**, ver abajo | **Hecho** — alcance original cerrado; el reconocimiento de escritura a mano (Mathpix) quedó descartado por ahora, ver "Decisión sobre el alcance de Fase 3" abajo |
| 4 | `calculated` / `calculatedmulti` con datasets | **Hecho y confirmado en Moodle** |
| 5 | Fórmulas en el export a Word y huecos `NUMERICAL` en cloze | **Hecho** |
| 6 | **Formato de examen impreso** en el Word (escudo + encabezado editable) | **Hecho** |
| 7 | Botón **«Novedades»** con los cambios de cada versión | **Hecho** |
| 8 | **Buzón de sugerencias** para que los docentes escriban a Daniel | **Hecho** |
| 9 | **Generador con IA: LaTeX → fórmula visual** al importar | **Hecho** |
| 10 | **Editor de dibujo → editor de diagramas didácticos** (motor Fabric.js, capas, conectores, plantillas, sellos) — reemplaza el motor de la Fase 3 | **En curso — Fases A y B hechas** (2026-07-30 y 2026-08-04), C-G sin empezar. Ver fases A-G más abajo |

Las fases 5 y 6 se hicieron juntas el 2026-07-29, como estaba previsto: las dos tocaban
el mismo export a Word. Su documentación está en «Fórmulas en el Word» y «Formato de
examen impreso», más abajo.

### Cómo se guarda una fórmula (Fase 2)

Dentro del enunciado (un `contenteditable`) la fórmula **no** es texto LaTeX crudo, sino
un bloque atómico:

```html
<span class="fx" contenteditable="false" data-latex="\frac{a}{b}">…dibujo de MathLive…</span>
```

- El docente ve la fórmula **dibujada** mientras escribe y no puede romperla por dentro.
- El LaTeX original viaja en `data-latex`.
- **Hay que convertir los bloques antes de mandar el enunciado a cualquier salida**, o
  el markup de MathLive se cuela en el archivo. Hay **dos** conversores y cada salida
  usa el suyo:

  | Función | Deja | La usan |
  |---|---|---|
  | `serializeMath(html)` | `\( … \)` para MathJax | `buildStatement()` (XML) y `renderTray()` |
  | `serializeMathWord(html, mapa)` | una `<img>` PNG de la fórmula | el export a Word (Fase 5) |

  **Si se añade una salida nueva hay que llamar a la que corresponda.** Si la salida es
  un archivo que se abre fuera del navegador (Word, PDF), es la segunda.

Detalles de MathLive que costaron descubrir:

- `<math-field>` emite `input` al teclear, pero **no** cuando se le inserta contenido
  por código (`executeCommand`/`insert`). Por eso la caja de LaTeX se refresca también
  al desplegar el `<details>`.
- El evento `toggle` de `<details>` es **asíncrono**: al probarlo hay que esperar un
  tick antes de leer el resultado.
- `\placeholder{}` **no existe en MathJax**. Si queda alguno sin llenar, Moodle mostraría
  un error, así que la inserción se bloquea. Para un hueco intencional está la plantilla
  «Espacio en blanco», que usa `\underline{\hspace{…}}` (TeX base, sin depender de AMS).

### Lienzo de dibujo (Fase 3)

**El lienzo no es un tipo de pregunta ni una salida nueva: es otro *productor* del
mismo objeto imagen** que ya producía el `<input type="file">`
(`{filename, base64, dataUrl, alt}`). Por eso **no hubo que tocar `buildXML()`,
`editQ()`, `resetForm()` ni el export a Word** — y por eso el checklist de 6 puntos
no aplica aquí. Un dibujo viaja a Moodle exactamente igual que un JPG cargado a mano.
La predicción se cumplió: el **escudo de la Fase 6** es el tercer productor y tampoco
hubo que tocar nada de eso — basta con devolver ese objeto y llamar a `makeImage()`.

`openDrawDlg(existing, onDone)` es reutilizable, al estilo de `openFxDlg`. Está
enganchado en dos sitios: la imagen general (`#imgArea`) y el elemento izquierdo del
emparejamiento (`.pair-thumb-draw`), que también admite imagen.

Decisiones que hay que respetar:

- **Los trazos NO se pintan directo sobre el canvas.** Se guardan como objetos en
  `drawShapes` y se redibuja todo en cada cambio (`redraw()`). Eso da gratis el
  deshacer/rehacer, la vista elástica al arrastrar una figura, y cambiar el fondo
  sin perder lo dibujado. Si alguien lo "optimiza" pintando directo, pierde las tres.
- **Sin librerías** (Fabric.js, Konva): serían ~200 KB para usar el 5 %.
- **Pointer Events**, no eventos de ratón: un solo camino cubre ratón, dedo y lápiz.
  `touch-action:none` en el canvas es **obligatorio** — sin él la página se desplaza
  al dibujar con el dedo y no llega ningún `pointermove`.
- El canvas tiene **1000×700 internos** y se muestra escalado por CSS, así que
  `drawPt()` convierte las coordenadas con `getBoundingClientRect()`. Sin esa
  conversión el trazo sale desplazado del cursor: es el error clásico de todo lienzo.
  Verificado: un trazo del 25 % al 75 % del ancho en pantalla cae exacto en x=250…750.
- Se exporta en **PNG, no JPEG**: el JPEG ensucia los bordes del trazo.
- **Los trazos no se guardan en localStorage** a propósito (engordarían mucho el
  almacenamiento, que ya va justo con las imágenes). `drawMemo` los recuerda solo
  durante la sesión: se puede reabrir y seguir dibujando, pero **al recargar la
  página el dibujo queda como imagen plana** y el botón pasa de «Seguir editando el
  dibujo» a «Dibujar otra». Es intencional y está comprobado.
- El plano cartesiano **no se numera**: la escala cambia en cada ejercicio, así que la
  pone el docente con la herramienta de texto.
- Los avisos del lienzo van **inline dentro del diálogo** (`#drawMsg`), nunca por
  toast — ver la sección del toast más abajo. El «Dibujo insertado» sí es un toast,
  pero se lanza **después** de cerrar el diálogo.

Tamaños medidos (el límite es 1 MB): un dibujo normal ronda los **20–40 KB**. El peor
caso realista —papel milimetrado, el fondo más pesado, más 120 garabatos gruesos— dio
**325 KB**. En la práctica el docente no va a topar con el techo.

### Decisión sobre el alcance de Fase 3 (histórico, 2026-07-29)

**Registro histórico: lo que se construyó no era lo que se había hablado
originalmente**, y por eso quedó esta nota — pero la decisión ya se tomó (ver abajo) y
la fase está cerrada con el alcance que sí se construyó. El `CLAUDE.md` describía
la Fase 3 como "lienzo de dibujo y cámara → imagen (sin OCR)", y eso es lo que se
construyó: un lienzo que produce una imagen estática, igual que cargar un JPG.

Pero Daniel aclaró que en una sesión anterior (que nunca quedó documentada aquí) se
había hablado de algo distinto y más ambicioso: un módulo de **"Escritura a mano /
Tablet"** que cumpliera con la experiencia de **Mathpix Snip** — es decir, que el
lienzo no se quede en imagen, sino que **reconozca la fórmula escrita a mano y la
convierta a LaTeX/MathML**, insertándola como un bloque `span.fx` normal (el mismo
formato de la Fase 2), no como una imagen.

Esto es un problema de reconocimiento de escritura matemática (HWR), no un simple
canvas. Se evaluaron las opciones reales el 2026-07-29:

| Opción | Calidad | Costo/arquitectura |
|---|---|---|
| **API de Mathpix + proxy serverless** | La única que da de verdad la experiencia Mathpix Snip (es su motor) | Rompe la invariante "100 % en el navegador, sin backend": necesita una función serverless mínima (Cloudflare Worker o similar) para no exponer la API key. Tiene costo si se supera el nivel gratuito de Mathpix. |
| Modelo abierto en el navegador (ONNX/TF.js, CROHME) | Notablemente peor que Mathpix con letra desprolija de docente/estudiante | Sigue 100 % estático y sin costo, pero es semanas de trabajo real (entrenar/adaptar modelo, convertirlo, cargar decenas de MB de pesos) |
| Cada docente con su propia key de Mathpix | Misma calidad que la opción 1 | Sin backend propio, pero fricción de registro alta — probablemente pocos docentes lo hacen |

**Decisión de Daniel (2026-07-29): no seguir con esto por ahora.** El lienzo actual
(dibujo → imagen) queda como está, funcionando como plan B universal para fórmulas
cuando MathJax no esté activo en el Moodle de destino. Retomar el reconocimiento de
escritura a mano es una decisión pendiente que solo la puede tomar Daniel, porque
implica costo recurrente y añadir el único componente de backend del proyecto.

**Antes de tocar esto de nuevo:** confirmar con Daniel cuál de las tres rutas de la
tabla prefiere, no asumir ninguna.

### Reescalado automático de imágenes (Fase 3)

Antes, una foto de celular (2–5 MB) **se rechazaba** y el docente tenía que
comprimirla por su cuenta. Ahora `fitImage()` la reduce a 1400 px de lado máximo y la
recomprime hasta entrar. Por eso el `accept` de los inputs es `image/*`: en el móvil
eso ya ofrece **«Tomar foto»** de forma nativa, que es mejor interfaz que cualquier
`getUserMedia` que programemos. **Esa es la razón por la que no hay cámara propia** —
no es un olvido de la Fase 3.

**Trampa importante: la extensión del archivo tiene que casar con los bytes reales.**
`editQ()` reconstruye el `dataUrl` a partir de la extensión, el export a Word deriva
el MIME de ella (`filename.slice(-3)`), y Moodle también se guía por ella. Así que
`fitImage()` **reconvierte siempre** cualquier formato que no sea PNG ni JPEG: dejar
pasar un `.webp` renombrado a `.jpg` metería bytes de webp en el XML con extensión
mentirosa y Moodle importaría la imagen rota. Solo se salta el reescalado cuando el
formato ya es PNG/JPEG **y** cabe en medidas **y** en peso.

Comprobado midiendo: PNG de 3,74 MB → JPEG de 0,53 MB a 1400×969; webp pequeño y
dentro de medidas → reconvertido a `.jpg` (no pasa tal cual); y en el XML resultante
la firma de bytes de cada `<file>` coincide con su extensión.

### Editor de dibujo → editor de diagramas didácticos (Fase 10)

Reescritura del lienzo de la Fase 3 (`drawShapes`/`redraw()`, canvas 2D puro) hacia un
editor de objetos vectorial (selección, capas, conectores, plantillas). Aprobada por
Daniel el 2026-07-30, documentada aquí **antes** de iniciar cualquier fase para que
sobreviva a un `/clear` de la conversación.

**Decisiones de arquitectura ya tomadas (no volver a discutir sin motivo nuevo):**

- **Motor: Fabric.js v5.x, vendorizado en el propio repo** (p. ej. `/vendor/`), **no
  CDN externo**. GitHub Pages ya sirve estático gratis; depender de un CDN de terceros
  es justo el tipo de fragilidad que más le duele a este público (wifi de colegio poco
  confiable). Carga **perezosa**, solo al abrir el diálogo de dibujo — mismo patrón que
  `ensureMathJax()` —, con degradación si la carga falla.
- **Sigue sin backend.** El estado del editor vive en memoria de sesión, igual que
  `drawMemo` hoy — no se persiste en localStorage (mismo motivo que ya aplica al lienzo
  actual: no inflar el almacenamiento, que ya va justo con las imágenes).
- **La salida no cambia**: sigue siendo PNG vía `makeImage()`. `buildXML()`, el export a
  Word, `editQ()` y el contrato `openDrawDlg(existing, onDone)` quedan intactos — esto
  es un reemplazo del motor interno, no una función nueva aparte.
- **Reemplaza, no coexiste**, con `drawShapes`/`redraw()`.
- No toca la decisión pendiente de Mathpix/reconocimiento de escritura a mano de
  «Decisión sobre el alcance de Fase 3» (arriba) — son problemas distintos: esto sigue
  produciendo una imagen rasterizada, no LaTeX/MathML.

**Fases:**

| Fase | Alcance |
|---|---|
| A | Motor Fabric.js + paridad de herramientas actuales como objetos vivos (seleccionar/mover/rotar/reescalar/editar propiedades), multi-selección, agrupar, candado (botón + clic derecho), capas (frente/fondo/duplicar/papelera/bloquear), deshacer/rehacer, fondos actuales migrados tal cual |
| B | Lienzo infinito: manita (pan), zoom con rueda + botones, recorte automático al exportar (bounding box del contenido real). **Ampliada tras la revisión de Daniel**: fondo infinito de verdad, cromo de aplicación con barra de acciones siempre visible, herramientas que no se quedan armadas, y desplegable de formas geométricas |
| C | Imagen de fondo (subir foto), auto-bloqueo, resaltador, anotación sobre fotos (flechas, círculos, cotas de medida "10 cm", texto) |
| D | Conectores anclados a formas (recto/ortogonal/curvo) + cajas de texto con borde/relleno para mapas conceptuales |
| E | Plantillas pedagógicas: Venn, línea de tiempo, ciclo, cuadro comparativo, mapa conceptual prearmado, rotulado con líneas guía |
| F | Sellos didácticos por materia + insertar fórmula LaTeX como objeto del lienzo + regla/transportador |
| G | «Pluma inteligente» (trazo a mano → forma geométrica limpia) — evaluar al final, no comprometida de entrada; ver nota abajo |

Detalle y decisiones de cada fase:

- **Fase A.** Cada figura/línea/texto queda seleccionable, movible, reescalable,
  rotable, con propiedades editables después de creada — hoy no existe: una vez
  dibujado un trazo es fijo. Multi-selección (marco de arrastre o Shift+clic) y agrupar
  no estaban en el pedido original pero son indispensables en cuanto haya más de 2-3
  objetos. El candado se activa desde botón 🔒 y también desde clic derecho. Los fondos
  actuales (milimetrado, cartesiano, isométrico, recta numérica, blanco, colores) se
  portan sin cambios visuales.
  **Sobre "el borrador":** en un editor de objetos no hay borrador de píxeles —
  seleccionar + papelera (o tecla Supr) cumple esa función. Un borrador que quite
  *parte* de un trazo a mano alzada (como una goma sobre lápiz) es una herramienta
  aparte y más cara de construir; queda en el backlog de la Fase G, no dado por hecho.

  **Hecha (2026-07-30).** Fabric.js v5.3.0 vendorizado en `vendor/fabric.min.js`
  (ojo: el build de cdnjs para "5.3.0" trae el string de versión interno mal
  etiquetado como 5.1.0 — un bug conocido de esos builds —, así que el archivo
  vendorizado viene de unpkg, verificado con `version:"5.3.0"` real dentro del
  propio bundle). Carga perezosa con `ensureFabric()`, mismo patrón que
  `ensureMathJax()`. El motor interno del lienzo (antes `drawShapes`/`redraw()`
  con canvas 2D puro) fue reemplazado por completo; `openDrawDlg(existing,
  onDone)` conserva su firma y `drawMemo` sigue viviendo solo en memoria de
  sesión (ahora guarda el JSON de Fabric en vez de un arreglo de figuras).

  Detalles que no eran obvios de antemano:
  - **Los fondos (patrón) y el color de relleno siguen siendo independientes**,
    igual que antes: el patrón (`drawBackground()` y sus funciones, sin tocar)
    se rasteriza una vez a un canvas aparte y entra como `backgroundImage` no
    seleccionable; el color va aparte en `backgroundColor`. Ninguno de los dos
    viaja dentro del historial de deshacer/rehacer (se restaura aparte con
    `applyBackground()`) para no arrastrar una copia del PNG de fondo en cada
    paso — antes tampoco era "deshacible" cambiar el fondo, así que el
    comportamiento no cambió, solo cómo se logra.
    **⚠️ Superado por la Fase B**: el fondo ya no se rasteriza a un PNG ni usa
    `backgroundImage`/`backgroundColor` de Fabric — se pinta por fotograma en
    `renderCanvasBg()` para que sea infinito. Lo que SÍ sigue igual es que el
    fondo no viaja en el historial.
  - **La herramienta Flecha arma un `fabric.Group` (línea + triángulo) marcado
    con `dArrow:true`.** Sin esa marca, el botón "Desagrupar" la partiría en sus
    dos piezas sueltas la primera vez que alguien seleccione una flecha y
    pulse agrupar/desagrupar por error — `dArrow` (y `dLocked`, del candado) van
    en `FABRIC_EXTRA_PROPS` porque Fabric no los serializa por defecto.
  - **Deshacer/rehacer es una pila de snapshots** (`canvas.toJSON()` en cada
    acción confirmada: crear figura, mover/rotar/reescalar, candado, agrupar,
    duplicar, papelera, capas, color/trazo/opacidad del panel), no un historial
    de comandos. Consecuencia visible: "Limpiar todo" ya no se deshace "trazo a
    trazo" como en la Fase 3 — un solo Deshacer devuelve el lienzo completo de
    una vez. Se avisa así en el mensaje inline del diálogo para no prometer de
    más.
  - **Exportar SIEMPRE a 1000×700 reales.** El lienzo se ve escalado con
    `canvas.setZoom()` para caber en el diálogo (responsive), pero
    `toDataURL()` exporta al tamaño de canvas ACTUAL — si se exportara sin más,
    en una pantalla angosta (zoom<1) el PNG saldría más chico de lo debido. El
    botón "Insertar" restaura zoom=1 y 1000×700 antes de `toDataURL()` y
    devuelve el zoom visual después. Comprobado: el PNG insertado midió
    1000×700 px sin importar que el lienzo se viera a 591×414 en pantalla.
    **⚠️ Superado por la Fase B**: ya NO se exporta a 1000×700, sino recortado
    al contenido real (`contentBBox()`), y lo que se restaura antes de
    `toDataURL()` es el `viewportTransform` entero, no solo el zoom. Se deja
    escrito por qué existía la regla, no para seguirla.
  - **La casilla "Texto por escribir" del formulario (Fase 3) desapareció.** Ya
    no hace falta escribir el rótulo antes de tocar el lienzo: la herramienta
    Texto ahora crea un `fabric.IText` que entra en edición al instante (texto
    de verdad, editable después). Un texto que queda vacío al perder el foco se
    borra solo (`text:editing:exited`), en vez de dejar una etiqueta fantasma.
  - Verificado en el navegador (no solo leyendo el código): las 7 herramientas
    crean objetos seleccionables/movibles/reescalables; selección múltiple con
    arrastre y agrupar/desagrupar (protegido en flechas); candado desde el
    botón y desde clic derecho; frente/fondo/duplicar/papelera; deshacer/rehacer
    en una secuencia larga (crear → mover → candado → agrupar → duplicar →
    borrar) recupera cada paso exacto en ambos sentidos; los 6 fondos y 7
    colores de fondo se rasterizan con los píxeles exactos esperados; y
    "Seguir editando el dibujo" retoma el JSON guardado con el fondo intacto.
- **Fase B.** Lienzo infinito con mano/zoom, y recorte automático al exportar.

  **Hecha (2026-08-04).** El diálogo ya tenía `max-width:1320px` desde la Fase A (no
  hizo falta agrandarlo más). Lo que sí cambió de raíz es la relación entre el
  elemento `<canvas>` y la "página" de 1000×700:

  - **Antes (Fase A):** el `<canvas>` se dimensionaba SIEMPRE igual a la página
    escalada (`canvas.setZoom(scale)` + `setWidth(DRAW_W*scale)`) — el canvas ERA
    la página, solo que más chica.
  - **Ahora (Fase B):** el `<canvas>` es una VENTANA de tamaño fijo (el alto/ancho
    de `.draw-stage`, ver CSS) que se recorre con pan/zoom real
    (`canvas.viewportTransform`) — la página es un objeto más dentro de ese
    lienzo, no el lienzo mismo. `resizeDrawStage()` solo ajusta el tamaño de la
    ventana (nunca toca el zoom/pan, para no perder la vista del docente al
    redimensionar); `fitToPage()` centra la página con un 6 % de aire y es la que
    se llama, aparte, cada vez que se ABRE el diálogo (nuevo dibujo o retomar uno
    existente) — así el docente siempre empieza viendo la página completa sin
    importar en qué pan/zoom quedó `fcv` (la instancia se reutiliza entre
    aperturas) la última vez.

  **El color de fondo dejó de vivir en `canvas.backgroundColor`.** En la Fase A
  tiñe TODO el canvas visible, lo cual era correcto porque el canvas era
  exactamente la página. Con el lienzo infinito eso teñiría también el vacío de
  alrededor. Ahora el color de relleno (`fillRect` del `drawBgColor`) y un borde
  fino (`#c7bfae`) que marca el límite de la página se hornean DENTRO de la misma
  imagen offscreen que ya rasterizaba el patrón (`applyBackground()`), y viajan
  como `backgroundImage` — así solo cubren la página (0,0)-(1000,700) y se
  desplazan/hacen zoom junto con el contenido, como se espera de una "página dentro
  de un lienzo infinito". `canvas.backgroundColor` pasó a `null`; el vacío
  alrededor de la página lo pinta el CSS de `.draw-stage` (`#ddd6c7`, un gris cálido
  distinto del blanco de la página, para que el borde se note).

  **Herramienta Mano (🖐):** nuevo tool `pan` en `DRAW_TOOLS`, entre Seleccionar y
  Lápiz. Activa `skipTargetFind` (igual que las herramientas de forma: arrastrar
  con la Mano sobre una figura debe mover el LIENZO, no la figura) y usa
  `canvas.relativePan()` sobre los deltas de `getPointer(e, true)` (con
  `ignoreVpt:true`, así se leen en píxeles de pantalla y no en coordenadas ya
  transformadas por el zoom/pan actual). `getPointer` ya resuelve touch vs. ratón
  por dentro, así que la Mano funciona igual con el dedo en una tablet, sin volver
  a la maquinaria de Pointer Events a mano de la Fase 3.

  **Zoom:** rueda del ratón vía el evento `mouse:wheel` de Fabric
  (`canvas.zoomToPoint()`, centrado en el puntero — igual que Figma/Canva, para
  que la vista no "salte"), más tres botones (`−`/`+`/`⤢ Ajustar`) que hacen zoom
  centrado en el medio de la ventana o piden `fitToPage()`. Acotado entre 15 % y
  400 % (`clampZoom()`). El listener de `wheel` que arma Fabric internamente NO es
  pasivo (se comprobó leyendo `vendor/fabric.min.js`: solo `mousemove`/`touchstart`
  llevan `{passive:false}` explícito, pero `wheel` no lleva ninguna opción, y los
  navegadores no la hacen pasiva por defecto salvo para touch) — por eso
  `e.preventDefault()` sí evita que la rueda además desplace la página detrás del
  diálogo.

  **Recorte automático al exportar (`contentBBox()`):** "Insertar" ya no exporta
  siempre la página completa de 1000×700. Calcula la caja que envuelve TODOS los
  objetos reales (`getBoundingRect(true,true)` de cada uno, unidas), le agrega
  28 px de aire alrededor, y si algún lado queda por debajo de 120 px lo infla
  hasta ese mínimo (para que un trazo puntual no exporte una imagen microscópica).
  El recorte usa las opciones `left/top/width/height` de `canvas.toDataURL()` —
  **importante:** esas coordenadas son relativas al `viewportTransform` ACTUAL, no
  al espacio de los objetos, así que antes de exportar hay que resetear la vista a
  identidad (`setViewportTransform([1,0,0,1,0,0])`) y restaurarla después, igual
  que antes se reseteaba el zoom (Fase A) pero ahora también el pan. Esto significa
  que el pan/zoom con el que el docente ESTÁ MIRANDO el lienzo en el momento de
  insertar no afecta en nada al resultado exportado — es intencional: lo que se
  exporta es lo que hay dibujado, no lo que se ve en pantalla.

  Detalles que no eran obvios de antemano:
  - **`getBoundingRect(absolute, calculate)` de Fabric devuelve coordenadas en el
    espacio de `object.left/top`, NO en píxeles de pantalla** — el
    `viewportTransform` se aplica solo al pintar, nunca se hornea en las
    coordenadas de los objetos. Por eso el reseteo a identidad antes de recortar
    es imprescindible: con cualquier otro pan/zoom activo, `left/top/width/height`
    de `toDataURL()` se leerían en el espacio de pantalla equivocado y el recorte
    saldría desplazado.
  - **`canvas.toDataURL()` con `left/top/width/height` NO depende del tamaño en
    píxeles del `<canvas>` en pantalla** — `toCanvasElement()` arma un canvas
    offscreen del tamaño exacto del recorte y renderiza ahí directo
    (`renderCanvas()`, síncrono, sin pasar por la ventana visible). Por eso ya no
    hace falta forzar `setWidth(DRAW_W)`/`setHeight(DRAW_H)` antes de exportar
    como en la Fase A: el tamaño de exportación lo decide el recorte, no el
    tamaño de la ventana.
  - **`canvas.setViewportTransform()`/`relativePan()`/`zoomToPoint()` mutan el
    estado de forma síncrona, pero el REPINTADO en pantalla es asíncrono**
    (`requestRenderAll()` agenda el redibujado con `requestAnimationFrame`, no
    lo hace al instante). Esto costó descubrirlo verificando: comprobar un pan
    leyendo los píxeles del canvas justo después de disparar el evento dio
    siempre "sin cambios", porque el frame nuevo aún no se había pintado; hubo
    que interceptar `relativePan()` (parche temporal de depuración sobre
    `fabric.Canvas.prototype`, revertido después) y leer `viewportTransform`
    directamente para confirmar que el pan sí se aplicaba con los deltas
    correctos. `toDataURL()` en cambio SÍ renderiza síncrono (ver punto
    anterior), así que el recorte de exportación no sufre este problema.
  - **`.draw-stage` pasó de `overflow:auto` a `overflow:hidden` y de fondo blanco
    fijo a un gris cálido (`#ddd6c7`)**, con un alto explícito
    (`height:min(58vh,600px)`, `46vh` en móvil) que antes no hacía falta porque el
    canvas medía exacto lo mismo que la página escalada y el contenedor flex
    heredaba esa altura solo.
  - Verificado en el navegador (no solo leyendo el código, e interceptando
    `relativePan` para confirmar el estado real ya que el panel de vista previa de
    esta sesión no compone fotogramas): el `<canvas>` se dimensiona de forma
    independiente a la página (964×416 de ventana mostrando una página de
    1000×700 al 56 %, no 1000×700 directo); la rueda cambia el zoom (56 %→75 %,
    acotado y con `preventDefault`); los tres botones de zoom (94 %/60 %/`Ajustar`
    → 56 %) calzan con el cálculo esperado; la Mano mueve `viewportTransform[4]/[5]`
    exactamente con el delta arrastrado; en móvil (375×812) el lienzo pasa a
    columna con un alto propio (312×370, ajuste a 29 %); y un rectángulo pequeño
    exportó un PNG de 131×120 px — ni 1000×700 ni el tamaño exacto del trazo,
    sino trazo+28px de aire con el alto clamped al mínimo de 120, tal como se
    calculó a mano.

  #### Revisión de Daniel sobre la Fase B (2026-08-04) — cinco correcciones

  Daniel probó la primera versión de la Fase B y reportó cinco cosas. La primera
  obligó a **rehacer el modelo del lienzo**, no solo a ajustar un número:

  **1. «Al alejar, el lienzo se ve diminuto».** La primera versión entendió
  "lienzo infinito" como *una hoja de 1000×700 flotando en un vacío gris que se
  puede recorrer*. Lo que Daniel quería es lo contrario: **por más que aleje,
  poder seguir dibujando**; el zoom es para acercarse a corregir un detalle y
  luego volver. Con el modelo de "hoja", alejar solo servía para ver la hoja más
  pequeña y rodeada de nada — inútil.

  El arreglo es de fondo: **ya no hay página**. `applyBackground()` dejó de
  rasterizar un PNG de 1000×700 como `backgroundImage`; ahora `renderCanvasBg()`
  pinta el fondo **en cada fotograma** enganchado al evento `before:render` de
  Fabric, sobre la región visible (`canvas.vptCoords`), así que la cuadrícula
  **no se acaba nunca**. Comprobado: desplazándose a la coordenada
  (−22.500, −15.000) y al 40 % de zoom, las cuatro esquinas del lienzo siguen
  teniendo cuadrícula.

  Detalles que hay que respetar aquí:
  - **`before:render` recibe el contexto ya limpio y ANTES de aplicar el
    viewportTransform**, así que dentro hay que aplicar la matriz a mano
    (`ctx.transform(...vt)`) para trabajar en coordenadas de dibujo.
  - **El grosor de las líneas de fondo se mide en píxeles de PANTALLA**
    (`px(z) = 1/zoom`), no en unidades de dibujo. Sin esto, al alejar las líneas
    se juntan hasta volverse una mancha gris y al acercar se convierten en
    barrotes. Además se omite una familia de líneas cuando su separación en
    pantalla bajaría de 5 px (`if(step*z < 5) return`).
  - **Dos familias de fondo, a propósito.** Los **periódicos** (cuadrícula,
    milimetrado, isométrico) se repiten sin fin. El **plano cartesiano** y la
    **recta numérica** siguen siendo figuras ACOTADAS al área de trabajo: tienen
    un origen y una escala concretos, un plano cartesiano "infinito" sin números
    no significaría nada, y sus flechas tendrían que vivir en el borde de la
    ventana moviéndose al desplazarse. Su trazo sí escala con el zoom (son parte
    de la figura, no del papel).
  - `DRAW_W`/`DRAW_H` dejaron de ser "la página" y pasaron a ser **el área de
    trabajo inicial**: lo que se encuadra al abrir y donde se anclan esos dos
    fondos. Como la exportación ya recorta al contenido, sus medidas exactas no
    condicionan el resultado.
  - **El zoom mínimo subió de 15 % a 40 %** (máximo 400 % → 500 %). Alejar sirve
    para ganar sitio donde dibujar, no para ver el dibujo en miniatura, así que
    un mínimo generoso no quita nada y evita llegar a una escala inservible.
  - `fitToPage()` se reemplazó por **`fitToContent()`** («⤢ Ver todo lo
    dibujado», lo único que significa algo en un lienzo sin bordes, y el botón
    de rescate si alguien se desplazó lejos y perdió el dibujo de vista) más
    **`resetView()`** («⌂ Volver al área de trabajo»). La vista inicial es al
    100 % si cabe: se prefiere el trazo a tamaño real antes que un encuadre
    diminuto con tal de que quepa todo.

  **2. «La barra de abajo se pierde».** El diálogo era un documento que crecía
  con su contenido, así que «Insertar», «Deshacer» y «Limpiar» quedaban por
  debajo del borde de la pantalla y había que desplazarse para terminar la tarea
  principal. Ahora es una **ventana de aplicación**: `.draw-dlg` con alto fijo
  (94vh; pantalla completa en móvil) y `.draw-shell` como columna flex de cuatro
  filas — cabecera / barra / lienzo / acciones — donde **solo el lienzo crece**.
  La clave es `flex:1` + **`min-height:0`** en `.draw-workspace`: sin
  `min-height:0` un hijo flex no baja de su tamaño de contenido y volvería a
  empujar la barra de acciones fuera de la ventana.

  De paso, dos controles se sacaron de la barra y **flotan sobre el lienzo**
  (patrón Figma/Canva): el **zoom** (esquina inferior izquierda) y el **panel de
  propiedades** (`.draw-props`, ahora `position:absolute` en vez de una columna
  propia). Esto último arregla algo real: antes el panel ocupaba 190 px de ancho
  y **el lienzo cambiaba de tamaño al seleccionar o deseleccionar**, moviendo lo
  que el docente tenía debajo del dedo o del lápiz.

  **3. «Si inserto una figura y hago otro clic, inserta otra».** Era un error
  fácil de cometer: tras insertar, el clic siguiente —el natural, para mover o
  corregir lo que se acaba de poner— creaba otra figura encima. Ahora las
  herramientas de **insertar** vuelven solas a Seleccionar (`toolDone()`) y
  dejan la figura recién creada ya seleccionada, lista para moverla o cambiarle
  el color. **Excepción deliberada:** `DRAW_STICKY_TOOLS` = `select`, `pan` y
  `pen`, que son **modos continuos** (se dibuja o se desplaza varias veces
  seguidas); volver a Seleccionar en cada trazo del lápiz sería un estorbo.
  Como repetir la misma figura pasa a ser lo más frecuente, el botón de formas
  es **partido**: la cara grande vuelve a armar la última forma de un solo clic.

  **4. «Ya no funciona escribir».** Regresión real de la Fase B, y la causa no
  era donde parecía. **Fabric cuelga de `<body>` el `<textarea>` oculto** con el
  que se escribe dentro del lienzo (`initHiddenTextarea`), y este editor vive en
  un `<dialog>` abierto con `showModal()`, que **deja inerte todo lo que queda
  fuera del diálogo**: el cuadro de edición no podía recibir el foco. Se veía el
  cursor parpadeando pero no entraba ni una letra, y `hiddenTextarea.focus()` a
  mano tampoco hacía nada.

  El arreglo usa el punto de extensión que trae Fabric:
  `fabric.IText.prototype.hiddenTextareaContainer = $('drawTextHost')`, un
  contenedor **dentro** del diálogo. Va en el **prototipo**, no objeto por
  objeto, para que valga también para los textos que Fabric recrea al retomar un
  dibujo con `loadFromJSON`. `#drawTextHost` es `position:fixed`, 0×0 y
  `overflow:hidden`, y **no es ancestro del canvas** a propósito: si el
  navegador intenta desplazarlo para "traerlo a la vista" al enfocar, no puede
  mover el lienzo. Además ahora se llama a `setDrawTool('select')` **antes** de
  `enterEditing()`: editar texto exige el modo normal del lienzo
  (`skipTargetFind:false`, `selection:true`).

  Es la trampa más cara de toda la fase, y aplica a **cualquier** librería de
  canvas que use un input oculto dentro de un `<dialog>` modal.

  **5. Desplegable de formas.** `DRAW_SHAPES` (20 figuras en 4 grupos) sustituye
  a los botones sueltos de rectángulo y elipse, que se movieron dentro. La
  geometría de cada una se define **una sola vez** en `shapeGeom()`, en una caja
  de 100×100, y de ahí salen **dos cosas a la vez**: el objeto Fabric que se
  inserta y el **ícono SVG del catálogo** (`shapeIconSVG()`) — así el botón
  siempre muestra exactamente la figura que va a insertar, sin dibujar los
  íconos aparte. Agregar una forma nueva es agregar su entrada al catálogo y su
  geometría; **no hay que tocar los manejadores del ratón**, porque todas se
  crean igual: nacen con su geometría y se **escalan** al arrastrar.

  Los grupos, elegidos por lo que hace falta en un examen de secundaria:
  *Básicas* (rectángulo, cuadrado, elipse, círculo, triángulo, triángulo
  rectángulo) · *Cuadriláteros y polígonos* (rombo, trapecio, paralelogramo,
  pentágono, hexágono, octágono, estrella) · ***Cuerpos geométricos*** (cubo,
  cilindro, cono, esfera, pirámide — para ejercicios de volumen y área
  superficial; antes había que dibujar un cilindro a pulso con el lápiz) ·
  *Otras* (globo de diálogo, llave `{`).

  Decisiones a respetar:
  - Los cuerpos geométricos son **alambre** (`fabric.Path` con las aristas
    internas como subtrazados sueltos), no figuras rellenas.
  - **`strokeUniform:true` en todas.** Sin él, estirar mucho una figura de un
    solo lado engorda el contorno en esa dirección y el trazo se ve de grosor
    distinto en cada lado. Fabric SÍ lo serializa por defecto, así que no hace
    falta añadirlo a `FABRIC_EXTRA_PROPS` (comprobado en un ida y vuelta por
    JSON).
  - `ratio:true` (cuadrado, círculo, cubo, esfera) fuerza ancho=alto al
    arrastrar: se deforman feo si se estiran de un solo lado.

  Comprobado en el navegador, con el detalle de que **el panel de vista previa
  de esta sesión no compone fotogramas, así que `requestAnimationFrame` nunca
  dispara y `requestRenderAll()` no llega a pintar** — hubo que parchear
  `requestRenderAll` para que renderizara síncrono (y de paso capturar la
  instancia del canvas, que vive en un closure) antes de poder leer píxeles.
  Anotar esto porque invalida cualquier medición de píxeles hecha a la ligera en
  este entorno: las 20 formas se crean con el tipo correcto y vuelven a
  Seleccionar; arrastrar en zona vacía tras insertar ya **no** crea otra figura
  (11 → 11 objetos) y un clic en el botón de formas la vuelve a armar (11 → 12);
  escribir funciona (el textarea queda dentro de `#drawTextHost`, con el foco, y
  teclear llega al objeto); deshacer/rehacer con las formas nuevas devuelve un
  estado **idéntico** tras el ida y vuelta por JSON; los 6 fondos se pintan (el
  cartesiano y la recta numérica acotados, el resto infinitos); el lápiz y la
  mano siguen armados tras usarlos; el PNG exportado sale 100 % opaco con el
  color de fondo elegido (88 % de sus píxeles) y la cuadrícula, y la vista
  (pan/zoom) se restaura intacta tras exportar; el pie con «Insertar» queda
  dentro de la ventana tanto en escritorio (855 px de diálogo en 910 px de
  pantalla) como en móvil; y en móvil la barra pasa a **una sola fila
  deslizable**, con lo que el lienzo pasó de 313 px a 564 px de alto (antes el
  cromo ocupaba más que el propio lienzo).

  #### Dos correcciones más (2026-08-04, misma sesión)

  **La flecha salía descentrada, sobre todo en horizontal.** `fabric.Triangle`
  con `originY:'center'` se posiciona por su **centro**, no por su punta, y el
  código la centraba en el punto donde se soltaba el ratón: la punta sobresalía
  media cabeza más allá de ese punto y **el asta atravesaba la cabeza hasta su
  centro**. En diagonal se disimulaba; en horizontal el desfase quedaba a la
  vista contra la cuadrícula. Ahora se calcula el centro del triángulo
  retrocediendo medio largo de cabeza desde la punta (`x2-ux*hl/2`), y el asta
  termina en la **base** de la cabeza (`hl*0.92`, con un pelo de solape para que
  no aparezca una rendija con el trazo grueso). La cabeza además nunca ocupa más
  del 60 % del largo: con tamaño fijo, una flecha corta quedaba tapada por su
  propia punta. Comprobado midiendo el centroide de tinta columna por columna en
  una flecha horizontal: asta y cabeza comparten centro exacto (201.14 px) de
  punta a punta; solo varía en los últimos 10 px por el antialiasing de la punta
  del triángulo, que es inevitable e invisible.

  **El recorte se comía el plano cartesiano / la recta numérica.** El recorte
  automático se ceñía a `contentBBox()` — solo los objetos dibujados —, así que
  marcar un punto pequeño a la izquierda del plano exportaba ese punto suelto y
  **el plano desaparecía**, que era justo lo que se quería mostrar. La causa de
  fondo es que la Fase B convirtió el fondo en algo puramente decorativo, y eso
  vale para la cuadrícula pero no para estos dos.

  `anchoredBgBBox()` distingue las dos familias que ya existían en el
  renderizador: los fondos **periódicos** (cuadrícula, milimetrado, isométrico)
  devuelven `null` porque son infinitos y no existe un "entero" que encuadrar,
  mientras que el **plano cartesiano** (área de trabajo completa) y la **recta
  numérica** (su extensión real, calculada desde `numLineOverlay()`) devuelven su
  caja, y el encuadre pasa a ser la **unión** de esa caja con lo dibujado.

  Efecto secundario buscado: **con uno de esos dos fondos ya se puede insertar
  sin haber dibujado nada encima** (antes saltaba «el lienzo está vacío»). Un
  plano cartesiano en blanco es una imagen legítima — el estudiante grafica
  encima en el papel.

  Comprobado: plano + un círculo de 35×35 pegado a la izquierda → PNG de
  1118×756 con el plano entero (antes habrían sido ~91×91 y sin plano); recta
  numérica sin nada dibujado → 1004×126; cuadrícula + una marca pequeña →
  120×120, **sin** encuadre extra, o sea que los periódicos no cambiaron; y en
  el PNG del plano el eje horizontal va de x=28 a x=1027, cruzando más del 90 %
  del ancho.
- **Fase C.** **Desviación consciente del pedido original**: el prompt pedía ajustar el
  lienzo "exactamente" a los píxeles originales de la foto cargada. Eso choca con
  `fitImage()` (máx. 1400px, ya documentado arriba: localStorage, memoria, la trampa
  extensión-vs-bytes-reales). La foto de fondo pasa primero por `fitImage()`; el lienzo
  se ajusta a esas medidas ya reducidas, no al original.
  **Pendiente a confirmar con Daniel:** el pedido menciona SVG como formato de fondo
  aceptado. Propuesta: rasterizarlo a PNG al cargarlo (como cualquier otra imagen), para
  que el fondo siga siendo "una sola imagen bloqueada" y no un grupo de objetos
  vectoriales sueltos.
- **Fase D.** La más cara técnicamente: ninguna librería trae conectores anclados
  gratis, hay que construirlos a mano (que la línea siga a la forma si esta se mueve).
- **Fase E.** No estaba en el pedido original, se suma por valor: son solo
  composiciones prearmadas de lo construido en A-D, no código nuevo complejo.
- **Fase F.** Sellos organizados por materia reusando el mismo criterio que
  `ESPECIFICACIONES_AREA` (Fase 9, ver abajo). Insertar fórmula LaTeX como objeto del
  lienzo reutiliza `openFxDlg`/MathLive/`latexToPng()` (Fases 2 y 5) — tampoco estaba en
  el pedido original, pero conecta piezas ya construidas del proyecto en vez de duplicar
  trabajo.
- **Fase G.** Ya hay botones directos de rectángulo/elipse, así que el valor de un
  reconocedor de trazos es dudoso frente al costo de construirlo bien. Se decide al
  final, con el mismo criterio que se usó para descartar Mathpix en su momento — no
  asumir que se hace.

**Interfaz — grupos de la barra de herramientas** (los 5 que pidió Daniel + 2 nuevos
para que quepan las funciones que se sumaron):

`[Selección y Navegación]` (cursor · mano/pan · zoom · deshacer/rehacer · alinear y
distribuir) · `[Dibujo y Pinceles]` (lápiz · resaltador · color · grosor) ·
`[Formas y Conectores]` (línea · flecha · rectángulo · elipse · conectores · caja de
texto) · `[Plantillas]` *(nuevo)* · `[Sellos Didácticos]` · `[Fórmulas]` *(nuevo)* ·
`[Fondos e Imagen]` (subir imagen · recortar · fondos dinámicos · color de fondo).

Además, un **panel de propiedades contextual** a la derecha (aparece solo cuando hay un
objeto seleccionado: color, grosor, relleno, opacidad, candado, duplicar, capas,
papelera) — separado de la barra de "crear", como en Canva/Figma, para no saturar la
barra superior con controles que solo aplican a veces.

### Preguntas calculadas (Fase 4)

Dos subtipos comparten el bloque `#calcBlock` del formulario: `calculated` (respuesta
única) y `calculatedmulti` (opciones). Por eso `applyType()` compara **por elemento y no
por tipo** — si comparara por tipo, el segundo volvería a ocultar el bloque que el
primero acaba de mostrar.

Decisiones que hay que respetar:

- **El docente define rangos, no listas.** Dice «{a} va de 2 a 12, 0 decimales» y los
  valores se sortean solos. Pedirle escribir 10 valores a mano sería inviable.
- **Los valores se sortean al GUARDAR**, no al exportar, y se almacenan en
  `q.calcVars[].values`. Así el XML siempre coincide con lo que el docente vio, y volver
  a exportar no cambia los números de un examen ya repartido.
- `calculated` se emite como **`calculatedsimple`**, que lleva sus datasets dentro de la
  propia pregunta (`status=private`) sin depender de datos compartidos del curso.
- `tolerancetype=1` (tolerancia **relativa**: 0.01 = 1 %) es el único valor comprobado
  contra un Moodle real. No cambiarlo a nominal/geométrica sin volver a probar.
- Las opciones de `calculatedmulti` se envuelven en `{= … }` al exportar, salvo que el
  docente ya las escribiera así (para mezclar texto y fórmula).

**El evaluador de fórmulas (`evalFormula`) es solo para la vista previa.** Quien evalúa
de verdad es Moodle. No usa `eval()` sobre el texto del docente: sustituye variables,
traduce las funciones de una lista blanca a `Math.*`, y **comprueba que lo que queda
sean solo cifras, operadores y paréntesis** antes de evaluar. Si se añaden funciones,
hay que tocar `CALC_FUNCS` **y** la expresión regular de validación.

Trampa encontrada al probar: `substCalc()` **no puede** usar una expresión regular tipo
`/\{=([^}]*)\}/`, porque la fórmula lleva llaves dentro. Con `{={a}*{b}}` cortaba en el
primer `}` y evaluaba `{a`. Hay que contar el anidamiento a mano.

### Fórmulas en las opciones de respuesta

Las opciones de `multichoice` **ya no son `<input type="text">`**: son `contenteditable`
con su propio botón ∑, igual que el enunciado. Por tanto **`opts[].text` es HTML**, no
texto plano. Consecuencias que hay que respetar:

- Al comprobar si una opción está llena hay que usar `htmlHasText()`, no `text.trim()`
  (una fórmula sola no aporta texto propio pero sí es contenido válido).
- En el XML va `serializeMath(o.text)` **sin `esc()`**. Poner `esc()` rompería el HTML.
- `migrateQ()` escapa una sola vez las opciones antiguas y marca `q.optsHtml = true`.
  Sin eso, un «5 < 10» guardado antes se interpretaría como etiqueta y desaparecería.

El **elemento izquierdo del emparejamiento** también las admite (misma razón por la que
admite imagen: Moodle lo renderiza como HTML). `pairs[].q` es HTML y se migra con la
bandera `q.pairsHtml`, igual que `optsHtml`.

**Dónde NO va el botón ∑, y por qué.** Esto no es un olvido; si alguien lo "arregla"
añadiéndolo, romperá la pregunta:

| Campo | Motivo |
|---|---|
| Respuesta de `numerical` | Moodle lo compara como **número** para calificar. Solo cifras. |
| Fórmula de `calculated` | Es una fórmula **del motor de Moodle** (`{a}*{b}`), no LaTeX. |
| Opciones de `calculatedmulti` | Muestran un **número que Moodle calcula**, distinto por estudiante. Además las llaves de LaTeX chocarían con la sintaxis `{= … }`. |
| Respuesta derecha del emparejamiento | Va en un `<select>`; un `<option>` no admite HTML. |
| Respuestas de «respuesta corta» | Se comparan como texto literal. |

Cada uno de esos bloques lleva en la interfaz una nota que lo explica al docente, para
que la ausencia no se lea como un fallo.

El modal de fórmulas es reutilizable: `openFxDlg(target, onDone)` recibe el
`contenteditable` destino y un callback para volcar el resultado al estado.

### Fórmulas en el Word (Fase 5)

Word **no** entiende LaTeX (imprime `\(x^2\)` tal cual) y tampoco sirve pegarle el
HTML de MathLive, porque necesita sus tipografías y esas no viajan dentro del `.doc`.
Lo único que se imprime igual en cualquier equipo es una **imagen**, así que cada
fórmula se convierte antes de escribir el archivo:

```
LaTeX → MathJax (salida SVG, glifos como <path>) → <img> → canvas → PNG base64
```

**Por qué MathJax y no MathLive, que ya estaba cargado:** la salida SVG de MathJax
dibuja las letras con trazos, así que el SVG es autosuficiente y se puede rasterizar.
El HTML de MathLive depende de fuentes externas y saldría con letras sustitutas.

Decisiones que hay que respetar:

- **MathJax se carga solo al exportar, y solo si hay fórmulas** (`ensureMathJax()`).
  Pesa ~1 MB: quien no use matemáticas no paga nada. Por eso el export a Word pasó a
  ser **asíncrono** (`downloadWordBtn` espera y luego llama a `writeWordFile(mapa)`).
- `svg:{fontCache:'local'}` es **obligatorio**. Por defecto MathJax guarda los trazos
  en un `<svg>` compartido de la página; sin `local`, la imagen exportada sale **en
  blanco**.
- Se rasteriza a **4x** y se imprime al tamaño real (`MJ_SCALE`). A 1x sale pixelado
  en papel.
- La `<img>` lleva las medidas **dos veces**: en atributos (px) y en `style` (pt).
  Distintas versiones de Word hacen caso a una o a la otra, y sin ninguna imprimirían
  la imagen a su tamaño real (4x) y se saldría de la hoja.
- El PNG va con **fondo blanco, no transparente**: al imprimir, algunas versiones de
  Word pintan de negro el canal alfa.
- `vertical-align` en pt viene del `vertical-align` en `ex` que trae el SVG, para que
  una fracción no quede flotando sobre la línea.
- **Degrada solo:** si el CDN no responde, cada fórmula vuelve al `\( … \)` literal y
  el archivo se descarga igual, con un aviso. Comprobado simulando la caída del script.

Comprobado midiendo: `\frac{3}{4}+\frac{1}{2}` sale a 35 × 15,1 pt con
`vertical-align:-4,3pt`, el PNG tiene tinta de verdad (8,9 % de píxeles oscuros, no
está en blanco) y en el documento de prueba las 6 fórmulas quedaron como imagen y
**cero** `\(` literales.

### Huecos numéricos en cloze (Fase 5)

Hay **dos clases de hueco** y la diferencia importa para la nota:

| Se escribe | Moodle recibe | Cómo califica |
|---|---|---|
| `[[París\|Paris]]` | `{1:SHORTANSWER:=París~=Paris}` | texto literal |
| `[[#25]]` | `{1:NUMERICAL:=25:0}` | como número: 25, 25,0 y 25.00 valen igual |
| `[[#3,14±0,01]]` | `{1:NUMERICAL:=3.14:0.01}` | número con margen de error |

- El `#` es solo **nuestra** marca amigable; nunca llega al XML.
- Para el margen de error valen `±`, `+-` y `~` (un docente no tiene por qué encontrar
  el `±` en su teclado).
- **La coma decimal se convierte a punto** al compilar: el docente escribe `3,14` pero
  el XML de Moodle espera `3.14`.
- Varias respuestas válidas siguen separándose con `|`, igual que en los de texto.
- **Un hueco `#` con algo que no sea un número BLOQUEA el guardado.** No es un capricho:
  rompería la pregunta al importarla, y eso viola la invariante del proyecto. En la
  vista previa ese hueco sale en rojo y el contador dice cuántos hay mal.
- `gapStats()` es la única fuente de verdad del recuento (total / texto / numéricos /
  mal escritos). `countGaps()` quedó como envoltorio suyo.
- **Trampa:** `gapRe()` devuelve una expresión regular **nueva** en cada llamada. Una
  `/g` compartida guarda `lastIndex` entre usos y se saltaría huecos.

### Formato de examen impreso (Fase 6)

Es para los docentes que **no suben nada a Moodle**: descargan el Word y aplican la
evaluación en papel. Vive en el objeto `exam`, que **no es parte de ninguna pregunta**
—describe la evaluación entera— y **solo lo lee el export a Word**. El XML de Moodle no
cambia en nada. Se abre con el botón «⚙️ Configuración de la plantilla de evaluación»
—va **arriba** del botón de Word a propósito, porque es la configuración que ese botón
va a usar— y se guarda solo.

**El diseño del encabezado sigue al pie de la letra la plantilla de referencia que
Daniel dejó en `/Plantillas/Plantilla cuestionarios docentes.zip`** (un `.dc.html`
exportado de una herramienta de diseño, con su miniatura `.thumbnail`). Ese archivo
**no lo lee la app** — es solo la referencia visual que se usó para construir
`examHeaderHTML()`; si el diseño cambia otra vez, ese zip es el primer sitio donde mirar.
De ahí salen dos decisiones que si no se conocen parecen arbitrarias:

- **La tabla de identificación es SIEMPRE 2 filas × 3 columnas**, igual que la
  plantilla: fila 1 = Estudiante / Grado y curso / Fecha (lo que se llena a mano);
  fila 2 = Docente / Asignatura / Nota (lo que el docente ya sabe, más la casilla de
  nota). Los campos que la app ya conoce (`course`, `teacher`, `subject`) se
  **pre-llenan**; solo quedan en blanco los que de verdad hay que escribir a mano.
- **El campo se llama «Nota», no «Puntaje»** — así lo tenía la plantilla. Esto es
  distinto del `grade` de cada pregunta (el puntaje Moodle de esa pregunta en
  particular): no confundir los dos.

#### Tres correcciones de la primera versión (2026-07-29, tarde)

Daniel comparó el resultado real contra el que quería, con capturas. Los tres defectos
y su causa, para que no se repitan:

| Se veía | Por qué | Arreglo |
|---|---|---|
| Cuadros del encabezado enormes, con mucho aire | Cada dato eran DOS filas: una de etiqueta y otra vacía de `height:26pt` | Un dato = **una celda de una línea** con la etiqueta dentro (`ESTUDIANTE: Carlos`). El encabezado pasó de ~8 cm a **4,0 cm** medidos |
| El escudo pegado al margen izquierdo | La celda del escudo lo alineaba a la izquierda | `align="right"` en esa celda + anchos **28/44/28 %**. Medido: escudo a 2,6 cm del margen, 72 px hasta el texto, texto centrado en la hoja |
| **Las preguntas empezaban en la hoja 2** | La tabla de 2 columnas era **una sola `<tr>`** con todas las preguntas dentro, y Word no parte una fila entre páginas: empujaba el bloque entero | **Una fila por pareja** de preguntas (ver «Preguntas en 1 o 2 columnas») |

El cuadro de instrucciones dejó de ser un `<div>` aparte y es la **última fila de la
misma tabla** (`colspan`): antes el margen entre los dos bloques dejaba un hueco.

#### Tres trampas de Word que salieron de la segunda ronda (mismo día)

Daniel revisó otra vez y aparecieron tres cosas más. Las tres son comportamientos de
Word que **no se ven en el navegador**, así que están medidas y anotadas:

1. **Word ignora el `text-align:center` puesto por clase** (`td.ident{text-align:center}`)
   y sacó los datos del colegio alineados a la izquierda. Lo que sí respeta es el
   **atributo HTML `align="center"`**, y hay que ponerlo en la celda **y en cada
   párrafo**. La regla CSS se dejó igual porque es la que vale al probar en el
   navegador; el atributo es el que manda en Word. No quitar ninguno de los dos.
2. **`padding` en una celda de una tabla `table-layout:fixed` SE SUMA al ancho de la
   columna** en vez de caber dentro. Por eso un `padding-right` en la celda del escudo
   la ensanchaba, dejaba de medir lo mismo que la columna vacía de la derecha y **el
   texto se descentraba** (medido: 16 px fuera del centro de la hoja). La posición del
   escudo se controla **solo con los anchos de columna**, nunca con relleno.
3. **El `margin-bottom` de una tabla no sobrevive si lo que sigue es otra tabla** — el
   caso de 2 columnas. Las preguntas quedaban pegadas al cuadro de instrucciones. La
   solución es un párrafo separador real (`p.headgap`), que Word sí respeta siempre.

**La composición del encabezado está calibrada por medición, no a ojo.** Los anchos
`32/36/32 %` cumplen dos condiciones al mismo tiempo, y si se tocan hay que volver a
comprobar las dos:

- las **columnas laterales iguales** son lo que deja el texto centrado en la HOJA (no
  solo dentro de su celda). Romper la igualdad lo descentra;
- con el escudo **centrado en su columna** queda a media distancia: ~1,7 cm del margen
  y ~2,6 cm del título. Pegado a la izquierda y pegado al título se probaron los dos,
  y Daniel rechazó ambos.

Medido en el resultado: las tres líneas centran en 343 px con el centro de hoja en
344 px, columnas laterales de 220 px cada una, escudo sin deformarse (1,50), 0,65 cm
de aire tras las instrucciones y las preguntas arrancando a 5,0 cm de la hoja 1.

Sin título propio, `examTitleFor()` arma uno con la asignatura («Evaluación de
Matemáticas»), como en la plantilla — no cae directo al nombre del archivo salvo que
tampoco haya asignatura. El **periodo** (que la plantilla no muestra) se imprime como
un subtítulo pequeño bajo el título en vez de forzarlo dentro de la tabla fija de 2×3;
y la **dirección / ciudad / NIT o código DANE** (`exam.address`, nueva) va como
subtítulo bajo el nombre del colegio, exactamente como en la plantilla.

El **escudo** es otro *productor* del mismo objeto imagen que el resto de la app (igual
que el lienzo de la Fase 3): pasa por `readAsImage()` y `makeImage()`. Añade dos cosas:

- `fitCrest()` lo reduce a 420 px como máximo. En el papel mide ~58 pt: guardar 1400 px
  sería malgastar el localStorage (un escudo típico queda en ~10 KB).
- Guarda `w` y `h`. **Word necesita las dos medidas explícitas**: con una sola, algunas
  versiones imprimen la imagen a su tamaño natural y ocuparía media hoja. Con ellas se
  respeta la proporción — comprobado: un escudo de 900×600 sale a 87 × 58 pt (1,50 en
  los dos casos, sin deformarse).

Reglas del `.doc` que hay que respetar (**es HTML con extensión `.doc`, no un `.docx`**):

- **Tablas y medidas en pt, nunca flex ni grid.** Word ignora los segundos.
- **Las opciones van en `<p class="opt">` con sangría, NO en `<ul>`.** Word le pone su
  propia viñeta a las listas aunque se le diga `list-style:none`, y salía «• A) …».
  Este era un defecto real del export anterior.
- `@page WordSection1` fija hoja **Carta** (21,59 × 27,94 cm) y márgenes. Sin `@page`,
  el documento se abre con los márgenes que tenga configurado el equipo del docente.
- La **numeración de páginas** usa `mso-footer` + `mso-field-code:PAGE/NUMPAGES`, que es
  el marcado que Word emite él mismo al guardar como página web. Aun así **el docente
  puede apagarla** desde el diálogo: si su versión de Word no lo entiende, aparecería un
  «Página de» suelto al final. Ese interruptor es la vía de escape, no un adorno.
- Los avisos del diálogo van en `#examMsg` (inline), nunca por toast — ver la sección
  del toast más abajo.

Dos arreglos de calidad de impresión que salieron de esta fase (no estaban pedidos,
pero sin ellos el papel no servía):

- **Una lectura compartida se imprime UNA vez**, no repetida en cada pregunta que la
  usa. Va fuera del `div.question` para que `page-break-inside:avoid` no intente meter
  lectura + pregunta en la misma página.
- **El emparejamiento imprime el banco de respuestas.** En papel no hay lista
  desplegable: sin las opciones a la vista la pregunta era imposible de contestar. Va
  en orden alfabético (el orden de las parejas regalaría la respuesta) y sale igual en
  cada exportación.

### Preguntas en 1 o 2 columnas (Fase 6)

`exam.columns` (`'1'` o `'2'`) se elige con un segmentado en el diálogo. La numeración
de las preguntas es **siempre global** (1, 2, 3…, sin reiniciar por columna): eso lo
garantiza `questionsHTML()` al asignar el número ANTES de decidir en qué columna cae.

**Por qué una tabla estática y no columnas CSS de verdad (`mso-columns-count`):** Word sí
soporta columnas reales, pero solo dentro de un salto de sección «continuo», y la
sintaxis que usa Word para eso en el HTML exportado está pobremente documentada y varía
entre versiones — es fácil que salga como un salto de **página** en vez de continuo, y
metería una página en blanco antes de las preguntas. Una tabla se ve **igual en
cualquier Word**, sin sorpresas.

**Pero tiene que ser UNA FILA POR PAREJA de preguntas, no una fila única.** Este fue un
bug real: con las 20 preguntas dentro de una sola `<tr>`, Word —que no parte una fila
entre páginas— empujaba el bloque completo y **la hoja 1 quedaba con solo el
encabezado**. Con una fila por pareja, las filas son pequeñas y Word las reparte solo.

Consecuencia del diseño, y es la que pidió Daniel: la mitad de las preguntas va a la
izquierda y la otra mitad a la derecha (`halfSplit()` = `Math.ceil(n/2)`), de modo que
la pregunta *i* queda **al lado de la *i*+mitad** — con 20 preguntas, la 1 junto a la
11, la 2 junto a la 12, etc. El precio es que si una pareja es desigual queda aire
debajo de la más corta; se aceptó a cambio de que la paginación funcione.

Reglas de la tabla `table.qcols`:

- **`table-layout:fixed` es obligatorio** en `table.qcols` y en `table.exhead`. Sin
  esto, una tabla en modo automático reparte el ancho según el contenido (una columna
  con una imagen angosta se encoge), no según el 50 %/50 % que se le pide.
- **Una lectura (`passage`) SIEMPRE corta la tabla de columnas** y se imprime a ancho
  completo, nunca dentro de una columna angosta. `questionsHTML()` arma "tandas" de
  preguntas consecutivas entre lectura y lectura, y decide 1 o 2 columnas **tanda por
  tanda**, no para el examen completo.
- **Una sola pregunta en la tanda nunca genera la tabla** (no tendría sentido partir
  una pregunta sola en "2 columnas" con la derecha vacía).
- Si el número de preguntas es impar, la última fila lleva la celda derecha vacía
  (`&nbsp;`): una celda ausente descuadraría los anchos.
- Si el encabezado está apagado (`exam.on=false`), las columnas también se apagan —
  `exam.columns` se ignora. No tendría con qué alinearse.

**Para el checklist de impresión:** con la fila-por-pareja el riesgo de la hoja en
blanco desaparece, pero **todavía no se ha visto en Word** cómo queda una pareja muy
desigual repartida entre dos hojas — agregar ese caso a la revisión cuando Daniel
imprima de verdad (ver el checklist de las fases 5 y 6, más abajo).

El **número de la pregunta va en la misma línea que el enunciado** (`unwrapFirstBlock()`
le quita el `<p>` envolvente del editor). Antes ocupaba un párrafo suelto y se
desperdiciaba media hoja.

### Respaldo JSON: versión 3

El respaldo pasó a `version:3` porque ahora incluye `exam`. `adoptExam()` rellena los
campos que falten, así que **un respaldo v2 se restaura sin problema** (queda con el
encabezado por defecto). Comprobado en los dos sentidos.

### Botón «Novedades» (Fase 7)

Al lado de «Instrucciones de uso», abre `#whatsNewDlg` con el historial de cambios en
lenguaje de docente. Todo el contenido vive en el arreglo `WHATS_NEW` de `js/main.js`
(cerca de `FRACS`/`SA_FRACS`, antes de la sección `Elements`) — **al entregar una
versión nueva, la única edición necesaria es agregar una entrada arriba de ese
arreglo**, con `version`, `date` y `items` (los `items` se insertan como HTML sin
`esc()`, igual que el resto de la guía, así que admiten `<b>` para resaltar).

El botón muestra un punto naranja (`#whatsNewDot` / clase `.new-dot`) cuando la última
versión de `WHATS_NEW[0].version` no coincide con lo guardado en `localStorage` bajo
`praxis_whatsnew_seen` (ver «Rebranding a Praxis Pedagógica» más abajo). Se compara solo
con la **primera** entrada del arreglo (la más
nueva), así que el orden de `WHATS_NEW` importa: siempre más nuevo primero. Al abrir el
diálogo se marca como vista y el punto desaparece; comprobado que persiste entre
recargas (`localStorage`) y que un docente nuevo (sin esa clave) sí ve el punto.

### Buzón de sugerencias (Fase 8)

Botón «✉️ Contáctame» al lado de «Novedades» (el texto del botón e id internos son
`suggestOpenBtn`/`suggestDlg`/etc. — se renombró solo la copia visible, no los ids, para
no generar cambios innecesarios). Se decidió con Daniel entre las opciones
que dejó pendientes el CLAUDE.md: **Web3Forms**, por ser la que mejor calza con el resto
de la app — sin backend propio, sin problemas de CORS (a diferencia de un Apps Script),
con antispam ya integrado, y con un `<dialog>` propio con el estilo de la app en vez de
un widget embebido con marca ajena. Envía por correo, que era lo que Daniel pidió
(evitar WhatsApp).

- `WEB3FORMS_KEY` (en `js/main.js`, junto a `WN_SEEN_KEY`) es la "access key" pública de
  la cuenta de Daniel en Web3Forms. **No es un secreto que haya que ocultar**: el
  servicio está diseñado para que esa clave viva en el navegador — el límite/antispam va
  por clave, igual que el "form ID" de Formspree. Si algún día llega spam, la clave se
  regenera desde el panel de Web3Forms sin tocar código.
- El envío es un `fetch()` JSON directo a `https://api.web3forms.com/submit`, sin
  backend intermedio.
- Campo honeypot (`#suggestHoney`, `name="botcheck"`, oculto y fuera del tabulador): si
  llega lleno, la app **finge éxito y no envía nada** — así un bot no aprende que fue
  detectado, pero tampoco le llega el correo a Daniel.
- El aviso de éxito/error va **inline en `#suggestMsg`**, nunca por toast (misma razón
  que en los demás diálogos: el toast global queda tapado por cualquier `<dialog>`
  abierto — ver la nota grande sobre esto más abajo). Éxito usa la clase `.err-msg.ok`
  (verde, `--correct`); error usa `.err-msg` sola (rojo, `--danger`).
- Si falla el envío (red caída o Web3Forms no responde), **el mensaje escrito NO se
  borra** — solo se limpian los campos tras un envío exitoso. El docente no pierde lo
  que escribió si hay que reintentar.
- Comprobado en vivo: un envío de prueba real llegó con `success:true` desde la API de
  Web3Forms con la clave de Daniel.

### Los tres lanzadores del encabezado (revisión visual 2026-07-29, tarde)

Daniel reportó que «Instrucciones de uso», «Novedades» y «Contáctame» **no se
distinguían del fondo**. La causa: `.btn-ghost` (`background:var(--surface-2)`,
`#f4efe7`) contra el fondo de la página (`--bg`, `#fbf7f1`) es casi el mismo tono — la
diferencia es real pero demasiado sutil para leerse como botón. `.btn-ghost` se usa en
**muchos otros sitios** (los «Cerrar» de cada diálogo, «Vaciar lista», «Gestionar
lecturas»…) y en esos casos sí funciona, porque ahí el botón está sobre una tarjeta
**blanca** (`--surface`), no sobre el fondo crema — mismo problema, contextos distintos.
Por eso **no se tocó `.btn-ghost`**: se creó `.btn-surface` (fondo blanco + borde +
sombra propia) solo para los lanzadores que viven directo sobre `--bg`.

«Novedades» pidió además un color que resaltara. Se usó `.btn-accent-soft`
(`--accent-soft` de fondo, borde en `--accent`) — el mismo tono "quemado" que ya usa
`.ai-note b` y la insignia de versión del propio panel de Novedades (`.wn-ver`), así que
no es un color nuevo en la paleta. **El texto sí queda en `--ink`, no en `--accent-dark`**:
se probó con `--accent-dark` (el par que usan `.ai-note`/`.wn-ver`) y midiendo el
contraste real dio **3.6:1**, por debajo del 4.5:1 que exige AA para texto de 15px — esos
otros usos existentes se salvan por ser insignias pequeñas o texto dentro de un párrafo
más largo, pero un botón de navegación necesita mejor contraste. El color lo sigue
aportando el fondo/borde, no el texto. En hover pasa a fondo `--accent` sólido con texto
blanco, igual que `.btn-primary`. Con esto
la fila queda con tres pesos visuales a propósito: **botón IA** (degradado, el más
fuerte) > **Novedades** (acento, medio) > **Instrucciones / Contáctame** (neutro, el
más discreto) — jerarquía deliberada, no decoración.

`.new-dot` (el punto de "hay algo nuevo") se dejó igual: el anillo blanco de 2px sobre
un fondo ya anaranjado claro (`--accent-soft`) se sigue viendo, porque el punto en sí usa
`--accent` sólido, bastante más saturado que el fondo del botón.

## El toast global no sirve dentro de un `<dialog>` abierto

Hallazgo del 2026-07-29, verificado midiendo coordenadas: cualquier `<dialog>` abierto
con `showModal()` se pinta en la **capa superior** del navegador, por encima de TODO el
documento, sin importar el `z-index` de nada más. El `#toast` vive fuera de los
diálogos, así que con un modal abierto el aviso queda **tapado por el propio cuadro**.

Regla para el futuro: **cualquier confirmación dentro de un diálogo debe vivir dentro
del diálogo** (cambiar el texto/color de un botón, un mensaje inline), nunca depender
del toast global. Ya se corrigió para "Copiar instrucción para la IA" (`aiCopyBtn`
cambia de texto y de color en vez de lanzar un toast). Si se agregan más acciones
dentro de `aiDlg`, `passageDlg`, `fxDlg` o `helpDlg` que necesiten confirmación visual,
aplicar el mismo patrón.

### Fase 9 — Generador con IA: que reconozca LaTeX al importar (pedida y cerrada el 2026-07-29, junto con las fases 7 y 8)

Pedido el 2026-07-29, en una sesión posterior a las fases 6/7/8. Hoy el flujo es:

1. `buildAIPrompt()` arma un texto que le pide a la IA formato Aiken plano (enunciado,
   `A) B) C) D)`, `ANSWER: X`), sin mencionar fórmulas.
2. El docente pega la respuesta y `parseAiken()` la trocea en preguntas.
3. `importAiken()` escapa el enunciado línea a línea con `esc()` y las opciones quedan
   como texto plano — **cualquier LaTeX que la IA hubiera escrito llegaría como código
   crudo**, no como una fórmula dibujada.

**Lo que pidió Daniel** (retomado y construido el 2026-07-29, más tarde ese mismo día):
cuando la asignatura sea de matemáticas, que el prompt le pida a la IA usar LaTeX
(`\( … \)`) para las fórmulas, y que **al importar, la app reconozca esos delimitadores
y los convierta sola** en los mismos bloques `<span class="fx" data-latex="…">` que
genera el editor manual (Fase 2) — tanto en el enunciado como en las opciones.

**Antes de construirlo se verificó, en vivo y no de memoria, si el motor de dibujo
(MathLive, no MathJax — ver más abajo) realmente cubre física y química**, porque
Daniel lo pidió para las 3 materias y no solo para matemáticas. Se probó
`MathLive.convertLatexToMarkup()` directo en la consola con casos reales:

| LaTeX probado | Resultado |
|---|---|
| `\vec{F}=m\vec{a}` (física, vectores) | ✅ perfecto |
| `H_2O`, `Na^+ + Cl^- \rightarrow NaCl` (química, subíndices/superíndices sueltos) | ✅ perfecto |
| `\rightleftharpoons` (flecha de reacción reversible) | ✅ se ve el símbolo ⇌ |
| `\ce{2H2 + O2 -> 2H2O}` (paquete **mhchem**, la forma "correcta" de LaTeX químico) | ❌ **sale garabateado** ("2HX2+OX2…"), sin lanzar ningún error — MathLive no trae ese paquete |

Conclusión: física, sin peros (es notación matemática estándar). Química, **con una
condición real**: hay que pedirle a la IA que NO use `\ce{}` y en cambio escriba
subíndices/superíndices sueltos y flechas normales — porque el fallo de `\ce{}` no
lanza excepción, así que el mecanismo de "degradar con gracia" no lo detecta solo; hay
que evitarlo desde el prompt.

Piezas que ya existían y se reutilizaron tal cual (como estaba previsto):

- `renderLatex(latex)` (la misma del editor y las plantillas del modal ∑) dibuja cada
  fórmula detectada.
- El bloque `<span class="fx" contenteditable="false" data-latex="…">` es el mismo que
  usa todo lo demás (XML, Word, migración, `serializeMath()` de vuelta a `\( … \)`).

Lo que se construyó:

1. **`isMathSubject(s)`** (`js/main.js`, junto a `buildAIPrompt`): compara la asignatura
   (en minúsculas) contra `['matemáticas','física','química']`. `buildAIPrompt()` añade
   un requisito 5 condicional solo si coincide, pidiendo `\( … \)` exclusivamente (nada
   de `$` ni `\[ \]`) y, para química, subíndices/superíndices sueltos en vez de `\ce{}`.
2. **`detectAndRenderLatex(text)`** (junto a `parseAiken`/`importAiken`): recorre el
   texto con `/\\\(([\s\S]+?)\\\)/g`, escapa con `esc()` lo que no es fórmula y arma el
   `span.fx` con `renderLatex()` para lo que sí lo es. Si no hay coincidencias, el
   resultado es exactamente el mismo `esc(text)` de siempre — **degradación garantizada
   por diseño**, no por un `try/catch` que pueda fallar.
3. Enganchada en `importAiken()`: reemplaza el `esc()` plano tanto en el enunciado como
   en cada opción, y el objeto de la pregunta ahora siempre lleva `optsHtml:true`
   (antes no lo llevaba — dependía de que `migrateQ()` lo escapara en la próxima carga;
   con `detectAndRenderLatex` el texto ya sale escapado en el momento, así que
   **también cierra un hueco real**: antes, una opción importada con un `<` o `&` podía
   verse rota en la vista previa de la MISMA sesión, antes de recargar la página).

**Se decidió NO aceptar `$…$` como delimitador de respaldo** (Daniel lo eligió
explícitamente): solo `\( … \)`. Más simple y predecible; si la IA no respeta el
formato pedido, la fórmula queda como texto plano visible y se nota fácil al revisar.
**⚠️ Revertido el 2026-08-05 tras un caso real** — ver «El portapapeles de Gemini
devuelve `$`», justo abajo.

Comprobado de punta a punta en el navegador (no solo leyendo el código):

- Importación con física (`\(t=\sqrt{\frac{2h}{g}}\)`) → el enunciado y las 4 opciones
  quedan con `span.fx` correcto, `optsHtml:true`, y la vista previa (`renderPreview()`)
  y el editor (`#stmt`, cajas de opciones) los dibujan de verdad al editar la pregunta.
- Importación con química (`H_2O`, `\rightarrow`, sin `\ce{}`) → igual de bien.
- Texto con delimitador equivocado (`$x+2=5$`) → **no** genera `span.fx`, queda como
  texto plano escapado, la importación no se rompe.
- `buildAIPrompt()` con asignatura "Física"/"Química" incluye el requisito 5; con
  "Historia" no lo incluye.
- El **XML final de descarga** trae `\(t=\sqrt{\frac{2h}{g}}\)` (lo que Moodle/MathJax
  necesita), sin rastro del HTML de MathLive — `serializeMath()` hizo la conversión de
  vuelta exactamente igual que con una fórmula creada a mano.

#### El portapapeles de Gemini devuelve `$` (2026-08-05)

Daniel generó preguntas de cálculo con Gemini usando el prompt de la Fase 9 y al pegarlas
llegó `$\frac{16}{3}$ metros cuadrados`, con **`$`**, no con `\( … \)`. El importador hizo
exactamente lo que estaba escrito (no hay coincidencias → todo sale escapado), así que el
docente vio LaTeX crudo en la vista previa.

**La causa no está en el prompt: está en el botón de copiar.** Gemini **dibuja** las
fórmulas en su propia interfaz, y al copiar el texto renderizado su serializador emite
`$ … $` sin importar con qué delimitador venía. El docente no puede evitarlo. Por eso el
prompt solo no bastaba, y se hicieron **las dos cosas**:

1. **El prompt pide entregar todo dentro de UN bloque de código** (`deliveryLine` en
   `buildAIPrompt()`, solo para las materias de `MATH_PROMPT_SUBJECTS`), porque ahí el
   texto se copia crudo. Ojo: eso **contradice a propósito** el «no uses bloques de
   código» que sigue vigente para el resto de asignaturas — con fórmulas de por medio el
   bloque deja de ser un estorbo y pasa a ser la única vía fiable. `stripCodeFences()`
   quita las vallas ``` antes de `parseAiken()`; sin eso la primera se pegaría al
   enunciado de la primera pregunta y la última se contaría como «1 bloque ignorado».
2. **`detectAndRenderLatex()` acepta `$ … $` y `$$ … $$` como respaldo**, pero solo si en
   TODO el texto no apareció ni un `\( … \)` (con el delimitador oficial presente, mandan
   esos — mezclar los dos sería adivinar).

**Las guardas del respaldo `$` no son opcionales: en Colombia el dinero se escribe
`$5.000`.** Un enunciado con dos precios («gana $5.000 y pierde $8.000») se leería como
una fórmula que dice « 5.000 y pierde ». `pairLooksLikeMath(inner)` decide par por par:

- con `\comando`, `^` o `_` → es fórmula, seguro;
- una a tres letras solas (`x`, `dx`) → fórmula;
- si hay una palabra de 2+ letras («por unidad», «y luego») → prosa, se descarta;
- cifra con separador de miles + espacios **y sin ningún operador** («5.000 y ») → dinero.
  Con un operador sí pasa, porque `G(x) = 5.000x - 8.000` es una expresión legítima —
  ese matiz salió de probar el caso, no del diseño inicial;
- lo demás: máximo 40 caracteres y solo caracteres de expresión.

**Al descartar un par, el escáner reanuda justo después del `$` de apertura, no del de
cierre.** Es lo que salva el caso mixto «cuesta $5.000 y la función es $f(x)=2x$»: el `$`
que cerraba el par malo es en realidad el que abre el bueno. Con un `RegExp` con `/g` esto
no se puede hacer, por eso es un bucle a mano.

Comprobado en el navegador con el texto real de Gemini (no solo leyendo el código):

- Las 5 fórmulas del enunciado y las 4 de las opciones se convierten en `span.fx`
  dibujados de verdad (MathLive genera glifos, no solo el `data-latex`), y la vista previa
  muestra las 9.
- **El XML de descarga sale con `\(\frac{32}{3}\)` y cero `$`** — la invariante de Moodle
  intacta, igual que con una fórmula escrita a mano.
- Trampa de dinero: «vende a $5.000 la unidad y paga $8.000 de transporte, así que su
  ganancia es $G(x) = 5.000x - 8.000$ y el precio sube de $5.000 a $7.000» → **solo** se
  convierte `G(x) = 5.000x - 8.000`; los cuatro precios quedan como texto literal.
- Una pregunta sin nada de matemáticas y llena de precios (`$12.000`, `$52.000`…) → cero
  conversiones, todo literal.
- Regresión: con `\( … \)` presentes, el respaldo `$` ni se activa (un `$5.000` en el
  mismo enunciado sigue siendo texto), y el escapado sigue bien («5 < 10 & sin fórmula»).
- El prompt de Matemáticas trae el requisito 5 reforzado (`Nunca uses $ … $, $$ … $$`) y
  el bloque de código; el de Historia no trae ninguno de los dos y conserva su «no uses
  bloques de código».

**Confirmado con Gemini el mismo día:** al pedirle «muéstrame tu respuesta anterior
completa dentro de un bloque de código, sin renderizar», devolvió `\(1.000\)`, `\(31\)`,
`\(G(x)\)` — o sea que **el prompt siempre se cumplió** y el único culpable era el botón
de copiar. Ese texto se pegó bien en el generador. Por eso la instrucción del bloque de
código es el arreglo de raíz y el respaldo `$` es la red de seguridad (docente que copia
a mano de la parte dibujada, IA que ignora la instrucción, u otra IA con el mismo
comportamiento al copiar), no al revés.

#### «Otra…»: asignaturas escritas a mano (2026-08-05)

`isMathSubject()` comparaba contra 4 nombres exactos, así que un docente que eligiera
«Otra…» y escribiera *Cálculo*, *Trigonometría*, *Estadística* o *Matemáticas 11* se
quedaba **sin el requisito 5 de LaTeX y sin el bloque de código** — justo donde más
falta hacen. Ahora la resolución es en dos pasos:

1. **Las 16 asignaturas de la lista siguen resolviéndose por nombre EXACTO**, y eso no es
   pereza: **«Educación Física» contiene «física»** y no debe pedir LaTeX. Por eso, si el
   texto es una clave de `ESPECIFICACIONES_AREA`, manda el nombre exacto y se acaba ahí.
2. Solo si **no** es ninguna de las 16 (es decir, vino de «Otra…»), se buscan las palabras
   de `MATH_SUBJECT_HINTS` sin tildes (`matematic`, `calculo`, `algebra`, `trigonometr`,
   `geometr`, `estadistic`, `aritmetic`, `fisica`, `quimica`), con una excepción escrita a
   mano para «educación física / ed. física» tecleada libre.

`noAccents()` usa `new RegExp('[\\u0300-\\u036f]','g')` **a propósito**: con los signos
combinantes escritos de verdad en el archivo, cualquier reguardado en otra codificación
los destrozaría y la función dejaría de quitar tildes **sin lanzar ningún error**.

Comprobado capturando el prompt real de 16 asignaturas: las 4 de siempre lo traen;
Biología, Historia y **Educación Física** (de la lista) no; y escritas a mano, *Cálculo
diferencial*, *Trigonometría*, *Matemáticas 11*, *matematicas* (sin tilde), *Estadística*
y *Geometría analítica* sí, mientras *Educación física y deporte*, *Danzas* y *Filosofía*
no. El enfoque pedagógico de `ESPECIFICACIONES_AREA` sigue saliendo solo con los nombres
exactos, como antes — una asignatura libre recibe LaTeX pero no enfoque, que es lo
correcto: no hay enfoque escrito para ella.

### Enfoque pedagógico por asignatura en el prompt (2026-07-29, más tarde)

Daniel trajo una propuesta de un tercero (otra IA/consultor) para que el prompt del
generador variara según la asignatura elegida — hoy `buildAIPrompt()` da la misma
estructura genérica sin importar la materia. La propuesta traía un diccionario
`ESPECIFICACIONES_AREA` con una instrucción de enfoque pedagógico por cada una de las
16 asignaturas del `<select>`. Antes de implementarla se auditó como haría un consultor
educativo/experto en ICFES **y** se revisó contra el código real:

- **Conflicto real que se corrigió**: la propuesta original mezclaba, dentro del mismo
  diccionario, instrucciones de notación LaTeX para Matemáticas/Física/Química —
  pero permitía `\( … \)` **o** `$$ … $$`. Eso habría contradicho la regla que ya
  construimos y probamos (`mathLine`, más arriba): solo `\( … \)`, sin `$$`, decisión
  que Daniel ya había tomado explícitamente. Se dejó `ESPECIFICACIONES_AREA` con
  **solo el enfoque de contenido** para esas materias (sin mencionar notación) y
  `mathLine` sigue siendo la única fuente de verdad sobre cómo escribir fórmulas.
- **"Ciencias Naturales" se sumó a `MATH_PROMPT_SUBJECTS`** (antes solo tenía
  Matemáticas/Física/Química): el importador (`detectAndRenderLatex`) ya reconoce
  `\( … \)` sin importar la asignatura, así que no había ningún riesgo técnico nuevo en
  extenderlo — decisión de Daniel, confirmada explícitamente.
- **Hallazgo de contenido (Inglés)**: la propuesta original no decía en qué idioma
  escribir la pregunta. Como el resto del prompt está en español, sin esa instrucción
  era muy probable que la IA generara una pregunta *sobre* inglés pero *en español* —
  no serviría como ítem real de comprensión/uso del idioma. Se añadió explícitamente
  "Redacta el estímulo, la pregunta y las opciones DIRECTAMENTE EN INGLÉS".
- Otros ajustes de contenido: Química se amplió más allá de solo estequiometría
  (estructura atómica, tabla periódica, ácido-base); Educación Artística se aclaró para
  que la IA no asuma que hay una imagen adjunta (esta herramienta no genera imágenes,
  solo texto en formato Aiken).
- El resto de las 16 entradas se dejaron esencialmente como llegaron — el enfoque de
  Ciencias Sociales/Ciudadanas/Historia (multiperspectivismo, sin juicios moralizantes,
  causalidad en vez de fechas) ya estaba bien pensado.

Implementación: `ESPECIFICACIONES_AREA` (objeto, claves = texto EXACTO de cada
`<option>` de `#aiSubjectSel`) vive junto a `MATH_PROMPT_SUBJECTS`/`isMathSubject`, antes
de `buildAIPrompt()`. Dentro de `buildAIPrompt()`, `areaLine` busca
`ESPECIFICACIONES_AREA[asig]` (default `''` si no hay coincidencia — una asignatura
libre por "Otra…" simplemente no agrega nada, sin romper) y se concatena **justo antes**
de "Requisitos estrictos para cada pregunta", como pidió Daniel. No toca
`parseAiken`/`importAiken`/`detectAndRenderLatex`/XML — es un cambio aislado a qué le
pedimos a la IA, cero riesgo para la invariante de Moodle.

Comprobado en el navegador (capturando el texto real que arma `aiCopyBtn`, no solo
leyendo el código): Matemáticas/Física/Química/Ciencias Naturales traen el enfoque **y**
el requisito 5 de LaTeX (sin duplicarse ni contradecirse); Biología/Inglés/Historia
traen el enfoque **sin** el requisito de LaTeX; una asignatura inventada no agrega nada.
El prompt completo de Química se revisó línea por línea: el párrafo de enfoque queda
entre las competencias y los "Requisitos estrictos", sin saltos de línea rotos.

### Migración de datos guardados

Las preguntas numéricas anteriores a la Fase 1 traen `{numAns, numTol}`. La función
`migrateQ()` las convierte a `{numAnswers:[…], numUnitsOn, numUnits}` al cargar de
localStorage **y** al restaurar un respaldo JSON. Si algún día cambia otra vez el
formato de un tipo, ese es el sitio donde engancharlo.

### Verificado importando en un Moodle real (2026-07)

No son suposiciones: se importó un XML de sonda y se revisó la vista previa.

- ✅ **MathJax está activo y renderiza `\( … \)` y `\[ … \]`**, tanto en el enunciado
  como en **las opciones de respuesta**. El LaTeX es una vía válida.
- ✅ **`calculatedsimple` funciona**: los `<dataset_definitions>` importan bien y los
  comodines `{a}`, `{b}` se sustituyen por valores reales. El XML que se documenta más
  abajo es el que se validó.
- ✅ Cloze con huecos `{1:NUMERICAL:=5:0.01}` importa y puntúa por hueco.
- ✅ **Numérica: el crédito parcial y las unidades CALIFICAN bien.** Responder `3.1` a
  una respuesta de 50 % da 0.50 sobre 1.00. Y con `<units>` + multiplicador, responder
  `18 km/h` a una pregunta cuya respuesta es `5 m/s` se acepta como correcta.
- ✅ **Datasets con decimales** (`<decimals>1</decimals>`) funcionan.
- ⚠️ **`calculatedmulti`: las opciones NO se evalúan solas.** Con `<text>{a}+{b}</text>`
  el estudiante ve literalmente «15+11». **Hay que envolverlas en `{= … }`**:
  `<text>{={a}+{b}}</text>` sí muestra el número. Comprobado. Se puede mezclar texto y
  fórmula en la misma opción («El resultado es {={a}*{b}} unidades»). La calificación va
  por el atributo `fraction`, no por la fórmula.
- La sintaxis `{= … }` también evalúa dentro de `<generalfeedback>`: sirve para
  mostrarle al estudiante la solución desarrollada con sus propios números.

### Checklist de impresión real (Fases 5 y 6 — código cerrado, pendiente de uso)

Las fases 5 y 6 están cerradas en cuanto a código: todo lo de abajo se verificó **en el
navegador**, midiendo, y no hay nada más que construir. Esta lista queda como
**checklist de referencia** para la primera vez que Daniel abra el `.doc` en Word de
verdad e imprima — son cosas que un navegador no puede confirmar por sí solo, no tareas
de desarrollo pendientes:

1. **Abrir el `.doc` en Word e IMPRIMIRLO.** Puntos a mirar, en orden de riesgo:
   la numeración del pie (si sale un «Página de» suelto, el interruptor del diálogo la
   apaga); los márgenes de `@page`; que las imágenes de fórmula queden a la altura del
   texto y no gigantes; el escudo sin deformarse; y que ninguna pregunta se corte entre
   dos páginas. **Añadido el 2026-07-29 tarde (rediseño con la plantilla de
   referencia):** con **2 columnas** y 20 preguntas, comprobar que las preguntas
   arrancan en la **hoja 1** (era el bug de la fila única) y que las parejas 1↔11,
   2↔12… se ven alineadas; y que las celdas del encabezado quedan compactas, de una
   línea, como en la captura que envió Daniel.
2. **Importar en Moodle un cloze con huecos `#`.** El XML que se genera es
   `{1:NUMERICAL:=25:0}` y `{1:NUMERICAL:=3.14:0.01}`. La forma con tolerancia ya estaba
   confirmada arriba; lo que **no** se ha probado en un Moodle real es la **tolerancia 0**
   (`:0`), que es lo que sale cuando el docente no pide margen de error. Si Moodle se
   quejara, la alternativa es omitir el `:0` (Moodle asume 0 si no está).

**Requisito de diseño que salió de estas pruebas:** `correctanswerlength` controla
cuántos decimales se muestran. Con el valor 2, una suma de enteros sale como «5.00»,
que queda absurdo. El formulario de la Fase 4 **debe dejar que el docente elija los
decimales** (0 para enteros, 2 para dinero o física).

Cuidado con generalizar: que MathJax esté activo en el Moodle de Daniel no significa
que lo esté en el de otra institución. El plan B universal es una imagen, y el lienzo
de la Fase 3 lo permite a mano (el docente dibuja la expresión).

Desde la Fase 5 **ya existe el código que convierte una fórmula de MathLive en imagen**
(`latexToPng()`), pero solo se usa para el Word. Si algún día hace falta también para el
XML —un Moodle sin MathJax—, esa función es la pieza que hay que reutilizar; el sitio
donde engancharla sería `buildStatement()`, y habría que emitir además el `<file>`
hermano de cada imagen, como ya se hace con las demás.

### Sobre el LaTeX y MathJax

- Hasta la Fase 2, **ni la vista previa ni el export a Word renderizan LaTeX**: se ve
  el código crudo. Desde la Fase 5 el Word **sí** lo dibuja (como imagen).
- Decisión tomada: **se acepta depender de librerías externas** (MathLive por CDN). El
  proyecto ya no promete funcionar sin conexión.

## Probar cambios

`index.html` se puede abrir directo en el navegador. Para trabajar es más cómodo
servirlo por HTTP: `.claude/launch.json` levanta `python -m http.server 8777`.

**El navegador cachea `main.js` y `style.css` con fuerza**: si un cambio "no aparece",
casi siempre es caché. **Ctrl+R no basta** — hay que hacer **Ctrl+F5** o añadir `?v=N`
a la URL.

**Desde la Fase 10-B los dos recursos se enlazan con `?v=` en `index.html`**
(`css/style.css?v=10b`, `js/main.js?v=10b`) y **hay que subir ese número al publicar
un cambio en `css/` o `js/`**. No es cosmético: el HTML y el JS dejaron de ser
independientes (el marcado nuevo del editor de dibujo espera funciones nuevas), así
que un navegador que sirva una mitad vieja y otra nueva deja el editor roto — no
degradado, roto. Pasó de verdad al probar la fase: `index.html` llegaba nuevo y
`main.js` cacheado, y el botón de formas salía vacío y las herramientas sin conectar.
Un docente con la versión anterior abierta habría visto exactamente eso.

Al probar con herramientas automatizadas, ojo: el panel de vista previa integrado puede
renderizar `file://` como captura estática **sin ejecutar JavaScript**, y eso parece un
bug del código cuando no lo es. Ante cualquier duda, servir por HTTP y forzar recarga.

## Preferencias de trabajo

- **Confirmar antes de actuar**, sobre todo en cualquier cosa que toque git o GitHub.
- **Nunca hacer push sin aprobación explícita**: la rama `main` se publica automáticamente
  en GitHub Pages, así que un push cambia el sitio en vivo.
- Verificar los cambios de interfaz en el navegador antes de darlos por hechos.
