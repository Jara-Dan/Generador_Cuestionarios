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

## Estado de matemáticas (pendiente de trabajo grande)

Hoy el soporte matemático es **una sola línea** en `js/main.js` (`rtCmd`, caso `'math'`):
el botón ∑ inserta el texto literal `\(  \)` en el enunciado. Nada más.

Implicaciones a tener en cuenta antes de rediseñarlo:

- `\( … \)` es la sintaxis del filtro **MathJax/TeX de Moodle**. Solo se renderiza si
  ese filtro está activado en el Moodle destino — conviene no asumir que lo está.
- **La vista previa NO renderiza LaTeX**: el docente ve `\( x^2 \)` en crudo.
- **La exportación a Word tampoco lo renderiza**: saldría el LaTeX literal en el `.doc`.
- Renderizar fórmulas requeriría KaTeX/MathJax, y hoy el proyecto **no tiene ninguna
  dependencia JS**. Si se agrega, habría que empaquetarla localmente para no romper el
  funcionamiento sin conexión.
- Moodle tiene además tipos de pregunta numéricos/calculados que hoy no se aprovechan.

## Probar cambios

Se abre `index.html` directamente en el navegador (no hace falta servidor). **El
navegador cachea `main.js` y `style.css` con fuerza**: si un cambio "no aparece", casi
siempre es caché — recargar con Ctrl+F5.

## Preferencias de trabajo

- **Confirmar antes de actuar**, sobre todo en cualquier cosa que toque git o GitHub.
- **Nunca hacer push sin aprobación explícita**: la rama `main` se publica automáticamente
  en GitHub Pages, así que un push cambia el sitio en vivo.
- Verificar los cambios de interfaz en el navegador antes de darlos por hechos.
