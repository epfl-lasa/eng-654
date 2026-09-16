/* Native browser regression for the iiwa redundancy labs. No packages required.
 * Start the lecture HTTP server and Chromium with a CDP port, then run this file.
 * CDP_URL, LECTURE_URL and SCREENSHOT_DIR can override the defaults below.
 * LAYOUT_ONLY=1 runs only the stable-slide layout and loading checks.
 * A separate incognito context keeps the user's current slides untouched. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const CDP_URL = (process.env.CDP_URL || 'http://127.0.0.1:9256').replace(/\/$/, '');
const LECTURE_URL = process.env.LECTURE_URL || 'http://127.0.0.1:8052/lectures/lecture_08.html';

async function main() {
  const browser = await (await fetch(CDP_URL + '/json/version')).json();
  const ws = new WebSocket(browser.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  let serial = 0, sessionId, contextId;
  const pending = new Map(), errors = [], httpErrors = [], consoleErrors = [];
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const job = pending.get(message.id); if (!job) return;
      clearTimeout(job.timer); pending.delete(message.id);
      message.error ? job.reject(new Error(JSON.stringify(message.error))) : job.resolve(message.result);
    }
    if (message.sessionId !== sessionId) return;
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') consoleErrors.push(message.params.args.map(arg => arg.value || arg.description));
    if (message.method === 'Network.responseReceived' && message.params.response.status >= 400) httpErrors.push([message.params.response.status, message.params.response.url]);
  });
  const send = (method, params = {}, session = sessionId) => new Promise((resolve, reject) => {
    const id = ++serial, timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 60000);
    pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params, ...(session ? { sessionId: session } : {}) }));
  });
  const run = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const until = async (expression, limit = 1200) => {
    for (let i = 0; i < limit; i++) { if (errors.length || consoleErrors.length) throw new Error(JSON.stringify({ errors, consoleErrors, httpErrors })); if (await run(expression)) return; await wait(100); }
    throw new Error('Not ready: ' + expression + '\n' + JSON.stringify({ errors, consoleErrors, httpErrors }));
  };
  const host = mode => `document.querySelector('[data-redundancy-lab="${mode}"]')`;
  const click = (mode, selector) => run(`${host(mode)}.querySelector('${selector}').click()`);
  const value = (mode, selector, value, event = 'change') => run(`(()=>{const input=${host(mode)}.querySelector('${selector}');input.value=${JSON.stringify(value)};input.dispatchEvent(new Event('${event}',{bubbles:true}));})()`);
  const go = async mode => {
    const n = await run(`Array.from(document.querySelectorAll('#deck>.slide')).indexOf(${host(mode)}.closest('.slide'))+1`);
    await run(`location.hash='slide-${n}'`); await wait(350);
    await until(`${host(mode)}?.dataset.ready==='true'&&${host(mode)}.dataset.busy==='false'&&${host(mode)}.closest('.slide').classList.contains('active')&&Math.abs(${host(mode)}.closest('.slide').getBoundingClientRect().x)<1`);
  };
  const capture = async name => {
    if (!process.env.SCREENSHOT_DIR) return;
    await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    fs.mkdirSync(process.env.SCREENSHOT_DIR, { recursive: true });
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(process.env.SCREENSHOT_DIR, name + '.png'), Buffer.from(shot.data, 'base64'));
  };
  const layout = mode => run(`(()=>{const h=${host(mode)},s=h.closest('.slide'),b=s.getBoundingClientRect(),panel=h.querySelector('.l8r-panel'),opacity=h.querySelector('.l8r-opacity'),stage=h.querySelector('.l8r-stage'),rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right}};return{slide:rect(s),host:rect(h),panel:rect(panel),panelOverflow:panel.scrollHeight-panel.clientHeight,opacityBottom:stage.getBoundingClientRect().bottom-opacity.getBoundingClientRect().bottom,overflow:[...s.querySelectorAll('p,h2,h3,button,select,output,canvas')].filter(e=>{const r=e.getBoundingClientRect();return r.width&&(r.right>b.right+2||r.bottom>b.bottom+2||r.left<b.left-2)}).map(e=>e.textContent.slice(0,80))}})()`);
  try {
    ({ browserContextId: contextId } = await send('Target.createBrowserContext', {}, null));
    const { targetId } = await send('Target.createTarget', { url: 'about:blank', browserContextId: contextId }, null);
    ({ sessionId } = await send('Target.attachToTarget', { targetId, flatten: true }, null));
    await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: LECTURE_URL });
    await until(`!!${host('null-motion')}`);
    await go('configuration-pair');
    const pair = await run(`({...${host('configuration-pair')}.dataset})`);
    assert.ok(Number(pair.poseError) < 1e-10, 'Both configurations realize the same full tool pose.');
    const configurations = JSON.parse(pair.configurations);
    assert.ok(Math.hypot(...configurations[0].map((q,i)=>q-configurations[1][i])) > .5);
    assert.deepEqual(await run(`[...${host('configuration-pair')}.querySelectorAll('.l8r-stage')].map(s=>s.dataset.meshCount)`),['8','8']);
    await run('window.MathJax?.startup?.promise || Promise.resolve()');
    for (const [width,height] of [[1440,900],[1280,720]]) {
      await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
      for (const number of [1,2,3,4,5,6,8,9,10]) {
        await run(`location.hash='slide-${number}'`);
        await until(`document.querySelectorAll('#deck>.slide')[${number-1}].classList.contains('active')&&Math.abs(document.querySelectorAll('#deck>.slide')[${number-1}].getBoundingClientRect().x)<1`);
        const overflow = await run(`(()=>{const s=document.querySelector('.slide.active'),b=s.getBoundingClientRect();return [...s.querySelectorAll('p,h2,h3,table,mjx-container,.l8-card')].filter(e=>{const r=e.getBoundingClientRect();return r.width&&(r.left<b.left-2||r.right>b.right+2||r.bottom>b.bottom+2)}).map(e=>e.textContent.slice(0,80));})()`);
        assert.deepEqual(overflow,[],`Slide ${number} fits at ${width}×${height}`);
        await capture(`slide-${number}-${width}`);
      }
    }
    await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
    await go('null-motion');
    if (!process.env.LAYOUT_ONLY) {
    assert.equal(await run(`${host('null-motion')}.querySelector('.l8r-stage').dataset.meshCount`), '8');
    assert.equal(await run(`${host('null-motion')}.dataset.selectedBranch`), '4');
    assert.equal(await run(`${host('null-motion')}.querySelector('[data-angle-output]').textContent`), '−30°'.replace('−', '-'));
    const initialQ = await run(`${host('null-motion')}.dataset.configuration`);
    await value('null-motion', '[data-angle]', '-25', 'input');
    assert.notEqual(await run(`${host('null-motion')}.dataset.configuration`), initialQ);
    assert.match(await run(`${host('null-motion')}.querySelector('.l8r-readout').textContent`), /tool position error/);
    await capture('null-motion-1440');
    console.log('null-motion layout', await layout('null-motion'));
    await click('null-motion', '[data-default]');
    await until(`${host('null-motion')}.dataset.busy==='false'`);
    await go('numerical');
    console.log('Default map and native viewer ready.');
    assert.equal(await run(`${host('numerical')}.querySelector('[data-cost] option[value=manipulability]')`),null);
    assert.equal(await run(`document.querySelectorAll('.l8-cost-table tbody tr').length`),4);
    assert.equal(await run(`document.querySelector('.l8-cost-table').closest('.slide').querySelector('.l8-takeaway')`),null);
    assert.match(await run(`document.querySelector('.l8-cost-table').closest('.slide').textContent`),/dimensionless/);
    assert.equal(await run(`${host('numerical')}.querySelectorAll('[data-branch]').length`), 8);
    assert.equal(await run(`${host('numerical')}.querySelectorAll('[data-branch].legal').length`), 2);
    await capture('numerical-start-1440');
    // A real mouse click at s=0, q3=-30 selects the actual analytical root,
    // builds numerical null-space continuation and begins playback.
    const position = await run(`(()=>{const c=${host('numerical')}.querySelector('.l8r-map'),r=c.getBoundingClientRect();return{x:r.left+48,y:r.top+30+(170+30)/340*(r.height-66)}})()`);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...position, button: 'left', buttons: 1, clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...position, button: 'left', buttons: 0, clickCount: 1 });
    await until(`${host('numerical')}.dataset.busy==='false'&&${host('numerical')}.dataset.complete==='true'`);
    await until(`Number(${host('numerical')}.dataset.pathProgress)>.02`);
    await click('numerical', '[data-play]');
    const paused = await run(`${host('numerical')}.dataset.frame`); await wait(350);
    assert.equal(await run(`${host('numerical')}.dataset.frame`), paused);
    await click('numerical', '[data-play]'); await wait(450);
    assert.ok(Number(await run(`${host('numerical')}.dataset.frame`)) > +paused);
    await value('numerical', '[data-scrub]', '1', 'input');
    assert.equal(await run(`${host('numerical')}.dataset.pathProgress`), '1');
    assert.equal(await run(`${host('numerical')}.querySelector('[data-play]').textContent`), 'Replay');
    const centeringQ = await run(`${host('numerical')}.dataset.configuration`);
    await capture('numerical-end-1440');
    await click('numerical', '[data-play]'); await wait(400);
    assert.ok(Number(await run(`${host('numerical')}.dataset.pathProgress`)) < .15);
    await click('numerical', '[data-reset]');
    assert.equal(await run(`${host('numerical')}.dataset.pathProgress`), '0');
    await click('numerical', '[data-compare]');
    await until(`${host('numerical')}.dataset.busy==='false'&&${host('numerical')}.querySelector('.l8r-footer').textContent.includes('of the eight')`);
    const results = await run(`[...${host('numerical')}.querySelectorAll('[data-branch] span')].map(e=>e.textContent)`);
    assert.equal(results.filter(x => x === 'finishes').length, 1);
    assert.equal(results.filter(x => x === 'stops').length, 1);
    assert.equal(results.filter(x => x === 'unavailable').length, 6);
    await click('numerical', '[data-branch="3"]'); await value('numerical', '[data-scrub]', '1', 'input');
    assert.equal(await run(`${host('numerical')}.dataset.complete`), 'false');
    assert.ok(Number(await run(`${host('numerical')}.dataset.pathProgress`)) < .2);
    await capture('numerical-limit-stop-1440');
    console.log('Map click, numerical playback/replay, and all-eight comparison passed.');
    await click('numerical', '[data-branch="4"]');
    await value('numerical', '[data-cost]', 'none');
    await click('numerical', '[data-plan]'); await until(`${host('numerical')}.dataset.busy==='false'&&${host('numerical')}.dataset.complete==='true'`);
    await value('numerical', '[data-scrub]', '1', 'input');
    assert.notEqual(await run(`${host('numerical')}.dataset.configuration`), centeringQ);
    await click('numerical', '[data-all]');
    await capture('all-eight-maps-1440');
    await click('numerical', '[data-all]');
    await go('global-map');
    await capture('global-map-1440');
    await go('analytical');
    console.log('Building analytical global path…');
    assert.equal(await run(`${host('analytical')}.querySelector('[data-method]').value`), 'analytical');
    await click('analytical', '[data-plan]');
    await until(`${host('analytical')}.dataset.busy==='false'&&${host('analytical')}.dataset.complete==='true'`);
    await value('analytical', '[data-scrub]', '1', 'input');
    await capture('analytical-end-1440');
    console.log('Analytical global path completed.');
    // Rectangle edits are shared by every lab, and rebuilding discards stale plans.
    await value('analytical', '[data-size="width"]', '.20', 'input');
    await click('analytical', '[data-rebuild]'); await until(`${host('analytical')}.dataset.busy==='false'`);
    await go('global-map');
    assert.equal(Number(await run(`${host('global-map')}.querySelector('[data-size="width"]').value`)), .2);
    assert.equal(await run(`${host('global-map')}.dataset.complete`), 'false');
    await click('global-map', '[data-branch="0"]');
    assert.equal(await run(`${host('global-map')}.dataset.selectedBranch`), '0');
    assert.equal(await run(`${host('global-map')}.querySelector('[data-plan]').disabled`), true);
    await value('global-map', '[data-center="0"]', '1', 'input');
    await value('global-map', '[data-center="1"]', '1', 'input');
    await value('global-map', '[data-center="2"]', '1', 'input');
    await click('global-map', '[data-rebuild]'); await until(`${host('global-map')}.dataset.busy==='false'`);
    assert.equal(await run(`${host('global-map')}.dataset.configuration`), undefined);
    assert.equal(await run(`${host('global-map')}.querySelector('.l8r-stage').dataset.configuration`), undefined);
    await click('global-map', '[data-default]'); await until(`${host('global-map')}.dataset.busy==='false'`);
    }
    for (const [width, height] of [[1440, 900], [1280, 720]]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      for (const mode of ['null-motion', 'numerical', 'global-map', 'analytical']) {
        await go(mode); const result = await layout(mode); console.log(mode, width, result);
        assert.ok(Math.abs(result.slide.x)<1, 'The inspected slide is fully onscreen');
        assert.deepEqual(result.overflow, [], 'No slide overflow');
        assert.ok(result.panelOverflow <= 2, `Controls fit without scrolling: ${mode} at ${width}, overflow ${result.panelOverflow}`);
        assert.ok(Math.abs(result.opacityBottom - 8) < 1, 'Opacity sits at the bottom of the scene');
        await capture(`${mode}-${width}`);
      }
    }
    assert.deepEqual(errors, []); assert.deepEqual(consoleErrors, []); assert.deepEqual(httpErrors, []);
    console.log(process.env.LAYOUT_ONLY ? 'Lecture 08 stable-slide layout checks passed at 1440×900 and 1280×720.' : 'Lecture 08 browser regression passed: model, shared rectangle, analytic map, start click, null costs, 8-start comparison, global plan, replay and responsive layouts.');
  } finally {
    if (contextId) await send('Target.disposeBrowserContext', { browserContextId: contextId }, null).catch(() => {});
    ws.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
