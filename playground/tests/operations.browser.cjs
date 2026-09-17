/* A local browser check using a disposable, isolated Chromium context.
 * Start a repo-root HTTP server and Chromium with remote debugging enabled.
 * OPERATIONS_BASE_URL, OPERATIONS_CDP_PORT and OPERATIONS_SCREENSHOT override defaults.
 * node playground/tests/operations.browser.cjs
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const base = process.env.OPERATIONS_BASE_URL || 'http://127.0.0.1:8062';
const cdp = 'http://127.0.0.1:' + (process.env.OPERATIONS_CDP_PORT || '9256');
const screenshot = process.env.OPERATIONS_SCREENSHOT || '/tmp/building-blocks.png';

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
    await run(`(() => {
      const urls=new Map(), create=URL.createObjectURL.bind(URL), original=HTMLAnchorElement.prototype.click;
      URL.createObjectURL=blob => {const url=create(blob); urls.set(url,blob); return url;};
      HTMLAnchorElement.prototype.click=function() {
        if(this.download && urls.has(this.href)) {window.lastDownload=urls.get(this.href).text().then(text=>({text,name:this.download})); return;}
        return original.call(this);
      };
    })()`);

    await upload(fs.readFileSync(require('node:path').join(__dirname,'../examples/exercise-01-iiwa7-twists.json'),'utf8'));
    await until('KinematicsPlayground.getState().graph.nodes.length === 40', 'KUKA graph load');
    assert.equal((await state()).selected, 'space_screws');
    near(await output(), [[0,0,0,0,0,0,0],[0,1,0,-1,0,1,0],[1,0,1,0,1,0,1],[0,-.34,0,.74,0,-1.14,0],[0,0,0,0,0,0,0],[0,0,0,0,0,0,0]]);
    assert.equal(await run('document.querySelector("#output-dimension").textContent'), '6 × 7');
    await click('#numeric-view'); await click('#fit');
    await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    const initialShot = await page.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(screenshot, Buffer.from(initialShot.data, 'base64'));
    console.log('KUKA screenshot ready: ' + screenshot);
    await select('linear_2'); near(await output(), [[-.34],[0],[0]]);
    await wire('omega_2', 'linear_2', 'a'); await wire('point_2', 'linear_2', 'b');
    near(await output(), [[.34],[0],[0]]);
    await select('minor_determinant'); near(await output(), [[0]]);
    await click('#output-python'); await change('#code-scope', 'block');
    assert.ok(!(await run('document.querySelector("#python-code").textContent')).includes('Cannot generate Python'));
    assert.match(await run('document.querySelector("#python-code").textContent'), /includes its input chain/);
    await click('[aria-label="Close Python code"]');
    console.log('PASS: KUKA world twists, determinant, named ports in reverse direction, and Python scope.');

    await change('#example', 'empty');
    const matrix = await add('matrix');
    await change('input[aria-label="Rows (m)"]', 2); await change('input[aria-label="Columns (n)"]', 2);
    for (const [r,c,value] of [[1,1,1],[1,2,2],[2,1,3],[2,2,4]]) await change(`input[aria-label="Matrix row ${r} column ${c}"]`, value, 'input');
    const determinant = await add('determinant'); await source('Matrix input', matrix); near(await output(), [[-2]]);
    await select(matrix); await click('#select-output-columns');
    const columns = (await state()).selected;
    await change('input[aria-label="Source column 1"]', 2); await change('input[aria-label="Source column 2"]', 1);
    near(await output(), [[2,1],[4,3]]);
    const reversedDeterminant = await add('determinant'); await source('Matrix input', columns); near(await output(), [[2]]);
    await select(columns); await source('Output column 2 · source', '');
    assert.equal(await output(), undefined);
    await source('Output column 2 · source', matrix); near(await output(), [[2,1],[4,3]]);
    console.log('PASS: matrix dimensions and entry editing, selected column order and sources, signed determinants.');

    await select(reversedDeterminant); await click('#save-function');
    await change('#function-name', 'Reordered determinant', 'input'); await click('#function-submit');
    assert.equal((await state()).library.length, 1);
    await click('#download-blocks'); const libraryFile = await run('window.lastDownload');
    await click('#save'); const workspace = await run('window.lastDownload');
    const before = await state();
    assert.equal(JSON.parse(workspace.text).format, 'kinematic-building-blocks');
    await change('#example', 'empty'); assert.equal((await state()).graph.nodes.length, 0);
    await upload(workspace.text);
    assert.deepEqual((await state()).graph, before.graph);
    assert.equal((await state()).selected, before.selected);
    assert.deepEqual((await state()).library, before.library);
    await upload(libraryFile.text); assert.deepEqual((await state()).library, before.library, 'reuploading library deduplicates definitions');
    const stable = await state();
    await upload('{ broken JSON');
    assert.deepEqual((await state()).graph, stable.graph); assert.deepEqual((await state()).library, stable.library);
    assert.match(await run('document.querySelector("#toast").textContent'), /Could not upload/);
    const invalid = JSON.parse(workspace.text); invalid.graph.edges.push({from:'missing',to:matrix});
    await upload(JSON.stringify(invalid)); assert.deepEqual((await state()).graph, stable.graph);
    await click('.library-block'); near(await output(), [[2]]);
    console.log('PASS: workspace download/upload, saved-operation library reuse, and transactional malformed-file rejection.');

    await change('#example', 'screw'); await until('KinematicsPlayground.getOutput()?.kind === "screw"', 'numeric screw result');
    assert.equal(await run('document.querySelector("#select-output-columns").disabled'), true, 'screw coordinates cannot become matrix edges');
    await upload(fs.readFileSync(require('node:path').join(__dirname,'../examples/exercise-01-iiwa7-twists.json'),'utf8')); await until('KinematicsPlayground.getState().selected === "space_screws"');
    await click('#numeric-view'); await click('#fit');
    await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    const shot = await page.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(screenshot, Buffer.from(shot.data, 'base64'));
    assert.deepEqual(page.errors, []);
    console.log('PASS: no browser errors. Screenshot: ' + screenshot);
  } finally {
    if (context) await browser.send('Target.disposeBrowserContext', { browserContextId: context });
    page?.close(); browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
