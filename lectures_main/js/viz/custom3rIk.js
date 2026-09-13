import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createSceneControlPanel, createZUpWorld, resizeRendererToContainer } from './threeUtils.js';
import { parseStlGeometry } from './frameDHPlayground.js';

const DEG = Math.PI / 180;
const MODEL_ROOT = new URL('../../assets/models/custom_3R/', import.meta.url);
const ASSET_REVISION = new URL(import.meta.url).searchParams.get('v') || 'dev';
const modelAssetUrl = (filename) => {
  const url = new URL(filename, MODEL_ROOT);
  url.searchParams.set('v', ASSET_REVISION);
  return url;
};
const URDF_URL = modelAssetUrl('custom_3R_new.urdf');
const TARGET_Q_DEG = [-35, -10, -170];
const ZERO_TARGET_Q_DEG = [-35, -10, -170];
const IK_SOLUTION_DEG = [
  [-35, -10, -170],
  [-14.6556883192, -6.6055592987, -147.6075456696],
  [178.4024280182, -147.5329051962, -61.1502417161],
  [-69.0983199015, -61.9762166618, 166.6779007736]
];
const CGA_TARGET_Z_OFFSET = 1;
const CGA_IK_SOLUTION_DEG = [
  [8.560853671659, -46.888070562430, -97.515419825156],
  [-169.572383340993, -132.273182994342, -39.698098590009]
];
const IKS_VISIBILITY = [true, false, false, false];

let robotModelPromise;
let robotModel;
let ikExample;

let geometryPromise;
const variantGeometryPromises = new Map();

async function loadRobotModel() {
  if (!robotModelPromise) robotModelPromise = loadRobotModelFromUrdf();
  return robotModelPromise;
}

async function loadRobotModelFromUrdf() {
  const response = await fetch(URDF_URL);
  if (!response.ok) throw new Error('Could not load custom_3R_new.urdf.');
  const documentNode = new DOMParser().parseFromString(await response.text(), 'application/xml');
  if (documentNode.querySelector('parsererror')) throw new Error('custom_3R_new.urdf is not valid XML.');

  const directChild = (element, tagName) => [...element.children]
    .find((child) => child.tagName.toLowerCase() === tagName);
  const vectorAttribute = (element, attribute, fallback = [0, 0, 0]) =>
    (element?.getAttribute(attribute)?.trim().split(/\s+/).map(Number) || fallback);
  const originMatrix = (element) => {
    const origin = directChild(element, 'origin');
    const [x, y, z] = vectorAttribute(origin, 'xyz');
    const [roll, pitch, yaw] = vectorAttribute(origin, 'rpy');
    return rpyMatrix(x, y, z, roll, pitch, yaw);
  };
  const joint = (name) => {
    const element = [...documentNode.querySelectorAll('joint')].find((item) => item.getAttribute('name') === name);
    if (!element) throw new Error(`Missing ${name} in custom_3R_new.urdf.`);
    return {
      element,
      origin: originMatrix(element),
      axis: new THREE.Vector3(...vectorAttribute(directChild(element, 'axis'), 'xyz', [0, 0, 1])).normalize(),
      child: directChild(element, 'child')?.getAttribute('link')
    };
  };
  const visual = (linkName) => {
    const link = [...documentNode.querySelectorAll('link')].find((item) => item.getAttribute('name') === linkName);
    const visualElement = link && directChild(link, 'visual');
    const mesh = visualElement?.querySelector('geometry > mesh');
    if (!link || !visualElement || !mesh) throw new Error(`Missing visual mesh for ${linkName}.`);
    const filename = mesh.getAttribute('filename').split('/').at(-1);
    return { origin: originMatrix(visualElement), file: filename };
  };

  const joints = [joint('joint_1'), joint('joint_2'), joint('joint_3')];
  const toolJoint = joint('tool0_fixed_joint');
  const homeLinks = [new THREE.Matrix4()];
  joints.forEach((item, index) => {
    homeLinks.push((index ? homeLinks[index] : new THREE.Matrix4()).clone().multiply(item.origin));
  });
  const axisPoints = joints.map((item, index) => new THREE.Vector3().setFromMatrixPosition(homeLinks[index + 1]));
  const axes = joints.map((item, index) => item.axis.clone().transformDirection(homeLinks[index + 1]));
  const toolHomeMatrix = homeLinks[3].clone().multiply(toolJoint.origin);
  const homeTool = new THREE.Vector3().setFromMatrixPosition(toolHomeMatrix);
  const linkNames = ['base_link', joints[0].child, joints[1].child, joints[2].child];
  const visuals = linkNames.map(visual);
  const colors = [0x333638, 0x0d7d80, 0xb8b8b8, 0x0d7d80];
  const meshSpecs = visuals.map((item, index) => ({ file: item.file, prefix: index, color: colors[index] }));

  const joint2Origin = new THREE.Vector3().setFromMatrixPosition(joints[1].origin);
  const joint3Origin = new THREE.Vector3().setFromMatrixPosition(joints[2].origin);
  const toolOrigin = new THREE.Vector3().setFromMatrixPosition(toolJoint.origin);
  const model = {
    axes,
    axisPoints,
    homeTool,
    homeLinks,
    visualOrigins: visuals.map((item) => item.origin),
    meshSpecs,
    dh: {
      a1: joint2Origin.x,
      alpha1: -90 * DEG,
      d1: axisPoints[1].z,
      a2: joint3Origin.x,
      alpha2: 90 * DEG,
      d2: joint3Origin.y,
      a3: toolOrigin.x,
      alpha3: 0,
      d3: toolOrigin.z
    }
  };

  const targetQ = TARGET_Q_DEG.map((angle) => angle * DEG);
  const solutions = IK_SOLUTION_DEG.map((q) => q.map((angle) => angle * DEG));
  const eePosition = forwardPosition(model, targetQ);
  const derived = deriveExampleValues(model, targetQ, eePosition);
  solutions.forEach((q, index) => {
    const residual = forwardPosition(model, q).distanceTo(eePosition);
    if (residual > 1e-8) throw new Error(`IK branch ${index + 1} is inconsistent with custom_3R_new.urdf.`);
  });
  robotModel = model;
  ikExample = { targetQ, solutions, eePosition, ...derived };
  bindLectureExample(ikExample, model);
  bindCgaExample(ikExample);
  return model;
}

function forwardPosition(model, q) {
  return model.homeTool.clone().applyMatrix4(prefixMatrixFor(model, q, 3));
}

function prefixMatrixFor(model, q, count) {
  const matrix = new THREE.Matrix4();
  for (let i = 0; i < count; i += 1) matrix.multiply(expRevolute(model.axes[i], model.axisPoints[i], q[i]));
  return matrix;
}

function deriveExampleValues(model, q, eePosition) {
  const { a1, a2, a3, d1, d2, d3 } = model.dh;
  const [, theta2, theta3] = q;
  const ux = a2 + a3 * Math.cos(theta3);
  const uy = -d3;
  const uz = d2 + a3 * Math.sin(theta3);
  const U = Math.cos(theta2) * ux - Math.sin(theta2) * uy;
  const V = Math.sin(theta2) * ux + Math.cos(theta2) * uy;
  const zBar = eePosition.z - d1;
  const zElim = zBar / Math.sin(model.dh.alpha1);
  const R = eePosition.x ** 2 + eePosition.y ** 2;
  const normR = R + zBar ** 2;
  const uNormSquared = ux ** 2 + uy ** 2 + uz ** 2;
  const D = R + zBar ** 2 - a1 ** 2 - uNormSquared;
  const vx = a1 + U;
  return {
    ux, uy, uz, U, V, zBar, zElim, R, normR, uNormSquared, D, vx,
    planarNormSquared: ux ** 2 + uy ** 2,
    angleUV: Math.atan2(V, U) / DEG,
    angleU: Math.atan2(uy, ux) / DEG,
    targetAzimuth: Math.atan2(eePosition.y, eePosition.x) / DEG,
    preAzimuth: Math.atan2(uz, vx) / DEG
  };
}

function bindLectureExample(example, model) {
  window.custom3RExample = { model, ...example };
  document.querySelectorAll('[data-custom3r-ee]').forEach((element) => {
    const digits = Number(element.dataset.digits || 4);
    element.textContent = example.eePosition.toArray().map((value) => value.toFixed(digits)).join(', ');
  });
  const [x, y, z] = example.eePosition.toArray().map((value) => fixed(value, 4));
  const [q1, q2, q3] = TARGET_Q_DEG;
  const bindings = {
    problem: `\\[\\mathbf q=(${q1}^\\circ,${q2}^\\circ,${q3}^\\circ)\\Rightarrow\\mathbf p_d=\\begin{bmatrix}${x}\\\\${y}\\\\${z}\\end{bmatrix}\\mathrm m\\]`,
    forward: `\\[\\mathbf p(${q1}^\\circ,${q2}^\\circ,${q3}^\\circ)=\\begin{bmatrix}${x}\\\\${y}\\\\${z}\\end{bmatrix}\\mathrm m\\]`,
    inline: `\\(\\mathbf p_d=(${x},${y},${z})\\,\\mathrm m\\)`
  };
  const boundElements = [...document.querySelectorAll('[data-custom3r-target]')];
  updateMathBindings(boundElements, (element) => bindings[element.dataset.custom3rTarget] || '');
}

function bindCgaExample(example) {
  const target = example.eePosition.clone().add(new THREE.Vector3(0, 0, CGA_TARGET_Z_OFFSET));
  const [x, y, z] = target.toArray().map((value) => fixed(value, 4));
  const bindings = {
    inline: `\\(\\mathbf p_d=(${x},${y},${z})\\,\\mathrm m\\)`,
    vector: `\\[\\mathbf p_d=\\begin{bmatrix}${x}\\\\${y}\\\\${z}\\end{bmatrix}\\mathrm m\\]`
  };
  const elements = [...document.querySelectorAll('[data-cga-target]')];
  updateMathBindings(elements, (element) => bindings[element.dataset.cgaTarget] || '');
}

function updateMathBindings(elements, markupFor) {
  if (!elements.length) return;
  const replace = () => elements.forEach((element) => { element.innerHTML = markupFor(element); });
  const mathJax = window.MathJax;
  if (!mathJax?.startup?.promise) {
    replace();
    return;
  }
  // Wait for initial rendering, then serialize both target updates. Clear the
  // old MathItems before replacing nodes that MathJax may already have tracked.
  mathJax.startup.promise = mathJax.startup.promise.then(() => {
    mathJax.typesetClear?.(elements);
    replace();
    return mathJax.typesetPromise?.(elements);
  }).catch((error) => console.warn('Target equation typesetting failed:', error));
}

export function initCustom3RIkDemos() {
  const hosts = [...document.querySelectorAll('[data-custom3r-ik]')];
  if (!hosts.length) return;
  const instances = new WeakMap();
  function ensure(host) {
    const existing = instances.get(host);
    if (existing?.timer) {
      clearTimeout(existing.timer);
      existing.timer = null;
    }
    if (!existing) {
      const instance = createDemo(host);
      instances.set(host, { instance, timer: null });
    }
  }
  function scheduleDispose(host) {
    const existing = instances.get(host);
    if (existing && !existing.timer) {
      existing.timer = setTimeout(() => {
        existing.instance.dispose();
        instances.delete(host);
      }, 2200);
    }
  }
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) ensure(entry.target);
      else scheduleDispose(entry.target);
    });
  }, { threshold: .04, rootMargin: '80px' });
  hosts.forEach((host) => observer.observe(host));

  // Horizontal deck navigation uses a large CSS transform. Some Chromium
  // versions briefly report zero intersection during the initial hash jump,
  // so also activate the slide named by the deck hash explicitly.
  let lastHash = '';
  const syncHashSlide = () => {
    if (location.hash === lastHash) return;
    lastHash = location.hash;
    const match = location.hash.match(/#slide-(\d+)/);
    const index = match ? Math.max(0, Number(match[1]) - 1) : 0;
    const slide = document.querySelectorAll('#deck > .slide')[index];
    slide?.querySelectorAll('[data-custom3r-ik]').forEach(ensure);
  };
  syncHashSlide();
  setTimeout(() => { lastHash = ''; syncHashSlide(); }, 350);
  setInterval(syncHashSlide, 300);
}

function createDemo(container) {
  const mode = container.dataset.mode || 'robot';
  container.classList.add('ik3r-demo');
  container.innerHTML = '<div class="ik3r-canvas"></div><div class="ik3r-footer"><p class="ik3r-note"></p></div><div class="ik3r-controls"></div>';
  const stage = container.querySelector('.ik3r-canvas');
  const note = container.querySelector('.ik3r-note');
  const controlHost = container.querySelector('.ik3r-controls');
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xfcfcfc);
  const camera = new THREE.PerspectiveCamera(38, 1, .01, 100);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.7));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  stage.appendChild(renderer.domElement);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x777777, 2.4));
  const key = new THREE.DirectionalLight(0xffffff, 2.8);
  key.position.set(5, 8, 7);
  scene.add(key);
  const world = createZUpWorld(scene);
  world.userData.sceneControls = createSceneControlPanel(stage, world, { labels: false });
  container.querySelector('.ik3r-footer').prepend(stage.querySelector('.course-3d-controls'));
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = .08;
  controls.target.set(2, 1.1, -.65);
  camera.position.set(7, 5.5, 6);
  controls.update();
  const cleaners = [];
  let alive = true;
  let update = () => {};

  const kit = {
    container, mode, scene, world, camera, renderer, controls, note, controlHost, cleaners,
    setCamera(position, target = [2, 1, -.65]) {
      camera.position.fromArray(position);
      controls.target.fromArray(target);
      controls.update();
    }
  };

  addGrid(world);
  addLabelVisibilityControl(kit);
  Promise.resolve(buildMode(kit)).then((modeUpdate) => {
    if (!alive) return;
    if (typeof modeUpdate === 'function') update = modeUpdate;
    kit.syncLabels?.();
  }).catch((error) => {
    note.textContent = 'Three.js scene could not load: ' + error.message;
    note.classList.add('is-error');
    container.dataset.errorStack = error.stack || error.message;
    console.error('custom_3R IK visualization failed:', error);
  });

  const resize = () => resizeRendererToContainer(renderer, camera, stage);
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(stage);
  resize();
  let last = performance.now();
  function animate(time) {
    if (!alive) return;
    const dt = Math.max(0, Math.min((time - last) / 1000, .05));
    last = time;
    update(time / 1000, dt);
    kit.syncLabels?.();
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);

  return {
    dispose() {
      alive = false;
      resizeObserver.disconnect();
      cleaners.forEach((fn) => fn());
      scene.traverse(disposeObject);
      controls.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      container.innerHTML = '';
    }
  };
}

async function buildMode(kit) {
  switch (kit.mode) {
    case 'dimensions': return buildDimensions(kit);
    case 'dh-motion': return buildDhMotion(kit);
    case 'top': return buildTopView(kit);
    case 'u-vector': return buildUVector(kit);
    case 'uv-concept': return buildUvConcept(kit);
    case 'uv': return buildUvRotation(kit);
    case 'height': return buildHeightInvariant(kit);
    case 'radial': return buildRadialInvariant(kit);
    case 'roots': return buildRoots(kit);
    case 'conic': return buildConicInterpretation(kit);
    case 'conic-explorer': return buildConicExplorer(kit);
    case 'back2': return buildBackprop(kit, 2);
    case 'back1': return buildBackprop(kit, 1);
    case 'degeneracy': return buildDegeneracy(kit);
    case 'orbit': return buildOrbit(kit);
    case 'circle-distance': return buildCircleDistance(kit);
    case 'pk1': return buildPk1(kit);
    case 'pk3': return buildPk3(kit);
    case 'pk3-reduction': return buildPk3Reduction(kit);
    case 'pk3-ik': return buildPk3Ik(kit);
    case 'pk2-geometry': return buildPk2Geometry(kit);
    case 'pk2-branch-a': return buildPk2Branch(kit, 'a');
    case 'pk2-branch-b': return buildPk2Branch(kit, 'b');
    case 'cga-circles': return buildCgaCircles(kit);
    case 'cga-circle-motion': return buildCgaCircleMotion(kit);
    case 'cga-four-theta2': return buildCgaFourTheta2(kit);
    case 'cga-backsolve': return buildCgaBacksolve(kit);
    case 'cga-forward': return buildCgaForward(kit);
    case 'cga-torus': return buildCgaTorus(kit);
    case 'cga-interactive': return buildCgaInteractive(kit);
    case 'intersecting': return buildIntersecting(kit);
    case 'pipeline': return buildPipeline(kit);
    default: return buildDhMotion(kit);
  }
}

async function buildDimensions(kit) {
  kit.setCamera([9, 6.7, 8]);
  const robot = await createRobot(kit.world, [0, 0, 0]);
  const { dh, axisPoints, homeTool } = robotModel;
  addJointAxes(kit.world, [0, 0, 0], true);
  const joint2 = axisPoints[1], joint3 = axisPoints[2];
  const d2End = joint2.clone().add(new THREE.Vector3(0, dh.d2, 0));
  const d3End = joint3.clone().add(new THREE.Vector3(0, 0, dh.d3));
  const dimensionText = (symbol, value) => kit.container.dataset.dimensionLabels === 'symbols'
    ? symbol
    : `${symbol} = ${fixed(value, 2)} m`;
  const dims = [
    [v([0, 0, 0]), v([0, 0, dh.d1]), dimensionText('d₁', dh.d1), 0xff0000],
    [v([0, 0, dh.d1]), joint2, dimensionText('a₁', dh.a1), 0x111111],
    [joint2, d2End, dimensionText('d₂', dh.d2), 0x3f6ea8],
    [d2End, joint3, dimensionText('a₂', dh.a2), 0x111111],
    [d3End, homeTool, dimensionText('a₃', dh.a3), 0xff0000]
  ];
  const annotations = dims.map(([a, b, text, color]) =>
    addDimension(kit.world, a, b, text, color));
  annotations.push(addDimension(kit.world, joint3, d3End, dimensionText('d₃', dh.d3), 0x888888, .75));
  addDimensionLabelControls(kit, annotations);
  kit.note.textContent = 'Geometry loaded from custom_3R_new.urdf; each annotation is derived from its joint and tool origins.';
  return () => robot.update([0, 0, 0]);
}

async function buildDhMotion(kit) {
  kit.setCamera([7, 5.4, 6.2]);
  const robot = await createRobot(kit.world, [0, 0, 0]);
  const target = ikExample.targetQ.slice();
  const q = [0, 0, 0];
  addTarget(kit.world, ikExample.eePosition, 'p_d');
  kit.note.textContent = `The global target p_d = (${vectorText(ikExample.eePosition, 3)}) m is computed once from the URDF and q = (${TARGET_Q_DEG.join('°, ')}°).`;
  return (time, dt) => {
    const phase = .5 - .5 * Math.cos(Math.min(1, (time % 8) / 3) * Math.PI);
    q.forEach((_, i) => { q[i] += (target[i] * phase - q[i]) * Math.min(1, 5 * dt); });
    robot.update(q);
  };
}

async function buildTopView(kit) {
  await loadRobotModel();
  kit.setCamera([5.8, 7.2, 5.4], [1.1, .7, 0]);
  kit.controls.enableRotate = true;
  const robot = await createRobot(kit.world, ikExample.targetQ);
  addRobotVisibilityToggle(kit, robot.group, 'STL');
  const { eePosition, R } = ikExample;
  const d1 = robotModel.dh.d1;
  addTarget(kit.world, eePosition, 'p_d');
  const projection = new THREE.Vector3(eePosition.x, eePosition.y, d1);
  addRing(kit.world, new THREE.Vector3(0, 0, d1), Math.sqrt(R), 0x3f6ea8, 1.3);
  kit.world.add(tube(projection, eePosition, .018, 0x777777, .65));
  const projectedMarker = sphere(.09, 0x3f6ea8);
  projectedMarker.position.copy(projection);
  kit.world.add(projectedMarker);
  addLabel(kit.world, projection.clone().add(new THREE.Vector3(.08, .08, .16)), 'π_xy(p_d)');
  kit.note.textContent = `The blue circle has radius ρ = ${fixed(Math.sqrt(R), 4)} m; with z = z_d − d₁, the θ₁-invariant is R = ρ² + z².`;
  return () => robot.update(ikExample.targetQ);
}

async function buildUVector(kit) {
  await loadRobotModel();
  kit.setCamera([7.3, 5.2, 5.8]);
  const homeQ = [0, 0, 0];
  const theta3OnlyQ = [0, 0, ikExample.targetQ[2]];
  const homeRobot = await createRobot(kit.world, homeQ, {
    opacity: .25,
    colors: [0x777777, 0x777777, 0x999999, 0x777777]
  });
  const finalRobot = await createRobot(kit.world, ikExample.targetQ, {
    opacity: .25,
    colors: [0x333638, 0x3f6ea8, 0xaec7e8, 0x3f6ea8]
  });
  const theta3Robot = await createRobot(kit.world, theta3OnlyQ, { opacity: .8 });
  addRobotVisibilityToggle(kit, homeRobot.group, 'Home');
  addRobotVisibilityToggle(kit, finalRobot.group, 'Final');
  addRobotVisibilityToggle(kit, theta3Robot.group, 'θ₃');
  const origin = robotModel.axisPoints[1].clone();
  const { a2, a3, d2, d3 } = robotModel.dh;
  const theta = ikExample.targetQ[2];
  const thetaDegrees = TARGET_Q_DEG[2];
  // Frame 1 has x₁ = x_W, y₁ = -z_W, z₁ = y_W at q₁ = 0.
  const u = new THREE.Vector3(a2 + a3 * Math.cos(theta), d2 + a3 * Math.sin(theta), d3);
  addVector(kit.world, origin, u, 0xff0000, `u(${thetaDegrees}°)`);
  addVector(kit.world, origin, new THREE.Vector3(a2 + a3, d2, d3), 0x777777, 'u(0°)');
  addTarget(kit.world, ikExample.eePosition, 'p_d', new THREE.Vector3(-.28, .08, .58));
  addVector(kit.world, origin, new THREE.Vector3(.65, 0, 0), 0xe74c3c, 'x₁');
  addVector(kit.world, origin, new THREE.Vector3(0, 0, -.65), 0x35a853, 'y₁');
  addVector(kit.world, origin, new THREE.Vector3(0, .65, 0), 0x2775ff, 'z₁');
  kit.note.textContent = `The θ₃-only state (${thetaDegrees}°) is shown at 0.8 opacity; home and the final IK state are references at 0.25.`;
  return () => {
    homeRobot.update(homeQ);
    finalRobot.update(ikExample.targetQ);
    theta3Robot.update(theta3OnlyQ);
  };
}

async function buildUvRotation(kit) {
  await loadRobotModel();
  kit.setCamera([6.8, 5.8, 6.5]);
  const robot = await createRobot(kit.world, ikExample.targetQ);
  const center = robotModel.axisPoints[1].clone();
  addRingInPlane(kit.world, center, Math.sqrt(ikExample.planarNormSquared), new THREE.Vector3(0, 1, 0), 0x3f6ea8);
  addVector(kit.world, center, new THREE.Vector3(ikExample.ux, 0, -ikExample.uy), 0x777777, '[F₁,F₂]');
  addVector(kit.world, center, new THREE.Vector3(ikExample.U, 0, -ikExample.V), 0xff0000, '[E,z]');
  kit.note.textContent = `In the shown x–z plane, −θ₂ = ${fixed(-TARGET_Q_DEG[1], 0)}° rotates [F₁,F₂] into [E,z]; both lengths remain ${fixed(Math.sqrt(ikExample.planarNormSquared), 4)} m.`;
  return () => robot.update(ikExample.targetQ);
}

async function buildUvConcept(kit) {
  await loadRobotModel();
  kit.setCamera([6.8, 5.8, 6.5]);
  const stlGroup = new THREE.Group();
  kit.world.add(stlGroup);
  const homeRobot = await createRobot(kit.world, [0, 0, 0], {
    opacity: .25,
    colors: [0x777777, 0x777777, 0x999999, 0x777777]
  });
  const rotatedQ = [0, ikExample.targetQ[1], ikExample.targetQ[2]];
  const rotatedRobot = await createRobot(kit.world, rotatedQ, { opacity: .72 });
  stlGroup.add(homeRobot.group, rotatedRobot.group);
  addRobotVisibilityToggle(kit, stlGroup, 'STL');
  addRobotVisibilityToggle(kit, homeRobot.group, 'Home');

  const center = robotModel.axisPoints[1].clone();
  const jointAxis = robotModel.axes[1].clone();
  kit.world.add(makeAxis(center, jointAxis, 4.2, 0x111111));
  addLabel(kit.world, center.clone().addScaledVector(jointAxis, 1.55), 'joint 2 axis');
  addRingInPlane(kit.world, center, Math.sqrt(ikExample.planarNormSquared), jointAxis, 0x3f6ea8);
  addVector(kit.world, center, new THREE.Vector3(ikExample.ux, 0, -ikExample.uy), 0x777777, '[F₁,F₂]');
  addVector(kit.world, center, new THREE.Vector3(ikExample.U, 0, -ikExample.V), 0xff0000, '[E,z]');
  kit.note.textContent = `In the shown x–z plane, the oriented rotation from [F₁,F₂] to [E,z] is −θ₂ = ${-TARGET_Q_DEG[1]}°.`;
  return () => {
    homeRobot.update([0, 0, 0]);
    rotatedRobot.update(rotatedQ);
  };
}

async function buildHeightInvariant(kit) {
  await loadRobotModel();
  kit.setCamera([7.1, 4.7, 6.2]);
  const robot = await createRobot(kit.world, ikExample.targetQ);
  const d1 = robotModel.dh.d1;
  addTarget(kit.world, ikExample.eePosition, `z_d = ${fixed(ikExample.eePosition.z, 4)} m`);
  addDimension(kit.world, v([0, 0, d1]), v([0, 0, ikExample.eePosition.z]), `z = ${fixed(ikExample.zBar, 4)} m`, 0xff0000);
  const plane = new THREE.GridHelper(8, 16, 0xaaaaaa, 0xdddddd);
  plane.rotation.x = Math.PI / 2;
  plane.position.z = d1;
  kit.world.add(plane);
  kit.note.textContent = 'z_d is the world target height; z = z_d − d₁ measures height above the plane through joint 2.';
  return () => robot.update(ikExample.targetQ);
}

async function buildRadialInvariant(kit) {
  await loadRobotModel();
  kit.setCamera([4.2, 10.8, 6.4], [.8, .45, 1.15]);
  const robot = await createRobot(kit.world, ikExample.targetQ);
  const center = new THREE.Vector3(0, 0, ikExample.eePosition.z);
  const joint1Point = robotModel.axisPoints[0];
  addTarget(kit.world, ikExample.eePosition, 'p_d');
  addRing(kit.world, center, Math.sqrt(ikExample.R), 0xff0000, 1.5);
  addVector(kit.world, center, new THREE.Vector3(ikExample.eePosition.x, ikExample.eePosition.y, 0), 0x3f6ea8, 'ρ');
  kit.world.add(tube(joint1Point.clone().add(new THREE.Vector3(0, 0, -1)), center.clone().add(new THREE.Vector3(0, 0, 1)), .025, 0x111111, .8));
  addLabel(kit.world, joint1Point.clone().add(new THREE.Vector3(.08, .08, .15)), 'joint 1');
  addLabel(kit.world, center.clone().add(new THREE.Vector3(.08, .08, .15)), '(0, 0, z_d)');
  kit.note.textContent = 'The black joint-1 axis is x = y = 0. The circle radius is ρ; with z = z_d − d₁, the invariant is R = ρ² + z².';
  return () => robot.update(ikExample.targetQ);
}

async function buildRoots(kit) {
  kit.setCamera([7.2, 5.4, 6.6]);
  const palettes = [
    [0x333638, 0x0d7d80, 0xb8b8b8, 0x0d7d80],
    [0x333638, 0x3f6ea8, 0xaec7e8, 0x3f6ea8],
    [0x333638, 0xd79b00, 0xf0d48b, 0xd79b00],
    [0x333638, 0xff5555, 0xffbbbb, 0xff5555]
  ];
  await loadRobotModel();
  const robots = await Promise.all(ikExample.solutions.map((q, i) =>
    createRobot(kit.world, q, { opacity: .58, colors: palettes[i] })));
  robots.forEach((robot, i) => {
    const elbow = robotModel.axisPoints[2].clone().applyMatrix4(prefixMatrixFor(robotModel, ikExample.solutions[i], 2));
    addLabel(robot.group, elbow.add(new THREE.Vector3(.08, .08, .24)), `IKS ${i + 1}`, palettes[i][1]);
    addRobotVisibilityToggle(
      kit,
      robot.group,
      `IKS ${i + 1}`,
      IKS_VISIBILITY[i],
      (visible) => { IKS_VISIBILITY[i] = visible; }
    );
  });
  addTarget(kit.world, ikExample.eePosition, 'same p_d');
  kit.note.textContent = 'Each switch independently preserves an IK branch, so any subset of the four solutions can be compared at the common target.';
  return () => robots.forEach((robot, i) => robot.update(ikExample.solutions[i]));
}

async function buildBackprop(kit, joint) {
  await loadRobotModel();
  kit.setCamera(joint === 2 ? [6.8, 5.5, 6.3] : [2.1, 14, -.8], [2.1, 1.1, -.8]);
  const robot = await createRobot(kit.world, ikExample.targetQ);
  addTarget(kit.world, ikExample.eePosition, 'p_d');
  if (joint === 2) {
    const center = robotModel.axisPoints[1];
    addVector(kit.world, center, v([ikExample.ux, 0, -ikExample.uy]), 0x777777, `atan2(F₂,F₁) = ${fixed(-ikExample.angleU, 3)}°`);
    addVector(kit.world, center, v([ikExample.U, 0, -ikExample.V]), 0xff0000, `atan2(z,E) = ${fixed(-ikExample.angleUV, 3)}°`);
    kit.note.textContent = `θ₂ = atan2(F₂,F₁) − atan2(z,E) = ${fixed(-ikExample.angleU, 3)}° − ${fixed(-ikExample.angleUV, 3)}° = ${fixed(TARGET_Q_DEG[1], 3)}°.`;
  } else {
    const center = v([0, 0, robotModel.dh.d1]);
    addVector(kit.world, center, v([ikExample.vx, ikExample.uz, 0]), 0x777777, `atan2(C,a₁+E) = ${fixed(ikExample.preAzimuth, 3)}°`);
    addVector(kit.world, center, v([ikExample.eePosition.x, ikExample.eePosition.y, 0]), 0xff0000, `target azimuth = ${fixed(ikExample.targetAzimuth, 3)}°`);
    kit.note.textContent = `θ₁ = ${fixed(ikExample.targetAzimuth, 3)}° − ${fixed(ikExample.preAzimuth, 3)}° = ${fixed(TARGET_Q_DEG[0], 3)}°.`;
  }
  return () => robot.update(ikExample.targetQ);
}

async function buildDegeneracy(kit) {
  kit.setCamera([6.8, 5.3, 6.2]);
  const filenames = [
    'custom_3R_new.urdf',
    'custom_3R_new_800.urdf',
    'custom_3R_new_600.urdf',
    'custom_3R_new_400.urdf',
    'custom_3R_new_0.urdf'
  ];
  const variants = await Promise.all(filenames.map((filename) => createUrdfVariantRobot(kit.world, filename)));
  variants.forEach((variant) => setVariantOpacity(variant.group, 0));
  let lastMessage = '';
  const stageDuration = 2.4;
  const fadeDuration = .55;
  return (time) => {
    const position = (time % (stageDuration * variants.length)) / stageDuration;
    const index = Math.floor(position);
    const withinStage = (position - index) * stageDuration;
    const nextIndex = (index + 1) % variants.length;
    const blend = Math.max(0, Math.min(1, (withinStage - (stageDuration - fadeDuration)) / fadeDuration));
    variants.forEach((variant, variantIndex) => {
      const opacity = variantIndex === index ? 1 - blend : variantIndex === nextIndex ? blend : 0;
      setVariantOpacity(variant.group, opacity);
    });
    const current = variants[index];
    const next = variants[nextIndex];
    const message = blend > .02
      ? `${current.filename} (a₁=${fixed(current.a1, 1)} m) → ${next.filename} (a₁=${fixed(next.a1, 1)} m)`
      : `${current.filename} · a₁ = ${fixed(current.a1, 1)} m`;
    if (message !== lastMessage) {
      kit.note.textContent = message;
      lastMessage = message;
    }
  };
}

async function createUrdfVariantRobot(world, filename) {
  const response = await fetch(modelAssetUrl(filename));
  if (!response.ok) throw new Error(`Could not load ${filename}.`);
  const documentNode = new DOMParser().parseFromString(await response.text(), 'application/xml');
  if (documentNode.querySelector('parsererror')) throw new Error(`${filename} is not valid XML.`);
  const child = (element, tagName) => [...element.children]
    .find((item) => item.tagName.toLowerCase() === tagName);
  const vector = (element, attribute, fallback = [0, 0, 0]) =>
    (element?.getAttribute(attribute)?.trim().split(/\s+/).map(Number) || fallback);
  const origin = (element) => {
    const originElement = child(element, 'origin');
    const [x, y, z] = vector(originElement, 'xyz');
    const [roll, pitch, yaw] = vector(originElement, 'rpy');
    return rpyMatrix(x, y, z, roll, pitch, yaw);
  };
  const joint = (name) => {
    const element = [...documentNode.querySelectorAll('joint')].find((item) => item.getAttribute('name') === name);
    if (!element) throw new Error(`Missing ${name} in ${filename}.`);
    return { element, origin: origin(element), child: child(element, 'child')?.getAttribute('link') };
  };
  const visual = (name) => {
    const link = [...documentNode.querySelectorAll('link')].find((item) => item.getAttribute('name') === name);
    const element = link && child(link, 'visual');
    const mesh = element?.querySelector('geometry > mesh');
    if (!mesh) throw new Error(`Missing visual for ${name} in ${filename}.`);
    return { origin: origin(element), file: mesh.getAttribute('filename').split('/').at(-1) };
  };

  const joints = [joint('joint_1'), joint('joint_2'), joint('joint_3')];
  const homeLinks = [new THREE.Matrix4()];
  joints.forEach((item, index) => {
    homeLinks.push((index ? homeLinks[index] : new THREE.Matrix4()).clone().multiply(item.origin));
  });
  const linkNames = ['base_link', ...joints.map((item) => item.child)];
  const visuals = linkNames.map(visual);
  const colors = [0x333638, 0x0d7d80, 0xb8b8b8, 0x0d7d80];
  const group = new THREE.Group();
  world.add(group);
  world.userData.sceneControls?.registerStlRoot(group);
  await Promise.all(visuals.map(async (item, index) => {
    const geometry = await loadVariantGeometry(item.file);
    const sceneOpacity = world.userData.courseStlOpacityFactor ?? 1;
    const holder = new THREE.Group();
    holder.matrixAutoUpdate = false;
    holder.matrix.copy(homeLinks[index]).multiply(item.origin);
    const material = new THREE.MeshStandardMaterial({
      color: colors[index], roughness: .62, metalness: .06,
      transparent: sceneOpacity < 1, opacity: sceneOpacity, depthWrite: sceneOpacity >= .95,
      side: THREE.DoubleSide
    });
    material.userData.ikVariantBaseOpacity = 1;
    material.userData.ikVariantBaseTransparent = false;
    material.userData.ikVariantBaseDepthWrite = true;
    const mesh = new THREE.Mesh(geometry.clone(), material);
    mesh.userData.isCourseStl = true;
    holder.add(mesh);
    group.add(holder);
  }));

  const joint2Point = new THREE.Vector3().setFromMatrixPosition(homeLinks[2]);
  const axis1Point = new THREE.Vector3(0, 0, joint2Point.z);
  const a1 = joint2Point.x;
  group.add(makeAxis(axis1Point, new THREE.Vector3(0, 0, 1), 3.8, 0x111111));
  group.add(makeAxis(joint2Point, new THREE.Vector3(0, 1, 0), 4.2, 0xff0000));
  if (Math.abs(a1) > 1e-4) addDimension(group, axis1Point, joint2Point, `a₁ = ${fixed(a1, 1)} m`, 0x3f6ea8);
  else addLabel(group, joint2Point.clone().add(new THREE.Vector3(.16, .12, .18)), 'a₁ = 0 · shared point', 0x3f6ea8);
  return { group, filename, a1 };
}

function loadVariantGeometry(filename) {
  if (!variantGeometryPromises.has(filename)) {
    variantGeometryPromises.set(filename, fetch(modelAssetUrl(filename)).then(async (response) => {
      if (!response.ok) throw new Error(`Could not load ${filename}.`);
      return parseStlGeometry(await response.arrayBuffer());
    }));
  }
  return variantGeometryPromises.get(filename);
}

function setVariantOpacity(group, opacity) {
  const variantOpacity = Math.max(0, Math.min(1, opacity));
  const stlOpacity = group.parent?.userData.courseStlOpacityFactor ?? 1;
  group.visible = variantOpacity > .005;
  group.traverse((object) => {
    if (!object.material) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach((material) => {
      if (material.userData.ikVariantBaseOpacity == null) {
        material.userData.ikVariantBaseOpacity = material.opacity;
        material.userData.ikVariantBaseTransparent = material.transparent;
        material.userData.ikVariantBaseDepthWrite = material.depthWrite;
      }
      const sceneFactor = object.userData.isCourseStl ? stlOpacity : 1;
      const displayOpacity = Math.max(0, Math.min(1,
        material.userData.ikVariantBaseOpacity * variantOpacity * sceneFactor));
      material.transparent = material.userData.ikVariantBaseTransparent || displayOpacity < .999;
      material.opacity = displayOpacity;
      material.depthWrite = displayOpacity >= .95
        ? material.userData.ikVariantBaseDepthWrite
        : false;
      material.needsUpdate = true;
    });
  });
}

function buildOrbit(kit) {
  kit.world.userData.ikLabelBackground = false;
  kit.setCamera([5.8, 4.8, 5.6], [0, 1, 0]);
  const origin = new THREE.Vector3();
  const center = new THREE.Vector3(0, 0, 1);
  const p = new THREE.Vector3(1.7, Math.sqrt(4 - 1.7 ** 2), 1);
  kit.world.add(makeAxis(origin, new THREE.Vector3(0, 0, 1), 4, 0x111111));
  addPkPlane(kit.world, center, 5.1, 0x3f6ea8);
  addRing(kit.world, center, 2, 0x3f6ea8, 2);
  const axial = addVector(kit.world, origin, center, 0x3f6ea8, 'p∥');
  const radial = addVector(kit.world, center, p.clone().sub(center), 0x18865e, 'p⊥');
  axial.children.find((object) => object.userData.isIkLabel).position.set(-.25, -.3, .6);
  radial.children.find((object) => object.userData.isIkLabel).position.copy(center).lerp(p, .55).add(new THREE.Vector3(0, 0, .25));
  kit.world.add(tube(origin, p, .017, 0x777777, .65));
  const point = sphere(.12, 0xff0000);
  point.position.copy(p);
  kit.world.add(point);
  addLabel(kit.world, p.clone().add(new THREE.Vector3(.12, .12, .48)), 'p', 0xff0000);
  addLabel(kit.world, new THREE.Vector3(-.4, -.12, 2.15), 'ω');
  addLabel(kit.world, new THREE.Vector3(-1.45, 1.8, 1.12), 'orbit plane Π', 0x3f6ea8);
  kit.note.textContent = 'Static decomposition: p = p∥ + p⊥. The axial part locates the circle center; the radial part sets its radius.';
}

function buildCircleDistance(kit) {
  kit.setCamera([5.8, 5.6, 6.3], [0, 1, 0]);
  const first = addRing(kit.world, new THREE.Vector3(-.7, 0, 1), 1.7, 0x111111, 2);
  const second = addRing(kit.world, new THREE.Vector3(1.6, 0, 1), 1.35, 0xff0000, 2);
  kit.note.textContent = 'center distance d changes: separate → tangent → two intersections → contained';
  return (time) => {
    const d = 2.25 + 1.7 * Math.sin(time * .55);
    second.position.x = -.7 + d;
    first.rotation.z = 0;
  };
}

function buildPk1(kit) {
  kit.world.userData.ikLabelBackground = false;
  kit.setCamera([5.7, 4.8, 5.8], [0, 1, 0]);
  kit.world.add(makeAxis(new THREE.Vector3(), new THREE.Vector3(0, 0, 1), 4, 0x111111));
  addRing(kit.world, new THREE.Vector3(0, 0, 1), 2, 0xaaaaaa, 2);
  const p = sphere(.12, 0x3f6ea8), q = sphere(.12, 0xff0000), moving = sphere(.1, 0xd79b00);
  p.position.set(2, 0, 1);
  q.position.set(0, 2, 1);
  kit.world.add(p, q, moving);
  addLabel(kit.world, p.position.clone(), 'p');
  addLabel(kit.world, new THREE.Vector3(0, 2, 1), 'q');
  kit.note.textContent = 'PK1 · rotate p onto q · the signed orbit angle is θ';
  return (time) => {
    const theta = (Math.sin(time * .75) * .5 + .5) * Math.PI / 2;
    moving.position.set(2 * Math.cos(theta), 2 * Math.sin(theta), 1);
  };
}

function buildPk3(kit) {
  kit.world.userData.ikLabelBackground = false;
  kit.setCamera([7.5, 6, 7.7], [.6, 1.4, 0]);
  const geometry = pk3Geometry();
  const { center, p, q, radius, delta, sliceRadius, intersections } = geometry;
  addPkAxis(kit);
  addPkPoint(kit.world, p, 'p', 0xd79b00, [-.15, -.12, .3]);
  addPkPoint(kit.world, q, 'q', 0xcc3434, [-.55, -.45, .4]);
  const sweep = addPkSphereSweep(kit.world, q, delta);
  const deltaLine = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), q, delta, 0xcc3434, .13, .08);
  kit.world.add(deltaLine);
  const deltaLabel = addLabel(kit.world, q.clone().add(new THREE.Vector3(.2, 0, delta * .5)), 'δ', 0xcc3434);
  const meridian = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(Array.from({ length: 97 }, (_, i) => {
      const angle = Math.PI * i / 96;
      return new THREE.Vector3(delta * Math.sin(angle), 0, delta * Math.cos(angle));
    })),
    new THREE.LineBasicMaterial({ color: 0xcc3434 })
  );
  meridian.position.copy(q);
  kit.world.add(meridian);
  const plane = addPkPlane(kit.world, center, 7.3, 0x3f6ea8);
  const orbit = addRing(kit.world, center, radius, 0x333333, 2);
  const slice = addRing(kit.world, new THREE.Vector3(q.x, q.y, center.z), sliceRadius, 0xcc3434, 2);
  const movingLabelOffset = new THREE.Vector3(.65, .65, .65);
  const moving = addPkPoint(kit.world, p, 'R(ω, θ)p', 0x18865e, movingLabelOffset.toArray());
  const solutions = new THREE.Group();
  kit.world.add(solutions);
  intersections.forEach((point, i) => addPkPoint(solutions, point, `θ${i ? '⁻' : '⁺'}`, 0x3f6ea8,
    i ? [-.1, -.3, .3] : [.45, .45, -.3]));
  const distance = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), q, delta, 0x18865e, .1, .06);
  kit.world.add(distance);
  const thetaTarget = Math.atan2(intersections[0].y, intersections[0].x) - Math.PI;
  return addPkPlayback(kit, 17, (time) => {
    const radiusProgress = pkProgress(time, 1, 2.4);
    const polarProgress = pkProgress(time, 2.4, 4.5);
    const sweepProgress = pkProgress(time, 4.5, 7.5);
    const phi = sweepProgress * 2 * Math.PI;
    const polar = time <= 4.5 ? polarProgress * Math.PI
      : Math.PI * (1 - .5 * pkProgress(time, 4.5, 5));
    const direction = new THREE.Vector3(Math.sin(polar) * Math.cos(phi), Math.sin(polar) * Math.sin(phi), Math.cos(polar));
    deltaLine.visible = time >= 1 && time < 7.5;
    deltaLine.setDirection(direction);
    deltaLine.setLength(Math.max(.001, radiusProgress * delta), .13, .08);
    deltaLabel.userData.ikLabelAuthoredVisible = deltaLine.visible;
    deltaLabel.position.copy(q).addScaledVector(direction, radiusProgress * delta * .5).add(new THREE.Vector3(.2, 0, 0));
    meridian.visible = time >= 2.4 && time < 7.5;
    meridian.geometry.setDrawRange(0, Math.max(2, Math.floor(polarProgress * 97)));
    meridian.rotation.z = phi;
    sweep.setProgress(sweepProgress);
    const theta = thetaTarget * pkProgress(time, 7.5, 11);
    moving.group.visible = time >= 7.5;
    moving.marker.position.copy(p).applyAxisAngle(new THREE.Vector3(0, 0, 1), theta);
    moving.label.position.copy(moving.marker.position).add(movingLabelOffset);
    orbit.visible = time >= 7.5;
    plane.visible = time >= 11;
    plane.material.opacity = .075 * pkProgress(time, 11, 12);
    slice.visible = time >= 12;
    solutions.visible = time >= 13;
    distance.visible = time >= 13;
    distance.setDirection(intersections[0].clone().sub(q).normalize());
    kit.note.textContent = time < 1 ? '1 · Start with p, q and the rotation axis ω.'
      : time < 2.4 ? '2 · Draw a radius of length δ from q.'
      : time < 7.5 ? '3 · Sweep that radius through all directions to form the distance sphere.'
      : time < 11 ? `4 · Rotate p about ω: θ = ${fixed(theta / DEG, 1)}°. Its orbit is a circle.`
      : time < 13 ? '5 · Slice the sphere with the orbit plane. Its red section is a second circle.'
      : '6 · Both blue intersections solve: how much must I rotate p about ω to be δ away from q?';
  });
}

// Slides 40 and 41 use the same off-plane distance center. The planar
// distance radius must be sqrt(delta² - h²), not the sphere radius delta.
function pk3Geometry() {
  const center = new THREE.Vector3(0, 0, 1);
  const q = new THREE.Vector3(1.9, 0, 1.8);
  const p = new THREE.Vector3(-2.1, 0, 1);
  const radius = 2.1;
  const sliceRadius = 1.55;
  const h = q.z - center.z;
  const delta = Math.hypot(sliceRadius, h);
  const x = (radius ** 2 - sliceRadius ** 2 + q.x ** 2) / (2 * q.x);
  const y = Math.sqrt(radius ** 2 - x ** 2);
  return { center, q, p, radius, sliceRadius, h, delta,
    intersections: [new THREE.Vector3(x, y, center.z), new THREE.Vector3(x, -y, center.z)] };
}

function buildPk3Reduction(kit) {
  kit.world.userData.ikLabelBackground = false;
  kit.setCamera([7.5, 6, 7.7], [.6, 1.4, 0]);
  const { center, p, q, radius, delta, sliceRadius, h, intersections } = pk3Geometry();
  addPkAxis(kit);
  addPkPoint(kit.world, p, 'p', 0xd79b00, [-.15, -.12, .3]);
  addPkPoint(kit.world, q, 'q', 0xcc3434, [-.55, -.45, .4]);
  addRing(kit.world, center, radius, 0x333333, 2);
  const sweep = addPkSphereSweep(kit.world, q, delta);
  sweep.setProgress(1);
  const plane = addPkPlane(kit.world, center, 7.3, 0x3f6ea8);
  const section = addRing(kit.world, q, 1, 0xcc3434, 2);
  const projected = new THREE.Vector3(q.x, q.y, center.z);
  const projection = addPkPoint(kit.world, projected, 'qΠ', 0x3f6ea8, [.45, .45, -.35]);
  const triangle = new THREE.Group();
  kit.world.add(triangle);
  const radiusEnd = projected.clone().add(new THREE.Vector3(0, sliceRadius, 0));
  const heightDimension = addDimension(triangle, q, projected, 'h', 0x777777);
  const planarDimension = addDimension(triangle, projected, radiusEnd, 'δ⊥', 0x3f6ea8);
  const distanceDimension = addDimension(triangle, q, radiusEnd, 'δ', 0xcc3434);
  heightDimension.userData.dimensionLabel.position.add(new THREE.Vector3(-.35, -.35, 0));
  planarDimension.userData.dimensionLabel.position.add(new THREE.Vector3(.3, .3, -.25));
  distanceDimension.userData.dimensionLabel.position.add(new THREE.Vector3(.45, .45, .45));
  const corners = [projected.clone().add(new THREE.Vector3(0, .15, 0)),
    projected.clone().add(new THREE.Vector3(0, .15, .15)),
    projected.clone().add(new THREE.Vector3(0, 0, .15))];
  triangle.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(corners), new THREE.LineBasicMaterial({ color: 0x777777 })));
  const candidates = new THREE.Group();
  kit.world.add(candidates);
  intersections.forEach((point) => {
    const marker = sphere(.12, 0x18865e);
    marker.position.copy(point);
    candidates.add(marker);
  });
  return addPkPlayback(kit, 14, (time) => {
    const level = THREE.MathUtils.lerp(q.z + delta + .3, center.z, pkProgress(time, 1, 6));
    plane.position.z = level;
    const squaredRadius = delta ** 2 - (level - q.z) ** 2;
    section.visible = squaredRadius > 0;
    section.position.set(q.x, q.y, level);
    section.scale.setScalar(Math.sqrt(Math.max(.000001, squaredRadius)));
    projection.group.visible = time >= 6;
    triangle.visible = time >= 7;
    candidates.visible = time >= 10;
    // Fade the full sphere to emphasize its exact section; never flatten it.
    sweep.mesh.material.opacity = .14 - .115 * pkProgress(time, 8, 10);
    kit.note.textContent = time < 1 ? '1 · The distance constraint is a sphere centered at q with radius δ.'
      : time < 6 ? '2 · Move a transparent plane through the sphere until it reaches the fixed orbit plane Π.'
      : time < 7 ? '3 · Project q onto Π: qΠ is the center of the red section circle.'
      : time < 10 ? `4 · A right triangle gives δ⊥² = δ² − h²: h = ${fixed(h, 2)}, δ⊥ = ${fixed(sliceRadius, 2)}.`
      : '5 · Keep the planar section. Its intersections with the black orbit give the two angles.';
  });
}

function addPkAxis(kit) {
  kit.world.add(makeAxis(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, 1), 5.2, 0x111111));
  addLabel(kit.world, new THREE.Vector3(-.2, 0, 3.5), 'ω');
}

function addPkPoint(parent, position, text, color, offset) {
  const group = new THREE.Group();
  parent.add(group);
  const marker = sphere(.12, color);
  marker.position.copy(position);
  group.add(marker);
  const label = addLabel(group, position.clone().add(new THREE.Vector3(...offset)), text, color);
  label.scale.multiplyScalar(.8);
  return { group, marker, label };
}

function addPkPlane(parent, center, width, color) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, width * .76),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .075, side: THREE.DoubleSide, depthWrite: false }));
  mesh.position.copy(center);
  parent.add(mesh);
  return mesh;
}

function addPkSphereSweep(parent, center, radius) {
  const longitudes = 48, latitudes = 24;
  const positions = [], indices = [];
  for (let i = 0; i <= longitudes; i += 1) {
    const phi = i / longitudes * 2 * Math.PI;
    for (let j = 0; j <= latitudes; j += 1) {
      const theta = j / latitudes * Math.PI;
      positions.push(radius * Math.sin(theta) * Math.cos(phi), radius * Math.sin(theta) * Math.sin(phi), radius * Math.cos(theta));
    }
  }
  for (let i = 0; i < longitudes; i += 1) {
    for (let j = 0; j < latitudes; j += 1) {
      const a = i * (latitudes + 1) + j, b = a + latitudes + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
    color: 0xcc3434, transparent: true, opacity: .14, side: THREE.DoubleSide, depthWrite: false
  }));
  mesh.position.copy(center);
  parent.add(mesh);
  return { mesh, setProgress(progress) {
    mesh.visible = progress > 0;
    geometry.setDrawRange(0, Math.ceil(progress * longitudes) * latitudes * 6);
  } };
}

function pkProgress(time, start, end) {
  return THREE.MathUtils.smoothstep(time, start, end);
}

function addPkPlayback(kit, duration, draw) {
  let elapsed = 0, paused = false;
  const pause = document.createElement('button');
  pause.type = 'button';
  pause.className = 'ik3r-label-select';
  pause.textContent = 'Pause';
  pause.setAttribute('aria-label', 'Pause scene animation');
  const replay = document.createElement('button');
  replay.type = 'button';
  replay.className = 'ik3r-label-select';
  replay.textContent = 'Replay';
  replay.setAttribute('aria-label', 'Replay scene animation');
  const toggle = () => {
    paused = !paused;
    pause.textContent = paused ? 'Play' : 'Pause';
    pause.setAttribute('aria-label', paused ? 'Play scene animation' : 'Pause scene animation');
  };
  const restart = () => {
    elapsed = 0;
    paused = false;
    pause.textContent = 'Pause';
    pause.setAttribute('aria-label', 'Pause scene animation');
    draw(0);
  };
  pause.addEventListener('click', toggle);
  replay.addEventListener('click', restart);
  kit.cleaners.push(() => { pause.removeEventListener('click', toggle); replay.removeEventListener('click', restart); });
  kit.controlHost.append(pause, replay);
  draw(0);
  return (_time, dt) => {
    if (paused || elapsed >= duration) return;
    elapsed = Math.min(duration, elapsed + dt);
    draw(elapsed);
  };
}

async function buildPk3Ik(kit) {
  kit.setCamera([7.2, 6.2, 6.4], [1.35, .8, 1.15]);
  const model = zeroRobotModel();
  const targetQ = ZERO_TARGET_Q_DEG.map((angle) => angle * DEG);
  const targetPose = zeroPrefixMatrix(targetQ, 3);
  const targetPoint = model.homeTool.clone().applyMatrix4(targetPose);
  const c = model.axisPoints[1];
  const axis3Point = model.axisPoints[2];
  const orbitCenter = axis3Point.clone().add(new THREE.Vector3(0, 0, .75));
  const orbitRadius = 1.5;
  const delta = targetPoint.distanceTo(c);
  const roots = [-170, -125.9892335838].map((angle) => angle * DEG);
  const robot = await createZeroRobot(kit.world, [0, 0, 0], { opacity: .86 });

  kit.world.add(makeAxis(c, model.axes[0], 3.9, 0x111111));
  kit.world.add(makeAxis(c, model.axes[1], 4.3, 0xff0000));
  const axis3Line = makeAxis(axis3Point, model.axes[2], 3.3, 0x777777);
  kit.world.add(axis3Line);
  const orbit = addRing(kit.world, orbitCenter, orbitRadius, 0x111111, 2);
  const distanceSphere = addWireSphere(kit.world, c, delta, 0xff0000);
  addLabel(kit.world, c.clone().add(new THREE.Vector3(-.25, -.25, .22)), 'c = (0,0,1)', 0x3f6ea8);
  const axis3Label = addLabel(kit.world, axis3Point.clone().add(new THREE.Vector3(.15, .12, 1.45)), 'joint-3 axis');
  axis3Label.userData.ikLabelAuthoredVisible = false;
  axis3Label.visible = false;
  const targetMarker = sphere(.12, 0x18865e);
  targetMarker.position.copy(targetPoint);
  kit.world.add(targetMarker);
  const targetLabel = addLabel(kit.world, targetPoint.clone().add(new THREE.Vector3(-.5, .45, .65)), 'p_d sets δ', 0x18865e);
  const deltaDimension = addDimension(kit.world, c, targetPoint, `δ = ${fixed(delta, 3)} m`, 0x18865e);

  const candidateGroup = new THREE.Group();
  kit.world.add(candidateGroup);
  const candidates = roots.map((angle, index) => {
    const point = model.homeTool.clone().applyMatrix4(expRevolute(model.axes[2], axis3Point, angle));
    const marker = sphere(.13, 0x3f6ea8);
    marker.position.copy(point);
    candidateGroup.add(marker);
    const offset = index
      ? new THREE.Vector3(.38, -.18, -.18)
      : new THREE.Vector3(-.28, .16, .52);
    addLabel(candidateGroup, point.clone().add(offset), `θ₃${index ? '⁻' : '⁺'} = ${fixed(angle / DEG, 1)}°`, 0x3f6ea8);
    return marker;
  });
  const toolMarker = sphere(.105, 0xd79b00);
  kit.world.add(toolMarker);
  const toolLabel = addLabel(kit.world, model.homeTool.clone().add(new THREE.Vector3(.16, .12, .3)), 'p(θ₃)', 0xd79b00);
  toolLabel.userData.ikLabelAuthoredVisible = false;
  toolLabel.visible = false;
  let lastStage = '';
  let startTime;
  return (time) => {
    if (startTime === undefined) startTime = time;
    const phase = (time - startTime) % 12;
    const sphereProgress = THREE.MathUtils.smoothstep(Math.min(phase / 2.4, 1), 0, 1);
    const rotating = phase >= 6;
    const rotateProgress = phase < 6 ? 0 : phase < 10
      ? THREE.MathUtils.smoothstep((phase - 6) / 4, 0, 1)
      : 1;
    const theta3 = roots[0] * rotateProgress;
    const stage = phase < 3 ? '1 · Build the sphere: δ = ||p_d − c|| = 1.347 m.'
      : phase < 6 ? '2 · Reveal the robot at θ₃ = 0: the orange tool point is p.'
      : phase < 10 ? `3 · Rotate joint 3: θ₃ = ${fixed(theta3 / DEG, 1)}°.`
      : '3 · p has reached the blue circle–sphere intersection: θ₃ = −170°.';
    if (stage !== lastStage) {
      kit.note.textContent = stage;
      lastStage = stage;
    }
    distanceSphere.scale.setScalar(Math.max(.001, sphereProgress));
    robot.group.visible = phase >= 3;
    axis3Line.visible = phase >= 3;
    axis3Label.userData.ikLabelAuthoredVisible = phase >= 3;
    orbit.visible = rotating;
    candidateGroup.visible = rotating;
    toolMarker.visible = phase >= 3;
    toolLabel.userData.ikLabelAuthoredVisible = phase >= 3;
    targetMarker.visible = phase < 3 || phase >= 10;
    targetLabel.userData.ikLabelAuthoredVisible = phase < 3;
    deltaDimension.visible = phase < 3;
    robot.update([0, 0, theta3]);
    toolMarker.position.copy(model.homeTool).applyMatrix4(expRevolute(model.axes[2], axis3Point, theta3));
    toolLabel.position.copy(toolMarker.position).add(new THREE.Vector3(.16, .12, .3));
    const pulse = 1 + .12 * Math.sin(time * 3);
    candidates[0].scale.setScalar(pulse);
    candidates[1].scale.setScalar(2 - pulse);
  };
}

async function buildPk2Branch(kit, branch) {
  kit.setCamera([7.1, 5.8, 6.3], [1.25, .7, 1.05]);
  const solutionSets = {
    a: [
      [-144.280191892629, -108.143491292260, -125.989233583833],
      [31.799947787715, -4.171947158659, -125.989233583833]
    ],
    b: [
      [-77.480244104914, -59.756939433423, -170],
      [-35, -10, -170]
    ]
  };
  const solutions = solutionSets[branch].map((q) => q.map((angle) => angle * DEG));
  const palettes = [
    [0x333638, 0x3f6ea8, 0x94acd0, 0x3f6ea8],
    [0x333638, 0xd79b00, 0xe6c06c, 0xd79b00]
  ];
  const robots = await Promise.all(solutions.map((q, index) => createZeroRobot(kit.world, q, {
    opacity: .62,
    colors: palettes[index]
  })));
  const model = zeroRobotModel();
  const targetQ = ZERO_TARGET_Q_DEG.map((angle) => angle * DEG);
  const targetPoint = model.homeTool.clone().applyMatrix4(zeroPrefixMatrix(targetQ, 3));
  const target = sphere(.15, 0x18865e);
  target.position.copy(targetPoint);
  kit.world.add(target);
  addLabel(kit.world, targetPoint.clone().add(new THREE.Vector3(.15, .12, .35)), 'common p_d', 0x18865e);
  robots.forEach((robot, index) => addRobotVisibilityToggle(kit, robot.group, index ? 'E > 0' : 'E < 0', true));
  kit.note.textContent = branch === 'a'
    ? 'θ₃ = −125.989° · blue: E < 0; orange: E > 0. Both reach the green target.'
    : 'θ₃ = −170.000° · blue: E < 0; orange: E > 0. Both reach the green target.';
  return () => robots.forEach((robot, index) => robot.update(solutions[index]));
}

function buildPk2Geometry(kit) {
  kit.setCamera([5.8, 5.4, 5.8], [.2, .75, 1.45]);
  const c = new THREE.Vector3(0, 0, 1);
  const w1 = new THREE.Vector3(0, 0, 1);
  const w2 = new THREE.Vector3(0, 1, 0);
  const q = new THREE.Vector3(.88262378, .58997049, .82938706);
  const t = new THREE.Vector3(.52278837, .98952773, .75);
  const radius = q.length();
  const eta = w2.dot(t);
  const zeta = w1.dot(q);
  const circle2Center = c.clone().addScaledVector(w2, eta);
  const circle1Center = c.clone().addScaledVector(w1, zeta);
  const circle2Radius = Math.sqrt(Math.max(0, radius ** 2 - eta ** 2));
  const circle1Radius = Math.sqrt(Math.max(0, radius ** 2 - zeta ** 2));
  const gamma = Math.sqrt(Math.max(0, radius ** 2 - eta ** 2 - zeta ** 2));

  addWireSphere(kit.world, c, radius, 0x888888);
  addDiscInPlane(kit.world, circle2Center, circle2Radius, w2, 0x3f6ea8);
  addDiscInPlane(kit.world, circle1Center, circle1Radius, w1, 0xd79b00);
  addRingInPlane(kit.world, circle2Center, circle2Radius, w2, 0x3f6ea8, 2);
  addRingInPlane(kit.world, circle1Center, circle1Radius, w1, 0xd79b00, 2);
  kit.world.add(makeAxis(c, w1, 3.6, 0x111111));
  kit.world.add(makeAxis(c, w2, 3.9, 0xff0000));

  const centerMarker = sphere(.09, 0x111111);
  centerMarker.position.copy(c);
  const tMarker = sphere(.12, 0x3f6ea8);
  tMarker.position.copy(c).add(t);
  const qMarker = sphere(.12, 0x18865e);
  qMarker.position.copy(c).add(q);
  kit.world.add(centerMarker, tMarker, qMarker);
  addLabel(kit.world, c.clone().add(new THREE.Vector3(-.22, -.22, .18)), 'c');
  addLabel(kit.world, tMarker.position.clone().add(new THREE.Vector3(.62, .2, -.42)), 't(θ₃)', 0x3f6ea8);
  addLabel(kit.world, qMarker.position.clone().add(new THREE.Vector3(.7, -.5, .62)), 'p_d', 0x18865e);

  [-1, 1].forEach((sign) => {
    const point = c.clone().add(new THREE.Vector3(sign * gamma, eta, zeta));
    const marker = sphere(.13, 0xff0000);
    marker.position.copy(point);
    kit.world.add(marker);
  });
  addLabel(
    kit.world,
    c.clone().add(new THREE.Vector3(-.78, eta + .24, zeta + .72)),
    'x₊ , x₋ · intersections',
    0xff0000
  );
  kit.note.textContent = 'PK2 · blue C₂ is the joint-2 orbit through t; orange C₁ is the inverse joint-1 orbit through p_d; red points are x±';
  return () => {};
}

async function buildIntersecting(kit) {
  kit.setCamera([7.1, 5.8, 6.3], [1.25, .75, 1]);
  const model = zeroRobotModel();
  const robot = await createZeroRobot(kit.world, [0, 0, 0]);
  const c = model.axisPoints[1];
  kit.world.add(makeAxis(c, model.axes[0], 4, 0x111111));
  kit.world.add(makeAxis(c, model.axes[1], 4.5, 0xff0000));
  const marker = sphere(.13, 0x3f6ea8);
  marker.position.copy(c);
  kit.world.add(marker);
  addLabel(kit.world, c.clone().add(new THREE.Vector3(.12, .12, .24)), 'c = (0,0,1) m', 0x3f6ea8);
  addLabel(kit.world, c.clone().add(new THREE.Vector3(0, 1.7, .15)), 'joint 2 · ω₂ = eᵧ', 0xff0000);
  addLabel(kit.world, c.clone().add(new THREE.Vector3(.15, 0, 1.7)), 'joint 1 · ω₁ = e_z');
  kit.note.textContent = 'custom_3R_new_0.urdf · joint axes 1 and 2 intersect at c, hence a₁ = 0';
  return () => robot.update([0, 0, 0]);
}

async function buildPipeline(kit) {
  kit.setCamera([7.2, 5.4, 6.6]);
  const robot = await createRobot(kit.world, [0, 0, 0]);
  addTarget(kit.world, ikExample.eePosition, 'p_d');
  const q = [0, 0, 0];
  kit.note.textContent = `One branch is reconstructed in elimination order: θ₃ = ${TARGET_Q_DEG[2]}° → θ₂ = ${TARGET_Q_DEG[1]}° → θ₁ = ${TARGET_Q_DEG[0]}°.`;
  return (time, dt) => {
    const phase = time % 9;
    const desired = [0, 0, 0];
    if (phase > 1) desired[2] = ikExample.targetQ[2] * Math.min(1, phase - 1);
    if (phase > 3.3) desired[1] = ikExample.targetQ[1] * Math.min(1, phase - 3.3);
    if (phase > 5.6) desired[0] = ikExample.targetQ[0] * Math.min(1, phase - 5.6);
    q.forEach((_, i) => { q[i] += (desired[i] - q[i]) * Math.min(1, 7 * dt); });
    robot.update(q);
  };
}

function projectToAxis(point, axisPoint, axis) {
  return axisPoint.clone().addScaledVector(axis, point.clone().sub(axisPoint).dot(axis));
}

function cgaCircleData(targetOverride, solutionsOverride) {
  const { axes, axisPoints, homeTool } = robotModel;
  const target = targetOverride?.clone() || ikExample.eePosition.clone().add(new THREE.Vector3(0, 0, CGA_TARGET_Z_OFFSET));
  const solutions = solutionsOverride || CGA_IK_SOLUTION_DEG.map((q) => q.map((angle) => angle * DEG));
  const fixedCenter = projectToAxis(target, axisPoints[0], axes[0]);
  const homeCenter = projectToAxis(homeTool, axisPoints[2], axes[2]);
  const fixedRadius = target.distanceTo(fixedCenter);
  const homeRadius = homeTool.distanceTo(homeCenter);
  const branches = solutions.map((q) => {
    const inverseJoint1 = expRevolute(axes[0], axisPoints[0], -q[0]);
    const joint2 = expRevolute(axes[1], axisPoints[1], q[1]);
    const inverseJoint2 = expRevolute(axes[1], axisPoints[1], -q[1]);
    const branch = {
      q,
      intersection: target.clone().applyMatrix4(inverseJoint1),
      reversedPoint: target.clone().applyMatrix4(inverseJoint1).applyMatrix4(inverseJoint2),
      movingCenter: homeCenter.clone().applyMatrix4(joint2),
      movingNormal: axes[2].clone().transformDirection(joint2)
    };
    const expectedAfterJoint3 = homeTool.clone().applyMatrix4(expRevolute(axes[2], axisPoints[2], q[2]));
    const fixedCircleError = Math.abs(branch.intersection.distanceTo(fixedCenter) - fixedRadius);
    const movingCircleError = Math.abs(branch.intersection.distanceTo(branch.movingCenter) - homeRadius);
    const movingPlaneError = Math.abs(branch.intersection.clone().sub(branch.movingCenter).dot(branch.movingNormal));
    const reverseError = branch.reversedPoint.distanceTo(expectedAfterJoint3);
    if (Math.max(fixedCircleError, movingCircleError, movingPlaneError, reverseError) > 1e-5) {
      throw new Error('CGA circle construction is inconsistent with an IK branch.');
    }
    return branch;
  });
  return {
    target, fixedCenter, fixedRadius, fixedNormal: axes[0],
    homePoint: homeTool.clone(), homeCenter, homeRadius, homeNormal: axes[2], branches
  };
}

function addCgaCircle(world, center, radius, normal, color, label, labelOffset = new THREE.Vector3(.1, .1, .22)) {
  addDiscInPlane(world, center, radius, normal, color);
  const ring = addRingInPlane(world, center, radius, normal, color, 2);
  if (label) addLabel(world, center.clone().add(labelOffset), label, color);
  return ring;
}

function addPointMarker(world, point, color, label, offset = new THREE.Vector3(.1, .1, .25)) {
  const marker = new THREE.Group();
  marker.add(sphere(.105, color));
  marker.position.copy(point);
  world.add(marker);
  if (label) addLabel(marker, offset, label, color);
  return marker;
}

function addCgaTarget(world, point) {
  const marker = new THREE.Group();
  const color = 0xb5179e;
  marker.add(new THREE.Mesh(
    new THREE.OctahedronGeometry(.17),
    new THREE.MeshStandardMaterial({ color, roughness: .4 })
  ));
  marker.position.copy(point);
  marker.userData.isCgaTarget = true;
  addLabel(marker, new THREE.Vector3(.1, .1, .3), 'p_d', color);
  world.add(marker);
  return marker;
}

async function buildCgaCircles(kit) {
  await loadRobotModel();
  kit.setCamera([8.1, 6.3, 6.7], [1.7, .7, 1.15]);
  const robot = await createRobot(kit.world, [0, 0, 0], { opacity: .78 });
  const data = cgaCircleData();
  addCgaCircle(kit.world, data.fixedCenter, data.fixedRadius, data.fixedNormal, 0xe85d04, 'C_B · fixed');
  addCgaCircle(kit.world, data.homeCenter, data.homeRadius, data.homeNormal, 0x2775ff, 'C_A · home');
  addCgaTarget(kit.world, data.target);
  addPointMarker(kit.world, data.homePoint, 0x2775ff, 'p');
  kit.world.add(makeAxis(robotModel.axisPoints[0], robotModel.axes[0], 4.7, 0xe85d04));
  kit.world.add(makeAxis(robotModel.axisPoints[2], robotModel.axes[2], 3.5, 0x2775ff));
  addLabel(kit.world, robotModel.axisPoints[0].clone().addScaledVector(robotModel.axes[0], 1.85), 'ω₁', 0xe85d04);
  addLabel(kit.world, robotModel.axisPoints[2].clone().addScaledVector(robotModel.axes[2], 1.45), 'ω₃', 0x2775ff);
  kit.note.textContent = 'Orange C_B is the joint-1 orbit through p_d; blue C_A is the joint-3 orbit through the home tool point p.';
  return () => robot.update([0, 0, 0]);
}

async function buildCgaCircleMotion(kit) {
  await loadRobotModel();
  kit.setCamera([9.4, 7.3, 8.2], [1.55, 1.55, 1.55]);
  const data = cgaCircleData();
  const robot = await createRobot(kit.world, [0, 0, 0], { opacity: .38 });
  addCgaCircle(kit.world, data.fixedCenter, data.fixedRadius, data.fixedNormal, 0xe85d04, 'C_B');
  addCgaTarget(kit.world, data.target);
  kit.world.add(makeAxis(robotModel.axisPoints[1], robotModel.axes[1], 5, 0x111111));
  addLabel(kit.world, robotModel.axisPoints[1].clone().addScaledVector(robotModel.axes[1], 2), 'ω₂');
  const moving = new THREE.Group();
  moving.matrixAutoUpdate = false;
  kit.world.add(moving);
  addCgaCircle(moving, data.homeCenter, data.homeRadius, data.homeNormal, 0x2775ff, 'C_A(θ₂)');
  const hits = data.branches.map((branch, index) => {
    const marker = addPointMarker(kit.world, branch.intersection, 0xff0000, null);
    marker.visible = false;
    return marker;
  });
  const readout = document.createElement('output');
  readout.className = 'ik3r-cga-joint-readout';
  readout.setAttribute('aria-label', 'Moving circle joint 2 angle');
  readout.value = 'θ₂ = 0.0° · home';
  kit.container.appendChild(readout);
  kit.cleaners.push(() => readout.remove());
  let elapsed = 0;
  kit.note.textContent = 'C_A starts at its home position (θ₂ = 0°). As it rotates, red spheres mark its intersections with C_B; p_d is the magenta diamond.';
  return (_time, dt) => {
    elapsed += dt;
    // Hold home first; sweep in the negative direction to encounter the two
    // branches, then wrap continuously to home after one full revolution.
    const travelled = Math.max(0, elapsed - 1.2) * .42;
    const angle = Math.atan2(Math.sin(-travelled), Math.cos(-travelled));
    readout.value = `θ₂ = ${fixed(angle / DEG, 1)}°${elapsed <= 1.2 ? ' · home' : ''}`;
    moving.matrix.copy(expRevolute(robotModel.axes[1], robotModel.axisPoints[1], angle));
    moving.matrixWorldNeedsUpdate = true;
    hits.forEach((marker, index) => {
      const error = Math.abs(Math.atan2(
        Math.sin(angle - data.branches[index].q[1]),
        Math.cos(angle - data.branches[index].q[1])
      ));
      marker.visible = error < 5 * DEG;
      marker.scale.setScalar(1 + .35 * Math.max(0, 1 - error / (5 * DEG)));
    });
    robot.update([0, 0, 0]);
  };
}

async function buildCgaFourTheta2(kit) {
  await loadRobotModel();
  kit.setCamera([9.4, 7.5, 8.2], [1.55, .65, 1.55]);
  const data = cgaCircleData();
  await createRobot(kit.world, [0, 0, 0], { opacity: .18 });
  addCgaCircle(kit.world, data.fixedCenter, data.fixedRadius, data.fixedNormal, 0xe85d04, 'C_B');
  addCgaTarget(kit.world, data.target);
  const moving = new THREE.Group();
  moving.matrixAutoUpdate = false;
  kit.world.add(moving);
  addCgaCircle(moving, data.homeCenter, data.homeRadius, data.homeNormal, 0x2775ff, 'chosen C_A(θ₂)');
  const hit = addPointMarker(kit.world, data.branches[0].intersection, 0xff0000, 'chosen x');
  let selected = 0;
  let startedAt = performance.now() / 1000;
  addCgaBranchSelect(kit, data.branches, (index) => {
    selected = index;
    startedAt = performance.now() / 1000;
    hit.position.copy(data.branches[index].intersection);
  });
  kit.note.textContent = 'Choose an IK circle. The blue home circle then rotates by its θ₂ until it meets the selected point on C_B.';
  return (time) => {
    const progress = smoothStep(Math.min(1, Math.max(0, (time - startedAt) / 2.8)));
    const angle = data.branches[selected].q[1] * progress;
    moving.matrix.copy(expRevolute(robotModel.axes[1], robotModel.axisPoints[1], angle));
    moving.matrixWorldNeedsUpdate = true;
  };
}

async function buildCgaBacksolve(kit) {
  await loadRobotModel();
  kit.setCamera([8.3, 6.1, 6.8], [1.7, .65, 1.1]);
  const data = cgaCircleData();
  const robot = await createRobot(kit.world, [0, 0, 0], { opacity: .82 });
  addCgaCircle(kit.world, data.fixedCenter, data.fixedRadius, data.fixedNormal, 0xe85d04, 'C_B');
  addCgaTarget(kit.world, data.target);
  addPointMarker(kit.world, data.homePoint, 0x2775ff, 'p');
  const movingCircle = new THREE.Group();
  movingCircle.matrixAutoUpdate = false;
  kit.world.add(movingCircle);
  addCgaCircle(movingCircle, data.homeCenter, data.homeRadius, data.homeNormal, 0x00a676, 'C_A carried back');
  const movingMarker = addPointMarker(kit.world, data.branches[0].intersection, 0x111111, 'dragged x');
  let selected = 0;
  let startedAt = performance.now() / 1000;
  addCgaBranchSelect(kit, data.branches, (index) => {
    selected = index;
    startedAt = performance.now() / 1000;
  });
  kit.note.textContent = 'Start at the selected intersection. Apply -θ₂ to the whole circle and x; then rotate p about ω₃ until it reaches the dragged point.';
  return (time) => {
    const branch = data.branches[selected];
    const phase = (time - startedAt) % 10;
    const reversePhase = smoothStep((phase - 1) / 3);
    const circleAngle = branch.q[1] * (1 - reversePhase);
    movingCircle.matrix.copy(expRevolute(robotModel.axes[1], robotModel.axisPoints[1], circleAngle));
    movingCircle.matrixWorldNeedsUpdate = true;
    movingMarker.position.copy(branch.intersection)
      .applyMatrix4(expRevolute(robotModel.axes[1], robotModel.axisPoints[1], -branch.q[1] * reversePhase));
    const q3Phase = smoothStep((phase - 5) / 2.6);
    robot.update([0, 0, branch.q[2] * q3Phase]);
  };
}

async function buildCgaForward(kit) {
  await loadRobotModel();
  kit.setCamera([9.4, 7.2, 8], [1.6, .65, 1.5]);
  const data = cgaCircleData();
  const robot = await createRobot(kit.world, [0, 0, 0]);
  addCgaCircle(kit.world, data.fixedCenter, data.fixedRadius, data.fixedNormal, 0xe85d04, 'C_B');
  addCgaCircle(kit.world, data.homeCenter, data.homeRadius, data.homeNormal, 0x2775ff, 'C_A · home');
  const carriedCircle = new THREE.Group();
  carriedCircle.matrixAutoUpdate = false;
  carriedCircle.visible = false;
  kit.world.add(carriedCircle);
  addCgaCircle(carriedCircle, data.homeCenter, data.homeRadius, data.homeNormal, 0x00a676, 'duplicate C_A');
  const hit = addPointMarker(kit.world, data.branches[0].intersection, 0x00a676, 'x');
  addCgaTarget(kit.world, data.target);
  const eeMarker = addPointMarker(kit.world, data.homePoint, 0x111111, 'tool');
  let selected = 0;
  let startedAt = performance.now() / 1000;
  addCgaBranchSelect(kit, data.branches, (index) => {
    selected = index;
    startedAt = performance.now() / 1000;
    hit.position.copy(data.branches[index].intersection);
  });
  kit.note.textContent = 'Animated values are shown in order: θ₃ on C_A, θ₂ carrying a duplicate of C_A to x, then θ₁ carrying x to p_d.';
  return (time) => {
    const branch = data.branches[selected];
    const phase = (time - startedAt) % 10;
    const q3 = branch.q[2] * smoothStep((phase - .7) / 2.1);
    const q2Progress = smoothStep((phase - 3.5) / 2);
    const q2 = branch.q[1] * q2Progress;
    const q1 = branch.q[0] * smoothStep((phase - 6.2) / 1.9);
    carriedCircle.visible = phase >= 3.15;
    carriedCircle.matrix.copy(expRevolute(robotModel.axes[1], robotModel.axisPoints[1], q2));
    carriedCircle.matrixWorldNeedsUpdate = true;
    robot.update([q1, q2, q3]);
    eeMarker.position.copy(forwardPosition(robotModel, [q1, q2, q3]));
    const degrees = [q3, q2, q1].map((angle) => `${fixed(angle / DEG, 1)}°`);
    kit.note.textContent = `θ₃ = ${degrees[0]}  →  θ₂ = ${degrees[1]}  →  θ₁ = ${degrees[2]}`;
  };
}

function smoothStep(value) {
  const u = Math.max(0, Math.min(1, value));
  return u * u * (3 - 2 * u);
}

function addCgaBranchSelect(kit, branches, onChange) {
  const label = document.createElement('span');
  label.className = 'ik3r-control-label';
  label.textContent = 'Circle';
  const select = document.createElement('select');
  select.className = 'ik3r-label-select';
  select.setAttribute('aria-label', 'Choose IK circle');
  branches.forEach((branch, index) => {
    const option = document.createElement('option');
    option.value = index;
    option.textContent = `IK ${index + 1} · θ₂ ${fixed(branch.q[1] / DEG, 1)}°`;
    select.appendChild(option);
  });
  const update = () => onChange(Number(select.value));
  select.addEventListener('change', update);
  kit.cleaners.push(() => select.removeEventListener('change', update));
  kit.controlHost.append(label, select);
  return select;
}

function solvePositionIk(target) {
  const seeds = [-135, -45, 45, 135].map((angle) => angle * DEG);
  const solutions = [];
  const wrap = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle));
  const residual = (q) => forwardPosition(robotModel, q).sub(target);
  for (const q1 of seeds) for (const q2 of seeds) for (const q3 of seeds) {
    const q = [q1, q2, q3];
    for (let iteration = 0; iteration < 34; iteration += 1) {
      const f = residual(q);
      if (f.length() < 1e-8) break;
      const h = 1e-5;
      const columns = q.map((_, index) => {
        const plus = q.slice(), minus = q.slice();
        plus[index] += h;
        minus[index] -= h;
        return forwardPosition(robotModel, plus).sub(forwardPosition(robotModel, minus)).multiplyScalar(.5 / h);
      });
      const jacobian = new THREE.Matrix3().set(
        columns[0].x, columns[1].x, columns[2].x,
        columns[0].y, columns[1].y, columns[2].y,
        columns[0].z, columns[1].z, columns[2].z
      );
      if (Math.abs(jacobian.determinant()) < 1e-9) break;
      const delta = f.clone().multiplyScalar(-1).applyMatrix3(jacobian.clone().invert());
      if (delta.length() > .55) delta.setLength(.55);
      q[0] = wrap(q[0] + delta.x);
      q[1] = wrap(q[1] + delta.y);
      q[2] = wrap(q[2] + delta.z);
    }
    if (residual(q).length() < 2e-6 && !solutions.some((candidate) =>
      Math.hypot(...q.map((angle, index) => wrap(angle - candidate[index]))) < 2e-4)) {
      solutions.push(q.slice());
    }
  }
  return solutions.sort((a, b) => a[1] - b[1]);
}

export async function solveCustom3RPositionIk(position) {
  await loadRobotModel();
  const target = position?.isVector3 ? position.clone() : new THREE.Vector3(...position);
  return solvePositionIk(target);
}

function clearGroup(group) {
  while (group.children.length) {
    const child = group.children[0];
    group.remove(child);
    child.traverse(disposeObject);
  }
}

// Pure interaction state: angles remain in radians, including exact branch
// values after a snap. DOM range inputs are views of this state, never storage.
export function createCgaGuidedMotion(solutions = [], snapDegrees = 4) {
  const wrap = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle));
  const snapTolerance = snapDegrees * Math.PI / 180;
  const state = { phase: 'target', solutions: [], branchIndex: null, q: [0, 0, 0], animation: null };
  const reset = (nextSolutions = state.solutions) => {
    state.solutions = nextSolutions.map((q) => q.slice());
    state.branchIndex = null;
    state.q = [0, 0, 0];
    state.animation = null;
    state.phase = state.solutions.length ? 'target' : 'unreachable';
  };
  const moveJoint = (joint, value) => {
    if (!Number.isFinite(value)) return null;
    const expectedJoint = { target: 1, theta2: 1, theta3: 2, theta1: 0 }[state.phase];
    if (joint !== expectedJoint) return null;
    if (state.phase === 'target') state.phase = 'theta2';
    state.q[joint] = wrap(value);
    if (joint === 1) {
      let nearest = null;
      state.solutions.forEach((q, index) => {
        const error = Math.abs(wrap(value - q[1]));
        if (!nearest || error < nearest.error) nearest = { index, error };
      });
      if (!nearest || nearest.error > snapTolerance) return null;
      state.branchIndex = nearest.index;
      state.q[1] = state.solutions[nearest.index][1];
      state.phase = 'reversing';
      state.animation = { elapsed: 0, from: state.q[1], to: 0, nextPhase: 'theta3' };
    } else {
      const branch = state.solutions[state.branchIndex];
      if (Math.abs(wrap(value - branch[joint])) > snapTolerance) return null;
      state.q[joint] = branch[joint];
      if (joint === 2) {
        state.phase = 'restoring';
        state.animation = { elapsed: 0, from: 0, to: branch[1], nextPhase: 'theta1' };
      } else {
        state.phase = 'complete';
        state.q = branch.slice();
      }
    }
    return { joint, branchIndex: state.branchIndex };
  };
  const advance = (dt) => {
    const animation = state.animation;
    if (!animation || !Number.isFinite(dt) || dt <= 0) return;
    animation.elapsed += dt;
    // Hold either exact snap for two seconds before reversing/restoring.
    const u = Math.min(1, Math.max(0, (animation.elapsed - 2) / 1.4));
    state.q[1] = animation.from + (animation.to - animation.from) * u * u * (3 - 2 * u);
    if (u === 1) {
      state.q[1] = animation.to;
      state.phase = animation.nextPhase;
      state.animation = null;
    }
  };
  reset(solutions);
  return { state, reset, moveJoint, advance };
}

function addCgaSlider(kit, text, min, max, initial, digits, onInput, host = kit.controlHost) {
  const label = document.createElement('label');
  label.className = 'ik3r-slider-control';
  const caption = document.createElement('span');
  caption.textContent = text;
  const input = document.createElement('input');
  input.type = 'range';
  input.min = min;
  input.max = max;
  // Fractional IK angles must survive exact snapping, including values that
  // do not lie on a 0.5-degree range-input grid.
  input.step = 'any';
  input.setAttribute('aria-label', text);
  const output = document.createElement('output');
  const setValue = (value) => {
    input.value = String(value);
    output.value = fixed(value, digits);
    input.setAttribute('aria-valuetext', `${fixed(value, digits)}${text.startsWith('θ') ? ' degrees' : ' metres'}`);
  };
  const setEnabled = (enabled) => {
    input.disabled = !enabled;
    label.classList.toggle('is-disabled', !enabled);
  };
  const update = () => {
    const value = Number(input.value);
    setValue(value);
    onInput(value);
  };
  input.addEventListener('input', update);
  kit.cleaners.push(() => input.removeEventListener('input', update));
  label.append(caption, input, output);
  host.appendChild(label);
  kit.cleaners.push(() => label.remove());
  setValue(initial);
  return { input, output, setValue, setEnabled };
}

function createCgaSnapSound(kit) {
  const interactionHost = kit.container.closest('.cga-guided-slide') || kit.container;
  let context = null;
  const prepare = (event) => {
    if (!event.isTrusted) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    try {
      context ||= new AudioContext();
      if (context.state === 'suspended') context.resume().catch(() => {});
    } catch (_) { /* The visual snap remains available without audio support. */ }
  };
  const play = () => {
    if (!context) return;
    const activeContext = context;
    const emit = () => {
      if (activeContext.state !== 'running') return;
      const oscillator = activeContext.createOscillator();
      const gain = activeContext.createGain();
      const start = activeContext.currentTime;
      oscillator.type = 'triangle';
      oscillator.frequency.setValueAtTime(1350, start);
      oscillator.frequency.exponentialRampToValueAtTime(450, start + .045);
      gain.gain.setValueAtTime(.0001, start);
      gain.gain.exponentialRampToValueAtTime(.13, start + .003);
      gain.gain.exponentialRampToValueAtTime(.0001, start + .055);
      oscillator.connect(gain).connect(activeContext.destination);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
      oscillator.start(start);
      oscillator.stop(start + .06);
    };
    // A first pointer-down can snap the slider before resume() settles.
    // Queue that one click instead of dropping it while audio is suspended.
    if (activeContext.state === 'suspended') activeContext.resume().then(emit).catch(() => {});
    else emit();
  };
  interactionHost.addEventListener('pointerdown', prepare);
  interactionHost.addEventListener('keydown', prepare);
  kit.cleaners.push(() => {
    interactionHost.removeEventListener('pointerdown', prepare);
    interactionHost.removeEventListener('keydown', prepare);
    if (context && context.state !== 'closed') context.close().catch(() => {});
  });
  return play;
}

async function buildCgaInteractive(kit) {
  await loadRobotModel();
  kit.container.classList.add('is-cga-interactive');
  kit.setCamera([9.2, 7, 7.4], [1.55, 3, 1.25]);
  const robot = await createRobot(kit.world, [0, 0, 0], { opacity: .72 });
  const fixedLayer = new THREE.Group();
  const movingLayer = new THREE.Group();
  movingLayer.matrixAutoUpdate = false;
  kit.world.add(fixedLayer, movingLayer);
  const target = ikExample.eePosition.clone().add(new THREE.Vector3(0, 0, CGA_TARGET_Z_OFFSET));
  const controller = createCgaGuidedMotion();
  const { state } = controller;
  const playSnap = createCgaSnapSound(kit);
  const instruction = document.createElement('p');
  instruction.className = 'ik3r-cga-instruction';
  instruction.setAttribute('role', 'status');
  instruction.setAttribute('aria-live', 'polite');
  kit.container.appendChild(instruction);
  kit.cleaners.push(() => instruction.remove());
  const jointSliders = [];
  const toolMarker = addPointMarker(kit.world, robotModel.homeTool, 0x111111, 'tool');
  let data;
  let intersectionMarker;
  let carriedMarker;
  let lastInstruction = '';
  const updateScene = () => {
    const [theta1, theta2] = state.q;
    const joint1Motion = expRevolute(robotModel.axes[0], robotModel.axisPoints[0], theta1);
    movingLayer.matrix.copy(joint1Motion).multiply(
      expRevolute(robotModel.axes[1], robotModel.axisPoints[1], theta2)
    );
    movingLayer.matrixWorldNeedsUpdate = true;
    const branch = state.branchIndex === null ? null : data.branches[state.branchIndex];
    carriedMarker.visible = Boolean(branch);
    intersectionMarker.visible = false;
    if (branch) {
      // The preimage is fixed on the home circle. Applying the same θ₂/θ₁
      // transforms as the robot carries it home, back to x, and then to p_d.
      carriedMarker.position.copy(branch.reversedPoint);
      intersectionMarker.position.copy(branch.intersection);
      const carriedPosition = branch.reversedPoint.clone().applyMatrix4(movingLayer.matrix);
      intersectionMarker.visible = carriedPosition.distanceTo(branch.intersection) > .16;
    }
    robot.update(state.q);
    const toolPosition = forwardPosition(robotModel, state.q);
    toolMarker.position.copy(toolPosition);
    toolMarker.visible = state.phase !== 'complete';
    // Suppress overlapping marker meshes when the tool reaches the carried x.
    if (branch) carriedMarker.visible = toolPosition.distanceTo(
      branch.reversedPoint.clone().applyMatrix4(movingLayer.matrix)
    ) > .13;
    const enabledJoint = { target: 1, theta2: 1, theta3: 2, theta1: 0 }[state.phase];
    jointSliders.forEach((slider, index) => {
      slider.setValue(state.q[index] / DEG);
      slider.setEnabled(index === enabledJoint);
    });
    const instructions = {
      target: 'Set p_d (magenta diamond), then rotate θ₂ until the circles meet.',
      theta2: 'Rotate θ₂ until C_A meets C_B. The angle snaps near an intersection.',
      reversing: 'θ₂ found! Pause for 2 seconds, then the circle and robot return home.',
      theta3: 'Now rotate θ₃ until the tool reaches the carried point on C_A.',
      restoring: 'θ₂ and θ₃ found! Pause for 2 seconds, then return to the chosen intersection.',
      theta1: 'Now rotate θ₁ to carry the tool from the intersection to p_d.',
      complete: 'Target reached! θ₁, θ₂ and θ₃ are snapped to the chosen IK solution.',
      unreachable: 'No IK branch was found for this target. Move p_d to choose another position.'
    };
    if (instructions[state.phase] !== lastInstruction) {
      lastInstruction = instructions[state.phase];
      instruction.textContent = lastInstruction;
    }
    kit.container.dataset.cgaPhase = state.phase;
    const branchText = branch ? ` · IK ${state.branchIndex + 1}` : '';
    const branchCount = `${state.solutions.length} IK branch${state.solutions.length === 1 ? '' : 'es'} found`;
    const foundAngles = branch ? ` · saved θ₂ = ${fixed(branch.q[1] / DEG, 2)}°` : '';
    kit.note.textContent = state.phase === 'complete'
      ? `${branchCount}${branchText} · tool–target distance ${toolPosition.distanceTo(target).toExponential(1)} m`
      : `${branchCount}${branchText}${foundAngles} · snap within 4°`;
  };
  const redrawTarget = () => {
    const solutions = solvePositionIk(target);
    controller.reset(solutions);
    data = cgaCircleData(target, solutions);
    clearGroup(fixedLayer);
    clearGroup(movingLayer);
    addCgaCircle(fixedLayer, data.fixedCenter, data.fixedRadius, data.fixedNormal, 0xe85d04, 'C_B');
    addCgaTarget(fixedLayer, data.target);
    addCgaCircle(movingLayer, data.homeCenter, data.homeRadius, data.homeNormal, 0x2775ff, 'C_A(θ₂)');
    intersectionMarker = addPointMarker(fixedLayer, data.homePoint, 0xff0000, 'chosen x');
    carriedMarker = addPointMarker(movingLayer, data.homePoint, 0x00a676, 'carried x');
    updateScene();
  };
  [
    ['pₓ', -3.5, 4.5, 'x'], ['pᵧ', -3.5, 4.5, 'y'], ['p_z', -.5, 5, 'z']
  ].forEach(([label, min, max, key]) => addCgaSlider(
    kit, label, min, max, target[key], 2,
    (next) => { target[key] = next; redrawTarget(); }
  ));
  const jointControlHost = kit.container.closest('.cga-guided-slide')?.querySelector('[data-cga-joint-controls]') || kit.controlHost;
  [['θ₂', 1], ['θ₃', 2], ['θ₁', 0]].forEach(([label, index]) => {
    jointSliders[index] = addCgaSlider(kit, label, -180, 180, 0, 2, (next) => {
      if (controller.moveJoint(index, next * DEG)) playSnap();
      updateScene();
    }, jointControlHost);
  });
  const resetButton = document.createElement('button');
  resetButton.type = 'button';
  resetButton.className = 'ik3r-cga-action';
  resetButton.textContent = 'Reset joints';
  const resetJoints = () => { controller.reset(); updateScene(); };
  resetButton.addEventListener('click', resetJoints);
  kit.cleaners.push(() => resetButton.removeEventListener('click', resetJoints));
  kit.controlHost.appendChild(resetButton);
  redrawTarget();
  return (_time, dt) => {
    controller.advance(dt);
    updateScene();
  };
}

async function buildCgaTorus(kit) {
  await loadRobotModel();
  kit.setCamera([10.2, 8.2, 8.3], [1.55, .65, 1.05]);
  const data = cgaCircleData();
  await createRobot(kit.world, [0, 0, 0], { opacity: .14 });
  kit.world.add(makeSweptCircleSurface(data, 96, 64, 0x2775ff, .14));
  addCgaCircle(kit.world, data.fixedCenter, data.fixedRadius, data.fixedNormal, 0xe85d04, 'C_B');
  addCgaTarget(kit.world, data.target);
  const offsets = [
    new THREE.Vector3(.18, -.38, .12), new THREE.Vector3(.2, .22, .18),
    new THREE.Vector3(-.28, .18, .34), new THREE.Vector3(.25, -.12, .42)
  ];
  data.branches.forEach((branch, index) => addPointMarker(
    kit.world, branch.intersection, 0xff0000, `${index + 1}`, offsets[index]
  ));
  kit.note.textContent = 'The blue swept surface is generated by C_A(θ₂). The raised target circle C_B intersects it at two real IK points.';
  return () => {};
}

function makeSweptCircleSurface(data, thetaSegments, circleSegments, color, opacity) {
  const normal = data.homeNormal.clone().normalize();
  const uAxis = data.homePoint.clone().sub(data.homeCenter).normalize();
  const vAxis = normal.clone().cross(uAxis).normalize();
  const positions = [];
  const indices = [];
  for (let i = 0; i <= thetaSegments; i += 1) {
    const theta = -Math.PI + (2 * Math.PI * i) / thetaSegments;
    const transform = expRevolute(robotModel.axes[1], robotModel.axisPoints[1], theta);
    for (let j = 0; j <= circleSegments; j += 1) {
      const phi = (2 * Math.PI * j) / circleSegments;
      const point = data.homeCenter.clone()
        .addScaledVector(uAxis, data.homeRadius * Math.cos(phi))
        .addScaledVector(vAxis, data.homeRadius * Math.sin(phi))
        .applyMatrix4(transform);
      positions.push(point.x, point.y, point.z);
    }
  }
  const row = circleSegments + 1;
  for (let i = 0; i < thetaSegments; i += 1) {
    for (let j = 0; j < circleSegments; j += 1) {
      const a = i * row + j, b = a + row;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false,
    roughness: .72, metalness: .02
  }));
}

async function buildConicInterpretation(kit) {
  await loadRobotModel();
  kit.setCamera([0, 6.8, 0], [0, 0, 0]);
  kit.controls.enableRotate = false;
  const z = .02;
  addRing(kit.world, new THREE.Vector3(0, 0, z), 1, 0xff0000, 2);
  kit.world.add(tube(v([-1.55, 0, z]), v([1.55, 0, z]), .012, 0x777777));
  kit.world.add(tube(v([0, -1.35, z]), v([0, 1.35, z]), .012, 0x777777));

  const conic = custom3rConic(ikExample.normR, ikExample.zBar);
  addImplicitContour(kit.world, conic, [-1.45, 1.45, -1.25, 1.25], 86, 0x3f6ea8, z + .015);
  ikExample.solutions.forEach((q) => {
    const theta = q[2];
    const marker = sphere(.045, 0x111111);
    marker.position.set(Math.cos(theta), Math.sin(theta), z + .05);
    kit.world.add(marker);
  });
  addLabel(kit.world, v([1.25, .08, z]), 'c₃');
  addLabel(kit.world, v([.08, 1.18, z]), 's₃');
  kit.note.textContent = 'Blue: F(c₃,s₃)=0. Red: c₃²+s₃²=1. Their four intersections are the four real values of θ₃.';
  return () => {};
}

async function buildConicExplorer(kit) {
  await loadRobotModel();
  kit.setCamera([0, 6.8, 0], [0, 0, 0]);
  kit.controls.enableRotate = false;
  const z = .02;
  addRing(kit.world, new THREE.Vector3(0, 0, z), 1, 0xff0000, 2);
  kit.world.add(tube(v([-1.55, 0, z]), v([1.55, 0, z]), .012, 0x777777));
  kit.world.add(tube(v([0, -1.35, z]), v([0, 1.35, z]), .012, 0x777777));
  addLabel(kit.world, v([1.25, .08, z]), 'c₃');
  addLabel(kit.world, v([.08, 1.18, z]), 's₃');

  const state = { R: ikExample.normR, z: ikExample.zBar };
  const markers = new THREE.Group();
  kit.world.add(markers);
  let contour;
  const redraw = () => {
    if (contour) {
      kit.world.remove(contour);
      contour.geometry.dispose();
      contour.material.dispose();
    }
    while (markers.children.length) {
      const child = markers.children[0];
      markers.remove(child);
      disposeObject(child);
    }
    const conic = custom3rConic(state.R, state.z);
    contour = addImplicitContour(kit.world, conic, [-1.45, 1.45, -1.25, 1.25], 86, 0x3f6ea8, z + .015);
    const roots = circleIntersections(conic);
    roots.forEach((theta) => {
      const marker = sphere(.05, 0x111111);
      marker.position.set(Math.cos(theta), Math.sin(theta), z + .05);
      markers.add(marker);
    });
    kit.note.textContent = `R = ρ²+z² = ${fixed(state.R, 2)} m², z = ${fixed(state.z, 2)} m: ${roots.length} circle–conic intersection${roots.length === 1 ? '' : 's'}.`;
  };
  addConicSlider(kit, 'R', .2, 10, .05, state.R, (value) => { state.R = value; redraw(); });
  addConicSlider(kit, 'z', -3, 3, .05, state.z, (value) => { state.z = value; redraw(); });
  redraw();
  return () => {};
}

function custom3rConic(R, z) {
  const { a1, a2, a3, d2, d3, alpha1 } = robotModel.dh;
  const normConstant = a2 ** 2 + a3 ** 2 + d2 ** 2 + d3 ** 2;
  const zElim = z / Math.sin(alpha1);
  return (c, s) => {
    const F1 = a2 + a3 * c;
    const F2 = d3;
    // The circle identity reduces F3 to an affine function of (c3,s3).
    const F3 = a1 ** 2 + normConstant + 2 * a2 * a3 * c + 2 * d2 * a3 * s;
    const E = (R - F3) / (2 * a1);
    return E ** 2 + zElim ** 2 - F1 ** 2 - F2 ** 2;
  };
}

function circleIntersections(fn) {
  const samples = 1440;
  const roots = [];
  let theta0 = -Math.PI;
  let value0 = fn(Math.cos(theta0), Math.sin(theta0));
  for (let i = 1; i <= samples; i += 1) {
    const theta1 = -Math.PI + (2 * Math.PI * i) / samples;
    const value1 = fn(Math.cos(theta1), Math.sin(theta1));
    if (value0 === 0 || value0 * value1 < 0) {
      let lo = theta0, hi = theta1, fLo = value0;
      for (let iteration = 0; iteration < 42; iteration += 1) {
        const mid = (lo + hi) / 2;
        const fMid = fn(Math.cos(mid), Math.sin(mid));
        if (fLo * fMid <= 0) hi = mid;
        else { lo = mid; fLo = fMid; }
      }
      const root = (lo + hi) / 2;
      if (!roots.some((item) => Math.abs(Math.atan2(Math.sin(root - item), Math.cos(root - item))) < 1e-4)) roots.push(root);
    }
    theta0 = theta1;
    value0 = value1;
  }
  return roots;
}

function zeroRobotModel() {
  const axisPoints = [v([0, 0, .5]), v([0, 0, 1]), v([2, 1.25, 1])];
  const axes = [v([0, 0, 1]), v([0, 1, 0]), v([0, 0, 1])];
  const homeLinks = [
    new THREE.Matrix4(),
    new THREE.Matrix4().makeTranslation(0, 0, .5),
    new THREE.Matrix4().makeTranslation(0, 0, 1),
    new THREE.Matrix4().makeTranslation(2, 1.25, 1)
  ];
  return {
    axisPoints,
    axes,
    homeLinks,
    homeTool: v([3.5, 1.25, 1.75]),
    meshSpecs: [
      { file: 'base_link.stl', prefix: 0, visual: new THREE.Matrix4(), color: 0x333638 },
      { file: 'link_1_0.stl', prefix: 1, visual: new THREE.Matrix4(), color: 0x0d7d80 },
      { file: 'link_2.stl', prefix: 2, visual: rpyMatrix(0, .25, 0, 0, 0, -1.5707), color: 0xb8b8b8 },
      { file: 'link_3_d3.stl', prefix: 3, visual: new THREE.Matrix4().makeTranslation(0, 0, .25), color: 0x0d7d80 }
    ]
  };
}

function zeroPrefixMatrix(q, count) {
  const model = zeroRobotModel();
  const matrix = new THREE.Matrix4();
  for (let i = 0; i < count; i += 1) {
    matrix.multiply(expRevolute(model.axes[i], model.axisPoints[i], q[i]));
  }
  return matrix;
}

async function createZeroRobot(world, q = [0, 0, 0], options = {}) {
  const model = zeroRobotModel();
  const group = new THREE.Group();
  const visuals = [];
  world.add(group);
  world.userData.sceneControls?.registerStlRoot(group);
  await Promise.all(model.meshSpecs.map(async (spec) => {
    const geometry = await loadVariantGeometry(spec.file);
    const sceneOpacity = world.userData.courseStlOpacityFactor ?? 1;
    const holder = new THREE.Group();
    holder.matrixAutoUpdate = false;
    const opacity = (options.opacity ?? 1) * sceneOpacity;
    const color = options.colors?.[spec.prefix] ?? spec.color;
    const mesh = new THREE.Mesh(geometry.clone(), new THREE.MeshStandardMaterial({
      color,
      roughness: .62,
      metalness: .06,
      transparent: opacity < 1,
      opacity,
      depthWrite: opacity > .85,
      side: THREE.DoubleSide
    }));
    mesh.userData.isCourseStl = true;
    holder.add(mesh);
    group.add(holder);
    visuals.push({
      holder,
      prefix: spec.prefix,
      home: model.homeLinks[spec.prefix].clone().multiply(spec.visual)
    });
  }));
  const update = (values) => {
    visuals.forEach((item) => {
      item.holder.matrix.multiplyMatrices(zeroPrefixMatrix(values, item.prefix), item.home);
      item.holder.matrixWorldNeedsUpdate = true;
    });
  };
  update(q);
  return { group, update, model };
}

async function createRobot(world, q = [0, 0, 0], options = {}) {
  const model = await loadRobotModel();
  const geometries = await loadGeometries();
  const group = new THREE.Group();
  world.add(group);
  world.userData.sceneControls?.registerStlRoot(group);
  const sceneOpacity = world.userData.courseStlOpacityFactor ?? 1;
  const visuals = [];
  model.meshSpecs.forEach((spec, i) => {
    const holder = new THREE.Group();
    holder.matrixAutoUpdate = false;
    const color = options.colors?.[i] ?? spec.color;
    const opacity = (options.opacity ?? 1) * sceneOpacity;
    const mesh = new THREE.Mesh(geometries[i].clone(), new THREE.MeshStandardMaterial({
      color, roughness: .62, metalness: .06, transparent: opacity < 1,
      opacity, depthWrite: opacity > .85, side: THREE.DoubleSide
    }));
    mesh.userData.isCourseStl = true;
    holder.add(mesh);
    group.add(holder);
    visuals.push({ holder, prefix: spec.prefix, home: model.homeLinks[i].clone().multiply(model.visualOrigins[i]) });
  });
  function update(values) {
    visuals.forEach((item) => {
      item.holder.matrix.multiplyMatrices(prefixMatrix(values, item.prefix), item.home);
      item.holder.matrixWorldNeedsUpdate = true;
    });
  }
  update(q);
  return { group, update };
}

function loadGeometries() {
  if (!geometryPromise) {
    geometryPromise = loadRobotModel().then((model) => Promise.all(model.meshSpecs.map(async (spec) => {
      const response = await fetch(modelAssetUrl(spec.file));
      if (!response.ok) throw new Error('Could not load ' + spec.file);
      return parseStlGeometry(await response.arrayBuffer());
    })));
  }
  return geometryPromise;
}

function prefixMatrix(q, count) {
  return prefixMatrixFor(robotModel, q, count);
}

function expRevolute(axis, point, angle) {
  const matrix = new THREE.Matrix4().makeRotationAxis(axis, angle);
  const rotated = point.clone().applyMatrix4(matrix);
  matrix.setPosition(point.clone().sub(rotated));
  return matrix;
}

function addJointAxes(world, q, labels = false) {
  const axes = [
    { p: robotModel.axisPoints[0], w: robotModel.axes[0], prefix: 0, text: 'z₀ · joint 1' },
    { p: robotModel.axisPoints[1], w: robotModel.axes[1], prefix: 1, text: 'z₁ · joint 2' },
    { p: robotModel.axisPoints[2], w: robotModel.axes[2], prefix: 2, text: 'z₂ · joint 3' }
  ];
  axes.forEach((axis) => {
    const m = prefixMatrix(q, axis.prefix);
    const p = axis.p.clone().applyMatrix4(m);
    const w = axis.w.clone().transformDirection(m);
    world.add(makeAxis(p, w, 4.2, 0x222222));
    if (labels) addLabel(world, p.clone().add(w.clone().multiplyScalar(1.7)), axis.text);
  });
}

function makeAxis(point, direction, length, color) {
  const start = point.clone().addScaledVector(direction, -length / 2);
  const end = point.clone().addScaledVector(direction, length / 2);
  return tube(start, end, .025, color, .72);
}

function addGrid(world) {
  const grid = new THREE.GridHelper(8, 16, 0xcccccc, 0xe8e8e8);
  grid.rotation.x = Math.PI / 2;
  world.add(grid);
}

function addTarget(world, point, text, labelOffset = new THREE.Vector3(.1, .1, .32)) {
  const marker = sphere(.14, 0xff0000);
  marker.position.copy(point);
  world.add(marker);
  addLabel(world, point.clone().add(labelOffset), text);
}

function addDimension(world, start, end, text, color = 0x111111, opacity = 1) {
  const group = new THREE.Group();
  const direction = end.clone().sub(start);
  const length = direction.length();
  if (length < 1e-4) return group;
  const normal = new THREE.Vector3(0, 0, 1);
  if (Math.abs(direction.clone().normalize().dot(normal)) > .9) normal.set(0, 1, 0);
  const cap = normal.clone().cross(direction).normalize().multiplyScalar(.12);
  group.add(tube(start, end, .018, color, opacity));
  group.add(tube(start.clone().sub(cap), start.clone().add(cap), .014, color, opacity));
  group.add(tube(end.clone().sub(cap), end.clone().add(cap), .014, color, opacity));
  world.add(group);
  group.userData.dimensionLabel = addLabel(
    group,
    start.clone().lerp(end, .5).add(cap.clone().multiplyScalar(1.3)),
    text,
    color
  );
  group.userData.dimensionKey = text.slice(0, 2);
  return group;
}

function addDimensionLabelControls(kit, dimensions) {
  const choices = [
    ['all', 'All'],
    ['none', 'None'],
    ...dimensions.map((group) => [group.userData.dimensionKey, group.userData.dimensionKey])
  ];
  const label = document.createElement('span');
  label.className = 'ik3r-control-label';
  label.textContent = 'Dimensions';
  const select = document.createElement('select');
  select.className = 'ik3r-label-select';
  select.setAttribute('aria-label', 'Visible dimension labels');
  choices.forEach(([value, text]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = text;
    select.appendChild(option);
  });
  const update = () => {
    setAllLabelsAuthoredVisible(kit.world, select.value === 'all');
    if (select.value !== 'all' && select.value !== 'none') {
      const selected = dimensions.find((group) => group.userData.dimensionKey === select.value);
      if (selected?.userData.dimensionLabel) {
        selected.userData.dimensionLabel.userData.ikLabelAuthoredVisible = true;
      }
    }
    kit.syncLabels?.();
  };
  select.addEventListener('change', update);
  kit.cleaners.push(() => select.removeEventListener('change', update));
  kit.controlHost.append(label, select);
  update();
}

function addLabelVisibilityControl(kit) {
  const label = document.createElement('label');
  label.className = 'ik3r-label-toggle';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = true;
  checkbox.setAttribute('aria-label', 'Show scene labels');
  const text = document.createElement('span');
  text.textContent = 'Labels';
  label.append(checkbox, text);
  const update = () => {
    kit.world.userData.courseLabelsVisible = checkbox.checked;
    syncIkLabelVisibility(kit.world);
  };
  checkbox.addEventListener('change', update);
  kit.cleaners.push(() => checkbox.removeEventListener('change', update));
  kit.controlHost.append(label);
  kit.syncLabels = update;
}

function addRobotVisibilityToggle(kit, robotGroup, text, checked = true, onChange = () => {}) {
  const label = document.createElement('label');
  label.className = 'ik3r-state-toggle';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = checked;
  checkbox.setAttribute('aria-label', `Show ${text} robot state`);
  const track = document.createElement('span');
  track.className = 'ik3r-switch-track';
  track.setAttribute('aria-hidden', 'true');
  const caption = document.createElement('span');
  caption.textContent = text;
  const update = () => {
    robotGroup.visible = checkbox.checked;
    onChange(checkbox.checked);
  };
  checkbox.addEventListener('change', update);
  kit.cleaners.push(() => checkbox.removeEventListener('change', update));
  label.append(checkbox, track, caption);
  kit.controlHost.append(label);
  update();
}

function addConicSlider(kit, text, min, max, step, initial, onInput) {
  const label = document.createElement('label');
  label.className = 'ik3r-slider-control';
  const caption = document.createElement('span');
  const valueLabel = document.createElement('output');
  const input = document.createElement('input');
  input.type = 'range';
  input.min = min;
  input.max = max;
  input.step = step;
  input.value = initial;
  const update = () => {
    const value = Number(input.value);
    valueLabel.value = fixed(value, 2);
    onInput(value);
  };
  caption.textContent = text;
  valueLabel.value = fixed(initial, 2);
  input.setAttribute('aria-label', text);
  input.addEventListener('input', update);
  kit.cleaners.push(() => input.removeEventListener('input', update));
  label.append(caption, input, valueLabel);
  kit.controlHost.append(label);
}

function setAllLabelsAuthoredVisible(world, visible) {
  world.traverse((object) => {
    if (object.userData.isIkLabel) object.userData.ikLabelAuthoredVisible = visible;
  });
}

function syncIkLabelVisibility(world) {
  const globallyVisible = world.userData.courseLabelsVisible !== false;
  world.traverse((object) => {
    if (object.userData.isIkLabel) {
      object.visible = globallyVisible && object.userData.ikLabelAuthoredVisible !== false;
    }
  });
}

function addImplicitContour(world, fn, bounds, resolution, color, z = 0) {
  const [xMin, xMax, yMin, yMax] = bounds;
  const dx = (xMax - xMin) / resolution;
  const dy = (yMax - yMin) / resolution;
  const points = [];
  const interpolate = (a, b, fa, fb) => a.clone().lerp(b, Math.abs(fa - fb) < 1e-12 ? .5 : fa / (fa - fb));
  for (let ix = 0; ix < resolution; ix += 1) {
    for (let iy = 0; iy < resolution; iy += 1) {
      const corners = [
        v([xMin + ix * dx, yMin + iy * dy, z]),
        v([xMin + (ix + 1) * dx, yMin + iy * dy, z]),
        v([xMin + (ix + 1) * dx, yMin + (iy + 1) * dy, z]),
        v([xMin + ix * dx, yMin + (iy + 1) * dy, z])
      ];
      const values = corners.map((p) => fn(p.x, p.y));
      const crossings = [];
      [[0, 1], [1, 2], [2, 3], [3, 0]].forEach(([a, b]) => {
        if ((values[a] <= 0 && values[b] > 0) || (values[a] > 0 && values[b] <= 0)) {
          crossings.push(interpolate(corners[a], corners[b], values[a], values[b]));
        }
      });
      if (crossings.length === 2) points.push(crossings[0], crossings[1]);
      if (crossings.length === 4) points.push(crossings[0], crossings[1], crossings[2], crossings[3]);
    }
  }
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color }));
  world.add(lines);
  return lines;
}

function addVector(world, origin, vector, color, text) {
  const end = origin.clone().add(vector);
  const group = new THREE.Group();
  group.add(tube(origin, end, .035, color));
  const cone = new THREE.Mesh(new THREE.ConeGeometry(.11, .28, 20), new THREE.MeshStandardMaterial({ color }));
  cone.position.copy(end);
  cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vector.clone().normalize());
  group.add(cone);
  world.add(group);
  addLabel(group, end.clone().add(new THREE.Vector3(.08, .08, .18)), text, color);
  return group;
}

function addAxisTriad(world, origin, scale) {
  addVector(world, origin, new THREE.Vector3(scale, 0, 0), 0xe74c3c, 'x');
  addVector(world, origin, new THREE.Vector3(0, scale, 0), 0x35a853, 'y');
  addVector(world, origin, new THREE.Vector3(0, 0, scale), 0x2775ff, 'z');
}

function addRing(world, center, radius, color, width = 1) {
  return addRingInPlane(world, center, radius, new THREE.Vector3(0, 0, 1), color, width);
}

function addRingInPlane(world, center, radius, normal, color, width = 1) {
  const curve = new THREE.EllipseCurve(0, 0, radius, radius, 0, Math.PI * 2);
  const points = curve.getPoints(128).map((p) => new THREE.Vector3(p.x, p.y, 0));
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const ring = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color, linewidth: width }));
  ring.position.copy(center);
  ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal.clone().normalize());
  world.add(ring);
  return ring;
}

function addWireSphere(world, center, radius, color) {
  const geometry = new THREE.SphereGeometry(radius, 28, 18);
  const wireframe = new THREE.LineSegments(
    new THREE.WireframeGeometry(geometry),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: .24 })
  );
  wireframe.position.copy(center);
  world.add(wireframe);
  return wireframe;
}

function addDiscInPlane(world, center, radius, normal, color) {
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 72),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: .07,
      side: THREE.DoubleSide,
      depthWrite: false
    })
  );
  disc.position.copy(center);
  disc.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal.clone().normalize());
  world.add(disc);
  return disc;
}

function tube(start, end, radius, color, opacity = 1) {
  const direction = end.clone().sub(start);
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, direction.length(), 16),
    new THREE.MeshStandardMaterial({ color, transparent: opacity < 1, opacity })
  );
  mesh.position.copy(start).add(end).multiplyScalar(.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  return mesh;
}

function sphere(radius, color) {
  return new THREE.Mesh(
    new THREE.SphereGeometry(radius, 24, 16),
    new THREE.MeshStandardMaterial({ color, roughness: .5 })
  );
}

function addLabel(parent, position, text, color = 0x111111, background) {
  // A scene can opt out of label backing without changing other lecture modes.
  if (background === undefined) {
    let ancestor = parent;
    while (ancestor && ancestor.userData.ikLabelBackground === undefined) ancestor = ancestor.parent;
    background = ancestor?.userData.ikLabelBackground !== false;
  }
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const font = '700 28px Arial';
  ctx.font = font;
  const width = Math.ceil(ctx.measureText(text).width + 28);
  canvas.width = Math.max(128, width);
  canvas.height = 54;
  if (background) {
    ctx.fillStyle = 'rgba(255,255,255,.92)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.fillStyle = '#' + color.toString(16).padStart(6, '0');
  ctx.font = font;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 14, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false }));
  sprite.position.copy(position);
  sprite.scale.set(canvas.width / 115, canvas.height / 115, 1);
  sprite.renderOrder = 20;
  sprite.userData.isIkLabel = true;
  sprite.userData.ikLabelAuthoredVisible = true;
  parent.add(sprite);
  return sprite;
}

function rpyMatrix(x, y, z, roll, pitch, yaw) {
  const matrix = new THREE.Matrix4().makeTranslation(x, y, z);
  const rotation = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(roll, pitch, yaw, 'XYZ'));
  return matrix.multiply(rotation);
}

function v(values) { return new THREE.Vector3(...values); }
function fixed(value, digits = 4) {
  const clean = Math.abs(value) < .5 * 10 ** -digits ? 0 : value;
  return Number(clean).toFixed(digits);
}
function vectorText(vector, digits = 4) { return vector.toArray().map((value) => fixed(value, digits)).join(', '); }

function disposeObject(object) {
  object.geometry?.dispose?.();
  const materials = object.material ? (Array.isArray(object.material) ? object.material : [object.material]) : [];
  materials.forEach((material) => {
    material.map?.dispose?.();
    material.dispose?.();
  });
}
