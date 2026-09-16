/* Lecture 07 opacity and plot interaction regression. Uses an isolated CDP context.
 * CDP_URL and LECTURE_URL override the local preview defaults; SCREENSHOT_DIR is optional. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{
const browser=await(await fetch((process.env.CDP_URL||'http://127.0.0.1:9256').replace(/\/$/,'')+'/json/version')).json(),ws=new WebSocket(browser.webSocketDebuggerUrl);
await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true});});
let id=0,session,context;const pending=new Map(),errors=[];
ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);if(!p)return;clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result);}if(m.sessionId===session&&m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);});
const send=(method,params={},target=session)=>new Promise((resolve,reject)=>{const n=++id,timer=setTimeout(()=>reject(new Error(method)),30000);pending.set(n,{resolve,reject,timer});ws.send(JSON.stringify({id:n,method,params,...(target?{sessionId:target}:{})}));});
const run=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
const wait=ms=>new Promise(r=>setTimeout(r,ms));const until=async e=>{for(let i=0;i<150;i++){if(await run(e))return;await wait(100);}throw new Error('Not ready '+e);};
const host=`document.querySelector('[data-path-lab="square-master"]')`,svg=`${host}.querySelector('svg')`;
const bounds=()=>run(`JSON.parse(${svg}.dataset.plotBounds)`);
const button=action=>run(`${host}.querySelector('[data-plot-action="${action}"]').click()`);
const go=async selector=>{const n=await run(`[...document.querySelectorAll('#deck>.slide')].indexOf(document.querySelector('${selector}').closest('.slide'))+1`);await run(`location.hash='slide-${n}'`);await wait(300);};
const pixel=point=>run(`(()=>{const svg=${svg},b=JSON.parse(svg.dataset.plotBounds),r=svg.querySelector('clipPath rect'),p=svg.createSVGPoint();p.x=+r.getAttribute('x')+(${point[0]}-b.x[0])/(b.x[1]-b.x[0])*+r.getAttribute('width');p.y=+r.getAttribute('y')+(b.y[1]-${point[1]})/(b.y[1]-b.y[0])*+r.getAttribute('height');const s=p.matrixTransform(svg.getScreenCTM());return{x:s.x,y:s.y};})()`);
const mouse=async p=>{await send('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',buttons:1,clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',buttons:0,clickCount:1});};
try{
({browserContextId:context}=await send('Target.createBrowserContext',{},null));const {targetId}=await send('Target.createTarget',{url:'about:blank',browserContextId:context},null);({sessionId:session}=await send('Target.attachToTarget',{targetId,flatten:true},null));await send('Runtime.enable');await send('Page.enable');await send('Network.enable');await send('Network.setCacheDisabled',{cacheDisabled:true});
await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});await send('Page.navigate',{url:process.env.LECTURE_URL||'http://127.0.0.1:8052/lectures/lecture_07.html'});await until(`!!document.querySelector('[data-path-model="custom-intro"]')`);
for(const [width,height]of [[1440,900],[1280,720]]){
await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await go('[data-path-model="custom-intro"]');await until(`document.querySelector('[data-path-model="custom-intro"]').dataset.meshCount==='4'`);
const opacity=await run(`(()=>{const h=document.querySelector('[data-path-model="custom-intro"]'),label=h.querySelector('.l7-dh-opacity');return{host:h.clientWidth,label:label.getBoundingClientRect().width,input:label.querySelector('input').getBoundingClientRect().width};})()`);assert.ok(opacity.label<300&&opacity.label<opacity.host*.6,JSON.stringify(opacity));
await run(`(()=>{const e=document.querySelector('[data-path-model="custom-intro"] .l7-dh-opacity input');e.value='.5';e.dispatchEvent(new Event('input'));})()`);assert.equal(await run(`document.querySelector('[data-path-model="custom-intro"] .l7-dh-opacity output').textContent`),'50%');
await go('[data-path-lab="square-master"]');await until(`${svg}?.dataset.plotBounds`);await button('reset');assert.deepEqual(await bounds(),{x:[0,5],y:[-4,4]});
const aspect=await run(`(()=>{const svg=${svg},r=svg.querySelector('clipPath rect');return +r.getAttribute('width')/+r.getAttribute('height');})()`);assert.ok(Math.abs(aspect-.625)<1e-10,'The plot uses equal metre scales.');assert.equal(await run(`!!${svg}.querySelector('[data-view-notice]')`),false,'The default cusp path is inside the expanded view.');
const overflows=await run(`(()=>{const h=${host},r=h.getBoundingClientRect();return [...h.querySelectorAll('[data-plot-tools] *')].filter(e=>{const b=e.getBoundingClientRect();return b.right>r.right||b.bottom>r.bottom||b.left<r.left;}).map(e=>e.textContent);})()`);assert.deepEqual(overflows,[]);
if(process.env.SCREENSHOT_DIR){fs.mkdirSync(process.env.SCREENSHOT_DIR,{recursive:true});const image=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(require('node:path').join(process.env.SCREENSHOT_DIR,'plot-default-'+width+'.png'),Buffer.from(image.data,'base64'));}
await button('in');let b=await bounds();assert.ok(Math.abs(b.x[1]-b.x[0]-5/1.5)<1e-10);await button('out');b=await bounds();assert.ok(Math.abs(b.x[1]-b.x[0]-5)<1e-10);
await button('fit');b=await bounds();assert.ok(b.y[1]>2.93462&&b.y[0]<2.5);await button('reset');
const anchor=[2.1,.4],at=await pixel(anchor);await send('Input.dispatchMouseEvent',{type:'mouseWheel',...at,deltaX:0,deltaY:-250});await wait(200);b=await bounds();assert.ok(b.x[1]-b.x[0]<5);const after=await pixel(anchor);assert.ok(Math.hypot(after.x-at.x,after.y-at.y)<1,JSON.stringify({at,after}));
const panStart=await pixel([2.5,0]);await send('Input.dispatchMouseEvent',{type:'mousePressed',...panStart,button:'left',buttons:1,modifiers:8,clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:panStart.x+50,y:panStart.y+25,button:'left',buttons:1,modifiers:8});await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:panStart.x+50,y:panStart.y+25,button:'left',buttons:0,modifiers:8,clickCount:1});await wait(100);const shifted=await bounds();assert.ok(shifted.x[0]<b.x[0]&&shifted.y[0]>b.y[0]);
await run(`${host}.querySelector('[data-draw]').click()`);const points=[[2,.3],[2.2,.4],[2.15,.1]];for(const point of points)await mouse(await pixel(point));const draft=await run(`JSON.parse(${host}.dataset.draftPathSignature)`);for(let i=0;i<3;i++)for(let j=0;j<2;j++)assert.ok(Math.abs(draft.vertices[i][j]-points[i][j])<.008,JSON.stringify(draft));
await button('reset');assert.deepEqual(await bounds(),{x:[0,5],y:[-4,4]});await run(`${host}.querySelector('[data-reset]').click()`);
console.log(JSON.stringify({viewport:[width,height],opacity,defaultBounds:await bounds(),zoom:true,pan:true,drawingAfterZoom:true}));
for(const mode of ['custom-regular','custom-infeasible-a','custom-infeasible-b','custom-nonsingular','custom-two-laps']){
  await go('[data-path-lab="'+mode+'"]');
  const h=`document.querySelector('[data-path-lab="${mode}"]')`,work=`${h}.querySelector('[data-work]')`;
  await until(`${work}?.dataset.plotBounds`);
  assert.equal(await run(`${work}.dataset.plotViewMode`),'zoomed',mode+' defaults to Zoomed');
  const zoomBounds=await run(`JSON.parse(${work}.dataset.plotBounds)`);
  assert.ok(zoomBounds.x[1]-zoomBounds.x[0]<3&&zoomBounds.y[0]>1&&zoomBounds.y[1]<5,JSON.stringify(zoomBounds));
  const density=await run(`(${work}.querySelector('[data-critical-curves]').getAttribute('d').match(/L/g)||[]).length`);
  assert.ok(density>10000,'The adaptive vector critical curves retain fine geometry.');
  const initialSample=await run(`${h}.dataset.sample`);
  await run(`${h}.querySelector('[data-plot-view="full"]').click()`);
  assert.deepEqual(await run(`JSON.parse(${work}.dataset.plotBounds)`),{x:[0,5],y:[-4,5]});
  assert.equal(await run(`${work}.dataset.plotViewMode`),'full');
  assert.equal(await run(`${h}.querySelector('[data-plot-view="full"]').getAttribute('aria-pressed')`),'true');
  assert.match(await run(`${work}.textContent`),/critical values · z: −4…5 m/,'Full view labels the expanded upper extent.');
  const scale=await run(`(()=>{const r=${work}.querySelector('clipPath rect');return +r.getAttribute('width')/+r.getAttribute('height');})()`);
  assert.ok(Math.abs(scale-5/9)<1e-10,'Full view retains equal metre scales.');
  if(process.env.SCREENSHOT_DIR&&mode==='custom-nonsingular'){const image=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(require('node:path').join(process.env.SCREENSHOT_DIR,'critical-full-'+width+'.png'),Buffer.from(image.data,'base64'));}
  await run(`${h}.querySelector('[data-plot-view="zoomed"]').click()`);
  assert.deepEqual(await run(`JSON.parse(${work}.dataset.plotBounds)`),zoomBounds);
  assert.equal(await run(`${h}.dataset.sample`),initialSample,'Changing the plot view preserves animation state.');
  const overflow=await run(`(()=>{const h=${h},r=h.getBoundingClientRect();return [...h.querySelectorAll('[data-plot-views] button')].some(e=>{const b=e.getBoundingClientRect();return b.left<r.left||b.right>r.right||b.bottom>r.bottom;});})()`);
  assert.equal(overflow,false);
  if(process.env.SCREENSHOT_DIR&&mode==='custom-nonsingular'){const image=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(require('node:path').join(process.env.SCREENSHOT_DIR,'critical-zoomed-'+width+'.png'),Buffer.from(image.data,'base64'));}
  console.log(JSON.stringify({viewport:[width,height],mode,defaultZoom:zoomBounds,fullBounds:{x:[0,5],y:[-4,5]},curveSegments:density}));
}

}
assert.deepEqual(errors,[]);console.log('Lecture07 plot/opacity browser checks passed.');
}finally{if(context)await send('Target.disposeBrowserContext',{browserContextId:context},null);ws.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
