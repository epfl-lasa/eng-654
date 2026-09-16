/* Local lecture preview + CDP; uses a disposable context and requests detail once. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
(async()=>{
 const {chromium}=require(process.env.PLAYWRIGHT_PATH||'/home/durghy/Downloads/playcanvas-kuka-physics-ab-v6/node_modules/playwright');
 const browser=await chromium.connectOverCDP(process.env.CDP_URL||'http://127.0.0.1:9256');
 const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage(),errors=[],sliceRequests=[];
 const host=mode=>page.locator(`[data-crb-lab="${mode}"]`),state=mode=>host(mode).evaluate(el=>({...el.dataset}));
 const ready=mode=>page.waitForFunction(mode=>{const el=document.querySelector(`[data-crb-lab="${mode}"]`);return el?.dataset.busy==='false'&&el.dataset.limitCurvePending==='false'&&+el.dataset.limitCurveSegments>0;},mode,{timeout:120000});
 const go=async mode=>{
  await page.evaluate(mode=>{const slide=document.querySelector(`[data-crb-lab="${mode}"]`).closest('.slide');location.hash='slide-'+([...document.querySelectorAll('#deck>.slide')].indexOf(slide)+1);},mode);
  await page.waitForFunction(mode=>{const slide=document.querySelector(`[data-crb-lab="${mode}"]`).closest('.slide');return slide.classList.contains('active')&&Math.abs(slide.getBoundingClientRect().left)<2;},mode);
  await ready(mode);
 };
 const curveAtStop=mode=>host(mode).evaluate(el=>{
  const svg=el.querySelector('[data-slice]'),box=svg.querySelector('clipPath rect'),bounds=JSON.parse(el.dataset.viewBounds),stop=JSON.parse(el.dataset.stop);
  const x=+box.getAttribute('x'),y=+box.getAttribute('y'),w=+box.getAttribute('width'),h=+box.getAttribute('height');
  const world=([a,b])=>[bounds[0]+(a-x)/w*(bounds[1]-bounds[0]),bounds[3]-(b-y)/h*(bounds[3]-bounds[2])];
  const distance=(p,a,b)=>{const d=b.map((v,i)=>v-a[i]),t=Math.max(0,Math.min(1,p.reduce((sum,v,i)=>sum+(v-a[i])*d[i],0)/d.reduce((sum,v)=>sum+v*v,0)));return Math.hypot(...p.map((v,i)=>v-a[i]-t*d[i]));};
  let nearest=Infinity,segments=0;
  for(const curve of svg.querySelectorAll('[data-q4-limit-curve]')){
   const points=[...curve.getAttribute('d').matchAll(/[ML]([\d.e+-]+),([\d.e+-]+)/g)].map(match=>world([+match[1],+match[2]]));
   for(let i=1;i<points.length;i++){nearest=Math.min(nearest,distance(stop.position.slice(0,2),points[i-1],points[i]));segments++;}
  }
  const marker=svg.querySelector('[data-limit-marker] circle'),point=world([+marker.getAttribute('cx'),+marker.getAttribute('cy')]);
  return {nearest,segments,markerError:Math.hypot(...point.map((v,i)=>v-stop.position[i]))};
 });
 const layout=mode=>host(mode).evaluate(el=>{
  const slide=el.closest('.slide'),bounds=slide.getBoundingClientRect(),overflow=[];
  for(const child of slide.querySelectorAll('p,h2,h3,button,select,svg,.l7-crb-side,.l7-crb-bottom,.l7-crb-map-views')){
   const rect=child.getBoundingClientRect();if(!rect.width||!rect.height)continue;
   let {left,right,top,bottom}=rect;
   for(let parent=child.parentElement;parent&&parent!==slide;parent=parent.parentElement){const css=getComputedStyle(parent),r=parent.getBoundingClientRect();if(['auto','scroll','hidden','clip'].includes(css.overflowX)){left=Math.max(left,r.left);right=Math.min(right,r.right);}if(['auto','scroll','hidden','clip'].includes(css.overflowY)){top=Math.max(top,r.top);bottom=Math.min(bottom,r.bottom);}}
   if(right>left&&bottom>top&&(right>bounds.right+2||bottom>bounds.bottom+2||left<bounds.left-2))overflow.push(child.textContent.slice(0,100));
  }
  const note=el.querySelector('[data-q4-note]').getBoundingClientRect(),map=el.querySelector('.l7-crb-map').getBoundingClientRect();
  return {overflow,noteInsideMap:note.top>=map.top-1&&note.bottom<=map.bottom+1&&note.right<=map.right+1};
 });
 page.on('pageerror',error=>errors.push(error.message));
 page.on('request',request=>{if(request.method()==='POST'&&request.url().endsWith(':8743/slice'))sliceRequests.push(request.postDataJSON());});
 try{
  await page.goto((process.env.LECTURE_URL||'http://127.0.0.1:8052/lectures/lecture_07.html').split('#')[0]+'#slide-22');
  await go('atlas');assert.equal((await state('atlas')).mapView,'full');console.log('Ready: default atlas and q4 boundary.');
  const freshCurve=await host('atlas').evaluate(async el=>{
   const {q4LimitCurve}=await import('../js/viz/abbCrbJointLimitCurves.js?boundary-test='+Date.now()),b=JSON.parse(el.dataset.viewBounds);
   const result=q4LimitCurve({z:+el.dataset.sliceZ,orientation:JSON.parse(el.dataset.orientation),xmin:b[0],xmax:b[1],ymin:b[2],ymax:b[3]});
   const p=[.0059983,.2146056];let nearest=Infinity;
   for(const line of result.lines)for(let i=1;i<line.length;i++){const a=line[i-1],d=line[i].map((v,j)=>v-a[j]),t=Math.max(0,Math.min(1,p.reduce((sum,v,j)=>sum+(v-a[j])*d[j],0)/d.reduce((sum,v)=>sum+v*v,0)));nearest=Math.min(nearest,Math.hypot(...p.map((v,j)=>v-a[j]-t*d[j])));}
   return {segments:result.lines.length,nearest};
  });
  assert.ok(freshCurve.segments>0&&freshCurve.nearest<1e-6,JSON.stringify(freshCurve));
  assert.ok(await host('atlas').locator('[data-q4-limit-curve]').count()>0);assert.match(await host('atlas').locator('[data-q4-note]').textContent(),/q₄ = ±180°/);
  await host('atlas').locator('[data-example]').evaluate(el=>el.click());await ready('atlas');
  assert.equal((await state('atlas')).ikCount,'16');assert.equal(await host('atlas').locator('[data-count]').inputValue(),'limits');
  await host('atlas').locator('[data-compare]').evaluate(el=>el.click());
  await page.waitForFunction(()=>{const el=document.querySelector('[data-crb-lab="atlas"]');return el.dataset.busy==='false'&&el.querySelectorAll('[data-comparison] button').length===16;},null,{timeout:120000});
  console.log('Ready: all 16 starting IKs compared.');
  const stops=[];
  for(const ik of [4,9]){
   await host('atlas').locator('[data-comparison] button').nth(ik-1).evaluate(el=>el.click());const current=await state('atlas'),stop=JSON.parse(current.stop);stops.push(stop);
   assert.equal(+current.selectedIk,ik-1);assert.equal(stop.joint,3);assert.ok(Math.abs(Math.abs(stop.limit)-Math.PI)<1e-12);assert.ok(Math.abs(stop.progress-.583745)<1e-5);
   assert.ok(Math.abs(stop.position[0]-.0059983)<1e-6&&Math.abs(stop.position[1]-.2146056)<1e-6);
   assert.match(await host('atlas').locator('[data-limit-marker] text').textContent(),/^q4 = -?180° stop$/);
   const curve=await curveAtStop('atlas');assert.ok(curve.segments>0);assert.ok(curve.nearest<5e-6,JSON.stringify(curve));assert.ok(curve.markerError<1e-12);
   await host('atlas').locator('[data-stop-summary]').evaluate(el=>el.click());assert.match(await host('atlas').locator('[data-limit-readout]').textContent(),/q4: \[-180°, 180°\]/);assert.match(await host('atlas').locator('[data-stop-explanation]').textContent(),/360° jump/);
   // Sample the real playback slider across the whole track, including adjacent
   // frames near both endpoints; check native physical limits independently.
   const playback=await host('atlas').evaluate(async el=>{
    const k=await import('../js/viz/abbCrbKinematics.js'),slider=el.querySelector('[data-progress]'),qs=[],lastFrame=+slider.max;
    const frames=[...new Set([0,1,Math.round(lastFrame/2),lastFrame-1,lastFrame])].sort((a,b)=>a-b);
    for(const frame of frames){slider.value=frame;slider.dispatchEvent(new Event('input'));qs.push(JSON.parse(el.querySelector('[data-stage]').dataset.q));}
    const stop=JSON.parse(el.dataset.stop),last=qs.at(-1);
    return {count:lastFrame+1,legal:qs.every(q=>k.withinLimits(q)),maxStep:Math.max(...qs.slice(1).flatMap((q,i)=>frames[i+1]-frames[i]===1?q.map((v,j)=>Math.abs(v-qs[i][j])):[])),boundaryLegal:k.withinLimits(stop.boundaryQ,1e-9),boundaryError:Math.abs(stop.boundaryQ[3]-stop.limit),lastQ4:last[3],lastSafe:stop.lastSafe,ghost:JSON.parse(el.querySelector('[data-stage]').dataset.ghostQ),start:qs[0]};
   });
   assert.ok(playback.count>100);assert.equal(playback.legal,true);assert.ok(playback.maxStep<.16);assert.equal(playback.boundaryLegal,true);assert.ok(playback.boundaryError<1e-9);assert.ok(Math.abs(playback.lastQ4-playback.lastSafe)<1e-10);assert.deepEqual(playback.ghost,playback.start);
   assert.equal(await host('atlas').locator('[data-play]').textContent(),'Replay');
   await host('atlas').locator('[data-reset]').evaluate(el=>el.click());assert.equal((await state('atlas')).frame,'0');
   await host('atlas').locator('[data-play]').evaluate(el=>el.click());await page.waitForFunction(()=>+document.querySelector('[data-crb-lab="atlas"]').dataset.frame>2);await host('atlas').evaluate(el=>{if(el.dataset.playing==='true')el.querySelector('[data-play]').click();});assert.equal((await state('atlas')).playing,'false');
   await host('atlas').locator('[data-progress]').evaluate(el=>{el.value=+el.max-1;el.dispatchEvent(new Event('input'));});await host('atlas').locator('[data-play]').evaluate(el=>el.click());
   await page.waitForFunction(()=>{const el=document.querySelector('[data-crb-lab="atlas"]');return el.dataset.playing==='false'&&el.dataset.frame===el.querySelector('[data-progress]').max;});
   const latched=await host('atlas').locator('[data-stage]').getAttribute('data-q');await page.waitForTimeout(120);assert.equal(await host('atlas').locator('[data-stage]').getAttribute('data-q'),latched);
   if(await host('atlas').locator('[data-stop-details]').getAttribute('open')!==null)await host('atlas').locator('[data-stop-summary]').evaluate(el=>el.click());
   console.log('PASS: IK '+ik+' marker, bounded samples and playback endpoint.');
  }
  console.log('PASS: both stop markers and bounded playback samples.');
  assert.ok(stops[0].limit*stops[1].limit<0,'IK 4 and IK 9 reach opposite q4 boundaries');
  await host('atlas').locator('[data-q4-boundary]').uncheck();assert.equal(await host('atlas').locator('[data-q4-limit-curve]').count(),0);assert.equal(await host('atlas').locator('[data-limit-marker]').count(),1);
  await host('atlas').locator('[data-q4-boundary]').check();assert.ok(await host('atlas').locator('[data-q4-limit-curve]').count()>0);
  const screenshotDir=process.env.SCREENSHOT_DIR;
  if(screenshotDir)fs.mkdirSync(screenshotDir,{recursive:true});
  for(const view of ['full','detail']){
   if(view==='detail'){await go('atlas');await host('atlas').locator('[data-map-view="detail"]').evaluate(el=>el.click());await ready('atlas');}
   for(const width of [1440,1280]){
    await page.setViewportSize({width,height:width===1440?900:720});
    for(const mode of ['atlas','draw']){
     await go(mode);const current=await state(mode);assert.equal(current.mapView,view);assert.equal(current.selectedIk,'8');
     const fit=await layout(mode);assert.deepEqual(fit.overflow,[],`${mode} ${view} ${width}`);assert.equal(fit.noteInsideMap,true,`boundary note fits ${mode} ${view} ${width}`);
     const curve=await curveAtStop(mode);assert.ok(curve.nearest<5e-6,`${mode} ${view} ${width}: ${JSON.stringify(curve)}`);
     if(screenshotDir)await page.screenshot({path:path.join(screenshotDir,`${mode}-${view}-${width}.png`)});
    }
   }
  }
  await host('draw').locator('[data-map-view="full"]').evaluate(el=>el.click());await ready('draw');assert.equal((await state('draw')).mapBusy,'false');
  assert.ok(sliceRequests.length<=1,'Only one detail count request is needed for the boundary regression');
  assert.deepEqual(errors,[]);
  console.log('PASS: IK 4/9 stops coincide with the q4 boundary curve; labels, native joint limits, continuous playback and endpoint latch, overlay toggle, full/detail atlas/draw layouts at 1440/1280.');
 }finally{await context.close();await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
