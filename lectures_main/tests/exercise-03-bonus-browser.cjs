/* Exercise 03 bonus persistence, using a disposable browser context. */
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
(async()=>{
 const {chromium}=require(process.env.PLAYWRIGHT_PATH||'/home/durghy/Downloads/playcanvas-kuka-physics-ab-v6/node_modules/playwright');
 const browser=await chromium.connectOverCDP(process.env.CDP_URL||'http://127.0.0.1:9256');
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'exercise03-bonus-'));
 const key=JSON.parse(fs.readFileSync('lectures_main/solutions/exercise_03_answers.json'));
 const matrix=page.locator('[data-answer^="bonus.J."]'),derivation=page.locator('[data-answer="bonus.crb-jacobian"]');
 const determinant=page.locator('[data-answer="bonus.determinant"]');
 const values=()=>matrix.evaluateAll(fields=>fields.map(field=>field.value));
 const documentValue=()=>page.evaluate(()=>window.Exercise03.document());
 const upload=async(name,value)=>{const file=path.join(directory,name);fs.writeFileSync(file,JSON.stringify(value));await page.locator('#load-responses').setInputFiles(file);await page.waitForFunction(()=>document.querySelector('#file-status').textContent.startsWith('Responses loaded'));};
 page.on('pageerror',error=>errors.push(error.message));
 try{
  await page.goto(process.env.EXERCISE03_URL||'http://127.0.0.1:8052/exercises/exercise_03.html');
  await page.waitForSelector('body[data-exercise-ready=true]');
  assert.equal(await matrix.count(),36);
  assert.equal(await determinant.inputValue(),'');
  assert.deepEqual(await values(),Array(36).fill(''));
  assert.equal(await page.locator('[data-answer^="J."]').count(),18);
  for(let r=1;r<=6;r++)for(let c=1;c<=6;c++){
   const label=await page.locator(`[data-answer="bonus.J.${r}.${c}"]`).getAttribute('aria-label');
   assert.match(label,new RegExp(`row ${r} .*column ${c} \\(joint ${c}\\)`));
  }
  await matrix.nth(0).fill('a2*cos(q3)+a3');await matrix.nth(35).fill('-c4*s5');
  const text='My point shift is from the tool to O4. '+('Both velocity blocks are then expressed along the axes of frame 3. ').repeat(10);
  await determinant.fill('-a2*(E*R*s5+a5*C)');await derivation.fill(text);await page.locator('#record-bonus').click();
  assert.equal(await matrix.nth(0).getAttribute('data-result'),'review');
  assert.equal(await matrix.nth(1).getAttribute('data-result'),null);
  assert.equal(await derivation.getAttribute('data-result'),'review');
  assert.equal(await determinant.getAttribute('data-result'),'review');
  assert.match(await page.locator('#bonus-status').textContent(),/determinant included/);
  assert.match(await page.locator('#bonus-status').textContent(),/2\/36.*instructor review/);
  await page.reload();await page.waitForSelector('body[data-exercise-ready=true]');
  assert.equal(await matrix.nth(0).inputValue(),'a2*cos(q3)+a3');assert.equal(await matrix.nth(35).inputValue(),'-c4*s5');assert.equal(await derivation.inputValue(),text);
  assert.equal(await determinant.inputValue(),'-a2*(E*R*s5+a5*C)');
  // CDP can attach to a browser with an isolated download filesystem; inspect the
  // actual response Blob while still asserting that the download event fires.
  await page.evaluate(()=>{const create=URL.createObjectURL;URL.createObjectURL=function(blob){window.bonusDownload=blob.text();return create.call(this,blob);};});
  const downloadEvent=page.waitForEvent('download');await page.locator('#download-responses').click();const download=await downloadEvent;
  assert.equal(download.suggestedFilename(),'exercise_03_responses.json');
  const exported=JSON.parse(await page.evaluate(()=>window.bonusDownload));assert.equal(exported.answers['bonus.J.1.1'],'a2*cos(q3)+a3');assert.equal(exported.answers['bonus.J.6.6'],'-c4*s5');assert.equal(exported.answers['bonus.crb-jacobian'],text);
  assert.equal(exported.answers['bonus.determinant'],'-a2*(E*R*s5+a5*C)');
  await matrix.nth(0).fill('changed');await upload('responses.json',exported);assert.equal(await matrix.nth(0).inputValue(),'a2*cos(q3)+a3');
  await upload('key.json',key);assert.deepEqual(await values(),key.reference.bonus.matrixExpressions.flat());
  assert.equal(await determinant.inputValue(),key.answers['bonus.determinant']);
  assert.match(await page.locator('#progress').textContent(),/6\/6/);
  assert.equal(await page.locator('[data-answer^="bonus.J."][data-result="review"]').count(),36);
  assert.equal(await page.locator('[data-stage="bonus"] [data-result="correct"]').count(),0);
  const before=await documentValue();
  const invalid=await page.evaluate(()=>{const value=window.Exercise03.document();value.answers['bonus.J.1.1']='x'.repeat(501);try{window.Exercise03.importDocument(value);return false;}catch{return true;}});
  assert.equal(invalid,true);assert.deepEqual(await documentValue(),before);
  const legacy=structuredClone(key);delete legacy.answers['bonus.determinant'];for(const name of Object.keys(legacy.answers))if(name.startsWith('bonus.J.'))delete legacy.answers[name];
  await upload('legacy.json',legacy);assert.deepEqual(await values(),Array(36).fill(''));assert.equal(await derivation.inputValue(),legacy.answers['bonus.crb-jacobian']);assert.match(await page.locator('#progress').textContent(),/6\/6/);
  assert.equal(await determinant.inputValue(),'');
  for(const width of [1440,800,390]){
   await page.setViewportSize({width,height:1000});
   const bounds=await page.locator('#bonus-jacobian-inputs').evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth,right:el.getBoundingClientRect().right,viewport:innerWidth}));
   assert.ok(bounds.right<=bounds.viewport+2,`matrix container fits ${width}px screen`);
   if(width===390)assert.ok(bounds.scroll>bounds.width,'narrow screens scroll within the matrix');
  }
  await page.setViewportSize({width:1440,height:1300});await page.locator('[data-stage=bonus]').screenshot({path:'/tmp/exercise-03-bonus-matrix.png'});
  assert.deepEqual(errors,[]);
  console.log('PASS: 36 accessible blank cells; partial answers, determinant and derivation survive reload, download and upload; instructor matrix imports; legacy schema 1 remains compatible; no automatic bonus grading; responsive matrix.');
 }finally{fs.rmSync(directory,{recursive:true,force:true});await context.close();await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
