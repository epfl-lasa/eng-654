import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { parseStlGeometry } from './frameDHPlayground.js';
import { createZUpWorld, createSceneControlPanel, resizeRendererToContainer } from './threeUtils.js';

const ROOT = new URL('../../assets/models/abb_gofa/', import.meta.url);
const NAMES = ['base_link', 'link_1', 'link_2', 'link_3', 'link_4', 'link_5', 'link_6'];
// Neutral ABB paint: dark joint housings and pale arm covers.
const PAINT = [0x575e60, 0x737a7c, 0xe9eae7, 0xe9eae7, 0x6b7376, 0xe5e6e2, 0x898f91];
let geometryPromise;

function geometryAssets() {
  return geometryPromise ||= Promise.all(NAMES.map(async name => {
    const response = await fetch(new URL(name + '.stl', ROOT));
    if (!response.ok) throw new Error(`Could not load ABB CRB mesh ${name}.`);
    const geometry = parseStlGeometry(await response.arrayBuffer());
    geometry.computeVertexNormals();
    return geometry;
  })).catch(error => { geometryPromise = null; throw error; });
}

/** A z-up URDF scene. All robot copies share geometry and retain white/grey paint. */
export async function createAbbCrbViewer(host, fk) {
  host.classList.add('l7-stage', 'l7-crb-stage');
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0xf2f3f4);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.7));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
  host.prepend(renderer.domElement);
  // Look across the arm plane so the starting and ending elbow poses separate visibly.
  const camera = new THREE.PerspectiveCamera(40, 1, .01, 30); camera.position.set(1.8, 1.45, -1.85);
  const controls = new OrbitControls(camera, renderer.domElement); controls.target.set(.12, .4, 0); controls.enableDamping = false; controls.update();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x70767a, 1.7));
  const light = new THREE.DirectionalLight(0xffffff, 2.5); light.position.set(2, 5, 4); scene.add(light);
  const world = createZUpWorld(scene), grid = new THREE.GridHelper(2.6, 26, 0xc0c5c8, 0xe2e5e7);
  grid.rotation.x = Math.PI / 2; world.add(grid);
  let frame = 0, alive = true;
  const render = () => { if (!frame && alive) frame = requestAnimationFrame(() => { frame = 0; renderer.render(scene, camera); }); };
  const sceneControls = createSceneControlPanel(host, world, { render });
  controls.addEventListener('change', render);
  const resize = new ResizeObserver(() => { resizeRendererToContainer(renderer, camera, host); render(); }); resize.observe(host);
  resizeRendererToContainer(renderer, camera, host);
  const geometry = await geometryAssets();
  const copies = new Map();
  function robot(name, opacity) {
    const root = new THREE.Group(), isGhost = name === 'start'; root.name = name;
    NAMES.forEach((name, i) => {
      const material = new THREE.MeshStandardMaterial({ color: isGhost ? 0x596269 : PAINT[i], roughness: .62, metalness: .12,
        opacity, transparent: opacity < 1, depthWrite: opacity >= .95 });
      const mesh = new THREE.Mesh(geometry[i], material); mesh.name = name; mesh.matrixAutoUpdate = false;
      mesh.userData.isCourseStl = true; root.add(mesh);
    });
    world.add(root); sceneControls.registerStlRoot(root); copies.set(name, root); return root;
  }
  const primary = robot('current', 1);
  function apply(root, q) {
    const transforms = fk(q).links;
    root.children.forEach(mesh => { mesh.matrix.set(...transforms[mesh.name].flat()); mesh.matrixWorldNeedsUpdate = true; });
    root.updateMatrixWorld(true);
  }
  let ghost = null, ghostQ = null;
  // A dashed centre line keeps the transparent starting arm readable on the grid.
  const ghostLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({
    color: 0x34434d, dashSize: .025, gapSize: .014, transparent: true, opacity: .7, depthTest: false
  }));
  ghostLine.visible = false; ghostLine.renderOrder = 4; world.add(ghostLine);
  const ee = new THREE.AxesHelper(.105); ee.matrixAutoUpdate = false; world.add(ee);
  const target = new THREE.Mesh(new THREE.SphereGeometry(.009, 16, 12), new THREE.MeshBasicMaterial({ color: 0xd71920 }));
  target.visible = false; world.add(target);
  const paths = new Map();
  function line(name, points, color) {
    const old = paths.get(name);
    if (old) { world.remove(old); old.geometry.dispose(); old.material.dispose(); paths.delete(name); }
    if (points.length < 2) return;
    const g = new THREE.BufferGeometry().setFromPoints(points.map(p => new THREE.Vector3(...p)));
    const object = new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: .95 }));
    object.renderOrder = 5; world.add(object); paths.set(name, object);
  }
  function update(q) {
    apply(primary, q); primary.visible = true;
    ee.matrix.set(...fk(q).matrix.flat()); ee.matrixWorldNeedsUpdate = true;
    host.dataset.q = JSON.stringify(q); render();
  }
  update([0, 0, 0, 0, .5, 0]);
  host.dataset.meshCount = String(NAMES.length);
  return {
    update,
    setPrimaryVisible(visible) { primary.visible = visible; ee.visible = visible; host.dataset.primaryVisible = String(visible); render(); },
    setGhost(q) {
      if (q) {
        ghost ||= robot('start', .3);
        if (q !== ghostQ) {
          apply(ghost, q);
          const f = fk(q);
          ghostLine.geometry.setFromPoints([[0,0,0],...f.origins,f.position].map(p => new THREE.Vector3(...p)));
          ghostLine.computeLineDistances(); ghostQ = q;
        }
        ghost.visible = true;
      } else if (ghost) { ghost.visible = false; ghostQ = null; }
      ghostLine.visible = !!q;
      host.dataset.ghostQ = q ? JSON.stringify(q) : '';
      host.dataset.hasGhost = String(!!q); render();
    },
    setConfigurations(configurations = []) {
      for (const [name, root] of copies) if (name.startsWith('ik_')) root.visible = false;
      for (const { id, q } of configurations) {
        const name = 'ik_' + id, root = copies.get(name) || robot(name, .19);
        apply(root, q); root.visible = true;
      }
      host.dataset.visibleIks = String(configurations.length); render();
    },
    setPath(points) { line('desired', points, 0xd71920); render(); },
    setTrace(points) { line('trace', points, 0x245e96); render(); },
    setTarget(point) { target.visible = !!point; if (point) target.position.fromArray(point); render(); },
    /** Optional framing for tall or wide task examples, preserving view direction.
     * Callers include the base, robot joint origins, and tool path. The extra
     * margin covers mesh thickness beyond those kinematic centre lines.
     */
    framePoints(points) {
      if (!points.length) return;
      world.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromPoints(points.map(p => world.localToWorld(new THREE.Vector3(...p))));
      box.expandByScalar(.12);
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      const direction = camera.position.clone().sub(controls.target).normalize();
      const vertical = camera.fov * Math.PI / 360;
      const horizontal = Math.atan(Math.tan(vertical) * camera.aspect);
      const distance = sphere.radius / Math.sin(Math.min(vertical, horizontal)) * 1.06;
      controls.target.copy(sphere.center);
      camera.position.copy(sphere.center).addScaledVector(direction, distance);
      controls.update(); render();
    },
    dispose() {
      alive = false; cancelAnimationFrame(frame); resize.disconnect(); controls.dispose(); renderer.dispose();
      copies.forEach(root => { root.traverse(o => o.material?.dispose()); sceneControls.unregisterStlRoot(root); });
      paths.forEach(path => { path.geometry.dispose(); path.material.dispose(); });
      target.geometry.dispose(); target.material.dispose();
      ghostLine.geometry.dispose(); ghostLine.material.dispose();
    }
  };
}
