/* A local browser check using a disposable, isolated Chromium context.
 * Start a repo-root HTTP server and Chromium with remote debugging enabled.
 * OPERATIONS_BASE_URL, OPERATIONS_CDP_PORT and OPERATIONS_SCREENSHOT override defaults.
 * node playground/tests/editable-results.browser.cjs
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

    const cell=(r,c,value)=>change('input[aria-label="Matrix row '+r+' column '+c+'"]',value,'input');
    const input=(label,value)=>change('[aria-label="'+label+'"]',value);
    const node=id=>state().then(s=>s.graph.nodes.find(n=>n.id===id));
    const title=id=>run('document.querySelector('+JSON.stringify('article[data-node-id="'+id+'"] .block-title')+').textContent');
    for(const row of [false,true]){
      await change('#example','empty');
      const a=await add(row?'row-vector':'column-vector');for(let i=1;i<=3;i++)await cell(row?1:i,row?i:1,i);
      const b=await add(row?'row-vector':'column-vector');for(let i=1;i<=3;i++)await cell(row?1:i,row?i:1,4);
      const sub=await add('subtract');await input('A · first vector',a);
      assert.equal((await state()).graph.nodes.length,3);assert.equal(await title(sub),'Subtract vectors');
      // Compact inputs can dock while the operation is waiting for its final operand.
      await select(a);await key('m',10);assert.equal(await run('document.querySelector("article.is-docked").dataset.nodeId'),a);
      await select(sub);await input('B · vector to subtract',b);
      let graph=(await state()).graph;
      assert.equal(graph.nodes.length,1,'only the result remains');assert.deepEqual(graph.edges,[]);
      assert.equal(graph.nodes[0].type,'matrix');assert.equal(await title(sub),row?'Row vector':'Column vector');
      assert.equal(await run('document.querySelectorAll("article.block").length'),1);
      assert.equal(await run('document.querySelector(".is-docked")'),null);
      assert.equal(await run('document.querySelectorAll("#vector-orientation").length'),1);
      near(await output(),row?[[-3,-2,-1]]:[[-3],[-2],[-1]]);
      await key('z');assert.equal((await state()).graph.nodes.length,3);assert.equal((await node(sub)).type,'subtract');
      await key('y');assert.equal((await state()).graph.nodes.length,1);
      await select(sub);await cell(row?1:2,row?2:1,'10');near(await output(),row?[[-3,10,-1]]:[[-3],[10],[-1]]);
      // A new operation consumes that result as its input, leaving one vector again.
      const scale=await add('scale');await change('input[aria-label="Scalar factor"]','2','input');await input('A · vector or matrix',sub);
      assert.equal((await state()).graph.nodes.length,1);assert.equal((await node(scale)).type,'matrix');
      near(await output(),row?[[-6,20,-2]]:[[-6],[20],[-2]]);
      await select(scale);await cell(1,1,'theta_2');
      assert.equal(await run('document.querySelector(".math-input-preview msub mi").textContent'),'θ');
      await cell(1,1,'-6');
      const before=(await state()).graph;await run('delete window.KinematicsPlayground');await page.send('Page.reload');await until('!!window.KinematicsPlayground');assert.deepEqual((await state()).graph,before);
      await select(scale);near(await output(),row?[[-6,20,-2]]:[[-6],[20],[-2]]);
    }
    // Incompatible vectors stay on canvas until corrected.
    await change('#example','empty');const a=await add('column-vector');for(let i=1;i<=3;i++)await cell(i,1,i);
    const b=await add('row-vector');for(let i=1;i<=3;i++)await cell(1,i,i+3);
    const sum=await add('add');await input('A · first vector',a);await input('B · vector to add',b);
    assert.equal((await state()).graph.nodes.length,3);assert.equal((await node(sum)).type,'add');
    assert.match(await run('document.querySelector("#inspector-error").textContent'),/orientation/);
    await select(b);await change('#vector-orientation','column');assert.equal((await state()).graph.nodes.length,1);assert.equal((await state()).selected,sum);
    near(await output(),[[5],[7],[9]]);
    await click('#output-python');assert.match(await run('document.querySelector("#python-code").textContent'),/Matrix/);await click('#code-dialog form button');
    await click('#arrange-fit');await run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    await page.send('Page.captureScreenshot',{format:'png'}).then(shot=>fs.writeFileSync('/tmp/playground-completed-vector.png',Buffer.from(shot.data,'base64')));
    assert.deepEqual(page.errors,[]);
    console.log('PASS: immediate result replacement, disappearing inputs, docking before completion, undo/redo, editable vectors, chaining, symbols, invalid inputs, Python and reload.');
  } finally {
    if(context)await browser.send('Target.disposeBrowserContext',{browserContextId:context});
    page?.close();browser.close();
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
