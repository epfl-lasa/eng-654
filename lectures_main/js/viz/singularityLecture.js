import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createZUpWorld, resizeRendererToContainer } from './threeUtils.js';
import { parseStlGeometry } from './frameDHPlayground.js?v=20260814-3';

const DEG = Math.PI / 180;
const COLORS = [0xff2020, 0x2d73d5, 0x68a84f, 0xd79b00, 0x9673a6, 0x00a0a0];
const BUILT_INS = {
  'custom 3R': new URL('../../assets/models/custom_3R/custom_3R_new.urdf', import.meta.url),
  'custom 6R': new URL('../../assets/models/custom_6R/custom_6R_new.urdf', import.meta.url)
};
const SYMBOLIC_DH = {
  threeROffset: String.raw`\det J_p=\frac{3}{4}(3c_3+4)\left[c_2(c_3-2s_3)-s_3\right]`,
  threeRIntersecting: String.raw`\det J_p=\frac{3}{4}(3c_3+4)c_2(c_3-2s_3)`,
  preferentialLinear: String.raw`{}^3J_{5,v}=\begin{bmatrix}
  -s_\alpha(a_1s_3+a_2c_2s_3+d_4c_2)&c_\alpha(a_2s_3+d_4)&d_4&0&0&0\\
  -c_\alpha(a_1+a_2c_2+a_3c_2c_3+d_4c_2s_3)+s_2(a_3s_3-d_4c_3)&-s_\alpha(a_2+a_3c_3+d_4s_3)&0&0&0&0\\
  s_\alpha(a_1c_3+a_2c_2c_3+a_3c_2)&-c_\alpha(a_2c_3+a_3)&-a_3&0&0&0
  \end{bmatrix}`,
  preferentialAngular: String.raw`{}^3J_{5,\omega}=\begin{bmatrix}
  s_2c_3+c_\alpha c_2s_3&s_\alpha s_3&0&0&s_4&c_4s_5\\
  -s_\alpha c_2&c_\alpha&1&0&-c_4&s_4s_5\\
  s_2s_3-c_\alpha c_2c_3&-s_\alpha c_3&0&1&0&-c_5
  \end{bmatrix}`,
  preferentialDet: String.raw`\det({}^3J_5)=(d_4c_3-a_3s_3)\,G(q_2,q_3)\,s_5`,
  preferentialG: String.raw`G=a_1a_2+a_1s_\alpha^2(a_3c_3+d_4s_3)+a_2c_2(a_2+a_3c_3+d_4s_3)+a_2s_2c_\alpha(d_4c_3-a_3s_3)`
};

export function initSingularityLecture() {
  bindSymbolicDisplays();
  const hosts = [...document.querySelectorAll('[data-singularity-lab]')];
  if (!hosts.length) return;
  const instances = new WeakMap();
  const ensure = (host) => {
    if (instances.has(host)) return;
    try { instances.set(host, createLab(host)); }
    catch (error) { host.innerHTML = `<div class="warning">Visualization error: ${escapeHtml(error.message)}</div>`; console.error(error); }
  };
  const observer = new IntersectionObserver((entries) => entries.forEach((entry) => {
    if (entry.isIntersecting) ensure(entry.target);
  }), { threshold: .025, rootMargin: '120px' });
  hosts.forEach((host) => observer.observe(host));
  const syncHash = () => {
    const n = Number(location.hash.match(/#slide-(\d+)/)?.[1] || 1);
    document.querySelectorAll('#deck > .slide')[n - 1]?.querySelectorAll('[data-singularity-lab]').forEach(ensure);
  };
  syncHash();
  window.addEventListener('hashchange', syncHash);
  runDevelopmentChecks();
  runRequestedSymbolicChecks();
}

function bindSymbolicDisplays(){const nodes=[...document.querySelectorAll('[data-symbolic-dh]')];nodes.forEach(node=>{const expression=SYMBOLIC_DH[node.dataset.symbolicDh];if(expression)node.textContent=`\\[${expression}\\]`;});if(nodes.length&&window.MathJax?.typesetPromise)window.MathJax.typesetPromise(nodes).catch(error=>console.error('Symbolic D–H typesetting failed:',error));}

function createLab(host) {
  const mode = host.dataset.singularityLab;
  if (mode === 'two-r') return create2RLab(host);
  if (mode === 'map-3r') return create3RMap(host);
  if (mode === 'builder') return createBuilder(host);
  return createThreeLab(host, mode);
}

function create2RLab(host) {
  host.className += ' sing-lab';
  host.innerHTML = `<div class="sing-stage"><canvas></canvas><div class="sing-hud">Drag the red EE · y is up</div></div>
    <aside class="sing-panel"><h3>Planar 2R Jacobian</h3><div class="sing-controls"></div>
    <div class="sing-metric"><span>det(J)</span><strong data-det></strong></div>
    <div class="sing-metric"><span>|det(J)|</span><strong data-abs></strong></div>
    <label class="sing-toggle"><input type="checkbox" data-ellipse checked> velocity ellipse</label>
    <div class="sing-formula" data-matrix></div><p>Threshold shown: near singular when |det J| &lt; 0.08 m².</p>
    <div class="sing-legend"><span><i style="background:#ff2020"></i>J₁</span><span><i style="background:#2d73d5"></i>J₂</span></div></aside>`;
  const canvas = host.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const controls = host.querySelector('.sing-controls');
  const state = { q1: 35 * DEG, q2: 70 * DEG, l1: 1.15, l2: .9 };
  ['q1','q2'].forEach((key, i) => addRange(controls, `q${i + 1}`, -180, 180, 1, state[key] / DEG, (v) => { state[key] = v * DEG; draw(); }));
  ['l1','l2'].forEach((key, i) => addRange(controls, `l${i + 1}`, .35, 1.5, .05, state[key], (v) => { state[key] = v; draw(); }, ' m'));
  let size = [1, 1];
  const resize = () => { const dpr = Math.min(devicePixelRatio || 1, 2); size = [canvas.clientWidth, canvas.clientHeight]; canvas.width = size[0] * dpr; canvas.height = size[1] * dpr; ctx.setTransform(dpr,0,0,dpr,0,0); draw(); };
  const ro = new ResizeObserver(resize); ro.observe(canvas);
  const point = () => ({ x: state.l1 * Math.cos(state.q1) + state.l2 * Math.cos(state.q1 + state.q2), y: state.l1 * Math.sin(state.q1) + state.l2 * Math.sin(state.q1 + state.q2) });
  const jac = () => {
    const s1 = Math.sin(state.q1), c1 = Math.cos(state.q1), s12 = Math.sin(state.q1 + state.q2), c12 = Math.cos(state.q1 + state.q2);
    return [[-state.l1*s1-state.l2*s12,-state.l2*s12],[state.l1*c1+state.l2*c12,state.l2*c12]];
  };
  function draw() {
    const [w,h] = size; if (!w || !h) return;
    ctx.clearRect(0,0,w,h); const scale = Math.min(w,h) / 5.4; const ox = w*.5, oy = h*.54;
    const xy = (p) => [ox+p.x*scale,oy-p.y*scale];
    ctx.strokeStyle='#d9d9d9'; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(0,oy); ctx.lineTo(w,oy); ctx.moveTo(ox,0); ctx.lineTo(ox,h); ctx.stroke();
    const elbow = {x:state.l1*Math.cos(state.q1),y:state.l1*Math.sin(state.q1)}, ee = point();
    const pts = [{x:0,y:0},elbow,ee].map(xy); ctx.strokeStyle='#151515'; ctx.lineWidth=12; ctx.lineCap='round'; ctx.beginPath(); ctx.moveTo(...pts[0]); ctx.lineTo(...pts[1]); ctx.lineTo(...pts[2]); ctx.stroke();
    pts.forEach((p,i) => { ctx.beginPath(); ctx.arc(...p,i===2?9:7,0,Math.PI*2); ctx.fillStyle=i===2?'#ff2020':'#fff'; ctx.fill(); ctx.strokeStyle='#111'; ctx.lineWidth=3; ctx.stroke(); });
    const J = jac(), det = determinant(J); drawVector(ctx,pts[2],[J[0][0],-J[1][0]],COLORS[0],scale*.42,'J₁'); drawVector(ctx,pts[2],[J[0][1],-J[1][1]],COLORS[1],scale*.42,'J₂');
    if (host.querySelector('[data-ellipse]').checked) drawEllipse(ctx, pts[2], J, scale*.34);
    host.querySelector('[data-det]').textContent = signed(det,4); host.querySelector('[data-abs]').textContent = Math.abs(det).toFixed(4);
    host.querySelectorAll('.sing-metric').forEach((e) => e.classList.toggle('near',Math.abs(det)<.08));
    host.querySelector('[data-matrix]').textContent = matrixText(J,3);
  }
  host.querySelector('[data-ellipse]').addEventListener('change',draw);
  let dragging=false;
  canvas.addEventListener('pointerdown',(e)=>{dragging=true; canvas.setPointerCapture(e.pointerId); drag(e);});
  canvas.addEventListener('pointermove',(e)=>{if(dragging) drag(e);}); canvas.addEventListener('pointerup',()=>{dragging=false;});
  function drag(e) {
    const rect=canvas.getBoundingClientRect(), scale=Math.min(size[0],size[1])/5.4;
    let x=(e.clientX-rect.left-size[0]*.5)/scale, y=-(e.clientY-rect.top-size[1]*.54)/scale;
    const r=Math.hypot(x,y), max=state.l1+state.l2-.001, min=Math.abs(state.l1-state.l2)+.001, rr=Math.max(min,Math.min(max,r)); x*=rr/(r||1); y*=rr/(r||1);
    const c2=clamp((x*x+y*y-state.l1**2-state.l2**2)/(2*state.l1*state.l2),-1,1); state.q2=Math.acos(c2); state.q1=Math.atan2(y,x)-Math.atan2(state.l2*Math.sin(state.q2),state.l1+state.l2*Math.cos(state.q2)); syncRanges(controls,state); draw();
  }
  resize(); return { dispose(){ro.disconnect();} };
}

function drawEllipse(ctx, origin, J, scale) {
  const a=J[0][0]**2+J[0][1]**2,b=J[0][0]*J[1][0]+J[0][1]*J[1][1],d=J[1][0]**2+J[1][1]**2;
  const tr=a+d, disc=Math.sqrt((a-d)**2+4*b*b), l1=Math.max(0,(tr+disc)/2), l2=Math.max(0,(tr-disc)/2), phi=.5*Math.atan2(2*b,a-d);
  ctx.save(); ctx.translate(...origin); ctx.rotate(-phi); ctx.strokeStyle='rgba(130,179,102,.9)'; ctx.lineWidth=3; ctx.setLineDash([5,4]); ctx.beginPath(); ctx.ellipse(0,0,Math.sqrt(l1)*scale,Math.sqrt(l2)*scale,0,0,Math.PI*2); ctx.stroke(); ctx.restore();
}

function drawVector(ctx, origin, vector, color, scale, label) {
  const x=vector[0]*scale,y=vector[1]*scale, n=Math.hypot(x,y)||1, ux=x/n,uy=y/n;
  ctx.strokeStyle=`#${new THREE.Color(color).getHexString()}`; ctx.fillStyle=ctx.strokeStyle; ctx.lineWidth=4; ctx.beginPath(); ctx.moveTo(...origin); ctx.lineTo(origin[0]+x,origin[1]+y); ctx.stroke(); ctx.beginPath(); ctx.moveTo(origin[0]+x,origin[1]+y); ctx.lineTo(origin[0]+x-12*ux+6*uy,origin[1]+y-12*uy-6*ux); ctx.lineTo(origin[0]+x-12*ux-6*uy,origin[1]+y-12*uy+6*ux); ctx.fill(); ctx.font='700 13px Arial'; ctx.fillText(label,origin[0]+x+5,origin[1]+y-5);
}

function createThreeLab(host, mode) {
  host.className += ' sing-lab';
  host.innerHTML = `<div class="sing-stage"><div class="sing-hud"></div></div><aside class="sing-panel"><h3></h3><div class="sing-controls"></div><div class="sing-selects"></div><div class="sing-metric"><span>det(J)</span><strong data-det>—</strong></div><div class="sing-formula l5-matrix" data-matrix></div><p class="sing-status"></p></aside>`;
  const stage=host.querySelector('.sing-stage'), panel=host.querySelector('.sing-panel'), hud=host.querySelector('.sing-hud');
  const kit=createWorld(stage); kit.host=host; kit.panel=panel; kit.hud=hud;
  let setup;
  if(mode==='screw') setup=setupScrewLab(kit);
  else if(mode==='dh-3r') setup=setupDhLab(kit);
  else if(mode==='three-r') setup=setupUrdfJacobianLab(kit,'custom 3R');
  else if(mode==='six-r') setup=setupUrdfJacobianLab(kit,'custom 6R');
  else setup=Promise.resolve();
  setup.catch((error)=>{panel.querySelector('.sing-status').textContent=error.message; panel.querySelector('.sing-status').classList.add('error'); console.error(error);});
  return kit;
}

function createWorld(stage) {
  const scene=new THREE.Scene(); scene.background=new THREE.Color(0xf6f7f8); const camera=new THREE.PerspectiveCamera(42,1,.01,200); const renderer=new THREE.WebGLRenderer({antialias:true}); renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.8)); renderer.outputColorSpace=THREE.SRGBColorSpace; stage.insertBefore(renderer.domElement,stage.firstChild);
  scene.add(new THREE.HemisphereLight(0xffffff,0x59636e,2.4)); const dl=new THREE.DirectionalLight(0xffffff,2.2); dl.position.set(7,10,11); scene.add(dl); const world=createZUpWorld(scene); const grid=new THREE.GridHelper(14,28,0xbfc3c7,0xe2e4e6); grid.rotation.x=Math.PI/2; world.add(grid);
  camera.position.set(8,7,6); const controls=new OrbitControls(camera,renderer.domElement); controls.enableDamping=true;
  // Robot coordinates are z-up inside a root rotated by Rx(-pi/2). OrbitControls
  // targets scene coordinates, so (x,y,z)_robot maps to (x,z,-y)_scene.
  controls.target.set(2,1.2,0); controls.update();
  let needs=true, raf=0; const render=()=>{needs=true;renderer.render(scene,camera);if(!raf)raf=requestAnimationFrame(frame);}; function frame(){raf=0;if(!needs)return;needs=false;controls.update();renderer.render(scene,camera);if(controls.enableDamping)render();}
  controls.addEventListener('change',render); const ro=new ResizeObserver(()=>{resizeRendererToContainer(renderer,camera,stage);render();});ro.observe(stage);resizeRendererToContainer(renderer,camera,stage);render();
  return {scene,camera,renderer,world,controls,render,dispose(){ro.disconnect();controls.dispose();renderer.dispose();cancelAnimationFrame(raf);}};
}

function setupScrewLab(kit) {
  const {panel,world}=kit; panel.querySelector('h3').textContent='One joint → one screw column'; panel.querySelector('[data-det]').parentElement.remove(); panel.querySelector('[data-matrix]').textContent=''; kit.hud.textContent='Drag the red point · orbit the world';
  const controls=panel.querySelector('.sing-controls'); const state={angle:25*DEG,px:2.4,py:.8,pz:1.1}; addRange(controls,'axis tilt',-80,80,1,state.angle/DEG,(v)=>{state.angle=v*DEG;update();}); addRange(controls,'point z',.1,2.8,.05,state.pz,(v)=>{state.pz=v;update();},' m');
  const dynamic=new THREE.Group();world.add(dynamic); const ray=new THREE.Raycaster(),mouse=new THREE.Vector2(),plane=new THREE.Plane(new THREE.Vector3(0,0,1),-state.pz); let dragging=false;
  kit.renderer.domElement.addEventListener('pointerdown',(e)=>{dragging=true;kit.controls.enabled=false;kit.renderer.domElement.setPointerCapture(e.pointerId);drag(e);});kit.renderer.domElement.addEventListener('pointermove',(e)=>{if(dragging)drag(e);});kit.renderer.domElement.addEventListener('pointerup',()=>{dragging=false;kit.controls.enabled=true;});
  function drag(e){const r=kit.renderer.domElement.getBoundingClientRect();mouse.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);ray.setFromCamera(mouse,kit.camera);const hit=new THREE.Vector3();plane.constant=-state.pz;if(ray.ray.intersectPlane(plane,hit)){state.px=hit.x;state.py=hit.y;update();}}
  function update(){clearGroup(dynamic);const z=new THREE.Vector3(Math.sin(state.angle),0,Math.cos(state.angle)).normalize(),pk=new THREE.Vector3(0,0,.4),p=new THREE.Vector3(state.px,state.py,state.pz),r=p.clone().sub(pk),v=z.clone().cross(r); addAxisLine(dynamic,pk,z,4,COLORS[1]);addArrow(dynamic,pk,z,1.25,COLORS[1]);addArrow(dynamic,pk,r,1,COLORS[3]);addArrow(dynamic,p,v,1,COLORS[0]);dynamic.add(sphere(p,.11,COLORS[0]));panel.querySelector('[data-matrix]').textContent=`Jₖ = [ v ; ω ]\n   = [ ${vec(v)} ; ${vec(z)} ]`;panel.querySelector('.sing-status').textContent='Move p: the moment v = z × (p − pₖ) changes; the angular part ω = z does not.';kit.render();}
  update(); return Promise.resolve();
}

async function setupDhLab(kit) {
  const panel=kit.panel; panel.querySelector('h3').textContent='Editable D–H + draggable EE'; kit.hud.textContent='Drag the red EE in the camera plane'; const state={q:[20,-35,55].map(x=>x*DEG),rows:[[1,-90*DEG,1],[2,90*DEG,1.25],[1.5,0,.75]]};
  const controls=panel.querySelector('.sing-controls'); state.q.forEach((q,i)=>addRange(controls,`q${i+1}`,-180,180,1,q/DEG,(v)=>{state.q[i]=v*DEG;update();}));
  const grid=document.createElement('div');grid.className='sing-dh-grid';grid.innerHTML='<b>row</b><b>a</b><b>α°</b><b>d</b>'; state.rows.forEach((row,i)=>{const tag=document.createElement('b');tag.textContent=`${i+1}`;grid.append(tag);row.forEach((v,j)=>{const input=document.createElement('input');input.type='number';input.step=j===1?'5':'.05';input.value=(j===1?v/DEG:v).toFixed(2);input.addEventListener('change',()=>{row[j]=Number(input.value)*(j===1?DEG:1);update();});grid.append(input);});});controls.append(grid);
  const dynamic=new THREE.Group();kit.world.add(dynamic); const ray=new THREE.Raycaster(),mouse=new THREE.Vector2(),plane=new THREE.Plane();let dragging=false,target=new THREE.Vector3(); const canvas=kit.renderer.domElement;
  const factor=document.createElement('div');factor.className='sing-formula sing-factor';panel.insertBefore(factor,panel.querySelector('[data-matrix]'));
  canvas.addEventListener('pointerdown',(e)=>{dragging=true;kit.controls.enabled=false;canvas.setPointerCapture(e.pointerId);const kin=dhKinematics(state);target.copy(kin.end);plane.setFromNormalAndCoplanarPoint(kit.camera.getWorldDirection(new THREE.Vector3()),target);drag(e);});canvas.addEventListener('pointermove',(e)=>{if(dragging)drag(e);});canvas.addEventListener('pointerup',()=>{dragging=false;kit.controls.enabled=true;});
  function drag(e){const r=canvas.getBoundingClientRect();mouse.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);ray.setFromCamera(mouse,kit.camera);if(ray.ray.intersectPlane(plane,target)){for(let n=0;n<18;n++){const kin=dhKinematics(state),err=target.clone().sub(kin.end);if(err.length()<1e-3)break;const J=positionJacobian(kin.axes,kin.points,kin.end);const dq=dampedStep(J,err,.08);state.q=state.q.map((q,i)=>q+clamp(dq[i],-.16,.16));}syncRanges(controls,{q1:state.q[0],q2:state.q[1],q3:state.q[2]});update();}}
  function update(){clearGroup(dynamic);const kin=dhKinematics(state);drawSkeleton(dynamic,kin.points,kin.end,kin.axes);const J=positionJacobian(kin.axes,kin.points,kin.end),det=determinant(J);panel.querySelector('[data-det]').textContent=signed(det,5);panel.querySelector('[data-det]').parentElement.classList.toggle('near',Math.abs(det)<.08);factor.textContent=formatDh3Factorization(state.rows);panel.querySelector('[data-matrix]').textContent=`Jₚ(q) at the current configuration\n${matrixText(J,3)}`;panel.querySelector('.sing-status').textContent=`p = ${vec(kin.end)} m · the displayed determinant is simplified symbolically after every D–H edit.`;kit.render();}
  update();
}

async function setupUrdfJacobianLab(kit,builtin) {
  const six=builtin.includes('6R'),panel=kit.panel;panel.querySelector('h3').textContent=six?'custom_6R_new.urdf singularities':'custom_3R_new.urdf Jacobian';kit.hud.textContent=six?'Reading custom_6R_new.urdf':'Reading custom_3R_new.urdf';
  const response=await fetch(BUILT_INS[builtin]);if(!response.ok)throw new Error(`Could not load ${builtin} URDF.`);const urdfText=await response.text(),model=parseUrdf(urdfText); const end=six?'link_6':'tool0', chain=findChain(model,model.roots[0],end); if(!chain)throw new Error(`No serial chain to ${end}.`); const movable=chain.filter(j=>j.type!=='fixed');const state={q:six?[20,-30,40,15,35,-20].map(v=>v*DEG):movable.map(()=>0),i:0,j:six?5:movable.length,k:0,labels:true,meshes:true,focus:-1,axes:[true,true,true],positions:[false,false,false],columns:[true,true,true]};
  const meshVisuals=await loadUrdfStlVisuals(kit.world,urdfText,new URL('.',BUILT_INS[builtin]));kit.hud.textContent+=` · ${meshVisuals.count} STL links`;
  const controls=panel.querySelector('.sing-controls');state.q.forEach((q,n)=>addRange(controls,`q${n+1}`,-180,180,1,q/DEG,(v)=>{state.q[n]=v*DEG;update();}));
  if(six){
    const selects=panel.querySelector('.sing-selects');
    selects.append(makeSelect('frame i',rangeOptions(0,6,'F'),0,(v)=>{state.i=+v;update();}),makeSelect('point j',rangeOptions(0,6,'O'),5,(v)=>{state.j=+v;update();}),makeSelect('column k',rangeOptions(1,6,'J'),1,(v)=>{state.k=+v-1;update();}));
    const b=document.createElement('button');b.textContent='Use wrist-center choice i=3, j=5';b.addEventListener('click',()=>{state.i=3;state.j=5;selects.querySelectorAll('select').forEach((s,n)=>{if(n===0)s.value='3';if(n===1)s.value='5';});update();});panel.insertBefore(b,panel.querySelector('.sing-metric'));
    const cases=document.createElement('div');cases.className='sing-case-buttons';cases.innerHTML='<button data-case="regular">regular</button><button data-case="arm">arm singular</button><button data-case="wrist">wrist singular</button>';panel.insertBefore(cases,panel.querySelector('.sing-metric'));
    cases.addEventListener('click',(event)=>{const which=event.target.dataset.case;if(!which)return;if(which==='regular')state.q=[20,-30,40,15,35,-20].map(v=>v*DEG);if(which==='arm'){state.q[1]=-Math.atan(6);state.q[2]=0;state.q[4]=35*DEG;}if(which==='wrist')state.q[4]=0;syncJointRanges(controls,state.q);update();});
    for(const [key,label] of [['wrist','wrist factor'],['arm','arm factor']]){const metric=document.createElement('div');metric.className='sing-metric';metric.dataset.factor=key;metric.innerHTML=`<span>${label}</span><strong></strong>`;panel.insertBefore(metric,panel.querySelector('.sing-metric'));}
  }
  else {
    const selects=panel.querySelector('.sing-selects');selects.append(makeSelect('view preset',[['-1','all columns'],['0','column 1 geometry'],['1','column 2 geometry'],['2','column 3 geometry']],'-1',(v)=>{state.focus=+v;if(state.focus<0){state.axes.fill(true);state.positions.fill(false);state.columns.fill(true);}else{state.axes=state.axes.map((_,i)=>i===state.focus);state.positions=state.positions.map((_,i)=>i===state.focus);state.columns=state.columns.map((_,i)=>i===state.focus);}syncVectorToggles(vectorControls,state);update();}));
    const vectorControls=document.createElement('div');vectorControls.className='sing-vector-toggles';vectorControls.innerHTML=vectorToggleMarkup(state);vectorControls.addEventListener('change',(event)=>{const input=event.target;if(!input.matches('input[data-vector]'))return;state[input.dataset.vector][+input.dataset.index]=input.checked;update();});panel.insertBefore(vectorControls,panel.querySelector('.sing-metric'));
    const labelToggle=document.createElement('label');labelToggle.className='sing-toggle';labelToggle.innerHTML='<input type="checkbox" checked> show annotations';labelToggle.firstChild.addEventListener('change',(e)=>{state.labels=e.target.checked;update();});panel.insertBefore(labelToggle,panel.querySelector('.sing-metric'));
    const meshToggle=document.createElement('label');meshToggle.className='sing-toggle';meshToggle.innerHTML='<input type="checkbox" checked> show STL links';meshToggle.firstChild.addEventListener('change',(e)=>{state.meshes=e.target.checked;meshVisuals.group.visible=state.meshes;kit.render();});panel.insertBefore(meshToggle,panel.querySelector('.sing-metric'));
    const readout=document.createElement('div');readout.className='sing-column-readout';panel.insertBefore(readout,panel.querySelector('[data-matrix]'));
  }
  const dynamic=new THREE.Group();kit.world.add(dynamic); const status=panel.querySelector('.sing-status');if(six){kit.camera.position.set(12,9,8);kit.controls.target.set(3.4,1.1,-1.1);kit.controls.update();}
  function update(){clearGroup(dynamic);const kin=chainKinematics(chain,state.q);meshVisuals.update(linkMatricesForChain(model.roots[0],chain,state.q));meshVisuals.group.visible=state.meshes;drawSkeleton(dynamic,kin.points,kin.end,kin.axes,{links:false,axes:false});let J;
    if(six){J=screwJacobian(kin,state.j,state.i);const ordinary=screwJacobian(kin,movable.length,0),d0=determinant(ordinary),dp=determinant(J),pW=kin.points[4],Jarm=positionJacobian(kin.axes.slice(0,3),kin.points.slice(0,3),pW),dArm=determinant(Jarm),wristAxes=kin.axes.slice(3,6),Jwrist=Array.from({length:3},(_,r)=>wristAxes.map(z=>z.getComponent(r))),dWrist=determinant(Jwrist);panel.querySelector('[data-det]').textContent=signed(dp,5);panel.querySelector('[data-det]').parentElement.classList.toggle('near',Math.abs(dp)<1e-4);const armMetric=panel.querySelector('[data-factor="arm"]'),wristMetric=panel.querySelector('[data-factor="wrist"]');armMetric.querySelector('strong').textContent=signed(dArm,5);wristMetric.querySelector('strong').textContent=signed(dWrist,5);armMetric.classList.toggle('near',Math.abs(dArm)<1e-4);wristMetric.classList.toggle('near',Math.abs(dWrist)<1e-4);const pk=kin.points[state.k],pRef=framePoint(kin,state.j),axis=kin.axes[state.k],v=axis.clone().cross(pRef.clone().sub(pk));addAxisLine(dynamic,pk,axis,4,COLORS[state.k]);addArrow(dynamic,pk,pRef.clone().sub(pk),1,COLORS[3]);addArrow(dynamic,pRef,v,1,COLORS[0]);const kind=Math.abs(dArm)<1e-4&&Math.abs(dWrist)<1e-4?'combined arm and wrist singularity':Math.abs(dArm)<1e-4?'arm singularity':Math.abs(dWrist)<1e-4?'wrist singularity':'regular configuration';status.textContent=`${kind} · det J = D_arm D_wrist · ordinary ${signed(d0,4)} · preferential ${signed(dp,4)}.`;}
    else {J=positionJacobian(kin.axes,kin.points,kin.end);const det=determinant(J);panel.querySelector('[data-det]').textContent=signed(det,5);panel.querySelector('[data-det]').parentElement.classList.toggle('near',Math.abs(det)<.08);for(let c=0;c<3;c++){const column=new THREE.Vector3(J[0][c],J[1][c],J[2][c]),r=kin.end.clone().sub(kin.points[c]);if(state.axes[c]){addAxisLine(dynamic,kin.points[c],kin.axes[c],3.2,COLORS[c]);addArrow(dynamic,kin.points[c],kin.axes[c],1.05,COLORS[c]);if(state.labels)addTextLabel(dynamic,kin.points[c].clone().addScaledVector(kin.axes[c],1.15),`z${c+1}`,COLORS[c]);}if(state.positions[c]){addArrow(dynamic,kin.points[c],r,1,0xd79b00);if(state.labels)addTextLabel(dynamic,kin.points[c].clone().addScaledVector(r,.52),`r${c+1} = p - p${c+1}`,0xd79b00);}if(state.columns[c]){addArrow(dynamic,kin.end,column,.45,COLORS[c]);if(state.labels)addTextLabel(dynamic,kin.end.clone().addScaledVector(column,.45),`Jp,${c+1} = z${c+1} × r${c+1}`,COLORS[c]);}}if(state.labels)addTextLabel(dynamic,kin.end.clone().add(new THREE.Vector3(0,0,.35)),'p = tool0',0x111111);const meanings=['tangent to the base-axis sweep','tool velocity from tilting about joint 2','tool velocity from the final joint offset'];panel.querySelector('.sing-column-readout').innerHTML=[0,1,2].map(c=>`<div class="${state.columns[c]?'active':''}" style="border-color:#${new THREE.Color(COLORS[c]).getHexString()}"><strong>J<sub>p,${c+1}</sub></strong><span>z<sub>${c+1}</sub> × r<sub>${c+1}</sub> · ${meanings[c]}</span><code>${vec(new THREE.Vector3(J[0][c],J[1][c],J[2][c]),3)}</code></div>`).join('');status.textContent=`${model.name} · rank ${numericRank(J)} · toggle zₖ, rₖ, and Jp,k independently to reconstruct each cross product.`;}
    panel.querySelector('[data-matrix]').textContent=matrixText(J,3);kit.render();}
  update();
}

function create3RMap(host) {
  host.className += ' sing-lab';host.innerHTML=`<div class="sing-stage"><canvas></canvas><div class="sing-hud">Drag the white point · det(Jₚ)=0 contour</div></div><aside class="sing-panel"><h3>Requested symbolic 3R map</h3><div class="sing-controls"></div><div class="sing-selects"></div><div class="sing-metric"><span>det(Jₚ)</span><strong data-det></strong></div><div class="sing-formula">horizontal q₂ · vertical q₃<br>red/blue: determinant sign<br>white: |det J| ≈ 0</div><p class="sing-status"></p></aside>`;
  const canvas=host.querySelector('canvas'),ctx=canvas.getContext('2d'),controls=host.querySelector('.sing-controls'),state={q2:-25*DEG,q3:80*DEG,a1:1};addRange(controls,'q2',-180,180,1,state.q2/DEG,v=>{state.q2=v*DEG;draw();});addRange(controls,'q3',-180,180,1,state.q3/DEG,v=>{state.q3=v*DEG;draw();});host.querySelector('.sing-selects').append(makeSelect('D–H case',[['1','a₁ = 1 · offset'],['0','a₁ = 0 · intersecting']],'1',value=>{state.a1=+value;image=null;draw();}));let size=[1,1],image;
  const ro=new ResizeObserver(()=>{const dpr=Math.min(devicePixelRatio||1,2);size=[canvas.clientWidth,canvas.clientHeight];canvas.width=size[0]*dpr;canvas.height=size[1]*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);image=null;draw();});ro.observe(canvas);
  function detAt(q2,q3){return requested3RDet([0,q2,q3],state.a1);}
  function buildImage(){const w=Math.max(120,Math.floor(size[0]/3)),h=Math.max(90,Math.floor(size[1]/3)),off=document.createElement('canvas');off.width=w;off.height=h;const c=off.getContext('2d'),im=c.createImageData(w,h);let max=0,vals=new Float32Array(w*h);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const v=detAt((x/(w-1)*2-1)*Math.PI,(1-y/(h-1)*2)*Math.PI);vals[y*w+x]=v;max=Math.max(max,Math.abs(v));}for(let n=0;n<vals.length;n++){const t=vals[n]/(max||1),a=Math.min(1,Math.abs(t)*2.6),white=Math.abs(t)<.018;im.data[n*4]=white?250:(t>0?220:35);im.data[n*4+1]=white?250:Math.round(245-145*a);im.data[n*4+2]=white?250:(t>0?60:215);im.data[n*4+3]=255;}c.putImageData(im,0,0);image=off;}
  function draw(){if(!image)buildImage();ctx.clearRect(0,0,...size);ctx.imageSmoothingEnabled=true;ctx.drawImage(image,0,0,...size);const x=(state.q2/Math.PI+1)*.5*size[0],y=(1-state.q3/Math.PI)*.5*size[1];ctx.beginPath();ctx.arc(x,y,9,0,Math.PI*2);ctx.fillStyle='#fff';ctx.fill();ctx.strokeStyle='#111';ctx.lineWidth=3;ctx.stroke();const det=detAt(state.q2,state.q3);host.querySelector('[data-det]').textContent=signed(det,5);host.querySelector('.sing-metric').classList.toggle('near',Math.abs(det)<.08);host.querySelector('.sing-status').textContent=state.a1?'Offset case: c₂(c₃ − 2s₃) − s₃ = 0.':'Intersecting-axis case: c₂(c₃ − 2s₃) = 0.';}
  let dragging=false;canvas.addEventListener('pointerdown',(e)=>{dragging=true;canvas.setPointerCapture(e.pointerId);drag(e);});canvas.addEventListener('pointermove',(e)=>{if(dragging)drag(e);});canvas.addEventListener('pointerup',()=>dragging=false);function drag(e){const r=canvas.getBoundingClientRect();state.q2=((e.clientX-r.left)/r.width*2-1)*Math.PI;state.q3=(1-(e.clientY-r.top)/r.height*2)*Math.PI;syncRanges(controls,{q2:state.q2,q3:state.q3});draw();}return{dispose(){ro.disconnect();}};
}

function createBuilder(host) {
  host.className += ' sing-builder';host.innerHTML=`<div class="sing-stage"><div class="sing-hud">URDF geometry-only rendering</div></div><aside class="sing-panel"><h3>URDF singularity builder</h3><div class="sing-pipeline"></div><div class="sing-tabs"><button data-built="custom 3R">custom 3R</button><button data-built="custom 6R">custom 6R</button></div><input type="file" accept=".urdf,.xml" data-file><div class="sing-selects" data-links></div><div class="sing-urdf-tree"></div><div class="sing-metric"><span data-kind>diagnostic</span><strong data-value>—</strong></div><div class="sing-formula l5-matrix" data-matrix></div><p class="sing-status"></p></aside>`;
  const stage=host.querySelector('.sing-stage'),kit=createWorld(stage),panel=host.querySelector('.sing-panel'),dynamic=new THREE.Group();kit.world.add(dynamic);const pipeline=['URDF','serial chain','axes + origins','screw columns','choose i,j','Jacobian','rank condition'];panel.querySelector('.sing-pipeline').innerHTML=pipeline.map(x=>`<span>${x}</span>`).join('');let current;
  panel.querySelectorAll('[data-built]').forEach(b=>b.addEventListener('click',()=>loadBuiltin(b.dataset.built)));panel.querySelector('[data-file]').addEventListener('change',async(e)=>{const file=e.target.files[0];if(file)loadText(await file.text(),file.name);});
  async function loadBuiltin(name){try{loadText(await(await fetch(BUILT_INS[name])).text(),name);}catch(e){fail(e);}}
  function fail(error){panel.querySelector('.sing-status').textContent=error.message;panel.querySelector('.sing-status').classList.add('error');}
  function loadText(text,label){try{const model=parseUrdf(text);current={model,label};const ends=[...model.links].filter(x=>!model.joints.some(j=>j.parent===x));const preferredEnd=label==='custom 6R'&&ends.includes('link_6')?'link_6':ends.at(-1);const links=panel.querySelector('[data-links]');links.innerHTML='';links.append(makeSelect('base',model.roots.map(x=>[x,x]),model.roots[0],renderBuilder),makeSelect('end',ends.map(x=>[x,x]),preferredEnd,renderBuilder));panel.querySelector('.sing-status').classList.remove('error');renderBuilder();}catch(e){fail(e);}}
  function renderBuilder(){if(!current)return;try{const selects=panel.querySelectorAll('[data-links] select'),base=selects[0].value,end=selects[1].value,chain=findChain(current.model,base,end);if(!chain)throw new Error('No valid base-to-end chain.');const children=new Map();current.model.joints.filter(j=>j.type!=='fixed').forEach(j=>children.set(j.parent,(children.get(j.parent)||0)+1));if(chain.some(j=>(children.get(j.parent)||0)>1))throw new Error('Branched movable mechanism detected; this builder currently analyzes one serial chain.');const movable=chain.filter(j=>j.type!=='fixed');if(!movable.length)throw new Error('The selected chain contains no movable joints.');if(movable.some(j=>!['revolute','continuous','prismatic'].includes(j.type)))throw new Error('Floating and planar joints are not supported.');const kin=chainKinematics(chain,movable.map(()=>0)),J=movable.length===3?positionJacobian(kin.axes,kin.points,kin.end):screwJacobian(kin,movable.length,0);clearGroup(dynamic);drawSkeleton(dynamic,kin.points,kin.end,kin.axes);panel.querySelector('.sing-urdf-tree').textContent=`${base}\n${chain.map(j=>`  └─ ${j.name} [${j.type}] axis=${vec(j.axis)}\n     ${j.child}`).join('\n')}`;panel.querySelector('[data-matrix]').textContent=matrixText(J,3);const square=J.length===J[0].length,value=square?determinant(J):numericRank(J);panel.querySelector('[data-kind]').textContent=square?'det(J)':'rank(J)';panel.querySelector('[data-value]').textContent=square?signed(value,5):String(value);panel.querySelector('.sing-status').textContent=square?`Generated from ${current.label}; determinant is valid because the selected task Jacobian is square.`:`Generated from ${current.label}; det(J) is not defined for ${J.length}×${J[0].length}. Showing numerical rank instead.`;[...panel.querySelectorAll('.sing-pipeline span')].forEach(x=>x.classList.add('active'));kit.render();}catch(e){fail(e);}}
  loadBuiltin('custom 3R'); return kit;
}

function parseUrdf(text) {
  const xml=new DOMParser().parseFromString(text,'application/xml');if(xml.querySelector('parsererror'))throw new Error('Invalid URDF XML.');const root=xml.documentElement;if(root.tagName.toLowerCase()!=='robot')throw new Error('Expected a <robot> root.');const child=(n,t)=>[...n.children].find(x=>x.tagName.toLowerCase()===t);const nums=(s,f=[0,0,0])=>(s?.trim().split(/\s+/).map(Number)||f);const links=new Set([...root.children].filter(x=>x.tagName.toLowerCase()==='link').map(x=>x.getAttribute('name')).filter(Boolean));const joints=[...root.children].filter(x=>x.tagName.toLowerCase()==='joint').map(e=>{const o=child(e,'origin'),[x,y,z]=nums(o?.getAttribute('xyz')),[r,p,w]=nums(o?.getAttribute('rpy'));return{name:e.getAttribute('name')||'joint',type:e.getAttribute('type')||'fixed',parent:child(e,'parent')?.getAttribute('link'),child:child(e,'child')?.getAttribute('link'),origin:rpyMatrix(x,y,z,r,p,w),axis:new THREE.Vector3(...nums(child(e,'axis')?.getAttribute('xyz'),[1,0,0])).normalize()};}).filter(j=>links.has(j.parent)&&links.has(j.child));if(!links.size)throw new Error('No links found.');const childLinks=new Set(joints.map(j=>j.child)),roots=[...links].filter(l=>!childLinks.has(l));if(!roots.length)throw new Error('No base link found (cycle or invalid graph).');return{name:root.getAttribute('name')||'robot',links,joints,roots};
}

async function loadUrdfStlVisuals(parent,urdfText,modelRoot) {
  const xml=new DOMParser().parseFromString(urdfText,'application/xml'),group=new THREE.Group(),visuals=[],palette=[0x333638,0x0d7d80,0xb8b8b8,0x0d7d80,0x45494d,0x0d7d80,0xf2730c];parent.add(group);
  const direct=(node,tag)=>[...node.children].find(child=>child.tagName.toLowerCase()===tag),numbers=(value,fallback=[0,0,0])=>(value?.trim().split(/\s+/).map(Number)||fallback);
  const specs=[];[...xml.documentElement.children].filter(node=>node.tagName.toLowerCase()==='link').forEach((link,linkIndex)=>{[...link.children].filter(node=>node.tagName.toLowerCase()==='visual').forEach((visual)=>{const mesh=visual.querySelector('geometry > mesh');if(!mesh)return;const origin=direct(visual,'origin'),[x,y,z]=numbers(origin?.getAttribute('xyz')),[r,p,w]=numbers(origin?.getAttribute('rpy')),[sx,sy,sz]=numbers(mesh.getAttribute('scale'),[1,1,1]),file=mesh.getAttribute('filename')?.split('/').at(-1);if(file)specs.push({link:link.getAttribute('name'),file,origin:rpyMatrix(x,y,z,r,p,w),scale:[sx,sy,sz],color:palette[linkIndex%palette.length]});});});
  await Promise.all(specs.map(async(spec)=>{const response=await fetch(new URL(spec.file,modelRoot));if(!response.ok)throw new Error(`Could not load uploaded STL ${spec.file}.`);const geometry=parseStlGeometry(await response.arrayBuffer()),holder=new THREE.Group();holder.matrixAutoUpdate=false;const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color:spec.color,roughness:.63,metalness:.05,transparent:true,opacity:.82,depthWrite:false,side:THREE.DoubleSide}));mesh.scale.fromArray(spec.scale);holder.add(mesh);group.add(holder);visuals.push({...spec,holder});}));
  return {group,count:visuals.length,update(linkMatrices){visuals.forEach(item=>{item.holder.matrix.multiplyMatrices(linkMatrices.get(item.link)||new THREE.Matrix4(),item.origin);item.holder.matrixWorldNeedsUpdate=true;});}};
}

function linkMatricesForChain(base,chain,q){const matrices=new Map([[base,new THREE.Matrix4()]]);let T=new THREE.Matrix4(),qi=0;for(const joint of chain){const pre=T.clone().multiply(joint.origin);if(joint.type==='fixed')T=pre;else{const motion=joint.type==='prismatic'?new THREE.Matrix4().makeTranslation(...joint.axis.clone().multiplyScalar(q[qi]).toArray()):new THREE.Matrix4().makeRotationAxis(joint.axis,q[qi]);T=pre.multiply(motion);qi++;}matrices.set(joint.child,T.clone());}return matrices;}

function findChain(model,base,end) {const byParent=new Map();model.joints.forEach(j=>{if(!byParent.has(j.parent))byParent.set(j.parent,[]);byParent.get(j.parent).push(j);});function walk(link,path,seen){if(link===end)return path;if(seen.has(link))return null;const next=new Set(seen);next.add(link);for(const joint of byParent.get(link)||[]){const found=walk(joint.child,[...path,joint],next);if(found)return found;}return null;}return walk(base,[],new Set());}

function chainKinematics(chain,q) {let T=new THREE.Matrix4(),qi=0;const points=[],axes=[],frames=[T.clone()];for(const joint of chain){const pre=T.clone().multiply(joint.origin),axis=joint.axis.clone().transformDirection(pre);if(joint.type!=='fixed'){points.push(new THREE.Vector3().setFromMatrixPosition(pre));axes.push(axis);let motion=new THREE.Matrix4();if(joint.type==='prismatic')motion.makeTranslation(...joint.axis.clone().multiplyScalar(q[qi]).toArray());else motion.makeRotationAxis(joint.axis,q[qi]);T=pre.multiply(motion);frames.push(T.clone());qi++;}else T=pre;}const end=new THREE.Vector3().setFromMatrixPosition(T);if(frames.length)frames[frames.length-1]=T.clone();return{points,axes,frames,end,types:chain.filter(j=>j.type!=='fixed').map(j=>j.type)};}

function dhKinematics(state){let T=new THREE.Matrix4();const points=[],axes=[],frames=[T.clone()];state.rows.forEach((row,i)=>{points.push(new THREE.Vector3().setFromMatrixPosition(T));axes.push(new THREE.Vector3(0,0,1).transformDirection(T));T.multiply(dhMatrix(row[0],row[1],row[2],state.q[i]));frames.push(T.clone());});return{points,axes,frames,end:new THREE.Vector3().setFromMatrixPosition(T),types:['revolute','revolute','revolute']};}
function dhMatrix(a,alpha,d,theta){const c=Math.cos(theta),s=Math.sin(theta),ca=Math.cos(alpha),sa=Math.sin(alpha);return new THREE.Matrix4().set(c,-s*ca,s*sa,a*c,s,c*ca,-c*sa,a*s,0,sa,ca,d,0,0,0,1);}
function rpyMatrix(x,y,z,r,p,w){return new THREE.Matrix4().makeTranslation(x,y,z).multiply(new THREE.Matrix4().makeRotationZ(w)).multiply(new THREE.Matrix4().makeRotationY(p)).multiply(new THREE.Matrix4().makeRotationX(r));}
function positionJacobian(axes,points,end,types=[]){const J=Array.from({length:3},()=>Array(axes.length).fill(0));axes.forEach((z,k)=>{const v=types[k]==='prismatic'?z.clone():z.clone().cross(end.clone().sub(points[k]));for(let r=0;r<3;r++)J[r][k]=v.getComponent(r);});return J;}
function screwJacobian(kin,j=kin.frames.length-1,i=0){const R=new THREE.Matrix3().setFromMatrix4(kin.frames[clamp(i,0,kin.frames.length-1)]).transpose(),ref=framePoint(kin,j),n=kin.axes.length,J=Array.from({length:6},()=>Array(n).fill(0));for(let k=0;k<n;k++){let v,w;if(kin.types[k]==='prismatic'){v=kin.axes[k].clone();w=new THREE.Vector3();}else{w=kin.axes[k].clone();v=w.clone().cross(ref.clone().sub(kin.points[k]));}v.applyMatrix3(R);w.applyMatrix3(R);for(let r=0;r<3;r++){J[r][k]=v.getComponent(r);J[r+3][k]=w.getComponent(r);}}return J;}
function framePoint(kin,j){return new THREE.Vector3().setFromMatrixPosition(kin.frames[clamp(j,0,kin.frames.length-1)]);}
function dh3Det(q,rows){const kin=dhKinematics({q,rows}),J=positionJacobian(kin.axes,kin.points,kin.end);return determinant(J);}
function requested3RDet(q,a1){const c2=Math.cos(q[1]),s3=Math.sin(q[2]),c3=Math.cos(q[2]);return .75*(3*c3+4)*(c2*(c3-2*s3)-a1*s3);}
function requestedPreferential6R(q,parameters){const [,q2,q3,q4,q5]=q,{a1,a2,a3,alpha2,d4}=parameters,s2=Math.sin(q2),c2=Math.cos(q2),s3=Math.sin(q3),c3=Math.cos(q3),s4=Math.sin(q4),c4=Math.cos(q4),s5=Math.sin(q5),c5=Math.cos(q5),sa=Math.sin(alpha2),ca=Math.cos(alpha2);return[
  [-sa*(a1*s3+a2*c2*s3+d4*c2),ca*(a2*s3+d4),d4,0,0,0],
  [-ca*(a1+a2*c2+a3*c2*c3+d4*c2*s3)+s2*(a3*s3-d4*c3),-sa*(a2+a3*c3+d4*s3),0,0,0,0],
  [sa*(a1*c3+a2*c2*c3+a3*c2),-ca*(a2*c3+a3),-a3,0,0,0],
  [s2*c3+ca*c2*s3,sa*s3,0,0,s4,c4*s5],
  [-sa*c2,ca,1,0,-c4,s4*s5],
  [s2*s3-ca*c2*c3,-sa*c3,0,1,0,-c5]
];}
function requestedPreferential6RDet(q,parameters){const [,q2,q3,,q5]=q,{a1,a2,a3,alpha2,d4}=parameters,s2=Math.sin(q2),c2=Math.cos(q2),s3=Math.sin(q3),c3=Math.cos(q3),s5=Math.sin(q5),sa=Math.sin(alpha2),ca=Math.cos(alpha2),arm=a1*a2+a1*sa*sa*(a3*c3+d4*s3)+a2*c2*(a2+a3*c3+d4*s3)+a2*s2*ca*(d4*c3-a3*s3);return(d4*c3-a3*s3)*arm*s5;}

// For a standard-DH 3R position task, det(Jp) is independent of q1 and alpha3.
// Collecting the exact symbolic result by s2 and c2 gives
//   det(Jp) = a3 [ F0(q3) + s2 Fs(q3) + c2 Fc(q3) ].
function dh3FactorCoefficients(rows){
  const [[a1,A1],[a2,A2,d2],[a3,,d3]]=rows;
  const sA1=Math.sin(A1),cA1=Math.cos(A1),sA2=Math.sin(A2),cA2=Math.cos(A2);
  return {a3,
    f0:[[-a1*a2*sA1,'s₃'],[-a1*a3*sA1*sA2*sA2,'s₃c₃'],[-a1*d3*sA1*sA2*cA2,'c₃']],
    fs:[[a1*a2*sA2*cA1+d2*d3*sA1*sA2*sA2,'c₃'],[a1*a3*sA2*cA1,'c₃²'],[a2*a3*sA1*cA2,'s₃²'],[-a2*d3*sA1*sA2,'s₃'],[-a3*d2*sA1*sA2*cA2,'s₃c₃']],
    fc:[[a1*a3*sA2*cA1*cA2-a2*a3*sA1,'s₃c₃'],[-a1*d3*sA2*sA2*cA1+a2*d2*sA1*sA2,'c₃'],[-a2*a2*sA1,'s₃'],[a3*d2*sA1*sA2,'c₃²']]
  };
}
function formatDh3Factorization(rows){const c=dh3FactorCoefficients(rows),term=(terms)=>{const kept=terms.filter(([v])=>Math.abs(v)>1e-9);if(!kept.length)return'0';return kept.map(([v,x],i)=>`${i?(v>=0?' + ':' − '):(v<0?'−':'')}${Math.abs(v).toFixed(3)}${x}`).join('');};return`trig-simplified and factorized\ndet(Jₚ) = ${c.a3.toFixed(3)} [ F₀ + s₂Fₛ + c₂F꜀ ]\nF₀ = ${term(c.f0)}\nFₛ = ${term(c.fs)}\nF꜀ = ${term(c.fc)}\n(independent of q₁, d₁, α₃)`;}
function dh3FactoredValue(q,rows){const c=dh3FactorCoefficients(rows),s2=Math.sin(q[1]),c2=Math.cos(q[1]),s3=Math.sin(q[2]),c3=Math.cos(q[2]),evalTerms=(terms)=>terms.reduce((sum,[v,x])=>sum+v*({'s₃':s3,'c₃':c3,'s₃c₃':s3*c3,'c₃²':c3*c3,'s₃²':s3*s3}[x]),0);return c.a3*(evalTerms(c.f0)+s2*evalTerms(c.fs)+c2*evalTerms(c.fc));}

function determinant(A){if(!A.length||A.length!==A[0].length)return NaN;const M=A.map(r=>r.slice());let d=1;for(let i=0;i<M.length;i++){let p=i;for(let r=i+1;r<M.length;r++)if(Math.abs(M[r][i])>Math.abs(M[p][i]))p=r;if(Math.abs(M[p][i])<1e-12)return 0;if(p!==i){[M[p],M[i]]=[M[i],M[p]];d=-d;}const pivot=M[i][i];d*=pivot;for(let r=i+1;r<M.length;r++){const f=M[r][i]/pivot;for(let c=i+1;c<M.length;c++)M[r][c]-=f*M[i][c];}}return d;}
function dampedStep(J,error,lambda){const JT=J[0].map((_,c)=>J.map(row=>row[c])),A=J.map((row,r)=>J.map((_,c)=>row.reduce((s,v,k)=>s+v*J[c][k],0)+(r===c?lambda:0))),y=solve(A,error.toArray());return JT.map(row=>row.reduce((s,v,k)=>s+v*y[k],0));}
function solve(A,b){const M=A.map((r,i)=>[...r,b[i]]),n=b.length;for(let i=0;i<n;i++){let p=i;for(let r=i+1;r<n;r++)if(Math.abs(M[r][i])>Math.abs(M[p][i]))p=r;[M[p],M[i]]=[M[i],M[p]];const d=M[i][i]||1e-9;for(let c=i;c<=n;c++)M[i][c]/=d;for(let r=0;r<n;r++)if(r!==i){const f=M[r][i];for(let c=i;c<=n;c++)M[r][c]-=f*M[i][c];}}return M.map(r=>r[n]);}
function numericRank(J,tolerance=1e-8){const M=J.map(r=>r.slice());let rank=0,col=0;while(rank<M.length&&col<M[0].length){let p=rank;for(let r=rank+1;r<M.length;r++)if(Math.abs(M[r][col])>Math.abs(M[p][col]))p=r;if(Math.abs(M[p][col])<=tolerance){col++;continue;}[M[p],M[rank]]=[M[rank],M[p]];for(let r=rank+1;r<M.length;r++){const f=M[r][col]/M[rank][col];for(let c=col;c<M[0].length;c++)M[r][c]-=f*M[rank][c];}rank++;col++;}return rank;}

function drawSkeleton(group,points,end,axes,options={}){const {links=true,axes:showAxes=true}=options,pts=[...points,end];if(links)for(let i=0;i<pts.length-1;i++)group.add(cylinderBetween(pts[i],pts[i+1],.055,0x34383c));points.forEach((p,i)=>{group.add(sphere(p,.095,COLORS[i%COLORS.length]));if(showAxes)addAxisLine(group,p,axes[i],1.1,COLORS[i%COLORS.length]);});group.add(sphere(end,.12,0xff2020));}
function cylinderBetween(a,b,r,color){const d=b.clone().sub(a),mesh=new THREE.Mesh(new THREE.CylinderGeometry(r,r,Math.max(.001,d.length()),16),new THREE.MeshStandardMaterial({color}));mesh.position.copy(a).add(b).multiplyScalar(.5);mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),d.clone().normalize());return mesh;}
function sphere(p,r,color){const m=new THREE.Mesh(new THREE.SphereGeometry(r,18,12),new THREE.MeshStandardMaterial({color}));m.position.copy(p);return m;}
function addAxisLine(group,p,z,length,color){const a=p.clone().addScaledVector(z,-length/2),b=p.clone().addScaledVector(z,length/2),g=new THREE.BufferGeometry().setFromPoints([a,b]),m=new THREE.LineBasicMaterial({color,transparent:true,opacity:.8});group.add(new THREE.Line(g,m));}
function addArrow(group,p,v,scale,color){const len=v.length()*scale;if(len<1e-6)return;group.add(new THREE.ArrowHelper(v.clone().normalize(),p,len,color,Math.min(.22,len*.25),Math.min(.11,len*.14)));}
function addTextLabel(group,position,text,color=0x111111){const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');ctx.font='700 27px Arial';canvas.width=Math.max(112,Math.ceil(ctx.measureText(text).width+26));canvas.height=52;ctx.fillStyle='rgba(255,255,255,.94)';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.strokeStyle=`#${new THREE.Color(color).getHexString()}`;ctx.lineWidth=4;ctx.strokeRect(2,2,canvas.width-4,canvas.height-4);ctx.fillStyle='#111';ctx.font='700 27px Arial';ctx.textBaseline='middle';ctx.fillText(text,13,26);const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,transparent:true,depthTest:false}));sprite.position.copy(position);sprite.scale.set(canvas.width/125,canvas.height/125,1);sprite.renderOrder=20;group.add(sprite);return sprite;}
function clearGroup(group){while(group.children.length){const o=group.children.pop();o.geometry?.dispose();const dispose=(m)=>{m?.map?.dispose();m?.dispose();};if(Array.isArray(o.material))o.material.forEach(dispose);else dispose(o.material);}}

function addRange(host,label,min,max,step,value,onInput,suffix='°'){const row=document.createElement('label');row.className='sing-control';row.innerHTML=`<span>${label}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${value}"><output>${Number(value).toFixed(step<1?2:0)}${suffix}</output>`;const input=row.querySelector('input'),out=row.querySelector('output');input.dataset.key=label;input.addEventListener('input',()=>{out.value=`${Number(input.value).toFixed(step<1?2:0)}${suffix}`;onInput(Number(input.value));});host.append(row);return input;}
function syncRanges(host,state){host.querySelectorAll('input[type=range]').forEach(input=>{const key=input.dataset.key;let value=state[key];if(value==null)return;if(key.startsWith('q'))value/=DEG;input.value=value;input.nextElementSibling.value=`${Number(value).toFixed(0)}°`;});}
function syncJointRanges(host,q){syncRanges(host,Object.fromEntries(q.map((value,index)=>[`q${index+1}`,value])));}
function vectorToggleMarkup(state){const row=(key,title,symbol)=>`<div><strong>${title}</strong>${state[key].map((checked,index)=>`<label><input type="checkbox" data-vector="${key}" data-index="${index}" ${checked?'checked':''}><span>${symbol}<sub>${index+1}</sub></span></label>`).join('')}</div>`;return row('axes','joint axes','z')+row('positions','position vectors','r')+row('columns','Jacobian columns','Jp,');}
function syncVectorToggles(host,state){host.querySelectorAll('input[data-vector]').forEach(input=>{input.checked=state[input.dataset.vector][+input.dataset.index];});}
function makeSelect(label,options,value,onChange){const wrap=document.createElement('label');const select=document.createElement('select');options.forEach(([v,t])=>{const o=document.createElement('option');o.value=v;o.textContent=t;select.append(o);});select.value=value;select.addEventListener('change',()=>onChange(select.value));wrap.append(label,select);return wrap;}
function rangeOptions(a,b,prefix){return Array.from({length:b-a+1},(_,n)=>[String(a+n),`${prefix}${a+n}`]);}
function matrixText(A,d=3){return A.map(r=>'[ '+r.map(x=>(Number.isFinite(x)?signed(x,d):'—').padStart(d+4)).join(' ')+' ]').join('\n');}
function vec(v,d=2){return `[${v.toArray().map(x=>signed(x,d)).join(', ')}]`;}
function signed(x,d=3){const v=Math.abs(x)<10**(-d)?0:x;return `${v>=0?' ':''}${v.toFixed(d)}`;}
function clamp(x,a,b){return Math.max(a,Math.min(b,x));}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

async function runDevelopmentChecks(){try{for(let n=0;n<12;n++){const q=[(Math.random()*2-1)*Math.PI,(Math.random()*2-1)*Math.PI],l1=.7+Math.random(),l2=.7+Math.random(),J=[[-l1*Math.sin(q[0])-l2*Math.sin(q[0]+q[1]),-l2*Math.sin(q[0]+q[1])],[l1*Math.cos(q[0])+l2*Math.cos(q[0]+q[1]),l2*Math.cos(q[0]+q[1])]];if(Math.abs(determinant(J)-l1*l2*Math.sin(q[1]))>1e-9)throw new Error('2R determinant check failed');}for(let n=0;n<12;n++){const q=Array(3).fill(0).map(()=>Math.random()*4-2),rows=Array.from({length:3},()=>[.4+Math.random()*2,(Math.random()*2-1)*Math.PI,.2+Math.random()*1.4]);if(Math.abs(dh3Det(q,rows)-dh3FactoredValue(q,rows))>2e-8)throw new Error('3R factorized determinant check failed');}const model=parseUrdf(await(await fetch(BUILT_INS['custom 3R'])).text()),chain=findChain(model,model.roots[0],'tool0');for(let n=0;n<8;n++){const q=Array(3).fill(0).map(()=>Math.random()*4-2),kin=chainKinematics(chain,q),J=positionJacobian(kin.axes,kin.points,kin.end),eps=1e-6;for(let k=0;k<3;k++){const qp=q.slice(),qm=q.slice();qp[k]+=eps;qm[k]-=eps;const fd=chainKinematics(chain,qp).end.sub(chainKinematics(chain,qm).end).multiplyScalar(1/(2*eps));for(let r=0;r<3;r++)if(Math.abs(fd.getComponent(r)-J[r][k])>2e-5)throw new Error('3R finite-difference Jacobian check failed');}}const model6=parseUrdf(await(await fetch(BUILT_INS['custom 6R'])).text()),chain6=findChain(model6,model6.roots[0],'link_6');for(let n=0;n<8;n++){const q=Array(6).fill(0).map(()=>Math.random()*4-2),kin=chainKinematics(chain6,q),ordinary=screwJacobian(kin,6,0),preferential=screwJacobian(kin,4,3),d0=determinant(ordinary),dp=determinant(preferential);if(Math.abs(d0-dp)>1e-7*Math.max(1,Math.abs(d0)))throw new Error('6R preferential determinant check failed');if(numericRank(ordinary)!==numericRank(preferential))throw new Error('6R preferential rank check failed');}console.info('ENG-654 Lecture 05 checks passed: 2R determinant, 3R symbolic factorization/finite differences, and 6R preferential rank/determinant invariance.');}catch(e){console.error('ENG-654 Lecture 05 validation failed:',e);}}

function runRequestedSymbolicChecks(){try{
  for(const firstA of [1,0])for(let n=0;n<16;n++){const q=Array(3).fill(0).map(()=>Math.random()*4-2),d1=.3+Math.random()*1.7,alpha3=(Math.random()*2-1)*Math.PI,rows=[[firstA,Math.PI/2,d1],[2,Math.PI/2,1],[1.5,alpha3,0]],direct=dh3Det(q,rows),symbolic=requested3RDet(q,firstA);if(Math.abs(direct-symbolic)>1e-8*Math.max(1,Math.abs(direct)))throw new Error(`Requested 3R symbolic determinant failed for a1=${firstA}.`);}
  for(let n=0;n<12;n++){const q=Array(6).fill(0).map(()=>Math.random()*4-2),parameters={a1:.4+Math.random(),a2:.8+Math.random()*1.5,a3:.5+Math.random(),a6:.3+Math.random(),d1:.2+Math.random(),d4:.5+Math.random()*1.5,d6:.2+Math.random(),alpha2:(Math.random()*2-1)*Math.PI},rows=[[parameters.a1,Math.PI/2,parameters.d1],[parameters.a2,parameters.alpha2,0],[parameters.a3,Math.PI/2,0],[0,Math.PI/2,parameters.d4],[0,Math.PI/2,0],[parameters.a6,0,parameters.d6]],kin=dhKinematics({q,rows}),direct=screwJacobian(kin,5,3),symbolic=requestedPreferential6R(q,parameters);for(let r=0;r<6;r++)for(let c=0;c<6;c++)if(Math.abs(direct[r][c]-symbolic[r][c])>2e-8)throw new Error('Requested preferential Jacobian entry check failed.');const detDirect=determinant(direct),detSymbolic=requestedPreferential6RDet(q,parameters);if(Math.abs(detDirect-detSymbolic)>2e-8*Math.max(1,Math.abs(detDirect)))throw new Error('Requested preferential determinant check failed.');}
  console.info('ENG-654 requested symbolic checks passed: both 3R determinants and the exact frame-3, O5 preferential 6R Jacobian.');
}catch(error){console.error('ENG-654 requested symbolic validation failed:',error);}}
