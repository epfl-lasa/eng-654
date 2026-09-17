/* A local browser check using a disposable, isolated Chromium context.
 * Start a repo-root HTTP server and Chromium with remote debugging enabled.
 * OPERATIONS_BASE_URL, OPERATIONS_CDP_PORT and OPERATIONS_SCREENSHOT override defaults.
 * node playground/tests/drag-subtract.browser.cjs
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const base = process.env.OPERATIONS_BASE_URL || 'http://127.0.0.1:8062';
const cdp = 'http://127.0.0.1:' + (process.env.OPERATIONS_CDP_PORT || '9256');
const screenshot = process.env.OPERATIONS_SCREENSHOT || '/tmp/building-blocks-drag-subtract.png';

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
    const select = id => change('#block-picker', id);
    const state = () => run('KinematicsPlayground.getState()');
    const output = () => run('KinematicsPlayground.getOutput()?.matrix.map(row => row.map(value => KinematicsMath.evaluate(value, KinematicsPlayground.getState().graph.bindings)))');
    const near = (actual, expected) => {
      assert.equal(actual.length, expected.length);
      actual.forEach((row, r) => { assert.equal(row.length, expected[r].length); row.forEach((value, c) => assert.ok(Math.abs(value - expected[r][c]) < 1e-10, `${r},${c}: ${value} != ${expected[r][c]}`)); });
    };
    const add = async type => { await click(`.palette-item[data-type="${type}"]`); return (await state()).selected; };
    const source = (label, id) => change(`select[aria-label="${label}"]`, id);
    const wire = async (from, to, input) => {
      // Keyboard activation starts at the receiving port, then chooses its source.
      await click(`article[data-node-id="${to}"] [data-port="input"][data-input="${input}"]`);
      await click(`article[data-node-id="${from}"] [data-port="output"]`);
    };
    const upload = async content => {
      await run(`(() => { const transfer=new DataTransfer(); transfer.items.add(new File([${JSON.stringify(content)}], 'operations.json', {type:'application/json'})); const input=document.querySelector('#graph-file'); input.files=transfer.files; input.dispatchEvent(new Event('change', {bubbles:true})); })()`);
      await until('document.querySelector("#graph-file").value === ""', 'file upload completion');
    };
    await page.send('Runtime.enable'); await page.send('Page.enable'); await page.send('Network.enable');
    await page.send('Network.setCacheDisabled', { cacheDisabled: true });
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1100, deviceScaleFactor: 1, mobile: false });
    await page.send('Page.navigate', { url: base + '/playground/building_blocks.html' });
    await until('!!window.KinematicsPlayground', 'playground startup');
    const fixture={version:1,name:'Subtract vectors',angleUnit:'rad',bindings:{},nodes:[
      {id:'a',type:'matrix',label:'A',params:{rows:3,columns:1,matrix:['7','2','-1']},position:{x:100,y:90}},
      {id:'b',type:'matrix',label:'B',params:{rows:3,columns:1,matrix:['3','5','-1']},position:{x:100,y:420}},
      {id:'difference',type:'subtract',label:'A minus B',params:{},position:{x:600,y:230}}
    ],edges:[]};
    await upload(JSON.stringify(fixture));
    await until('KinematicsPlayground.getState().graph.nodes.length===3');
    const settle=()=>run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    await settle();
    const center=selector=>run(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
    const mouse=(type,p)=>page.send('Input.dispatchMouseEvent',{type,x:p.x,y:p.y,button:'left',buttons:type==='mouseReleased'?0:1,clickCount:type==='mouseMoved'?0:1});
    const drag=async (p,q)=>{await mouse('mousePressed',p);await mouse('mouseMoved',q);await mouse('mouseReleased',q);await settle();};
    const port=(id,direction,input)=>`article[data-node-id="${id}"] [data-port="${direction}"]${input?`[data-input="${input}"]`:''}`;
    const position=async id=>(await state()).graph.nodes.find(n=>n.id===id).position;
    // Both matrix cells and the footer move the block, with undo preserving its old position.
    for(const selector of ['.block-body td','.block-footer span']) {
      const before=await position('a'),scale=(await state()).view.scale,p=await center(`article[data-node-id="a"] ${selector}`);
      await drag(p,{x:p.x+45,y:p.y+22});
      const after=await position('a');
      assert.ok(Math.abs(after.x-before.x-45/scale)<1e-6);
      assert.ok(Math.abs(after.y-before.y-22/scale)<1e-6);
      await click('#undo');assert.deepEqual(await position('a'),before);
    }
    // Multi-selection also moves from a body, and the whole move is one undo step.
    await run('document.querySelector("#canvas").focus()');
    await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',modifiers:2});
    await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA'});
    assert.equal((await state()).selectedIds.length,3);
    const groupBefore=(await state()).graph.nodes.map(n=>n.position),groupScale=(await state()).view.scale;
    const groupStart=await center('article[data-node-id="b"] .block-body');
    await drag(groupStart,{x:groupStart.x+20,y:groupStart.y-15});
    (await state()).graph.nodes.forEach((n,i)=>{assert.ok(Math.abs(n.position.x-groupBefore[i].x-20/groupScale)<1e-6);assert.ok(Math.abs(n.position.y-groupBefore[i].y+15/groupScale)<1e-6);});
    await click('#undo');assert.deepEqual((await state()).graph.nodes.map(n=>n.position),groupBefore);
    // Block buttons still open their menu without moving the block.
    const before=await position('a');
    await click('article[data-node-id="a"] .block-menu');
    assert.equal(await run('document.querySelector("#context-menu").hidden'),false);
    assert.deepEqual(await position('a'),before);
    await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape'});
    await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape'});
    // A release outside the visible circle and its hit area still snaps to A.
    for(const [source,input,reverse] of [['a','a',false],['b','b',true]]) {
      const origin=await center(port(reverse?'difference':source,reverse?'input':'output',reverse?input:null));
      const target=await center(port(reverse?source:'difference',reverse?'output':'input',reverse?null:input));
      const near={x:target.x+(reverse?24:-24),y:target.y};
      await mouse('mousePressed',origin);await mouse('mouseMoved',near);
      assert.equal(await run('document.querySelectorAll(".is-snap-target").length'),1);
      const error=await run(`(()=>{const path=document.querySelector('.wire-pending');const p=path.getPointAtLength(${reverse?'0':'path.getTotalLength()'});const screen=new DOMPoint(p.x,p.y).matrixTransform(path.getScreenCTM());return Math.hypot(screen.x-${target.x},screen.y-${target.y})})()`);
      assert.ok(error<1,'preview line ends at the actual target centre');
      await mouse('mouseReleased',near);await settle();
      assert.ok((await state()).graph.edges.some(e=>e.from===source&&e.to==='difference'&&e.input===input));
      assert.equal(await run('document.querySelectorAll(".is-snap-target").length'),0);
    }
    await select('difference');near(await output(),[[4],[-3],[0]]);
    // The same operation preserves row orientation after changing both operands.
    for(const id of ['a','b']){await select(id);await click('[data-vector-orientation="row"]');}
    await select('difference');near(await output(),[[4,-3,0]]);
    await click('#undo');await select('difference');assert.equal(await run('KinematicsPlayground.getOutput()'),null,'mixed row/column inputs report an error');
    await click('#redo');await select('difference');near(await output(),[[4,-3,0]]);
    // Snap tolerance is in screen pixels, including when zoomed out.
    await click('#zoom-out');await click('#zoom-out');await settle();
    const origin=await center(port('a','output')),zoomTarget=await center(port('difference','input','a'));
    await drag(origin,{x:zoomTarget.x-24,y:zoomTarget.y});
    assert.equal((await state()).graph.edges.length,2,'reconnecting replaces one input without duplicating edges');
    // Self connections never become snap targets, and Escape clears a pending wire.
    const self=await center(port('a','input','input'));
    await mouse('mousePressed',await center(port('a','output')));await mouse('mouseMoved',self);
    assert.equal(await run('document.querySelectorAll(".is-snap-target").length'),0);
    await mouse('mouseReleased',self);
    await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape'});
    await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape'});
    assert.equal((await state()).graph.edges.length,2);
    assert.equal(await run('document.querySelectorAll(".wire-pending").length'),0);
    // Escape during an active drag cancels capture; subsequent movement is safe.
    await mouse('mousePressed',await center(port('a','output')));
    await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape'});
    await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape'});
    await mouse('mouseMoved',zoomTarget);await mouse('mouseReleased',zoomTarget);
    assert.equal(await run('document.querySelectorAll(".wire-pending").length'),0);
    const added=await add('subtract');
    assert.equal((await state()).graph.nodes.find(n=>n.id===added).type,'subtract');
    await select('difference');
    const shot=await page.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(screenshot,Buffer.from(shot.data,'base64'));
    assert.deepEqual(page.errors,[]);
    console.log('PASS: vector subtraction, body/footer dragging, undo, controls, bidirectional snapping, zoom and invalid targets. Screenshot: '+screenshot);
  } finally {
    if(context)await browser.send('Target.disposeBrowserContext',{browserContextId:context});
    page?.close();browser.close();
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
