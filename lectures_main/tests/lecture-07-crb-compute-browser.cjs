/* Run with the static lecture server and tools/serve-crb-ik.sh active.
 * Uses its own browser context; it does not alter existing tabs or saved paths. */
const assert=require('node:assert/strict');
const CDP=process.env.CDP_URL||'http://127.0.0.1:9256';
const URL=process.env.LECTURE_URL||'http://127.0.0.1:8052/lectures/lecture_07.html';
async function main(){
 const browser=await(await fetch(CDP+'/json/version')).json(),ws=new WebSocket(browser.webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
 let serial=0,sessionId,contextId;const pending=new Map();
 ws.addEventListener('message',event=>{const m=JSON.parse(event.data),job=pending.get(m.id);if(!job)return;clearTimeout(job.timer);pending.delete(m.id);m.error?job.reject(new Error(JSON.stringify(m.error))):job.resolve(m.result);});
 const send=(method,params={},session=sessionId)=>new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(new Error('CDP timeout: '+method));},120000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params,...(session?{sessionId:session}:{})}));});
 const run=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 try{
  ({browserContextId:contextId}=await send('Target.createBrowserContext',{},null));
  const {targetId}=await send('Target.createTarget',{url:'about:blank',browserContextId:contextId},null);
  ({sessionId}=await send('Target.attachToTarget',{targetId,flatten:true},null));
  await send('Runtime.enable');await send('Page.enable');await send('Page.navigate',{url:URL});
  for(let i=0;i<100;i++){if(await run('document.readyState === "complete"'))break;await new Promise(r=>setTimeout(r,100));}
  const result=await run(`(async()=>{
   const {computeSlice}=await import('../js/viz/abbCrbCompute.js'),{orientationZYX}=await import('../js/viz/abbCrbSlice.js');
   const slice={plane:'xy',nx:20,ny:20,xmin:.2,xmax:.6,ymin:-.2,ymax:.2,z:.2,orientation:orientationZYX([.3,1.1,.4]),orientationEulerZYX:[.3,1.1,.4]};
   const rustProgress=[],jsProgress=[];
   const native=await computeSlice(slice,p=>rustProgress.push(p.done));
   const js=await computeSlice(slice,p=>jsProgress.push(p.done),{backend:'javascript-workers',maxWorkers:3});
   const offline=await computeSlice({...slice,nx:4,ny:4},()=>{},{nativeUrl:'http://127.0.0.1:8744',maxWorkers:2});
   const aborts=[];
   for(const backend of ['rust-native','javascript-workers']){
    const controller=new AbortController();let callbacks=0,error;
    try{await computeSlice({...slice,nx:400,ny:250},p=>{callbacks++;if(p.done>0)controller.abort();},{backend,signal:controller.signal,maxWorkers:2});}catch(e){error=e.name;}
    const atAbort=callbacks;await new Promise(r=>setTimeout(r,250));aborts.push({backend,error,callbacks,atAbort});
   }
   const badController=new AbortController();badController.abort();let beforeStart;
   try{await computeSlice(slice,null,{signal:badController.signal});}catch(e){beforeStart=e.name;}
   return {native:{backend:native.backend,workers:native.workers,seconds:native.wallSeconds,unresolved:native.unresolved},js:{backend:js.backend,workers:js.workers,seconds:js.wallSeconds,unresolved:js.unresolved},
    equal:JSON.stringify(native.counts)===JSON.stringify(js.counts)&&JSON.stringify(native.limitCounts)===JSON.stringify(js.limitCounts),rustProgress,jsProgress,offline:{backend:offline.backend,workers:offline.workers},aborts,beforeStart};
  })()`);
  assert.equal(result.native.backend,'rust-native');assert.equal(result.js.backend,'javascript-workers');
  assert.ok(result.native.workers>=1&&result.native.workers<=16);assert.ok(result.js.workers>=1&&result.js.workers<=3);
  assert.equal(result.equal,true);assert.equal(result.native.unresolved,0);assert.equal(result.js.unresolved,0);
  assert.equal(result.offline.backend,'javascript-workers');assert.ok(result.offline.workers<=2);
  for(const values of [result.rustProgress,result.jsProgress]){assert.equal(values[0],0);assert.equal(values.at(-1),400);assert.ok(values.length>=2);assert.ok(values.every((v,i)=>!i||v>=values[i-1]));}
  for(const abort of result.aborts){assert.equal(abort.error,'AbortError');assert.equal(abort.callbacks,abort.atAbort);}
  assert.equal(result.beforeStart,'AbortError');console.log('PASS',JSON.stringify(result));
  if(process.env.FULL_NATIVE){
   const benchmark=await run(`(async()=>{
    const atlas=await(await fetch('../assets/data/lecture07/crb-slice-xy-diverse.json')).json(),{computeSlice}=await import('../js/viz/abbCrbCompute.js');
    const {plane,nx,ny,xmin,xmax,ymin,ymax,z,orientation,orientationEulerZYX}=atlas;let updates=0;
    const result=await computeSlice({plane,nx,ny,xmin,xmax,ymin,ymax,z,orientation,orientationEulerZYX},()=>updates++,{backend:'rust-native'});
    const mismatches=result.counts.map((v,i)=>v!==atlas.counts[i]||result.limitCounts[i]!==atlas.limitCounts[i]?i:null).filter(i=>i!==null);
    return {poses:result.counts.length,backend:result.backend,workers:result.workers,nativeSeconds:result.elapsedSeconds,wallSeconds:result.wallSeconds,recoverySeconds:result.recoverySeconds,nativeUnresolved:result.nativeUnresolved,recoveredPoses:result.recoveredPoses,unresolved:result.unresolved,maxFkError:result.maxFkError,updates,mismatches};
   })()`);
   assert.equal(benchmark.poses,100000);assert.deepEqual(benchmark.mismatches,[]);assert.equal(benchmark.unresolved,0);
   require('node:fs').writeFileSync('/tmp/crb-native-benchmark-xy.json',JSON.stringify(benchmark,null,2));
   console.log('FULL NATIVE BENCHMARK',JSON.stringify(benchmark));
  }
 }finally{if(contextId)await send('Target.disposeBrowserContext',{browserContextId:contextId},null).catch(()=>{});for(const p of pending.values())clearTimeout(p.timer);ws.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
