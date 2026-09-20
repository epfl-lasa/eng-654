/* A local browser check using a disposable, isolated Chromium context.
 * Start a repo-root HTTP server and Chromium with remote debugging enabled.
 * OPERATIONS_BASE_URL, OPERATIONS_CDP_PORT and OPERATIONS_SCREENSHOT override defaults.
 * node playground/tests/floating-inputs.browser.cjs
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

    const hidden=()=>run('document.querySelector("#input-panel").hidden');
    const settle=()=>run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    const enter=async selector=>{
      await run(`document.querySelector(${JSON.stringify(selector)}).focus()`);
      await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
      await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
      await settle();assert.equal(await hidden(),true,'Enter closes the floating inputs');
    };
    const menu=async text=>run(`(()=>{const button=[...document.querySelectorAll('#context-menu button')].find(b=>b.textContent===${JSON.stringify(text)});if(!button)throw Error('Missing menu action');button.click();})()`);
    const sourceField=(label,id)=>change(`select[aria-label="${label}"]`,id);
    await change('#example','empty');
    const first=await add('rotation');
    await change('input[aria-label="Rotation angle"]','pi/2','input');
    await enter('input[aria-label="Rotation angle"]');
    assert.equal((await state()).graph.nodes[0].params.angle,'pi/2');
    await select(first);
    await run("document.querySelector('#block-name').select()");
    await page.send('Input.insertText',{text:'Shoulder rotation'});
    await enter('#block-name');
    assert.equal((await state()).graph.nodes[0].label,'Shoulder rotation');
    assert.equal(await run('document.querySelector(".block-title").textContent'),'Shoulder rotation');
    await click('#undo');assert.equal((await state()).graph.nodes[0].label,'Rotation');
    await click('#redo');assert.equal((await state()).graph.nodes[0].label,'Shoulder rotation');
    await select(first);await click('#save-function');
    await change('#function-name','Turn');await click('#function-submit');
    await click('.library-block');const fn=(await state()).selected;
    await click('.library-menu');await menu('Rename function');
    await change('#function-name','Quarter turn');await click('#function-submit');
    assert.ok(await run('document.querySelector(".library-block").textContent.includes("Quarter turn")'));
    assert.equal((await state()).graph.nodes.find(n=>n.id===fn).label,'Quarter turn');
    await click('#undo');assert.equal((await state()).graph.nodes.find(n=>n.id===fn).label,'Turn');
    await click('#redo');
    await select(fn);await change('#block-name','My turn');
    await click('.library-menu');await menu('Rename function');await change('#function-name','Saved turn');await click('#function-submit');
    assert.equal((await state()).graph.nodes.find(n=>n.id===fn).label,'My turn');
    await run('delete window.KinematicsPlayground');await page.send('Page.reload');await until('!!window.KinematicsPlayground');
    assert.ok((await state()).graph.nodes.some(n=>n.label==='My turn'));
    assert.ok(await run('document.querySelector(".library-block").textContent.includes("Saved turn")'));

    await change('#example','empty');
    assert.equal(await run('document.querySelector(".palette-item[data-type=columns]")'),null);
    const left=await add('column-vector');
    for(let i=1;i<=3;i++)await change(`input[aria-label="Matrix row ${i} column 1"]`,i,'input');
    const right=await add('column-vector');
    for(let i=1;i<=3;i++)await change(`input[aria-label="Matrix row ${i} column 1"]`,i+3,'input');
    await select(left);await click('#stack-output-columns');const joined=(await state()).selected;await select(joined);
    assert.equal((await state()).graph.nodes.find(n=>n.id===joined).type,'stackColumns');
    assert.equal(await run(`document.querySelector('select[aria-label="A · left columns"]').value`),left);
    await sourceField('B · right columns',right);
    near(await output(),[[1,4],[2,5],[3,6]]);
    assert.equal((await state()).graph.nodes.length,1);
    await click('#undo');assert.equal((await state()).graph.nodes.find(n=>n.id===joined).type,'stackColumns');
    await click('#redo');near(await output(),[[1,4],[2,5],[3,6]]);

    for(const before of [true,false])for(const type of ['row-vector','column-vector','matrix']){
      await change('#example','empty');const target=await add(type);
      if(type!=='matrix')for(let i=1;i<=3;i++)await change(`input[aria-label="Matrix row ${type==='row-vector'?1:i} column ${type==='row-vector'?i:1}"]`,i,'input');
      const factor=await add('scale');await change('input[aria-label="Scalar factor"]','2','input');await enter('input[aria-label="Scalar factor"]');
      assert.equal((await state()).graph.nodes.find(n=>n.id===factor).type,'scale','unconnected multiplier stays a multiplier');
      const from=before?factor:target,to=before?target:factor;
      await click(`[data-node-id="${from}"] [data-port="output"]`);
      await click(`[data-node-id="${to}"] [data-port="input"]`);
      const result=await output();
      const completed=(await state()).graph;
      assert.equal(completed.nodes.length,1,'either direction becomes one editable result block');
      assert.equal(completed.nodes[0].id,to);
      assert.equal(completed.nodes[0].type,'matrix');
      assert.deepEqual(completed.edges,[]);
      await click('#undo');assert.equal((await state()).graph.nodes.length,2,'undo restores the scalar and operand');
      await click('#redo');near(await output(),result);
      if(type==='matrix')near(result,[[2,0,0],[0,2,0],[0,0,2]]);
      else {
        await select(to);
        assert.equal(await run('KinematicsPlayground.getOutput()?.kind'),'matrix');
        near(result,type==='row-vector'?[[2,4,6]]:[[2],[4],[6]]);
      }
    }
    await change('#example','empty');
    const symbolic=await add('column-vector');
    for(const [i,name] of ['x_i','y_i','z_i'].entries())await change(`input[aria-label="Matrix row ${i+1} column 1"]`,name,'input');
    for(const name of ['k1','k2']){
      const factor=await add('scale');await change('input[aria-label="Scalar factor"]',name,'input');await enter('input[aria-label="Scalar factor"]');
      await click(`[data-node-id="${factor}"] [data-port="output"]`);
      await click(`[data-node-id="${symbolic}"] [data-port="input"]`);
    }
    await select(symbolic);
    assert.deepEqual(await run('[...document.querySelectorAll("[data-matrix-symbol]")].map(input=>input.dataset.matrixSymbol)'),['k1','k2','x_i','y_i','z_i']);
    const setSymbol=async(name,value)=>{
      const selector=`input[aria-label="Symbol ${name}"]`;
      await run(`document.querySelector(${JSON.stringify(selector)}).focus()`);
      await change(selector,value,'input');
    };
    for(const [name,value] of Object.entries({k1:2,k2:3,x_i:1,y_i:2,z_i:3}))await setSymbol(name,value);
    near(await output(),[[6],[12],[18]]);
    await setSymbol('k1',4);await enter('input[aria-label="Symbol k1"]');near(await output(),[[12],[24],[36]]);
    await click('#undo');near(await output(),[[6],[12],[18]]);await click('#redo');near(await output(),[[12],[24],[36]]);
    await run('delete window.KinematicsPlayground');await page.send('Page.reload');await until('!!window.KinematicsPlayground');await select(symbolic);
    assert.equal(await run(`document.querySelector('input[aria-label="Symbol k1"]').value`),'4');
    await setSymbol('k2',0);near(await output(),[[0],[0],[0]]);await setSymbol('k2',5);near(await output(),[[20],[40],[60]]);
    await change('#vector-orientation','row');near(await output(),[[20,40,60]]);
    assert.equal(await run(`document.querySelector('input[aria-label="Symbol k1"]').value`),'4');
    await change('#example','empty');
    const rotation=await add('rotation');const determinant=await add('determinant');
    await sourceField('Matrix input',rotation);
    assert.equal(await run('KinematicsMath.format(KinematicsPlayground.getOutput().matrix[0][0])'),'1');
    for(const preset of ['custom3r-dh','custom3r-poe']){
      await change('#example',preset);
      const pose=(await state()).selected;
      await add('determinant');await sourceField('Matrix input',pose);
      assert.equal(await run('KinematicsMath.format(KinematicsPlayground.getOutput().matrix[0][0])'),'1',preset+' returns the determinant of its 4 × 4 pose');
    }
    assert.deepEqual(page.errors,[]);
    console.log('PASS: rename blocks and functions, undo/redo/reload, Enter commits and closes, stack columns, scalar multiplication on either side, persistent merged-symbol inputs, simplified determinant.');
  } finally {
    if(context)await browser.send('Target.disposeBrowserContext',{browserContextId:context});
    page?.close();browser.close();
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
