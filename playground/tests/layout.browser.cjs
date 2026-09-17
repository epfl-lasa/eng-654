/* A local browser check using a disposable, isolated Chromium context.
 * Start a repo-root HTTP server and Chromium with remote debugging enabled.
 * OPERATIONS_BASE_URL and OPERATIONS_CDP_PORT override defaults.
 * node playground/tests/layout.browser.cjs
 */
const assert = require('node:assert/strict');
const base = process.env.OPERATIONS_BASE_URL || 'http://127.0.0.1:8062';
const cdp = 'http://127.0.0.1:' + (process.env.OPERATIONS_CDP_PORT || '9256');

async function connection(url) {
  const socket = new WebSocket(url), pending = new Map(), errors = [];
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let serial = 0;
  socket.addEventListener('message', event => {
    const data = JSON.parse(event.data);
    if (data.id) {
      const item = pending.get(data.id); if (!item) return;
      pending.delete(data.id); clearTimeout(item.timer);
      data.error ? item.reject(Error(JSON.stringify(data.error))) : item.resolve(data.result);
    } else if (data.method === 'Runtime.exceptionThrown') errors.push(data.params.exceptionDetails);
    else if (data.method === 'Runtime.consoleAPICalled' && data.params.type === 'error') errors.push(data.params.args.map(arg => arg.value || arg.description).join(' '));
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++serial, timer = setTimeout(() => { pending.delete(id); reject(Error('CDP timeout: ' + method)); }, 30000);
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  });
  return { send, errors, close: () => socket.close() };
}

(async () => {
  const info = await (await fetch(cdp + '/json/version')).json();
  const browser = await connection(info.webSocketDebuggerUrl);
  let context, page;
  try {
    context = (await browser.send('Target.createBrowserContext')).browserContextId;
    const target = await browser.send('Target.createTarget', { url: 'about:blank', browserContextId: context });
    const targets = await (await fetch(cdp + '/json/list')).json();
    page = await connection(targets.find(item => item.id === target.targetId).webSocketDebuggerUrl);
    const run = async expression => {
      const result = await page.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    const until = async (expression, label) => {
      for (let attempt = 0; attempt < 100; attempt++) {
        if (await run(expression)) return;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw Error('Timed out: ' + (label || expression) + '; ' + JSON.stringify(page.errors));
    };
    const click = selector => run(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const change = (selector, value, event = 'change') => run(`(() => { const input=document.querySelector(${JSON.stringify(selector)}); input.value=${JSON.stringify(String(value))}; input.dispatchEvent(new Event(${JSON.stringify(event)}, {bubbles:true})); })()`);
    const state = () => run('KinematicsPlayground.getState()');
    const select = id => run("document.querySelector("+JSON.stringify('[data-node-id="'+id+'"]')+").dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))");
    const add = async type => { await click(`.palette-item[data-type="${type}"]`); const id=(await state()).selected;await select(id);return id; };
    await page.send('Runtime.enable'); await page.send('Page.enable'); await page.send('Network.enable');
    await page.send('Network.setCacheDisabled', { cacheDisabled: true });
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1100, deviceScaleFactor: 1, mobile: false });
    await page.send('Page.navigate', { url: base + '/playground/building_blocks.html' });
    await until('!!window.KinematicsPlayground', 'playground startup');

    const key=async (key,modifiers=2)=>{
      await run('document.querySelector("#canvas").focus()');
      await page.send('Input.dispatchKeyEvent',{type:'keyDown',key,code:'Key'+key.toUpperCase(),windowsVirtualKeyCode:key.toUpperCase().charCodeAt(0),modifiers});
      await page.send('Input.dispatchKeyEvent',{type:'keyUp',key,modifiers});
    };

    const settle=()=>run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    const upload=async graph=>{
      await run(`(()=>{const t=new DataTransfer();t.items.add(new File([${JSON.stringify(JSON.stringify(graph))}], 'layout.json',{type:'application/json'}));const input=document.querySelector('#graph-file');input.files=t.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      await until(`KinematicsPlayground.getState().graph.name===${JSON.stringify(graph.name)}`);await settle();
    };
    const layout=async()=>{
      await settle();
      const rectangles=await run(`(()=>{const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom};};return {canvas:rect(document.querySelector('#canvas')),controls:rect(document.querySelector('.canvas-controls')),heading:rect(document.querySelector('.canvas-heading')),blocks:[...document.querySelectorAll('.block')].map(rect)};})()`);
      for(const r of rectangles.blocks){
        assert.ok(r.x>=rectangles.canvas.x&&r.right<=rectangles.canvas.right,JSON.stringify(rectangles));
        assert.ok(r.y>=rectangles.heading.bottom&&r.bottom<=rectangles.controls.y,JSON.stringify(rectangles));
      }
      for(let i=0;i<rectangles.blocks.length;i++)for(let j=i+1;j<rectangles.blocks.length;j++){
        const a=rectangles.blocks[i],b=rectangles.blocks[j];assert.ok(a.right<=b.x||b.right<=a.x||a.bottom<=b.y||b.bottom<=a.y,'overlapping blocks');
      }
    };
    const fixture={version:1,name:'Scattered branches',nodes:['a','b','c','d','out','separate'].map((id,i)=>({id,type:'matrix',label:id,params:{rows:3,columns:3,matrix:['1','0','0','0','1','0','0','0','1']},position:{x:i%2?5000:-5000,y:i%2?-9000:9000}})),edges:[{from:'a',to:'b'},{from:'a',to:'c'},{from:'b',to:'out'}],bindings:{},angleUnit:'rad'};
    await upload(fixture);
    const original=await state();
    await click('#arrange-fit');await layout();
    const arranged=await state();
    assert.deepEqual(arranged.graph.edges,original.graph.edges);
    assert.deepEqual(arranged.graph.nodes.map(n=>n.params),original.graph.nodes.map(n=>n.params));
    assert.deepEqual(arranged.selectedIds,original.selectedIds);
    assert.notDeepEqual(arranged.graph.nodes.map(n=>n.position),original.graph.nodes.map(n=>n.position));
    await key('z');assert.deepEqual((await state()).graph,original.graph);assert.deepEqual((await state()).view,original.view);
    await key('y');await layout();assert.deepEqual((await state()).graph,arranged.graph);
    await key('z');await key('F',10);await layout();assert.deepEqual((await state()).graph,arranged.graph);
    await run('document.querySelector("#inspector-content input").focus()');
    const beforeTyping=await state();
    await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'F',modifiers:10});
    assert.deepEqual((await state()).graph,beforeTyping.graph);
    for(const [width,height] of [[1280,720],[800,900],[390,844]]){
      await page.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<650});
      await click('#arrange-fit');await layout();
    }
    await page.send('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false});
    const long={...fixture,name:'Long chain',nodes:Array.from({length:120},(_,i)=>({...fixture.nodes[0],id:'n'+i,label:'Block '+i})),edges:Array.from({length:119},(_,i)=>({from:'n'+i,to:'n'+(i+1)}))};
    await upload(long);await key('F',10);await layout();assert.ok((await state()).view.scale<0.08,'long chains fit below the old zoom limit');
    await change('#example','empty');await key('F',10);assert.equal((await state()).graph.nodes.length,0);
    await add('rotation');await key('F',10);await layout();
    assert.deepEqual(page.errors,[]);
    console.log('PASS: arrange button and shortcut, branches, disconnected blocks, undo/redo, input focus, responsive fit, 120-block chain, empty and single-block canvases.');
  } finally {
    if(context)await browser.send('Target.disposeBrowserContext',{browserContextId:context});
    page?.close();browser.close();
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
