import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createBoldAxes, createZUpWorld, resizeRendererToContainer } from './threeUtils.js';

export function initThreeRevoluteDemos() {
  document.querySelectorAll('[data-three-revolute]').forEach(container => {
    try {
      createThreeRevoluteDemo(container);
    } catch (err) {
      container.innerHTML = `<p class="warning">Three.js demo could not start: ${err.message}</p>`;
      console.error(err);
    }
  });
}

function createThreeRevoluteDemo(container) {
  container.classList.add('three-viewer');

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
  camera.position.set(3, 2.2, 3.2);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  container.appendChild(renderer.domElement);

  const ambient = new THREE.AmbientLight(0xffffff, 1.4);
  scene.add(ambient);
  const directional = new THREE.DirectionalLight(0xffffff, 2.0);
  directional.position.set(3, 4, 5);
  scene.add(directional);

  const robotWorld = createZUpWorld(scene);
  const axes = createBoldAxes(1.4);
  robotWorld.add(axes);

  const revoluteJoint = new THREE.Group();
  robotWorld.add(revoluteJoint);

  const joint = new THREE.Mesh(
    new THREE.CylinderGeometry(0.15, 0.15, 0.35, 32),
    new THREE.MeshStandardMaterial({ color: 0x111111 })
  );
  joint.rotation.x = Math.PI / 2;
  revoluteJoint.add(joint);

  const link = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 0.18, 0.18),
    new THREE.MeshStandardMaterial({ color: 0xff0000 })
  );
  link.position.x = 0.8;
  revoluteJoint.add(link);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  const resize = () => resizeRendererToContainer(renderer, camera, container);
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();

  function animate(time) {
    const t = time / 1000;
    const q = 0.8 * Math.sin(t);
    revoluteJoint.rotation.z = q; // z-up robotics convention.
    controls.update?.();
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }

  requestAnimationFrame(animate);
}
