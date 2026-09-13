/* Synchronous worksheet adapter for the actual iiwa STL viewer.
 * The SVG view is only a clearly labelled fallback when WebGL/assets cannot load. */
(function (root, factory) {
    'use strict';
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.Exercise02Scene = factory();
})(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';
    const NS = 'http://www.w3.org/2000/svg';
    const add = (a, b) => a.map((value, i) => value + b[i]);
    const scale = (a, factor) => a.map(value => value * factor);
    const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
    let sceneCount = 0;

    function createFallback(container, options) {
        if (!container || !container.ownerDocument) throw new Error('Choose a container for the robot view.');
        options = options || {};
        const model = options.model;
        if (!model || typeof model.jointFrames !== 'function' || typeof model.fk !== 'function') throw new Error('The iiwa model is required for the robot view.');
        const document = container.ownerDocument;
        const listeners = [];
        const id = 'ex02-scene-' + (++sceneCount);
        let configuration = [0, 0, 0, 0, 0, 0, 0];
        let settings = { showWrist: false, showAxes: true, caption: '' };
        let azimuth = .65, elevation = .2, zoom = 1, pan = [0, 0];
        let activeGesture = null;
        let disposed = false;
        const pointers = new Map();

        function html(tag, className, text) {
            const node = document.createElement(tag);
            if (className) node.className = className;
            if (text !== undefined) node.textContent = text;
            return node;
        }
        function svgNode(tag, attributes, text) {
            const node = document.createElementNS(NS, tag);
            Object.entries(attributes || {}).forEach(([key, value]) => node.setAttribute(key, String(value)));
            if (text !== undefined) node.textContent = text;
            return node;
        }
        function on(node, event, callback, eventOptions) {
            node.addEventListener(event, callback, eventOptions);
            listeners.push(() => node.removeEventListener(event, callback, eventOptions));
        }
        const wrapper = html('figure', 'ex02-robot-scene');
        const canvas = svgNode('svg', { viewBox: '0 0 640 390', role: 'img', tabindex: '0', 'aria-labelledby': id + '-title ' + id + '-description' });
        const title = svgNode('title', { id: id + '-title' }, 'KUKA iiwa 7 joint frames');
        const description = svgNode('desc', { id: id + '-description' }, 'A robot frame schematic from the URDF. Drag to orbit, Shift-drag to pan, or scroll to zoom. Arrow keys orbit, plus and minus zoom, and Home resets the view.');
        const drawing = svgNode('g');
        canvas.append(title, description, drawing);
        const toolbar = html('div', 'ex02-scene-toolbar');
        const instructions = html('span', 'ex02-scene-help', 'Drag to orbit · Shift-drag to pan · Scroll to zoom');
        const controls = html('span', 'ex02-scene-controls');
        const zoomOut = html('button', '', '−'), zoomIn = html('button', '', '+'), reset = html('button', '', 'Reset view');
        [[zoomOut, 'Zoom out'], [zoomIn, 'Zoom in'], [reset, 'Reset camera']].forEach(([button, label]) => { button.type = 'button'; button.setAttribute('aria-label', label); });
        controls.append(zoomOut, zoomIn, reset); toolbar.append(instructions, controls);
        const caption = html('figcaption', 'ex02-scene-caption');
        wrapper.append(canvas, toolbar, caption); container.append(wrapper);

        function project(point) {
            const delta = [point[0], point[1], point[2] - .66];
            const right = [-Math.sin(azimuth), Math.cos(azimuth), 0];
            const up = [-Math.sin(elevation) * Math.cos(azimuth), -Math.sin(elevation) * Math.sin(azimuth), Math.cos(elevation)];
            const depth = [Math.cos(elevation) * Math.cos(azimuth), Math.cos(elevation) * Math.sin(azimuth), Math.sin(elevation)];
            return [320 + pan[0] + dot(delta, right) * 225 * zoom, 204 + pan[1] - dot(delta, up) * 225 * zoom, dot(delta, depth)];
        }
        function line(from, to, attributes) {
            const a = project(from), b = project(to);
            return svgNode('line', Object.assign({ x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: '#111', 'stroke-width': 2, 'stroke-linecap': 'round', 'vector-effect': 'non-scaling-stroke' }, attributes));
        }
        function label(point, text, attributes) {
            const p = project(point);
            return svgNode('text', Object.assign({ x: p[0] + 7, y: p[1] - 7, fill: '#111', 'font-family': 'system-ui, sans-serif', 'font-size': 12, 'font-weight': 650,
                stroke: '#fff', 'stroke-width': 3, 'stroke-linejoin': 'round', 'paint-order': 'stroke' }, attributes), text);
        }
        function draw() {
            if (disposed) return;
            drawing.replaceChildren();
            try {
                const frames = model.jointFrames(configuration);
                const transform = model.fk(configuration);
                const end = [transform[0][3], transform[1][3], transform[2][3]];
                const ground = svgNode('g', { opacity: .5 });
                for (let i = -3; i <= 3; i += 1) {
                    ground.append(line([i * .2, -.6, 0], [i * .2, .6, 0], { stroke: '#ddd', 'stroke-width': 1 }));
                    ground.append(line([-.6, i * .2, 0], [.6, i * .2, 0], { stroke: '#ddd', 'stroke-width': 1 }));
                }
                drawing.append(ground);
                const worldOrigin = [0, 0, 0];
                [[.22, 0, 0], [0, .22, 0], [0, 0, .22]].forEach((tip, index) => {
                    drawing.append(line(worldOrigin, tip, { stroke: index === 0 ? '#f00' : '#777', 'stroke-width': 1.5 }));
                    drawing.append(label(tip, ['x₀', 'y₀', 'z₀'][index], { 'font-size': 11, fill: '#555' }));
                });
                const points = [worldOrigin].concat(frames.map(frame => frame.origin), [end]);
                const links = points.slice(1).map((point, i) => ({ start: points[i], end: point, depth: (project(points[i])[2] + project(point)[2]) / 2 }));
                links.sort((a, b) => a.depth - b.depth).forEach(link => {
                    drawing.append(line(link.start, link.end, { stroke: '#fff', 'stroke-width': 11 }));
                    drawing.append(line(link.start, link.end, { stroke: '#777', 'stroke-width': 7 }));
                    drawing.append(line(link.start, link.end, { stroke: '#222', 'stroke-width': 1.5 }));
                });
                if (settings.showAxes) {
                    frames.forEach((frame, i) => {
                        // URDF joint origins are not necessarily at the common
                        // wrist center; show the full axis through each origin.
                        const start = add(frame.origin, scale(frame.axis, -.19));
                        const tip = add(frame.origin, scale(frame.axis, .25));
                        drawing.append(line(start, tip, { stroke: '#111', opacity: .7, 'stroke-width': 1.5, 'stroke-dasharray': '4 4' }));
                        drawing.append(label(tip, 'ω' + ['₁', '₂', '₃', '₄', '₅', '₆', '₇'][i], { x: project(tip)[0] + 7 + (i % 2) * 10, y: project(tip)[1] - 7 - (i % 3) * 12, fill: '#111' }));
                    });
                }
                frames.map((frame, i) => ({ frame, index: i, position: project(frame.origin) })).sort((a, b) => a.position[2] - b.position[2]).forEach(item => {
                    drawing.append(svgNode('circle', { cx: item.position[0], cy: item.position[1], r: 4.5, fill: '#fff', stroke: '#111', 'stroke-width': 1.5 }));
                    if (!settings.showAxes) drawing.append(label(item.frame.origin, 'J' + (item.index + 1), { 'font-size': 11, x: item.position[0] + 8, y: item.position[1] - 5 - item.index % 2 * 9 }));
                });
                const point = project(end);
                drawing.append(svgNode('path', { d: 'M ' + point[0] + ' ' + (point[1] - 6) + ' l 6 6 -6 6 -6 -6 Z', fill: '#f00', stroke: '#fff', 'stroke-width': 1.5 }));
                drawing.append(label(end, 'pₑₑ', { fill: '#d00', x: point[0] + 10, y: point[1] - 10 }));
                for (let i = 0; i < 3; i += 1) {
                    const axis = [transform[0][i], transform[1][i], transform[2][i]];
                    const tip = add(end, scale(axis, .12));
                    drawing.append(line(end, tip, { stroke: '#f00', 'stroke-width': 1.4, 'stroke-dasharray': i === 2 ? '2 2' : 'none' }));
                    drawing.append(label(tip, ['xₑ', 'yₑ', 'zₑ'][i], { 'font-size': 10, fill: '#d00', y: project(tip)[1] + 13 }));
                }
                if (settings.showWrist && typeof model.wristPosition === 'function') {
                    const wrist = model.wristPosition(configuration), p = project(wrist);
                    drawing.append(svgNode('circle', { cx: p[0], cy: p[1], r: 8, fill: '#f00', stroke: '#fff', 'stroke-width': 2 }));
                    drawing.append(svgNode('circle', { cx: p[0], cy: p[1], r: 12, fill: 'none', stroke: '#f00', 'stroke-width': 1.5 }));
                    drawing.append(label(wrist, 'p𝑤', { fill: '#d00', x: p[0] - 29, y: p[1] - 15, 'font-size': 14 }));
                }
                caption.textContent = settings.caption || 'Joint-frame schematic only; STL meshes are not loaded. The dashed lines extend the joint axes; the diamond marks the tool point.';
            } catch (_) {
                drawing.append(svgNode('text', { x: 320, y: 195, 'text-anchor': 'middle', fill: '#111', 'font-family': 'system-ui', 'font-size': 15 }, 'Set seven finite joint angles to display the robot.'));
            }
        }
        function resetView() { azimuth = .65; elevation = .2; zoom = 1; pan = [0, 0]; draw(); }
        function changeZoom(factor) { zoom = Math.max(.45, Math.min(3.5, zoom * factor)); draw(); }
        function localPoint(event) {
            const screenMatrix = canvas.getScreenCTM();
            if (screenMatrix) {
                const point = canvas.createSVGPoint(); point.x = event.clientX; point.y = event.clientY;
                const local = point.matrixTransform(screenMatrix.inverse()); return [local.x, local.y];
            }
            const rect = canvas.getBoundingClientRect();
            return [(event.clientX - rect.left) * 640 / Math.max(1, rect.width), (event.clientY - rect.top) * 390 / Math.max(1, rect.height)];
        }
        on(zoomIn, 'click', () => changeZoom(1.2)); on(zoomOut, 'click', () => changeZoom(1 / 1.2)); on(reset, 'click', resetView);
        on(canvas, 'pointerdown', event => {
            if (event.button > 2) return;
            event.preventDefault(); canvas.focus({ preventScroll: true });
            pointers.set(event.pointerId, localPoint(event)); canvas.setPointerCapture(event.pointerId);
            if (pointers.size === 1) activeGesture = { point: localPoint(event), pan: event.shiftKey || event.button !== 0 };
            else if (pointers.size === 2) {
                const pair = [...pointers.values()];
                activeGesture = { pinch: Math.hypot(pair[0][0] - pair[1][0], pair[0][1] - pair[1][1]), midpoint: [(pair[0][0] + pair[1][0]) / 2, (pair[0][1] + pair[1][1]) / 2] };
            }
        });
        on(canvas, 'pointermove', event => {
            if (!pointers.has(event.pointerId) || !activeGesture) return;
            const current = localPoint(event); pointers.set(event.pointerId, current);
            if (pointers.size === 2 && activeGesture.pinch !== undefined) {
                const pair = [...pointers.values()], distance = Math.hypot(pair[0][0] - pair[1][0], pair[0][1] - pair[1][1]);
                const middle = [(pair[0][0] + pair[1][0]) / 2, (pair[0][1] + pair[1][1]) / 2];
                if (activeGesture.pinch > 0) zoom = Math.max(.45, Math.min(3.5, zoom * distance / activeGesture.pinch));
                pan = [pan[0] + middle[0] - activeGesture.midpoint[0], pan[1] + middle[1] - activeGesture.midpoint[1]];
                activeGesture = { pinch: distance, midpoint: middle };
            } else if (pointers.size === 1 && activeGesture.point) {
                const dx = current[0] - activeGesture.point[0], dy = current[1] - activeGesture.point[1];
                if (activeGesture.pan) pan = [pan[0] + dx, pan[1] + dy];
                else { azimuth -= dx * .009; elevation = Math.max(-1.4, Math.min(1.4, elevation + dy * .007)); }
                activeGesture.point = current;
            }
            draw();
        });
        function endPointer(event) {
            pointers.delete(event.pointerId);
            if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
            activeGesture = pointers.size === 1 ? { point: [...pointers.values()][0], pan: false } : null;
        }
        on(canvas, 'pointerup', endPointer); on(canvas, 'pointercancel', endPointer); on(canvas, 'lostpointercapture', endPointer);
        on(canvas, 'contextmenu', event => event.preventDefault());
        on(canvas, 'wheel', event => { if (event.ctrlKey) return; event.preventDefault(); changeZoom(Math.exp(-Math.max(-100, Math.min(100, event.deltaY)) * .002)); }, { passive: false });
        on(canvas, 'keydown', event => {
            const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', '_', 'Home'];
            if (!keys.includes(event.key)) return;
            event.preventDefault(); event.stopPropagation();
            if (event.key === 'Home') return resetView();
            if (event.key === '+' || event.key === '=') return changeZoom(1.15);
            if (event.key === '-' || event.key === '_') return changeZoom(1 / 1.15);
            if (event.key === 'ArrowLeft') azimuth -= .1;
            if (event.key === 'ArrowRight') azimuth += .1;
            if (event.key === 'ArrowUp') elevation = Math.min(1.4, elevation + .1);
            if (event.key === 'ArrowDown') elevation = Math.max(-1.4, elevation - .1);
            draw();
        });
        draw();
        return {
            update(q, nextSettings) {
                if (!Array.isArray(q) || q.length !== 7 || !q.every(Number.isFinite)) throw new Error('The robot view needs seven finite joint angles in radians.');
                configuration = q.slice(); settings = Object.assign({}, settings, nextSettings || {}); draw();
            },
            resetView,
            dispose() { if (!disposed) { disposed = true; listeners.forEach(remove => remove()); wrapper.remove(); } }
        };
    }
    // Capture this script's location before an asynchronous import changes currentScript.
    const script = typeof document !== 'undefined' ? document.currentScript : null;
    const moduleURL = script && script.src ? new URL('./exercise-02-scene-three.js', script.src).href : null;
    let modulePromise = null;
    function loadRenderer() {
        if (!moduleURL) return Promise.reject(new Error('The STL viewer module could not be located.'));
        if (!modulePromise) modulePromise = import(moduleURL).catch(error => { modulePromise = null; throw error; });
        return modulePromise;
    }
    function create(container, options) {
        options = options || {};
        const model = options.model;
        if (!container || !container.ownerDocument || !model || typeof model.jointFrames !== 'function') throw new Error('Choose a container and iiwa model for the robot view.');
        const document = container.ownerDocument;
        const wrapper = document.createElement('div'); wrapper.className = 'ex02-scene-adapter'; wrapper.dataset.sceneState = 'loading';
        const mount = document.createElement('div'); mount.className = 'ex02-scene-mount';
        const status = document.createElement('div'); status.className = 'ex02-scene-load-status'; status.setAttribute('role', 'status');
        const message = document.createElement('span');
        const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = 'Retry STL loading'; retry.hidden = true;
        status.append(message, retry); wrapper.append(mount, status); container.append(wrapper);
        let configuration = [0, 0, 0, 0, 0, 0, 0];
        let settings = { showWrist: false, showAxes: true, caption: '' };
        let renderer = null, disposed = false, generation = 0;
        async function start() {
            const current = ++generation;
            if (renderer) { renderer.dispose(); renderer = null; }
            mount.replaceChildren(); retry.hidden = true; wrapper.dataset.sceneState = 'loading';
            message.textContent = 'Loading the iiwa 7 URDF and its eight STL link meshes…';
            try {
                if (document.location && document.location.protocol === 'file:') throw new Error('Open this exercise from the course website or a local HTTP server to load the URDF and STL files.');
                const module = await loadRenderer();
                if (disposed || current !== generation) return;
                const view = await module.createThreeScene(mount, { model, configuration, settings });
                if (disposed || current !== generation) { view.dispose(); return; }
                renderer = view; renderer.update(configuration, settings);
                wrapper.dataset.sceneState = 'ready'; message.textContent = 'KUKA iiwa 7 · 8 STL link meshes loaded from the course URDF.';
            } catch (error) {
                if (disposed || current !== generation) return;
                wrapper.dataset.sceneState = 'fallback';
                message.textContent = 'STL robot not loaded. ' + (error && error.message ? error.message : 'The 3D renderer could not start.') + ' Showing a joint-frame schematic.';
                retry.hidden = false;
                mount.replaceChildren(); renderer = createFallback(mount, { model }); renderer.update(configuration, settings);
                const figure = mount.querySelector('figure');
                if (figure) Object.defineProperty(figure, 'getSceneSnapshot', { value: () => getSnapshot() });
            }
        }
        function getSnapshot() {
            if (renderer && typeof renderer.getSnapshot === 'function') return renderer.getSnapshot();
            return Object.freeze({ state: wrapper.dataset.sceneState, renderer: 'schematic', meshCount: 0, configuration: configuration.slice(), showWrist: !!settings.showWrist });
        }
        retry.addEventListener('click', start); start();
        return Object.freeze({
            update(q, nextSettings) {
                if (!Array.isArray(q) || q.length !== 7 || !q.every(Number.isFinite)) throw new Error('The robot view needs seven finite joint angles in radians.');
                configuration = q.slice(); settings = Object.assign({}, settings, nextSettings || {});
                if (renderer) renderer.update(configuration, nextSettings || {});
            },
            getSnapshot,
            resetView() { if (renderer) renderer.resetView(); },
            dispose() { disposed = true; generation += 1; retry.removeEventListener('click', start); if (renderer) renderer.dispose(); wrapper.remove(); }
        });
    }
    return Object.freeze({ create });
});
