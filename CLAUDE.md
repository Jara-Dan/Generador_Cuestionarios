# Generador de Cuestionarios · Trendi

Herramienta web para que docentes creen preguntas y las exporten como **XML del banco
de preguntas de Moodle**. También genera un prompt tipo ICFES para crear preguntas con
IA, importa respuestas en formato Aiken, y exporta la evaluación a Word.

## Invariante principal (no negociable)

**Todo lo que se genere tiene que poder importarse en Moodle como XML sin errores.**
Antes de agregar cualquier funcionalidad nueva hay que verificar que el tipo de pregunta
de Moodle la soporte de verdad — no basta con que se vea bien en la interfaz.

## Arquitectura

- **Sin dependencias ni build.** HTML + CSS + JS puro. Toda la lógica vive en
  `js/main.js` (~1000 líneas, un solo IIFE). El único recurso externo es Google Fonts (CSS).
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
| Export Word | HTML con estilo `.doc` |

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
  (localStorage son ~5 MB en total y las imágenes lo llenan rápido).
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
| 3 | Lienzo de dibujo y cámara → imagen (sin OCR) | Pendiente |
| 4 | `calculated` / `calculatedmulti` con datasets | **Hecho y confirmado en Moodle** |
| 5 | Fórmulas en el export a Word y huecos `NUMERICAL` en cloze | Pendiente |
| 6 | **Formato de examen impreso** en el Word (escudo + encabezado editable) | Pendiente |
| 7 | Botón **«Novedades»** con los cambios de cada versión | Pendiente |
| 8 | **Buzón de sugerencias** para que los docentes escriban a Daniel | Pendiente |
| 9 | **Generador con IA: LaTeX → fórmula visual** al importar | Pendiente |

Las fases 6, 7 y 8 las pidió Daniel el 2026-07-29; el detalle está más abajo. La fase 9
se agregó el mismo día en una sesión posterior.

**Fases 5 y 6 van juntas en una sola sesión de trabajo:** las dos tocan el mismo export
a Word (una le agrega fórmulas, la otra el encabezado/escudo). Separarlas obligaría a
tocar la misma función `exportWordBtn` dos veces y a probar la impresión dos veces.
Abordarlas en la misma sesión, no en sesiones distintas.

### Cómo se guarda una fórmula (Fase 2)

Dentro del enunciado (un `contenteditable`) la fórmula **no** es texto LaTeX crudo, sino
un bloque atómico:

```html
<span class="fx" contenteditable="false" data-latex="\frac{a}{b}">…dibujo de MathLive…</span>
```

- El docente ve la fórmula **dibujada** mientras escribe y no puede romperla por dentro.
- El LaTeX original viaja en `data-latex`.
- **`serializeMath()` es obligatorio** antes de mandar el enunciado a cualquier salida:
  convierte cada bloque a `\( … \)`. Ya está enganchado en `buildStatement()` (XML),
  el export a Word y `renderTray()`. **Si se añade una salida nueva, hay que llamarlo
  ahí también**, o el markup de MathLive se colará en el archivo.

Detalles de MathLive que costaron descubrir:

- `<math-field>` emite `input` al teclear, pero **no** cuando se le inserta contenido
  por código (`executeCommand`/`insert`). Por eso la caja de LaTeX se refresca también
  al desplegar el `<details>`.
- El evento `toggle` de `<details>` es **asíncrono**: al probarlo hay que esperar un
  tick antes de leer el resultado.
- `\placeholder{}` **no existe en MathJax**. Si queda alguno sin llenar, Moodle mostraría
  un error, así que la inserción se bloquea. Para un hueco intencional está la plantilla
  «Espacio en blanco», que usa `\underline{\hspace{…}}` (TeX base, sin depender de AMS).

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

## Fases pendientes: qué pidió Daniel exactamente

Anotado el 2026-07-29 para que no se pierda entre sesiones. Nada de esto está empezado.

### Fase 6 — Formato de examen impreso en el Word

Hay docentes que **no suben nada a Moodle**: descargan el Word y aplican la evaluación
en papel. Hoy el `.doc` es funcional pero sin identidad. Lo que pidió:

- Un **espacio arriba para el escudo institucional** (subir imagen, igual que las
  imágenes de pregunta: base64, límite de 1 MB).
- Un **encabezado genérico de evaluación editable**: nombre del colegio, asignatura,
  docente, periodo, espacio para nombre del estudiante y fecha, etc.
- Que quede «un formatico chévere», o sea presentable para imprimir tal cual.

Ojo al implementarlo: el export actual es **HTML con extensión `.doc`**, no un `.docx`
real. Los encabezados repetidos en cada página y los márgenes de Word se controlan con
CSS propietario de Word (`@page`, `mso-*`), que no siempre se comporta. Conviene probar
imprimiendo de verdad, no solo abriendo el archivo. Va junto con la Fase 5, que también
toca el Word (fórmulas como imagen).

### Fase 7 — Botón «Novedades»

Al lado del botón de **«Instrucciones de uso»**, un botón que abra un diálogo con los
cambios de cada versión, en lenguaje de docente y no de programador («ahora puedes poner
fracciones en las respuestas», no «se refactorizó `renderOpts`»). Al entregar una versión
nueva hay que acordarse de añadir su entrada.

### Fase 8 — Buzón de sugerencias

Para que los docentes le escriban a Daniel. **Él prefiere evitar WhatsApp**; querría algo
por correo. Hay que decidir con él cuando se aborde; el problema de fondo es que la app
es 100 % estática en GitHub Pages, **sin backend**, así que no puede enviar correo por sí
misma. Opciones reales:

| Opción | A favor | En contra |
|---|---|---|
| Enlace `mailto:` | Cero infraestructura | Necesita cliente de correo configurado; el correo queda expuesto a rastreadores de spam |
| **Formspree / Formspark** | Formulario dentro de la app, llega al correo, plan gratuito | Depende de un tercero; el endpoint es público (traen antispam) |
| **Formulario de Google** | Gratis, robusto, respuestas en una hoja de cálculo | Saca al docente de la app; estética distinta |

Recomendación de partida: **Formspree** si se quiere que se sienta parte de la app, o
**Formulario de Google** si se prefiere cero mantenimiento. En cualquier caso, **no se
puede ocultar una clave de API en un sitio estático** — hay que elegir un servicio cuyo
endpoint sea público por diseño. Decidirlo con Daniel antes de programar nada.

### Fase 9 — Generador con IA: que reconozca LaTeX al importar

Pedido el 2026-07-29, en una sesión posterior a las fases 6/7/8. Hoy el flujo es:

1. `buildAIPrompt()` arma un texto que le pide a la IA formato Aiken plano (enunciado,
   `A) B) C) D)`, `ANSWER: X`), sin mencionar fórmulas.
2. El docente pega la respuesta y `parseAiken()` la trocea en preguntas.
3. `importAiken()` escapa el enunciado línea a línea con `esc()` y las opciones quedan
   como texto plano — **cualquier LaTeX que la IA hubiera escrito llegaría como código
   crudo**, no como una fórmula dibujada.

Lo que pidió Daniel: cuando la pregunta sea de matemáticas, que el prompt le pida a la
IA usar LaTeX (`\( … \)`) para las fórmulas, y que **al importar, la app reconozca esos
delimitadores y los convierta sola** en los mismos bloques `<span class="fx"
data-latex="…">` que genera el editor manual (Fase 2) — tanto en el enunciado como en
las opciones.

Piezas que ya existen y se pueden reutilizar directamente:

- `renderLatex(latex)` ya convierte un LaTeX a HTML dibujado (la usa el editor y las
  plantillas del modal ∑). Es la misma función que hay que llamar aquí.
- El bloque `<span class="fx" contenteditable="false" data-latex="…">` es el formato
  ya soportado en toda la cadena (XML, Word, migración). No hay que inventar nada nuevo,
  solo generarlo desde texto importado en vez de desde el modal.

Lo que falta construir:

1. En `buildAIPrompt()`: cuando el tema/asignatura sea matemáticas (o un toggle
   explícito «Esta evaluación es de matemáticas»), añadir una instrucción pidiendo que
   toda fórmula vaya envuelta en `\( … \)`.
2. Una función tipo `detectAndRenderLatex(text)` que recorra el texto plano buscando
   `\( … \)` (y quizá `\[ … \]`), escape con `esc()` los tramos que NO son fórmula, y
   para los que sí lo son arme el `span.fx` con `renderLatex()` — igual a como
   `serializeMath()` hace el camino inverso.
3. Enganchar esa función en `importAiken()`: al construir `stmtHtml` y al limpiar
   `cleanOpts`, en vez de `esc()` puro. Si se detecta al menos una fórmula en las
   opciones de una pregunta, hay que marcar `optsHtml:true` en el objeto guardado (ver
   la sección "Fórmulas en las opciones de respuesta" más arriba) para que no se
   vuelva a escapar en la próxima migración.

Riesgo a vigilar: distintas IA no siempre respetan el delimitador pedido (a veces usan
`$…$`, o Markdown con negritas alrededor). El prompt debe ser insistente y explícito, y
`detectAndRenderLatex` debe degradar con gracia (dejar el texto tal cual, escapado) si
no encuentra el patrón exacto — nunca debe romper una importación por una fórmula mal
delimitada.

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

**Requisito de diseño que salió de estas pruebas:** `correctanswerlength` controla
cuántos decimales se muestran. Con el valor 2, una suma de enteros sale como «5.00»,
que queda absurdo. El formulario de la Fase 4 **debe dejar que el docente elija los
decimales** (0 para enteros, 2 para dinero o física).

Cuidado con generalizar: que MathJax esté activo en el Moodle de Daniel no significa
que lo esté en el de otra institución. Por eso la Fase 3 (fórmula como imagen) sigue
siendo el plan B universal.

### Sobre el LaTeX y MathJax

- Hasta la Fase 2, **ni la vista previa ni el export a Word renderizan LaTeX**: se ve
  el código crudo.
- Decisión tomada: **se acepta depender de librerías externas** (MathLive por CDN). El
  proyecto ya no promete funcionar sin conexión.

## Probar cambios

`index.html` se puede abrir directo en el navegador. Para trabajar es más cómodo
servirlo por HTTP: `.claude/launch.json` levanta `python -m http.server 8777`.

**El navegador cachea `main.js` y `style.css` con fuerza**: si un cambio "no aparece",
casi siempre es caché. **Ctrl+R no basta** — hay que hacer **Ctrl+F5** o añadir `?v=N`
a la URL.

Al probar con herramientas automatizadas, ojo: el panel de vista previa integrado puede
renderizar `file://` como captura estática **sin ejecutar JavaScript**, y eso parece un
bug del código cuando no lo es. Ante cualquier duda, servir por HTTP y forzar recarga.

## Preferencias de trabajo

- **Confirmar antes de actuar**, sobre todo en cualquier cosa que toque git o GitHub.
- **Nunca hacer push sin aprobación explícita**: la rama `main` se publica automáticamente
  en GitHub Pages, así que un push cambia el sitio en vivo.
- Verificar los cambios de interfaz en el navegador antes de darlos por hechos.
