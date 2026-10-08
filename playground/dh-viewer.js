import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { parseStlGeometry } from '../lectures_main/js/viz/frameDHPlayground.js';
import { loadAbbIrbVisuals } from '../lectures_main/js/viz/abbIrbVisuals.js';

const M = window.DHModel, R = window.DHRobots, Measurements=window.DHMeasurements, Drag=window.DHDrag;
const GOLD = 0xd5a020, BLUE = 0x3488df, NORMAL_BROWN = 0x895238, CONTEXT_OPACITY = .035;
const subscript=text=>text.replace(/\d/g,d=>'₀₁₂₃₄₅₆₇₈₉'[Number(d)]);
const vector = a => new THREE.Vector3(...a);
const matrix = t => new THREE.Matrix4().set(...t.flat());
function release(group) {
  const geometries=new Set(),materials=new Set();
  group.traverse(object=>{if(object.geometry)geometries.add(object.geometry);if(object.material)(Array.isArray(object.material)?object.material:[object.material]).forEach(m=>materials.add(m));});
  geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());group.clear();
}
function tube(start,end,radius,color,opacity=1) {
  const delta=end.clone().sub(start),length=delta.length();
  const mesh=new THREE.Mesh(new THREE.CylinderGeometry(radius,radius,Math.max(length,1e-7),10),new THREE.MeshBasicMaterial({color,transparent:opacity<1,opacity,depthWrite:opacity===1}));
  mesh.position.copy(start).add(end).multiplyScalar(.5);mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize());return mesh;
}
function arrow(group,direction,length,color,radius,pick,measurement) {
  const end=direction.clone().multiplyScalar(length),shaft=tube(new THREE.Vector3(),end,radius,color);
  const tip=new THREE.Mesh(new THREE.ConeGeometry(radius*3.3,radius*9,12),new THREE.MeshBasicMaterial({color}));
  tip.position.copy(end);tip.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),direction);
  if(pick){shaft.userData.pick=pick;tip.userData.pick=pick;}
  if(measurement){shaft.userData.measure=measurement;tip.userData.measure=measurement;}group.add(shaft,tip);
}
export function create(stage,onAxis,onLoad,onMeasurement,onTaskAxis,onDrag) {
  const scene=new THREE.Scene();scene.background=new THREE.Color(0xf8fafc);
  const camera=new THREE.PerspectiveCamera(40,1,.001,1000);camera.up.set(0,0,1);
  const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio || 1,2));renderer.outputColorSpace=THREE.SRGBColorSpace;
  const canvas=renderer.domElement;canvas.tabIndex=0;canvas.setAttribute('aria-label','3D robot. Left drag or one finger to orbit, right drag to pan, wheel to zoom. Two fingers pan and zoom. Home resets.');stage.prepend(canvas);
  const labels=document.createElement('div');labels.className='frame-labels';stage.append(labels);
  const controls=new OrbitControls(camera,canvas);controls.enableDamping=true;controls.dampingFactor=.08;controls.screenSpacePanning=true;
  controls.mouseButtons={LEFT:THREE.MOUSE.ROTATE,MIDDLE:THREE.MOUSE.DOLLY,RIGHT:THREE.MOUSE.PAN};controls.touches={ONE:THREE.TOUCH.ROTATE,TWO:THREE.TOUCH.DOLLY_PAN};controls.listenToKeyEvents(canvas);
  scene.add(new THREE.HemisphereLight(0xffffff,0x78889b,2.5));const light=new THREE.DirectionalLight(0xffffff,2.5);light.position.set(3,-4,6);scene.add(light);
  const robot=new THREE.Group(),joints=new THREE.Group(),links=new THREE.Group(),axes=new THREE.Group(),supplied=new THREE.Group(),assigned=new THREE.Group(),normals=new THREE.Group(),motion=new THREE.Group(),ground=new THREE.Group(),tool=new THREE.Group(),measurementDrawing=new THREE.Group(),taskCue=new THREE.Group();
  scene.add(robot,joints,links,axes,supplied,assigned,normals,motion,ground,tool,measurementDrawing,taskCue);
  let model=null,value=null,extent=1,frameSize=.2,center=new THREE.Vector3(),home=null,fitPoints=[],needsFit=false,cad=null,serial=0,disposed=false,animation=null;
  let physical=[],sourceFrames=[],dhFrames=[],frameLabels=[],poseKey='',assignmentKey='',loaded=0,loading=false,loadError='',grid=null;
  let measurementMode=null,selected=[null,null],features=new Map(),measurementInfo={mode:null,options:[],selected:[],result:null},measurementKey='',cueKey='',drag=null;
  const compass=[...stage.querySelectorAll('[data-ground-axis]')];
  function label(text,parent,position,className='') {
    const element=document.createElement('span');element.textContent=text;element.className='frame-label '+className;labels.append(element);const entry={element,parent,position};frameLabels.push(entry);return entry;
  }
  function makeFrame(name,index,pickable=false,color=null) {
    const group=new THREE.Group();group.matrixAutoUpdate=false;group.userData.name=name;
    const colors=color?[color,color,color]:[0xd63f3c,0x1c915a,0x347bd3];
    [0,1,2].forEach(i=>{
      const direction=new THREE.Vector3().setComponent(i,1);
      arrow(group,direction,frameSize,colors[i],extent*.0034,pickable?{frame:index,axis:i}:null,name==='Moving'?null:{id:`${name}:axis:${i}`,type:'line',label:`${subscript(name)} · ${'xyz'[i]} axis`,origin:[0,0,0],direction:direction.toArray()});
      group.children.slice(-2).forEach((node,j)=>{node.userData.frameAxis=i;node.userData.axisPart=j===0?'shaft':'tip';node.userData.basePosition=node.position.clone();});
      if(name==='Moving')label('xyz'[i],group,direction.clone().multiplyScalar(frameSize*1.18),'axis-label moving-label').axis=i;
    });
    if(name!=='Moving')addPoint(group,`${name}:origin`,name==='O'?'O · ground origin':`${subscript(name)} origin`,[0,0,0]);
    if(name==='Moving'){const handle=new THREE.Mesh(new THREE.SphereGeometry(extent*.019,16,12),new THREE.MeshBasicMaterial({color:0xa752b4,depthTest:false}));handle.userData.dragHandle=true;handle.renderOrder=18;group.add(handle);}
    label(name==='O'?'O · ground':subscript(name),group,new THREE.Vector3(frameSize*.1,frameSize*.1,frameSize*.28),color?'moving-label':'').frameName=true;return group;
  }
  function addPoint(group,id,name,position,color=0xa752b4) {
    const point=new THREE.Mesh(new THREE.SphereGeometry(extent*.012,12,8),new THREE.MeshBasicMaterial({color,depthTest:false,depthWrite:false}));
    point.position.copy(vector(position));point.renderOrder=20;point.userData.measurePoint=true;point.userData.measure={id,type:'point',label:name,origin:position};point.visible=measurementMode==='distance';group.add(point);
  }
  function clearLabels(){frameLabels.forEach(l=>l.element.remove());frameLabels=[];}
  function rebuildFrames() {
    [supplied,assigned,normals,motion,ground,tool].forEach(release);clearLabels();
    sourceFrames=model.world.map((_,i)=>{const g=makeFrame(`F${i+1}`,i,true);supplied.add(g);return g;});
    dhFrames=model.dhFrames.map((t,i)=>{const g=makeFrame(`D${i}`,i);g.matrix.copy(matrix(t));assigned.add(g);return g;});
    model.normals.forEach((n,i)=>{
      const g=new THREE.Group();g.userData.index=i;
      if(n.length>1e-8){
        const start=vector(n.start),end=vector(n.end),count=Math.max(2,Math.ceil(n.length/(extent*.04)));
        for(let dash=0;dash<count;dash++)g.add(tube(start.clone().lerp(end,dash/count),start.clone().lerp(end,(dash+.65)/count),extent*.005,NORMAL_BROWN));
        // A transparent carrier keeps the whole normal measurable, including gaps.
        const pickLine=tube(start,end,extent*.005,NORMAL_BROWN,0);pickLine.userData.invisibleCarrier=true;pickLine.userData.measure={id:`normal:${i}:line`,type:'line',label:`Common normal x${subscript(String(i+1))}`,origin:n.start,direction:M.axis(model.dhFrames[i+1],0)};g.add(pickLine);
      }
      else{const ball=new THREE.Mesh(new THREE.SphereGeometry(extent*.014,12,8),new THREE.MeshBasicMaterial({color:NORMAL_BROWN}));ball.position.copy(vector(n.end));g.add(ball);}normals.add(g);
      addPoint(g,`normal:${i}:start`,`Normal ${i+1} start`,n.start,NORMAL_BROWN);addPoint(g,`normal:${i}:end`,`Normal ${i+1} end`,n.end,NORMAL_BROWN);
    });
    motion.add(makeFrame('Moving',-1,false,0xa752b4));
    const origin=makeFrame('O',0);origin.traverse(node=>{if(node.material){node.material.depthTest=false;node.material.depthWrite=false;node.renderOrder=10;}});ground.add(origin);
    tool.matrixAutoUpdate=false;addPoint(tool,'tool:origin','E · tool origin',[0,0,0]);label('E',tool,new THREE.Vector3(0,0,frameSize*.2));
    model.axes.forEach((_,i)=>{const local=vector(model.frames[i].localAxis || [0,1,2].map(j=>j===model.frames[i].axis?(model.frames[i].axisSign || 1):0));label(`z${subscript(String(i))}`,physical[i].axis,local.multiplyScalar(extent*.35),'gold-label');});
    indexFeatures();
    assignmentKey=JSON.stringify(model.dhFrames);
  }
  function indexFeatures(){features=new Map();[ground,supplied,assigned,axes,normals,tool].forEach(group=>group.traverse(node=>{if(node.userData.measure)features.set(node.userData.measure.id,{node,data:node.userData.measure});}));}
  function isVisible(node){for(let p=node;p;p=p.parent)if(!p.visible)return false;return true;}
  function resolveFeature(id) {
    const feature=features.get(id);if(!feature||!isVisible(feature.node))return null;
    const {data,node}=feature,transform=node.parent.matrixWorld;
    return {id,type:data.type,label:data.label,origin:vector(data.origin).applyMatrix4(transform).toArray(),...(data.direction?{direction:vector(data.direction).transformDirection(transform).toArray()}: {})};
  }
  function refreshMeasurement() {
    const options=[...features.keys()].map(resolveFeature).filter(f=>f&&(measurementMode!=='angle'||f.type==='line'));
    selected=selected.map(id=>options.some(f=>f.id===id)?id:null);
    const choices=selected.map(id=>id?resolveFeature(id):null);let result=null;
    if(measurementMode&&choices.every(Boolean))result=measurementMode==='distance'?Measurements.distance(...choices,value?.projectionAxes || []):Measurements.angle(...choices,value?.angleReference || null);
    measurementInfo={mode:measurementMode,options,selected:choices,result};
    const key=JSON.stringify(measurementInfo);if(key!==measurementKey){measurementKey=key;drawMeasurement(choices,result);onMeasurement?.(measurementInfo);}
  }
  function drawMeasurement(choices,result) {
    release(measurementDrawing);if(!measurementMode)return;
    const purple=0xa752b4;
    choices.filter(Boolean).forEach(choice=>{
      const p=vector(choice.origin);
      if(choice.type==='line'){const direction=vector(choice.direction);measurementDrawing.add(tube(p.clone().addScaledVector(direction,-frameSize*.8),p.clone().addScaledVector(direction,frameSize*.8),extent*.004,purple));}
      else{const dot=new THREE.Mesh(new THREE.SphereGeometry(extent*.017,12,8),new THREE.MeshBasicMaterial({color:purple,depthTest:false}));dot.position.copy(p);dot.renderOrder=21;measurementDrawing.add(dot);}
    });
    if(result&&measurementMode==='distance') {
      if(result.distance>1e-9)measurementDrawing.add(tube(vector(result.start),vector(result.end),extent*.003,purple));
    } else if(result) {
      const first=vector(choices[0].direction),second=vector(choices[1].direction),p=vector(choices[0].origin);
      let axis=result.signed?vector(value.angleReference.direction):first.clone().cross(second);
      if(axis.length()<1e-7)axis=first.clone().cross(Math.abs(first.z)<.8?new THREE.Vector3(0,0,1):new THREE.Vector3(0,1,0));axis.normalize();
      const points=Array.from({length:33},(_,i)=>first.clone().applyAxisAngle(axis,result.angle*i/32).multiplyScalar(frameSize*.65).add(p));
      measurementDrawing.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color:purple,depthTest:false})));
    }
  }
  function measure(mode) {
    if(drag)finishDrag();
    measurementMode=mode;selected=[null,null];canvas.style.cursor=mode?'crosshair':'';
    [ground,supplied,assigned,normals,tool].forEach(group=>group.traverse(node=>{if(node.userData.measurePoint)node.visible=mode==='distance';}));tool.visible=mode==='distance';
    scene.updateMatrixWorld(true);refreshMeasurement();
  }
  function selectMeasurement(slot,id){if(slot!==0&&slot!==1)return;const choice=resolveFeature(id);selected[slot]=choice&&(measurementMode!=='angle'||choice.type==='line')?id:null;refreshMeasurement();}
  function resetView(name='home') {
    if(!home)return;
    if(!stage.clientWidth||!stage.clientHeight){needsFit=true;return;}
    needsFit=false;camera.aspect=stage.clientWidth/stage.clientHeight;camera.updateProjectionMatrix();
    let points=fitPoints,focus=center;
    const focused=!!value?.studyOffsets||!!value?.action;
    if(focused){
      // Fit the active frames rather than the long background joint axes.
      const frames=value.studyOffsets?[sourceFrames[value.activeJoint],dhFrames[value.activeJoint]]:[motion.children[0],dhFrames[value.action.row+1]];
      let origins=frames.map(frame=>new THREE.Vector3().setFromMatrixPosition(frame.matrixWorld)),padding=2.15;
      if(value.action&&!value.action.rotation){origins=[new THREE.Vector3().setFromMatrixPosition(matrix(value.motionBase)),origins[0],value.action.key==='d'?vector(model.normals[value.action.row].start):origins[1]];padding=1.1;}
      points=origins.flatMap(origin=>{
        return [origin,...[-1,1].flatMap(x=>[-1,1].flatMap(y=>[-1,1].map(z=>origin.clone().add(new THREE.Vector3(x,y,z).multiplyScalar(frameSize*padding)))))];
      });
      focus=new THREE.Box3().setFromPoints(points).getCenter(new THREE.Vector3());
    }
    controls.enableDamping=false;controls.update();controls.target.copy(focus);
    const direction=(name==='top'?new THREE.Vector3(.0001,0,1):name==='front'?new THREE.Vector3(1,0,.04):home.offset.clone()).normalize();
    const right=direction.clone().cross(camera.up).normalize(),up=right.clone().cross(direction),tangent=Math.tan(THREE.MathUtils.degToRad(camera.fov/2));
    const distance=Math.max(extent*(focused ? .2 : 1.2),...points.map(point=>{const p=point.clone().sub(focus);return p.dot(direction)+1.1*Math.max(Math.abs(p.dot(up))/tangent,Math.abs(p.dot(right))/(tangent*camera.aspect));}));
    camera.position.copy(focus).addScaledVector(direction,distance);
    controls.update();controls.enableDamping=true;
  }
  async function loadBody(current,token) {
    if(!current.robot){loading=false;onLoad?.({loaded:0,loading:false,error:''});return;}
    loading=true;onLoad?.({loaded:0,loading:true,error:''});const holder=new THREE.Group();let update;
    try {
      if(current.id==='irb4600') {
        const abb=await loadAbbIrbVisuals(holder);update=poses=>abb.update(poses);
        holder.traverse(node=>{if(node.isMesh){node.material.transparent=true;node.material.opacity=.22;node.material.depthWrite=false;node.material.color.setHex(0x96a9bd);}});
      } else {
        const nodes=new Map(),jobs=[];
        current.robot.links.forEach(link=>{
          const group=new THREE.Group();group.matrixAutoUpdate=false;nodes.set(link.name,group);holder.add(group);
          link.visuals.forEach(visual=>jobs.push((async()=>{
            let geometry;
            if(visual.kind==='mesh') {
              const url=new URL(`../lectures_main/assets/models/${current.robot.spec.folder}/${visual.file}`,location.href);
              const response=await fetch(url);if(!response.ok)throw Error(`Mesh ${visual.file} could not load.`);geometry=parseStlGeometry(await response.arrayBuffer());geometry.computeVertexNormals();
            } else if(visual.kind==='box')geometry=new THREE.BoxGeometry(...visual.size);
            else if(visual.kind==='sphere')geometry=new THREE.SphereGeometry(visual.radius,20,16);
            else{geometry=new THREE.CylinderGeometry(visual.radius,visual.radius,visual.length,20);geometry.rotateX(Math.PI/2);}
            const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color:0x96a9bd,transparent:true,opacity:.22,depthWrite:false,roughness:.65,metalness:.08,side:THREE.DoubleSide}));
            mesh.matrixAutoUpdate=false;mesh.matrix.copy(matrix(visual.origin));if(visual.scale)mesh.matrix.scale(vector(visual.scale));group.add(mesh);
          })()));
        });
        const results=await Promise.allSettled(jobs),failure=results.find(r=>r.status==='rejected');if(failure)throw failure.reason;
        update=poses=>nodes.forEach((node,name)=>{node.visible=!!poses[name];if(poses[name]){node.matrix.copy(matrix(poses[name]));node.matrixWorldNeedsUpdate=true;}});
      }
      if(token!==serial || disposed){release(holder);return;}
      robot.add(holder);cad={group:holder,update};loaded=0;holder.traverse(node=>{if(node.isMesh)loaded++;});loading=false;
      update(R.linkPoses(current,value?.q || []));updateBodyVisibility();styleBody();onLoad?.({loaded,loading:false,error:''});
    } catch(error){release(holder);if(token===serial&&!disposed){loading=false;loadError=error.message;onLoad?.({loaded:0,loading:false,error:loadError});}}
  }
  function updateBodyVisibility(){const visible=!!value?.showBody;robot.visible=visible;joints.visible=links.visible=visible&&loaded===0;}
  function setOpacity(node,opacity){if(!node.material)return;(Array.isArray(node.material)?node.material:[node.material]).forEach(material=>{material.opacity=opacity;material.transparent=opacity<1;material.depthWrite=opacity===1;});node.userData.unfadedOpacity=opacity;}
  function styleBody(){const context=value?.phase<3||value?.studyOffsets;robot.traverse(node=>setOpacity(node,context?CONTEXT_OPACITY:.22));links.traverse(node=>setOpacity(node,context?CONTEXT_OPACITY:(model.robot ? .18 : .55)));physical.forEach((p,i)=>setOpacity(p.cylinder,context?CONTEXT_OPACITY:(i===value?.activeJoint ? .55 : .38)));}
  function setExercise(current) {
    serial++;model=current;loaded=0;loadError='';cad=null;physical=[];poseKey='';assignmentKey='';selected=[null,null];
    [robot,joints,links,axes,supplied,assigned,normals,motion,ground,tool,measurementDrawing,taskCue].forEach(release);clearLabels();cueKey='';
    const points=[new THREE.Vector3(),...model.world.map(t=>vector(M.origin(t))),vector(M.origin(M.multiply(model.world.at(-1),model.tool)))];
    const box=new THREE.Box3().setFromPoints(points);center=box.getCenter(new THREE.Vector3());extent=Math.max(.5,box.getSize(new THREE.Vector3()).length());frameSize=extent*.095;
    fitPoints=[...points,...model.world.flatMap((t,i)=>{const origin=vector(M.origin(t)),z=vector(model.axes[i]);return [-1,1].map(sign=>origin.clone().addScaledVector(z,extent*.72*sign));})];
    home={offset:new THREE.Vector3(1.3,-1.6,1.05).normalize().multiplyScalar(extent*2.15)};
    controls.minDistance=extent*.15;controls.maxDistance=extent*12;camera.near=extent*.001;camera.far=extent*100;camera.updateProjectionMatrix();
    if(grid){scene.remove(grid);release(grid);}grid=new THREE.GridHelper(extent*2.8,20,0xcbd5df,0xe2e7ee);grid.rotation.x=Math.PI/2;scene.add(grid);
    model.frames.forEach((frame,i)=>{
      const node=new THREE.Group();node.matrixAutoUpdate=false;
      const local=vector(frame.localAxis || [0,1,2].map(j=>j===frame.axis?(frame.axisSign || 1):0));
      const cylinder=new THREE.Mesh(new THREE.CylinderGeometry(extent*.027,extent*.027,extent*.115,28),new THREE.MeshStandardMaterial({color:BLUE,transparent:true,opacity:.38,depthWrite:false,roughness:.25,side:THREE.DoubleSide}));
      cylinder.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),local);node.add(cylinder);joints.add(node);
      const axisNode=new THREE.Group();axisNode.matrixAutoUpdate=false;axisNode.add(tube(local.clone().multiplyScalar(-extent*.7),local.clone().multiplyScalar(extent*.7),extent*.0025,GOLD));axes.add(axisNode);
      const tip=new THREE.Mesh(new THREE.ConeGeometry(extent*.011,extent*.035,12),new THREE.MeshBasicMaterial({color:GOLD}));tip.position.copy(local).multiplyScalar(extent*.7);tip.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),local);axisNode.add(tip);
      const measureAxis={id:`joint:${i}:axis`,type:'line',label:`Gold z${subscript(String(i))}`,origin:[0,0,0],direction:local.toArray()};axisNode.children.forEach(node=>{node.userData.measure=measureAxis;});
      physical.push({node,cylinder,axis:axisNode});
    });
    rebuildFrames();resetView();void loadBody(current,serial);
  }
  function updateLinks(poses,q) {
    const key=JSON.stringify(q);if(key===poseKey)return;poseKey=key;release(links);
    const points=[new THREE.Vector3(),...poses.map(t=>vector(M.origin(t.before))),vector(M.origin(M.urdfFK(model,q)))];
    for(let i=0;i<points.length-1;i++){
      const from=points[i],to=points[i+1],length=from.distanceTo(to);if(length<extent*1e-6)continue;
      const j=Math.min(model.frames.length-1,Math.max(0,i-1));
      const bend=vector(M.axis(poses[j].before,model.frames[j].axis)).multiplyScalar((model.frames[j].axisSign || 1)*length*.2);
      const curve=new THREE.CubicBezierCurve3(from,from.clone().add(bend),to.clone().sub(bend),to);
      links.add(new THREE.Mesh(new THREE.TubeGeometry(curve,24,extent*.012,10,false),new THREE.MeshStandardMaterial({color:0x608ba9,transparent:true,opacity:model.robot ? .18 : .55,depthWrite:false,roughness:.5})));
    }
  }
  function update(next) {
    if(drag&&(!next.axisLocked||!next.moving||next.model.id!==model.id||next.action?.id!==value?.action?.id))finishDrag();
    value=next;if(!model||model.id!==next.model.id)setExercise(next.model);
    model=next.model;if(assignmentKey!==JSON.stringify(model.dhFrames))rebuildFrames();
    const poses=M.jointPoses(model,next.q || []);updateLinks(poses,next.q || []);
    physical.forEach((p,i)=>{const t=matrix(poses[i].before);p.node.matrix.copy(t);p.axis.matrix.copy(t);p.node.matrixWorldNeedsUpdate=p.axis.matrixWorldNeedsUpdate=true;});
    sourceFrames.forEach((frame,i)=>{frame.matrix.copy(matrix(poses[i].after));frame.matrixWorldNeedsUpdate=true;frame.visible=next.showFrames&&next.sourcePair.includes(i);});
    let prefix=model.base;
    dhFrames.forEach((frame,i)=>{if(i>0)prefix=M.multiply(prefix,M.dh({...model.rows[i-1],theta:model.rows[i-1].theta+(next.q?.[i-1] || 0)}));frame.matrix.copy(matrix(next.studyOffsets&&i===next.activeJoint?M.multiply(prefix,M.rz(next.q?.[i] || 0)):prefix));frame.matrixWorldNeedsUpdate=true;frame.visible=next.showDH&&i<next.dhCount&&next.dhPair.includes(i);});
    frameLabels.forEach(entry=>{
      const {element,parent}=entry,index=dhFrames.indexOf(parent),reference=!!next.action&&index===next.action.row;
      entry.suppressed=!!next.action&&(entry.frameName&&(index>=0||parent===motion.children[0])||physical.some(p=>p.axis===parent));
      if(index>=0&&entry.frameName)element.textContent=subscript(parent.userData.name)+(next.studyOffsets?'⁺':reference?' · start':'');
      const source=sourceFrames.indexOf(parent),joint=physical.findIndex(p=>p.axis===parent);
      element.classList.toggle('reference-label',reference||!!next.action&&physical.some(p=>p.axis===parent)||!next.studyOffsets&&source>=0&&(next.phase!==0||source!==next.activeJoint)||!next.studyOffsets&&next.phase===0&&joint>=0&&joint!==next.activeJoint);
      if(parent===motion.children[0]&&next.action){
        if(entry.frameName){element.textContent=`O${subscript(String(next.action.row))}`;entry.suppressed=next.action.rotation;}
        if(entry.axis!==undefined){const highlighted=next.action.rotation&&entry.axis===next.action.alignAxis;entry.suppressed=!next.action.rotation;element.textContent=highlighted?`${'xyz'[entry.axis]}${subscript(String(next.action.row))}`:'xyz'[entry.axis];element.classList.toggle('alignment-label',highlighted);entry.position=new THREE.Vector3().setComponent(entry.axis,frameSize*(highlighted?2.1:1.18));element.classList.toggle('reference-label',!highlighted);}
      }
    });
    updateBodyVisibility();styleBody();labels.hidden=next.showLabels===false;axes.visible=next.showAxes;
    physical.forEach((p,i)=>{p.axis.visible=next.studyOffsets?i===next.activeJoint:next.sourcePair.includes(i);});
    normals.children.forEach((g,i)=>{g.visible=next.showNormals&&i===next.activeRow;});
    physical.forEach((p,i)=>p.axis.traverse(node=>setOpacity(node,!next.studyOffsets&&(next.phase===0&&i===next.activeJoint||next.phase===1&&next.sourcePair.includes(i))?1:CONTEXT_OPACITY)));
    normals.traverse(node=>{if(!node.userData.invisibleCarrier)setOpacity(node,next.phase===1&&!next.studyOffsets?1:CONTEXT_OPACITY);});grid.traverse(node=>setOpacity(node,.025));
    ground.children.forEach(frame=>styleFrame(frame,null,next.action&&!next.action.rotation?CONTEXT_OPACITY:.18));
    motion.visible=!!next.moving;if(next.moving){motion.children[0].matrix.copy(matrix(next.moving));motion.children[0].matrixWorldNeedsUpdate=true;}
    tool.visible=measurementMode==='distance';tool.matrix.copy(matrix(M.urdfFK(model,next.q || [])));tool.matrixWorldNeedsUpdate=true;
    if(cad)cad.update(R.linkPoses(model,next.q || []));scene.updateMatrixWorld(true);updateTaskCue(next);
    [supplied,assigned,motion,taskCue,axes,normals].forEach(group=>group.traverse(node=>{if(!node.material||node.userData.invisibleCarrier)return;const opacity=node.userData.unfadedOpacity??node.material.opacity;node.userData.unfadedOpacity=opacity;node.material.opacity=opacity*(next.sceneOpacity??1);node.material.transparent=node.material.opacity<1;node.material.depthWrite=node.material.opacity===1;}));
    refreshMeasurement();
  }
  function styleFrame(frame,highlightAxis,opacity=1,contextOpacity=opacity,highlightOpacity=opacity){
    frame.children.forEach(node=>{
      if(!node.material)return;
      const axis=node.userData.frameAxis,highlighted=axis!==undefined&&axis===highlightAxis,length=highlighted?1.8:1;
      if(axis!==undefined){
        node.position.copy(node.userData.basePosition).multiplyScalar(length);
        node.scale.set(highlighted?3.4:1,node.userData.axisPart==='shaft'?length:1,highlighted?3.4:1);
      }
      const alpha=highlighted?highlightOpacity:axis!==undefined?contextOpacity:opacity;
      node.userData.unfadedOpacity=alpha;node.material.opacity=alpha;node.material.transparent=alpha<1;node.material.depthWrite=alpha===1;
      node.material.depthTest=!highlighted&&alpha===1;node.renderOrder=highlighted?18:0;
    });
  }
  function updateTaskCue(next){
    const action=next.action;
    sourceFrames.forEach((frame,i)=>styleFrame(frame,null,next.studyOffsets||next.phase===3||next.phase===0&&i===next.activeJoint?1:CONTEXT_OPACITY));
    dhFrames.forEach((frame,i)=>styleFrame(frame,action?.rotation&&i===action.row+1?action.alignAxis:null,next.studyOffsets||next.phase===3?1:CONTEXT_OPACITY,next.studyOffsets||next.phase===3?1:CONTEXT_OPACITY,1));
    styleFrame(motion.children[0],action?.rotation?action.alignAxis:null,action?.rotation?CONTEXT_OPACITY:1,CONTEXT_OPACITY,1);
    motion.children[0].children.forEach(node=>{if(node.userData.frameAxis!==undefined){node.userData.taskAxis=action?`D${node.userData.frameAxis===0?action.row+1:action.row}:axis:${node.userData.frameAxis}`:null;}});
    const key=JSON.stringify([model.id,next.studyOffsets,next.activeJoint,action,next.showDH,next.showFrames,next.q,model.dhFrames,next.motionBase]);
    if(key===cueKey)return;cueKey=key;release(taskCue);
    frameLabels=frameLabels.filter(entry=>{if(entry.transient){entry.element.remove();return false;}return true;});
    const annotate=(text,parent,position,className='')=>{label(text,parent,position,className).transient=true;};
    if(next.studyOffsets){
      const from=dhFrames[next.activeJoint],to=sourceFrames[next.activeJoint];if(!from.visible||!to.visible)return;
      const start=new THREE.Vector3().setFromMatrixPosition(from.matrixWorld),end=new THREE.Vector3().setFromMatrixPosition(to.matrixWorld);
      if(start.distanceTo(end)>extent*1e-7)taskCue.add(tube(start,end,extent*.004,0xa752b4));
      [start,end].forEach((p,i)=>{const ring=new THREE.Mesh(new THREE.SphereGeometry(extent*(i?.025:.018),12,8),new THREE.MeshBasicMaterial({color:0xa752b4,wireframe:true,depthTest:false}));ring.position.copy(p);ring.renderOrder=12;taskCue.add(ring);});
    }else if(action&&next.motionBase){
      const transform=matrix(next.motionBase),origin=new THREE.Vector3().setFromMatrixPosition(transform),direction=new THREE.Vector3().setComponent(action.axis,1).transformDirection(transform),cueColor=action.axis===0?NORMAL_BROWN:GOLD;
      const g=new THREE.Group();g.position.copy(origin);arrow(g,direction,frameSize*1.65,cueColor,extent*.008);g.children.forEach(node=>{node.userData.taskAxis=action.id;});taskCue.add(g);
      annotate(`${'xyz'[action.axis]}${subscript(String(action.frame))}`,g,direction.clone().multiplyScalar(frameSize*1.8),`axis-label ${action.axis===0?'brown':'gold'}-label alignment-label${action.rotation?'':' reference-label'}`);
      if(action.rotation){
        annotate(`${'xyz'[action.alignAxis]}${subscript(String(action.row+1))}`,dhFrames[action.row+1],new THREE.Vector3().setComponent(action.alignAxis,frameSize*2.1),'axis-label alignment-label');
      }else{
        const target=action.key==='d'?vector(model.normals[action.row].start):new THREE.Vector3().setFromMatrixPosition(dhFrames[action.row+1].matrixWorld);
        const dot=new THREE.Mesh(new THREE.SphereGeometry(extent*.022,16,12),new THREE.MeshBasicMaterial({color:NORMAL_BROWN,depthTest:false}));dot.position.copy(target);dot.userData.targetPoint=true;taskCue.add(dot);
        annotate(`${action.key==='d'?'P':'O'}${subscript(String(action.row+1))}`,taskCue,target.clone().add(new THREE.Vector3(0,0,frameSize*.2)),'alignment-label brown-label');
      }
      taskCue.traverse(node=>setOpacity(node,action.rotation||node.userData.targetPoint?1:CONTEXT_OPACITY));
    }
    taskCue.traverse(node=>{if(node.material){node.material.depthTest=false;node.renderOrder=13;}});
  }
  function updateLabels() {
    const width=stage.clientWidth,height=stage.clientHeight;
    frameLabels.forEach(({element,parent,position,suppressed})=>{
      let visible=!suppressed;for(let node=parent;node;node=node.parent)if(!node.visible){visible=false;break;}
      const teaching=[supplied,assigned,motion,taskCue,axes,normals].some(group=>{for(let node=parent;node;node=node.parent)if(node===group)return true;return false;});element.style.opacity=String((teaching?(value?.sceneOpacity??1):1)*(element.classList.contains('reference-label')?CONTEXT_OPACITY:1));
      const p=position.clone().applyMatrix4(parent.matrixWorld).project(camera);visible=visible&&Math.abs(p.x)<.98&&Math.abs(p.y)<.96&&p.z>-1&&p.z<1;element.hidden=!visible;
      if(visible){
        const groundLabel=parent.userData.name==='O';
        const offsetY=groundLabel?20:value?.studyOffsets?(sourceFrames.includes(parent)?-14:dhFrames.includes(parent)?6:0):0;
        element.style.transform=`translate(${(p.x+1)*width/2+(groundLabel?-18:0)}px,${(1-p.y)*height/2+offsetY}px)`;
      }
    });
  }
  function updateCompass(){
    const inverse=camera.quaternion.clone().invert();
    compass.forEach((group,i)=>{
      const d=new THREE.Vector3().setComponent(i,1).applyQuaternion(inverse),x=40+d.x*26,y=40-d.y*26;
      const line=group.querySelector('line'),dot=group.querySelector('circle'),text=group.querySelector('text');
      // Keep the current side near vertical, where projection rounding changes sign.
      const anchor=Math.abs(d.x)>.05?(d.x>0?'start':'end'):(text.getAttribute('text-anchor') || 'start');
      line.setAttribute('x2',x);line.setAttribute('y2',y);dot.setAttribute('cx',x);dot.setAttribute('cy',y);
      text.setAttribute('x',x+(anchor==='start'?5:-5));text.setAttribute('y',y-3);text.setAttribute('text-anchor',anchor);
    });
  }
  function resize(){const w=Math.max(1,stage.clientWidth),h=Math.max(1,stage.clientHeight);renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();if(needsFit&&stage.clientWidth&&stage.clientHeight)resetView();}
  const observer=new ResizeObserver(resize);observer.observe(stage);resize();
  function animate(){if(disposed)return;if(stage.clientWidth&&stage.clientHeight){controls.update();scene.updateMatrixWorld(true);updateLabels();updateCompass();renderer.render(scene,camera);}animation=requestAnimationFrame(animate);}animation=requestAnimationFrame(animate);
  const raycaster=new THREE.Raycaster();let down=null;
  function pointerRay(event){const rect=canvas.getBoundingClientRect();raycaster.setFromCamera(new THREE.Vector2((event.clientX-rect.x)/rect.width*2-1,-(event.clientY-rect.y)/rect.height*2+1),camera);return raycaster.ray;}
  function screenPoint(point){const p=point.clone().project(camera),rect=canvas.getBoundingClientRect();return new THREE.Vector2((p.x+1)*rect.width/2,(1-p.y)*rect.height/2);}
  function finishDrag(event){
    if(!drag)return;const id=drag.id;drag=null;down=null;controls.enabled=true;
    if(canvas.hasPointerCapture(id))canvas.releasePointerCapture(id);
    canvas.style.cursor=measurementMode?'crosshair':value?.axisLocked?'grab':'';
    if(event){event.preventDefault();event.stopImmediatePropagation();}
  }
  function movingFrameHit(event){
    const hit=raycaster.intersectObjects([motion,taskCue],true).find(hit=>isVisible(hit.object)&&(hit.object.userData.frameAxis!==undefined&&motion.children[0].children.includes(hit.object)||hit.object.userData.dragHandle));
    if(hit)return hit;
    // Give the purple arrows a comfortable touch target without changing their size.
    const rect=canvas.getBoundingClientRect(),pointer=new THREE.Vector2(event.clientX-rect.x,event.clientY-rect.y),origin=new THREE.Vector3().setFromMatrixPosition(motion.children[0].matrixWorld),start=screenPoint(origin),radius=event.pointerType==='touch'?18:9;
    let closest=null,distance=radius;
    [0,1,2].forEach(axis=>{
      const highlighted=axis===(value.action.alignAxis??value.action.axis),end=new THREE.Vector3().setComponent(axis,frameSize*(highlighted?1.8:1)).applyMatrix4(motion.children[0].matrixWorld),line=screenPoint(end).sub(start),offset=pointer.clone().sub(start),t=line.lengthSq()?THREE.MathUtils.clamp(offset.dot(line)/line.lengthSq(),0,1):0,pixel=start.clone().addScaledVector(line,t),gap=pixel.distanceTo(pointer);
      if(gap<distance){distance=gap;closest={point:origin.clone().lerp(end,t)};}
    });return closest;
  }
  canvas.addEventListener('pointerdown',event=>{
    if(drag){if(drag.id!==event.pointerId)finishDrag();return;}
    if(event.button!==0||measurementMode||!value?.axisLocked||!motion.visible||!value.action)return;
    pointerRay(event);const hit=movingFrameHit(event);
    if(!hit)return;
    // Consume this gesture before OrbitControls; empty-space drags still orbit.
    event.preventDefault();event.stopImmediatePropagation();canvas.focus({preventScroll:true});
    controls.enableDamping=false;controls.update();controls.enableDamping=true;controls.enabled=false;
    const transform=matrix(value.motionBase),origin=new THREE.Vector3().setFromMatrixPosition(transform),axis=new THREE.Vector3().setComponent(value.action.axis,1).transformDirection(transform);
    const currentRay=pointerRay(event),startValue=value.motionValue;
    drag={id:event.pointerId,origin,axis,startValue,startX:event.clientX,startY:event.clientY,actionId:value.action.id,total:0};
    if(value.action.rotation){
      const plane=new THREE.Plane().setFromNormalAndCoplanarPoint(axis,origin),point=currentRay.intersectPlane(plane,new THREE.Vector3()),radial=point?.sub(origin);
      if(radial&&radial.length()>frameSize*.15&&Math.abs(currentRay.direction.dot(axis))>.15){drag.mode='rotation-plane';drag.plane=plane;drag.radial=radial;}
      else{
        let radius=hit.point.clone().sub(origin);radius.addScaledVector(axis,-radius.dot(axis));if(radius.length()<frameSize*.15)radius=new THREE.Vector3().setComponent(value.action.alignAxis,frameSize).transformDirection(matrix(value.moving)).multiplyScalar(frameSize);
        const tangent=axis.clone().cross(radius),projection=screenPoint(origin.clone().add(tangent)).sub(screenPoint(origin));
        if(projection.length()<4){const projectedAxis=screenPoint(origin.clone().addScaledVector(axis,frameSize)).sub(screenPoint(origin));projection.set(-projectedAxis.y,projectedAxis.x);if(projection.length()<4)projection.set(40,0);}
        drag.mode='rotation-tangent';drag.pixelsPerRadian=Math.max(24,projection.length());drag.screenDirection=projection.normalize();
      }
    }else{
      const parameter=Drag.axisParameter(currentRay.origin.toArray(),currentRay.direction.toArray(),origin.toArray(),axis.toArray());
      if(parameter!==null&&Math.abs(currentRay.direction.dot(axis))<.985){drag.mode='translation-line';drag.parameter=parameter;}
      else{
        const projection=screenPoint(origin.clone().addScaledVector(axis,frameSize)).sub(screenPoint(origin)),length=projection.length();
        drag.mode='translation-screen';drag.screenDirection=length>3?projection.normalize():new THREE.Vector2(0,-1);
        drag.pixelsPerUnit=length>3?length/frameSize:stage.clientHeight/(2*camera.position.distanceTo(origin)*Math.tan(THREE.MathUtils.degToRad(camera.fov/2)));
      }
    }
    const worldPerPixel=2*camera.position.distanceTo(origin)*Math.tan(THREE.MathUtils.degToRad(camera.fov/2))/stage.clientHeight;
    const radiusPixels=screenPoint(hit.point).distanceTo(screenPoint(origin));
    drag.snapTolerance=value.action.rotation?THREE.MathUtils.clamp(2/Math.max(20,radiusPixels),.015,.08):worldPerPixel*2;
    down=null;canvas.setPointerCapture(event.pointerId);canvas.style.cursor='grabbing';
  },true);
  canvas.addEventListener('pointermove',event=>{
    if(!drag||drag.id!==event.pointerId)return;event.preventDefault();event.stopImmediatePropagation();
    const ray=pointerRay(event);let delta;
    if(drag.mode==='rotation-plane'){
      const point=ray.intersectPlane(drag.plane,new THREE.Vector3());if(!point)return;point.sub(drag.origin);if(point.length()<frameSize*.1)return;
      const increment=Drag.rotationDelta(drag.radial.toArray(),point.toArray(),drag.axis.toArray());if(increment===null)return;drag.total+=increment;drag.radial=point;delta=drag.total;
    }else if(drag.mode==='translation-line'){
      const parameter=Drag.axisParameter(ray.origin.toArray(),ray.direction.toArray(),drag.origin.toArray(),drag.axis.toArray());if(parameter===null)return;delta=parameter-drag.parameter;
    }else{
      const pixels=(event.clientX-drag.startX)*drag.screenDirection.x+(event.clientY-drag.startY)*drag.screenDirection.y;
      delta=pixels/(drag.mode==='rotation-tangent'?drag.pixelsPerRadian:drag.pixelsPerUnit);
    }
    const next=drag.startValue+delta;if(Number.isFinite(next))onDrag?.(next,{snapTolerance:drag.snapTolerance});
  },true);
  ['pointerup','pointercancel'].forEach(type=>canvas.addEventListener(type,event=>{if(drag?.id===event.pointerId)finishDrag(event);},true));
  canvas.addEventListener('lostpointercapture',event=>{if(drag?.id===event.pointerId)finishDrag();},true);
  function hitFeature(event) {
    const rect=canvas.getBoundingClientRect();raycaster.setFromCamera(new THREE.Vector2((event.clientX-rect.x)/rect.width*2-1,-(event.clientY-rect.y)/rect.height*2+1),camera);
    const hits=raycaster.intersectObjects([ground,supplied,assigned,axes,normals,tool],true).filter(hit=>hit.object.userData.measure&&isVisible(hit.object)&&(measurementMode!=='angle'||hit.object.userData.measure.type==='line'));
    if(measurementMode==='distance')hits.sort((a,b)=>(a.object.userData.measure.type==='point'?0:1)-(b.object.userData.measure.type==='point'?0:1)||a.distance-b.distance);
    return hits[0]?.object.userData.measure.id;
  }
  canvas.addEventListener('pointerdown',event=>{down={x:event.clientX,y:event.clientY,id:event.pointerId,moved:false,multi:(controls._pointers?.length || 0)>1};canvas.focus({preventScroll:true});});
  canvas.addEventListener('pointermove',event=>{if(down){if(Math.hypot(event.clientX-down.x,event.clientY-down.y)>5)down.moved=true;return;}if(measurementMode){const hit=features.get(hitFeature(event));canvas.title=hit?hit.data.label:'Click an origin dot or axis to measure.';}else if(value?.axisLocked&&motion.visible){pointerRay(event);const hit=movingFrameHit(event);canvas.style.cursor=hit?'grab':'';canvas.title=hit?'Drag this purple frame along/about the selected axis.':'Drag empty space to orbit.';}});
  canvas.addEventListener('pointerup',event=>{
    if(!down||down.id!==event.pointerId||down.moved||down.multi||event.button!==0||Math.hypot(event.clientX-down.x,event.clientY-down.y)>5){down=null;return;}down=null;
    if(measurementMode){const hit=hitFeature(event);if(hit){if(selected.every(Boolean))selected=[hit,null];else selected[selected[0]?1:0]=hit;refreshMeasurement();}return;}
    if(value?.action){
      const rect=canvas.getBoundingClientRect();raycaster.setFromCamera(new THREE.Vector2((event.clientX-rect.x)/rect.width*2-1,-(event.clientY-rect.y)/rect.height*2+1),camera);
      const hit=raycaster.intersectObjects([assigned,taskCue,motion,axes,normals],true).find(hit=>isVisible(hit.object)&&(hit.object.userData.taskAxis||hit.object.userData.measure?.type==='line'));
      if(hit)onTaskAxis?.(hit.object.userData.taskAxis || hit.object.userData.measure.id);return;
    }
    if(!value?.selectable)return;
    const rect=canvas.getBoundingClientRect();raycaster.setFromCamera(new THREE.Vector2((event.clientX-rect.x)/rect.width*2-1,-(event.clientY-rect.y)/rect.height*2+1),camera);
    const hits=raycaster.intersectObjects(sourceFrames,true).filter(hit=>hit.object.userData.pick&&isVisible(hit.object));if(hits.length){const pick=hits[0].object.userData.pick;onAxis(pick.frame,pick.axis);}
  });
  canvas.addEventListener('pointercancel',()=>{down=null;});canvas.addEventListener('lostpointercapture',()=>{down=null;});
  canvas.addEventListener('keydown',event=>{if(event.key==='Escape'&&drag){event.preventDefault();finishDrag();}if(event.key==='Home'){event.preventDefault();finishDrag();resetView();}});
  function dispose(){if(disposed)return;finishDrag();disposed=true;serial++;cancelAnimationFrame(animation);observer.disconnect();controls.dispose();clearLabels();[robot,joints,links,axes,supplied,assigned,normals,motion,ground,tool,measurementDrawing,taskCue].forEach(release);if(grid)release(grid);renderer.dispose();}
  function opacities(group){const result=[];group.traverse(node=>{if(node.material)result.push(...(Array.isArray(node.material)?node.material:[node.material]).map(material=>material.opacity));});return result;}
  window.addEventListener('pagehide',event=>{if(!event.persisted)dispose();});
  return {update,view:resetView,measure,selectMeasurement,dispose,diagnostics:()=>({camera:camera.position.toArray(),up:camera.up.toArray(),target:controls.target.toArray(),distance:controls.getDistance(),pointers:controls._pointers?.length || 0,
    controls:controls.constructor.name,joints:physical.length,jointOpacity:physical.map(p=>p.cylinder.material.opacity),goldAxes:axes.children.length,axisColor:GOLD,axisMaterial:axes.children[0]?.children[0].material.type,
    links:links.children.length,cadMeshes:loaded,bodyRepresentation:loaded>0?'cad':'generated',loading,error:loadError,frames:sourceFrames.filter(f=>f.visible).length+dhFrames.filter(f=>f.visible).length,
    bodyTransparent:!!cad&&(()=>{const materials=[];cad.group.traverse(node=>{if(node.isMesh)materials.push(...(Array.isArray(node.material)?node.material:[node.material]));});return materials.length>0&&materials.every(m=>m.transparent&&m.opacity>0&&m.opacity<1);})(),
    layers:{body:robot.visible,joints:joints.visible,links:links.visible,axes:axes.visible,supplied:sourceFrames.some(f=>f.visible),assigned:dhFrames.some(f=>f.visible),ground:ground.visible},groundOrigin:[0,0,0],measurement:structuredClone(measurementInfo),
    visibleFrames:[...sourceFrames,...dhFrames].filter(f=>f.visible).map(f=>f.userData.name),visibleGoldAxes:physical.flatMap((p,i)=>p.axis.visible&&axes.visible?[i]:[]),highlight:value?.action || null,offsetMode:!!value?.studyOffsets,
    sceneOpacity:value?.sceneOpacity??1,rotationRings:taskCue.children.filter(node=>node.geometry?.type==='TorusGeometry').length,
    labelsVisible:!labels.hidden,contextOpacities:{body:opacities(robot),links:opacities(links),grid:opacities(grid),jointAxes:physical.map(p=>p.axis.children[0].material.opacity),supplied:sourceFrames.map(frame=>frame.children[0].material.opacity)},
    originHighlightOpacities:value?.action&&!value.action.rotation?{moving:motion.children[0].children.find(node=>node.userData.dragHandle)?.material.opacity,target:taskCue.children.find(node=>node.userData.targetPoint)?.material.opacity}:null,
    alignmentAxisOpacities:value?.action?{moving:motion.children[0].children.filter(node=>node.userData.axisPart==='shaft').map(node=>node.material.opacity),target:dhFrames[value.action.row+1].children.filter(node=>node.userData.axisPart==='shaft').map(node=>node.material.opacity),operation:taskCue.children[0]?.children[0]?.material.opacity}:null,
    manipulation:(()=>{if(!value?.action||!motion.visible)return {locked:false,dragging:false};const action=value.action,t=matrix(value.motionBase),origin=new THREE.Vector3().setFromMatrixPosition(t),direction=new THREE.Vector3().setComponent(action.axis,1).transformDirection(t),local=action.rotation?new THREE.Vector3().setComponent(action.alignAxis,frameSize*1.8*.75):new THREE.Vector3(),world=local.applyMatrix4(motion.children[0].matrixWorld),pixel=screenPoint(world);return {locked:!!value.axisLocked,dragging:!!drag,mode:drag?.mode || null,cameraEnabled:controls.enabled,value:value.motionValue,origin:origin.toArray(),direction:direction.toArray(),handle:{x:pixel.x,y:pixel.y,world:world.toArray()},axisOpacity:axes.children[0]?.children[0].material.opacity,normalOpacity:normals.children[value.activeRow]?.children[0]?.material.opacity};})(),
    frameOffset:value?.studyOffsets?new THREE.Matrix4().copy(dhFrames[value.activeJoint].matrixWorld).invert().multiply(sourceFrames[value.activeJoint].matrixWorld).toArray():null,
    measurementPicks:measurementInfo.options.map(feature=>{const p=vector(feature.origin);if(feature.direction)p.addScaledVector(vector(feature.direction),frameSize*.72);p.project(camera);return {id:feature.id,x:(p.x+1)*stage.clientWidth/2,y:(1-p.y)*stage.clientHeight/2};}),moving:motion.visible?motion.children[0].matrix.toArray():null,
    picks:sourceFrames.flatMap((group,i)=>[0,1,2].map(axis=>{const p=new THREE.Vector3().setComponent(axis,frameSize*.72).applyMatrix4(group.matrixWorld).project(camera);return {frame:i,axis,visible:group.visible,x:(p.x+1)*stage.clientWidth/2,y:(1-p.y)*stage.clientHeight/2};}))})};
}
