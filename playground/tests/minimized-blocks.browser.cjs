/* A local browser check using a disposable, isolated Chromium context.
 * Start a repo-root HTTP server and Chromium with remote debugging enabled.
 * OPERATIONS_BASE_URL, OPERATIONS_CDP_PORT and OPERATIONS_SCREENSHOT override defaults.
 * node playground/tests/minimized-blocks.browser.cjs
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
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
    const select = id => run("document.querySelector("+JSON.stringify('[data-node-id="'+id+'"]')+").dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))");
    const state = () => run('KinematicsPlayground.getState()');
    const output = () => run('KinematicsPlayground.getOutput()?.matrix.map(row => row.map(value => KinematicsMath.evaluate(value, KinematicsPlayground.getState().graph.bindings)))');
    const near = (actual, expected) => {
      assert.equal(actual.length, expected.length);
      actual.forEach((row, r) => { assert.equal(row.length, expected[r].length); row.forEach((value, c) => assert.ok(Math.abs(value - expected[r][c]) < 1e-10, `${r},${c}: ${value} != ${expected[r][c]}`)); });
    };
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
    const block=id=>'article[data-node-id="'+id+'"]';
    const compact=async id=>{await settle();return run('(()=>{const n=document.querySelector('+JSON.stringify(block(id))+');return {width:n.offsetWidth,height:n.offsetHeight,compact:n.classList.contains("is-minimized"),ports:[...n.querySelectorAll(".port")].map(p=>({label:p.getAttribute("aria-label"),top:p.offsetTop,left:p.offsetLeft,height:p.offsetHeight})),body:getComputedStyle(n.querySelector(".block-body")).display};})()');};
    const node=id=>state().then(s=>s.graph.nodes.find(n=>n.id===id));
    const link=async(from,to,slot)=>{await click(block(from)+' [data-port="output"]');await click(block(to)+' [data-input="'+slot+'"]');await settle();};
    const verifyWires=async()=>{
      await settle();
      const errors=await run('(()=>{const state=KinematicsPlayground.getState(),world=document.querySelector("#world").getBoundingClientRect(),paths=[...document.querySelectorAll("path.wire:not(.wire-pending)")];return state.graph.edges.flatMap((edge,i)=>{const from=document.querySelector("article[data-node-id="+edge.from+"] [data-port=output]").getBoundingClientRect(),to=document.querySelector("article[data-node-id="+edge.to+"] [data-input="+(edge.input||"input")+"]").getBoundingClientRect(),numbers=paths[i].getAttribute("d").match(/-?\\d+(?:\\.\\d+)?/g).map(Number),expected=[(from.x+from.width/2-world.x)/state.view.scale,(from.y+from.height/2-world.y)/state.view.scale,(to.x+to.width/2-world.x)/state.view.scale,(to.y+to.height/2-world.y)/state.view.scale],actual=[...numbers.slice(0,2),...numbers.slice(-2)];return actual.map((n,j)=>Math.abs(n-expected[j])).filter(n=>n>0.01);});})()');
      assert.deepEqual(errors,[],'wires terminate on visible ports');
    };
    await change('#example','empty');
    const a=await add('column-vector');
    assert.deepEqual(await run('[...document.querySelectorAll("[data-matrix-editor] .field > span:first-child")].map(n=>n.textContent)'),['x','y','z']);
    assert.equal(await run('document.querySelectorAll("#inspector-content input[type=text]").length'),3);
    assert.equal(await run('document.querySelector("#bindings")'),null);
    for(let row=1;row<=3;row++)await change('input[aria-label="Matrix row '+row+' column 1"]',row,'input');
    const b=await add('column-vector');
    for(let row=1;row<=3;row++)await change('input[aria-label="Matrix row '+row+' column 1"]',row+3,'input');
    const sum=await add('add');
    const full=await compact(sum);
    await key('m',10);
    const small=await compact(sum);
    assert.equal(small.compact,true);assert.equal(small.width,small.height);assert.ok(small.width<full.width);assert.equal(small.body,'none');
    assert.equal(small.ports.length,3);
    await link(a,sum,'a');await link(b,sum,'b');await select(sum);near(await output(),[[5],[7],[9]]);
    await verifyWires();
    await key('m',10);assert.equal((await compact(sum)).compact,false);await verifyWires();
    await key('z');assert.equal((await compact(sum)).compact,true);await verifyWires();
    await key('y');assert.equal((await compact(sum)).compact,false);
    await click(block(sum)+' .block-menu');
    await run('[...document.querySelectorAll("#context-menu button")].find(n=>n.textContent.startsWith("Minimize")).click()');
    assert.equal((await compact(sum)).compact,true);
    await key('d');const duplicate=(await state()).selected;assert.equal((await compact(duplicate)).compact,true);
    await key('z');
    await key('a');await key('m',10);assert.equal(await run('document.querySelectorAll(".is-minimized").length'),3);
    await key('m',12);assert.equal(await run('document.querySelectorAll(".is-minimized").length'),0,'Mac Cmd+Shift+M restores selection');
    await key('m',10);await click('#arrange-fit');await verifyWires();
    await select(a);
    await run('document.querySelector(".math-input input").focus()');
    await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'m',modifiers:10});
    assert.equal((await node(a)).minimized,true,'typing preserves block state');
    await change('input[aria-label="Matrix row 1 column 1"]','theta_2','input');
    assert.equal(await run('document.querySelectorAll("#inspector-content input[type=text]").length'),3);
    assert.equal(await run('document.querySelector(".math-input-preview msub mi").textContent'),'θ');
    await change('input[aria-label="Matrix row 1 column 1"]','1','input');
    await select(sum);near(await output(),[[5],[7],[9]]);
    const before=(await state()).graph;
    await run('delete window.KinematicsPlayground');await page.send('Page.reload');await until('!!window.KinematicsPlayground');
    assert.deepEqual((await state()).graph,before);await verifyWires();
    assert.equal(await run('document.querySelectorAll(".is-minimized").length'),3);
    await click('#keyboard-shortcuts');
    assert.match(await run('document.querySelector("#keyboard-shortcuts-dialog").textContent'),/Minimize \/ maximize selected blocks[\s\S]*Ctrl\+Shift\+M/);
    await click('#keyboard-shortcuts-dialog form button');
    const columns=await add('columns');await change('input[aria-label="Output columns"]',12);
    await key('m',10);const many=await compact(columns);assert.equal(many.width,many.height);assert.equal(many.ports.length,13);
    assert.ok(many.width<196,'even 12 inputs stay narrower than a full block');
    for(let i=0;i<12;i++)for(let j=i+1;j<12;j++)assert.ok(Math.hypot(many.ports[i].top-many.ports[j].top,many.ports[i].left-many.ports[j].left)>=20,'input ports do not overlap');
    await link(a,columns,'c4');await link(b,columns,'c8');
    await click('#arrange-fit');await verifyWires();
    await page.send('Page.captureScreenshot',{format:'png'}).then(shot=>fs.writeFileSync('/tmp/playground-minimized-blocks.png',Buffer.from(shot.data,'base64')));
    // Upload a legacy file: numeric substitutions become visible direct inputs.
    const fixture={version:1,name:'Legacy values',angleUnit:'rad',bindings:{x:'2',q:'pi/2'},nodes:[{id:'legacy',type:'matrix',label:'Vector',params:{rows:3,columns:1,matrix:['x','q','x+1']},position:{x:0,y:0},minimized:true}],edges:[]};
    await run('(()=>{const dt=new DataTransfer();dt.items.add(new File(['+JSON.stringify(JSON.stringify(fixture))+'],"legacy.json",{type:"application/json"}));const f=document.querySelector("#graph-file");f.files=dt.files;f.dispatchEvent(new Event("change"));})()');
    await until('KinematicsPlayground.getState().graph.name==="Legacy values"');await select('legacy');
    assert.deepEqual((await state()).graph.bindings,{});
    assert.deepEqual((await node('legacy')).params.matrix,['2','pi/2','(2)+1']);
    near(await output(),[[2],[Math.PI/2],[3]]);assert.equal((await compact('legacy')).compact,true);
    assert.equal(await run('document.querySelectorAll("#inspector-content input[type=text]").length'),3);
    assert.deepEqual(page.errors,[]);
    console.log('PASS: compact block shortcuts/menu, named ports and wires, undo/redo, duplication, multi-selection, typing, reload, 12 inputs, direct values, legacy migration.');
  } finally {
    if(context)await browser.send('Target.disposeBrowserContext',{browserContextId:context});
    page?.close();browser.close();
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
