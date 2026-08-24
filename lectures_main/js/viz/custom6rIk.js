import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createZUpWorld, resizeRendererToContainer } from './threeUtils.js';
import { parseStlGeometry } from './frameDHPlayground.js?v=20260814-3';

const DEG = Math.PI / 180;
const MODEL_ROOT = new URL('../../assets/models/custom_6R/', import.meta.url);
const REVISION = new URL(import.meta.url).searchParams.get('v') || 'dev';
const assetUrl = (name) => {
  const url = new URL(name, MODEL_ROOT);
  url.searchParams.set('v', REVISION);
  return url;
};

const EXAMPLE_Q_DEG = [-60, 20, 120, 35, -50, 70];
const ARM_SOLUTIONS_DEG = [
  [17.10762236, 6.31833973, -73.72931062],
  [-151.32923399, -164.62755468, 14.63227552],
  [-107.81342593, -149.15404131, 87.01714848],
  [-60, 20, 120]
];
const IK_SOLUTIONS_DEG = [
  [17.10762236, 6.31833973, -73.72931062, -23.20677276, 82.92482591, 118.50309034],
  [17.10762236, 6.31833973, -73.72931062, 156.79322724, -82.92482591, -61.49690966],
  [-151.32923399, -164.62755468, 14.63227552, -78.52169472, -45.78393296, 9.39055873],
  [-151.32923399, -164.62755468, 14.63227552, 101.47830528, 45.78393296, -170.60944127],
  [-107.81342593, -149.15404131, 87.01714848, -72.06284197, -50.13709052, -32.92754147],
  [-107.81342593, -149.15404131, 87.01714848, 107.93715803, 50.13709052, 147.07245853],
  [-60, 20, 120, -145, 50, -110],
  [-60, 20, 120, 35, -50, 70]
];

let modelPromise;
let model;
let geometriesPromise;

export function initCustom6RIkDemos() {
  const hosts = [...document.querySelectorAll('[data-custom6r-ik]')];
  if (!hosts.length) return;
  const instances = new WeakMap();
  const ensure = (host) => {
    if (instances.has(host)) return;
    instances.set(host, createDemo(host));
  };
  const observer = new IntersectionObserver((entries) => entries.forEach((entry) => {
    if (entry.isIntersecting) ensure(entry.target);
  }), { threshold: .03, rootMargin: '100px' });
  hosts.forEach((host) => observer.observe(host));
  const syncHash = () => {
    const match = location.hash.match(/#slide-(\d+)/);
    const index = match ? Number(match[1]) - 1 : 0;
    document.querySelectorAll('#deck > .slide')[index]?.querySelectorAll('[data-custom6r-ik]').forEach(ensure);
  };
  syncHash();
  window.addEventListener('hashchange', syncHash);
}

async function loadModel() {
  if (!modelPromise) modelPromise = loadUrdfModel();
  return modelPromise;
}

async function loadUrdfModel() {
  const response = await fetch(assetUrl('custom_6R_new.urdf'));
  if (!response.ok) throw new Error('Could not load custom_6R_new.urdf.');
  const xml = new DOMParser().parseFromString(await response.text(), 'application/xml');
  const child = (node, tag) => [...node.children].find((item) => item.tagName.toLowerCase() === tag);
  const vector = (node, attribute, fallback = [0, 0, 0]) =>
    (node?.getAttribute(attribute)?.trim().split(/\s+/).map(Number) || fallback);
  const origin = (node) => {
    const element = child(node, 'origin');
    return rpyMatrix(...vector(element, 'xyz'), ...vector(element, 'rpy'));
  };
  const getJoint = (name) => {
    const element = [...xml.querySelectorAll('joint')].find((item) => item.getAttribute('name') === name);
    if (!element) throw new Error(`Missing ${name}.`);
    return {
      origin: origin(element),
      axis: new THREE.Vector3(...vector(child(element, 'axis'), 'xyz', [0, 0, 1])).normalize(),
      child: child(element, 'child')?.getAttribute('link')
    };
  };
  const visual = (linkName) => {
    const link = [...xml.querySelectorAll('link')].find((item) => item.getAttribute('name') === linkName);
    const element = link && child(link, 'visual');
    const mesh = element?.querySelector('geometry > mesh');
    if (!mesh) throw new Error(`Missing mesh for ${linkName}.`);
    return { origin: origin(element), file: mesh.getAttribute('filename').split('/').at(-1) };
  };
  const joints = Array.from({ length: 6 }, (_, index) => getJoint(`joint_${index + 1}`));
  const homeLinks = [new THREE.Matrix4()];
  joints.forEach((joint, index) => homeLinks.push(homeLinks[index].clone().multiply(joint.origin)));
  const axisPoints = joints.map((_, index) => new THREE.Vector3().setFromMatrixPosition(homeLinks[index + 1]));
  const axes = joints.map((joint, index) => joint.axis.clone().transformDirection(homeLinks[index + 1]));
  const linkNames = ['base_link', ...joints.map((joint) => joint.child)];
  const visuals = linkNames.map(visual);
  const colors = [0x333638, 0x0d7d80, 0xb8b8b8, 0x0d7d80, 0x55595d, 0x0d7d80, 0xf07f24];
  model = {
    joints, homeLinks, axisPoints, axes, visuals,
    meshSpecs: visuals.map((item, index) => ({ ...item, prefix: index, color: colors[index] })),
    wristHome: axisPoints[4].clone(),
    eeHome: axisPoints[5].clone(),
    toolLength: axisPoints[5].distanceTo(axisPoints[4])
  };
  verifyExample();
  return model;
}

function verifyExample() {
  const q = EXAMPLE_Q_DEG.map((angle) => angle * DEG);
  const target = endEffectorTransform(q);
  IK_SOLUTIONS_DEG.forEach((solution, index) => {
    const residual = matrixMaxError(endEffectorTransform(solution.map((angle) => angle * DEG)), target);
    if (residual > 2e-7) throw new Error(`6R IK branch ${index + 1} is inconsistent.`);
  });
}

function createDemo(container) {
  container.classList.add('ik6r-demo');
  container.innerHTML = '<div class="ik6r-canvas"></div><p class="ik6r-note"></p><div class="ik6r-controls"></div>';
  const stage = container.querySelector('.ik6r-canvas');
  const note = container.querySelector('.ik6r-note');
  const controlsHost = container.querySelector('.ik6r-controls');
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xfcfcfc);
  const camera = new THREE.PerspectiveCamera(38, 1, .01, 100);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.7));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  stage.appendChild(renderer.domElement);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x777777, 2.5));
  const light = new THREE.DirectionalLight(0xffffff, 2.6);
  light.position.set(5, 8, 9);
  scene.add(light);
  const world = createZUpWorld(scene);
  world.userData.labelSprites = [];
  world.userData.labelsVisible = true;
  const grid = new THREE.GridHelper(12, 24, 0xcccccc, 0xe8e8e8);
  grid.rotation.x = Math.PI / 2;
  world.add(grid);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(3.2, .8, 1.2);
  camera.position.set(10, 8, 7.5);
  controls.update();
  const kit = {
    container, stage, note, controlsHost, scene, world, camera, renderer, controls,
    setCamera(position, target = [3.2, .8, 1.2]) {
      camera.position.fromArray(position);
      controls.target.fromArray(target);
      controls.update();
    }
  };
  addToggle(kit, 'labels', true, (visible) => {
    world.userData.labelsVisible = visible;
    world.userData.labelSprites.forEach((sprite) => { sprite.visible = visible; });
  });
  let update = () => {};
  Promise.resolve(buildMode(kit, container.dataset.mode)).then((callback) => {
    if (typeof callback === 'function') update = callback;
  }).catch((error) => {
    note.textContent = error.message;
    note.classList.add('is-error');
    console.error(error);
  });
  const resize = () => resizeRendererToContainer(renderer, camera, stage);
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(stage);
  resize();
  let last = performance.now();
  const animate = (time) => {
    const dt = Math.min(.05, (time - last) / 1000);
    last = time;
    update(time / 1000, dt);
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  };
  requestAnimationFrame(animate);
  return { dispose() { resizeObserver.disconnect(); controls.dispose(); renderer.dispose(); } };
}

async function buildMode(kit, mode) {
  switch (mode) {
    case 'playground': return buildPlayground(kit);
    case 'dh': return buildDhGeometry(kit);
    case 'fk': return buildFkExample(kit);
    case 'wrist-center': return buildWristCenter(kit);
    case 'arm-branches': return buildArmBranches(kit);
    case 'wrist-branches': return buildWristBranches(kit);
    case 'all-branches': return buildAllBranches(kit);
    case 'partition': return buildPartition(kit);
    default: return buildPlayground(kit);
  }
}

async function buildPlayground(kit) {
  await loadModel();
  kit.setCamera([11, 8.5, 7.4], [3.2, .7, 1.25]);
  const robot = await createRobot(kit.world, [0, 0, 0, 0, 0, 0]);
  const q = [0, 0, 0, 0, 0, 0];
  const wrist = marker(kit.world, model.wristHome, .13, 0xff0000, 'wrist center');
  q.forEach((_, index) => addSlider(kit, `θ${index + 1}`, -180, 180, 1, 0, (value) => { q[index] = value * DEG; }));
  kit.note.textContent = 'Drag all six joints. The red wrist center moves only with θ₁–θ₃; θ₄–θ₆ change orientation about that point.';
  return () => {
    robot.update(q);
    wrist.position.copy(wristPosition(q));
  };
}

async function buildDhGeometry(kit) {
  await loadModel();
  kit.setCamera([11.5, 8, 8.5], [3.3, .8, 1.25]);
  const robot = await createRobot(kit.world, [0, 0, 0, 0, 0, 0], { opacity: .72 });
  const colors = [0xe74c3c, 0x35a853, 0x2775ff, 0x9b5de5, 0xe85d04, 0x111111];
  model.axes.forEach((axis, index) => {
    kit.world.add(axisLine(model.axisPoints[index], axis, index < 3 ? 3.8 : 4.8, colors[index]));
    addLabel(kit.world, model.axisPoints[index].clone().addScaledVector(axis, 1.7), `z${index} · joint ${index + 1}`, colors[index]);
  });
  marker(kit.world, model.wristHome, .15, 0xff0000, 'O_w');
  kit.note.textContent = 'The last three infinite axis lines meet at O_w even though their URDF joint origins are placed at different points on those lines.';
  return () => robot.update([0, 0, 0, 0, 0, 0]);
}

async function buildFkExample(kit) {
  await loadModel();
  kit.setCamera([10.5, 8.2, 8], [2.7, .4, 1.1]);
  const robot = await createRobot(kit.world, [0, 0, 0, 0, 0, 0]);
  const targetQ = EXAMPLE_Q_DEG.map((angle) => angle * DEG);
  const target = endEffectorTransform(targetQ);
  addFrame(kit.world, target, .62, 'T_d');
  marker(kit.world, new THREE.Vector3().setFromMatrixPosition(target), .12, 0xff0000, 'p_d');
  const q = [0, 0, 0, 0, 0, 0];
  kit.note.textContent = 'The robot moves from the URDF home pose to q_d = (−60°,20°,120°,35°,−50°,70°).';
  return (time, dt) => {
    const phase = smoothStep(Math.min(1, (time % 8) / 3.2));
    q.forEach((_, index) => { q[index] += (targetQ[index] * phase - q[index]) * Math.min(1, 6 * dt); });
    robot.update(q);
  };
}

async function buildWristCenter(kit) {
  await loadModel();
  kit.setCamera([10.2, 7.5, 7.4], [3.3, .45, 1.15]);
  const q = EXAMPLE_Q_DEG.map((angle) => angle * DEG);
  const robot = await createRobot(kit.world, q, { opacity: .82 });
  const target = endEffectorTransform(q);
  const p = new THREE.Vector3().setFromMatrixPosition(target);
  const wrist = wristFromPose(target);
  addFrame(kit.world, target, .58, 'F₆');
  marker(kit.world, p, .12, 0xff0000, 'p_d');
  marker(kit.world, wrist, .15, 0x2775ff, 'p_w');
  kit.world.add(tube(wrist, p, .028, 0x2775ff, .85));
  addLabel(kit.world, wrist.clone().lerp(p, .5).add(new THREE.Vector3(0, 0, .22)), 'd₆ R_d eₓ', 0x2775ff);
  kit.note.textContent = 'Subtract the final 1.5 m link along the desired tool x-axis: p_w = p_d − d₆R_d eₓ.';
  return () => robot.update(q);
}

async function buildArmBranches(kit) {
  await loadModel();
  kit.setCamera([10, 8.2, 8.3], [2.5, .2, 1.15]);
  const colors = [0x2775ff, 0x00a676, 0x9b5de5, 0xf2b134];
  const robots = await Promise.all(ARM_SOLUTIONS_DEG.map((arm, index) => createRobot(
    kit.world, [...arm, 0, 0, 0].map((angle) => angle * DEG),
    { opacity: index === 0 ? .92 : .1, color: colors[index] }
  )));
  const target = endEffectorTransform(EXAMPLE_Q_DEG.map((angle) => angle * DEG));
  const wrist = wristFromPose(target);
  marker(kit.world, wrist, .16, 0xff0000, 'same p_w');
  const frames = ARM_SOLUTIONS_DEG.map((arm, index) => {
    const q = arm.map((angle) => angle * DEG);
    const frame = prefixMatrix(q, 3);
    frame.setPosition(wrist);
    const object = addFrame(kit.world, frame, .42, null, colors[index]);
    object.visible = index === 0;
    return object;
  });
  let selected = 0;
  addSelect(kit, 'arm IK', ARM_SOLUTIONS_DEG.map((arm, index) => [index,
    `A${index + 1} · (${arm.map((angle) => `${angle.toFixed(1)}°`).join(', ')})`
  ]), (value) => {
    selected = Number(value);
    robots.forEach((robot, index) => robot.setOpacity(index === selected ? .92 : .1));
    frames.forEach((frame, index) => { frame.visible = index === selected; });
    const arm = ARM_SOLUTIONS_DEG[selected];
    kit.note.textContent = `A${selected + 1}: q₁–q₃ = (${arm.map((angle) => `${angle.toFixed(2)}°`).join(', ')}). The wrist point is unchanged; the displayed F₃ orientation determines the wrist solve.`;
  });
  kit.note.textContent = 'Select an arm IK. The chosen robot and its F₃ triad are emphasized while the other three solutions remain as context.';
  return () => robots.forEach((robot, index) => robot.update([...ARM_SOLUTIONS_DEG[index], 0, 0, 0].map((angle) => angle * DEG)));
}

async function buildWristBranches(kit) {
  await loadModel();
  kit.setCamera([9.7, 7.4, 7.4], [3.1, .5, 1.2]);
  const robot = await createRobot(kit.world, IK_SOLUTIONS_DEG[0].map((angle) => angle * DEG));
  const target = endEffectorTransform(EXAMPLE_Q_DEG.map((angle) => angle * DEG));
  addFrame(kit.world, target, .62, 'T_d');
  marker(kit.world, wristFromPose(target), .14, 0xff0000, 'O_w');
  let selected = 6;
  const displayOrder = [6, 7, 0, 1, 2, 3, 4, 5];
  addSelect(kit, 'solution', displayOrder.map((index) => [index, `IK ${index + 1} · arm ${Math.floor(index / 2) + 1} · flip ${(index % 2) + 1}`]), (value) => { selected = Number(value); });
  kit.note.textContent = 'Choose any arm branch and either wrist flip. Both flips preserve the complete desired pose.';
  return () => robot.update(IK_SOLUTIONS_DEG[selected].map((angle) => angle * DEG));
}

async function buildAllBranches(kit) {
  await loadModel();
  kit.setCamera([10.5, 8.2, 8.2], [2.7, .45, 1.2]);
  const robot = await createRobot(kit.world, IK_SOLUTIONS_DEG[0].map((angle) => angle * DEG));
  const target = endEffectorTransform(EXAMPLE_Q_DEG.map((angle) => angle * DEG));
  addFrame(kit.world, target, .6, 'same T_d');
  let selected = 0;
  addSlider(kit, 'IK', 1, 8, 1, 1, (value) => { selected = Math.round(value) - 1; });
  kit.note.textContent = 'Drag the IK selector through all eight exact solutions. Every configuration reproduces the same position and orientation.';
  return () => robot.update(IK_SOLUTIONS_DEG[selected].map((angle) => angle * DEG));
}

async function buildPartition(kit) {
  await loadModel();
  kit.setCamera([10.4, 7.8, 7.8], [3.2, .6, 1.2]);
  const q = EXAMPLE_Q_DEG.map((angle) => angle * DEG);
  const robot = await createRobot(kit.world, q);
  const wrist = wristPosition(q);
  marker(kit.world, wrist, .16, 0xff0000, 'partition point O_w');
  const armAxes = new THREE.Group(), wristAxes = new THREE.Group();
  kit.world.add(armAxes, wristAxes);
  addCurrentAxes(armAxes, q, 0, 3, 0x2775ff);
  addCurrentAxes(wristAxes, q, 3, 6, 0xe85d04);
  kit.note.textContent = 'Blue joints 1–3 solve p_w. Orange joints 4–6 solve R₃⁶. The common wrist point is what makes the two problems independent.';
  return () => robot.update(q);
}

async function createRobot(world, q, options = {}) {
  await loadModel();
  const geometries = await loadGeometries();
  const group = new THREE.Group();
  world.add(group);
  const visuals = model.meshSpecs.map((spec, index) => {
    const holder = new THREE.Group();
    holder.matrixAutoUpdate = false;
    const color = options.color ?? spec.color;
    const opacity = options.opacity ?? 1;
    const material = new THREE.MeshStandardMaterial({
      color, roughness: .62, metalness: .05, transparent: opacity < 1,
      opacity, depthWrite: opacity > .8
    });
    holder.add(new THREE.Mesh(geometries[index].clone(), material));
    group.add(holder);
    return { holder, material, prefix: spec.prefix, home: model.homeLinks[spec.prefix].clone().multiply(spec.origin) };
  });
  const update = (values) => visuals.forEach((item) => {
    item.holder.matrix.multiplyMatrices(prefixMatrix(values, item.prefix), item.home);
    item.holder.matrixWorldNeedsUpdate = true;
  });
  update(q);
  const setOpacity = (opacity) => visuals.forEach(({ material }) => {
    material.transparent = opacity < 1;
    material.opacity = opacity;
    material.depthWrite = opacity > .8;
    material.needsUpdate = true;
  });
  return { group, update, setOpacity };
}

function loadGeometries() {
  if (!geometriesPromise) geometriesPromise = loadModel().then(() => Promise.all(model.meshSpecs.map(async (spec) => {
    const response = await fetch(assetUrl(spec.file));
    if (!response.ok) throw new Error(`Could not load ${spec.file}.`);
    return parseStlGeometry(await response.arrayBuffer());
  })));
  return geometriesPromise;
}

function prefixMatrix(q, count) {
  const matrix = new THREE.Matrix4();
  for (let index = 0; index < count; index += 1) matrix.multiply(
    revolute(model.axes[index], model.axisPoints[index], q[index] || 0)
  );
  return matrix;
}

function endEffectorTransform(q) {
  return prefixMatrix(q, 6).multiply(model.homeLinks[6].clone());
}

function wristPosition(q) {
  return model.wristHome.clone().applyMatrix4(prefixMatrix(q, 3));
}

function wristFromPose(transform) {
  const position = new THREE.Vector3().setFromMatrixPosition(transform);
  const xAxis = new THREE.Vector3(1, 0, 0).transformDirection(transform);
  return position.addScaledVector(xAxis, -model.toolLength);
}

function revolute(axis, point, angle) {
  const matrix = new THREE.Matrix4().makeRotationAxis(axis, angle);
  const rotated = point.clone().applyMatrix4(matrix);
  matrix.setPosition(point.clone().sub(rotated));
  return matrix;
}

function addCurrentAxes(group, q, start, end, color) {
  for (let index = start; index < end; index += 1) {
    const transform = prefixMatrix(q, index);
    const point = model.axisPoints[index].clone().applyMatrix4(transform);
    const axis = model.axes[index].clone().transformDirection(transform);
    group.add(axisLine(point, axis, index < 3 ? 3.2 : 4.2, color));
  }
}

function addFrame(world, matrix, scale, label, color) {
  const group = new THREE.Group();
  world.add(group);
  const origin = new THREE.Vector3().setFromMatrixPosition(matrix);
  const axes = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
  const colors = color ? [color, color, color] : [0xe74c3c, 0x35a853, 0x2775ff];
  axes.forEach((axis, index) => addArrow(group, origin, axis.transformDirection(matrix).multiplyScalar(scale), colors[index]));
  if (label) addLabel(group, origin.clone().add(new THREE.Vector3(.08, .08, .35)), label, color || 0x111111);
  return group;
}

function marker(world, position, radius, color, text) {
  const object = new THREE.Mesh(new THREE.SphereGeometry(radius, 24, 16), new THREE.MeshStandardMaterial({ color }));
  object.position.copy(position);
  world.add(object);
  if (text) addLabel(object, new THREE.Vector3(.1, .1, .28), text, color);
  return object;
}

function axisLine(point, axis, length, color) {
  return tube(point.clone().addScaledVector(axis, -length / 2), point.clone().addScaledVector(axis, length / 2), .022, color, .78);
}

function addArrow(world, start, vector, color) {
  const end = start.clone().add(vector);
  world.add(tube(start, end, .026, color));
  const cone = new THREE.Mesh(new THREE.ConeGeometry(.075, .2, 18), new THREE.MeshStandardMaterial({ color }));
  cone.position.copy(end);
  cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vector.clone().normalize());
  world.add(cone);
}

function tube(start, end, radius, color, opacity = 1) {
  const direction = end.clone().sub(start);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, direction.length(), 14), new THREE.MeshStandardMaterial({
    color, transparent: opacity < 1, opacity
  }));
  mesh.position.copy(start).add(end).multiplyScalar(.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  return mesh;
}

function addLabel(parent, position, text, color = 0x111111) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  context.font = '700 27px Arial';
  canvas.width = Math.max(120, Math.ceil(context.measureText(text).width + 26));
  canvas.height = 52;
  context.fillStyle = 'rgba(255,255,255,.92)';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
  context.font = '700 27px Arial';
  context.textBaseline = 'middle';
  context.fillText(text, 13, 26);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false }));
  sprite.position.copy(position);
  sprite.scale.set(canvas.width / 110, canvas.height / 110, 1);
  sprite.renderOrder = 20;
  parent.add(sprite);
  let registry = parent;
  while (registry && !registry.userData?.labelSprites) registry = registry.parent;
  if (registry) {
    sprite.visible = registry.userData.labelsVisible !== false;
    registry.userData.labelSprites.push(sprite);
  }
  return sprite;
}

function addSlider(kit, text, min, max, step, initial, onInput) {
  const label = document.createElement('label');
  label.className = 'ik6r-slider';
  const caption = document.createElement('span');
  caption.textContent = text;
  const input = document.createElement('input');
  input.type = 'range';
  input.min = min;
  input.max = max;
  input.step = step;
  input.value = initial;
  const output = document.createElement('output');
  const update = () => {
    output.value = `${Number(input.value).toFixed(step < 1 ? 1 : 0)}°`;
    onInput(Number(input.value));
  };
  input.addEventListener('input', update);
  update();
  label.append(caption, input, output);
  kit.controlsHost.append(label);
}

function addSelect(kit, text, entries, onChange) {
  const label = document.createElement('label');
  label.className = 'ik6r-select';
  const caption = document.createElement('span');
  caption.textContent = text;
  const select = document.createElement('select');
  entries.forEach(([value, name]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = name;
    select.appendChild(option);
  });
  select.addEventListener('change', () => onChange(select.value));
  label.append(caption, select);
  kit.controlsHost.append(label);
}

function addToggle(kit, text, initial, onChange) {
  const label = document.createElement('label');
  label.className = 'ik6r-toggle';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = initial;
  const caption = document.createElement('span');
  caption.textContent = text;
  input.addEventListener('change', () => onChange(input.checked));
  label.append(input, caption);
  kit.controlsHost.append(label);
}

function smoothStep(value) {
  const u = Math.max(0, Math.min(1, value));
  return u * u * (3 - 2 * u);
}

function matrixMaxError(a, b) {
  return Math.max(...a.elements.map((value, index) => Math.abs(value - b.elements[index])));
}

function rpyMatrix(x, y, z, roll, pitch, yaw) {
  const matrix = new THREE.Matrix4().makeTranslation(x, y, z);
  return matrix.multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(roll, pitch, yaw, 'XYZ')));
}
