import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createSceneControlPanel, createZUpWorld, resizeRendererToContainer } from './threeUtils.js';
import { parseStlGeometry } from './frameDHPlayground.js';
import { searchAspectPath } from './cuspidalPathPlanner.js';
import { createCuspidalityAtlas } from './cuspidalityAtlas.js';
import { loadAbbIrbVisuals } from './abbIrbVisuals.js';
import { ABB_PARAMETERS, abbUrdfTransforms, abbDHKinematics, abbJacobian, abbFactors, abbPreset, numericRank } from './abbIrbKinematics.js';
import { buildFixedOrientationPath, custom6RArmDeterminant, custom6RWristSolutions, matrixDeterminant } from './fixedOrientationPath.js';

const PI = Math.PI;
const DEG = PI / 180;
const MODULE_REVISION = new URL(import.meta.url).searchParams.get('v') || 'dev';
const COLORS = ['#e00000', '#2474d2', '#65a34a', '#d18b00', '#8b62a8', '#008f95'];
const MODEL_SPECS = {
  '3r-zero': { label: 'intersecting-axis course 3R', urdf: '../../assets/models/custom_3R/custom_3R_new_0.urdf', mesh: '../../assets/models/custom_3R/', end: 'tool0', q: [25,-35,55], camera: [10,9,8], target: [2,1,.7] },
  '3r-offset': { label: 'offset-axis course 3R', urdf: '../../assets/models/custom_3R/custom_3R_new.urdf', mesh: '../../assets/models/custom_3R/', end: 'tool0', q: [25,-35,55], camera: [10,9,8], target: [2,1,.7] },
  'custom-6r': { label: 'course wrist-partitioned 6R', urdf: '../../assets/models/custom_6R/custom_6R_new.urdf', mesh: '../../assets/models/custom_6R/', end: 'link_6', q: [-60,20,120,35,-50,70], camera: [14,12,10], target: [3,1.4,1], frameScale: .7 },
  puma: { label: 'PUMA 560', urdf: '../../assets/models/puma/puma560_robot.urdf', mesh: '../../assets/models/puma/', end: 'link7', q: [30,-35,45,40,-50,60], camera: [2.4,2.1,1.7], target: [.1,0,.65], frameScale: .11 },
  abb: { label: 'ABB IRB 4600', end: 'tool0', q: [0,15,-35,25,35,-20], camera: [4.8,4.2,3.5], target: [.5,0,1.05], frameScale: .23 },
  iiwa: { label: 'KUKA iiwa 7', urdf: '../../assets/models/iiwa7/iiwa7_free_joints.urdf', mesh: '../../assets/models/iiwa7/', end: 'iiwa_link_ee', q: [20,-35,30,50,-40,45,60], camera: [1.7,1.5,1.25], target: [.1,0,.62], frameScale: .11 },
  fanuc: { label: 'FANUC CRX-10iA/L', urdf: '../../assets/models/fanuc_crx10ia_support/crx10ial.urdf', mesh: '../../assets/models/fanuc_crx10ia_support/', end: 'link_6', q: [15,-30,55,20,40,-25], camera: [2.7,2.4,2.1], target: [.3,0,.7], frameScale: .16 }
};
const PRESETS = {
  noncuspidal: { a1: 0, a2: 2, a3: 1.5, d1: 1, d2: 1, d3: 0, A1: PI/2, A2: PI/2, A3: 0 },
  cuspidal: { a1: 1, a2: 2, a3: 1.5, d1: 1, d2: 1, d3: 0, A1: PI/2, A2: PI/2, A3: 0 }
};
const CUSTOM_3R_URDF_DH = { a1: 1, a2: 2, a3: 1.5, d1: 1, d2: 1.25, d3: .75, A1: -PI/2, A2: PI/2, A3: 0 };

export function initCuspidalityLecture() {
  const labs = [...document.querySelectorAll('[data-cusp-lab]')];
  const models = [...document.querySelectorAll('[data-cusp-model]')];
  if (!labs.length && !models.length) return;
  const initialized = new WeakSet();
  const ensure = (host) => {
    if (initialized.has(host)) return;
    initialized.add(host);
    const mode = host.dataset.cuspLab || host.dataset.cuspModel;
    try {
      if (host.dataset.cuspModel) createModelViewer(host, mode).catch((error) => fail(host,error));
      else if (mode === 'two-r') create2RAspectLab(host);
      else if (mode === 'atlas-3r') createAtlas3R(host);
      else if (mode === 'nscs-3r') createNscsLab(host).catch((error)=>fail(host,error));
      else if (mode === 'custom-6r') createCustom6RLab(host);
      else if (mode === 'abb-6r') createAbbAspectLab(host).catch((error)=>fail(host,error));
      else if (mode === 'abb-factors') createAbbFactorsLab(host).catch((error)=>fail(host,error));
      else if (mode === 'fanuc-16') createFanuc16Lab(host).catch((error)=>fail(host,error));
      else throw new Error(`Unknown cuspidality visualization: ${mode}`);
    } catch (error) { fail(host,error); }
  };
  const observer = new IntersectionObserver((entries) => entries.forEach((entry) => { if (entry.isIntersecting) ensure(entry.target); }), { threshold: .02, rootMargin: '100px' });
  [...labs,...models].forEach((host) => observer.observe(host));
  const sync = () => { const n = Number(location.hash.match(/#slide-(\d+)/)?.[1] || 1); document.querySelectorAll('#deck > .slide')[n-1]?.querySelectorAll('[data-cusp-lab],[data-cusp-model]').forEach(ensure); };
  sync(); window.addEventListener('hashchange',sync);
  runChecks();
}

function fail(host,error) { host.innerHTML = `<div class="warning">Cuspidality visualization could not start: ${escapeHtml(error.message)}</div>`; console.error(error); }

function create2RAspectLab(host) {
  host.className += ' cusp-lab cusp-two';
  host.innerHTML = '<div class="cusp-plot"><h3>joint space</h3><canvas data-joint></canvas></div><div class="cusp-plot"><h3>workspace</h3><canvas data-work></canvas></div><aside class="cusp-side"><h3>2R branch separator</h3><div data-ranges></div><div class="cusp-formula">det(J) = l₁l₂ sin(q₂)\n\nq₂ = 0 or ±π is singular.</div><div class="cusp-status" data-status></div><div class="cusp-legend"><span><i style="background:#2474d2"></i>elbow up</span><span><i style="background:#65a34a"></i>elbow down</span><span><i style="background:#e00000"></i>singular</span></div></aside>';
  const jc = host.querySelector('[data-joint]'), wc = host.querySelector('[data-work]'), ranges = host.querySelector('[data-ranges]');
  const state = { q1: .55, q2: 1.15, l1: 1.15, l2: .82 };
  addRange(ranges,'q₁',-180,180,1,state.q1/DEG,(v)=>{state.q1=v*DEG;draw();});
  addRange(ranges,'q₂',-180,180,1,state.q2/DEG,(v)=>{state.q2=v*DEG;draw();});
  addRange(ranges,'l₁',.5,1.5,.05,state.l1,(v)=>{state.l1=v;draw();},' m');
  addRange(ranges,'l₂',.5,1.5,.05,state.l2,(v)=>{state.l2=v;draw();},' m');
  const pair = resizeCanvases([jc,wc],draw);
  function fk(q1,q2) { return [state.l1*Math.cos(q1)+state.l2*Math.cos(q1+q2),state.l1*Math.sin(q1)+state.l2*Math.sin(q1+q2)]; }
  function draw() {
    if (!pair.ready()) return;
    const [jctx,wctx]=pair.contexts, [js,ws]=pair.sizes; clear(jctx,js); clear(wctx,ws);
    const jm=plotMap(js,[-PI,PI],[-PI,PI],{x:'q₁',y:'q₂'}); axes(jctx,jm);
    fillPlot(jctx,jm,[-PI,PI],[0,PI],'rgba(36,116,210,.12)'); fillPlot(jctx,jm,[-PI,PI],[-PI,0],'rgba(101,163,74,.12)');
    [0,-PI,PI].forEach((q)=>polyline(jctx,[[-PI,q],[PI,q]],jm,'#e00000',3));
    const target=fk(state.q1,state.q2),mirrorQ2=-state.q2,mirrorQ1=Math.atan2(target[1],target[0])-Math.atan2(state.l2*Math.sin(mirrorQ2),state.l1+state.l2*Math.cos(mirrorQ2));
    dot(jctx,jm.toPx(state.q1,state.q2),COLORS[state.q2>=0?1:2],7,'#111');dot(jctx,jm.toPx(wrap(mirrorQ1),mirrorQ2),COLORS[state.q2>=0?2:1],7,'#111');
    const reach=state.l1+state.l2, inner=Math.abs(state.l1-state.l2), wm=plotMap(ws,[-reach*1.15,reach*1.15],[-reach*1.15,reach*1.15],{x:'x',y:'y'}); axes(wctx,wm);
    circlePlot(wctx,wm,reach,'#e00000',3); circlePlot(wctx,wm,inner,'#e00000',3);
    const p=target,e=[state.l1*Math.cos(state.q1),state.l1*Math.sin(state.q1)],em=[state.l1*Math.cos(mirrorQ1),state.l1*Math.sin(mirrorQ1)],o=wm.toPx(0,0),ep=wm.toPx(...e),emp=wm.toPx(...em),pp=wm.toPx(...p);
    polylinePx(wctx,[o,emp,pp],COLORS[state.q2>=0?2:1],7);polylinePx(wctx,[o,ep,pp],COLORS[state.q2>=0?1:2],9);dot(wctx,o,'#fff',6,'#111');dot(wctx,ep,'#fff',5,'#111');dot(wctx,emp,'#fff',5,'#111');dot(wctx,pp,'#111',8,'#fff');
    const det=state.l1*state.l2*Math.sin(state.q2); host.querySelector('[data-status]').textContent=`Current branch: ${state.q2>=0?'elbow up':'elbow down'} · det(J) = ${det.toFixed(3)} m² · aspect ${state.q2>=0?'A₊':'A₋'}`;
  }
  bindDrag(jc,(x,y)=>{state.q1=x;state.q2=y;syncRanges(ranges,[state.q1/DEG,state.q2/DEG,state.l1,state.l2]);draw();},()=>plotMap(pair.sizes[0],[-PI,PI],[-PI,PI]));
  bindDrag(wc,(x,y)=>{const r2=x*x+y*y,c2=clamp((r2-state.l1**2-state.l2**2)/(2*state.l1*state.l2),-1,1),sign=state.q2>=0?1:-1;state.q2=sign*Math.acos(c2);state.q1=Math.atan2(y,x)-Math.atan2(state.l2*Math.sin(state.q2),state.l1+state.l2*Math.cos(state.q2));syncRanges(ranges,[state.q1/DEG,state.q2/DEG,state.l1,state.l2]);draw();},()=>{const r=state.l1+state.l2;return plotMap(pair.sizes[1],[-r*1.15,r*1.15],[-r*1.15,r*1.15]);});
  draw();
}

function createAtlas3R(host) {
  return createCuspidalityAtlas(host, { PRESETS, det3, sliceFk, solveIkSlice, factorText });
}

async function createNscsLab(host) {
  host.className += ' cusp-lab cusp-nscs';
  host.innerHTML = '<div class="cusp-nscs-panels"><div class="cusp-plot"><h3>joint path · q₂, q₃</h3><canvas data-joint></canvas></div><div class="cusp-plot"><h3>y = 0 slice · actual x, z</h3><canvas data-work></canvas></div><div class="cusp-stage" data-stage><div class="hud">custom_3R_new.urdf · discrete joint configurations</div></div></div><div class="cusp-nscs-controls"><div class="cusp-iks" data-iks></div><div class="cusp-status" data-status>Loading the Lecture 03 IK solver.</div><div><button data-build disabled>Build path</button> <button data-play disabled>Play</button> <button data-reset disabled>Reset to start</button></div></div>';
  const jc = host.querySelector('[data-joint]'), wc = host.querySelector('[data-work]');
  const status = host.querySelector('[data-status]'), buildButton = host.querySelector('[data-build]'), playButton = host.querySelector('[data-play]'), resetButton = host.querySelector('[data-reset]');
  const state = { p: { ...CUSTOM_3R_URDF_DH }, cache: null, target: null, solutions: [], selected: [], path: [], fullPath: [], trace: [], map: null, playing: false, busy: false, version: 0, progress: 0 };
  state.cache = buildSingularityCache(state.p);
  const pair = resizeCanvases([jc, wc], draw);
  const [viewer, ikModule, { createJointPathPlayback }] = await Promise.all([
    createModelViewer(host.querySelector('[data-stage]'), '3r-offset', { embedded: true }),
    import(`./custom3rIk.js?v=${MODULE_REVISION}`),
    import(`./jointPathPlayback.js?v=${MODULE_REVISION}`)
  ]);
  const determinant = (slice) => det3([0, ...slice], state.p);
  const playback = createJointPathPlayback({
    canPlay: () => !state.busy && state.fullPath.length > 1,
    isVisible: () => !document.hidden && (!host.closest('.slide') || host.closest('.slide').classList.contains('active')),
    duration: () => Math.max(6000, state.fullPath.length * 15),
    onFrame: progress => {
      state.progress = progress;
      const index = Math.round(progress * (state.fullPath.length - 1));
      viewer.update(state.fullPath[index]);
      host.dataset.sampleIndex = String(index);
      draw();
    },
    onState: ({ progress, playing }) => { state.progress = progress; state.playing = playing; controls(); }
  });
  function controls() {
    buildButton.disabled = state.busy || state.selected.length !== 2;
    playButton.disabled = state.busy || state.fullPath.length < 2;
    resetButton.disabled = state.busy || state.fullPath.length < 2;
    playButton.textContent = state.playing ? 'Pause' : state.progress >= 1 ? 'Replay' : state.progress > 0 ? 'Resume' : 'Play';
    host.querySelectorAll('[data-iks] button').forEach((button) => { button.disabled = state.busy; });
    host.dataset.playing = String(state.playing);
    host.dataset.pathPoints = String(state.fullPath.length);
    host.dataset.progress = state.progress.toFixed(4);
  }
  function pause() { playback.pause(); }
  function clearPath() {
    playback.reset(); state.version += 1; state.path = []; state.fullPath = []; state.trace = []; state.progress = 0;
    delete host.dataset.minAbsDet; delete host.dataset.maxSliceError;
    delete host.dataset.sampleIndex;
    viewer.setTrace([]); viewer.setGhost(null); controls();
  }
  function renderPills() {
    const pills = host.querySelector('[data-iks]');
    pills.innerHTML = state.solutions.map((q, i) => `<button data-i="${i}" class="${state.selected.includes(i) ? 'selected' : ''}" style="border-color:${COLORS[i % COLORS.length]}" title="q = (${q.map(v => (v / DEG).toFixed(1)).join(', ')}) degrees">IK ${i + 1}</button>`).join('');
    pills.querySelectorAll('button').forEach((button) => button.addEventListener('click', () => {
      if (state.busy) return;
      clearPath(); const i = Number(button.dataset.i);
      if (state.selected.includes(i)) state.selected = state.selected.filter(k => k !== i);
      else if (state.selected.length < 2) state.selected.push(i);
      else state.selected = [state.selected[1], i];
      viewer.update(state.solutions[i]); renderPills();
      status.textContent = state.selected.length === 2 ? 'Endpoints selected. Build path searches one regular aspect and checks every interpolated edge.' : 'Select two IK configurations at the same (x, 0, z) target.';
      controls(); draw();
    }));
  }
  async function setTarget(target, chooseExample = false) {
    clearPath(); const version = state.version; state.target = target; state.selected = []; state.solutions = []; state.busy = true;
    renderPills(); controls(); status.textContent = 'Solving the actual URDF position IK at (x, 0, z).'; draw();
    try {
      const solutions = await ikModule.solveCustom3RPositionIk([target[0], 0, target[1]]);
      if (version !== state.version) return;
      state.solutions = solutions.filter(q => Math.abs(determinant(q.slice(1))) > 1e-6);
      if (chooseExample) {
        outer: for (let i = 0; i < state.solutions.length; i += 1) for (let j = i + 1; j < state.solutions.length; j += 1) {
          if (determinant(state.solutions[i].slice(1)) * determinant(state.solutions[j].slice(1)) > 0) { state.selected = [i, j]; break outer; }
        }
      }
      if (state.solutions.length) viewer.update(state.solutions[state.selected[0] ?? 0]);
      status.textContent = `${state.solutions.length} regular position IKs at (${target[0].toFixed(3)}, 0, ${target[1].toFixed(3)}) m. ${state.selected.length === 2 ? 'Two endpoints selected: press Build path.' : 'Select two endpoints.'}`;
    } catch (error) { if (version === state.version) status.textContent = `IK could not be solved: ${error.message}`; }
    finally { if (version === state.version) { state.busy = false; renderPills(); controls(); draw(); } }
  }
  // q1 is reconstructed from the URDF at every dense waypoint. Thus the
  // displayed discrete joint configurations lie on y=0, including negative x.
  function configuration(slice, previous) {
    const p0 = new THREE.Vector3().setFromMatrixPosition(viewer.model.pose([0, ...slice]));
    const q1 = (state.target[0] < 0 ? PI : 0) - Math.atan2(p0.y, p0.x);
    return [previous == null ? q1 : previous + wrap(q1 - previous), ...slice];
  }
  async function buildPath() {
    if (state.busy || state.selected.length !== 2) return;
    clearPath(); const version = state.version, selected = state.selected.slice(); state.busy = true; controls();
    status.textContent = 'Searching a periodic joint grid with A*: checking determinant sign and clearance along each edge.';
    await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
    try {
      const qa = state.solutions[selected[0]], qb = state.solutions[selected[1]];
      const clearance = Math.min(.03, .1 * Math.abs(determinant(qa.slice(1))), .1 * Math.abs(determinant(qb.slice(1))));
      const result = searchAspectPath(qa.slice(1), qb.slice(1), { determinant, clearance, resolution: 144, maxStep: .012 });
      if (version !== state.version) return;
      if (!result.found) { status.textContent = result.reason; return; }
      let previous = qa[0];
      const fullPath = result.path.map(slice => { const q = configuration(slice, previous); previous = q[0]; return q; });
      const points = fullPath.map(q => new THREE.Vector3().setFromMatrixPosition(viewer.model.pose(q)));
      const maxSliceError = Math.max(...points.map(p => Math.abs(p.y)));
      const endpointError = Math.max(points[0].distanceTo(new THREE.Vector3(state.target[0], 0, state.target[1])), points.at(-1).distanceTo(new THREE.Vector3(state.target[0], 0, state.target[1])));
      const jointError = Math.max(...fullPath[0].map((v, i) => Math.abs(wrap(v - qa[i]))), ...fullPath.at(-1).map((v, i) => Math.abs(wrap(v - qb[i]))));
      // Check the independent URDF Jacobian at the actual complete waypoints.
      let minDet = Infinity, valid = maxSliceError < 1e-8 && endpointError < 1e-6 && jointError < 1e-5;
      const sign = Math.sign(determinant(qa.slice(1)));
      for (const q of fullPath) {
        const columns = viewer.model.geometricJacobian(q).columns.map(c => new THREE.Vector3(...c.slice(0, 3)));
        const d = columns[0].dot(columns[1].clone().cross(columns[2]));
        minDet = Math.min(minDet, Math.abs(d)); valid &&= Number.isFinite(d) && sign * d > clearance;
      }
      if (!valid) { status.textContent = 'The URDF endpoint, slice or Jacobian check failed. This path cannot be played.'; return; }
      state.path = result.path; state.fullPath = fullPath; state.trace = points.map(p => [p.x, p.z]);
      viewer.setGhost(fullPath[0]); viewer.setTrace(points); viewer.update(fullPath[0]);
      host.dataset.sampleIndex = '0';
      host.dataset.minAbsDet = String(minDet); host.dataset.maxSliceError = String(maxSliceError);
      status.textContent = `A* + checked shortcuts → ${fullPath.length} discrete joint samples. min |det J| = ${minDet.toFixed(3)}; endpoint error ${endpointError.toExponential(1)} m. q₁ keeps each sample on y = 0. Press Play.`;
    } catch (error) { if (version === state.version) status.textContent = `Path search failed: ${error.message}`; }
    finally { if (version === state.version) { state.busy = false; controls(); draw(); } }
  }
  function draw() {
    if (!pair.ready() || !state.cache) return;
    const [jctx, wctx] = pair.contexts, [js, ws] = pair.sizes; clear(jctx, js); clear(wctx, ws);
    const xmax = state.cache.rhoRange[1], jm = plotMap(js, [-PI, PI], [-PI, PI], { x: 'q₂ (rad)', y: 'q₃ (rad)' });
    const wm = plotMap(ws, [-xmax, xmax], state.cache.zRange, { x: 'x (m), y = 0', y: 'z (m)' }); state.map = wm;
    axes(jctx, jm); axes(wctx, wm); drawSegments(jctx, state.cache.singularSegments, jm, '#e00000', 1.8);
    state.cache.criticalBranches.forEach(branch => { polyline(wctx, branch, wm, '#e00000', 1.8); polyline(wctx, branch.map(([x, z]) => [-x, z]), wm, '#e00000', 1.8); });
    if (state.path.length) polylineTorus(jctx, state.path.map(q => q.map(wrap)), jm, '#111', 3);
    if (state.trace.length) polyline(wctx, state.trace, wm, '#2474d2', 3);
    if (state.target) dot(wctx, wm.toPx(...state.target), '#111', 7, '#fff');
    state.solutions.forEach((q, i) => dot(jctx, jm.toPx(q[1], q[2]), COLORS[i % COLORS.length], state.selected.includes(i) ? 9 : 6, '#111'));
    if (state.fullPath.length) {
      const i = Math.round(state.progress * (state.fullPath.length - 1)), q = state.fullPath[i];
      dot(jctx, jm.toPx(wrap(q[1]), wrap(q[2])), '#fff', 5, '#111'); dot(wctx, wm.toPx(...state.trace[i]), '#fff', 5, '#111');
    }
  }
  wc.addEventListener('pointerdown', (event) => {
    if (state.busy || !state.map) return;
    const rect = wc.getBoundingClientRect(), target = state.map.fromPx(event.clientX - rect.left, event.clientY - rect.top);
    if (target[0] < state.map.xr[0] || target[0] > state.map.xr[1] || target[1] < state.map.yr[0] || target[1] > state.map.yr[1]) return;
    setTarget(target);
  });
  buildButton.addEventListener('click', buildPath);
  playButton.addEventListener('click', () => {
    if (state.playing) { pause(); return; }
    playback.play();
  });
  resetButton.addEventListener('click', () => playback.reset());
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  window.addEventListener('hashchange', () => { if (state.playing) pause(); });
  await setTarget(sliceFk([-10 * DEG, -170 * DEG], state.p), true);
}

function createCustom6RLab(host) {
  createPartitioned6RLab(host,'custom-6r').catch((error)=>fail(host,error));
}

async function createPartitioned6RLab(host,key) {
  const canPlan = key === 'custom-6r';
  host.className += ` cusp-lab cusp-partitioned${canPlan?' has-path':''}`;
  host.innerHTML = '<div class="cusp-partition-panels"><div class="cusp-plot"><h3>positional singularities · q₂,q₃</h3><canvas data-joint></canvas></div><div class="cusp-plot"><h3>y = 0 · wrist-center workspace slice</h3><canvas data-work></canvas></div><div class="cusp-stage" data-stage><div class="hud">fixed tool orientation · RGB tool frame</div></div></div><div class="cusp-partition-controls"><div class="cusp-iks" data-iks></div><div class="cusp-status" data-status role="status">Loading the course URDF and STL files.</div><div data-actions></div></div>';
  const actions = host.querySelector('[data-actions]');
  actions.innerHTML = canPlan
    ? '<div class="cusp-path-controls"><label>Start <select data-start aria-label="Starting IK"></select></label><label>Goal <select data-goal aria-label="Goal IK"></select></label><button data-build disabled>Build path</button><button data-play disabled>Play</button><label>Path <input data-progress type="range" min="0" max="1" step=".001" value="0" disabled></label></div>'
    : '<label class="cusp-toggle"><input type="checkbox" data-autoplay> cycle through IK solutions</label>';
  const jc=host.querySelector('[data-joint]'), wc=host.querySelector('[data-work]'), status=host.querySelector('[data-status]');
  const state={solutions:[],selected:0,start:0,goal:1,target:null,jmap:null,wmap:null,cache:null,path:[],trace:[],progress:0,playing:false,frame:0,busy:false,version:0};
  const viewer=await createModelViewer(host.querySelector('[data-stage]'),key,{embedded:true,showEeFrame:true});
  const model=viewer.model,reference=MODEL_SPECS[key].q.map(v=>v*DEG);
  const fixedRotation=rotationOnly(model.pose(reference));
  const armFromSlice=slice=>{const p0=model.wrist([0,...slice,0,0,0]);return[-Math.atan2(p0.y,p0.x),...slice];};
  const mapFn=slice=>{const p=model.wrist([...armFromSlice(slice),0,0,0]);return[Math.hypot(p.x,p.y),p.z];};
  const detFn=custom6RArmDeterminant;
  state.cache=buildNumericalMapCache(mapFn,detFn,241);
  state.target=mapFn(reference.slice(1,3));
  const pair=resizeCanvases([jc,wc],draw);
  function syncControls() {
    if(!canPlan)return;
    host.querySelector('[data-build]').disabled=state.busy||state.solutions.length<2||state.start===state.goal;
    const play=host.querySelector('[data-play]');play.disabled=state.busy||state.path.length<2;
    play.textContent=state.playing?'Pause':state.progress>=1?'Replay':state.progress>0?'Resume':'Play';
    const slider=host.querySelector('[data-progress]');slider.disabled=state.busy||!state.path.length;slider.value=state.progress;
    host.querySelectorAll('select').forEach(el=>el.disabled=state.busy||!state.solutions.length);
    host.dataset.pathPoints=String(state.path.length);host.dataset.progress=state.progress.toFixed(4);host.dataset.playing=String(state.playing);
  }
  function pause(){cancelAnimationFrame(state.frame);state.frame=0;state.playing=false;syncControls();}
  function clearPath(){pause();state.version++;state.path=[];state.trace=[];state.progress=0;viewer.setTrace([]);viewer.setGhost(null);delete host.dataset.maxRotationError;delete host.dataset.minAbsDet;syncControls();}
  function solveTarget() {
    clearPath();
    const solutions=[];
    for(const slice of solveMapIk(state.target,mapFn,detFn).slice(0,4)) {
      const arm=armFromSlice(slice);
      const wrists=custom6RWristSolutions(arm,fixedRotation);
      for(const wrist of wrists){const q=[...arm,...wrist];if(!solutions.some(s=>jointDistance(s,q)<3e-2))solutions.push(q);}
    }
    state.solutions=solutions;state.selected=0;state.start=0;state.goal=Math.min(1,solutions.length-1);
    if(canPlan) {
      // Preselect two different arm IKs on the same wrist branch and determinant side.
      outer:for(let i=0;i<solutions.length;i++)for(let j=i+1;j<solutions.length;j++){
        const a=solutions[i],b=solutions[j];
        if(torusDistance(a.slice(1,3),b.slice(1,3))>.1 && detFn(a.slice(1,3))*detFn(b.slice(1,3))>0 && Math.sin(a[4])*Math.sin(b[4])>0){state.start=i;state.goal=j;break outer;}
      }
      for(const key of ['start','goal']){
        const select=host.querySelector(`[data-${key}]`);select.innerHTML=solutions.map((_,i)=>`<option value="${i}">IK ${i+1}</option>`).join('');select.value=state[key];
      }
    }
    state.selected=state.start;renderIks();if(solutions.length)viewer.update(solutions[state.selected]);
    const error=solutions.length?Math.max(...solutions.map(q=>rotationMatrixResidual(rotationOnly(model.pose(q)),fixedRotation))):Infinity;
    host.dataset.ikCount=String(solutions.length);
    status.textContent=`${solutions.length} complete IKs · fixed rotation error ${Number.isFinite(error)?error.toExponential(1):'n/a'} · O_w=(${state.target[0].toFixed(3)}, 0, ${state.target[1].toFixed(3)}) m. ${canPlan?'Choose endpoints, then Build path.':''}`;
    syncControls();draw();
  }
  function renderIks(){const h=host.querySelector('[data-iks]');h.innerHTML=state.solutions.map((q,i)=>`<button data-i="${i}" class="${i===state.selected?'selected':''}" aria-pressed="${i===state.selected}" style="border-color:${COLORS[i%COLORS.length]}">IK ${i+1}</button>`).join('');h.querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>select(+b.dataset.i)));}
  function select(i){if(!state.solutions.length||state.busy)return;pause();state.selected=(i+state.solutions.length)%state.solutions.length;viewer.update(state.solutions[state.selected]);renderIks();draw();}
  function showSample(progress){state.progress=progress;const q=state.path[Math.round(progress*(state.path.length-1))];if(q)viewer.update(q);syncControls();draw();}
  async function buildPath() {
    if(state.busy||state.start===state.goal||state.solutions.length<2)return;
    clearPath();state.busy=true;const version=state.version;syncControls();
    status.textContent='Searching arm joint space with A*, enforcing arm and wrist clearance at fixed orientation…';
    await new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0)));
    try{
      const qa=state.solutions[state.start],qb=state.solutions[state.goal];
      const result=buildFixedOrientationPath(qa,qb,{targetRotation:fixedRotation});
      if(version!==state.version)return;
      if(!result.found){status.textContent=result.reason;return;}
      let error=0,minDet=Infinity;
      for(const q of result.path){
        error=Math.max(error,rotationMatrixResidual(rotationOnly(model.pose(q)),fixedRotation));
        const columns=model.geometricJacobian(q).columns;
        minDet=Math.min(minDet,Math.abs(matrixDeterminant(columns[0].map((_,i)=>columns.map(c=>c[i])))));
      }
      if(error>2e-6||minDet<.004){status.textContent='The independent URDF rotation or full-Jacobian check rejected this path.';return;}
      state.path=result.path;const points=result.path.map(q=>model.wrist(q));state.trace=points.map(p=>[p.x,p.z]);
      viewer.setGhost(result.path[0]);viewer.setTrace(points);viewer.update(result.path[0]);
      host.dataset.maxRotationError=String(error);host.dataset.minAbsDet=String(minDet);
      status.textContent=`${result.path.length} discrete configurations · min |det J| ${minDet.toFixed(3)} · min |sin q₅| ${result.minWrist.toFixed(3)} · max rotation error ${error.toExponential(1)}. Arm edges and the continued wrist pass numerical checks. Press Play.`;
    }catch(error){status.textContent=`Path search failed: ${error.message}`;}
    finally{if(version===state.version){state.busy=false;syncControls();draw();}}
  }
  function draw(){
    if(!pair.ready()||!state.cache)return;
    const [a,b]=pair.contexts,[as,bs]=pair.sizes;clear(a,as);clear(b,bs);
    const jm=plotMap(as,[-PI,PI],[-PI,PI],{x:'q₂ (rad)',y:'q₃ (rad)'}),wm=plotMap(bs,state.cache.rhoRange,state.cache.zRange,{x:canPlan?'x (m), y = 0':'ρ (m)',y:'z (m)'});state.jmap=jm;state.wmap=wm;
    axes(a,jm);axes(b,wm);
    drawSegments(a,state.cache.singularSegments,jm,'#e00000',1.8);drawSegments(b,state.cache.criticalSegments,wm,'#e00000',1.8);
    if(state.path.length){polylineTorus(a,state.path.map(q=>q.slice(1,3).map(wrap)),jm,'#111',3);polyline(b,state.trace,wm,'#2474d2',3);}
    state.solutions.forEach((q,i)=>dot(a,jm.toPx(q[1],q[2]),COLORS[i%COLORS.length],i===state.selected?8:5,'#111'));
    if(state.target){dot(b,wm.toPx(...state.target),'#fff',7,'#111');ring(b,wm.toPx(...state.target),COLORS[state.selected%COLORS.length],10,3);}
    if(state.path.length){const i=Math.round(state.progress*(state.path.length-1)),q=state.path[i];dot(a,jm.toPx(wrap(q[1]),wrap(q[2])),'#fff',5,'#111');dot(b,wm.toPx(...state.trace[i]),'#fff',5,'#111');}
  }
  wc.addEventListener('pointerdown',event=>{
    if(state.busy||!state.wmap)return;
    const rect=wc.getBoundingClientRect(),p=state.wmap.fromPx(event.clientX-rect.left,event.clientY-rect.top);
    if(p[0]<state.wmap.xr[0]||p[0]>state.wmap.xr[1]||p[1]<state.wmap.yr[0]||p[1]>state.wmap.yr[1])return;
    state.target=p;solveTarget();
  });
  if(canPlan){
    for(const key of ['start','goal'])host.querySelector(`[data-${key}]`).addEventListener('change',event=>{clearPath();state[key]=+event.target.value;select(state[key]);status.textContent='Endpoints changed. Build a new path at the same fixed orientation.';syncControls();});
    host.querySelector('[data-build]').addEventListener('click',buildPath);
    host.querySelector('[data-play]').addEventListener('click',()=>{
      if(state.playing){pause();return;}if(state.busy||state.path.length<2)return;
      if(state.progress>=1)state.progress=0;
      const version=state.version,duration=Math.max(6000,state.path.length*12),started=performance.now()-state.progress*duration;
      state.playing=true;syncControls();
      const step=now=>{if(!state.playing||version!==state.version)return;if(document.hidden||!host.closest('.slide')?.classList.contains('active')){pause();return;}showSample(Math.min(1,(now-started)/duration));if(state.progress<1)state.frame=requestAnimationFrame(step);else pause();};
      state.frame=requestAnimationFrame(step);
    });
    host.querySelector('[data-progress]').addEventListener('input',event=>{const progress=Number(event.target.value);pause();showSample(progress);});
    document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});window.addEventListener('hashchange',pause);
  }else{
    let timer=null;host.querySelector('[data-autoplay]').addEventListener('change',event=>{clearInterval(timer);if(event.target.checked)timer=setInterval(()=>{if(!document.hidden&&host.closest('.slide')?.classList.contains('active'))select(state.selected+1);},1700);});
  }
  solveTarget();
}

async function createAbbAspectLab(host) {
  const {solveAbbIk,ABB_IK_EXAMPLE}=await import(`./abbIrbIk.js?v=${MODULE_REVISION}`);
  host.classList.add('cusp-lab','cusp-partitioned','cusp-abb');
  host.innerHTML='<div class="cusp-partition-panels"><div class="cusp-plot"><h3>ABB arm singularities · q₂,q₃</h3><canvas data-joint></canvas></div><div class="cusp-plot"><h3>wrist-center section · y = 0, x ≥ 0</h3><canvas data-work></canvas></div><div class="cusp-stage" data-stage><div class="hud">ABB IRB 4600</div></div></div><div class="cusp-abb-legend"><span><i style="background:#e00000"></i>shoulder: G = 0</span><span><i style="background:#2474d2"></i>elbow: F = a₃ sin q₃ + d₄ cos q₃ = 0</span><span>wrist: sin q₅ = 0 · coincident arm markers represent wrist flips</span></div><div class="cusp-partition-controls"><div class="cusp-iks" data-iks></div><div class="cusp-status" data-status role="status"></div><div><button data-example>Example target</button><label class="cusp-toggle"><input type="checkbox" data-autoplay> cycle through IKs</label></div></div>';
  const viewer=await createModelViewer(host.querySelector('[data-stage]'),'abb',{embedded:true,showEeFrame:true});
  const jc=host.querySelector('[data-joint]'),wc=host.querySelector('[data-work]'),status=host.querySelector('[data-status]');
  const {a1,a2,a3,d1,d4}=ABB_PARAMETERS;
  const factors={
    shoulder:([q2,q3])=>a1+a2*Math.sin(q2)+a3*Math.sin(q2+q3)+d4*Math.cos(q2+q3),
    elbow:([,q3])=>a3*Math.sin(q3)+d4*Math.cos(q3)
  };
  const mapFn=([q2,q3])=>[Math.abs(factors.shoulder([q2,q3])),d1+a2*Math.cos(q2)+a3*Math.cos(q2+q3)-d4*Math.sin(q2+q3)];
  const cache=buildFactoredMapCache(mapFn,factors,401);
  const state={target:ABB_IK_EXAMPLE.target.wrist.slice(),solutions:[],selected:0,map:null};
  const pair=resizeCanvases([jc,wc],draw);
  function solveTarget() {
    state.solutions=solveAbbIk({...ABB_IK_EXAMPLE.target,wrist:state.target}).filter(row=>!row.singular&&Math.abs(row.determinant)>1e-8);state.selected=0;
    host.dataset.ikCount=String(state.solutions.length);
    host.dataset.target=JSON.stringify(state.target);
    host.dataset.rotation=JSON.stringify(ABB_IK_EXAMPLE.target.rotation);
    if(state.solutions.length)viewer.update(state.solutions[0].q);
    render();
  }
  function select(i){if(!state.solutions.length)return;state.selected=(i+state.solutions.length)%state.solutions.length;viewer.update(state.solutions[state.selected].q);render();}
  function render(){
    const pills=host.querySelector('[data-iks]');
    pills.innerHTML=state.solutions.map((row,i)=>`<button data-i="${i}" aria-pressed="${i===state.selected}" class="${i===state.selected?'selected':''}" title="S,E,W = ${row.signs.map(s=>s>0?'+':'−').join(', ')}">IK ${i+1}</button>`).join('');
    pills.querySelectorAll('button').forEach(button=>button.addEventListener('click',()=>select(+button.dataset.i)));
    const row=state.solutions[state.selected];
    if(row){
      const T=viewer.model.pose(row.q),Rerror=rotationMatrixResidual(rotationOnly(T),ABB_IK_EXAMPLE.target.rotation);
      const perror=viewer.model.wrist(row.q).distanceTo(new THREE.Vector3(...state.target));
      host.dataset.positionError=String(perror);host.dataset.rotationError=String(Rerror);host.dataset.selectedIk=String(state.selected);
      host.dataset.selectedQ=JSON.stringify(row.q);host.dataset.signs=JSON.stringify(row.signs);
      status.textContent=`${state.solutions.length} regular IKs · IK ${state.selected+1}: S ${row.signs[0]>0?'+':'−'}, E ${row.signs[1]>0?'+':'−'}, W ${row.signs[2]>0?'+':'−'} · wrist error ${perror.toExponential(1)} m · rotation error ${Rerror.toExponential(1)}. Mathematical branches before joint-limit filtering.`;
    }else status.textContent='No isolated regular IK at this target. Select a point away from the singular curves inside the reachable section.';
    draw();
  }
  function draw(){
    if(!pair.ready())return;
    const [jctx,wctx]=pair.contexts,[js,ws]=pair.sizes;clear(jctx,js);clear(wctx,ws);
    const jm=plotMap(js,[-PI,PI],[-PI,PI],{x:'q₂ (rad)',y:'q₃ (rad)'}),wm=plotMap(ws,cache.rhoRange,cache.zRange,{x:'x (m), y = 0',y:'z (m)'});state.map=wm;
    axes(jctx,jm);axes(wctx,wm);
    cache.factorGroups.forEach(group=>{drawSegments(jctx,group.singularSegments,jm,group.color,2);drawSegments(wctx,group.criticalSegments,wm,group.color,2);});
    const arms=new Map();
    state.solutions.forEach((row,i)=>{const key=row.q.slice(0,3).map(q=>q.toFixed(7)).join(',');if(!arms.has(key))arms.set(key,{q:row.q,indices:[]});arms.get(key).indices.push(i);});
    Array.from(arms.values()).forEach(({q,indices},index)=>{
      const point=jm.toPx(q[1],q[2]),selected=indices.includes(state.selected);
      dot(jctx,point,COLORS[index%COLORS.length],selected?8:5,'#111');
      jctx.save();jctx.font='bold 10px Arial';jctx.textAlign=point[0]>jm.pad.l+jm.w-35?'right':'left';jctx.fillStyle='#111';jctx.strokeStyle='#fff';jctx.lineWidth=3;
      const label=indices.map(i=>i+1).join('/'),x=point[0]+(jctx.textAlign==='right'?-10:10),y=point[1]-9;
      jctx.strokeText(label,x,y);jctx.fillText(label,x,y);jctx.restore();
    });
    dot(wctx,wm.toPx(state.target[0],state.target[2]),'#111',7,'#fff');
  }
  wc.addEventListener('pointerdown',event=>{
    if(!state.map)return;const rect=wc.getBoundingClientRect(),p=state.map.fromPx(event.clientX-rect.left,event.clientY-rect.top);
    if(p[0]<0||p[0]>state.map.xr[1]||p[1]<state.map.yr[0]||p[1]>state.map.yr[1])return;
    state.target=[p[0],0,p[1]];solveTarget();
  });
  host.querySelector('[data-example]').addEventListener('click',()=>{state.target=ABB_IK_EXAMPLE.target.wrist.slice();solveTarget();});
  let timer=null;host.querySelector('[data-autoplay]').addEventListener('change',event=>{clearInterval(timer);if(event.target.checked)timer=setInterval(()=>{if(!document.hidden&&host.closest('.slide')?.classList.contains('active'))select(state.selected+1);},1600);});
  solveTarget();
}

async function createAbbFactorsLab(host) {
  host.classList.add('cusp-abb-factors');
  host.innerHTML='<div class="cusp-stage" data-stage><div class="hud">ABB IRB 4600</div></div><div class="cusp-abb-cases"><button data-case="regular">Regular</button><button data-case="G">Shoulder</button><button data-case="F">Elbow</button><button data-case="wrist">Wrist</button></div><div class="cusp-status" data-status role="status"></div>';
  const viewer=await createModelViewer(host.querySelector('[data-stage]'),'abb',{embedded:true,showEeFrame:true});
  function select(name){
    const q=abbPreset(name),f=abbFactors(q);viewer.update(q);
    host.querySelectorAll('[data-case]').forEach(button=>{button.classList.toggle('selected',button.dataset.case===name);button.setAttribute('aria-pressed',String(button.dataset.case===name));});
    const J=abbJacobian(q),rank=numericRank(J);
    host.dataset.rank=String(rank);host.dataset.case=name;
    host.querySelector('[data-status]').textContent=`G = ${f.G.toFixed(4)} m · F = ${f.F.toFixed(4)} m · sin q₅ = ${f.wrist.toFixed(4)} · rank J = ${rank}/6`;
  }
  host.querySelectorAll('[data-case]').forEach(button=>button.addEventListener('click',()=>select(button.dataset.case)));
  select('regular');
}

function buildNumericalMapCache(mapFn,detFn,n){const values=Array.from({length:n},()=>Array(n));let maxR=0,minZ=Infinity,maxZ=-Infinity;for(let i=0;i<n;i+=1)for(let j=0;j<n;j+=1){const q=[-PI+2*PI*i/(n-1),-PI+2*PI*j/(n-1)],w=mapFn(q);values[i][j]=detFn(q);maxR=Math.max(maxR,w[0]);minZ=Math.min(minZ,w[1]);maxZ=Math.max(maxZ,w[1]);}const singularSegments=marchingSquares(values,[-PI,PI],[-PI,PI]),criticalSegments=singularSegments.map(segment=>segment.map(mapFn)),pad=Math.max(.08,(maxZ-minZ)*.08);return{singularSegments,criticalSegments,rhoRange:[0,maxR*1.08],zRange:[minZ-pad,maxZ+pad]};}

function buildFactoredMapCache(mapFn,factors,n){let maxR=0,minZ=Infinity,maxZ=-Infinity;const grids={};for(const name of Object.keys(factors))grids[name]=Array.from({length:n},()=>Array(n));for(let i=0;i<n;i+=1)for(let j=0;j<n;j+=1){const q=[-PI+2*PI*i/(n-1),-PI+2*PI*j/(n-1)],w=mapFn(q);for(const [name,fn] of Object.entries(factors))grids[name][i][j]=fn(q);maxR=Math.max(maxR,w[0]);minZ=Math.min(minZ,w[1]);maxZ=Math.max(maxZ,w[1]);}const palette={shoulder:'#e00000',elbow:'#2474d2'},factorGroups=Object.keys(factors).map(name=>{const singularSegments=marchingSquares(grids[name],[-PI,PI],[-PI,PI]);return{name,color:palette[name],singularSegments,criticalSegments:singularSegments.map(segment=>segment.map(mapFn))};}),pad=Math.max(.08,(maxZ-minZ)*.08);return{factorGroups,rhoRange:[0,maxR*1.08],zRange:[minZ-pad,maxZ+pad]};}

function solveMapIk(target,mapFn,detFn){const roots=[];for(let i=0;i<20;i+=1)for(let j=0;j<20;j+=1){let q=[-PI+2*PI*(i+.31)/20,-PI+2*PI*(j+.67)/20];for(let k=0;k<32;k+=1){const f=mapFn(q),e=[target[0]-f[0],target[1]-f[1]],h=1e-5,a=mapFn([q[0]+h,q[1]]),b=mapFn([q[0],q[1]+h]),J=[[(a[0]-f[0])/h,(b[0]-f[0])/h],[(a[1]-f[1])/h,(b[1]-f[1])/h]],d=J[0][0]*J[1][1]-J[0][1]*J[1][0];if(Math.hypot(...e)<1e-8)break;if(Math.abs(d)<1e-9)break;q=[wrap(q[0]+clamp((e[0]*J[1][1]-J[0][1]*e[1])/d,-.45,.45)),wrap(q[1]+clamp((J[0][0]*e[1]-e[0]*J[1][0])/d,-.45,.45))];}if(distance2(mapFn(q),target)<2e-5&&Math.abs(detFn(q))>1e-5&&!roots.some(r=>torusDistance(r,q)<1.5e-1))roots.push(q);}return roots;}

function rotationOnly(matrix){const e=matrix.elements;return[[e[0],e[4],e[8]],[e[1],e[5],e[9]],[e[2],e[6],e[10]]];}
function rotationMatrixResidual(a,b){let error=0;for(let r=0;r<3;r+=1)for(let c=0;c<3;c+=1)error=Math.max(error,Math.abs(a[r][c]-b[r][c]));return error;}
function orientationError(current,target){const col=(R,i)=>[R[0][i],R[1][i],R[2][i]],cross3=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],e=[0,0,0];for(let i=0;i<3;i+=1){const c=cross3(col(current,i),col(target,i));for(let k=0;k<3;k+=1)e[k]+=.5*c[k];}return e;}
function norm(v){return Math.hypot(...v);}
function jointDistance(a,b){return Math.hypot(...a.map((v,i)=>wrap(v-b[i])));}

async function createFanuc16Lab(host) {
  host.className += ' cusp-lab cusp-fanuc';
  host.innerHTML = '<div class="cusp-stage" data-stage><div class="hud">CRX course model · common tool pose</div></div><aside class="cusp-fanuc-panel"><div class="cusp-branch-map"><canvas></canvas></div><div class="cusp-fanuc-actions"><label class="cusp-toggle"><input type="checkbox" data-multiple> Show multiple IKs</label><button data-show-all>Show all</button><span class="cusp-fanuc-count" data-count></span></div><div class="cusp-iks" data-iks aria-label="Inverse-kinematic configurations"></div><div class="cusp-formula" data-q></div><div class="cusp-status" data-status></div><label class="cusp-toggle"><input type="checkbox" data-autoplay> cycle through individual IKs</label></aside>';
  const [viewer, response] = await Promise.all([
    createModelViewer(host.querySelector('[data-stage]'), 'fanuc', { embedded: true, showEeFrame: true }),
    fetch(new URL('../../assets/data/ik16_solutions.csv', import.meta.url))
  ]);
  if (!response.ok) throw new Error('Could not load ik16_solutions.csv.');
  const signs = [1,-1,-1,1,-1,-1], offsets = [0,-PI/2,0,PI,PI,0];
  const rows = (await response.text()).trim().split(/\r?\n/).slice(1).map(line => {
    const v = line.split(',').map(Number), qDh = v.slice(1,7).map(x => x*DEG);
    const q = qDh.map((x,i) => wrap(signs[i]*x+offsets[i]));
    return { id:v[0], q, positionError:v[7], rotationError:v[8], sigma:v[9] };
  });
  let selected = 0, timer = null, map;
  const visible = new Set([0,1]);
  const multi = host.querySelector('[data-multiple]'), autoplay = host.querySelector('[data-autoplay]');
  const canvas = host.querySelector('.cusp-branch-map canvas'), pair = resizeCanvases([canvas], draw);
  const target = viewer.model.pose(rows[0].q);
  const maxResidual = Math.max(...rows.map(row => matrixResidual(viewer.model.pose(row.q), target)));
  host.dataset.fkResidual = String(maxResidual);
  function refresh() {
    viewer.update(rows[selected].q);
    viewer.setConfigurations(multi.checked ? [...visible].map(i => ({id:i, q:rows[i].q, color:COLORS[i%COLORS.length]})) : null);
    const h = host.querySelector('[data-iks]');
    h.innerHTML = rows.map((row,i) => `<button data-i="${i}" style="--ik-color:${COLORS[i%COLORS.length]}" class="${selected===i?'selected ':''}${multi.checked&&visible.has(i)?'visible-ik':''}" aria-pressed="${multi.checked?visible.has(i):selected===i}" title="${multi.checked?'Toggle visibility of':'Select'} IK ${row.id}">${multi.checked&&visible.has(i)?'✓ ':''}${row.id}</button>`).join('');
    h.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      selected = +b.dataset.i;
      if (multi.checked) { if (visible.has(selected)) visible.delete(selected); else visible.add(selected); }
      refresh();
    }));
    host.querySelector('[data-count]').textContent = `${multi.checked?visible.size:1} / ${rows.length} visible`;
    host.dataset.visibleCount = String(multi.checked?visible.size:1);
    const row = rows[selected];
    host.querySelector('[data-q]').textContent = `IK ${row.id} · URDF angles\nq = (${row.q.map(v => `${(v/DEG).toFixed(1)}°`).join(', ')})`;
    host.querySelector('[data-status]').textContent = `${multi.checked?'Toggle the numbered buttons to compare configurations at the common tool pose.':'Choose one IK, or enable multiple configurations.'} CSV errors: ${row.positionError.toExponential(1)} m, ${row.rotationError.toExponential(1)} rad · scaled σmin ${row.sigma.toFixed(4)}.`;
    draw();
  }
  function stopCycle() { clearInterval(timer); timer = null; autoplay.checked = false; }
  multi.addEventListener('change', () => { stopCycle(); if (multi.checked) visible.add(selected); refresh(); });
  host.querySelector('[data-show-all]').addEventListener('click', () => {
    stopCycle(); multi.checked = true; rows.forEach((_,i) => visible.add(i)); refresh();
  });
  autoplay.addEventListener('change', () => {
    clearInterval(timer); timer = null;
    if (autoplay.checked) {
      multi.checked = false; refresh();
      timer = setInterval(() => {
        if (document.hidden || !host.closest('.slide')?.classList.contains('active')) return;
        selected = (selected+1)%rows.length; refresh();
      },1250);
    }
  });
  function draw() {
    if (!pair.ready()) return;
    const ctx=pair.contexts[0],size=pair.sizes[0];clear(ctx,size);
    map=plotMap(size,[-PI,PI],[-PI,PI],{x:'q₁ (rad)',y:'q₂ (rad)'});axes(ctx,map);
    rows.forEach((row,i) => {
      const shown = multi.checked ? visible.has(i) : i===selected;
      dot(ctx,map.toPx(row.q[0],row.q[1]),shown?COLORS[i%COLORS.length]:'#ddd',i===selected?8:5,shown?'#111':'#aaa');
    });
  }
  canvas.addEventListener('pointerdown', event => {
    if (!map) return;
    const r=canvas.getBoundingClientRect(), p=[event.clientX-r.left,event.clientY-r.top];
    let nearest=-1, d=18;
    rows.forEach((row,i)=>{const px=map.toPx(row.q[0],row.q[1]),dist=distance2(p,px);if(dist<d){nearest=i;d=dist;}});
    if(nearest>=0){selected=nearest;if(multi.checked)visible.add(selected);refresh();}
  });
  refresh();
  console.info(`ENG-654 Lecture 06 FANUC CSV check: ${rows.length} solutions, maximum URDF FK residual ${maxResidual}.`);
}

function matrixResidual(a,b){return Math.max(...a.elements.map((v,i)=>Math.abs(v-b.elements[i])));}

function buildSingularityCache(p,n=321) {
  const values=Array.from({length:n},()=>Array(n));let maxR=0,minZ=Infinity,maxZ=-Infinity;
  for(let i=0;i<n;i+=1)for(let j=0;j<n;j+=1){const q2=-PI+2*PI*i/(n-1),q3=-PI+2*PI*j/(n-1);values[i][j]=det3([0,q2,q3],p);const w=sliceFk([q2,q3],p);maxR=Math.max(maxR,w[0]);minZ=Math.min(minZ,w[1]);maxZ=Math.max(maxZ,w[1]);}
  const singularSegments=marchingSquares(values,[-PI,PI],[-PI,PI]),criticalBranches=algebraicCriticalBranches(p,1000);
  const padZ=Math.max(.4,(maxZ-minZ)*.08);return{singularSegments,criticalBranches,rhoRange:[0,maxR*1.08],zRange:[minZ-padZ,maxZ+padZ]};
}

function marchingSquares(values,xr,yr){const nx=values.length,ny=values[0].length,segments=[],point=(i,j)=>[xr[0]+(xr[1]-xr[0])*i/(nx-1),yr[0]+(yr[1]-yr[0])*j/(ny-1)],cross=(p0,p1,v0,v1)=>{const t=v0===v1?.5:v0/(v0-v1);return[p0[0]+t*(p1[0]-p0[0]),p0[1]+t*(p1[1]-p0[1])];};for(let i=0;i<nx-1;i+=1)for(let j=0;j<ny-1;j+=1){const p=[point(i,j),point(i+1,j),point(i+1,j+1),point(i,j+1)],v=[values[i][j],values[i+1][j],values[i+1][j+1],values[i][j+1]],hits=[];for(let e=0;e<4;e+=1){const k=(e+1)%4;if((v[e]<=0&&v[k]>0)||(v[e]>0&&v[k]<=0))hits.push(cross(p[e],p[k],v[e],v[k]));}if(hits.length===2)segments.push(hits);else if(hits.length===4){const center=(v[0]+v[1]+v[2]+v[3])/4;if((v[0]>0)=== (center>0))segments.push([hits[0],hits[3]],[hits[1],hits[2]]);else segments.push([hits[0],hits[1]],[hits[2],hits[3]]);}}return segments;}

function algebraicCriticalBranches(p,count){const branches=[],active=[];for(let i=0;i<count;i+=1){const q2=-PI+2*PI*i/(count-1),coeff=detPolynomialV(q2,p),roots=realPolynomialRoots(coeff).map(v=>2*Math.atan(v)).sort((a,b)=>a-b),used=new Set();for(let k=0;k<active.length;k+=1){let best=-1,dist=.22;for(let r=0;r<roots.length;r+=1)if(!used.has(r)&&Math.abs(wrap(roots[r]-active[k].q3))<dist){best=r;dist=Math.abs(wrap(roots[r]-active[k].q3));}if(best>=0){active[k].q3=roots[best];active[k].points.push(sliceFk([q2,roots[best]],p));used.add(best);}else{if(active[k].points.length>1)branches.push(active[k].points);active[k].points=[];}}for(let r=0;r<roots.length;r+=1)if(!used.has(r))active.push({q3:roots[r],points:[sliceFk([q2,roots[r]],p)]});}
  active.forEach(a=>{if(a.points.length>1)branches.push(a.points);});if(p.a1<1e-7&&close(p.A1,PI/2)&&close(p.A2,PI/2)){for(const q2 of [-PI/2,PI/2])branches.push(Array.from({length:1000},(_,i)=>sliceFk([q2,-PI+2*PI*i/999],p)));}return branches;}

function detPolynomialV(q2,p){const samples=[-2,-1,0,1,2],A=samples.map(v=>[1,v,v*v,v**3,v**4]),b=samples.map(v=>det3([0,q2,2*Math.atan(v)],p)*(1+v*v)**2);return solveLinear(A,b);}
function realPolynomialRoots(coeff){let c=coeff.slice();while(c.length>1&&Math.abs(c.at(-1))<1e-8)c.pop();const degree=c.length-1;if(degree<1)return[];if(degree===1)return[-c[0]/c[1]];const derivative=c.slice(1).map((v,i)=>v*(i+1)),critical=realPolynomialRoots(derivative).sort((a,b)=>a-b),bound=1+Math.max(...c.slice(0,-1).map(v=>Math.abs(v/c.at(-1)))),cuts=[-bound,...critical.filter(x=>x>-bound&&x<bound),bound],evalP=(x)=>c.reduceRight((s,v)=>s*x+v,0),roots=[];for(const x of critical)if(Math.abs(evalP(x))<1e-6)roots.push(x);for(let i=0;i<cuts.length-1;i+=1){let a=cuts[i],b=cuts[i+1],fa=evalP(a),fb=evalP(b);if(fa===0)roots.push(a);if(fa*fb>0)continue;for(let k=0;k<60;k+=1){const m=(a+b)/2,fm=evalP(m);if(fa*fm<=0){b=m;fb=fm;}else{a=m;fa=fm;}}roots.push((a+b)/2);}return roots.filter(Number.isFinite).sort((a,b)=>a-b).filter((x,i,a)=>i===0||Math.abs(x-a[i-1])>1e-5);}

function solveIkSlice(target,p) {
  const roots=[];
  for(let i=0;i<18;i+=1)for(let j=0;j<18;j+=1){let q=[-PI+2*PI*(i+.35)/18,-PI+2*PI*(j+.65)/18];for(let k=0;k<35;k+=1){const f=sliceFk(q,p),e=[target[0]-f[0],target[1]-f[1]];if(Math.hypot(...e)<1e-8)break;const h=1e-5,fx=sliceFk([q[0]+h,q[1]],p),fy=sliceFk([q[0],q[1]+h],p),J=[[(fx[0]-f[0])/h,(fy[0]-f[0])/h],[(fx[1]-f[1])/h,(fy[1]-f[1])/h]],d=J[0][0]*J[1][1]-J[0][1]*J[1][0];if(Math.abs(d)<1e-9)break;const dq=[(e[0]*J[1][1]-J[0][1]*e[1])/d,(J[0][0]*e[1]-e[0]*J[1][0])/d];q=[wrap(q[0]+clamp(dq[0],-.5,.5)),wrap(q[1]+clamp(dq[1],-.5,.5))];}
    if(distance2(sliceFk(q,p),target)<1e-6&&Math.abs(det3([0,...q],p))>1e-5&&!roots.some(r=>torusDistance(r,q)<2e-3))roots.push(q);
  }
  return roots.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
}


function verifyContinuation(path,p){let seed=path[0].slice();for(let i=1;i<path.length;i+=Math.max(1,Math.floor(path.length/40))){const target=sliceFk(path[i],p),sol=solveNear(target,seed,p);if(!sol||torusDistance(sol,path[i])>.08)return false;seed=sol;}return true;}
async function verifyFullIkContinuation(path,viewer,solvePosition){if(!path.length)return false;const stride=Math.max(1,Math.floor(path.length/14));for(let i=0;i<path.length;i+=stride){const q=path[i],point=viewer.point(q),solutions=await solvePosition([point.x,point.y,point.z]);if(!solutions.some(candidate=>Math.hypot(...candidate.map((angle,j)=>wrap(angle-q[j])))<2e-3))return false;}const q=path.at(-1),point=viewer.point(q),solutions=await solvePosition([point.x,point.y,point.z]);return solutions.some(candidate=>Math.hypot(...candidate.map((angle,j)=>wrap(angle-q[j])))<2e-3);}
function solveNear(target,seed,p){let q=seed.slice();for(let k=0;k<18;k+=1){const f=sliceFk(q,p),e=[target[0]-f[0],target[1]-f[1]],h=1e-5,fx=sliceFk([q[0]+h,q[1]],p),fy=sliceFk([q[0],q[1]+h],p),a=(fx[0]-f[0])/h,b=(fy[0]-f[0])/h,c=(fx[1]-f[1])/h,d=(fy[1]-f[1])/h,det=a*d-b*c;if(Math.abs(det)<1e-9)return null;q=[wrap(q[0]+clamp((e[0]*d-b*e[1])/det,-.3,.3)),wrap(q[1]+clamp((a*e[1]-e[0]*c)/det,-.3,.3))];if(Math.hypot(...e)<1e-7)return q;}return distance2(sliceFk(q,p),target)<1e-5?q:null;}

function sliceFk(q,p){const v=fkDh([0,q[0],q[1]],p).end;return[Math.hypot(v.x,v.y),v.z];}
function det3(q,p){const k=fkDh(q,p),cols=k.axes.map((z,i)=>z.clone().cross(k.end.clone().sub(k.origins[i])));return cols[0].dot(cols[1].clone().cross(cols[2]));}
function fkDh(q,p){const rows=[[p.a1,p.A1,p.d1],[p.a2,p.A2,p.d2],[p.a3,p.A3,p.d3]],T=new THREE.Matrix4(),origins=[],axes=[];for(let i=0;i<3;i+=1){origins.push(new THREE.Vector3().setFromMatrixPosition(T));axes.push(new THREE.Vector3(0,0,1).transformDirection(T));T.multiply(dhMatrix(q[i],...rows[i]));}return{end:new THREE.Vector3().setFromMatrixPosition(T),origins,axes,T};}
function dhMatrix(theta,a,alpha,d){const c=Math.cos(theta),s=Math.sin(theta),ca=Math.cos(alpha),sa=Math.sin(alpha);return new THREE.Matrix4().set(c,-s*ca,s*sa,a*c,s,c*ca,-c*sa,a*s,0,sa,ca,d,0,0,0,1);}

function factorText(p){
  if(close(p.A1,PI/2)&&close(p.A2,PI/2)&&close(p.d2,1)&&close(p.d3,0)&&close(p.a2,2)&&close(p.a3,1.5))return close(p.a1,0)?'det(Jₚ) = ¾(3c₃ + 4)c₂(c₃ − 2s₃)\nindependent of q₁, d₁, α₃':`det(Jₚ) = ¾(3c₃ + 4)[c₂(c₃ − 2s₃) − ${close(p.a1,1)?'':p.a1.toFixed(2)}s₃]\nindependent of q₁, d₁, α₃`;
  const [[a1,A1],[a2,A2,d2],[a3,,d3]]=[[p.a1,p.A1,p.d1],[p.a2,p.A2,p.d2],[p.a3,p.A3,p.d3]],s1=Math.sin(A1),c1=Math.cos(A1),s2=Math.sin(A2),c2=Math.cos(A2),terms=(xs)=>xs.filter(([v])=>Math.abs(v)>1e-7).map(([v,t],i)=>`${i?(v>=0?' + ':' − '):(v<0?'−':'')}${Math.abs(v).toFixed(3)}${t}`).join('')||'0';
  const f0=terms([[-a1*a2*s1,'s₃'],[-a1*a3*s1*s2*s2,'s₃c₃'],[-a1*d3*s1*s2*c2,'c₃']]),fs=terms([[a1*a2*s2*c1+d2*d3*s1*s2*s2,'c₃'],[a1*a3*s2*c1,'c₃²'],[a2*a3*s1*c2,'s₃²'],[-a2*d3*s1*s2,'s₃'],[-a3*d2*s1*s2*c2,'s₃c₃']]),fc=terms([[a1*a3*s2*c1*c2-a2*a3*s1,'s₃c₃'],[-a1*d3*s2*s2*c1+a2*d2*s1*s2,'c₃'],[-a2*a2*s1,'s₃'],[a3*d2*s1*s2,'c₃²']]);return`det(Jₚ) = ${a3.toFixed(3)}[F₀ + s₂Fₛ + c₂F꜀]\nF₀ = ${f0}\nFₛ = ${fs}\nF꜀ = ${fc}\nindependent of q₁, d₁, α₃`;
}

export async function createModelViewer(host,key,options={}) {
  host.classList.add('cusp-stage');
  const spec=MODEL_SPECS[key],kit=createThreeKit(host,spec),model=key==='abb'?await loadAbbViewerModel(kit.world):await loadUrdfRobot(kit.world,spec);
  if(key==='abb'){kit.renderer.toneMapping=THREE.ACESFilmicToneMapping;kit.renderer.toneMappingExposure=.85;}
  kit.sceneControls.registerStlRoot(model.root);
  let q=spec.q.map(v=>v*DEG),ghost=null,trace=null,eeFrame=null;
  const overlays = new Map();
  function removeClone(clone) {
    if (!clone) return;
    kit.sceneControls.unregisterStlRoot(clone); clone.removeFromParent();
    clone.traverse(o => { if (o.isMesh) o.material.dispose(); });
  }
  function cloneRobot(color, opacity) {
    const clone = model.root.clone(true); clone.visible = true;
    clone.traverse(o => { if (o.isMesh) {
      o.material = o.material.clone();
      if (color) o.material.color.set(color);
      o.material.transparent = true; o.material.opacity = opacity; o.material.depthWrite = false;
    } });
    kit.world.add(clone); kit.sceneControls.registerStlRoot(clone); return clone;
  }
  if(options.showEeFrame){eeFrame=new THREE.Group();const axes=new THREE.AxesHelper(spec.frameScale||.25),origin=new THREE.Mesh(new THREE.SphereGeometry((spec.frameScale||.25)*.055,16,10),new THREE.MeshBasicMaterial({color:0x111111}));eeFrame.add(axes,origin);eeFrame.matrixAutoUpdate=false;eeFrame.renderOrder=15;kit.world.add(eeFrame);}
  const updateFrame=(next)=>{if(eeFrame){eeFrame.matrix.copy(model.pose(next));eeFrame.matrixWorldNeedsUpdate=true;}};
  model.update(q);updateFrame(q);kit.render();
  if(!host.querySelector('.hud')&&!host.hasAttribute('data-hide-badge')&&options.label!==false){const badge=document.createElement('div');badge.className='hud';badge.dataset.course3dLabel='';badge.textContent=options.embedded?spec.label:`${spec.label} · ${model.meshCount} course STL links`;badge.hidden=kit.world.userData.courseLabelsVisible===false;host.append(badge);}
  return {
    update(next){q=next.slice();model.update(q);updateFrame(q);kit.render();},
    point(next){return model.point(next);},
    sliceConfiguration(slice){const p0=model.point([0,slice[0],slice[1]]);return[-Math.atan2(p0.y,p0.x),slice[0],slice[1]];},
    setGhost(next){removeClone(ghost);ghost=null;if(next){ghost=cloneRobot(null,.18);model.applyTo(ghost,next);}kit.render();},
    setTrace(points){if(trace){trace.removeFromParent();trace.geometry.dispose();trace.material.dispose();trace=null;}if(points.length>1){const g=new THREE.BufferGeometry().setFromPoints(points),m=new THREE.LineBasicMaterial({color:0x2474d2,linewidth:3});trace=new THREE.Line(g,m);kit.world.add(trace);}kit.render();},
    setConfigurations(configurations=null) {
      const wanted = new Set((configurations || []).map(c => c.id));
      for (const [id, clone] of overlays) clone.visible = wanted.has(id);
      model.root.visible = configurations === null;
      for (const config of configurations || []) {
        let clone = overlays.get(config.id);
        if (!clone) { clone = cloneRobot(config.color,.38); overlays.set(config.id,clone); }
        clone.visible = true; model.applyTo(clone,config.q);
      }
      host.dataset.visibleConfigurations = String(configurations === null ? 1 : configurations.length);
      kit.render();
    },
    model,
    dispose(){removeClone(ghost);overlays.forEach(removeClone);if(trace){trace.geometry.dispose();trace.material.dispose();}model.dispose?.();kit.dispose();}
  };
}

async function loadAbbViewerModel(world) {
  const visuals = await loadAbbIrbVisuals(world);
  const matrix = rows => new THREE.Matrix4().set(...rows.flat());
  const pose = (q,linkName='tool0') => matrix(abbUrdfTransforms(q)[linkName]);
  const point = (q,linkName='tool0') => new THREE.Vector3().setFromMatrixPosition(pose(q,linkName));
  return {
    root: visuals.group, meshCount: visuals.count,
    update(q) { visuals.update(abbUrdfTransforms(q)); },
    applyTo(clone,q) {
      const transforms = abbUrdfTransforms(q);
      clone.children.forEach(node=>{if(transforms[node.name]){node.matrix.copy(matrix(transforms[node.name]));node.matrixWorldNeedsUpdate=true;}});
    },
    pose, point,
    wrist(q) { return new THREE.Vector3(...abbDHKinematics(q).wrist); },
    geometricJacobian(q) {
      const p=point(q),J=abbJacobian(q,{point:p.toArray()});
      return {columns:J[0].map((_,i)=>J.map(row=>row[i])),indices:[0,1,2,3,4,5],p,T:pose(q)};
    },
    dispose:visuals.dispose
  };
}

function createThreeKit(host,spec){
  const scene=new THREE.Scene();scene.background=new THREE.Color(0xf3f4f5);
  const camera=new THREE.PerspectiveCamera(38,1,.01,100);camera.position.fromArray(spec.camera);
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.7));renderer.outputColorSpace=THREE.SRGBColorSpace;host.prepend(renderer.domElement);
  scene.add(new THREE.HemisphereLight(0xffffff,0x5b6670,2.5));const light=new THREE.DirectionalLight(0xffffff,2.5);light.position.set(6,9,10);scene.add(light);
  const world=createZUpWorld(scene),grid=new THREE.GridHelper(12,24,0xc3c7cb,0xe3e5e7);grid.rotation.x=PI/2;world.add(grid);
  const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(spec.target[0],spec.target[2],-spec.target[1]);controls.enableDamping=true;controls.update();
  let raf=0,dirty=true;
  const frame=()=>{raf=0;if(!dirty)return;dirty=false;sceneControls.syncLabels();controls.update();renderer.render(scene,camera);};
  const render=()=>{dirty=true;if(!raf)raf=requestAnimationFrame(frame);};
  const sceneControls=createSceneControlPanel(host,world,{render});
  controls.addEventListener('change',render);
  const ro=new ResizeObserver(()=>{resizeRendererToContainer(renderer,camera,host);render();});ro.observe(host);resizeRendererToContainer(renderer,camera,host);render();
  return{scene,camera,renderer,world,controls,render,sceneControls,dispose(){ro.disconnect();controls.dispose();renderer.dispose();cancelAnimationFrame(raf);}};
}

async function loadUrdfRobot(world,spec){const urdfUrl=versionedAssetUrl(spec.urdf),response=await fetch(urdfUrl);if(!response.ok)throw new Error(`Could not load ${urdfUrl.pathname.split('/').at(-1)}.`);const xml=new DOMParser().parseFromString(await response.text(),'application/xml'),links=new Map(),joints=[];for(const el of xml.querySelectorAll('link'))links.set(el.getAttribute('name'),{name:el.getAttribute('name'),visual:parseVisual(el)});for(const el of xml.querySelectorAll('joint')){const direct=(tag)=>[...el.children].find(x=>x.tagName.toLowerCase()===tag),origin=parseOrigin(direct('origin')),axis=parseVec(direct('axis')?.getAttribute('xyz')||'0 0 1');joints.push({name:el.getAttribute('name'),type:el.getAttribute('type'),parent:direct('parent')?.getAttribute('link'),child:direct('child')?.getAttribute('link'),origin,axis:new THREE.Vector3(...axis).normalize()});}const childNames=new Set(joints.map(j=>j.child)),rootName=[...links.keys()].find(x=>!childNames.has(x)),root=new THREE.Group(),movable=[],nodeByLink=new Map();world.add(root);let meshCount=0;
  async function build(linkName,parent){const link=links.get(linkName),node=new THREE.Group();node.userData.linkName=linkName;parent.add(node);nodeByLink.set(linkName,node);if(link?.visual){const holder=new THREE.Group();holder.applyMatrix4(link.visual.origin);const file=link.visual.file.split('/').at(-1),meshUrl=versionedAssetUrl(file,new URL(spec.mesh,import.meta.url)),r=await fetch(meshUrl);if(!r.ok)throw new Error(`Could not load course STL ${file}.`);const geom=parseStlGeometry(await r.arrayBuffer()),mat=new THREE.MeshStandardMaterial({color:meshColor(meshCount),roughness:.62,metalness:.06,side:THREE.DoubleSide});const mesh=new THREE.Mesh(geom,mat);mesh.userData.isCourseStl=true;mesh.scale.fromArray(link.visual.scale);holder.add(mesh);node.add(holder);meshCount+=1;}for(const joint of joints.filter(j=>j.parent===linkName)){const originNode=new THREE.Group();originNode.applyMatrix4(joint.origin);node.add(originNode);const rotor=new THREE.Group();originNode.add(rotor);joint.rotor=rotor;if(joint.type!=='fixed')movable.push(joint);await build(joint.child,rotor);}}
  await build(rootName,root);const update=(q,target=root)=>{target.traverse(o=>{if(o.userData.jointIndex!=null){const joint=movable[o.userData.jointIndex],angle=q[o.userData.jointIndex]||0;o.quaternion.setFromAxisAngle(joint.axis,angle);}});};movable.forEach((joint,i)=>{joint.rotor.userData.jointIndex=i;joint.movableIndex=i;});
  const findPath=(linkName,target,path=[])=>{if(linkName===target)return path;for(const joint of joints.filter(j=>j.parent===linkName)){const found=findPath(joint.child,target,[...path,joint]);if(found)return found;}return null;},serial=findPath(rootName,spec.end)||[];
  const pose=(q,linkName=spec.end)=>{const T=new THREE.Matrix4();for(const joint of linkName===spec.end?serial:(findPath(rootName,linkName)||[])){T.multiply(joint.origin);if(joint.type!=='fixed')T.multiply(new THREE.Matrix4().makeRotationAxis(joint.axis,q[joint.movableIndex]||0));}return T;};
  const geometricJacobian=(q)=>{const T=new THREE.Matrix4(),origins=[],axes=[],indices=[];for(const joint of serial){T.multiply(joint.origin);if(joint.type!=='fixed'){origins.push(new THREE.Vector3().setFromMatrixPosition(T));axes.push(joint.axis.clone().transformDirection(T));indices.push(joint.movableIndex);T.multiply(new THREE.Matrix4().makeRotationAxis(joint.axis,q[joint.movableIndex]||0));}}const p=new THREE.Vector3().setFromMatrixPosition(T),columns=origins.map((o,i)=>{const v=axes[i].clone().cross(p.clone().sub(o));return[v.x,v.y,v.z,axes[i].x,axes[i].y,axes[i].z];});return{columns,indices,p,T};};
  const wrist=(q)=>{const T=new THREE.Matrix4();let count=0;for(const joint of serial){T.multiply(joint.origin);if(joint.type!=='fixed'){if(count===4)return new THREE.Vector3().setFromMatrixPosition(T);T.multiply(new THREE.Matrix4().makeRotationAxis(joint.axis,q[joint.movableIndex]||0));count+=1;}}return new THREE.Vector3().setFromMatrixPosition(T);};
  const applyTo=(clone,q)=>{clone.traverse(o=>{if(o.userData.jointIndex!=null){const i=o.userData.jointIndex;o.quaternion.setFromAxisAngle(movable[i].axis,q[i]||0);}});};const point=(q,linkName=spec.end)=>new THREE.Vector3().setFromMatrixPosition(pose(q,linkName));return{root,movable,meshCount,update,applyTo,point,pose,geometricJacobian,wrist,nodeByLink};}

function parseVisual(link){const visual=[...link.children].find(x=>x.tagName.toLowerCase()==='visual');if(!visual)return null;const mesh=visual.querySelector('geometry > mesh');if(!mesh)return null;return{file:mesh.getAttribute('filename'),scale:parseVec(mesh.getAttribute('scale')||'1 1 1'),origin:parseOrigin([...visual.children].find(x=>x.tagName.toLowerCase()==='origin'))};}
function versionedAssetUrl(path,base=import.meta.url){const url=new URL(path,base);url.searchParams.set('v',MODULE_REVISION);return url;}
function parseOrigin(el){const xyz=parseVec(el?.getAttribute('xyz')||'0 0 0'),rpy=parseVec(el?.getAttribute('rpy')||'0 0 0'),r=new THREE.Matrix4().makeRotationZ(rpy[2]).multiply(new THREE.Matrix4().makeRotationY(rpy[1])).multiply(new THREE.Matrix4().makeRotationX(rpy[0]));return new THREE.Matrix4().makeTranslation(...xyz).multiply(r);}
function parseVec(s){return s.trim().split(/\s+/).map(Number);}
function meshColor(i){return[0x333638,0x0d7d80,0xb8b8b8,0x0d7d80,0x90959a,0x0d7d80,0x666b70][i%7];}

function resizeCanvases(canvases,onResize){const contexts=canvases.map(c=>c.getContext('2d')),sizes=canvases.map(()=>[0,0]);const ro=new ResizeObserver(()=>{canvases.forEach((c,i)=>{const dpr=Math.min(devicePixelRatio||1,2),w=Math.max(1,c.clientWidth),h=Math.max(1,c.clientHeight);if(c.width!==Math.round(w*dpr)||c.height!==Math.round(h*dpr)){c.width=Math.round(w*dpr);c.height=Math.round(h*dpr);contexts[i].setTransform(dpr,0,0,dpr,0,0);sizes[i]=[w,h];}});onResize();});canvases.forEach(c=>ro.observe(c));return{contexts,sizes,ready:()=>sizes.every(s=>s[0]>1&&s[1]>1),ro};}
function plotMap(size,xr,yr,labels={}){const pad={l:42,r:12,t:27,b:32},w=Math.max(1,size[0]-pad.l-pad.r),h=Math.max(1,size[1]-pad.t-pad.b),toPx=(x,y)=>[pad.l+(x-xr[0])/(xr[1]-xr[0])*w,pad.t+(yr[1]-y)/(yr[1]-yr[0])*h],fromPx=(x,y)=>[xr[0]+(x-pad.l)/w*(xr[1]-xr[0]),yr[1]-(y-pad.t)/h*(yr[1]-yr[0])];return{size,xr,yr,pad,w,h,toPx,fromPx,labels};}
function axes(ctx,m){ctx.save();ctx.strokeStyle='#aaa';ctx.lineWidth=1;ctx.strokeRect(m.pad.l,m.pad.t,m.w,m.h);ctx.fillStyle='#333';ctx.font='12px Arial';ctx.textAlign='center';ctx.fillText(m.labels.x||'',m.pad.l+m.w/2,m.size[1]-7);ctx.save();ctx.translate(12,m.pad.t+m.h/2);ctx.rotate(-PI/2);ctx.fillText(m.labels.y||'',0,0);ctx.restore();ctx.font='10px Arial';ctx.textAlign='left';ctx.fillText(formatTick(m.xr[0]),m.pad.l,m.size[1]-18);ctx.textAlign='right';ctx.fillText(formatTick(m.xr[1]),m.pad.l+m.w,m.size[1]-18);ctx.textAlign='right';ctx.fillText(formatTick(m.yr[1]),m.pad.l-5,m.pad.t+4);ctx.fillText(formatTick(m.yr[0]),m.pad.l-5,m.pad.t+m.h);ctx.restore();}
function fillPlot(ctx,m,xr,yr,color){const a=m.toPx(xr[0],yr[1]),b=m.toPx(xr[1],yr[0]);ctx.fillStyle=color;ctx.fillRect(a[0],a[1],b[0]-a[0],b[1]-a[1]);}
function scatter(ctx,pts,m,color,r=1.5){ctx.fillStyle=color;for(const p of pts){const q=m.toPx(...p);ctx.fillRect(q[0]-r,q[1]-r,2*r,2*r);}}
function drawSegments(ctx,segments,m,color,width=2){ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();for(const segment of segments){const a=m.toPx(...segment[0]),b=m.toPx(...segment[1]);ctx.moveTo(...a);ctx.lineTo(...b);}ctx.stroke();}
function polyline(ctx,pts,m,color,width=2){polylinePx(ctx,pts.map(p=>m.toPx(...p)),color,width);}
function polylineTorus(ctx,pts,m,color,width=2){if(!pts.length)return;let segment=[pts[0]];for(let i=1;i<pts.length;i+=1){if(Math.abs(pts[i][0]-pts[i-1][0])>PI||Math.abs(pts[i][1]-pts[i-1][1])>PI){if(segment.length>1)polyline(ctx,segment,m,color,width);segment=[pts[i]];}else segment.push(pts[i]);}if(segment.length>1)polyline(ctx,segment,m,color,width);}
function polylinePx(ctx,pts,color,width=2){if(!pts.length)return;ctx.strokeStyle=color;ctx.lineWidth=width;ctx.lineJoin='round';ctx.lineCap='round';ctx.beginPath();ctx.moveTo(...pts[0]);for(let i=1;i<pts.length;i+=1)ctx.lineTo(...pts[i]);ctx.stroke();}
function circlePlot(ctx,m,r,color,width){const pts=Array.from({length:121},(_,i)=>[r*Math.cos(2*PI*i/120),r*Math.sin(2*PI*i/120)]);polyline(ctx,pts,m,color,width);}
function dot(ctx,p,color,r=6,stroke){ctx.beginPath();ctx.arc(p[0],p[1],r,0,2*PI);ctx.fillStyle=color;ctx.fill();if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=2;ctx.stroke();}}
function ring(ctx,p,color,r=7,width=2){ctx.beginPath();ctx.arc(p[0],p[1],r,0,2*PI);ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke();}
function clear(ctx,size){ctx.clearRect(0,0,size[0],size[1]);ctx.fillStyle='#fff';ctx.fillRect(0,0,size[0],size[1]);}
function bindDrag(canvas,onPoint,getMap){let active=false;const act=(e)=>{const r=canvas.getBoundingClientRect(),m=getMap(),p=m.fromPx(e.clientX-r.left,e.clientY-r.top);onPoint(clamp(p[0],m.xr[0],m.xr[1]),clamp(p[1],m.yr[0],m.yr[1]));};canvas.addEventListener('pointerdown',(e)=>{active=true;canvas.setPointerCapture(e.pointerId);act(e);});canvas.addEventListener('pointermove',(e)=>{if(active)act(e);});canvas.addEventListener('pointerup',()=>active=false);}
function addRange(host,label,min,max,step,value,onInput,suffix='°'){const row=document.createElement('label');row.className='cusp-range';row.innerHTML=`<span>${label}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${value}"><output>${Number(value).toFixed(step<1?2:0)}${suffix}</output>`;const input=row.querySelector('input'),out=row.querySelector('output');input.addEventListener('input',()=>{out.textContent=`${Number(input.value).toFixed(step<1?2:0)}${suffix}`;onInput(Number(input.value));});host.append(row);return input;}
function syncRanges(host,values){host.querySelectorAll('input[type=range]').forEach((input,i)=>{input.value=values[i];input.nextElementSibling.textContent=`${Number(values[i]).toFixed(i>1?2:0)}${i>1?' m':'°'}`;});}
function angleLerp(a,b,t){return wrap(a+wrap(b-a)*t);}
function wrap(x){while(x>PI)x-=2*PI;while(x<=-PI)x+=2*PI;return x;}
function torusDistance(a,b){return Math.hypot(wrap(a[0]-b[0]),wrap(a[1]-b[1]));}
function distance2(a,b){return Math.hypot(a[0]-b[0],a[1]-b[1]);}
function solveLinear(A,b){const M=A.map((row,i)=>[...row,b[i]]),n=b.length;for(let i=0;i<n;i+=1){let pivot=i;for(let r=i+1;r<n;r+=1)if(Math.abs(M[r][i])>Math.abs(M[pivot][i]))pivot=r;if(Math.abs(M[pivot][i])<1e-12)return Array(n).fill(NaN);[M[i],M[pivot]]=[M[pivot],M[i]];const d=M[i][i];for(let c=i;c<=n;c+=1)M[i][c]/=d;for(let r=0;r<n;r+=1)if(r!==i){const f=M[r][i];for(let c=i;c<=n;c+=1)M[r][c]-=f*M[i][c];}}return M.map(row=>row[n]);}
function clamp(x,a,b){return Math.max(a,Math.min(b,x));}
function close(a,b,t=1e-8){return Math.abs(a-b)<t;}
function formatTick(x){if(close(x,PI))return'π';if(close(x,-PI))return'−π';return Number(x).toFixed(1);}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

function runChecks(){try{for(const name of Object.keys(PRESETS)){const p=PRESETS[name];for(let i=0;i<10;i+=1){const q=[0,(Math.random()*2-1)*PI,(Math.random()*2-1)*PI],direct=det3(q,p),s2=Math.sin(q[1]),c2=Math.cos(q[1]),s3=Math.sin(q[2]),c3=Math.cos(q[2]),expected=.75*(3*c3+4)*(p.a1===0?c2*(c3-2*s3):c2*(c3-2*s3)-s3);if(Math.abs(direct-expected)>1e-8*Math.max(1,Math.abs(direct)))throw new Error(`${name} determinant check failed`);}}console.info('ENG-654 Lecture 06 checks passed: both idealized 3R atlas presets agree with direct D–H Jacobians.');}catch(error){console.error('ENG-654 Lecture 06 validation failed:',error);}}
