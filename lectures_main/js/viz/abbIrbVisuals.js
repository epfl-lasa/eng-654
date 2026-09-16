import * as THREE from 'three';

const ASSET_ROOT = new URL('../../assets/models/abb_irb/', import.meta.url);
const URDF_URL = new URL('irb4600_40_255.urdf', ASSET_ROOT);
const LINK_NAMES = ['base_link', 'link_1', 'link_2', 'link_3', 'link_4', 'link_5', 'link_6'];

/**
 * Load the seven supplied ABB IRB 4600 visual meshes into a robotics z-up world.
 *
 * This deliberately reads the small COLLADA subset used by these assets:
 * triangle positions/normals, source accessors, scene nodes, matrix/translate/
 * rotate/scale transforms, and meter units. It is not a general COLLADA loader.
 * There are no textures, animations, controllers or embedded materials here.
 *
 * The six MeshLab exports incorrectly advertise Y_UP; their vertices are
 * already in the URDF link axes. For example, the base spans z=0..0.213 m and
 * link_2 extends along +z to its next joint at 1.095 m. The Blender link_4
 * correctly advertises Z_UP. Preserve the supplied URDF coordinates for ALL
 * seven meshes: converting their up_axis metadata would separate the links.
 * Node transforms and units still apply. createZUpWorld handles display axes.
 *
 * update accepts a Map or object from URDF link names to THREE.Matrix4 values
 * or nested row-major 4x4 arrays. These transforms are relative to `world`,
 * independent of any D-H frame convention. The initial pose is URDF zero.
 */
export async function loadAbbIrbVisuals(world) {
  const document = parseXml(await fetchText(URDF_URL), 'ABB URDF');
  const robot = document.documentElement;
  const links = new Map(children(robot, 'link').map((link) => [link.getAttribute('name'), link]));
  const group = new THREE.Group();
  group.name = 'ABB IRB 4600 visual meshes';
  const nodes = new Map();
  const allocated = [];

  try {
    const results = await Promise.allSettled(LINK_NAMES.map(async (name) => {
      const visual = child(links.get(name), 'visual');
      const meshElement = child(child(visual, 'geometry'), 'mesh');
      if (!meshElement) throw new Error(`ABB visual mesh missing for ${name}.`);
      // The ROS package hierarchy is flattened in this repository.
      const filename = meshElement.getAttribute('filename').split('/').at(-1);
      const dae = parseXml(await fetchText(new URL(filename, ASSET_ROOT)), filename);
      const rgba = numbers(child(child(visual, 'material'), 'color')?.getAttribute('rgba') || '0.9254902 0.9254902 0.9058824 1');
      const material = new THREE.MeshStandardMaterial({
        color: new THREE.Color().setRGB(...rgba.slice(0, 3), THREE.SRGBColorSpace),
        roughness: 0.58,
        metalness: 0.14,
        opacity: rgba[3],
        transparent: rgba[3] < 1
      });
      allocated.push(material);
      const asset = parseBundledDae(dae, material, allocated, filename);
      const visualRoot = new THREE.Group();
      visualRoot.matrixAutoUpdate = false;
      visualRoot.matrix.copy(originMatrix(child(visual, 'origin')));
      visualRoot.matrix.scale(new THREE.Vector3(...numbers(meshElement.getAttribute('scale') || '1 1 1')));
      visualRoot.add(asset);
      const linkRoot = new THREE.Group();
      linkRoot.name = name;
      linkRoot.matrixAutoUpdate = false;
      linkRoot.add(visualRoot);
      return { name, linkRoot };
    }));
    const failure = results.find((result) => result.status === 'rejected');
    if (failure) throw failure.reason;
    for (const result of results) {
      nodes.set(result.value.name, result.value.linkRoot);
      group.add(result.value.linkRoot);
    }
    update(zeroLinkMatrices(robot));
    world.add(group);
  } catch (error) {
    allocated.forEach((resource) => resource.dispose());
    throw error;
  }

  function update(linkMatrices) {
    for (const [name, node] of nodes) {
      const value = linkMatrices instanceof Map ? linkMatrices.get(name) : linkMatrices[name];
      if (!value) throw new Error(`Missing ABB link transform: ${name}.`);
      if (value.isMatrix4) node.matrix.copy(value);
      else if (Array.isArray(value) && value.length === 4 && value.every((row) => row.length === 4)) node.matrix.set(...value.flat());
      else throw new Error(`Expected a 4×4 transform for ABB ${name}.`);
      node.matrixWorldNeedsUpdate = true;
    }
    group.updateMatrixWorld(true);
  }

  return {
    group,
    count: nodes.size,
    update,
    dispose() {
      group.removeFromParent();
      allocated.forEach((resource) => resource.dispose());
    }
  };
}

function parseBundledDae(document, material, allocated, filename) {
  const root = document.documentElement;
  const asset = child(root, 'asset');
  const unit = Number(child(asset, 'unit')?.getAttribute('meter') || 1);
  if (!(unit > 0)) throw new Error(`Invalid COLLADA meter unit in ${filename}.`);
  for (const libraryName of ['library_controllers', 'library_animations', 'library_nodes']) {
    if (child(root, libraryName)?.children.length) throw new Error(`Unsupported ${libraryName} in ABB ${filename}.`);
  }
  const geometries = new Map();
  for (const geometryElement of children(child(root, 'library_geometries'), 'geometry')) {
    const geometry = readTriangleGeometry(child(geometryElement, 'mesh'), filename);
    allocated.push(geometry);
    geometries.set(geometryElement.getAttribute('id'), geometry);
  }
  const sceneId = reference(child(child(root, 'scene'), 'instance_visual_scene')?.getAttribute('url'));
  const scene = children(child(root, 'library_visual_scenes'), 'visual_scene').find((item) => item.getAttribute('id') === sceneId);
  if (!scene) throw new Error(`COLLADA visual scene missing in ${filename}.`);
  const result = new THREE.Group();
  result.name = filename;
  result.scale.setScalar(unit);
  result.userData.colladaUpAxis = child(asset, 'up_axis')?.textContent.trim() || 'Y_UP';
  result.userData.coordinates = 'URDF link frame; bundled mesh metadata override';

  function readNode(element) {
    const node = new THREE.Group();
    node.name = element.getAttribute('name') || element.getAttribute('id') || 'COLLADA node';
    node.matrixAutoUpdate = false;
    for (const entry of element.children) {
      const values = ['matrix', 'translate', 'rotate', 'scale'].includes(entry.localName) ? numbers(entry.textContent) : null;
      if (entry.localName === 'matrix') node.matrix.multiply(new THREE.Matrix4().fromArray(values).transpose());
      else if (entry.localName === 'translate') node.matrix.multiply(new THREE.Matrix4().makeTranslation(...values));
      else if (entry.localName === 'rotate') node.matrix.multiply(new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(...values.slice(0, 3)).normalize(), values[3] * Math.PI / 180));
      else if (entry.localName === 'scale') node.matrix.multiply(new THREE.Matrix4().makeScale(...values));
      else if (entry.localName === 'node') node.add(readNode(entry));
      else if (entry.localName === 'instance_geometry') {
        const geometry = geometries.get(reference(entry.getAttribute('url')));
        if (!geometry) throw new Error(`COLLADA geometry missing in ${filename}.`);
        const mesh = new THREE.Mesh(geometry, material);
        // Existing course mesh-opacity controls use this marker for all CAD.
        mesh.userData.isCourseStl = true;
        mesh.userData.sourceFormat = 'COLLADA';
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        node.add(mesh);
      } else if (entry.localName !== 'extra') throw new Error(`Unsupported COLLADA node entry ${entry.localName} in ${filename}.`);
    }
    return node;
  }

  children(scene, 'node').forEach((node) => result.add(readNode(node)));
  let meshCount = 0;
  result.traverse((node) => { if (node.isMesh) meshCount++; });
  if (!meshCount) throw new Error(`No ABB triangles loaded from ${filename}.`);
  return result;
}

function readTriangleGeometry(mesh, filename) {
  if (!mesh) throw new Error(`COLLADA mesh missing in ${filename}.`);
  const sources = new Map();
  for (const source of children(mesh, 'source')) {
    const accessor = child(child(source, 'technique_common'), 'accessor');
    const values = numbers(child(source, 'float_array')?.textContent || '');
    const stride = Number(accessor?.getAttribute('stride') || 1);
    const offset = Number(accessor?.getAttribute('offset') || 0);
    const count = Number(accessor?.getAttribute('count') || 0);
    if (stride < 3 || values.length < offset + count * stride) throw new Error(`Unsupported COLLADA source accessor in ${filename}.`);
    sources.set(source.getAttribute('id'), { values, stride, offset, count });
  }
  const vertices = new Map(children(mesh, 'vertices').map((element) => [
    element.getAttribute('id'),
    reference(children(element, 'input').find((input) => input.getAttribute('semantic') === 'POSITION')?.getAttribute('source'))
  ]));
  const positions = [], normals = [];
  for (const primitive of mesh.children) {
    if (['source', 'vertices', 'extra'].includes(primitive.localName)) continue;
    if (primitive.localName !== 'triangles') throw new Error(`Expected bundled ABB triangles, found ${primitive.localName} in ${filename}.`);
    const inputs = children(primitive, 'input');
    const width = Math.max(...inputs.map((input) => Number(input.getAttribute('offset') || 0))) + 1;
    const vertex = inputs.find((input) => input.getAttribute('semantic') === 'VERTEX');
    const normal = inputs.find((input) => input.getAttribute('semantic') === 'NORMAL');
    const positionSource = sources.get(vertices.get(reference(vertex?.getAttribute('source'))));
    const normalSource = sources.get(reference(normal?.getAttribute('source')));
    if (!positionSource || !normalSource) throw new Error(`ABB positions or normals missing in ${filename}.`);
    const indices = numbers(child(primitive, 'p')?.textContent || '');
    if (indices.length !== Number(primitive.getAttribute('count')) * 3 * width) throw new Error(`Invalid ABB triangle index count in ${filename}.`);
    for (let index = 0; index < indices.length; index += width) {
      appendVertex(positionSource, indices[index + Number(vertex.getAttribute('offset') || 0)], positions, filename);
      appendVertex(normalSource, indices[index + Number(normal.getAttribute('offset') || 0)], normals, filename);
    }
  }
  if (!positions.length) throw new Error(`Empty ABB mesh in ${filename}.`);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.normalizeNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function appendVertex(source, index, destination, filename) {
  if (!Number.isInteger(index) || index < 0 || index >= source.count) throw new Error(`Invalid ABB vertex index in ${filename}.`);
  const start = source.offset + index * source.stride;
  destination.push(source.values[start], source.values[start + 1], source.values[start + 2]);
}

function zeroLinkMatrices(robot) {
  const transforms = new Map([['base_link', new THREE.Matrix4()]]);
  const pending = children(robot, 'joint').slice();
  while (pending.length) {
    const index = pending.findIndex((joint) => transforms.has(child(joint, 'parent')?.getAttribute('link')));
    if (index < 0) throw new Error('ABB URDF joint tree is disconnected.');
    const joint = pending.splice(index, 1)[0];
    const parent = transforms.get(child(joint, 'parent').getAttribute('link'));
    transforms.set(child(joint, 'child').getAttribute('link'), parent.clone().multiply(originMatrix(child(joint, 'origin'))));
  }
  return transforms;
}

function originMatrix(origin) {
  const position = numbers(origin?.getAttribute('xyz') || '0 0 0');
  const [roll, pitch, yaw] = numbers(origin?.getAttribute('rpy') || '0 0 0');
  const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(roll, pitch, yaw, 'ZYX'));
  return new THREE.Matrix4().compose(new THREE.Vector3(...position), rotation, new THREE.Vector3(1, 1, 1));
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ABB asset ${url.pathname.split('/').at(-1)} (${response.status}).`);
  return response.text();
}

function parseXml(text, label) {
  const document = new DOMParser().parseFromString(text, 'application/xml');
  if (document.querySelector('parsererror')) throw new Error(`Invalid XML in ${label}.`);
  return document;
}

function children(element, tag) { return [...(element?.children || [])].filter((entry) => entry.localName === tag); }
function child(element, tag) { return children(element, tag)[0]; }
function reference(value) { return (value || '').replace(/^#/, ''); }
function numbers(text) { return text.trim().split(/\s+/).filter(Boolean).map(Number); }
