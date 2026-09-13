import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { parseStlGeometry } from '../viz/frameDHPlayground.js';

// All worksheet views share the same parsed URDF and STL geometries.
// Mesh placement is URDF link transform × visual origin × mesh scale.
const assetRoot = new URL('../../assets/models/iiwa7/', import.meta.url);
const geometryCache = new Map();
let robotPromise;
const subscripts = ['₀', '₁', '₂', '₃', '₄', '₅', '₆', '₇'];
const frameColors = [0xff0000, 0x111111, 0x777777];

function vectorAttribute(node, name, fallback) {
    const raw = node && node.getAttribute(name);
    if (!raw) return fallback.slice();
    const values = raw.trim().split(/\s+/).map(Number);
    if (values.length !== 3 || !values.every(Number.isFinite)) throw new Error('Invalid URDF ' + name + ' vector.');
    return values;
}
function originMatrix(xyz, rpy) {
    // URDF fixed-axis roll, pitch, yaw is Rz(yaw) Ry(pitch) Rx(roll).
    const matrix = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rpy[0], rpy[1], rpy[2], 'ZYX'));
    matrix.setPosition(...xyz); return matrix;
}
async function geometryFor(filename) {
    if (!geometryCache.has(filename)) {
        const pending = fetch(new URL(filename, assetRoot)).then(async response => {
            if (!response.ok) throw new Error('Could not load ' + filename + ' (HTTP ' + response.status + ').');
            return parseStlGeometry(await response.arrayBuffer());
        }).catch(error => { geometryCache.delete(filename); throw error; });
        geometryCache.set(filename, pending);
    }
    return geometryCache.get(filename);
}
async function loadRobot() {
    if (!robotPromise) robotPromise = (async () => {
        const response = await fetch(new URL('iiwa7.urdf', assetRoot));
        if (!response.ok) throw new Error('Could not load iiwa7.urdf (HTTP ' + response.status + ').');
        const xml = new DOMParser().parseFromString(await response.text(), 'application/xml');
        if (xml.querySelector('parsererror') || xml.documentElement.getAttribute('name') !== 'iiwa7') throw new Error('The iiwa 7 URDF could not be read.');
        const specs = Array.from({ length: 8 }, (_, index) => {
            const linkName = 'iiwa_link_' + index;
            const visual = xml.querySelector('link[name="' + linkName + '"] > visual');
            const mesh = visual && visual.querySelector('geometry > mesh');
            if (!mesh) throw new Error('Missing visual mesh for ' + linkName + '.');
            const filename = (mesh.getAttribute('filename') || '').split('/').pop();
            if (filename !== 'link_' + index + '.stl') throw new Error('Unexpected iiwa visual mesh filename.');
            const origin = visual.querySelector('origin');
            return { index, linkName, filename, xyz: vectorAttribute(origin, 'xyz', [0, 0, 0]),
                rpy: vectorAttribute(origin, 'rpy', [0, 0, 0]), scale: vectorAttribute(mesh, 'scale', [1, 1, 1]) };
        });
        return Promise.all(specs.map(async spec => ({ ...spec, geometry: await geometryFor(spec.filename) })));
    })().catch(error => { robotPromise = null; throw error; });
    return robotPromise;
}

export async function createThreeScene(container, options) {
    const specs = await loadRobot();
    const model = options.model, document = container.ownerDocument;
    let q = options.configuration.slice(), settings = { showWrist: false, showAxes: true, caption: '', ...options.settings };
    let disposed = false, axesChosenByUser = false, pendingFrame = 0, visible = true;
    const ownGeometries = new Set(), ownMaterials = new Set(), listeners = [];
    const labels = [], axisLabels = [], meshes = [], axes = [], linkFrames = [];
    const preferences = { meshes: true, opacity: .78, axes: settings.showAxes, axisLength: 1.2, frames: false, labels: true, world: true };
    const element = (tag, className, text) => {
        const node = document.createElement(tag); if (className) node.className = className;
        if (text !== undefined) node.textContent = text; return node;
    };
    const on = (node, event, fn, opts) => { node.addEventListener(event, fn, opts); listeners.push(() => node.removeEventListener(event, fn, opts)); };
    const figure = element('figure', 'ex02-robot-scene'); figure.dataset.renderer = 'three';
    const viewport = element('div', 'ex02-scene-viewport');
    const labelLayer = element('div', 'ex02-scene-label-layer'); labelLayer.setAttribute('aria-hidden', 'true');
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0xffffff);
    const camera = new THREE.PerspectiveCamera(40, 1, .01, 30); camera.up.set(0, 0, 1);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.tabIndex = 0; renderer.domElement.setAttribute('role', 'img');
    renderer.domElement.setAttribute('aria-label', 'KUKA iiwa 7 STL robot. Drag to orbit, right-drag to pan, and scroll to zoom. Arrow keys orbit, plus and minus zoom, Home resets the camera.');
    viewport.append(renderer.domElement, labelLayer); figure.append(viewport); container.append(figure);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false; controls.minDistance = .35; controls.maxDistance = 7;
    controls.target.set(0, 0, .64); camera.position.set(1.8, 2.3, 1.5); controls.update(); controls.saveState();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x777777, 2));
    const key = new THREE.DirectionalLight(0xffffff, 2.3); key.position.set(3, 4, 6); scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, .8); fill.position.set(-3, -2, 2); scene.add(fill);
    const grid = new THREE.GridHelper(2, 10, 0xc6c6c6, 0xe9e9e9); grid.rotation.x = Math.PI / 2; scene.add(grid);
    ownGeometries.add(grid.geometry); (Array.isArray(grid.material) ? grid.material : [grid.material]).forEach(material => ownMaterials.add(material));
    const meshGroup = new THREE.Group(), axisGroup = new THREE.Group(), frameGroup = new THREE.Group(), worldGroup = new THREE.Group();
    scene.add(meshGroup, axisGroup, frameGroup, worldGroup);
    function material(properties, line = false) {
        const result = line ? new THREE.LineBasicMaterial(properties) : new THREE.MeshStandardMaterial(properties);
        ownMaterials.add(result); return result;
    }
    function line(from, to, parent, color, opacity = 1) {
        const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...from), new THREE.Vector3(...to)]); ownGeometries.add(geometry);
        const result = new THREE.Line(geometry, material({ color, transparent: opacity < 1, opacity, depthTest: false }, true));
        result.renderOrder = 5; parent.add(result); return result;
    }
    function label(text, point, category, offset = [5, -8]) {
        const node = element('span', 'ex02-scene-label', text); labelLayer.append(node);
        const entry = { node, point: new THREE.Vector3(...point), category, offset };
        labels.push(entry); return entry;
    }
    function triad(parent, size, labelSuffix, category) {
        const group = new THREE.Group(); parent.add(group);
        const entries = [];
        for (let axis = 0; axis < 3; axis += 1) {
            const tip = [0, 0, 0]; tip[axis] = size;
            line([0, 0, 0], tip, group, frameColors[axis]);
            entries.push({ label: label(['x', 'y', 'z'][axis] + labelSuffix, tip, category), local: new THREE.Vector3(...tip) });
        }
        return { group, entries };
    }
    triad(worldGroup, .24, 'W', 'world');
    specs.forEach(spec => {
        const holder = new THREE.Group(); holder.matrixAutoUpdate = false;
        const visual = new THREE.Group(); visual.matrixAutoUpdate = false; visual.matrix.copy(originMatrix(spec.xyz, spec.rpy)); holder.add(visual);
        const mesh = new THREE.Mesh(spec.geometry, material({ color: spec.index === 0 || spec.index === 7 ? 0x292929 : 0xe9e9e9,
            metalness: .08, roughness: .56, transparent: true, opacity: preferences.opacity, depthWrite: false, side: THREE.DoubleSide }));
        mesh.scale.fromArray(spec.scale); mesh.userData.isCourseStl = true; mesh.userData.linkName = spec.linkName;
        visual.add(mesh); meshGroup.add(holder); meshes.push({ spec, holder, visual, mesh });
        const frame = triad(frameGroup, .085, subscripts[spec.index], 'frames');
        frame.group.matrixAutoUpdate = false; frame.linkName = spec.linkName; linkFrames.push(frame);
    });
    const eeFrame = triad(frameGroup, .085, 'ₑ', 'frames');
    eeFrame.group.matrixAutoUpdate = false; eeFrame.linkName = 'iiwa_link_ee'; linkFrames.push(eeFrame);
    for (let index = 0; index < 7; index += 1) {
        const axis = line([0, 0, 0], [0, 0, 1], axisGroup, 0x202020, .76);
        axis.material = new THREE.LineDashedMaterial({ color: 0x202020, transparent: true, opacity: .76, depthTest: false, dashSize: .025, gapSize: .014 });
        ownMaterials.add(axis.material);
        // Equal appearance for all axes. No grouping or colors reveal the wrist.
        axis.userData.joint = index + 1; axes.push(axis);
        axisLabels.push(label('ω' + subscripts[index + 1], [0, 0, 0], 'axes', [7 + (index % 2) * 10, -7 - (index % 3) * 17]));
    }
    const toolGeometry = new THREE.OctahedronGeometry(.018); ownGeometries.add(toolGeometry);
    const tool = new THREE.Mesh(toolGeometry, material({ color: 0xff0000, depthTest: false })); tool.renderOrder = 9; scene.add(tool);
    const toolLabel = label('pₑₑ', [0, 0, 0], 'tool', [9, -14]);
    const wristGeometry = new THREE.SphereGeometry(.02, 20, 12); ownGeometries.add(wristGeometry);
    const wrist = new THREE.Mesh(wristGeometry, material({ color: 0xff0000, depthTest: false })); wrist.renderOrder = 10; scene.add(wrist);
    const wristLabel = label('p𝑤', [0, 0, 0], 'wrist', [-28, 12]);

    const toolbar = element('div', 'ex02-scene-toolbar');
    const help = element('span', 'ex02-scene-help', 'Drag to orbit · Right-drag to pan · Scroll / pinch to zoom');
    const cameraButtons = element('span', 'ex02-scene-controls');
    const zoomOut = element('button', '', '−'), zoomIn = element('button', '', '+'), reset = element('button', '', 'Reset view');
    [[zoomOut, 'Zoom out'], [zoomIn, 'Zoom in'], [reset, 'Reset camera']].forEach(([button, name]) => { button.type = 'button'; button.setAttribute('aria-label', name); });
    cameraButtons.append(zoomOut, zoomIn, reset); toolbar.append(help, cameraButtons);
    const displayControls = element('div', 'ex02-scene-display-controls'); displayControls.setAttribute('aria-label', 'Robot display controls');
    function checkbox(name, keyName) {
        const labelNode = element('label', 'ex02-scene-toggle'); const input = element('input'); input.type = 'checkbox'; input.checked = preferences[keyName]; input.dataset.sceneControl = keyName;
        labelNode.append(input, document.createTextNode(name)); displayControls.append(labelNode);
        on(input, 'change', () => { preferences[keyName] = input.checked; if (keyName === 'axes') axesChosenByUser = true; applyPreferences(); requestRender(); });
        return input;
    }
    checkbox('STL robot', 'meshes'); const axesCheckbox = checkbox('Joint axes', 'axes'); checkbox('URDF frames', 'frames'); checkbox('Labels', 'labels'); checkbox('World frame', 'world');
    function slider(name, keyName, min, max, step, suffix, toValue, fromValue) {
        const labelNode = element('label', 'ex02-scene-slider'); const title = element('span', '', name);
        const input = element('input'); input.type = 'range'; input.min = String(min); input.max = String(max); input.step = String(step); input.value = String(fromValue(preferences[keyName])); input.dataset.sceneControl = keyName;
        input.setAttribute('aria-label', name); const output = element('output'); output.textContent = input.value + suffix;
        labelNode.append(title, input, output); displayControls.append(labelNode);
        on(input, 'input', () => { preferences[keyName] = toValue(Number(input.value)); output.textContent = input.value + suffix; if (keyName === 'axisLength') updateGeometry(); applyPreferences(); requestRender(); });
    }
    slider('STL opacity', 'opacity', 0, 100, 1, '%', value => value / 100, value => Math.round(value * 100));
    slider('Axis length', 'axisLength', .4, 2, .05, ' m', value => value, value => value);
    const caption = element('figcaption', 'ex02-scene-caption'); figure.append(toolbar, displayControls, caption);

    function applyPreferences() {
        meshGroup.visible = preferences.meshes && preferences.opacity > 0; axisGroup.visible = preferences.axes; frameGroup.visible = preferences.frames; worldGroup.visible = preferences.world;
        meshes.forEach(({ mesh }) => { mesh.material.opacity = preferences.opacity; mesh.material.depthWrite = preferences.opacity === 1; });
        wrist.visible = !!settings.showWrist;
        // Update visibility even for a currently hidden tutorial stage. Its
        // labels will receive fresh projected positions when it becomes visible.
        labels.forEach(entry => { entry.node.hidden = !labelVisible(entry); });
    }
    function labelVisible(entry) {
        const category = entry.category;
        return preferences.labels && (category === 'tool' || (category === 'wrist' ? settings.showWrist : preferences[category]));
    }
    function matrixFromRows(rows) { return new THREE.Matrix4().set(...rows.flat()); }
    function updateGeometry() {
        const frames = model.jointFrames(q);
        meshes.forEach(({ spec, holder }) => holder.matrix.copy(spec.index === 0 ? new THREE.Matrix4() : matrixFromRows(frames[spec.index - 1].transform)));
        linkFrames.forEach((frame, index) => {
            frame.group.matrix.copy(index === 0 ? new THREE.Matrix4() : index === 8 ? matrixFromRows(model.fk(q)) : matrixFromRows(frames[index - 1].transform));
            frame.entries.forEach(entry => entry.label.point.copy(entry.local).applyMatrix4(frame.group.matrix));
        });
        frames.forEach((frame, index) => {
            const start = frame.origin.map((value, axis) => value - frame.axis[axis] * preferences.axisLength / 2);
            const end = frame.origin.map((value, axis) => value + frame.axis[axis] * preferences.axisLength / 2);
            const attribute = axes[index].geometry.getAttribute('position'); attribute.setXYZ(0, ...start); attribute.setXYZ(1, ...end); attribute.needsUpdate = true;
            axes[index].geometry.computeBoundingSphere(); axes[index].computeLineDistances(); axisLabels[index].point.set(...end);
        });
        const end = model.position(model.fk(q)); tool.position.set(...end); toolLabel.point.copy(tool.position);
        wrist.position.set(...model.wristPosition(q)); wristLabel.point.copy(wrist.position);
        scene.updateMatrixWorld(true);
        caption.textContent = settings.caption || 'The STL meshes and link frames follow the iiwa 7 URDF. Joint-axis lines extend equally in both directions.';
    }
    function updateLabels(width, height) {
        labels.forEach(entry => {
            const projected = entry.point.clone().project(camera);
            const show = labelVisible(entry) && projected.z >= -1 && projected.z <= 1 && Math.abs(projected.x) < 1.1 && Math.abs(projected.y) < 1.1;
            entry.node.hidden = !show;
            if (show) entry.node.style.transform = 'translate(' + ((projected.x + 1) * width / 2 + entry.offset[0]) + 'px,' + ((1 - projected.y) * height / 2 + entry.offset[1]) + 'px)';
        });
    }
    function render() {
        pendingFrame = 0; if (disposed || !visible) return;
        const width = viewport.clientWidth, height = viewport.clientHeight;
        if (width < 1 || height < 1) return;
        const dimensions = new THREE.Vector2(); renderer.getSize(dimensions);
        if (dimensions.x !== width || dimensions.y !== height) { renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix(); }
        camera.updateMatrixWorld(); renderer.render(scene, camera); updateLabels(width, height);
    }
    function requestRender() { if (!disposed && !pendingFrame) pendingFrame = requestAnimationFrame(render); }
    function resetView() { controls.reset(); requestRender(); }
    function zoom(factor) { camera.position.sub(controls.target).multiplyScalar(factor).clampLength(controls.minDistance, controls.maxDistance).add(controls.target); controls.update(); requestRender(); }
    on(controls, 'change', requestRender); on(reset, 'click', resetView); on(zoomIn, 'click', () => zoom(.85)); on(zoomOut, 'click', () => zoom(1 / .85));
    on(renderer.domElement, 'keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', '_', 'Home'].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation();
        if (event.key === 'Home') return resetView();
        if (event.key === '+' || event.key === '=') return zoom(.9);
        if (event.key === '-' || event.key === '_') return zoom(1 / .9);
        const offset = camera.position.clone().sub(controls.target);
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') offset.applyAxisAngle(camera.up, event.key === 'ArrowLeft' ? .12 : -.12);
        else {
            const right = new THREE.Vector3().crossVectors(offset, camera.up).normalize();
            const proposed = offset.clone().applyAxisAngle(right, event.key === 'ArrowUp' ? .1 : -.1);
            if (Math.abs(proposed.clone().normalize().dot(camera.up)) < .98) offset.copy(proposed);
        }
        camera.position.copy(controls.target).add(offset); controls.update(); requestRender();
    });
    const observer = new ResizeObserver(requestRender); observer.observe(viewport);
    const intersection = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => { visible = entries[0].isIntersecting; if (visible) requestRender(); }) : null;
    if (intersection) intersection.observe(viewport);
    function getSnapshot() {
        scene.updateMatrixWorld(true);
        const toRows = matrix => { const e = matrix.elements; return Array.from({ length: 4 }, (_, row) => [e[row], e[4 + row], e[8 + row], e[12 + row]]); };
        return Object.freeze({ state: 'ready', renderer: 'three', meshCount: meshes.length, configuration: q.slice(), preferences: { ...preferences },
            showWrist: wrist.visible, camera: camera.position.toArray(), cameraUp: camera.up.toArray(), target: controls.target.toArray(),
            controlsEnabled: controls.enabled, viewport: { width: viewport.clientWidth, height: viewport.clientHeight },
            axes: axes.map(axis => ({ joint: axis.userData.joint, points: Array.from(axis.geometry.getAttribute('position').array), color: axis.material.color.getHex(), visible: axisGroup.visible })),
            frames: linkFrames.map(frame => ({ link: frame.linkName, transform: toRows(frame.group.matrix), visible: frameGroup.visible })),
            meshes: meshes.map(({ spec, holder, visual, mesh }) => ({ link: spec.linkName, url: new URL(spec.filename, assetRoot).href,
                vertexCount: mesh.geometry.getAttribute('position').count, scale: mesh.scale.toArray(), linkTransform: toRows(holder.matrix),
                visualTransform: toRows(visual.matrix), worldTransform: toRows(mesh.matrixWorld), opacity: mesh.material.opacity, visible: meshGroup.visible })) });
    }
    Object.defineProperty(figure, 'getSceneSnapshot', { value: getSnapshot });
    updateGeometry(); applyPreferences(); requestRender();
    return Object.freeze({
        update(configuration, nextSettings = {}) {
            q = configuration.slice(); settings = { ...settings, ...nextSettings };
            // Gate checks regularly pass showAxes=true. Respect a student's toggle.
            if (!axesChosenByUser && typeof nextSettings.showAxes === 'boolean') { preferences.axes = nextSettings.showAxes; axesCheckbox.checked = preferences.axes; }
            updateGeometry(); applyPreferences(); requestRender();
        },
        getSnapshot, resetView,
        dispose() {
            if (disposed) return; disposed = true; if (pendingFrame) cancelAnimationFrame(pendingFrame);
            observer.disconnect(); if (intersection) intersection.disconnect(); listeners.forEach(remove => remove()); controls.dispose();
            ownGeometries.forEach(geometry => geometry.dispose()); ownMaterials.forEach(value => value.dispose());
            // Cached STL geometries belong to the shared loader, not this view.
            renderer.dispose(); renderer.forceContextLoss(); figure.remove();
        }
    });
}
