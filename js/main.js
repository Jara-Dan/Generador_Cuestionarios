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
  function freshPairs(){ return [{q:'',a:''},{q:'',a:''},{q:'',a:''}]; }
  // `state` = la pregunta que se está editando AHORA (un borrador en memoria).
  // Al pulsar "Agregar a la lista" se valida y se copia a `questions`. `editingId`
  // distingue entre crear una nueva (null) o estar editando una existente (su id).
  var state = {
    type:'multichoice', editingId:null,
    opts:freshOpts(), mcMulti:false,
    tfVal:true,
    saAnswers:freshSA(), saCase:false,
    numAns:'', numTol:'0',
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
      if(d){ questions = d.q||[]; passages = d.passages||[]; if(d.cat) $('category').value=d.cat; }
    }catch(e){}
  }

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
    if(cmd==='math'){ document.execCommand('insertText', false, '\\(  \\)'); }
    else{ document.execCommand(cmd, false, null); }
    target.focus();
  }
  document.querySelectorAll('.rt-tools button[data-cmd]').forEach(function(b){
    b.addEventListener('mousedown', function(e){ e.preventDefault(); rtCmd(b.dataset.cmd, stmt); renderPreview(); });
  });
  // Paste as plain text (kills messy Word/HTML markup)
  function plainPaste(e){
    e.preventDefault();
    var text=(e.clipboardData||window.clipboardData).getData('text/plain');
    document.execCommand('insertText', false, text);
  }
  stmt.addEventListener('paste', plainPaste);
  stmt.addEventListener('input', function(){ renderPreview(); if(state.type==='cloze') updateGapCount(); });

  // ---------- Type switch ----------
  var BLOCKS={multichoice:'mcBlock',truefalse:'tfBlock',shortanswer:'saBlock',numerical:'numBlock',matching:'matchBlock',cloze:null,essay:'essayBlock'};
  function applyType(){
    document.querySelectorAll('#types button').forEach(function(x){
      x.setAttribute('aria-pressed', x.dataset.type===state.type ? 'true':'false');
    });
    Object.keys(BLOCKS).forEach(function(t){
      if(BLOCKS[t]) $(BLOCKS[t]).style.display = (t===state.type)?'block':'none';
    });
    $('clozeHint').style.display = state.type==='cloze'?'block':'none';
    // shuffle only meaningful for multichoice & matching
    $('shuffleWrap').style.display = (state.type==='multichoice'||state.type==='matching')?'flex':'none';
    $('stmtLabel').firstChild.textContent = state.type==='cloze' ? 'Texto con huecos ' : 'Enunciado de la pregunta ';
    if(state.type==='cloze') updateGapCount();
  }
  $('types').addEventListener('click', function(e){
    var b = e.target.closest('button'); if(!b) return;
    state.type = b.dataset.type;
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
      var inp=document.createElement('input'); inp.type='text'; inp.value=o.text;
      inp.placeholder='Opción '+(i+1); inp.setAttribute('aria-label','Texto de la opción '+(i+1));
      inp.oninput=function(){ o.text=inp.value; renderPreview(); };
      var del=document.createElement('button'); del.type='button'; del.className='del'; del.innerHTML='×';
      del.title='Eliminar'; del.setAttribute('aria-label','Eliminar la opción '+(i+1));
      del.onclick=function(){ if(state.opts.length<=2){toast('Mínimo 2 opciones',true);return;}
        state.opts.splice(i,1); if(!state.opts.some(function(x){return x.correct;})) state.opts[0].correct=true;
        renderOpts(); renderPreview(); };
      row.appendChild(mark); row.appendChild(inp); row.appendChild(del);
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
  $('numAns').addEventListener('input',function(){ state.numAns=this.value; renderPreview(); });
  $('numTol').addEventListener('input',function(){ state.numTol=this.value; renderPreview(); });

  // ---------- Matching ----------
  function renderMatch(){
    var list=$('matchList'); list.innerHTML='';
    state.pairs.forEach(function(p,i){
      var row=document.createElement('div'); row.className='pair-row';
      var q=document.createElement('input'); q.type='text'; q.value=p.q;
      q.placeholder='Elemento '+(i+1); q.setAttribute('aria-label','Elemento '+(i+1));
      q.oninput=function(){ p.q=q.value; renderPreview(); };
      var arrow=document.createElement('span'); arrow.className='arrow'; arrow.textContent='→'; arrow.setAttribute('aria-hidden','true');
      var a=document.createElement('input'); a.type='text'; a.value=p.a;
      a.placeholder='Su respuesta'; a.setAttribute('aria-label','Respuesta del elemento '+(i+1));
      a.oninput=function(){ p.a=a.value; renderPreview(); };
      var del=document.createElement('button'); del.type='button'; del.className='del'; del.innerHTML='×';
      del.title='Eliminar'; del.setAttribute('aria-label','Eliminar la pareja '+(i+1));
      del.onclick=function(){ if(state.pairs.length<=3){toast('Mínimo 3 parejas',true);return;}
        state.pairs.splice(i,1); renderMatch(); renderPreview(); };
      row.appendChild(q); row.appendChild(arrow); row.appendChild(a); row.appendChild(del);
      list.appendChild(row);
    });
  }
  $('addPair').onclick=function(){ state.pairs.push({q:'',a:''}); renderMatch(); };

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
    if(state.type==='cloze'){
      h = h.replace(/\[\[([^\]]+)\]\]/g, function(_,inner){ return '<span class="gap">'+esc(inner.split('|')[0])+'</span>'; });
    }
    html += '<div class="prev-stmt">'+(h||'<span style="color:#b3b0a8">Sin enunciado…</span>');
    if(state.image) html += '<img src="'+state.image.dataUrl+'" alt="'+esc(state.image.alt||'')+'">';
    html += '</div>';

    if(state.type==='multichoice'){
      state.opts.forEach(function(o){
        html += '<div class="prev-opt'+(o.correct?' ok':'')+'"><span class="circle'+(state.mcMulti?' sq':'')+'">'+(o.correct?'✓':'')+'</span>'+
                (o.text? esc(o.text):'<span style="color:#b3b0a8">(vacía)</span>')+(o.correct?'<span class="ok-tag">Correcta</span>':'')+'</div>';
      });
    } else if(state.type==='truefalse'){
      html += '<div class="prev-opt'+(state.tfVal?' ok':'')+'"><span class="circle">'+(state.tfVal?'✓':'')+'</span>Verdadero'+(state.tfVal?'<span class="ok-tag">Correcta</span>':'')+'</div>';
      html += '<div class="prev-opt'+(!state.tfVal?' ok':'')+'"><span class="circle">'+(!state.tfVal?'✓':'')+'</span>Falso'+(!state.tfVal?'<span class="ok-tag">Correcta</span>':'')+'</div>';
    } else if(state.type==='shortanswer'){
      var acc=state.saAnswers.filter(function(a){return a.text.trim();});
      html += acc.length? '<div class="prev-opt ok"><span class="circle">✓</span>'+esc(acc[0].text)+(acc.length>1?' <span class="prev-note">(+'+(acc.length-1)+' aceptadas)</span>':'')+'</div>'
                        : '<div class="prev-note">Sin respuestas aún…</div>';
    } else if(state.type==='numerical'){
      html += state.numAns.trim()? '<div class="prev-opt ok"><span class="circle">✓</span>'+esc(state.numAns)+(parseFloat(state.numTol)?' ± '+esc(state.numTol):'')+'</div>'
                                 : '<div class="prev-note">Sin respuesta aún…</div>';
    } else if(state.type==='matching'){
      var pr=state.pairs.filter(function(p){return p.q.trim()&&p.a.trim();});
      if(pr.length){ pr.forEach(function(p){ html+='<div class="prev-opt"><span class="circle ok"></span>'+esc(p.q)+' <span style="color:var(--muted);margin:0 6px;">→</span> <b>'+esc(p.a)+'</b></div>'; }); }
      else html += '<div class="prev-note">Agrega parejas…</div>';
    } else if(state.type==='cloze'){
      html += '<div class="prev-note">'+countGaps(stmt.innerHTML)+' hueco(s). Las palabras subrayadas son las respuestas.</div>';
    } else if(state.type==='essay'){
      html += '<div class="prev-opt"><span class="circle"></span><i>Espacio de respuesta abierta · calificación manual</i></div>';
    }
    preview.innerHTML = html;
  }

  // ---------- Validation + Add ----------
  var ERRFIELDS={errStmt:'stmt',errOpts:null,errSA:null,errNum:'numAns',errMatch:null};
  function clearErrs(){
    ['errStmt','errOpts','errSA','errNum','errMatch'].forEach(function(id){
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
      var filled=state.opts.filter(function(o){return o.text.trim();});
      var corrects=state.opts.filter(function(o){return o.correct && o.text.trim();});
      var need = state.mcMulti ? corrects.length>=1 : corrects.length===1;
      if(filled.length<2 || !need){ showErr('errOpts'); ok=false; }
    } else if(state.type==='shortanswer'){
      var saFilled=state.saAnswers.filter(function(a){return a.text.trim();});
      var sa100=saFilled.some(function(a){return a.frac==='100';});
      if(!saFilled.length || !sa100){ showErr('errSA'); ok=false; }
    } else if(state.type==='numerical'){
      if(state.numAns.trim()==='' || isNaN(parseFloat(state.numAns))){ showErr('errNum'); ok=false; }
    } else if(state.type==='matching'){
      var pr=state.pairs.filter(function(p){return p.q.trim()&&p.a.trim();});
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
      q.opts = state.opts.filter(function(o){return o.text.trim();}).map(function(o){return {text:o.text.trim(),correct:o.correct};});
    } else if(state.type==='truefalse'){ q.tfVal=state.tfVal; }
    else if(state.type==='shortanswer'){ q.saCase=state.saCase;
      q.saAnswers=state.saAnswers.filter(function(a){return a.text.trim();}).map(function(a){return {text:a.text.trim(),frac:a.frac};}); }
    else if(state.type==='numerical'){ q.numAns=state.numAns.trim(); q.numTol=(state.numTol.trim()||'0'); }
    else if(state.type==='matching'){ q.pairs=state.pairs.filter(function(p){return p.q.trim()&&p.a.trim();}).map(function(p){return {q:p.q.trim(),a:p.a.trim()};}); }

    if(state.editingId){
      var idx=questions.findIndex(function(x){return x.id===state.editingId;});
      questions[idx]=q; toast('Pregunta actualizada');
    } else { questions.push(q); toast('Pregunta agregada'); }

    save(); renderTray(); resetForm();
  };

  $('clearBtn').onclick=resetForm;
  function resetForm(){
    var keepType=state.type;
    state={ type:keepType, editingId:null,
      opts:freshOpts(), mcMulti:false, tfVal:true,
      saAnswers:freshSA(), saCase:false, numAns:'', numTol:'0', pairs:freshPairs(),
      image:null, tags:[], passageId:'', grade:'1', penalty:'0', genfb:'', shuffle:true };
    stmt.innerHTML=''; $('qname').value=''; $('genfb').value=''; $('grade').value='1'; $('penalty').value='0';
    $('imgInput').value=''; $('mcMulti').checked=false; $('saCase').checked=false; $('shuffle').checked=true;
    $('tagInput').value=''; $('errStmt').textContent='El enunciado no puede estar vacío.';
    $('addBtn').textContent='Agregar a la lista'; $('clearBtn').style.display='none';
    $('tf').querySelector('.v').setAttribute('aria-pressed','true'); $('tf').querySelector('.f').setAttribute('aria-pressed','false');
    refreshPassageSelect();
    renderOpts(); renderSA(); renderMatch(); renderImg(); renderTags(); applyType(); renderPreview(); clearErrs();
    document.querySelectorAll('.q-item').forEach(function(x){x.classList.remove('editing');});
  }

  // ---------- Tray ----------
  var TYPE_LABEL={multichoice:'Op. múltiple',truefalse:'V / F',shortanswer:'Resp. corta',numerical:'Numérica',matching:'Emparejar',cloze:'Huecos',essay:'Ensayo'};
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
        '<div class="q-name">'+esc(stripTags(q.statement)||'(sin enunciado)')+'</div>'+
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
    state.numAns = q.type==='numerical' ? q.numAns : ''; state.numTol = q.type==='numerical' ? q.numTol : '0';
    state.pairs = q.type==='matching' ? q.pairs.map(function(p){return {q:p.q,a:p.a};}) : freshPairs();
    state.grade=q.grade||'1'; state.penalty=q.penalty!=null?q.penalty:'0'; state.genfb=q.genfb||''; state.shuffle=q.shuffle!==false;

    stmt.innerHTML=q.statement; $('qname').value=q.name; $('genfb').value=state.genfb;
    $('grade').value=state.grade; $('penalty').value=state.penalty;
    $('mcMulti').checked=state.mcMulti; $('saCase').checked=state.saCase; $('shuffle').checked=state.shuffle;
    $('tf').querySelector('.v').setAttribute('aria-pressed', state.tfVal?'true':'false');
    $('tf').querySelector('.f').setAttribute('aria-pressed', state.tfVal?'false':'true');
    $('addBtn').textContent='Actualizar pregunta'; $('clearBtn').style.display='inline-flex';
    refreshPassageSelect(); $('passageSel').value=state.passageId;
    renderOpts(); renderSA(); renderMatch(); renderImg(); renderTags(); applyType(); renderPreview(); renderTray();
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
        questions=d.questions; passages=Array.isArray(d.passages)?d.passages:[];
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
    html += (q.type==='cloze') ? compileCloze(q.statement) : q.statement;
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
        x += '\n    <answer fraction="'+frac(o)+'" format="html">'+
             htmlText('<p>'+esc(o.text)+'</p>')+
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
      x += '\n  <question type="numerical">'+commonXML(q)+
           '\n    <answer fraction="100" format="moodle_auto_format">'+plainText(q.numAns)+
           '<feedback format="html"><text></text></feedback>'+
           '<tolerance>'+esc(q.numTol||'0')+'</tolerance></answer>'+
           '\n    <unitgradingtype>0</unitgradingtype><unitpenalty>0</unitpenalty><showunits>3</showunits><unitsleft>0</unitsleft>'+
           '\n  </question>';

    } else if(q.type==='matching'){
      x += '\n  <question type="matching">'+commonXML(q)+
           '\n    <shuffleanswers>'+(q.shuffle!==false?'true':'false')+'</shuffleanswers>'+
           '\n    <correctfeedback format="html"><text>Respuesta correcta.</text></correctfeedback>'+
           '\n    <partiallycorrectfeedback format="html"><text>Respuesta parcialmente correcta.</text></partiallycorrectfeedback>'+
           '\n    <incorrectfeedback format="html"><text>Respuesta incorrecta.</text></incorrectfeedback>';
      q.pairs.forEach(function(p){
        x += '\n    <subquestion format="html">'+htmlText('<p>'+esc(p.q)+'</p>')+
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
      var stmtClean = q.type === 'cloze' ? q.statement.replace(/\[\[([^\]]+)\]\]/g, ' ________ ') : q.statement;
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
            wordContent += '<li>' + letra + ') ' + esc(o.text) + '</li>'; 
        });
        wordContent += '</ul>';
      } else if (q.type === 'truefalse') {
        wordContent += '<ul class="opts"><li>( &nbsp; ) Verdadero</li><li>( &nbsp; ) Falso</li></ul>';
      } else if (q.type === 'shortanswer' || q.type === 'numerical' || q.type === 'cloze') {
        wordContent += '<p><br>Respuesta: _________________________________________</p>';
      } else if (q.type === 'matching') {
        wordContent += '<ul class="opts">';
        q.pairs.forEach(function(p) { wordContent += '<li>' + esc(p.q) + ' &nbsp; _______________________</li>'; });
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
  renderOpts(); renderSA(); renderMatch(); renderImg(); renderTags(); applyType(); renderPreview(); renderTray();
})();
