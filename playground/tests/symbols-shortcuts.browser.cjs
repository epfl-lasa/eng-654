/* A local browser check using a disposable, isolated Chromium context.
 * Start a repo-root HTTP server and Chromium with remote debugging enabled.
 * OPERATIONS_BASE_URL, OPERATIONS_CDP_PORT and OPERATIONS_SCREENSHOT override defaults.
 * node playground/tests/drag-subtract.browser.cjs
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
    assert.equal(await run('document.querySelector("#selected-id")'),null);
    assert.equal(await run('document.querySelectorAll(".inspector button:not(#close-inputs), #block-picker, #preset-guide").length'),0);
    assert.equal(await run('document.querySelector("#block-units").hidden'),false);
    assert.equal(await run('document.querySelector("#load-iiwa-example")'),null);
    assert.equal(await run('document.body.textContent.includes("Derivation guide")'),false);
    assert.equal(await run('document.querySelector("#bindings")'),null);
    await click('#operations-panel > summary');
    assert.equal(await run('document.querySelector("#operations-panel").open'),false);
    await click('#operations-panel > summary');
    await click('#toggle-output');
    assert.equal(await run('document.querySelector("#toggle-output .disclosure-sign").textContent'),'−');
    await click('#toggle-output');
    assert.equal(await run('document.querySelector("#toggle-output .disclosure-sign").textContent'),'+');
    await change('#example','empty');
    const first=await add('rotation');
    await change('input[aria-label="Rotation angle"]','theta_2','input');
    const second=await add('rotation');
    await change('input[aria-label="Rotation angle"]',String.raw`\theta_{2}`,'input');
    let current=await state();
    const secondSymbol=current.graph.nodes.find(n=>n.id===second).params.angle;
    assert.notEqual(secondSymbol,'theta_2');
    assert.deepEqual((await state()).graph.bindings,{});
    await select(first);
    await change('input[aria-label="Rotation angle"]',String.raw`\phi_{12}`,'input');
    assert.equal(await run('document.querySelector(".math-input-preview msub mi").textContent'),'φ');
    assert.equal(await run('document.querySelector(".math-input-preview msub mn").textContent'),'12');
    await key('c');
    await key('v');
    await until('KinematicsPlayground.getState().graph.nodes.length===3','copy and paste');
    current=await state();
    const pasted=current.graph.nodes.find(n=>n.id===current.selected), pastedSymbol=await run('KinematicsGraph.rawSymbols(KinematicsPlayground.getState().graph.nodes.at(-1))[0]');
    assert.notEqual(pastedSymbol,'phi_12');
    await select(pasted.id);await change('input[aria-label="Rotation angle"]','0.9','input');
    assert.equal(await run('KinematicsMath.normalizeInput(KinematicsPlayground.getState().graph.nodes.find(n=>n.id==='+JSON.stringify(first)+').params.angle)'), 'phi_12');
    await key('d');
    assert.equal((await state()).graph.nodes.length,4);
    await key('z');assert.equal((await state()).graph.nodes.length,3);
    await key('y');assert.equal((await state()).graph.nodes.length,4);
    await key('x');assert.equal((await state()).graph.nodes.length,3);
    await key('v');assert.equal((await state()).graph.nodes.length,4);
    // Text editing keeps the browser's own copy, paste and duplicate shortcut.
    await run('document.querySelector(".math-input input").focus()');
    await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'d',modifiers:2});
    assert.equal((await state()).graph.nodes.length,4);
    await select(first);await click('#save-function');await click('#function-submit');
    await select(first);await change('input[aria-label="Rotation angle"]','0.8','input');
    await click('.library-block');await select((await state()).selected);
    assert.equal(await run('document.querySelectorAll(".inspector button:not(#close-inputs)").length'),0);
    assert.equal(await run('document.querySelector("#angle-unit").disabled'),true);
    const functionNode=(await state()).graph.nodes.at(-1);
    const argument=functionNode.params.arguments.phi_12;
    assert.equal(argument,'phi_12');
    assert.equal((await state()).graph.nodes.find(n=>n.id===first).params.angle,'0.8');
    assert.deepEqual((await state()).graph.bindings,{});
    await change('#example','dh');
    await key('a');await key('c');await key('v');
    current=await state();
    assert.equal(current.graph.nodes.length,8);assert.equal(current.graph.edges.length,6);
    assert.equal(current.selectedIds.length,4);
    const beforeCombine=await output();
    await key('k');assert.equal(await run('document.querySelector("#function-dialog").open'),true);
    await click('#function-submit');
    assert.equal((await state()).graph.nodes.length,5);
    near(await output(),beforeCombine);
    await key('e');assert.equal((await state()).graph.nodes.length,8);near(await output(),beforeCombine);
    await key('z');assert.equal((await state()).graph.nodes.length,5);
    await key('z',10);assert.equal((await state()).graph.nodes.length,8);
    await select((await state()).selected);
    await click('#toggle-output');
    const shot=await page.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync('/tmp/playground-symbols-shortcuts.png',Buffer.from(shot.data,'base64'));
    const beforeReload=await state();
    await run('delete window.KinematicsPlayground');await page.send('Page.reload');await until('!!window.KinematicsPlayground');
    assert.deepEqual((await state()).graph,beforeReload.graph);
    assert.deepEqual(page.errors,[]);
    console.log('PASS: collapsible panels, LaTeX rendering, isolated values, native copy/paste/cut, duplicate, undo/redo, combine and expand.');
  } finally {
    if(context)await browser.send('Target.disposeBrowserContext',{browserContextId:context});
    page?.close();browser.close();
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
