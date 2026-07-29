# Generador de Cuestionarios · Trendi

Herramienta web para que docentes creen preguntas de evaluación y las exporten
como un archivo **XML compatible con Moodle**, sin instalar nada.

\---

## 📌 Descripción del proyecto

Es una **aplicación de una sola página** (SPA sencilla) que corre 100 % en el
navegador. No tiene servidor, base de datos ni backend: todo el trabajo ocurre
en el equipo del usuario y se guarda automáticamente en el propio navegador
(`localStorage`).

Permite:

* Crear preguntas de **7 tipos**: opción múltiple, verdadero/falso, respuesta
corta, numérica, emparejamiento, completar espacios en blanco (*cloze*) y
ensayo.
* Añadir a cada pregunta: **imagen**, **etiquetas** (objetivo, competencia,
dificultad, nivel de Bloom) y una **lectura/estímulo compartido** (ideal para
comprensión lectora).
* Ver una **vista previa en vivo** mientras se edita.
* **Exportar a Moodle XML** en un clic, listo para subir al banco de preguntas.
* **Generar preguntas con IA**: arma un *prompt* tipo ICFES (modelo basado en
evidencias) que se pega en ChatGPT, Claude o Gemini, y luego **importa** la
respuesta de la IA en formato Aiken.
* **Respaldar y restaurar** todo el trabajo como archivo JSON.

\---

## 🛠️ Tecnologías utilizadas

|Tecnología|Uso|
|-|-|
|**HTML5**|Estructura de la página (`index.html`). Usa elementos modernos como `<dialog>` para los modales.|
|**CSS3**|Estilos a mano en `css/style.css`. Usa *CSS Custom Properties* (variables), CSS Grid y Flexbox. Sin frameworks.|
|**JavaScript (ES5+/Vanilla)**|Toda la lógica en `js/main.js`. Sin librerías ni dependencias (no jQuery, no React).|
|**Google Fonts**|Tipografía *Hanken Grotesk*, cargada desde CDN. Degrada a la fuente del sistema si no hay internet.|
|**localStorage API**|Persistencia automática del trabajo en el navegador.|
|**Web APIs nativas**|`FileReader` (imágenes/respaldo), `Blob`/`URL.createObjectURL` (descargas), `Clipboard` (copiar el prompt).|

> \\\*\\\*Sin paso de compilación.\\\*\\\* No hay Node, npm, bundler ni transpilador. Lo que
> ves es lo que se ejecuta.

\---

## 🚀 Cómo ejecutarlo

**Opción rápida (la más común):**

> Abre el archivo \\\*\\\*`index.html`\\\*\\\* en cualquier navegador moderno
> (Chrome, Edge, Firefox o Safari). Doble clic basta.

**Opción recomendada para uso real (servidor local):**

Abrir directamente con `file://` funciona, pero algunos navegadores tratan los
archivos locales de forma especial y el guardado automático (`localStorage`)
puede comportarse de manera inconsistente. Para evitarlo, sirve la carpeta por
HTTP local con cualquiera de estos comandos (desde la carpeta del proyecto):

```bash
# Si tienes Python instalado:
python -m http.server 8000

# O si tienes Node.js:
npx serve
```

Luego abre `http://localhost:8000` en el navegador. Esto también habilita el
copiado al portapapeles en todos los navegadores (la API de portapapeles exige
un "contexto seguro": `https://` o `localhost`).

**Para entregar / publicar:** sube la carpeta tal cual a cualquier hosting
estático (Netlify, GitHub Pages, Vercel, static.app, etc.). No requiere
configuración de servidor.

\---

## 📁 Estructura del proyecto

```
generador-cuestionarios-trendi/
├── index.html          # Esqueleto HTML de la página (solo marcado).
├── css/
│   └── style.css       # Todos los estilos. Empieza por :root con las variables de tema.
├── js/
│   └── main.js         # Toda la lógica de la app (un único módulo IIFE comentado).
├── assets/
│   └── favicon.svg     # Ícono de la pestaña. Aquí van futuras imágenes/logos.
└── README.md           # Este archivo.
```

|Carpeta / archivo|Qué contiene|
|-|-|
|`index.html`|La estructura visible. Enlaza el CSS en el `<head>` y el JS al final del `<body>`.|
|`css/style.css`|Diseño y tema. **Para cambiar la marca/color, edita las variables en `:root`** (parte superior).|
|`js/main.js`|El "cerebro": estado, validaciones, vista previa, exportación a Moodle XML e integración con IA.|
|`assets/`|Recursos estáticos. Hoy solo el favicon; es el lugar para añadir un logo u otras imágenes.|

\---

## 📥 Cómo usar el resultado en Moodle

1. En la app, crea tus preguntas y pulsa **⤓ Descargar XML para Moodle**.
2. En tu curso de Moodle: **Banco de preguntas → Importar**.
3. Elige el formato **"Moodle XML"** y sube el archivo descargado.
4. Crea un **Cuestionario** y agrega las preguntas desde el banco.

\---

## 💾 Persistencia y respaldos

* El trabajo se guarda **solo en el navegador donde se usa** (no en la nube).
* El botón **Guardar respaldo (JSON)** descarga una copia para llevarla a otro
equipo o conservarla; **Restaurar respaldo** la recupera.
* El **XML** es para Moodle; el **JSON** es para seguir editando dentro de la
herramienta.

\---

## 🧭 Notas para quien mantenga el código

Lee esto antes de modificar `js/main.js`:

* **No reordenes el contenido del IIFE.** Todo el JS está envuelto en
`(function(){ ... })();`. Varias funciones se usan *antes* de la línea donde
se declaran y dependen del *hoisting* de JavaScript. Mover bloques puede
romper la app silenciosamente.
* **Las fracciones de Moodle son fijas** (objeto `FRACS`). Moodle solo acepta un
conjunto cerrado de porcentajes de crédito; si inventas valores, rechaza la
importación. No los "redondees a mano".
* **Imágenes en el XML:** se incrustan en base64 y se referencian con la ruta
mágica `@@PLUGINFILE@@/...` que Moodle reconoce. Ver `buildStatement()` y
`fileTag()`.
* **El tipo *cloze* no usa `commonXML()`** a propósito: su esquema en Moodle es
distinto. Está armado a mano en `questionXML()`.
* **El editor de texto enriquecido usa `document.execCommand`**, que está marcado
como obsoleto pero sigue funcionando en todos los navegadores actuales. Si en
el futuro deja de funcionar, ese es el primer lugar a revisar (sección
*Rich text*).
* **Copiar al portapapeles** requiere `https://` o `localhost`. Para `file://`
existe un respaldo con `execCommand('copy')` (función `legacyCopy`).
* **Límite de `localStorage` (\~5 MB):** las imágenes pesadas lo llenan rápido.
La función `save()` detecta el error y avisa al usuario; mantén ese aviso.
* **Importación con IA:** la salida de la IA se interpreta con un parser de
formato **Aiken** tolerante (`parseAiken`). Si una IA cambia su formato de
salida, ajusta ahí las expresiones regulares.

### Cambios respecto al archivo original de una sola página

Este proyecto se generó separando el `.html` monolítico original en archivos
independientes. **La lógica no se modificó** (se verificó que el código es
idéntico carácter por carácter, comentarios aparte); solo se hizo lo siguiente:

* Se extrajeron el CSS y el JS a `css/style.css` y `js/main.js`.
* Se añadieron comentarios explicativos.
* Se extrajo el favicon a `assets/favicon.svg`.
* **Se eliminaron dos `<script>` externos de `static.app`** que el hosting
inyectaba automáticamente (`static-forms.js` y `static.js`). No forman parte
de la herramienta y no son necesarios para que funcione. Si vuelves a
publicar en static.app, esa plataforma los reinyecta sola.

\---

## ⚠️ Limitaciones conocidas

* **Sin nube ni cuentas:** los datos viven en un solo navegador. Antes de
limpiar el historial o cambiar de equipo, hay que guardar un respaldo JSON.
* **La IA no es infalible:** puede marcar mal la respuesta correcta o proponer
distractores flojos. Siempre hay que **revisar** las preguntas importadas
antes de usarlas con estudiantes.
* **Importación de IA limitada a opción múltiple** (formato Aiken). Los demás
tipos se crean manualmente.
* **Requiere JavaScript activado** (la página muestra un aviso si no lo está).

\---

## 👏 Créditos

Herramienta Desarrollada por Daniel Felipe Jara para la empresa **Trendi · Trends \& Innovation** para apoyo pedagógico y creación de bancos de preguntas para Moodle.

