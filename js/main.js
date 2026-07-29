/* ============================================================================
   main.js — Generador de Cuestionarios · Trendi
   ----------------------------------------------------------------------------
   Toda la lógica de la herramienta vive en este archivo. Es JavaScript puro
   ("vanilla JS"), sin librerías ni dependencias externas.

   QUÉ HACE LA APP
   ---------------
   Permite a un docente crear preguntas de 7 tipos (opción múltiple, V/F,
   respuesta corta, numérica, emparejamiento, completar espacios "cloze" y
   ensayo) y exportarlas como un archivo XML compatible con el banco de
   preguntas de Moodle. También genera un "prompt" tipo ICFES para crear
   preguntas con IA e importa esas respuestas en formato Aiken.

   ARQUITECTURA (en una frase)
   ---------------------------
   Hay UN objeto `state` que representa la pregunta que se está editando, y UN
   arreglo `questions` con todo lo ya guardado. Cuando el usuario interactúa,
   se actualiza `state`, se vuelve a dibujar la vista previa, y al "Agregar" se
   empuja una copia a `questions`. Todo se persiste en localStorage.

   POR QUÉ TODO ESTÁ ENVUELTO EN  (function(){ ... })();
   -----------------------------------------------------
   Es un IIFE (función que se ejecuta sola). Encapsula las variables para que NO
   contaminen el ámbito global (`window`), evitando choques con otros scripts.
   No reordenar el contenido: varias funciones se usan antes de su línea de
   definición y dependen del "hoisting" de declaraciones de función.

   MAPA DE SECCIONES (busca estos rótulos "// ----------" para navegar)
   --------------------------------------------------------------------
     State .............. estado de la pregunta en edición y datos persistidos
     Persistence ........ guardar/cargar en localStorage
     Rich text .......... editor con negrita/cursiva/listas/fórmula
     Type switch ........ mostrar el formulario según el tipo de pregunta
     Multichoice / TF / Short answer / Numerical / Matching / Cloze / Image
     Tags / Passages .... etiquetas y lecturas compartidas
     Preview ............ vista previa en vivo
     Validation + Add ... validar y guardar la pregunta
     Tray ............... lista de preguntas (editar/duplicar/eliminar)
     Backup ............. exportar/importar respaldo JSON
     XML EXPORT ......... construcción del Moodle XML  <-- núcleo delicado
     Generador con IA ... prompt ICFES + parser Aiken
     Toast / Init ....... avisos y arranque
   ========================================================================== */

(function(){
  "use strict";

  // ---------- State ----------
  function freshOpts(){ return [{text:'',correct:true},{text:'',correct:false}]; }
  function freshSA(){ return [{text:'',frac:'100'}]; }
  function freshPairs(){ return [{q:'',a:'',image:null},{q:'',a:'',image:null},{q:'',a:'',image:null}]; }
  // Numérica: Moodle admite VARIAS respuestas, cada una con su tolerancia y su
  // porcentaje de crédito (igual que "respuesta corta"). Opcionalmente pide unidad.
  function freshNum(){ return [{val:'',tol:'0',frac:'100'}]; }
  function freshUnits(){ return [{name:'',mult:'1'}]; }
  // Calculadas: el docente define RANGOS y nosotros sorteamos los valores.
  function freshCalcVars(){ return [{name:'a',min:'1',max:'10',dec:'0'},{name:'b',min:'1',max:'10',dec:'0'}]; }
  function freshCalcOpts(){ return [{text:'',correct:true},{text:'',correct:false},{text:'',correct:false}]; }
  // `state` = la pregunta que se está editando AHORA (un borrador en memoria).
  // Al pulsar "Agregar a la lista" se valida y se copia a `questions`. `editingId`
  // distingue entre crear una nueva (null) o estar editando una existente (su id).
  var state = {
    type:'multichoice', editingId:null,
    opts:freshOpts(), mcMulti:false,
    tfVal:true,
    saAnswers:freshSA(), saCase:false,
    numAnswers:freshNum(), numUnitsOn:false, numUnits:freshUnits(),
    calcVars:freshCalcVars(), calcAns:'', calcOpts:freshCalcOpts(),
    calcDec:'2', calcTol:'0.01', calcVariants:'5', calcSample:null,
    pairs:freshPairs(),
    image:null, tags:[], passageId:'',
    grade:'1', penalty:'0', genfb:'', shuffle:true
  };
  var questions = [];
  var passages = [];
  // Clave única en localStorage. El sufijo "_v1" permite versionar el formato:
  // si algún día cambia la estructura guardada, se sube a "_v2" sin pisar datos viejos.
  var KEY = 'trendi_quizgen_v1';
  var saveOk = true;

  // IMPORTANTE: Moodle SOLO acepta un conjunto cerrado de "fracciones" (porcentajes
  // de crédito) por respuesta. Si enviamos un valor fuera de esa lista, Moodle
  // rechaza la importación. Por eso pre-calculamos 100/n para n=1..10 (varias
  // respuestas correctas) con la cadena EXACTA que Moodle espera. No redondear a mano.
  var FRACS = {1:'100',2:'50',3:'33.33333',4:'25',5:'20',6:'16.66667',7:'14.28571',8:'12.5',9:'11.11111',10:'10'};
  var SA_FRACS = ['100','90','80','75','66.66667','60','50','40','33.33333','25','20','10','0'];

  // ---------- Elements ----------
  var $ = function(id){return document.getElementById(id);};
  var stmt=$('stmt'), opts=$('opts'), tray=$('tray'), preview=$('preview');

  // ---------- Persistence ----------
  function setSaveState(ok){
    saveOk = ok;
    var el=$('saveState'), t=$('saveTxt');
    if(ok){ el.className='savestate'; t.textContent='Guardado automático activo'; }
    else{ el.className='savestate err'; t.textContent='No se pudo guardar — exporta un respaldo'; }
  }
  // Guarda TODO el trabajo (preguntas + categoría + lecturas) en localStorage.
  // Se llama tras cada cambio relevante para que nada se pierda al recargar.
  function save(){
    try{
      localStorage.setItem(KEY, JSON.stringify({q:questions, cat:$('category').value, passages:passages}));
      if(!saveOk) setSaveState(true);
    }catch(e){
      // localStorage tiene un límite (~5 MB). Las imágenes en base64 lo llenan rápido:
      // si falla, avisamos al usuario para que descargue un respaldo antes de perder datos.
      setSaveState(false);
      toast('Almacenamiento lleno. Quita imágenes pesadas o guarda un respaldo JSON ahora.', true);
    }
  }
  function load(){
    try{
      var d = JSON.parse(localStorage.getItem(KEY)||'null');
      if(d){ questions = migrateAll(d.q); passages = d.passages||[]; if(d.cat) $('category').value=d.cat; }
    }catch(e){}
  }
  // Las preguntas numéricas guardadas antes de la Fase 1 traen {numAns, numTol}:
  // una sola respuesta al 100 % y sin unidades. Se convierten al formato nuevo
  // {numAnswers:[…]} para que todo lo de abajo (preview, XML, Word) sea uniforme.
  // Se aplica tanto al cargar de localStorage como al restaurar un respaldo JSON.
  function migrateQ(q){
    // Las opciones de multichoice eran texto plano y ahora son HTML (para poder llevar
    // fórmulas). Se escapan una sola vez, si no un "5 < 10" antiguo se leería como
    // etiqueta. La bandera `optsHtml` marca las que ya están convertidas.
    if(q && q.type==='multichoice' && Array.isArray(q.opts) && !q.optsHtml){
      q.opts.forEach(function(o){ o.text = esc(o.text||''); });
      q.optsHtml = true;
    }
    // Igual que las opciones: el elemento izquierdo del emparejamiento pasó de texto
    // plano a HTML para poder llevar fórmulas. Se escapa una sola vez.
    if(q && q.type==='matching' && Array.isArray(q.pairs) && !q.pairsHtml){
      q.pairs.forEach(function(p){ p.q = esc(p.q||''); });
      q.pairsHtml = true;
    }
    if(q && q.type==='numerical' && !Array.isArray(q.numAnswers)){
      q.numAnswers = [{ val:(q.numAns!=null?String(q.numAns):''), tol:(q.numTol!=null?String(q.numTol):'0'), frac:'100' }];
      q.numUnitsOn = false; q.numUnits = [];
      delete q.numAns; delete q.numTol;
    }
    return q;
  }
  function migrateAll(arr){ return (Array.isArray(arr)?arr:[]).map(migrateQ); }

  // ---------- Helpers ----------
  function autoName(){
    var cat=$('category').value.trim();
    var base = cat ? cat+' ' : 'Pregunta ';
    var n = questions.filter(function(x){return x.id!==state.editingId;}).length + 1;
    return base + ('0'+n).slice(-2);
  }

  // ---------- Rich text ----------
  try{ document.execCommand('defaultParagraphSeparator', false, 'p'); }catch(e){}
  function rtCmd(cmd, target){
    document.execCommand(cmd, false, null);
    target.focus();
  }
  document.querySelectorAll('.rt-tools button[data-cmd]').forEach(function(b){
    b.addEventListener('mousedown', function(e){
      e.preventDefault();
      // El botón ∑ abre el editor visual de fórmulas en vez de ejecutar un comando.
      // Se hace en 'mousedown' con preventDefault para NO perder dónde está el cursor
      // dentro del enunciado: ahí es donde se insertará la fórmula después.
      if(b.dataset.cmd==='math'){ openFxDlg(); return; }
      rtCmd(b.dataset.cmd, stmt); renderPreview();
    });
  });

  // ---------- Formula editor (MathLive) ----------
  /* CÓMO SE GUARDA UNA FÓRMULA
     --------------------------
     Dentro del enunciado (un contenteditable) la fórmula NO se guarda como texto
     LaTeX crudo, sino como un bloque atómico:

       <span class="fx" contenteditable="false" data-latex="\frac{a}{b}">…dibujo…</span>

     Así el docente ve la fórmula dibujada mientras escribe, y no puede romperla por
     dentro sin querer (se borra entera o no se borra). El LaTeX original viaja en
     data-latex. Justo antes de generar el XML o el Word, serializeMath() cambia cada
     bloque por el texto  \( … \)  que es lo que entiende el filtro MathJax de Moodle. */

  // Plantillas. `tex` es lo que se inserta (con sus cuadros vacíos) y `glyph` es la
  // muestra que se dibuja en el botón — con letras de ejemplo, para que se reconozca.
  var FX_TEMPLATES = [
    {cap:'Fracción',    glyph:'\\frac{a}{b}',              tex:'\\frac{\\placeholder{}}{\\placeholder{}}'},
    {cap:'Sumar fracciones', glyph:'\\frac{a}{b}+\\frac{c}{d}', tex:'\\frac{\\placeholder{}}{\\placeholder{}}+\\frac{\\placeholder{}}{\\placeholder{}}'},
    {cap:'Potencia',    glyph:'x^{2}',                     tex:'{\\placeholder{}}^{\\placeholder{}}'},
    {cap:'Subíndice',   glyph:'x_{1}',                     tex:'{\\placeholder{}}_{\\placeholder{}}'},
    {cap:'Raíz',        glyph:'\\sqrt{x}',                 tex:'\\sqrt{\\placeholder{}}'},
    {cap:'Raíz n',      glyph:'\\sqrt[3]{x}',              tex:'\\sqrt[\\placeholder{}]{\\placeholder{}}'},
    {cap:'Paréntesis',  glyph:'\\left(x\\right)',          tex:'\\left(\\placeholder{}\\right)'},
    {cap:'Sumatorio',   glyph:'\\sum_{i=1}^{n}',           tex:'\\sum_{\\placeholder{}}^{\\placeholder{}}\\placeholder{}'},
    {cap:'Integral',    glyph:'\\int_{a}^{b}',             tex:'\\int_{\\placeholder{}}^{\\placeholder{}}\\placeholder{}\\,d\\placeholder{}'},
    {cap:'Límite',      glyph:'\\lim_{x\\to0}',            tex:'\\lim_{\\placeholder{}\\to\\placeholder{}}\\placeholder{}'},
    {cap:'Sistema',     glyph:'\\begin{cases}a\\\\b\\end{cases}',       tex:'\\begin{cases}\\placeholder{}\\\\\\placeholder{}\\end{cases}'},
    {cap:'Matriz 2×2',  glyph:'\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}', tex:'\\begin{pmatrix}\\placeholder{}&\\placeholder{}\\\\\\placeholder{}&\\placeholder{}\\end{pmatrix}'},
    // \underline{\hspace{}} son comandos de TeX base: se renderizan en cualquier
    // MathJax, sin necesidad del paquete AMS. Sirve para "completa la fórmula".
    {cap:'Espacio en blanco', glyph:'\\underline{\\hspace{1em}}', tex:'\\underline{\\hspace{1.4em}}'},
    // Los operadores sueltos también van como botón: el docente no tiene por qué
    // adivinar que puede escribirlos con el teclado.
    {cap:'Sumar',       glyph:'+',                         tex:'+'},
    {cap:'Restar',      glyph:'-',                         tex:'-'},
    {cap:'Igual',       glyph:'=',                         tex:'='},
    {cap:'Por',         glyph:'\\times',                   tex:'\\times'},
    {cap:'Dividir',     glyph:'\\div',                     tex:'\\div'},
    {cap:'Más y menos', glyph:'\\pm',                      tex:'\\pm'},
    {cap:'Menor igual', glyph:'\\leq',                     tex:'\\leq'},
    {cap:'Mayor igual', glyph:'\\geq',                     tex:'\\geq'},
    {cap:'Distinto',    glyph:'\\neq',                     tex:'\\neq'},
    {cap:'Pi',          glyph:'\\pi',                      tex:'\\pi'},
    {cap:'Grados',      glyph:'90^{\\circ}',               tex:'^{\\circ}'}
  ];

  var fxRange = null;      // dónde estaba el cursor al abrir el modal
  var fxTarget = null;     // en qué campo editable hay que insertar (enunciado u opción)
  var fxOnDone = null;     // qué hacer después de insertar (p. ej. guardar la opción)
  var fxSyncing = false;   // evita el bucle math-field <-> caja de LaTeX
  var fxReady = false;     // ¿se pudo montar el editor?

  function mathLive(){ return window.MathLive || null; }
  function fxField(){ return $('fxField'); }

  // Dibuja un LaTeX como HTML estático. Si la librería no cargó, devuelve el código
  // crudo escapado — así nunca se pierde el contenido del docente.
  function renderLatex(latex){
    var ML = mathLive();
    if(!ML || !ML.convertLatexToMarkup) return esc(latex);
    try{ return ML.convertLatexToMarkup(latex); }
    catch(e){ return esc(latex); }
  }

  function buildFxTemplates(){
    var box=$('fxTemplates'); if(!box || box.childNodes.length) return;
    FX_TEMPLATES.forEach(function(t){
      var b=document.createElement('button'); b.type='button';
      b.setAttribute('aria-label','Insertar '+t.cap);
      b.innerHTML='<span class="glyph">'+renderLatex(t.glyph)+'</span><span class="cap">'+esc(t.cap)+'</span>';
      b.onclick=function(){ fxInsertTemplate(t.tex); };
      box.appendChild(b);
    });
  }

  function fxInsertTemplate(tex){
    var mf=fxField();
    if(!fxReady){ // sin MathLive: se concatena en la caja de texto LaTeX
      var inp=$('fxLatex'); inp.value += tex; inp.focus(); return;
    }
    try{
      // selectionMode:'placeholder' deja el cursor dentro del primer cuadro vacío
      mf.insert(tex, {focus:true, insertionMode:'replaceSelection', selectionMode:'placeholder'});
    }catch(e){ mf.value = (mf.value||'') + tex; }
    fxSyncFromField();
  }

  function fxSyncFromField(){
    if(fxSyncing) return; fxSyncing=true;
    $('fxLatex').value = fxReady ? (fxField().value||'') : $('fxLatex').value;
    fxSyncing=false;
  }
  function fxSyncFromInput(){
    if(fxSyncing) return; fxSyncing=true;
    if(fxReady){ try{ fxField().value = $('fxLatex').value; }catch(e){} }
    fxSyncing=false;
  }

  // `target` es el contenteditable donde se insertará; `onDone` se llama después
  // (las opciones lo usan para volcar su HTML al estado y redibujar la vista previa).
  function openFxDlg(target, onDone){
    fxTarget = target || stmt;
    fxOnDone = onDone || null;
    // Guardar la posición del cursor ANTES de que el diálogo se lleve el foco.
    var sel=window.getSelection();
    fxRange = (sel && sel.rangeCount && fxTarget.contains(sel.getRangeAt(0).commonAncestorContainer))
      ? sel.getRangeAt(0).cloneRange() : null;

    fxReady = !!(mathLive() && fxField() && typeof fxField().insert==='function');
    $('fxOffline').style.display = fxReady ? 'none' : 'block';
    // Sin MathLive, la única vía es la caja de LaTeX: se abre desplegada.
    if(!fxReady){ var adv=document.querySelector('.fx-adv'); if(adv) adv.open=true; }

    buildFxTemplates();
    if(fxReady){ try{ fxField().value=''; }catch(e){} }
    $('fxLatex').value=''; $('errFx').classList.remove('show');

    var dlg=$('fxDlg');
    if(dlg.showModal) dlg.showModal(); else dlg.setAttribute('open','');
    setTimeout(function(){ if(fxReady) fxField().focus(); else $('fxLatex').focus(); }, 30);
  }

  // Reemplaza los bloques de fórmula por  \( latex \)  — el formato que Moodle
  // procesa con MathJax. Se usa el DOM (no expresiones regulares) para no romper
  // enunciados con HTML anidado, y un nodo de texto para que el escapado sea correcto.
  function serializeMath(html){
    if(!html || html.indexOf('data-latex')===-1) return html;
    var d=document.createElement('div'); d.innerHTML=html;
    Array.prototype.slice.call(d.querySelectorAll('span.fx[data-latex]')).forEach(function(sp){
      sp.parentNode.replaceChild(document.createTextNode(' \\('+sp.getAttribute('data-latex')+'\\) '), sp);
    });
    return d.innerHTML;
  }

  function insertFormulaIntoStmt(latex){
    var host = fxTarget || stmt;
    var span=document.createElement('span');
    span.className='fx'; span.setAttribute('contenteditable','false');
    span.setAttribute('data-latex', latex);
    span.innerHTML = renderLatex(latex);

    host.focus();
    var sel=window.getSelection();
    if(fxRange && host.contains(fxRange.commonAncestorContainer)){
      sel.removeAllRanges(); sel.addRange(fxRange);
    }
    if(!sel.rangeCount || !host.contains(sel.getRangeAt(0).commonAncestorContainer)){ host.appendChild(span); }
    else{
      var r=sel.getRangeAt(0);
      r.deleteContents(); r.insertNode(span);
      // Un espacio después para que el cursor tenga dónde seguir escribiendo:
      // sin él, es muy difícil salir de un bloque contenteditable=false.
      var sp=document.createTextNode(' ');
      span.parentNode.insertBefore(sp, span.nextSibling);
      r.setStartAfter(sp); r.collapse(true);
      sel.removeAllRanges(); sel.addRange(r);
    }
    fxRange=null;
    if(fxOnDone){ try{ fxOnDone(host); }catch(e){} }
    renderPreview();
    if(state.type==='cloze') updateGapCount();
  }

  $('fxInsert').onclick=function(){
    var latex = (fxReady ? (fxField().value||'') : $('fxLatex').value||'').trim();
    if(!latex){ $('errFx').textContent='Escribe una fórmula antes de insertarla.'; $('errFx').classList.add('show'); return; }
    // \placeholder no existe en MathJax: si queda alguno, Moodle mostraría un error.
    if(latex.indexOf('\\placeholder')>-1){
      $('errFx').textContent='Quedan cuadros vacíos sin llenar. Complétalos, o usa la plantilla «Espacio en blanco» si quieres dejarlo en blanco a propósito.';
      $('errFx').classList.add('show');
      if(fxReady) fxField().focus();
      return;
    }
    $('errFx').classList.remove('show');
    var dlg=$('fxDlg'); if(dlg.close) dlg.close(); else dlg.removeAttribute('open');
    var enOpcion = fxTarget && fxTarget!==stmt;
    insertFormulaIntoStmt(latex);
    toast(enOpcion ? 'Fórmula insertada en la opción' : 'Fórmula insertada en el enunciado');
  };
  $('fxClear').onclick=function(){
    if(fxReady){ try{ fxField().value=''; }catch(e){} }
    $('fxLatex').value=''; $('errFx').classList.remove('show');
    if(fxReady) fxField().focus(); else $('fxLatex').focus();
  };
  $('fxLatex').addEventListener('input', function(){ fxSyncFromInput(); });
  // <math-field> emite 'input' al teclear, pero NO cuando se le inserta contenido por
  // código (executeCommand/insert) — comprobado. Por eso, además del listener, la caja
  // de LaTeX se refresca al desplegarla: así lo que se ve siempre está al día.
  $('fxField').addEventListener('input', function(){ fxSyncFromField(); });
  $('fxAdv').addEventListener('toggle', function(){ if(this.open) fxSyncFromField(); });
  // Paste as plain text (kills messy Word/HTML markup)
  function plainPaste(e){
    e.preventDefault();
    var text=(e.clipboardData||window.clipboardData).getData('text/plain');
    document.execCommand('insertText', false, text);
  }
  stmt.addEventListener('paste', plainPaste);
  stmt.addEventListener('input', function(){ renderPreview(); if(state.type==='cloze') updateGapCount(); });

  // ---------- Ayudas desplegables ----------
  // Un solo manejador para todos los botones "?": cada uno apunta con data-help al id
  // de la nota que muestra u oculta. Así agregar una ayuda nueva es solo markup.
  document.addEventListener('click', function(e){
    var b = e.target.closest('.help-q'); if(!b) return;
    e.preventDefault();
    var note = $(b.dataset.help); if(!note) return;
    var abrir = note.style.display !== 'block';
    note.style.display = abrir ? 'block' : 'none';
    b.setAttribute('aria-expanded', abrir ? 'true' : 'false');
  });

  // ---------- Type switch ----------
  // Ojo: "calculated" y "calculatedmulti" COMPARTEN el mismo bloque del formulario.
  // Por eso applyType() compara por elemento y no por tipo (si no, el segundo tipo
  // volvería a ocultar el bloque que el primero acaba de mostrar).
  var BLOCKS={multichoice:'mcBlock',truefalse:'tfBlock',shortanswer:'saBlock',numerical:'numBlock',
              calculated:'calcBlock',calculatedmulti:'calcBlock',matching:'matchBlock',cloze:null,essay:'essayBlock'};
  // Tipos que viven dentro del grupo "Matemáticas". El botón del grupo no es un tipo
  // en sí: al pulsarlo se despliega esta lista y se selecciona el último subtipo usado.
  // Al agregar "calculated"/"calculatedmulti" basta con meterlos en este arreglo y
  // poner su <button data-type="…"> dentro de #mathTypes en index.html.
  var MATH_TYPES=['numerical','calculated','calculatedmulti'];
  var lastMathType='numerical';
  function isCalc(t){ return t==='calculated'||t==='calculatedmulti'; }
  function isMath(t){ return MATH_TYPES.indexOf(t)>-1; }

  function applyType(){
    var inMath = isMath(state.type);
    // Botones de primer nivel: los normales se comparan por data-type; el agrupador
    // "Matemáticas" se marca cuando el tipo activo es cualquiera de sus subtipos.
    document.querySelectorAll('#types button').forEach(function(x){
      var on = x.dataset.group==='math' ? inMath : (x.dataset.type===state.type);
      x.setAttribute('aria-pressed', on ? 'true':'false');
      if(x.dataset.group) x.setAttribute('aria-expanded', on ? 'true':'false');
    });
    $('mathTypes').style.display = inMath ? 'grid' : 'none';
    document.querySelectorAll('#mathTypes button').forEach(function(x){
      x.setAttribute('aria-pressed', x.dataset.type===state.type ? 'true':'false');
    });
    var visibleBlock = BLOCKS[state.type];
    Object.keys(BLOCKS).forEach(function(t){
      if(BLOCKS[t]) $(BLOCKS[t]).style.display = (BLOCKS[t]===visibleBlock)?'block':'none';
    });
    // Dentro del bloque compartido de calculadas: fórmula única vs. opciones
    $('calcAnsWrap').style.display  = (state.type==='calculated')?'block':'none';
    $('calcOptsWrap').style.display = (state.type==='calculatedmulti')?'block':'none';
    if(isCalc(state.type)) renderCalcSample();
    $('clozeHint').style.display = state.type==='cloze'?'block':'none';
    // shuffle only meaningful for multichoice & matching
    $('shuffleWrap').style.display = (state.type==='multichoice'||state.type==='matching'||state.type==='calculatedmulti')?'flex':'none';
    $('stmtLabel').firstChild.textContent = state.type==='cloze' ? 'Texto con huecos ' : 'Enunciado de la pregunta ';
    if(state.type==='cloze') updateGapCount();
  }
  $('types').addEventListener('click', function(e){
    var b = e.target.closest('button'); if(!b) return;
    // "Matemáticas" no es un tipo: abre el grupo en el último subtipo elegido.
    state.type = b.dataset.group==='math' ? lastMathType : b.dataset.type;
    applyType(); renderPreview();
  });
  $('mathTypes').addEventListener('click', function(e){
    var b = e.target.closest('button'); if(!b) return;
    state.type = b.dataset.type; lastMathType = state.type;
    applyType(); renderPreview();
  });

  // ---------- Multichoice ----------
  function svgCheck(w){ return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="'+(w||3)+'" aria-hidden="true"><path d="M5 12l4 4 10-10"/></svg>'; }
  function renderOpts(){
    opts.innerHTML='';
    state.opts.forEach(function(o,i){
      var row=document.createElement('div'); row.className='opt-row';
      var mark=document.createElement('button'); mark.type='button';
      mark.className='mark'+(o.correct?' correct':'')+(state.mcMulti?' sq':'');
      mark.setAttribute('aria-pressed', o.correct?'true':'false');
      mark.setAttribute('aria-label','Marcar la opción '+(i+1)+' como correcta');
      mark.innerHTML = o.correct?svgCheck():'';
      mark.onclick=function(){
        if(state.mcMulti){ o.correct=!o.correct; }
        else{ state.opts.forEach(function(x,j){x.correct=(j===i);}); }
        renderOpts(); renderPreview();
      };
      // La opción es un contenteditable, no un <input>, para poder llevar fórmulas
      // dibujadas igual que el enunciado. `o.text` pasa a ser HTML (ver migrateQ).
      var inp=document.createElement('div');
      inp.className='rt rt-opt'; inp.contentEditable='true';
      inp.setAttribute('role','textbox');
      inp.setAttribute('data-ph','Opción '+(i+1));
      inp.setAttribute('aria-label','Texto de la opción '+(i+1));
      inp.innerHTML=o.text;
      inp.addEventListener('paste', plainPaste);
      inp.oninput=function(){ o.text=inp.innerHTML; renderPreview(); };

      var fx=document.createElement('button'); fx.type='button'; fx.className='opt-fx';
      fx.textContent='∑'; fx.title='Insertar fórmula en esta opción';
      fx.setAttribute('aria-label','Insertar fórmula en la opción '+(i+1));
      // mousedown + preventDefault para no perder el cursor dentro de la opción
      fx.addEventListener('mousedown', function(e){
        e.preventDefault();
        openFxDlg(inp, function(host){ o.text=host.innerHTML; });
      });

      var del=document.createElement('button'); del.type='button'; del.className='del'; del.innerHTML='×';
      del.title='Eliminar'; del.setAttribute('aria-label','Eliminar la opción '+(i+1));
      del.onclick=function(){ if(state.opts.length<=2){toast('Mínimo 2 opciones',true);return;}
        state.opts.splice(i,1); if(!state.opts.some(function(x){return x.correct;})) state.opts[0].correct=true;
        renderOpts(); renderPreview(); };
      row.appendChild(mark); row.appendChild(inp); row.appendChild(fx); row.appendChild(del);
      opts.appendChild(row);
    });
  }
  $('addOpt').onclick=function(){ state.opts.push({text:'',correct:false}); renderOpts(); };
  $('mcMulti').onchange=function(){
    state.mcMulti=this.checked;
    if(!state.mcMulti){ var seen=false; state.opts.forEach(function(o){ if(o.correct&&!seen){seen=true;}else{o.correct=false;} }); if(!seen) state.opts[0].correct=true; }
    renderOpts(); renderPreview();
  };

  // ---------- True/False ----------
  $('tf').addEventListener('click', function(e){
    var b=e.target.closest('button'); if(!b) return;
    state.tfVal = b.dataset.val==='true';
    $('tf').querySelector('.v').setAttribute('aria-pressed', state.tfVal?'true':'false');
    $('tf').querySelector('.f').setAttribute('aria-pressed', state.tfVal?'false':'true');
    renderPreview();
  });

  // ---------- Short answer ----------
  function renderSA(){
    var list=$('saList'); list.innerHTML='';
    state.saAnswers.forEach(function(a,i){
      var row=document.createElement('div'); row.className='opt-row';
      var inp=document.createElement('input'); inp.type='text'; inp.value=a.text;
      inp.placeholder='Respuesta aceptada '+(i+1); inp.setAttribute('aria-label','Respuesta aceptada '+(i+1));
      inp.oninput=function(){ a.text=inp.value; renderPreview(); };
      var sel=document.createElement('select'); sel.className='frac-sel'; sel.setAttribute('aria-label','Crédito de la respuesta '+(i+1));
      SA_FRACS.forEach(function(f){ var op=document.createElement('option'); op.value=f;
        op.textContent=(f==='66.66667'?'66.7':f==='33.33333'?'33.3':f==='16.66667'?'16.7':f==='14.28571'?'14.3':f==='11.11111'?'11.1':f)+'%';
        if(f===a.frac) op.selected=true; sel.appendChild(op); });
      sel.onchange=function(){ a.frac=sel.value; };
      var del=document.createElement('button'); del.type='button'; del.className='del'; del.innerHTML='×';
      del.title='Eliminar'; del.setAttribute('aria-label','Eliminar la respuesta '+(i+1));
      del.onclick=function(){ if(state.saAnswers.length<=1){toast('Necesitas al menos una respuesta',true);return;}
        state.saAnswers.splice(i,1); renderSA(); renderPreview(); };
      row.appendChild(inp); row.appendChild(sel); row.appendChild(del);
      list.appendChild(row);
    });
  }
  $('addSA').onclick=function(){ state.saAnswers.push({text:'',frac:'100'}); renderSA(); };
  $('saCase').onchange=function(){ state.saCase=this.checked; };
  // ---------- Numerical ----------
  // Una fila por respuesta aceptada: valor · tolerancia · crédito. Moodle acepta el
  // comodín "*" como "cualquier otra respuesta" (útil para retroalimentación al 0 %).
  function renderNum(){
    var list=$('numList'); list.innerHTML='';
    state.numAnswers.forEach(function(a,i){
      var row=document.createElement('div'); row.className='opt-row';

      var val=document.createElement('input'); val.type='text'; val.inputMode='decimal'; val.value=a.val;
      val.placeholder = i===0 ? 'Ej. 3.14' : 'Otro valor aceptado (o *)';
      val.setAttribute('aria-label','Valor de la respuesta '+(i+1));
      val.oninput=function(){ a.val=val.value; renderPreview(); };

      var tol=document.createElement('input'); tol.type='text'; tol.inputMode='decimal'; tol.className='tol-inp';
      tol.value=a.tol; tol.placeholder='0'; tol.title='Tolerancia ±';
      tol.setAttribute('aria-label','Tolerancia de la respuesta '+(i+1));
      tol.oninput=function(){ a.tol=tol.value; renderPreview(); };

      var sel=document.createElement('select'); sel.className='frac-sel';
      sel.setAttribute('aria-label','Crédito de la respuesta '+(i+1));
      SA_FRACS.forEach(function(f){
        var op=document.createElement('option'); op.value=f;
        op.textContent=(f==='66.66667'?'66.7':f==='33.33333'?'33.3':f==='16.66667'?'16.7':f==='14.28571'?'14.3':f==='11.11111'?'11.1':f)+'%';
        if(f===a.frac) op.selected=true; sel.appendChild(op);
      });
      sel.onchange=function(){ a.frac=sel.value; renderPreview(); };

      var del=document.createElement('button'); del.type='button'; del.className='del'; del.innerHTML='×';
      del.title='Eliminar'; del.setAttribute('aria-label','Eliminar la respuesta '+(i+1));
      del.onclick=function(){
        if(state.numAnswers.length<=1){ toast('Necesitas al menos una respuesta',true); return; }
        state.numAnswers.splice(i,1); renderNum(); renderPreview();
      };

      row.appendChild(val); row.appendChild(tol); row.appendChild(sel); row.appendChild(del);
      list.appendChild(row);
    });
  }
  $('addNum').onclick=function(){ state.numAnswers.push({val:'',tol:'0',frac:'0'}); renderNum(); };

  // Unidades. La PRIMERA es la unidad en la que está escrita la respuesta, así que su
  // multiplicador es siempre 1 y por eso va en solo lectura (evita un error muy común).
  function renderUnits(){
    $('numUnitsWrap').style.display = state.numUnitsOn ? 'block' : 'none';
    var list=$('numUnitsList'); list.innerHTML='';
    state.numUnits.forEach(function(u,i){
      var row=document.createElement('div'); row.className='opt-row';

      var name=document.createElement('input'); name.type='text'; name.value=u.name;
      name.placeholder = i===0 ? 'Unidad principal (ej. m/s)' : 'Unidad equivalente (ej. km/h)';
      name.setAttribute('aria-label','Nombre de la unidad '+(i+1));
      name.oninput=function(){ u.name=name.value; renderPreview(); };

      var mult=document.createElement('input'); mult.type='text'; mult.inputMode='decimal'; mult.className='unit-mult';
      mult.setAttribute('aria-label','Multiplicador de la unidad '+(i+1));
      if(i===0){ u.mult='1'; mult.value='1'; mult.readOnly=true; mult.title='La unidad principal siempre vale 1'; }
      else{ mult.value=u.mult; mult.placeholder='Multiplicador'; mult.title='Multiplicador'; mult.oninput=function(){ u.mult=mult.value; }; }

      var del=document.createElement('button'); del.type='button'; del.className='del'; del.innerHTML='×';
      del.title='Eliminar'; del.setAttribute('aria-label','Eliminar la unidad '+(i+1));
      del.onclick=function(){
        if(state.numUnits.length<=1){ toast('Deja al menos una unidad o desactiva la casilla',true); return; }
        state.numUnits.splice(i,1); renderUnits(); renderPreview();
      };

      row.appendChild(name); row.appendChild(mult); row.appendChild(del);
      list.appendChild(row);
    });
  }
  $('addUnit').onclick=function(){ state.numUnits.push({name:'',mult:''}); renderUnits(); };
  $('numUnitsOn').onchange=function(){
    state.numUnitsOn=this.checked;
    if(state.numUnitsOn && !state.numUnits.length) state.numUnits=freshUnits();
    renderUnits(); renderPreview();
  };

  // ---------- Calculated ----------
  /* Moodle evalúa las fórmulas en el servidor con su propio motor. Nosotros solo
     necesitamos evaluarlas AQUÍ para enseñarle al docente una versión de ejemplo.

     SEGURIDAD: no se pasa el texto del docente a eval() tal cual. Primero se
     sustituyen las variables, después se traducen las funciones permitidas a Math.*,
     y por último se comprueba que lo que queda sean SOLO cifras, operadores y
     paréntesis. Si aparece cualquier otra cosa, se rechaza sin evaluar. */
  var CALC_FUNCS={sqrt:'Math.sqrt',abs:'Math.abs',round:'Math.round',floor:'Math.floor',
    ceil:'Math.ceil',pow:'Math.pow',sin:'Math.sin',cos:'Math.cos',tan:'Math.tan',
    log10:'Math.log10',log:'Math.log',exp:'Math.exp',min:'Math.min',max:'Math.max'};

  function evalFormula(expr, vals){
    if(!expr || !String(expr).trim()) return null;
    var s=String(expr);
    s = s.replace(/\{(\w+)\}/g, function(_,n){ return (vals && vals[n]!=null) ? '('+vals[n]+')' : 'NOPE'; });
    s = s.replace(/\bpi\s*\(\s*\)/gi, '(Math.PI)');
    s = s.replace(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g, function(m,name){
      var f=CALC_FUNCS[name.toLowerCase()];
      return f ? f+'(' : 'NOPE(';
    });
    // Tras quitar los tokens Math.* permitidos solo puede quedar aritmética básica.
    var probe = s.replace(/Math\.(sqrt|abs|round|floor|ceil|pow|sin|cos|tan|log10|log|exp|min|max|PI)\b/g,'');
    if(!/^[0-9+\-*/(),.\s]*$/.test(probe)) return null;
    try{
      var v = (new Function('return ('+s+');'))();
      return (typeof v==='number' && isFinite(v)) ? v : null;
    }catch(e){ return null; }
  }

  // Sortea un valor por variable dentro de su rango, respetando los decimales pedidos.
  function sampleVars(vars){
    var o={};
    (vars||[]).forEach(function(v){
      var name=(v.name||'').trim(); if(!name) return;
      var min=parseFloat(v.min), max=parseFloat(v.max), dec=parseInt(v.dec,10)||0;
      if(!isFinite(min)||!isFinite(max)) return;
      if(max<min){ var t=min; min=max; max=t; }
      o[name] = (min + Math.random()*(max-min)).toFixed(dec);
    });
    return o;
  }
  function currentSample(){
    if(!state.calcSample) state.calcSample = sampleVars(state.calcVars);
    return state.calcSample;
  }
  function rerollSample(){ state.calcSample = sampleVars(state.calcVars); }

  // Sustituye {var} por su valor y {=expr} por el resultado, igual que hace Moodle.
  /* Sustituye {=expr} por su resultado y {var} por su valor.
     No se puede usar una expresión regular tipo /\{=([^}]*)\}/ porque la propia
     expresión lleva llaves dentro: en "{={a}*{b}}" cortaría en el primer "}" y
     evaluaría "{a" — un fallo real que apareció al probarlo. Hay que contar
     el anidamiento de llaves a mano. */
  function substCalc(text, vals, dec){
    if(text==null) return '';
    var s=String(text), out='', i=0;
    while(i<s.length){
      var start=s.indexOf('{=', i);
      if(start<0){ out+=s.slice(i); break; }
      out += s.slice(i,start);
      var depth=1, j=start+2;
      while(j<s.length){
        if(s[j]==='{') depth++;
        else if(s[j]==='}'){ depth--; if(depth===0) break; }
        j++;
      }
      if(depth!==0){ out += s.slice(start); break; }   // llave sin cerrar: se deja igual
      var r=evalFormula(s.slice(start+2, j), vals);
      out += (r==null ? '?' : fmtCalc(r, dec));
      i=j+1;
    }
    return out.replace(/\{(\w+)\}/g, function(m,n){ return (vals && vals[n]!=null) ? vals[n] : m; });
  }
  // `dec` explícito para poder formatear preguntas ya guardadas (que traen su propio
  // calcDec) sin depender del estado del formulario.
  function fmtCalc(n, dec){
    var d = parseInt(dec!=null?dec:state.calcDec, 10) || 0;
    return Number(n).toFixed(d);
  }
  // Valores de la variante `idx` de una pregunta guardada.
  function calcVariantVals(q, idx){
    var o={};
    (q.calcVars||[]).forEach(function(v){ o[v.name]=(v.values||[])[idx||0]; });
    return o;
  }

  // Nombres de variable realmente usados en un texto (para avisar de erratas)
  function varsUsed(text){
    var out=[], m, re=/\{(\w+)\}/g;
    while((m=re.exec(String(text||'')))){ if(m[1]!=='=' && out.indexOf(m[1])<0) out.push(m[1]); }
    return out;
  }
  function definedVarNames(){
    return (state.calcVars||[]).map(function(v){return (v.name||'').trim();}).filter(Boolean);
  }

  function renderCalcVars(){
    var list=$('calcVarList'); list.innerHTML='';
    state.calcVars.forEach(function(v,i){
      var row=document.createElement('div'); row.className='calc-row';
      function mk(cls,val,ph,label,key,mode){
        var el=document.createElement('input'); el.type='text'; el.value=val; el.placeholder=ph;
        if(cls) el.className=cls;
        if(mode) el.inputMode=mode;
        el.setAttribute('aria-label',label+' de la variable '+(i+1));
        el.oninput=function(){ v[key]=el.value; rerollSample(); renderCalcSample(); renderPreview(); };
        return el;
      }
      row.appendChild(mk('var-name', v.name, 'a', 'Nombre', 'name'));
      row.appendChild(mk('', v.min, '1', 'Valor mínimo', 'min', 'decimal'));
      row.appendChild(mk('', v.max, '10', 'Valor máximo', 'max', 'decimal'));
      row.appendChild(mk('', v.dec, '0', 'Decimales', 'dec', 'numeric'));
      var del=document.createElement('button'); del.type='button'; del.className='del'; del.innerHTML='×';
      del.title='Eliminar'; del.setAttribute('aria-label','Eliminar la variable '+(i+1));
      del.onclick=function(){
        if(state.calcVars.length<=1){ toast('Necesitas al menos una variable',true); return; }
        state.calcVars.splice(i,1); rerollSample(); renderCalcVars(); renderCalcSample(); renderPreview();
      };
      row.appendChild(del);
      list.appendChild(row);
    });
  }
  $('addCalcVar').onclick=function(){
    // Sugerir la siguiente letra libre: a, b, c…
    var used=definedVarNames(), letra='a';
    for(var i=0;i<26;i++){ var c=String.fromCharCode(97+i); if(used.indexOf(c)<0){ letra=c; break; } }
    state.calcVars.push({name:letra,min:'1',max:'10',dec:'0'});
    rerollSample(); renderCalcVars(); renderCalcSample();
  };

  function renderCalcOpts(){
    var list=$('calcOptList'); list.innerHTML='';
    state.calcOpts.forEach(function(o,i){
      var row=document.createElement('div'); row.className='opt-row';
      var mark=document.createElement('span'); mark.className='mark'+(o.correct?' correct':'');
      mark.setAttribute('role','radio'); mark.tabIndex=0;
      mark.setAttribute('aria-checked', o.correct?'true':'false');
      mark.setAttribute('aria-label','Marcar la opción '+(i+1)+' como correcta');
      mark.innerHTML=o.correct?svgCheck():'';
      function pick(){ state.calcOpts.forEach(function(x){x.correct=false;}); o.correct=true; renderCalcOpts(); renderPreview(); }
      mark.onclick=pick;
      mark.onkeydown=function(e){ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); pick(); } };

      var inp=document.createElement('input'); inp.type='text'; inp.value=o.text; inp.spellcheck=false;
      inp.placeholder = i===0 ? 'Fórmula correcta, ej. {a}+{b}' : 'Distractor, ej. {a}-{b}';
      inp.setAttribute('aria-label','Fórmula de la opción '+(i+1));
      inp.oninput=function(){ o.text=inp.value; renderCalcSample(); renderPreview(); };

      var del=document.createElement('button'); del.type='button'; del.className='del'; del.innerHTML='×';
      del.title='Eliminar'; del.setAttribute('aria-label','Eliminar la opción '+(i+1));
      del.onclick=function(){
        if(state.calcOpts.length<=2){ toast('Mínimo 2 opciones',true); return; }
        var eraCorrecta=o.correct;
        state.calcOpts.splice(i,1);
        if(eraCorrecta) state.calcOpts[0].correct=true;
        renderCalcOpts(); renderPreview();
      };
      row.appendChild(mark); row.appendChild(inp); row.appendChild(del);
      list.appendChild(row);
    });
  }
  $('addCalcOpt').onclick=function(){ state.calcOpts.push({text:'',correct:false}); renderCalcOpts(); };

  // Panel de "así se verá una versión". Es lo que convierte esto en algo entendible.
  function renderCalcSample(){
    var box=$('calcSample'); if(!box) return;
    var vals=currentSample();
    var names=Object.keys(vals);
    if(!names.length){ box.innerHTML='<span class="lbl">Ejemplo</span>Define al menos una variable con su rango.'; return; }
    var h='<span class="lbl">Ejemplo de una versión</span>';
    h += names.map(function(n){ return '<span class="val">{'+esc(n)+'} = '+esc(vals[n])+'</span>'; }).join(' &nbsp;·&nbsp; ');
    if(state.type==='calculated'){
      var r=evalFormula(state.calcAns, vals);
      h += '<div class="res">'+(r==null
        ? '<span class="bad">No se pudo calcular la fórmula.</span> Revisa que las variables existan y que solo uses operadores y funciones permitidas.'
        : 'Respuesta correcta para esta versión: <span class="val">'+esc(fmtCalc(r))+'</span>')+'</div>';
    } else {
      var items=state.calcOpts.filter(function(o){return o.text.trim();});
      if(items.length){
        h += '<div class="res">'+items.map(function(o,i){
          var txt=o.text.trim();
          var shown = txt.indexOf('{=')>-1 ? substCalc(txt, vals)
                    : (function(){ var r=evalFormula(txt, vals); return r==null?'<span class="bad">?</span>':fmtCalc(r); })();
          return String.fromCharCode(97+i)+'. <span class="val">'+shown+'</span>'+(o.correct?' ✓':'');
        }).join('<br>')+'</div>';
      }
    }
    box.innerHTML=h;
  }
  $('calcReroll').onclick=function(){ rerollSample(); renderCalcSample(); renderPreview(); };
  $('calcAns').addEventListener('input', function(){ state.calcAns=this.value; renderCalcSample(); renderPreview(); });
  ['calcDec','calcTol','calcVariants'].forEach(function(id){
    $(id).addEventListener('change', function(){
      state[id==='calcDec'?'calcDec':id==='calcTol'?'calcTol':'calcVariants']=this.value;
      renderCalcSample(); renderPreview();
    });
  });

  // ---------- Matching ----------
  // Nota Moodle: la respuesta (derecha) del emparejamiento se muestra siempre
  // en un <select> de Moodle, así que solo puede ser texto plano — jamás imagen.
  // El elemento (izquierda) sí admite imagen porque se renderiza como HTML normal.
  function renderMatch(){
    var list=$('matchList'); list.innerHTML='';
    state.pairs.forEach(function(p,i){
      var row=document.createElement('div'); row.className='pair-row';

      var thumbWrap=document.createElement('div'); thumbWrap.className='pair-thumb-wrap';
      var thumb=document.createElement('div'); thumb.className='pair-thumb'+(p.image?' has-img':'');
      thumb.setAttribute('role','button'); thumb.tabIndex=0;
      thumb.title=p.image?'Cambiar imagen':'Agregar imagen al elemento (opcional)';
      var fileInput=document.createElement('input'); fileInput.type='file'; fileInput.accept='image/png,image/jpeg'; fileInput.style.display='none';
      fileInput.onchange=function(e){
        var file=e.target.files[0]; if(!file) return;
        if(file.size > 1024*1024){ toast('La imagen pesa '+(file.size/1048576).toFixed(1)+' MB. Máximo 1 MB — comprímela primero.', true); this.value=''; return; }
        var r=new FileReader();
        r.onload=function(){
          var data=r.result; var b64=data.split(',')[1];
          var ext = file.type==='image/png'?'png':'jpg';
          p.image={ filename:'pair_'+Date.now()+'_'+Math.random().toString(36).slice(2,7)+'.'+ext, base64:b64, dataUrl:data, alt:'' };
          renderMatch(); renderPreview();
        };
        r.readAsDataURL(file);
      };
      if(p.image){
        var img=document.createElement('img'); img.src=p.image.dataUrl; img.alt='';
        thumb.appendChild(img);
      } else {
        thumb.innerHTML='🖼️';
      }
      thumb.appendChild(fileInput);
      thumb.onclick=function(){ fileInput.click(); };
      thumb.onkeydown=function(e){ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); fileInput.click(); } };
      thumbWrap.appendChild(thumb);
      if(p.image){
        var rm=document.createElement('button'); rm.type='button'; rm.className='pair-thumb-rm'; rm.textContent='Quitar';
        rm.setAttribute('aria-label','Quitar imagen del elemento '+(i+1));
        rm.onclick=function(){ p.image=null; renderMatch(); renderPreview(); };
        thumbWrap.appendChild(rm);
      }

      var fields=document.createElement('div'); fields.className='pair-fields';
      // El elemento de la IZQUIERDA sí admite HTML en Moodle (por eso puede llevar
      // imagen), así que también puede llevar fórmulas: es un contenteditable con ∑.
      var q=document.createElement('div');
      q.className='rt rt-opt'; q.contentEditable='true'; q.setAttribute('role','textbox');
      q.setAttribute('data-ph', p.image ? 'Texto opcional' : 'Elemento '+(i+1));
      q.setAttribute('aria-label','Elemento '+(i+1));
      q.innerHTML = p.q;
      q.addEventListener('paste', plainPaste);
      q.oninput=function(){ p.q=q.innerHTML; renderPreview(); };

      var qfx=document.createElement('button'); qfx.type='button'; qfx.className='opt-fx';
      qfx.textContent='∑'; qfx.title='Insertar fórmula en este elemento';
      qfx.setAttribute('aria-label','Insertar fórmula en el elemento '+(i+1));
      qfx.addEventListener('mousedown', function(e){
        e.preventDefault();
        openFxDlg(q, function(host){ p.q=host.innerHTML; });
      });

      var arrow=document.createElement('span'); arrow.className='arrow'; arrow.textContent='→'; arrow.setAttribute('aria-hidden','true');
      var a=document.createElement('input'); a.type='text'; a.value=p.a;
      a.placeholder='Su respuesta'; a.setAttribute('aria-label','Respuesta del elemento '+(i+1));
      a.oninput=function(){ p.a=a.value; renderPreview(); };
      fields.appendChild(q); fields.appendChild(qfx); fields.appendChild(arrow); fields.appendChild(a);

      var del=document.createElement('button'); del.type='button'; del.className='del'; del.innerHTML='×';
      del.title='Eliminar pareja'; del.setAttribute('aria-label','Eliminar la pareja '+(i+1));
      del.onclick=function(){ if(state.pairs.length<=3){toast('Mínimo 3 parejas',true);return;}
        state.pairs.splice(i,1); renderMatch(); renderPreview(); };

      row.appendChild(thumbWrap); row.appendChild(fields); row.appendChild(del);
      list.appendChild(row);
    });
  }
  $('addPair').onclick=function(){ state.pairs.push({q:'',a:'',image:null}); renderMatch(); };

  // ---------- Cloze ----------
  function countGaps(html){ var m=html.match(/\[\[[^\]]+\]\]/g); return m?m.length:0; }
  function updateGapCount(){ $('gapCount').textContent = countGaps(stmt.innerHTML); }

  // ---------- Image ----------
  function bindDrop(){ var d=$('imgArea').querySelector('#imgDrop'); if(d) d.onclick=function(){ $('imgInput').click(); }; }
  $('imgInput').onchange=function(e){
    var file=e.target.files[0]; if(!file) return;
    if(file.size > 1024*1024){
      toast('La imagen pesa '+(file.size/1048576).toFixed(1)+' MB. Máximo 1 MB — comprímela primero.', true);
      this.value=''; return;
    }
    var r=new FileReader();
    r.onload=function(){
      var data=r.result; var b64=data.split(',')[1];
      var ext = file.type==='image/png'?'png':'jpg';
      state.image={ filename:'img_'+Date.now()+'.'+ext, base64:b64, dataUrl:data, alt:'' };
      renderImg(); renderPreview();
    };
    r.readAsDataURL(file);
  };
  function renderImg(){
    var area=$('imgArea');
    if(!state.image){ area.innerHTML='<div class="img-drop" id="imgDrop">Haz clic para cargar una imagen</div>'; bindDrop(); return; }
    area.innerHTML='';
    var wrap=document.createElement('div'); wrap.className='img-prev';
    var img=document.createElement('img'); img.src=state.image.dataUrl; img.alt='Vista previa de la imagen cargada';
    var meta=document.createElement('div'); meta.className='meta';
    var alt=document.createElement('input'); alt.type='text'; alt.placeholder='Texto alternativo — opcional, recomendado para accesibilidad';
    alt.setAttribute('aria-label','Texto alternativo de la imagen');
    alt.value=state.image.alt; alt.oninput=function(){ state.image.alt=alt.value; };
    var rm=document.createElement('button'); rm.type='button'; rm.className='add-opt'; rm.style.color='var(--danger)'; rm.textContent='Quitar imagen';
    rm.onclick=function(){ state.image=null; $('imgInput').value=''; renderImg(); renderPreview(); };
    meta.appendChild(alt); meta.appendChild(rm);
    wrap.appendChild(img); wrap.appendChild(meta); area.appendChild(wrap);
  }

  // ---------- Tags ----------
  function addTag(t){ t=(t||'').trim(); if(!t) return; if(state.tags.indexOf(t)>-1) return; state.tags.push(t); renderTags(); }
  function renderTags(){
    var box=$('tagChips'); box.innerHTML='';
    state.tags.forEach(function(t,i){
      var c=document.createElement('span'); c.className='chip';
      c.appendChild(document.createTextNode(t));
      var b=document.createElement('button'); b.type='button'; b.textContent='×'; b.setAttribute('aria-label','Quitar etiqueta '+t);
      b.onclick=function(){ state.tags.splice(i,1); renderTags(); };
      c.appendChild(b); box.appendChild(c);
    });
  }
  $('tagInput').addEventListener('keydown', function(e){
    if(e.key==='Enter'||e.key===','){ e.preventDefault(); addTag(this.value); this.value=''; }
  });
  $('tagInput').addEventListener('blur', function(){ if(this.value.trim()){ addTag(this.value); this.value=''; } });
  document.querySelectorAll('.quick-tags button').forEach(function(b){ b.onclick=function(){ addTag(b.dataset.tag); }; });

  // ---------- Passages ----------
  function refreshPassageSelect(){
    var sel=$('passageSel'); var cur=state.passageId;
    sel.innerHTML='<option value="">Sin lectura</option>';
    passages.forEach(function(p){ var o=document.createElement('option'); o.value=p.id; o.textContent=p.title||'(sin título)'; sel.appendChild(o); });
    sel.value = passages.some(function(p){return p.id===cur;}) ? cur : '';
    state.passageId = sel.value;
  }
  $('passageSel').onchange=function(){ state.passageId=this.value; renderPreview(); };
  $('managePassages').onclick=function(){ openPassageDlg(); };
  document.querySelectorAll('#passageDlg .rt-tools button[data-pcmd]').forEach(function(b){
    b.addEventListener('mousedown', function(e){ e.preventDefault(); document.execCommand(b.dataset.pcmd,false,null); $('pBody').focus(); });
  });
  $('pBody').addEventListener('paste', plainPaste);
  var editingPassageId=null;
  function openPassageDlg(){ editingPassageId=null; $('pTitle').value=''; $('pBody').innerHTML=''; renderPassageList();
    var d=$('passageDlg'); if(d.showModal) d.showModal(); else d.setAttribute('open','');
  }
  $('savePassage').onclick=function(){
    var title=$('pTitle').value.trim(); var body=$('pBody').innerHTML.trim();
    if(!$('pBody').textContent.trim()){ toast('Escribe el texto de la lectura',true); return; }
    if(editingPassageId){
      var p=passages.find(function(x){return x.id===editingPassageId;}); if(p){ p.title=title; p.html=body; }
      editingPassageId=null;
    } else {
      passages.push({id:'p'+Date.now(), title:title||'Lectura', html:body});
    }
    $('pTitle').value=''; $('pBody').innerHTML='';
    save(); refreshPassageSelect(); renderPassageList(); toast('Lectura guardada');
  };
  function renderPassageList(){
    var box=$('passageList'); box.innerHTML='';
    if(!passages.length){ box.innerHTML='<div class="prev-note">Aún no hay lecturas.</div>'; return; }
    passages.forEach(function(p){
      var row=document.createElement('div'); row.className='q-item'; row.style.marginBottom='8px';
      var t=document.createElement('div'); t.className='q-title'; t.style.marginBottom='6px'; t.textContent=p.title||'(sin título)';
      var acts=document.createElement('div'); acts.className='q-actions';
      var ed=document.createElement('button'); ed.type='button'; ed.textContent='Editar';
      ed.onclick=function(){ editingPassageId=p.id; $('pTitle').value=p.title; $('pBody').innerHTML=p.html; };
      var dl=document.createElement('button'); dl.type='button'; dl.className='danger'; dl.textContent='Eliminar';
      dl.onclick=function(){ if(!confirm('¿Eliminar esta lectura?')) return;
        passages=passages.filter(function(x){return x.id!==p.id;});
        if(state.passageId===p.id) state.passageId='';
        save(); refreshPassageSelect(); renderPassageList(); renderPreview(); };
      acts.appendChild(ed); acts.appendChild(dl);
      row.appendChild(t); row.appendChild(acts); box.appendChild(row);
    });
  }

  // ---------- Preview ----------
  function renderPreview(){
    var html='';
    var pass = passages.find(function(p){return p.id===state.passageId;});
    if(pass) html += '<div class="prev-passage">'+pass.html+'</div>';
    var h = stmt.innerHTML.trim();
    // En las calculadas el docente escribe {a}; aquí se muestra ya con números reales,
    // que es lo que verá el estudiante.
    if(isCalc(state.type)) h = substCalc(h, currentSample());
    if(state.type==='cloze'){
      h = h.replace(/\[\[([^\]]+)\]\]/g, function(_,inner){ return '<span class="gap">'+esc(inner.split('|')[0])+'</span>'; });
    }
    html += '<div class="prev-stmt">'+(h||'<span style="color:#b3b0a8">Sin enunciado…</span>');
    if(state.image) html += '<img src="'+state.image.dataUrl+'" alt="'+esc(state.image.alt||'')+'">';
    html += '</div>';

    if(state.type==='multichoice'){
      // Moodle numera las opciones con a. b. c. (answernumbering=abc en el XML)
      state.opts.forEach(function(o,i){
        html += '<div class="prev-opt'+(o.correct?' ok':'')+'"><span class="circle'+(state.mcMulti?' sq':'')+'">'+(o.correct?'✓':'')+'</span>'+
                '<span class="prev-letter">'+String.fromCharCode(97+i)+'.</span>'+
                (htmlHasText(o.text)? o.text :'<span style="color:#b3b0a8">(vacía)</span>')+(o.correct?'<span class="ok-tag">Correcta</span>':'')+'</div>';
      });
    } else if(state.type==='truefalse'){
      html += '<div class="prev-opt'+(state.tfVal?' ok':'')+'"><span class="circle">'+(state.tfVal?'✓':'')+'</span>Verdadero'+(state.tfVal?'<span class="ok-tag">Correcta</span>':'')+'</div>';
      html += '<div class="prev-opt'+(!state.tfVal?' ok':'')+'"><span class="circle">'+(!state.tfVal?'✓':'')+'</span>Falso'+(!state.tfVal?'<span class="ok-tag">Correcta</span>':'')+'</div>';
    } else if(state.type==='shortanswer'){
      // En Moodle el alumno escribe en una caja de texto; aquí se muestra la respuesta esperada.
      var acc=state.saAnswers.filter(function(a){return a.text.trim();});
      html += acc.length? '<div class="prev-input">✓ '+esc(acc[0].text)+(acc.length>1?' <span class="prev-note">(+'+(acc.length-1)+' aceptadas)</span>':'')+'</div>'
                        : '<div class="prev-note">Sin respuestas aún…</div>';
    } else if(state.type==='numerical'){
      // El estudiante ve una caja vacía; aquí listamos las respuestas que Moodle
      // aceptará, con su tolerancia y su crédito (es una vista para el docente).
      var uNames = state.numUnitsOn ? state.numUnits.filter(function(u){return u.name.trim();}) : [];
      var mainUnit = uNames.length ? ' '+esc(uNames[0].name.trim()) : '';
      var na = state.numAnswers.filter(function(a){return a.val.trim();});
      if(na.length){
        na.forEach(function(a){
          var v = a.val.trim();
          // "*" es el comodín "cualquier otra respuesta": no lleva tolerancia ni unidad.
          if(v==='*'){
            html += '<div class="prev-input partial">Cualquier otra respuesta '+
                    '<span class="prev-note">('+esc(a.frac)+' %)</span></div>';
            return;
          }
          var tolNum = parseFloat(a.tol);
          html += '<div class="prev-input'+(a.frac==='100'?'':' partial')+'">'+
                  (a.frac==='100'?'✓ ':'~ ')+esc(v)+
                  (tolNum? ' ± '+esc(a.tol.trim()):'')+mainUnit+
                  (a.frac==='100'?'':' <span class="prev-note">('+esc(a.frac)+' %)</span>')+'</div>';
        });
        if(uNames.length>1){
          html += '<div class="prev-note">También acepta: '+
                  uNames.slice(1).map(function(u){return esc(u.name.trim());}).join(', ')+'</div>';
        }
      } else html += '<div class="prev-note">Sin respuesta aún…</div>';
    } else if(state.type==='calculated'){
      var cr = evalFormula(state.calcAns, currentSample());
      html += cr==null
        ? '<div class="prev-note">Escribe la fórmula de la respuesta…</div>'
        : '<div class="prev-input">✓ '+esc(fmtCalc(cr))+(parseFloat(state.calcTol)?' <span class="prev-note">(± '+esc((parseFloat(state.calcTol)*100).toFixed(1))+' %)</span>':'')+'</div>';
      html += '<div class="prev-note">Cada estudiante recibe una de '+esc(state.calcVariants)+' versiones con números distintos.</div>';
    } else if(state.type==='calculatedmulti'){
      var cvals=currentSample();
      var copts=state.calcOpts.filter(function(o){return o.text.trim();});
      if(copts.length){
        copts.forEach(function(o,i){
          var t=o.text.trim();
          var shown = t.indexOf('{=')>-1 ? substCalc(t,cvals)
                    : (function(){ var r=evalFormula(t,cvals); return r==null?'?':fmtCalc(r); })();
          html += '<div class="prev-opt'+(o.correct?' ok':'')+'"><span class="circle">'+(o.correct?'✓':'')+'</span>'+
                  '<span class="prev-letter">'+String.fromCharCode(97+i)+'.</span>'+shown+
                  (o.correct?'<span class="ok-tag">Correcta</span>':'')+'</div>';
        });
        html += '<div class="prev-note">Cada estudiante recibe una de '+esc(state.calcVariants)+' versiones con números distintos.</div>';
      } else html += '<div class="prev-note">Agrega las opciones…</div>';
    } else if(state.type==='matching'){
      // Moodle muestra cada elemento a la izquierda y un <select> a la derecha
      // ("Elige una opción…"). Aquí el desplegable ya trae la respuesta correcta.
      var pr=state.pairs.filter(function(p){return (htmlHasText(p.q)||p.image)&&p.a.trim();});
      // Si alguna pareja tiene imagen, todas reservan la columna para que los
      // textos y los desplegables queden alineados entre filas.
      var anyImg=pr.some(function(p){return !!p.image;});
      if(pr.length){ pr.forEach(function(p){
        html+='<div class="prev-match'+(anyImg?' with-img':'')+'">'+
          (anyImg?'<div class="pic">'+(p.image?'<img src="'+p.image.dataUrl+'" alt="">':'')+'</div>':'')+
          '<div class="stem">'+(htmlHasText(p.q)?p.q:'')+'</div>'+
          '<span class="prev-select">'+esc(p.a)+'<span class="chev">▼</span></span></div>';
      }); }
      else html += '<div class="prev-note">Agrega parejas…</div>';
    } else if(state.type==='cloze'){
      html += '<div class="prev-note">'+countGaps(stmt.innerHTML)+' hueco(s). En Moodle el estudiante ve esas cajas vacías; aquí muestran la respuesta.</div>';
    } else if(state.type==='essay'){
      // En Moodle el alumno escribe en un editor de texto; se representa como caja amplia.
      html += '<div class="prev-essay-box">Espacio de respuesta abierta — el estudiante escribe aquí (calificación manual).</div>';
    }
    preview.innerHTML = html;
  }

  // ---------- Validation + Add ----------
  var ERRFIELDS={errStmt:'stmt',errOpts:null,errSA:null,errNum:null,errMatch:null,
                 errCalcVars:null,errCalcAns:'calcAns',errCalcOpts:null};
  function clearErrs(){
    ['errStmt','errOpts','errSA','errNum','errMatch','errCalcVars','errCalcAns','errCalcOpts'].forEach(function(id){
      $(id).classList.remove('show');
      var f=ERRFIELDS[id]; if(f) $(f).setAttribute('aria-invalid','false');
    });
  }
  function showErr(id){ $(id).classList.add('show'); var f=ERRFIELDS[id]; if(f) $(f).setAttribute('aria-invalid','true'); }

  $('addBtn').onclick=function(){
    clearErrs(); var ok=true;
    var stmtHtml = stmt.innerHTML.trim();
    var needsStmt = true; // all types need a statement
    if(!stmt.textContent.trim()){ showErr('errStmt'); ok=false; }

    if(state.type==='multichoice'){
      var filled=state.opts.filter(function(o){return htmlHasText(o.text);});
      var corrects=state.opts.filter(function(o){return o.correct && htmlHasText(o.text);});
      var need = state.mcMulti ? corrects.length>=1 : corrects.length===1;
      if(filled.length<2 || !need){ showErr('errOpts'); ok=false; }
    } else if(state.type==='shortanswer'){
      var saFilled=state.saAnswers.filter(function(a){return a.text.trim();});
      var sa100=saFilled.some(function(a){return a.frac==='100';});
      if(!saFilled.length || !sa100){ showErr('errSA'); ok=false; }
    } else if(state.type==='numerical'){
      var numFilled=state.numAnswers.filter(function(a){return a.val.trim();});
      // "*" es el comodín de Moodle para "cualquier otra respuesta"; el resto deben ser números.
      var numValid=numFilled.length>0 && numFilled.every(function(a){
        return a.val.trim()==='*' || !isNaN(parseFloat(a.val.trim()));
      });
      var num100=numFilled.some(function(a){return a.frac==='100' && a.val.trim()!=='*';});
      if(!numValid || !num100){ showErr('errNum'); ok=false; }
      if(state.numUnitsOn && !state.numUnits.some(function(u){return u.name.trim();})){
        showErr('errNum'); toast('Escribe al menos una unidad o desactiva la casilla',true); ok=false;
      }
    } else if(isCalc(state.type)){
      var vnames=definedVarNames();
      var varsOk = vnames.length>0 && state.calcVars.every(function(v){
        if(!(v.name||'').trim()) return false;
        if(!/^[A-Za-z_]\w*$/.test(v.name.trim())) return false;   // Moodle no admite nombres raros
        var mn=parseFloat(v.min), mx=parseFloat(v.max);
        return isFinite(mn) && isFinite(mx) && mx>mn;
      });
      // Nombres repetidos: el dataset se pisaría a sí mismo
      var dup = vnames.some(function(n,i){ return vnames.indexOf(n)!==i; });
      if(!varsOk || dup){ showErr('errCalcVars'); ok=false;
        if(dup) $('errCalcVars').textContent='Hay dos variables con el mismo nombre.';
        else $('errCalcVars').textContent='Cada variable necesita un nombre válido (letras) y un rango con "desde" menor que "hasta".';
      }
      // Toda variable usada en el enunciado o en las fórmulas tiene que estar definida
      var usadas = varsUsed(stmt.textContent);
      if(state.type==='calculated'){
        var f=state.calcAns.trim();
        usadas = usadas.concat(varsUsed(f));
        if(!f || evalFormula(f, sampleVars(state.calcVars))==null){ showErr('errCalcAns'); ok=false; }
      } else {
        var cop=state.calcOpts.filter(function(o){return o.text.trim();});
        var corr=state.calcOpts.filter(function(o){return o.correct && o.text.trim();});
        cop.forEach(function(o){ usadas=usadas.concat(varsUsed(o.text)); });
        if(cop.length<2 || corr.length!==1){ showErr('errCalcOpts'); ok=false; }
      }
      var huerfanas = usadas.filter(function(n){ return vnames.indexOf(n)<0; });
      if(huerfanas.length){
        showErr('errCalcVars'); ok=false;
        $('errCalcVars').textContent='Usas {'+huerfanas.join('}, {')+'} pero no está definida como variable.';
      }
    } else if(state.type==='matching'){
      var pr=state.pairs.filter(function(p){return (htmlHasText(p.q)||p.image)&&p.a.trim();});
      if(pr.length<3){ showErr('errMatch'); ok=false; }
    } else if(state.type==='cloze'){
      if(countGaps(stmtHtml)<1){ showErr('errStmt'); $('errStmt').textContent='Agrega al menos un hueco con [[respuesta]].'; ok=false; }
      else { $('errStmt').textContent='El enunciado no puede estar vacío.'; }
    }
    // El texto alternativo de la imagen es opcional (no bloquea el guardado).
    if(!ok){ toast('Revisa los campos marcados',true); return; }

    var q={
      id: state.editingId || ('q'+Date.now()),
      type: state.type,
      name: ($('qname').value.trim() || autoName()),
      statement: stmtHtml,
      passageId: state.passageId||'',
      image: state.image ? {filename:state.image.filename, base64:state.image.base64, alt:state.image.alt.trim()} : null,
      tags: state.tags.slice(),
      genfb: $('genfb').value.trim(),
      grade: ($('grade').value.trim()||'1'),
      penalty: ($('penalty').value.trim()||'0'),
      shuffle: !!$('shuffle').checked
    };
    if(state.type==='multichoice'){
      q.single = !state.mcMulti;
      q.optsHtml = true;   // las opciones ya son HTML (pueden llevar fórmulas)
      q.opts = state.opts.filter(function(o){return htmlHasText(o.text);}).map(function(o){return {text:o.text.trim(),correct:o.correct};});
    } else if(state.type==='truefalse'){ q.tfVal=state.tfVal; }
    else if(state.type==='shortanswer'){ q.saCase=state.saCase;
      q.saAnswers=state.saAnswers.filter(function(a){return a.text.trim();}).map(function(a){return {text:a.text.trim(),frac:a.frac};}); }
    else if(state.type==='numerical'){
      q.numAnswers=state.numAnswers.filter(function(a){return a.val.trim();})
        .map(function(a){ return {val:a.val.trim(), tol:(a.tol.trim()||'0'), frac:a.frac}; });
      q.numUnitsOn=!!state.numUnitsOn;
      // El multiplicador de la primera unidad es 1 por definición (ver renderUnits).
      q.numUnits = state.numUnitsOn
        ? state.numUnits.filter(function(u){return u.name.trim();})
            .map(function(u,i){ return {name:u.name.trim(), mult:(i===0?'1':(String(u.mult).trim()||'1'))}; })
        : [];
    }
    else if(isCalc(state.type)){
      // Los valores del dataset se sortean AQUÍ, una sola vez, y se guardan con la
      // pregunta. Así el XML siempre coincide con lo que el docente vio, y volver a
      // exportar no cambia los números a mitad de un examen ya repartido.
      var nVar = parseInt(state.calcVariants,10)||5;
      q.calcVars = state.calcVars.map(function(v){
        var min=parseFloat(v.min), max=parseFloat(v.max), dec=parseInt(v.dec,10)||0;
        if(max<min){ var t=min; min=max; max=t; }
        var vals=[];
        for(var i=0;i<nVar;i++) vals.push((min+Math.random()*(max-min)).toFixed(dec));
        return {name:v.name.trim(), min:String(min), max:String(max), dec:String(dec), values:vals};
      });
      q.calcDec=state.calcDec; q.calcTol=state.calcTol; q.calcVariants=String(nVar);
      if(state.type==='calculated'){ q.calcAns=state.calcAns.trim(); }
      else{
        q.calcOpts = state.calcOpts.filter(function(o){return o.text.trim();})
          .map(function(o){ return {text:o.text.trim(), correct:!!o.correct}; });
      }
    }
    else if(state.type==='matching'){ q.pairsHtml=true; q.pairs=state.pairs.filter(function(p){return (htmlHasText(p.q)||p.image)&&p.a.trim();}).map(function(p){return {q:p.q.trim(),a:p.a.trim(),image:p.image?{filename:p.image.filename,base64:p.image.base64,alt:(p.image.alt||'').trim()}:null};}); }

    if(state.editingId){
      var idx=questions.findIndex(function(x){return x.id===state.editingId;});
      questions[idx]=q; toast('Pregunta actualizada');
    } else { questions.push(q); toast('Pregunta agregada'); }

    save(); renderTray(); resetForm();
  };

  $('clearBtn').onclick=resetForm;
  $('editBannerNewBtn').onclick=resetForm;
  function resetForm(){
    var keepType=state.type;
    state={ type:keepType, editingId:null,
      opts:freshOpts(), mcMulti:false, tfVal:true,
      saAnswers:freshSA(), saCase:false,
      numAnswers:freshNum(), numUnitsOn:false, numUnits:freshUnits(),
      calcVars:freshCalcVars(), calcAns:'', calcOpts:freshCalcOpts(),
      calcDec:'2', calcTol:'0.01', calcVariants:'5', calcSample:null, pairs:freshPairs(),
      image:null, tags:[], passageId:'', grade:'1', penalty:'0', genfb:'', shuffle:true };
    $('calcAns').value=''; $('calcDec').value='2'; $('calcTol').value='0.01'; $('calcVariants').value='5';
    stmt.innerHTML=''; $('qname').value=''; $('genfb').value=''; $('grade').value='1'; $('penalty').value='0';
    $('imgInput').value=''; $('mcMulti').checked=false; $('saCase').checked=false; $('shuffle').checked=true;
    $('numUnitsOn').checked=false;
    $('tagInput').value=''; $('errStmt').textContent='El enunciado no puede estar vacío.';
    $('addBtn').textContent='Agregar a la lista'; $('clearBtn').style.display='none';
    $('editBanner').style.display='none';
    $('tf').querySelector('.v').setAttribute('aria-pressed','true'); $('tf').querySelector('.f').setAttribute('aria-pressed','false');
    refreshPassageSelect();
    renderOpts(); renderSA(); renderNum(); renderUnits();
    renderCalcVars(); renderCalcOpts(); renderCalcSample(); renderMatch(); renderImg(); renderTags();
    applyType(); renderPreview(); clearErrs();
    document.querySelectorAll('.q-item').forEach(function(x){x.classList.remove('editing');});
  }

  // ---------- Tray ----------
  var TYPE_LABEL={multichoice:'Op. múltiple',truefalse:'V / F',shortanswer:'Resp. corta',numerical:'Numérica',
                  calculated:'Calculada',calculatedmulti:'Calc. múltiple',matching:'Emparejar',cloze:'Huecos',essay:'Ensayo'};
  function renderTray(){
    $('count').textContent=questions.length;
    if(!questions.length){
      tray.innerHTML='<div class="empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg><div>Aún no has agregado preguntas.</div></div>';
      $('downloadBtn').disabled=true; return;
    }
    $('downloadBtn').disabled=false;
    tray.innerHTML='';
    questions.forEach(function(q,i){
      var el=document.createElement('div'); el.className='q-item'+(q.id===state.editingId?' editing':'');
      var badge='<span class="q-badge '+q.type+'">'+(TYPE_LABEL[q.type]||q.type)+'</span>';
      var tagsHtml = (q.tags&&q.tags.length)? '<div class="q-tags">'+q.tags.map(function(t){return '<span>'+esc(t)+'</span>';}).join('')+'</div>':'';
      el.innerHTML =
        '<div class="q-top"><span class="q-idx">'+(i+1)+'.</span>'+badge+(q.image?'<span title="Tiene imagen">🖼️</span>':'')+(q.passageId?'<span title="Tiene lectura">📖</span>':'')+'<span class="q-title">'+esc(q.name)+'</span></div>'+
        '<div class="q-name">'+esc(stripTags(serializeMath(q.statement))||'(sin enunciado)')+'</div>'+
        tagsHtml+
        '<div class="q-actions">'+
          '<button data-act="edit">Editar</button>'+
          '<button data-act="dup">Duplicar</button>'+
          '<button data-act="del" class="danger">Eliminar</button>'+
        '</div>';
      el.querySelector('[data-act=edit]').onclick=function(){ editQ(q.id); };
      el.querySelector('[data-act=dup]').onclick=function(){ dupQ(q.id); };
      el.querySelector('[data-act=del]').onclick=function(){ delQ(q.id); };
      tray.appendChild(el);
    });
  }
  function editQ(id){
    var q=questions.find(function(x){return x.id===id;}); if(!q) return;
    state.editingId=id; state.type=q.type;
    state.tags=(q.tags||[]).slice(); state.passageId=q.passageId||'';
    state.image = q.image? {filename:q.image.filename, base64:q.image.base64, alt:q.image.alt, dataUrl:'data:image/'+(q.image.filename.slice(-3)==='png'?'png':'jpeg')+';base64,'+q.image.base64} : null;
    state.mcMulti = q.type==='multichoice' ? (q.single===false) : false;
    state.opts = q.type==='multichoice' ? (Array.isArray(q.opts)&&q.opts.length>=2 ? q.opts.map(function(o){return {text:o.text||'',correct:!!o.correct};}) : freshOpts()) : freshOpts();
    state.tfVal = q.type==='truefalse' ? q.tfVal : true;
    state.saAnswers = q.type==='shortanswer' ? q.saAnswers.map(function(a){return {text:a.text,frac:a.frac};}) : freshSA();
    state.saCase = q.type==='shortanswer' ? !!q.saCase : false;
    // migrateQ() ya garantiza que toda pregunta numérica guardada tenga numAnswers.
    state.numAnswers = q.type==='numerical' && Array.isArray(q.numAnswers) && q.numAnswers.length
      ? q.numAnswers.map(function(a){ return {val:String(a.val), tol:String(a.tol), frac:a.frac}; })
      : freshNum();
    state.numUnitsOn = q.type==='numerical' ? !!q.numUnitsOn : false;
    state.numUnits = q.type==='numerical' && Array.isArray(q.numUnits) && q.numUnits.length
      ? q.numUnits.map(function(u){ return {name:u.name, mult:String(u.mult)}; })
      : freshUnits();
    // Calculadas. Los `values` guardados no se recargan al formulario: el docente edita
    // rangos, y al volver a guardar se sortean de nuevo.
    state.calcVars = isCalc(q.type) && Array.isArray(q.calcVars) && q.calcVars.length
      ? q.calcVars.map(function(v){ return {name:v.name, min:String(v.min), max:String(v.max), dec:String(v.dec)}; })
      : freshCalcVars();
    state.calcAns = q.type==='calculated' ? (q.calcAns||'') : '';
    state.calcOpts = q.type==='calculatedmulti' && Array.isArray(q.calcOpts) && q.calcOpts.length>=2
      ? q.calcOpts.map(function(o){ return {text:o.text||'', correct:!!o.correct}; })
      : freshCalcOpts();
    state.calcDec = isCalc(q.type) ? (q.calcDec||'2') : '2';
    state.calcTol = isCalc(q.type) ? (q.calcTol||'0.01') : '0.01';
    state.calcVariants = isCalc(q.type) ? String(q.calcVariants||'5') : '5';
    state.calcSample = null;
    state.pairs = q.type==='matching' ? q.pairs.map(function(p){return {q:p.q,a:p.a,image:p.image?{filename:p.image.filename,base64:p.image.base64,alt:p.image.alt,dataUrl:'data:image/'+(p.image.filename.slice(-3)==='png'?'png':'jpeg')+';base64,'+p.image.base64}:null};}) : freshPairs();
    state.grade=q.grade||'1'; state.penalty=q.penalty!=null?q.penalty:'0'; state.genfb=q.genfb||''; state.shuffle=q.shuffle!==false;

    stmt.innerHTML=q.statement; $('qname').value=q.name; $('genfb').value=state.genfb;
    $('grade').value=state.grade; $('penalty').value=state.penalty;
    $('mcMulti').checked=state.mcMulti; $('saCase').checked=state.saCase; $('shuffle').checked=state.shuffle;
    $('numUnitsOn').checked=state.numUnitsOn;
    $('calcAns').value=state.calcAns; $('calcDec').value=state.calcDec;
    $('calcTol').value=state.calcTol; $('calcVariants').value=state.calcVariants;
    if(isMath(q.type)) lastMathType=q.type;
    $('tf').querySelector('.v').setAttribute('aria-pressed', state.tfVal?'true':'false');
    $('tf').querySelector('.f').setAttribute('aria-pressed', state.tfVal?'false':'true');
    $('addBtn').textContent='Actualizar pregunta'; $('clearBtn').style.display='inline-flex';
    $('editBannerName').textContent=q.name; $('editBanner').style.display='flex';
    refreshPassageSelect(); $('passageSel').value=state.passageId;
    renderOpts(); renderSA(); renderNum(); renderUnits();
    renderCalcVars(); renderCalcOpts(); renderCalcSample(); renderMatch(); renderImg(); renderTags();
    applyType(); renderPreview(); renderTray();
    window.scrollTo({top:0,behavior:'smooth'});
    stmt.focus(); // move keyboard focus into the form
  }
  function dupQ(id){
    var q=questions.find(function(x){return x.id===id;}); if(!q) return;
    var c=JSON.parse(JSON.stringify(q)); c.id='q'+Date.now(); c.name=q.name+' (copia)';
    var idx=questions.findIndex(function(x){return x.id===id;}); questions.splice(idx+1,0,c);
    save(); renderTray(); toast('Pregunta duplicada');
  }
  function delQ(id){
    if(!confirm('¿Eliminar esta pregunta?')) return;
    questions=questions.filter(function(x){return x.id!==id;});
    if(state.editingId===id) resetForm();
    save(); renderTray();
  }
  $('wipeBtn').onclick=function(){
    if(!questions.length) return;
    if(!confirm('¿Vaciar toda la lista? Esto no se puede deshacer.')) return;
    questions=[]; resetForm(); save(); renderTray(); toast('Lista vaciada');
  };
  $('category').addEventListener('input', save);

  // ---------- Backup: export / import JSON ----------
  function download(filename, text, mime){
    var blob=new Blob([text],{type:(mime||'text/plain')+';charset=utf-8'});
    var url=URL.createObjectURL(blob); var a=document.createElement('a');
    a.href=url; a.download=filename; document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function(){URL.revokeObjectURL(url);},1000);
  }
  $('exportBtn').onclick=function(){
    var data={version:2, app:'trendi_quizgen', category:$('category').value, questions:questions, passages:passages};
    var name=($('category').value.trim().replace(/[^\w\-]+/g,'_')||'respaldo_trendi')+'.json';
    download(name, JSON.stringify(data,null,2), 'application/json');
    toast('Respaldo JSON descargado');
  };
  $('importBtn').onclick=function(){ $('importInput').click(); };
  $('importInput').onchange=function(e){
    var file=e.target.files[0]; if(!file){ return; }
    var r=new FileReader();
    r.onload=function(){
      try{
        var d=JSON.parse(r.result);
        if(!d || !Array.isArray(d.questions)) throw new Error('formato');
        if(questions.length && !confirm('Esto reemplazará las '+questions.length+' pregunta(s) actuales por las del respaldo. ¿Continuar?')) return;
        questions=migrateAll(d.questions); passages=Array.isArray(d.passages)?d.passages:[];
        if(d.category!=null) $('category').value=d.category;
        save(); refreshPassageSelect(); renderTray(); resetForm();
        toast('Respaldo restaurado · '+questions.length+' pregunta(s)');
      }catch(err){ toast('Archivo no válido. Usa un respaldo JSON de esta herramienta.', true); }
    };
    r.readAsText(file); this.value='';
  };

  // ---------- XML EXPORT ----------
  function cdata(s){ return '<![CDATA['+String(s).replace(/\]\]>/g,']]&gt;')+']]>'; }
  function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function stripTags(s){ var d=document.createElement('div'); d.innerHTML=s; return (d.textContent||'').replace(/\s+/g,' ').trim(); }
  // ¿Este HTML tiene contenido real? Una fórmula sola no aporta texto propio, así que
  // también cuenta como "lleno" si hay un bloque <span class="fx">.
  function htmlHasText(html){
    if(!html) return false;
    if(String(html).indexOf('data-latex')>-1) return true;
    return !!stripTags(html);
  }
  function htmlText(s){ return '<text>'+cdata(s)+'</text>'; }
  function plainText(s){ return '<text>'+esc(s)+'</text>'; }
  function clozeEsc(s){ return String(s).replace(/([\\{}#~=])/g,'\\$1'); }

  // Convierte nuestra sintaxis amigable [[respuesta]] a la sintaxis nativa "cloze" de
  // Moodle: {1:SHORTANSWER:=respuesta~=alternativa}. El "=" marca la respuesta válida.
  // clozeEsc() escapa los caracteres { } # ~ = que tienen significado especial en cloze.
  function compileCloze(html){
    return html.replace(/\[\[([^\]]+)\]\]/g, function(m, inner){
      var alts=inner.split('|').map(function(s){return s.trim();}).filter(Boolean);
      if(!alts.length) return m;
      var body=alts.map(function(a,i){ return (i===0?'=':'~=')+clozeEsc(a); }).join('');
      return '{1:SHORTANSWER:'+body+'}';
    });
  }

  // Arma el HTML del enunciado que verá el estudiante: antepone la lectura/estímulo
  // (si la hay), inserta el texto y, si hay imagen, la referencia con la ruta mágica
  // "@@PLUGINFILE@@" que Moodle reemplaza por el archivo embebido (ver fileTag()).
  function buildStatement(q){
    var html='';
    var pass = passages.find(function(p){return p.id===q.passageId;});
    if(pass) html += '<div>'+pass.html+'</div><hr>';
    // serializeMath() convierte los bloques de fórmula a \( … \) para MathJax.
    var body = serializeMath(q.statement);
    html += (q.type==='cloze') ? compileCloze(body) : body;
    if(q.image){ html += '<p><img src="@@PLUGINFILE@@/'+q.image.filename+'" alt="'+esc(q.image.alt)+'"></p>'; }
    return html;
  }
  function fileTag(img){
    return '\n      <file name="'+esc(img.filename)+'" path="/" encoding="base64">'+img.base64+'</file>';
  }
  function tagsXML(q){
    if(!q.tags || !q.tags.length) return '';
    var x='\n    <tags>';
    q.tags.forEach(function(t){ x+='\n      <tag>'+plainText(t)+'</tag>'; });
    return x+'\n    </tags>';
  }
  function commonXML(q){
    var qt = '\n    <questiontext format="html">\n      '+htmlText(buildStatement(q))+
             (q.image? fileTag(q.image):'') + '\n    </questiontext>';
    return '\n    <name>'+plainText(q.name)+'</name>'+
      qt +
      '\n    <generalfeedback format="html">'+htmlText(q.genfb||'')+'</generalfeedback>'+
      '\n    <defaultgrade>'+esc(q.grade)+'</defaultgrade>'+
      '\n    <penalty>'+esc(q.penalty!=null?q.penalty:'0')+'</penalty>'+
      '\n    <hidden>0</hidden>'+
      tagsXML(q);
  }
  function mcFractions(q){
    // returns a function mapping a correct/incorrect flag to a valid Moodle fraction
    if(q.single!==false){ return function(o){ return o.correct?'100':'0'; }; }
    var nc=q.opts.filter(function(o){return o.correct;}).length || 1;
    var f=FRACS[nc]||String((100/nc).toFixed(5));
    return function(o){ return o.correct? f : '0'; };
  }

  function questionXML(q){
    var x='';
    if(q.type==='multichoice'){
      var frac=mcFractions(q);
      x += '\n  <question type="multichoice">'+commonXML(q)+
           '\n    <single>'+(q.single!==false?'true':'false')+'</single>'+
           '\n    <shuffleanswers>'+(q.shuffle!==false?'true':'false')+'</shuffleanswers>'+
           '\n    <answernumbering>abc</answernumbering>'+
           '\n    <correctfeedback format="html"><text>Respuesta correcta.</text></correctfeedback>'+
           '\n    <partiallycorrectfeedback format="html"><text>Respuesta parcialmente correcta.</text></partiallycorrectfeedback>'+
           '\n    <incorrectfeedback format="html"><text>Respuesta incorrecta.</text></incorrectfeedback>';
      q.opts.forEach(function(o){
        // La opción ya es HTML: serializeMath() convierte sus fórmulas a \( … \).
        // Comprobado en Moodle: el filtro MathJax también actúa sobre las opciones.
        x += '\n    <answer fraction="'+frac(o)+'" format="html">'+
             htmlText('<p>'+serializeMath(o.text)+'</p>')+
             '<feedback format="html"><text></text></feedback></answer>';
      });
      x += '\n  </question>';

    } else if(q.type==='truefalse'){
      x += '\n  <question type="truefalse">'+commonXML(q)+
           '\n    <answer fraction="'+(q.tfVal?'100':'0')+'" format="moodle_auto_format"><text>true</text>'+
           '<feedback format="html"><text></text></feedback></answer>'+
           '\n    <answer fraction="'+(q.tfVal?'0':'100')+'" format="moodle_auto_format"><text>false</text>'+
           '<feedback format="html"><text></text></feedback></answer>'+
           '\n  </question>';

    } else if(q.type==='shortanswer'){
      x += '\n  <question type="shortanswer">'+commonXML(q)+
           '\n    <usecase>'+(q.saCase?'1':'0')+'</usecase>';
      q.saAnswers.forEach(function(a){
        x += '\n    <answer fraction="'+esc(a.frac)+'" format="moodle_auto_format">'+plainText(a.text)+
             '<feedback format="html"><text></text></feedback></answer>';
      });
      x += '\n  </question>';

    } else if(q.type==='numerical'){
      // Orden exigido por Moodle: primero TODOS los <answer>, después <units> y por
      // último los ajustes de unidades. Cada <answer> lleva su propia <tolerance>.
      x += '\n  <question type="numerical">'+commonXML(q);
      (q.numAnswers||[]).forEach(function(a){
        x += '\n    <answer fraction="'+esc(a.frac)+'" format="moodle_auto_format">'+plainText(a.val)+
             '<feedback format="html"><text></text></feedback>'+
             '<tolerance>'+esc(a.tol||'0')+'</tolerance></answer>';
      });
      var units = q.numUnitsOn ? (q.numUnits||[]).filter(function(u){return u.name;}) : [];
      if(units.length){
        x += '\n    <units>';
        units.forEach(function(u){
          x += '\n      <unit><multiplier>'+esc(u.mult||'1')+'</multiplier><unit_name>'+esc(u.name)+'</unit_name></unit>';
        });
        x += '\n    </units>';
        // showunits=0 → el estudiante escribe la unidad en un campo de texto.
        // unitgradingtype=1 → la unidad se califica y resta unitpenalty si está mal.
        x += '\n    <unitgradingtype>1</unitgradingtype><unitpenalty>0.1</unitpenalty><showunits>0</showunits><unitsleft>0</unitsleft>';
      } else {
        // showunits=3 → no se usan unidades en absoluto.
        x += '\n    <unitgradingtype>0</unitgradingtype><unitpenalty>0</unitpenalty><showunits>3</showunits><unitsleft>0</unitsleft>';
      }
      x += '\n  </question>';

    } else if(isCalc(q.type)){
      // Estructura verificada importando en Moodle (ver "Verificado…" en CLAUDE.md).
      // Se usa "calculatedsimple" para la de respuesta única porque lleva sus datasets
      // dentro de la propia pregunta (status=private), sin depender de datos compartidos.
      var qtype = q.type==='calculated' ? 'calculatedsimple' : 'calculatedmulti';
      var len = String(parseInt(q.calcDec,10)||0);
      var tol = String(q.calcTol||'0');
      // tolerancetype=1 → tolerancia RELATIVA (una fracción, 0.01 = 1 %). Es el único
      // valor comprobado contra un Moodle real; no cambiarlo sin volver a probar.
      function calcAnswer(text, fraction){
        return '\n    <answer fraction="'+fraction+'" format="moodle_auto_format">'+
               '\n      <text>'+esc(text)+'</text>'+
               '\n      <tolerance>'+esc(tol)+'</tolerance>'+
               '\n      <tolerancetype>1</tolerancetype>'+
               '\n      <correctanswerformat>1</correctanswerformat>'+
               '\n      <correctanswerlength>'+len+'</correctanswerlength>'+
               '\n      <feedback format="html"><text></text></feedback>'+
               '\n    </answer>';
      }
      x += '\n  <question type="'+qtype+'">'+commonXML(q)+
           '\n    <synchronize>0</synchronize>'+
           '\n    <single>'+(q.type==='calculatedmulti'?'1':'0')+'</single>'+
           '\n    <answernumbering>abc</answernumbering>'+
           '\n    <shuffleanswers>'+(q.type==='calculatedmulti' && q.shuffle!==false?'1':'0')+'</shuffleanswers>'+
           '\n    <correctfeedback format="html"><text>Respuesta correcta.</text></correctfeedback>'+
           '\n    <partiallycorrectfeedback format="html"><text>Respuesta parcialmente correcta.</text></partiallycorrectfeedback>'+
           '\n    <incorrectfeedback format="html"><text>Respuesta incorrecta.</text></incorrectfeedback>';

      if(q.type==='calculated'){
        x += calcAnswer(q.calcAns||'0', '100');
      } else {
        // COMPROBADO: una opción escrita como "{a}+{b}" se muestra LITERAL. Para que
        // Moodle calcule hay que envolverla en {= … }. Si el docente ya la escribió
        // así (para mezclar texto y fórmula), se respeta tal cual.
        (q.calcOpts||[]).forEach(function(o){
          var t=o.text.indexOf('{=')>-1 ? o.text : '{='+o.text+'}';
          x += calcAnswer(t, o.correct?'100':'0');
        });
      }
      x += '\n    <unitgradingtype>0</unitgradingtype><unitpenalty>0</unitpenalty><showunits>3</showunits><unitsleft>0</unitsleft>';

      x += '\n    <dataset_definitions>';
      (q.calcVars||[]).forEach(function(v){
        x += '\n      <dataset_definition>'+
             '\n        <status><text>private</text></status>'+
             '\n        <name><text>'+esc(v.name)+'</text></name>'+
             '\n        <type>calculated</type>'+
             '\n        <distribution><text>uniform</text></distribution>'+
             '\n        <minimum><text>'+esc(v.min)+'</text></minimum>'+
             '\n        <maximum><text>'+esc(v.max)+'</text></maximum>'+
             '\n        <decimals><text>'+esc(v.dec)+'</text></decimals>'+
             '\n        <itemcount>'+(v.values||[]).length+'</itemcount>'+
             '\n        <dataset_items>';
        (v.values||[]).forEach(function(val,i){
          x += '\n          <dataset_item><number>'+(i+1)+'</number><value>'+esc(val)+'</value></dataset_item>';
        });
        x += '\n        </dataset_items>'+
             '\n        <number_of_items>'+(v.values||[]).length+'</number_of_items>'+
             '\n      </dataset_definition>';
      });
      x += '\n    </dataset_definitions>'+
           '\n  </question>';

    } else if(q.type==='matching'){
      x += '\n  <question type="matching">'+commonXML(q)+
           '\n    <shuffleanswers>'+(q.shuffle!==false?'true':'false')+'</shuffleanswers>'+
           '\n    <correctfeedback format="html"><text>Respuesta correcta.</text></correctfeedback>'+
           '\n    <partiallycorrectfeedback format="html"><text>Respuesta parcialmente correcta.</text></partiallycorrectfeedback>'+
           '\n    <incorrectfeedback format="html"><text>Respuesta incorrecta.</text></incorrectfeedback>';
      q.pairs.forEach(function(p){
        var stemHtml = '<p>'+(htmlHasText(p.q)?serializeMath(p.q):'')+(p.image?'<img src="@@PLUGINFILE@@/'+p.image.filename+'" alt="'+esc(p.image.alt||'')+'">':'')+'</p>';
        x += '\n    <subquestion format="html">'+htmlText(stemHtml)+
             (p.image? fileTag(p.image):'') +
             '<answer>'+plainText(p.a)+'</answer></subquestion>';
      });
      x += '\n  </question>';

    } else if(q.type==='cloze'){
      // El tipo "cloze" NO usa commonXML(): su esquema en Moodle es distinto
      // (no lleva <defaultgrade> ni bloques de answer; el puntaje va dentro de
      // la propia sintaxis {1:SHORTANSWER:...}). Por eso se arma a mano aquí.
      x += '\n  <question type="cloze">'+
           '\n    <name>'+plainText(q.name)+'</name>'+
           '\n    <questiontext format="html">\n      '+htmlText(buildStatement(q))+
           (q.image? fileTag(q.image):'')+'\n    </questiontext>'+
           '\n    <generalfeedback format="html">'+htmlText(q.genfb||'')+'</generalfeedback>'+
           '\n    <penalty>'+esc(q.penalty!=null?q.penalty:'0')+'</penalty>'+
           '\n    <hidden>0</hidden>'+
           tagsXML(q)+
           '\n  </question>';

    } else if(q.type==='essay'){
      x += '\n  <question type="essay">'+commonXML(q)+
           '\n    <responseformat>editor</responseformat>'+
           '\n    <responserequired>1</responserequired>'+
           '\n    <responsefieldlines>10</responsefieldlines>'+
           '\n    <attachments>0</attachments>'+
           '\n    <attachmentsrequired>0</attachmentsrequired>'+
           '\n    <graderinfo format="html"><text></text></graderinfo>'+
           '\n    <responsetemplate format="html"><text></text></responsetemplate>'+
           '\n  </question>';
    }
    return x;
  }

  // Construye el archivo XML completo que se descarga. Recorre todas las preguntas
  // y las concatena dentro de <quiz>...</quiz>.
  function buildXML(){
    var cat = $('category').value.trim();
    var out = '<?xml version="1.0" encoding="UTF-8"?>\n<quiz>';
    if(cat){
      // Pregunta especial "category": le dice a Moodle en qué carpeta del banco
      // de preguntas colocar todo lo que viene después. "$course$/top/" = raíz del curso.
      out += '\n  <question type="category">\n    <category>'+plainText('$course$/top/'+cat)+'</category>'+
             '\n    <info format="html"><text></text></info>\n  </question>';
    }
    questions.forEach(function(q){ out += questionXML(q); });
    out += '\n</quiz>\n';
    return out;
  }

  $('downloadBtn').onclick=function(){
    if(!questions.length){ toast('Agrega al menos una pregunta',true); return; }
    var cat=$('category').value.trim().replace(/[^\w\-]+/g,'_') || 'cuestionario_trendi';
    download(cat+'.xml', buildXML(), 'application/xml');
    toast('XML descargado · súbelo a tu banco de preguntas');
  };

   // ---------- WORD EXPORT ----------
  $('downloadWordBtn').onclick=function(){
    if(!questions.length){ toast('Agrega al menos una pregunta',true); return; }
    var catName = $('category').value.trim() || 'Evaluacion_Trendi';

    // 1. Estructura base del documento Word
    var wordContent = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">';
    wordContent += '<head><meta charset="utf-8"><title>' + esc(catName) + '</title>';
    wordContent += '<style>';
    wordContent += 'body { font-family: "Arial", sans-serif; font-size: 11pt; color: #000; } ';
    wordContent += 'h1 { text-align: center; font-size: 16pt; margin-bottom: 24px; } ';
    wordContent += '.question { margin-bottom: 24px; page-break-inside: avoid; } ';
    wordContent += '.passage { padding: 12px; border: 1px solid #ccc; margin-bottom: 12px; background: #f9f9f9; font-style: italic; }';
    wordContent += '.opts { list-style-type: none; padding-left: 0; margin-top: 8px; } ';
    wordContent += '.opts li { margin-bottom: 6px; } ';
    wordContent += '</style></head><body>';
    wordContent += '<h1>' + esc(catName.replace(/_/g, ' ')) + '</h1><hr><br>';

    // 2. Iterar sobre cada pregunta guardada en la lista
    questions.forEach(function(q, i) {
      wordContent += '<div class="question">';
      wordContent += '<p style="font-weight:bold; margin-bottom: 8px;">' + (i + 1) + '.</p>';

      // A) Insertar lectura si la pregunta tiene una asociada
      if(q.passageId) {
        var pass = passages.find(function(p){return p.id===q.passageId;});
        if(pass) wordContent += '<div class="passage">' + pass.html + '</div>';
      }

      // B) Insertar el enunciado (limpiando sintaxis cloze si aplica)
      // Word no renderiza LaTeX: sale el código literal entre \( \). Se corrige en la Fase 5.
      var stmtWord = serializeMath(q.statement);
      // En papel no puede haber {a}: se imprime la PRIMERA variante, ya con números.
      if(isCalc(q.type)) stmtWord = substCalc(stmtWord, calcVariantVals(q,0), q.calcDec);
      var stmtClean = q.type === 'cloze' ? stmtWord.replace(/\[\[([^\]]+)\]\]/g, ' ________ ') : stmtWord;
      wordContent += '<div>' + stmtClean + '</div>';

      // C) Insertar imagen si la tiene (se inserta en base64 para que Word la lea sin internet)
      if(q.image) {
        var mime = q.image.filename.slice(-3) === 'png' ? 'png' : 'jpeg';
        wordContent += '<p><img src="data:image/' + mime + ';base64,' + q.image.base64 + '" style="max-width:100%;" alt="' + esc(q.image.alt) + '"></p>';
      }

      // D) Dibujar las opciones de respuesta según el tipo (Versión estudiante)
      if(q.type === 'multichoice') {
        wordContent += '<ul class="opts">';
        // Creamos un array con las letras para asignarlas automáticamente
        var letras = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
        q.opts.forEach(function(o, index) { 
            var letra = letras[index] || '•';
            // Word no renderiza LaTeX: sale el código entre \( \) (se corrige en Fase 5).
            wordContent += '<li>' + letra + ') ' + serializeMath(o.text) + '</li>';
        });
        wordContent += '</ul>';
      } else if (q.type === 'truefalse') {
        wordContent += '<ul class="opts"><li>( &nbsp; ) Verdadero</li><li>( &nbsp; ) Falso</li></ul>';
      } else if (q.type === 'calculatedmulti') {
        var wv = calcVariantVals(q,0);
        wordContent += '<ul class="opts">';
        var wLetras = ['A','B','C','D','E','F','G','H'];
        (q.calcOpts||[]).forEach(function(o, index){
          var t=o.text.trim();
          var shown = t.indexOf('{=')>-1 ? substCalc(t, wv, q.calcDec)
                    : (function(){ var r=evalFormula(t, wv); return r==null?t:fmtCalc(r, q.calcDec); })();
          wordContent += '<li>' + (wLetras[index]||'•') + ') ' + esc(shown) + '</li>';
        });
        wordContent += '</ul>';
      } else if (q.type === 'calculated') {
        wordContent += '<p><br>Respuesta: _________________________________________</p>';
      } else if (q.type === 'numerical') {
        // Si la pregunta pide unidad, se le avisa al estudiante en el impreso.
        var wUnits = q.numUnitsOn ? (q.numUnits||[]).filter(function(u){return u.name;}) : [];
        var wNote = wUnits.length
          ? ' <i>(incluye la unidad: ' + esc(wUnits.map(function(u){return u.name;}).join(' o ')) + ')</i>'
          : '';
        wordContent += '<p><br>Respuesta: _________________________________________' + wNote + '</p>';
      } else if (q.type === 'shortanswer' || q.type === 'cloze') {
        wordContent += '<p><br>Respuesta: _________________________________________</p>';
      } else if (q.type === 'matching') {
        wordContent += '<ul class="opts">';
        q.pairs.forEach(function(p) {
          var mime = p.image ? (p.image.filename.slice(-3)==='png'?'png':'jpeg') : '';
          var imgHtml = p.image ? '<img src="data:image/' + mime + ';base64,' + p.image.base64 + '" style="max-width:80px;max-height:60px;vertical-align:middle;margin-right:8px;" alt="' + esc(p.image.alt||'') + '">' : '';
          wordContent += '<li>' + imgHtml + serializeMath(p.q) + ' &nbsp; _______________________</li>';
        });
        wordContent += '</ul>';
      } else if (q.type === 'essay') {
        wordContent += '<p><br>___________________________________________________________________<br><br>___________________________________________________________________<br><br>___________________________________________________________________</p>';
      }

      wordContent += '</div>';
    });

    wordContent += '</body></html>';

    // 3. Generar y descargar el archivo
    var blob = new Blob(['\ufeff', wordContent], { type: 'application/msword' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = (catName.replace(/[^\w\-]+/g, '_')) + '.doc';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
    
    toast('Evaluación descargada en Word');
  };
   
  // ---------- Generador con IA ----------
  $('aiOpenBtn').onclick=function(){
    var d=$('aiDlg'); if(d.showModal) d.showModal(); else d.setAttribute('open','');
  };
  $('helpOpenBtn').onclick=function(){
    var d=$('helpDlg'); if(d.showModal) d.showModal(); else d.setAttribute('open','');
  };

  function buildAIPrompt(){
    var n=parseInt($('aiCount').value,10); if(isNaN(n)||n<1) n=3; if(n>20) n=20;
    var grado=$('aiGrade').value.trim()||'(no especificado)';
    var asig=$('aiSubject').value.trim()||'(no especificada)';
    var tema=$('aiTopic').value.trim()||'(no especificado)';
    var compRaw=$('aiComp').value.trim();
    var compLine = compRaw
      ? '- Competencia(s) a evaluar: '+compRaw+'\n'
      : '- Competencia(s) a evaluar: no se especificaron; elige tú las competencias más pertinentes para el grado y el tema, siguiendo el enfoque del ICFES.\n';
    return 'Actúa como un experto en diseño de evaluaciones educativas bajo el modelo basado en evidencias del ICFES (Instituto Colombiano para la Evaluación de la Educación). Tu objetivo es diseñar preguntas de selección múltiple con única respuesta que evalúen competencias y no la simple memorización de datos.\n\n'+
      'Por favor, genera '+n+' preguntas basadas en los siguientes datos de la asignatura:\n'+
      '- Grado: '+grado+'\n'+
      '- Asignatura: '+asig+'\n'+
      '- Tema(s): '+tema+'\n'+
      compLine+'\n'+
      'Requisitos estrictos para cada pregunta:\n'+
      '1. Contexto o estímulo: cada pregunta debe iniciar con una situación de la vida real, un caso, un gráfico descrito en texto, un experimento o un fragmento de texto analítico. El estudiante debe necesitar leer y analizar el contexto para responder.\n'+
      '2. Enunciado claro: una pregunta directa derivada del contexto.\n'+
      '3. Cuatro opciones de respuesta (A, B, C, D):\n'+
      '- Solo UNA debe ser la respuesta correcta y metodológicamente irreprochable.\n'+
      '- Las otras tres deben ser distractores plausibles (que parezcan correctos si el estudiante tiene un error conceptual común, pero que sean falsos). Evita distractores absurdos o el uso de "todas las anteriores".\n'+
      '4. Al final de cada pregunta indica la opción correcta únicamente con la línea "ANSWER:" seguida de la letra correspondiente (ejemplo: ANSWER: B).\n\n'+
      'Entrega el resultado exclusivamente en texto plano con formato Aiken: primero el enunciado (puede ocupar varias líneas, incluyendo el contexto), luego las cuatro opciones una por línea con el formato "A) texto", "B) texto", "C) texto" y "D) texto", y por último la línea "ANSWER: X". No numeres las preguntas, no uses viñetas, negrillas, tablas, bloques de código ni formatos interactivos. Separa cada pregunta de la siguiente con una línea en blanco.';
  }

  function legacyCopy(txt){
    try{
      var host=$('aiDlg');
      var ta=document.createElement('textarea');
      ta.value=txt; ta.style.position='fixed'; ta.style.opacity='0';
      host.appendChild(ta); ta.focus(); ta.select();
      var done=document.execCommand('copy');
      host.removeChild(ta);
      return done;
    }catch(e){ return false; }
  }
  $('aiCopyBtn').onclick=function(){
    var txt=buildAIPrompt();
    var ok=function(){ toast('Instrucción copiada · pégala en tu IA favorita'); };
    var ko=function(){ toast('No se pudo copiar automáticamente. Intenta de nuevo.', true); };
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(txt).then(ok, function(){ legacyCopy(txt)?ok():ko(); });
    } else { legacyCopy(txt)?ok():ko(); }
  };

  // Parser Aiken resiliente: enunciado multilínea -> opciones "A)" / "A." -> "ANSWER: X".
  // El formato Aiken es el estándar de texto plano que pedimos a la IA. Este parser
  // es tolerante: ignora numeraciones ("1.", "Pregunta 1:"), acepta opciones con ")" o "."
  // y une líneas sueltas a la opción anterior, para soportar las pequeñas variaciones
  // que distintas IA (ChatGPT, Claude, Gemini) introducen en su salida.
  function parseAiken(text){
    var lines=String(text).replace(/\r/g,'').split('\n');
    var out=[], stmtLines=[], opts=[], skipped=0;
    function flush(ansLetter){
      var idx = ansLetter ? ansLetter.toUpperCase().charCodeAt(0)-65 : -1;
      if(stmtLines.length && opts.length>=2 && idx>=0 && idx<opts.length){
        opts.forEach(function(o,i){ o.correct=(i===idx); });
        out.push({statement:stmtLines.join('\n'), opts:opts});
      } else if(stmtLines.length || opts.length){ skipped++; }
      stmtLines=[]; opts=[];
    }
    for(var i=0;i<lines.length;i++){
      var ln=lines[i].trim();
      if(!ln) continue; // líneas vacías: se ignoran (separadores)
      var mAns=ln.match(/^ANSWER\s*[:\.]?\s*([A-Ja-j])\b/i);
      if(mAns){ flush(mAns[1]); continue; }
      var mOpt=ln.match(/^([A-Ja-j])[\)\.]\s*(\S.*)$/);
      if(mOpt){
        var li=mOpt[1].toUpperCase().charCodeAt(0)-65;
        // Solo se acepta como opción si sigue la secuencia (A, B, C…); evita confundir texto del contexto
        if(li===opts.length && (li>0 || stmtLines.length)){ opts.push({text:mOpt[2].trim(), correct:false}); continue; }
      }
      if(opts.length){
        // Texto entre opciones y ANSWER → continuación de la última opción
        opts[opts.length-1].text += ' '+ln;
      } else {
        // Primera línea: quita numeraciones tipo "1." o "Pregunta 1:" que algunas IA agregan
        if(!stmtLines.length) ln=ln.replace(/^(pregunta\s*)?\d+\s*[\.\):—-]\s*/i,'');
        if(ln) stmtLines.push(ln);
      }
    }
    flush(null);
    return {questions:out, skipped:skipped};
  }

  function importAiken(text){
    var res=parseAiken(text);
    if(!res.questions.length){
      toast('No se encontraron preguntas en formato Aiken. Revisa el texto.', true);
      return;
    }
    var stamp=Date.now();
    res.questions.forEach(function(p,k){
      var stmtHtml=p.statement.split('\n').map(function(l){return esc(l);}).join('<br>');
      var cleanOpts=(p.opts||[]).filter(function(o){return o && String(o.text).trim();})
        .map(function(o){return {text:String(o.text).trim(), correct:!!o.correct};});
      if(cleanOpts.length<2 || !cleanOpts.some(function(o){return o.correct;})){ res.skipped++; return; }
      questions.push({
        id:'q'+stamp+'_'+k,
        type:'multichoice',
        name:autoName(),
        statement:stmtHtml,
        passageId:'', image:null, tags:[], genfb:'',
        grade:'1', penalty:'0', shuffle:true,
        single:true,
        opts:cleanOpts
      });
    });
    save(); renderTray();
    var msg=res.questions.length+' pregunta(s) importadas con éxito';
    if(res.skipped) msg+=' · '+res.skipped+' bloque(s) ignorados por formato incompleto';
    toast(msg, !!0);
    $('aiPaste').value='';
    var d=$('aiDlg'); if(d.close) d.close(); else d.removeAttribute('open');
  }

  $('aiImportBtn').onclick=function(){
    var pasted=$('aiPaste').value.trim();
    if(pasted){
      importAiken(pasted);
    } else {
      toast('Pega la respuesta de la IA en el recuadro', true);
    }
  };

  // ---------- Toast ----------
  var toastT;
  function toast(msg,err){
    var t=$('toast'); t.textContent=msg; t.className='toast show'+(err?' err':'');
    clearTimeout(toastT); toastT=setTimeout(function(){t.className='toast'+(err?' err':'');},3200);
  }

  // ---------- Init ----------
  // Arranque: carga lo guardado de sesiones anteriores y dibuja toda la interfaz
  // por primera vez. Se ejecuta una sola vez, al cargar la página.
  load(); refreshPassageSelect();
  renderOpts(); renderSA(); renderNum(); renderUnits();
  renderCalcVars(); renderCalcOpts(); renderCalcSample(); renderMatch(); renderImg(); renderTags();
  applyType(); renderPreview(); renderTray();
})();
