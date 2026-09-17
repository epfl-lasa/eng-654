/* A local browser check using a disposable, isolated Chromium context.
 * Start a repo-root HTTP server and Chromium with remote debugging enabled.
 * OPERATIONS_BASE_URL, OPERATIONS_CDP_PORT and OPERATIONS_SCREENSHOT override defaults.
 * node playground/tests/docked-inputs.browser.cjs
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const base = process.env.OPERATIONS_BASE_URL || 'http://127.0.0.1:8062';
const cdp = 'http://127.0.0.1:' + (process.env.OPERATIONS_CDP_PORT || '9256');

async function connection(url) {
  const socket = new WebSocket(url), pending = new Map(), errors = [];
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let serial = 0;
  socket.addEventListener('message', event => {
    const data = JSON.parse(event.data);
    if (data.id) {
      const item = pending.get(data.id); if (!item) return;
      pending.delete(data.id); clearTimeout(item.timer);
      data.error ? item.reject(Error(JSON.stringify(data.error))) : item.resolve(data.result);
    } else if (data.method === 'Runtime.exceptionThrown') errors.push(data.params.exceptionDetails);
    else if (data.method === 'Runtime.consoleAPICalled' && data.params.type === 'error') errors.push(data.params.args.map(arg => arg.value || arg.description).join(' '));
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++serial, timer = setTimeout(() => { pending.delete(id); reject(Error('CDP timeout: ' + method)); }, 30000);
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  });
  return { send, errors, close: () => socket.close() };
}

(async () => {
  const info = await (await fetch(cdp + '/json/version')).json();
  const browser = await connection(info.webSocketDebuggerUrl);
  let context, page;
  try {
    context = (await browser.send('Target.createBrowserContext')).browserContextId;
    const target = await browser.send('Target.createTarget', { url: 'about:blank', browserContextId: context });
    const targets = await (await fetch(cdp + '/json/list')).json();
    page = await connection(targets.find(item => item.id === target.targetId).webSocketDebuggerUrl);
    const run = async expression => {
      const result = await page.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    const until = async (expression, label) => {
      for (let attempt = 0; attempt < 100; attempt++) {
        if (await run(expression)) return;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw Error('Timed out: ' + (label || expression) + '; ' + JSON.stringify(page.errors));
    };
    const click = selector => run(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const change = (selector, value, event = 'change') => run(`(() => { const input=document.querySelector(${JSON.stringify(selector)}); input.value=${JSON.stringify(String(value))}; input.dispatchEvent(new Event(${JSON.stringify(event)}, {bubbles:true})); })()`);
    const select = id => run("document.querySelector("+JSON.stringify('[data-node-id="'+id+'"]')+").dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))");
    const state = () => run('KinematicsPlayground.getState()');
    const output = () => run('KinematicsPlayground.getOutput()?.matrix.map(row => row.map(value => KinematicsMath.evaluate(value, KinematicsPlayground.getState().graph.bindings)))');
    const near = (actual, expected) => {
      assert.equal(actual.length, expected.length);
      actual.forEach((row, r) => { assert.equal(row.length, expected[r].length); row.forEach((value, c) => assert.ok(Math.abs(value - expected[r][c]) < 1e-10, `${r},${c}: ${value} != ${expected[r][c]}`)); });
    };
    const add = async type => { await click(`.palette-item[data-type="${type}"]`); const id=(await state()).selected;await select(id);return id; };
    await page.send('Runtime.enable'); await page.send('Page.enable'); await page.send('Network.enable');
    await page.send('Network.setCacheDisabled', { cacheDisabled: true });
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1100, deviceScaleFactor: 1, mobile: false });
    await page.send('Page.navigate', { url: base + '/playground/building_blocks.html' });
    await until('!!window.KinematicsPlayground', 'playground startup');

    const key=async (key,modifiers=2)=>{
      await run('document.querySelector("#canvas").focus()');
      await page.send('Input.dispatchKeyEvent',{type:'keyDown',key,code:'Key'+key.toUpperCase(),windowsVirtualKeyCode:key.toUpperCase().charCodeAt(0),modifiers});
      await page.send('Input.dispatchKeyEvent',{type:'keyUp',key,modifiers});
    };

    const settle=()=>run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    const block=id=>'article[data-node-id="'+id+'"]';
    const compact=async id=>{await settle();return run('(()=>{const n=document.querySelector('+JSON.stringify(block(id))+');return {width:n.offsetWidth,height:n.offsetHeight,compact:n.classList.contains("is-minimized"),ports:[...n.querySelectorAll(".port")].map(p=>({label:p.getAttribute("aria-label"),top:p.offsetTop,left:p.offsetLeft,height:p.offsetHeight})),body:getComputedStyle(n.querySelector(".block-body")).display};})()');};
    const node=id=>state().then(s=>s.graph.nodes.find(n=>n.id===id));
    const link=async(from,to,slot)=>{await click(block(from)+' [data-port="output"]');await click(block(to)+' [data-input="'+slot+'"]');await settle();};
    const verifyWires=async()=>{
      await settle();
      const errors=await run('(()=>{const state=KinematicsPlayground.getState(),world=document.querySelector("#world").getBoundingClientRect(),paths=[...document.querySelectorAll("path.wire:not(.wire-pending)")];return state.graph.edges.flatMap((edge,i)=>{const from=document.querySelector("article[data-node-id="+edge.from+"] [data-port=output]").getBoundingClientRect(),to=document.querySelector("article[data-node-id="+edge.to+"] [data-input="+(edge.input||"input")+"]").getBoundingClientRect(),numbers=paths[i].getAttribute("d").match(/-?\\d+(?:\\.\\d+)?/g).map(Number),expected=[(from.x+from.width/2-world.x)/state.view.scale,(from.y+from.height/2-world.y)/state.view.scale,(to.x+to.width/2-world.x)/state.view.scale,(to.y+to.height/2-world.y)/state.view.scale],actual=[...numbers.slice(0,2),...numbers.slice(-2)];return actual.map((n,j)=>Math.abs(n-expected[j])).filter(n=>n>0.01);});})()');
      assert.deepEqual(errors,[],'wires terminate on visible ports');
    };
    const upload=async fixture=>{
      await run('(()=>{const dt=new DataTransfer();dt.items.add(new File(['+JSON.stringify(JSON.stringify(fixture))+'],"dock.json",{type:"application/json"}));const f=document.querySelector("#graph-file");f.files=dt.files;f.dispatchEvent(new Event("change"));})()');
      await until('KinematicsPlayground.getState().graph.name==='+JSON.stringify(fixture.name));await settle();
    };
    const rect=async id=>run('(()=>{const n=document.querySelector('+JSON.stringify(block(id))+'),r=n.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height,left:n.offsetLeft,top:n.offsetTop,dockedTo:n.dataset.dockedTo};})()');
    const assertDock=async(id,parent,slot)=>{
      await settle();const child=await rect(id),outer=await rect(parent);
      assert.equal(child.dockedTo,parent);
      assert.ok(child.x>outer.x&&child.y>outer.y&&child.right<outer.right&&child.bottom<outer.bottom,'child is inside its operation');
      const aligned=await run('(()=>{const a=document.querySelector('+JSON.stringify(block(id)+' [data-port="output"]')+').getBoundingClientRect(),b=document.querySelector('+JSON.stringify(block(parent)+' [data-input="'+slot+'"]')+').getBoundingClientRect();return {dy:Math.abs(a.y+a.height/2-b.y-b.height/2),gap:b.x-a.right};})()');
      assert.ok(aligned.dy<1&&aligned.gap>=0&&aligned.gap<60,JSON.stringify(aligned));
      await verifyWires();
    };
    const fixture=type=>({version:1,name:'Dock '+type,angleUnit:'rad',bindings:{},nodes:[
      {id:'a',type:'matrix',label:'First vector',params:{rows:3,columns:1,matrix:['1','2','3']},position:{x:10,y:20}},
      {id:'b',type:'matrix',label:'Second vector',params:{rows:3,columns:1,matrix:['4','5','6']},position:{x:10,y:240}},
      {id:'op',type,label:type==='add'?'Add vectors':'Subtract vectors',params:{},position:{x:380,y:80}}
    ],edges:[{from:'a',to:'op',input:'a'},{from:'b',to:'op',input:'b'}]});
    for(const type of ['add','subtract']){
      await upload(fixture(type));
      await select('a');await key('m',10);await assertDock('a','op','a');
      assert.deepEqual((await node('a')).position,{x:10,y:20},'saved free position stays intact');
      await select('b');await key('m',10);await assertDock('b','op','b');
      const a=await rect('a'),b=await rect('b');assert.ok(a.bottom<b.y,'docked inputs do not overlap');
      assert.equal(await run('document.querySelectorAll(".dock-wire").length'),2);
      await select('op');near(await output(),type==='add'?[[5],[7],[9]]:[[-3],[-3],[-3]]);
      // Dragging an operation carries both inputs, without changing their saved positions.
      await click('#close-inputs');
      const before=await rect('a');
      const handle=await run('(()=>{const r=document.querySelector("article[data-node-id=op] .block-header").getBoundingClientRect();return{x:r.x+55,y:r.y+r.height/2}})()');
      for(const [type,x,y] of [['mousePressed',handle.x,handle.y],['mouseMoved',handle.x+90,handle.y+50],['mouseReleased',handle.x+90,handle.y+50]]){
        await page.send('Input.dispatchMouseEvent',{type,x,y,button:'left',buttons:type==='mouseReleased'?0:1,clickCount:1});
        if(type==='mouseMoved')assert.equal(await run('(()=>{const r=document.querySelector("article[data-node-id=a]").getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2).closest("article").dataset.nodeId;})()'),'a','docked inputs stay visible while dragging');
      }
      await settle();const after=await rect('a');assert.ok(Math.abs(after.x-before.x-90)<1&&Math.abs(after.y-before.y-50)<1);
      await assertDock('a','op','a');await assertDock('b','op','b');
      await key('z');await assertDock('a','op','a');
      await select('a');await key('m',10);assert.equal((await rect('a')).dockedTo,undefined);assert.equal((await rect('a')).left,10);assert.equal((await rect('a')).top,20);
      await key('z');await assertDock('a','op','a');await key('y');assert.equal((await rect('a')).dockedTo,undefined);
      await key('m',10);await assertDock('a','op','a');
      await click('#arrange-fit');await assertDock('a','op','a');await assertDock('b','op','b');
      const snapshot=(await state()).graph;
      await run('delete window.KinematicsPlayground');await page.send('Page.reload');await until('!!window.KinematicsPlayground');
      assert.deepEqual((await state()).graph,snapshot);await assertDock('a','op','a');await assertDock('b','op','b');
      await select('a');assert.equal(await run('document.querySelector("#inputs-title").textContent'),'First vector');
      await change('input[aria-label="Matrix row 1 column 1"]','7','input');await assertDock('a','op','a');
      await select('op');near(await output(),type==='add'?[[11],[7],[9]]:[[3],[-3],[-3]]);
      // A minimized destination suspends docking; restoring it brings inputs back.
      await key('m',10);assert.equal(await run('document.querySelectorAll(".is-docked").length'),0);
      await key('m',10);await assertDock('a','op','a');await assertDock('b','op','b');
      await select('op');await change('select[aria-label="A · first vector"]','');
      assert.equal((await rect('a')).dockedTo,undefined);assert.equal((await node('a')).minimized,true);await assertDock('b','op','b');
      await change('select[aria-label="A · first vector"]','a');await assertDock('a','op','a');
    }
    await click('#close-inputs');await click('#arrange-fit');
    await page.send('Page.captureScreenshot',{format:'png'}).then(shot=>fs.writeFileSync('/tmp/playground-docked-inputs.png',Buffer.from(shot.data,'base64')));
    // Shared source docks once and still feeds both operations.
    const shared=fixture('add');shared.name='Shared input';shared.nodes[0].minimized=true;
    shared.nodes.push({id:'scale',type:'scale',label:'Scale',params:{factor:'2'},position:{x:800,y:80}});shared.edges.push({from:'a',to:'scale'});
    await upload(shared);await assertDock('a','op','a');await select('scale');near(await output(),[[2],[4],[6]]);
    await select('op');await change('select[aria-label="A · first vector"]','');await assertDock('a','scale','input');
    assert.equal(await run('document.querySelectorAll("article[data-node-id=a]").length'),1);
    assert.deepEqual(page.errors,[]);
    console.log('PASS: input docking for add/subtract/scale, port alignment, editing, shared sources, dragging, undo/redo, arrange/fit, restore, disconnect/reconnect and reload.');
  } finally {
    if(context)await browser.send('Target.disposeBrowserContext',{browserContextId:context});
    page?.close();browser.close();
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
