import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createZUpWorld, resizeRendererToContainer } from './threeUtils.js';
import { loadAbbIrbVisuals } from './abbIrbVisuals.js';
import { abbUrdfTransforms, abbDeterminant } from './abbIrbKinematics.js';
import { analyzeAbbPath, abbPathPoseError, abbPathJointVelocity, ABB_PATH_SPEED_LIMITS, ABB_PATH_SPEC, abbPositionSliceBoundaries, abbRectangleClock, abbRectangleTime } from './lecture07AbbIrbPaths.js';

const DEG = Math.PI / 180;
const label = signs => signs.map((sign, i) => `${['S', 'E', 'W'][i]}${sign > 0 ? '+' : '−'}`).join(' ');
const svgNS = 'http://www.w3.org/2000/svg';

/** Full-pose numerical continuation and genuine analytical ABB IK enumeration. */
export async function createAbbIrbPathLab(host, mode) {
  if (!['abb-irb-path', 'abb-irb-numerical', 'abb-irb-analytical'].includes(mode)) throw new Error(`Unknown ABB path mode: ${mode}`);
  const analytical = mode === 'abb-irb-analytical';
  host.classList.add('l7-viewer-lab', 'l7-irb-lab');
  host.innerHTML = `<div class="l7-stage"><div class="hud">ABB IRB 4600 · fixed tool orientation · tool path</div>
    <label class="l7-irb-opacity"><span>STL opacity</span><input aria-label="ABB mesh opacity" type="range" min="10" max="100" step="5" value="100"><output>100%</output></label></div>
    <div class="l7-plot l7-irb-plot"><svg role="img" aria-label="Desired and achieved tool path, x and y in metres"></svg></div>
    <aside class="l7-panel l7-irb-panel"><div class="l7-controls"><button class="primary" data-play>Play path</button><button data-reset>Reset</button>
    <select data-seed aria-label="Starting ABB inverse-kinematic solution"></select><label class="l7-irb-scrub">Duration T <input data-duration aria-label="ABB trajectory duration" type="range" min="2" max="20" step="1" value="12"><output data-duration-value>12 s</output></label><label class="l7-irb-scrub">Path progress <input data-progress aria-label="Path progress" type="range" min="0" max="360" value="0"></label></div>
    <table class="l7-irb-branches"><thead><tr><th>Start IK</th><th>${analytical ? 'Whole-path analysis' : 'Local continuation'}</th></tr></thead><tbody></tbody></table>
    <div><div class="l7-readout"></div><p class="l7-status" aria-live="polite"></p></div></aside>`;
  const stage = host.querySelector('.l7-stage'), play = host.querySelector('[data-play]'), reset = host.querySelector('[data-reset]');
  const select = host.querySelector('[data-seed]'), progress = host.querySelector('[data-progress]');
  const readout = host.querySelector('.l7-readout'), status = host.querySelector('.l7-status'), table = host.querySelector('tbody');
  const data = analyzeAbbPath(), tracks = analytical ? data.analytical : data.numerical;
  let selected = mode === 'abb-irb-numerical' ? tracks.findIndex(track => track.failIndex > 0) : tracks.findIndex(track => track.success);
  let frame = 0, playing = false, startTime = 0, raf = 0, disposed = false, duration = 12;
  const unitSpeedRatios = tracks.map(track => Math.max(...track.states.map((q,i) => {
    const s = i/(data.targets.length-1), clock = abbRectangleClock(abbRectangleTime(s));
    const rates = abbPathJointVelocity(q,s,clock.velocity);
    return rates ? Math.max(...rates.map((v,k) => Math.abs(v)/ABB_PATH_SPEED_LIMITS[k])) : Infinity;
  })));
  progress.max = data.targets.length - 1;
  tracks.forEach((track, index) => {
    const option = document.createElement('option'); option.value = index;
    option.textContent = `${label(track.seed.signs)}${track.failIndex === 0 ? ' · rejected at start' : ''}`;
    select.append(option);
    const row = document.createElement('tr'); row.dataset.branch = label(track.seed.signs); row.dataset.seedIndex = index;
    const name = document.createElement('td'), state = document.createElement('td'); name.textContent = label(track.seed.signs);
    row.append(name, state); table.append(row);
  });
  select.value = selected;

  const scene = new THREE.Scene(); scene.background = new THREE.Color(0xf1f2f3);
  const camera = new THREE.PerspectiveCamera(38, 1, .02, 60); camera.position.set(4.5, 3.1, 4.7);
  const renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = .8;
  stage.prepend(renderer.domElement);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x626a70, 2.4));
  const light = new THREE.DirectionalLight(0xffffff, 2.5); light.position.set(5, 7, 9); scene.add(light);
  const world = createZUpWorld(scene), grid = new THREE.GridHelper(6, 24, 0xb4bbc1, 0xdadfe3); grid.rotation.x = Math.PI / 2; world.add(grid);
  const controls = new OrbitControls(camera, renderer.domElement); controls.target.set(1.05, 1, -.3); controls.enableDamping = false; controls.update();
  const render = () => { if (!disposed) renderer.render(scene, camera); };
  controls.addEventListener('change', render);
  const visuals = await loadAbbIrbVisuals(world);
  const materials = new Set();
  visuals.group.children.forEach((link, i) => link.traverse(object => {
    if (!object.isMesh) return;
    object.material.color.set(i === 0 || i === 1 || i === 4 ? 0x777d82 : 0xe9e8e4);
    materials.add(object.material);
  }));
  const opacity = stage.querySelector('.l7-irb-opacity');
  Object.assign(opacity.style, { position: 'absolute', bottom: '.5rem', left: '.5rem', top: 'auto', zIndex: '4', display: 'flex', alignItems: 'center', gap: '.4rem', padding: '.3rem .45rem', background: 'rgba(255,255,255,.94)', fontSize: '.7rem' });
  opacity.querySelector('input').addEventListener('input', event => {
    const amount = Number(event.target.value) / 100;
    materials.forEach(material => { material.opacity = amount; material.transparent = amount < 1; material.depthWrite = amount >= .95; material.needsUpdate = true; });
    opacity.querySelector('output').value = `${event.target.value}%`; host.dataset.opacity = amount; render();
  });
  const pathGeometry = new THREE.BufferGeometry().setFromPoints(data.targets.map(target => new THREE.Vector3(...target.position)));
  const desiredLine = new THREE.Line(pathGeometry, new THREE.LineBasicMaterial({ color: 0xe00000 })); world.add(desiredLine);
  const trailGeometry = new THREE.BufferGeometry(), trail = new THREE.Line(trailGeometry, new THREE.LineBasicMaterial({ color: 0x222b32 })); world.add(trail);
  const sphereGeometry = new THREE.SphereGeometry(.035, 16, 12);
  const desired = new THREE.Mesh(sphereGeometry, new THREE.MeshStandardMaterial({ color: 0xe00000 }));
  const actual = new THREE.Mesh(sphereGeometry, new THREE.MeshStandardMaterial({ color: 0x222b32 })); actual.scale.setScalar(.72); world.add(desired, actual);
  const plot = createPathPlot(host.querySelector('svg'), data.targets);
  const resize = new ResizeObserver(() => { resizeRendererToContainer(renderer, camera, stage); render(); }); resize.observe(stage);
  resizeRendererToContainer(renderer, camera, stage);

  function lastFrame() { return tracks[selected].success ? data.targets.length - 1 : tracks[selected].failIndex; }
  function update(index) {
    frame = Math.max(0, Math.min(index, lastFrame()));
    const track = tracks[selected], achievedIndex = Math.min(frame, track.states.length - 1), q = track.states[achievedIndex];
    const transforms = abbUrdfTransforms(q), point = transforms.tool0.slice(0, 3).map(row => row[3]); visuals.update(transforms);
    desired.position.fromArray(data.targets[frame].position); actual.position.fromArray(point);
    const achieved = track.states.slice(0, achievedIndex + 1).map(state => abbUrdfTransforms(state).tool0.slice(0, 3).map(row => row[3]));
    trailGeometry.setFromPoints(achieved.map(position => new THREE.Vector3(...position))); plot.update(achieved, data.targets[frame].position, point, track, analytical || frame >= track.failIndex);
    progress.value = frame;
    table.querySelectorAll('tr').forEach((row, index) => {
      const candidate = tracks[index]; row.classList.toggle('active', index === selected);
      row.setAttribute('aria-selected', String(index === selected));
      const rejected = candidate.failIndex === 0, failedNow = !candidate.success && frame >= candidate.failIndex;
      row.dataset.state = rejected ? 'rejected' : failedNow ? 'failed' : frame === data.targets.length - 1 ? 'complete' : 'alive';
      row.lastChild.textContent = rejected ? `Rejected: ${candidate.failure.message}`
        : analytical ? candidate.success ? 'Completes loop' : `Stops s=${(candidate.failIndex / (data.targets.length - 1)).toFixed(3)}: ${candidate.failure.message}`
          : failedNow ? `Stopped: ${candidate.failure.message}` : frame === data.targets.length - 1 ? 'Loop complete' : 'Tracking';
    });
    const atFailure = !track.success && frame >= track.failIndex;
    play.disabled = track.failIndex === 0;
    const s = achievedIndex/(data.targets.length-1), clock = abbRectangleClock(abbRectangleTime(s,duration),duration);
    const rates = abbPathJointVelocity(q,s,clock.velocity), peakSpeedRatio = unitSpeedRatios[selected]/duration;
    readout.textContent = `s = ${(frame / (data.targets.length - 1)).toFixed(3)} · ${label(track.seed.signs)} · ${analytical ? 'analytical IK' : 'hybrid predictor + Newton'}\n` +
      `${data.positionCounts[frame]} position IKs · ${data.roots[frame].length} full-pose IKs at the desired point\nq₁…q₆ [°]: ${q.map(value => (value / DEG).toFixed(1)).join(', ')}\n|det ⁰J₆| = ${Math.abs(abbDeterminant(q)).toFixed(4)} m³ · FK error ${Math.hypot(...abbPathPoseError(q, data.targets[achievedIndex])).toExponential(1)}`;
    readout.textContent += `\nq̇ [°/s]: ${rates ? rates.map(v=>(v/DEG).toFixed(1)).join(', ') : 'undefined at singularity'}\nT=${duration}s · peak speed / limit = ${peakSpeedRatio.toFixed(2)} ${peakSpeedRatio<=1?'✓':'— increase T'} (sampled ${track.success?'whole path':'admissible prefix'})`;
    status.textContent = atFailure
      ? `${track.failIndex === 0 ? 'This mathematical start is outside the joint limits.' : track.failure.kind === 'positional-fold' ? 'This branch reaches a positional fold.' : track.failure.kind === 'joint-limit' ? 'This branch reaches a joint limit.' : 'This continuation cannot proceed.'} ${track.failure.message}. ${track.failIndex > 0 ? 'The robot holds its last admissible configuration. Choose S+ E+ to complete the same command.' : 'Choose an admissible starting IK.'}`
      : analytical ? `${data.mathematicalStarts} mathematical starts → ${data.validStarts} admissible starts → ${data.completed} complete sampled joint paths. All IK roots are recomputed at every pose; limits and continuation decide which starts work.`
        : 'Analytical IK initializes each S/E/W branch; J q̇ = V predicts motion and Newton corrects it. A separate smooth clock stops at each rectangle corner. Increasing T can fix a speed excess; it cannot restore a missing IK branch.';
    host.dataset.ready = 'true'; host.dataset.mode = mode; host.dataset.frame = frame; host.dataset.selectedSeed = selected;
    host.dataset.playing = String(playing); host.dataset.meshCount = visuals.count; host.dataset.startIkCount = data.mathematicalStarts;
    host.dataset.pathPlane = 'xy'; host.dataset.pathShape = 'rectangle'; host.dataset.jacobianPoint = '6'; host.dataset.positionIkCount = data.positionCounts[frame]; host.dataset.fullPoseIkCount = data.roots[frame].length;
    host.dataset.validStartCount = data.validStarts; host.dataset.completeBranchCount = data.completed;
    host.dataset.duration = duration; host.dataset.peakSpeedRatio = peakSpeedRatio;
    host.dataset.trackState = atFailure ? 'failed' : frame === data.targets.length - 1 ? 'complete' : 'tracking'; render();
  }
  function stop() { playing = false; cancelAnimationFrame(raf); raf = 0; play.textContent = 'Play path'; host.dataset.playing = 'false'; }
  function tick(time) {
    if (!playing || disposed) return;
    const s = abbRectangleClock(Math.max(0,(time-startTime)/1000),duration).s;
    const i = Math.max(0, Math.min(lastFrame(), Math.floor(s*(data.targets.length-1)))); update(i);
    if (i >= lastFrame()) { stop(); play.textContent = 'Replay path'; } else raf = requestAnimationFrame(tick);
  }
  play.addEventListener('click', () => {
    if (playing) { stop(); return; }
    if (frame >= lastFrame()) frame = 0;
    playing = true; startTime = performance.now() - abbRectangleTime(frame/(data.targets.length-1),duration)*1000; play.textContent = 'Pause'; update(frame); raf = requestAnimationFrame(tick);
  });
  reset.addEventListener('click', () => { stop(); update(0); });
  select.addEventListener('change', () => { stop(); selected = Number(select.value); update(0); });
  progress.addEventListener('input', () => { stop(); update(Number(progress.value)); });
  host.querySelector('[data-duration]').addEventListener('input', event => {
    stop();duration=Number(event.target.value);host.querySelector('[data-duration-value]').textContent=duration+' s';update(0);
  });
  table.addEventListener('click', event => { const row = event.target.closest('[data-seed-index]'); if (row) { select.value = row.dataset.seedIndex; select.dispatchEvent(new Event('change')); } });
  function onHash() { if (host.closest('.slide')?.classList.contains('active') === false) stop(); }
  window.addEventListener('hashchange', onHash);
  update(0);
  return { analysis: data, update, dispose() {
    stop(); disposed = true; resize.disconnect(); plot.dispose(); controls.dispose(); visuals.dispose(); renderer.dispose();
    pathGeometry.dispose(); trailGeometry.dispose(); sphereGeometry.dispose();
    desiredLine.material.dispose(); trail.material.dispose(); desired.material.dispose(); actual.material.dispose();
    window.removeEventListener('hashchange', onHash);
  } };
}

function createPathPlot(svg, targets) {
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  const element = (tag, attributes = {}, parent = svg) => { const node = document.createElementNS(svgNS, tag); Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, value)); parent.append(node); return node; };
  const text = (x, y, label, extra = {}) => { const node = element('text', { x, y, fill: '#323b43', 'font-family': 'Arial,sans-serif', 'font-size': 12, ...extra }); node.textContent = label; return node; };
  let width = 420, height = 260, bounds, achieved, desiredDot, actualDot, stop, lastState;
  const x0 = 1.2, x1 = 2.55, y0 = 0, y1 = 1.05, radii = abbPositionSliceBoundaries();
  const px = x => bounds.left + (x - x0) / (x1 - x0) * (bounds.right - bounds.left);
  const py = y => bounds.bottom - (y - y0) / (y1 - y0) * (bounds.bottom - bounds.top);
  const path = points => points.map((point, i) => `${i ? 'L' : 'M'}${px(point[0]).toFixed(3)},${py(point[1]).toFixed(3)}`).join(' ');
  const clipId = `abb-xy-clip-${Math.random().toString(36).slice(2)}`;
  function build() {
    const rect = svg.getBoundingClientRect(); width = Math.max(240, rect.width || 420); height = Math.max(120, rect.height || 260);
    const availableWidth = width - 60, availableHeight = Math.max(40, height - 97);
    const scale = Math.min(availableWidth / (x1 - x0), availableHeight / (y1 - y0));
    const plotWidth = scale * (x1 - x0), plotHeight = scale * (y1 - y0);
    const left = 45 + (availableWidth - plotWidth) / 2, top = 61 + (availableHeight - plotHeight) / 2;
    bounds = { left, right: left + plotWidth, top, bottom: top + plotHeight };
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`); svg.replaceChildren();
    svg.dataset.positionBoundaryRadius = radii.fourToTwo; svg.dataset.plane = 'xy';
    element('rect', { width, height, fill: 'white' }); text(10, 17, `Tool xy path · z = ${ABB_PATH_SPEC.z.toFixed(2)} m`, { 'font-weight': 700, 'font-size': 12 });
    const defs = element('defs'), clip = element('clipPath', { id: clipId }, defs);
    element('rect', { x: left, y: top, width: plotWidth, height: plotHeight }, clip);
    const regions = element('g', { 'clip-path': `url(#${clipId})` });
    element('rect', { x: left, y: top, width: plotWidth, height: plotHeight, fill: '#b9bfc4' }, regions);
    element('circle', { cx: px(0), cy: py(0), r: radii.twoToZero * scale, fill: '#e2e5e8', stroke: '#67727b', 'stroke-width': 1 }, regions);
    element('circle', { cx: px(0), cy: py(0), r: radii.fourToTwo * scale, fill: '#fff', stroke: '#67727b', 'stroke-width': 1.5, 'stroke-dasharray': '4 3', 'data-position-boundary': '4-to-2' }, regions);
    for (let x = 1.25; x <= x1 + .001; x += .25) { element('line', { x1: px(x), x2: px(x), y1: bounds.top, y2: bounds.bottom, stroke: '#ccd2d7', 'stroke-opacity': .65, 'stroke-width': .7 }); text(px(x), bounds.bottom + 15, Number(x.toFixed(2)), { 'text-anchor': 'middle', 'font-size': 10 }); }
    for (let y = y0; y <= y1 + .001; y += .25) { element('line', { x1: bounds.left, x2: bounds.right, y1: py(y), y2: py(y), stroke: '#ccd2d7', 'stroke-opacity': .65, 'stroke-width': .7 }); text(bounds.left - 7, py(y) + 4, Number(y.toFixed(2)), { 'text-anchor': 'end', 'font-size': 10 }); }
    element('path', { d: `M${bounds.left},${bounds.top}V${bounds.bottom}H${bounds.right}`, fill: 'none', stroke: '#63717b', 'stroke-width': 1.2 });
    text((bounds.left + bounds.right) / 2, height - 4, 'x [m]', { 'text-anchor': 'middle', 'font-size': 11 }); text(13, (bounds.top + bounds.bottom) / 2, 'y [m]', { transform: `rotate(-90 13 ${(bounds.top + bounds.bottom) / 2})`, 'text-anchor': 'middle', 'font-size': 11 });
    element('path', { d: path(targets.map(target => target.position)), fill: 'none', stroke: '#e00000', 'stroke-width': 2.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'miter' });
    achieved = element('path', { fill: 'none', stroke: '#222b32', 'stroke-width': 1.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'miter' });
    const start = targets[0].position; element('circle', { cx: px(start[0]), cy: py(start[1]), r: 4, fill: '#fff', stroke: '#333', 'stroke-width': 1.5 }); text(px(start[0]) + 6, py(start[1]) + 13, 'start', { 'font-size': 10 });
    desiredDot = element('circle', { r: 4, fill: '#e00000', stroke: '#fff', 'stroke-width': 1.2 });
    actualDot = element('circle', { r: 3, fill: '#222b32', stroke: '#fff', 'stroke-width': 1 });
    stop = element('path', { fill: 'none', stroke: '#b86200', 'stroke-width': 2.5 });
    text(10, 34, 'Position IKs:', { 'font-size': 10 });
    [[83, '#fff', '4'], [116, '#e2e5e8', '2'], [149, '#b9bfc4', '0']].forEach(([x, fill, label]) => { element('rect', { x, y: 25, width: 9, height: 9, fill, stroke: '#67727b', 'stroke-width': .6 }); text(x + 12, 34, label, { 'font-size': 10 }); });
    text(10, 48, '— desired', { fill: '#e00000', 'font-size': 10 }); text(88, 48, '— achieved', { fill: '#222b32', 'font-size': 10 });
    if (lastState) update(...lastState);
  }
  function update(points, target, actual, track, showFailure) {
    lastState = [points, target, actual, track, showFailure]; achieved.setAttribute('d', path(points));
    desiredDot.setAttribute('cx', px(target[0])); desiredDot.setAttribute('cy', py(target[1]));
    actualDot.setAttribute('cx', px(actual[0])); actualDot.setAttribute('cy', py(actual[1]));
    if (showFailure && track.failIndex > 0) { const p = targets[track.failIndex].position, x = px(p[0]), y = py(p[1]); stop.setAttribute('d', `M${x - 5},${y - 5}L${x + 5},${y + 5}M${x - 5},${y + 5}L${x + 5},${y - 5}`); }
    else stop.setAttribute('d', '');
  }
  const observer = new ResizeObserver(build); observer.observe(svg); build();
  return { update, dispose() { observer.disconnect(); } };
}
