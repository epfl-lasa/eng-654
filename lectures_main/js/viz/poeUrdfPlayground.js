import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createBoldAxes, createZUpWorld, resizeRendererToContainer } from './threeUtils.js';
import { parseStlGeometry } from './frameDHPlayground.js?v=20260814-3';

const DEG = Math.PI / 180;
const EPS = 1e-8;

export function initPoeUrdfPlaygrounds() {
  initAll('[data-rotation2d-demo]', createRotation2DDemo);
  initAll('[data-screw-exponential-demo]', createScrewExponentialDemo);
  initAll('[data-screw-frame-demo]', createScrewFrameDemo);
  initAll('[data-custom3r-poe-demo]', createCustom3RPoeDemo);
  initAll('[data-urdf-editor-demo]', createUrdfEditorDemo);
}

function initAll(selector, factory) {
  document.querySelectorAll(selector).forEach((container) => {
    try {
      const result = factory(container);
      if (result?.catch) result.catch((error) => failDemo(container, error));
    }
    catch (error) {
      failDemo(container, error);
    }
  });
}

function failDemo(container, error) {
  container.innerHTML = `<div class="warning">Interactive demo could not start: ${escapeHtml(error.message)}</div>`;
  console.error('ENG-654 PoE/URDF demo failed:', error);
}

function sceneKit(stage, cameraPosition = [4.5, 3.2, 4.2]) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xfafafa);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 100);
  camera.position.fromArray(cameraPosition);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  stage.prepend(renderer.domElement);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x777777, 1.8));
  const light = new THREE.DirectionalLight(0xffffff, 2.2);
  light.position.set(4, 6, 5); scene.add(light);
  const world = createZUpWorld(scene); world.add(grid(7, 0.5));
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.08; controls.target.set(0.8, 0.4, 0.5); controls.update();
  const resize = () => resizeRendererToContainer(renderer, camera, stage);
  const observer = new ResizeObserver(resize); observer.observe(stage); resize();
  function animate() { controls.update(); renderer.render(scene, camera); requestAnimationFrame(animate); }
  requestAnimationFrame(animate);
  return { camera, renderer, world, controls };
}

function grid(size, step) {
  const vertices = [], h = size / 2;
  for (let x = -h; x <= h + EPS; x += step) vertices.push(x, -h, 0, x, h, 0);
  for (let y = -h; y <= h + EPS; y += step) vertices.push(-h, y, 0, h, y, 0);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  return new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0xd8d8d8, transparent: true, opacity: 0.75 }));
}

function sprite(text, accent = false) {
  const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 80;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.fillRect(2, 5, 252, 70);
  ctx.strokeStyle = accent ? '#ff0000' : '#bbbbbb'; ctx.lineWidth = accent ? 5 : 2; ctx.strokeRect(2, 5, 252, 70);
  ctx.fillStyle = '#111'; ctx.font = '700 34px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 128, 40);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const result = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
  result.scale.set(0.78, 0.24, 1); result.renderOrder = 20; return result;
}

function frame(name, scale = 0.65, accent = false) {
  const group = new THREE.Group(); group.matrixAutoUpdate = false; group.add(createBoldAxes(scale));
  const marker = new THREE.Mesh(new THREE.SphereGeometry(scale * 0.075, 20, 14), new THREE.MeshStandardMaterial({ color: accent ? 0xff0000 : 0x222222 }));
  group.add(marker);
  const label = sprite(name, accent); label.position.set(scale * 0.22, scale * 0.22, scale * 0.28); group.add(label);
  return { group, marker, label };
}

function line(points, color = 0xff0000, opacity = 0.85) {
  return new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
}

function matrixRows(matrix) {
  const e = matrix.elements;
  return [[e[0],e[4],e[8],e[12]],[e[1],e[5],e[9],e[13]],[e[2],e[6],e[10],e[14]],[e[3],e[7],e[11],e[15]]];
}
function matrixHtml(matrix, digits = 3) {
  return matrixRows(matrix).map((row) => `<tr>${row.map((value) => `<td>${format(value, digits)}</td>`).join('')}</tr>`).join('');
}
function format(value, digits = 3) {
  const clean = Math.abs(value) < 0.5 * 10 ** -digits ? 0 : value; return clean.toFixed(digits);
}
function rpyMatrix(x, y, z, roll, pitch, yaw) {
  const rotation = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(roll, pitch, yaw, 'ZYX'));
  return new THREE.Matrix4().makeTranslation(x, y, z).multiply(rotation);
}
function expRevolute(omega, point, theta, pitch = 0) {
  const axis = omega.clone().normalize();
  const rotation = new THREE.Matrix4().makeRotationAxis(axis, theta);
  const rotatedPoint = point.clone().applyMatrix4(rotation);
  rotation.setPosition(point.clone().sub(rotatedPoint).addScaledVector(axis, pitch * theta));
  return rotation;
}

function createRotation2DDemo(container) {
  container.className = 'rotation2d-demo';
  const controlId = 'rotation2d-theta-' + Math.random().toString(36).slice(2,8);
  container.innerHTML = `
    <div class="rotation2d-canvas-wrap">
      <canvas aria-label="Animated two-dimensional rotation"></canvas>
      <p class="rotation2d-legend"><span class="world-key">W</span> fixed frame · <span class="body-key">B</span> rotating frame · green arrow \\(\\dot{\\mathbf p}\\)</p>
    </div>
    <div class="rotation2d-controls">
      <button class="control-button" data-play type="button">Play</button>
      <label for="${controlId}">θ</label>
      <input id="${controlId}" data-angle type="range" min="-360" max="360" step="1" value="45">
      <output data-angle-out>45°</output>
    </div>
    <div class="rotation2d-readout">
      <strong>\\(R(\\theta)=e^{J\\theta}\\)</strong>
      <table class="l2-matrix"><tbody data-r2-matrix></tbody></table>
    </div>`;
  const canvas = container.querySelector('canvas'), context = canvas.getContext('2d');
  const angleInput = container.querySelector('[data-angle]'), playButton = container.querySelector('[data-play]');
  let playing = false, lastTime = 0;

  function arrow(origin, vector, color, label, width = 4) {
    const end = { x: origin.x + vector.x, y: origin.y + vector.y };
    context.strokeStyle = color; context.fillStyle = color; context.lineWidth = width;
    context.beginPath(); context.moveTo(origin.x, origin.y); context.lineTo(end.x, end.y); context.stroke();
    const angle = Math.atan2(end.y - origin.y, end.x - origin.x), head = 10;
    context.beginPath(); context.moveTo(end.x, end.y);
    context.lineTo(end.x - head * Math.cos(angle - .45), end.y - head * Math.sin(angle - .45));
    context.lineTo(end.x - head * Math.cos(angle + .45), end.y - head * Math.sin(angle + .45));
    context.closePath(); context.fill();
    context.font = '700 14px Arial'; context.fillText(label, end.x + 6, end.y - 6);
  }

  function draw() {
    const rect = canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(rect.width * dpr)), height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    context.setTransform(dpr, 0, 0, dpr, 0, 0); context.clearRect(0, 0, rect.width, rect.height);
    const origin = { x: rect.width * .46, y: rect.height * .54 }, radius = Math.min(rect.width, rect.height) * .3;
    const theta = Number(angleInput.value) * DEG;
    context.strokeStyle = '#dddddd'; context.lineWidth = 1;
    for (let i = -4; i <= 4; i += 1) {
      context.beginPath(); context.moveTo(origin.x + i * 35, 20); context.lineTo(origin.x + i * 35, rect.height - 20); context.stroke();
      context.beginPath(); context.moveTo(20, origin.y + i * 35); context.lineTo(rect.width - 20, origin.y + i * 35); context.stroke();
    }
    context.strokeStyle = '#b8b8b8'; context.lineWidth = 2; context.beginPath(); context.arc(origin.x, origin.y, radius, 0, Math.PI * 2); context.stroke();
    arrow(origin, {x: radius * .72, y: 0}, '#777777', 'x_W', 3);
    arrow(origin, {x: 0, y: -radius * .72}, '#777777', 'y_W', 3);
    arrow(origin, {x: radius * .72 * Math.cos(theta), y: -radius * .72 * Math.sin(theta)}, '#ff3030', 'x_B');
    arrow(origin, {x: radius * .72 * Math.sin(theta), y: radius * .72 * Math.cos(theta)}, '#2775ff', 'y_B');
    const point = {x: origin.x + radius * Math.cos(theta), y: origin.y - radius * Math.sin(theta)};
    context.fillStyle = '#111111'; context.beginPath(); context.arc(point.x, point.y, 6, 0, Math.PI * 2); context.fill();
    context.font = '700 15px Arial'; context.fillText('P', point.x + 8, point.y - 8);
    arrow(point, {x: -55 * Math.sin(theta), y: -55 * Math.cos(theta)}, '#35a853', 'ṗ', 3);
    context.fillStyle = '#111'; context.beginPath(); context.arc(origin.x, origin.y, 5, 0, Math.PI * 2); context.fill();
    context.font = '700 14px Arial'; context.fillText('O', origin.x - 18, origin.y + 18);
    container.querySelector('[data-angle-out]').textContent = angleInput.value + '°';
    const rows = matrixRows(new THREE.Matrix4().makeRotationZ(theta)).slice(0,2).map((row) => row.slice(0,2));
    container.querySelector('[data-r2-matrix]').innerHTML = rows.map((row) => `<tr>${row.map((v) => `<td>${format(v,3)}</td>`).join('')}</tr>`).join('');
  }

  function animate(time) {
    if (playing) {
      if (lastTime) {
        let angle = Number(angleInput.value) + (time - lastTime) * .055;
        if (angle > 360) angle = -360;
        angleInput.value = angle;
      }
      lastTime = time; draw();
    } else lastTime = 0;
    requestAnimationFrame(animate);
  }
  angleInput.addEventListener('input', draw);
  playButton.addEventListener('click', () => { playing = !playing; playButton.textContent = playing ? 'Pause' : 'Play'; });
  new ResizeObserver(draw).observe(canvas);
  draw(); requestAnimationFrame(animate); typeset(container);
}

function createScrewExponentialDemo(container) {
  container.className = 'l2-demo screw-exponential-demo';
  container.innerHTML = `
    <div class="l2-stage"><p class="l2-stage-note">red line: screw axis · drag to orbit</p></div>
    <div class="l2-panel">
      <div class="l2-card"><strong>Screw parameters</strong>
        <div class="l2-control"><label>θ</label><input data-theta type="range" min="-360" max="360" value="90"><output data-theta-out>90°</output></div>
        <div class="l2-control"><label>pitch h</label><input data-pitch type="range" min="-0.6" max="0.6" step="0.02" value="0.2"><output data-pitch-out>0.20</output></div>
      </div>
      <div class="l2-card"><strong>Twist</strong><p class="l2-vector" data-twist></p></div>
      <div class="l2-card"><strong>Finite motion \\(e^{\\widehat{\\xi}\\theta}\\)</strong><table class="l2-matrix"><tbody data-matrix></tbody></table></div>
    </div>`;
  const kit = sceneKit(container.querySelector('.l2-stage'), [4.2, 3.2, 3.7]);
  const axisPoint = new THREE.Vector3(0.65, 0, 0), omega = new THREE.Vector3(0, 0, 1);
  kit.world.add(line([new THREE.Vector3(.65,0,-1.5), new THREE.Vector3(.65,0,2.8)], 0xff0000));
  const axisLabel = sprite('screw axis', true); axisLabel.position.set(.82, 0, 2.3); kit.world.add(axisLabel);
  const worldFrame = frame('W', 0.72); worldFrame.group.matrix.identity(); kit.world.add(worldFrame.group);
  const moving = frame('B', 0.72, true); kit.world.add(moving.group);
  let path = line([], 0x222222, 0.6); kit.world.add(path);
  const thetaInput = container.querySelector('[data-theta]'), pitchInput = container.querySelector('[data-pitch]');
  function update() {
    const theta = Number(thetaInput.value) * DEG, pitch = Number(pitchInput.value);
    const motion = expRevolute(omega, axisPoint, theta, pitch);
    moving.group.matrix.multiplyMatrices(motion, new THREE.Matrix4().makeTranslation(1.55, 0, 0.35)); moving.group.matrixWorldNeedsUpdate = true;
    const points = [];
    for (let i = 0; i <= 100; i += 1) points.push(new THREE.Vector3(1.55, 0, 0.35).applyMatrix4(expRevolute(omega, axisPoint, theta * i / 100, pitch)));
    kit.world.remove(path); path.geometry.dispose(); path.material.dispose(); path = line(points, 0x222222, 0.65); kit.world.add(path);
    const v = new THREE.Vector3().crossVectors(omega, axisPoint).negate().addScaledVector(omega, pitch);
    container.querySelector('[data-theta-out]').textContent = thetaInput.value + '°';
    container.querySelector('[data-pitch-out]').textContent = Number(pitchInput.value).toFixed(2);
    container.querySelector('[data-twist]').textContent = `ω = [0, 0, 1]   v = [${format(v.x,2)}, ${format(v.y,2)}, ${format(v.z,2)}]`;
    container.querySelector('[data-matrix]').innerHTML = matrixHtml(motion);
  }
  thetaInput.addEventListener('input', update); pitchInput.addEventListener('input', update); update(); typeset(container);
}

function createScrewFrameDemo(container) {
  container.className = 'l2-demo screw-frame-demo';
  container.innerHTML = `
    <div class="l2-stage"><p class="l2-stage-note">same red world screw · move observer B</p></div>
    <div class="l2-panel">
      <div class="l2-card"><strong>Pose \\({}^{W}T_B\\)</strong>
        <div class="l2-control"><label>x</label><input data-x type="range" min="-1.5" max="1.5" step=".05" value=".4"><output data-x-out>0.40</output></div>
        <div class="l2-control"><label>y</label><input data-y type="range" min="-1.5" max="1.5" step=".05" value=".7"><output data-y-out>0.70</output></div>
        <div class="l2-control"><label>yaw</label><input data-yaw type="range" min="-180" max="180" value="35"><output data-yaw-out>35°</output></div>
      </div>
      <div class="l2-card"><strong>Same physical screw</strong><p class="l2-vector">\\(^{W}\\xi=[0,0,1;\ 0,-0.8,0]\\)</p><p class="l2-vector" data-xi-b></p></div>
      <div class="l2-card"><strong>Adjoint check</strong><p style="margin:.35rem 0 0">\\(^{B}\\xi=\\operatorname{Ad}_{({}^{W}T_B)^{-1}}{}^{W}\\xi\\)</p></div>
    </div>`;
  const kit = sceneKit(container.querySelector('.l2-stage'));
  const worldFrame = frame('W', 0.7); worldFrame.group.matrix.identity(); kit.world.add(worldFrame.group);
  const bFrame = frame('B', 0.7, true); kit.world.add(bFrame.group);
  kit.world.add(line([new THREE.Vector3(.8,0,-1.4), new THREE.Vector3(.8,0,2.6)], 0xff0000));
  const inputs = Object.fromEntries(['x','y','yaw'].map((key) => [key, container.querySelector(`[data-${key}]`)]));
  function update() {
    const x = Number(inputs.x.value), y = Number(inputs.y.value), yaw = Number(inputs.yaw.value) * DEG;
    const matrix = rpyMatrix(x, y, 0, 0, 0, yaw); bFrame.group.matrix.copy(matrix); bFrame.group.matrixWorldNeedsUpdate = true;
    const omegaW = new THREE.Vector3(0,0,1), vW = new THREE.Vector3(0,-.8,0);
    const rotationT = new THREE.Matrix3().setFromMatrix4(matrix).transpose();
    const omegaB = omegaW.clone().applyMatrix3(rotationT);
    const vB = vW.clone().sub(new THREE.Vector3().crossVectors(new THREE.Vector3(x,y,0), omegaW)).applyMatrix3(rotationT);
    container.querySelector('[data-x-out]').textContent = format(x,2); container.querySelector('[data-y-out]').textContent = format(y,2);
    container.querySelector('[data-yaw-out]').textContent = inputs.yaw.value + '°';
    container.querySelector('[data-xi-b]').textContent = `ᴮξ = [${[omegaB.x,omegaB.y,omegaB.z,vB.x,vB.y,vB.z].map((n)=>format(n,2)).join(', ')}]`;
  }
  Object.values(inputs).forEach((input) => input.addEventListener('input', update)); update(); typeset(container);
}

async function createCustom3RPoeDemo(container) {
  container.className = 'l2-demo custom3r-poe-demo';
  container.innerHTML = `
    <div class="l2-stage"><p class="l2-stage-note">custom_3R URDF/STL · space PoE · black curve: end-effector trace</p></div>
    <div class="l2-panel">
      <div class="l2-card"><strong>Joint coordinates</strong>
        ${[1,2,3].map((i) => `<div class="l2-control"><label>q${i}</label><input data-q="${i-1}" type="range" min="-170" max="170" step="0.1" value="0"><output data-q-out="${i-1}">0.0°</output></div>`).join('')}
        <label class="poe-ghost-control"><input data-home-ghost type="checkbox" checked><span>Keep home configuration as ghost</span><output>50%</output></label>
        <p class="poe-model-status" data-model-status>Loading custom_3R meshes…</p>
      </div>
      <div class="l2-card"><strong>Ordered factors</strong><div class="poe-factor-strip"><div class="poe-factor">\\(e^{\\hat\\xi_1q_1}\\)</div><div class="poe-factor">\\(e^{\\hat\\xi_2q_2}\\)</div><div class="poe-factor">\\(e^{\\hat\\xi_3q_3}\\)</div><div class="poe-factor">\\(M\\)</div></div></div>
      <div class="l2-card"><strong>Tool pose \\(T(q)\\)</strong><table class="l2-matrix"><tbody data-tool-matrix></tbody></table></div>
      <button class="control-button" data-clear-path type="button">Clear path</button>
    </div>`;
  const kit = sceneKit(container.querySelector('.l2-stage'), [7, 5.5, 6]);
  kit.controls.target.set(2.1, .6, .9);
  const omega = [new THREE.Vector3(0,0,1), new THREE.Vector3(0,1,0), new THREE.Vector3(0,0,1)];
  const points = [new THREE.Vector3(0,0,.5), new THREE.Vector3(1,0,1), new THREE.Vector3(3,1.25,1)];
  const homeTool = new THREE.Vector3(4.5,1.25,1.25);
  const q = [0,0,0], targetQ = [0,0,0];
  const frameVisuals = ['F₁','F₂','F₃','F₄'].map((name, index) => {
    const visual = frame(name, index === 3 ? .62 : .52, index === 3);
    kit.world.add(visual.group); return visual;
  });
  const robot = new THREE.Group(), homeGhost = new THREE.Group();
  robot.name = 'custom_3R-current';
  homeGhost.name = 'custom_3R-home-ghost';
  kit.world.add(homeGhost, robot);
  let robotVisuals = [], tracePoints = [], trace = line([], 0x111111, .65);
  kit.world.add(trace);
  function prefixMatrix(count) {
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < count; i += 1) matrix.multiply(expRevolute(omega[i], points[i], q[i]));
    return matrix;
  }
  function applyPrefix(source, count) { return source.clone().applyMatrix4(prefixMatrix(count)); }
  function update(active = -1, recordPath = true) {
    const positions = [points[0].clone(), applyPrefix(points[1],1), applyPrefix(points[2],2), applyPrefix(homeTool,3)];
    robotVisuals.forEach((visual) => {
      visual.group.matrix.multiplyMatrices(prefixMatrix(visual.prefixCount), visual.homeMatrix);
      visual.group.matrixWorldNeedsUpdate = true;
    });
    frameVisuals.forEach((visual, i) => {
      const matrix = prefixMatrix(Math.min(i,3)); matrix.setPosition(positions[i]);
      visual.group.matrix.copy(matrix); visual.group.matrixWorldNeedsUpdate = true;
    });
    const toolMatrix = prefixMatrix(3); toolMatrix.setPosition(positions[3]);
    container.querySelector('[data-tool-matrix]').innerHTML = matrixHtml(toolMatrix);
    if (recordPath) {
      tracePoints.push(positions[3].clone()); if (tracePoints.length > 900) tracePoints.shift();
      kit.world.remove(trace); trace.geometry.dispose(); trace.material.dispose(); trace = line(tracePoints, 0x111111, .7); kit.world.add(trace);
    }
    container.querySelectorAll('.poe-factor').forEach((el,i) => el.classList.toggle('is-active', i === active));
  }
  container.querySelectorAll('[data-q]').forEach((input) => input.addEventListener('input', () => {
    const i = Number(input.dataset.q);
    targetQ[i] = Number(input.value) * DEG;
    container.querySelector(`[data-q-out="${i}"]`).textContent = Number(input.value).toFixed(1) + '°';
    container.querySelectorAll('.poe-factor').forEach((el,index) => el.classList.toggle('is-active', index === i));
  }));
  container.querySelector('[data-home-ghost]').addEventListener('change', (event) => { homeGhost.visible = event.target.checked; });
  container.querySelector('[data-clear-path]').addEventListener('click', () => {
    tracePoints = [];
    kit.world.remove(trace); trace.geometry.dispose(); trace.material.dispose();
    trace = line([], 0x111111, .7); kit.world.add(trace);
  });

  let previousTime = performance.now();
  function smoothMotion(time) {
    const dt = Math.min((time - previousTime) / 1000, .05);
    previousTime = time;
    const blend = 1 - Math.exp(-12 * dt);
    let moving = false, active = -1, largestError = 0;
    q.forEach((value, i) => {
      const error = targetQ[i] - value;
      if (Math.abs(error) > 1e-5) {
        q[i] += error * blend;
        if (Math.abs(targetQ[i] - q[i]) < 1e-5) q[i] = targetQ[i];
        moving = true;
      }
      if (Math.abs(error) > largestError) { largestError = Math.abs(error); active = i; }
    });
    if (moving) update(active);
    requestAnimationFrame(smoothMotion);
  }

  const modelRoot = new URL('../../assets/models/custom_3R/', import.meta.url);
  const homeLinks = [
    new THREE.Matrix4(),
    new THREE.Matrix4().makeTranslation(0,0,.5),
    new THREE.Matrix4().makeTranslation(1,0,1),
    new THREE.Matrix4().makeTranslation(3,1.25,1)
  ];
  const visualOrigins = [
    new THREE.Matrix4(),
    new THREE.Matrix4(),
    rpyMatrix(0,.25,0,0,0,-1.5707),
    new THREE.Matrix4().makeTranslation(0,0,.25)
  ];
  const meshSpecs = [
    { file: 'base_link.stl', prefixCount: 0, color: 0x333638 },
    { file: 'link_1.stl', prefixCount: 1, color: 0x0d7d80 },
    { file: 'link_2.stl', prefixCount: 2, color: 0xb8b8b8 },
    { file: 'link_3.stl', prefixCount: 3, color: 0x0d7d80 }
  ];
  const loaded = await Promise.all(meshSpecs.map(async (spec, index) => {
    const response = await fetch(new URL(spec.file, modelRoot));
    if (!response.ok) throw new Error('Could not load custom_3R mesh ' + spec.file + '.');
    return { spec, index, geometry: parseStlGeometry(await response.arrayBuffer()) };
  }));
  loaded.forEach(({ spec, index, geometry }) => {
    const homeMatrix = homeLinks[index].clone().multiply(visualOrigins[index]);
    const currentGroup = new THREE.Group();
    currentGroup.matrixAutoUpdate = false;
    currentGroup.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: spec.color, roughness: .62, metalness: .06 })));
    robot.add(currentGroup);
    robotVisuals.push({ group: currentGroup, prefixCount: spec.prefixCount, homeMatrix });
    if (index > 0) {
      const ghostGroup = new THREE.Group();
      ghostGroup.matrixAutoUpdate = false;
      ghostGroup.matrix.copy(homeMatrix);
      ghostGroup.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
        color: spec.color, roughness: .7, transparent: true, opacity: .5, depthWrite: false
      })));
      homeGhost.add(ghostGroup);
    }
  });
  container.querySelector('[data-model-status]').textContent = 'Loaded custom_3R · 4 STL visuals';
  update(-1, false);
  typeset(container);
  requestAnimationFrame(smoothMotion);
}

const DEFAULT_URDF = `<robot name="two_frame_lab">
  <link name="world"/>
  <link name="frame_a"/>
  <link name="frame_b"/>

  <joint name="world_to_a" type="fixed">
    <parent link="world"/>
    <child link="frame_a"/>
    <origin xyz="0.60 0.20 0.40" rpy="0 0 0.25"/>
  </joint>

  <joint name="a_to_b" type="fixed">
    <parent link="frame_a"/>
    <child link="frame_b"/>
    <origin xyz="1.20 0.45 0.35" rpy="0 0 0.45"/>
  </joint>
</robot>`;

function createUrdfEditorDemo(container) {
  container.className = 'l2-demo urdf-editor-demo';
  container.innerHTML = `
    <div class="urdf-editor-pane">
      <div class="urdf-editor-toolbar">
        <strong>Editable URDF</strong>
        <label class="control-button urdf-upload-button">Upload URDF<input data-urdf-upload type="file" accept=".urdf,.xml,text/xml,application/xml"></label>
      </div>
      <textarea data-urdf spellcheck="false" aria-label="Editable URDF source"></textarea>
      <p class="urdf-editor-status" data-status>Reading link and joint frames…</p>
    </div>
    <div class="l2-panel">
      <div class="l2-stage"><p class="l2-stage-note">every link gets a frame · drag non-root origins · orbit empty space</p></div>
      <div class="l2-card urdf-frame-controls">
        <div class="l2-control"><label data-selected-label>Frame z</label><input data-frame-z type="range" min="-5" max="5" step=".01" value="0" disabled><output data-frame-z-out>—</output></div>
      </div>
    </div>`;
  const textarea = container.querySelector('[data-urdf]'), status = container.querySelector('[data-status]');
  const zInput = container.querySelector('[data-frame-z]'), zOutput = container.querySelector('[data-frame-z-out]');
  const selectedLabel = container.querySelector('[data-selected-label]');
  textarea.value = DEFAULT_URDF;
  const kit = sceneKit(container.querySelector('.l2-stage'), [4.1,3.4,3.8]);
  kit.controls.target.set(.8,.3,.4);
  const visuals = [], visualByLink = new Map();
  let connectors = [], state = null, selectedLink = null;

  function parse(text) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('XML is not well formed.');
    const robot = doc.documentElement;
    if (robot?.tagName.toLowerCase() !== 'robot') throw new Error('The root element must be <robot>.');
    const linkNames = [...robot.children]
      .filter((item) => item.tagName.toLowerCase() === 'link')
      .map((item) => item.getAttribute('name'));
    if (!linkNames.length || linkNames.some((name) => !name)) throw new Error('Every <link> needs a name.');
    if (new Set(linkNames).size !== linkNames.length) throw new Error('Link names must be unique.');
    const linkSet = new Set(linkNames);
    const incoming = new Map(), children = new Map(linkNames.map((name) => [name, []]));
    const joints = [...robot.children]
      .filter((item) => item.tagName.toLowerCase() === 'joint')
      .map((joint, index) => {
        const name = joint.getAttribute('name') || `joint_${index + 1}`;
        const parent = [...joint.children].find((item) => item.tagName.toLowerCase() === 'parent')?.getAttribute('link');
        const child = [...joint.children].find((item) => item.tagName.toLowerCase() === 'child')?.getAttribute('link');
        if (!linkSet.has(parent) || !linkSet.has(child)) throw new Error(`Joint "${name}" must reference declared parent and child links.`);
        if (parent === child) throw new Error(`Joint "${name}" cannot connect a link to itself.`);
        if (incoming.has(child)) throw new Error(`Link "${child}" has more than one parent joint.`);
        const origin = [...joint.children].find((item) => item.tagName.toLowerCase() === 'origin');
        const result = {
          name, parent, child,
          xyz: numbers(origin?.getAttribute('xyz') || '0 0 0', 3),
          rpy: numbers(origin?.getAttribute('rpy') || '0 0 0', 3)
        };
        incoming.set(child, result);
        children.get(parent).push(result);
        return result;
      });
    const roots = linkNames.filter((name) => !incoming.has(name));
    if (roots.length !== 1) throw new Error(`URDF needs one root link; found ${roots.length}.`);
    const visited = new Set(), transforms = new Map();
    function visit(linkName, transform) {
      if (visited.has(linkName)) throw new Error(`A cycle reaches link "${linkName}".`);
      visited.add(linkName);
      transforms.set(linkName, transform);
      children.get(linkName).forEach((joint) => {
        visit(joint.child, transform.clone().multiply(rpyMatrix(...joint.xyz, ...joint.rpy)));
      });
    }
    visit(roots[0], new THREE.Matrix4());
    if (visited.size !== linkNames.length) throw new Error('Every link must be connected to the root by a joint.');
    return { links: linkNames, joints, root: roots[0], incoming, transforms };
  }

  function disposeObject(object) {
    kit.world.remove(object);
    object.traverse((child) => {
      child.geometry?.dispose?.();
      if (child.material?.map) child.material.map.dispose();
      child.material?.dispose?.();
    });
  }

  function updateVisuals() {
    if (!state) return;
    [...visualByLink.keys()].filter((name) => !state.transforms.has(name)).forEach((name) => {
      const visual = visualByLink.get(name);
      disposeObject(visual.group);
      visualByLink.delete(name);
      visuals.splice(visuals.indexOf(visual), 1);
    });
    state.links.forEach((name) => {
      let visual = visualByLink.get(name);
      if (!visual) {
        visual = frame(name, name === state.root ? .62 : .55, name !== state.root);
        visual.marker.userData.dragFrame = name;
        visualByLink.set(name, visual);
        visuals.push(visual);
        kit.world.add(visual.group);
      }
      visual.marker.userData.dragFrame = name;
      visual.group.matrix.copy(state.transforms.get(name));
      visual.group.matrixWorldNeedsUpdate = true;
    });
    connectors.forEach(disposeObject);
    connectors = state.joints.map((joint) => {
      const parent = new THREE.Vector3().setFromMatrixPosition(state.transforms.get(joint.parent));
      const child = new THREE.Vector3().setFromMatrixPosition(state.transforms.get(joint.child));
      const connector = line([parent, child], 0x333333, .72);
      kit.world.add(connector);
      return connector;
    });
    if (!selectedLink || !state.transforms.has(selectedLink)) {
      selectedLink = state.links.find((name) => name !== state.root) || state.root;
    }
    const selectedPosition = new THREE.Vector3().setFromMatrixPosition(state.transforms.get(selectedLink));
    selectedLabel.textContent = `${selectedLink}.z`;
    zInput.disabled = selectedLink === state.root;
    zInput.value = selectedPosition.z;
    zOutput.textContent = format(selectedPosition.z, 2);
  }

  function readEditor(sourceName = '') {
    try {
      state = parse(textarea.value);
      updateVisuals();
      status.textContent = `${sourceName ? `${sourceName} · ` : ''}Valid URDF · ${state.links.length} link frames · ${state.joints.length} joints`;
      status.classList.remove('is-error');
    } catch (error) {
      status.textContent = error.message;
      status.classList.add('is-error');
    }
  }

  function replaceOrigin(jointName, xyz) {
    const escapedName = jointName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const jointPattern = new RegExp(`(<joint\\b(?=[^>]*\\bname=["']${escapedName}["'])[^>]*>)([\\s\\S]*?)(<\\/joint>)`);
    const match = textarea.value.match(jointPattern);
    if (!match) return;
    const value = xyz.map((number) => format(number, 3)).join(' ');
    let body = match[2];
    if (/<origin\b[^>]*>/i.test(body)) {
      body = body.replace(/<origin\b([^>]*)>/i, (tag, attributes) => {
        const updated = /\bxyz=["'][^"']*["']/i.test(attributes)
          ? attributes.replace(/\bxyz=["'][^"']*["']/i, `xyz="${value}"`)
          : `${attributes} xyz="${value}"`;
        return `<origin${updated}>`;
      });
    } else {
      body = `\n    <origin xyz="${value}" rpy="0 0 0"/>${body}`;
    }
    textarea.value = textarea.value.replace(jointPattern, `$1${body}$3`);
    readEditor();
  }

  let timer = 0;
  textarea.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(readEditor, 180);
  });
  container.querySelector('[data-urdf-upload]').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      textarea.value = await file.text();
      selectedLink = null;
      readEditor(file.name);
    } catch (error) {
      status.textContent = `Could not read ${file.name}: ${error.message}`;
      status.classList.add('is-error');
    }
    event.target.value = '';
  });
  zInput.addEventListener('input', () => {
    if (!state || !selectedLink || selectedLink === state.root) return;
    const joint = state.incoming.get(selectedLink);
    const desired = new THREE.Vector3().setFromMatrixPosition(state.transforms.get(selectedLink));
    desired.z = Number(zInput.value);
    joint.xyz = desired.applyMatrix4(state.transforms.get(joint.parent).clone().invert()).toArray();
    replaceOrigin(joint.name, joint.xyz);
  });
  enableFrameDrag(kit, visuals, (id, worldPosition) => {
    if (!state || id === state.root) return;
    selectedLink = id;
    const joint = state.incoming.get(id);
    const local = worldPosition.clone().applyMatrix4(state.transforms.get(joint.parent).clone().invert());
    joint.xyz[0] = local.x;
    joint.xyz[1] = local.y;
    replaceOrigin(joint.name, joint.xyz);
  });
  readEditor();
}

function enableFrameDrag(kit, visuals, onMove) {
  const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0,1,0), 0);
  let active = null;
  const canvas = kit.renderer.domElement;
  function rayFromEvent(event) {
    const rect = canvas.getBoundingClientRect();
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(pointer, kit.camera);
  }
  canvas.addEventListener('pointerdown', (event) => {
    rayFromEvent(event); kit.world.updateMatrixWorld(true);
    const hits = raycaster.intersectObjects(visuals.map((v) => v.marker), false); if (!hits.length) return;
    active = hits[0].object.userData.dragFrame;
    const visual = visuals.find((v) => v.marker.userData.dragFrame === active);
    const renderedPosition = visual.marker.getWorldPosition(new THREE.Vector3());
    plane.constant = -renderedPosition.y;
    kit.controls.enabled = false; canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!active) return; rayFromEvent(event);
    const hit = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(plane, hit)) onMove(active, kit.world.worldToLocal(hit.clone()));
  });
  function stop(event) {
    if (!active) return; active = null; kit.controls.enabled = true;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  }
  canvas.addEventListener('pointerup', stop); canvas.addEventListener('pointercancel', stop);
}

function numbers(value, length) {
  const result = String(value || '').trim().split(/\s+/).map(Number);
  if (result.length !== length || result.some((n) => !Number.isFinite(n))) throw new Error(`Expected ${length} numeric values.`);
  return result;
}
function typeset(container) {
  window.MathJax?.typesetPromise?.([container]).catch((error) => console.warn('MathJax typeset failed:', error));
}
function escapeHtml(value) {
  return String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
}
