/* Run from the repository root against a local Chromium CDP page and HTTP server.
 * EXERCISE02_PREVIEW_URL defaults to the lectures_main server on port 8052.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Model = require('../../js/exercises/exercise-02-model.js');
const answerFile = process.cwd() + '/lectures_main/solutions/exercise_02_answers.json';
const urdf = fs.readFileSync('lectures_main/assets/models/iiwa7/iiwa7.urdf', 'utf8');
const visuals = Array.from(urdf.matchAll(/<link name="iiwa_link_(\d)">([\s\S]*?)<\/link>/g)).map(match => {
    const body = match[2].match(/<visual>([\s\S]*?)<\/visual>/)[1];
    const origin = body.match(/<origin([^>]*)>/)?.[1] || '';
    const vector = (name, fallback) => origin.match(new RegExp(name + '="([^"]+)"'))?.[1].trim().split(/\s+/).map(Number) || fallback;
    return { index: Number(match[1]), xyz: vector('xyz', [0, 0, 0]), rpy: vector('rpy', [0, 0, 0]) };
}).sort((a, b) => a.index - b.index);
function originMatrix({ xyz, rpy: [r, p, y] }) {
    const cr = Math.cos(r), sr = Math.sin(r), cp = Math.cos(p), sp = Math.sin(p), cy = Math.cos(y), sy = Math.sin(y);
    return [[cy*cp,cy*sp*sr-sy*cr,cy*sp*cr+sy*sr,xyz[0]], [sy*cp,sy*sp*sr+cy*cr,sy*sp*cr-cy*sr,xyz[1]],[-sp,cp*sr,cp*cr,xyz[2]],[0,0,0,1]];
}
function near(a, b, tolerance = 1e-8) { assert.ok(Math.abs(a-b)<tolerance, `${a} differs from ${b}`); }
function matrixNear(a, b) { a.forEach((row, i) => row.forEach((value, j) => near(value, b[i][j]))); }
function checkPlacement(scene, q) {
    assert.equal(scene.renderer, 'three'); assert.equal(scene.meshCount, 8); assert.equal(scene.axes.length, 7);
    assert.deepEqual(scene.cameraUp, [0, 0, 1]);
    assert.equal(scene.frames.length, 9);
    assert.equal(scene.frames[8].link, 'iiwa_link_ee');
    matrixNear(scene.frames[8].transform, Model.fk(q));
    const frames = Model.jointFrames(q);
    scene.meshes.forEach((mesh, i) => {
        assert.ok(mesh.vertexCount > 0 && mesh.vertexCount % 3 === 0);
        assert.ok(mesh.url.endsWith('/iiwa7/link_' + i + '.stl'));
        const frame = i ? frames[i-1].transform : Model.identity(), visual = originMatrix(visuals[i]);
        matrixNear(mesh.linkTransform, frame); matrixNear(mesh.visualTransform, visual);
        matrixNear(mesh.worldTransform, Model.multiply(frame, visual));
        matrixNear(scene.frames[i].transform, frame);
    });
    scene.axes.forEach((axis, i) => {
        const a = axis.points.slice(0,3), b = axis.points.slice(3);
        near(Math.hypot(...a.map((x,j)=>b[j]-x)), scene.preferences.axisLength, 2e-7);
        a.forEach((x,j) => near((x+b[j])/2, frames[i].origin[j], 2e-7));
        a.forEach((x,j) => near((b[j]-x)/scene.preferences.axisLength, frames[i].axis[j], 2e-7));
    });
}
(async () => {
    const c = await require('./exercise-02-cdp.cjs')();
    const scene = name => c.run(`document.querySelector('#${name}-preview figure').getSceneSnapshot()`);
    const waitScenes = async () => {
        for (let i=0; i<150; i++) {
            const states = await c.run("Array.from(document.querySelectorAll('.ex02-scene-adapter')).map(e=>e.dataset.sceneState)");
            if (states.length===4 && states.every(state=>state==='ready')) return;
            if (states.some(state=>state==='fallback')) throw Error(await c.run("document.querySelector('.ex02-scene-load-status').textContent"));
            await c.wait(100);
        }
        throw Error('STL views did not become ready.');
    };
    try {
        await c.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
        await c.send('Page.navigate',{url:process.env.EXERCISE02_PREVIEW_URL || 'http://127.0.0.1:8052/exercises/exercise_02.html'});
        await c.wait(350); await c.ready();
        await c.run("localStorage.removeItem('eng654.exercise02.v1')"); await c.send('Page.reload'); await c.wait(350); await c.ready(); await waitScenes();
        checkPlacement(await scene('home'),[0,0,Model.DEFAULT_PHI,0,0,0,0]);
        assert.equal((await scene('home')).showWrist,false);
        assert.equal(new Set((await scene('home')).axes.map(axis=>axis.color)).size,1,'No pre-answer axis grouping');
        await c.click('#apply-q3'); await c.click('#review-model');
        await c.run("location.hash='#slide-4'"); await c.wait(350);
        await c.click('#home-preview [data-scene-control=frames]');
        assert.ok((await scene('home')).frames.every(frame=>frame.visible));
        await c.input('#home-preview [data-scene-control=opacity]','25');
        assert.ok((await scene('home')).meshes.every(mesh=>mesh.opacity===.25));
        await c.input('#home-preview [data-scene-control=axisLength]','1.75');
        checkPlacement(await scene('home'),[0,0,Model.DEFAULT_PHI,0,0,0,0]);
        await c.click('#home-preview [data-scene-control=axes]');
        await c.input('[data-answer="wrist.home.x"]','0');
        assert.ok((await scene('home')).axes.every(axis=>!axis.visible),'Checking a field must not reset the axes toggle');
        await c.click('#home-preview [data-scene-control=axes]');
        await c.click('#home-preview [data-scene-control=labels]');
        assert.equal((await scene('home')).preferences.labels,false);
        await c.input('#home-preview [data-scene-control=opacity]','0');
        assert.ok((await scene('home')).meshes.every(mesh=>!mesh.visible));
        assert.ok((await scene('home')).axes.every(axis=>axis.visible));
        await c.input('#home-preview [data-scene-control=opacity]','78');
        await c.click('#home-preview [data-scene-control=frames]'); await c.click('#home-preview [data-scene-control=labels]');
        await c.input('#home-preview [data-scene-control=axisLength]','1.2');
        // Native orbit and zoom change the real Three.js camera.
        const before = (await scene('home')).camera, point = await c.locate('#home-preview canvas');
        await c.send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',buttons:1,clickCount:1});
        for(let i=1;i<=10;i++) await c.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:point.x+i*9,y:point.y+i*2,button:'left',buttons:1});
        await c.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x+90,y:point.y+20,button:'left',clickCount:1});
        assert.notDeepEqual((await scene('home')).camera,before);
        await c.click('#home-preview [aria-label="Reset camera"]');
        (await scene('home')).camera.forEach((value,i)=>near(value,before[i]));
        await c.send('Input.dispatchMouseEvent',{type:'mouseWheel',...point,deltaX:0,deltaY:-100});
        assert.notDeepEqual((await scene('home')).camera,before);
        const doc = await c.send('DOM.getDocument'), input = await c.send('DOM.querySelector',{nodeId:doc.root.nodeId,selector:'#load-responses'});
        await c.send('DOM.setFileInputFiles',{nodeId:input.nodeId,files:[answerFile]});await c.wait(350);
        assert.equal((await c.snapshot()).passed.limits,true);
        assert.equal((await scene('home')).showWrist,true);
        checkPlacement(await scene('target'),Model.DEFAULT_Q);
        const previousToolMesh=(await scene('target')).meshes[7].worldTransform;
        await c.input('[aria-label="Numeric q2 in radians"]','-.4','change');
        const q=Model.DEFAULT_Q.slice();q[1]=-.4;checkPlacement(await scene('target'),q);
        assert.deepEqual((await scene('target')).configuration,q);
        // A new joint configuration must move the STL geometry, not just an annotation.
        assert.notDeepEqual((await scene('target')).meshes[7].worldTransform,previousToolMesh);
        await c.click('#solve-own');
        const state=await c.snapshot();checkPlacement(await scene('branch'),state.own.branches[0].q);
        await c.run("location.hash='#slide-6'");await c.wait(500);await c.screenshot('/tmp/ex02-stl-method-desktop.png');
        const methodText=await c.run("document.querySelector('[data-stage=method]').textContent");
        assert.match(methodText,/Paden–Kahan/);assert.doesNotMatch(methodText,/a₁|a_?1|intersect|divid|zero/i);
        await c.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
        await c.run("document.querySelector('#method-preview').scrollIntoView({block:'center'})");await c.wait(600);
        assert.ok(await c.run('document.documentElement.scrollWidth<=innerWidth+1'));
        assert.ok((await scene('method')).viewport.width>250);
        await c.screenshot('/tmp/ex02-stl-method-mobile.png');
        const placement=await c.run("(()=>{const v=document.querySelector('#method-preview .ex02-scene-viewport').getBoundingClientRect(),o=document.querySelector('#method-preview [data-scene-control=opacity]').getBoundingClientRect();return {sceneBottom:v.bottom,opacityTop:o.top}})()");
        assert.ok(placement.opacityTop>=placement.sceneBottom,'Opacity belongs below the scene');
        assert.equal(c.errors.length,0,JSON.stringify(c.errors));
        console.log('PASS: eight actual STL meshes per view, URDF visual/frame placement, extended axes, independent opacity/frame/label controls, wrist gate, OrbitControls, FK/IK motion, neutral method prompt and mobile layout.');
    } catch(error) {console.error(error);process.exitCode=1;} finally {c.ws.close();}
})();
