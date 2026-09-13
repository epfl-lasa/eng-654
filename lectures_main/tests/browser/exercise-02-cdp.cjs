/* Local Chromium CDP helpers; no browser package dependency. */
const fs=require('node:fs');
async function connect(){
 const pages=await(await fetch(`http://127.0.0.1:${process.env.EXERCISE02_CDP_PORT || '9256'}/json`)).json();
 const ws=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));let n=0;const pending=new Map(),errors=[],requests=[];
 const send=(method,params={})=>new Promise((resolve,reject)=>{pending.set(++n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}));});
 ws.addEventListener('message',e=>{const d=JSON.parse(e.data);if(d.id){const p=pending.get(d.id);pending.delete(d.id);d.error?p.reject(d.error):p.resolve(d.result);}if(d.method==='Runtime.exceptionThrown')errors.push(d.params.exceptionDetails);if(d.method==='Network.requestWillBeSent')requests.push(d.params.request.url);});
 const run=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 const wait=ms=>new Promise(r=>setTimeout(r,ms));
 const locate=selector=>run(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing '+${JSON.stringify(selector)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2};})()`);
 const click=async selector=>{const p=await locate(selector);await send('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',clickCount:1});await wait(60);};
 const input=async(selector,value,event='input')=>run(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event(${JSON.stringify(event)},{bubbles:true}));})()`);
 const snapshot=()=>run('Exercise02App.snapshot()');
 const screenshot=async path=>{const r=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path,Buffer.from(r.data,'base64'));};
 const ready=async()=>{for(let i=0;i<100;i++){if(await run('Boolean(window.Exercise02App)'))return;await wait(100);}throw Error('Exercise not ready: '+await run('document.querySelector("#file-status")?.textContent'));};
 await send('Runtime.enable');await send('Page.enable');await send('Network.enable');
 return{ws,send,run,wait,locate,click,input,snapshot,screenshot,ready,errors,requests};
}
module.exports=connect;
