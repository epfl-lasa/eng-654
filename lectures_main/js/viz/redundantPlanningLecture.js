import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { parseStlGeometry } from './frameDHPlayground.js';
import { createZUpWorld, resizeRendererToContainer } from './threeUtils.js';
import { fk, inverseFixedQ3, poseDistance, IIWA_LIMITS } from './iiwa7Kinematics.js';
import { buildSelfMotionSweep } from './iiwa7SelfMotion.js';
import { DEFAULT_RECTANGLE, NULL_SPACE_COSTS, ANALYTICAL_COSTS, MIN_SINGULAR_VALUE, rectangleSamples, buildRedundancyMap, planNumerical, planAnalytical, configurationMetrics } from './iiwa7Planning.js';

const DEG = Math.PI / 180;
const GREEN = '#239445', GREY = '#c8cccf', RED = '#d90000', INK = '#17191c';
const shared = {
  spec: null, map: null, row: 0, branch: 0, cost: 'centering', gain: .8,
  busy: false, progress: 0, message: '', version: 0, plan: null,
  plans: new Map(), comparison: null, listeners: new Set(), promise: null
};
let assetsPromise;
const notify = () => shared.listeners.forEach(fn => fn());
const copySpec = spec => ({ ...spec, center: spec.center.slice(), R: spec.R.map(row => row.slice()) });
const closestRow = (angles, value) => angles.reduce((best, angle, i) => Math.abs(angle - value) < Math.abs(angles[best] - value) ? i : best, 0);
const startRoot = (branch = shared.branch, row = shared.row) => shared.map?.cells[0]?.[row]?.[branch];
const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
const rootLegal = root => !!root?.valid;
const rootName = (root, branch) => `IK ${branch + 1}${root?.label ? ` · ${root.label}` : ''}`;

export function initRedundantPlanningLecture() {
  const hosts = [...document.querySelectorAll('[data-redundancy-lab],[data-l8-lab]')];
  if (!hosts.length) return;
  const done = new WeakSet();
  const ensure = host => {
    if (done.has(host)) return;
    done.add(host);
    createLab(host, host.dataset.redundancyLab || host.dataset.l8Lab).catch(error => fail(host, error));
  };
  const observer = new IntersectionObserver(entries => entries.forEach(entry => {
    if (entry.isIntersecting) ensure(entry.target);
  }), { threshold: .02 });
  hosts.forEach(host => observer.observe(host));
  const sync = () => {
    const n = Number(location.hash.match(/#slide-(\d+)/)?.[1] || 1);
    document.querySelectorAll('#deck > .slide')[n - 1]?.querySelectorAll('[data-redundancy-lab],[data-l8-lab]').forEach(ensure);
  };
  sync();
  window.addEventListener('hashchange', sync);
}

async function ensureMap() {
  if (shared.map) return shared.map;
  if (!shared.promise) shared.promise = rebuildMap(copySpec(DEFAULT_RECTANGLE));
  return shared.promise;
}

async function rebuildMap(spec) {
  shared.busy = true;
  shared.progress = 0;
  shared.message = 'Evaluating all eight analytical branches at every map sample…';
  shared.version++;
  shared.spec = copySpec(spec);
  shared.plan = null;
  shared.map = null;
  shared.comparison = null;
  shared.plans.clear();
  notify();
  try {
    const map = await buildRedundancyMap(spec, {
      nProgress: 81, nAngles: 69,
      onProgress: value => {
        shared.progress = progressValue(value);
        notify();
      }
    });
    shared.map = map;
    shared.row = closestRow(map.angles, 30 * DEG);
    const preferred = map.cells[0][shared.row];
    let best = preferred.reduce((result, root, branch) => rootLegal(root) && (!result || root.limitMargin > result.root.limitMargin) ? { root, branch } : result, null);
    if (!best) {
      let choice = null;
      for (let row = 0; row < map.angles.length; row++) for (let branch = 0; branch < 8; branch++) {
        const root = map.cells[0][row][branch];
        if (rootLegal(root) && (!choice || Math.abs(map.angles[row] - 30 * DEG) < choice.distance)) choice = { row, branch, root, distance: Math.abs(map.angles[row] - 30 * DEG) };
      }
      if (choice) { shared.row = choice.row; best = choice; }
    }
    shared.branch = best?.branch ?? 0;
    if (map.defaultStart && rootLegal(map.cells[0][map.defaultStart.row]?.[map.defaultStart.branch])) {
      shared.row = map.defaultStart.row; shared.branch = map.defaultStart.branch;
      best = { root: startRoot(), branch: shared.branch };
    }
    shared.message = best ? 'Click a green dot on the left edge to choose a starting IK and follow the rectangle.' : 'This rectangle has no legal sampled starting configuration. Move or resize it and rebuild.';
    shared.progress = 1;
    return map;
  } finally { shared.busy = false; notify(); }
}

function progressValue(value) {
  if (typeof value === 'number') return Math.min(1, value > 1 ? value / 100 : value);
  return value?.progress ?? value?.fraction ?? 0;
}

const keyFor = (method, branch, cost) => `${shared.version}/${shared.row}/${branch}/${method}/${cost}/${shared.gain}`;
async function computePlan(method, branch, cost) {
  const root = startRoot(branch);
  if (!rootLegal(root)) return null;
  const key = keyFor(method, branch, cost);
  if (shared.plans.has(key)) return shared.plans.get(key);
  const onProgress = value => { shared.progress = progressValue(value); notify(); };
  const result = method === 'analytical'
    ? await planAnalytical(shared.map, { row: shared.row, branch, cost, onProgress })
    : await planNumerical(shared.spec, root.q, { cost, gain: shared.gain, nSteps: 400, onProgress });
  // Classify once, outside playback: algebraic branch labels can change along
  // a continuous redundant motion. Each map receives only its own segments.
  for (const sample of result.samples) {
    if (sample.mergedBranchIndices?.length) { sample.branchIndices = sample.mergedBranchIndices; continue; }
    const roots = inverseFixedQ3({ p: sample.p, R: shared.spec.R }, sample.q[2]);
    const matching = roots.find(root => Math.hypot(...root.q.map((value, i) => value - sample.q[i])) < 1e-5);
    sample.branchIndices = matching?.mergedBranchIndices || (matching ? [matching.branchIndex] : []);
  }
  result.method = method;
  result.cost = cost;
  result.startBranch = branch;
  result.startRow = shared.row;
  shared.plans.set(key, result);
  return result;
}

async function buildSelected(method, cost) {
  if (shared.busy || !rootLegal(startRoot())) return null;
  shared.busy = true;
  shared.progress = 0;
  shared.plan = null;
  shared.message = method === 'analytical' ? 'Searching the analytical map and checking the connecting motions…' : 'Integrating the Jacobian controller and correcting the tool pose…';
  notify();
  try {
    shared.plan = await computePlan(method, shared.branch, cost);
    shared.message = planMessage(shared.plan);
    shared.progress = 1;
    return shared.plan;
  } finally { shared.busy = false; notify(); }
}

async function compareStarts(method, cost) {
  if (shared.busy || !shared.map) return;
  shared.busy = true;
  shared.comparison = Array(8).fill(null);
  notify();
  try {
    for (let branch = 0; branch < 8; branch++) {
      shared.message = `Checking starting IK ${branch + 1} of 8 with the same ${method} strategy…`;
      shared.progress = branch / 8;
      notify();
      const root = startRoot(branch);
      shared.comparison[branch] = rootLegal(root) ? await computePlan(method, branch, cost) : { complete: false, reason: root ? 'Starting joint limit / singularity' : 'No real starting root', unavailable: true };
      notify();
      await nextFrame();
    }
    const complete = shared.comparison.filter(plan => plan?.complete).length;
    shared.message = `${complete} of the eight starting branches finish with this strategy at q₃ = ${(shared.map.angles[shared.row] / DEG).toFixed(0)}°. Select a branch to inspect its result.`;
    const selected = shared.comparison[shared.branch];
    if (selected && !selected.unavailable) shared.plan = selected;
    shared.progress = 1;
  } finally { shared.busy = false; notify(); }
}

function planMessage(plan) {
  if (!plan) return 'Choose a legal starting IK.';
  if (plan.complete) return 'Complete: this start and strategy follow all four edges within the checked limits and singularity margin.';
  return `Stopped at s = ${(plan.samples?.at(-1)?.s ?? 0).toFixed(3)}: ${plan.reason || 'continuation did not pass the checks'}. Try another start or strategy.`;
}

async function createLab(host, mode) {
  if (mode === 'configuration-pair') return createConfigurationPair(host);
  const isNull = mode === 'null-motion';
  const labState = isNull ? { message: 'Move q₃ along a continuous fixed-pose curve. Grey sections are mathematical configurations beyond the robot’s joint limits.' } : shared;
  host.classList.add('l8-redundancy-lab');
  host.dataset.labMode = mode;
  host.dataset.ready = 'false';
  host.innerHTML = `
    <div class="l8r-toolbar">
      <strong>${isNull ? 'Fixed tool pose · centre' : 'Shared rectangle · fixed tool orientation'}</strong>
      ${['x', 'y', 'z'].map((axis, i) => `<label>${axis} <input data-center="${i}" type="number" step="0.02" min="-1" max="1" aria-label="Rectangle center ${axis}"></label>`).join('')}
      ${isNull ? '' : `<label>width <input data-size="width" type="number" step="0.02" min="0.04" max="0.8" aria-label="Rectangle width"></label>
      <label>height <input data-size="height" type="number" step="0.02" min="0.04" max="0.8" aria-label="Rectangle height"></label>`}
      <span class="l8r-units">m</span><button data-rebuild>${isNull ? 'Rebuild curves' : 'Rebuild map'}</button><button data-default title="Restore the tested example">Default</button>
    </div>
    <div class="l8r-body">
      <div class="l8r-stage"><span class="l8r-badge">KUKA iiwa 7 · native joint limits</span><span class="l8r-scene-legend">${isNull ? 'tool frame held fixed' : 'black: given path · red: followed path'}</span></div>
      <div class="l8r-map-panel">
        <div class="l8r-map-heading"><strong>${isNull ? 'Continuous self-motion · fixed pose' : 'Path progress × redundant angle'}</strong><label><input data-all type="checkbox"> All 8 ${isNull ? 'IK curves' : 'maps'}</label></div>
        <canvas class="l8r-map" aria-label="${isNull ? 'Continuous dependent joint angles versus q3. Click to inspect an angle; grey means a joint-limit violation.' : 'Analytical redundancy map. Click the start column to select an inverse kinematic solution.'}"></canvas>
        <div class="l8r-legend"><span><i class="green"></i>${isNull ? 'within joint limits' : 'legal, regular'}</span><span><i class="grey"></i>${isNull ? 'outside joint limits' : 'limit / singular / no root'}</span><span><i class="red"></i>${isNull ? 'selected q₃' : 'plan on this IK chart'}</span></div>
      </div>
      <aside class="l8r-panel">
        <label class="l8r-angle">${isNull ? 'Redundant angle' : 'Starting redundant angle'} <output data-angle-output>30°</output><input data-angle type="range" min="-170" max="170" step="${isNull ? '.5' : '5'}" value="30" aria-label="${isNull ? 'Redundant angle q3' : 'Starting redundant angle q3'}"></label>
        <div class="l8r-branches" aria-label="Eight analytical IK branches"></div>
        ${isNull ? '<p class="l8r-equation">J q̇ = 0<br>7 joint velocities · 6 tool constraints</p>' : `
          <div class="l8r-method-row"><label>Planner<select data-method><option value="numerical">Numerical · null space</option><option value="analytical">Analytical · global map</option></select></label></div>
          <label class="l8r-cost-label"><span data-cost-label>Null-space objective</span><select data-cost></select></label>
          <label class="l8r-gain">Null-space gain γ <input data-gain type="range" min="0" max="1.5" step="0.05" value="0.8"><output data-gain-output>0.80</output></label>
          <div class="l8r-actions"><button class="primary" data-plan>Build path</button><button data-compare>Compare 8 starts</button></div>
          <div class="l8r-playback"><button data-play disabled>Play</button><button data-reset disabled>Reset</button><input data-scrub type="range" min="0" max="1" step="0.0025" value="0" aria-label="Path playback progress" disabled></div>
        `}
        <output class="l8r-readout">Building the analytical map…</output>
        <progress data-work-progress value="0" max="1" aria-label="Planning progress"></progress>
      </aside>
    </div>
    <p class="l8r-footer" role="status">Loading the robot and analytical model…</p>`;
  const $ = selector => host.querySelector(selector);
  const stage = $('.l8r-stage'), canvas = $('.l8r-map'), branchBox = $('.l8r-branches');
  const methodInput = $('[data-method]'), costInput = $('[data-cost]'), angleInput = $('[data-angle]');
  let method = mode === 'analytical' ? 'analytical' : 'numerical';
  let numericalCost = shared.cost, analyticalCost = 'travel';
  let allMaps = false, frame = 0, playing = false, startedAt = 0, previousPlan = null;
  let ownVersion = -1, regions = [], resizeState = null;
  let nullSpec = copySpec(DEFAULT_RECTANGLE), selfMotion = null, nullRow = 0, nullBranch = 4;
  const selectedBranch = () => isNull ? nullBranch : shared.branch;
  const selectedRow = () => isNull ? nullRow : shared.row;
  const selectedAngles = () => isNull ? selfMotion?.angles : shared.map?.angles;
  const selectedRoot = (branch = selectedBranch(), row = selectedRow()) => isNull ? selfMotion?.branches[branch]?.[row] : shared.map?.cells[0]?.[row]?.[branch];
  function rebuildSelfMotion() {
    selfMotion = buildSelfMotionSweep({ p: nullSpec.center.slice(), R: nullSpec.R.map(row => row.slice()) });
    nullRow = closestRow(selfMotion.angles, -30 * DEG);
    host.dataset.selfMotionSamples = String(selfMotion.sampleCount);
    host.dataset.selfMotionFullSweep = String(selfMotion.fullSweep);
    host.dataset.fixedPose = JSON.stringify(selfMotion.pose);
    host.querySelectorAll('[data-center]').forEach(input => { input.value = nullSpec.center[+input.dataset.center].toFixed(2); });
  }
  const viewerPromise = createViewer(stage);
  const currentCost = () => method === 'analytical' ? analyticalCost : numericalCost;
  const activePlan = () => isNull ? null : shared.plan;
  const stop = () => { playing = false; if ($('[data-play]')) $('[data-play]').textContent = frame >= (activePlan()?.samples?.length || 0) - 1 ? 'Replay' : 'Play'; host.dataset.playing = 'false'; };
  const useStart = (row, branch, autoplay = false) => {
    if (shared.busy || !shared.map) return;
    const root = selectedRoot(branch, row);
    if (!root || (!isNull && !rootLegal(root))) { labState.message = root ? `IK ${branch + 1} is grey here: ${root.reason || 'a joint limit or singularity check fails'}. Choose a green starting dot.` : 'No real IK exists on this branch at that redundant angle.'; notify(); return; }
    stop();
    if (isNull) { nullRow = row; nullBranch = branch; }
    else { shared.row = row; shared.branch = branch; shared.plan = null; shared.comparison = null; }
    labState.message = `Selected ${rootName(root, branch)} at q₃ = ${Number((selectedAngles()[row] / DEG).toFixed(1))}°.${isNull && !root.valid ? ' Inspection only: this continuous configuration exceeds a physical joint limit (grey).' : ''}`;
    notify();
    if (autoplay && !isNull) buildSelected(method, currentCost()).then(plan => { if (plan?.samples?.length > 1) play(); }).catch(error => showError(error));
  };
  function configureCost() {
    if (!costInput) return;
    const options = method === 'analytical'
      ? ANALYTICAL_COSTS
      : NULL_SPACE_COSTS;
    costInput.innerHTML = options.map(option => `<option value="${option.id}">${option.label}</option>`).join('');
    costInput.value = currentCost();
    $('[data-cost-label]').textContent = method === 'analytical' ? 'Global edge cost' : 'Null-space objective';
    $('.l8r-gain').hidden = method === 'analytical';
    methodInput.value = method;
  }
  if (!isNull) {
    configureCost();
    methodInput.addEventListener('change', () => { stop(); method = methodInput.value; configureCost(); shared.plan = null; shared.comparison = null; labState.message = 'Build from the same selected start with this planner.'; notify(); });
    costInput.addEventListener('change', () => { stop(); if (method === 'analytical') analyticalCost = costInput.value; else numericalCost = shared.cost = costInput.value; shared.plan = null; shared.comparison = null; labState.message = 'Objective changed. Rebuild or compare the eight starts.'; notify(); });
    $('[data-gain]').addEventListener('input', event => { stop(); shared.gain = +event.target.value; shared.plan = null; shared.comparison = null; notify(); });
    $('[data-plan]').addEventListener('click', () => buildSelected(method, currentCost()).catch(showError));
    $('[data-compare]').addEventListener('click', () => compareStarts(method, currentCost()).catch(showError));
    $('[data-play]').addEventListener('click', () => playing ? stop() : play());
    $('[data-reset]').addEventListener('click', () => { stop(); frame = 0; renderFrame(); });
    $('[data-scrub]').addEventListener('input', event => { stop(); frame = Math.round(+event.target.value * ((activePlan()?.samples?.length || 1) - 1)); renderFrame(); });
  }
  angleInput.addEventListener('input', event => {
    if (!shared.map) return;
    useStart(closestRow(selectedAngles(), +event.target.value * DEG), selectedBranch());
  });
  $('[data-all]').addEventListener('change', event => { allMaps = event.target.checked; draw(); });
  $('[data-rebuild]').addEventListener('click', () => {
    if (shared.busy) return;
    const spec = copySpec(isNull ? nullSpec : shared.spec || DEFAULT_RECTANGLE);
    host.querySelectorAll('[data-center]').forEach(input => { spec.center[+input.dataset.center] = +input.value; });
    host.querySelectorAll('[data-size]').forEach(input => { spec[input.dataset.size] = +input.value; });
    if (!spec.center.every(Number.isFinite) || ![spec.width, spec.height].every(value => Number.isFinite(value) && value >= .04 && value <= .8)) { labState.message = 'Enter finite coordinates and side lengths between 0.04 m and 0.80 m.'; notify(); return; }
    stop();
    if (isNull) { nullSpec = spec; rebuildSelfMotion(); labState.message = selfMotion.fullSweep ? 'All eight mathematical IK curves span −170° to 170°. Grey sections exceed a joint limit.' : 'This fixed pose has gaps or chart boundaries; only verified connected solutions are drawn.'; refresh(); }
    else rebuildMap(spec).catch(showError);
  });
  $('[data-default]').addEventListener('click', () => { if (!shared.busy) { stop(); if (isNull) { nullSpec = copySpec(DEFAULT_RECTANGLE); nullBranch = 4; rebuildSelfMotion(); labState.message = 'Default fixed pose restored. All eight curves are continuous; grey sections exceed a joint limit.'; refresh(); } else rebuildMap(copySpec(DEFAULT_RECTANGLE)).catch(showError); } });
  canvas.addEventListener('click', event => {
    if (!shared.map || shared.busy) return;
    const rect = canvas.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top;
    const region = regions.find(box => x >= box.left - 12 && x <= box.right + 6 && y >= box.top - 6 && y <= box.bottom + 6);
    if (!region) return;
    if (isNull) {
      const angles = selectedAngles(), q3 = angles[0] + (x - region.left) / (region.right - region.left) * (angles.at(-1) - angles[0]);
      useStart(closestRow(angles, q3), region.branch); return;
    }
    if (x > region.left + Math.max(16, (region.right - region.left) * .09)) {
      labState.message = 'Choose a starting configuration on the left edge, s = 0. The rest of the map shows what may be possible later along the path.';
      notify(); return;
    }
    const q3 = (region.bottom - y) / (region.bottom - region.top) * 340 * DEG - 170 * DEG;
    const row = closestRow(shared.map.angles, q3);
    useStart(row, region.branch, !isNull);
  });
  function showError(error) { shared.busy = false; labState.message = error.message || String(error); notify(); console.error(error); }
  let viewer;
  function refresh() {
    const map = shared.map;
    host.dataset.busy = String(shared.busy);
    host.dataset.selectedBranch = String(selectedBranch());
    host.dataset.selectedRow = String(selectedRow());
    host.dataset.method = method;
    numericalCost = shared.cost;
    if (costInput && method === 'numerical') costInput.value = numericalCost;
    host.dataset.cost = currentCost();
    host.dataset.mapReady = String(!!map);
    host.dataset.progress = String(shared.progress);
    $('[data-work-progress]').value = shared.progress;
    $('.l8r-footer').textContent = isNull && labState.message.startsWith('Click a green dot')
      ? 'Move the q₃ slider to reconfigure the arm at the same tool pose, or select another IK branch to compare.'
      : labState.message;
    host.querySelectorAll('button,input,select').forEach(element => { if (!element.closest('.l8r-opacity')) element.disabled = shared.busy || !map; });
    if (!isNull && ownVersion !== shared.version) {
      ownVersion = shared.version;
      if (shared.spec) {
        host.querySelectorAll('[data-center]').forEach(input => { input.value = shared.spec.center[+input.dataset.center].toFixed(2); });
        host.querySelectorAll('[data-size]').forEach(input => { input.value = shared.spec[input.dataset.size].toFixed(2); });
        viewer?.setDesired(isNull ? [] : rectangleSamples(shared.spec, 81).map(sample => sample.p));
      }
      stop();
    }
    if (!map) { $('.l8r-readout').textContent = 'All eight analytical branches\nNative iiwa 7 geometry and joint limits\nMap calculation in progress…'; draw(); return; }
    if (shared.busy) { stop(); return; }
    if (isNull && !selfMotion) rebuildSelfMotion();
    host.dataset.selectedBranch = String(selectedBranch());
    host.dataset.selectedRow = String(selectedRow());
    angleInput.min = (selectedAngles()[0] / DEG).toFixed(2);
    angleInput.max = (selectedAngles().at(-1) / DEG).toFixed(2);
    angleInput.value = (selectedAngles()[selectedRow()] / DEG).toFixed(2);
    $('[data-angle-output]').textContent = `${Number((selectedAngles()[selectedRow()] / DEG).toFixed(1))}°`;
    if (!isNull) { $('[data-gain]').value = shared.gain; $('[data-gain-output]').textContent = shared.gain.toFixed(2); }
    branchBox.innerHTML = Array.from({ length: 8 }, (_, branch) => {
      const root = selectedRoot(branch), result = isNull ? null : shared.comparison?.[branch];
      const status = result ? result.complete ? 'finishes' : result.unavailable ? 'unavailable' : 'stops' : rootLegal(root) ? isNull ? 'within limits' : 'legal start' : root ? isNull ? 'joint limit' : 'limit / rank' : 'no root';
      return `<button data-branch="${branch}" class="${branch === selectedBranch() ? 'selected ' : ''}${rootLegal(root) ? 'legal' : 'invalid'}" ${shared.busy ? 'disabled' : ''} title="${rootName(root, branch)}"><b>IK ${branch + 1}</b><span>${status}</span></button>`;
    }).join('');
    branchBox.querySelectorAll('button').forEach(button => button.addEventListener('click', () => {
      const branch = +button.dataset.branch, comparison = shared.comparison;
      stop();
      if (isNull) nullBranch = branch;
      else { shared.branch = branch; shared.plan = comparison?.[branch] && !comparison[branch].unavailable ? comparison[branch] : null; }
      labState.message = !rootLegal(selectedRoot()) ? `Inspecting IK ${branch + 1}: ${selectedRoot()?.reason || 'no real root at this angle'}.${isNull ? ' Grey curves remain visible for inspection.' : ' Choose a green starting dot on this map before planning.'}` : isNull ? `Selected ${rootName(selectedRoot(), branch)}. Move q₃ along its continuous fixed-pose curve.` : shared.plan ? planMessage(shared.plan) : `Selected ${rootName(selectedRoot(), branch)}. Build the path or click its green starting dot.`;
      notify();
    }));
    if (shared.plan !== previousPlan) { previousPlan = shared.plan; frame = 0; stop(); }
    if (!isNull) {
      const hasPlan = !!shared.plan?.samples?.length;
      $('[data-plan]').disabled = shared.busy || !rootLegal(selectedRoot());
      $('[data-play]').disabled = shared.busy || !hasPlan;
      $('[data-reset]').disabled = shared.busy || !hasPlan;
      $('[data-scrub]').disabled = shared.busy || !hasPlan;
    }
    renderFrame();
  }
  function renderFrame() {
    const root = selectedRoot(), plan = activePlan();
    const sample = plan?.samples?.[Math.min(frame, plan.samples.length - 1)];
    const q = sample?.q || root?.q;
    const visible = host.closest('.slide')?.classList.contains('active') !== false;
    if (q && viewer && visible) {
      viewer.update(q);
      if (isNull) { viewer.setGhost(null); viewer.setAchieved([]); }
      else {
        viewer.setGhost(root?.q || null);
        viewer.setAchieved(plan?.samples?.slice(0, frame + 1).map(item => item.p || fk(item.q).p) || []);
      }
      host.dataset.configuration = JSON.stringify(q);
      stage.querySelector('.l8r-badge').textContent = rootLegal(root) || sample ? 'KUKA iiwa 7 · native joint limits' : isNull ? 'Inspection only · joint limit violation' : 'Inspection only · joint limit / rank violation';
    } else if (!q && viewer && visible) {
      viewer.update(null); viewer.setGhost(null); viewer.setAchieved([]);
      delete host.dataset.configuration;
      stage.querySelector('.l8r-badge').textContent = 'No real IK on this chart at the chosen angle';
    }
    const s = sample?.s ?? 0;
    host.dataset.pathProgress = String(s);
    host.dataset.frame = String(frame);
    host.dataset.playing = String(playing);
    host.dataset.complete = String(!!plan?.complete);
    host.dataset.outcome = plan?.reason || (plan?.complete ? 'complete' : 'unplanned');
    if (!isNull) {
      $('[data-scrub]').value = plan?.samples?.length > 1 ? frame / (plan.samples.length - 1) : 0;
      $('[data-play]').textContent = playing ? 'Pause' : plan && frame >= plan.samples.length - 1 ? 'Replay' : 'Play';
    }
    if (q) {
      const metrics = sample || configurationMetrics(q), pose = fk(q);
      const target = isNull ? selfMotion?.pose : sample;
      const error = sample?.error ?? Math.hypot(...pose.p.map((value, i) => value - (target?.p?.[i] ?? value)));
      const margin = metrics.limitMargin ?? root?.limitMargin ?? 0;
      $('.l8r-readout').textContent = isNull
        ? `IK ${selectedBranch() + 1} · q₃ = ${(q[2] / DEG).toFixed(1)}°\ntool position error ${Number(root?.positionError ?? error).toExponential(1)} m\ntool rotation error ${Number(root?.orientationError ?? 0).toExponential(1)} rad\nminimum joint margin ${(margin / DEG).toFixed(1)}°\n${metrics.sigmaMin > MIN_SINGULAR_VALUE ? 'Full J: regular · nullity 1' : 'Full J: near singular'}\nq = ${q.map(value => (value / DEG).toFixed(0)).join(', ')}°`
        : `IK ${shared.branch + 1} · ${plan?.method || method}${plan?.cost ? ' / ' + plan.cost : ''}\ns = ${s.toFixed(3)} · q₃ = ${(q[2] / DEG).toFixed(1)}°\n${plan ? plan.complete ? 'COMPLETE PATH' : 'PARTIAL PATH' : rootLegal(root) ? 'Start selected · build to follow' : 'INSPECTION · invalid starting pose'}\nminimum limit margin ${((plan?.minLimitMargin ?? margin) / DEG).toFixed(1)}°\nmax pose error ${Number(plan?.maxPoseError ?? error).toExponential(1)}\nmin σ(Ĵ) ${Number(plan?.minSigma ?? metrics.sigmaMin ?? root?.sigmaMin ?? 0).toFixed(4)}`;
    } else $('.l8r-readout').textContent = isNull ? 'No real IK at this angle.\nChoose another q₃ or change\nthe fixed tool position and rebuild.' : 'No legal starting IK selected.\nChoose a green dot at s = 0\nor move and resize the rectangle.';
    draw();
  }
  function draw() {
    if (!resizeState?.ready || host.closest('.slide')?.classList.contains('active') === false) return;
    const { ctx, w, h } = resizeState;
    ctx.clearRect(0, 0, w, h); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    regions = [];
    if (!shared.map) { ctx.fillStyle = '#666'; ctx.font = '12px Arial'; ctx.fillText('Evaluating analytical inverse kinematics…', 14, 28); return; }
    if (isNull) {
      if (!selfMotion) return;
      if (!allMaps) regions.push(drawSelfMotion(ctx, { x: 0, y: 0, w, h }, selfMotion, nullBranch, nullRow));
      else {
        const gap = 7, tileW = (w - gap) / 2, tileH = (h - 3 * gap) / 4;
        for (let branch = 0; branch < 8; branch++) regions.push(drawSelfMotion(ctx, { x: branch % 2 * (tileW + gap), y: Math.floor(branch / 2) * (tileH + gap), w: tileW, h: tileH }, selfMotion, branch, nullRow, true));
      }
      return;
    }
    if (allMaps) {
      const gap = 7, tileW = (w - gap) / 2, tileH = (h - 3 * gap) / 4;
      for (let branch = 0; branch < 8; branch++) {
        const x = branch % 2 * (tileW + gap), y = Math.floor(branch / 2) * (tileH + gap);
        regions.push(drawMap(ctx, { x, y, w: tileW, h: tileH }, shared.map, branch, shared.row, activePlan(), frame, true));
      }
    } else regions.push(drawMap(ctx, { x: 0, y: 0, w, h }, shared.map, shared.branch, shared.row, activePlan(), frame, false));
  }
  function play() {
    const plan = activePlan(); if (!plan?.samples?.length || shared.busy) return;
    if (frame >= plan.samples.length - 1) frame = 0;
    playing = true;
    const duration = 12000 * Math.max(.4, plan.samples.at(-1)?.s ?? 1);
    startedAt = performance.now() - frame / Math.max(1, plan.samples.length - 1) * duration;
    renderFrame();
  }
  function animate(time) {
    const slide = host.closest('.slide');
    if (playing && slide && !slide.classList.contains('is-active') && !slide.classList.contains('active')) stop();
    if (playing) {
      const plan = activePlan(), duration = 12000 * Math.max(.4, plan.samples.at(-1)?.s ?? 1);
      frame = Math.max(0, Math.min(plan.samples.length - 1, Math.floor((time - startedAt) / duration * (plan.samples.length - 1))));
      renderFrame();
      if (frame >= plan.samples.length - 1) stop();
    }
    requestAnimationFrame(animate);
  }
  resizeState = canvasKit(canvas, draw);
  shared.listeners.add(refresh);
  window.addEventListener('hashchange', () => { if (host.closest('.slide')?.classList.contains('active')) refresh(); else stop(); });
  viewer = await viewerPromise;
  await ensureMap();
  if (shared.spec) viewer.setDesired(isNull ? [] : rectangleSamples(shared.spec, 81).map(sample => sample.p));
  host.dataset.ready = 'true';
  refresh();
  requestAnimationFrame(animate);
}

function drawMap(ctx, box, map, branch, selectedRow, plan, frame, compact) {
  const left = box.x + (compact ? 29 : 48), right = box.x + box.w - (compact ? 9 : 14);
  const top = box.y + (compact ? 16 : 30), bottom = box.y + box.h - (compact ? 15 : 36);
  const X = s => left + s * (right - left), Y = angle => bottom - (angle / DEG + 170) / 340 * (bottom - top);
  ctx.fillStyle = '#fbfbfb'; ctx.fillRect(left, top, right - left, bottom - top);
  ctx.strokeStyle = '#e8e8e8'; ctx.lineWidth = .7;
  for (const s of [0, .25, .5, .75, 1]) { ctx.beginPath(); ctx.moveTo(X(s), top); ctx.lineTo(X(s), bottom); ctx.stroke(); }
  for (const angle of [-170, -90, 0, 90, 170]) { ctx.beginPath(); ctx.moveTo(left, Y(angle * DEG)); ctx.lineTo(right, Y(angle * DEG)); ctx.stroke(); }
  const radius = compact ? .68 : Math.min(2.25, Math.max(.9, (right - left) / Math.max(1, map.samples.length - 1) * .35));
  // Each dot is an independently evaluated analytical IK, never an interpolated cell estimate.
  for (const legal of [false, true]) {
    ctx.fillStyle = legal ? GREEN : GREY; ctx.beginPath();
    for (let k = 0; k < map.samples.length; k++) for (let row = 0; row < map.angles.length; row++) {
      if (rootLegal(map.cells[k][row][branch]) !== legal) continue;
      const x = X(map.samples[k].s), y = Y(map.angles[row]);
      ctx.moveTo(x + radius, y); ctx.arc(x, y, radius, 0, Math.PI * 2);
    }
    ctx.fill();
  }
  ctx.strokeStyle = '#555'; ctx.lineWidth = .8; ctx.strokeRect(left, top, right - left, bottom - top);
  ctx.font = `${compact ? 9 : 11}px Arial`; ctx.fillStyle = INK;
  ctx.textAlign = 'left'; ctx.font = `bold ${compact ? 10 : 12}px Arial`;
  ctx.fillText(`IK ${branch + 1}${!compact ? ' · click a green start at s = 0' : ''}`, left, top - (compact ? 5 : 12));
  ctx.font = `${compact ? 8 : 10}px Arial`; ctx.textAlign = 'right';
  for (const angle of compact ? [-170, 170] : [-170, -90, 0, 90, 170]) ctx.fillText(`${angle}°`, left - 5, Y(angle * DEG) + 3);
  ctx.textAlign = 'center'; for (const s of compact ? [0, 1] : [0, .25, .5, .75, 1]) ctx.fillText(String(s), X(s), bottom + (compact ? 11 : 14));
  if (!compact) {
    ctx.font = '11px Arial'; ctx.fillText('workspace path progress s', (left + right) / 2, box.y + box.h - 5);
    ctx.save(); ctx.translate(box.x + 12, (top + bottom) / 2); ctx.rotate(-Math.PI / 2); ctx.fillText('redundant joint angle q₃', 0, 0); ctx.restore();
  }
  if (branch === shared.branch) {
    ctx.strokeStyle = RED; ctx.lineWidth = compact ? 1.8 : 2.3;
    ctx.beginPath(); ctx.arc(left, Y(map.angles[selectedRow]), compact ? 3 : 5, 0, Math.PI * 2); ctx.stroke();
  }
  if (plan?.samples?.length) {
    ctx.strokeStyle = '#fff'; ctx.lineWidth = compact ? 3 : 4; pathLine(ctx, plan.samples, X, q => Y(q), plan.samples.length - 1, branch); ctx.stroke();
    ctx.strokeStyle = RED; ctx.lineWidth = compact ? 1.25 : 1.8; pathLine(ctx, plan.samples, X, q => Y(q), plan.samples.length - 1, branch); ctx.stroke();
    const current = plan.samples[Math.min(frame, plan.samples.length - 1)];
    if (current.branchIndices?.includes(branch)) { ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(X(current.s), Y(current.q[2]), compact ? 2.5 : 4, 0, Math.PI * 2); ctx.fill(); }
  }
  return { left, right, top, bottom, branch };
}
function pathLine(ctx, samples, X, Y, end, branch) {
  ctx.beginPath(); let started = false;
  for (const sample of samples.slice(0, end + 1)) {
    if (!sample.branchIndices?.includes(branch)) { started = false; continue; }
    const x = X(sample.s), y = Y(sample.q[2]);
    started ? ctx.lineTo(x, y) : ctx.moveTo(x, y); started = true;
  }
}

function drawSelfMotion(ctx, box, sweep, branch, selectedRow, compact = false) {
  const samples = sweep.branches[branch], joints = [0, 1, 3, 4, 5, 6];
  const values = samples.flatMap(sample => sample ? joints.map(j => sample.q[j] / DEG) : []);
  const yMin = Math.min(-180, Math.floor((Math.min(...values) - 8) / 90) * 90);
  const yMax = Math.max(180, Math.ceil((Math.max(...values) + 8) / 90) * 90);
  const left = box.x + (compact ? 31 : 47), right = box.x + box.w - (compact ? 9 : 16);
  const top = box.y + (compact ? 16 : 29), bottom = box.y + box.h - (compact ? 16 : 35);
  const X = value => left + (value - sweep.angles[0]) / (sweep.angles.at(-1) - sweep.angles[0]) * (right - left);
  const Y = value => bottom - (value / DEG - yMin) / (yMax - yMin) * (bottom - top);
  ctx.fillStyle = INK; ctx.textAlign = 'left'; ctx.font = `bold ${compact ? 9 : 11}px Arial`;
  ctx.fillText(`IK ${branch + 1}${compact ? '' : ' · continuous joint angles, fixed tool pose'}`, left, top - (compact ? 5 : 13));
  ctx.strokeStyle = '#e2e2e2'; ctx.lineWidth = .7; ctx.font = `${compact ? 8 : 10}px Arial`;
  for (const value of compact ? [-170, 0, 170] : [-170, -90, 0, 90, 170]) {
    ctx.beginPath(); ctx.moveTo(X(value * DEG), top); ctx.lineTo(X(value * DEG), bottom); ctx.stroke();
    ctx.textAlign = 'center'; ctx.fillText(`${value}°`, X(value * DEG), bottom + (compact ? 12 : 15));
  }
  const tickStep = compact ? yMax - yMin : 90;
  for (let value = yMin; value <= yMax; value += tickStep) {
    ctx.beginPath(); ctx.moveTo(left, Y(value * DEG)); ctx.lineTo(right, Y(value * DEG)); ctx.stroke();
    ctx.textAlign = 'right'; ctx.fillText(`${value}°`, left - 5, Y(value * DEG) + 3);
  }
  ctx.save(); ctx.beginPath(); ctx.rect(left, top, right - left, bottom - top); ctx.clip();
  for (const joint of joints) for (let row = 1; row < samples.length; row++) {
    const sample = samples[row], previous = samples[row - 1];
    if (!sample?.connectedToPrevious || !previous) continue;
    ctx.strokeStyle = sample.valid && previous.valid ? GREEN : GREY;
    ctx.lineWidth = compact ? 1 : 1.8; ctx.beginPath();
    ctx.moveTo(X(previous.angle), Y(previous.q[joint])); ctx.lineTo(X(sample.angle), Y(sample.q[joint])); ctx.stroke();
  }
  const selectedX = X(sweep.angles[selectedRow]);
  ctx.strokeStyle = RED; ctx.lineWidth = compact ? 1 : 1.5; ctx.beginPath(); ctx.moveTo(selectedX, top); ctx.lineTo(selectedX, bottom); ctx.stroke();
  ctx.restore();
  const selected = samples[selectedRow];
  if (selected && !compact) {
    const labels = joints.map(joint => ({ joint, original: Y(selected.q[joint]), y: Y(selected.q[joint]) + 3 })).sort((a, b) => a.y - b.y);
    labels.forEach((label, index) => { if (index) label.y = Math.max(label.y, labels[index - 1].y + 12); });
    const overshoot = Math.max(0, labels.at(-1).y - bottom);
    const labelX = selectedX > right - 35 ? selectedX - 24 : selectedX + 10;
    for (const label of labels) {
      label.y -= overshoot;
      ctx.strokeStyle = '#777'; ctx.lineWidth = .7; ctx.beginPath(); ctx.moveTo(selectedX, label.original); ctx.lineTo(labelX, label.y - 3); ctx.stroke();
      ctx.fillStyle = INK; ctx.font = 'bold 10px Arial'; ctx.textAlign = 'left'; ctx.fillText(`q${label.joint + 1}`, labelX, label.y);
    }
  }
  if (!compact) {
    ctx.fillStyle = INK; ctx.font = '11px Arial'; ctx.textAlign = 'center'; ctx.fillText('redundant angle q₃', (left + right) / 2, box.y + box.h - 4);
    ctx.save(); ctx.translate(box.x + 11, (top + bottom) / 2); ctx.rotate(-Math.PI / 2); ctx.fillText('continuous dependent joint angles', 0, 0); ctx.restore();
  }
  return { left, right, top, bottom, branch };
}

function canvasKit(canvas, draw) {
  const state = { ctx: canvas.getContext('2d'), w: 0, h: 0, ready: false };
  const resize = () => {
    const rect = canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
    if (rect.width < 2 || rect.height < 2) return;
    canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr);
    state.ctx.setTransform(dpr, 0, 0, dpr, 0, 0); state.w = rect.width; state.h = rect.height; state.ready = true; draw();
  };
  new ResizeObserver(resize).observe(canvas); requestAnimationFrame(resize); return state;
}

async function createConfigurationPair(host) {
  const pose = { p: DEFAULT_RECTANGLE.center, R: DEFAULT_RECTANGLE.R };
  const roots = [-30, 30].map(angle => inverseFixedQ3(pose, angle * DEG).find(root => root.branchIndex === 4 && root.valid));
  if (roots.some(root => !root)) throw new Error('The redundancy example requires two legal configurations of the same tool pose.');
  host.innerHTML = roots.map((root, i) => `<figure><figcaption>Configuration ${i ? 'B' : 'A'} · q₃ = ${i ? '+30' : '−30'}°</figcaption><div class="l8r-stage"><span class="l8r-badge">Tool t · same position and orientation</span></div><p>q${i ? 'B' : 'A'} [°]: ${root.q.map(q => (q / DEG).toFixed(1)).join(', ')}</p></figure>`).join('');
  await Promise.all([...host.querySelectorAll('.l8r-stage')].map(async (stage, i) => {
    const viewer = await createViewer(stage); viewer.update(roots[i].q);
  }));
  host.dataset.configurations = JSON.stringify(roots.map(root => root.q));
  host.dataset.poseError = Math.max(...roots.map(root => poseDistance(fk(root.q), pose).error));
  host.dataset.ready = 'true'; host.dataset.busy = 'false';
}

async function robotAssets() {
  if (assetsPromise) return assetsPromise;
  assetsPromise = (async () => {
    const url = new URL('../../assets/models/iiwa7/iiwa7.urdf', import.meta.url);
    const response = await fetch(url); if (!response.ok) throw new Error('Could not load the KUKA iiwa 7 robot.');
    const xml = new DOMParser().parseFromString(await response.text(), 'application/xml');
    const direct = (node, name) => [...node.children].find(child => child.tagName === name);
    const vector = (node, attribute, fallback = [0, 0, 0]) => node?.getAttribute(attribute)?.trim().split(/\s+/).map(Number) || fallback;
    const origin = node => {
      const data = direct(node, 'origin'), [x, y, z] = vector(data, 'xyz'), [r, p, yaw] = vector(data, 'rpy');
      return new THREE.Matrix4().makeTranslation(x, y, z).multiply(new THREE.Matrix4().makeRotationZ(yaw)).multiply(new THREE.Matrix4().makeRotationY(p)).multiply(new THREE.Matrix4().makeRotationX(r));
    };
    const joints = [...xml.documentElement.children].filter(node => node.tagName === 'joint').map(node => ({ name: node.getAttribute('name'), parent: direct(node, 'parent').getAttribute('link'), child: direct(node, 'child').getAttribute('link'), origin: origin(node), axis: new THREE.Vector3(...vector(direct(node, 'axis'), 'xyz', [0, 0, 1])).normalize(), index: node.getAttribute('type') === 'revolute' ? +node.getAttribute('name').match(/(\d+)$/)[1] - 1 : -1 }));
    const materials = new Map([...xml.documentElement.children].filter(node => node.tagName === 'material').map(node => [node.getAttribute('name'), vector(direct(node, 'color'), 'rgba', [.6, .6, .6, 1])]));
    const visuals = await Promise.all([...xml.documentElement.children].filter(node => node.tagName === 'link' && direct(node, 'visual')).map(async link => {
      const visual = direct(link, 'visual'), mesh = visual.querySelector('geometry > mesh');
      const file = mesh.getAttribute('filename').split('/').at(-1), response = await fetch(new URL(file, url));
      if (!response.ok) throw new Error(`Could not load iiwa mesh ${file}.`);
      const geometry = parseStlGeometry(await response.arrayBuffer()); geometry.computeVertexNormals();
      const material = direct(visual, 'material'), rgba = materials.get(material?.getAttribute('name')) || [.6, .6, .6, 1];
      return { name: link.getAttribute('name'), geometry, origin: origin(visual), scale: vector(mesh, 'scale', [1, 1, 1]), color: new THREE.Color(...rgba.slice(0, 3)) };
    }));
    const transforms = q => {
      const result = { world: new THREE.Matrix4() };
      for (const joint of joints) {
        if (!result[joint.parent]) result[joint.parent] = new THREE.Matrix4();
        const matrix = result[joint.parent].clone().multiply(joint.origin);
        if (joint.index >= 0) matrix.multiply(new THREE.Matrix4().makeRotationAxis(joint.axis, q[joint.index]));
        result[joint.child] = matrix;
      }
      return result;
    };
    for (let i = 0; i < 10; i++) {
      const q = IIWA_LIMITS.map((limit, joint) => .6 * limit * Math.sin(i * 1.71 + joint));
      const actual = transforms(q).iiwa_link_ee, expected = fk(q), point = new THREE.Vector3().setFromMatrixPosition(actual);
      if (point.distanceTo(new THREE.Vector3(...expected.p)) > 1e-9) throw new Error('The analytical iiwa model and rendered robot do not match.');
      const e = actual.elements;
      for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) if (Math.abs(e[col * 4 + row] - expected.R[row][col]) > 1e-9) throw new Error('The analytical iiwa tool orientation and rendered robot do not match.');
    }
    return { visuals, transforms };
  })();
  return assetsPromise;
}

async function createViewer(host) {
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#f3f4f5');
  const camera = new THREE.PerspectiveCamera(38, 1, .01, 20); camera.position.set(1.8, 1.5, 1.9);
  const renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); renderer.outputColorSpace = THREE.SRGBColorSpace; host.prepend(renderer.domElement);
  const world = createZUpWorld(scene), grid = new THREE.GridHelper(2.4, 24, 0xc4c8cc, 0xe0e3e6); grid.rotation.x = Math.PI / 2; world.add(grid);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x65707a, 2.5));
  const light = new THREE.DirectionalLight(0xffffff, 2.5); light.position.set(4, 6, 3); scene.add(light);
  const controls = new OrbitControls(camera, renderer.domElement); controls.target.set(.2, .5, 0); controls.update();
  const robot = new THREE.Group(), ghost = new THREE.Group(); world.add(robot, ghost); ghost.visible = false;
  const toolFrame = new THREE.AxesHelper(.09); toolFrame.matrixAutoUpdate = false; toolFrame.material.depthTest = false; toolFrame.renderOrder = 20; world.add(toolFrame);
  const toolDot = new THREE.Mesh(new THREE.SphereGeometry(.011, 16, 10), new THREE.MeshBasicMaterial({ color: 0xd90000, depthTest: false })); toolDot.renderOrder = 21; world.add(toolDot);
  let desired = null, achieved = null, ghostKey = '', opacity = 1;
  const render = () => renderer.render(scene, camera);
  const opacityLabel = document.createElement('label'); opacityLabel.className = 'l8r-opacity';
  opacityLabel.innerHTML = 'STL opacity <input type="range" min="0.1" max="1" value="1" step="0.05" aria-label="KUKA STL opacity"><output>100%</output>'; host.append(opacityLabel);
  opacityLabel.querySelector('input').addEventListener('input', event => {
    opacity = +event.target.value;
    robot.traverse(node => { if (node.isMesh) { node.material.opacity = opacity; node.material.transparent = opacity < 1; node.material.depthWrite = opacity === 1; } });
    opacityLabel.querySelector('output').textContent = `${Math.round(opacity * 100)}%`; render();
  });
  controls.addEventListener('change', render);
  new ResizeObserver(() => { resizeRendererToContainer(renderer, camera, host); render(); }).observe(host);
  resizeRendererToContainer(renderer, camera, host);
  const assets = await robotAssets();
  for (const spec of assets.visuals) for (const [group, isGhost] of [[robot, false], [ghost, true]]) {
    const mesh = new THREE.Mesh(spec.geometry, new THREE.MeshStandardMaterial({ color: isGhost ? '#74787d' : spec.color, roughness: .57, metalness: .08, transparent: isGhost, opacity: isGhost ? .17 : opacity, depthWrite: !isGhost }));
    mesh.name = spec.name; mesh.matrixAutoUpdate = false; group.add(mesh);
  }
  const pose = (group, q) => {
    const transforms = assets.transforms(q);
    group.children.forEach((mesh, i) => { const spec = assets.visuals[i]; mesh.matrix.copy(transforms[spec.name]).multiply(spec.origin).scale(new THREE.Vector3(...spec.scale)); mesh.matrixWorldNeedsUpdate = true; });
    return transforms;
  };
  const replaceLine = (previous, points, color, dashed = false) => {
    if (previous) { previous.removeFromParent(); previous.geometry.dispose(); previous.material.dispose(); }
    if (points.length < 2) return null;
    const geometry = new THREE.BufferGeometry().setFromPoints(points.map(point => new THREE.Vector3(...point)));
    const material = dashed ? new THREE.LineDashedMaterial({ color, dashSize: .025, gapSize: .012, depthTest: false }) : new THREE.LineBasicMaterial({ color, depthTest: false });
    const line = new THREE.Line(geometry, material); line.renderOrder = 12; if (dashed) line.computeLineDistances(); world.add(line); return line;
  };
  host.dataset.meshCount = String(robot.children.length);
  host.dataset.robotModel = 'KUKA iiwa 7';
  return {
    update(q) { robot.visible = !!q; toolFrame.visible = !!q; toolDot.visible = !!q; if (!q) { delete host.dataset.configuration; render(); return; } const transforms = pose(robot, q); toolFrame.matrix.copy(transforms.iiwa_link_ee); toolFrame.matrixWorldNeedsUpdate = true; toolDot.position.fromArray(fk(q).p); host.dataset.configuration = JSON.stringify(q); render(); },
    setGhost(q) { const key = q?.join(',') || ''; if (key === ghostKey) return; ghostKey = key; ghost.visible = !!q; if (q) pose(ghost, q); host.dataset.hasGhost = String(!!q); render(); },
    setDesired(points) { desired = replaceLine(desired, points, 0x151515, true); render(); },
    setAchieved(points) { achieved = replaceLine(achieved, points, 0xd90000); render(); }
  };
}

export { createViewer as createIiwa7Viewer };

function fail(host, error) {
  host.innerHTML = '';
  const message = document.createElement('div'); message.className = 'warning'; message.textContent = `The iiwa planning lab could not start: ${error.message}`; host.append(message); host.dataset.error = error.message; console.error(error);
}
