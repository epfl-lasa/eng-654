#!/usr/bin/env node
/* Export the final visible state of every lecture slide through local Chromium.
 * Requirements: Node 22+, Python 3 with pypdf and Pillow, a local lecture HTTP server,
 * and a Chromium CDP endpoint. The exporter owns a disposable browser context.
 * CDP_URL, LECTURE_BASE_URL, LECTURES (01,02,...), PDF_OUTPUT_DIR,
 * PDF_WORK_DIR and SLIDES (for reviewing selected slide numbers) are optional.
 * Navigation and capture styles exist only in the export context.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
const CDP = (process.env.CDP_URL || 'http://127.0.0.1:9256').replace(/\/$/, '');
const BASE = (process.env.LECTURE_BASE_URL || 'http://127.0.0.1:8052').replace(/\/$/, '');
const OUTPUT = process.env.PDF_OUTPUT_DIR || path.join(ROOT, 'assets/pdf');
const WORK = process.env.PDF_WORK_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'eng654-pdf-'));
const LECTURES = (process.env.LECTURES || '01,02,03,04,05,06,07,08').split(',').map(x => x.padStart(2, '0'));
const SELECTED_SLIDES = process.env.SLIDES?.split(',').map(Number);
const WIDTH = 1440, HEIGHT = 900;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const browser = await (await fetch(CDP + '/json/version')).json();
  const ws = new WebSocket(browser.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  let serial = 0, session, context;
  const pending = new Map(), errors = [], requests = new Map();
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const job = pending.get(message.id); if (!job) return;
      pending.delete(message.id); clearTimeout(job.timer);
      message.error ? job.reject(new Error(JSON.stringify(message.error))) : job.resolve(message.result);
    }
    if (message.sessionId !== session) return;
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(message.params.args.map(a => a.value || a.description));
    if (message.method === 'Network.requestWillBeSent') requests.set(message.params.requestId, message.params.request.url);
    if (['Network.loadingFinished', 'Network.loadingFailed'].includes(message.method)) requests.delete(message.params.requestId);
    if (message.method === 'Network.responseReceived' && message.params.response.status >= 400 && !message.params.response.url.endsWith('/favicon.ico')) errors.push({ status: message.params.response.status, url: message.params.response.url });
  });
  const send = (method, params = {}, sessionId = session) => new Promise((resolve, reject) => {
    const id = ++serial, timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 180000);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const run = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const until = async (expression, timeout = 120000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (errors.length) throw new Error(JSON.stringify(errors));
      if (await run(expression)) return;
      await delay(200);
    }
    throw new Error('Not ready: ' + expression);
  };
  const active = 'document.querySelector("#deck > .slide.active")';
  const click = selector => run(`${active}.querySelector(${JSON.stringify(selector)})?.click()`);
  const scrub = () => run(`(()=>{for(const e of ${active}.querySelectorAll('input[data-progress],input[data-scrub],input[data-paper-progress]')){if(!e.disabled){e.value=e.max||'1';e.dispatchEvent(new Event('input',{bubbles:true}));}}})()`);
  const busy = `${active}.querySelector('[data-busy="true"],[aria-busy="true"]')`;
  const settled = async () => {
    await delay(600);
    await until(`(()=>{const s=${active};return !!s&&!${busy}&&!Array.from(s.querySelectorAll('[data-status],.cusp-status,.ik3r-note,.l8r-footer')).some(e=>/^(Loading|Computing|Evaluating|Building|Enumerating|Solving)/i.test(e.textContent.trim()));})()`);
    for (let i = 0; i < 20 && requests.size; i++) await delay(100);
    if (process.env.PDF_DEBUG && requests.size) console.log('Pending requests:', [...requests.values()]);
    await run('document.fonts.ready');
    await run('window.MathJax?.startup?.promise || Promise.resolve()');
    await delay(200);
  };

  async function finalState(lecture, number) {
    // Reveal authored fragment groups and explicitly stepped frame diagrams.
    await run(`${active}.querySelectorAll('.fragment').forEach(e=>e.classList.add('revealed'))`);
    await click('[data-puma-show-frames]');
    const mode = await run(`${active}.querySelector('[data-custom3r-ik]')?.dataset.mode`);
    // Construction animations have a finite last stage or a last hold in a loop.
    // Wait in real time so the same animation controller used in class draws it.
    if (mode === 'pk3') await until(`${active}.querySelector('.ik3r-note').textContent.startsWith('6 ·')`);
    if (mode === 'pk3-reduction') await until(`${active}.querySelector('.ik3r-note').textContent.startsWith('5 ·')`);
    if (mode === 'pk3-ik') await until(`${active}.querySelector('.ik3r-note').textContent.includes('has reached')`);
    if (mode === 'pipeline') await until('performance.now()%9000>7900&&performance.now()%9000<8100');
    if (['cga-backsolve','cga-forward'].includes(mode)) {
      await run(`${active}.querySelector('[aria-label="Choose IK circle"]').dispatchEvent(new Event('change',{bubbles:true}))`);
      await delay(mode==='cga-forward'?8300:8000);
    }
    if (mode === 'cga-circle-motion') await delay(14000);
    if (mode) await click('[aria-label="Pause scene animation"]');
    await run(`(()=>{for(const v of ${active}.querySelectorAll('video')){v.pause();v.controls=false;if(Number.isFinite(v.duration))v.currentTime=Math.max(0,v.duration-.12);}})()`);
    if (await run(`${active}.querySelector('video')!==null`)) {
      await until(`Array.from(${active}.querySelectorAll('video')).every(v=>v.readyState>=2&&!v.seeking)`);
    }
    const cusp = await run(`${active}.querySelector('[data-cusp-lab]')?.dataset.cuspLab`);
    if (['nscs-3r', 'custom-6r'].includes(cusp)) {
      await until(`${active}.querySelector('[data-build]')&&!${active}.querySelector('[data-build]').disabled`);
      await click('[data-build]');
      await until(`${active}.querySelector('[data-play]')&&!${active}.querySelector('[data-play]').disabled`);
      if (await run(`${active}.querySelector('input[data-progress]')!==null`)) await scrub();
      else { await click('[data-play]'); await until(`${active}.querySelector('[data-cusp-lab]').dataset.progress==='1.0000'`, 120000); }
    }
    if (lecture === '07') {
      const lab = await run(`${active}.querySelector('[data-path-lab]')?.dataset.pathLab`);
      if (lab?.startsWith('custom-')) {
        await click('[data-play]'); await until(`${active}.querySelector('[data-path-lab]').dataset.pathComplete==='true'`);
        if (lab === 'custom-two-laps') { await click('[data-play]'); await until(`${active}.querySelector('[data-path-lab]').dataset.lap==='2'&&${active}.querySelector('[data-path-lab]').dataset.pathComplete==='true'`); }
      }
      if (lab?.startsWith('abb-irb')) await scrub();
      const crb = await run(`${active}.querySelector('[data-crb-lab]')?.dataset.crbLab`);
      if (['atlas', 'draw'].includes(crb)) {
        await click('[data-map-view="detail"]');
        await until(`${active}.querySelector('[data-crb-lab]').dataset.mapBusy==='false'&&${active}.querySelector('[data-crb-lab]').dataset.limitCurvePending==='false'`);
      }
      if (crb === 'draw') {
        await click('[data-example]'); await settled(); await click('[data-compare]');
        await until(`${active}.querySelector('[data-status]').textContent.includes('starting IKs complete')`);
        await scrub();
      }
      if (crb === 'nscs') await click('[data-end]');
    }
    if (lecture === '08') {
      const lab = await run(`${active}.querySelector('[data-redundancy-lab]')?.dataset.redundancyLab`);
      if (lab === 'configuration-pair') await until(`${active}.querySelector('[data-redundancy-lab]').dataset.ready==='true'`);
      if (lab && !['null-motion', 'configuration-pair'].includes(lab)) {
        await until(`${active}.querySelector('[data-redundancy-lab]').dataset.ready==='true'&&!${busy}`);
        await click('[data-plan]');
        await until(`${active}.querySelector('[data-redundancy-lab]').dataset.busy==='false'&&Number(${active}.querySelector('[data-scrub]').disabled)===0`);
        await scrub();
      }
    }
    if (!mode) await settled();
    // On-demand viewers can initialize while still just outside the viewport.
    // Reapply their existing display value to redraw once this slide is active.
    await run(`(()=>{for(const input of ${active}.querySelectorAll('.course-3d-opacity input,.l7-dh-opacity input,[aria-label*="opacity" i]')){input.dispatchEvent(new Event('input',{bubbles:true}));}})()`);
    await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  }

  try {
    ({ browserContextId: context } = await send('Target.createBrowserContext', { disposeOnDetach: true }, null));
    fs.mkdirSync(OUTPUT, { recursive: true });
    for (const lecture of LECTURES) {
      errors.length = 0; requests.clear();
      const { targetId } = await send('Target.createTarget', { url: 'about:blank', browserContextId: context }, null);
      ({ sessionId: session } = await send('Target.attachToTarget', { targetId, flatten: true }, null));
      await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
      // Capture canvases in the frame in which Three.js rendered them. Keeping
      // that image during print avoids GPU readbacks after print changes layout.
      await send('Page.addScriptToEvaluateOnNewDocument', { source: `(()=>{
        const getContext=HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext=function(kind,options){
          return getContext.call(this,kind,/^(webgl2?|experimental-webgl)$/.test(kind)?{...options,preserveDrawingBuffer:true}:options);
        };
        // Offscreen lecture renderers do not need GPU draws during export.
        for(const Context of [window.WebGLRenderingContext,window.WebGL2RenderingContext].filter(Boolean)){
          for(const name of ['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced']){
            const original=Context.prototype[name];if(!original)continue;
            Context.prototype[name]=function(...args){const slide=this.canvas.closest?.('.slide');if(slide&&!slide.classList.contains('active'))return;return original.apply(this,args)};
          }
        }
        const raf=window.requestAnimationFrame.bind(window), queued=[];
        let paused=false, frozen=[];
        window.requestAnimationFrame=callback=>raf(time=>{if(paused)queued.push(callback);else callback(time)});
        window.__lecturePdf={
          freeze:()=>new Promise(resolve=>{if(!document.querySelector('.slide.active canvas')){paused=true;resolve();return;}requestAnimationFrame(()=>{
            frozen=[...document.querySelectorAll('.slide.active canvas')].map(canvas=>{
              const image=canvas.cloneNode(false);
              image.getContext('2d').drawImage(canvas,0,0);
              canvas.replaceWith(image);return{canvas,image};
            });
            paused=true;resolve();
          })}),
          restore:()=>{for(const {canvas,image} of frozen)image.replaceWith(canvas);frozen=[];paused=false;for(const callback of queued.splice(0))requestAnimationFrame(callback);}
        };
      })()` });
      await send('Network.setCacheDisabled', { cacheDisabled: true });
      await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 2, mobile: false });
      await send('Page.navigate', { url: `${BASE}/lectures/lecture_${lecture}.html` });
      await until(`document.querySelector('#deck')?.dataset.navReady==='true'&&document.readyState==='complete'`);
      await delay(1500);
      await run(`(()=>{const style=document.createElement('style');style.textContent='.deck-nav{display:none!important}.fragment{opacity:1!important;transform:none!important;transition:none!important}#deck{transition:none!important}@media print{html,body{width:${WIDTH}px!important;height:${HEIGHT}px!important;overflow:hidden!important}#deck{display:block!important;width:${WIDTH}px!important;height:${HEIGHT}px!important;transform:none!important}.slide{display:none!important}.slide.active{display:flex!important;width:${WIDTH}px!important;height:${HEIGHT}px!important;position:relative!important;break-inside:avoid!important}}';document.head.append(style);})()`);
      const info = await run(`({title:document.title,slides:[...document.querySelectorAll('#deck>.slide')].map(s=>s.querySelector('h1,h2')?.textContent.replace(/\\s+/g,' ').trim()||'Slide')})`);
      const dir = path.join(WORK, `lecture_${lecture}`); fs.mkdirSync(dir, { recursive: true });
      const manifestFile = path.join(dir, 'manifest.json');
      const manifest = process.env.PDF_RESUME && fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile)) : { lecture, title: info.title, width: WIDTH, height: HEIGHT, pages: [], capturedAt: new Date().toISOString() };
      for (let i = 0; i < info.slides.length; i++) {
        const number = i + 1;
        if (SELECTED_SLIDES && !SELECTED_SLIDES.includes(number)) continue;
        if (manifest.pages.some(p => p.number === number) && !process.env.PDF_RECAPTURE) continue;
        await run(`location.hash='slide-${number}'`);
        await until(`${active}===[...document.querySelectorAll('#deck>.slide')][${i}]&&Math.abs(${active}.getBoundingClientRect().left)<1`);
        const started = Date.now();
        await settled();
        if (process.env.PDF_DEBUG) console.log('Settled', Date.now()-started);
        await finalState(lecture, number);
        if (process.env.PDF_DEBUG) console.log('Final', Date.now()-started);
        if (errors.length) throw new Error(JSON.stringify(errors));
        const state = await run(`(()=>{const s=${active};return {unrevealed:s.querySelectorAll('.fragment:not(.revealed)').length,images:[...s.querySelectorAll('img')].filter(e=>!e.complete||!e.naturalWidth).map(e=>e.src),errors:[...s.querySelectorAll('.is-error,[data-error-stack]')].map(e=>e.textContent),canvases:s.querySelectorAll('canvas').length,status:[...s.querySelectorAll('[data-status],.ik3r-note,.l7-status,.l8r-footer')].map(e=>e.textContent.trim()),text:s.innerText};})()`);
        if (state.images.length || state.errors.length) throw new Error(`Lecture ${lecture} slide ${number}: ${JSON.stringify(state)}`);
        const filename = `slide-${String(number).padStart(2,'0')}`;
        if (state.canvases || process.env.PDF_SCREENSHOTS) {
          const screenshot = await send('Page.captureScreenshot', { format: 'png' });
          fs.writeFileSync(path.join(dir, filename+'.png'), Buffer.from(screenshot.data, 'base64'));
        }
        await run('window.__lecturePdf.freeze()');
        const pdf = await send('Page.printToPDF', { printBackground: true, paperWidth: WIDTH/96, paperHeight: HEIGHT/96, marginTop:0,marginBottom:0,marginLeft:0,marginRight:0, preferCSSPageSize:false });
        fs.writeFileSync(path.join(dir, filename+'.pdf'), Buffer.from(pdf.data, 'base64'));
        await run('window.__lecturePdf.restore()');
        manifest.pages = manifest.pages.filter(p => p.number !== number);
        manifest.pages.push({ number, title: info.slides[i], file: filename+'.pdf', screenshot: state.canvases ? filename+'.png' : null, ...state });
        fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest,null,2)+'\n');
        console.log(`Lecture ${lecture}: ${number}/${info.slides.length} ${info.slides[i]} (${((Date.now()-started)/1000).toFixed(1)}s)`);
      }
      execFileSync('python3', [path.join(__dirname, 'merge-lecture-pdf.py'), path.join(dir, 'manifest.json'), path.join(OUTPUT, `lecture_${lecture}.pdf`)], { stdio: 'inherit' });
      await send('Target.closeTarget', { targetId }, null); session = undefined;
    }
    console.log('PDFs: '+OUTPUT+'\nReview captures: '+WORK);
  } finally {
    if (context) await send('Target.disposeBrowserContext', { browserContextId: context }, null).catch(()=>{});
    for (const job of pending.values()) clearTimeout(job.timer);
    ws.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
