import * as THREE from 'three';

const PI=Math.PI,DEG=PI/180;
const REVISION=new URL(import.meta.url).searchParams.get('v')||'dev';
const CUSTOM={a1:1,a2:2,a3:1.5,d1:1,d2:1,d3:0,A1:PI/2,A2:PI/2,A3:0};
const CUSP=[1.3555,.4953];
const DEFAULT_PATH={rho:1.55,z:.7,width:.7,height:.7,rotation:180};
const PUMA_BRANCHES=[
  {label:'S+ E+ W+',q:[30,-35,45,-140,50,-120]},
  {label:'S+ E+ W−',q:[30,-35,45,40,-50,60]},
  {label:'S+ E− W+',q:[30,-77.350538,129.616727,-90.226068,29.498956,178.600513]},
  {label:'S+ E− W−',q:[30,-77.350538,129.616727,89.773932,-29.498956,-1.399487]},
  {label:'S− E+ W+',q:[170.431029,-139.616727,129.616727,-4.60855,47.946938,-111.486592]},
  {label:'S− E+ W−',q:[170.431029,-139.616727,129.616727,175.39145,-47.946938,68.513408]},
  {label:'S− E− W+',q:[170.431029,-97.266189,45,-31.538752,6.549211,-83.205391]},
  {label:'S− E− W−',q:[170.431029,-97.266189,45,148.461249,-6.549211,96.794609]}
].map(branch=>({...branch,q:branch.q.map(v=>v*DEG)}));

let viewerModulePromise,sharedPath=loadPath(),criticalCache;
const analysisCache=new Map();

export function initPathPlanningLecture(){
  const labs=[...document.querySelectorAll('[data-path-lab]')],models=[...document.querySelectorAll('[data-path-model]')];
  if(!labs.length&&!models.length)return;
  const initialized=new WeakSet(),ensure=(host)=>{
    if(initialized.has(host))return;initialized.add(host);
    const mode=host.dataset.pathLab||host.dataset.pathModel;
    Promise.resolve(mode==='custom-intro'?createIntroModel(host):createLab(host,mode)).catch(error=>fail(host,error));
  };
  const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting)ensure(entry.target);}),{threshold:.02,rootMargin:'120px'});
  [...labs,...models].forEach(host=>observer.observe(host));
  const sync=()=>{const n=Number(location.hash.match(/#slide-(\d+)/)?.[1]||1);document.querySelectorAll('#deck > .slide')[n-1]?.querySelectorAll('[data-path-lab],[data-path-model]').forEach(ensure);};
  sync();window.addEventListener('hashchange',sync);
}

async function viewerApi(){
  if(!viewerModulePromise)viewerModulePromise=import(`./cuspidalityLecture.js?v=${REVISION}`);
  return viewerModulePromise;
}

async function createLab(host,mode){
  if(mode==='square-master')return createMaster(host);
  if(mode.startsWith('puma-'))return createPumaLab(host,mode);
  if(mode.startsWith('custom-'))return createCustomLab(host,mode);
  throw new Error(`Unknown path-planning lab: ${mode}`);
}

async function createIntroModel(host){
  const {createModelViewer}=await viewerApi();
  await createModelViewer(host,'3r-offset',{embedded:true,showEeFrame:true});
}

async function createPumaLab(host,mode){
  host.classList.add('l7-viewer-lab');
  host.innerHTML='<div class="l7-stage"><div class="hud">PUMA 560 · wrist-center path</div></div><aside class="l7-panel"><div class="l7-controls"></div><div class="l7-plot"><h3>workspace path · x,z</h3><canvas></canvas></div><div><div class="l7-readout"></div><p class="l7-status"></p></div></aside>';
  const stage=host.querySelector('.l7-stage'),controls=host.querySelector('.l7-controls'),canvas=host.querySelector('canvas'),readout=host.querySelector('.l7-readout'),status=host.querySelector('.l7-status');
  const {createModelViewer}=await viewerApi(),viewer=await createModelViewer(stage,'puma',{embedded:true,showEeFrame:true});
  const branches=mode==='puma-numerical'?[PUMA_BRANCHES[1],PUMA_BRANCHES[7]]:mode==='puma-analytical'?PUMA_BRANCHES:[PUMA_BRANCHES[1]];
  let selected=0,playing=false,startTime=0,frame=0,track;
  const desiredMarker=sphere(.018,0xe00000),actualMarker=sphere(.014,0x2474d2);viewer.model.root.add(desiredMarker,actualMarker);
  const targetPath=buildPumaPath(viewer.model,branches[0].q),line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(targetPath),new THREE.LineBasicMaterial({color:0xe00000}));viewer.model.root.add(line);
  const pair=resizeCanvas(canvas,draw);
  const play=document.createElement('button');play.className='primary';play.textContent='Play path';play.addEventListener('click',()=>{playing=!playing;play.textContent=playing?'Pause':'Play path';if(playing)startTime=performance.now()-frame*28;});controls.append(play);
  if(branches.length>1){const select=document.createElement('select');branches.forEach((branch,i)=>{const option=document.createElement('option');option.value=i;option.textContent=mode==='puma-numerical'?`seed ${i?'B':'A'} · ${branch.label}`:branch.label;select.append(option);});select.addEventListener('change',()=>{selected=+select.value;frame=0;rebuild();});controls.append(select);}
  function rebuild(){track=trackPuma(viewer.model,targetPath,branches[selected].q);frame=0;playing=false;play.textContent='Play path';update(0);const method=mode==='puma-analytical'?'branch request':'Jacobian continuation';status.textContent=`${method} · ${branches[selected].label} · ${track.success?'closed path tracked':'continuation failed'} · max error ${track.maxError.toExponential(2)} m.`;}
  function update(i){const q=track.q[Math.min(i,track.q.length-1)]||branches[selected].q;viewer.update(q);desiredMarker.position.copy(targetPath[Math.min(i,targetPath.length-1)]);actualMarker.position.copy(viewer.model.wrist(q));frame=i;readout.textContent=`sample ${i+1}/${targetPath.length}\n${mode==='puma-analytical'?'requested branch':'initial seed'}: ${branches[selected].label}\nq₁…q₃ = ${q.slice(0,3).map(a=>(a/DEG).toFixed(1)+'°').join(', ')}`;draw();}
  function draw(){if(!pair.ready||!track)return;const {ctx,w,h}=pair,pts=targetPath.map(p=>[p.x,p.z]),xr=extent(pts.map(p=>p[0]),.15),yr=extent(pts.map(p=>p[1]),.15),map=plotMap(w,h,xr,yr,'x','z');clear(ctx,w,h);axes(ctx,map);polyline(ctx,pts,map,'#e00000',3);const achieved=track.q.slice(0,frame+1).map(q=>{const p=viewer.model.wrist(q);return[p.x,p.z];});polyline(ctx,achieved,map,'#2474d2',2.2);dot(ctx,map.toPx(...pts[Math.min(frame,pts.length-1)]),'#e00000',6);if(achieved.length)dot(ctx,map.toPx(...achieved.at(-1)),'#2474d2',4);legend(ctx,[['desired','#e00000'],['achieved','#2474d2']],map);}
  function animate(time){if(playing){const i=Math.min(targetPath.length-1,Math.floor((time-startTime)/28));update(i);if(i===targetPath.length-1){playing=false;play.textContent='Replay';}}requestAnimationFrame(animate);}rebuild();requestAnimationFrame(animate);
}

function buildPumaPath(model,q){
  const c=model.wrist(q),points=[],n=180;
  for(let i=0;i<n;i+=1){const t=2*PI*i/(n-1),u=.075*Math.cos(t),v=.05*Math.sin(t);points.push(c.clone().add(new THREE.Vector3(u,.025*Math.sin(2*t),v)));}
  return points;
}

function trackPuma(model,targets,seed){
  const qs=[seed.slice()];let q=seed.slice(),maxError=0,success=true;
  for(let i=1;i<targets.length;i+=1){const solved=solvePumaNear(model,targets[i],q);if(!solved){success=false;break;}q=solved;qs.push(q);maxError=Math.max(maxError,model.wrist(q).distanceTo(targets[i]));}
  return{q:qs,maxError,success};
}

function solvePumaNear(model,target,seed){
  const q=seed.slice();
  for(let iteration=0;iteration<28;iteration+=1){const p=model.wrist(q),e=target.clone().sub(p);if(e.length()<2e-7)return q;const h=1e-5,columns=[];for(let j=0;j<3;j+=1){const plus=q.slice(),minus=q.slice();plus[j]+=h;minus[j]-=h;columns.push(model.wrist(plus).sub(model.wrist(minus)).multiplyScalar(.5/h));}const J=new THREE.Matrix3().set(columns[0].x,columns[1].x,columns[2].x,columns[0].y,columns[1].y,columns[2].y,columns[0].z,columns[1].z,columns[2].z);if(Math.abs(J.determinant())<1e-8)return null;const dq=e.applyMatrix3(J.invert());if(dq.length()>.22)dq.setLength(.22);q[0]=wrap(q[0]+dq.x);q[1]=wrap(q[1]+dq.y);q[2]=wrap(q[2]+dq.z);}
  return model.wrist(q).distanceTo(target)<2e-5?q:null;
}

function createMaster(host){
  host.classList.add('l7-master');host.innerHTML='<div class="l7-plot"><h3>shared workspace path · ρ,z</h3><canvas></canvas></div><aside class="l7-master-side"><div class="l7-shared-badge">All case-study slides use this finalized path.</div><div data-ranges></div><div class="l7-controls"><button class="primary" data-finalize>Finalize shared path</button><button data-reset>Reset</button></div><div class="l7-readout"></div><p class="l7-status"></p></aside>';
  const canvas=host.querySelector('canvas'),ranges=host.querySelector('[data-ranges]'),readout=host.querySelector('.l7-readout'),status=host.querySelector('.l7-status'),pair=resizeCanvas(canvas,draw);let draft={...sharedPath};
  const specs=[['rho','center ρ',1,4.2,.01,'m'],['z','center z',-1,3.4,.01,'m'],['width','width',.15,1.5,.01,'m'],['height','height',.15,1.5,.01,'m'],['rotation','rotation',-180,180,1,'°']];
  specs.forEach(([key,label,min,max,step,unit])=>{const row=document.createElement('label');row.className='l7-range';row.innerHTML=`<span>${label}</span><input type="range" min="${min}" max="${max}" step="${step}"><output></output>`;const input=row.querySelector('input'),output=row.querySelector('output');input.value=draft[key];const update=()=>{draft[key]=+input.value;output.value=`${(+input.value).toFixed(step<1?2:0)} ${unit}`;refresh();};input.addEventListener('input',update);update();ranges.append(row);});
  host.querySelector('[data-finalize]').addEventListener('click',()=>{const analysis=analyzeCustomPath(draft);if(!analysis.regular.length||analysis.infeasible.length<2||!analysis.nonsingular.length){status.textContent='Not finalized: keep adjusting until the preview reports at least 1 closed, 2 obstructed, and 1 nonsingular-change lift.';return;}sharedPath={...draft};localStorage.setItem('eng654-l7-square',JSON.stringify(sharedPath));analysisCache.clear();window.dispatchEvent(new CustomEvent('eng654-shared-path'));status.textContent='Finalized. Every regular, infeasible, and nonsingular slide now uses these exact vertices.';draw();});
  host.querySelector('[data-reset]').addEventListener('click',()=>{draft={...DEFAULT_PATH};ranges.querySelectorAll('input').forEach((input,i)=>{input.value=draft[specs[i][0]];input.dispatchEvent(new Event('input'));});});
  function refresh(){const analysis=analyzeCustomPath(draft);readout.textContent=pathText(draft);status.textContent=`Preview: ${analysis.regular.length} closed lift(s) · ${analysis.infeasible.length} obstructed lift(s) · ${analysis.nonsingular.length} nonsingular change(s).`;draw();}
  function draw(){if(!pair.ready)return;drawWorkspace(pair,draft,null,0,true);}refresh();
}

async function createCustomLab(host,mode){
  host.classList.add('l7-custom-lab');host.innerHTML='<div class="l7-custom-panels"><div class="l7-plot"><h3>workspace · same finalized square</h3><canvas data-work></canvas></div><div class="l7-plot"><h3>joint-space lift · q₂,q₃</h3><canvas data-joint></canvas></div><div class="l7-stage"><div class="hud">custom_3R_new.urdf · selected lift</div></div></div><div class="l7-custom-controls"><div class="l7-controls"><button class="primary" data-play>Play</button><button data-reset>Reset</button></div><div><div class="l7-state-pills"></div><progress class="l7-progress" max="1" value="0"></progress><p class="l7-status"></p></div><div class="l7-readout"></div></div>';
  const work=host.querySelector('[data-work]'),joint=host.querySelector('[data-joint]'),stage=host.querySelector('.l7-stage'),play=host.querySelector('[data-play]'),reset=host.querySelector('[data-reset]'),progress=host.querySelector('progress'),status=host.querySelector('.l7-status'),readout=host.querySelector('.l7-readout'),pills=host.querySelector('.l7-state-pills');
  let result,index=0,playing=false,startTime=0,lap=0;
  const workPair=resizeCanvas(work,draw),jointPair=resizeCanvas(joint,draw),{createModelViewer}=await viewerApi(),viewer=await createModelViewer(stage,'3r-offset',{embedded:true,showEeFrame:true});
  function choose(){const analysis=analyzeCustomPath(sharedPath);if(mode==='custom-regular')return analysis.regular[0]||analysis.successful[0]||analysis.tracks[0];if(mode==='custom-infeasible-a')return analysis.infeasible[0]||closestToSingular(analysis.tracks,0);if(mode==='custom-infeasible-b')return analysis.infeasible[1]||closestToSingular(analysis.tracks,1);return analysis.nonsingular[0]||mostOpen(analysis.successful)||analysis.tracks[0];}
  function rebuild(){result=choose();if(!result)throw new Error('The finalized path has no IK at its starting point. Return to the master path editor.');if(mode.includes('infeasible')&&result.success){const cut=result.minIndex;result={...result,path:result.path.slice(0,cut+1),success:false,failIndex:cut};}index=0;lap=0;playing=false;play.textContent=mode==='custom-two-laps'?'Play lap 1':'Play';renderPills();update(0);describe();}
  function describe(){const closure=result.closure??Infinity,min=result.minDet??0;if(mode==='custom-regular')status.textContent=`Regular lift: workspace and joint paths close · joint closure ${closure.toFixed(3)} rad · min |det Jₚ| ${min.toFixed(3)}.`;else if(mode.includes('infeasible'))status.textContent=`Infeasible lift ${mode.endsWith('a')?'A':'B'}: continuation reaches its closest singular configuration on edge ${edgeAt(result.failIndex||result.minIndex)} · min |det Jₚ| ${min.toExponential(2)}.`;else status.textContent=`Nonsingular change of solution: workspace closure 0 · joint endpoint separation ${closure.toFixed(3)} rad · min |det Jₚ| ${min.toFixed(3)}.`;}
  function renderPills(){const start=result.path[0],end=result.path.at(-1);pills.innerHTML=`<span class="${index===0?'active':''}">start q = ${angles(start)}</span><span class="${index===result.path.length-1?'active':''}">${result.success?'end':'stop'} q = ${angles(end)}</span>`;}
  function update(i){index=Math.min(i,result.path.length-1);const q=result.path[index];viewer.update([0,...q]);progress.value=result.path.length>1?index/(result.path.length-1):0;readout.textContent=`shared path: ${pathText(sharedPath)}\n${mode==='custom-two-laps'?`lap ${lap+1} · `:''}sample ${index+1}/${result.path.length}\nq₂,q₃ = ${angles(q)}\n|det Jₚ| = ${Math.abs(detCustom([0,...q])).toFixed(4)}`;renderPills();draw();}
  function begin(){playing=!playing;if(playing){if(index>=result.path.length-1){if(mode==='custom-two-laps'&&lap===0){const second=analyzeCustomPath(sharedPath).secondLap;if(second?.path.length>1){result=second;lap=1;index=0;renderPills();status.textContent=second.success?`Lap 2 starts from lap 1's new IK and remains regular · endpoint separation ${second.closure.toFixed(3)} rad · min |det Jₚ| ${second.minDet.toFixed(3)}.`:`Lap 2 starts from lap 1's new IK, then reaches a fold on edge ${edgeAt(second.failIndex)} · min |det Jₚ| ${second.minDet.toExponential(2)}. The same command is not repeatable from the new configuration.`;}else{playing=false;status.textContent='The second traversal has no continuation from the new endpoint.';return;}}else index=0;}startTime=performance.now()-index*30;}play.textContent=playing?'Pause':mode==='custom-two-laps'&&lap===0?'Play lap 1':'Play';}
  play.addEventListener('click',begin);reset.addEventListener('click',rebuild);window.addEventListener('eng654-shared-path',rebuild);
  function animate(time){if(playing){const i=Math.min(result.path.length-1,Math.floor((time-startTime)/30));update(i);if(i===result.path.length-1){playing=false;if(mode==='custom-two-laps'&&lap===0)play.textContent='Play lap 2';else play.textContent='Replay';}}requestAnimationFrame(animate);}
  function draw(){if(workPair.ready)drawWorkspace(workPair,sharedPath,result,index,true);if(jointPair.ready)drawJoint(jointPair,result,index);}rebuild();requestAnimationFrame(animate);
}

function analyzeCustomPath(state){
  const key=JSON.stringify(state);if(analysisCache.has(key))return analysisCache.get(key);const workspace=squarePath(state),starts=solveSliceIk(workspace[0]),tracks=starts.map(seed=>trackFromSeed(workspace,seed));
  const successful=tracks.filter(t=>t.success),regular=successful.filter(t=>t.closure<.08&&t.minDet>.012),nonsingular=successful.filter(t=>t.closure>.18&&t.minDet>.008),infeasible=tracks.filter(t=>!t.success||t.minDet<=.012).sort((a,b)=>(a.failIndex??a.minIndex)-(b.failIndex??b.minIndex));
  const secondLap=nonsingular.length?trackFromSeed(workspace,nonsingular[0].path.at(-1)):null,analysis={workspace,tracks,successful,regular,nonsingular,infeasible,secondLap};analysisCache.set(key,analysis);console.info(`ENG-654 Lecture 07 shared-path lifts ${JSON.stringify({state,solutions:starts.length,regular:regular.length,infeasible:infeasible.length,nonsingular:nonsingular.length,secondLap:secondLap&&{success:secondLap.success,closure:secondLap.closure,minDet:secondLap.minDet},tracks:tracks.map(t=>({success:t.success,closure:t.closure,minDet:t.minDet,fail:t.failIndex,minIndex:t.minIndex}))})}`);return analysis;
}

function trackFromSeed(workspace,seed){
  const path=[seed.slice()];let q=seed.slice(),success=true,failIndex=null,minDet=Math.abs(detCustom([0,...q])),minIndex=0;
  for(let i=1;i<workspace.length;i+=1){const next=solveSliceNear(workspace[i],q);if(!next){const refined=refineFold(workspace[i-1],workspace[i],q);if(refined){q=refined;path.push(q);const d=Math.abs(detCustom([0,...q]));if(d<minDet){minDet=d;minIndex=i;}}success=false;failIndex=i;break;}q=next;path.push(q);const d=Math.abs(detCustom([0,...q]));if(d<minDet){minDet=d;minIndex=i;}}
  return{path,success,failIndex,minDet,minIndex,closure:success?torusDistance(path[0],path.at(-1)):Infinity};
}

function refineFold(a,b,seed){let lo=0,hi=1,best=seed.slice();for(let k=0;k<20;k+=1){const t=(lo+hi)/2,target=[a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])],q=solveSliceNear(target,best,36);if(q){best=q;lo=t;}else hi=t;}return best;}

function squarePath(state,samples=44){
  const a=state.rotation*DEG,c=Math.cos(a),s=Math.sin(a),corners=[[-.5,-.5],[.5,-.5],[.5,.5],[-.5,.5]],rotated=corners.map(([x,y])=>[state.rho+c*x*state.width-s*y*state.height,state.z+s*x*state.width+c*y*state.height]),points=[];
  for(let edge=0;edge<4;edge+=1){const p=rotated[edge],q=rotated[(edge+1)%4];for(let i=0;i<samples;i+=1){const t=i/samples;points.push([p[0]+t*(q[0]-p[0]),p[1]+t*(q[1]-p[1])]);}}points.push(rotated[0]);return points;
}

function solveSliceIk(target){
  const roots=[],seeds=Array.from({length:14},(_,i)=>-PI+2*PI*(i+.37)/14);
  for(const q2 of seeds)for(const q3 of seeds){const q=solveSliceNear(target,[q2,q3],42);if(q&&Math.abs(detCustom([0,...q]))>1e-7&&!roots.some(r=>torusDistance(r,q)<2e-3))roots.push(q);}
  return roots.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
}

function solveSliceNear(target,seed,iterations=24){
  let q=seed.slice();for(let k=0;k<iterations;k+=1){const f=sliceFk(q),e=[target[0]-f[0],target[1]-f[1]];if(Math.hypot(...e)<2e-8)return q;const h=1e-5,fx=sliceFk([q[0]+h,q[1]]),fy=sliceFk([q[0],q[1]+h]),a=(fx[0]-f[0])/h,b=(fy[0]-f[0])/h,c=(fx[1]-f[1])/h,d=(fy[1]-f[1])/h,det=a*d-b*c;if(Math.abs(det)<1e-10)return null;let u=(e[0]*d-b*e[1])/det,v=(a*e[1]-e[0]*c)/det,scale=Math.max(1,Math.hypot(u,v)/.32);u/=scale;v/=scale;q=[wrap(q[0]+u),wrap(q[1]+v)];}
  return distance2(sliceFk(q),target)<2e-5?q:null;
}

function fkCustom(q){const rows=[[CUSTOM.a1,CUSTOM.A1,CUSTOM.d1],[CUSTOM.a2,CUSTOM.A2,CUSTOM.d2],[CUSTOM.a3,CUSTOM.A3,CUSTOM.d3]],T=new THREE.Matrix4(),origins=[],axes=[];for(let i=0;i<3;i+=1){origins.push(new THREE.Vector3().setFromMatrixPosition(T));axes.push(new THREE.Vector3(0,0,1).transformDirection(T));T.multiply(dh(q[i],...rows[i]));}return{end:new THREE.Vector3().setFromMatrixPosition(T),origins,axes};}
function sliceFk(q){const p=fkCustom([0,...q]).end;return[Math.hypot(p.x,p.y),p.z];}
function detCustom(q){const k=fkCustom(q),cols=k.axes.map((z,i)=>z.clone().cross(k.end.clone().sub(k.origins[i])));return cols[0].dot(cols[1].clone().cross(cols[2]));}
function dh(theta,a,alpha,d){const c=Math.cos(theta),s=Math.sin(theta),ca=Math.cos(alpha),sa=Math.sin(alpha);return new THREE.Matrix4().set(c,-s*ca,s*sa,a*c,s,c*ca,-c*sa,a*s,0,sa,ca,d,0,0,0,1);}

function criticalData(){
  if(criticalCache)return criticalCache;const workspace=[],joint=[],n=240,tolerance=.018;
  for(let i=0;i<n;i+=1)for(let j=0;j<n;j+=1){const q=[-PI+2*PI*i/(n-1),-PI+2*PI*j/(n-1)],d=detCustom([0,...q]);if(Math.abs(d)<tolerance){joint.push(q);workspace.push(sliceFk(q));}}
  return criticalCache={workspace,joint};
}

function drawWorkspace(pair,state,result,index,showCusp){const {ctx,w,h}=pair,map=plotMap(w,h,[.4,4.8],[-1.5,3.7],'ρ','z'),critical=criticalData();clear(ctx,w,h);axes(ctx,map);scatter(ctx,critical.workspace,map,'rgba(224,0,0,.42)',1.05);const loop=squarePath(state);polyline(ctx,loop,map,'#111',2.4);if(result){const reached=loop.slice(0,Math.min(index+1,loop.length));polyline(ctx,reached,map,result.success?'#2474d2':'#e00000',3.2);dot(ctx,map.toPx(...loop[Math.min(index,loop.length-1)]),result.success?'#2474d2':'#e00000',5);}if(showCusp){cross(ctx,map.toPx(...CUSP),'#e00000',7,2.5);ctx.fillStyle='#a00000';ctx.font='700 11px Arial';ctx.fillText('cusp',...offset(map.toPx(...CUSP),8,-8));}legend(ctx,[['critical values','#e00000'],['shared square','#111']],map);}
function drawJoint(pair,result,index){const {ctx,w,h}=pair,map=plotMap(w,h,[-PI,PI],[-PI,PI],'q₂','q₃'),critical=criticalData();clear(ctx,w,h);axes(ctx,map);scatter(ctx,critical.joint,map,'rgba(224,0,0,.38)',1);if(result){polylineTorus(ctx,result.path.slice(0,index+1),map,result.success?'#2474d2':'#e00000',3);dot(ctx,map.toPx(...result.path[Math.min(index,result.path.length-1)]),result.success?'#2474d2':'#e00000',5);dot(ctx,map.toPx(...result.path[0]),'#111',4);}legend(ctx,[['det Jₚ = 0','#e00000'],['selected lift','#2474d2']],map);}

function resizeCanvas(canvas,draw){const state={canvas,ctx:canvas.getContext('2d'),w:0,h:0,ready:false};const resize=()=>{const rect=canvas.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2);if(rect.width<2||rect.height<2)return;canvas.width=Math.round(rect.width*dpr);canvas.height=Math.round(rect.height*dpr);state.ctx.setTransform(dpr,0,0,dpr,0,0);state.w=rect.width;state.h=rect.height;state.ready=true;draw();};new ResizeObserver(resize).observe(canvas);requestAnimationFrame(resize);return state;}
function plotMap(w,h,xr,yr,xLabel,yLabel){const pad={l:42,r:14,t:28,b:34},pw=Math.max(1,w-pad.l-pad.r),ph=Math.max(1,h-pad.t-pad.b);return{w,h,xr,yr,pad,pw,ph,xLabel,yLabel,toPx:(x,y)=>[pad.l+(x-xr[0])/(xr[1]-xr[0])*pw,pad.t+(yr[1]-y)/(yr[1]-yr[0])*ph]};}
function axes(ctx,m){ctx.strokeStyle='#aaa';ctx.lineWidth=1;ctx.strokeRect(m.pad.l,m.pad.t,m.pw,m.ph);ctx.fillStyle='#333';ctx.font='11px Arial';ctx.textAlign='center';ctx.fillText(m.xLabel,m.pad.l+m.pw/2,m.h-8);ctx.save();ctx.translate(12,m.pad.t+m.ph/2);ctx.rotate(-PI/2);ctx.fillText(m.yLabel,0,0);ctx.restore();ctx.textAlign='left';ctx.fillText(format(m.xr[0]),m.pad.l,m.h-20);ctx.textAlign='right';ctx.fillText(format(m.xr[1]),m.pad.l+m.pw,m.h-20);ctx.fillText(format(m.yr[1]),m.pad.l-5,m.pad.t+4);ctx.fillText(format(m.yr[0]),m.pad.l-5,m.pad.t+m.ph);}
function clear(ctx,w,h){ctx.clearRect(0,0,w,h);ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);}
function polyline(ctx,points,map,color,width=2){if(points.length<2)return;ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();points.forEach((p,i)=>{const v=map.toPx(...p);if(i)ctx.lineTo(...v);else ctx.moveTo(...v);});ctx.stroke();}
function polylineTorus(ctx,points,map,color,width){let segment=[];for(const p of points){if(segment.length&&(Math.abs(p[0]-segment.at(-1)[0])>PI||Math.abs(p[1]-segment.at(-1)[1])>PI)){polyline(ctx,segment,map,color,width);segment=[];}segment.push(p);}polyline(ctx,segment,map,color,width);}
function scatter(ctx,points,map,color,size){ctx.fillStyle=color;for(const p of points){const v=map.toPx(...p);ctx.fillRect(v[0]-size,v[1]-size,2*size,2*size);}}
function dot(ctx,p,color,r){ctx.beginPath();ctx.arc(p[0],p[1],r,0,2*PI);ctx.fillStyle=color;ctx.fill();ctx.strokeStyle='#111';ctx.lineWidth=1;ctx.stroke();}
function cross(ctx,p,color,r,width){ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(p[0]-r,p[1]-r);ctx.lineTo(p[0]+r,p[1]+r);ctx.moveTo(p[0]+r,p[1]-r);ctx.lineTo(p[0]-r,p[1]+r);ctx.stroke();}
function legend(ctx,items,map){ctx.font='10px Arial';ctx.textAlign='left';items.forEach(([name,color],i)=>{const x=map.pad.l+8+i*112,y=map.pad.t+15;ctx.fillStyle=color;ctx.fillRect(x,y-7,15,3);ctx.fillStyle='#333';ctx.fillText(name,x+20,y-3);});}
function sphere(radius,color){return new THREE.Mesh(new THREE.SphereGeometry(radius,18,12),new THREE.MeshStandardMaterial({color}));}
function extent(values,pad){const min=Math.min(...values),max=Math.max(...values),d=Math.max(1e-4,max-min);return[min-pad*d,max+pad*d];}
function format(v){return Math.abs(v)>=3?v.toFixed(1):v.toFixed(2);}
function offset(p,x,y){return[p[0]+x,p[1]+y];}
function wrap(a){return Math.atan2(Math.sin(a),Math.cos(a));}
function torusDistance(a,b){return Math.hypot(...a.map((v,i)=>wrap(v-b[i])));}
function distance2(a,b){return Math.hypot(a[0]-b[0],a[1]-b[1]);}
function angles(q){return `(${q.map(a=>(a/DEG).toFixed(1)+'°').join(', ')})`;}
function pathText(s){return `c=(${s.rho.toFixed(2)}, ${s.z.toFixed(2)}) m · ${s.width.toFixed(2)}×${s.height.toFixed(2)} m · ${s.rotation.toFixed(0)}°`;}
function edgeAt(i){return Math.min(4,Math.floor((i||0)/44)+1);}
function mostOpen(tracks){return tracks.slice().sort((a,b)=>(b.closure||0)-(a.closure||0))[0];}
function closestToSingular(tracks,skip){return tracks.slice().sort((a,b)=>a.minDet-b.minDet)[skip]||tracks[0];}
function loadPath(){try{const saved={...DEFAULT_PATH,...JSON.parse(localStorage.getItem('eng654-l7-square')||'{}')},query=new URL(location.href).searchParams.get('l7path');if(!query)return saved;const [rho,z,width,height,rotation]=query.split(',').map(Number);return[rho,z,width,height,rotation].every(Number.isFinite)?{rho,z,width,height,rotation}:saved;}catch{return{...DEFAULT_PATH}}}
function fail(host,error){host.innerHTML=`<div class="warning">Path-planning visualization could not start: ${escapeHtml(error.message)}</div>`;console.error(error);}
function escapeHtml(value){return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
