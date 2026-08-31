import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createBoldAxes, createSceneControlPanel, createZUpWorld, resizeRendererToContainer } from './threeUtils.js';

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
  const displayControls = createSceneControlPanel(container, robotWorld);
  const axes = createBoldAxes(1.4);
  robotWorld.add(axes);
  robotWorld.add(
    axisLabel('x', [1.55, 0, 0], '#c62828'),
    axisLabel('y', [0, 1.55, 0], '#20813f'),
    axisLabel('z', [0, 0, 1.55], '#1d5fc0')
  );

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
    displayControls.syncLabels();
    controls.update?.();
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }

  requestAnimationFrame(animate);
}

function axisLabel(text, position, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 48;
  const context = canvas.getContext('2d');
  context.fillStyle = 'rgba(255,255,255,.9)';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = color;
  context.font = '700 30px Arial';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, canvas.width / 2, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
  sprite.position.fromArray(position);
  sprite.scale.set(.32, .24, 1);
  sprite.userData.isCourseLabel = true;
  return sprite;
}
