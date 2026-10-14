/* Lecture 05: keep the ABB screw geometry beside each Jacobian representation. */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createZUpWorld, createSceneControlPanel, resizeRendererToContainer } from './threeUtils.js';
import { loadAbbIrbVisuals } from './abbIrbVisuals.js';
import { abbDHKinematics, abbUrdfTransforms, abbJacobian, abbPreset, abbFactors } from './abbIrbKinematics.js';

const BLUE = 0x3f6ea8, RED = 0xed1b2f, OCHRE = 0xd79b00, INK = 0x333333;
const REPRESENTATIONS = {
  'world-tool': { point: 6, basis: 0, name: '⁰Jₜ · tool point, world axes' },
  'world-wrist': { point: 5, basis: 0, name: '⁰J₅ · wrist center, world axes' },
  'frame3-wrist': { point: 5, basis: 3, name: '³J₅ · wrist center, frame-3 axes' }
};
const superscript = value => value === 3 ? '³' : '⁰';
const subscript = value => '₀₁₂₃₄₅₆'[value];
const xyz = values => values.map(value => Math.abs(value) < .0005 ? '0.000' : value.toFixed(3)).join(', ');
const framePoint = (kin, i) => new THREE.Vector3(...kin.frames[i].slice(0, 3).map(row => row[3]));
const frameRotation = (kin, i) => new THREE.Matrix3().set(...kin.frames[i].slice(0, 3).flatMap(row => row.slice(0, 3)));

function init() {
  const instances = new Map();
  const hosts = [...document.querySelectorAll('[data-abb-jacobian]')];
  const ensure = host => {
    if (instances.has(host)) return;
    try { instances.set(host, createView(host)); }
    catch (error) {
      host.dataset.error = error.message;
      host.textContent = `ABB geometry could not load: ${error.message}`;
      console.error(error);
    }
  };
  const visibility = new IntersectionObserver(entries => entries.forEach(entry => {
    if (entry.isIntersecting) ensure(entry.target);
  }), { rootMargin: '80px', threshold: .01 });
  hosts.forEach(host => visibility.observe(host));
  const active = document.querySelector('.slide.active [data-abb-jacobian]');
  if (active) ensure(active);
  window.addEventListener('pagehide', () => {
    visibility.disconnect();
    instances.forEach(view => view.dispose());
  }, { once: true });
}

function createView(host) {
  const initial = host.dataset.abbJacobian;
  const state = { representation: initial, column: Number(host.dataset.column || 2) - 1 };
  const q = host.dataset.pose === 'home' ? Array(6).fill(0) : abbPreset();
  const kin = abbDHKinematics(q);
  const slide = host.closest('.slide');
  host.classList.add('l5-abb-geometry');
  host.innerHTML = `<div class="l5-abb-toolbar"></div><div class="l5-abb-stage"></div>
    <div class="l5-abb-readout" aria-live="polite"></div>`;
  const toolbar = host.querySelector('.l5-abb-toolbar');
  const stage = host.querySelector('.l5-abb-stage');
  const readout = host.querySelector('.l5-abb-readout');
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xfcfcfc);
  const camera = new THREE.PerspectiveCamera(38, 1, .01, 80);
  camera.position.set(3.6, 2.7, 3.9);
  if (host.dataset.showRadial === 'true') camera.position.set(3.6, 2.7, 1.8);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.7));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = .85;
  stage.append(renderer.domElement);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x59636e, 2.4));
  const light = new THREE.DirectionalLight(0xffffff, 2.2);
  light.position.set(7, 10, 11);
  scene.add(light);
  const world = createZUpWorld(scene);
  const grid = new THREE.GridHelper(5, 20, 0xcccccc, 0xe8e8e8);
  grid.rotation.x = Math.PI / 2;
  world.add(grid);
  const dynamic = new THREE.Group();
  world.add(dynamic);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(.55, .95, 0);
  controls.enableDamping = true;
  controls.update();
  let visible = false, alive = true, raf = 0, visuals, cameraFitted = false;
  const render = () => {
    if (!alive || !visible || raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (!alive || !visible) return;
      display.syncLabels();
      controls.update();
      renderer.render(scene, camera);
    });
  };
  const display = createSceneControlPanel(stage, world, { render });
  controls.addEventListener('change', render);
  const viewVisibility = new IntersectionObserver(entries => {
    visible = entries.some(entry => entry.isIntersecting);
    if (visible) render();
    else { cancelAnimationFrame(raf); raf = 0; }
  }, { threshold: 0 });
  viewVisibility.observe(stage);
  const resize = new ResizeObserver(() => {
    resizeRendererToContainer(renderer, camera, stage);
    dynamic.children.filter(object => object.isSprite).forEach(sizeLabel);
    render();
  });
  resize.observe(stage);
  resizeRendererToContainer(renderer, camera, stage);

  const columnControl = document.createElement('label');
  columnControl.textContent = 'Joint column ';
  const column = document.createElement('select');
  column.setAttribute('aria-label', 'ABB joint screw column');
  for (let k = 1; k <= 6; k++) column.add(new Option(String(k), String(k - 1)));
  column.value = state.column;
  column.addEventListener('change', () => { state.column = Number(column.value); update(); });
  columnControl.append(column);
  toolbar.append(columnControl);
  const representation = document.createElement('select');
  representation.setAttribute('aria-label', 'Jacobian point and coordinate frame');
  Object.entries(REPRESENTATIONS).forEach(([key, view]) => representation.add(new Option(view.name, key)));
  representation.value = initial;
  if (host.dataset.allowRepresentation === 'true') {
    representation.addEventListener('change', () => { state.representation = representation.value; update(); });
    toolbar.append(representation);
  } else {
    const name = document.createElement('span');
    name.dataset.representationName = '';
    toolbar.append(name);
  }

  function screenOffset(right, up) {
    return new THREE.Vector3(right, up, 0).applyQuaternion(camera.quaternion)
      .applyQuaternion(world.quaternion.clone().invert());
  }
  function sizeLabel(sprite) {
    const height = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 22 / Math.max(stage.clientHeight, 1);
    sprite.scale.set(height * sprite.userData.labelAspect, height, 1);
  }
  function label(point, text, color = INK, right = .06, up = .09) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.font = '700 24px Arial';
    canvas.width = Math.ceil(ctx.measureText(text).width) + 16;
    canvas.height = 40;
    ctx.fillStyle = 'rgba(255,255,255,.90)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = '700 24px Arial';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = `#${new THREE.Color(color).getHexString()}`;
    ctx.fillText(text, 8, 20);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: texture, depthTest: false, depthWrite: false, sizeAttenuation: false, toneMapped: false
    }));
    sprite.position.copy(point).add(screenOffset(right, up));
    sprite.userData.labelAspect = canvas.width / canvas.height;
    sizeLabel(sprite);
    sprite.renderOrder = 25;
    dynamic.add(sprite);
  }
  function arrow(start, vector, color, scale = 1) {
    const length = vector.length() * scale;
    if (length < 1e-7) return;
    const helper = new THREE.ArrowHelper(vector.clone().normalize(), start, length, color, Math.min(.10, length * .25), Math.min(.06, length * .15));
    // ArrowHelper shares its default geometries; this view disposes only its own copies.
    helper.line.geometry = helper.line.geometry.clone();
    helper.cone.geometry = helper.cone.geometry.clone();
    [helper.line.material, helper.cone.material].forEach(material => {
      material.transparent = true; material.depthTest = false; material.depthWrite = false;
    });
    helper.line.renderOrder = helper.cone.renderOrder = 20;
    dynamic.add(helper);
  }
  function line(start, end, color, dashed = false) {
    const material = dashed
      ? new THREE.LineDashedMaterial({ color, dashSize: .07, gapSize: .045, transparent: true, depthTest: false })
      : new THREE.LineBasicMaterial({ color, transparent: true, depthTest: false });
    const object = new THREE.Line(new THREE.BufferGeometry().setFromPoints([start, end]), material);
    object.computeLineDistances();
    object.renderOrder = 15;
    dynamic.add(object);
  }
  function marker(point, color) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(.045, 16, 12),
      new THREE.MeshBasicMaterial({ color, transparent: true, depthTest: false, depthWrite: false }));
    mesh.position.copy(point); mesh.renderOrder = 23;
    dynamic.add(mesh);
  }
  function basis(i) {
    const origin = framePoint(kin, i), R = frameRotation(kin, i);
    [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)].forEach((axis, n) => {
      axis.applyMatrix3(R);
      arrow(origin, axis, [0xb33d3d, 0x3d8654, BLUE][n], .30);
      label(origin.clone().addScaledVector(axis, .32), `${'xyz'[n]}${subscript(i)}`, INK, .02, .04);
    });
    label(origin, i === 0 ? 'O₀ · world' : 'O₃ · D–H', INK, -.32, -.22);
  }
  function clear() {
    dynamic.traverse(object => {
      object.geometry?.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.filter(Boolean).forEach(material => { material.map?.dispose(); material.dispose(); });
    });
    dynamic.clear();
  }
  function fitInitialCamera() {
    dynamic.updateWorldMatrix(true, true);
    const points = kin.frames.map((_, i) => world.localToWorld(framePoint(kin, i)));
    dynamic.traverse(object => {
      if (object.isSprite) points.push(object.getWorldPosition(new THREE.Vector3()));
      const vertices = object.geometry?.getAttribute('position');
      if (vertices) for (let i = 0; i < vertices.count; i++) {
        points.push(new THREE.Vector3().fromBufferAttribute(vertices, i).applyMatrix4(object.matrixWorld));
      }
    });
    const bounds = new THREE.Box3().setFromPoints(points);
    const center = bounds.getCenter(new THREE.Vector3());
    const direction = camera.position.clone().sub(controls.target).normalize();
    const inverseView = camera.quaternion.clone().invert();
    const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * .80;
    const tanH = tanV * camera.aspect;
    let distance = 1;
    for (const point of points) {
      const local = point.clone().sub(center).applyQuaternion(inverseView);
      distance = Math.max(distance, local.z + (Math.abs(local.y) + .10) / tanV, local.z + (Math.abs(local.x) + .10) / tanH);
    }
    controls.target.copy(center);
    camera.position.copy(center).addScaledVector(direction, distance);
    controls.update();
    cameraFitted = true;
  }
  function update() {
    clear();
    const view = REPRESENTATIONS[state.representation], k = state.column;
    const prefix = superscript(view.basis);
    const origin = framePoint(kin, view.basis), wrist = framePoint(kin, 5), tool = framePoint(kin, 6);
    const point = view.point === 5 ? wrist : tool;
    const axisPoint = new THREE.Vector3(...kin.points[k]), omega = new THREE.Vector3(...kin.axes[k]);
    const r = axisPoint.clone().sub(origin), u = r.clone().cross(omega);
    const velocity = omega.clone().cross(point.clone().sub(axisPoint));
    const R = frameRotation(kin, view.basis).transpose();
    const J = abbJacobian(q, { point: view.point, basis: view.basis });
    const omegaInBasis = omega.clone().applyMatrix3(R), uInBasis = u.clone().applyMatrix3(R);
    const rInBasis = r.clone().applyMatrix3(R);
    const velocityInBasis = velocity.clone().applyMatrix3(R);
    representation.value = state.representation;
    const name = toolbar.querySelector('[data-representation-name]');
    if (name) name.textContent = view.name;
    basis(view.basis);
    if (host.dataset.showFrame3 === 'true' && view.basis !== 3) basis(3);
    marker(wrist, BLUE); marker(tool, RED);
    line(wrist, tool, BLUE);
    label(wrist, 'O₅ = p_w', BLUE, -.13, .18);
    label(tool, 't · tool', RED, .08, -.15);
    line(axisPoint.clone().addScaledVector(omega, -.45), axisPoint.clone().addScaledVector(omega, .8), BLUE, true);
    arrow(axisPoint, omega, BLUE, .55);
    label(axisPoint.clone().addScaledVector(omega, .57), `ω${subscript(k + 1)}`, BLUE);
    line(origin, axisPoint, OCHRE, true);
    if (r.length() > .05) label(origin.clone().lerp(axisPoint, .55), `r${subscript(k + 1)}`, OCHRE, -.10, .10);
    arrow(origin, u, OCHRE, .42);
    label(origin.clone().addScaledVector(u, .42), u.length() < 1e-7 ? 'r × ω = 0' : 'r × ω', OCHRE, .35, -.24);
    line(axisPoint, point, 0x888888, true);
    arrow(point, velocity, RED, .42);
    label(point.clone().addScaledVector(velocity, .42), velocity.length() < 1e-7 ? 'v_P = 0' : 'v_P', RED, .08, .12);
    if (host.dataset.showRadial === 'true') {
      const er = new THREE.Vector3(Math.cos(q[0]), Math.sin(q[0]), 0);
      const et = new THREE.Vector3(-Math.sin(q[0]), Math.cos(q[0]), 0);
      const zero = new THREE.Vector3(), projection = new THREE.Vector3(wrist.x, wrist.y, 0);
      arrow(zero, er, BLUE, .72); arrow(zero, et, RED, .65);
      line(zero, projection, BLUE, true); line(projection, wrist, 0x888888, true);
      label(er.clone().multiplyScalar(.75), 'e_r', BLUE, .04, .09);
      label(et.clone().multiplyScalar(.68), 'e_t', RED, .04, .09);
      label(projection.clone().multiplyScalar(.75), `G = ${abbFactors(q).G.toFixed(3)} m`, BLUE, .07, -.12);
    }
    host.dataset.representation = state.representation;
    host.dataset.column = String(k + 1);
    host.dataset.columnValues = JSON.stringify(J.map(row => row[k]));
    host.dataset.screwValues = JSON.stringify([...uInBasis.toArray(), ...omegaInBasis.toArray()]);
    readout.textContent = `${prefix}ω${subscript(k + 1)} = (${xyz(omegaInBasis.toArray())})\n` +
      `${prefix}(r × ω) = (${xyz(uInBasis.toArray())}) · at O${subscript(view.basis)}\n` +
      `${prefix}v_P = (${xyz(velocityInBasis.toArray())}) · at ${view.point === 5 ? 'O₅' : 't'}`;
    readout.title = `${prefix}r${subscript(k + 1)} = (${xyz(rInBasis.toArray())}); the column is [v_P; ω].`;
    if (!cameraFitted) fitInitialCamera();
    render();
  }

  const fragments = [...slide.querySelectorAll('[data-jacobian-representation]')];
  const syncReveal = () => {
    const scroll = document.body.classList.contains('mode-scroll');
    const shown = fragments.filter(fragment => scroll || fragment.classList.contains('revealed'));
    state.representation = shown.at(-1)?.dataset.jacobianRepresentation || initial;
    update();
  };
  const revealObserver = new MutationObserver(syncReveal);
  fragments.forEach(fragment => revealObserver.observe(fragment, { attributes: true, attributeFilter: ['class'] }));
  if (fragments.length) revealObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  syncReveal();
  loadAbbIrbVisuals(world).then(model => {
    if (!alive) { model.dispose(); return; }
    visuals = model;
    visuals.update(abbUrdfTransforms(q));
    display.registerStlRoot(visuals.group);
    const opacity = stage.querySelector('.course-3d-opacity input');
    opacity.value = 45;
    opacity.dispatchEvent(new Event('input', { bubbles: true }));
    host.dataset.ready = 'true';
    render();
  }).catch(error => {
    host.dataset.error = error.message;
    readout.textContent = `ABB meshes could not load: ${error.message}`;
    console.error(error);
  });
  return { dispose() {
    alive = false;
    cancelAnimationFrame(raf);
    viewVisibility.disconnect(); resize.disconnect(); revealObserver.disconnect();
    controls.removeEventListener('change', render); controls.dispose();
    clear(); visuals?.dispose(); grid.geometry.dispose(); grid.material.dispose();
    renderer.dispose(); renderer.forceContextLoss();
  } };
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
else init();
