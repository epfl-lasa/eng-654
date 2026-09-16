/* Browser regression, no packages required. Start the lecture HTTP server and Chromium CDP,
 * then: node lectures_main/tests/lecture-07-browser.cjs
 * Override CDP_URL (default http://127.0.0.1:9256) and LECTURE_URL (default below).
 * Optional SCREENSHOT_DIR saves review images. Uses its own incognito browser
 * context; existing tabs and saved paths are untouched. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const CDP_URL = (process.env.CDP_URL || 'http://127.0.0.1:9256').replace(/\/$/, '');
const LECTURE_URL = (process.env.LECTURE_URL || 'http://127.0.0.1:8052/lectures/lecture_07.html').split('#')[0];

async function main() {
  const browser = await (await fetch(CDP_URL + '/json/version')).json();
  const ws = new WebSocket(browser.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, {once:true}); ws.addEventListener('error', reject, {once:true}); });
  let serial = 0, sessionId, contextId;
  const pending = new Map(), errors = [], consoleErrors = [], httpErrors = [];
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
    const id = ++serial, timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 30000);
    pending.set(id, {resolve, reject, timer});
    ws.send(JSON.stringify({id, method, params, ...(session ? {sessionId:session} : {})}));
  });
  const run = async expression => {
    const result = await send('Runtime.evaluate', {expression, returnByValue:true, awaitPromise:true});
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  const capture = async name => {
    if (!process.env.SCREENSHOT_DIR) return;
    await run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    fs.mkdirSync(process.env.SCREENSHOT_DIR, {recursive:true});
    const result = await send('Page.captureScreenshot', {format:'png'});
    fs.writeFileSync(path.join(process.env.SCREENSHOT_DIR, name + '.png'), Buffer.from(result.data, 'base64'));
  };
  const until = async (expression, limit = 450) => {
    for (let i = 0; i < limit; i++) { if (await run(expression)) return; await wait(100); }
    throw new Error('Not ready: ' + expression + '\n' + JSON.stringify({errors, consoleErrors, httpErrors}));
  };
  const h = mode => `document.querySelector('[data-crb-lab="${mode}"]')`;
  const click = (mode, selector) => run(`${h(mode)}.querySelector('${selector}').click()`);
  const selector = mode => mode === 'intro' ? '[data-crb-model]' : mode === 'abb' ? '[data-path-lab=abb-irb-path]' : mode.startsWith('abb-irb-') ? '[data-path-lab='+mode+']' : '[data-crb-lab='+mode+']';
  const go = async mode => { const n = await run(`Array.from(document.querySelectorAll('#deck>.slide')).indexOf(document.querySelector('${selector(mode)}').closest('.slide'))+1`); await run(`location.hash='slide-${n}'`);await until(`(()=>{const s=document.querySelector('${selector(mode)}').closest('.slide');return s.classList.contains('active')&&Math.abs(s.getBoundingClientRect().left)<2;})()`);await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))'); };
  const clickMap = async (mode, point) => {
    const position=await run(`(()=>{const host=${h(mode)},svg=host.querySelector('[data-slice]'),box=svg.querySelector('clipPath rect'),b=JSON.parse(host.dataset.viewBounds),p=svg.createSVGPoint();p.x=Number(box.getAttribute('x'))+(${point[0]}-b[0])/(b[1]-b[0])*Number(box.getAttribute('width'));p.y=Number(box.getAttribute('y'))+(b[3]-(${point[1]}))/(b[3]-b[2])*Number(box.getAttribute('height'));const screen=p.matrixTransform(svg.getScreenCTM()),hit=document.elementFromPoint(screen.x,screen.y);return{x:screen.x,y:screen.y,hit:hit?.tagName,host:hit?.closest('[data-crb-lab]')?.dataset.crbLab};})()`);
    assert.equal(position.host,mode,JSON.stringify(position));await send('Input.dispatchMouseEvent',{type:'mousePressed',x:position.x,y:position.y,button:'left',buttons:1,clickCount:1});
    await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:position.x,y:position.y,button:'left',buttons:0,clickCount:1});
  };
  const layout = mode => run(`(()=>{
    const s=document.querySelector('${selector(mode)}').closest('.slide'),r=s.getBoundingClientRect();
    const visibleBounds=e=>{
      const b=e.getBoundingClientRect();if(!b.width||!b.height)return null;
      let left=b.left,right=b.right,top=b.top,bottom=b.bottom;
      // A scrollable sidebar intentionally contains offscreen rows. Check the
      // visible intersection, while retaining overflow checks for its container.
      for(let p=e.parentElement;p&&p!==s;p=p.parentElement){
        const css=getComputedStyle(p),q=p.getBoundingClientRect();
        if(['auto','scroll','hidden','clip'].includes(css.overflowX)){left=Math.max(left,q.left);right=Math.min(right,q.right);}
        if(['auto','scroll','hidden','clip'].includes(css.overflowY)){top=Math.max(top,q.top);bottom=Math.min(bottom,q.bottom);}
      }
      return right>left&&bottom>top?{left,right,top,bottom}:null;
    };
    return {overflow:[...s.querySelectorAll('p,h2,h3,button,select,svg,.l7-crb-side,.l7-crb-bottom,.l7-crb-nscs-controls')].filter(e=>{const b=visibleBounds(e);return b&&(b.right>r.right+2||b.bottom>r.bottom+2||b.left<r.left-2)}).map(e=>e.textContent.slice(0,80))};
  })()`);
  const xyAtlas=JSON.parse(fs.readFileSync(path.join(__dirname,'../assets/data/lecture07/crb-slice-xy-diverse.json'),'utf8'));
  try {
    ({browserContextId:contextId} = await send('Target.createBrowserContext', {}, null));
    const {targetId} = await send('Target.createTarget', {url:'about:blank', browserContextId:contextId}, null);
    ({sessionId} = await send('Target.attachToTarget', {targetId, flatten:true}, null));
await send('Runtime.enable');await send('Page.enable');await send('Network.enable');await send('Network.setCacheDisabled',{cacheDisabled:true});await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
await send('Page.navigate',{url:LECTURE_URL});await until(`!!document.querySelector('[data-crb-model]')`);assert.equal(await run(`document.querySelectorAll('#deck>.slide').length`),27);assert.equal(await run(`document.querySelector('[data-crb-lab=paper]')`),null);await go('intro');await until(`document.querySelector('[data-crb-model]')?.dataset.meshCount==='7'`);assert.deepEqual((await layout('intro')).overflow,[]);await capture('19-model');
await go('atlas');await until(`${h('atlas')}?.dataset.ikCount==='16'&&${h('atlas')}.dataset.busy==='false'`);
assert.equal(await run(`${h('atlas')}.dataset.samples`),'100000');assert.equal(await run(`${h('atlas')}.dataset.slicePlane`),'xy');assert.equal(await run(`${h('atlas')}.dataset.sliceZ`),String(xyAtlas.z));assert.equal(await run(`${h('atlas')}.dataset.limitIkCount`),'10');assert.equal(await run(`${h('atlas')}.querySelector('[data-stage]').dataset.meshCount`),'7');assert.equal(await run(`${h('atlas')}.querySelector('[data-stage]').dataset.visibleIks`),'15');
await click('atlas','[data-show-one]');assert.equal(await run(`${h('atlas')}.querySelector('[data-stage]').dataset.visibleIks`),'0');await click('atlas','[data-show-all]');assert.equal(await run(`${h('atlas')}.querySelector('[data-stage]').dataset.visibleIks`),'15');
await run(`${h('atlas')}.querySelectorAll('[data-iks] button')[3].click()`);assert.equal(await run(`${h('atlas')}.dataset.selectedIk`),'3');
await run(`(()=>{const select=${h('atlas')}.querySelector('[data-count]');select.value='limits';select.dispatchEvent(new Event('change'));})()`);
await click('atlas','[data-mode="point"]');await click('atlas','[data-map-view="full"]');await clickMap('atlas',[1.05,1.05]);await until(`${h('atlas')}.dataset.busy==='false'&&${h('atlas')}.dataset.ikCount==='0'`);
assert.equal(await run(`${h('atlas')}.querySelector('[data-stage]').dataset.primaryVisible`),'false');assert.equal(await run(`${h('atlas')}.querySelector('[data-stage]').dataset.visibleIks`),'0');
await click('atlas','[data-map-view="detail"]');await clickMap('atlas',xyAtlas.demonstrationPoint);await until(`${h('atlas')}.dataset.busy==='false'&&${h('atlas')}.dataset.ikCount==='16'`);
await click('atlas','[data-show-one]');await run(`${h('atlas')}.querySelector('[data-iks] .active input').click()`);assert.equal(await run(`${h('atlas')}.querySelector('[data-stage]').dataset.primaryVisible`),'false');await click('atlas','[data-show-all]');assert.equal(await run(`${h('atlas')}.querySelector('[data-stage]').dataset.primaryVisible`),'true');
await run(`${h('atlas')}.querySelectorAll('[data-iks] button')[5].click()`);await click('atlas','[data-clear]');await click('atlas','[data-mode="draw"]');
const point=xyAtlas.demonstrationPoint;await clickMap('atlas',[point[0]+.015,point[1]]);await clickMap('atlas',[point[0]+.015,point[1]-.015]);await click('atlas','[data-close]');assert.equal(await run(`JSON.parse(${h('atlas')}.dataset.pathVertices).length`),4);
const drawnVertices=await run(`${h('atlas')}.dataset.pathVertices`);await click('atlas','[data-track]');await until(`${h('atlas')}.dataset.busy==='false'&&Number(${h('atlas')}.dataset.pathPoints)>2`);assert.match(await run(`${h('atlas')}.querySelector('[data-status]').textContent`),/full path/);
await go('draw');await until(`${h('draw')}?.dataset.ikCount==='16'`);assert.equal(await run(`${h('draw')}.dataset.pathVertices`),drawnVertices,'The actual drawn xy path carries into the next slide.');
await go('atlas');await click('atlas','[data-example]');await until(`${h('atlas')}.dataset.busy==='false'&&JSON.parse(${h('atlas')}.dataset.pathVertices).length>10`);const vertices=await run(`${h('atlas')}.dataset.pathVertices`);await click('atlas','[data-compare]');await until(`${h('atlas')}.dataset.busy==='false'&&${h('atlas')}.querySelectorAll('[data-comparison] button').length===16`);
const results=await run(`[...${h('atlas')}.querySelectorAll('[data-comparison] button')].map(b=>b.textContent)`);assert.deepEqual(results.flatMap((text,i)=>text.endsWith('complete')?[i]:[]),xyAtlas.demonstrationPath.verification.completeIndices);await capture('22-xy-comparison');
await go('draw');await until(`${h('draw')}?.dataset.ikCount==='16'`);assert.equal(await run(`${h('draw')}.dataset.pathVertices`),vertices);assert.equal(await run(`${h('draw')}.querySelectorAll('[data-comparison] button').length`),16);
await run(`[...${h('draw')}.querySelectorAll('[data-comparison] button')].find(b=>b.textContent.endsWith('complete')).click()`);const count=+await run(`${h('draw')}.dataset.pathPoints`);assert.equal(count,xyAtlas.demonstrationPath.verification.targetSamples);assert.equal(await run(`${h('draw')}.querySelector('[data-stage]').dataset.hasGhost`),'true');
await click('draw','[data-play]');await until(`Number(${h('draw')}.querySelector('[data-progress]').value)>5`);await click('draw','[data-play]');const idx=+await run(`${h('draw')}.querySelector('[data-progress]').value`);await wait(120);assert.equal(+await run(`${h('draw')}.querySelector('[data-progress]').value`),idx);
await run(`(()=>{const progress=${h('draw')}.querySelector('[data-progress]');progress.value=progress.max;progress.dispatchEvent(new Event('input'));})()`);assert.equal(await run(`${h('draw')}.querySelector('[data-play]').textContent`),'Replay');await click('draw','[data-play]');await until(`Number(${h('draw')}.querySelector('[data-progress]').value)>3&&Number(${h('draw')}.querySelector('[data-progress]').value)<50`);await click('draw','[data-reset]');assert.equal(await run(`${h('draw')}.querySelector('[data-progress]').value`),'0');assert.deepEqual((await layout('draw')).overflow,[]);
await go('nscs');await until(`${h('nscs')}?.dataset.pathPoints&&${h('nscs')}.querySelector('[data-stage]').dataset.hasGhost==='true'`);const ns=await run(`({...${h('nscs')}.dataset})`);assert.ok(+ns.endpointJointDistance>1);assert.ok(+ns.minDet>0);assert.ok(+ns.minLimitMargin>0);const nscsStart=await run(`${h('nscs')}.querySelector('[data-stage]').dataset.q`);
await click('nscs','[data-end]');assert.notEqual(await run(`${h('nscs')}.querySelector('[data-stage]').dataset.q`),nscsStart);assert.equal(await run(`${h('nscs')}.querySelector('[data-stage]').dataset.ghostQ`),nscsStart,'The transparent robot remains at the initial configuration.');assert.equal(+await run(`${h('nscs')}.dataset.frame`),+ns.pathPoints-1);await capture('22-endpoint');await click('nscs','[data-play]');await until(`+${h('nscs')}.dataset.frame>5&&+${h('nscs')}.dataset.frame<200`);await click('nscs','[data-reset]');assert.equal(await run(`${h('nscs')}.dataset.frame`),'0');assert.equal(await run(`${h('nscs')}.dataset.playing`),'false');assert.deepEqual((await layout('nscs')).overflow,[]);
    const abbHost = mode => `document.querySelector('[data-path-lab="${mode}"]')`;
    const abbSet = (mode, selector, value) => run(`(()=>{const input=${abbHost(mode)}.querySelector('${selector}');input.value='${value}';input.dispatchEvent(new Event('input'));})()`);
    const abbShow = async mode => { await go(mode); await until(`${abbHost(mode)}?.dataset.ready==='true'`); };
    const abbLayout = async mode => {
      const bounds = await run(`(()=>{
        const h=${abbHost(mode)},panel=h.querySelector('.l7-panel'),stage=h.querySelector('.l7-stage'),opacity=h.querySelector('.l7-irb-opacity');
        const r=panel.getBoundingClientRect(),readout=h.querySelector('.l7-readout').getBoundingClientRect(),status=h.querySelector('.l7-status').getBoundingClientRect();
        const rectangle=h.querySelector('svg path[stroke="#e00000"]').getBBox();
        return {scroll:panel.scrollHeight,available:panel.clientHeight,readoutBottom:readout.bottom,statusBottom:status.bottom,panelBottom:r.bottom,
          opacityGap:stage.getBoundingClientRect().bottom-opacity.getBoundingClientRect().bottom,rectangleRatio:rectangle.height/rectangle.width,plotHeight:h.querySelector('svg').clientHeight};
      })()`);
      assert.ok(bounds.scroll <= bounds.available + 1, 'All ABB controls, joint speeds and messages fit without scrolling: ' + JSON.stringify(bounds));
      assert.ok(bounds.readoutBottom <= bounds.panelBottom + 1 && bounds.statusBottom <= bounds.panelBottom + 1);
      assert.ok(bounds.opacityGap > 0 && bounds.opacityGap < 15, 'STL opacity stays at the scene bottom.');
      assert.ok(Math.abs(bounds.rectangleRatio - .55/.85) < .002, 'The 2D plot uses equal metre scales.');
      assert.ok(bounds.plotHeight >= 170, 'The full-height IRB plot retains readable labels.');
      assert.deepEqual((await layout(mode)).overflow, []);
    };
    const modes = ['abb-irb-path','abb-irb-numerical','abb-irb-analytical'];
    for (const mode of modes) {
      await abbShow(mode);
      const data = await run(`({...${abbHost(mode)}.dataset})`);
      assert.equal(data.pathPlane,'xy'); assert.equal(data.pathShape,'rectangle'); assert.equal(data.jacobianPoint,'6'); assert.equal(data.startIkCount, '8'); assert.equal(data.validStartCount, '4');
      assert.equal(data.completeBranchCount, '2'); assert.equal(data.meshCount, '7');
      await abbSet(mode, '[data-duration]', 2);
      await abbSet(mode,'[data-progress]',90); if(mode!=='abb-irb-numerical'){assert.equal(await run(`${abbHost(mode)}.dataset.positionIkCount`),'2');assert.equal(await run(`${abbHost(mode)}.dataset.fullPoseIkCount`),'4');} const ratio2 = +await run(`${abbHost(mode)}.dataset.peakSpeedRatio`);
      await abbSet(mode, '[data-progress]', 40);
      const rates = async () => (await run(`${abbHost(mode)}.querySelector('.l7-readout').textContent`)).split('\n').find(line=>line.startsWith('q̇')).split(':')[1].split(',').map(Number);
      const rates2 = await rates();
      await abbSet(mode, '[data-duration]', 20);
      const ratio20 = +await run(`${abbHost(mode)}.dataset.peakSpeedRatio`);
      assert.ok(Math.abs(ratio2/ratio20-10) < 1e-10, 'Joint speed scales inversely with trajectory duration.');
      await abbSet(mode, '[data-progress]', 40);
      const rates20 = await rates(); assert.equal(rates20.length, 6);
      rates2.forEach((value,i) => assert.ok(Math.abs(value-10*rates20[i]) < .56, 'Displayed speeds agree within decimal rounding.'));
      await abbSet(mode, '.l7-irb-opacity input', 25); assert.equal(await run(`${abbHost(mode)}.dataset.opacity`), '0.25');
      await abbSet(mode, '.l7-irb-opacity input', 100);
      await abbLayout(mode); await capture(mode+'-1440');
    }
    await send('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false}); await wait(400);
    for (const mode of modes) { await abbShow(mode); await abbLayout(mode); await capture(mode+'-1280'); }
    await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});

    const pathMode = 'abb-irb-path'; await abbShow(pathMode); await abbSet(pathMode, '[data-duration]', 2);
    const startTime = await run(`(()=>{${abbHost(pathMode)}.querySelector('[data-play]').click();return performance.now();})()`);
    await wait(500);
    const state = await run(`({time:performance.now(),frame:+${abbHost(pathMode)}.dataset.frame})`),tau=Math.min(1,(state.time-startTime)/2000);
    assert.ok(Math.abs(state.frame-(()=>{const edge=Math.min(3,Math.floor(4*tau)),u=4*tau-edge;return 90*(edge+10*u**3-15*u**4+6*u**5);})()) < 10, 'Playback follows the smooth clock for each rectangle edge.');
    await run(`${abbHost(pathMode)}.querySelector('[data-play]').click()`);
    const paused = await run(`${abbHost(pathMode)}.dataset.frame`); await wait(150);
    assert.equal(await run(`${abbHost(pathMode)}.dataset.frame`), paused);
    assert.equal(await run(`${abbHost(pathMode)}.dataset.playing`), 'false');
    await run(`${abbHost(pathMode)}.querySelector('[data-play]').click()`);
    await until(`${abbHost(pathMode)}.dataset.trackState==='complete'`,60);
    assert.equal(await run(`${abbHost(pathMode)}.dataset.frame`), '360');
    await run(`${abbHost(pathMode)}.querySelector('[data-play]').click()`);
    await until(`+${abbHost(pathMode)}.dataset.frame>1&&+${abbHost(pathMode)}.dataset.frame<50`,30);
    await run(`${abbHost(pathMode)}.querySelector('[data-reset]').click()`);
    assert.equal(await run(`${abbHost(pathMode)}.dataset.frame`), '0');
    assert.equal(await run(`${abbHost(pathMode)}.dataset.playing`), 'false');
    const failMode = 'abb-irb-numerical'; await abbShow(failMode); await abbSet(failMode, '[data-duration]', 2);
    await run(`${abbHost(failMode)}.querySelector('[data-play]').click()`);
    await until(`${abbHost(failMode)}.dataset.trackState==='failed'`,60);
    const failed = await run(`({...${abbHost(failMode)}.dataset})`);
    assert.equal(+failed.frame,71); assert.equal(failed.playing, 'false');
    assert.match(await run(`${abbHost(failMode)}.querySelector('.l7-status').textContent`), /positional fold/);

    assert.deepEqual(errors, [], 'No uncaught browser exceptions');
    assert.deepEqual(consoleErrors, [], 'No caught visualization/bootstrap errors');
    assert.deepEqual(httpErrors, [], 'All module imports and assets loaded');
    console.log('PASS: CRB x–y map at z = 0.5 m (16 initial IKs), IK selection, drawing, branch failures, shared paths, NSCS ghost and replay; ABB 8/4/2 outcomes, joint speeds, duration clock, replay, positional-fold stops, equal-scale rectangle plots and layout at two viewport sizes.');
  } finally {
    if (contextId) await send('Target.disposeBrowserContext', {browserContextId:contextId}, null).catch(() => {});
    for (const job of pending.values()) clearTimeout(job.timer);
    ws.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
