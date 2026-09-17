/* A local browser check using a disposable, isolated Chromium context.
 * Start a repo-root HTTP server and Chromium with remote debugging enabled.
 * OPERATIONS_BASE_URL, OPERATIONS_CDP_PORT and OPERATIONS_SCREENSHOT override defaults.
 * node playground/tests/floating-inputs.browser.cjs
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

    const hidden=()=>run('document.querySelector("#input-panel").hidden');
    const settle=()=>run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    const center=selector=>run("(()=>{const r=document.querySelector("+JSON.stringify(selector)+").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()");
    const mouse=(type,p)=>page.send('Input.dispatchMouseEvent',{type,x:p.x,y:p.y,button:'left',buttons:type==='mouseReleased'?0:1,clickCount:type==='mouseMoved'?0:1});
    const tap=async selector=>{const p=await center(selector);await mouse('mousePressed',p);await mouse('mouseReleased',p);await settle();};
    const checkPanel=async()=>{
      await settle();
      assert.equal(await hidden(),false);
      const bounds=await run('(()=>{const r=document.querySelector("#input-panel").getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight,position:getComputedStyle(document.querySelector("#input-panel")).position};})()');
      assert.equal(bounds.position,'fixed');
      assert.ok(bounds.x>=0&&bounds.y>=0&&bounds.right<=bounds.width+1&&bounds.bottom<=bounds.height+1,JSON.stringify(bounds));
    };
    assert.equal(await hidden(),true,'startup is closed despite restored selection');
    const widthBefore=await run('document.querySelector("#canvas").clientWidth');
    await tap('[data-node-id="b4"] .block-header');await checkPanel();
    assert.equal(await run('document.querySelector("#canvas").clientWidth'),widthBefore,'opening does not shrink the canvas');
    await click('#close-inputs');assert.equal(await hidden(),true);
    await select('b4');await checkPanel();
    await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape'});
    assert.equal(await hidden(),true);
    await select('b4');
    const beforeMove=await run('(()=>{const r=document.querySelector("#input-panel").getBoundingClientRect();return {x:r.x,y:r.y}})()');
    const handle=await center('#inputs-title');
    await mouse('mousePressed',handle);await mouse('mouseMoved',{x:handle.x-180,y:handle.y+35});await mouse('mouseReleased',{x:handle.x-180,y:handle.y+35});
    const afterMove=await run('(()=>{const r=document.querySelector("#input-panel").getBoundingClientRect();return {x:r.x,y:r.y}})()');
    assert.ok(afterMove.x<beforeMove.x-100,'header dragging moves the panel');
    await run('document.querySelector(".math-input input").focus()');
    const empty=await run('(()=>{const r=document.querySelector("#canvas").getBoundingClientRect();return {x:r.x+20,y:r.y+r.height-90}})()');
    await mouse('mousePressed',empty);await mouse('mouseReleased',empty);assert.equal(await hidden(),true);
    assert.equal(await run('document.activeElement.id'),'canvas');

    for(const example of ['custom3r-poe','custom3r-dh']){
      await change('#example',example);await settle();
      assert.equal(await hidden(),true,'loading a template does not open inputs');
      assert.deepEqual((await state()).graph.bindings,{});
      await select('b1');await checkPanel();
      assert.equal(await run('document.querySelector("#bindings")'),null);
    }
    await click('#save-function');await click('#function-submit');
    await click('.library-block');assert.equal(await hidden(),true,'adding a function does not open the panel');
    await select((await state()).selected);
    assert.equal(await run('document.querySelector("#bindings")'),null);

    await change('#example','empty');
    await click('.palette-item[data-type="rotation"]');await settle();
    assert.equal(await hidden(),true,'adding a block does not open the panel');
    const first=(await state()).selected;await tap('[data-node-id="'+first+'"] .block-header');await checkPanel();
    assert.equal(await run('document.querySelector("#bindings")'),null);
    await change('input[aria-label="Rotation angle"]','0','input');
    await key('d');await select((await state()).selected);
    assert.equal(await run('document.querySelector(".math-input input").value'),'0','duplicate retains an explicitly entered zero');
    await click('.palette-item[data-type="rotation"]');await select((await state()).selected);
    assert.equal(await run('document.querySelector(".math-input input").value'),'theta','a new block does not inherit the other zero');
    await change('input[aria-label="Rotation angle"]','theta','input');
    assert.equal(await run('document.querySelector(".math-input input").value'),'theta','a symbol stays in its direct input');
    const last=(await state()).selected;
    for(const [width,height] of [[800,900],[390,844],[1280,720]]){
      await page.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<650});
      await select(last);await checkPanel();
    }
    await select(first);
    const snapshot=(await state()).graph;
    await run('delete window.KinematicsPlayground');await page.send('Page.reload');await until('!!window.KinematicsPlayground');
    assert.equal(await hidden(),true);
    assert.deepEqual((await state()).graph,snapshot);
    await select(first);assert.equal(await run('document.querySelector(".math-input input").value'),'0');
    const shot=await page.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync('/tmp/playground-floating-inputs.png',Buffer.from(shot.data,'base64'));
    assert.deepEqual(page.errors,[]);
    console.log('PASS: click-to-open floating inputs, close/Escape/outside, dragging, full-width canvas, blank defaults, explicit zeros, reload and mobile bounds.');
  } finally {
    if(context)await browser.send('Target.disposeBrowserContext',{browserContextId:context});
    page?.close();browser.close();
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
