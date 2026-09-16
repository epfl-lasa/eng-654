/* CRB slice controls and recovery regression, no packages required. Start the lecture HTTP server, Chromium CDP,
 * and the native IK service with bash lectures_main/tools/serve-crb-ik.sh (port 8743),
 * then: node lectures_main/tests/lecture-07-crb-slice-browser.cjs
 * Override CDP_URL (default http://127.0.0.1:9256) and LECTURE_URL (default below).
 * Optional SCREENSHOT_DIR saves review images. Uses its own incognito browser
 * context; existing tabs and saved paths are untouched. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const CDP_URL = (process.env.CDP_URL || 'http://127.0.0.1:9256').replace(/\/$/, '');
const CHECKS=process.env.CRB_CHECKS||'all'; // saved, core, recovery, or all
const LECTURE_URL = (process.env.LECTURE_URL || 'http://127.0.0.1:8052/lectures/lecture_07.html').split('#')[0];

async function main() {
  const browser = await (await fetch(CDP_URL + '/json/version')).json();
  const ws = new WebSocket(browser.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, {once:true}); ws.addEventListener('error', reject, {once:true}); });
  let serial = 0, sessionId, contextId;
  const pending = new Map(), errors = [], consoleErrors = [], httpErrors = [], sliceRequests = [], nativeRequests = [], detailRequests = [];
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
    if (message.method === 'Network.requestWillBeSent') {
      const request=message.params.request,url=new URL(request.url);
      if(url.port==='8743'&&['/slice','/health'].includes(url.pathname))nativeRequests.push(request.url);
      if(url.pathname.endsWith('/crb-slice-xy-detail.json'))detailRequests.push(request.url);
      if(url.port==='8743'&&url.pathname==='/slice'&&request.method==='POST'&&request.postData)sliceRequests.push({id:message.params.requestId,spec:JSON.parse(request.postData)});
    }
    if (message.method === 'Network.responseReceived' && message.params.response.status >= 400) {
      const response=message.params.response;
      if(!(response.status===404&&new URL(response.url).pathname==='/favicon.ico'))httpErrors.push([response.status,response.url]);
    }
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
  const atlas = JSON.parse(fs.readFileSync(path.join(__dirname,'../assets/data/lecture07/crb-slice-xy-diverse.json'),'utf8'));
  const detailAtlas = JSON.parse(fs.readFileSync(path.join(__dirname,'../assets/data/lecture07/crb-slice-xy-detail.json'),'utf8'));
  const savedRaster=Object.fromEntries(['counts','limitCounts'].map(key=>[key,Array.from({length:detailAtlas.ny},(_,row)=>detailAtlas[key].slice((detailAtlas.ny-1-row)*detailAtlas.nx,(detailAtlas.ny-row)*detailAtlas.nx)).flat()]));
  const representatives=atlas.representativePoints,sixteen=representatives.find(sample=>sample.count===16);
  const state = mode => run(`({...${h(mode)}.dataset})`);
  const set = (mode,selector,value) => run(`${h(mode)}.querySelector('${selector}').value=${JSON.stringify(String(value))}`);
  const clickMap = async (mode, point) => {
    const position=await run(`(()=>{const host=${h(mode)},svg=host.querySelector('[data-slice]'),box=svg.querySelector('clipPath rect'),b=JSON.parse(host.dataset.viewBounds),p=svg.createSVGPoint();p.x=Number(box.getAttribute('x'))+(${point[0]}-b[0])/(b[1]-b[0])*Number(box.getAttribute('width'));p.y=Number(box.getAttribute('y'))+(b[3]-(${point[1]}))/(b[3]-b[2])*Number(box.getAttribute('height'));const screen=p.matrixTransform(svg.getScreenCTM()),hit=document.elementFromPoint(screen.x,screen.y);return{x:screen.x,y:screen.y,hit:hit?.tagName,host:hit?.closest('[data-crb-lab]')?.dataset.crbLab};})()`);
    assert.equal(position.host,mode,JSON.stringify(position));await send('Input.dispatchMouseEvent',{type:'mousePressed',x:position.x,y:position.y,button:'left',buttons:1,clickCount:1});
    await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:position.x,y:position.y,button:'left',buttons:0,clickCount:1});
  };
  const waitPoint = (mode,count) => until(`${h(mode)}.dataset.busy==='false'&&Number(${h(mode)}.dataset.ikCount)===${count}`);
  const mapJobs = async () => ({native:nativeRequests.length,slices:sliceRequests.length,
    workers:await run('window.__crbSliceWorkerStarts.length'),workerJobs:await run('window.__crbSliceWorkerJobs.length')});
  const isDefaultPose = current => Number(current.sliceZ)===atlas.z&&JSON.parse(current.orientation).every((row,i)=>row.every((v,j)=>Math.abs(v-atlas.orientation[i][j])<1e-12));
  const setView = async (mode, requested) => {
    const before=await mapJobs(),previous=await state(mode),previousQ=await run(`${h(mode)}.querySelector('[data-stage]').dataset.q`);
    await click(mode,`[data-map-view="${requested}"]`);
    await until(`${h(mode)}.dataset.mapView==='${requested}'&&${h(mode)}.dataset.mapBusy==='false'&&${h(mode)}.dataset.busy==='false'`,2400);
    if(requested==='detail'){
      const current=await state(mode);
      assert.deepEqual(JSON.parse(current.mapBounds),JSON.parse(current.viewBounds));
      assert.equal(current.samples,'100000');assert.equal(current.mapCompleted,'100000');
      if(isDefaultPose(previous)){
        assert.deepEqual(await mapJobs(),before,'Default Central detail must load the saved map without contacting a native service or starting a slice worker.');
        assert.equal(current.mapSource,'backup');assert.equal(current.mapSeconds,'0');
        assert.deepEqual(JSON.parse(current.orientation),atlas.orientation);
      }else{
        const after=await mapJobs();assert.ok(after.slices>before.slices||after.workerJobs>before.workerJobs,'An edited pose must still calculate its detail map.');
        assert.equal(current.mapSource,'live');
        if(after.slices>before.slices){const spec=sliceRequests.at(-1).spec;
          assert.equal(spec.nx*spec.ny,100000);assert.deepEqual([spec.xmin,spec.xmax,spec.ymin,spec.ymax],JSON.parse(current.viewBounds));
          assert.equal(spec.z,Number(current.sliceZ));assert.deepEqual(spec.orientation,JSON.parse(previous.orientation),'The request preserves the committed orientation, without rounding displayed fields.');
        }
      }
      for(const key of ['pathVertices','pathPoints','selectedIk','ikCount','limitIkCount','sliceZ'])assert.equal(current[key],previous[key],`Detail preserves ${key}`);
      assert.equal(await run(`${h(mode)}.querySelector('[data-stage]').dataset.q`),previousQ,'Detail preserves the selected robot pose.');
    }
  };
  // Read the actual rendered raster rather than trusting a sample-count label.
  const raster = mode => run(`(async()=>{
    const host=${h(mode)},svg=host.querySelector('[data-slice]'),image=new Image();image.src=svg.querySelector('image').getAttribute('href');await image.decode();
    const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
    const palette=new Map();for(const span of host.querySelector('[data-legend]').children){const count=Number(span.textContent.replace(' IKs',''));if(!Number.isFinite(count))continue;const swatch=getComputedStyle(span.querySelector('i')).backgroundColor,values=swatch.match(/\\d+/g).slice(0,3);palette.set(values.join(','),count);}
    const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data,counts=[],histogram={};for(let i=0;i<pixels.length;i+=4){const count=palette.get([pixels[i],pixels[i+1],pixels[i+2]].join(','));if(count===undefined)throw new Error('Raster color missing from legend');counts.push(count);histogram[count]=(histogram[count]||0)+1;}
    return {width:canvas.width,height:canvas.height,counts,histogram};
  })()`);
  const fkAt = (mode,point,z,orientation) => run(`(async()=>{const k=await import('../js/viz/abbCrbKinematics.js'),q=JSON.parse(${h(mode)}.querySelector('[data-stage]').dataset.q);return k.poseError(k.fk(q).matrix,k.makePose(${JSON.stringify([point[0],point[1],z])},${JSON.stringify(orientation)}));})()`);
  try {
    ({browserContextId:contextId} = await send('Target.createBrowserContext', {disposeOnDetach:true}, null));
    const {targetId} = await send('Target.createTarget', {url:'about:blank', browserContextId:contextId}, null);
    ({sessionId} = await send('Target.attachToTarget', {targetId, flatten:true}, null));
    await send('Runtime.enable');await send('Page.enable');await send('Network.enable');await send('Network.setCacheDisabled',{cacheDisabled:true});
    await send('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{
      window.__crbSliceWorkerStarts=[];window.__crbSliceWorkerJobs=[];window.__crbHeldDetailFetches=[];
      const NativeWorker=window.Worker;window.Worker=class extends NativeWorker{
        constructor(url,options){super(url,options);this.__slice=String(url).includes('abbCrbSliceWorker.js');if(this.__slice)window.__crbSliceWorkerStarts.push(String(url));}
        postMessage(message,...rest){if(this.__slice)window.__crbSliceWorkerJobs.push(message.slice);return super.postMessage(message,...rest);}
      };
      const originalFetch=window.fetch.bind(window);window.fetch=(input,options)=>{
        if(window.__crbDelaySavedDetail&&String(input?.url||input).includes('crb-slice-xy-detail.json'))return new Promise((resolve,reject)=>window.__crbHeldDetailFetches.push(()=>originalFetch(input,options).then(resolve,reject)));
        return originalFetch(input,options);
      };
    })()`});
    await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
    await send('Page.navigate',{url:LECTURE_URL});await until(`!!document.querySelector('[data-crb-lab="atlas"]')`);await go('atlas');
    await until(`${h('atlas')}?.dataset.busy==='false'&&${h('atlas')}.dataset.mapSource==='backup'`);
    assert.equal(atlas.plane,'xy');assert.equal(atlas.nx*atlas.ny,100000);
    assert.equal((await state('atlas')).slicePlane,'xy');assert.equal((await state('atlas')).samples,'100000');assert.equal((await state('atlas')).sliceZ,String(atlas.z));
    assert.deepEqual(JSON.parse((await state('atlas')).orientation),atlas.orientation);
    assert.equal((await state('atlas')).mapView,'full');assert.deepEqual(JSON.parse((await state('atlas')).viewBounds),[-1.1,1.1,-1.1,1.1]);
    assert.deepEqual(await run(`[...${h('atlas')}.querySelectorAll('[data-slice] .l7-svg-label')].map(n=>n.textContent)`),['x [m]','y [m]']);
    assert.match(await run(`${h('atlas')}.querySelector('[data-map-title]').textContent`),/x-y.*z = 0.5/);
    const histogram=atlas.counts.reduce((counts,value)=>(counts[value]=(counts[value]||0)+1,counts),{});
    assert.deepEqual(histogram,atlas.histogram);assert.equal(Object.values(histogram).reduce((sum,n)=>sum+n,0),100000);
    for(const count of [4,6,8,10,12,14,16])assert.ok(histogram[count]>0,`Missing actual ${count}-IK region.`);
    const legend=await run(`${h('atlas')}.querySelector('[data-legend]').textContent`);for(const count of [4,6,8,10,12,14,16])assert.ok(legend.includes(count+' IKs'));
    assert.equal(await run(`${h('atlas')}.querySelector('[data-stage]').dataset.meshCount`),'7');
    if(CHECKS==='saved'){
      assert.deepEqual(await mapJobs(),{native:0,slices:0,workers:0,workerJobs:0});
      assert.equal(detailAtlas.nx,400);assert.equal(detailAtlas.ny,250);assert.equal(detailAtlas.counts.length,100000);
      assert.equal(detailAtlas.limitCounts.length,100000);assert.equal(detailRequests.length,1,'Preload the saved detail once.');
      await setView('atlas','detail');
      const all=await raster('atlas');assert.equal(all.width,400);assert.equal(all.height,250);assert.deepEqual(all.counts,savedRaster.counts);
      await set('atlas','[data-count]','limits');await run(`${h('atlas')}.querySelector('[data-count]').dispatchEvent(new Event('change'))`);
      const legal=await raster('atlas');assert.deepEqual(legal.counts,savedRaster.limitCounts);
      assert.ok(legal.counts.every((count,i)=>count>=0&&count<=all.counts[i]));assert.ok(legal.counts.some((count,i)=>count<all.counts[i]));
      await setView('atlas','detail');await setView('atlas','full');await setView('atlas','detail');
      await go('draw');await waitPoint('draw',16);await click('draw','[data-example]');await waitPoint('draw',16);
      await run(`${h('draw')}.querySelectorAll('[data-iks] button')[1].click()`);
      await click('draw','[data-track]');await until(`${h('draw')}.dataset.busy==='false'&&Number(${h('draw')}.dataset.pathPoints)>0`,1400);
      await run(`(()=>{const slider=${h('draw')}.querySelector('[data-progress]');slider.value=Math.floor(Number(slider.max)/3);slider.dispatchEvent(new Event('input'));})()`);
      const tracked=await state('draw'),trackedQ=await run(`${h('draw')}.querySelector('[data-stage]').dataset.q`);
      for(const view of ['full','detail','detail'])await setView('draw',view);
      const restored=await state('draw');
      for(const key of ['pathVertices','pathPoints','selectedIk','ikCount','limitIkCount','frame'])assert.equal(restored[key],tracked[key],`Saved-map switches preserve ${key}.`);
      assert.equal(await run(`${h('draw')}.querySelector('[data-stage]').dataset.q`),trackedQ);
      assert.equal(detailRequests.length,1);assert.deepEqual(await mapJobs(),{native:0,slices:0,workers:0,workerJobs:0});
      console.log('PASS: first/repeated Central detail loads saved 400×250 count layers without map jobs; full/detail switches retain IK, path, frame and robot pose.');

      // Hold the shared asset during reload while both slide hosts initialize.
      // Releasing it must initialize both from saved data without a map job.
      const delayed=await send('Page.addScriptToEvaluateOnNewDocument',{source:'window.__crbDelaySavedDetail=true;'});
      await send('Page.reload',{ignoreCache:true});await until(`!!document.querySelector('[data-crb-lab="atlas"]')`);await go('atlas');
      await until('window.__crbHeldDetailFetches?.length===1');await go('draw');
      assert.equal(await run('window.__crbHeldDetailFetches.length'),1,'Both hosts share one pending detail fetch.');
      assert.deepEqual(await mapJobs(),{native:0,slices:0,workers:0,workerJobs:0});
      await run('window.__crbDelaySavedDetail=false;window.__crbHeldDetailFetches.splice(0).forEach(release=>release())');
      for(const mode of ['atlas','draw'])await until(`${h(mode)}.dataset.busy==='false'&&${h(mode)}.dataset.mapBusy==='false'&&${h(mode)}.dataset.mapSource==='backup'`);
      await send('Page.removeScriptToEvaluateOnNewDocument',{identifier:delayed.identifier});
      await setView('draw','detail');assert.deepEqual((await raster('draw')).counts,savedRaster.counts);
      assert.equal(detailRequests.length,2);assert.deepEqual(await mapJobs(),{native:0,slices:0,workers:0,workerJobs:0});
      console.log('PASS: reload and concurrent slide initialization reuse the saved detail, including a delayed asset response.');

      // Explicit quick recalculation must not round the unchanged orientation
      // into a different pose that would prevent the next saved-detail load.
      const beforeQuickDefault=await mapJobs();
      await set('draw','[data-resolution]',400);await click('draw','[data-calculate]');
      await until(`${h('draw')}.dataset.mapBusy==='false'&&${h('draw')}.dataset.busy==='false'&&${h('draw')}.dataset.mapSource==='live'&&${h('draw')}.dataset.mapCompleted==='400'`,1400);
      assert.equal(isDefaultPose(await state('draw')),true,'Native normalization may only change the returned orientation within 1e-12.');
      const quickDefaultJobs=await mapJobs();
      const quickDefaultSpec=quickDefaultJobs.slices>beforeQuickDefault.slices?sliceRequests.at(-1).spec:await run('window.__crbSliceWorkerJobs.at(-1)');
      assert.deepEqual(quickDefaultSpec.orientation,atlas.orientation,'The quick request preserves the exact committed orientation.');
      await setView('draw','detail');
      assert.deepEqual(await mapJobs(),quickDefaultJobs);assert.equal((await state('draw')).mapSource,'backup');
      assert.deepEqual((await raster('draw')).counts,savedRaster.counts);
      console.log('PASS: explicit default quick400 retains exact orientation and returns to saved detail without a 100k job.');

      // Each edited pose still receives a real quick map. Its detail request
      // must launch 100k computation, which can be cancelled back to saved data.
      for(const edit of [{z:.49,yawDelta:0},{z:atlas.z,yawDelta:.4}]){
        await click('draw','[data-backup]');await waitPoint('draw',16);await setView('draw','detail');
        const yaw=Number(await run(`${h('draw')}.querySelector('[data-yaw]').value`));
        await set('draw','[data-slice-z]',edit.z);await set('draw','[data-yaw]',yaw+edit.yawDelta);await set('draw','[data-resolution]',400);
        const before=await mapJobs();await click('draw','[data-calculate]');
        await until(`${h('draw')}.dataset.mapBusy==='false'&&${h('draw')}.dataset.busy==='false'&&${h('draw')}.dataset.mapSource==='live'&&${h('draw')}.dataset.mapCompleted==='400'`,1400);
        const quick=await state('draw'),after=await mapJobs();
        assert.ok(after.slices>before.slices||after.workerJobs>before.workerJobs);assert.equal(quick.sliceZ,String(edit.z));assert.equal(quick.mapView,'detail');
        assert.equal(isDefaultPose(quick),false);assert.equal((await raster('draw')).counts.length,400);
        await click('draw','[data-map-view="detail"]');
        for(let i=0;i<100;i++){const jobs=await mapJobs();if(jobs.slices>after.slices||jobs.workerJobs>after.workerJobs)break;await wait(100);}
        const launched=await mapJobs();assert.ok(launched.slices>after.slices||launched.workerJobs>after.workerJobs,'Edited Central detail must start a fresh map job.');
        const spec=launched.slices>after.slices?sliceRequests.at(-1).spec:await run('window.__crbSliceWorkerJobs.at(-1)');
        assert.equal(spec.nx*spec.ny,100000);assert.equal(spec.z,edit.z);assert.deepEqual([spec.xmin,spec.xmax,spec.ymin,spec.ymax],atlas.detailBounds);
        assert.deepEqual(spec.orientation,JSON.parse(quick.orientation));
        await click('draw','[data-backup]');await waitPoint('draw',16);await setView('draw','detail');await wait(500);
        const final=await state('draw');assert.equal(final.mapBusy,'false');assert.equal(final.mapSource,'backup');assert.equal(final.mapView,'detail');
        assert.deepEqual(JSON.parse(final.mapBounds),atlas.detailBounds);assert.equal(final.sliceZ,String(atlas.z));
        assert.deepEqual((await raster('draw')).counts,savedRaster.counts,'Late live chunks cannot overwrite the restored saved map.');
      }
      assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);assert.deepEqual(httpErrors,[]);
      console.log('PASS: changed height/orientation calculate real 400-pose maps, start 100k detail jobs, and safely cancel back to the saved default.');
      return;
    }
    if(CHECKS!=='recovery'){
    // Use real pointer events against the currently displayed plot bounds.
    assert.ok(Array.isArray(representatives)&&representatives.length>=7,'Verified representative points must accompany the count map.');
    await setView('atlas','detail');assert.equal((await state('atlas')).mapView,'detail');assert.deepEqual(JSON.parse((await state('atlas')).viewBounds),atlas.detailBounds);
    const allRaster=await raster('atlas');assert.equal(allRaster.width,400);assert.equal(allRaster.height,250);assert.deepEqual(allRaster.counts,savedRaster.counts);
    await set('atlas','[data-count]','limits');await run(`${h('atlas')}.querySelector('[data-count]').dispatchEvent(new Event('change'))`);
    const legalRaster=await raster('atlas');assert.deepEqual(legalRaster.counts,savedRaster.limitCounts);assert.ok(legalRaster.counts.some((n,i)=>n<allRaster.counts[i]));
    assert.ok(legalRaster.counts.every((n,i)=>n>=0&&n<=allRaster.counts[i]));assert.equal(Object.values(legalRaster.histogram).reduce((a,b)=>a+b,0),100000);
    const checkIndices=[0,399,997,5555,18003,31579,49999,50000,61555,75511,89991,99999];
    const independent=await run(`(async()=>{const k=await import('../js/viz/abbCrbKinematics.js'),b=JSON.parse(${h('atlas')}.dataset.mapBounds),R=JSON.parse(${h('atlas')}.dataset.orientation),z=Number(${h('atlas')}.dataset.sliceZ);return ${JSON.stringify(checkIndices)}.map(i=>{const x=b[0]+i%400/399*(b[1]-b[0]),y=b[3]-Math.floor(i/400)/249*(b[3]-b[2]),roots=k.inverse(k.makePose([x,y,z],R));return {i,all:roots.solutions.length,legal:roots.solutions.filter(q=>q.withinLimits).length,resolved:roots.diagnostics.resolved};});})()`);
    for(const check of independent){assert.equal(check.resolved,true);assert.equal(allRaster.counts[check.i],check.all);assert.equal(legalRaster.counts[check.i],check.legal);}
    await capture('central-detail-100k-legal');await set('atlas','[data-count]','all');await run(`${h('atlas')}.querySelector('[data-count]').dispatchEvent(new Event('change'))`);await capture('central-detail-100k-all');console.log('PASS: Central detail loads the saved 100k map without recalculation; both rendered count layers match the asset and independent IK samples.');
    for(const count of [4,6,8,10,12,14,16]){
      const sample=representatives.find(sample=>sample.count===count);assert.ok(sample,`Missing ${count}-IK representative.`);
      const b=JSON.parse((await state('atlas')).viewBounds),inside=sample.point[0]>=b[0]&&sample.point[0]<=b[1]&&sample.point[1]>=b[2]&&sample.point[1]<=b[3];
      if(!inside)await setView('atlas','full');
      await clickMap('atlas',sample.point);await waitPoint('atlas',count);
      assert.equal((await state('atlas')).resolved,'true');assert.equal(+(await state('atlas')).limitIkCount,sample.limitCount);
      const actualPoint=JSON.parse((await state('atlas')).pathVertices)[0];assert.ok(Math.hypot(...actualPoint.map((v,i)=>v-sample.point[i]))<.008,'Pointer rounding stays within one full-view map pixel.');const error=await fkAt('atlas',actualPoint,atlas.z,atlas.orientation);assert.ok(error.position<2e-7&&error.rotation<2e-7,'Selected IK matches the actual clicked xy pose.');
    }
    await setView('atlas','detail');await clickMap('atlas',sixteen.point);await waitPoint('atlas',16);
    const sixteenClicked=JSON.parse((await state('atlas')).pathVertices)[0];assert.equal(await run(`${h('atlas')}.querySelectorAll('[data-iks] button').length`),16);
    await click('atlas','[data-show-one]');assert.equal(await run(`${h('atlas')}.querySelector('[data-stage]').dataset.visibleIks`),'0');
    await click('atlas','[data-show-all]');assert.equal(await run(`${h('atlas')}.querySelector('[data-stage]').dataset.visibleIks`),'15');
    for(let i=0;i<16;i++){await run(`${h('atlas')}.querySelectorAll('[data-iks] button')[${i}].click()`);const e=await fkAt('atlas',sixteenClicked,atlas.z,atlas.orientation);assert.ok(e.position<2e-7&&e.rotation<2e-7,`IK ${i+1} FK residual`);}
    await capture('xy-sixteen-iks-detail');
    // Point selection carries forward. Drawing creates a constant-z, constant-R task path.
    await go('draw');await waitPoint('draw',16);assert.equal((await state('draw')).mapSource,'backup');
    await setView('draw','detail');await capture('xy-draw-before-click');await click('draw','[data-mode="point"]');await clickMap('draw',atlas.demonstrationPoint);await waitPoint('draw',16);
    await click('draw','[data-clear]');await click('draw','[data-mode="draw"]');
    const p=atlas.demonstrationPoint,vertices=[p,[p[0]+.018,p[1]],[p[0]+.018,p[1]+.018],[p[0],p[1]+.018]];
    for(const point of vertices.slice(1))await clickMap('draw',point);
    await click('draw','[data-close]');
    let drawn=JSON.parse((await state('draw')).pathVertices);assert.equal(drawn.length,5,JSON.stringify({drawn,mode:await run(`${h('draw')}.querySelector('[data-mode].active')?.dataset.mode`),errors,status:await run(`${h('draw')}.querySelector('[data-status]').textContent`)}));assert.ok(Math.hypot(...drawn[0].map((v,i)=>v-drawn.at(-1)[i]))<1e-10);
    const targets=await run(`(async()=>{const s=await import('../js/viz/abbCrbSlice.js'),a=${JSON.stringify(atlas.orientation)},p=s.slicePathPoses(JSON.parse(${h('draw')}.dataset.pathVertices),{plane:'xy',z:${atlas.z},orientation:a});return p.map(t=>({p:t.slice(0,3).map(row=>row[3]),R:t.slice(0,3).map(row=>row.slice(0,3))}));})()`);
    assert.ok(targets.length>20);targets.forEach(t=>{assert.equal(t.p[2],atlas.z);assert.deepEqual(t.R,atlas.orientation);});
    assert.deepEqual(JSON.parse((await state('atlas')).pathVertices),drawn);
    // Compare the supplied example dynamically; do not reuse another slice's branch outcomes.
    await click('draw','[data-example]');await waitPoint('draw',16);
    assert.equal(await run(`${h('draw')}.querySelector('[data-count]').value`),'limits');
    const example=JSON.parse((await state('draw')).pathVertices),xRange=Math.max(...example.map(p=>p[0]))-Math.min(...example.map(p=>p[0])),yRange=Math.max(...example.map(p=>p[1]))-Math.min(...example.map(p=>p[1]));
    assert.ok(xRange>.295&&yRange>.295,'The example loop spans 30 cm in both map axes.');
    assert.deepEqual(example[0],atlas.demonstrationPoint);assert.deepEqual(example.at(-1),example[0]);
    const midway=example[Math.floor((example.length-1)/2)],crossing=await run(`(async()=>{const k=await import('../js/viz/abbCrbKinematics.js'),result=k.inverse(k.makePose([${midway[0]},${midway[1]},${atlas.z}],${JSON.stringify(atlas.orientation)}));return {all:result.solutions.length,legal:result.solutions.filter(q=>q.withinLimits).length,resolved:result.diagnostics.resolved};})()`);
    assert.equal(crossing.resolved,true);assert.equal(crossing.all,8);assert.equal(crossing.legal,8,'The enlarged supplied loop crosses an eight-legal-IK region.');
    await until(`${h('draw')}.querySelector('[data-compare]').disabled===false`);
    await click('draw','[data-compare]');await until(`${h('draw')}.dataset.busy==='false'&&${h('draw')}.querySelectorAll('[data-comparison] button').length===16`,1400);
    const outcomes=await run(`[...${h('draw')}.querySelectorAll('[data-comparison] button')].map(b=>b.textContent)`),complete=outcomes.map((s,i)=>s.includes('complete')?i:-1).filter(i=>i>=0);
    assert.deepEqual(complete,[0,1,10],'The enlarged example retains two nonsingular changes of IK and one closed joint loop.');
    await run(`${h('draw')}.querySelectorAll('[data-comparison] button')[${complete[0]}].click()`);
    const last=Number(await run(`${h('draw')}.querySelector('[data-progress]').max`));assert.ok(last>10);assert.equal(await run(`${h('draw')}.querySelector('[data-stage]').dataset.hasGhost`),'true');
    await click('draw','[data-play]');await until(`Number(${h('draw')}.dataset.frame)>2`);await click('draw','[data-play]');assert.equal((await state('draw')).playing,'false');
    await run(`(()=>{const slider=${h('draw')}.querySelector('[data-progress]');slider.value=slider.max;slider.dispatchEvent(new Event('input'));})()`);
    assert.equal((await state('draw')).frame,String(last));assert.equal(await run(`${h('draw')}.querySelector('[data-play]').textContent`),'Replay');
    await click('draw','[data-play]');await until(`Number(${h('draw')}.dataset.frame)>0&&Number(${h('draw')}.dataset.frame)<${last}`);await click('draw','[data-reset]');assert.equal((await state('draw')).frame,'0');assert.equal((await state('draw')).playing,'false');
    await go('atlas');assert.equal(+(await state('atlas')).pathPoints,last+1);await go('draw');await capture('xy-example-path');
    // Reuse the saved central region with a chosen branch and track present.
    await setView('draw','detail');assert.deepEqual(JSON.parse((await state('atlas')).mapBounds),atlas.detailBounds);assert.equal((await state('atlas')).samples,'100000');
    await setView('draw','detail');assert.equal((await state('draw')).pathPoints,String(last+1));
    const keepTrack=await state('draw');await setView('draw','full');assert.deepEqual(JSON.parse((await state('draw')).viewBounds),[atlas.xmin,atlas.xmax,atlas.ymin,atlas.ymax]);assert.equal((await state('draw')).pathVertices,keepTrack.pathVertices);assert.equal((await state('draw')).pathPoints,keepTrack.pathPoints);
    // Rapid switches between the saved maps remain synchronous and preserve the track.
    const beforeSwitches=await mapJobs();await click('draw','[data-map-view="detail"]');await click('draw','[data-map-view="full"]');await until(`${h('draw')}.dataset.mapBusy==='false'&&${h('draw')}.dataset.mapView==='full'`);assert.deepEqual(await mapJobs(),beforeSwitches);
    for(const mode of ['atlas','draw']){assert.equal((await state(mode)).mapView,'full');assert.deepEqual(JSON.parse((await state(mode)).mapBounds),[atlas.xmin,atlas.xmax,atlas.ymin,atlas.ymax]);assert.equal((await state(mode)).pathPoints,keepTrack.pathPoints);}

    console.log('PASS: larger loop reaches exactly eight legal IKs; repeated saved detail/full switches preserve the selected track and pose in both panels.');
    if(CHECKS==='core'){assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);assert.deepEqual(httpErrors,[]);return;}
    }else{await go('draw');await waitPoint('draw',16);}
    // Native 400-pose calculation applies all four independent pose controls to both panels.
    assert.equal(await run(`${h('draw')}.querySelector('[data-slice-settings]').checkValidity()`),true);
    const health=await run(`fetch('http://127.0.0.1:8743/health').then(r=>r.json())`);assert.equal(health.backend,'rust-native');
    await set('draw','[data-slice-z]',.49);await set('draw','[data-yaw]',1.4);await set('draw','[data-pitch]',-15.7);await set('draw','[data-roll]',83.9);await set('draw','[data-resolution]',400);
    await click('draw','[data-calculate]');await until(`${h('draw')}.dataset.mapBusy==='false'&&${h('draw')}.dataset.busy==='false'&&${h('draw')}.dataset.mapSource==='live'`,1400);
    assert.equal((await state('draw')).backend,'rust-native');assert.equal((await state('draw')).mapCompleted,'400');assert.equal((await state('draw')).sliceZ,'0.49');assert.equal((await state('atlas')).sliceZ,'0.49');assert.equal((await state('atlas')).backend,'rust-native');
    const angles=JSON.parse((await state('draw')).orientationRpy);[83.9,-15.7,1.4].forEach((angle,i)=>assert.ok(Math.abs(angles[i]-angle*Math.PI/180)<1e-10));
    assert.ok(Number((await state('draw')).ikCount)>0);const liveR=JSON.parse((await state('draw')).orientation),e=await fkAt('draw',JSON.parse((await state('draw')).pathVertices)[0],.49,liveR);assert.ok(e.position<2e-7&&e.rotation<2e-7);
    assert.match(await run(`${h('draw')}.querySelector('[data-status]').textContent`),/400 poses.*slice\./);
    // The service-unavailable route still computes real counts with a JS worker pool.
    await run(`window.CRBIK_NATIVE_URL='http://127.0.0.1:1'`);await set('draw','[data-slice-z]',.5);await click('draw','[data-calculate]');
    await until(`${h('draw')}.dataset.mapBusy==='false'&&${h('draw')}.dataset.busy==='false'&&${h('draw')}.dataset.mapSource==='live'`,1400);
    assert.equal((await state('draw')).backend,'javascript-workers');assert.ok(+(await state('draw')).workers>=Math.min(2,Math.max(1,(await run('navigator.hardwareConcurrency'))-1)));assert.equal((await state('draw')).mapCompleted,'400');
    assert.doesNotMatch(await run(`${h('draw')}.querySelector('[data-status]').textContent`),/native Rust|parallel browser|difficult poses recovered|Every sampled pose resolved/);
    // A resolved unreachable slice stays zero; it must not trigger the backup.
    await set('draw','[data-slice-z]',-1.2);await click('draw','[data-calculate]');await until(`${h('draw')}.dataset.busy==='false'&&${h('draw')}.dataset.mapBusy==='false'&&${h('draw')}.dataset.ikCount==='0'`,1400);
    assert.equal((await state('draw')).mapSource,'live');assert.equal(await run(`${h('draw')}.querySelector('[data-stage]').dataset.primaryVisible`),'false');assert.equal(await run(`${h('draw')}.querySelector('[data-legend]').textContent`),'0 IKs');
    await run('delete window.CRBIK_NATIVE_URL');
    // Both larger resolutions are cancelable, and stale results cannot replace the backup.
    for(const size of [4000,100000]){await set('draw','[data-slice-z]',.5);await set('draw','[data-resolution]',size);await click('draw','[data-calculate]');assert.equal((await state('draw')).samples,String(size));await click('draw','[data-backup]');await until(`${h('draw')}.dataset.mapSource==='backup'&&${h('draw')}.dataset.busy==='false'&&${h('draw')}.dataset.mapBusy==='false'`);await wait(200);assert.equal((await state('draw')).samples,'100000');assert.equal((await state('draw')).sliceZ,String(atlas.z));}
    // Fail only the map pool, preserving the point IK worker used by recovery.
    await run(`window.CRBIK_NATIVE_URL='http://127.0.0.1:1';window.__RealWorker=window.Worker;window.Worker=class extends window.__RealWorker{constructor(url,options){if(String(url).includes('abbCrbSliceWorker.js'))throw new Error('Injected map worker failure');super(url,options);}}`);
    await set('draw','[data-slice-z]',.35);await set('draw','[data-resolution]',400);await click('draw','[data-calculate]');await until(`${h('draw')}.dataset.busy==='false'&&${h('draw')}.dataset.mapSource==='backup'&&${h('draw')}.dataset.sliceZ==='${atlas.z}'`);
    await run('window.Worker=window.__RealWorker;delete window.__RealWorker;delete window.CRBIK_NATIVE_URL');
    assert.match(await run(`${h('draw')}.querySelector('[data-status]').textContent`),/Live map calculation failed.*Verified 100,000-pose backup restored/);assert.equal((await state('atlas')).mapSource,'backup');
    // A map-only failure must retain a nondefault committed pose and its completed detail sampling.
    await click('draw','[data-map-view="detail"]');await set('draw','[data-slice-z]',.48);await set('draw','[data-resolution]',400);await click('draw','[data-calculate]');
    await until(`${h('draw')}.dataset.mapBusy==='false'&&${h('draw')}.dataset.busy==='false'&&${h('draw')}.dataset.sliceZ==='0.48'`);
    assert.equal((await state('draw')).mapView,'detail');assert.equal((await state('draw')).samples,'400');
    await click('draw','[data-example]');await until(`${h('draw')}.dataset.busy==='false'&&JSON.parse(${h('draw')}.dataset.pathVertices).length===121`);await click('draw','[data-show-one]');
    const preserved=await state('draw'),preservedQ=await run(`${h('draw')}.querySelector('[data-stage]').dataset.q`);
    await run(`window.CRBIK_NATIVE_URL='http://127.0.0.1:1';window.__RealWorker=window.Worker;window.Worker=class extends window.__RealWorker{constructor(url,options){if(String(url).includes('abbCrbSliceWorker.js'))throw new Error('Injected map-only failure');super(url,options);}}`);
    const pendingMap=await run(`(()=>{const host=${h('draw')};host.querySelector('[data-map-view="full"]').click();return {busy:host.dataset.mapBusy,done:host.dataset.mapCompleted};})()`);assert.deepEqual(pendingMap,{busy:'true',done:'0'});
    await until(`${h('draw')}.dataset.mapBusy==='false'&&${h('draw')}.dataset.mapView==='detail'`);
    for(const key of ['sliceZ','pathVertices','ikCount','limitIkCount','selectedIk'])assert.equal((await state('draw'))[key],preserved[key]);
    assert.deepEqual(JSON.parse((await state('draw')).mapBounds),atlas.detailBounds);assert.equal((await state('draw')).samples,'400');assert.equal(await run(`${h('draw')}.querySelector('[data-stage]').dataset.q`),preservedQ);
    assert.match(await run(`${h('draw')}.querySelector('[data-status]').textContent`),/previous sampling at the same height and orientation/);
    await run('window.Worker=window.__RealWorker;delete window.__RealWorker;delete window.CRBIK_NATIVE_URL');await click('draw','[data-backup]');await until(`${h('draw')}.dataset.busy==='false'&&${h('draw')}.dataset.mapSource==='backup'`);
    // Include 16 IK controls and both plot views in the two projector-size checks.
    await go('atlas');await setView('atlas','detail');await clickMap('atlas',sixteen.point);await waitPoint('atlas',16);
    for(const selectedView of ['detail','full']){
      if(selectedView==='full'){await go('atlas');await setView('atlas','full');}
      for(const width of [1440,1280]){
        await send('Emulation.setDeviceMetricsOverride',{width,height:width===1440?900:720,deviceScaleFactor:1,mobile:false});
        for(const mode of ['atlas','draw']){
          await go(mode);assert.deepEqual((await layout(mode)).overflow,[]);assert.equal((await state(mode)).mapView,selectedView);
          const fields=await run(`(()=>{const host=${h(mode)},r=host.querySelector('.l7-crb-side').getBoundingClientRect();return [...host.querySelectorAll('[data-slice-settings] input,[data-slice-settings] select,[data-slice-settings] button')].every(el=>{const b=el.getBoundingClientRect();return b.left>=r.left-1&&b.right<=r.right+1;});})()`);assert.ok(fields,'Slice settings fit their sidebar.');
          await capture('xy-'+mode+'-'+selectedView+'-'+width);
        }
      }
    }
    assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);assert.deepEqual(httpErrors,[]);
    console.log('PASS: XY axes, real 100k histogram 4–16 IKs, representative-point clicks/FK, full/detail views, all16 visibility, shared constant-z paths, compare/play/replay/reset, native400 map, parallelJS fallback, zero plane, cancellation/failure backup, 1440/1280 layouts.');
  } finally {
    if (contextId) await send('Target.disposeBrowserContext',{browserContextId:contextId},null).catch(()=>{});
    for(const job of pending.values())clearTimeout(job.timer);ws.close();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
