import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createBoldAxes, createZUpWorld, resizeRendererToContainer } from './threeUtils.js';

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;
const EPS = 1e-8;

export function initFrameDHPlaygrounds() {
  document.querySelectorAll('[data-frame-pose-demo]').forEach((container) => {
    try {
      createFramePoseDemo(container);
    } catch (error) {
      fail(container, error);
    }
  });

  document.querySelectorAll('[data-frame-dh-playground]').forEach((container) => {
    try {
      createDHPlayground(container);
    } catch (error) {
      fail(container, error);
    }
  });

  document.querySelectorAll('[data-custom3r-dh-demo]').forEach((container) => {
    try {
      createCustom3RDHDemo(container);
    } catch (error) {
      fail(container, error);
    }
  });

  document.querySelectorAll('[data-serial-frame-demo]').forEach((container) => {
    createSerialFrameDemo(container).catch((error) => fail(container, error));
  });
}

function fail(container, error) {
  container.innerHTML = `<div class="warning">Interactive 3D demo could not start: ${escapeHtml(error.message)}</div>`;
  console.error('ENG-654 frame/DH visualization failed:', error);
}

function createScene(stage, options = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xfafafa);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 100);
  camera.position.set(...(options.camera || [4.7, 3.0, 4.8]));
  camera.lookAt(0.7, 0.35, 0.2);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  stage.prepend(renderer.domElement);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x888888, 1.8));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(4, 6, 5);
  scene.add(key);

  const robotWorld = createZUpWorld(scene);
  robotWorld.add(createGroundGrid(5.5, 0.5));

  if (options.worldFrame !== false) {
    const worldAxes = createBoldAxes(0.75);
    worldAxes.name = 'world-axes';
    robotWorld.add(worldAxes);
    robotWorld.add(createTextSprite('W', 0.24, { offset: [0.14, 0.14, 0.16], bold: true }));
  }

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.target.set(0.8, 0.35, 0.25);
  controls.update();

  const resize = () => resizeRendererToContainer(renderer, camera, stage);
  const observer = new ResizeObserver(resize);
  observer.observe(stage);
  resize();

  let disposed = false;
  function animate() {
    if (disposed) return;
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);

  return {
    scene,
    camera,
    renderer,
    robotWorld,
    controls,
    dispose() {
      disposed = true;
      observer.disconnect();
      controls.dispose();
      renderer.dispose();
    }
  };
}

function createGroundGrid(size = 5, step = 0.5) {
  const vertices = [];
  const half = size / 2;
  for (let x = -half; x <= half + EPS; x += step) {
    vertices.push(x, -half, 0, x, half, 0);
  }
  for (let y = -half; y <= half + EPS; y += step) {
    vertices.push(-half, y, 0, half, y, 0);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  const material = new THREE.LineBasicMaterial({ color: 0xd7d7d7, transparent: true, opacity: 0.72 });
  return new THREE.LineSegments(geometry, material);
}

function createTextSprite(text, scale = 0.25, options = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'rgba(255,255,255,0.90)';
  ctx.fillRect(0, 8, canvas.width, 80);
  ctx.strokeStyle = options.accent ? '#ff0000' : 'rgba(0,0,0,0.16)';
  ctx.lineWidth = options.accent ? 6 : 2;
  ctx.strokeRect(2, 10, canvas.width - 4, 76);
  ctx.fillStyle = '#111111';
  ctx.font = `${options.bold ? '700' : '600'} 42px Arial, Helvetica, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(scale * 2.45, scale * 0.73, 1);
  const [x, y, z] = options.offset || [0.12, 0.12, 0.12];
  sprite.position.set(x, y, z);
  sprite.renderOrder = 50;
  return sprite;
}

function makeDHMatrix(a, alpha, d, theta) {
  const rz = new THREE.Matrix4().makeRotationZ(theta);
  const tz = new THREE.Matrix4().makeTranslation(0, 0, d);
  const tx = new THREE.Matrix4().makeTranslation(a, 0, 0);
  const rx = new THREE.Matrix4().makeRotationX(alpha);
  return new THREE.Matrix4().multiplyMatrices(rz, tz).multiply(tx).multiply(rx);
}

function makeRPYMatrix(x, y, z, roll, pitch, yaw) {
  const rz = new THREE.Matrix4().makeRotationZ(yaw);
  const ry = new THREE.Matrix4().makeRotationY(pitch);
  const rx = new THREE.Matrix4().makeRotationX(roll);
  const t = new THREE.Matrix4().makeTranslation(x, y, z);
  return new THREE.Matrix4().multiplyMatrices(t, rz).multiply(ry).multiply(rx);
}

function matrixValues(matrix) {
  const e = matrix.elements;
  return [
    [e[0], e[4], e[8], e[12]],
    [e[1], e[5], e[9], e[13]],
    [e[2], e[6], e[10], e[14]],
    [e[3], e[7], e[11], e[15]]
  ];
}

function matrixTableHtml(matrix, digits = 3) {
  return matrixValues(matrix).map((row) => (
    `<tr>${row.map((v) => `<td>${formatNumber(v, digits)}</td>`).join('')}</tr>`
  )).join('');
}

function formatNumber(value, digits = 3) {
  if (Math.abs(value) < Math.pow(10, -digits) * 0.5) value = 0;
  return Number(value).toFixed(digits);
}

function formatDeg(rad, digits = 1) {
  return `${formatNumber(normalizeDeg(rad * RAD), digits)}°`;
}

function normalizeDeg(value) {
  let v = value;
  while (v > 180) v -= 360;
  while (v <= -180) v += 360;
  return v;
}

function inferStandardDH(relative) {
  const e = relative.elements;
  const r11 = e[0], r21 = e[1], r31 = e[2];
  const r12 = e[4], r22 = e[5], r32 = e[6];
  const r13 = e[8], r23 = e[9], r33 = e[10];
  const px = e[12], py = e[13], pz = e[14];

  const theta = Math.atan2(r21, r11);
  const alpha = Math.atan2(r32, r33);
  const a = px * Math.cos(theta) + py * Math.sin(theta);
  const d = pz;

  const reconstructed = makeDHMatrix(a, alpha, d, theta);
  const source = relative.elements;
  const fit = reconstructed.elements;
  let residual = 0;
  let frobenius = 0;
  for (let i = 0; i < 16; i += 1) {
    const err = source[i] - fit[i];
    residual = Math.max(residual, Math.abs(err));
    frobenius += err * err;
  }
  frobenius = Math.sqrt(frobenius);

  const constraints = {
    r31,
    translationNormal: -px * Math.sin(theta) + py * Math.cos(theta),
    rotationResidual: Math.max(
      Math.abs(r12 + Math.sin(theta) * Math.cos(alpha)),
      Math.abs(r22 - Math.cos(theta) * Math.cos(alpha)),
      Math.abs(r13 - Math.sin(theta) * Math.sin(alpha)),
      Math.abs(r23 + Math.cos(theta) * Math.sin(alpha))
    )
  };

  return {
    a,
    alpha,
    d,
    theta,
    reconstructed,
    residual,
    frobenius,
    compatible: residual < 1e-5,
    constraints
  };
}

function createFrameVisual(name, selected = false) {
  const group = new THREE.Group();
  group.matrixAutoUpdate = false;
  group.userData.frameName = name;

  const axes = createBoldAxes(0.5);
  group.add(axes);

  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(0.055, 20, 16),
    new THREE.MeshStandardMaterial({
      color: selected ? 0xff0000 : 0x222222,
      roughness: 0.6,
      metalness: 0.05
    })
  );
  marker.userData.framePick = true;
  group.add(marker);

  const label = createTextSprite(name, 0.2, { accent: selected });
  label.position.set(0.13, 0.13, 0.16);
  group.add(label);

  return { group, marker, label, axes };
}

function setFrameVisualSelected(visual, selected) {
  visual.marker.material.color.setHex(selected ? 0xff0000 : 0x222222);
  const oldLabel = visual.label;
  const labelPosition = oldLabel.position.clone();
  visual.group.remove(oldLabel);
  oldLabel.material.map?.dispose();
  oldLabel.material.dispose();
  visual.label = createTextSprite(visual.group.userData.frameName, 0.2, { accent: selected });
  visual.label.position.copy(labelPosition);
  visual.group.add(visual.label);
}

function createAxisExtension(length = 3.8, color = 0x5f5f5f) {
  const geometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, -length / 2),
    new THREE.Vector3(0, 0, length / 2)
  ]);
  const material = new THREE.LineDashedMaterial({ color, dashSize: 0.12, gapSize: 0.08, transparent: true, opacity: 0.45 });
  const line = new THREE.Line(geometry, material);
  line.computeLineDistances();
  return line;
}

function createLine(points, color = 0x666666, opacity = 0.75, dashed = false) {
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = dashed
    ? new THREE.LineDashedMaterial({ color, dashSize: 0.1, gapSize: 0.07, transparent: true, opacity })
    : new THREE.LineBasicMaterial({ color, transparent: true, opacity });
  const line = new THREE.Line(geometry, material);
  if (dashed) line.computeLineDistances();
  return line;
}

function transformPoint(matrix, point) {
  return point.clone().applyMatrix4(matrix);
}

function createFramePoseDemo(container) {
  container.classList.add('frame-pose-demo');
  container.innerHTML = `
    <div class="frame-pose-stage">
      <p class="frame-pose-stage-note">Drag to orbit · scroll to zoom · robotics world is z-up</p>
    </div>
    <div class="frame-pose-panel">
      <div class="frame-pose-card">
        <strong>Move frame B relative to world W</strong>
        <div data-pose-ranges style="margin-top:0.45rem"></div>
      </div>
      <div class="frame-pose-card">
        <strong>Same point, different coordinates</strong>
        <div class="frame-coordinates">
          <div class="frame-coordinate-box"><strong>\\({}^{W}\\mathbf{p}_{P}\\)</strong><code data-world-point></code></div>
          <div class="frame-coordinate-box"><strong>\\({}^{B}\\mathbf{p}_{P}\\)</strong><code data-local-point></code></div>
        </div>
      </div>
      <div class="frame-pose-card">
        <strong>\\({}^{W}T_{B}\\)</strong>
        <table class="pose-matrix" aria-label="Homogeneous transformation matrix"><tbody data-pose-matrix></tbody></table>
      </div>
    </div>
  `;

  const stage = container.querySelector('.frame-pose-stage');
  const sceneKit = createScene(stage, { camera: [3.7, 2.6, 3.8] });
  const { robotWorld, renderer, camera } = sceneKit;

  const state = { x: 0.8, y: 0.45, z: 0.65, roll: 20 * DEG, pitch: -15 * DEG, yaw: 35 * DEG };
  const ranges = [
    ['x', 'x', -1.5, 1.5, 0.01, ' m'],
    ['y', 'y', -1.5, 1.5, 0.01, ' m'],
    ['z', 'z', -0.3, 1.8, 0.01, ' m'],
    ['roll', 'φ', -180, 180, 1, '°'],
    ['pitch', 'θ', -180, 180, 1, '°'],
    ['yaw', 'ψ', -180, 180, 1, '°']
  ];

  const rangesHost = container.querySelector('[data-pose-ranges]');
  rangesHost.innerHTML = ranges.map(([key, label, min, max, step, unit]) => {
    const value = ['roll', 'pitch', 'yaw'].includes(key) ? state[key] * RAD : state[key];
    return `
      <div class="pose-range-row">
        <label for="pose-${key}-${uid(container)}">${label}</label>
        <input id="pose-${key}-${uid(container)}" data-pose-key="${key}" type="range" min="${min}" max="${max}" step="${step}" value="${value}">
        <output data-pose-output="${key}">${formatNumber(value, unit === '°' ? 0 : 2)}${unit}</output>
      </div>`;
  }).join('');

  const frameVisual = createFrameVisual('B', true);
  robotWorld.add(frameVisual.group);

  const pointLocal = new THREE.Vector3(0.48, 0.28, 0.22);
  const point = new THREE.Mesh(
    new THREE.SphereGeometry(0.075, 24, 18),
    new THREE.MeshStandardMaterial({ color: 0xff0000 })
  );
  point.position.copy(pointLocal);
  frameVisual.group.add(point);
  const pointLabel = createTextSprite('P', 0.16, { accent: true });
  pointLabel.position.copy(pointLocal).add(new THREE.Vector3(0.08, 0.08, 0.1));
  frameVisual.group.add(pointLabel);

  const tether = createLine([new THREE.Vector3(), pointLocal], 0x777777, 0.55, true);
  frameVisual.group.add(tether);

  const matrixBody = container.querySelector('[data-pose-matrix]');
  const worldPointOut = container.querySelector('[data-world-point]');
  const localPointOut = container.querySelector('[data-local-point]');

  function update() {
    const m = makeRPYMatrix(state.x, state.y, state.z, state.roll, state.pitch, state.yaw);
    frameVisual.group.matrix.copy(m);
    frameVisual.group.matrixWorldNeedsUpdate = true;

    const worldPoint = transformPoint(m, pointLocal);
    worldPointOut.textContent = `[${formatNumber(worldPoint.x, 2)}, ${formatNumber(worldPoint.y, 2)}, ${formatNumber(worldPoint.z, 2)}] m`;
    localPointOut.textContent = `[${formatNumber(pointLocal.x, 2)}, ${formatNumber(pointLocal.y, 2)}, ${formatNumber(pointLocal.z, 2)}] m`;
    matrixBody.innerHTML = matrixTableHtml(m, 3);

    container.querySelectorAll('[data-pose-output]').forEach((out) => {
      const key = out.dataset.poseOutput;
      const isAngle = ['roll', 'pitch', 'yaw'].includes(key);
      const value = isAngle ? state[key] * RAD : state[key];
      out.textContent = `${formatNumber(value, isAngle ? 0 : 2)}${isAngle ? '°' : ' m'}`;
    });
  }

  container.querySelectorAll('[data-pose-key]').forEach((input) => {
    input.addEventListener('input', () => {
      const key = input.dataset.poseKey;
      const isAngle = ['roll', 'pitch', 'yaw'].includes(key);
      state[key] = Number(input.value) * (isAngle ? DEG : 1);
      update();
    });
  });

  update();
  enableFramePicking(renderer.domElement, camera, [frameVisual], () => {});
  typesetMath(container);
}

async function createSerialFrameDemo(container) {
  container.classList.add('puma-frame-demo');
  container.innerHTML = `
    <div class="puma-frame-stage">
      <p class="puma-frame-stage-note">custom_3R · zero joint configuration · drag to orbit · scroll to zoom</p>
    </div>
    <div class="puma-frame-panel">
      <div class="puma-frame-selectors">
        <div class="dh-field">
          <label for="puma-base-${uid(container)}">Base frame A</label>
          <select id="puma-base-${uid(container)}" data-puma-base></select>
        </div>
        <div class="dh-field">
          <label for="puma-target-${uid(container)}">Target frame B</label>
          <select id="puma-target-${uid(container)}" data-puma-target></select>
        </div>
        <p class="dh-help">\\({}^{A}T_B\\) maps coordinates expressed in B into coordinates expressed in A. F₁–F₃ are joint frames; F₄ is the fixed end-effector frame at <code>tool0</code>.</p>
      </div>
      <div class="puma-transform-card" aria-live="polite">
        <div class="puma-transform-heading">
          <strong>Selected transform</strong>
          <span data-puma-transform-name>world ← F₄</span>
        </div>
        <table class="pose-matrix" aria-label="Selected homogeneous transformation matrix">
          <tbody data-puma-transform-matrix></tbody>
        </table>
      </div>
      <div class="puma-display-controls">
        <label class="dh-switch">
          <input data-puma-meshes type="checkbox" checked>
          <span class="dh-switch-track" aria-hidden="true"></span>
          <span>Show STL robot</span>
        </label>
        <label class="puma-range-control">
          <span>Frame marker size</span>
          <input data-puma-marker-size type="range" min="25" max="120" step="5" value="65">
          <output data-puma-marker-size-output>65%</output>
        </label>
        <label class="puma-range-control">
          <span>STL opacity</span>
          <input data-puma-opacity type="range" min="10" max="100" step="5" value="55">
          <output data-puma-opacity-output>55%</output>
        </label>
      </div>
      <div class="puma-frame-visibility" role="group" aria-label="Frame visibility controls">
        <div class="puma-frame-visibility-heading">
          <strong>Visible frames</strong>
          <div class="puma-frame-sequence-actions">
            <button class="dh-button" data-puma-hide-frames type="button">Hide all</button>
            <button class="dh-button primary" data-puma-reveal-next type="button">Reveal next</button>
            <button class="dh-button" data-puma-show-frames type="button">Show all</button>
          </div>
        </div>
        <div class="puma-frame-checks" data-puma-frame-checks></div>
      </div>
    </div>
  `;

  const stage = container.querySelector('.puma-frame-stage');
  const sceneKit = createScene(stage, { camera: [2.6, 2.2, 2.0], worldFrame: false });
  const { robotWorld, camera, controls } = sceneKit;
  const modelRoot = new URL('../../assets/models/custom_3R/', import.meta.url);
  const urdfResponse = await fetch(new URL('custom_3R.urdf', modelRoot));
  if (!urdfResponse.ok) throw new Error('Could not load the bundled custom_3R URDF.');

  const model = parseUrdf(await urdfResponse.text());
  const linkMatrices = computeUrdfLinkMatrices(model);
  const robotMeshes = new THREE.Group();
  robotMeshes.name = 'custom-3r-meshes';
  robotWorld.add(robotMeshes);

  for (const [linkName, link] of model.links) {
    const linkMatrix = linkMatrices.get(linkName);
    if (!linkMatrix) continue;
    for (const visual of link.visuals) {
      let geometry;
      if (visual.geometry.type === 'mesh') {
        const meshName = normalizeMeshPath(visual.geometry.filename).split('/').at(-1);
        const meshResponse = await fetch(new URL(meshName, modelRoot));
        if (!meshResponse.ok) throw new Error('Could not load bundled mesh ' + meshName + '.');
        geometry = parseStlGeometry(await meshResponse.arrayBuffer());
      } else {
        geometry = createUrdfPrimitiveGeometry(visual.geometry);
      }
      if (!geometry) continue;

      const visualGroup = new THREE.Group();
      visualGroup.matrixAutoUpdate = false;
      visualGroup.matrix.multiplyMatrices(linkMatrix, visual.origin);
      const material = new THREE.MeshStandardMaterial({
        color: visual.color,
        roughness: 0.62,
        metalness: 0.08,
        transparent: true,
        opacity: 0.82,
        depthWrite: true
      });
      const mesh = new THREE.Mesh(geometry, material);
      if (visual.geometry.scale) mesh.scale.fromArray(visual.geometry.scale);
      visualGroup.add(mesh);
      robotMeshes.add(visualGroup);
    }
  }

  const revoluteJoints = model.joints.filter((joint) => (
    joint.type === 'revolute' || joint.type === 'continuous'
  ));
  if (!revoluteJoints.length) throw new Error('The bundled custom_3R model contains no revolute joints.');

  const frames = [{ id: 'world', label: 'world', matrix: new THREE.Matrix4() }];
  revoluteJoints.forEach((joint, index) => {
    frames.push({
      id: 'F' + (index + 1),
      label: 'F' + String.fromCharCode(0x2081 + index),
      matrix: linkMatrices.get(joint.child).clone()
    });
  });
  const lastJointChild = revoluteJoints.at(-1).child;
  const endEffectorJoint = model.joints.find((joint) => (
    joint.type === 'fixed' && joint.parent === lastJointChild && linkMatrices.has(joint.child)
  ));
  if (!endEffectorJoint) throw new Error('The bundled custom_3R model contains no fixed end-effector frame.');
  const endEffectorIndex = revoluteJoints.length + 1;
  frames.push({
    id: 'F' + endEffectorIndex,
    label: 'F' + String.fromCharCode(0x2080 + endEffectorIndex),
    optionLabel: 'F' + String.fromCharCode(0x2080 + endEffectorIndex) + ' (end effector)',
    matrix: linkMatrices.get(endEffectorJoint.child).clone()
  });

  const labelOffsets = [
    [-0.18, -0.18, 0.15],
    [0.16, 0.14, 0.18],
    [-0.17, 0.14, 0.23],
    [0.16, -0.15, 0.18],
    [-0.16, -0.16, 0.22],
    [0.16, 0.14, 0.2],
    [-0.17, 0.15, 0.14]
  ];
  frames.forEach((frame, index) => {
    const visual = createFrameVisual(frame.label);
    visual.label.position.fromArray(labelOffsets[index]);
    visual.group.matrix.copy(frame.matrix);
    visual.group.matrixWorldNeedsUpdate = true;
    robotWorld.add(visual.group);
    frame.visual = visual;
  });

  robotWorld.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(robotMeshes);
  if (!bounds.isEmpty()) {
    const center = bounds.getCenter(new THREE.Vector3());
    const size = Math.max(bounds.getSize(new THREE.Vector3()).length(), 1);
    controls.target.copy(center);
    camera.position.copy(center).add(new THREE.Vector3(1.15, 1.05, 0.82).normalize().multiplyScalar(size * 0.95));
    camera.near = Math.max(size / 1000, 0.001);
    camera.far = Math.max(size * 20, 100);
    camera.updateProjectionMatrix();
    controls.update();
  }

  const baseSelect = container.querySelector('[data-puma-base]');
  const targetSelect = container.querySelector('[data-puma-target]');
  const matrixBody = container.querySelector('[data-puma-transform-matrix]');
  const transformName = container.querySelector('[data-puma-transform-name]');
  const meshesToggle = container.querySelector('[data-puma-meshes]');
  const markerSize = container.querySelector('[data-puma-marker-size]');
  const markerSizeOutput = container.querySelector('[data-puma-marker-size-output]');
  const opacity = container.querySelector('[data-puma-opacity]');
  const opacityOutput = container.querySelector('[data-puma-opacity-output]');
  const frameChecks = container.querySelector('[data-puma-frame-checks]');
  const hideFramesButton = container.querySelector('[data-puma-hide-frames]');
  const revealNextButton = container.querySelector('[data-puma-reveal-next]');
  const showFramesButton = container.querySelector('[data-puma-show-frames]');
  const options = frames.map((frame) => `<option value="${frame.id}">${frame.optionLabel || frame.label}</option>`).join('');
  baseSelect.innerHTML = options;
  targetSelect.innerHTML = options;
  frameChecks.innerHTML = frames.map((frame) => `
    <label class="puma-frame-check">
      <input data-puma-frame-id="${frame.id}" type="checkbox" checked>
      <span>${frame.label}</span>
    </label>
  `).join('');
  baseSelect.value = 'world';
  targetSelect.value = frames.at(-1).id;

  function updateRelativeTransform() {
    const base = frames.find((frame) => frame.id === baseSelect.value);
    const target = frames.find((frame) => frame.id === targetSelect.value);
    const baseInverse = base.matrix.clone().invert();
    const relative = new THREE.Matrix4().multiplyMatrices(baseInverse, target.matrix);
    matrixBody.innerHTML = matrixTableHtml(relative, 3);
    transformName.textContent = base.label + ' ← ' + target.label;
    frames.forEach((frame) => setFrameVisualSelected(frame.visual, frame === target));
    applyMarkerSize();
  }

  function applyMarkerSize() {
    const scale = Number(markerSize.value) / 100;
    markerSizeOutput.textContent = markerSize.value + '%';
    frames.forEach((frame) => {
      frame.visual.group.matrix.copy(frame.matrix).scale(new THREE.Vector3(scale, scale, scale));
      frame.visual.group.matrixWorldNeedsUpdate = true;
    });
  }

  function applyRobotDisplay() {
    robotMeshes.visible = meshesToggle.checked;
    const alpha = Number(opacity.value) / 100;
    opacityOutput.textContent = opacity.value + '%';
    robotMeshes.traverse((object) => {
      if (!object.isMesh) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => {
        material.transparent = alpha < 1;
        material.opacity = alpha;
        material.depthWrite = alpha >= 0.95;
        material.needsUpdate = true;
      });
    });
  }

  function applyFrameVisibility() {
    const checks = [...frameChecks.querySelectorAll('[data-puma-frame-id]')];
    checks.forEach((checkbox) => {
      const frame = frames.find((candidate) => candidate.id === checkbox.dataset.pumaFrameId);
      if (frame) frame.visual.group.visible = checkbox.checked;
    });
    revealNextButton.disabled = checks.every((checkbox) => checkbox.checked);
  }

  function setAllFramesVisible(visible) {
    frameChecks.querySelectorAll('[data-puma-frame-id]').forEach((checkbox) => {
      checkbox.checked = visible;
    });
    applyFrameVisibility();
  }

  function revealNextFrame() {
    const next = [...frameChecks.querySelectorAll('[data-puma-frame-id]')]
      .find((checkbox) => !checkbox.checked);
    if (next) next.checked = true;
    applyFrameVisibility();
  }

  baseSelect.addEventListener('change', updateRelativeTransform);
  targetSelect.addEventListener('change', updateRelativeTransform);
  meshesToggle.addEventListener('change', applyRobotDisplay);
  markerSize.addEventListener('input', applyMarkerSize);
  opacity.addEventListener('input', applyRobotDisplay);
  frameChecks.addEventListener('change', applyFrameVisibility);
  hideFramesButton.addEventListener('click', () => setAllFramesVisible(false));
  revealNextButton.addEventListener('click', revealNextFrame);
  showFramesButton.addEventListener('click', () => setAllFramesVisible(true));
  applyRobotDisplay();
  applyFrameVisibility();
  updateRelativeTransform();
  typesetMath(container);
}

function createDHPlayground(container) {
  container.classList.add('dh-playground');
  container.innerHTML = `
    <div class="dh-stage">
      <p class="dh-stage-note">Click a frame origin to select · drag to orbit · scroll to zoom</p>
    </div>
    <aside class="dh-panel" aria-label="DH playground controls">
      <details open>
        <summary>Frames</summary>
        <div class="dh-section-body">
          <div class="dh-frame-list" data-frame-list></div>
          <div class="dh-button-row">
            <button class="dh-button" type="button" data-reset-custom3r>Reset custom_3R</button>
            <button class="dh-button" type="button" data-clear-frames>Clear</button>
          </div>
        </div>
      </details>

      <details open>
        <summary>Robot model</summary>
        <div class="dh-section-body">
          <label class="dh-file-picker">
            <span>URDF + referenced STL files</span>
            <input type="file" data-robot-files accept=".urdf,.stl" multiple>
          </label>
          <p class="dh-help">Choose one URDF and all of its STL files together. Files stay in this browser.</p>
          <div class="dh-display-control">
            <label class="dh-switch">
              <input type="checkbox" data-toggle-robot-meshes checked>
              <span class="dh-switch-track" aria-hidden="true"></span>
              <span>Show robot meshes</span>
            </label>
          </div>
          <label class="dh-opacity-control">
            <span>Mesh opacity</span>
            <input type="range" data-robot-opacity min="0" max="1" step="0.05" value="0.65">
            <output data-robot-opacity-output>65%</output>
          </label>
          <p class="dh-live-note" data-robot-status aria-live="polite">Default: custom_3R robot with frames F0–F3.</p>
        </div>
      </details>

      <details open>
        <summary>Add / edit with standard DH</summary>
        <div class="dh-section-body">
          <div class="dh-grid-2">
            <div class="dh-field">
              <label for="dh-parent-${uid(container)}">Parent frame</label>
              <select id="dh-parent-${uid(container)}" data-parent-select></select>
            </div>
            <div class="dh-field">
              <label for="dh-name-${uid(container)}">Frame name</label>
              <input id="dh-name-${uid(container)}" data-frame-name value="F4" maxlength="12">
            </div>
          </div>
          <div class="dh-grid-4" style="margin-top:0.45rem">
            <div class="dh-field"><label>a [m]</label><input data-dh-input="a" type="number" step="0.05" value="0.8"></div>
            <div class="dh-field"><label>α [deg]</label><input data-dh-input="alpha" type="number" step="1" value="0"></div>
            <div class="dh-field"><label>d [m]</label><input data-dh-input="d" type="number" step="0.05" value="0"></div>
            <div class="dh-field"><label>θ [deg]</label><input data-dh-input="theta" type="number" step="1" value="0"></div>
          </div>
          <div class="dh-button-row">
            <button class="dh-button primary" type="button" data-add-frame>Add frame</button>
            <button class="dh-button" type="button" data-apply-frame>Apply to selected</button>
            <button class="dh-button danger" type="button" data-remove-frame>Remove selected</button>
          </div>
          <p class="dh-help">The new frame is created using \\(R_z(\\theta)T_z(d)T_x(a)R_x(\\alpha)\\) relative to its parent.</p>
          <p class="dh-live-note" data-live-note aria-live="polite"></p>
        </div>
      </details>

      <details open>
        <summary>Infer DH between two frames</summary>
        <div class="dh-section-body">
          <div class="dh-grid-2">
            <div class="dh-field"><label>Frame A</label><select data-infer-a></select></div>
            <div class="dh-field"><label>Frame B</label><select data-infer-b></select></div>
          </div>
          <div class="dh-result-grid" data-infer-results></div>
          <div class="dh-status" data-infer-status aria-live="polite"></div>
          <table class="dh-matrix" aria-label="Relative homogeneous transformation"><tbody data-infer-matrix></tbody></table>
          <p class="dh-help">A general rigid transform has 6 DOF; a standard-DH link transform has 4. A non-zero fit residual means the selected frames are not a valid consecutive standard-DH pair.</p>
        </div>
      </details>

      <details>
        <summary>Display</summary>
        <div class="dh-section-body dh-checks">
          <label><input type="checkbox" data-toggle-labels checked> labels</label>
          <label><input type="checkbox" data-toggle-zaxes checked> extended z-axes</label>
          <label><input type="checkbox" data-toggle-links checked> DH construction</label>
        </div>
      </details>
    </aside>
  `;

  const stage = container.querySelector('.dh-stage');
  const sceneKit = createScene(stage, { camera: [5.8, 3.4, 5.4] });
  const { robotWorld, renderer, camera, controls } = sceneKit;

  const state = {
    frames: new Map(),
    selectedId: null,
    nextIndex: 1,
    connectionObjects: [],
    robotRoot: new THREE.Group(),
    robotMode: 'default',
    bundledRobotModel: null,
    bundledRobotVisuals: [],
    robotMeshesVisible: true,
    robotOpacity: 0.65,
    showLabels: true,
    showZAxes: true,
    showLinks: true
  };

  const els = {
    frameList: container.querySelector('[data-frame-list]'),
    parentSelect: container.querySelector('[data-parent-select]'),
    frameName: container.querySelector('[data-frame-name]'),
    add: container.querySelector('[data-add-frame]'),
    apply: container.querySelector('[data-apply-frame]'),
    remove: container.querySelector('[data-remove-frame]'),
    reset: container.querySelector('[data-reset-custom3r]'),
    clear: container.querySelector('[data-clear-frames]'),
    liveNote: container.querySelector('[data-live-note]'),
    inferA: container.querySelector('[data-infer-a]'),
    inferB: container.querySelector('[data-infer-b]'),
    inferResults: container.querySelector('[data-infer-results]'),
    inferStatus: container.querySelector('[data-infer-status]'),
    inferMatrix: container.querySelector('[data-infer-matrix]'),
    labels: container.querySelector('[data-toggle-labels]'),
    zaxes: container.querySelector('[data-toggle-zaxes]'),
    links: container.querySelector('[data-toggle-links]'),
    robotFiles: container.querySelector('[data-robot-files]'),
    robotMeshes: container.querySelector('[data-toggle-robot-meshes]'),
    robotOpacity: container.querySelector('[data-robot-opacity]'),
    robotOpacityOutput: container.querySelector('[data-robot-opacity-output]'),
    robotStatus: container.querySelector('[data-robot-status]')
  };

  state.robotRoot.name = 'robot-visuals';
  robotWorld.add(state.robotRoot);

  const paramInput = (key) => container.querySelector(`[data-dh-input="${key}"]`);

  function clearRobotVisuals() {
    [...state.robotRoot.children].forEach((object) => {
      state.robotRoot.remove(object);
      disposeObject(object);
    });
    state.bundledRobotModel = null;
    state.bundledRobotVisuals = [];
  }

  function applyRobotDisplay() {
    state.robotRoot.visible = state.robotMeshesVisible;
    state.robotRoot.traverse((object) => {
      if (!object.isMesh || !object.material) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => {
        material.transparent = state.robotOpacity < 1;
        material.opacity = state.robotOpacity;
        material.depthWrite = state.robotOpacity >= 0.95;
        material.needsUpdate = true;
      });
    });
  }

  function robotMaterial(color = 0x8c8c8c) {
    return new THREE.MeshStandardMaterial({
      color,
      roughness: 0.62,
      metalness: 0.08,
      transparent: state.robotOpacity < 1,
      opacity: state.robotOpacity
    });
  }

  function addLinkMesh(start, end, radius, color) {
    const direction = end.clone().sub(start);
    const length = direction.length();
    if (length < EPS) return;
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, length, 24),
      robotMaterial(color)
    );
    mesh.position.copy(start).add(end).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    state.robotRoot.add(mesh);
  }

  function rebuildDefaultRobotVisuals() {
    if (state.robotMode !== 'default') return;
    clearRobotVisuals();

    const origins = ['F0', 'F1', 'F2', 'F3']
      .map((id) => state.frames.get(id))
      .filter(Boolean)
      .map((frame) => transformPoint(frame.robotMatrix, new THREE.Vector3()));
    if (!origins.length) return;

    addLinkMesh(new THREE.Vector3(), origins[0], 0.15, 0x555555);
    for (let i = 1; i < origins.length; i += 1) {
      const isToolLink = i === origins.length - 1;
      addLinkMesh(origins[i - 1], origins[i], isToolLink ? 0.11 : 0.14, isToolLink ? 0xd9272e : 0x767676);
    }
    origins.forEach((origin, i) => {
      const isTool = i === origins.length - 1;
      const joint = new THREE.Mesh(
        new THREE.SphereGeometry(isTool ? 0.14 : 0.19, 24, 18),
        robotMaterial(isTool ? 0xd9272e : 0x303030)
      );
      joint.position.copy(origin);
      state.robotRoot.add(joint);
    });
    applyRobotDisplay();
  }

  function updateBundledRobotVisuals() {
    if (state.robotMode !== 'bundled' || !state.bundledRobotModel) return;

    const jointAngles = new Map();
    for (let i = 1; i <= 3; i += 1) {
      const theta = state.frames.get('F' + i)?.params?.theta;
      if (Number.isFinite(theta)) jointAngles.set('joint_' + i, theta);
    }
    const linkMatrices = computeUrdfLinkMatrices(state.bundledRobotModel, jointAngles);
    state.bundledRobotVisuals.forEach((visual) => {
      const linkMatrix = linkMatrices.get(visual.linkName);
      if (!linkMatrix) return;
      visual.group.matrix.multiplyMatrices(linkMatrix, visual.origin);
      visual.group.matrixWorldNeedsUpdate = true;
    });
  }

  function fitCameraToRobot() {
    state.robotRoot.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(state.robotRoot);
    if (bounds.isEmpty()) return;
    const center = bounds.getCenter(new THREE.Vector3());
    const size = Math.max(bounds.getSize(new THREE.Vector3()).length(), 1);
    const viewDirection = camera.position.clone().sub(controls.target).normalize();
    controls.target.copy(center);
    camera.position.copy(center).addScaledVector(viewDirection, size * 1.25);
    camera.near = Math.max(size / 1000, 0.001);
    camera.far = Math.max(size * 20, 100);
    camera.updateProjectionMatrix();
    controls.update();
  }

  async function loadRobotFiles(fileList) {
    const files = [...fileList];
    const urdfFiles = files.filter((file) => file.name.toLowerCase().endsWith('.urdf'));
    if (urdfFiles.length !== 1) {
      throw new Error('Select exactly one .urdf file together with its referenced .stl files.');
    }

    const model = parseUrdf(await urdfFiles[0].text());
    const meshFiles = new Map();
    files.filter((file) => file.name.toLowerCase().endsWith('.stl')).forEach((file) => {
      const relativeName = normalizeMeshPath(file.webkitRelativePath || file.name);
      meshFiles.set(relativeName, file);
      meshFiles.set(file.name.toLowerCase(), file);
    });

    state.robotMode = 'imported';
    clearFrames();
    clearRobotVisuals();

    const jointsByParent = new Map();
    model.joints.forEach((joint) => {
      if (!jointsByParent.has(joint.parent)) jointsByParent.set(joint.parent, []);
      jointsByParent.get(joint.parent).push(joint);
    });

    const addLinkTree = (linkName, parentId = 'W', localMatrix = new THREE.Matrix4()) => {
      const id = 'urdf:' + linkName;
      addFrame({ id, name: linkName, parentId, type: 'fixed', fixedMatrix: localMatrix });
      (jointsByParent.get(linkName) || []).forEach((joint) => {
        addLinkTree(joint.child, id, joint.origin);
      });
    };
    model.roots.forEach((rootName) => addLinkTree(rootName));

    state.selectedId = model.roots.length ? 'urdf:' + model.roots[0] : null;
    state.nextIndex = state.frames.size + 1;
    updateAll();

    let loadedMeshes = 0;
    let missingMeshes = 0;
    for (const [linkName, link] of model.links) {
      const frame = state.frames.get('urdf:' + linkName);
      if (!frame) continue;
      for (const visual of link.visuals) {
        let geometry;
        if (visual.geometry.type === 'mesh') {
          const meshFile = findMeshFile(visual.geometry.filename, meshFiles);
          if (!meshFile) {
            missingMeshes += 1;
            continue;
          }
          geometry = parseStlGeometry(await meshFile.arrayBuffer());
        } else {
          geometry = createUrdfPrimitiveGeometry(visual.geometry);
        }
        if (!geometry) continue;

        const group = new THREE.Group();
        group.matrixAutoUpdate = false;
        group.matrix.multiplyMatrices(frame.robotMatrix, visual.origin);
        const mesh = new THREE.Mesh(geometry, robotMaterial(visual.color));
        if (visual.geometry.scale) mesh.scale.fromArray(visual.geometry.scale);
        group.add(mesh);
        state.robotRoot.add(group);
        loadedMeshes += 1;
      }
    }

    applyRobotDisplay();
    fitCameraToRobot();
    const missing = missingMeshes
      ? ', ' + missingMeshes + ' missing STL file' + (missingMeshes === 1 ? '' : 's')
      : '';
    els.robotStatus.textContent = 'Loaded ' + model.name + ': ' + model.links.size + ' links, ' + loadedMeshes + ' visuals' + missing + '.';
    note('Loaded URDF robot ' + model.name + ' at its zero joint configuration.');
  }

  async function loadBundledCustom3RVisuals() {
    const modelRoot = new URL('../../assets/models/custom_3R/', import.meta.url);
    const urdfUrl = new URL('custom_3R.urdf', modelRoot);
    const response = await fetch(urdfUrl);
    if (!response.ok) throw new Error('Could not load the bundled custom_3R URDF.');
    const model = parseUrdf(await response.text());
    const linkMatrices = computeUrdfLinkMatrices(model);

    state.robotMode = 'bundled';
    clearRobotVisuals();
    state.robotMode = 'bundled';
    state.bundledRobotModel = model;
    let loadedMeshes = 0;
    for (const [linkName, link] of model.links) {
      const linkMatrix = linkMatrices.get(linkName);
      if (!linkMatrix) continue;
      for (const visual of link.visuals) {
        let geometry;
        if (visual.geometry.type === 'mesh') {
          const meshName = normalizeMeshPath(visual.geometry.filename).split('/').at(-1);
          const meshResponse = await fetch(new URL(meshName, modelRoot));
          if (!meshResponse.ok) throw new Error('Could not load bundled mesh ' + meshName + '.');
          geometry = parseStlGeometry(await meshResponse.arrayBuffer());
        } else {
          geometry = createUrdfPrimitiveGeometry(visual.geometry);
        }
        if (!geometry) continue;

        const group = new THREE.Group();
        group.matrixAutoUpdate = false;
        group.matrix.multiplyMatrices(linkMatrix, visual.origin);
        const mesh = new THREE.Mesh(geometry, robotMaterial(visual.color));
        if (visual.geometry.scale) mesh.scale.fromArray(visual.geometry.scale);
        group.add(mesh);
        state.robotRoot.add(group);
        state.bundledRobotVisuals.push({ linkName, group, origin: visual.origin.clone() });
        loadedMeshes += 1;
      }
    }
    applyRobotDisplay();
    updateBundledRobotVisuals();
    fitCameraToRobot();
    els.robotStatus.textContent = 'Default: custom_3R URDF with ' + loadedMeshes + ' STL visuals and DH frames F0–F3.';
  }

  function addFrame(spec) {
    if (state.frames.has(spec.id)) throw new Error(`Frame id ${spec.id} already exists.`);
    const visual = createFrameVisual(spec.name, false);
    const zAxis = createAxisExtension();
    visual.group.add(zAxis);
    visual.zAxis = zAxis;
    visual.group.userData.frameId = spec.id;
    visual.marker.userData.frameId = spec.id;
    robotWorld.add(visual.group);

    state.frames.set(spec.id, {
      id: spec.id,
      name: spec.name,
      parentId: spec.parentId ?? 'W',
      type: spec.type || 'dh',
      params: spec.params ? { ...spec.params } : null,
      fixedMatrix: spec.fixedMatrix ? spec.fixedMatrix.clone() : null,
      robotMatrix: new THREE.Matrix4(),
      visual
    });
  }

  function removeFrameTree(id) {
    const descendants = [];
    const visit = (parentId) => {
      for (const frame of state.frames.values()) {
        if (frame.parentId === parentId) {
          descendants.push(frame.id);
          visit(frame.id);
        }
      }
    };
    descendants.push(id);
    visit(id);
    const unique = [...new Set(descendants)].reverse();
    unique.forEach((frameId) => {
      const frame = state.frames.get(frameId);
      if (!frame) return;
      robotWorld.remove(frame.visual.group);
      disposeObject(frame.visual.group);
      state.frames.delete(frameId);
    });
  }

  function clearFrames() {
    [...state.frames.keys()].forEach((id) => {
      const frame = state.frames.get(id);
      robotWorld.remove(frame.visual.group);
      disposeObject(frame.visual.group);
    });
    state.frames.clear();
    state.selectedId = null;
  }

  function loadCustom3R() {
    state.robotMode = 'bundled-loading';
    clearFrames();
    clearRobotVisuals();
    addFrame({
      id: 'F0',
      name: 'F0',
      parentId: 'W',
      type: 'fixed',
      fixedMatrix: new THREE.Matrix4().makeTranslation(0, 0, 1.0)
    });
    addFrame({ id: 'F1', name: 'F1', parentId: 'F0', params: { a: 1.0, alpha: -90 * DEG, d: 0.0, theta: 0.0 } });
    addFrame({ id: 'F2', name: 'F2', parentId: 'F1', params: { a: 2.0, alpha: 90 * DEG, d: 1.25, theta: 0.0 } });
    addFrame({ id: 'F3', name: 'F3', parentId: 'F2', params: { a: 1.5, alpha: 0.0, d: 0.25, theta: 0.0 } });
    state.nextIndex = 4;
    state.selectedId = 'F1';
    updateAll();
    els.inferA.value = 'F0';
    els.inferB.value = 'F1';
    updateInference();
    els.robotStatus.textContent = 'Loading bundled custom_3R URDF and STL visuals…';
    note('Loaded the custom_3R DH teaching model. F0 is offset from the URDF base by a fixed transform.');
    loadBundledCustom3RVisuals().catch((error) => {
      console.error('Bundled custom_3R load failed:', error);
      state.robotMode = 'default';
      rebuildDefaultRobotVisuals();
      els.robotStatus.textContent = 'Bundled STL load failed; showing the geometric custom_3R fallback.';
    });
  }

  function getLocalMatrix(frame) {
    if (frame.type === 'fixed') return frame.fixedMatrix.clone();
    return makeDHMatrix(frame.params.a, frame.params.alpha, frame.params.d, frame.params.theta);
  }

  function computeWorldMatrices() {
    const resolving = new Set();
    const resolved = new Set();
    const solve = (id) => {
      if (id === 'W') return new THREE.Matrix4();
      const frame = state.frames.get(id);
      if (!frame) return new THREE.Matrix4();
      if (resolved.has(id)) return frame.robotMatrix;
      if (resolving.has(id)) throw new Error('Frame parenting contains a cycle.');
      resolving.add(id);
      const parentWorld = frame.parentId === 'W' ? new THREE.Matrix4() : solve(frame.parentId);
      frame.robotMatrix.multiplyMatrices(parentWorld, getLocalMatrix(frame));
      resolving.delete(id);
      resolved.add(id);
      return frame.robotMatrix;
    };
    state.frames.forEach((_, id) => solve(id));
  }

  function rebuildConnections() {
    state.connectionObjects.forEach((obj) => {
      robotWorld.remove(obj);
      disposeObject(obj);
    });
    state.connectionObjects = [];
    if (!state.showLinks) return;

    for (const frame of state.frames.values()) {
      const parentMatrix = frame.parentId === 'W'
        ? new THREE.Matrix4()
        : state.frames.get(frame.parentId)?.robotMatrix;
      if (!parentMatrix) continue;

      const parentOrigin = transformPoint(parentMatrix, new THREE.Vector3());
      const childOrigin = transformPoint(frame.robotMatrix, new THREE.Vector3());
      const selected = frame.id === state.selectedId;

      if (frame.type === 'dh') {
        const { a, d, theta } = frame.params;
        const afterDLocal = new THREE.Vector3(0, 0, d);
        const afterALocal = new THREE.Vector3(a * Math.cos(theta), a * Math.sin(theta), d);
        const afterD = transformPoint(parentMatrix, afterDLocal);
        const afterA = transformPoint(parentMatrix, afterALocal);
        const zSegment = createLine([parentOrigin, afterD], selected ? 0xff0000 : 0x8b8b8b, selected ? 0.95 : 0.52);
        const aSegment = createLine([afterD, afterA], selected ? 0xff0000 : 0x111111, selected ? 0.95 : 0.72);
        state.connectionObjects.push(zSegment, aSegment);
        robotWorld.add(zSegment, aSegment);
      } else {
        const fixedLine = createLine([parentOrigin, childOrigin], 0x888888, 0.45, true);
        state.connectionObjects.push(fixedLine);
        robotWorld.add(fixedLine);
      }
    }
  }

  function updateVisuals() {
    computeWorldMatrices();
    for (const frame of state.frames.values()) {
      frame.visual.group.matrix.copy(frame.robotMatrix);
      frame.visual.group.matrixWorldNeedsUpdate = true;
      setFrameVisualSelected(frame.visual, frame.id === state.selectedId);
      frame.visual.label.visible = state.showLabels;
      frame.visual.zAxis.visible = state.showZAxes;
    }
    rebuildConnections();
    rebuildDefaultRobotVisuals();
    updateBundledRobotVisuals();
  }

  function frameOptionsHtml() {
    return [
      '<option value="W">W · world</option>',
      ...[...state.frames.values()].map((frame) => `<option value="${escapeHtml(frame.id)}">${escapeHtml(frame.name)}</option>`)
    ].join('');
  }

  function refreshUI() {
    const frames = [...state.frames.values()];
    els.frameList.innerHTML = frames.length
      ? frames.map((frame) => {
          const selected = frame.id === state.selectedId ? ' is-selected' : '';
          const desc = frame.type === 'dh'
            ? `a ${formatNumber(frame.params.a, 2)} · α ${formatDeg(frame.params.alpha, 0)}`
            : 'fixed frame';
          return `<button class="dh-frame-chip${selected}" type="button" data-frame-chip="${escapeHtml(frame.id)}"><strong>${escapeHtml(frame.name)}</strong><span class="dh-mini">${desc}</span></button>`;
        }).join('')
      : '<span class="dh-help">No user frames. Add one relative to W.</span>';

    const options = frameOptionsHtml();
    const parentBefore = els.parentSelect.value;
    const inferABefore = els.inferA.value;
    const inferBBefore = els.inferB.value;
    els.parentSelect.innerHTML = options;
    els.inferA.innerHTML = options;
    els.inferB.innerHTML = options;

    if (optionExists(els.parentSelect, parentBefore)) els.parentSelect.value = parentBefore;
    if (optionExists(els.inferA, inferABefore)) els.inferA.value = inferABefore;
    if (optionExists(els.inferB, inferBBefore)) els.inferB.value = inferBBefore;

    els.frameList.querySelectorAll('[data-frame-chip]').forEach((button) => {
      button.addEventListener('click', () => selectFrame(button.dataset.frameChip));
    });

    syncEditorFromSelected();
  }

  function selectFrame(id) {
    if (!state.frames.has(id)) return;
    state.selectedId = id;
    updateVisuals();
    refreshUI();
    const frame = state.frames.get(id);
    note(`Selected ${frame.name}.`);
  }

  function syncEditorFromSelected() {
    const frame = state.frames.get(state.selectedId);
    const editable = frame?.type === 'dh';
    els.apply.disabled = !editable;
    els.remove.disabled = !frame;
    if (!frame) return;

    els.frameName.value = frame.name;
    if (optionExists(els.parentSelect, frame.id)) els.parentSelect.value = frame.id;
    if (editable) {
      paramInput('a').value = formatNumber(frame.params.a, 4);
      paramInput('alpha').value = formatNumber(frame.params.alpha * RAD, 3);
      paramInput('d').value = formatNumber(frame.params.d, 4);
      paramInput('theta').value = formatNumber(frame.params.theta * RAD, 3);
    }
  }

  function updateInference() {
    const aId = els.inferA.value || 'W';
    const bId = els.inferB.value || 'W';
    const aWorld = aId === 'W' ? new THREE.Matrix4() : state.frames.get(aId)?.robotMatrix;
    const bWorld = bId === 'W' ? new THREE.Matrix4() : state.frames.get(bId)?.robotMatrix;
    if (!aWorld || !bWorld) return;

    const relative = new THREE.Matrix4().multiplyMatrices(aWorld.clone().invert(), bWorld);
    const inferred = inferStandardDH(relative);
    els.inferResults.innerHTML = [
      ['a', `${formatNumber(inferred.a, 4)} m`],
      ['\\alpha', formatDeg(inferred.alpha, 2)],
      ['d', `${formatNumber(inferred.d, 4)} m`],
      ['\\theta', formatDeg(inferred.theta, 2)]
    ].map(([symbol, value]) => `<div class="dh-result"><span class="symbol">\\(${symbol}\\)</span><span class="value">${value}</span></div>`).join('');
    typesetMath(els.inferResults);

    els.inferMatrix.innerHTML = matrixTableHtml(relative, 3);
    els.inferStatus.classList.toggle('is-warning', !inferred.compatible);
    els.inferStatus.innerHTML = inferred.compatible
      ? `<strong>DH-compatible</strong><span>fit residual ${inferred.residual.toExponential(2)}</span>`
      : `<strong>Not a consecutive DH pair</strong><span>best 4-parameter fit residual ${inferred.residual.toExponential(2)}</span>`;
  }

  function updateAll() {
    if (state.selectedId && !state.frames.has(state.selectedId)) state.selectedId = null;
    updateVisuals();
    refreshUI();
    updateInference();
  }

  function note(message) {
    els.liveNote.textContent = message;
  }

  function previewSelectedDHParameters() {
    const frame = state.frames.get(state.selectedId);
    if (!frame || frame.type !== 'dh') return;
    const values = {
      a: paramInput('a').valueAsNumber,
      alpha: paramInput('alpha').valueAsNumber,
      d: paramInput('d').valueAsNumber,
      theta: paramInput('theta').valueAsNumber
    };
    if (Object.values(values).some((value) => !Number.isFinite(value))) return;

    frame.params = {
      a: values.a,
      alpha: values.alpha * DEG,
      d: values.d,
      theta: values.theta * DEG
    };
    updateVisuals();
    updateInference();
  }

  ['a', 'alpha', 'd', 'theta'].forEach((key) => {
    paramInput(key).addEventListener('input', previewSelectedDHParameters);
  });

  els.add.addEventListener('click', () => {
    const parentId = els.parentSelect.value || 'W';
    let proposedName = (els.frameName.value || '').trim() || `F${state.nextIndex}`;
    const selected = state.frames.get(state.selectedId);
    if (selected && proposedName === selected.name) proposedName = `F${state.nextIndex}`;
    const name = uniqueFrameName(proposedName, state.frames);
    const id = `U${Date.now().toString(36)}${state.nextIndex}`;
    addFrame({
      id,
      name,
      parentId,
      params: readDHInputs(paramInput)
    });
    state.nextIndex += 1;
    state.selectedId = id;
    updateAll();
    els.inferA.value = parentId;
    els.inferB.value = id;
    updateInference();
    note(`Added ${name} as a DH child of ${labelForFrame(parentId, state.frames)}.`);
  });

  els.apply.addEventListener('click', () => {
    const frame = state.frames.get(state.selectedId);
    if (!frame || frame.type !== 'dh') return;
    frame.params = readDHInputs(paramInput);
    frame.name = uniqueFrameName((els.frameName.value || frame.name).trim() || frame.name, state.frames, frame.id);
    frame.visual.group.userData.frameName = frame.name;
    updateAll();
    note(`Updated ${frame.name} from the four DH parameters.`);
  });

  els.remove.addEventListener('click', () => {
    const frame = state.frames.get(state.selectedId);
    if (!frame) return;
    const oldName = frame.name;
    removeFrameTree(frame.id);
    state.selectedId = state.frames.size ? [...state.frames.keys()].at(-1) : null;
    updateAll();
    note(`Removed ${oldName} and any descendant frames.`);
  });

  els.reset.addEventListener('click', loadCustom3R);
  els.clear.addEventListener('click', () => {
    state.robotMode = 'none';
    clearFrames();
    clearRobotVisuals();
    state.nextIndex = 1;
    updateAll();
    els.parentSelect.value = 'W';
    els.inferA.value = 'W';
    els.inferB.value = 'W';
    els.frameName.value = 'F1';
    note('Cleared all user frames. World W remains fixed.');
  });

  els.robotFiles.addEventListener('change', async () => {
    if (!els.robotFiles.files.length) return;
    els.robotFiles.disabled = true;
    els.robotStatus.textContent = 'Loading URDF and meshes…';
    try {
      await loadRobotFiles(els.robotFiles.files);
    } catch (error) {
      console.error('URDF/STL import failed:', error);
      els.robotStatus.textContent = 'Import failed: ' + error.message;
      note('Robot import failed. Reset custom_3R to restore the default model.');
    } finally {
      els.robotFiles.disabled = false;
      els.robotFiles.value = '';
    }
  });
  els.robotMeshes.addEventListener('change', () => {
    state.robotMeshesVisible = els.robotMeshes.checked;
    applyRobotDisplay();
  });
  els.robotOpacity.addEventListener('input', () => {
    state.robotOpacity = Number(els.robotOpacity.value);
    els.robotOpacityOutput.textContent = Math.round(state.robotOpacity * 100) + '%';
    applyRobotDisplay();
  });

  els.inferA.addEventListener('change', updateInference);
  els.inferB.addEventListener('change', updateInference);
  els.labels.addEventListener('change', () => { state.showLabels = els.labels.checked; updateVisuals(); });
  els.zaxes.addEventListener('change', () => { state.showZAxes = els.zaxes.checked; updateVisuals(); });
  els.links.addEventListener('change', () => { state.showLinks = els.links.checked; rebuildConnections(); });

  enableFramePicking(renderer.domElement, camera, () => [...state.frames.values()].map((f) => f.visual), (id) => {
    if (id) selectFrame(id);
  }, robotWorld);

  loadCustom3R();
  typesetMath(container);
}

function directChild(element, tagName) {
  return [...(element?.children || [])].find((child) => child.tagName.toLowerCase() === tagName) || null;
}

function numberList(value, fallback) {
  if (!value) return [...fallback];
  const values = value.trim().split(/\s+/).map(Number);
  return values.length === fallback.length && values.every(Number.isFinite) ? values : [...fallback];
}

function urdfOrigin(element) {
  const origin = directChild(element, 'origin');
  const [x, y, z] = numberList(origin?.getAttribute('xyz'), [0, 0, 0]);
  const [roll, pitch, yaw] = numberList(origin?.getAttribute('rpy'), [0, 0, 0]);
  return makeRPYMatrix(x, y, z, roll, pitch, yaw);
}

function urdfColor(materialElement, namedMaterials) {
  const inlineColor = directChild(materialElement, 'color')?.getAttribute('rgba');
  const namedColor = namedMaterials.get(materialElement?.getAttribute('name')) || null;
  const rgba = numberList(inlineColor || namedColor, [0.55, 0.55, 0.55, 1]);
  return new THREE.Color(rgba[0], rgba[1], rgba[2]).getHex();
}

function parseUrdfGeometry(geometryElement) {
  const mesh = directChild(geometryElement, 'mesh');
  if (mesh) {
    return {
      type: 'mesh',
      filename: mesh.getAttribute('filename') || '',
      scale: numberList(mesh.getAttribute('scale'), [1, 1, 1])
    };
  }
  const box = directChild(geometryElement, 'box');
  if (box) return { type: 'box', size: numberList(box.getAttribute('size'), [1, 1, 1]) };
  const cylinder = directChild(geometryElement, 'cylinder');
  if (cylinder) {
    return {
      type: 'cylinder',
      radius: finiteNumber(cylinder.getAttribute('radius'), 0.5),
      length: finiteNumber(cylinder.getAttribute('length'), 1)
    };
  }
  const sphere = directChild(geometryElement, 'sphere');
  if (sphere) return { type: 'sphere', radius: finiteNumber(sphere.getAttribute('radius'), 0.5) };
  return null;
}

function parseUrdf(xmlText) {
  const documentNode = new DOMParser().parseFromString(xmlText, 'application/xml');
  const parseError = documentNode.querySelector('parsererror');
  if (parseError) throw new Error('The URDF is not valid XML.');
  const robot = documentNode.documentElement;
  if (robot.tagName.toLowerCase() !== 'robot') throw new Error('The selected XML file has no <robot> root.');

  const namedMaterials = new Map();
  [...robot.children].filter((element) => element.tagName.toLowerCase() === 'material').forEach((material) => {
    const rgba = directChild(material, 'color')?.getAttribute('rgba');
    if (material.getAttribute('name') && rgba) namedMaterials.set(material.getAttribute('name'), rgba);
  });

  const links = new Map();
  [...robot.children].filter((element) => element.tagName.toLowerCase() === 'link').forEach((linkElement) => {
    const name = linkElement.getAttribute('name');
    if (!name) return;
    const visuals = [...linkElement.children]
      .filter((element) => element.tagName.toLowerCase() === 'visual')
      .map((visualElement) => {
        const geometry = parseUrdfGeometry(directChild(visualElement, 'geometry'));
        if (!geometry) return null;
        return {
          origin: urdfOrigin(visualElement),
          geometry,
          color: urdfColor(directChild(visualElement, 'material'), namedMaterials)
        };
      })
      .filter(Boolean);
    links.set(name, { name, visuals });
  });

  const joints = [...robot.children]
    .filter((element) => element.tagName.toLowerCase() === 'joint')
    .map((jointElement) => ({
      name: jointElement.getAttribute('name') || 'joint',
      type: jointElement.getAttribute('type') || 'fixed',
      parent: directChild(jointElement, 'parent')?.getAttribute('link') || '',
      child: directChild(jointElement, 'child')?.getAttribute('link') || '',
      origin: urdfOrigin(jointElement),
      axis: new THREE.Vector3(...numberList(
        directChild(jointElement, 'axis')?.getAttribute('xyz'),
        [1, 0, 0]
      )).normalize(),
      position: 0
    }))
    .filter((joint) => links.has(joint.parent) && links.has(joint.child));

  const childLinks = new Set(joints.map((joint) => joint.child));
  const roots = [...links.keys()].filter((name) => !childLinks.has(name));
  if (!links.size || !roots.length) throw new Error('The URDF contains no valid rooted link tree.');

  return {
    name: robot.getAttribute('name') || 'URDF robot',
    links,
    joints,
    roots
  };
}

function computeUrdfLinkMatrices(model, jointAngles = new Map()) {
  const matrices = new Map();
  const jointsByParent = new Map();
  model.joints.forEach((joint) => {
    if (!jointsByParent.has(joint.parent)) jointsByParent.set(joint.parent, []);
    jointsByParent.get(joint.parent).push(joint);
  });
  const visit = (linkName, worldMatrix) => {
    matrices.set(linkName, worldMatrix);
    (jointsByParent.get(linkName) || []).forEach((joint) => {
      const angle = jointAngles.get(joint.name) ?? joint.position ?? 0;
      joint.position = angle;
      const motion = joint.type === 'revolute' || joint.type === 'continuous'
        ? new THREE.Matrix4().makeRotationAxis(joint.axis, angle)
        : new THREE.Matrix4();
      const localMatrix = new THREE.Matrix4().multiplyMatrices(joint.origin, motion);
      visit(joint.child, new THREE.Matrix4().multiplyMatrices(worldMatrix, localMatrix));
    });
  };
  model.roots.forEach((rootName) => visit(rootName, new THREE.Matrix4()));
  return matrices;
}

function normalizeMeshPath(filename) {
  let path = String(filename || '').replaceAll('\\', '/').toLowerCase();
  path = path.replace(/^package:\/\/[^/]+\//, '').replace(/^file:\/\//, '');
  try {
    path = decodeURIComponent(path);
  } catch {
    // Keep the literal path when it contains malformed URL escapes.
  }
  return path.replace(/^\.?\//, '');
}

function findMeshFile(filename, meshFiles) {
  const normalized = normalizeMeshPath(filename);
  const basename = normalized.split('/').at(-1);
  if (meshFiles.has(normalized)) return meshFiles.get(normalized);
  if (meshFiles.has(basename)) return meshFiles.get(basename);
  for (const [path, file] of meshFiles) {
    if (path.endsWith('/' + normalized) || path.endsWith('/' + basename)) return file;
  }
  return null;
}

function createUrdfPrimitiveGeometry(spec) {
  if (spec.type === 'box') return new THREE.BoxGeometry(...spec.size);
  if (spec.type === 'sphere') return new THREE.SphereGeometry(spec.radius, 28, 20);
  if (spec.type === 'cylinder') {
    const geometry = new THREE.CylinderGeometry(spec.radius, spec.radius, spec.length, 28);
    geometry.rotateX(Math.PI / 2);
    return geometry;
  }
  return null;
}

export function parseStlGeometry(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  const triangleCount = arrayBuffer.byteLength >= 84 ? view.getUint32(80, true) : 0;
  const expectedBinarySize = 84 + triangleCount * 50;
  const isBinary = triangleCount > 0 && expectedBinarySize === arrayBuffer.byteLength;
  const positions = [];
  const normals = [];

  if (isBinary) {
    let offset = 84;
    for (let triangle = 0; triangle < triangleCount; triangle += 1) {
      const normal = [
        view.getFloat32(offset, true),
        view.getFloat32(offset + 4, true),
        view.getFloat32(offset + 8, true)
      ];
      offset += 12;
      for (let vertex = 0; vertex < 3; vertex += 1) {
        positions.push(
          view.getFloat32(offset, true),
          view.getFloat32(offset + 4, true),
          view.getFloat32(offset + 8, true)
        );
        normals.push(...normal);
        offset += 12;
      }
      offset += 2;
    }
  } else {
    const text = new TextDecoder().decode(arrayBuffer);
    const number = '([-+]?(?:\\d*\\.)?\\d+(?:[eE][-+]?\\d+)?)';
    const vertexPattern = new RegExp('vertex\\s+' + number + '\\s+' + number + '\\s+' + number, 'gi');
    for (const match of text.matchAll(vertexPattern)) {
      positions.push(Number(match[1]), Number(match[2]), Number(match[3]));
    }
  }

  if (positions.length < 9 || positions.length % 9 !== 0) {
    throw new Error('An STL file contains no valid triangle geometry.');
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  if (normals.length === positions.length) {
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  } else {
    geometry.computeVertexNormals();
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function readDHInputs(getInput) {
  return {
    a: finiteNumber(getInput('a').value, 0),
    alpha: finiteNumber(getInput('alpha').value, 0) * DEG,
    d: finiteNumber(getInput('d').value, 0),
    theta: finiteNumber(getInput('theta').value, 0) * DEG
  };
}

function wouldCreateCycle(frameId, proposedParent, frames) {
  if (proposedParent === 'W') return false;
  if (proposedParent === frameId) return true;
  let current = frames.get(proposedParent);
  const visited = new Set();
  while (current && !visited.has(current.id)) {
    if (current.parentId === frameId) return true;
    visited.add(current.id);
    current = current.parentId === 'W' ? null : frames.get(current.parentId);
  }
  return false;
}

function uniqueFrameName(name, frames, excludeId = null) {
  const used = new Set([...frames.values()].filter((f) => f.id !== excludeId).map((f) => f.name));
  if (!used.has(name)) return name;
  let i = 2;
  while (used.has(`${name}_${i}`)) i += 1;
  return `${name}_${i}`;
}

function labelForFrame(id, frames) {
  return id === 'W' ? 'W' : (frames.get(id)?.name || id);
}

function optionExists(select, value) {
  return [...select.options].some((option) => option.value === value);
}

function finiteNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function disposeObject(object) {
  object.traverse?.((child) => {
    child.geometry?.dispose?.();
    if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose?.());
    else child.material?.dispose?.();
    child.material?.map?.dispose?.();
  });
  object.geometry?.dispose?.();
  object.material?.dispose?.();
}

function enableFramePicking(domElement, camera, visualSource, onPick, root = null) {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  domElement.addEventListener('pointerdown', (event) => {
    const rect = domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const visuals = typeof visualSource === 'function' ? visualSource() : visualSource;
    if (root) root.updateMatrixWorld(true);
    const markers = visuals.map((v) => v.marker).filter(Boolean);
    const hits = raycaster.intersectObjects(markers, false);
    if (!hits.length) return;
    onPick(hits[0].object.userData.frameId || null);
  });
}

function createCustom3RDHDemo(container) {
  container.classList.add('custom3r-dh-demo');
  container.innerHTML = `
    <div class="custom3r-stage">
      <p class="custom3r-stage-note">custom_3R · exact kinematic match to the uploaded URDF chain · z-up</p>
    </div>
    <div class="custom3r-panel">
      <div class="custom3r-card">
        <strong>Move the three revolute coordinates</strong>
        <div data-q-controls style="margin-top:0.5rem"></div>
      </div>
      <div class="custom3r-card">
        <strong>Standard DH table</strong>
        <table class="custom3r-table">
          <thead><tr><th>i</th><th>aᵢ [m]</th><th>αᵢ</th><th>dᵢ [m]</th><th>θᵢ</th></tr></thead>
          <tbody>
            <tr data-row="1"><td>1</td><td>1.00</td><td>−90°</td><td>0.00</td><td>q₁</td></tr>
            <tr data-row="2"><td>2</td><td>2.00</td><td>+90°</td><td>1.25</td><td>q₂</td></tr>
            <tr data-row="3"><td>3</td><td>1.50</td><td>0°</td><td>0.25</td><td>q₃</td></tr>
          </tbody>
        </table>
        <p class="dh-help">Fixed base transform: \\({}^{W}T_{0}=T_z(1.0\\,\\mathrm{m})\\). The DH frame origin may lie anywhere on the same revolute axis; it need not coincide with the URDF joint-origin point.</p>
      </div>
      <div class="custom3r-card">
        <strong>Tool pose \\({}^{W}T_{3}\\)</strong>
        <table class="dh-matrix"><tbody data-tool-matrix></tbody></table>
      </div>
    </div>
  `;

  const stage = container.querySelector('.custom3r-stage');
  const sceneKit = createScene(stage, { camera: [6.3, 3.8, 5.9] });
  const { robotWorld } = sceneKit;
  const q = [0, 0, 0];

  const base = new THREE.Matrix4().makeTranslation(0, 0, 1.0);
  const params = [
    { a: 1.0, alpha: -90 * DEG, d: 0.0 },
    { a: 2.0, alpha: 90 * DEG, d: 1.25 },
    { a: 1.5, alpha: 0, d: 0.25 }
  ];

  const frames = ['F0', 'F1', 'F2', 'F3'].map((name, i) => {
    const visual = createFrameVisual(name, i === 0);
    visual.zAxis = createAxisExtension(i < 3 ? 4.4 : 2.0, i < 3 ? 0x555555 : 0xaaaaaa);
    visual.group.add(visual.zAxis);
    robotWorld.add(visual.group);
    return visual;
  });

  const linkObjects = [];
  const matrixBody = container.querySelector('[data-tool-matrix]');
  const controlsHost = container.querySelector('[data-q-controls]');

  controlsHost.innerHTML = [0, 1, 2].map((i) => `
    <div class="custom3r-slider">
      <label for="custom-q${i + 1}-${uid(container)}">q${i + 1}</label>
      <input id="custom-q${i + 1}-${uid(container)}" data-q="${i}" type="range" min="-170" max="170" step="1" value="0">
      <output data-q-out="${i}">0°</output>
    </div>`).join('');

  function update() {
    let current = base.clone();
    const matrices = [current.clone()];
    for (let i = 0; i < 3; i += 1) {
      current = new THREE.Matrix4().multiplyMatrices(current, makeDHMatrix(params[i].a, params[i].alpha, params[i].d, q[i]));
      matrices.push(current.clone());
    }

    matrices.forEach((matrix, i) => {
      frames[i].group.matrix.copy(matrix);
      frames[i].group.matrixWorldNeedsUpdate = true;
    });

    linkObjects.forEach((obj) => {
      robotWorld.remove(obj);
      disposeObject(obj);
    });
    linkObjects.length = 0;

    for (let i = 1; i < matrices.length; i += 1) {
      const p0 = transformPoint(matrices[i - 1], new THREE.Vector3());
      const p1 = transformPoint(matrices[i], new THREE.Vector3());
      const line = createLine([p0, p1], i === 3 ? 0xff0000 : 0x222222, 0.82);
      linkObjects.push(line);
      robotWorld.add(line);
    }

    matrixBody.innerHTML = matrixTableHtml(matrices[3], 3);
    container.querySelectorAll('[data-q-out]').forEach((out) => {
      const i = Number(out.dataset.qOut);
      out.textContent = `${Math.round(q[i] * RAD)}°`;
    });
  }

  container.querySelectorAll('[data-q]').forEach((input) => {
    input.addEventListener('input', () => {
      const i = Number(input.dataset.q);
      q[i] = Number(input.value) * DEG;
      container.querySelectorAll('[data-row]').forEach((row) => row.classList.toggle('is-active', Number(row.dataset.row) === i + 1));
      update();
    });
    input.addEventListener('focus', () => {
      const i = Number(input.dataset.q);
      container.querySelectorAll('[data-row]').forEach((row) => row.classList.toggle('is-active', Number(row.dataset.row) === i + 1));
    });
  });

  update();
  typesetMath(container);
}

function typesetMath(container) {
  if (window.MathJax?.typesetPromise) {
    window.MathJax.typesetPromise([container]).catch((error) => console.warn('MathJax typeset failed:', error));
  }
}

function uid(element) {
  if (!element.dataset.uid) element.dataset.uid = Math.random().toString(36).slice(2, 8);
  return element.dataset.uid;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
