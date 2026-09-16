import { DEFAULT_CUSTOM_PATH,CUSTOM_CUSP,analyzeCustomPath,customCriticalCurves,customDeterminant,pathVertices,sliceConfiguration,trackCustomPath } from './lecture07CustomMath.js';
import { createLecturePathPlot } from './lecture07Plots.js';
import { createCustomURDFViewer } from './lecture07CustomViewer.js';

const DEG=Math.PI/180,REVISION=new URL(import.meta.url).searchParams.get('v')||'dev';
const STORAGE='eng654-l7-urdf-shared-path-v3',analysisCache=new Map(),critical=customCriticalCurves();
// The native model reaches z = 4.509 m: include that upper lobe in Full view.
const fullCriticalBounds={x:[0,Math.max(5,Math.ceil(Math.max(...critical.workspace.flat().map(p=>p[0]))))],y:[Math.min(-4,Math.floor(Math.min(...critical.workspace.flat().map(p=>p[1])))),Math.max(4,Math.ceil(Math.max(...critical.workspace.flat().map(p=>p[1]))))]};
let sharedPath=loadPath();

export function initPathPlanningLecture(){
  const hosts=[...document.querySelectorAll('[data-path-lab],[data-path-model]')],initialized=new WeakSet();
  if(!hosts.length)return;
  const ensure=host=>{if(initialized.has(host))return;initialized.add(host);const mode=host.dataset.pathLab||host.dataset.pathModel;Promise.resolve().then(()=>createLab(host,mode)).catch(error=>fail(host,error));};
  const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting)ensure(entry.target);}),{threshold:.02,rootMargin:'120px'});
  hosts.forEach(host=>observer.observe(host));
  const sync=()=>{const n=Number(location.hash.match(/#slide-(\d+)/)?.[1]||1);document.querySelectorAll('#deck > .slide')[n-1]?.querySelectorAll('[data-path-lab],[data-path-model]').forEach(ensure);};
  sync();window.addEventListener('hashchange',sync);
}

async function createLab(host,mode){
  if(mode==='abb-irb-starts'){const {createAbbIrbStarts}=await import(`./lecture07AbbIrbLab.js?v=${REVISION}`);return createAbbIrbStarts(host);}
  if(mode==='custom-intro'){const viewer=createCustomURDFViewer(host,{compactOpacity:true});viewer.update(sliceConfiguration([-.65,2.8]));return;}
  if(mode==='square-master')return createMaster(host);
  if(mode.startsWith('abb-irb-')){const {createAbbIrbPathLab}=await import(`./lecture07AbbIrbLab.js?v=${REVISION}`);return createAbbIrbPathLab(host,mode);}
  if(mode.startsWith('custom-'))return createCustomLab(host,mode);
  throw new Error(`Unknown path-planning lab: ${mode}`);
}
function analysisFor(state){const key=JSON.stringify(state);if(!analysisCache.has(key)){if(analysisCache.size>24)analysisCache.clear();analysisCache.set(key,analyzeCustomPath(state));}return analysisCache.get(key);}
const copy=value=>JSON.parse(JSON.stringify(value));
function stamp(host,state,analysis){host.dataset.pathSignature=JSON.stringify(state);host.dataset.pathVertices=JSON.stringify(pathVertices(state));host.dataset.pathOutcomes=JSON.stringify({starts:analysis.starts.length,regular:analysis.regular.length,infeasible:analysis.infeasible.length,nonsingular:analysis.nonsingular.length,tracks:analysis.tracks.map(t=>({branch:t.branch,success:t.success,minDet:t.minDet,closure:t.success?t.closure:null,termination:t.termination}))});}

function createMaster(host){
  host.classList.add('l7-master');host.innerHTML='<div class="l7-plot"><h3>One shared task-space path · y = 0</h3><svg data-work></svg></div><aside class="l7-master-side"><div class="l7-shared-badge">Finalize once: every following comparison uses this exact path.</div><div data-ranges></div><div class="l7-controls"><button data-draw>Draw vertices</button><button data-undo disabled>Undo vertex</button></div><div class="l7-controls"><button class="primary" data-finalize>Finalize shared path</button><button data-reset>Verified example</button></div><div class="l7-readout"></div><p class="l7-status" role="status"></p></aside>';
  const ranges=host.querySelector('[data-ranges]'),readout=host.querySelector('.l7-readout'),status=host.querySelector('.l7-status'),drawButton=host.querySelector('[data-draw]'),undo=host.querySelector('[data-undo]');
  let draft=copy(sharedPath),drawing=false,drawn=[],analysis=analysisFor(draft);
  const plot=createLecturePathPlot(host.querySelector('svg'),{initialBounds:{x:[0,5],y:[-4,4]},zoomable:true,onPoint(point){if(!drawing)return;if(point[0]<0){status.textContent='Choose a nonnegative radial distance ρ.';return;}drawn.push(point.map(x=>+x.toFixed(6)));undo.disabled=false;if(drawn.length>=3){draft={vertices:copy(drawn)};refresh();}else status.textContent=`${drawn.length} vertex selected. Click at least three vertices; the last connects back to the first.`;}});
  const specs=[['rho','center ρ',.1,4.4,.01,'m'],['z','center z',-2.5,4.5,.01,'m'],['width','width',.1,2,.01,'m'],['height','height',.1,2,.01,'m'],['rotation','rotation',-180,180,1,'°']];
  specs.forEach(([key,label,min,max,step,unit])=>{const row=document.createElement('label');row.className='l7-range';row.innerHTML=`<span>${label}</span><input type="range" min="${min}" max="${max}" step="${step}"><output></output>`;const input=row.querySelector('input');input.addEventListener('input',()=>{if(draft.vertices)draft={...DEFAULT_CUSTOM_PATH};draft[key]=+input.value;drawing=false;drawButton.textContent='Draw vertices';refresh();});ranges.append(row);});
  drawButton.addEventListener('click',()=>{drawing=!drawing;drawButton.textContent=drawing?'Finish drawing':'Draw vertices';if(drawing){drawn=[];undo.disabled=true;status.textContent='Click the plot in order: the first vertex selects the starting task point. Use at least three vertices.';}else refresh();});
  undo.addEventListener('click',()=>{drawn.pop();undo.disabled=!drawn.length;if(drawn.length>=3){draft={vertices:copy(drawn)};refresh();}else status.textContent='Select at least three vertices to define a closed path.';});
  host.querySelector('[data-finalize]').addEventListener('click',()=>{if(drawing&&drawn.length<3){status.textContent='Select at least three vertices before finalizing the drawn path.';return;}sharedPath=copy(draft);try{localStorage.setItem(STORAGE,JSON.stringify(sharedPath));}catch{}window.dispatchEvent(new CustomEvent('eng654-shared-path'));stamp(host,sharedPath,analysis);status.textContent='Path saved for the following examples.';});
  host.querySelector('[data-reset]').addEventListener('click',()=>{draft={...DEFAULT_CUSTOM_PATH};drawing=false;drawn=[];drawButton.textContent='Draw vertices';refresh();});
  function refresh(){analysis=analysisFor(draft);specs.forEach(([key,,min,max,step,unit],i)=>{const row=ranges.children[i],value=draft[key]??DEFAULT_CUSTOM_PATH[key];row.querySelector('input').value=value;row.querySelector('output').textContent=`${value.toFixed(step<1?2:0)} ${unit}`;});readout.textContent=`${pathText(draft)}\nStart: ${analysis.starts.length} IKs · model cusp (${CUSTOM_CUSP[0].toFixed(4)}, ${CUSTOM_CUSP[1].toFixed(4)}) m`;status.textContent='';plot.render({curves:critical.workspace,path:analysis.workspace,vertices:pathVertices(draft),startCount:analysis.starts.length,cusp:CUSTOM_CUSP});host.dataset.draftPathSignature=JSON.stringify(draft);}
  stamp(host,sharedPath,analysisFor(sharedPath));refresh();
}

function createCustomLab(host,mode){
  host.classList.add('l7-custom-lab');host.innerHTML='<div class="l7-custom-panels"><div class="l7-plot"><h3>Shared task path · y = 0</h3><svg data-work></svg></div><div class="l7-plot"><h3>Lift = continuous joint trajectory</h3><svg data-joint></svg></div><div class="l7-stage"><div class="hud">Custom 3R · exact native URDF geometry and STL visuals</div></div></div><div class="l7-custom-controls"><div class="l7-controls"><select data-branch aria-label="Starting inverse kinematic solution"></select><button class="primary" data-play>Play</button><button data-reset>Reset</button></div><div><div class="l7-state-pills"></div><progress class="l7-progress" max="1" value="0"></progress><p class="l7-status" role="status"></p></div><div class="l7-readout"></div></div>';
  const workPlot=createLecturePathPlot(host.querySelector('[data-work]'),{overviewBounds:fullCriticalBounds}),jointPlot=createLecturePathPlot(host.querySelector('[data-joint]'),{joint:true}),viewer=createCustomURDFViewer(host.querySelector('.l7-stage'));
  const play=host.querySelector('[data-play]'),select=host.querySelector('select'),progress=host.querySelector('progress'),status=host.querySelector('.l7-status'),readout=host.querySelector('.l7-readout'),pills=host.querySelector('.l7-state-pills');
  let analysis,result=null,index=0,playing=false,startTime=0,lap=0,baseResult=null;
  const expected=mode==='custom-regular'?'regular':mode.includes('infeasible')?'infeasible':'nonsingular';
  function selectInitial(){const items=analysis[expected],skip=mode==='custom-infeasible-b'?1:0;return items[skip]||null;}
  function rebuild(){analysis=analysisFor(sharedPath);stamp(host,sharedPath,analysis);result=selectInitial();select.replaceChildren();if(!result){const option=document.createElement('option');option.value='';option.textContent=`No ${caseLabel(expected)} for this path`;select.append(option);}analysis.tracks.forEach(track=>{const option=document.createElement('option');option.value=track.branch;option.textContent=`IK ${track.branch+1} · ${outcome(track)}`;select.append(option);});select.value=result?String(result.branch):'';baseResult=result;restart();viewer.setTrace(analysis.workspace);}
  function restart(){result=baseResult;index=0;lap=0;playing=false;play.disabled=!result;play.textContent='Play';viewer.setGhost(result?sliceConfiguration(result.path[0]):null);update(0);describe();}
  select.addEventListener('change',()=>{baseResult=analysis.tracks.find(t=>String(t.branch)===select.value)||null;restart();});
  host.querySelector('[data-reset]').addEventListener('click',restart);window.addEventListener('eng654-shared-path',rebuild);
  function describe(){if(!result){status.textContent=`This shared path has no ${caseLabel(expected)}. ${summary(analysis)} Choose an available starting IK to inspect its actual trajectory, or edit the shared path in the path editor.`;return;}const details=result.success?`joint endpoint separation ${result.closure.toFixed(4)} rad`:`${result.reason}`;status.textContent=`${lap?'Lap 2: ':''}${outcome(result)} · ${details} · min sampled |det Jₚ| ${result.minDet.toExponential(2)} m³. Adaptive continuation bounds joint increments below 0.055 rad.`;}
  function update(i){index=result?Math.max(0,Math.min(i,result.path.length-1)):0;host.dataset.sample=String(index);host.dataset.lap=String(lap+1);host.dataset.selectedOutcome=result?outcome(result):'unavailable';host.dataset.selectedBranch=result?String(baseResult.branch):'';host.dataset.trackSuccess=String(!!result?.success);host.dataset.pathComplete=String(!!result&&index===result.path.length-1);if(result){const q=sliceConfiguration(result.path[index]);viewer.update(q);host.dataset.configuration=JSON.stringify(q);progress.value=index/Math.max(1,result.path.length-1);readout.textContent=`sample ${index+1}/${result.path.length}\nq₁,q₂,q₃ = ${angles(q)}\n|det Jₚ| = ${Math.abs(customDeterminant(result.path[index])).toFixed(5)} m³`;pills.textContent=`Start IK ${baseResult.branch+1} · ${lap?'second traversal':'first traversal'} · ${outcome(result)}`;}else{readout.textContent=pathText(sharedPath);pills.textContent='No trajectory substituted';progress.value=0;}
    workPlot.render({curves:critical.workspace,path:analysis.workspace,reached:result?.reached.slice(0,index+1),point:result?.reached[index],vertices:pathVertices(sharedPath),startCount:analysis.starts.length,cusp:CUSTOM_CUSP});
    jointPlot.render({curves:critical.joint,path:result?.path,reached:result?.path.slice(0,index+1),point:result?.path[index],start:result?.path[0]});
  }
  play.addEventListener('click',()=>{if(!result)return;if(playing){playing=false;play.textContent='Play';return;}if(index>=result.path.length-1){if(mode==='custom-two-laps'&&lap===0&&result.success){
      if(baseResult===analysis.nonsingular[0])result=analysis.secondLap;else result=trackCustomPath(analysis.workspace,result.path.at(-1));lap=1;index=0;describe();
    }else restart();}if(!result)return;playing=true;startTime=performance.now()-index*Math.max(22,7000/Math.max(1,result.path.length-1));play.textContent='Pause';});
  function animate(time){if(playing&&result){update(Math.max(0,Math.min(result.path.length-1,Math.floor((time-startTime)/Math.max(22,7000/Math.max(1,result.path.length-1))))));if(index===result.path.length-1){playing=false;play.textContent=mode==='custom-two-laps'&&lap===0&&result.success?'Play lap 2':'Replay';}}requestAnimationFrame(animate);}
  rebuild();requestAnimationFrame(animate);
}

function summary(a){const folds=a.infeasible.filter(t=>t.termination!=='joint-limit').length,limits=a.infeasible.length-folds;return `${a.regular.length} closed joint loop(s) · ${folds} fold termination(s)${limits?` · ${limits} joint-limit termination(s)`:''} · ${a.nonsingular.length} nonsingular change(s).`;}
function outcome(t){return !t.success?(t.termination==='joint-limit'?'joint-limit termination':'fold termination'):t.closure<1e-5?'closed joint loop':'nonsingular change';}
function caseLabel(value){return {regular:'closed joint loop',infeasible:'infeasible continuation',nonsingular:'nonsingular change'}[value];}
function angles(q){return q.map(a=>(a/DEG).toFixed(1)+'°').join(', ');}
function pathText(state){return state.vertices?`${state.vertices.length} drawn vertices · same finalized coordinates in every panel`:`center (${state.rho.toFixed(2)}, ${state.z.toFixed(2)}) m · ${state.width.toFixed(2)} × ${state.height.toFixed(2)} m · ${state.rotation.toFixed(0)}°`;}
function validPath(state){if(!state||typeof state!=='object')return false;if(state.vertices)return Array.isArray(state.vertices)&&state.vertices.length>=3&&state.vertices.length<=256&&state.vertices.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&p[0]>=0&&p[0]<20&&Math.abs(p[1])<20);return ['rho','z','width','height','rotation'].every(key=>Number.isFinite(state[key]))&&state.width>0&&state.height>0&&state.width<=10&&state.height<=10&&state.rho>=0&&state.rho<20&&Math.abs(state.z)<20;}
function loadPath(){try{const query=new URL(location.href).searchParams.get('l7path');if(query){const [rho,z,width,height,rotation]=query.split(',').map(Number),path={rho,z,width,height,rotation};if(validPath(path))return path;}const path=JSON.parse(localStorage.getItem(STORAGE)||'null');if(validPath(path))return path;}catch{}return {...DEFAULT_CUSTOM_PATH};}
function fail(host,error){host.replaceChildren();const box=document.createElement('div');box.className='warning';box.textContent=`Path-planning visualization could not start: ${error.message}`;host.append(box);console.error(error);}
