/* Run against a local server and Chromium with --remote-debugging-port=9267:
 * node playground/tests/orbit.browser.cjs
 * Optional ORBIT_CDP_PORT and ORBIT_BASE_URL override these local defaults.
 */
const assert = require('node:assert/strict');
const base = process.env.ORBIT_BASE_URL || 'http://127.0.0.1:8057';
const port = process.env.ORBIT_CDP_PORT || '9267';

(async () => {
  const page = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
  let id = 0;
  const pending = new Map(), errors = [];
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    pending.set(++id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params }));
  });
  socket.addEventListener('message', event => {
    const data = JSON.parse(event.data);
    if (data.id) {
      const request = pending.get(data.id); pending.delete(data.id);
      data.error ? request.reject(Error(JSON.stringify(data.error))) : request.resolve(data.result);
    } else if (data.method === 'Runtime.exceptionThrown') errors.push(data.params.exceptionDetails);
  });
  const run = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const mouse = (type, x, y, button = 'left', extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button, ...extra });
  const drag = async (from, to, button = 'left', modifiers = 0) => {
    const buttons = button === 'right' ? 2 : button === 'middle' ? 4 : 1;
    await mouse('mousePressed', from.x, from.y, button, { buttons, clickCount: 1, modifiers });
    for (let i = 1; i <= 8; i++) await mouse('mouseMoved', from.x + (to.x - from.x) * i / 8, from.y + (to.y - from.y) * i / 8, button, { buttons, modifiers });
    await mouse('mouseReleased', to.x, to.y, button, { clickCount: 1, modifiers });
    await wait(70);
  };
  try {
    await send('Runtime.enable'); errors.length = 0; await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
    const navigationTag = String(Date.now());
    await send('Page.navigate', { url: `${base}/playground/building_blocks.html?orbit-check=${navigationTag}` });
    for (let attempt = 0; attempt < 80; attempt++) {
      if (await run(`location.search.includes('${navigationTag}') && Boolean(window.KinematicsPlayground && document.querySelector("#preview svg"))`)) break;
      await wait(100);
    }
    const point = await run(`(() => {
      // Keep the live app's viewer inside the headless browser's physical touch
      // surface even when its emulated viewport is taller than the host window.
      const host = document.querySelector('#preview');
      host.style.cssText = 'position:fixed;top:40px;left:40px;width:' + host.getBoundingClientRect().width + 'px;z-index:99999';
      const preview = document.querySelector('#preview svg'); preview.scrollIntoView({block:'center'});
      const r = preview.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2};
    })()`);
    const drawing = () => run('document.querySelector("#preview svg").innerHTML');
    const reset = () => run('document.querySelector(".preview-reset").click()');
    const initial = await drawing();
    await drag(point, { x: point.x + 45, y: point.y + 20 });
    assert.notEqual(await drawing(), initial, 'left drag orbits the pose');
    await reset(); assert.equal(await drawing(), initial, 'reset restores the camera');
    await drag(point, { x: point.x + 30, y: point.y + 15 }, 'right');
    assert.notEqual(await drawing(), initial, 'right drag pans');
    await reset();
    await mouse('mouseWheel', point.x, point.y, 'none', { deltaX: 0, deltaY: -180 });
    await wait(70); assert.notEqual(await drawing(), initial, 'native wheel zooms');
    await reset();
    await drag(point, { x: point.x, y: point.y - 35 }, 'middle');
    assert.notEqual(await drawing(), initial, 'middle drag zooms');
    await reset();
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: point.x - 25, y: point.y, id: 1 }] });
    await wait(50);
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: point.x - 25, y: point.y, id: 1 }, { x: point.x + 25, y: point.y, id: 2 }] });
    await wait(50);
    await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: point.x - 45, y: point.y + 12, id: 1 }, { x: point.x + 45, y: point.y + 12, id: 2 }] });
    await wait(50);
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await send('Emulation.setTouchEmulationEnabled', { enabled: false });
    assert.ok(await drawing() !== initial, 'two fingers pinch and pan');
    await reset();
    await run('document.querySelector("#preview svg").addEventListener("pointerdown", e => window.previewPointer = e.pointerId, {once:true})');
    await mouse('mousePressed', point.x, point.y, 'left', { buttons: 1, clickCount: 1 });
    await run('document.querySelector("#preview svg").releasePointerCapture(window.previewPointer)');
    await mouse('mouseMoved', point.x + 40, point.y + 15, 'left', { buttons: 1 });
    await mouse('mouseReleased', point.x + 40, point.y + 15, 'left', { clickCount: 1 });
    assert.equal(await drawing(), initial, 'losing capture ends the preview gesture');
    assert.deepEqual(errors, []);

    // Mount the real Three.js controls and marker-drag helper in an isolated scene.
    // Only add an export to the actual helper; its production event code is unchanged.
    await send('Page.navigate', { url: `${base}/playground/tests/` });
    for (let attempt = 0; attempt < 50; attempt++) {
      if (await run('location.pathname.endsWith("/tests/") && !window.KinematicsPlayground && Boolean(document.body)')) break;
      await wait(50);
    }
    await run(`(async () => {
      document.body.replaceChildren(); document.body.style.cssText = 'display:block;margin:0;background:white';
      const map = document.createElement('script'); map.type = 'importmap';
      map.textContent = JSON.stringify({imports:{three:'${base}/lectures_main/vendor/three/build/three.module.js','three/addons/':'${base}/lectures_main/vendor/three/examples/jsm/'}});
      document.head.append(map);
      const THREE = await import('three');
      let source = await (await fetch('${base}/lectures_main/js/viz/poeUrdfPlayground.js')).text();
      source = source.replace("from './threeUtils.js'", "from '${base}/lectures_main/js/viz/threeUtils.js'")
        .replace("from './frameDHPlayground.js'", "from '${base}/lectures_main/js/viz/frameDHPlayground.js'")
        .replace('function sceneKit(', 'export function sceneKit(')
        .replace('function enableFrameDrag(', 'export function enableFrameDrag(');
      const url = URL.createObjectURL(new Blob([source], {type:'text/javascript'}));
      const {enableFrameDrag, sceneKit} = await import(url); URL.revokeObjectURL(url);
      const stage = document.createElement('div'); stage.style.cssText = 'position:relative;width:600px;height:400px'; document.body.append(stage);
      const kit = sceneKit(stage, [0,5,10]);
      const {camera, renderer, world, controls} = kit;
      renderer.domElement.style.cssText = 'display:block;width:600px;height:400px';
      const marker = new THREE.Mesh(new THREE.SphereGeometry(.45), new THREE.MeshBasicMaterial({color:0xff0000}));
      marker.userData.dragFrame = 'joint1'; world.add(marker);
      enableFrameDrag(kit, [{marker}], (_, position) => marker.position.copy(position));
      document.addEventListener('pointerdown', event => window.markerPointer = event.pointerId, {capture:true});
      window.orbitTest = {kit, marker, reset() {
        controls.enableDamping = false; controls.update(); controls.enableDamping = true;
        camera.position.set(0,5,10); controls.target.set(0,0,0); marker.position.set(0,0,0); controls.update();
      },
        state() {return {camera:camera.position.toArray(),marker:marker.position.toArray(),enabled:controls.enabled,pointers:controls._pointers.length};}};
      orbitTest.reset();
    })()`);
    const state = () => run('window.orbitTest.state()');
    await wait(100); const home = await state();
    await drag({ x: 530, y: 330 }, { x: 460, y: 290 });
    assert.notDeepEqual((await state()).camera, home.camera, 'empty-space drag operates OrbitControls');
    await run('orbitTest.reset()'); await wait(40);
    await mouse('mousePressed', 300, 200, 'left', { buttons: 1, clickCount: 1 });
    let active = await state(); assert.equal(active.enabled, false); assert.equal(active.pointers, 0, 'marker drag never starts OrbitControls');
    await mouse('mouseMoved', 360, 230, 'left', { buttons: 1 });
    active = await state(); assert.notDeepEqual(active.marker, home.marker, 'marker follows its drag plane'); assert.deepEqual(active.camera, home.camera, 'marker drag leaves camera steady');
    await mouse('mouseReleased', 360, 230, 'left', { clickCount: 1 });
    assert.equal((await state()).enabled, true, 'release restores orbit');
    await run('orbitTest.reset()');
    await drag({ x: 530, y: 330 }, { x: 450, y: 300 });
    await mouse('mousePressed', 300, 200, 'left', { buttons: 1, clickCount: 1 });
    const afterOrbit = await state(); assert.equal(afterOrbit.enabled, false);
    await wait(150);
    assert.deepEqual((await state()).camera, afterOrbit.camera, 'marker drag pauses residual camera damping');
    await mouse('mouseReleased', 300, 200, 'left', { clickCount: 1 });
    await run('orbitTest.reset()'); await wait(40);
    await mouse('mousePressed', 300, 200, 'left', { buttons: 1, clickCount: 1 });
    await run('orbitTest.kit.renderer.domElement.releasePointerCapture(window.markerPointer)');
    await mouse('mouseMoved', 340, 215, 'left', { buttons: 1 });
    await mouse('mouseReleased', 340, 215, 'left', { clickCount: 1 });
    assert.equal((await state()).enabled, true, 'lost capture restores OrbitControls');
    await drag({ x: 530, y: 330 }, { x: 465, y: 285 });
    assert.notDeepEqual((await state()).camera, home.camera, 'camera still orbits after interrupted marker drag');
    assert.deepEqual(errors, []);
    console.log('PASS: native preview orbit, pan, wheel/middle zoom, pinch, reset and lost capture; production Three.js OrbitControls and marker dragging coexist, pause residual damping, and recover after capture loss.');
  } finally {
    await fetch(`http://127.0.0.1:${port}/json/close/${page.id}`).catch(() => {});
    socket.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
