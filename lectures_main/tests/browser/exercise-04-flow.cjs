/* Exercise 04 integration regression. Uses a disposable browser context.
 * Requires the local preview server and Chromium CDP. No npm dependencies.
 * CDP_URL, EXERCISE04_URL and SCREENSHOT_DIR override local defaults.
 * EXERCISE04_DOWNLOAD_ROOT selects a directory accessible to sandboxed Chromium.
 */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const CDP_URL=process.env.CDP_URL||'http://127.0.0.1:9256';
const PAGE_URL=process.env.EXERCISE04_URL||'http://127.0.0.1:8052/exercises/exercise_04.html';
const instructorPath=path.resolve('lectures_main/solutions/exercise_04_answers.json');
const instructor=JSON.parse(fs.readFileSync(instructorPath,'utf8')),startAngle=Number(instructor.answers['iiwa.0.1']),secondAngle=Number(instructor.answers['iiwa.0.2']);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
 const version=await(await fetch(CDP_URL+'/json/version')).json(),ws=new WebSocket(version.webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
 let serial=0,sessionId,contextId;const pending=new Map(),errors=[],httpErrors=[],requests=[],downloads=[];
 ws.addEventListener('message',event=>{const msg=JSON.parse(event.data);if(msg.id){const job=pending.get(msg.id);if(job){pending.delete(msg.id);clearTimeout(job.timer);msg.error?job.reject(new Error(JSON.stringify(msg.error))):job.resolve(msg.result);}}if(msg.method==='Browser.downloadWillBegin')downloads.push(msg.params);if(msg.sessionId!==sessionId)return;if(msg.method==='Runtime.exceptionThrown')errors.push(msg.params.exceptionDetails);if(msg.method==='Runtime.consoleAPICalled'&&msg.params.type==='error')errors.push(msg.params.args.map(x=>x.value||x.description));if(msg.method==='Network.requestWillBeSent')requests.push(msg.params.request.url);if(msg.method==='Network.responseReceived'&&msg.params.response.status>=400&&!(msg.params.response.status===404&&new URL(msg.params.response.url).pathname==='/favicon.ico'))httpErrors.push([msg.params.response.status,msg.params.response.url]);});
 const send=(method,params={},session=sessionId)=>new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(new Error('CDP timeout: '+method));},60000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params,...(session?{sessionId:session}:{})}));});
 const run=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 const until=async(expression,ms=120000)=>{const deadline=Date.now()+ms;do{if(errors.length)throw new Error(JSON.stringify(errors));if(await run(expression))return;await sleep(100);}while(Date.now()<deadline);throw new Error('Timeout: '+expression+'\n'+JSON.stringify(await run('({body:document.body.dataset,status:document.querySelector("#file-status")?.textContent,iiwa:document.querySelector("#iiwa-status")?.textContent,crb:document.querySelector("#crb-status")?.textContent})')));};
 const click=selector=>run(`document.querySelector(${JSON.stringify(selector)}).click()`);
 const value=(selector,value,event='input')=>run(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(String(value))};e.dispatchEvent(new Event(${JSON.stringify(event)},{bubbles:true}));})()`);
 const idle=()=>until('document.body.dataset.busy==="false"');
 const text=selector=>run(`document.querySelector(${JSON.stringify(selector)}).textContent`);
 const shot=async name=>{if(!process.env.SCREENSHOT_DIR)return;fs.mkdirSync(process.env.SCREENSHOT_DIR,{recursive:true});const r=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(process.env.SCREENSHOT_DIR,name+'.png'),Buffer.from(r.data,'base64'));};
 const pointerClick=async selector=>{await scroll(selector);const p=await run(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),b=e.getBoundingClientRect();return{x:b.x+b.width/2,y:b.y+b.height/2}})()`);await send('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',clickCount:1});};
 const scroll=async selector=>{await run(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);await sleep(250);};
 const layout=()=>run(`(()=>({width:innerWidth,documentWidth:document.documentElement.scrollWidth,bodyWidth:document.body.scrollWidth,overflow:[...document.querySelectorAll('.slide p,.slide h1,.slide h2,.slide button,.slide select,.slide input,.answer-toolbar')].filter(e=>{const r=e.getBoundingClientRect();if(!r.width)return false;let clipped=false;for(let p=e.parentElement;p&&p!==document.body;p=p.parentElement){const c=getComputedStyle(p);if(['auto','scroll','hidden'].includes(c.overflowX)&&p.scrollWidth>p.clientWidth+1){clipped=true;break;}}return !clipped&&(r.left < -2||r.right > innerWidth+2)}).map(e=>({text:e.textContent.slice(0,70),tag:e.tagName,rect:{x:e.getBoundingClientRect().x,right:e.getBoundingClientRect().right}}))}))()`);
 try{
  ({browserContextId:contextId}=await send('Target.createBrowserContext',{},null));const target=await send('Target.createTarget',{url:'about:blank',browserContextId:contextId},null);({sessionId}=await send('Target.attachToTarget',{targetId:target.targetId,flatten:true},null));
  await send('Runtime.enable');await send('Page.enable');await send('Network.enable');await send('Network.setCacheDisabled',{cacheDisabled:true});await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  const downloadDir=fs.mkdtempSync(path.join(process.env.EXERCISE04_DOWNLOAD_ROOT||'/tmp','exercise04-browser-download-'));await send('Browser.setDownloadBehavior',{behavior:'allow',browserContextId:contextId,downloadPath:downloadDir,eventsEnabled:true},null);
  await send('Page.navigate',{url:PAGE_URL});await until('document.body?.dataset.ready==="true"');await idle();
  if(process.env.EXERCISE04_FOCUS==='defaults'){
   const blank=()=>run('[...document.querySelectorAll("#iiwa-answer-rows select")].every(input=>input.value==="")');
   const choices=()=>run('[...document.querySelectorAll("#iiwa-answer-rows select")].map(input=>input.value)');
   assert.equal(await run('document.querySelectorAll("#iiwa-answer-rows select").length'),16);
   assert.equal(await blank(),true);assert.equal(await run('document.querySelector("#restore-iiwa-choices").hidden'),true);
   await value('[data-answer="iiwa.0.1"]',-80);await value('[data-answer="iiwa.0.2"]',0);await value('[data-answer="iiwa.1.1"]',120);
   await value('[data-answer="crb.explanation"]','Retain independent responses.');
   await send('Page.reload',{ignoreCache:true});await until('document.body?.dataset.ready==="true"');await idle();
   assert.equal(await blank(),true);assert.equal(await run('document.querySelector("#restore-iiwa-choices").hidden'),false);
   assert.equal(await run('document.querySelector("[data-answer=\\"crb.explanation\\"]").value'),'Retain independent responses.');
   await value('[data-answer="crb.explanation"]','An unrelated edit must preserve the saved angles.');
   let stored=JSON.parse(await run('localStorage.getItem("eng654-exercise04-v1")'));
   assert.equal(stored.answers['iiwa.0.1'],'-80');assert.equal(stored.answers['iiwa.0.2'],'0');assert.equal(stored.answers['iiwa.1.1'],'120');
   await value('[data-answer="iiwa.0.1"]',80);await value('[data-answer="iiwa.1.1"]','');
   await run('(()=>{const original=URL.createObjectURL;URL.createObjectURL=function(blob){window.__responseDownload=blob.text();return original.call(this,blob);};})()');
   await click('#download-responses');const active=JSON.parse(await run('window.__responseDownload'));
   assert.equal(active.answers['iiwa.0.1'],'80');assert.equal(active.answers['iiwa.0.2'],'');
   await click('#restore-iiwa-choices');
   assert.deepEqual((await choices()).slice(0,4),['80','0','','']);assert.equal(await run('document.querySelector("#restore-iiwa-choices").hidden'),true);
   await send('Page.reload',{ignoreCache:true});await until('document.body?.dataset.ready==="true"');await idle();assert.equal(await blank(),true);
   stored=JSON.parse(await run('localStorage.getItem("eng654-exercise04-v1")'));
   assert.equal(stored.answers['iiwa.0.1'],'80');assert.equal(stored.answers['iiwa.0.2'],'0');assert.equal(stored.answers['iiwa.1.1'],'');
   const file=path.join(downloadDir,'explicit-responses.json');fs.writeFileSync(file,JSON.stringify(stored));
   const doc=await send('DOM.getDocument'),input=await send('DOM.querySelector',{nodeId:doc.root.nodeId,selector:'#load-responses'});
   await send('DOM.setFileInputFiles',{nodeId:input.nodeId,files:[file]});await until('document.querySelector("#file-status").textContent.includes("Responses loaded")');
   assert.deepEqual((await choices()).slice(0,4),['80','0','','']);assert.equal(await run('document.querySelector("#restore-iiwa-choices").hidden'),true);
   await scroll('#iiwa-answer-rows');await shot('explicit-restored-choices');
   assert.deepEqual(errors,[]);assert.deepEqual(httpErrors,[]);
   console.log('PASS: all16 Step04 choices start blank, saved angles survive unrelated edits, restoration is explicit, and uploads remain supported.');
   return;
  }
  if(process.env.EXERCISE04_FOCUS==='iiwa'){
   assert.equal(await run('document.body.dataset.planningRevision'),'iiwa-redundant-graph-v3');
   assert.match(await text('#iiwa-method-description'),/q3 may change/);
   assert.match(await text('#iiwa-method-description'),/either planner completes/);
   for(const angle of [-80,80]){
    await value('#iiwa-branch',0,'change');await value('#iiwa-angle',angle,'change');
    await click('#iiwa-build');await idle();
    assert.equal(await run('document.querySelector("#iiwa-scene").dataset.accepted'),'true');
    assert.match(await text('#iiwa-status'),/Analytical: complete\. Numerical: complete\./);
    for(const method of ['analytical','numerical']){
     await value('#iiwa-method',method,'change');
     assert.equal(await run('document.querySelectorAll("#iiwa-feasibility-maps path").length'),0);
     const initial=JSON.parse(await run('document.querySelector("#iiwa-scene").dataset.configuration'));
     await value('#iiwa-playback [data-scrub]',1);
     assert.equal(await run('document.querySelector("#iiwa-playback").dataset.progress'),'1');
     const final=JSON.parse(await run('document.querySelector("#iiwa-scene").dataset.configuration'));
     assert.ok(Math.abs(final[2]-initial[2])>.01,'The selected q3 fixes the start, and can change along the completed path.');
    }
   }
   await value('[data-answer="iiwa.0.1"]',-80);await value('[data-answer="iiwa.0.2"]',80);
   await click('[data-check-set="0"]');await idle();
   assert.match(await text('#iiwa-answer-status'),/2 \/ 2 choices complete with at least one planner/);
   assert.equal(await run('document.querySelectorAll("[data-set=\\"0\\"] [data-state=correct]").length'),2);
   await value('[data-answer="iiwa.4.1"]',0);await value('[data-answer="iiwa.4.2"]',-20);
   await click('[data-check-set="4"]');await idle();
   assert.equal(await run('document.querySelectorAll("[data-set=\\"4\\"] [data-state=correct]").length'),2);
   for(const n of [1,2]){
    const feedback=await text(`[data-answer-wrap="iiwa.4.${n}"] .ex04-feedback`);
    assert.match(feedback,/Analytical: complete/);assert.match(feedback,/Numerical: joint-limit/);
   }
   await run(`(()=>{const original=URL.createObjectURL;URL.createObjectURL=function(blob){window.__responseDownload=blob.text();return original.call(this,blob);};})()`);
   await click('#download-responses');
   const saved=JSON.parse(await run('window.__responseDownload'));
   assert.equal(saved.planningRevision,'iiwa-redundant-graph-v3');assert.equal(saved.pathRevision,'iiwa-circle-v2');
   assert.equal(saved.answers['iiwa.0.1'],'-80');assert.equal(saved.answers['iiwa.0.2'],'80');
   assert.deepEqual(errors,[]);assert.deepEqual(httpErrors,[]);
   console.log('PASS: Exercise 04 analytical redundancy connections, both playback methods, Step 04 grading and saved planning revision.');
   return;
  }
  assert.equal(await run('document.body.dataset.mapReady'),'true');
  assert.equal(await run('document.body.dataset.pathRevision'),'iiwa-circle-v2');
  assert.equal(await run('document.body.dataset.planningRevision'),'iiwa-redundant-graph-v3');
  assert.equal(await run('document.querySelector("#iiwa-angle").value'),'');
  assert.equal(await run('document.querySelectorAll("[data-selected-start]").length'),0);
  assert.equal(await run('document.querySelectorAll("[data-feasibility-map]").length'),1);
  assert.equal(await run('document.querySelectorAll("[data-map-k]").length'),121*35);
  assert.equal(await run('document.querySelectorAll("[data-quiz-question]").length'),15);
  assert.equal(await run('document.querySelectorAll("[data-quiz-question][data-state]").length'),0);
  assert.equal(await run('document.querySelectorAll("[data-quiz-answer]").length'),60);
  assert.equal(await run('document.querySelector("#crb-scene").dataset.meshCount'),'7');
  assert.equal(await run('document.querySelector("#iiwa-scene").dataset.meshCount'),'8');
  assert.equal(await run('document.querySelector("#crb-scene").dataset.completeCount'),'3');
  assert.equal(await run('document.querySelectorAll("#crb-branches button").length'),8);
  assert.equal(await run('document.querySelectorAll("#crb-branches button.complete").length'),3);
  await scroll('#crb-scene');await shot('crb-default-1440');
  await click('#crb-all');assert.equal(await run('document.querySelector("#crb-scene").dataset.visibleIks'),'8');await shot('crb-all-starts-1440');await click('#crb-all');assert.equal(await run('document.querySelector("#crb-scene").dataset.visibleIks'),'0');
  await click('#crb-branches [data-branch="1"]');assert.equal(await run('document.querySelector("#crb-scene").dataset.complete'),'true');
  const initialQ=await run('document.querySelector("#crb-scene").dataset.q');await click('#crb-playback [data-play]');await until('Number(document.querySelector("#crb-playback").dataset.frame)>5');await click('#crb-playback [data-play]');const paused=await run('document.querySelector("#crb-playback").dataset.frame');await sleep(180);assert.equal(await run('document.querySelector("#crb-playback").dataset.frame'),paused);assert.notEqual(await run('document.querySelector("#crb-scene").dataset.q'),initialQ);
  await value('#crb-playback [data-scrub]',1);assert.equal(await text('#crb-playback [data-play]'),'Replay');await click('#crb-playback [data-play]');await until('Number(document.querySelector("#crb-playback").dataset.frame)>1&&Number(document.querySelector("#crb-playback").dataset.frame)<30');await click('#crb-playback [data-reset]');assert.equal(await run('document.querySelector("#crb-playback").dataset.frame'),'0');
  await click('#crb-branches [data-branch="0"]');await value('#crb-playback [data-scrub]',1);assert.ok(Number(await run('document.querySelector("#crb-playback").dataset.progress'))<.22);assert.match(await text('#crb-status'),/q2 = 180/);
  console.log('CRB default, all-start overlays, branch choice, real joint stop, playback, replay and reset passed.');
  for(const [i,z]of [.35,.40,.45].entries())await value(`[data-answer="crb.height.${i+1}"]`,z);
  await click('#check-heights');await idle();assert.match(await text('#height-status'),/3 \/ 3/);assert.equal(await run('document.querySelectorAll(".ex04-height-answer[data-state=correct]").length'),3);
  await value('#crb-height',.45);await click('#crb-build');await idle();assert.equal(await run('document.querySelector("#crb-scene").dataset.completeCount'),'8');await scroll('#crb-scene');await shot('crb-eight-complete-1440');
  await click('#crb-default');await idle();assert.equal(await run('document.querySelector("#crb-scene").dataset.completeCount'),'3');
  await scroll('#iiwa-feasibility-maps');await shot('iiwa-full-map-1440');
  const mapTruth=await run(`(async()=>{const m=await import('../js/exercises/exercise-04-iiwa-model.js'),map=await m.buildFeasibilityMap();window.__mapTruth=map;return{samples:map.samples.length,angles:map.angles.map(a=>Math.round(a*180/Math.PI)),kind:map.spec.kind}})()`);
  assert.equal(mapTruth.kind,'circle');assert.equal(mapTruth.samples,121);assert.deepEqual(mapTruth.angles,Array.from({length:35},(_,i)=>-170+i*10));
  const row=mapTruth.angles.indexOf(startAngle);
  assert.ok(row>=0);await pointerClick(`[data-feasibility-map="0"] [data-map-k="0"][data-map-row="${row}"]`);
  assert.equal(await run('document.querySelector("#iiwa-angle").value'),String(startAngle));
  assert.equal(await run('document.querySelectorAll("[data-selected-start]").length'),1);
  assert.equal(await run('document.querySelector("#iiwa-playback [data-play]").disabled'),true);
  await pointerClick('[data-feasibility-map="0"] [data-map-k="60"][data-map-row="20"]');
  assert.equal(await run('document.querySelector("#iiwa-angle").value'),String(startAngle));
  assert.equal(await run('document.querySelector("#iiwa-feasibility-maps").dataset.inspectedSample'),'60');
  await click('#iiwa-show-all-maps');assert.equal(await run('document.querySelectorAll("[data-feasibility-map]").length'),8);
  assert.equal(await run('document.querySelectorAll("[data-map-k]").length'),121*35*8);
  const truthErrors=await run(`(()=>{const errors=[];for(let b=0;b<8;b++)for(const k of [0,17,60,99,120])for(const row of [0,3,13,17,24,34]){const el=document.querySelector('[data-feasibility-map="'+b+'"] [data-map-k="'+k+'"][data-map-row="'+row+'"]'),valid=!!window.__mapTruth.cells[k][row][b]?.valid;if(el.dataset.valid!==String(valid)||el.getAttribute('fill')!==(valid?'#39834d':'#c3c6c8'))errors.push({b,k,row,valid});}return errors})()`);assert.deepEqual(truthErrors,[]);
  await pointerClick('[data-feasibility-map="0"] [data-map-k="1"][data-map-row="20"]');
  assert.equal(await run('document.querySelector("#iiwa-feasibility-maps").dataset.inspectedSample'),'1');
  assert.equal(await run('document.querySelector("#iiwa-angle").value'),String(startAngle));
  await shot('iiwa-all-eight-maps-1440');await click('#iiwa-show-all-maps');
  assert.equal(await run('document.querySelectorAll("#iiwa-feasibility-maps path").length'),0);
  await click('#iiwa-build');await idle();assert.equal(await run('document.querySelector("#iiwa-scene").dataset.accepted'),'true');assert.match(await text('#iiwa-status'),/Analytical: complete\. Numerical: complete\./);
  for(const method of ['analytical','numerical']){await value('#iiwa-method',method,'change');assert.equal(await run('document.querySelectorAll("#iiwa-feasibility-maps path").length'),0);assert.equal(await run('document.querySelector("#iiwa-plot").dataset.followedSamples'),'1');assert.equal(await run('document.querySelectorAll("#iiwa-plot [data-path=followed]").length'),0);await click('#iiwa-playback [data-play]');await until('Number(document.querySelector("#iiwa-playback").dataset.frame)>2');await value('#iiwa-playback [data-scrub]',1);assert.equal(await run('document.querySelector("#iiwa-playback").dataset.progress'),'1');assert.equal(await text('#iiwa-playback [data-play]'),'Replay');await click('#iiwa-playback [data-play]');await until('Number(document.querySelector("#iiwa-playback").dataset.frame)>1&&Number(document.querySelector("#iiwa-playback").dataset.progress)<.2');await click('#iiwa-playback [data-reset]');assert.equal(await run('document.querySelector("#iiwa-playback").dataset.frame'),'0');}
  await scroll('#iiwa-scene');await shot('iiwa-valid-1440');await value('#iiwa-angle',0,'change');await click('#iiwa-build');await idle();assert.equal(await run('document.querySelector("#iiwa-scene").dataset.accepted'),'false');assert.equal(await run('document.querySelector("#iiwa-playback [data-play]").disabled'),true);await shot('iiwa-invalid-1440');
  await value('#iiwa-branch',6,'change');await value('#iiwa-angle',-150,'change');
  assert.match(await text('#iiwa-status'),/starting IK is legal/);await click('#iiwa-build');await idle();await value('#iiwa-method','numerical','change');
  assert.equal(await run('document.querySelector("#iiwa-playback [data-play]").disabled'),false);
  assert.equal(await run('document.querySelector("#iiwa-plot").dataset.followedSamples'),'1');
  assert.equal(await run('document.querySelectorAll("#iiwa-feasibility-maps path").length'),0);
  await value('#iiwa-playback [data-scrub]',1);
  const stopProgress=Number(await run('document.querySelector("#iiwa-playback").dataset.progress'));assert.ok(stopProgress>.035&&stopProgress<.05,stopProgress);
  assert.match(await text('#iiwa-status'),/Numerical: joint-limit/);assert.equal(await text('#iiwa-playback [data-play]'),'Replay');
  await click('#iiwa-playback [data-play]');await until('Number(document.querySelector("#iiwa-playback").dataset.frame)>0&&Number(document.querySelector("#iiwa-playback").dataset.progress)<.02');
  await click('#iiwa-playback [data-reset]');assert.equal(await run('document.querySelector("#iiwa-playback").dataset.frame'),'0');
  await scroll('#iiwa-scene');await shot('iiwa-legal-start-stops-1440');
  await value('[data-answer="iiwa.0.1"]',startAngle);await value('[data-answer="iiwa.0.2"]',secondAngle);await click('[data-check-set="0"]');await idle();assert.match(await text('#iiwa-answer-status'),/2 \/ 2/);
  await click('[data-quiz-answer="quiz.urdf"][value="axis-local"]');
  await click('[data-quiz-check="urdf"]');assert.equal(await run('document.querySelector("[data-quiz-question=urdf]").dataset.state'),'incorrect');
  await click('[data-quiz-answer="quiz.urdf"][value="visual-separate"]');
  assert.equal(await run('document.querySelector("[data-quiz-question=urdf]").dataset.state'),undefined);
  await click('[data-quiz-answer="quiz.urdf"][value="pose-units"]');await click('[data-quiz-check="urdf"]');
  assert.equal(await run('document.querySelector("[data-quiz-question=urdf]").dataset.state'),'correct');
  await value('[data-answer="crb.explanation"]','A local IK count cannot establish continuous joint-limit feasibility.');
  await run(`(()=>{const original=URL.createObjectURL;URL.createObjectURL=function(blob){window.__responseDownload=blob.text();return original.call(this,blob);};})()`);await click('#download-responses');const downloaded=JSON.parse(await run('window.__responseDownload'));for(let i=0;i<30&&!downloads.length;i++)await sleep(100);assert.equal(downloads.at(-1)?.suggestedFilename,'exercise_04_responses.json');assert.equal(downloaded.exercise,'exercise_04');assert.equal(downloaded.answers['crb.height.1'],'0.35');assert.equal(downloaded.answers['iiwa.0.1'],String(startAngle));assert.equal(downloaded.pathRevision,'iiwa-circle-v2');assert.equal(downloaded.planningRevision,'iiwa-redundant-graph-v3');assert.deepEqual(downloaded.answers['quiz.urdf'],['axis-local','visual-separate','pose-units']);
  await send('Page.reload',{ignoreCache:true});await until('document.body?.dataset.ready==="true"');await idle();assert.equal(await run('document.querySelector("[data-answer=\\"crb.height.1\\"]").value'),'0.35');assert.equal(await run('document.querySelector("[data-answer=\\"iiwa.0.1\\"]").value'),'');await click('#restore-iiwa-choices');assert.equal(await run('document.querySelector("[data-answer=\\"iiwa.0.1\\"]").value'),String(startAngle));
  await run(`(()=>{const old=JSON.parse(localStorage.getItem('eng654-exercise04-v1'));delete old.pathRevision;old.answers['iiwa.0.1']='-80';for(const key of Object.keys(old.answers))if(key.startsWith('quiz.'))delete old.answers[key];localStorage.setItem('eng654-exercise04-v1',JSON.stringify(old));})()`);
  await send('Page.reload',{ignoreCache:true});await until('document.body?.dataset.ready==="true"');await idle();
  assert.match(await text('#file-status'),/planning checks have changed/);
  assert.equal(await run('document.body.dataset.answersVerified'),undefined);
  assert.equal(await run('document.querySelectorAll("[data-answer-wrap][data-state],[data-quiz-question][data-state]").length'),0);
  assert.equal(await run('document.querySelectorAll("[data-quiz-answer]:checked").length'),0);
  assert.equal(await run('document.querySelector("[data-answer=\\"iiwa.0.1\\"]").value'),'');await click('#restore-iiwa-choices');
  await click('[data-check-set="0"]');await idle();assert.match(await text('#iiwa-answer-status'),/2 \/ 2/);
  assert.equal(await run(`document.querySelector('[data-answer-wrap="iiwa.0.1"]').dataset.state`),'correct');
  let solutionPath=path.resolve('lectures_main/solutions/exercise_04_answers.json');if(!fs.existsSync(solutionPath)){const iiwa=JSON.parse(fs.readFileSync('/tmp/exercise04-iiwa-solutions.json','utf8'));const answers={...downloaded.answers};[.35,.4,.45].forEach((z,i)=>answers[`crb.height.${i+1}`]=String(z));iiwa.answers.forEach((row,b)=>row.forEach((angle,i)=>answers[`iiwa.${b}.${i+1}`]=String(angle)));solutionPath='/tmp/exercise04-browser-instructor.json';fs.writeFileSync(solutionPath,JSON.stringify({...downloaded,answers}));}
  const doc=await send('DOM.getDocument');const fileNode=await send('DOM.querySelector',{nodeId:doc.root.nodeId,selector:'#load-responses'});await send('DOM.setFileInputFiles',{nodeId:fileNode.nodeId,files:[solutionPath]});await until('document.querySelector("#file-status").textContent.includes("Responses loaded")');assert.equal(await run('document.querySelector("[data-answer=\\"iiwa.7.2\\"]").value'),instructor.answers['iiwa.7.2']);assert.equal(await run('document.querySelectorAll("[data-quiz-question][data-state]").length'),0);await click('#check-all');await idle();assert.equal(await run('document.body.dataset.answersVerified'),'true');await scroll('#iiwa-answer-rows');await shot('all-answers-verified-1440');assert.equal(await run('document.querySelectorAll("[data-quiz-question][data-state=correct]").length'),15);assert.match(await text('#file-status'),/15 \/ 15 questions correct/);
  console.log('Three heights, two iiwa methods, invalid-start rejection, response download/persistence/import and all eight answer sets passed.');
  for(const [width,height]of [[1440,900],[1280,720],[800,900]]){await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await sleep(200);for(const section of ['#crb-scene','#iiwa-feasibility-maps','#iiwa-scene','#iiwa-answer-rows','#exercise04-quiz']){await scroll(section);const result=await layout();assert.ok(result.documentWidth<=width+2,JSON.stringify(result));assert.deepEqual(result.overflow,[],JSON.stringify(result));await shot(section.slice(1)+'-'+width);}}
  assert.equal(await run('[...document.querySelectorAll("a")].some(a=>/solutions|answers\\.json/.test(a.getAttribute("href")||""))'),false);
  assert.equal(requests.some(url=>/solutions\/exercise_04_answers\.json/.test(url)),false);assert.deepEqual(errors,[]);assert.deepEqual(httpErrors,[]);
  console.log('PASS: Exercise 04 browser flow, verified answers, native robot rendering and responsive layout.');
 }catch(error){console.error(error);console.error(await run('({error:document.body.dataset.error,status:document.querySelector("#file-status")?.textContent,crb:document.querySelector("#crb-status")?.textContent,iiwa:document.querySelector("#iiwa-status")?.textContent})').catch(()=>null));await shot('exercise04-failure');process.exitCode=1;}finally{if(contextId)await send('Target.disposeBrowserContext',{browserContextId:contextId},null).catch(()=>{});ws.close();}
})();
