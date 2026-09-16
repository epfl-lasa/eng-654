import { fk, makePose, determinant, jointLimits, poseError, withinLimits } from './abbCrbKinematics.js';
import { createAbbCrbViewer } from './abbCrbVisuals.js';
import { orientationZYX, slicePosition, sliceProjection, slicePathPoses } from './abbCrbSlice.js';
import { createCrbExampleLoop } from './abbCrbExamplePath.js';

import { computeSlice } from './abbCrbCompute.js';

const NS = 'http://www.w3.org/2000/svg', DEG = 180 / Math.PI;
const ASSETS = new URL('../../assets/data/lecture07/', import.meta.url);
// One color per integer: joint limits can leave an odd number of admissible IKs.
const COUNTS = ['#f4f4f1','#e8e2f0','#b9dce8','#e1c1e1','#93bccb','#bba4d1','#6296af','#997dba','#336d91','#735ba1','#234b77','#584180','#183153','#422b63','#10233e','#2d194a','#091528'];
const JOINT_COLORS = ['#bd292c','#246392','#477b3f','#946726','#8a548d','#178080'];
const shared = { atlas: null, target: null, solutions: [], selected: -1, visible: new Set(), vertices: [], track: null,
  tracks: [], resolved: true, message: '', busy: false, pointVersion: 0, sliceVersion: 0, mapView: 'full', mapBusy: false, mapMessage: '', mapCompleted: 0 };
let backupAtlas, defaultDetailAtlas, fullAtlas, completedAtlas, sliceJob;
let limitCurveKey='',limitCurveLines=[],limitCurvePending=false,limitCurveMessage='';
const listeners = new Set();
const publish = () => listeners.forEach(fn => fn());
const jsonCache = new Map();
function data(name) {
  if (!jsonCache.has(name)) jsonCache.set(name, fetch(new URL(name, ASSETS)).then(response => {
    if (!response.ok) throw new Error(`Could not load ABB CRB ${name}.`); return response.json();
  }));
  return jsonCache.get(name);
}
let worker, serial = 0;
const pending = new Map();
function compute(operation, payload, onProgress) {
  if (!worker) {
    worker = new Worker(new URL('./abbCrbWorker.js', import.meta.url), { type: 'module' });
    worker.onmessage = event => {
      const job = pending.get(event.data.id); if (!job) return;
      if (event.data.progress) { job.onProgress?.(event.data.progress); return; }
      clearTimeout(job.timer); pending.delete(event.data.id);
      event.data.error ? job.reject(new Error(event.data.error)) : job.resolve(event.data.result);
    };
    worker.onerror = event => {
      for (const job of pending.values()) { clearTimeout(job.timer); job.reject(new Error(event.message || 'The IK worker could not start.')); }
      pending.clear(); worker.terminate(); worker = null;
    };
  }
  return new Promise((resolve, reject) => {
    const id = ++serial, timer = setTimeout(() => { pending.delete(id); reject(new Error('This calculation exceeded the time limit. Shorten the path and try again.')); }, 120000);
    pending.set(id, { resolve, reject, onProgress, timer }); worker.postMessage({ id, operation, payload });
  });
}

function element(tag, attributes = {}, text) {
  const node = document.createElementNS(NS, tag);
  Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, value));
  if (text !== undefined) node.textContent = text; return node;
}
function pathD(points, map) { return points.map((p,i) => `${i?'L':'M'}${map(...p).map(v=>v.toFixed(3)).join(',')}`).join(''); }
function tickValues(lo, hi) {
  const rough=(hi-lo)/5, magnitude=10**Math.floor(Math.log10(rough));
  const step=[1,2,2.5,5,10].find(x=>x*magnitude>=rough)*magnitude, ticks=[];
  for(let v=Math.ceil(lo/step)*step;v<=hi+step*1e-6;v+=step)ticks.push(Math.abs(v)<step*1e-10?0:Number(v.toPrecision(8)));
  return ticks;
}
let plotId = 0;
function plot(svg, xr, yr, labels, equal = true, topMargin = 38) {
  const w=Math.max(240,svg.clientWidth), h=Math.max(210,svg.clientHeight), pad={l:52,r:16,t:topMargin,b:43};
  let width=w-pad.l-pad.r,height=h-pad.t-pad.b,left=pad.l,top=pad.t;
  if(equal){const scale=Math.min(width/(xr[1]-xr[0]),height/(yr[1]-yr[0]));const ww=scale*(xr[1]-xr[0]),hh=scale*(yr[1]-yr[0]);left+=(width-ww)/2;top+=(height-hh)/2;width=ww;height=hh;}
  const map=(x,y)=>[left+(x-xr[0])/(xr[1]-xr[0])*width,top+(yr[1]-y)/(yr[1]-yr[0])*height];
  const from=(x,y)=>[xr[0]+(x-left)/width*(xr[1]-xr[0]),yr[1]-(y-top)/height*(yr[1]-yr[0])];
  svg.setAttribute('viewBox',`0 0 ${w} ${h}`);svg.replaceChildren();
  const clip='crb-plot-'+(++plotId),defs=element('defs'),clipPath=element('clipPath',{id:clip});
  clipPath.append(element('rect',{x:left,y:top,width,height}));defs.append(clipPath);svg.append(defs);
  const background=element('g',{'clip-path':`url(#${clip})`}),grid=element('g'),curves=element('g',{'clip-path':`url(#${clip})`});
  svg.append(background,grid,curves);
  for(const value of tickValues(...xr)){const x=map(value,yr[0])[0];grid.append(element('line',{x1:x,x2:x,y1:top,y2:top+height,stroke:'#d8dde1','stroke-width':.7}),element('text',{x,y:top+height+17,'text-anchor':'middle',class:'l7-svg-tick'},value));}
  for(const value of tickValues(...yr)){const y=map(xr[0],value)[1];grid.append(element('line',{x1:left,x2:left+width,y1:y,y2:y,stroke:'#d8dde1','stroke-width':.7}),element('text',{x:left-8,y:y+3,'text-anchor':'end',class:'l7-svg-tick'},value));}
  svg.append(element('rect',{x:left,y:top,width,height,fill:'none',stroke:'#75818a','stroke-width':1}),element('text',{x:left+width/2,y:h-8,'text-anchor':'middle',class:'l7-svg-label'},labels[0]),element('text',{transform:`translate(${Math.max(12,left-39)} ${top+height/2}) rotate(-90)`,'text-anchor':'middle',class:'l7-svg-label'},labels[1]));
  return {map,from,left,top,width,height,xr,yr,background,curves};
}
function color(count) { return count < 0 ? '#9a929c' : COUNTS[Math.min(COUNTS.length-1,count)]; }
const imageCache = new WeakMap();
function atlasImage(atlas, limited) {
  let cached=imageCache.get(atlas);if(!cached){cached={};imageCache.set(atlas,cached);}const key=limited?'limitCounts':'counts';if(cached[key])return cached[key];
  const canvas=document.createElement('canvas');canvas.width=atlas.nx;canvas.height=atlas.ny;
  const ctx=canvas.getContext('2d'),pixels=ctx.createImageData(atlas.nx,atlas.ny),counts=atlas[key];
  for(let y=0;y<atlas.ny;y++)for(let x=0;x<atlas.nx;x++){
    const c=color(counts[y*atlas.nx+x]),i=((atlas.ny-1-y)*atlas.nx+x)*4;
    pixels.data[i]=parseInt(c.slice(1,3),16);pixels.data[i+1]=parseInt(c.slice(3,5),16);pixels.data[i+2]=parseInt(c.slice(5,7),16);pixels.data[i+3]=255;
  }
  ctx.putImageData(pixels,0,0);return cached[key]=canvas.toDataURL();
}
function normalizedTrack(track) {
  return {...track,q:track.q||track.qs||[],success:track.success??track.complete,failIndex:track.failIndex??track.failedAt};
}
function shapeTargets() { return slicePathPoses(shared.vertices,shared.atlas); }

async function selectPoint(point, {keepPath=false, allowFallback=true} = {}) {
  const version=++shared.pointVersion;
  shared.target=point;if(!keepPath)shared.vertices=[point];shared.track=null;shared.tracks=[];shared.solutions=[];shared.selected=-1;shared.visible.clear();shared.busy=true;shared.message='Enumerating and verifying this pose’s IKs…';publish();
  try {
    const result=await compute('inverse',{pose:makePose(slicePosition(point,shared.atlas),shared.atlas.orientation)});
    if(version!==shared.pointVersion)return;
    shared.solutions=result.solutions;shared.resolved=result.diagnostics?.resolved!==false;
    shared.selected=Math.max(0,result.solutions.findIndex(s=>s.withinLimits));
    shared.visible=new Set(result.solutions.map((_,i)=>i));
    const legal=result.solutions.filter(s=>s.withinLimits).length;
    shared.message=`${result.solutions.length} verified IKs · ${legal} within joint limits.${shared.resolved?'':' Root enumeration is unresolved here; these are verified candidates, not a complete count.'}`;
  } catch(error){if(version===shared.pointVersion){if(allowFallback&&shared.atlas.source!=='backup')await restoreBackup('Live point IK failed: '+error.message+' Verified backup restored.');else shared.message=error.message;}}
  finally {if(version===shared.pointVersion){shared.busy=false;publish();}}
}

function stopSliceJob() {
  if(!sliceJob)return;
  sliceJob.controller.abort();clearTimeout(sliceJob.timer);sliceJob=null;
}
async function restoreBackup(message) {
  stopSliceJob();++shared.sliceVersion;++shared.pointVersion;
  backupAtlas ||= await data('crb-slice-xy-diverse.json');
  shared.atlas={...backupAtlas,source:'backup'};fullAtlas=completedAtlas=shared.atlas;shared.mapView='full';shared.mapBusy=false;shared.mapSeconds=0;shared.mapCompleted=backupAtlas.nx*backupAtlas.ny;shared.mapMessage=message;
  await selectPoint(backupAtlas.demonstrationPoint,{allowFallback:false});
}
let progressFrame=0;
function publishProgress(){if(!progressFrame)progressFrame=requestAnimationFrame(()=>{progressFrame=0;publish();});}
const sameSlicePose=(a,b)=>!!a&&!!b&&a.z===b.z&&a.orientation.every((row,i)=>row.every((value,j)=>Math.abs(value-b.orientation[i][j])<1e-12));
const viewBounds=view=>view==='detail'?(backupAtlas.detailBounds||[-.23,.23,-.23,.23]):[backupAtlas.xmin,backupAtlas.xmax,backupAtlas.ymin,backupAtlas.ymax];
function verifiedDefaultDetail(detail) {
  if(!detail||detail.plane!=='xy'||detail.nx!==400||detail.ny!==250
    ||!Array.isArray(detail.orientation)||detail.orientation.length!==3
    ||detail.orientation.some(row=>!Array.isArray(row)||row.length!==3||!row.every(Number.isFinite))
    ||!sameSlicePose(detail,backupAtlas))return null;
  const bounds=viewBounds('detail');
  if([detail.xmin,detail.xmax,detail.ymin,detail.ymax].some((value,i)=>value!==bounds[i])
    ||!Array.isArray(detail.counts)||!Array.isArray(detail.limitCounts)
    ||detail.counts.length!==100000||detail.limitCounts.length!==100000
    ||detail.counts.some((count,i)=>!Number.isInteger(count)||count<0||count>16
      ||!Number.isInteger(detail.limitCounts[i])||detail.limitCounts[i]<0||detail.limitCounts[i]>count))return null;
  return {...detail,orientationEulerZYX:backupAtlas.orientationEulerZYX,source:'backup'};
}
function requestLimitCurve(atlas,bounds) {
  const key=[atlas.z,...atlas.orientation.flat(),...bounds].map(v=>Number(v.toPrecision(12))).join(',');
  if(key===limitCurveKey)return;
  limitCurveKey=key;limitCurveLines=[];limitCurvePending=true;limitCurveMessage='Checking the q₄ limit boundary…';
  const [xmin,xmax,ymin,ymax]=bounds;
  compute('q4-limit-curve',{z:atlas.z,orientation:atlas.orientation,xmin,xmax,ymin,ymax}).then(result=>{
    if(key!==limitCurveKey)return;
    limitCurveLines=result.lines;limitCurvePending=false;limitCurveMessage=result.reason||'Dashed red: q₄ = ±180° for at least one legal IK. Other IKs can remain feasible across this boundary.';publish();
  }).catch(error=>{if(key===limitCurveKey){limitCurvePending=false;limitCurveMessage='The q₄ boundary could not be computed: '+error.message;publish();}});
}
function selectMapView(view) {
  const atlas=shared.atlas;
  shared.mapView=view;
  // The default detail is a saved, independently sampled map. Restoring either
  // saved view preserves the selected pose, branch, path and playback position.
  // Other heights and orientations still require a fresh detail calculation.
  if(view==='detail'&&sameSlicePose(defaultDetailAtlas,atlas)){
    stopSliceJob();++shared.sliceVersion;shared.atlas=completedAtlas=defaultDetailAtlas;shared.mapBusy=false;
    shared.mapCompleted=defaultDetailAtlas.nx*defaultDetailAtlas.ny;shared.mapSeconds=0;
    shared.mapMessage=`Central detail loaded · ${shared.mapCompleted.toLocaleString()} saved poses.`;publish();return;
  }
  if(view==='full'&&sameSlicePose(fullAtlas,atlas)){
    stopSliceJob();++shared.sliceVersion;shared.atlas=fullAtlas;shared.mapBusy=false;
    shared.mapCompleted=fullAtlas.nx*fullAtlas.ny;shared.mapSeconds=fullAtlas.calculationSeconds||0;
    shared.mapMessage=`Full slice restored · ${shared.mapCompleted.toLocaleString()} sampled poses.`;publish();return;
  }
  calculateLiveSlice(atlas.z,atlas.orientationEulerZYX,100000,{orientation:atlas.orientation});
}
async function calculateLiveSlice(z,angles,samples,{orientation=orientationZYX(angles)}={}) {
  stopSliceJob();const version=++shared.sliceVersion,nx=samples===100000?400:samples===4000?80:20,ny=samples===100000?250:samples===4000?50:20,started=performance.now();
  const requestedView=shared.mapView,[xmin,xmax,ymin,ymax]=viewBounds(requestedView);
  const slice={plane:'xy',fixedAxis:'z',z,orientationEulerZYX:angles,orientation,nx,ny,xmin,xmax,ymin,ymax,source:'live'};
  const preservePose=sameSlicePose(shared.atlas,slice),previous=sameSlicePose(completedAtlas,slice)?completedAtlas:null;
  const workingAtlas={...slice,counts:new Array(nx*ny).fill(-1),limitCounts:new Array(nx*ny).fill(-1)};
  shared.atlas=workingAtlas;
  shared.mapBusy=true;shared.mapCompleted=0;shared.mapSeconds=0;shared.mapMessage=`Computing 0/${samples.toLocaleString()} poses in ${requestedView==='detail'?'central detail':'the full slice'} · x ∈ [${xmin}, ${xmax}], y ∈ [${ymin}, ${ymax}] m…`;
  const point=shared.target||backupAtlas.demonstrationPoint;
  const controller=new AbortController();
  const failed=error=>{
    if(version!==shared.sliceVersion)return;
    if(!preservePose){restoreBackup('Live map calculation failed: '+error.message+' Verified 100,000-pose backup restored.');return;}
    stopSliceJob();++shared.sliceVersion;shared.mapBusy=false;
    if(previous){shared.atlas=previous;shared.mapCompleted=previous.nx*previous.ny;shared.mapSeconds=previous.calculationSeconds||0;shared.mapView=previous.xmin===backupAtlas.xmin&&previous.xmax===backupAtlas.xmax&&previous.ymin===backupAtlas.ymin&&previous.ymax===backupAtlas.ymax?'full':'detail';}
    shared.mapMessage='Live map calculation failed: '+error.message+(previous?' Showing the previous sampling at the same height and orientation.':' Unsampled cells remain unresolved.');publish();
  };
  const timer=setTimeout(()=>failed(new Error('The calculation exceeded its time limit.')),samples===100000?1800000:120000);
  sliceJob={controller,timer};
  if(preservePose)publish();else selectPoint(point,{keepPath:true});
  try {
    const result=await computeSlice(slice,p=>{
      if(version!==shared.sliceVersion)return;
      if(p.reset){workingAtlas.counts.fill(-1);workingAtlas.limitCounts.fill(-1);imageCache.delete(workingAtlas);}
      if(p.counts){p.counts.forEach((v,i)=>{workingAtlas.counts[p.start+i]=v;workingAtlas.limitCounts[p.start+i]=p.limitCounts[i];});imageCache.delete(workingAtlas);}
      if(p.backend)workingAtlas.backend=p.backend;if(p.workers)workingAtlas.workers=p.workers;
      shared.mapCompleted=p.done;shared.mapMessage=p.recovery?`Verifying difficult poses ${p.recovery.done}/${p.recovery.total} with the browser solver after the Rust batch…`:`Computing ${p.done.toLocaleString()}/${p.total.toLocaleString()} poses · ${p.backend==='rust-native'?'native Rust':'parallel browser'} · ${p.workers||1} workers. Click any point for its exact IKs.`;publishProgress();
    },{signal:controller.signal});
    if(version!==shared.sliceVersion)return;
    clearTimeout(timer);sliceJob=null;shared.mapSeconds=(performance.now()-started)/1000;shared.atlas={...result,source:'live',calculationSeconds:shared.mapSeconds};completedAtlas=shared.atlas;if(requestedView==='full')fullAtlas=shared.atlas;shared.mapBusy=false;shared.mapCompleted=samples;
    shared.mapMessage=`${samples.toLocaleString()} poses in ${shared.mapSeconds.toFixed(1)} s · ${requestedView==='detail'?'central detail':'full slice'}.${result.unresolved?' '+result.unresolved+' unresolved cells.':''}`;publish();
  }catch(error){if(error.name!=='AbortError')failed(error);}
}

export function initAbbCrbLecture() {
  const hosts=[...document.querySelectorAll('[data-crb-lab],[data-crb-model]')],started=new WeakSet();
  const ensure=host=>{
    if(started.has(host))return;started.add(host);
    const task=host.dataset.crbModel?createAbbCrbViewer(host,fk):host.dataset.crbLab==='paper'?createPaperLab(host):host.dataset.crbLab==='nscs'?createNscs(host):createSliceLab(host,host.dataset.crbLab);
    Promise.resolve(task).catch(error=>{host.innerHTML='';const message=document.createElement('p');message.className='warning';message.textContent='ABB CRB demonstration could not start: '+error.message;host.append(message);console.error(error);});
  };
  const observer=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting)ensure(e.target);}),{threshold:.02});hosts.forEach(host=>observer.observe(host));
  const sync=()=>{const n=Number(location.hash.match(/slide-(\d+)/)?.[1]||1);document.querySelectorAll('#deck>.slide')[n-1]?.querySelectorAll('[data-crb-lab],[data-crb-model]').forEach(ensure);};
  sync();window.addEventListener('hashchange',sync);
}

async function createSliceLab(host,mode) {
  host.classList.add('l7-crb-lab');
  host.innerHTML=`<div class="l7-crb-panels"><div class="l7-plot l7-crb-map"><h3 data-map-title>Tool position · x-y slice</h3><svg data-slice aria-label="ABB CRB inverse-kinematic solution count in the x-y slice" role="img"></svg></div><div class="l7-stage" data-stage><div class="hud">ABB CRB 15000 · white/grey CAD · selected IK solid</div></div><aside class="l7-crb-side"><form class="l7-crb-slice-settings" data-slice-settings><div class="l7-crb-slice-fields"><label>z [m]<input data-slice-z type="number" step="any" min="-1.2" max="1.2" required></label><label>Yaw [°]<input data-yaw type="number" step="any" required></label><label>Pitch [°]<input data-pitch type="number" step="any" required></label><label>Roll [°]<input data-roll type="number" step="any" required></label></div><div class="l7-controls"><label>Map <select data-resolution><option value="400">Quick · 400 poses</option><option value="4000">Standard · 4,000 poses</option><option value="100000">Detailed · 100,000 poses</option></select></label><button class="primary" data-calculate type="submit">Calculate slice</button><button data-backup type="button">Verified default slice</button></div></form><div class="l7-controls"><label>Count <select data-count><option value="all">All real IKs</option><option value="limits">Inside joint limits</option></select></label><button data-show-all>Show all IKs</button><button data-show-one>Selected only</button></div><div class="l7-crb-legend" data-legend></div><div class="l7-controls"><button data-mode="point" class="active">Select point</button><button data-mode="draw">Draw path</button><button data-example>Example loop</button><button data-close>Close loop</button><button data-undo>Undo vertex</button><button data-clear>Clear path</button></div><div class="l7-controls"><button class="primary" data-track>Track selected IK</button><button data-compare>Compare all starts</button></div><p class="l7-status" data-status role="status">Loading the verified 100,000-pose x-y slice…</p><details data-stop-details><summary data-stop-summary>Joint limits and branch continuity</summary><pre data-limit-readout></pre><p data-stop-explanation></p></details><details><summary>Orientation and sampling</summary><pre data-orientation></pre></details><div data-comparison></div></aside></div><div class="l7-crb-bottom"><div class="l7-crb-iks" data-iks></div><div class="l7-controls l7-crb-playback"><button data-play>Play</button><button data-reset>Reset</button><input data-progress type="range" min="0" max="1" value="0" aria-label="ABB CRB path progress"><output data-frame></output></div></div>`;
  const svg=host.querySelector('[data-slice]'),status=host.querySelector('[data-status]'),iks=host.querySelector('[data-iks]');
  let viewer,map,interaction=mode==='draw'?'draw':'point',index=0,playing=false,startTime=0,trackRef=null,trackPositions=[],stroke=null,settingsRef=null,resolutionRef=null;
  const [backup,detail]=await Promise.all([data('crb-slice-xy-diverse.json'),data('crb-slice-xy-detail.json').catch(()=>null)]);backupAtlas=backup;
  defaultDetailAtlas ||= verifiedDefaultDetail(detail);
  if(!shared.atlas){shared.atlas={...backup,source:'backup'};fullAtlas=completedAtlas=shared.atlas;shared.mapCompleted=backup.nx*backup.ny;}
  const viewControls=document.createElement('div');viewControls.className='l7-controls l7-crb-map-views';
  viewControls.innerHTML='<button data-map-view="full" class="active" aria-pressed="true">Full slice</button><button data-map-view="detail" aria-pressed="false">Central detail</button>';
  host.querySelector('.l7-crb-map').insertBefore(viewControls,svg);
  const boundaryControl=document.createElement('label');boundaryControl.className='l7-crb-limit-toggle';
  boundaryControl.innerHTML='<input data-q4-boundary type="checkbox" checked> q₄ limit boundary';viewControls.append(boundaryControl);
  const boundaryNote=document.createElement('p');boundaryNote.className='l7-crb-limit-note';boundaryNote.setAttribute('data-q4-note','');host.querySelector('.l7-crb-map').append(boundaryNote);
  boundaryControl.querySelector('input').addEventListener('change',paint);
  viewControls.querySelectorAll('button').forEach(button=>button.addEventListener('click',()=>selectMapView(button.dataset.mapView)));
  viewer=await createAbbCrbViewer(host.querySelector('[data-stage]'),fk);
  function paint() {
    const atlas=shared.atlas,limited=host.querySelector('[data-count]').value==='limits';
    const mapView=shared.mapView,bounds=viewBounds(mapView);
    requestLimitCurve(atlas,bounds);
    map=plot(svg,bounds.slice(0,2),bounds.slice(2),['x [m]','y [m]']);
    const dx=(atlas.xmax-atlas.xmin)/(atlas.nx-1),dy=(atlas.ymax-atlas.ymin)/(atlas.ny-1);
    const corner=map.map(atlas.xmin-dx/2,atlas.ymax+dy/2),opposite=map.map(atlas.xmax+dx/2,atlas.ymin-dy/2);
    map.background.append(element('image',{href:atlasImage(atlas,limited),x:corner[0],y:corner[1],width:opposite[0]-corner[0],height:opposite[1]-corner[1],preserveAspectRatio:'none',style:'image-rendering:pixelated'}));
    if(boundaryControl.querySelector('input').checked)for(const line of limitCurveLines){
      map.curves.append(element('path',{d:pathD(line,map.map),fill:'none',stroke:'white','stroke-width':4.3,'stroke-dasharray':'7 5','data-q4-limit-halo':''}),element('path',{d:pathD(line,map.map),fill:'none',stroke:'#bd292c','stroke-width':2,'stroke-dasharray':'7 5','data-q4-limit-curve':''}));
    }
    boundaryNote.textContent=limitCurveMessage;host.dataset.limitCurvePending=String(limitCurvePending);host.dataset.limitCurveSegments=String(limitCurveLines.length);
    viewControls.querySelectorAll('button').forEach(button=>{const active=button.dataset.mapView===mapView;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});
    host.dataset.mapView=mapView;host.dataset.viewBounds=JSON.stringify(bounds);
    if(shared.vertices.length>1)map.curves.append(element('path',{d:pathD(shared.vertices,map.map),fill:'none',stroke:'#c5242c','stroke-width':2.6,'stroke-linejoin':'round','stroke-linecap':'round'}));
    shared.vertices.forEach((point,i)=>{if(i===0||shared.vertices.length<20){const [x,y]=map.map(...point);map.curves.append(element('circle',{cx:x,cy:y,r:i===0?5:2.5,fill:i===0?'#111':'#c5242c',stroke:'white','stroke-width':1.3}));}});
    if(trackPositions.length){const points=trackPositions.map(p=>sliceProjection(p,atlas));map.curves.append(element('path',{d:pathD(points.slice(0,index+1),map.map),fill:'none',stroke:'#17242d','stroke-width':2.4}));const [x,y]=map.map(...points[Math.min(index,points.length-1)]);map.curves.append(element('circle',{cx:x,cy:y,r:4.5,fill:'#17242d',stroke:'white','stroke-width':1.5}));}
    const stop=shared.track?.stop;
    if(stop?.position){const [x,y]=map.map(...sliceProjection(stop.position,atlas)),marker=element('g',{'data-limit-marker':'','aria-label':`q${stop.joint+1} joint limit at s ${stop.progress.toFixed(4)}`});marker.append(element('circle',{cx:x,cy:y,r:8,fill:'white',stroke:'#b7222a','stroke-width':1.5}),element('path',{d:`M${x-4},${y-4}L${x+4},${y+4}M${x-4},${y+4}L${x+4},${y-4}`,stroke:'#b7222a','stroke-width':2}),element('title',{},shared.track.reason),element('text',{x:Math.max(map.left+4,Math.min(map.left+map.width-95,x+11)),y:Math.max(map.top+14,y-9),fill:'#17242d','font-size':11,'font-weight':700,stroke:'white','stroke-width':3,'paint-order':'stroke'},`q${stop.joint+1} = ${(stop.limit*DEG).toFixed(0)}° stop`));map.curves.append(marker);}
    host.dataset.pathVertices=JSON.stringify(shared.vertices);host.dataset.pathPoints=String(shared.track?.q.length||0);
  }
  function updateRobot() {
    const atlas=shared.atlas,selected=shared.solutions[shared.selected];
    if(shared.track?.q.length){viewer.update(shared.track.q[Math.min(index,shared.track.q.length-1)]);viewer.setConfigurations([]);viewer.setGhost(shared.track.q[0]);viewer.setTrace(trackPositions.slice(0,index+1));}
    else {if(selected)viewer.update(selected.q);viewer.setGhost(null);viewer.setTrace([]);viewer.setConfigurations([...shared.visible].filter(i=>i!==shared.selected&&shared.solutions[i]).map(i=>({id:i,q:shared.solutions[i].q})));}
    viewer.setPrimaryVisible(!!shared.track?.q.length||!!selected&&shared.visible.has(shared.selected));
    viewer.setTarget(shared.target?slicePosition(shared.target,atlas):null);viewer.setPath(shared.vertices.map(p=>slicePosition(p,atlas)));
  }
  function playbackState(){const n=shared.track?.q.length||0;host.querySelector('[data-progress]').max=Math.max(1,n-1);host.querySelector('[data-progress]').value=index;host.querySelector('[data-frame]').textContent=n?`${index+1}/${n}${shared.track.s?.length?' · s = '+shared.track.s[index].toFixed(3):''}`:'';host.querySelector('[data-play]').disabled=n<2;host.querySelector('[data-reset]').disabled=n<2;host.querySelector('[data-play]').textContent=playing?'Pause':index>=n-1&&n?'Replay':'Play';host.dataset.frame=String(index);host.dataset.playing=String(playing);}
  function render() {
    const atlas=shared.atlas;
    if(trackRef!==shared.track){playing=false;index=0;trackRef=shared.track;trackPositions=(shared.track?.q||[]).map(q=>fk(q).position);}
    const settingsKey=[atlas.z,...atlas.orientationEulerZYX].join(',');
    if(settingsRef!==settingsKey){settingsRef=settingsKey;const angles=atlas.orientationEulerZYX;host.querySelector('[data-slice-z]').value=atlas.z;['yaw','pitch','roll'].forEach((name,i)=>{host.querySelector(`[data-${name}]`).value=Number((angles[i]*DEG).toFixed(6));});}
    const samples=atlas.nx*atlas.ny;
    if(resolutionRef!==shared.sliceVersion){resolutionRef=shared.sliceVersion;host.querySelector('[data-resolution]').value=String(samples);}
    host.querySelector('[data-map-title]').textContent=`Tool position · x-y slice · z = ${Number(atlas.z.toFixed(3))} m`;
    host.querySelector('[data-orientation]').textContent='Tool0 orientation in the world frame:\nRz(yaw) Ry(pitch) Rx(roll)\n'+atlas.orientation.map(r=>r.map(v=>v.toFixed(5)).join('  ')).join('\n')+`\n\n${atlas.nx} × ${atlas.ny} = ${samples.toLocaleString()} poses\n${atlas.source==='backup'?'Verified precomputed backup.':'Computed for the selected height and orientation.'}\nEach clicked pose uses full algebraic IK and FK verification.\nGrey “unresolved” cells are never counted as zero.\nCounts identify geometric branches modulo 360°.\nAdditional legal axis-6 windings are not counted again.\nLive calculations use native Rust when available; otherwise a parallel browser-worker pool.\nThe backup button cancels a running map.`;
    status.textContent=[shared.mapMessage,shared.message||'Click the slice to enumerate the IKs of that full pose.',shared.tracks.length&&shared.track?`Selected IK ${shared.selected+1}: ${shared.track.reason}`:''].filter(Boolean).join(' ');
    const stop=shared.track?.stop;
    host.dataset.stop=stop?JSON.stringify(stop):'';
    host.querySelector('[data-stop-summary]').textContent=stop?`q${stop.joint+1} limit at s = ${stop.progress.toFixed(4)} · details`:'Joint limits and branch continuity';
    host.querySelector('[data-limit-readout]').textContent=jointLimits.map((range,i)=>`q${i+1}: [${range.map(v=>(v*DEG).toFixed(0)+'°').join(', ')}]`).join('\n')+(stop?`\n\nq${stop.joint+1} last safe sample: ${(stop.lastSafe*DEG).toFixed(4)}°\nNext attempted sample: ${(stop.attempted*DEG).toFixed(4)}°\nRefined limit: ${(stop.limit*DEG).toFixed(0)}° at s = ${stop.progress.toFixed(6)}\nTool [x, y, z]: ${stop.position.map(v=>v.toFixed(6)).join(', ')} m\n|det J| at the stop: ${Math.abs(determinant(stop.boundaryQ)).toExponential(3)} m³`:'');
    host.querySelector('[data-stop-explanation]').textContent='GoFa 5 axis 6 permits ±270°. Colors count distinct geometric IKs at each pose, modulo 360°; they do not show the connectivity of a selected joint branch. '+(stop?.wrappedEquivalent?'Beyond this stop, IK can return an equivalent angle one full turn away. That keeps the pose-wise count unchanged but cannot continue this bounded joint without a 360° jump.':'Continuation keeps every joint angle unwrapped and stops at its actual limit. s is normalized distance along the tool path.');
    host.dataset.samples=String(samples);host.dataset.slicePlane='xy';host.dataset.sliceZ=String(atlas.z);host.dataset.backend=atlas.backend||'precomputed-rust';host.dataset.workers=String(atlas.workers||0);host.dataset.orientationRpy=JSON.stringify([...atlas.orientationEulerZYX].reverse());host.dataset.orientation=JSON.stringify(atlas.orientation);host.dataset.mapSource=atlas.source;host.dataset.mapSeconds=String(shared.mapSeconds||0);host.dataset.mapBusy=String(shared.mapBusy);host.dataset.mapCompleted=String(shared.mapCompleted);host.dataset.mapBounds=JSON.stringify([atlas.xmin,atlas.xmax,atlas.ymin,atlas.ymax]);
    host.dataset.ikCount=String(shared.solutions.length);host.dataset.limitIkCount=String(shared.solutions.filter(s=>s.withinLimits).length);host.dataset.selectedIk=String(shared.selected);host.dataset.resolved=String(shared.resolved);host.dataset.busy=String(shared.busy);
    iks.replaceChildren(...shared.solutions.map((solution,i)=>{
      const row=document.createElement('div');row.className='l7-crb-ik'+(i===shared.selected?' active':'')+(!solution.withinLimits?' outside':'');
      const toggle=document.createElement('input');toggle.type='checkbox';toggle.checked=shared.visible.has(i);toggle.setAttribute('aria-label',`Show IK ${i+1}`);toggle.addEventListener('change',()=>{toggle.checked?shared.visible.add(i):shared.visible.delete(i);publish();});
      const button=document.createElement('button');button.textContent=`IK ${i+1}${solution.withinLimits?'':' · outside limits'}`;button.setAttribute('aria-pressed',String(i===shared.selected));button.title=solution.q.map((q,k)=>`q${k+1}=${(q*DEG).toFixed(1)}°`).join(', ');button.addEventListener('click',()=>{shared.selected=i;shared.track=null;shared.visible.add(i);publish();});row.append(toggle,button);return row;
    }));
    const counts=[...new Set(atlas[host.querySelector('[data-count]').value==='limits'?'limitCounts':'counts'])].sort((a,b)=>a-b);
    const legend=host.querySelector('[data-legend]');legend.replaceChildren(...counts.map(count=>{const item=document.createElement('span'),swatch=document.createElement('i');swatch.style.background=color(count);item.append(swatch,document.createTextNode(count<0?(shared.mapBusy?'pending':'unresolved'):count+' IKs'));return item;}));
    host.querySelectorAll('[data-mode]').forEach(button=>button.classList.toggle('active',button.dataset.mode===interaction));
    host.querySelector('[data-track]').disabled=shared.busy||shared.vertices.length<2||!shared.solutions[shared.selected]?.withinLimits;
    host.querySelector('[data-compare]').disabled=shared.busy||shared.vertices.length<2||!shared.solutions.length;
    const comparison=host.querySelector('[data-comparison]');comparison.replaceChildren(...shared.tracks.map(track=>{const button=document.createElement('button');button.className='l7-crb-track';button.textContent=`IK ${track.index+1}: ${track.success?'complete':track.stop?`q${track.stop.joint+1} limit · s=${track.stop.progress.toFixed(3)}`:track.reason}`;button.setAttribute('aria-pressed',String(shared.track===track));button.title=track.reason;button.addEventListener('click',()=>{shared.selected=track.index;shared.track=track;publish();});return button;}));
    paint();updateRobot();playbackState();
  }
  function changePath(){shared.track=null;shared.tracks=[];shared.message=`${shared.vertices.length} path vertices at z = ${shared.atlas.z} m. Choose a starting IK, then track or compare.`;publish();}
  function pointAt(event){const p=new DOMPoint(event.clientX,event.clientY).matrixTransform(svg.getScreenCTM().inverse());return map.from(p.x,p.y);}
  function inside(p){return p[0]>=map.xr[0]&&p[0]<=map.xr[1]&&p[1]>=map.yr[0]&&p[1]<=map.yr[1];}
  svg.addEventListener('pointerdown',event=>{
    if(event.button!==0||!map)return;const point=pointAt(event);if(!inside(point))return;event.preventDefault();
    if(interaction==='point'||!shared.target){selectPoint(point);return;}
    svg.setPointerCapture(event.pointerId);stroke={id:event.pointerId,last:[event.clientX,event.clientY]};shared.vertices.push(point);changePath();
  });
  svg.addEventListener('pointermove',event=>{if(!stroke||stroke.id!==event.pointerId)return;if(Math.hypot(event.clientX-stroke.last[0],event.clientY-stroke.last[1])<9)return;const point=pointAt(event);if(!inside(point))return;stroke.last=[event.clientX,event.clientY];shared.vertices.push(point);changePath();});
  const end=()=>{stroke=null;};svg.addEventListener('pointerup',end);svg.addEventListener('pointercancel',end);
  host.querySelector('[data-count]').addEventListener('change',render);
  host.querySelectorAll('[data-mode]').forEach(button=>button.addEventListener('click',()=>{interaction=button.dataset.mode;render();}));
  host.querySelector('[data-show-all]').addEventListener('click',()=>{shared.visible=new Set(shared.solutions.map((_,i)=>i));publish();});
  host.querySelector('[data-show-one]').addEventListener('click',()=>{shared.visible=new Set([shared.selected]);publish();});
  host.querySelector('[data-clear]').addEventListener('click',()=>{shared.vertices=shared.target?[shared.target]:[];changePath();});
  host.querySelector('[data-undo]').addEventListener('click',()=>{if(shared.vertices.length>1)shared.vertices.pop();changePath();});
  host.querySelector('[data-close]').addEventListener('click',()=>{if(shared.vertices.length>2){shared.vertices.push([...shared.vertices[0]]);changePath();}});
  async function exampleLoop() {
    const spec=createCrbExampleLoop(),start=spec.startPoint,version=shared.pointVersion+1;
    await selectPoint(start);
    if(version!==shared.pointVersion)return;
    shared.vertices=spec.vertices;host.querySelector('[data-count]').value='limits';
    interaction='draw';shared.message=`${(2*spec.radius).toFixed(2)} m diameter example loop · showing IKs inside joint limits · ${shared.solutions.filter(s=>s.withinLimits).length} legal starting IKs at the current height and orientation. Compare all starts to find the feasible continuations.`;publish();
  }
  host.querySelector('[data-example]').addEventListener('click',exampleLoop);
  host.querySelector('[data-slice-settings]').addEventListener('submit',event=>{
    event.preventDefault();const z=Number(host.querySelector('[data-slice-z]').value),angles=['yaw','pitch','roll'].map(name=>Number(host.querySelector(`[data-${name}]`).value)/DEG),samples=Number(host.querySelector('[data-resolution]').value);
    if(![z,...angles].every(Number.isFinite))return;
    // Unedited angle fields display rounded degrees; retain their exact pose so
    // a height-only calculation can still match the saved default orientation.
    const sameOrientation=angles.every((angle,i)=>angle===Number((shared.atlas.orientationEulerZYX[i]*DEG).toFixed(6))/DEG);
    calculateLiveSlice(z,sameOrientation?shared.atlas.orientationEulerZYX:angles,samples,sameOrientation?{orientation:shared.atlas.orientation}:{});
  });
  host.querySelector('[data-backup]').addEventListener('click',()=>restoreBackup('Verified 100,000-pose backup restored.'));
  async function build(compare) {
    if(shared.busy)return;shared.busy=true;shared.message=compare?'Comparing every starting IK…':'Continuing the selected IK…';publish();const version=shared.pointVersion,vertices=JSON.stringify(shared.vertices),selected=shared.selected;
    try {
      const poses=shapeTargets();
      const result=await compute(compare?'compare':'follow',compare?{poses,solutions:shared.solutions}:{poses,q:shared.solutions[shared.selected].q},progress=>{if(version===shared.pointVersion){shared.message=`Compared ${progress.done}/${progress.total} starting IKs…`;publish();}});
      if(version!==shared.pointVersion||vertices!==JSON.stringify(shared.vertices)||!compare&&selected!==shared.selected)return;
      if(compare){shared.tracks=result.map(normalizedTrack);shared.track=shared.tracks.find(t=>t.index===shared.selected)||shared.tracks[0];shared.message=`${shared.tracks.filter(t=>t.success).length}/${shared.tracks.length} starting IKs complete the path. Select a result to animate it.`;}
      else {shared.track=normalizedTrack(result);shared.message=shared.track.reason;}
    }catch(error){if(version===shared.pointVersion)shared.message=error.message;}finally{if(version===shared.pointVersion){shared.busy=false;publish();}}
  }
  host.querySelector('[data-track]').addEventListener('click',()=>build(false));host.querySelector('[data-compare]').addEventListener('click',()=>build(true));
  host.querySelector('[data-play]').addEventListener('click',()=>{if(!shared.track?.q.length)return;if(index>=shared.track.q.length-1)index=0;playing=!playing;startTime=performance.now()-index*25;playbackState();});
  host.querySelector('[data-reset]').addEventListener('click',()=>{playing=false;index=0;paint();updateRobot();playbackState();});
  host.querySelector('[data-progress]').addEventListener('input',event=>{playing=false;index=Number(event.target.value);paint();updateRobot();playbackState();});
  function animate(time){if(playing&&shared.track){index=Math.max(0,Math.min(shared.track.q.length-1,Math.floor((time-startTime)/25)));paint();updateRobot();if(index===shared.track.q.length-1)playing=false;playbackState();}requestAnimationFrame(animate);}requestAnimationFrame(animate);
  window.addEventListener('hashchange',()=>{if(!host.closest('.slide')?.classList.contains('active')){playing=false;playbackState();}});
  new ResizeObserver(paint).observe(svg);listeners.add(render);render();
  if(!shared.target)await selectPoint(backup.demonstrationPoint);
  if(mode==='draw'&&shared.vertices.length===1&&backup.demonstrationPoint?.every((v,i)=>Math.abs(v-shared.target[i])<1e-9))await exampleLoop();
}

async function createNscs(host) {
  host.classList.add('l7-crb-nscs');host.innerHTML='<div class="l7-custom-panels"><div class="l7-plot"><h3>Tool path · xy projection · z and orientation vary</h3><svg data-work role="img" aria-label="Projection of ABB CRB closed task-space path"></svg></div><div class="l7-plot"><h3>Continuous joint trajectories · degrees</h3><svg data-joint role="img" aria-label="ABB CRB joint trajectories ending at a different inverse solution"></svg></div><div class="l7-stage" data-stage><div class="hud">Solid: current · transparent: starting configuration</div></div></div><div class="l7-crb-nscs-controls"><div class="l7-controls"><button class="primary" data-play>Play connection</button><button data-reset>Reset</button><button data-end>Show endpoint</button><input type="range" data-progress min="0" value="0" aria-label="Nonsingular connection progress"></div><p class="l7-status" data-status></p><div class="l7-readout" data-readout></div></div>';
  const [example,viewer]=await Promise.all([data('crb-nscs.json'),createAbbCrbViewer(host.querySelector('[data-stage]'),fk)]);
  const qs=example.q||example.qs,poses=qs.map(q=>fk(q)),points=poses.map(f=>f.position),work=host.querySelector('[data-work]'),joint=host.querySelector('[data-joint]');
  const min=(values)=>Math.min(...values),max=(values)=>Math.max(...values),bounds=values=>{const a=min(values),b=max(values),p=Math.max(.04,(b-a)*.1);return[a-p,b+p];};
  let index=0,playing=false,startTime=0;
  viewer.setPath(points);viewer.setGhost(qs[0]);host.querySelector('[data-progress]').max=qs.length-1;
  const dets=qs.map(q=>Math.abs(determinant(q))),margins=qs.map(q=>min(q.flatMap((v,k)=>[v-jointLimits[k][0],jointLimits[k][1]-v])));
  const separation=Math.hypot(...qs[0].map((v,k)=>qs.at(-1)[k]-v));
  const closure=poseError(poses[0].matrix,poses.at(-1).matrix);
  host.dataset.pathPoints=String(qs.length);host.dataset.endpointJointDistance=String(separation);host.dataset.minDet=String(min(dets));host.dataset.minLimitMargin=String(min(margins));
  function draw() {
    const wm=plot(work,bounds(points.map(p=>p[0])),bounds(points.map(p=>p[1])),['x [m]','y [m]']);
    wm.curves.append(element('path',{d:pathD(points,wm.map),fill:'none',stroke:'#c5242c','stroke-width':2}),element('path',{d:pathD(points.slice(0,index+1),wm.map),fill:'none',stroke:'#20252b','stroke-width':2.8}));
    const p=wm.map(...points[index]);wm.curves.append(element('circle',{cx:p[0],cy:p[1],r:4.5,fill:'#20252b',stroke:'#fff','stroke-width':1.5}));
    const jm=plot(joint,[0,1],[-230,190],['Path parameter s','q [°]'],false,55);
    for(let k=0;k<6;k++){jm.curves.append(element('path',{d:pathD(qs.map((q,i)=>[i/(qs.length-1),q[k]*DEG]),jm.map),fill:'none',stroke:JOINT_COLORS[k],'stroke-width':1.8}));joint.append(element('text',{x:jm.left+9+k*jm.width/6,y:39,style:`fill:${JOINT_COLORS[k]}`,class:'l7-svg-tick'},'q'+(k+1)));}
    const x=jm.map(index/(qs.length-1),0)[0];jm.curves.append(element('line',{x1:x,x2:x,y1:jm.top,y2:jm.top+jm.height,stroke:'#111','stroke-width':1.2,'stroke-dasharray':'4 3'}));
  }
  function update() {
    viewer.update(qs[index]);viewer.setTrace(points.slice(0,index+1));viewer.setTarget(points[index]);
    host.querySelector('[data-progress]').value=index;host.dataset.frame=String(index);host.dataset.playing=String(playing);
    host.querySelector('[data-play]').textContent=playing?'Pause':index===qs.length-1?'Replay':'Play connection';
    host.querySelector('[data-status]').textContent=`IK ${example.startIndex+1} → IK ${example.endIndex+1} · ${index+1}/${qs.length} samples · joint separation ${separation.toFixed(3)} rad · pose closure ${closure.position.toExponential(1)} m / ${closure.rotation.toExponential(1)} rad · whole-path |det J| > ${example.verification.wholeSegment.certifiedMinAbsDet.toFixed(5)} m³ · min limit margin ${(min(margins)*DEG).toFixed(2)}°.`;
    host.querySelector('[data-readout]').textContent=`Start q [°]: ${qs[0].map(q=>(q*DEG).toFixed(1)).join(', ')}\nNow   q [°]: ${qs[index].map(q=>(q*DEG).toFixed(1)).join(', ')}\nEnd   q [°]: ${qs.at(-1).map(q=>(q*DEG).toFixed(1)).join(', ')}`;draw();
  }
  host.querySelector('[data-play]').addEventListener('click',()=>{if(index===qs.length-1)index=0;playing=!playing;startTime=performance.now()-index*10000/(qs.length-1);update();});
  host.querySelector('[data-reset]').addEventListener('click',()=>{index=0;playing=false;update();});host.querySelector('[data-end]').addEventListener('click',()=>{index=qs.length-1;playing=false;update();});
  host.querySelector('[data-progress]').addEventListener('input',event=>{index=Number(event.target.value);playing=false;update();});
  function animate(time){if(playing){index=Math.max(0,Math.min(qs.length-1,Math.floor((time-startTime)*(qs.length-1)/10000)));if(index===qs.length-1)playing=false;update();}requestAnimationFrame(animate);}requestAnimationFrame(animate);
  window.addEventListener('hashchange',()=>{if(!host.closest('.slide')?.classList.contains('active')){playing=false;update();}});
  new ResizeObserver(draw).observe(work);new ResizeObserver(draw).observe(joint);update();
}

async function createPaperLab(host) {
  host.classList.add('l7-crb-paper');
  host.innerHTML=`<div class="l7-controls l7-crb-paper-controls"><label>Example <select data-paper-example></select></label><label><input data-paper-limits type="checkbox"> Enforce native joint limits</label><label>Start <select data-paper-start></select></label><label>Plot <select data-paper-joint>${Array.from({length:6},(_,i)=>`<option value="${i}">q${i+1}</option>`).join('')}</select></label><label>Projection <select data-paper-projection><option value="0,1">xy</option><option value="0,2">xz</option><option value="1,2">yz</option></select></label></div><div class="l7-custom-panels"><div class="l7-plot"><h3>Desired tool path and followed portion</h3><svg data-paper-work role="img" aria-label="Projection of the desired ABB CRB paper example path"></svg></div><div class="l7-plot"><h3 data-paper-joint-title>Continuous joint trajectories</h3><svg data-paper-graph role="img" aria-label="ABB CRB joint trajectories and all sampled inverse solutions"></svg></div><div class="l7-stage" data-stage><div class="hud">ABB CRB 15000 · solid: current · transparent: start</div></div></div><div class="l7-crb-paper-bottom"><div><div class="l7-controls"><button class="primary" data-paper-play>Play</button><button data-paper-reset>Reset</button><button data-paper-end>Show endpoint</button><input data-paper-progress type="range" min="0" max="1000" value="0" aria-label="Paper path progress"><output data-paper-frame></output></div><p class="l7-status" data-paper-status role="status"></p></div><div><p class="l7-crb-paper-note" data-paper-note></p><p class="l7-crb-paper-note" data-paper-outcome></p><details><summary>Coordinates and verification</summary><pre class="l7-readout" data-paper-coordinates></pre></details></div></div>`;
  const [artifact,viewer]=await Promise.all([data('crb-paper-paths.json'),createAbbCrbViewer(host.querySelector('[data-stage]'),fk)]);
  const select=host.querySelector('[data-paper-example]'),startSelect=host.querySelector('[data-paper-start]'),limitToggle=host.querySelector('[data-paper-limits]');
  const jointSelect=host.querySelector('[data-paper-joint]'),projectionSelect=host.querySelector('[data-paper-projection]');
  const work=host.querySelector('[data-paper-work]'),graph=host.querySelector('[data-paper-graph]');
  artifact.examples.forEach(example=>{const option=document.createElement('option');option.value=example.id;option.textContent=example.title;select.append(option);});
  let example=artifact.examples[0],selected=0,track,index=0,playing=false,startTime=0,positions=[];
  const framing=new Map();
  const endIndex=()=>limitToggle.checked&&track.limitStop>=0?Math.max(0,track.limitStop-1):track.q.length-1;
  const bounds=(values,padding=.08)=>{const a=Math.min(...values),b=Math.max(...values),p=Math.max(padding,(b-a)*.08);return[a-p,b+p];};
  const outcome=t=>limitToggle.checked&&t.limitStop>=0?`joint ${t.stopJoint+1} limit`:t.success?'complete':'singular continuation boundary';
  function sampleIndex(s){let lo=0,hi=endIndex();while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(track.s[mid]<=s)lo=mid;else hi=mid-1;}return lo;}
  function draw(){
    const axes=projectionSelect.value.split(',').map(Number),names=['x','y','z'];
    const xr=bounds(example.points.map(p=>p[axes[0]]),.03),yr=bounds(example.points.map(p=>p[axes[1]]),.03);
    // Keep metre scales equal without squeezing a nearly vertical MoveL into
    // a thin rectangle with overlapping ticks: expand its empty surroundings.
    const sx=xr[1]-xr[0],sy=yr[1]-yr[0];
    if(sx<.6*sy){const c=(xr[0]+xr[1])/2;xr[0]=c-.3*sy;xr[1]=c+.3*sy;}
    if(sy<.6*sx){const c=(yr[0]+yr[1])/2;yr[0]=c-.3*sx;yr[1]=c+.3*sx;}
    const wm=plot(work,xr,yr,axes.map(k=>names[k]+' [m]'));
    const projected=example.points.map(p=>axes.map(k=>p[k])),followed=positions.slice(0,index+1).map(p=>axes.map(k=>p[k]));
    wm.curves.append(element('path',{d:pathD(projected,wm.map),fill:'none',stroke:'#c5242c','stroke-width':2.5}),element('path',{d:pathD(followed,wm.map),fill:'none',stroke:'#15232b','stroke-width':3}));
    for(const [p,fill,r] of [[projected[0],'#fff',4.5],[followed.at(-1),'#15232b',4]]){const [x,y]=wm.map(...p);wm.curves.append(element('circle',{cx:x,cy:y,r,fill,stroke:'#15232b','stroke-width':1.4}));}
    const k=Number(jointSelect.value),values=example.tracks.flatMap(t=>t.q.map(q=>q[k]*DEG));
    if(limitToggle.checked)values.push(...jointLimits[k].map(v=>v*DEG));
    if(example.layers)values.push(...example.layers.flatMap(layer=>layer.q.map(q=>q[k]*DEG)));
    const jm=plot(graph,[0,1],bounds(values,8),['Path parameter s',`q${k+1} [°]`],false);
    // Every grey dot is a separately verified IK at that target pose; lines
    // show actual continued branches. Newly born roots do not become starts.
    if(example.layers){let dots='';for(const layer of example.layers)for(let i=0;i<layer.q.length;i++){if(limitToggle.checked&&!layer.legal[i])continue;const [x,y]=jm.map(layer.s,layer.q[i][k]*DEG);dots+=`M${x.toFixed(2)},${y.toFixed(2)}h.1`;}
      jm.curves.append(element('path',{d:dots,fill:'none',stroke:'#b7bec4','stroke-width':2.1,'stroke-linecap':'round'}));}
    example.tracks.forEach((t,i)=>{const stop=limitToggle.checked&&t.limitStop>=0?Math.max(1,t.limitStop):t.q.length;const points=t.q.slice(0,stop).map((q,j)=>[t.s[j],q[k]*DEG]);jm.curves.append(element('path',{d:pathD(points,jm.map),fill:'none',stroke:i===selected?'#b7222a':'#6e7880','stroke-width':i===selected?2.3:1.1,opacity:i===selected?1:.5}));});
    if(limitToggle.checked)for(const value of jointLimits[k]){const y=jm.map(0,value*DEG)[1];jm.curves.append(element('line',{x1:jm.left,x2:jm.left+jm.width,y1:y,y2:y,stroke:'#b7222a','stroke-width':1,'stroke-dasharray':'5 4'}));}
    const [x,y]=jm.map(track.s[index],track.q[index][k]*DEG);jm.curves.append(element('line',{x1:x,x2:x,y1:jm.top,y2:jm.top+jm.height,stroke:'#17242d','stroke-dasharray':'3 3'}),element('circle',{cx:x,cy:y,r:4,fill:'#b7222a',stroke:'#fff','stroke-width':1}));
  }
  function update(){
    const end=endIndex();index=Math.max(0,Math.min(index,end));
    viewer.update(track.q[index]);viewer.setTrace(positions.slice(0,index+1));viewer.setTarget(positions[index]);
    host.dataset.example=example.id;host.dataset.selectedStart=String(selected);host.dataset.frame=String(index);host.dataset.playing=String(playing);host.dataset.pathProgress=String(track.s[index]);host.dataset.enforceLimits=String(limitToggle.checked);host.dataset.outcome=outcome(track);
    host.dataset.initialIks=String(example.metrics?.initialIks??example.startSolutions.length);host.dataset.finalIks=String(example.metrics?.finalIks??example.startSolutions.length);host.dataset.mathCompletions=String(example.metrics?.mathematicalCompletions??1);host.dataset.legalCompletions=String(example.metrics?.legalCompletions??0);
    host.querySelector('[data-paper-progress]').value=Math.round(track.s[index]*1000);host.querySelector('[data-paper-progress]').max=Math.max(0,Math.round(track.s[end]*1000));
    host.querySelector('[data-paper-play]').disabled=end===0;host.querySelector('[data-paper-play]').textContent=playing?'Pause':index===end&&end?'Replay':'Play';
    host.querySelector('[data-paper-frame]').textContent=`s = ${track.s[index].toFixed(3)}`;
    const legal=withinLimits(track.q[index]);
    host.querySelector('[data-paper-status]').textContent=`${example.type==='movel'?`Start IK ${selected+1}`:'Published connection'}: ${outcome(track)}. ${legal?'Current configuration is inside joint limits.':'Current configuration exceeds joint limits.'} |det J| = ${Math.abs(determinant(track.q[index])).toExponential(2)} m³.`;
    if(example.type==='movel')host.querySelector('[data-paper-outcome]').textContent=`${example.metrics.initialIks} starting IKs (${example.metrics.initialLegalIks} legal), ${example.metrics.finalIks} final IKs. ${example.metrics.mathematicalCompletions} regular continuations; ${example.metrics.legalCompletions} also respect joint limits. Grey dots: all sampled IKs. Red: selected branch. Native stop limits: dashed lines.`;
    else host.querySelector('[data-paper-outcome]').textContent=`Same full endpoint pose, different joints. Pose closure ${example.closure.position.toExponential(1)} m; |det J| > ${example.verification.certifiedMinAbsDet.toFixed(5)} m³ throughout. This mathematical NSCS is not a joint-limit-feasible robot motion.`;
    draw();
  }
  function chooseTrack(){
    selected=Number(startSelect.value)||0;track=example.tracks[selected];index=0;playing=false;positions=track.q.map(q=>fk(q).position);
    viewer.setPath(example.points);viewer.setGhost(track.q[0]);host.querySelector('[data-paper-joint-title]').textContent=example.type==='movel'?'All IKs and continued starting branches':'Published joint-space connection';update();
  }
  function choices(){startSelect.replaceChildren(...example.tracks.map((t,i)=>{const option=document.createElement('option');option.value=i;option.textContent=example.type==='movel'?`IK ${i+1} · ${outcome(t)}`:'Published qA';return option;}));startSelect.value=String(Math.min(selected,example.tracks.length-1));chooseTrack();}
  function chooseExample(){
    example=artifact.examples.find(e=>e.id===select.value);selected=0;limitToggle.checked=example.type==='movel';jointSelect.value=example.type==='movel'?'3':'2';projectionSelect.value=example.type==='movel'?'1,2':'0,1';
    host.querySelector('[data-paper-note]').textContent=example.attribution;
    host.querySelector('[data-paper-coordinates]').textContent=example.type==='movel'?`Start p [m]: ${example.A.slice(0,3).map(r=>r[3].toFixed(6)).join(', ')}\nEnd   p [m]: ${example.end.map(v=>v.toFixed(6)).join(', ')}\nFixed world tool orientation:\n${example.A.slice(0,3).map(r=>r.slice(0,3).map(v=>v.toFixed(6)).join('  ')).join('\n')}\nPath length: ${example.metrics.pathLength.toFixed(3)} m\n${example.layers.length} full IK layers, adaptively refined continuation.\nMaximum pose residual: ${Math.max(example.metrics.maxPositionError,example.metrics.maxRotationError).toExponential(2)}.`:`Printed qA [rad]: ${example.publishedA.join(', ')}\nPrinted qB [rad]: ${example.publishedB.join(', ')}\nMaximum qB rounding correction: ${example.endpointCorrection.toExponential(3)} rad.\nThe published native q3 exceeds its upper stop.\nThe subsequent legal NSCS is a separate searched path.`;
    if(!framing.has(example.id)){
      const points=[[0,0,0],...example.points];
      for(const t of example.tracks){const stride=Math.max(1,Math.floor(t.q.length/60));for(let i=0;i<t.q.length;i+=stride){const f=fk(t.q[i]);points.push(...f.origins,f.position);}const end=fk(t.q.at(-1));points.push(...end.origins,end.position);}
      framing.set(example.id,points);
    }
    choices();viewer.framePoints(framing.get(example.id));
  }
  select.addEventListener('change',chooseExample);startSelect.addEventListener('change',chooseTrack);limitToggle.addEventListener('change',choices);jointSelect.addEventListener('change',draw);projectionSelect.addEventListener('change',draw);
  host.querySelector('[data-paper-play]').addEventListener('click',()=>{if(index>=endIndex())index=0;playing=!playing;startTime=performance.now()-track.s[index]*10000;update();});
  host.querySelector('[data-paper-reset]').addEventListener('click',()=>{playing=false;index=0;update();});host.querySelector('[data-paper-end]').addEventListener('click',()=>{playing=false;index=endIndex();update();});
  host.querySelector('[data-paper-progress]').addEventListener('input',event=>{playing=false;index=sampleIndex(Number(event.target.value)/1000);update();});
  function animate(time){if(playing){const s=Math.max(0,(time-startTime)/10000);index=sampleIndex(s);if(s>=track.s[endIndex()]){index=endIndex();playing=false;}update();}requestAnimationFrame(animate);}requestAnimationFrame(animate);
  window.addEventListener('hashchange',()=>{if(!host.closest('.slide')?.classList.contains('active')){playing=false;update();}});
  new ResizeObserver(draw).observe(work);new ResizeObserver(draw).observe(graph);chooseExample();
}
