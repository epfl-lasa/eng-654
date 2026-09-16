/* Compact playground regression. Uses a disposable Chromium context and the
 * repo-root preview; no browser profile or saved user work is modified.
 * COMPACT_BASE_URL, COMPACT_CDP_URL and COMPACT_SCREENSHOT_DIR override defaults.
 */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base=process.env.COMPACT_BASE_URL||'http://127.0.0.1:8062';
const cdp=process.env.COMPACT_CDP_URL||'http://127.0.0.1:9256';
const shots=process.env.COMPACT_SCREENSHOT_DIR||'/tmp/playground-compact';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function connect(url){
 const socket=new WebSocket(url),pending=new Map(),errors=[],events=[];let serial=0;
 await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
 socket.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(new Error(JSON.stringify(m.error))):p.resolve(m.result);}}else{events.push(m);if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')errors.push(m.params.args.map(x=>x.value||x.description));}});
 const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(new Error('CDP timeout: '+method));},30000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});
 return{send,errors,events,close:()=>socket.close()};
}
(async()=>{
 const info=await(await fetch(cdp+'/json/version')).json(),browser=await connect(info.webSocketDebuggerUrl);let context,page;
 try{
  context=(await browser.send('Target.createBrowserContext')).browserContextId;
  const target=await browser.send('Target.createTarget',{url:'about:blank',browserContextId:context});
  const targets=await(await fetch(cdp+'/json/list')).json();page=await connect(targets.find(t=>t.id===target.targetId).webSocketDebuggerUrl);
  const run=async expression=>{const r=await page.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  const until=async expression=>{for(let i=0;i<100;i++){if(page.errors.length)throw new Error(JSON.stringify(page.errors));if(await run(expression))return;await pause(100);}throw new Error('Not ready: '+expression);};
  const click=selector=>run(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const change=(selector,value,event='change')=>run(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(String(value))};e.dispatchEvent(new Event(${JSON.stringify(event)},{bubbles:true}));})()`);
  const state=()=>run('KinematicsPlayground.getState()');
  const select=id=>change('#block-picker',id);
  const node=async id=>(await state()).graph.nodes.find(n=>n.id===id);
  const output=()=>run('KinematicsPlayground.getOutput()?.matrix.map(row=>row.map(v=>KinematicsMath.evaluate(v,KinematicsPlayground.getState().graph.bindings)))');
  const add=async type=>{await click(`.palette-item[data-type="${type}"]`);return(await state()).selected;};
  const size=(axis,count)=>change(`input[aria-label="${axis==='rows'?'Rows (m)':'Columns (n)'}"]`,count);
  const cell=(r,c,value)=>change(`input[aria-label="Matrix row ${r} column ${c}"]`,value,'input');
  const capture=async name=>{fs.mkdirSync(shots,{recursive:true});await run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');const shot=await page.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(shots,name+'.png'),Buffer.from(shot.data,'base64'));};
  const collapsed=()=>run('document.querySelector(".output-panel").dataset.expanded==="false"');
  const near=(actual,expected)=>{assert.equal(actual.length,expected.length);actual.forEach((r,i)=>{assert.equal(r.length,expected[i].length);r.forEach((v,j)=>assert.ok(Math.abs(v-expected[i][j])<1e-10,`${i},${j}: ${v}`));});};
  const upload=async text=>{await run(`(()=>{const dt=new DataTransfer();dt.items.add(new File([${JSON.stringify(text)}],'operations.json',{type:'application/json'}));const input=document.querySelector('#graph-file');input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);await until('document.querySelector("#graph-file").value===""');};
  const wire=async(from,to,input='input')=>{await click(`article[data-node-id="${to}"] [data-port="input"][data-input="${input}"]`);await click(`article[data-node-id="${from}"] [data-port="output"]`);};
  await page.send('Runtime.enable');await page.send('Page.enable');await page.send('Network.enable');await page.send('Network.setCacheDisabled',{cacheDisabled:true});
  await page.send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await browser.send('Browser.setDownloadBehavior',{behavior:'allow',browserContextId:context,downloadPath:'/tmp/eng654-compact-downloads',eventsEnabled:true});
  await page.send('Page.navigate',{url:base+'/playground/building_blocks.html'});await until('!!window.KinematicsPlayground&&document.querySelector(".output-panel").dataset.expanded==="false"');
  const largeCanvas=await run('document.querySelector("#canvas").clientHeight');
  assert.equal(await run('document.querySelector("#output-content").hidden'),true);
  assert.ok(await run('document.querySelector(".output-panel").clientHeight')<=54);
  await click('#toggle-output');await until('document.querySelector(".output-panel").dataset.expanded==="true"');
  assert.equal(await run('document.querySelector("#output-content").hidden'),false);
  assert.ok(largeCanvas-(await run('document.querySelector("#canvas").clientHeight'))>120,'minimizing gives canvas more height');
  await click('#toggle-output');assert.equal(await collapsed(),true);
  await change('#example','empty');

  const column=await add('column-vector');let p=(await node(column)).params;
  assert.deepEqual([p.rows,p.columns,p.matrix],[3,1,['x','y','z']]);
  for(const [i,v]of [1,2,3].entries())await cell(i+1,1,v);
  await size('rows',4);assert.deepEqual((await node(column)).params.matrix,['1','2','3','0']);
  await click('[data-vector-orientation="row"]');p=(await node(column)).params;assert.deepEqual([p.rows,p.columns,p.matrix],[1,4,['1','2','3','0']]);
  await click('#undo');p=(await node(column)).params;assert.deepEqual([p.rows,p.columns],[4,1]);
  await size('rows',2);await click('#undo');assert.deepEqual((await node(column)).params.matrix,['1','2','3','0']);
  const row=await add('row-vector');p=(await node(row)).params;assert.deepEqual([p.rows,p.columns,p.matrix],[1,3,['x','y','z']]);
  for(const [i,v]of [4,5,6].entries())await cell(1,i+1,v);
  await click('[data-vector-orientation="column"]');near(await output(),[[4],[5],[6]]);
  await click('[data-vector-orientation="row"]');near(await output(),[[4,5,6]]);
  await size('columns',5);near(await output(),[[4,5,6,0,0]]);
  console.log('PASS: explicit row/column vectors, editable length, orientation preservation and undo.');

  const matrix=await add('matrix');await size('rows',2);await size('columns',3);
  for(const [r,c,v]of [[1,1,'a+sin(pi/2)'],[1,2,2],[1,3,3],[2,1,4],[2,2,5],[2,3,6]])await cell(r,c,v);
  await change('input[aria-label="Value of a"]',2,'input');near(await output(),[[3,2,3],[4,5,6]]);
  assert.equal(await run('document.querySelectorAll("[data-matrix-editor] input").length'),6);
  await size('columns',2);near(await output(),[[3,2],[4,5]]);await click('#undo');near(await output(),[[3,2,3],[4,5,6]]);
  await size('rows',3);await size('columns',4);near(await output(),[[3,2,3,0],[4,5,6,0],[0,0,0,0]]);
  await click('#undo');await click('#undo');near(await output(),[[3,2,3],[4,5,6]]);
  const beforeInvalid=(await node(matrix)).params;await size('rows',13);assert.deepEqual((await node(matrix)).params,beforeInvalid);assert.match(await run('document.querySelector("#toast").textContent'),/1 to 12/);
  await size('columns',2);
  const det=await add('determinant');await wire(matrix,det);near(await output(),[[7]]);
  await until('document.querySelector("#toggle-output").textContent==="Expand output"');
  await select(matrix);await size('columns',3);await select(det);
  await until('document.querySelector("#toggle-output").textContent==="Show error"');
  assert.equal(await run('KinematicsPlayground.getOutput()'),null);assert.match(await run('document.querySelector("#toggle-output").title'),/square/i);
  await capture('nonsquare-collapsed');await click('#toggle-output');assert.match(await run('document.querySelector("#output-content").textContent'),/square/i);assert.equal(await run('document.querySelector("#output-content").hidden'),false);await capture('nonsquare-expanded');await click('#toggle-output');
  await select(matrix);await size('columns',2);await select(det);near(await output(),[[7]]);
  await until('document.querySelector("#toggle-output").textContent==="Expand output"');
  const geometry=await run(`(()=>{const graph=KinematicsPlayground.getState().graph;return[...document.querySelectorAll('#connections .wire')].map(w=>{const a=graph.nodes.find(n=>n.id===w.dataset.from),b=graph.nodes.find(n=>n.id===w.dataset.to),ae=document.querySelector('[data-node-id="'+a.id+'"]'),be=document.querySelector('[data-node-id="'+b.id+'"]'),v=w.getAttribute('d').match(/-?[\\d.]+/g).map(Number);return{width:ae.offsetWidth,start:[v[0],v[1]],expected:[a.position.x+ae.offsetWidth,a.position.y+ae.offsetHeight/2],end:v.slice(-2),target:[b.position.x,b.position.y+be.offsetHeight/2]};});})()`);
  assert.ok(geometry.length);for(const g of geometry){assert.equal(g.width,196);assert.deepEqual(g.start,g.expected);assert.deepEqual(g.end,g.target);}
  await click('#fit');await capture('symbolic-square-determinant');
  console.log('PASS: m×n grid, symbolic entries, preserving resize/undo, square determinant and visible rectangular error, compact wire endpoints.');

  await click('#save-function');await change('#function-name','Editable determinant','input');await click('#function-submit');assert.equal((await state()).library.length,1);
  await run(`(()=>{const original=URL.createObjectURL;URL.createObjectURL=function(blob){window.__downloadedOperations=blob.text();return original.call(this,blob);};})()`);
  await click('#save');const savedText=await run('window.__downloadedOperations'),beforeSave=await state();
  assert.equal(JSON.parse(savedText).format,'kinematic-building-blocks');
  for(let i=0;i<30&&!browser.events.some(e=>e.method==='Browser.downloadWillBegin');i++)await pause(100);
  assert.ok(browser.events.some(e=>e.method==='Browser.downloadWillBegin'&&e.params.suggestedFilename==='kinematic-operations.json'));
  await change('#example','empty');await upload(savedText);const restored=await state();
  assert.deepEqual(restored.graph,beforeSave.graph);assert.deepEqual(restored.library,beforeSave.library);assert.equal(restored.selected,beforeSave.selected);near(await output(),[[7]]);
  await click('#toggle-output');await page.send('Page.reload');await pause(250);await until('!!window.KinematicsPlayground&&!!document.querySelector(".output-panel")?.dataset.expanded');assert.equal(await collapsed(),false,'expanded preference survives reload');
  await click('#toggle-output');assert.equal(await collapsed(),true);await select(matrix);await size('rows',12);await size('columns',12);
  assert.equal(await run('document.querySelectorAll("[data-matrix-editor] input").length'),144);await cell(12,12,'42');assert.equal((await node(matrix)).params.matrix.at(-1),'42');
  for(const [width,height]of [[1440,900],[1280,720],[800,900]]){
   await page.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await pause(180);await click('#fit');
   const layout=await run(`(()=>{const rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};return{width:innerWidth,height:innerHeight,docWidth:document.documentElement.scrollWidth,bodyHeight:document.body.scrollHeight,canvas:rect(document.querySelector('#canvas')),output:rect(document.querySelector('.output-panel')),inspector:rect(document.querySelector('.inspector')),toggle:rect(document.querySelector('#toggle-output')),grid:rect(document.querySelector('[data-matrix-editor]')),overflow:document.querySelector('[data-matrix-editor]').scrollWidth>document.querySelector('[data-matrix-editor]').clientWidth};})()`);
   assert.ok(layout.docWidth<=width+1,JSON.stringify(layout));assert.ok(layout.canvas.height>240);assert.ok(layout.output.bottom<=height+1,JSON.stringify(layout));assert.ok(layout.inspector.right<=width+1);assert.ok(layout.toggle.right<=layout.output.right+1);assert.ok(layout.grid.right<=layout.inspector.right+1);assert.equal(layout.overflow,true,'large editable matrix scrolls inside inspector');
   await capture('matrix-grid-'+width);await click('#toggle-output');await pause(100);const expanded=await run('document.querySelector(".output-panel").getBoundingClientRect().bottom');assert.ok(expanded<=height+1,'expanded output stays in viewport');await capture('expanded-output-'+width);await click('#toggle-output');
  }
  assert.deepEqual(page.errors,[]);const failures=page.events.filter(e=>e.method==='Network.responseReceived'&&e.params.response.status>=400);assert.deepEqual(failures,[]);
  console.log('PASS: saved operations roundtrip, output preference, 12×12 editor and 1440/1280/800 responsive layouts.');
 }catch(error){console.error(error);if(page){try{const r=await page.send('Page.captureScreenshot',{format:'png'});fs.mkdirSync(shots,{recursive:true});fs.writeFileSync(path.join(shots,'failure.png'),Buffer.from(r.data,'base64'));}catch{}}process.exitCode=1;}finally{if(context)await browser.send('Target.disposeBrowserContext',{browserContextId:context});page?.close();browser.close();}
})();
