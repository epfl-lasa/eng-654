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

/**
 * Add the two display controls shared by the course's Three.js scenes.
 *
 * Labels are represented by sprites throughout the visualizers, while STL
 * meshes are registered by the module that owns them.  Opacity is applied as
 * a ratio, so scenes that use faint ghost robots retain their visual hierarchy.
 */
export function createSceneControlPanel(host, world, options = {}) {
  host.classList.add('course-3d-host');
  const panel = document.createElement('div');
  panel.className = 'course-3d-controls';
  panel.setAttribute('aria-label', '3D display controls');
  host.append(panel);

  const render = typeof options.render === 'function' ? options.render : () => {};
  const stlRoots = new Set();
  let opacityFactor = 1;
  let labelsVisible = true;
  world.userData.courseStlOpacityFactor = opacityFactor;

  const applyLabelVisibility = () => {
    if (options.labels === false) return;
    world.userData.courseLabelsVisible = labelsVisible;
    world.traverse((object) => {
      if (object.isSprite || object.userData?.isCourseLabel) object.visible = labelsVisible;
    });
    host.querySelectorAll('.hud, [data-course-3d-label]').forEach((label) => {
      label.hidden = !labelsVisible;
    });
  };

  const scaleRootOpacity = (root, ratio, factor) => {
    const meshes = [];
    root?.traverse?.((object) => { if (object.isMesh) meshes.push(object); });
    const taggedStlMeshes = meshes.filter((object) => object.userData?.isCourseStl);
    (taggedStlMeshes.length ? taggedStlMeshes : meshes).forEach((object) => {
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.filter(Boolean).forEach((material) => {
        material.transparent = factor < 0.999 || material.transparent;
        material.opacity = Math.max(0, Math.min(1, material.opacity * ratio));
        material.depthWrite = material.opacity >= 0.95;
        material.needsUpdate = true;
      });
    });
  };

  if (options.labels !== false) {
    const labelToggle = document.createElement('label');
    labelToggle.className = 'course-3d-toggle';
    labelToggle.innerHTML = '<input type="checkbox" checked><span>Labels</span>';
    const checkbox = labelToggle.querySelector('input');
    checkbox.addEventListener('change', () => {
      labelsVisible = checkbox.checked;
      applyLabelVisibility();
      render();
    });
    panel.append(labelToggle);
    world.userData.courseLabelsVisible = true;
  }

  const opacityControl = document.createElement('label');
  opacityControl.className = 'course-3d-opacity';
  opacityControl.hidden = true;
  opacityControl.innerHTML = '<span>STL opacity</span><input type="range" min="10" max="100" step="5" value="100"><output>100%</output>';
  const opacityInput = opacityControl.querySelector('input');
  const opacityOutput = opacityControl.querySelector('output');
  opacityInput.addEventListener('input', () => {
    const nextFactor = Number(opacityInput.value) / 100;
    const ratio = nextFactor / Math.max(opacityFactor, 0.001);
    stlRoots.forEach((root) => scaleRootOpacity(root, ratio, nextFactor));
    opacityFactor = nextFactor;
    world.userData.courseStlOpacityFactor = opacityFactor;
    opacityOutput.textContent = `${opacityInput.value}%`;
    render();
  });
  panel.append(opacityControl);

  if (options.labels === false) panel.hidden = true;

  return {
    syncLabels: applyLabelVisibility,
    registerStlRoot(root) {
      if (!root) return;
      stlRoots.add(root);
      if (opacityFactor !== 1) scaleRootOpacity(root, opacityFactor, opacityFactor);
      opacityControl.hidden = false;
      panel.hidden = false;
    },
    unregisterStlRoot(root) {
      stlRoots.delete(root);
      opacityControl.hidden = stlRoots.size === 0;
      if (options.labels === false && stlRoots.size === 0) panel.hidden = true;
    }
  };
}
