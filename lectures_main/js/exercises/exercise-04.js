import { CRB_PATH, poseAt, analyzeHeight } from './exercise-04-crb-model.js';
import { PATH_SPEC, PATH_REVISION, PLANNING_REVISION, ANGLE_OPTIONS, BRANCH_LABELS, PLANNING_POLICY, pathSamples, getStartCandidate, evaluateChoice, buildFeasibilityMap } from './exercise-04-iiwa-model.js';
import { fk as crbFK } from '../viz/abbCrbKinematics.js';
import { fk as iiwaFK } from '../viz/iiwa7Kinematics.js';
import { createAbbCrbViewer } from '../viz/abbCrbVisuals.js';
import { createIiwa7Viewer } from '../viz/redundantPlanningLecture.js';
import { emptyAnswers, createPayload, parsePayload } from './exercise-04-answers.js';
import { mountQuiz } from './exercise-04-quiz.js';

const $=selector=>document.querySelector(selector), DEG=180/Math.PI;
const draftKey='eng654-exercise04-v1', answers=emptyAnswers();
const iiwaChoiceKeys=Array.from({length:8},(_,branch)=>[1,2].map(n=>`iiwa.${branch}.${n}`)).flat();
let deferredIiwaChoices=null;
const cacheCRB=new Map(), cacheIiwa=new Map();
let busy=false, currentCRB=null, currentIiwa=null, crbSelected=0, quiz=null, feasibilityMap=null;
const responsePayload=()=>({...createPayload(answers),pathRevision:PATH_REVISION,planningRevision:PLANNING_REVISION});
document.body.dataset.pathRevision=PATH_REVISION;
document.body.dataset.planningRevision=PLANNING_REVISION;
const svgNode=(tag,attributes={},text)=>{const n=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v]of Object.entries(attributes))n.setAttribute(k,v);if(text!==undefined)n.textContent=text;return n;};
function announce(text,error=false){$('#file-status').textContent=text;$('#file-status').classList.toggle('answer-status-error',error);}
function setBusy(value){busy=value;document.body.dataset.busy=String(value);for(const selector of ['#check-all','#check-heights','#crb-build','#crb-default','#iiwa-build','[data-check-set]','[data-try]','#load-responses','#restore-iiwa-choices','[data-answer]','#crb-height','#iiwa-branch','#iiwa-angle'])document.querySelectorAll(selector).forEach(b=>b.disabled=value);quiz?.setDisabled(value);}
async function runJob(job){if(busy)return;setBusy(true);try{await job();}catch(error){announce(error.message,true);}finally{setBusy(false);}}
function updateRestoreChoices(){ $('#restore-iiwa-choices').hidden=!deferredIiwaChoices||!Object.values(deferredIiwaChoices).some(Boolean); }
function save(){delete document.body.dataset.answersVerified;try{const payload=responsePayload();if(deferredIiwaChoices)Object.assign(payload.answers,deferredIiwaChoices);localStorage.setItem(draftKey,JSON.stringify(payload));}catch{announce('Responses remain on this page. Download them: browser storage is unavailable.',true);}}
function bindAnswer(input,key){input.dataset.answer=key;input.value=answers[key]||'';input.addEventListener('input',()=>{answers[key]=input.value;if(deferredIiwaChoices&&iiwaChoiceKeys.includes(key)){deferredIiwaChoices[key]=input.value;updateRestoreChoices();}const wrap=input.closest('[data-answer-wrap]');if(wrap){delete wrap.dataset.state;wrap.querySelector('.ex04-feedback').textContent='';}save();});}
const options=(blank=false)=>(blank?'<option value="">Choose q₃</option>':'')+ANGLE_OPTIONS.map(angle=>`<option value="${angle}">${angle}°</option>`).join('');
for(let i=1;i<=3;i++){
  const row=document.createElement('div');row.className='ex04-height-answer';row.dataset.answerWrap=`crb.height.${i}`;
  row.innerHTML=`<label>Height ${i} [m]<input type="number" min="${CRB_PATH.zRange[0]}" max="${CRB_PATH.zRange[1]}" step="0.01" placeholder="Your height"></label><span class="ex04-feedback" role="status"></span>`;
  bindAnswer(row.querySelector('input'),row.dataset.answerWrap);$('#crb-answer-rows').append(row);
}
for(let branch=0;branch<8;branch++){
  const row=document.createElement('tr');row.dataset.set=branch;
  const title=document.createElement('td');title.textContent=`IK ${branch+1} · ${BRANCH_LABELS[branch]}`;row.append(title);
  for(const n of [1,2]){
    const cell=document.createElement('td');cell.dataset.answerWrap=`iiwa.${branch}.${n}`;
    cell.innerHTML=`<select aria-label="IK ${branch+1} choice ${n}">${options(true)}</select><button data-try type="button">Try</button><span class="ex04-feedback" role="status"></span>`;
    bindAnswer(cell.querySelector('select'),cell.dataset.answerWrap);
    cell.querySelector('button').addEventListener('click',()=>{const value=answers[cell.dataset.answerWrap];if(!value)return announce('Choose an angle before trying it.',true);$('#iiwa-branch').value=String(branch);$('#iiwa-angle').value=value;$('#iiwa-build').closest('.slide').scrollIntoView({behavior:'smooth'});runJob(buildIiwa);});row.append(cell);
  }
  const check=document.createElement('td');check.innerHTML=`<button data-check-set="${branch}" type="button">Check set ${branch+1}</button>`;check.querySelector('button').addEventListener('click',()=>runJob(()=>checkSet(branch)));row.append(check);$('#iiwa-answer-rows').append(row);
}
for(const input of document.querySelectorAll('textarea[data-answer]'))bindAnswer(input,input.dataset.answer);
$('#iiwa-branch').innerHTML=Array.from({length:8},(_,i)=>`<option value="${i}">IK ${i+1} · ${BRANCH_LABELS[i]}</option>`).join('');
$('#iiwa-angle').innerHTML=options(true);$('#iiwa-angle').value='';
$('#crb-height').min=CRB_PATH.zRange[0];$('#crb-height').max=CRB_PATH.zRange[1];
$('#crb-spec').textContent=`XY rectangle: centre (${CRB_PATH.center.join(', ')}) m · sides ${CRB_PATH.width} × ${CRB_PATH.height} m\nFixed world tool orientation: ${CRB_PATH.rotationExpression} (angles in radians) · ${CRB_PATH.intervals+1} pose samples`;
$('#iiwa-spec').textContent=`XY circle: centre (${PATH_SPEC.center.join(', ')}) m · radius ${PATH_SPEC.radius} m\nFixed world tool orientation: diag(1, −1, −1) · q₃ choices: ${ANGLE_OPTIONS[0]}° to ${ANGLE_OPTIONS.at(-1)}°, every 10°`;
$('#iiwa-method-description').textContent=`Analytical: ${PLANNING_POLICY.analytical} Numerical: ${PLANNING_POLICY.numerical} ${PLANNING_POLICY.validity} ${PLANNING_POLICY.acceptance}`;
quiz=mountQuiz($('#exercise04-quiz'),{answers,onChange(key,value){answers[key]=value;save();}});
function applyAnswers(values,{deferIiwa=false}={}){Object.assign(answers,values);deferredIiwaChoices=deferIiwa?Object.fromEntries(iiwaChoiceKeys.map(key=>[key,answers[key]])):null;if(deferIiwa)iiwaChoiceKeys.forEach(key=>{answers[key]='';});updateRestoreChoices();quiz.sync(answers);for(const input of document.querySelectorAll('[data-answer]'))input.value=answers[input.dataset.answer]||'';for(const wrap of document.querySelectorAll('[data-answer-wrap]')){delete wrap.dataset.state;wrap.querySelector('.ex04-feedback').textContent='';}save();}
function restorePayload(text){const metadata=JSON.parse(text),values=parsePayload(text);applyAnswers(values,{deferIiwa:true});return metadata.pathRevision!==PATH_REVISION||metadata.planningRevision!==PLANNING_REVISION;}
try{const saved=localStorage.getItem(draftKey);if(saved&&restorePayload(saved))announce('The iiwa planning checks have changed. Use Restore saved choices in Step 04 to recover your draft angles, then check them again.');}catch(error){announce(`Could not restore the browser draft: ${error.message}`,true);}
$('#restore-iiwa-choices').addEventListener('click',()=>{if(!deferredIiwaChoices)return;Object.assign(answers,deferredIiwaChoices);deferredIiwaChoices=null;for(const key of iiwaChoiceKeys){const input=document.querySelector(`[data-answer="${key}"]`),wrap=input.closest('[data-answer-wrap]');input.value=answers[key];delete wrap.dataset.state;wrap.querySelector('.ex04-feedback').textContent='';}$('#iiwa-answer-status').textContent='';updateRestoreChoices();save();announce('Saved starting angles restored. Check the choices again to verify their paths.');});
$('#download-responses').addEventListener('click',()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(responsePayload(),null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='exercise_04_responses.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);announce('Responses downloaded. Load this JSON to continue later.');});
$('#load-responses').addEventListener('change',async event=>{const file=event.target.files[0];if(!file)return;try{if(file.size>524288)throw new Error('Choose a file smaller than 512 KB.');const raw=await file.text(),metadata=JSON.parse(raw),incoming=parsePayload(raw);for(let b=0;b<8;b++)for(const n of [1,2]){const value=incoming[`iiwa.${b}.${n}`];if(value&&!ANGLE_OPTIONS.includes(Number(value)))throw new Error(`IK ${b+1}: the saved q₃ is outside the supplied selection.`);if(value)incoming[`iiwa.${b}.${n}`]=String(Number(value));}applyAnswers(incoming);announce(metadata.pathRevision!==PATH_REVISION||metadata.planningRevision!==PLANNING_REVISION?'Responses loaded from an earlier path or planning revision: check every choice again.':'Responses loaded. Click Check all responses to recompute their validity.');}catch(error){announce(error.message,true);}event.target.value='';});
new ResizeObserver(entries=>document.body.style.setProperty('--answer-toolbar-height',`${entries[0].target.getBoundingClientRect().height}px`)).observe($('.answer-toolbar'));

function pathPlot(svg,points){
  let reached=[],current=null;
  function draw(){const w=svg.clientWidth,h=svg.clientHeight;if(w<10||h<10)return;svg.setAttribute('viewBox',`0 0 ${w} ${h}`);svg.replaceChildren();const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]),xmin=Math.min(...xs)-.04,xmax=Math.max(...xs)+.04,ymin=Math.min(...ys)-.04,ymax=Math.max(...ys)+.04,scale=Math.min((w-95)/(xmax-xmin),(h-95)/(ymax-ymin)),pw=scale*(xmax-xmin),ph=scale*(ymax-ymin),left=55+(w-95-pw)/2,top=30+(h-95-ph)/2;
    const X=x=>left+(x-xmin)*scale,Y=y=>top+ph-(y-ymin)*scale;
    svg.append(svgNode('rect',{width:w,height:h,fill:'#fff'}));
    for(let i=0;i<=4;i++){const x=xmin+(xmax-xmin)*i/4,y=ymin+(ymax-ymin)*i/4;svg.append(svgNode('line',{x1:X(x),x2:X(x),y1:top,y2:top+ph,stroke:'#e3e3e3'}),svgNode('text',{x:X(x),y:top+ph+21,'text-anchor':'middle','font-size':11},x.toFixed(2)),svgNode('line',{x1:left,x2:left+pw,y1:Y(y),y2:Y(y),stroke:'#e3e3e3'}),svgNode('text',{x:left-8,y:Y(y)+4,'text-anchor':'end','font-size':11},y.toFixed(2)));}
    svg.append(svgNode('rect',{x:left,y:top,width:pw,height:ph,fill:'none',stroke:'#777'}),svgNode('text',{x:left+pw/2,y:top+ph+41,'text-anchor':'middle','font-size':12},'x [m]'),svgNode('text',{transform:`translate(${left-40} ${top+ph/2}) rotate(-90)`,'text-anchor':'middle','font-size':12},'y [m]'));
    svg.dataset.followedSamples=reached.length;const line=(list,color,dash)=>{if(list.length>1)svg.append(svgNode('path',{'data-path':dash?'supplied':'followed',d:list.map((p,i)=>`${i?'L':'M'}${X(p[0])},${Y(p[1])}`).join(' '),fill:'none',stroke:color,'stroke-width':2.5,'stroke-dasharray':dash||'','stroke-linejoin':'round'}));};
    line(points,'#777','5 3');line(reached,'#d00');const start=points[0];svg.append(svgNode('circle',{cx:X(start[0]),cy:Y(start[1]),r:4,fill:'#fff',stroke:'#111','stroke-width':1.5}),svgNode('text',{x:X(start[0])+8,y:Y(start[1])-10,'font-size':11},'start'));
    if(current)svg.append(svgNode('circle',{cx:X(current[0]),cy:Y(current[1]),r:5,fill:'#d00'}));
    svg.append(svgNode('text',{x:15,y:18,'font-size':11,fill:'#444'},'Grey: supplied path · red: followed path'));
  }new ResizeObserver(draw).observe(svg);draw();return{update(list,point){reached=list;current=point;draw();}};
}
const crbPlot=pathPlot($('#crb-plot'),CRB_PATH.verticesXY),iiwaPlot=pathPlot($('#iiwa-plot'),pathSamples().map(x=>x.p));
let crbViewer,iiwaViewer;
function playback(host,onFrame){let samples=[],playing=false,index=0,frameId=0,started=0;const play=host.querySelector('[data-play]'),reset=host.querySelector('[data-reset]'),scrub=host.querySelector('[data-scrub]'),output=host.querySelector('[data-readout]');
  function stop(){playing=false;cancelAnimationFrame(frameId);host.dataset.playing='false';play.textContent=index===samples.length-1?'Replay':'Play';}
  function draw(){const item=samples[index];scrub.value=samples.length>1?index/(samples.length-1):0;host.dataset.frame=index;host.dataset.progress=item?.s??0;output.textContent=item?`s = ${item.s.toFixed(3)} · q = ${item.q.map(x=>(x*DEG).toFixed(1)).join(', ')}°`:'';if(item)onFrame(item,samples.slice(0,index+1));play.textContent=playing?'Pause':index===samples.length-1?'Replay':'Play';}
  function tick(now){if(!playing)return;index=Math.min(samples.length-1,Math.floor((now-started)/9000*(samples.length-1)));draw();if(index<samples.length-1)frameId=requestAnimationFrame(tick);else stop();}
  play.addEventListener('click',()=>{if(playing){stop();return;}if(samples.length<2)return;if(index===samples.length-1)index=0;playing=true;host.dataset.playing='true';started=performance.now()-9000*index/(samples.length-1);frameId=requestAnimationFrame(tick);});
  reset.addEventListener('click',()=>{stop();index=0;draw();});scrub.addEventListener('input',()=>{stop();index=Math.round(Number(scrub.value)*(samples.length-1));draw();});
  return{stop,set(next){stop();samples=next||[];index=0;play.disabled=samples.length<2;reset.disabled=scrub.disabled=!samples.length;draw();},get samples(){return samples;}};
}
const crbPlayback=playback($('#crb-playback'),(item,history)=>{if(!crbViewer)return;crbViewer.update(item.q);crbViewer.setTarget(item.p);crbViewer.setTrace(history.map(s=>s.p));crbPlot.update(history.map(s=>s.p),item.p);});
const iiwaPlayback=playback($('#iiwa-playback'),(item,history)=>{if(!iiwaViewer)return;iiwaViewer.update(item.q);iiwaViewer.setAchieved(history.map(s=>s.p));iiwaPlot.update(history.map(s=>s.p),item.p);});
document.addEventListener('visibilitychange',()=>{if(document.hidden){crbPlayback.stop();iiwaPlayback.stop();}});
async function crbResult(z,onProgress=()=>{}){const key=z.toFixed(6);if(!cacheCRB.has(key)){const promise=analyzeHeight(z,onProgress);cacheCRB.set(key,promise);promise.catch(()=>cacheCRB.delete(key));}const result=await cacheCRB.get(key);onProgress({percent:100,phase:'complete'});return result;}
async function iiwaResult(branch,angle,onProgress=()=>{}){const key=`${PATH_REVISION}/${PLANNING_REVISION}/${branch}/${angle}`;if(!cacheIiwa.has(key)){const promise=evaluateChoice(branch,angle,{onProgress});cacheIiwa.set(key,promise);promise.catch(()=>cacheIiwa.delete(key));}return cacheIiwa.get(key);}
function selectCRB(index){if(!currentCRB)return;crbSelected=index;const track=currentCRB.tracks[index];for(const b of $('#crb-branches').children)b.setAttribute('aria-pressed',String(Number(b.dataset.branch)===index));
  const samples=track.q.map((q,i)=>({q,s:track.s[i],p:crbFK(q).position}));crbViewer.setPrimaryVisible(!!samples.length);crbViewer.setGhost(track.start.q);crbPlayback.set(samples);
  $('#crb-status').textContent=`Height ${currentCRB.z.toFixed(3)} m: ${currentCRB.completeCount} complete paths / ${currentCRB.legalStartCount} legal starts / ${currentCRB.geometricStartCount} geometric starting IKs.\n${track.label}: ${track.complete?'complete path':track.reason||'stopped'}.`;
  $('#crb-scene').dataset.selectedBranch=index;$('#crb-scene').dataset.complete=String(track.complete);$('#crb-scene').dataset.completeCount=currentCRB.completeCount;frameCRB();
}
function frameCRB(){if(!currentCRB||!crbViewer)return;const points=[[0,0,0],...CRB_PATH.verticesXY.map(p=>[...p,currentCRB.z])],track=currentCRB.tracks[crbSelected];for(let i=0;i<(track?.q.length||0);i+=20){const f=crbFK(track.q[i]);points.push(...f.origins,f.position);}if($('#crb-all').checked)for(const root of currentCRB.solutions){const f=crbFK(root.q);points.push(...f.origins,f.position);}crbViewer.framePoints(points);}
function showCRBStarts(){if(!currentCRB||!crbViewer)return;crbViewer.setConfigurations($('#crb-all').checked?currentCRB.solutions.map((root,id)=>({id,q:root.q})):[]);frameCRB();}
async function buildCRB(){crbPlayback.set([]);const z=Number($('#crb-height').value);if(!$('#crb-height').value)throw new Error('Enter a height.');$('#crb-status').textContent='Enumerating every pose and following every starting IK…';currentCRB=await crbResult(z,event=>{$('#crb-progress').value=event.percent/100;$('#crb-status').textContent=`${event.phase==='continue'?'Following starting IKs':'Enumerating IKs along the path'} · ${Math.round(event.percent)}%`;});
  $('#crb-branches').replaceChildren();for(const track of currentCRB.tracks){const button=document.createElement('button');button.dataset.branch=track.index;button.className=track.complete?'complete':'stopped';button.textContent=track.label;const small=document.createElement('small');small.textContent=track.complete?'complete':track.start.withinLimits?'stops':'illegal start';button.append(small);button.addEventListener('click',()=>selectCRB(track.index));$('#crb-branches').append(button);}
  crbViewer.setPath(currentCRB.poses.map(T=>T.slice(0,3).map(row=>row[3])));crbViewer.setTrace([]);showCRBStarts();
  if(currentCRB.tracks.length)selectCRB(Math.min(crbSelected,currentCRB.tracks.length-1));else{crbViewer.setPrimaryVisible(false);crbViewer.setGhost(null);crbPlot.update([],null);$('#crb-status').textContent='No starting IK exists at this height.';}
  if(!currentCRB.resolved)$('#crb-status').textContent+='\nSome IK enumerations were unresolved. This calculation cannot certify a height.';
}
function showIiwaResult(){if(!currentIiwa){previewIiwa();return;}const method=$('#iiwa-method').value,result=currentIiwa?.[method];iiwaPlayback.set(result?.samples||[]);iiwaViewer?.setGhost(currentIiwa?.start?.q||null);if(!result?.samples.length){iiwaViewer?.update(currentIiwa?.start?.q||null);iiwaViewer?.setAchieved([]);iiwaPlot.update([],null);}if(!currentIiwa)return;
  $('#iiwa-scene').dataset.accepted=String(currentIiwa.accepted);$('#iiwa-scene').dataset.method=method;
  $('#iiwa-status').textContent=`IK ${currentIiwa.branch+1}, starting q₃ = ${currentIiwa.angleDegrees}°\nAnalytical: ${currentIiwa.analytical.complete?'complete':currentIiwa.analytical.reason}. Numerical: ${currentIiwa.numerical.complete?'complete':currentIiwa.numerical.reason}.`;
  if(result?.complete)$('#iiwa-status').textContent+=`\n${method}: minimum joint margin ${(result.minLimitMargin*DEG).toFixed(2)}° · minimum scaled σ(J) ${result.minSigma.toFixed(4)} · max pose error ${result.maxPoseError.toExponential(1)}.`;
}
function previewIiwa(){currentIiwa=null;iiwaPlayback.set([]);renderMaps();if($('#iiwa-angle').value===''){iiwaViewer?.update(Array(7).fill(0));iiwaViewer?.setGhost(null);iiwaViewer?.setAchieved([]);iiwaPlot.update([],null);$('#iiwa-scene').dataset.accepted='false';$('#iiwa-status').textContent='Choose an IK set and a starting q₃ from the first map column or the angle menu.';return;}const branch=Number($('#iiwa-branch').value),angle=Number($('#iiwa-angle').value),root=getStartCandidate(branch,angle);iiwaViewer?.update(root?.q||null);iiwaViewer?.setGhost(null);iiwaViewer?.setAchieved([]);iiwaPlot.update([],root?iiwaFK(root.q).p:null);$('#iiwa-scene').dataset.accepted='false';$('#iiwa-status').textContent=`IK ${branch+1}, q₃ = ${angle}°: ${root?.valid?'the starting IK is legal; calculate both planners to check the entire path':root?'this starting configuration exceeds a joint limit or fails the rank check':'no real root on this chart'}.`;}
async function buildIiwa(){if($('#iiwa-angle').value==='')throw new Error('Choose a starting q₃ before calculating the planners.');renderMaps();iiwaPlayback.set([]);$('#iiwa-status').textContent='Calculating both planners from the chosen start…';currentIiwa=await iiwaResult(Number($('#iiwa-branch').value),Number($('#iiwa-angle').value),event=>{$('#iiwa-progress').value=(event.planner==='numerical'?.5:0)+.5*Number(event.progress);});$('#iiwa-progress').value=1;showIiwaResult();}
function feedback(key,correct,text){const wrap=document.querySelector(`[data-answer-wrap="${key}"]`);wrap.dataset.state=correct===null?'pending':correct?'correct':'incorrect';wrap.querySelector('.ex04-feedback').textContent=text;}
async function checkHeights(){let good=0;const values=[1,2,3].map(i=>answers[`crb.height.${i}`].trim());for(let i=0;i<3;i++){const key=`crb.height.${i+1}`,z=Number(values[i]);if(!values[i]||!Number.isFinite(z)||z<CRB_PATH.zRange[0]||z>CRB_PATH.zRange[1]){feedback(key,false,`Enter a height from ${CRB_PATH.zRange.join(' to ')} m.`);continue;}if(values.some((v,j)=>j!==i&&v&&Math.abs(Number(v)-z)<.01-1e-9)){feedback(key,false,'Choose heights at least 0.01 m apart.');continue;}feedback(key,null,'Calculating every starting path…');const result=await crbResult(z);const correct=result.resolved&&result.completeCount>=6;feedback(key,correct,result.resolved?`${result.completeCount} complete paths; ${result.legalStartCount} legal starting IKs. ${correct?'Verified.':'At least six complete paths are required.'}`:'IK enumeration unresolved; this height is not certified.');if(correct)good++;}$('#height-status').textContent=`${good} / 3 heights verified.`;return good===3;}
async function checkSet(branch){const values=[1,2].map(n=>answers[`iiwa.${branch}.${n}`]);let good=0;for(let i=0;i<2;i++){const key=`iiwa.${branch}.${i+1}`,value=values[i];if(!value||!ANGLE_OPTIONS.includes(Number(value))){feedback(key,false,'Choose a listed angle.');continue;}if(values[0]&&values[1]&&Number(values[0])===Number(values[1])){feedback(key,false,'Choose two different starting angles.');continue;}feedback(key,null,'Checking analytical and numerical paths…');const result=await iiwaResult(branch,Number(value));feedback(key,result.accepted,`Analytical: ${result.analytical.complete?'complete':result.analytical.reason}.\nNumerical: ${result.numerical.complete?'complete':result.numerical.reason}.`);if(result.accepted)good++;}$('#iiwa-answer-status').textContent=`IK set ${branch+1}: ${good} / 2 choices complete with at least one planner.`;return good===2;}
$('#check-heights').addEventListener('click',()=>runJob(checkHeights));
$('#check-all').addEventListener('click',()=>runJob(async()=>{const heightOK=await checkHeights();let sets=0;for(let b=0;b<8;b++){announce(`Checking iiwa set ${b+1} of 8…`);if(await checkSet(b))sets++;}const quizResult=quiz.checkAll();announce(`${heightOK?'All three CRB heights verified':'CRB height responses need attention'}. ${sets} / 8 iiwa sets verified. ${quizResult.passed} / ${quizResult.total} questions correct. Written explanations require instructor review.`);document.body.dataset.answersVerified=String(heightOK&&sets===8&&quizResult.passed===quizResult.total);}));
$('#crb-build').addEventListener('click',()=>runJob(buildCRB));$('#crb-default').addEventListener('click',()=>{$('#crb-height').value=CRB_PATH.defaultZ;runJob(buildCRB);});$('#crb-all').addEventListener('change',showCRBStarts);
$('#iiwa-branch').addEventListener('change',previewIiwa);$('#iiwa-angle').addEventListener('change',previewIiwa);
$('#iiwa-build').addEventListener('click',()=>runJob(buildIiwa));$('#iiwa-method').addEventListener('change',showIiwaResult);
function mapGeometry(svg){
  const width=Math.max(360,svg.clientWidth||720),height=320,left=61,right=19,top=23,bottom=49;
  return{width,height,left,top,pw:width-left-right,ph:height-top-bottom};
}
function renderMaps(){
  const host=$('#iiwa-feasibility-maps');if(!feasibilityMap)return;
  const all=$('#iiwa-show-all-maps').checked,selectedBranch=Number($('#iiwa-branch').value),selectedAngle=$('#iiwa-angle').value;
  host.dataset.showAll=String(all);host.replaceChildren();
  const branches=all?Array.from({length:8},(_,i)=>i):[selectedBranch];
  for(const branch of branches){
    const card=document.createElement('div');card.className='ex04-map-card';card.dataset.mapBranch=branch;
    const title=document.createElement('h4');title.textContent=`IK ${branch+1} · ${BRANCH_LABELS[branch]}`;
    const svg=svgNode('svg',{'aria-label':`IK ${branch+1}: path progress s versus redundant angle q3`,'data-feasibility-map':branch,role:'img',tabindex:'0'});
    card.append(title,svg);host.append(card);
    const {width,height,left,top,pw,ph}=mapGeometry(svg),n=feasibilityMap.samples.length,rows=feasibilityMap.angles.length;
    const first=feasibilityMap.angles[0]*DEG,last=feasibilityMap.angles.at(-1)*DEG;
    const X=s=>left+s*pw,Y=deg=>top+ph-(deg-first)/(last-first)*ph;
    svg.setAttribute('viewBox',`0 0 ${width} ${height}`);svg.dataset.sampleCount=n;svg.dataset.angleCount=rows;
    svg.append(svgNode('rect',{width,height,fill:'#fff'}));
    for(let k=0;k<=4;k++){
      const value=k/4;svg.append(svgNode('line',{x1:X(value),x2:X(value),y1:top,y2:top+ph,stroke:'#ececec'}),svgNode('text',{x:X(value),y:top+ph+21,'text-anchor':'middle','font-size':11},value.toFixed(2)));
    }
    for(const value of [first,-90,0,90,last])svg.append(svgNode('line',{x1:left,x2:left+pw,y1:Y(value),y2:Y(value),stroke:'#ececec'}),svgNode('text',{x:left-9,y:Y(value)+4,'text-anchor':'end','font-size':11},`${Math.round(value)}`));
    svg.append(svgNode('rect',{x:left,y:top,width:pw,height:ph,fill:'none',stroke:'#777'}),svgNode('rect',{x:left-4,y:top-4,width:8,height:ph+8,fill:'#111',opacity:'.07','data-start-column':'true'}));
    const dots=document.createDocumentFragment(),radius=Math.max(.7,Math.min(1.85,pw/(n-1)*.32,ph/(rows-1)*.3));
    for(let k=0;k<n;k++)for(let row=0;row<rows;row++){
      const cell=feasibilityMap.cells[k]?.[row]?.[branch],s=feasibilityMap.samples[k].s??k/(n-1),angle=feasibilityMap.angles[row]*DEG;
      dots.append(svgNode('circle',{cx:X(s),cy:Y(angle),r:radius,fill:cell?.valid?'#39834d':'#c3c6c8','data-map-k':k,'data-map-row':row,'data-valid':String(!!cell?.valid)}));
    }
    svg.append(dots,svgNode('text',{x:left+pw/2,y:height-8,'text-anchor':'middle','font-size':12},'Path progress s'),svgNode('text',{transform:`translate(16 ${top+ph/2}) rotate(-90)`,'text-anchor':'middle','font-size':12},'Redundant q₃ [°]'));
    if(selectedAngle!==''&&branch===selectedBranch)svg.append(svgNode('circle',{cx:X(0),cy:Y(Number(selectedAngle)),r:5,fill:'none',stroke:'#111','stroke-width':2,'data-selected-start':'true'}));
    function inspect(k,row){
      if(busy)return;
      const angle=Math.round(feasibilityMap.angles[row]*DEG),cell=feasibilityMap.cells[k]?.[row]?.[branch],s=feasibilityMap.samples[k].s??k/(n-1);
      if(k===0){$('#iiwa-branch').value=String(branch);$('#iiwa-angle').value=String(angle);previewIiwa();}
      $('#iiwa-map-status').textContent=`IK ${branch+1} · s = ${s.toFixed(3)} · q₃ = ${angle}°: ${cell?.valid?'valid at this individual pose':'no valid IK at this individual pose'}.${k===0?' Starting angle selected; calculate both planners to test the complete path.':' The selected starting angle has not changed.'}`;
      host.dataset.inspectedBranch=branch;host.dataset.inspectedSample=k;host.dataset.inspectedRow=row;
    }
    svg.addEventListener('click',event=>{
      const matrix=svg.getScreenCTM();if(!matrix)return;const p=new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix.inverse());
      if(p.x<left-10||p.x>left+pw+5||p.y<top-5||p.y>top+ph+5)return;
      const dot=event.target.closest('[data-map-k][data-map-row]');
      const k=dot?Number(dot.dataset.mapK):Math.max(0,Math.min(n-1,Math.round((p.x-left)/pw*(n-1)))),row=dot?Number(dot.dataset.mapRow):Math.max(0,Math.min(rows-1,Math.round((1-(p.y-top)/ph)*(rows-1))));inspect(k,row);
    });
    svg.addEventListener('keydown',event=>{
      if(!['ArrowUp','ArrowDown','Home','End'].includes(event.key)||busy)return;event.preventDefault();
      let row=selectedAngle===''?Math.floor(rows/2):feasibilityMap.angles.findIndex(a=>Math.abs(a*DEG-Number(selectedAngle))<1e-6);
      row=event.key==='Home'?0:event.key==='End'?rows-1:Math.max(0,Math.min(rows-1,row+(event.key==='ArrowUp'?1:-1)));inspect(0,row);
      host.querySelector(`[data-feasibility-map="${branch}"]`)?.focus({preventScroll:true});
    });
  }
}
async function initializeMaps(){
  feasibilityMap=await buildFeasibilityMap({onProgress:progress=>{$('#iiwa-map-progress').value=progress;$('#iiwa-map-status').textContent=`Calculating individual pose feasibility · ${Math.round(progress*100)}%`;}});
  $('#iiwa-map-progress').value=1;renderMaps();document.body.dataset.mapReady='true';
  $('#iiwa-map-status').textContent=`${feasibilityMap.samples.length} path poses × ${feasibilityMap.angles.length} redundant angles for each of eight IK sets. Choose your own starting q₃ at s = 0.`;
}
$('#iiwa-show-all-maps').addEventListener('change',renderMaps);
let mapResizeWidth=0;new ResizeObserver(entries=>{const width=entries[0].contentRect.width;if(Math.abs(width-mapResizeWidth)>1){mapResizeWidth=width;renderMaps();}}).observe($('#iiwa-feasibility-maps'));

async function initialize(){setBusy(true);try{[crbViewer,iiwaViewer]=await Promise.all([createAbbCrbViewer($('#crb-scene'),crbFK),createIiwa7Viewer($('#iiwa-scene'))]);iiwaViewer.setDesired(pathSamples().map(s=>s.p));previewIiwa();await Promise.all([buildCRB(),initializeMaps()]);document.body.dataset.ready='true';}catch(error){announce(`Could not initialize an exercise tool: ${error.message}`,true);document.body.dataset.error=error.message;}finally{setBusy(false);}}
initialize();
