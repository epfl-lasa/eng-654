/* Run from the repository root with a preview server and a local Chromium CDP page.
 * EXERCISE02_CDP_PORT defaults to 9256; EXERCISE02_PREVIEW_URL defaults to the
 * repository-root server on 8050. Clears only this exercise’s browser responses.
 */
const assert=require('node:assert/strict'),fs=require('node:fs');
const key=JSON.parse(fs.readFileSync('lectures_main/solutions/exercise_02_answers.json','utf8'));
(async()=>{const c=await require('./exercise-02-cdp.cjs')();
try{
await c.send('Page.navigate',{url:process.env.EXERCISE02_PREVIEW_URL || 'http://127.0.0.1:8050/lectures_main/exercises/exercise_02.html'});await c.wait(300);await c.ready();
await c.run("localStorage.removeItem('eng654.exercise02.v1')");await c.send('Page.reload',{ignoreCache:true});await c.wait(300);await c.ready();
assert.equal((await c.snapshot()).allowed.elbow,false);
await c.run("location.hash='#slide-10'");await c.wait(200);
assert.equal(await c.run("document.querySelector('[data-stage=wrist] [data-stage-content]').hidden"),true);
await c.click('#apply-q3');assert.equal((await c.snapshot()).allowed.model,true);
assert.match(await c.run("document.querySelector('#full-representation').innerText"),/Derive the D-H representation/);
assert.equal(await c.run("document.querySelectorAll('#full-representation table, #full-representation .ex02-matrix').length"),0);
await c.click('[data-stage=model] [data-representation=poe]');
assert.match(await c.run("document.querySelector('#full-representation').innerText"),/Derive the PoE representation/);
assert.doesNotMatch(await c.run("document.querySelector('#full-representation').innerText"),/Ad\(Cφ\)|Mφ =|1\.266/);
assert.equal(await c.run("document.querySelectorAll('#full-representation table, #full-representation .ex02-matrix').length"),0);
await c.click('#review-model');assert.equal((await c.snapshot()).allowed.home,true);
for(const [name,value] of [['wrist.home.x','0'],['wrist.home.y','0'],['wrist.home.z','1.266']])await c.input(`[data-answer="${name}"]`,value);
await c.click('[data-answer="wrist.axes"][value="5,6,7"]');await c.click('[data-check=home]');
assert.equal((await c.snapshot()).allowed.partition,false);
assert.equal(await c.run("document.querySelector('[data-answer-wrap=\"wrist.home.z\"]').dataset.result"),'incorrect');
await c.input('[data-answer="wrist.home.z"]','1.14');await c.click('[data-check=home]');assert.equal((await c.snapshot()).allowed.partition,true);
await c.run("document.querySelector('[data-stage=home]').scrollIntoView({block:'start'})");await c.screenshot('/tmp/ex02-home.png');
for(const k of ['partition.arm','partition.wrist'])await c.click(`[data-answer="${k}"][value="${key.answers[k]}"]`);
await c.click('[data-check=partition]');assert.equal((await c.snapshot()).allowed.method,true);
assert.equal(await c.run("document.querySelectorAll('#arm-representation table, #arm-representation .ex02-matrix').length"),0);
assert.doesNotMatch(await c.run("document.querySelector('#arm-representation').innerText"),/1\.14|B₂ =/);
const methodPrompt=await c.run("document.querySelector('[data-stage=method]').textContent");
assert.match(methodPrompt,/Paden–Kahan subproblems/);assert.doesNotMatch(methodPrompt,/a₁|a_?1|intersect|divid|zero/i);
assert.equal(await c.run("document.querySelector('[data-stage=elbow] [data-stage-content]').hidden"),true);
await c.click('[data-answer=method][value=algebraic]');await c.click('[data-check=method]');assert.equal((await c.snapshot()).allowed.elbow,false);
assert.equal(await c.run("document.querySelector('#method-remediation').hidden"),false);
assert.equal(await c.run("document.querySelector('#method-remediation a').getAttribute('target')"),'_blank');
assert.ok(await c.run("document.querySelector('#method-remediation a').href.endsWith('lecture_02.html#slide-30')"));
await c.click('[data-answer=method][value=geometric]');await c.click('[data-check=method]');assert.equal((await c.snapshot()).allowed.elbow,true);
const eq=k=>`[data-equation-id="${k}"] .ex02-equation-input`;
await c.click(eq('eq.R'));
for(const token of ['L','^','2','+','U','^','2','+','2','*','L','*','U','*','c3'])await c.click(`#elbow-builder .ex02-equation-palette [data-value="${token}"]`);
assert.equal((await c.snapshot()).document.answers['eq.R'].replace(/\s/g,''),'L^2+U^2+2*L*U*c3');
for(const k of ['eq.c3','eq.s3','eq.theta3'])await c.input(eq(k),key.answers[k]);
await c.input(eq('eq.theta3'),'atan2(s3,sqrt(c3^2))');await c.click('[data-check=elbow]');assert.equal((await c.snapshot()).allowed.radial,false);
await c.input(eq('eq.theta3'),key.answers['eq.theta3']);await c.click('[data-check=elbow]');assert.equal((await c.snapshot()).allowed.radial,true);
await c.input(eq('eq.E'),'sigmaE*sqrt(rho2-C^2)');await c.click('[data-answer="arm.signReason"][value="squared-projection"]');await c.click('[data-check=radial]');assert.equal((await c.snapshot()).allowed.backsub,true);
for(const k of ['eq.c2','eq.s2','eq.theta2','eq.c1','eq.s1','eq.theta1'])await c.input(eq(k),key.answers[k]);
await c.click('[data-check=backsub]');assert.equal((await c.snapshot()).allowed.wrist,true);
await c.run("document.querySelector('[data-stage=backsub]').scrollIntoView({block:'start'})");await c.screenshot('/tmp/ex02-equations.png');
for(const k of ['wrist.relative','wrist.convention','wrist.count'])await c.click(`[data-answer="${k}"][value="${key.answers[k]}"]`);
await c.input('[data-answer="wrist.r33"]','cos(q6)');await c.click('[data-check=wrist]');assert.equal((await c.snapshot()).allowed.verify,true);
await c.input('[data-answer="branches.count"]','8');await c.click('[data-check=verify]');
let s=await c.snapshot();assert.equal(s.lesson.count,8);assert.equal(s.lesson.executedStudentEquations,true);assert.equal(s.lesson.feasibleCount,6);assert.equal(s.allowed.pose,true);
await c.click('#solve-own');s=await c.snapshot();assert.equal(s.allowed.limits,true);assert.equal(s.own.count,8);
for(const [k,v]of Object.entries(key.answers).filter(([k])=>k.startsWith('limits.')))await c.input(`[data-answer="${k}"]`,v,'change');
await c.click('[data-check=limits]');assert.equal((await c.snapshot()).passed.limits,true);
await c.run("document.querySelector('[data-stage=limits]').scrollIntoView({block:'start'})");await c.screenshot('/tmp/ex02-branches.png');
// Independent target: preserve the learned stages, invalidate only the result and limit answers.
await c.input('#target-q1','0.8');s=await c.snapshot();assert.equal(s.passed.verify,true);assert.equal(s.allowed.limits,false);assert.equal(Object.keys(s.document.answers).some(k=>k.startsWith('limits.')),false);
await c.click('#solve-own');s=await c.snapshot();assert.equal(s.own.count,8);assert.ok(s.own.branches.every(b=>b.residuals.position<1e-8));
// q4 = 0 gives merging elbow branches, never fabricate eight isolated roots.
await c.input('[aria-label="Numeric q4 in radians"]','0','change');await c.click('#solve-own');s=await c.snapshot();assert.equal(s.own.singular,true);assert.equal(s.own.usedSingularFallback,true);assert.ok(s.own.count<8);
// Restore the default and verify persistence through reload.
await c.click('#reset-target');await c.click('#solve-own');const saved=(await c.snapshot()).document;
await c.send('Page.reload');await c.wait(250);await c.ready();s=await c.snapshot();assert.equal(s.own.count,8);assert.equal(s.document.answers['eq.E'],saved.answers['eq.E']);
// A changed frozen angle recalculates the representation and locks all dependent stages.
await c.input('#fixed-q3','pi/4');await c.click('#apply-q3');s=await c.snapshot();assert.equal(s.document.fixedQ3,Math.PI/4);assert.equal(s.allowed.model,true);assert.equal(s.allowed.home,false);assert.equal(Object.keys(s.document.answers).length,0);
// Import the instructor JSON using the real file input.
const doc=await c.send('DOM.getDocument'), node=await c.send('DOM.querySelector',{nodeId:doc.root.nodeId,selector:'#load-responses'});
await c.send('DOM.setFileInputFiles',{nodeId:node.nodeId,files:[process.cwd()+'/lectures_main/solutions/exercise_02_answers.json']});await c.wait(350);s=await c.snapshot();assert.equal(s.passed.limits,true);assert.equal(s.own.feasibleCount,6);
// No answer key is requested by the tutorial's network code.
assert.equal(c.requests.some(u=>/solutions\/exercise_02_answers\.json/.test(u)),false);
assert.equal(c.errors.length,0,JSON.stringify(c.errors));
console.log('PASS: gated flow, per-field feedback, symbolic blocks, wrong-quadrant rejection, 8 FK-verified roots, 6 legal roots, own target, singularity, q3 reset, persistence, instructor JSON import; no page errors.');
}catch(e){console.error(e);console.error(await c.run('document.querySelector("#file-status")?.textContent'));process.exitCode=1;}finally{c.ws.close();}
})();
