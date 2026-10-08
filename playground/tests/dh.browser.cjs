/* Requires Node 22+, a local HTTP server, and an isolated Chromium browser.
 * DH_BASE_URL=http://localhost:8000 DH_CDP_PORT=9222 node playground/tests/dh.browser.cjs
 */
const assert=require('node:assert/strict'),fs=require('node:fs');
const base=process.env.DH_BASE_URL || 'http://127.0.0.1:8064';
const cdp=`http://127.0.0.1:${process.env.DH_CDP_PORT || '9264'}`;
async function connect(url) {
  const socket=new WebSocket(url),pending=new Map(),errors=[];let serial=0;
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  socket.addEventListener('message',event=>{
    const data=JSON.parse(event.data);
    if(data.id){const task=pending.get(data.id);if(!task)return;pending.delete(data.id);clearTimeout(task.timer);data.error?task.reject(Error(JSON.stringify(data.error))):task.resolve(data.result);}
    else if(data.method==='Runtime.exceptionThrown')errors.push(data.params.exceptionDetails);
    else if(data.method==='Runtime.consoleAPICalled'&&data.params.type==='error')errors.push(data.params.args.map(a=>a.value||a.description).join(' '));
  });
  return {errors,close:()=>socket.close(),send:(method,params={})=>new Promise((resolve,reject)=>{
    const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+method));},30000);
    pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));
  })};
}
(async()=>{
  const browser=await connect((await (await fetch(cdp+'/json/version')).json()).webSocketDebuggerUrl);let context,page;
  try {
    context=(await browser.send('Target.createBrowserContext')).browserContextId;
    const target=await browser.send('Target.createTarget',{url:'about:blank',browserContextId:context});
    page=await connect((await (await fetch(cdp+'/json/list')).json()).find(t=>t.id===target.targetId).webSocketDebuggerUrl);
    const run=async expression=>{const r=await page.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
    const click=selector=>run(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const change=(selector,value,event='change')=>run(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.value=${JSON.stringify(String(value))};el.dispatchEvent(new Event(${JSON.stringify(event)},{bubbles:true}));})()`);
    const state=()=>run('DHPlayground.getState()'),model=()=>run('DHPlayground.getModel()'),view=()=>run('DHPlayground.getViewerState()');
    const feedback=()=>run('document.querySelector("#feedback").textContent');
    const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    async function until(expression,message,timeout=30000){const end=Date.now()+timeout;while(Date.now()<end){if(await run(expression))return;await wait(100);}throw Error(message);}
    async function size(width,height,mobile=false){await page.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile});await wait(120);}
    async function screenshot(name){await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');const r=await page.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync('/tmp/eng654-dh-'+name+'.png',Buffer.from(r.data,'base64'));}
    async function bounds(label){
      const result=await run(`(()=>{const root=document.documentElement;return {width:innerWidth,height:innerHeight,scrollWidth:root.scrollWidth,scrollHeight:root.scrollHeight,panels:[...document.querySelectorAll('[data-pane]')].filter(e=>e.getClientRects().length).map(e=>({pane:e.dataset.pane,height:e.clientHeight,content:e.scrollHeight,width:e.clientWidth,contentWidth:e.scrollWidth})),actions:[...document.querySelectorAll('.task-actions button,.table-heading button')].filter(e=>e.getClientRects().length).map(e=>{const r=e.getBoundingClientRect();return {id:e.id,bottom:r.bottom,right:r.right};})};})()`);
      assert.ok(result.scrollWidth<=result.width&&result.scrollHeight<=result.height,`${label}: page overflow ${JSON.stringify(result)}`);
      result.panels.forEach(p=>assert.ok(p.content<=p.height+2&&p.contentWidth<=p.width+2,`${label}: panel overflow ${JSON.stringify(p)}`));
      result.actions.forEach(b=>assert.ok(b.bottom<=result.height&&b.right<=result.width,`${label}: hidden action ${JSON.stringify(b)}`));
    }
    async function begin(id){await change('#exercise',id);await until(`window.DHPlayground?.getModel()?.id===${JSON.stringify(id)}&&DHPlayground.getState().phase===0`,'load '+id);assert.ok((await state()).drafts.every(r=>Object.values(r).every(v=>v==='')),'table starts empty');}
    async function axes(){
      const checked=await run(`(()=>{const checks=[];DHPlayground.getModel().frames.forEach(f=>{document.querySelector('[data-axis="'+f.axis+'"][data-sign="'+(f.axisSign||1)+'"]').click();document.querySelector('#check').click();checks.push(document.querySelector('#feedback').textContent);document.querySelector('#next').click();});return checks;})()`);
      checked.forEach(text=>assert.match(text,/Correct/));assert.equal((await state()).phase,1);
    }
    async function normals(choice=0){
      const checked=await run(`(()=>{const checks=[];DHPlayground.getModel().normals.forEach(n=>{const choice=${choice}===3&&n.kind!=='coincident'?0:${choice};document.querySelector('[data-normal="'+choice+'"]').click();document.querySelector('#check').click();checks.push(document.querySelector('#feedback').textContent);document.querySelector('#next').click();});return checks;})()`);
      checked.forEach(text=>assert.match(text,/Correct/));
      assert.equal((await state()).phase,2);
    }
    async function fillTable(){
      await run(`(()=>{const rows=DHPlayground.getModel().rows;document.querySelectorAll('[data-table-row]').forEach(input=>{const value=rows[Number(input.dataset.tableRow)][input.dataset.parameter];input.focus();input.value=Math.abs(value)<1e-8?'0':Math.abs(value-Math.PI/2)<1e-8?'pi/2':Math.abs(value+Math.PI/2)<1e-8?'-pi/2':value.toFixed(3);input.dispatchEvent(new Event('input',{bubbles:true}));});document.activeElement.blur();})()`);
    }
    async function verify(){await click('#verify-table');assert.equal((await state()).verified,true,await run('document.querySelector("#table-status").textContent'));assert.ok(await run('DHPlayground.getComparison().error<1e-8'));assert.equal(await run('document.querySelector("#check").hidden'),true,'completed exercise hides Check');assert.equal(await run('document.querySelector("#verify-table").hidden'),true,'verified table hides repeated verification');}
    async function mouseDrag(button,dx,dy){
      const point=await run('(()=>{const r=document.querySelector("#dh-scene canvas").getBoundingClientRect();return {x:r.x+r.width*.4,y:r.y+r.height*.4};})()');
      const buttons={left:1,right:2,middle:4}[button];
      await page.send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button,buttons,clickCount:1});
      for(let i=1;i<=4;i++)await page.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:point.x+dx*i/4,y:point.y+dy*i/4,button,buttons});
      await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x+dx,y:point.y+dy,button,buttons:0,clickCount:1});await wait(700);
    }
    async function pickMeasurement(id){
      const point=await run(`(()=>{const r=document.querySelector('#dh-scene').getBoundingClientRect(),p=DHPlayground.getViewerState().measurementPicks.find(p=>p.id===${JSON.stringify(id)});if(!p)throw Error('Missing measurement target');return {x:r.x+p.x,y:r.y+p.y};})()`);
      await page.send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',buttons:1,clickCount:1});await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',buttons:0,clickCount:1});
    }
    async function measurementLayout(label){
      const rect=await run(`(()=>{const panel=document.querySelector('#measurement-panel'),stage=document.querySelector('#dh-scene'),a=panel.getBoundingClientRect(),b=stage.getBoundingClientRect();return {left:a.left,top:a.top,right:a.right,bottom:a.bottom,stageLeft:b.left,stageTop:b.top,stageRight:b.right,stageBottom:b.bottom,height:panel.clientHeight,content:panel.scrollHeight};})()`);
      assert.ok(rect.left>=rect.stageLeft&&rect.top>=rect.stageTop&&rect.right<=rect.stageRight&&rect.bottom<=rect.stageBottom&&rect.content<=rect.height+2,`${label}: measurement overlay fits ${JSON.stringify(rect)}`);
    }
    async function dragFrame(delta,touch=false){
      await wait(120);
      const before=await view(),s=await state(),key=['theta','d','alpha','a'][s.stage],rotation=s.stage===0||s.stage===2,initial=Number(s.drafts[s.row][key]||0),others={...s.drafts[s.row]};
      const path=await run(`(()=>{const M=DHModel,v=DHPlayground.getViewerState(),g=v.manipulation,r=document.querySelector('#dh-scene').getBoundingClientRect(),forward=M.unit(M.sub(v.target,v.camera)),right=M.unit(M.cross(forward,v.up)),up=M.cross(right,forward),tan=Math.tan(20*Math.PI/180),stage=document.querySelector('#dh-scene'),aspect=stage.clientWidth/stage.clientHeight;
        const project=point=>{const p=M.sub(point,v.camera),z=M.dot(p,forward);return {x:r.x+r.width/2*(1+M.dot(p,right)/(z*tan*aspect)),y:r.y+r.height/2*(1-M.dot(p,up)/(z*tan))};};
        return Array.from({length:13},(_,i)=>{const amount=${delta}*i/12,point=${rotation}?M.add(g.origin,M.origin(M.multiply(M.rotation(g.direction,amount),M.translation(M.sub(g.handle.world,g.origin))))):M.add(g.handle.world,M.scale(g.direction,amount));return project(point);});})()`);
      if(touch)await page.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...path[0],id:1}]});
      else await page.send('Input.dispatchMouseEvent',{type:'mousePressed',...path[0],button:'left',buttons:1,clickCount:1});
      assert.equal((await view()).manipulation.dragging,true,key+' starts dragging the purple frame');assert.equal((await view()).manipulation.cameraEnabled,false,'frame drag suspends camera gestures');
      for(const point of path.slice(1)){
        if(touch)await page.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...point,id:1}]});
        else await page.send('Input.dispatchMouseEvent',{type:'mouseMoved',...point,button:'left',buttons:1});
      }
      if(touch)await page.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      else await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',...path.at(-1),button:'left',buttons:0,clickCount:1});await wait(60);
      const after=await view(),next=await state();assert.ok(Math.abs(Number(next.drafts[s.row][key])-initial-delta)<.00005,key+' drag updates its signed numeric value: '+JSON.stringify({initial,delta,actual:next.drafts[s.row][key],before:before.manipulation,after:after.manipulation,cameraBefore:before.camera,cameraAfter:after.camera}));assert.equal(await run('Number(document.querySelector("#parameter-answer").value)'),Number(next.drafts[s.row][key]));assert.equal(await run(`Number(document.querySelector('[data-table-row="${s.row}"][data-parameter="${key}"]').value)`),Number(next.drafts[s.row][key]));
      assert.ok(after.camera.every((v,i)=>Math.abs(v-before.camera[i])<1e-8),'frame drag leaves camera position fixed');assert.ok(after.target.every((v,i)=>Math.abs(v-before.target[i])<1e-8));assert.equal(after.manipulation.cameraEnabled,true);assert.equal(after.manipulation.dragging,false);assert.equal(next.solved[s.row][key],false,'dragged answers still need checking');
      Object.keys(others).filter(k=>k!==key).forEach(k=>assert.equal(next.drafts[s.row][k],others[k],'drag changes only '+key));
      if(rotation){const index=s.stage===0?0:2,a=before.moving.slice(index*4,index*4+3),b=after.moving.slice(index*4,index*4+3);const angle=await run(`DHModel.angle(${JSON.stringify(a)},${JSON.stringify(b)},${JSON.stringify(before.manipulation.direction)})`);assert.ok(Math.abs(angle-delta)<.00005,'purple frame rotates about the selected world axis');}
      else{const displacement=after.moving.slice(12,15).map((v,i)=>v-before.moving[12+i]);assert.ok(displacement.every((v,i)=>Math.abs(v-before.manipulation.direction[i]*delta)<.00005),'purple frame translates along the selected world axis');}
    }
    async function frameManipulationChecks(){
      const focus=key=>run(`document.querySelector('[data-table-row="0"][data-parameter="${key}"]').focus()`);
      await focus('theta');await change('#motion-axis','D0:axis:0');assert.equal((await state()).axisLocked,false,'wrong rotation axis does not lock');await change('#motion-axis','D0:axis:2');assert.equal((await state()).axisLocked,true);assert.equal(await run('document.querySelector("#motion-axis").disabled'),true);
      await dragFrame(.4);await dragFrame(-.4);
      await focus('d');await change('#motion-axis','D0:axis:2');await dragFrame(.22);await dragFrame(-.22);
      await change('[data-table-row="0"][data-parameter="d"]',String((await model()).rows[0].d),'input');
      await focus('alpha');await change('#motion-axis','D1:axis:0');assert.equal((await state()).axisLocked,true,'the common-normal x axis locks for alpha');
      assert.equal((await view()).rotationRings,0,'rotation exercise has no circle');
      const opacities=(await view()).alignmentAxisOpacities;assert.equal([...opacities.moving,...opacities.target,opacities.operation].filter(opacity=>opacity===1).length,3,'only the operation, aligned, and target arrows are opaque');
      assert.deepEqual(await run('[...document.querySelectorAll(".frame-label")].filter(e=>e.getClientRects().length&&(/^D[₀₁₂₃₄₅₆₇₈₉0-9]/.test(e.textContent)||/moving/i.test(e.textContent))).map(e=>e.textContent)'),[],'alignment view omits D frame names and moving labels');
      await click('#hint');const hintText=await run('document.querySelector("#scene-hint").textContent');assert.match(hintText,/Align z0.*z1.*rotating about x1/);await click('#hint');assert.equal(await run('document.querySelector("#scene-hint").hidden'),true);await click('#hint');assert.equal(await run('document.querySelector("#scene-hint").textContent'),hintText,'Hint shows the same single instruction');
      assert.match(await run('getComputedStyle(document.querySelector("#scene-hint")).fontFamily'),/Calibri/);assert.ok((await view()).manipulation.axisOpacity<.3);assert.ok((await view()).manipulation.normalOpacity<.3);
      await dragFrame(.55);await screenshot('drag-alpha');await click('#hint');await dragFrame(-.8);await dragFrame(.25);
      const alpha=(await model()).rows[0].alpha;await dragFrame(alpha);assert.equal((await state()).dragAligned,true,'dragging to the geometric target snaps into alignment');assert.equal((await state()).solved[0].alpha,false,'aligned value still needs Check');await dragFrame(-alpha);
      await focus('a');await change('#motion-axis','D1:axis:0');await dragFrame(.18);await dragFrame(-.18);await click('#unlock-axis');assert.equal((await state()).axisLocked,false);
      await size(390,667,true);await click('[data-pane-button="table"]');await focus('alpha');await click('[data-pane-button="scene"]');await change('#motion-axis','D1:axis:0');await click('#scene-hint-toggle');await bounds('touch alignment hint');await click('#view-home');
      await page.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:2});await dragFrame(.3,true);await screenshot('drag-alpha-mobile');await dragFrame(-.3,true);
      await click('[data-pane-button="table"]');await focus('a');await click('[data-pane-button="scene"]');await change('#motion-axis','D1:axis:0');await dragFrame(.18,true);await dragFrame(-.18,true);
      await page.send('Emulation.setTouchEmulationEnabled',{enabled:false});await size(1440,900);await click('[data-pane-button="exercise"]');
      assert.equal(await run('document.querySelector(".frame-options").open'),true,'desktop frame controls stay visible');
      // Edge-on rotation and head-on translation must remain usable, and interrupted
      // gestures must release the camera instead of leaving OrbitControls disabled.
      const handle=()=>run('(()=>{const r=document.querySelector("#dh-scene canvas").getBoundingClientRect(),p=DHPlayground.getViewerState().manipulation.handle;return {x:r.x+p.x,y:r.y+p.y};})()');
      await focus('theta');await change('#motion-axis','D0:axis:2');await click('#view-front');await wait(120);let point=await handle(),camera=(await view()).camera;
      await page.send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',buttons:1,clickCount:1});assert.equal((await view()).manipulation.mode,'rotation-tangent');
      await page.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:point.x+30,y:point.y,button:'left',buttons:1});assert.ok(Math.abs(Number((await state()).drafts[0].theta))>.05,'edge-on rotation updates the answer');assert.deepEqual((await view()).camera,camera);
      await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});assert.equal((await view()).manipulation.dragging,false);assert.equal((await view()).manipulation.cameraEnabled,true);
      await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x+30,y:point.y,button:'left',buttons:0,clickCount:1});await change('[data-table-row="0"][data-parameter="theta"]','0','input');
      await focus('a');await change('#motion-axis','D1:axis:0');await click('#view-front');await wait(120);point=await handle();camera=(await view()).camera;
      await page.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:2});await page.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...point,id:1}]});assert.equal((await view()).manipulation.mode,'translation-screen');
      await page.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:point.x,y:point.y-30,id:1}]});assert.ok(Math.abs(Number((await state()).drafts[0].a))>.02,'head-on translation updates the answer');assert.deepEqual((await view()).camera,camera);
      await page.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});assert.equal((await view()).manipulation.dragging,false);assert.equal((await view()).manipulation.cameraEnabled,true);await page.send('Emulation.setTouchEmulationEnabled',{enabled:false});
      await click('#view-home');const value=(await state()).drafts[0].a;point=await run('(()=>{const r=document.querySelector("#dh-scene canvas").getBoundingClientRect();return {x:r.x+30,y:r.y+r.height*.4};})()');camera=(await view()).camera;
      await page.send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',buttons:1,clickCount:1});await page.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:point.x+30,y:point.y+20,button:'left',buttons:1});await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x+30,y:point.y+20,button:'left',buttons:0,clickCount:1});await wait(650);
      assert.notDeepEqual((await view()).camera,camera,'empty-space drag still orbits with the frame axis locked');assert.equal((await state()).drafts[0].a,value,'camera gesture does not edit the answer');
      await run(`document.querySelectorAll('[data-table-row="0"]').forEach(input=>{input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));});`);await focus('theta');
      console.log('PASS: axis locking, mouse/touch frame dragging about/along x/z, alignment snapping, edge-on/head-on gestures, cancellation, live inputs, fixed camera, faded context, and one toggleable Calibri hint.');
    }
    async function checkedMotion(s,detailed=false){
      const keys=['theta','d','alpha','a'],key=keys[s.stage],initial=await view();
      const checked=await run('(()=>{document.querySelector("#check").click();return {state:DHPlayground.getState(),text:document.querySelector("#scene-transition").textContent,hidden:document.querySelector("#scene-transition").hidden,feedback:document.querySelector("#feedback").textContent};})()');assert.equal(checked.state.pending,true,checked.feedback);assert.equal(checked.state.transition,'confirm','correct Check starts a demonstration');assert.equal(checked.hidden,false);assert.match(checked.text,/Correct/);
      if(detailed){
        await until('DHPlayground.getState().preview>10&&DHPlayground.getState().preview<90','checked transform animates');const mid=await view();
        if(Math.abs((await model()).rows[s.row][key])>1e-8)assert.notDeepEqual(mid.moving,initial.moving,'correct answer replays its transform');
        assert.ok(mid.camera.every((v,i)=>Math.abs(v-initial.camera[i])<1e-8),'demonstration keeps camera fixed');assert.equal(mid.layers.ground,true);assert.equal(mid.rotationRings,0);
        if(key==='alpha')await screenshot('checked-alpha');
        if(s.row<(await model()).rows.length-1||s.stage<3){
          await until('DHPlayground.getState().transition==="fade-out"&&DHPlayground.getState().sceneOpacity<.9&&DHPlayground.getState().sceneOpacity>.05','old frame pair fades');assert.ok((await view()).alignmentAxisOpacities.operation<.9);assert.equal((await view()).layers.ground,true);
          await until('DHPlayground.getState().transition==="fade-in"&&DHPlayground.getState().sceneOpacity>.05&&DHPlayground.getState().sceneOpacity<.95','next frame pair fades in');
          if(s.stage===3){assert.match(await run('document.querySelector("#scene-transition").textContent'),/next joint frame.*Joint 2/);assert.deepEqual((await view()).visibleFrames,['D1','D2']);await screenshot('next-joint');}
        }
      }
      await until('!DHPlayground.getState().transition&&!DHPlayground.getState().pending','correct Check automatically progresses',8000);
      const next=await state();assert.equal(next.solved[s.row][key],true);assert.equal(next.sceneOpacity,1);assert.equal((await view()).manipulation.cameraEnabled,true);await bounds('parameter confirmation');
      if(s.row<(await model()).rows.length-1||s.stage<3){assert.equal(next.row,s.stage===3?s.row+1:s.row);assert.equal(next.stage,(s.stage+1)%4);}else assert.match(await run('document.querySelector("#scene-transition").textContent'),/All joint frames are aligned/);
    }
    async function confirmationChecks(){
      const keys=['theta','d','alpha','a'];await axes();await normals(1);
      for(let i=0;i<12;i++){const s=await state();await change('#parameter-answer',(await model()).rows[s.row][keys[s.stage]].toFixed(3),'input');await checkedMotion(s,i<4);}
      assert.equal(await run('document.querySelector("#check").hidden'),true);assert.equal((await state()).verified,false,'completion still requires table verification');
      // A new exercise interrupts the old confirmation without a late task switch.
      await begin('skew');await axes();await normals();await change('#parameter-answer','0','input');await click('#check');await until('DHPlayground.getState().transition==="confirm"&&DHPlayground.getState().preview>10','confirmation before interruption');await begin('parallel');await wait(2400);assert.equal((await model()).id,'parallel');assert.equal((await state()).phase,0);assert.equal((await state()).transition,null);assert.equal((await view()).sceneOpacity,1);assert.equal(await run('document.querySelector("#scene-transition").hidden'),true);
      // The compact screen switches to the 3D demonstration; reduced motion keeps
      // automatic progression and text while avoiding animated transforms/fades.
      await axes();await normals();await size(390,667,true);await click('[data-pane-button="exercise"]');const s=await state();await change('#parameter-answer',(await model()).rows[s.row][keys[s.stage]],'input');await click('#check');assert.equal(await run('document.body.dataset.mobileView'),'scene');await until('!DHPlayground.getState().transition&&!DHPlayground.getState().pending','mobile confirmation progresses');await bounds('compact automatic transition');await screenshot('checked-mobile');
      const edited=await state();await change('#parameter-answer',(await model()).rows[edited.row][keys[edited.stage]],'input');await click('#check');await until('DHPlayground.getState().transition==="confirm"&&DHPlayground.getState().preview>10','confirmation before editing');await change('#parameter-answer','bad','input');await wait(2200);assert.equal((await state()).transition,null);assert.equal((await state()).pending,false);assert.equal((await state()).solved[edited.row][keys[edited.stage]],false);assert.equal((await state()).row,edited.row);assert.equal((await state()).stage,edited.stage);assert.equal((await view()).sceneOpacity,1);assert.equal(await run('document.querySelector("#scene-transition").hidden'),true,'editing cancels old demonstration and its message');
      await page.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
      while(!(await state()).solved.every(row=>keys.every(key=>row[key]))){const s=await state();await change('#parameter-answer',(await model()).rows[s.row][keys[s.stage]],'input');await click('#check');assert.equal((await state()).transition,null);assert.equal((await state()).sceneOpacity,1);assert.equal((await state()).pending,false);}
      assert.equal(await run('document.querySelector("#check").hidden'),true);assert.match(await run('document.querySelector("#scene-transition").textContent'),/All joint frames are aligned/);assert.deepEqual(page.errors,[]);
      console.log('PASS: correct Check replays motion, fades into the next task/joint, announces progression in 3D, preserves ground axes, cancels on exercise change, and respects reduced motion.');
    }
    await page.send('Runtime.enable');await page.send('Page.enable');
    await size(1440,900);await page.send('Page.navigate',{url:base+'/playground/dh_parameters.html'});
    await until('!!window.DHPlayground?.getModel()','viewer starts');
    if(process.env.DH_TRANSITION_ONLY){await confirmationChecks();return;}
    if(process.env.DH_DRAG_ONLY){await axes();await normals(1);await frameManipulationChecks();assert.deepEqual(page.errors,[]);return;}
    // A Z-up camera keeps ground z vertical; rounding near zero must not flip its label.
    for(const preset of ['home','front','top']){
      await click('#view-'+preset);await wait(100);
      await run(`(()=>{const group=document.querySelector('[data-ground-axis="2"]'),text=group.querySelector('text'),dot=group.querySelector('circle');window.groundLabelSamples=[];window.sampleGroundLabel=()=>{groundLabelSamples.push({anchor:text.getAttribute('text-anchor'),offset:Number(text.getAttribute('x'))-Number(dot.getAttribute('cx'))});window.groundLabelAnimation=requestAnimationFrame(sampleGroundLabel);};sampleGroundLabel();})()`);
      await mouseDrag('left',85,40);await mouseDrag('left',-170,-80);await wait(250);
      const samples=await run('(()=>{cancelAnimationFrame(groundLabelAnimation);return groundLabelSamples;})()');
      assert.ok(samples.length>10,preset+' samples ground z over multiple frames');
      assert.equal(new Set(samples.map(s=>s.anchor)).size,1,preset+' ground z label keeps its alignment while orbiting and settling');
      assert.ok(samples.every(s=>Math.abs(s.offset-samples[0].offset)<1e-8),preset+' ground z label keeps its offset');
    }
    await click('#view-home');console.log('PASS: ground z label stays stable during orbiting and damping in Home, Front, and Top views.');
    if(process.env.DH_GROUND_ONLY){assert.deepEqual(page.errors,[]);return;}
    assert.deepEqual(page.errors,[]);assert.equal(await run('document.querySelectorAll("#exercise option").length'),15);await bounds('initial desktop');await screenshot('initial');
    assert.deepEqual((await view()).visibleFrames,['F1','F2'],'only the current supplied pair is visible');
    assert.equal(await run('document.querySelectorAll(".workflow-guide li").length'),4);
    assert.equal(await run('document.querySelector(".workflow-guide a").target'),'_blank');
    await click('#hint');assert.match(await run('document.querySelector("#hint-text").textContent'),/gold rotation axis/);await click('#hint');assert.equal(await run('document.querySelector("#hint-text").hidden'),true);await click('#hint');assert.match(await run('document.querySelector("#scene-hint").textContent'),/URDF frame/);
    const offsetDrafts=(await state()).drafts,overviewDistance=(await view()).distance;
    await click('#study-offsets');assert.deepEqual((await view()).visibleFrames,['F1','D0']);assert.equal((await view()).offsetMode,true);assert.equal(await run('document.querySelector("#frame-offset-note").hidden'),false);assert.match(await run('document.querySelector("#frame-offset-note").textContent'),/fixed change of coordinates/);
    assert.ok((await view()).distance<overviewDistance,'offset study enlarges the current comparison');
    await change('#offset-joint','2');assert.deepEqual((await view()).visibleFrames,['F3','D2']);
    const offset=await run('DHPlayground.getFrameOffset()'),flat=offset.transform[0].map((_,col)=>offset.transform.map(row=>row[col])).flat();assert.ok((await view()).frameOffset.every((v,i)=>Math.abs(v-flat[i])<1e-8),'highlighted URDF–DH offset matches the actual frames');
    await click('#show-frames');assert.deepEqual((await view()).visibleFrames,['D2']);await click('#show-frames');await click('#show-dh');assert.deepEqual((await view()).visibleFrames,['F3']);await click('#show-dh');await screenshot('offsets');await click('#study-offsets');assert.deepEqual((await view()).visibleFrames,['F1','F2']);assert.deepEqual((await state()).drafts,offsetDrafts,'offset inspection leaves the table intact');
    assert.equal((await view()).controls,'OrbitControls');assert.deepEqual((await view()).up,[0,0,1]);assert.equal((await view()).joints,3);assert.equal((await view()).goldAxes,3);assert.equal((await view()).axisColor,0xd5a020);assert.equal((await view()).axisMaterial,'MeshBasicMaterial');assert.ok((await view()).links>0);assert.ok((await view()).jointOpacity.every(n=>n>0&&n<1));
    assert.equal((await view()).layers.ground,true);assert.deepEqual((await view()).groundOrigin,[0,0,0]);
    assert.equal(await run('document.querySelectorAll(".frame-label.axis-label:not(.moving-label)").length'),0,'no individual supplied or assigned frame-axis annotations');assert.ok(await run('[...document.querySelectorAll(".frame-label")].some(e=>e.textContent==="F₁")'));assert.match(await run('document.querySelector(".axis-legend").getAttribute("aria-label")'),/red x, green y, blue z/);
    await click('#toggle-robot');assert.equal((await view()).layers.body,false);assert.equal((await view()).layers.joints,false);assert.equal((await view()).layers.links,false);assert.equal((await view()).layers.ground,true);assert.equal(await run('document.querySelector("#show-body").checked'),false);await click('#toggle-robot');
    await click('#display');await click('#show-axes');assert.equal((await view()).layers.axes,false);await click('#show-axes');await click('#show-frames');assert.equal((await view()).layers.supplied,false);await click('#show-frames');await click('#display');
    await click('#measure-toggle');await measurementLayout('desktop');await pickMeasurement('F1:origin');await pickMeasurement('F2:origin');
    let measurement=(await view()).measurement;assert.ok(Math.abs(measurement.result.distance-Math.hypot(1,.25,.45))<1e-8);assert.deepEqual((await state()).axes,[null,null,null],'measuring does not choose a joint answer');
    await change('#measure-first','F2:origin');await change('#measure-second','O:axis:2');assert.ok(Math.abs((await view()).measurement.result.distance-Math.hypot(1,.25))<1e-8,'point-to-axis distance');
    await change('#measure-first','joint:0:axis');await change('#measure-second','joint:1:axis');assert.ok(Math.abs((await view()).measurement.result.distance-1)<1e-8,'axis-to-axis distance');
    await click('#measure-angle');await pickMeasurement('F1:axis:1');await pickMeasurement('F2:axis:0');assert.ok(Math.abs((await view()).measurement.result.angle-Math.PI/2)<1e-8,'native axis angle');
    const selection=(await view()).measurement.selected;await mouseDrag('left',40,20);assert.deepEqual((await view()).measurement.selected,selection,'orbiting leaves measurement selection intact');await click('#view-home');await screenshot('measurements');await click('#measure-clear');assert.equal((await view()).measurement.result,null);await click('#measure-close');
    console.log('PASS: click distances/angles, point/axis combinations, selectable origins, clean frame labels, ground axes, and robot visibility.');
    await click('#check');assert.match(await feedback(),/Check both/);
    // Actual pointer picking; dragging the camera must not select an arrow.
    const pick=await run('(()=>{const r=document.querySelector("#dh-scene").getBoundingClientRect();const p=DHPlayground.getViewerState().picks.find(p=>p.frame===0&&p.axis===0);return {x:r.x+p.x,y:r.y+p.y};})()');
    await page.send('Input.dispatchMouseEvent',{type:'mousePressed',...pick,button:'left',buttons:1,clickCount:1});await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',...pick,button:'left',buttons:0,clickCount:1});
    assert.equal((await state()).axes[0],'0:1','native click selects the local arrow');
    await click('#restart');const home=await view();await mouseDrag('left',85,40);assert.notDeepEqual((await view()).camera,home.camera,'left drag orbits');assert.deepEqual((await state()).axes,[null,null,null],'camera drag leaves answers untouched');assert.equal((await view()).pointers,0);await click('#view-home');
    await mouseDrag('right',65,30);assert.notDeepEqual((await view()).target,home.target,'right drag pans');await click('#view-home');await mouseDrag('middle',0,60);assert.ok(Math.abs((await view()).distance-home.distance)>.1,'middle drag zooms');await click('#view-home');
    await page.send('Input.dispatchMouseEvent',{type:'mouseWheel',...pick,deltaX:0,deltaY:-150});await wait(400);assert.ok((await view()).distance<home.distance,'wheel zooms');await click('#view-home');
    assert.ok((await view()).camera.every((v,i)=>Math.abs(v-home.camera[i])<1e-8),'Fit clears camera damping');
    await click('#view-top');assert.notDeepEqual((await view()).camera,home.camera);await click('#view-front');await run('document.querySelector("#dh-scene canvas").dispatchEvent(new KeyboardEvent("keydown",{key:"Home",bubbles:true}))');assert.ok((await view()).camera.every((v,i)=>Math.abs(v-home.camera[i])<1e-8));
    console.log('PASS: local Three.js, solid gold axes, translucent joints/links, native arrow picking, mouse orbit/pan/zoom, and camera reset.');
    await axes();await click('[data-normal="2"]');await click('#check');assert.match(await feedback(),/perpendicular/);await normals(1);assert.ok((await model()).rows[0].a<0,'reversed normals give signed lengths');
    assert.deepEqual((await view()).visibleFrames,['D0','D1'],'parameter task isolates the two D–H frames');assert.ok((await view()).moving,'purple frame is visible for direct manipulation');assert.equal((await view()).highlight.id,'D0:axis:2');assert.equal(await run('document.querySelector(".given-data").hidden'),true);assert.ok(await run('!document.querySelector("#exercise-note").textContent.includes("Three perpendicular")'));
    await frameManipulationChecks();await click('#hint');assert.match(await run('document.querySelector("#hint-text").textContent'),/Align x0.*x1.*rotating about z0/);await click('#hint');assert.equal(await run('document.querySelector("#scene-hint").hidden'),true);
    await click('#measure-toggle');await click('#measure-angle');await wait(120);const axisPick=await run('(()=>{const r=document.querySelector("#dh-scene").getBoundingClientRect(),p=DHPlayground.getViewerState().measurementPicks.find(p=>p.id==="D0:axis:2");return {x:r.x+p.x,y:r.y+p.y};})()');await click('#measure-close');await wait(120);await screenshot('parameter-hint');
    await page.send('Input.dispatchMouseEvent',{type:'mousePressed',...axisPick,button:'left',buttons:1,clickCount:1});await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',...axisPick,button:'left',buttons:0,clickCount:1});assert.equal((await state()).manipulationAxis,'D0:axis:2','native click selects the axis for the parameter manipulation');assert.match(await run('document.querySelector("#scene-instruction").textContent'),/Axis z0 locked/);
    await click('#measure-toggle');await change('#measure-first','D0:origin');await change('#measure-second','D1:origin');measurement=(await view()).measurement;
    assert.ok(Math.abs(measurement.result.projections[0].value-(await model()).rows[0].d)<1e-8);assert.ok(Math.abs(measurement.result.projections[1].value-(await model()).rows[0].a)<1e-8,'signed d/a components');
    await run(`document.querySelector('[data-table-row="0"][data-parameter="alpha"]').focus()`);await click('#measure-angle');await change('#measure-first','D0:axis:2');await change('#measure-second','D1:axis:2');measurement=(await view()).measurement;
    assert.equal(measurement.result.signed,true);assert.ok(Math.abs(measurement.result.angle-(await model()).rows[0].alpha)<1e-8,'signed alpha uses the task x axis');
    await run(`document.querySelector('[data-table-row="1"][data-parameter="theta"]').focus()`);await change('#measure-first','D1:axis:0');await change('#measure-second','D2:axis:0');measurement=(await view()).measurement;
    assert.equal(measurement.result.signed,true);assert.ok(Math.abs(measurement.result.angle-(await model()).rows[1].theta)<1e-8,'signed theta uses the task z axis');await click('#measure-close');await run(`document.querySelector('[data-table-row="0"][data-parameter="theta"]').focus()`);
    await click('#verify-table');assert.match(await run('document.querySelector("#table-status").textContent'),/Complete row/);
    await change('#parameter-answer','bad','input');await click('#check');assert.equal((await state()).pending,false);await change('#parameter-answer','0.3','input');await click('#check');assert.equal((await state()).pending,false);await click('#hint');await bounds('parameter hint');await change('#parameter-answer','0.31','input');assert.equal(await run('document.querySelector("#hint-text").hidden'),false,'hints stay visible while entering a trial value');
    const keys=['theta','d','alpha','a'];
    for(let i=0;i<12;i++){
      const s=await state(),value=(await model()).rows[s.row][keys[s.stage]];
      const task=(await view()).highlight;assert.equal(task.id,`D${s.stage<2?s.row:s.row+1}:axis:${s.stage<2?2:0}`);assert.deepEqual((await view()).visibleFrames,[`D${s.row}`,`D${s.row+1}`]);
      if(i>0&&i<4){await click('#hint');assert.equal(await run('document.querySelector("#scene-hint").hidden'),false);await screenshot('hint-'+keys[s.stage]);await click('#hint');assert.equal(await run('document.querySelector("#scene-hint").hidden'),true);}
      if(i===1)assert.ok(await run('(()=>{const a=document.querySelector("#origin-compass").getBoundingClientRect(),b=document.querySelector("#motion-controls").getBoundingClientRect();return b.right<=a.left;})()'),'motion controls leave the ground compass visible');
      await change('#parameter-answer',value.toFixed(3),'input');await checkedMotion(s,i<4);
      if(i===1){await change('#parameter-answer',(await model()).rows[0].alpha,'input');await change('#motion-progress',0,'input');const start=(await view()).moving;await change('#motion-progress',100,'input');assert.notDeepEqual((await view()).moving,start,'preview applies the actual frame transform');await click('#play-motion');await until('DHPlayground.getState().preview>0&&DHPlayground.getState().preview<100','preview animates');await click('#play-motion');await page.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await click('#play-motion');assert.equal((await state()).preview,100);await page.send('Emulation.setEmulatedMedia',{features:[]});}
    }
    assert.equal(await run('document.querySelector("#check").hidden'),true,'finishing all guided parameters hides Check before verification');
    await run(`document.querySelector('[data-table-row="0"][data-parameter="theta"]').focus()`);assert.equal(await run('document.querySelector("#check").hidden'),true,'reviewing completed parameters keeps Check hidden');
    await verify();assert.equal(await run('document.querySelector("#build-fk").target'),'_blank');assert.equal(await run('document.querySelector(".workflow-guide [aria-current=step]").dataset.workflowStep'),'3');await change('#joint-angle',.7,'input');assert.ok(await run('DHPlayground.getComparison().error<1e-8'));
    await click('#measure-toggle');await change('#measure-first','O:origin');await change('#measure-second','tool:origin');const toolPosition=(await view()).measurement.selected[1].origin;await change('#joint-angle',1.2,'input');measurement=(await view()).measurement;assert.notDeepEqual(measurement.selected[1].origin,toolPosition,'measurements track joint motion');assert.ok(Math.abs(measurement.result.distance-Math.hypot(...measurement.selected[1].origin))<1e-8);assert.equal((await state()).verified,true);await click('#measure-close');
    await click('#home-joints');assert.deepEqual((await state()).q,[0,0,0]);
    await run(`document.querySelector('[data-table-row="0"][data-parameter="d"]').focus()`);assert.equal((await state()).verified,true,'focus alone preserves verification');
    await change('[data-table-row="0"][data-parameter="d"]','0.9','input');assert.equal((await state()).verified,false);assert.equal(await run('document.querySelector("#download-table").disabled'),true);assert.equal(await run('document.querySelector("#check").hidden'),false,'editing restores Check');assert.equal(await run('document.querySelector("#verify-table").hidden'),false,'editing restores verification');await click('#verify-table');assert.equal((await state()).verified,false,'changed table must fail');await fillTable();await verify();
    await run(`(()=>{const blobs=new Map(),create=URL.createObjectURL.bind(URL);URL.createObjectURL=blob=>{const url=create(blob);blobs.set(url,blob);return url;};HTMLAnchorElement.prototype.click=function(){if(this.download)window.lastDHDownload=blobs.get(this.href).text().then(text=>({name:this.download,data:JSON.parse(text)}));};})()`);
    await click('#download-table');const exported=await run('window.lastDHDownload');assert.equal(exported.name,'standard-dh-skew.json');assert.equal(exported.data.rows.length,3);assert.deepEqual(exported.data.units,{angles:'radians',lengths:'metres'});assert.equal(exported.data.verification.configurations,13);
    console.log('PASS: guided steps, alternate normals, incorrect/rounded answers, table edits, FK, joint motion, and JSON download.');
    if(!process.env.DH_LAYOUT_ONLY) {
    for(const id of ['parallel','intersecting','coincident','antiparallel']){
      await begin(id);await axes();await normals(id==='coincident'?3:0);await fillTable();await verify();
    }
    const catalog=await run('DHRobots.catalog');
    for(const spec of catalog){
      await begin(spec.id);await until('!DHPlayground.getViewerState().loading','CAD finishes '+spec.id,60000);const v=await view();assert.equal(v.error,'',spec.id);assert.ok(v.cadMeshes>0,spec.id+' has CAD');assert.equal(v.bodyTransparent,true,spec.id+' body is transparent');assert.equal(v.joints,(await model()).axes.length);await bounds(spec.id+' desktop');
      assert.equal(v.bodyRepresentation,'cad',spec.id+' uses its own meshes');assert.equal(v.layers.joints,false,spec.id+' hides generated cylinders');assert.equal(v.layers.links,false,spec.id+' hides generated links');
      if(spec.id==='gofa'){await screenshot('gofa');await click('#toggle-robot');assert.equal((await view()).layers.body,false);await click('#toggle-robot');assert.equal((await view()).layers.body,true);assert.equal((await view()).layers.joints,false);assert.equal((await view()).layers.links,false);}
      await axes();await normals();await fillTable();await verify();
      await change('#pose-joint',String(v.joints-1));await change('#joint-angle','-.6','input');assert.ok(await run('DHPlayground.getComparison().error<1e-8'),spec.id+' moving tool matches');
      await click('#study-offsets');await change('#offset-joint',String(v.joints-1));assert.deepEqual((await view()).visibleFrames,[`F${v.joints}`,`D${v.joints-1}`]);const fixedOffset=(await view()).frameOffset;await change('#joint-angle','.8','input');assert.ok((await view()).frameOffset.every((n,i)=>Math.abs(n-fixedOffset[i])<1e-8),spec.id+' URDF–DH offset stays fixed during joint motion');await click('#study-offsets');
      if(spec.id==='custom6r')await screenshot('robot6r');console.log(`PASS: ${spec.name}, ${v.cadMeshes} CAD meshes, full student table, and moving FK.`);
    }
    } else {await begin('enlight');await until('!DHPlayground.getViewerState().loading','layout robot body loads');}
    await click('#restart');await axes();
    for(const [w,h,mobile] of [[1366,768,false],[1024,600,false],[390,844,true],[390,667,true]]){
      await size(w,h,mobile);await click('#hint');await bounds(`normal hint ${w}×${h}`);await click('[data-normal="0"]');await click('#check');await bounds(`normal feedback ${w}×${h}`);
      if(mobile||(w<=1150&&h<=650)){for(const pane of ['table','scene','exercise']){await click(`[data-pane-button="${pane}"]`);await bounds(`${pane} ${w}×${h}`);}await click('[data-pane-button="scene"]');await click('#study-offsets');await bounds(`offsets ${w}×${h}`);await screenshot('offsets-'+w+'-'+h);await click('#study-offsets');await click('#measure-toggle');await measurementLayout(`${w}×${h}`);await change('#measure-first','O:origin');await change('#measure-second','tool:origin');await measurementLayout(`result ${w}×${h}`);await screenshot('compact-'+w+'-'+h);await click('#measure-close');await click('[data-pane-button="exercise"]');}
    }
    await size(390,844,true);await click('[data-pane-button="scene"]');await page.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:2});
    const point=await run('(()=>{const r=document.querySelector("#dh-scene").getBoundingClientRect();return {x:r.x+r.width*.45,y:r.y+r.height*.4};})()');let before=await view();
    await page.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...point,id:1}]});await page.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:point.x+65,y:point.y+30,id:1}]});await page.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await wait(650);assert.notDeepEqual((await view()).camera,before.camera,'one-finger orbit');assert.equal((await view()).pointers,0);
    before=await view();await page.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:point.x-30,y:point.y,id:1},{x:point.x+30,y:point.y,id:2}]});await page.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:point.x-65,y:point.y+20,id:1},{x:point.x+65,y:point.y+20,id:2}]});await page.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await wait(650);assert.ok((await view()).distance<before.distance,'two-finger pinch zoom');assert.notDeepEqual((await view()).target,before.target,'two-finger pan');assert.equal((await view()).pointers,0);await click('#view-home');
    await click('#help');for(let i=0;i<5;i++)await click('#guide-next');assert.equal(await run('document.querySelector("#guide-page").textContent'),'6 / 6');await run('document.querySelector("#help-dialog").close()');
    await click('[data-pane-button="exercise"]');await normals();
    for(const [w,h,mobile] of [[1366,768,false],[1024,600,false],[390,844,true],[390,667,true]]){
      await size(w,h,mobile);await click('#hint');await bounds(`parameter hint ${w}×${h}`);await change('#parameter-answer','bad','input');await click('#check');await bounds(`parameter feedback ${w}×${h}`);
    }
    await click('[data-pane-button="table"]');await fillTable();await verify();await click('[data-pane-button="exercise"]');await bounds('verified mobile');await size(390,844,true);await bounds('verified tall mobile');await screenshot('mobile-complete');
    await click('[data-pane-button="scene"]');await click('#view-home');await click('#toggle-robot');assert.equal((await view()).layers.body,false);assert.equal((await view()).layers.ground,true);await click('#toggle-robot');await bounds('mobile robot viewer');await screenshot('mobile-robot');
    assert.deepEqual(page.errors,[],'no runtime errors in any exercise');console.log('PASS: viewport layouts for every task, mobile tabs, touch orbit/pan/zoom, and parameter guide.');
  } finally {if(page)page.close();if(context)await browser.send('Target.disposeBrowserContext',{browserContextId:context});browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
