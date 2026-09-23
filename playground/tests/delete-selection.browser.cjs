/* A local browser check using a disposable, isolated Chromium context.
 * Start a repo-root HTTP server and Chromium with remote debugging enabled.
 * OPERATIONS_BASE_URL, OPERATIONS_CDP_PORT and OPERATIONS_SCREENSHOT override defaults.
 * node playground/tests/delete-selection.browser.cjs
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

    const key = async (key, modifiers=0) => {
      const code=key==='Delete'?46:key==='Backspace'?8:key.toUpperCase().charCodeAt(0);
      await page.send('Input.dispatchKeyEvent',{type:'keyDown',key,windowsVirtualKeyCode:code,modifiers});
      await page.send('Input.dispatchKeyEvent',{type:'keyUp',key,windowsVirtualKeyCode:code,modifiers});
    };
    const rect = selector => run(`(() => {const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};})()`);
    const mouse = (type, x, y, modifiers=0) => page.send('Input.dispatchMouseEvent',{type,x,y,button:'left',buttons:type==='mouseReleased'?0:1,clickCount:1,modifiers});
    const tap = async (id, modifiers=0) => {
      const r=await rect(`[data-node-id="${id}"] .block-header`);
      await mouse('mousePressed',r.x+20,r.y+20,modifiers);
      await mouse('mouseReleased',r.x+20,r.y+20,modifiers);
    };
    const focusTemplate = () => run('document.querySelector("#example").focus()');
    const checkRemoved = async ids => {
      const current=await state();
      assert(!current.graph.nodes.some(n=>ids.includes(n.id)), 'selected nodes are deleted');
      assert(!current.graph.edges.some(e=>ids.includes(e.from)||ids.includes(e.to)), 'incident connections are removed');
    };
    await page.send('Runtime.enable');await page.send('Page.enable');
    await page.send('Emulation.setDeviceMetricsOverride',{width:1366,height:900,deviceScaleFactor:1,mobile:false});
    await page.send('Page.navigate',{url:base+'/playground/building_blocks.html'});
    await until('!!window.KinematicsPlayground');
    const original=(await state()).graph;

    // Real pointer selection must transfer focus from the template dropdown.
    await focusTemplate();await tap('b1');
    assert.equal(await run('document.activeElement.id'),'canvas');
    await key('Delete');await checkRemoved(['b1']);
    assert.equal((await state()).graph.nodes.length,3);
    await key('z',2);assert.deepEqual((await state()).graph,original);
    await key('y',2);await checkRemoved(['b1']);
    await key('z',2);

    await focusTemplate();await tap('b1');await tap('b2',8);
    assert.deepEqual(new Set((await state()).selectedIds),new Set(['b1','b2']));
    await key('Delete');await checkRemoved(['b1','b2']);
    assert.equal((await state()).graph.nodes.length,2);
    await key('z',2);assert.deepEqual((await state()).graph,original);

    // A drag selection also releases focus from controls outside the canvas.
    await focusTemplate();
    const first=await rect('[data-node-id="b1"]'), second=await rect('[data-node-id="b2"]');
    await mouse('mousePressed',first.x-12,first.y-12);
    await mouse('mouseMoved',second.x+second.width+12,second.y+second.height+12);
    await mouse('mouseReleased',second.x+second.width+12,second.y+second.height+12);
    assert.equal(await run('document.activeElement.id'),'canvas');
    assert.deepEqual(new Set((await state()).selectedIds),new Set(['b1','b2']));
    await key('Backspace');await checkRemoved(['b1','b2']);
    await key('z',2);assert.deepEqual((await state()).graph,original);

    // Delete remains a text-editing key when the user is actually editing inputs.
    await tap('b1');
    await run(`(() => {const input=document.querySelector('input[aria-label="Rotation angle"]');input.value='12';input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();input.setSelectionRange(0,1);})()`);
    await key('Delete');
    assert.equal((await state()).graph.nodes.length,4);
    assert.equal(await run('document.querySelector("input[aria-label=\\"Rotation angle\\"]").value'),'2');
    await click('#help');await key('Delete');assert.equal((await state()).graph.nodes.length,4);
    await run('document.querySelector("#help-dialog").close()');

    // Returning from an editor to the canvas restores selection shortcuts.
    await focusTemplate();await tap('b1');await key('a',2);await key('Delete');
    assert.equal((await state()).graph.nodes.length,0);
    assert.equal((await state()).graph.edges.length,0);
    await key('Delete');assert.equal((await state()).graph.nodes.length,0);
    await run('delete window.KinematicsPlayground');await page.send('Page.reload');await until('!!window.KinematicsPlayground');
    assert.equal((await state()).graph.nodes.length,0,'deletion persists across reload');
    assert.deepEqual(page.errors,[]);
    console.log('PASS: single, Shift, drag and select-all deletion; connection cleanup; undo/redo; text/dialog guards; persistence.');
  } finally {
    if(context)await browser.send('Target.disposeBrowserContext',{browserContextId:context});
    page?.close();browser.close();
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
