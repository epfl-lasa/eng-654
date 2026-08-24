import * as THREE from 'three';

export function createZUpWorld(scene) {
  const robotWorld = new THREE.Group();
  // Robotics convention: z-axis up. Three.js is y-up, so rotate root by Rx(-pi/2).
  robotWorld.rotation.x = -Math.PI / 2;
  scene.add(robotWorld);
  return robotWorld;
}

export function createBoldAxes(length = 1.4) {
  const axes = new THREE.Group();
  const headLength = length * 0.18;
  const shaftLength = length - headLength;
  const shaftRadius = length * 0.025;
  const headRadius = length * 0.065;

  const addAxis = (color, rotation) => {
    const material = new THREE.MeshStandardMaterial({ color });
    const axis = new THREE.Group();

    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(shaftRadius, shaftRadius, shaftLength, 20),
      material
    );
    shaft.position.y = shaftLength / 2;
    axis.add(shaft);

    const arrowhead = new THREE.Mesh(
      new THREE.ConeGeometry(headRadius, headLength, 24),
      material
    );
    arrowhead.position.y = shaftLength + headLength / 2;
    axis.add(arrowhead);

    // Three.js cylinders and cones point along +y by default.
    axis.rotation.set(...rotation);
    axes.add(axis);
  };

  addAxis(0xff3030, [0, 0, -Math.PI / 2]); // +x
  addAxis(0x35b85a, [0, 0, 0]);             // +y
  addAxis(0x2775ff, [Math.PI / 2, 0, 0]);   // +z

  return axes;
}

export function resizeRendererToContainer(renderer, camera, container) {
  const width = Math.max(1, container.clientWidth);
  const height = Math.max(1, container.clientHeight);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
