import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createZUpWorld, resizeRendererToContainer } from './threeUtils.js';
import { parseStlGeometry } from './frameDHPlayground.js?v=20260814-3';

const DEG = Math.PI / 180;
const REVISION = new URL(import.meta.url).searchParams.get('v') || 'dev';

const PUMA_QD_DEG = [30, -35, 45, 40, -50, 60];
const PUMA_IK_DEG = [
  [30, -35, 45, -140, 50, -120],
  [30, -35, 45, 40, -50, 60],
  [30, -77.350538, 129.616727, -90.226068, 29.498956, 178.600513],
  [30, -77.350538, 129.616727, 89.773932, -29.498956, -1.399487],
  [170.431029, -139.616727, 129.616727, -4.60855, 47.946938, -111.486592],
  [170.431029, -139.616727, 129.616727, 175.39145, -47.946938, 68.513408],
  [170.431029, -97.266189, 45, -31.538752, 6.549211, -83.205391],
  [170.431029, -97.266189, 45, 148.461249, -6.549211, 96.794609]
];

// One continuous, joint-limit-feasible branch for a fixed iiwa target pose.
// Each row was verified by FK; q3 is sampled every 5 degrees.
const IIWA_FAMILY_DEG = [
  [34.45639,-82.8271,-180,50,79.95518,21.6045,150.89774],[36.95044,-82.71906,-175,50,75.87417,24.02636,149.56061],
  [39.43019,-82.39529,-170,50,72.00983,26.40988,147.95057],[41.88119,-81.85696,-165,50,68.29093,28.74925,146.12676],
  [44.28874,-81.10612,-160,50,64.66767,31.03871,144.12776],[46.63779,-80.14596,-155,50,61.10413,33.27202,141.97951],
  [48.91278,-78.98109,-150,50,57.57397,35.44217,139.70026],[51.09767,-77.61789,-145,50,54.058,37.54113,137.3036],
  [53.17586,-76.06489,-140,50,50.54272,39.55981,134.80062],[55.13028,-74.33318,-135,50,47.01948,41.48811,132.20145],
  [56.94348,-72.43679,-130,50,43.4841,43.31514,129.51634],[58.59787,-70.39294,-125,50,39.93657,45.02956,126.75654],
  [60.076,-68.22216,-120,50,36.38086,46.62011,123.93485],[61.36103,-65.94821,-115,50,32.82462,48.07624,121.06588],
  [62.43718,-63.59771,-110,50,29.27882,49.38885,118.16612],[63.29037,-61.19946,-105,50,25.75708,50.55096,115.25357],
  [63.90882,-58.78356,-100,50,22.27487,51.55833,112.34724],[64.28361,-56.38023,-95,50,18.84848,52.40991,109.46633],
  [64.40917,-54.01863,-90,50,15.49395,53.10795,106.62929],[64.28361,-51.72563,-85,50,12.22598,53.65789,103.85292],
  [63.90882,-49.52488,-80,50,9.05702,54.06788,101.15159],[63.29037,-47.43605,-75,50,5.99659,54.34819,98.53659],
  [62.43718,-45.47452,-70,50,3.05093,54.51044,96.0159],[61.36103,-43.65135,-65,50,.22292,54.56682,93.59412],
  [60.076,-41.97362,-60,50,-2.48772,54.52944,91.27272],[58.59787,-40.44492,-55,50,-5.08402,54.40975,89.05042],
  [56.94348,-39.06598,-50,50,-7.5713,54.21817,86.92367],[55.13028,-37.83537,-45,50,-9.95668,53.96385,84.88715],
  [53.17586,-36.75017,-40,50,-12.24852,53.65454,82.93429],[51.09767,-35.80649,-35,50,-14.45608,53.29656,81.05766],
  [48.91278,-35,-30,50,-16.58912,52.89489,79.2493],[46.63779,-34.32634,-25,50,-18.65768,52.45322,77.50103],
  [44.28874,-33.78141,-20,50,-20.67187,51.97408,75.80459],[41.88119,-33.36158,-15,50,-22.64177,51.4589,74.15183],
  [39.43019,-33.0639,-10,50,-24.57737,50.90814,72.53473],[36.95044,-32.88619,-5,50,-26.48853,50.32136,70.94552],
  [34.45639,-32.8271,0,50,-28.38503,49.69728,69.37662],[31.96234,-32.88619,5,50,-30.27657,49.03381,67.82074],
  [29.48259,-33.0639,10,50,-32.17281,48.3281,66.27083],[27.03159,-33.36158,15,50,-34.08344,47.57656,64.7201],
  [24.62404,-33.78141,20,50,-36.01824,46.77485,63.16208],[22.27499,-34.32634,25,50,-37.98708,45.91792,61.59061],
  [20,-35,30,50,-40,45,60],[17.81511,-35.80649,35,50,-42.06721,44.01467,58.38508],
  [15.73692,-36.75017,40,50,-44.19909,42.95489,56.74142],[13.7825,-37.83537,45,50,-46.40618,41.81311,55.06558],
  [11.9693,-39.06598,50,50,-48.69916,40.58149,53.35545],[10.31491,-40.44492,55,50,-51.08881,39.25208,51.61064],
  [8.83678,-41.97362,60,50,-53.58603,37.81716,49.83304],[7.55175,-43.65135,65,50,-56.20192,36.2697,48.02751],
  [6.4756,-45.47452,70,50,-58.94805,34.60386,46.20263],[5.62241,-47.43605,75,50,-61.83693,32.81551,44.37177],
  [5.00396,-49.52488,80,50,-64.88301,30.9029,42.55432],[4.62917,-51.72563,85,50,-68.10438,28.86715,40.7775],
  [4.50361,-54.01863,90,50,-71.52561,26.71272,39.07892],[4.62917,-56.38023,95,50,-75.18249,24.44772,37.5107],
  [5.00396,-58.78356,100,50,-79.13,22.08416,36.14659],[5.62241,-61.19946,105,50,-83.45624,19.63805,35.09474],
  [6.4756,-63.59771,110,50,-88.30824,17.12993,34.52226],[7.55175,-65.94821,115,50,-93.94298,14.58633,34.70514],
  [8.83678,-68.22216,120,50,-100.83687,12.04394,36.13671],[10.31491,-70.39294,125,50,-109.9398,9.56125,39.78092],
  [11.9693,-72.43679,130,50,-123.28207,7.25265,47.67883],[13.7825,-74.33318,135,50,-145.03307,5.38867,64.00705],
  [15.73692,-76.06489,140,50,-178.79201,4.56799,92.36861],[17.81511,-77.61789,145,50,-213.0171,5.28971,121.22224],
  [20,-78.98109,150,50,-235.31974,7.07674,138.1769],[22.27499,-80.14596,155,50,-248.92985,9.31225,146.45753],
  [24.62404,-81.10612,160,50,-258.14388,11.71943,150.35343],[27.03159,-81.85696,165,50,-265.08373,14.18954,151.97756],
  [29.48259,-82.39529,170,50,-270.74728,16.67475,152.31746],[31.96234,-82.71906,175,50,-275.64098,19.15099,151.86821],
  [34.45639,-82.8271,180,50,-280.04482,21.6045,150.89774]
];

const CONFIGS = {
  puma: {
    root: new URL('../../assets/models/puma/', import.meta.url), urdf: 'puma560_robot.urdf',
    joints: Array.from({ length: 6 }, (_, index) => `j${index + 1}`), base: 'link1', toolOffset: [0, 0, 0],
    colors: [0x303436, 0x177f75, 0xc8c8c8, 0x177f75, 0x55595d, 0x177f75, 0xf07f24]
  },
  iiwa: {
    root: new URL('../../assets/models/iiwa7/', import.meta.url), urdf: 'iiwa7_free_joints.urdf',
    joints: Array.from({ length: 7 }, (_, index) => `iiwa_joint_${index + 1}`), base: 'iiwa_link_0', toolOffset: [0, 0, .045],
    colors: [0x292b2e, 0xf07122, 0x37393c, 0xf07122, 0x37393c, 0xf07122, 0x37393c, 0xf07122]
  }
};

const modelPromises = new Map();
const geometryPromises = new Map();

export function initPumaIiwaIkDemos() {
  const hosts = [...document.querySelectorAll('[data-serial-ik]')];
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
    document.querySelectorAll('#deck > .slide')[index]?.querySelectorAll('[data-serial-ik]').forEach(ensure);
  };
  syncHash();
  window.addEventListener('hashchange', syncHash);
}

function createDemo(container) {
  container.classList.add('ik6r-demo');
  container.innerHTML = '<div class="ik6r-canvas"></div><p class="ik6r-note"></p><div class="ik6r-controls"></div>';
  const stage = container.querySelector('.ik6r-canvas');
  const note = container.querySelector('.ik6r-note');
  const controlsHost = container.querySelector('.ik6r-controls');
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xfcfcfc);
  const camera = new THREE.PerspectiveCamera(38, 1, .005, 100);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.7));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  stage.appendChild(renderer.domElement);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x777777, 2.5));
  const light = new THREE.DirectionalLight(0xffffff, 2.5);
  light.position.set(4, 6, 8);
  scene.add(light);
  const world = createZUpWorld(scene);
  world.userData.labelSprites = [];
  world.userData.labelsVisible = true;
  const grid = new THREE.GridHelper(2.8, 28, 0xcccccc, 0xe8e8e8);
  grid.rotation.x = Math.PI / 2;
  world.add(grid);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  const kit = { container, stage, note, controlsHost, scene, world, camera, renderer, controls,
    setCamera(position, target) { camera.position.fromArray(position); controls.target.fromArray(target); controls.update(); }
  };
  addToggle(kit, 'labels', true, (visible) => {
    world.userData.labelsVisible = visible;
    world.userData.labelSprites.forEach((sprite) => { sprite.visible = visible; });
  });
  let update = () => {};
  Promise.resolve(buildMode(kit, container.dataset.serialIk)).then((callback) => {
    if (callback) update = callback;
  }).catch((error) => { note.textContent = error.message; note.classList.add('is-error'); console.error(error); });
  const resize = () => resizeRendererToContainer(renderer, camera, stage);
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(stage);
  resize();
  const animate = () => { update(); controls.update(); renderer.render(scene, camera); requestAnimationFrame(animate); };
  requestAnimationFrame(animate);
  return { dispose() { resizeObserver.disconnect(); controls.dispose(); renderer.dispose(); } };
}

async function buildMode(kit, mode) {
  if (mode === 'puma-explore') return buildPumaExplore(kit);
  if (mode === 'puma-solutions') return buildPumaSolutions(kit);
  if (mode === 'iiwa-union') return buildIiwaUnion(kit);
  if (mode === 'iiwa-family') return buildIiwaFamily(kit);
  throw new Error(`Unknown serial IK demo: ${mode}`);
}

async function buildPumaExplore(kit) {
  const model = await loadModel('puma');
  kit.setCamera([2.45, 2.15, 1.95], [.25, 0, .48]);
  const q = [0, 0, 0, 0, 0, 0];
  const robot = await createRobot(kit.world, model, q);
  const wrist = marker(kit, wristPosition(model, q), .018, 0xff2020, 'wrist center');
  q.forEach((_, index) => addSlider(kit, `q${index + 1}`, -180, 180, 1, 0, (value) => { q[index] = value * DEG; }));
  kit.note.textContent = 'Move the PUMA joints. Joints 4–6 rotate about one common wrist point; only q₁–q₃ move that point.';
  return () => { robot.update(q); wrist.position.copy(wristPosition(model, q)); };
}

async function buildPumaSolutions(kit) {
  const model = await loadModel('puma');
  verifySolutions(model, PUMA_IK_DEG, PUMA_QD_DEG, 3e-6, 'PUMA');
  kit.setCamera([2.35, 2.0, 1.8], [.25, 0, .42]);
  let selected = 0;
  const robot = await createRobot(kit.world, model, radians(PUMA_IK_DEG[selected]));
  const target = endTransform(model, radians(PUMA_QD_DEG));
  addFrame(kit, target, .09, 'same T_d');
  marker(kit, wristFromPumaPose(target), .018, 0xff2020, 'p_w');
  addSelect(kit, 'PUMA IK', PUMA_IK_DEG.map((q, index) => [index,
    `IK ${index + 1} · arm ${Math.floor(index / 2) + 1} · flip ${(index % 2) + 1}`
  ]), (value) => {
    selected = Number(value);
    const q = PUMA_IK_DEG[selected];
    kit.note.textContent = `IK ${selected + 1}: (${q.map((angle) => `${angle.toFixed(1)}°`).join(', ')}). The tool frame remains at T_d.`;
  });
  kit.note.textContent = 'Select any mathematical branch. The first two share one arm configuration and differ only by the wrist flip.';
  return () => robot.update(radians(PUMA_IK_DEG[selected]));
}

async function buildIiwaFamily(kit) {
  const model = await loadModel('iiwa');
  const targetIndex = IIWA_FAMILY_DEG.findIndex((q) => q[2] === 30);
  const target = endTransform(model, radians(IIWA_FAMILY_DEG[targetIndex]));
  verifySolutions(model, IIWA_FAMILY_DEG, IIWA_FAMILY_DEG[targetIndex], 2e-5, 'iiwa family');
  kit.setCamera([2.8, 2.35, 2.05], [-.12, -.08, .64]);
  let selected = targetIndex;
  const robot = await createRobot(kit.world, model, radians(IIWA_FAMILY_DEG[selected]));
  addFrame(kit, target, .11, 'fixed T_d');
  marker(kit, new THREE.Vector3().setFromMatrixPosition(target), .017, 0xff2020);
  addSlider(kit, 'free q3', -180, 180, 5, 30, (value) => {
    selected = Math.round((value + 180) / 5);
    const q = IIWA_FAMILY_DEG[selected];
    kit.note.textContent = `q₃ = ${q[2].toFixed(0)}°. The six dependent joints move to keep the complete tool pose fixed.`;
  });
  kit.note.textContent = 'Vary q₃ through one full cycle. The free-joints URDF allows every joint to rotate from −360° to 360°.';
  return () => robot.update(radians(IIWA_FAMILY_DEG[selected]));
}

async function buildIiwaUnion(kit) {
  const model = await loadModel('iiwa');
  const targetIndex = IIWA_FAMILY_DEG.findIndex((q) => q[2] === 30);
  const target = endTransform(model, radians(IIWA_FAMILY_DEG[targetIndex]));
  kit.setCamera([2.85, 2.45, 2.15], [-.1, -.08, .65]);
  const sampleAngles = [-150, -90, -30, 30, 90, 150];
  const palette = [0x2775ff, 0x00a676, 0x9b5de5, 0xf2b134, 0xe85d04, 0x55595d];
  await Promise.all(sampleAngles.map((angle, index) => {
    const q = IIWA_FAMILY_DEG.find((candidate) => candidate[2] === angle);
    return createRobot(kit.world, model, radians(q), { opacity: .11, color: palette[index] });
  }));
  let selected = targetIndex;
  const selectedRobot = await createRobot(kit.world, model, radians(IIWA_FAMILY_DEG[selected]), { opacity: .98 });
  const lock = marker(kit, model.axisPoints[2], .022, 0xff2020, 'q₃ locked');
  addFrame(kit, target, .11, 'common T_d');
  addSlider(kit, 'member q3', -180, 180, 5, 30, (value) => {
    selected = Math.round((value + 180) / 5);
    kit.note.textContent = `Member λ = q₃ = ${value.toFixed(0)}°: lock joint 3, set ᾱ₂ = ${value.toFixed(0)}°, and solve the resulting 6R robot.`;
  });
  kit.note.textContent = 'Each translucent posture is one member of the 6R family. Every member has its own ᾱ₂=q₃ but reaches the same desired pose.';
  return () => {
    const q = radians(IIWA_FAMILY_DEG[selected]);
    selectedRobot.update(q);
    lock.position.copy(model.axisPoints[2]).applyMatrix4(prefixMatrix(model, q, 2));
  };
}

async function loadModel(key) {
  if (!modelPromises.has(key)) modelPromises.set(key, parseModel(key));
  return modelPromises.get(key);
}

async function parseModel(key) {
  const config = CONFIGS[key];
  const response = await fetch(assetUrl(config, config.urdf));
  if (!response.ok) throw new Error(`Could not load ${config.urdf}.`);
  const xml = new DOMParser().parseFromString(await response.text(), 'application/xml');
  const child = (node, tag) => [...node.children].find((item) => item.tagName.toLowerCase() === tag);
  const vector = (node, attribute, fallback = [0, 0, 0]) => node?.getAttribute(attribute)?.trim().split(/\s+/).map(Number) || fallback;
  const origin = (node) => {
    const element = child(node, 'origin');
    return rpyMatrix(...vector(element, 'xyz'), ...vector(element, 'rpy'));
  };
  const joints = config.joints.map((name) => {
    const element = [...xml.querySelectorAll('joint')].find((item) => item.getAttribute('name') === name);
    if (!element) throw new Error(`Missing ${name}.`);
    return { origin: origin(element), axis: new THREE.Vector3(...vector(child(element, 'axis'), 'xyz', [0, 0, 1])).normalize(), child: child(element, 'child').getAttribute('link') };
  });
  const homeLinks = [new THREE.Matrix4()];
  joints.forEach((joint, index) => homeLinks.push(homeLinks[index].clone().multiply(joint.origin)));
  const axisPoints = joints.map((_, index) => new THREE.Vector3().setFromMatrixPosition(homeLinks[index + 1]));
  const axes = joints.map((joint, index) => joint.axis.clone().transformDirection(homeLinks[index + 1]));
  const linkNames = [config.base, ...joints.map((joint) => joint.child)];
  const visuals = linkNames.map((name, index) => {
    const link = [...xml.querySelectorAll('link')].find((item) => item.getAttribute('name') === name);
    const element = link && child(link, 'visual');
    const mesh = element?.querySelector('geometry > mesh');
    if (!mesh) throw new Error(`Missing mesh for ${name}.`);
    return { prefix: index, origin: origin(element), file: mesh.getAttribute('filename').split('/').at(-1), scale: vector(mesh, 'scale', [1, 1, 1]), color: config.colors[index] };
  });
  const toolOffset = new THREE.Matrix4().makeTranslation(...config.toolOffset);
  const homeTool = homeLinks.at(-1).clone().multiply(toolOffset);
  return { key, config, joints, homeLinks, axisPoints, axes, visuals, homeTool, wristHome: key === 'puma' ? axisPoints[4].clone() : null };
}

async function createRobot(world, model, q, options = {}) {
  const geometries = await loadGeometries(model);
  const group = new THREE.Group();
  world.add(group);
  const visuals = model.visuals.map((spec, index) => {
    const holder = new THREE.Group();
    holder.matrixAutoUpdate = false;
    const opacity = options.opacity ?? 1;
    holder.add(new THREE.Mesh(geometries[index], new THREE.MeshStandardMaterial({
      color: options.color ?? spec.color,
      roughness: .62,
      metalness: .04,
      transparent: opacity < 1,
      opacity,
      depthWrite: opacity > .8
    })));
    group.add(holder);
    return { holder, prefix: spec.prefix, home: model.homeLinks[spec.prefix].clone().multiply(spec.origin) };
  });
  const update = (values) => visuals.forEach((item) => {
    item.holder.matrix.multiplyMatrices(prefixMatrix(model, values, item.prefix), item.home);
    item.holder.matrixWorldNeedsUpdate = true;
  });
  update(q);
  return { update };
}

function loadGeometries(model) {
  if (!geometryPromises.has(model.key)) geometryPromises.set(model.key, Promise.all(model.visuals.map(async (spec) => {
    const response = await fetch(assetUrl(model.config, spec.file));
    if (!response.ok) throw new Error(`Could not load ${spec.file}.`);
    const geometry = parseStlGeometry(await response.arrayBuffer());
    geometry.scale(...spec.scale);
    return geometry;
  })));
  return geometryPromises.get(model.key);
}

function prefixMatrix(model, q, count) {
  const result = new THREE.Matrix4();
  for (let index = 0; index < count; index += 1) result.multiply(revolute(model.axes[index], model.axisPoints[index], q[index] || 0));
  return result;
}

function endTransform(model, q) { return prefixMatrix(model, q, model.joints.length).multiply(model.homeTool.clone()); }
function wristPosition(model, q) { return model.wristHome.clone().applyMatrix4(prefixMatrix(model, q, 3)); }
function wristFromPumaPose(transform) {
  const p = new THREE.Vector3().setFromMatrixPosition(transform);
  return p.addScaledVector(new THREE.Vector3(0, 0, 1).transformDirection(transform), -.0558);
}
function revolute(axis, point, angle) {
  const matrix = new THREE.Matrix4().makeRotationAxis(axis, angle);
  const rotated = point.clone().applyMatrix4(matrix);
  matrix.setPosition(point.clone().sub(rotated));
  return matrix;
}

function verifySolutions(model, solutions, targetQ, tolerance, name) {
  const target = endTransform(model, radians(targetQ));
  solutions.forEach((q, index) => {
    const residual = Math.max(...endTransform(model, radians(q)).elements.map((value, item) => Math.abs(value - target.elements[item])));
    if (residual > tolerance) throw new Error(`${name} solution ${index + 1} has residual ${residual}.`);
  });
}

function marker(kit, position, radius, color, text) {
  const object = new THREE.Mesh(new THREE.SphereGeometry(radius, 22, 14), new THREE.MeshStandardMaterial({ color }));
  object.position.copy(position);
  kit.world.add(object);
  if (text) addLabel(kit, object, new THREE.Vector3(radius * 2, radius * 2, radius * 3), text, color);
  return object;
}

function addFrame(kit, matrix, scale, label) {
  const origin = new THREE.Vector3().setFromMatrixPosition(matrix);
  const axes = [new THREE.Vector3(1,0,0), new THREE.Vector3(0,1,0), new THREE.Vector3(0,0,1)];
  [0xe74c3c, 0x35a853, 0x2775ff].forEach((color, index) => {
    const direction = axes[index].transformDirection(matrix).multiplyScalar(scale);
    kit.world.add(new THREE.ArrowHelper(direction.clone().normalize(), origin, scale, color, scale * .24, scale * .12));
  });
  addLabel(kit, kit.world, origin.clone().add(new THREE.Vector3(0,0,scale * .8)), label);
}

function addLabel(kit, parent, position, text, color = 0x111111) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  context.font = '700 26px Arial';
  canvas.width = Math.max(110, Math.ceil(context.measureText(text).width + 24));
  canvas.height = 48;
  context.fillStyle = 'rgba(255,255,255,.92)'; context.fillRect(0,0,canvas.width,canvas.height);
  context.fillStyle = `#${color.toString(16).padStart(6,'0')}`; context.font = '700 26px Arial'; context.textBaseline = 'middle'; context.fillText(text,12,24);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false }));
  sprite.position.copy(position); sprite.scale.set(canvas.width / 520, canvas.height / 520, 1); sprite.renderOrder = 20;
  parent.add(sprite); kit.world.userData.labelSprites.push(sprite); sprite.visible = kit.world.userData.labelsVisible;
}

function addSlider(kit, text, min, max, step, initial, onInput) {
  const label = document.createElement('label'); label.className = 'ik6r-slider';
  const caption = document.createElement('span'); caption.textContent = text;
  const input = document.createElement('input'); input.type = 'range'; input.min = min; input.max = max; input.step = step; input.value = initial;
  const output = document.createElement('output');
  const update = () => { output.value = `${Number(input.value).toFixed(0)}°`; onInput(Number(input.value)); };
  input.addEventListener('input', update); update(); label.append(caption,input,output); kit.controlsHost.append(label);
}
function addSelect(kit, text, entries, onChange) {
  const label = document.createElement('label'); label.className = 'ik6r-select';
  const caption = document.createElement('span'); caption.textContent = text;
  const select = document.createElement('select');
  entries.forEach(([value,name]) => { const option = document.createElement('option'); option.value = value; option.textContent = name; select.append(option); });
  select.addEventListener('change', () => onChange(select.value)); label.append(caption,select); kit.controlsHost.append(label);
}
function addToggle(kit, text, initial, onChange) {
  const label = document.createElement('label'); label.className = 'ik6r-toggle';
  const input = document.createElement('input'); input.type = 'checkbox'; input.checked = initial;
  const caption = document.createElement('span'); caption.textContent = text;
  input.addEventListener('change', () => onChange(input.checked)); label.append(input,caption); kit.controlsHost.append(label);
}

function radians(q) { return q.map((angle) => angle * DEG); }
function assetUrl(config, name) { const url = new URL(name, config.root); url.searchParams.set('v', REVISION); return url; }
function rpyMatrix(x, y, z, roll, pitch, yaw) {
  const rotation = new THREE.Matrix4().makeRotationZ(yaw)
    .multiply(new THREE.Matrix4().makeRotationY(pitch))
    .multiply(new THREE.Matrix4().makeRotationX(roll));
  return new THREE.Matrix4().makeTranslation(x,y,z).multiply(rotation);
}
