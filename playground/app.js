(function () {
  'use strict';
  const M = window.KinematicsMath;
  const G = window.KinematicsGraph;
  const P = window.KinematicsPresets;
  const Files = window.KinematicsFiles;
  const $ = id => document.getElementById(id);
  const STORAGE = 'eng654.kinematic-building-blocks.v1';
  const LIBRARY_STORAGE = STORAGE + '.functions';
  const TYPES = {
    rotation: { title: 'Rotation', icon: 'R', params: { axis: ['0', '0', '1'], angle: 'theta' } },
    translation: { title: 'Translation', icon: 'p', params: { vector: ['a', '0', '0'] } },
    transform: { title: 'Transform', icon: 'T', params: { matrix: ['1','0','0','0','0','1','0','0','0','0','1','0','0','0','0','1'] } },
    exponential: { title: 'Exponential', icon: 'exp', params: { omega: ['0','0','1'], v: ['0','-1','0'], theta: 'theta' } },
    inverse: { title: 'Inverse', icon: 'T⁻¹', params: {} },
    logarithm: { title: 'To screw', icon: 'log', params: {} },
    matrix: { title: 'Matrix', icon: 'A', params: { rows: 3, columns: 3, matrix: ['1','0','0','0','1','0','0','0','1'] } },
    subtract: { title: 'Subtract vectors', icon: '−', params: {} },
    cross: { title: 'Cross product', icon: '×', params: {} },
    columns: { title: 'Select columns', icon: '[c]', params: { columns: [1,2,3], rowStart: 1, rowCount: 3 } },
    stack: { title: 'Stack rows', icon: '↕', params: {} },
    determinant: { title: 'Determinant', icon: 'det', params: {} },
    function: { title: 'Function', icon: 'ƒ', params: {} }
  };
  const DEFAULT_BLOCK_SIZE = {width:196,height:154};
  const clone = value => JSON.parse(JSON.stringify(value));
  function nodeSpec(node) {
    if(node.type==='matrix'&&node.params.columns===1)return {...TYPES.matrix,title:'Column vector',icon:'↕'};
    if(node.type==='matrix'&&node.params.rows===1)return {...TYPES.matrix,title:'Row vector',icon:'↔'};
    return TYPES[node.type];
  }
  function blockSize(node) {
    const element=$('nodes').querySelector('[data-node-id="'+CSS.escape(node.id)+'"]');
    return {width:element?.offsetWidth||DEFAULT_BLOCK_SIZE.width,height:element?.offsetHeight||DEFAULT_BLOCK_SIZE.height};
  }
  const pretty = text => String(text).replace(/\b(theta|alpha|omega|phi|pi)\b/g, word => ({theta:'θ',alpha:'α',omega:'ω',phi:'φ',pi:'π'})[word]);
  const el = (tag, attrs = {}, ...children) => {
    const element = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (key.startsWith('on') && typeof value === 'function') element.addEventListener(key.slice(2), value);
      else if (key === 'class') element.className = value;
      else if (key === 'value') element.value = value;
      else if (value === true) element.setAttribute(key, '');
      else if (value !== false && value !== null && value !== undefined) element.setAttribute(key, String(value));
    }
    children.flat(Infinity).forEach(child => { if (child !== null && child !== undefined) element.append(child.nodeType ? child : document.createTextNode(String(child))); });
    return element;
  };
  const svg = (tag, attrs = {}, text) => {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attrs).forEach(([key,value]) => node.setAttribute(key,value));
    if (text !== undefined) node.textContent = text;
    return node;
  };
  function formattedName(name) {
    const match = String(name).match(/^\^(?:\{([^{}]+)\}|([^\s{}]+?))([A-Za-zΑ-ω]+)_(?:\{([^{}]+)\}|([^\s{}]+))$/);
    return match ? el('span',{class:'frame-name'},el('sup',{},match[1]||match[2]),match[3],el('sub',{},match[4]||match[5])) : el('span',{},name);
  }
  let serial = 0;
  const freshId = () => { let id; do { id = 'b' + (++serial); } while (graph?.nodes.some(n => n.id === id)); return id; };
  const makeNode = (id, type, params, x, y, label) => ({ id, type, label: label || TYPES[type].title, params: clone(params || TYPES[type].params), position: {x,y}, showMatrix: false });
  function preset(name) {
    if(P.names.includes(name))return P.create(name);
    const base = { version:1, name:'Empty canvas', nodes:[], edges:[], bindings:{}, angleUnit:'rad' };
    if (name === 'dh') {
      base.name = 'D–H transformation'; base.bindings = {theta:'pi/4',d:'0.4',a:'1.2',alpha:'pi/2'};
      base.nodes = [
        makeNode('b1','rotation',{axis:['0','0','1'],angle:'theta'},30,50,'Rz(θ)'),
        makeNode('b2','translation',{vector:['0','0','d']},340,50,'Tz(d)'),
        makeNode('b3','translation',{vector:['a','0','0']},650,50,'Tx(a)'),
        makeNode('b4','rotation',{axis:['1','0','0'],angle:'alpha'},960,50,'Rx(α)')
      ];
    } else if (name === 'poe') {
      base.name = 'Product of exponentials'; base.bindings = {theta1:'pi/6',theta2:'pi/4'};
      base.nodes = [
        makeNode('b1','exponential',{omega:['0','0','1'],v:['0','0','0'],theta:'theta1'},40,50,'Joint 1 · ξ₁'),
        makeNode('b2','exponential',{omega:['0','0','1'],v:['0','-1','0'],theta:'theta2'},370,50,'Joint 2 · ξ₂'),
        makeNode('b3','transform',{matrix:['1','0','0','2','0','1','0','0','0','0','1','0.2','0','0','0','1']},700,50,'Home pose · M')
      ];
    } else if (name === 'screw') {
      base.name = 'Screw → matrix → screw'; base.bindings = {theta:'pi/3'};
      base.nodes = [makeNode('b1','exponential',null,80,50,'Screw about an offset axis'),makeNode('b2','logarithm',{},450,50,'Recover the screw')];
    }
    base.edges = base.nodes.slice(1).map((n,i) => ({from:base.nodes[i].id,to:n.id}));
    return base;
  }
  let graph = preset('dh'), selected = 'b4', values = new Map(), numericValues = new Map(), view = {x:0,y:0,scale:1};
  let displayMode = 'symbolic', history = [], future = [], gesture = null, connection = null, codeNode = null;
  let bindingsSignature = '', preview = null, toastTimer, saveTimer, paletteDragTime = 0;
  let selectedIds = new Set([selected]), library = [], canvasMode = 'select', spaceDown = false, suppressClickUntil = 0;
  let functionAction = null, pendingDefinition = null, codeDefinition = null, importController = null;
  let presetGuideSignature = '';
  const snapshot = () => JSON.stringify({graph,selected,selectedIds:[...selectedIds],library});
  function onlySelect(id) { selected=id; selectedIds=new Set(id?[id]:[]); }
  function checkpoint() {
    const current = snapshot();
    if (history[history.length-1] !== current) history.push(current);
    if (history.length > 80) history.shift();
    future = [];
  }
  function undo(redo = false) {
    const source = redo ? future : history, destination = redo ? history : future;
    if (!source.length) return;
    destination.push(snapshot()); const previous = JSON.parse(source.pop());
    graph = previous.graph; library = previous.library || library; selected = previous.selected; selectedIds=new Set(previous.selectedIds || (selected?[selected]:[])); connection = null; bindingsSignature = '';
    renderLibrary(); render(); saveLocal(); toast(redo ? 'Change restored.' : 'Change undone.');
  }
  function toast(message) {
    $('toast').textContent = message; $('toast').hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3300);
  }
  function saveLocal() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(STORAGE, JSON.stringify({graph,selected,view})); localStorage.setItem(LIBRARY_STORAGE,JSON.stringify(library)); $('save-status').textContent = 'Saved on this device'; }
      catch (_) { $('save-status').textContent = 'Download operations to keep your work'; }
    }, 150);
  }
  function matrixElement(matrix, numeric = false, compact = false) {
    const table = el('table', {class: compact ? 'matrix-table node-matrix' : 'matrix-table', 'aria-label': `${matrix.length} by ${matrix[0].length} matrix`});
    table.append(el('tbody', {}, matrix.map(row => el('tr', {}, row.map(entry => {
      const full = numeric ? M.numberText(M.evaluate(entry, graph.bindings)) : pretty(M.format(entry));
      const text = compact && full.length > 30 ? full.slice(0,27) + '…' : full;
      return el('td', {title: compact ? full : null}, text);
    })))));
    if(compact&&matrix[0].length===4){
      // Sparse transforms need less room for constant columns than for a*cos(q).
      const weights=matrix[0].map((_,column)=>Math.max(2,...[...table.rows].map(row=>Math.min(16,row.cells[column].textContent.length))));
      const total=weights.reduce((sum,value)=>sum+value,0);
      table.prepend(el('colgroup',{},weights.map(weight=>el('col',{style:`width:${100*weight/total}%`}))));
    }
    return el('div', {class:'matrix-wrap'}, el('div', {class:'matrix-bracket'}, table));
  }
  function dimension(value) {
    if (!value) return '—';
    return value.kind === 'screw' ? 'ξ + θ' : value.kind === 'scalar' ? 'Scalar' : `${value.matrix.length} × ${value.matrix[0].length}`;
  }
  function operationName(node) {
    const p = node.params;
    if (node.type === 'function') return `${node.label}(${p.definition.parameters.map(name=>pretty(p.arguments[name])).join(', ')})`;
    if (node.type === 'rotation') {
      const axis = [['1','0','0'],['0','1','0'],['0','0','1']].findIndex(v => v.every((a,i) => a === p.axis[i]));
      return `R${axis < 0 ? 'ω' : ['x','y','z'][axis]}(${pretty(p.angle)})`;
    }
    if (node.type === 'translation') return `T(${p.vector.map(pretty).join(', ')})`;
    if (node.type === 'exponential') return `exp([ξ]${pretty(p.theta)})`;
    if (['matrix','subtract', 'cross','columns','stack','determinant'].includes(node.type)) return node.label;
    return node.type === 'transform' ? (node.label === 'Transform' ? 'T' : node.label) : node.type === 'inverse' ? 'inverse' : 'log';
  }
  function chainName(id, seen = new Set()) {
    if (seen.has(id)) return '';
    seen.add(id); const node = graph.nodes.find(n => n.id === id); if (!node) return '';
    const edge = graph.edges.find(e => e.to === id), before = edge ? chainName(edge.from,seen) : '';
    if (['subtract', 'cross','columns','stack'].includes(node.type)) return node.label;
    if (node.type === 'inverse' || node.type === 'logarithm' || node.type === 'determinant') return `${node.type === 'inverse' ? 'inverse' : node.type === 'determinant' ? 'det' : 'log'}(${before || 'input'})`;
    return (before ? before + ' · ' : '') + operationName(node);
  }
  function renderNodes() {
    $('nodes').replaceChildren(...graph.nodes.map(node => {
      const result = values.get(node.id), spec = nodeSpec(node);
      const article = el('article', {class:'block' + (selectedIds.has(node.id) ? ' is-selected' : '') + (result.error ? ' has-error' : ''), 'data-node-id':node.id, tabindex:'0', 'aria-label':`${node.label}: ${spec.title} block`});
      article.style.left = node.position.x + 'px'; article.style.top = node.position.y + 'px';
      const header = el('div', {class:'block-header'}, el('span',{class:'block-icon'},spec.icon), el('div',{},el('strong',{class:'block-title'},formattedName(node.label)),el('span',{class:'block-type'},spec.title)), el('button',{class:'block-menu','aria-label':`Actions for ${node.label}`,onpointerdown:e=>e.stopPropagation(),onclick:e=>{e.stopPropagation();openNodeMenu(node.id,e.clientX,e.clientY);}},'⋯'));
      const body = el('div', {class:'block-body'});
      try {
        if (node.type === 'function' && !node.showMatrix) {
          body.append(el('div',{class:'function-form'},formattedName(node.label)),el('div',{class:'function-signature'},'('+node.params.definition.parameters.map(name=>pretty(node.params.arguments[name])).join(', ')+')'),el('div',{class:'block-meta'},node.params.definition.kind==='graph' ? node.params.definition.graph.nodes.length+' operations · '+node.params.definition.angleUnit : 'Imported matrix function'));
        } else if (node.type === 'exponential' && !node.showMatrix) {
          body.append(el('div',{class:'exponential-form'},'e',el('sup',{},'[ξ]',pretty(node.params.theta))),
            el('div',{class:'block-meta'},'ω = [' + node.params.omega.map(pretty).join(', ') + ']'),
            el('div',{class:'block-meta'},'v = [' + node.params.v.map(pretty).join(', ') + ']'));
        } else if (result.ownValue?.kind === 'screw') {
          const s = result.ownValue.screw;
          body.append(el('div',{class:'result-symbol'},'ξ = (ω, v)'),el('div',{class:'block-meta'},'ω = ['+s.omega.map(a=>M.format(a)).join(', ')+']'),el('div',{class:'block-meta'},'v = ['+s.v.map(a=>M.format(a)).join(', ')+']'),el('div',{class:'block-meta'},'θ = '+M.format(s.theta)));
        } else if (result.ownValue) body.append(matrixElement(result.ownValue.matrix,false,true));
        else body.append(el('div',{class:'block-placeholder'}, node.type === 'inverse' ? 'T → T⁻¹' : node.type === 'logarithm' ? 'T → (ω, v, θ)' : 'Edit parameters'));
      } catch (error) { body.replaceChildren(el('p',{class:'error-message'},error.message)); }
      if (result.error) body.append(el('p',{class:'error-message',title:result.error}, result.error));
      const footer = el('div',{class:'block-footer'},el('span',{},result.value ? 'Output · '+dimension(result.value) : 'Connect or edit input'));
      if (node.type === 'exponential' || node.type === 'function') footer.append(el('button',{'aria-pressed':String(node.showMatrix),'aria-label':`Matrix form for ${node.label}`,onclick:e=>{e.stopPropagation();checkpoint();node.showMatrix=!node.showMatrix;render({inspector:false});saveLocal();}},node.showMatrix?(node.type==='function'?'Function':'Exponential'):'Matrix'));
      const slots = G.inputPorts(node);
      const inputs = slots.map((slot,index)=>el('button',{class:'port input'+(graph.edges.some(e=>e.to===node.id&&(e.input||'input')===slot)?' connected':''),'data-port':'input','data-input':slot,'data-node-id':node.id,'aria-label':`Input ${slotLabel(node,slot)} of ${node.label}`,title:`${slotLabel(node,slot)} · connect from another output`,style:`top:${100*(index+1)/(slots.length+1)}%`},slots.length>1?el('span',{class:'port-label'},slotLabel(node,slot)):null));
      if(slots.length>2)article.style.minHeight=Math.max(DEFAULT_BLOCK_SIZE.height,(slots.length+1)*40)+'px';
      const output = el('button',{class:'port output'+(graph.edges.some(e=>e.from===node.id)?' connected':''),'data-port':'output','data-node-id':node.id,'aria-label':`Output of ${node.label}`,title:node.type==='logarithm'?'Screw coordinates · read or copy ω, v, θ in the output panel':'Output · connect to another input'});
      [...inputs,output].forEach(port => {
        port.addEventListener('pointerdown',startPort);
        port.addEventListener('click',event=>{if(event.detail===0)handlePortClick(node.id,port.dataset.port,port.dataset.input);});
      });
      article.append(header,body,footer,...inputs,output);
      article.addEventListener('click',event=>{if(Date.now()>suppressClickUntil&&!event.target.closest('button'))selectNode(node.id,event.shiftKey||event.ctrlKey||event.metaKey);});
      article.addEventListener('keydown',event=>{if(event.key==='Enter'&&event.target===article){selectNode(node.id);focusEditor();}});
      article.addEventListener('pointerdown',event=>startNodeDrag(event,node.id));
      article.addEventListener('contextmenu',event=>{event.preventDefault();openNodeMenu(node.id,event.clientX,event.clientY);});
      return article;
    }));
    $('empty-state').hidden = graph.nodes.length !== 0;
    requestAnimationFrame(renderConnections);
  }
  function slotLabel(node, slot) { return slot==='input'?'Input':node.type==='columns'?'C'+(Number(slot.slice(1))+1):slot.toUpperCase(); }
  function portPoint(id, port, input='input') {
    const n = graph.nodes.find(n=>n.id===id), element = $('nodes').querySelector(`[data-node-id="${CSS.escape(id)}"]`);
    const socket = element?.querySelector(port==='output'?'[data-port="output"]':`[data-port="input"][data-input="${CSS.escape(input)}"]`);
    if(socket){const r=socket.getBoundingClientRect();return worldPoint(r.left+r.width/2,r.top+r.height/2);}
    const slots=G.inputPorts(n), fraction=port==='output'?.5:(Math.max(0,slots.indexOf(input))+1)/(slots.length+1);
    return {x:n.position.x+(port==='output'?(element?.offsetWidth||DEFAULT_BLOCK_SIZE.width):0),y:n.position.y+(element?.offsetHeight||DEFAULT_BLOCK_SIZE.height)*fraction};
  }
  function wirePath(a,b) {
    const bend=Math.max(55,Math.abs(b.x-a.x)*.45);
    return `M${a.x},${a.y} C${a.x+bend},${a.y} ${b.x-bend},${b.y} ${b.x},${b.y}`;
  }
  function renderConnections() {
    if(connection&&!graph.nodes.some(node=>node.id===connection.id))connection=null;
    $('nodes').querySelectorAll('.port').forEach(port=>port.classList.toggle('is-snap-target',!!connection?.target&&port.dataset.nodeId===connection.target.id&&port.dataset.port===connection.target.port&&(port.dataset.input||'input')===connection.target.input));
    $('connections').replaceChildren();
    graph.edges.forEach(edge=>{
      const a=portPoint(edge.from,'output'), b=portPoint(edge.to,'input',edge.input);
      const path=svg('path',{d:wirePath(a,b),class:'wire','data-from':edge.from,'data-to':edge.to,fill:'none'});
      path.addEventListener('contextmenu',event=>{event.preventDefault();openMenu([{label:'Disconnect',action:()=>disconnect(edge.to,edge.input||'input')}],event.clientX,event.clientY);});
      const hit=svg('path',{d:wirePath(a,b),class:'wire-hit',fill:'none','aria-label':'Connection; right-click to disconnect'});
      hit.addEventListener('contextmenu',event=>{event.preventDefault();openMenu([{label:'Disconnect',action:()=>disconnect(edge.to,edge.input||'input')}],event.clientX,event.clientY);});
      const source=values.get(edge.from)?.value, target=values.get(edge.to)?.value;
      const label=source&&target&&source.kind!=='transform'&&target.kind==='transform'?'→ 4 × 4':dimension(source);
      const x=(a.x+b.x)/2,y=(a.y+b.y)/2-12;
      $('connections').append(path,hit,svg('rect',{x:x-30,y:y-12,width:60,height:20,rx:4,class:'wire-label-bg'}),svg('text',{x,y:y+2,'text-anchor':'middle',class:'wire-label'},label));
    });
    if(connection){
      const a=portPoint(connection.id,connection.port,connection.input), b=connection.target?portPoint(connection.target.id,connection.target.port,connection.target.input):connection.pointer||{x:a.x+(connection.port==='output'?90:-90),y:a.y};
      $('connections').append(svg('path',{d:connection.port==='output'?wirePath(a,b):wirePath(b,a),class:'wire wire-pending',fill:'none'}));
    }
    $('connection-tip').hidden=!connection;
    if(connection)$('connection-tip').textContent=`Choose an ${connection.port==='output'?'input':'output'} port · Esc to cancel`;
  }
  function renderOutput() {
    const node=graph.nodes.find(n=>n.id===selected), result=(displayMode==='numeric'?numericValues:values).get(selected);
    $('output-title').textContent=node?chainName(selected):'Select a block to inspect its output';
    $('output-title').title=node?chainName(selected):'';
    $('output-dimension').textContent=dimension(result?.value);
    $('copy-result').disabled=!result?.value; $('output-python').disabled=!node;
    $('select-output-columns').disabled=!result?.value?.matrix||['scalar','screw'].includes(result.value.kind);
    $('symbolic-view').setAttribute('aria-pressed',displayMode==='symbolic');$('numeric-view').setAttribute('aria-pressed',displayMode==='numeric');
    const host=$('output-content');host.replaceChildren();
    if(!node){host.append(el('p',{class:'output-empty'},'Each connection adds one operation. Select any block to see the result up to that point.'));preview?.update(null);return;}
    if(result.error){host.append(el('p',{class:'error-message'},result.error));preview?.update(null);return;}
    try {
      if(result.value.kind==='screw'){
        const s=result.value.screw;
        host.append(el('div',{class:'screw-result'},el('div',{},el('strong',{},'ω'),matrixElement(s.omega.map(a=>[a]),true)),el('div',{},el('strong',{},'v'),matrixElement(s.v.map(a=>[a]),true)),el('div',{},el('strong',{},'θ'),el('p',{class:'result-symbol'},M.numberText(M.evaluate(s.theta))))));
        const pure=s.omega.every(a=>Math.abs(M.evaluate(a))<1e-12);
        host.append(el('p',{class:'matrix-caption'},pure?'Pure translation · θ is displacement; ω = 0.':'Principal rotational screw · θ in radians, 0 ≤ θ ≤ π.'));
      }else{
        host.append(matrixElement(result.value.matrix,displayMode==='numeric'));
        host.append(el('p',{class:'matrix-caption'},result.value.kind==='translation'?'Translation vector · mixed compositions embed it in a 4 × 4 transform.':result.value.kind==='rotation'?'Rotation matrix · connecting a translation promotes the result to 4 × 4.':result.value.kind==='matrix'?'Matrix · columns and rows follow the order selected in the inspector.':result.value.kind==='scalar'?'Determinant · defined for square matrices; zero means the matrix is singular.':'Homogeneous transform · upper-left: rotation; last column: position.'));
      }
    }catch(error){host.replaceChildren(el('p',{class:'error-message'},error.message),el('p',{class:'hint'},'Set numeric symbol values in the inspector, or switch to Symbolic.'));}
    try{preview?.update(M.validatedMatrix(numericValues.get(selected)?.value,graph.bindings));}catch(_){preview?.update(null);}
  }
  function field(label, input) { return el('label',{class:'field'},el('span',{},label),input); }
  function parameterInput(node,key,index,label) {
    const input=el('input',{type:'text',value:index===undefined?node.params[key]:node.params[key][index],maxlength:'500','aria-label':label,spellcheck:'false',autocomplete:'off'});
    input.addEventListener('focus',checkpoint);
    input.addEventListener('input',()=>{
      if(index===undefined)node.params[key]=input.value;else node.params[key][index]=input.value;
      refreshAfterEdit();
    });
    return input;
  }
  function vectorFields(node,key,labels) {
    return el('div',{class:'vector-fields'},labels.map((label,i)=>field(label,parameterInput(node,key,i,`${key} ${label}`))));
  }
  function countField(label,value,onChange) {
    const input=el('input',{type:'number',min:1,max:12,step:1,value,'aria-label':label});
    input.addEventListener('change',()=>{
      const count=Number(input.value);
      if(!Number.isInteger(count)||count<1||count>12){input.value=value;toast('Choose a whole number from 1 to 12.');return;}
      checkpoint();onChange(count);render();saveLocal();
    });
    return field(label,input);
  }
  function sourceField(node,slot,label) {
    const source=graph.edges.find(edge=>edge.to===node.id&&(edge.input||'input')===slot)?.from||'';
    const select=el('select',{'aria-label':label},el('option',{value:''},'Choose a block output'),graph.nodes.filter(n=>n.id!==node.id&&n.type!=='logarithm').map(n=>el('option',{value:n.id},n.label+' · '+dimension(values.get(n.id)?.value))));
    select.value=source;
    select.addEventListener('change',()=>{if(select.value){if(!connect(select.value,node.id,slot))select.value=source;}else disconnect(node.id,slot);});
    return field(label,select);
  }
  function matrixSize(node,key,count) {
    const old=node.params, rows=key==='rows'?count:old.rows, columns=key==='columns'?count:old.columns;
    node.params={rows,columns,matrix:Array.from({length:rows*columns},(_,index)=>{
      const r=Math.floor(index/columns),c=index%columns;return r<old.rows&&c<old.columns?old.matrix[r*old.columns+c]:'0';
    })};
  }
  function orientVector(node,orientation) {
    if(node.params.rows!==1&&node.params.columns!==1)return;
    const length=node.params.matrix.length,rows=orientation==='column'?length:1,columns=orientation==='row'?length:1;
    if(node.params.rows===rows&&node.params.columns===columns)return;
    checkpoint();node.params={rows,columns,matrix:node.params.matrix.slice()};
    if(['Column vector','Row vector'].includes(node.label))node.label=orientation==='column'?'Column vector':'Row vector';
    render();saveLocal();
  }
  function renderInspector() {
    const node=graph.nodes.find(n=>n.id===selected), host=$('inspector-content');host.replaceChildren();
    $('selected-id').textContent=node?node.id.toUpperCase():'';
    if(!node){host.append(el('div',{class:'inspector-section'},el('h2',{},'Your motion, assembled.'),el('p',{class:'hint'},'Select a block to edit its parameters. Start with a rotation, translation, or screw exponential.')));return;}
    const section=el('section',{class:'inspector-section'});
    section.append(el('div',{class:'inspector-title-row'},el('h2',{},nodeSpec(node).title),el('button',{class:'quiet',onclick:()=>showCode(node.id)},'Python </>')));
    const name=el('input',{type:'text',value:node.label,maxlength:'80','aria-label':'Block name'});
    name.addEventListener('focus',checkpoint);name.addEventListener('input',()=>{node.label=name.value;refreshAfterEdit();});section.append(field('Block name',name));
    if(node.type==='rotation'){
      const axis=el('select',{'aria-label':'Rotation axis'},['X','Y','Z','Custom'].map(a=>el('option',{value:a.toLowerCase()},a)));
      const index=[['1','0','0'],['0','1','0'],['0','0','1']].findIndex(a=>a.every((s,i)=>node.params.axis[i]===s));axis.value=index<0?'custom':['x','y','z'][index];
      axis.addEventListener('change',()=>{checkpoint();if(axis.value!=='custom')node.params.axis=['x','y','z'].map(a=>a===axis.value?'1':'0');else node.params.axis=['1','1','0'];render();saveLocal();});
      section.append(field('Rotation axis',axis));
      if(axis.value==='custom')section.append(vectorFields(node,'axis',['x','y','z']),el('p',{class:'hint'},'The axis direction is normalized automatically.'));
      section.append(field('Angle · number or symbol',parameterInput(node,'angle',undefined,'Rotation angle')));
    }else if(node.type==='translation'){
      section.append(el('p',{class:'section-label'},'TRANSLATION VECTOR'),vectorFields(node,'vector',['x','y','z']),el('p',{class:'hint'},'For example: a, 0, d. Connecting a rotation produces a homogeneous transform.'));
    }else if(node.type==='transform'){
      const grid=el('div',{class:'matrix-fields'});
      node.params.matrix.forEach((_,i)=>{const input=parameterInput(node,'matrix',i,`Matrix row ${Math.floor(i/4)+1} column ${i%4+1}`);if(i>=12){input.readOnly=true;input.title='Homogeneous bottom row: 0, 0, 0, 1';}grid.append(input);});
      section.append(el('p',{class:'section-label'},'HOMOGENEOUS MATRIX'),grid,el('p',{class:'hint'},'Enter a rotation in the upper-left 3 × 3 and a position in the last column. Symbolic expressions are supported.'));
    }else if(node.type==='matrix'){
      section.append(el('p',{class:'section-label'},'CHOOSE THE MATRIX SIZE · m × n'),
        el('div',{class:'field-row'},countField('Rows (m)',node.params.rows,count=>matrixSize(node,'rows',count)),countField('Columns (n)',node.params.columns,count=>matrixSize(node,'columns',count))));
      const vector=node.params.rows===1||node.params.columns===1;
      if(vector)section.append(el('div',{class:'field-row matrix-orientation','aria-label':'Vector orientation'},
        el('button',{type:'button','data-vector-orientation':'column','aria-pressed':String(node.params.columns===1),onclick:()=>orientVector(node,'column')},'Column vector'),
        el('button',{type:'button','data-vector-orientation':'row','aria-pressed':String(node.params.rows===1),onclick:()=>orientVector(node,'row')},'Row vector')));
      section.append(el('p',{class:'matrix-shape-summary',id:'matrix-shape-summary'},`${node.params.rows} rows × ${node.params.columns} columns · ${node.params.matrix.length} editable entries`));
      const grid=el('div',{class:'matrix-fields general-matrix-fields','data-matrix-editor':'','aria-label':`${node.params.rows} by ${node.params.columns} editable matrix`,style:`grid-template-columns:repeat(${node.params.columns},minmax(42px,1fr))`});
      node.params.matrix.forEach((_,i)=>grid.append(parameterInput(node,'matrix',i,`Matrix row ${Math.floor(i/node.params.columns)+1} column ${i%node.params.columns+1}`)));
      section.append(grid,el('p',{class:'hint'},'Enter numbers or symbolic expressions in each cell, for example 2, a, or cos(theta). Resize from 1 to 12 rows and columns. Existing overlapping cells stay in place; new cells are zero. Undo recovers removed cells. Products use the displayed dimensions.'));
    }else if(node.type==='columns'){
      section.append(el('p',{class:'hint'},'Choose each output column from any connected matrix or vector. Column and row numbers start at 1. All columns use the same row range.'));
      section.append(el('div',{class:'field-row'},countField('First row',node.params.rowStart,count=>{node.params.rowStart=count;}),countField('Number of rows',node.params.rowCount,count=>{node.params.rowCount=count;})));
      node.params.columns.forEach((column,i)=>section.append(el('div',{class:'column-source'},sourceField(node,'c'+i,'Output column '+(i+1)+' · source'),countField('Source column '+(i+1),column,count=>{node.params.columns[i]=count;}))));
      section.append(el('div',{class:'field-row'},el('button',{disabled:node.params.columns.length>=12,onclick:()=>{checkpoint();node.params.columns.push(1);render();saveLocal();}},'Add column'),el('button',{disabled:node.params.columns.length<=1,onclick:()=>{checkpoint();const slot='c'+(node.params.columns.length-1);node.params.columns.pop();graph.edges=graph.edges.filter(e=>e.to!==node.id||e.input!==slot);render();saveLocal();}},'Remove last')));
    }else if(node.type==='subtract'){
      section.append(sourceField(node,'a','A · first vector'),sourceField(node,'b','B · vector to subtract'),el('p',{class:'hint'},'Returns A − B entry by entry. Use two row vectors or two column vectors of the same length, expressed in the same frame.'));
    }else if(node.type==='cross'||node.type==='stack'){
      section.append(sourceField(node,'a',node.type==='cross'?'A · first vector':'A · upper rows'),sourceField(node,'b',node.type==='cross'?'B · second vector':'B · lower rows'),el('p',{class:'hint'},node.type==='cross'?'Returns A × B for two 3 × 1 column vectors in the same frame. Order matters: p × ω = −ω × p gives a revolute screw’s linear component. Use Select columns to extract a vector from a transform.':'Places A above B. Both inputs need the same number of columns. To form an angular-first twist, choose ω for A and v for B.'));
    }else if(node.type==='determinant'){
      section.append(sourceField(node,'input','Matrix input'),el('p',{class:'hint'},'Computes det(A) for a square matrix. Use Select columns to form a square submatrix from a wider matrix. A rectangular Jacobian has no determinant.'));
    }else if(node.type==='exponential'){
      section.append(el('p',{class:'section-label'},'ANGULAR PART · ω'),vectorFields(node,'omega',['ωx','ωy','ωz']),el('p',{class:'section-label'},'LINEAR PART · v'),vectorFields(node,'v',['vx','vy','vz']),field('Angle / displacement · θ',parameterInput(node,'theta',undefined,'Screw angle or displacement')),
        el('p',{class:'hint'},'ξ = (ω, v). For a unit rotational axis through r, v = −ω × r. For pure translation, set ω = 0; θ is displacement and ignores the angle unit.'));
      const toggle=el('input',{type:'checkbox',checked:node.showMatrix});toggle.addEventListener('change',()=>{checkpoint();node.showMatrix=toggle.checked;render({inspector:false});saveLocal();});
      section.append(el('label',{class:'field-row'},toggle,'Show matrix on the block'));
    }else if(node.type==='function'){
      const definition=node.params.definition;
      section.append(el('p',{class:'section-label'},'FUNCTION ARGUMENTS'));
      definition.parameters.forEach(name=>section.append(field(pretty(name)+' · value or symbol',parameterInput(node,'arguments',name,`Argument ${name}`))));
      if(!definition.parameters.length)section.append(el('p',{class:'hint'},'This function has no free parameters.'));
      section.append(el('p',{class:'hint'},`This function preserves its original ${definition.angleUnit==='deg'?'degree':'radian'} convention. Enter numbers to evaluate it or new symbols to reuse it in a larger FK.`));
      if(definition.kind==='graph')section.append(el('button',{class:'full-width',onclick:()=>expandNode(node.id)},'Expand into individual blocks'));
    }else{
      section.append(el('p',{class:'hint'},node.type==='inverse'?'Connect a rotation, translation, or transform. This block returns its inverse.':'Connect a numeric rotation or transform to recover ω, v, and θ. Assign every input symbol a numeric value. The returned rotational angle is in radians. This output contains coordinates; enter them in an Exponential block to compose that motion.'));
    }
    section.append(el('p',{id:'inspector-error',class:'error-message'}));
    const actions=el('div',{class:'inspector-actions'},el('button',{onclick:()=>duplicateNode(node.id)},'Duplicate'),el('button',{onclick:()=>disconnect(node.id),disabled:!graph.edges.some(e=>e.to===node.id)},'Disconnect'),el('button',{class:'danger',onclick:()=>deleteNode(node.id)},'Delete'));
    section.append(actions);
    if(node.type!=='logarithm')section.append(el('button',{class:'full-width',onclick:()=>openFunctionDialog('save')},'Save chain as function'));
    host.append(section);
  }
  function rawSymbols() {
    return G.rawSymbols(graph).sort();
  }
  function renderBindings() {
    const names=rawSymbols(), signature=JSON.stringify(names);
    if(signature===bindingsSignature)return;
    bindingsSignature=signature;const host=$('bindings');host.replaceChildren();
    if(!names.length){host.append(el('p',{class:'hint'},'Add a symbol such as theta or a to any parameter.'));return;}
    names.forEach(name=>{
      const input=el('input',{type:'text',value:graph.bindings[name]??'',placeholder:'Set a value','aria-label':`Value of ${name}`,maxlength:'500',spellcheck:'false'});
      input.addEventListener('focus',checkpoint);input.addEventListener('input',()=>{
        if(input.value.trim())graph.bindings[name]=input.value;else delete graph.bindings[name];
        refreshAfterEdit();
      });
      host.append(el('label',{class:'binding-row'},el('span',{title:name},pretty(name)),input));
    });
  }
  function renderPresetGuide(name) {
    const metadata=P.names.includes(name)?P.metadata(name):null;
    $('preset-guide').hidden=!metadata;
    if(!metadata||name===presetGuideSignature)return;
    presetGuideSignature=name;
    const host=$('preset-guide-content');
    host.replaceChildren(el('p',{},metadata.description),el('p',{class:'mono'},metadata.formula),
      el('p',{},'Output: base_link → tool0. The template starts in radians and metres, with q1 = q2 = q3 = 0.'),
      el('p',{},'At home: R = I, p = (4.5, 1.25, 1.25).'),
      el('p',{},'Change the joint values to compare both FK methods. Download operations keeps an editable copy; reselecting the template restores its starting values.'));
    if(name==='custom3r-dh'){
      const table=el('table',{'aria-label':'Standard D-H parameters for custom_3R',class:'template-table'},el('thead',{},el('tr',{},['i','θᵢ','dᵢ','aᵢ','αᵢ'].map(text=>el('th',{},text)))),el('tbody',{},[['1','q1','1','1','−π/2'],['2','q2','1.25','2','π/2'],['3','q3','0.25','1.5','0']].map(row=>el('tr',{},row.map(text=>el('td',{},text))))));
      host.append(table,el('p',{},'Each matrix expands into Rz(θᵢ) → Tz(dᵢ) → Tx(aᵢ) → Rx(αᵢ). Select it and use Expand into individual blocks.'),el('p',{},'d₁ = 1 m includes both 0.5 m origin heights. D-H frames 1 and 2 differ from the URDF link frames; the final frame is tool0.'));
    }else{
      host.append(el('p',{},'The screw coordinates are expressed in base_link at q = 0. The fixed home transform M is applied after the three exponentials.'),el('p',{class:'mono'},'ω₁ = (0,0,1), v₁ = (0,0,0)\nω₂ = (0,1,0), v₂ = (−1,0,1)\nω₃ = (0,0,1), v₃ = (1.25,−3,0)'));
    }
    host.append(el('a',{href:'../lectures_main/assets/models/custom_3R/custom_3R.urdf',target:'_blank',rel:'noreferrer'},'Source: custom_3R.urdf'));
  }
  function render({inspector=true}={}) {
    values=G.evaluateGraph(graph);
    numericValues=G.evaluateGraph(graph,{numeric:true});
    graph.nodes.filter(node=>node.type==='logarithm').forEach(node=>values.set(node.id,numericValues.get(node.id)));
    if(selected&&!graph.nodes.some(n=>n.id===selected))selected=null;
    selectedIds=new Set([...selectedIds].filter(id=>graph.nodes.some(n=>n.id===id)));
    if(selected&&!selectedIds.has(selected))selectedIds.add(selected);
    renderNodes();if(inspector)renderInspector();renderBindings();renderOutput();updateView();
    $('block-picker').replaceChildren(el('option',{value:''},'Go to a block…'),...graph.nodes.map(node=>el('option',{value:node.id},node.label)));
    $('block-picker').value=selected||'';
    renderSelection();
    $('angle-unit').value=graph.angleUnit;
    const exampleNames={dh:'D–H transformation',poe:'Product of exponentials',screw:'Screw → matrix → screw',empty:'Empty canvas'};
    P.names.forEach(name=>{exampleNames[name]=P.metadata(name).label;});
    const example=Object.keys(exampleNames).find(k=>exampleNames[k]===graph.name);
    $('example').querySelector('[value="custom"]')?.remove();
    if(example)$('example').value=example;else{$('example').append(el('option',{value:'custom',disabled:true,hidden:true},'Custom operations'));$('example').value='custom';}
    renderPresetGuide(example);
    $('undo').disabled=!history.length;$('redo').disabled=!future.length;
    const count=graph.nodes.length, errors=[...values.values()].filter(r=>r.error).length;
    $('status').textContent=`${count} block${count===1?'':'s'} · ${graph.edges.length} connection${graph.edges.length===1?'':'s'}${errors?' · '+errors+' need input':''}`;
    if($('inspector-error'))$('inspector-error').textContent=values.get(selected)?.error||'';
  }
  function refreshAfterEdit() { render({inspector:false});saveLocal(); }
  function selectNode(id,additive=false) {
    if(additive){if(selectedIds.has(id))selectedIds.delete(id);else selectedIds.add(id);selected=selectedIds.has(id)?id:[...selectedIds].at(-1)||null;}
    else onlySelect(id);
    render();saveLocal();
  }
  function renderSelection() {
    $('selection-count').textContent=selectedIds.size+' selected';
    $('combine-selection').disabled=selectedIds.size<2;
    $('save-function').disabled=!selectedIds.size || graph.nodes.find(n=>n.id===selected)?.type==='logarithm';
    $('nodes').querySelectorAll('.block').forEach(n=>n.classList.toggle('is-selected',selectedIds.has(n.dataset.nodeId)));
  }
  function focusEditor() { ($('inspector-content').querySelector('select,input:not([readonly]):not([aria-label="Block name"])') || $('inspector-content').querySelector('input'))?.focus(); }
  function updateView() {
    $('world').style.transform=`translate(${view.x}px,${view.y}px) scale(${view.scale})`;
    $('zoom-level').value=Math.round(view.scale*100)+'%';
    $('canvas').style.backgroundPosition=`${view.x}px ${view.y}px`;
    $('canvas').style.backgroundSize=`${24*view.scale}px ${24*view.scale}px`;
  }
  function fitGraph() {
    if(!graph.nodes.length){view={x:0,y:0,scale:1};updateView();return;}
    const bounds=$('canvas').getBoundingClientRect();
    const minX=Math.min(...graph.nodes.map(n=>n.position.x))-35,minY=Math.min(...graph.nodes.map(n=>n.position.y))-30;
    const maxX=Math.max(...graph.nodes.map(n=>n.position.x+blockSize(n).width))+35;
    const maxY=Math.max(...graph.nodes.map(n=>n.position.y+blockSize(n).height))+30;
    view.scale=Math.max(.08,Math.min(1.1,(bounds.width-35)/(maxX-minX),(bounds.height-65)/(maxY-minY)));
    view.x=(bounds.width-(maxX-minX)*view.scale)/2-minX*view.scale;
    view.y=(bounds.height-(maxY-minY)*view.scale)/2-minY*view.scale-8;
    updateView();saveLocal();
  }
  function zoom(factor,x=$('canvas').clientWidth/2,y=$('canvas').clientHeight/2) {
    const next=Math.max(.08,Math.min(2,view.scale*factor));
    view.x=x-(x-view.x)*next/view.scale;view.y=y-(y-view.y)*next/view.scale;view.scale=next;updateView();saveLocal();
  }
  function worldPoint(clientX,clientY) {const r=$('canvas').getBoundingClientRect();return{x:(clientX-r.left-view.x)/view.scale,y:(clientY-r.top-view.y)/view.scale};}
  function addBlock(type,point,definition=null) {
    const vectorOrientation=type==='column-vector'?'column':type==='row-vector'?'row':null;
    if(vectorOrientation)type='matrix';
    if(!TYPES[type])return;if(graph.nodes.length>=120){toast('This canvas supports up to 120 blocks.');return;}
    if(type==='function'&&!definition)return;
    const center=point||worldPoint($('canvas').getBoundingClientRect().left+$('canvas').clientWidth/2,$('canvas').getBoundingClientRect().top+$('canvas').clientHeight/2);
    const anchor=graph.nodes.find(n=>n.id===selected)||graph.nodes.at(-1);
    const position=!point&&anchor?{x:anchor.position.x+blockSize(anchor).width+65,y:anchor.position.y}:{x:Math.round(center.x-DEFAULT_BLOCK_SIZE.width/2),y:Math.round(center.y-DEFAULT_BLOCK_SIZE.height/2)};
    if(!point)while(graph.nodes.some(n=>position.x<n.position.x+blockSize(n).width+20&&position.x+DEFAULT_BLOCK_SIZE.width+20>n.position.x&&position.y<n.position.y+blockSize(n).height+20&&position.y+DEFAULT_BLOCK_SIZE.height+20>n.position.y))position.y+=DEFAULT_BLOCK_SIZE.height+45;
    const params=definition?{definition,arguments:Object.fromEntries(definition.parameters.map(name=>[name,name]))}:vectorOrientation?{rows:vectorOrientation==='column'?3:1,columns:vectorOrientation==='row'?3:1,matrix:['x','y','z']}:null;
    const label=definition?.name||(vectorOrientation==='column'?'Column vector':vectorOrientation==='row'?'Row vector':undefined);
    const node=makeNode(freshId(),type,params,position.x,position.y,label);
    const candidate=clone(graph);candidate.nodes.push(node);
    if(definition)Object.entries(definition.defaults||{}).forEach(([name,value])=>{if(!Object.hasOwn(candidate.bindings,name))candidate.bindings[name]=value;});
    try{const validated=G.validateGraph(candidate);checkpoint();graph=validated;}catch(error){toast(error.message);return;}
    onlySelect(node.id);bindingsSignature='';render();saveLocal();
    if(!point){requestAnimationFrame(fitGraph);focusEditor();}
    return node.id;
  }
  function duplicateNode(id) {const node=graph.nodes.find(n=>n.id===id);if(!node||graph.nodes.length>=120)return;const copy=clone(node);copy.id=freshId();copy.label=node.label.slice(0,75)+' copy';copy.position.x+=35;copy.position.y+=50;try{const candidate=G.validateGraph({...graph,nodes:[...graph.nodes,copy]});checkpoint();graph=candidate;onlySelect(copy.id);render();saveLocal();}catch(error){toast(error.message);}}
  function deleteNodes(ids) {const removed=new Set(ids);if(!graph.nodes.some(n=>removed.has(n.id)))return;checkpoint();graph.nodes=graph.nodes.filter(n=>!removed.has(n.id));graph.edges=graph.edges.filter(e=>!removed.has(e.from)&&!removed.has(e.to));onlySelect(graph.nodes.at(-1)?.id||null);connection=null;render();saveLocal();}
  function deleteNode(id) {deleteNodes([id]);}
  function disconnect(id,input) {const matches=e=>e.to===id&&(input===undefined||(e.input||'input')===input);if(!graph.edges.some(matches))return;checkpoint();graph.edges=graph.edges.filter(e=>!matches(e));render();saveLocal();toast('Input disconnected.');}
  function connect(from,to,input='input') {
    const error=G.canConnect(graph,from,to,input);if(error){toast(error);return false;}
    checkpoint();graph.edges=G.connect(graph,from,to,input);onlySelect(to);connection=null;render();saveLocal();return true;
  }
  const definitionId = () => 'f_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,7);
  function openFunctionDialog(action) {
    try {
      const name=action==='combine'?'^0T_1':graph.nodes.find(n=>n.id===selected)?.type==='function'?graph.nodes.find(n=>n.id===selected).label:'forward_kinematics';
      const options={id:definitionId(),name};
      pendingDefinition=selectedIds.size>1?G.captureFunction(graph,[...selectedIds],options):G.functionFromOutput(graph,selected,options);
      functionAction=action;$('function-title').textContent=action==='combine'?'Combine selected blocks':'Save a reusable function';
      $('function-name').value=name;$('function-name-preview').replaceChildren(formattedName(name));
      $('function-description').textContent=action==='combine'?'Replace the selected operations with one named block. Its input and output stay connected.':'Save these operations in My blocks. Each copy has its own arguments; symbolic parameters remain editable.';
      $('function-parameters').replaceChildren(...pendingDefinition.parameters.map(name=>el('span',{class:'tag'},name)));
      if(!pendingDefinition.parameters.length)$('function-parameters').append(el('span',{class:'hint'},'No free parameters'));
      $('function-error').textContent='';$('function-submit').textContent=action==='combine'?'Combine blocks':'Save function';
      $('function-dialog').showModal();$('function-name').select();
    } catch(error) {toast(error.message);}
  }
  function keepDefinition(definition) {
    if(library.length>=60)throw new Error('My blocks can hold 60 functions. Remove one before saving another.');
    definition=G.validateDefinition(definition);library.push(definition);renderLibrary();saveLocal();return definition;
  }
  function renderLibrary() {
    const host=$('function-library');host.replaceChildren();
    if(!library.length){host.append(el('span',{class:'library-empty'},'Select a chain and save it as a function.'));return;}
    library.forEach(definition=>{
      const add=el('button',{class:'library-block',draggable:true,title:`Add ${definition.name}(${definition.parameters.join(', ')})`,'data-function-id':definition.id},formattedName(definition.name),el('small',{},'('+definition.parameters.join(', ')+')'));
      add.addEventListener('click',()=>{if(Date.now()-paletteDragTime>200)addBlock('function',null,clone(definition));});
      add.addEventListener('dragstart',event=>{paletteDragTime=Date.now();event.dataTransfer.setData('application/x-kinematic-function',definition.id);event.dataTransfer.effectAllowed='copy';});
      add.addEventListener('dragend',()=>{paletteDragTime=Date.now();$('canvas').classList.remove('is-dragover');});
      const menu=el('button',{'aria-label':`Actions for saved ${definition.name}`,class:'library-menu',onclick:event=>openMenu([
        {label:'Add to canvas',action:()=>addBlock('function',null,clone(definition))},
        {label:'Download block (.json)',action:()=>download(JSON.stringify(Files.libraryFile([definition]),null,2),'kinematic-block.json','application/json')},
        {label:'Python function </>',action:()=>showDefinitionCode(definition)},
        {label:'Remove from My blocks',action:()=>{library=library.filter(item=>item!==definition);renderLibrary();saveLocal();toast('Removed from My blocks. Existing copies remain available.');}}
      ],event.clientX,event.clientY)},'⋯');
      host.append(el('div',{class:'library-entry'},add,menu));
    });
  }
  function expandNode(id) {
    try{
      const origin={...graph.nodes.find(node=>node.id===id).position};
      let result=G.expandFunction(graph,id),expandedIds=result.nodeIds,outputId=result.outputId;
      for(let depth=0;depth<8;depth++){
        const nested=result.graph.nodes.filter(node=>expandedIds.includes(node.id)&&node.type==='function'&&node.params.definition.kind==='graph');
        if(!nested.length)break;
        for(const node of nested){const expanded=G.expandFunction(result.graph,node.id);expandedIds=expandedIds.flatMap(current=>current===node.id?expanded.nodeIds:[current]);if(outputId===node.id)outputId=expanded.outputId;result=expanded;}
      }
      // Make room for the four visible D-H operations without covering the next link.
      const addedWidth=(expandedIds.length-1)*310;
      result.graph.nodes.forEach(node=>{
        const index=expandedIds.indexOf(node.id);
        if(index>=0)node.position={x:origin.x+index*310,y:origin.y};
        else if(node.position.x>=origin.x&&Math.abs(node.position.y-origin.y)<260)node.position.x+=addedWidth;
      });
      const expandedGraph=G.validateGraph(result.graph);
      checkpoint();graph=expandedGraph;connection=null;selectedIds=new Set(expandedIds);selected=outputId||expandedIds.at(-1)||null;bindingsSignature='';render();saveLocal();requestAnimationFrame(fitGraph);
    }
    catch(error){toast(error.message);}
  }
  $('combine-selection').addEventListener('click',()=>openFunctionDialog('combine'));
  $('save-function').addEventListener('click',()=>openFunctionDialog('save'));
  $('function-name').addEventListener('input',()=>$('function-name-preview').replaceChildren(formattedName($('function-name').value)));
  $('function-form').addEventListener('submit',event=>{
    event.preventDefault();const name=$('function-name').value.trim();if(!name)return;
    try{
      if(functionAction==='combine'){
        const result=G.groupSelection(graph,[...selectedIds],{id:pendingDefinition.id,label:name,nodeId:freshId()});
        checkpoint();graph=result.graph;connection=null;onlySelect(result.nodeId);bindingsSignature='';render();saveLocal();requestAnimationFrame(fitGraph);toast('Blocks combined. Edit the arguments in the inspector.');
      }else{keepDefinition({...pendingDefinition,name});toast('Function saved in My blocks. Drag it onto the canvas to reuse it.');}
      $('function-dialog').close();
    }catch(error){$('function-error').textContent=error.message;}
  });
  function finishPort(id,port,input='input') {
    if(!connection)return false;
    if(connection.id===id&&connection.port===port)return false;
    if(connection.port===port){toast('Connect an output port to an input port.');return false;}
    return connection.port==='output'?connect(connection.id,id,input):connect(id,connection.id,connection.input);
  }
  function handlePortClick(id,port,input='input') {if(!finishPort(id,port,input)){connection={id,port,input};renderConnections();}}
  function nearbyPort(clientX,clientY,pointerType='mouse') {
    if(!connection)return null;
    const canvas=$('canvas').getBoundingClientRect();
    if(clientX<canvas.left||clientX>canvas.right||clientY<canvas.top||clientY>canvas.bottom)return null;
    let nearest=null,distance=pointerType==='touch'?36:28;
    $('nodes').querySelectorAll(`[data-port="${connection.port==='output'?'input':'output'}"]`).forEach(port=>{
      const {nodeId:id,port:direction,input='input'}=port.dataset;
      if(id===connection.id)return;
      const r=port.getBoundingClientRect(),d=Math.hypot(clientX-r.left-r.width/2,clientY-r.top-r.height/2);
      if(d>distance)return;
      const error=connection.port==='output'?G.canConnect(graph,connection.id,id,input):G.canConnect(graph,id,connection.id,connection.input);
      if(error)return;
      nearest={id,port:direction,input};distance=d;
    });
    return nearest;
  }
  function moveConnection(event) {
    if(!connection)return;
    connection.pointer=worldPoint(event.clientX,event.clientY);
    connection.target=nearbyPort(event.clientX,event.clientY,event.pointerType);
    renderConnections();
  }
  function startPort(event) {
    if(event.button!==0)return;event.stopPropagation();event.preventDefault();
    const {nodeId:id,port,input='input'}=event.currentTarget.dataset;
    if(connection&&finishPort(id,port,input))return;
    connection={id,port,input,pointer:worldPoint(event.clientX,event.clientY)};
    gesture={type:'connect',pointer:event.pointerId,startX:event.clientX,startY:event.clientY};
    $('canvas').setPointerCapture(event.pointerId);renderConnections();
  }
  function startNodeDrag(event,id) {
    if(event.button!==0||event.target.closest('button,input,select,textarea,a,[contenteditable="true"]'))return;event.preventDefault();event.stopPropagation();
    if(event.shiftKey||event.ctrlKey||event.metaKey){selectNode(id,true);suppressClickUntil=Date.now()+400;return;}
    if(!selectedIds.has(id))onlySelect(id);else selected=id;
    renderInspector();renderOutput();renderSelection();
    gesture={type:'node',id,pointer:event.pointerId,startX:event.clientX,startY:event.clientY,positions:graph.nodes.filter(n=>selectedIds.has(n.id)).map(n=>({id:n.id,...n.position}))};
    $('canvas').setPointerCapture(event.pointerId);
  }
  $('canvas').addEventListener('pointerdown',event=>{
    if(event.button!==0||event.target.closest('.block,.wire,.wire-hit,button'))return;
    event.preventDefault();closeMenu();const pan=spaceDown||canvasMode==='pan';
    gesture={type:pan?'pan':'select',pointer:event.pointerId,startX:event.clientX,startY:event.clientY,x:view.x,y:view.y,base:event.shiftKey?new Set(selectedIds):new Set()};
    $('canvas').setPointerCapture(event.pointerId);
  });
  $('canvas').addEventListener('pointermove',event=>{
    if(!gesture){if(connection)moveConnection(event);return;}
    if(gesture.pointer!==event.pointerId)return;
    const dx=event.clientX-gesture.startX,dy=event.clientY-gesture.startY;
    if(gesture.type==='node'){
      if(!gesture.moved){if(Math.hypot(dx,dy)<3)return;checkpoint();gesture.moved=true;}
      gesture.positions.forEach(start=>{const node=graph.nodes.find(n=>n.id===start.id);node.position={x:start.x+dx/view.scale,y:start.y+dy/view.scale};const element=$('nodes').querySelector(`[data-node-id="${CSS.escape(node.id)}"]`);element.classList.add('is-dragging');element.style.left=node.position.x+'px';element.style.top=node.position.y+'px';});renderConnections();
    }else if(gesture.type==='pan'){view.x=gesture.x+dx;view.y=gesture.y+dy;updateView();}
    else if(gesture.type==='connect')moveConnection(event);
    else if(gesture.type==='select'){
      const bounds=$('canvas').getBoundingClientRect(),left=Math.min(gesture.startX,event.clientX),top=Math.min(gesture.startY,event.clientY),right=Math.max(gesture.startX,event.clientX),bottom=Math.max(gesture.startY,event.clientY);
      Object.assign($('selection-box').style,{left:left-bounds.left+'px',top:top-bounds.top+'px',width:right-left+'px',height:bottom-top+'px'});$('selection-box').hidden=false;
      selectedIds=new Set(gesture.base);
      $('nodes').querySelectorAll('.block').forEach(node=>{const r=node.getBoundingClientRect();if(r.right>=left&&r.left<=right&&r.bottom>=top&&r.top<=bottom)selectedIds.add(node.dataset.nodeId);});
      selected=[...selectedIds].at(-1)||null;renderSelection();
    }
  });
  $('canvas').addEventListener('pointerup',event=>{
    if(!gesture||gesture.pointer!==event.pointerId)return;
    const current=gesture;gesture=null;
    $('nodes').querySelectorAll('.is-dragging').forEach(node=>node.classList.remove('is-dragging'));
    suppressClickUntil=Date.now()+100;
    if($('canvas').hasPointerCapture(event.pointerId))$('canvas').releasePointerCapture(event.pointerId);
    if(current.type==='connect'){
      const port=nearbyPort(event.clientX,event.clientY,event.pointerType);
      if(port)finishPort(port.id,port.port,port.input);
      if(connection){delete connection.pointer;delete connection.target;}renderConnections();
    }
    if(current.type==='select'){
      if(Math.hypot(event.clientX-current.startX,event.clientY-current.startY)<3){selectedIds=current.base;selected=[...selectedIds].at(-1)||null;}
      $('selection-box').hidden=true;render();
    }
    saveLocal();$('undo').disabled=!history.length;
  });
  $('canvas').addEventListener('pointercancel',()=>{gesture=null;connection=null;$('nodes').querySelectorAll('.is-dragging').forEach(node=>node.classList.remove('is-dragging'));$('selection-box').hidden=true;renderConnections();});
  $('canvas').addEventListener('wheel',event=>{event.preventDefault();const rect=$('canvas').getBoundingClientRect();zoom(Math.exp(-event.deltaY*.0015),event.clientX-rect.left,event.clientY-rect.top);},{passive:false});
  document.querySelectorAll('.palette-item').forEach(button=>{
    button.addEventListener('dragstart',event=>{paletteDragTime=Date.now();event.dataTransfer.setData('application/x-kinematic-block',button.dataset.type);event.dataTransfer.setData('text/plain',button.dataset.type);event.dataTransfer.effectAllowed='copy';});
    button.addEventListener('dragend',()=>{paletteDragTime=Date.now();$('canvas').classList.remove('is-dragover');});
    button.addEventListener('click',()=>{if(Date.now()-paletteDragTime>200)addBlock(button.dataset.type);});
  });
  $('canvas').addEventListener('dragover',event=>{event.preventDefault();event.dataTransfer.dropEffect='copy';$('canvas').classList.add('is-dragover');});
  $('canvas').addEventListener('dragleave',event=>{if(!event.currentTarget.contains(event.relatedTarget))$('canvas').classList.remove('is-dragover');});
  $('canvas').addEventListener('drop',event=>{event.preventDefault();$('canvas').classList.remove('is-dragover');const definition=library.find(d=>d.id===event.dataTransfer.getData('application/x-kinematic-function'));addBlock(definition?'function':event.dataTransfer.getData('application/x-kinematic-block')||event.dataTransfer.getData('text/plain'),worldPoint(event.clientX,event.clientY),definition?clone(definition):null);});
  function openMenu(items,x,y) {
    const menu=$('context-menu');menu.replaceChildren(...items.map(item=>el('button',{role:'menuitem',onclick:()=>{closeMenu();item.action();}},item.label)));
    menu.hidden=false;menu.style.left=Math.min(Math.max(8,x),innerWidth-menu.offsetWidth-8)+'px';menu.style.top=Math.min(Math.max(8,y),innerHeight-menu.offsetHeight-8)+'px';menu.querySelector('button')?.focus();
  }
  function closeMenu(){$('context-menu').hidden=true;}
  function openNodeMenu(id,x,y) {
    if(!selectedIds.has(id))onlySelect(id);else selected=id;render();
    const node=graph.nodes.find(n=>n.id===id),items=[{label:'Edit parameters',action:focusEditor},{label:'Python code </>',action:()=>showCode(id)}];
    if(selectedIds.size>1)items.push({label:'Combine selected blocks',action:()=>openFunctionDialog('combine')});
    if(node.type!=='logarithm')items.push({label:'Save as function',action:()=>openFunctionDialog('save')});
    if(node.type==='function'&&node.params.definition.kind==='graph')items.push({label:'Expand individual blocks',action:()=>expandNode(id)});
    items.push({label:'Duplicate',action:()=>duplicateNode(id)},{label:'Disconnect input',action:()=>disconnect(id)},{label:selectedIds.size>1?'Delete selected blocks':'Delete block',action:()=>deleteNodes([...selectedIds])});openMenu(items,x,y);
  }
  document.addEventListener('pointerdown',event=>{if(!event.target.closest('#context-menu'))closeMenu();});
  $('context-menu').addEventListener('keydown',event=>{const buttons=[...$('context-menu').querySelectorAll('button')],i=buttons.indexOf(document.activeElement);if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();buttons[(i+(event.key==='ArrowDown'?1:buttons.length-1))%buttons.length]?.focus();}});
  function updateCode() {
    try{const options={includeBindings:$('code-bindings').checked,scope:$('code-scope').value};$('python-code').textContent=codeDefinition?window.KinematicsPython.exportFunction(codeDefinition,options):window.KinematicsPython.generatePython(graph,codeNode,options);$('copy-python').disabled=false;$('download-python').disabled=false;}
    catch(error){$('python-code').textContent='Cannot generate Python yet: '+error.message;$('copy-python').disabled=true;$('download-python').disabled=true;}
  }
  function showCode(id) {codeNode=id;codeDefinition=null;const node=graph.nodes.find(n=>n.id===id);if(!node)return;$('code-scope').disabled=false;$('code-scope').value='chain';$('code-title').textContent='Python · '+node.label;$('code-bindings').checked=node.type==='logarithm';updateCode();if(!$('code-dialog').open)$('code-dialog').showModal();}
  function showDefinitionCode(definition) {codeDefinition=definition;codeNode=null;$('code-scope').value='chain';$('code-scope').disabled=true;$('code-bindings').checked=false;$('code-title').textContent='Python · '+definition.name;updateCode();$('code-dialog').showModal();}
  function download(content,filename,mime) {const url=URL.createObjectURL(new Blob([content],{type:mime}));const a=el('a',{href:url,download:filename});document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  async function copy(text) {
    try{if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(text);else throw new Error('Clipboard unavailable');toast('Copied to clipboard.');}
    catch(_){const area=el('textarea',{value:text});area.style.position='fixed';area.style.opacity='0';document.body.append(area);area.select();const okay=document.execCommand('copy');area.remove();toast(okay?'Copied to clipboard.':'Copy is unavailable here. Use the download button.');}
  }
  function saveGraph(){
    try{download(JSON.stringify(Files.workspaceFile(graph,library,selected),null,2),'kinematic-operations.json','application/json');toast('Operations downloaded, including the graph and My blocks.');}
    catch(error){toast('Could not download operations: '+error.message);}
  }
  $('save').addEventListener('click',saveGraph);$('import').addEventListener('click',()=>$('graph-file').click());
  $('upload-blocks').addEventListener('click',()=>$('graph-file').click());
  $('download-blocks').addEventListener('click',()=>{download(JSON.stringify(Files.libraryFile(library),null,2),'kinematic-blocks.json','application/json');toast('My blocks downloaded.');});
  function restoreFile(candidate) {
    const restored=Files.readFile(candidate,library);
    checkpoint();library=restored.library;
    if(restored.graph){graph=restored.graph;onlySelect(restored.selected||graph.nodes.at(-1)?.id||null);}
    bindingsSignature='';connection=null;renderLibrary();render();requestAnimationFrame(fitGraph);saveLocal();
    toast(restored.graph?'Operations uploaded.':'Saved operations added to My blocks.');
  }
  $('graph-file').addEventListener('change',async()=>{
    const file=$('graph-file').files[0];if(!file)return;
    try{if(file.size>5*1024*1024)throw new Error('Choose an operations file smaller than 5 MB.');restoreFile(JSON.parse(await file.text()));}
    catch(error){toast('Could not upload operations: '+error.message);}finally{$('graph-file').value='';}
  });
  $('load-iiwa-example').addEventListener('click',async()=>{
    const button=$('load-iiwa-example');button.disabled=true;
    try{const response=await fetch('examples/exercise-01-iiwa7-twists.json');if(!response.ok)throw new Error('Example file could not be loaded.');restoreFile(await response.json());}
    catch(error){toast('Download the KUKA example and choose Upload operations to open it.');}
    finally{button.disabled=false;}
  });
  $('block-picker').addEventListener('change',()=>{
    const node=graph.nodes.find(n=>n.id===$('block-picker').value);if(!node)return;selectNode(node.id);
    view.scale=.9;view.x=$('canvas').clientWidth/2-(node.position.x+116)*view.scale;view.y=$('canvas').clientHeight/2-(node.position.y+120)*view.scale;updateView();saveLocal();
  });
  $('select-output-columns').addEventListener('click',()=>{
    const source=selected,value=values.get(source)?.value;if(!value?.matrix||['scalar','screw'].includes(value.kind))return;
    const anchor=graph.nodes.find(n=>n.id===source),id=freshId();
    const node=makeNode(id,'columns',{columns:value.matrix[0].map((_,i)=>i+1),rowStart:1,rowCount:value.matrix.length},anchor.position.x+blockSize(anchor).width+65,anchor.position.y,'Selected columns');
    try{
      const candidate=G.validateGraph({...graph,nodes:[...graph.nodes,node],edges:[...graph.edges,...node.params.columns.map((_,i)=>({from:source,to:id,input:'c'+i}))]});
      checkpoint();graph=candidate;onlySelect(id);render();saveLocal();requestAnimationFrame(fitGraph);
    }catch(error){toast('Could not select columns: '+error.message);}
  });
  function loadExample(name){checkpoint();graph=preset(name);onlySelect(graph.nodes.at(-1)?.id||null);bindingsSignature='';connection=null;render();requestAnimationFrame(fitGraph);saveLocal();}
  $('example').addEventListener('change',()=>{if($('example').value!=='custom')loadExample($('example').value);});$('load-dh').addEventListener('click',()=>loadExample('dh'));
  $('angle-unit').addEventListener('change',()=>{checkpoint();graph.angleUnit=$('angle-unit').value;refreshAfterEdit();toast('Angle parameters now use '+(graph.angleUnit==='deg'?'degrees.':'radians.'));});
  $('symbolic-view').addEventListener('click',()=>{displayMode='symbolic';renderOutput();});$('numeric-view').addEventListener('click',()=>{displayMode='numeric';renderOutput();});
  $('copy-result').addEventListener('click',()=>{const v=(displayMode==='numeric'?numericValues:values).get(selected)?.value;if(!v)return;try{const convert=e=>displayMode==='numeric'?M.evaluate(e,graph.bindings):M.format(e);copy(JSON.stringify(v.kind==='screw'?{omega:v.screw.omega.map(convert),v:v.screw.v.map(convert),theta:convert(v.screw.theta)}:v.matrix.map(row=>row.map(convert)),null,2));}catch(error){toast(error.message);}});
  $('output-python').addEventListener('click',()=>showCode(selected));$('code-bindings').addEventListener('change',updateCode);$('code-scope').addEventListener('change',updateCode);$('copy-python').addEventListener('click',()=>copy($('python-code').textContent));$('download-python').addEventListener('click',()=>download($('python-code').textContent,'kinematic_composition.py','text/x-python'));
  $('import-python').addEventListener('click',()=>{$('python-import-error').textContent='';$('python-import-status').textContent='';$('python-import-dialog').showModal();});
  function inspectPythonSource() {
    try{const info=window.KinematicsPythonImport.inspectSource($('python-source').value);if(info.functions.length===1)$('python-function-name').value=info.functions[0];$('python-function-name').disabled=info.kind==='playground';$('python-import-status').textContent=info.kind==='playground'?'Playground export detected · imports offline.':info.functions.length?'Available functions: '+info.functions.join(', '):'';$('python-import-error').textContent='';}
    catch(error){$('python-import-error').textContent=error.message;}
  }
  $('python-source').addEventListener('change',inspectPythonSource);
  $('python-file').addEventListener('change',async()=>{const file=$('python-file').files[0];if(!file)return;try{if(file.size>1024*1024)throw new Error('Choose a Python file smaller than 1 MB.');$('python-source').value=await file.text();inspectPythonSource();}catch(error){$('python-import-error').textContent=error.message;}finally{$('python-file').value='';}});
  $('run-python-import').addEventListener('click',async()=>{
    if(importController)return;
    importController=new AbortController();$('run-python-import').disabled=true;$('cancel-python-import').hidden=false;$('python-import-error').textContent='';
    try{
      const definition=await window.KinematicsPythonImport.importSource($('python-source').value,{functionName:$('python-function-name').value.trim()||undefined,allowExternal:true,signal:importController.signal,onStatus:status=>{$('python-import-status').textContent=status.message||String(status);}});
      if(importController.signal.aborted)return;
      definition.id=definitionId();definition.name=$('python-block-name').value.trim()||definition.name;
      keepDefinition(definition);const added=addBlock('function',null,clone(definition));$('python-import-dialog').close();toast(added?'Python function imported into My blocks and added to the canvas.':'Function saved in My blocks. Remove some canvas blocks before adding it.');
    }catch(error){$('python-import-error').textContent=error.message;}
    finally{importController=null;$('run-python-import').disabled=false;$('cancel-python-import').hidden=true;}
  });
  $('cancel-python-import').addEventListener('click',()=>importController?.abort());
  $('python-import-dialog').addEventListener('close',()=>importController?.abort());
  $('help').addEventListener('click',()=>$('help-dialog').showModal());$('undo').addEventListener('click',()=>undo());$('redo').addEventListener('click',()=>undo(true));
  $('zoom-in').addEventListener('click',()=>zoom(1.15));$('zoom-out').addEventListener('click',()=>zoom(1/1.15));$('fit').addEventListener('click',fitGraph);
  function setCanvasMode(mode){canvasMode=mode;$('select-mode').setAttribute('aria-pressed',mode==='select');$('pan-mode').setAttribute('aria-pressed',mode==='pan');$('canvas').classList.toggle('pan-mode',mode==='pan');}
  $('select-mode').addEventListener('click',()=>setCanvasMode('select'));$('pan-mode').addEventListener('click',()=>setCanvasMode('pan'));
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'){
      closeMenu();connection=null;
      if(gesture?.type==='connect'){const pointer=gesture.pointer;gesture=null;if($('canvas').hasPointerCapture(pointer))$('canvas').releasePointerCapture(pointer);}
      renderConnections();return;
    }
    if(document.querySelector('dialog[open]'))return;
    const typing=event.target.matches('input,textarea,select')||event.target.isContentEditable;
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();saveGraph();return;}
    if(typing)return;
    if(event.code==='Space'){event.preventDefault();spaceDown=true;$('canvas').classList.add('space-pan');}
    else if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='a'){event.preventDefault();selectedIds=new Set(graph.nodes.map(n=>n.id));selected=graph.nodes.at(-1)?.id||null;render();}
    else if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='g'){event.preventDefault();if(selectedIds.size>1)openFunctionDialog('combine');}
    else if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){event.preventDefault();undo(event.shiftKey);}
    else if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='y'){event.preventDefault();undo(true);}
    else if((event.key==='Delete'||event.key==='Backspace')&&selectedIds.size){event.preventDefault();deleteNodes([...selectedIds]);}
  });
  document.addEventListener('keyup',event=>{if(event.code==='Space'){spaceDown=false;$('canvas').classList.remove('space-pan');}});
  window.addEventListener('blur',()=>{spaceDown=false;$('canvas').classList.remove('space-pan');});
  try{
    const saved=JSON.parse(localStorage.getItem(STORAGE)||'null');
    if(saved){graph=G.validateGraph(saved.graph);onlySelect(graph.nodes.some(n=>n.id===saved.selected)?saved.selected:graph.nodes.at(-1)?.id||null);if(saved.view&&[saved.view.x,saved.view.y,saved.view.scale].every(Number.isFinite)&&saved.view.scale>=.08&&saved.view.scale<=2)view=saved.view;}
  }catch(_){/* A fresh example remains available if stored data is incomplete. */}
  try{const saved=JSON.parse(localStorage.getItem(LIBRARY_STORAGE)||'[]');if(Array.isArray(saved))library=saved.slice(0,60).flatMap(item=>{try{return[G.validateDefinition(item)];}catch(_){return[];}});}catch(_){}
  preview=window.KinematicsPreview?.create($('preview'));
  renderLibrary();render();requestAnimationFrame(fitGraph);
  new ResizeObserver(()=>{updateView();renderConnections();}).observe($('canvas'));
  window.addEventListener('beforeunload',()=>{try{localStorage.setItem(STORAGE,JSON.stringify({graph,selected,view}));localStorage.setItem(LIBRARY_STORAGE,JSON.stringify(library));}catch(_){}});
  // Read-only snapshots make the teaching state available to browser checks.
  window.KinematicsPlayground={getState:()=>clone({graph,selected,selectedIds:[...selectedIds],library,view,displayMode}),getOutput:()=>(displayMode==='numeric'?numericValues:values).get(selected)?.value||null};
})();
