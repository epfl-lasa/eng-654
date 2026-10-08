import './math.js';
import './dh-model.js';
import './dh-measurements.js';
import './dh-drag.js';
import './dh-robots.js';
import { create } from './dh-viewer.js';

const M=window.DHModel,R=window.DHRobots,$=s=>document.querySelector(s);
const keys=['theta','d','alpha','a'],symbols={theta:'θ',d:'d',alpha:'α',a:'a'};
const clean=v=>Math.abs(v)<1e-9?0:v;
const format=(v,d=4)=>String(Number(clean(v).toFixed(d)));
const vector=v=>`(${v.map(n=>format(n,3)).join(', ')})`;
function expression(v) {
  if(Math.abs(v)<1e-9)return '0';
  for(const denominator of [1,2,4,6]) {
    const numerator=Math.round(v/Math.PI*denominator);
    if(Math.abs(v-numerator*Math.PI/denominator)<1e-8) {
      const head=numerator===-1?'-pi':numerator===1?'pi':`${numerator}*pi`;
      return denominator===1?head:`${head}/${denominator}`;
    }
  }
  return String(clean(v));
}
function parse(text) {
  if(!text.trim())throw Error('Enter a value.');
  const n=window.KinematicsMath.evaluate(window.KinematicsMath.parse(text));
  if(!Number.isFinite(n))throw Error('Use a finite number or an expression such as -pi/2.');return n;
}
let model,state,viewer,request=0,animation=null,guidePage=0,measurementOptionsKey='',offsetDisplay=null,lastSceneTask='';
function hideHint(){ $('#hint-text').hidden=true;$('#scene-hint').hidden=true;['#hint','#scene-hint-toggle'].forEach(selector=>{$(selector).textContent='Hint';$(selector).setAttribute('aria-pressed','false');});if(state)state.hintVisible=false; }
function say(text,success=false) {$('#feedback').textContent=text;$('#feedback').hidden=!text;$('#feedback').classList.toggle('success',success);if(text)hideHint();}
function status(text,kind='') {$('#table-status').textContent=text;$('#table-status').className='table-status '+kind;}
function stop() {if(animation!==null)cancelAnimationFrame(animation);animation=null;$('#scene-transition').hidden=true;$('#play-motion').textContent='▶ Preview';const button=$('#play-joint');if(button)button.textContent='▶ Move joint';if(state?.transition){state.transition=null;state.sceneOpacity=1;state.preview=100;$('#next').hidden=!state.pending;renderScene();}}
function selectPane(name) {document.body.dataset.mobileView=name;document.querySelectorAll('[data-pane-button]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.paneButton===name));}
const compactMedia=matchMedia('(max-width:760px), (max-width:1150px) and (max-height:650px)');
const compact=()=>compactMedia.matches;
function chosenAxes() {return model.frames.map(f=>`${f.axis}:${f.axisSign || 1}`);}
function candidates(row) {const n=model.normals[row],z=model.axes[Math.min(row,model.axes.length-1)];return [n.x,M.scale(n.x,-1),z,M.unit(M.cross(z,n.x))];}
async function load(id) {
  const token=++request;stop();$('#exercise').value=id;$('#task-title').textContent='Loading exercise…';$('#check').disabled=true;$('#verify-table').disabled=true;
  try {
    const loaded=M.fixtures.some(f=>f.id===id)?M.complete(M.scenario(id)):await R.load(id);
    if(token!==request)return;model=loaded;
    state={phase:0,joint:0,row:0,stage:0,axes:Array(model.axes.length).fill(null),axisDone:Array(model.axes.length).fill(false),normalChoices:Array(model.normals.length).fill(null),normalDone:Array(model.normals.length).fill(false),
      directions:model.normals.map(n=>[...n.x]),drafts:model.rows.map(()=>({theta:'',d:'',a:'',alpha:''})),solved:model.rows.map(()=>({})),pending:false,preview:100,q:Array(model.axes.length).fill(0),verified:false,comparison:null,hintVisible:false,manipulationAxis:null,axisLocked:false,axisIssue:'',transition:null,sceneOpacity:1};
    document.documentElement.style.setProperty('--joint-count',model.axes.length);$('#exercise-count').textContent=`${model.axes.length} joints · ${model.rows.length} rows`;
    $('#check').disabled=false;$('#verify-table').disabled=false;$('#download-table').disabled=true;$('#show-frames').checked=true;$('#show-dh').checked=true;$('#show-intermediate').checked=false;$('#study-offsets').checked=false;offsetDisplay=null;
    $('#offset-joint').replaceChildren();model.frames.forEach((_,i)=>{const o=document.createElement('option');o.value=i;o.textContent=`Joint ${i+1} · F${i+1} ↔ D${i}`;$('#offset-joint').append(o);});
    viewer.measure(null);selectPane('exercise');say('');render();viewer.view();
    status('Choose the joint directions, then assign frames. Your table starts empty.');
  } catch(error) {if(token===request){say(error.message);$('#task-title').textContent='Exercise could not load';$('#task-description').textContent='Choose another exercise or restart to retry.';}}
}
function parametersComplete(){return state.phase>=2&&state.solved.every(row=>keys.every(key=>row[key]));}
function resetPending(keepHint=false) {state.pending=false;$('#next').hidden=true;$('#check').hidden=parametersComplete();say('');if(!keepHint)hideHint();}
function chooseAxis(joint,axis,sign=1) {
  if(state.phase!==0 || joint!==state.joint)return;
  state.axes[joint]=`${axis}:${sign}`;state.axisDone[joint]=false;resetPending();renderTask();renderScene();
}
function chooseNormal(index) {state.normalChoices[state.row]=index;state.normalDone[state.row]=false;resetPending();renderTask();renderScene();}
function render() {renderTask();renderTable();renderScene();}
function renderTask() {
  $('#step-label').textContent=`STEP ${state.phase+1} OF 4`;
  document.querySelectorAll('[data-workflow-step]').forEach(item=>{const i=Number(item.dataset.workflowStep);item.classList.toggle('done',i<state.phase);if(i===state.phase)item.setAttribute('aria-current','step');else item.removeAttribute('aria-current');});
  $('#focus-label').textContent=state.phase===0?`Joint ${state.joint+1}/${model.axes.length}`:`Row ${state.row+1}/${model.rows.length}`;
  $('#task-progress').replaceChildren();
  $('#task-progress').hidden=state.phase!==2;
  keys.forEach((key,i)=>{const item=document.createElement('li');item.textContent=symbols[key];item.setAttribute('aria-label',`Parameter ${symbols[key]}`);item.className=i===state.stage?'current':state.solved[state.row][key]?'done':'';if(i===state.stage)item.setAttribute('aria-current','step');$('#task-progress').append(item);});
  const picker=$('#focus');picker.replaceChildren();$('#focus-picker').hidden=state.phase===3;
  $('#focus-picker-label').textContent=state.phase===0?'Joint':'Transition';
  const count=state.phase===0?model.axes.length:model.rows.length;
  for(let i=0;i<count;i++) {const option=document.createElement('option');option.value=i;option.textContent=state.phase===0?`Joint ${i+1} · F${i+1}${state.axisDone[i]?' ✓':''}`:`Row ${i+1} · D${i} → D${i+1}${state.phase===1&&state.normalDone[i]?' ✓':''}`;picker.append(option);}
  picker.value=state.phase===0?state.joint:state.row;
  const host=$('#task-inputs');host.replaceChildren();hideHint();state.manipulationAxis=null;state.axisLocked=false;state.axisIssue='';state.dragAligned=false;
  $('#check').hidden=state.pending || parametersComplete() || state.phase===3;$('#next').hidden=!state.pending || state.phase===3;$('#hint').hidden=state.phase===3;$('#verify-table').hidden=state.phase===3;
  $('#scene-hint-toggle').hidden=state.phase===3;
  $('#next').textContent='Continue →';$('#motion-controls').hidden=state.phase!==2;
  $('#exercise-note').textContent=model.robot?`${model.robot.spec.name.split(' · ')[0]} · endpoint: ${model.robot.endpoint}`:`${model.axes.length} joints · ${model.rows.length} D–H rows`;
  if(state.phase===0) {
    $('#task-title').textContent=`Choose joint ${state.joint+1}'s axis`;
    $('#task-description').textContent='Which local arrow runs along the gold rotation axis through this joint? Read the given local axis, then choose its signed direction.';
    const buttons=document.createElement('div');buttons.className='axis-buttons';
    [1,-1].forEach(sign=>['x','y','z'].forEach((axis,index)=>{
      const button=document.createElement('button');button.textContent=(sign>0?'+':'−')+axis;button.dataset.axis=index;button.dataset.sign=sign;button.setAttribute('aria-pressed',state.axes[state.joint]===`${index}:${sign}`);button.setAttribute('aria-label',`Choose ${sign>0?'positive':'negative'} ${axis}`);button.addEventListener('click',()=>chooseAxis(state.joint,index,sign));buttons.append(button);
    }));host.append(buttons);
  } else if(state.phase===1) {
    const n=model.normals[state.row],terminal=n.terminal;
    $('#task-title').textContent=`Choose x${state.row+1}${terminal?' at the tool':''}`;
    $('#task-description').textContent=terminal?'Put the final origin at the tool. Keep its z parallel to the last joint axis; choose x along the perpendicular path to the tool.':`Choose x perpendicular to both gold axes z${state.row} and z${state.row+1}, along their connecting line. Either sign can work.`;
    const options=document.createElement('div');options.className='normal-options';
    candidates(state.row).forEach((v,i)=>{const button=document.createElement('button'),title=document.createElement('strong'),coordinates=document.createElement('span');button.dataset.normal=i;button.setAttribute('aria-pressed',state.normalChoices[state.row]===i);title.textContent='ABCD'[i];coordinates.textContent=vector(v);button.append(title,coordinates);button.addEventListener('click',()=>chooseNormal(i));options.append(button);});host.append(options);
  } else if(state.phase===2) {
    $('#show-intermediate').checked=true;
    const selector=$('#motion-axis');selector.replaceChildren();const prompt=document.createElement('option');prompt.value='';prompt.textContent='Choose a motion axis…';selector.append(prompt);
    [state.row,state.row+1].forEach(frame=>{['x','y','z'].forEach((axis,index)=>{const option=document.createElement('option');option.value=`D${frame}:axis:${index}`;option.textContent=`${axis}${frame}`;selector.append(option);});});
    const key=keys[state.stage],i=state.row+1;
    const titles=[`Rotate about z${i-1}`,`Translate along z${i-1}`,`Rotate about x${i}`,`Translate along x${i}`];
    const descriptions=[`Find the signed home angle θ${i},₀ that aligns x${i-1} with x${i}. The joint variable will add to this offset.`,`Find d${i}, the signed travel along the previous z axis to the common normal.`,`Find α${i}, the signed twist about the common normal that aligns the two z directions.`,`Find a${i}, the signed distance along the common normal to the next frame origin.`];
    $('#task-title').textContent=titles[state.stage];$('#task-description').textContent=descriptions[state.stage];
    const label=document.createElement('label');label.className='value-entry';label.htmlFor='parameter-answer';const title=document.createElement('span');title.textContent=`${symbols[key]}${i}${key==='theta'?',₀':''} · ${key==='theta'||key==='alpha'?'radians':'metres'}`;
    const input=document.createElement('input');input.id='parameter-answer';input.type='text';input.maxLength=96;input.autocomplete='off';input.placeholder='Number or expression, e.g. -pi/2';input.value=state.drafts[state.row][key];
    input.addEventListener('input',()=>{edit(state.row,key,input.value);syncTable();renderScene();});
    input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();state.pending?advance():check();}});label.append(title,input);host.append(label);
  } else {
    $('#task-title').textContent='Build forward kinematics';$('#task-description').textContent='Your table is verified. Open the building blocks playground in a new tab and compose one D–H transform per row.';
    const instructions=document.createElement('div');instructions.className='fk-guide';instructions.textContent='For each row: Rz(qᵢ + θᵢ,₀) → Tz(dᵢ) → Tx(aᵢ) → Rx(αᵢ). Multiply the rows in order, with the fixed base transform first and tool transform last (included in Download).';
    const launch=document.createElement('a');launch.id='build-fk';launch.href='building_blocks.html';launch.target='_blank';launch.rel='noopener';launch.textContent='Open building blocks · new tab ↗';instructions.append(launch);host.append(instructions);
    const block=document.createElement('div');block.className='pose-joint';const label=document.createElement('label');label.textContent='Move a joint (radians)';label.htmlFor='pose-joint';
    const select=document.createElement('select');select.id='pose-joint';model.frames.forEach((f,i)=>{const o=document.createElement('option');o.value=i;o.textContent=`Joint ${i+1}`;select.append(o);});select.value=state.joint;
    select.addEventListener('change',()=>{stop();state.joint=Number(select.value);renderTask();renderScene();});
    const output=document.createElement('output');output.id='joint-readout';output.textContent=expression(state.q[state.joint]);
    const slider=document.createElement('input');slider.id='joint-angle';slider.type='range';slider.min=-Math.PI;slider.max=Math.PI;slider.step='.01';slider.value=state.q[state.joint];slider.setAttribute('aria-label','Joint angle in radians');
    slider.addEventListener('input',()=>{stop();state.q[state.joint]=Number(slider.value);output.textContent=format(state.q[state.joint],3);renderScene();});
    const actions=document.createElement('div');actions.className='pose-actions';const home=document.createElement('button');home.id='home-joints';home.textContent='Reset pose';home.addEventListener('click',()=>{stop();state.q.fill(0);renderTask();renderScene();});const play=document.createElement('button');play.id='play-joint';play.textContent='▶ Move joint';play.addEventListener('click',playJoint);actions.append(home,play);block.append(label,select,slider,output,actions);host.append(block);
  }
  renderGiven();
}
function renderGiven() {
  $('.given-data').hidden=state.phase===1||state.phase===2;
  let text='';
  if(state.phase===0) {
    const i=state.joint,t=model.relatives[i],f=model.frames[i],local=f.localAxis || [0,1,2].map(j=>j===f.axis?(f.axisSign || 1):0);
    text=`${f.name || `joint_${i+1}`} · ${i?`F${i}`:'B'} → F${i+1}\nxyz = ${vector(M.origin(t))}\nrpy = ${vector(M.toRPY(t))}\naxis (local) = ${vector(local)}`;
  } else if(state.phase===3)text=`Home + 12 configurations checked\nMax FK difference: ${state.comparison.error.toExponential(2)}`;
  $('#given-title').textContent=state.phase===0?'Given joint origin':'Verification';$('#given-data').textContent=text;
}
function taskAction(){
  if(state.phase!==2)return null;
  const row=state.row,key=keys[state.stage],axis=key==='theta'||key==='d'?2:0,frame=axis===2?row:row+1;
  return {key,row,axis,frame,id:`D${frame}:axis:${axis}`,rotation:key==='theta'||key==='alpha',alignAxis:key==='theta'?0:key==='alpha'?2:null};
}
function motionValues(){return Object.fromEntries(keys.map(key=>{try{return [key,parse(state.drafts[state.row][key])];}catch(_){return [key,0];}}));}
function selectTaskAxis(id){
  const action=taskAction();if(!action||state.transition||$('#study-offsets').checked)return;
  if(state.axisLocked)return;
  const joint=/^joint:(\d+):axis$/.exec(id),normal=/^normal:(\d+):line$/.exec(id);
  if(joint)id=`D${Number(joint[1])}:axis:2`;if(normal)id=`D${Number(normal[1])+1}:axis:0`;
  stop();state.manipulationAxis=id;state.axisIssue='';
  if(id===action.id){
    const prefix=M.motionPose(model,state.row,motionValues(),state.stage,0),target=model.dhFrames[action.frame];
    const direction=M.axis(prefix,action.axis),expected=M.axis(target,action.axis),delta=M.sub(M.origin(target),M.origin(prefix));
    if(M.dot(direction,expected)<.99999)state.axisIssue='First align the moving x direction by completing θ for this row.';
    else if(M.norm(M.sub(delta,M.scale(direction,M.dot(delta,direction))))>.001)state.axisIssue='First translate the moving origin to the common normal by completing d for this row.';
    else{state.axisLocked=true;$('#show-intermediate').checked=true;viewer.measure(null);}
  }
  renderScene();
}
function dragParameter(value,gesture={}){
  if(state.phase!==2||!state.axisLocked)return;
  const key=keys[state.stage],target=model.rows[state.row][key],angular=key==='theta'||key==='alpha',span=M.norm(M.sub(M.origin(model.dhFrames[state.row+1]),M.origin(model.dhFrames[state.row])));
  const tolerance=angular?Math.min(.08,gesture.snapTolerance || .02):Math.min(Math.max(.003,span*.04),gesture.snapTolerance || .003);
  const aligned=Math.abs(equivalent(value,target,key))<tolerance;if(aligned)value=snap(value,target,key);
  const text=format(value,6);edit(state.row,key,text);state.dragAligned=aligned;const input=$('#parameter-answer');if(input)input.value=text;syncTable();renderScene();
}
function frameOffset(joint){
  const transform=M.multiply(M.inverse(model.dhFrames[joint]),model.world[joint]);
  const displacement=M.origin(transform),distance=M.norm(displacement),angle=Math.acos(Math.max(-1,Math.min(1,(transform[0][0]+transform[1][1]+transform[2][2]-1)/2)));
  return {joint,transform,displacement,distance,angle,different:distance>1e-8||angle>1e-8};
}
function renderScene() {
  let moving=null,motionBase=null,motionValue=0;
  if(state.phase===2){const values=motionValues();moving=M.motionPose(model,state.row,values,state.stage,state.preview/100);motionBase=M.motionPose(model,state.row,values,state.stage,0);motionValue=values[keys[state.stage]]*state.preview/100;}
  const offsets=$('#study-offsets').checked;
  const activeJoint=offsets?Number($('#offset-joint').value):state.phase===0||state.phase===3?state.joint:Math.min(state.row,model.axes.length-1);
  const activeRow=state.phase===3?activeJoint:state.row,sourceStart=Math.min(activeJoint,model.axes.length-2);
  const sourcePair=offsets?[activeJoint]:state.phase===0?[sourceStart,sourceStart+1]:[activeJoint,activeJoint+1].filter(i=>i<model.axes.length),dhPair=offsets?[activeJoint]:[activeRow,activeRow+1];
  const from=model.dhFrames[state.row],to=model.dhFrames[state.row+1];
  const projectionAxes=state.phase===2?[{label:`z${state.row}`,direction:M.axis(from,2)},{label:`x${state.row+1}`,direction:M.axis(to,0)}]:[];
  const angleReference=state.phase===2&&state.stage===0?projectionAxes[0]:state.phase===2&&state.stage===2?projectionAxes[1]:null;
  const action=offsets?null:taskAction();
  viewer.update({model,phase:state.phase,q:state.q,activeJoint,activeRow,sourcePair,dhPair,studyOffsets:offsets,action,selectable:state.phase===0&&!offsets,showLabels:$('#show-labels').checked,
    showBody:$('#show-body').checked,showAxes:$('#show-axes').checked,showFrames:$('#show-frames').checked,showDH:$('#show-dh').checked,showNormals:state.phase!==0&&state.phase!==3&&!offsets&&$('#show-normals').checked,
    dhCount:state.phase===0&&!offsets?0:model.dhFrames.length,
    moving:!offsets&&$('#show-intermediate').checked?moving:null,motionBase,motionValue,axisLocked:state.axisLocked&&!offsets&&!state.transition,sceneOpacity:state.sceneOpacity,projectionAxes:offsets?[]:projectionAxes,angleReference:offsets?null:angleReference});
  const visible=$('#show-body').checked;$('#toggle-robot').setAttribute('aria-pressed',visible);$('#toggle-robot').textContent=visible?'Robot ✓':'Robot —';$('#toggle-robot').title=visible?'Hide robot body, joints, and links':'Show robot body, joints, and links';
  $('#offset-joint').hidden=!offsets;
  $('#show-dh').disabled=state.phase===0&&!offsets;$('#show-intermediate').disabled=state.phase!==2||offsets||!!state.transition;$('#motion-controls').hidden=state.phase!==2||offsets;
  $('#manipulation-controls').hidden=!action;$('#motion-axis').value=state.manipulationAxis || '';$('#motion-axis').disabled=state.axisLocked||!!state.transition;$('#unlock-axis').hidden=!state.axisLocked;$('#unlock-axis').disabled=!!state.transition;$('#play-motion').disabled=$('#motion-progress').disabled=!!state.transition;
  if(action){let live='—';try{live=format(parse(state.drafts[state.row][action.key]),4);}catch(_){}$('#drag-value').textContent=`${state.dragAligned?'✓ ':''}${symbols[action.key]}${state.row+1}: ${live} ${action.rotation?'rad':'m'}`;$('#drag-value').title=state.dragAligned?'Alignment reached; press Check to confirm.':'The current value updates while dragging.';}
  $('#scene-loading').hidden=true;$('#scene-title').textContent=offsets?`Joint ${activeJoint+1} · F${activeJoint+1} ↔ D${activeJoint}⁺`:state.phase===0?`Joint ${activeJoint+1} · choose its local axis`:state.phase===1?`D${activeRow} → D${activeRow+1} · common normal`:state.phase===2?`Joint ${activeRow+1} · ${symbols[keys[state.stage]]} alignment`:model.name;
  let instruction=offsets?'Compare the origins and matching RGB arrows. Purple joins displaced origins.':state.phase===0?'Click the local arrow parallel to the gold joint axis; use ± buttons to choose its sign.':state.phase===1?'The dashed brown common normal connects the two gold joint axes perpendicularly.':'Step 4: open building blocks in a new tab and multiply the transforms in row order.';
  if(action){const axis=`${'xyz'[action.axis]}${action.frame}`;
    instruction=state.axisLocked?`Axis ${axis} locked. Drag the purple ${action.rotation?'alignment arrow':'frame origin'} to ${action.rotation?'rotate':'translate'}; the numeric value updates live. Drag empty space to orbit.`:'Choose the motion axis from the arrows or the selector, then drag the purple frame.';
    if(state.manipulationAxis&&!state.axisLocked)instruction=state.axisIssue||`This parameter ${action.rotation?'rotates about':'translates along'} ${axis}. Choose that axis to enable dragging.`;
    if(state.transition)instruction=state.transition==='confirm'?`Watch the correct ${action.rotation?'rotation about':'translation along'} ${axis}. The next task opens automatically.`:'The next frame task is appearing.';
  }
  if($('#scene-instruction').textContent!==instruction)$('#scene-instruction').textContent=instruction;
  const offset=frameOffset(activeJoint),showOffset=offsets||state.phase>0&&$('#show-frames').checked&&$('#show-dh').checked;
  $('#frame-offset-note').hidden=!showOffset;
  $('#frame-offset-note').textContent=`F${activeJoint+1} ↔ D${activeJoint}${offsets?'⁺':''}: ${offset.different?`origin offset ${format(offset.distance,4)} m; orientation offset ${format(offset.angle*180/Math.PI,1)}°`:'the frames coincide'}.${offsets?` D${activeJoint}⁺ includes this joint’s Rz(q${activeJoint+1}) substep.`:''} URDF frames follow the model; D–H aligns z with the joint and x with the common normal. This fixed change of coordinates is not joint motion. Keep the fixed base/tool transforms in FK.${state.phase<2?' D–H frames are provisional until normals are chosen.':''}`;
  $('#motion-progress').value=state.preview;$('#motion-percent').textContent=`${Math.round(state.preview)}%`;
  const taskKey=`${model.id}:${state.phase}:${activeRow}:${state.stage}:${offsets}`;
  if(taskKey!==lastSceneTask&&action)viewer.view();lastSceneTask=taskKey;
}
function renderMeasurement(info) {
  const open=!!info.mode;$('#measurement-panel').hidden=!open;$('#measure-toggle').setAttribute('aria-expanded',open);
  $('#measure-distance').setAttribute('aria-pressed',info.mode==='distance');$('#measure-angle').setAttribute('aria-pressed',info.mode==='angle');
  const key=JSON.stringify([info.mode,info.options.map(option=>[option.id,option.label])]);
  if(key!==measurementOptionsKey){measurementOptionsKey=key;['first','second'].forEach((name,i)=>{const select=$(`#measure-${name}`);select.replaceChildren();const prompt=document.createElement('option');prompt.value='';prompt.textContent=`${i+1}. Choose ${info.mode==='angle'?'axis':'point / axis'}`;select.append(prompt);info.options.forEach(feature=>{const option=document.createElement('option');option.value=feature.id;option.textContent=(feature.type==='point'?'• ':'↗ ')+feature.label;select.append(option);});});}
  ['first','second'].forEach((name,i)=>{$(`#measure-${name}`).value=info.selected[i]?.id || '';});
  const result=info.result;
  if(!result){$('#measure-result').textContent=info.selected[0]?`Choose a second ${info.mode==='angle'?'axis':'point or axis'}.`:`Click two ${info.mode==='angle'?'axes':'points or axes'}.`;$('#measure-detail').textContent='Purple marks selections. Drag to orbit; click to measure.';}
  else if(info.mode==='distance'){
    $('#measure-result').textContent=`${info.selected.every(f=>f.type==='point')?'Distance':'Shortest distance'}: ${format(result.distance,6)} m`;
    $('#measure-detail').textContent=result.projections.length?`Signed components · ${result.projections.map(p=>`${p.label}: ${format(p.value,6)} m`).join(' · ')}`:`Δ (base): ${vector(result.displacement)} m`;
  } else {
    $('#measure-result').textContent=`Angle: ${format(result.angle,6)} rad (${format(result.angle*180/Math.PI,2)}°)`;
    $('#measure-detail').textContent=result.signed?`Signed rotation about ${result.reference}.`:'Between the positive axis directions.';
  }
}
function setMeasurement(mode){stop();viewer.measure(mode);if(mode&&compact())selectPane('scene');}
function renderTable() {
  const host=$('#dh-table-body');host.replaceChildren();
  model.rows.forEach((_,i)=>{
    const tr=document.createElement('tr');tr.dataset.row=i;if(i===state.row&&state.phase>=1)tr.className='active';const name=document.createElement('td');name.textContent=i+1;tr.append(name);
    ['theta','d','a','alpha'].forEach(key=>{
      const td=document.createElement('td'),input=document.createElement('input');input.type='text';input.maxLength=96;input.value=state.drafts[i][key];input.placeholder='—';input.disabled=state.phase<2;input.dataset.tableRow=i;input.dataset.parameter=key;input.setAttribute('aria-label',`Row ${i+1} ${key}`);
      input.addEventListener('focus',()=>{stop();state.row=i;state.stage=keys.indexOf(key);if(state.phase===3){highlightRow();return;}state.pending=false;say('');renderTask();highlightRow();renderScene();});
      input.addEventListener('input',()=>{if(state.phase===3){state.phase=2;state.q.fill(0);renderTask();}edit(i,key,input.value);const answer=$('#parameter-answer');if(answer)answer.value=input.value;syncTable();renderScene();});
      input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();check();}});td.append(input);tr.append(td);
    });
    const result=document.createElement('td');result.className='row-state';result.dataset.rowStatus=i;tr.append(result);host.append(tr);
  });syncTable();
}
function highlightRow() {document.querySelectorAll('#dh-table-body tr').forEach(tr=>tr.classList.toggle('active',Number(tr.dataset.row)===state.row));}
function syncTable() {
  document.querySelectorAll('[data-table-row]').forEach(input=>{const row=Number(input.dataset.tableRow),key=input.dataset.parameter;if(input!==document.activeElement)input.value=state.drafts[row][key];input.removeAttribute('aria-invalid');});
  state.solved.forEach((solved,i)=>{const row=$(`[data-row-status="${i}"]`),count=keys.filter(key=>solved[key]).length;row.textContent=count===4?'✓':count?`${count}/4`:'—';row.classList.toggle('valid',count===4);});
}
function edit(row,key,text) {stop();state.dragAligned=false;state.drafts[row][key]=text;state.solved[row][key]=false;state.preview=100;state.verified=false;state.comparison=null;$('#download-table').disabled=true;resetPending(true);status('Table changed. Check each parameter, then verify the full table.');}
function equivalent(value,target,key) {return key==='theta'||key==='alpha'?Math.atan2(Math.sin(value-target),Math.cos(value-target)):value-target;}
function snap(value,target,key) {return key==='theta'||key==='alpha'?target+Math.round((value-target)/(2*Math.PI))*2*Math.PI:target;}
function check() {
  stop();if(parametersComplete())return;
  if(state.phase===0) {
    if(state.axes[state.joint]!==chosenAxes()[state.joint])return say('Follow the joint’s gold axis and read the local axis vector. Check both the arrow and its sign.');
    state.axisDone[state.joint]=true;say(`Correct. This direction becomes z${state.joint}. D–H uses each joint's positive rotation axis as z.`,true);
  } else if(state.phase===1) {
    const i=state.row,choice=state.normalChoices[i];if(choice===null)return say('Choose a normal direction first.');
    const v=candidates(i)[choice];if(!M.validCommonNormal(v,model.normals[i],model.axes[Math.min(i,model.axes.length-1)],model.axes[Math.min(i+1,model.axes.length-1)]))return say('The direction must be perpendicular to both axes and follow the line joining them.');
    state.directions[i]=v;model=M.assign(model,state.directions);state.normalDone[i]=true;
    say(`Correct. This is x${i+1}. We construct y = z × x to complete a right-handed frame.${i===0?' The free base x₀ is chosen parallel to x₁.':''}`,true);
  } else if(state.phase===2) {
    const key=keys[state.stage],target=model.rows[state.row][key];let value;
    try{value=parse(state.drafts[state.row][key]);}catch(error){return say(error.message);}
    if(Math.abs(equivalent(value,target,key))>.001)return say(`The frame does not align yet. Check the ${key==='theta'||key==='alpha'?'rotation sign and radian units':'signed distance along the selected axis'}. Use Hint or preview the motion.`);
    state.drafts[state.row][key]=expression(snap(value,target,key));state.solved[state.row][key]=true;syncTable();const input=$('#parameter-answer');if(input)input.value=state.drafts[state.row][key];
    say(`Correct: ${symbols[key]}${state.row+1} = ${state.drafts[state.row][key]}. Rounded entries are stored at the exact geometric value.`,true);
  } else return;
  state.pending=true;$('#check').hidden=true;$('#next').hidden=false;renderScene();
  if(state.phase===2)confirmMotion();
}
function nextParameter(){for(let i=0;i<model.rows.length;i++)for(let k=0;k<keys.length;k++)if(!state.solved[i][keys[k]])return {row:i,stage:k};return null;}
function sceneNotice(text){$('#scene-transition').textContent=text;$('#scene-transition').hidden=false;}
const ease=t=>t*t*(3-2*t);
function confirmMotion(){
  const key=keys[state.stage],row=state.row,axis=`${state.stage<2?'z':'x'}${state.stage<2?row:row+1}`,angular=key==='theta'||key==='alpha';
  const amount=parse(state.drafts[row][key]),zero=Math.abs(amount)<1e-9;
  sceneNotice(`Correct · ${symbols[key]}${row+1} = ${state.drafts[row][key]} ${angular?'rad':'m'}. ${zero?`The ${angular?'directions are already aligned':'origins already align along this axis'}.`:`Watch the ${angular?'rotation about':'translation along'} ${axis}.`}`);
  $('#next').hidden=true;$('#show-intermediate').checked=true;viewer.measure(null);if(compact())selectPane('scene');
  if(matchMedia('(prefers-reduced-motion: reduce)').matches){state.preview=100;renderScene();transitionToNext();return;}
  state.transition='confirm';state.preview=0;renderScene();const start=performance.now(),duration=zero?350:1100;
  function frame(now){state.preview=ease(Math.min(1,(now-start)/duration))*100;renderScene();if(now-start<duration+450)animation=requestAnimationFrame(frame);else{animation=null;transitionToNext();}}
  animation=requestAnimationFrame(frame);
}
function transitionToNext(){
  const next=nextParameter();
  if(!next){state.transition=null;state.sceneOpacity=1;state.preview=100;advanceTask();renderScene();sceneNotice('All joint frames are aligned. Verify your D–H table, then build forward kinematics.');return;}
  const changedJoint=next.row!==state.row,axis=`${next.stage<2?'z':'x'}${next.stage<2?next.row:next.row+1}`;
  const message=changedJoint?`Let’s move to the next joint frame · Joint ${next.row+1}.`:`Now ${next.stage===0||next.stage===2?'rotate about':'translate along'} ${axis} to find ${symbols[keys[next.stage]]}${next.row+1}.`;
  sceneNotice(message);
  if(matchMedia('(prefers-reduced-motion: reduce)').matches){state.transition=null;state.sceneOpacity=1;advanceTask();sceneNotice(message);return;}
  state.transition='fade-out';const start=performance.now();let swapped=false;
  function frame(now){
    const elapsed=now-start;
    if(elapsed<300)state.sceneOpacity=1-ease(elapsed/300);
    else{
      if(!swapped){state.sceneOpacity=0;advanceTask();state.transition='fade-in';sceneNotice(message);swapped=true;}
      state.sceneOpacity=ease(Math.min(1,(elapsed-300)/350));
    }
    renderScene();
    if(elapsed<650)animation=requestAnimationFrame(frame);else{animation=null;state.transition=null;state.sceneOpacity=1;renderScene();}
  }
  renderScene();animation=requestAnimationFrame(frame);
}
function advance(){if(!state.pending||state.transition)return;stop();if(state.phase===2)transitionToNext();else advanceTask();}
function advanceTask() {
  if(!state.pending)return;
  if(state.phase===0){const next=state.axisDone.findIndex(done=>!done);if(next<0){state.phase=1;state.row=0;$('#show-frames').checked=false;}else state.joint=next;}
  else if(state.phase===1){const next=state.normalDone.findIndex(done=>!done);if(next<0){state.phase=2;state.row=0;state.stage=0;status('Enter every θ, d, a and α. Use numbers or pi expressions.');}else state.row=next;}
  else{
    const next=nextParameter();
    if(next){state.row=next.row;state.stage=next.stage;}else{resetPending();say('All parameters are checked. Press Verify table to finish.',true);status('All parameters checked. Verify the full table to finish.');selectPane(compact()?'table':'exercise');return;}
  }
  state.preview=100;resetPending();render();
}
function hint() {
  if(state.hintVisible){hideHint();return;}
  say('');
  const i=state.row,key=keys[state.stage];let text;
  if(state.phase===0)text='Align the local joint arrow with the gold rotation axis. Select its signed x, y or z direction; this becomes D–H z. The given axis vector is expressed in the URDF frame, not the ground frame.';
  else if(state.phase===1){const n=model.normals[i];text=`Choose x${i+1} along the dashed brown common normal, perpendicular to z${i} and z${i+1}. ${n.kind==='intersecting'?'The axes meet, so a is zero; use their cross product for x.':n.kind==='coincident'?'The axes coincide, so any offered perpendicular x is valid.':'Either normal sign is valid if you retain the corresponding signed distance.'}`;}
  else if(key==='theta')text=`Align x${i} (purple) with x${i+1} (target) by rotating about z${i}. Choose z${i}, then drag the purple x arrow. The signed home angle θ${i+1},₀ updates in radians; positive rotation follows the right-hand rule.`;
  else if(key==='d')text=`Align O${i} (purple origin) with P${i+1} (common-normal start) by translating along z${i}. Choose z${i}, then drag the purple origin. The signed travel is d${i+1} in metres; the sideways distance along x belongs to a.`;
  else if(key==='alpha')text=`Align z${i} (purple) with z${i+1} (target) by rotating about x${i+1}, the common normal. Choose x${i+1}, then drag the purple z arrow. Positive α${i+1} follows the right-hand rule; the value updates in radians.`;
  else text=`Align O${i} (purple origin) with O${i+1} (target origin) by translating along x${i+1}. Choose x${i+1}, then drag the purple origin. The signed travel is a${i+1} in metres: positive along the arrow, negative against it.`;
  if(state.phase===2)text+=' Drag near the target to snap into alignment; Check confirms the value.';
  $('#hint-text').textContent=text;$('#hint-text').hidden=false;$('#scene-hint').textContent=text;$('#scene-hint').hidden=false;state.hintVisible=true;
  ['#hint','#scene-hint-toggle'].forEach(selector=>{$(selector).textContent='Hide hint';$(selector).setAttribute('aria-pressed','true');});
}

function verify() {
  stop();if(state.phase<2){status('First assign every joint axis and common normal.','error');return;}
  const rows=[];let firstError=null;
  state.drafts.forEach((draft,i)=>{const row={};keys.forEach(key=>{try{row[key]=parse(draft[key]);}catch(_){$(`[data-table-row="${i}"][data-parameter="${key}"]`).setAttribute('aria-invalid','true');if(!firstError)firstError={row:i,key};}});rows.push(row);});
  if(firstError){status(`Complete row ${firstError.row+1}: ${symbols[firstError.key]} needs a numeric value.`,'error');return;}
  rows.forEach((row,i)=>keys.forEach(key=>{const target=model.rows[i][key];if(Math.abs(equivalent(row[key],target,key))<=.001)row[key]=snap(row[key],target,key);}));
  const configurations=[Array(model.axes.length).fill(0),...Array.from({length:12},(_,j)=>model.axes.map((_,i)=>Math.sin((j+1)*(i+1)*.73)*1.1))];
  const error=Math.max(...configurations.map(q=>M.distance(M.urdfFK(model,q),M.dhFK(model,q,rows))));
  if(error>1e-6){const wrong=rows.findIndex((row,i)=>M.distance(M.dh(row),M.dh(model.rows[i]))>1e-6);status(`Table needs another look${wrong>=0?` · start at row ${wrong+1}`:''}. Maximum pose difference: ${error.toExponential(2)}.`,'error');return;}
  rows.forEach((row,i)=>keys.forEach(key=>{state.drafts[i][key]=expression(row[key]);state.solved[i][key]=true;}));state.verified=true;state.phase=3;state.pending=false;state.comparison={error,configurations:13};state.q.fill(0);$('#download-table').disabled=false;say('');
  status(`Verified · home + 12 joint configurations · max difference ${error.toExponential(2)}`,'success');render();
}
function playMotion() {
  if(animation!==null){stop();return;}if(matchMedia('(prefers-reduced-motion: reduce)').matches){state.preview=100;renderScene();return;}
  const start=performance.now();$('#play-motion').textContent='Ⅱ Pause';selectPane(compact()?'scene':document.body.dataset.mobileView);
  function frame(now){state.preview=Math.min(100,(now-start)/1800*100);renderScene();if(state.preview<100)animation=requestAnimationFrame(frame);else stop();}animation=requestAnimationFrame(frame);
}
function playJoint() {
  if(animation!==null){stop();return;}if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  const start=performance.now(),joint=state.joint;$('#play-joint').textContent='Ⅱ Pause';
  function frame(now){state.q[joint]=Math.sin((now-start)/1100);const slider=$('#joint-angle'),readout=$('#joint-readout');if(slider)slider.value=state.q[joint];if(readout)readout.textContent=format(state.q[joint],3);renderScene();animation=requestAnimationFrame(frame);}animation=requestAnimationFrame(frame);
}
function download() {
  if(!state.verified)return;
  const data={convention:'standard',exercise:model.id,units:{angles:'radians',lengths:'metres'},rows:state.drafts.map((draft,i)=>({joint:i+1,thetaOffset:parse(draft.theta),d:parse(draft.d),a:parse(draft.a),alpha:parse(draft.alpha)})),baseTransform:model.base,toolTransform:model.toolOffset,endpoint:model.robot?.endpoint || 'E',verification:state.comparison};
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)+'\n'],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=`standard-dh-${model.id}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
const guide=[
  ['Assign frames','The gold line is a joint’s positive rotation axis z. Put x along the common normal between consecutive z axes, and place the next origin on its joint axis. The lab chooses the free base x₀ to match x₁.','Complete each frame with y = z × x. This gives x × y = z. The terminal origin is at the tool; its z stays parallel to the last joint axis.'],
  ['θ · joint angle','Rotate about the previous z to align the two x directions. Use the right-hand rule and radians.','For revolute joints, θ = q + θ₀. You enter the home offset θ₀ in the table.'],
  ['d · link offset','Translate along the previous z to reach the common normal. Project the origin displacement onto that z direction.','d = (O_next − O_previous) · z_previous. It can be positive, negative, or zero.'],
  ['α · link twist','Rotate about the common-normal x to align the two z directions. The x direction is the one obtained after the θ rotation.','The tasks use Rz → Tz → Rx → Tx. Rx and Tx commute, so this is exactly the standard Rz → Tz → Tx → Rx product.'],
  ['a · link length','Translate along the common normal x to reach the next origin. The final moving frame coincides with the assigned target.','a = (O_next − O_previous) · x_next. Reversing x can give a negative a without changing the robot.'],
  ['Special cases','Parallel axes allow a choice of normal location. Intersecting axes give a = 0. Coincident axes also allow any perpendicular x direction. Opposite positive z directions give a twist of ±π.','The lab anchors parallel normals at the preceding supplied origin. Fixed base and tool changes of frame preserve the robot’s physical endpoint.']
];
function renderGuide(){const [title,...paragraphs]=guide[guidePage];const host=$('#guide-content');host.replaceChildren();const h=document.createElement('h3');h.textContent=title;host.append(h);paragraphs.forEach(text=>{const p=document.createElement('p');p.textContent=text;host.append(p);});$('#guide-page').textContent=`${guidePage+1} / ${guide.length}`;$('#guide-previous').disabled=guidePage===0;$('#guide-next').disabled=guidePage===guide.length-1;}
function populate() {
  const syncFrameOptions=()=>{$('.frame-options').open=!compact();};syncFrameOptions();compactMedia.addEventListener('change',syncFrameOptions);
  [['Geometric cases',M.fixtures],['Course robots',R.catalog]].forEach(([label,items])=>{const group=document.createElement('optgroup');group.label=label;items.forEach(item=>{const option=document.createElement('option');option.value=item.id;option.textContent=item.name;group.append(option);});$('#exercise').append(group);});
  $('#exercise').addEventListener('change',()=>load($('#exercise').value));$('#restart').addEventListener('click',()=>load($('#exercise').value));
  $('#focus').addEventListener('change',()=>{stop();if(state.phase===0)state.joint=Number($('#focus').value);else state.row=Number($('#focus').value);state.pending=false;state.preview=100;say('');render();});
  $('#check').addEventListener('click',check);$('#next').addEventListener('click',advance);$('#hint').addEventListener('click',hint);$('#verify-table').addEventListener('click',verify);$('#download-table').addEventListener('click',download);
  $('#scene-hint-toggle').addEventListener('click',hint);$('#motion-axis').addEventListener('change',event=>selectTaskAxis(event.target.value));
  $('#unlock-axis').addEventListener('click',()=>{stop();state.axisLocked=false;state.manipulationAxis=null;state.axisIssue='';renderScene();});
  ['body','axes','frames','dh','normals','intermediate','labels'].forEach(name=>$(`#show-${name}`).addEventListener('change',renderScene));
  $('#study-offsets').addEventListener('change',()=>{
    stop();hideHint();viewer.measure(null);
    if($('#study-offsets').checked){offsetDisplay={frames:$('#show-frames').checked,dh:$('#show-dh').checked,intermediate:$('#show-intermediate').checked};$('#show-frames').checked=$('#show-dh').checked=true;$('#show-intermediate').checked=false;$('#offset-joint').value=state.phase===0||state.phase===3?state.joint:Math.min(state.row,model.axes.length-1);}
    else if(offsetDisplay){['frames','dh','intermediate'].forEach(name=>$(`#show-${name}`).checked=offsetDisplay[name]);offsetDisplay=null;}
    renderScene();viewer.view();
  });
  $('#offset-joint').addEventListener('change',()=>{renderScene();viewer.view();});
  $('#toggle-robot').addEventListener('click',()=>{$('#show-body').checked=!$('#show-body').checked;renderScene();});
  $('#measure-toggle').addEventListener('click',()=>setMeasurement($('#measurement-panel').hidden?'distance':null));
  ['distance','angle'].forEach(mode=>$(`#measure-${mode}`).addEventListener('click',()=>setMeasurement(mode)));
  $('#measure-clear').addEventListener('click',()=>setMeasurement($('#measure-angle').getAttribute('aria-pressed')==='true'?'angle':'distance'));
  $('#measure-close').addEventListener('click',()=>setMeasurement(null));
  ['first','second'].forEach((name,i)=>$(`#measure-${name}`).addEventListener('change',event=>viewer.selectMeasurement(i,event.target.value)));
  ['home','top','front'].forEach(name=>$(`#view-${name}`).addEventListener('click',()=>viewer.view(name)));
  $('#motion-progress').addEventListener('input',()=>{stop();$('#show-intermediate').checked=true;state.preview=Number($('#motion-progress').value);renderScene();});$('#play-motion').addEventListener('click',()=>{$('#show-intermediate').checked=true;playMotion();});
  document.querySelectorAll('[data-pane-button]').forEach(b=>b.addEventListener('click',()=>selectPane(b.dataset.paneButton)));
  $('#help').addEventListener('click',()=>{renderGuide();$('#help-dialog').showModal();});$('#guide-previous').addEventListener('click',()=>{guidePage--;renderGuide();});$('#guide-next').addEventListener('click',()=>{guidePage++;renderGuide();});
}
try {
  viewer=create($('#dh-scene'),chooseAxis,info=>{$('#body-status').textContent=info.error?`Body unavailable · ${info.error}`:info.loading?'Loading transparent robot body…':info.loaded?`${info.loaded} transparent robot meshes · gold rotation axes`:'Blue cylinders: joints · gold: rotation axes';},renderMeasurement,selectTaskAxis,dragParameter);
  populate();
  window.DHPlayground={getState:()=>structuredClone(state),getModel:()=>structuredClone(model),getViewerState:()=>viewer.diagnostics(),getFrameOffset:(joint=Number($('#offset-joint').value))=>frameOffset(joint),getComparison:()=>{
    if(!state?.verified)return null;const rows=state.drafts.map(draft=>Object.fromEntries(keys.map(key=>[key,parse(draft[key])])));return {urdf:M.urdfFK(model,state.q),dh:M.dhFK(model,state.q,rows),error:M.distance(M.urdfFK(model,state.q),M.dhFK(model,state.q,rows))};
  }};
  await load('skew');
} catch(error){$('#scene-loading').textContent='The 3D viewer could not start.';say(error.message);console.error(error);}
