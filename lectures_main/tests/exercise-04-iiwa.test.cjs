'use strict';
const {test,before}=require('node:test');
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
let model,robot,planning;
before(async()=>{
 const load=p=>import(pathToFileURL(path.join(__dirname,'..',p)).href);
 [model,robot,planning]=await Promise.all([load('js/exercises/exercise-04-iiwa-model.js'),load('js/viz/iiwa7Kinematics.js'),load('js/viz/iiwa7Planning.js')]);
});

test('the supplied task is a visible closed XY circle with unchanged tool orientation',()=>{
 assert.equal(model.PATH_SPEC.kind,'circle');assert.equal(model.PATH_SPEC.radius,.12);
 assert.deepEqual(model.PATH_SPEC.center,[.50,0,.55]);
 const samples=model.pathSamples(121);
 assert.equal(samples.length,121);assert.equal(samples[0].s,0);assert.equal(samples.at(-1).s,1);
 assert.deepEqual(samples[0].p,samples.at(-1).p);
 for(const sample of samples){
  assert.ok(Math.abs(Math.hypot(sample.p[0]-.50,sample.p[1])-.12)<1e-14);
  assert.equal(sample.p[2],.55);assert.deepEqual(sample.R,model.PATH_SPEC.R);
  assert.deepEqual(sample,model.targetPose(sample.s));
 }
 assert.ok(Math.abs(model.targetPose(.125).p[0]-(.50+.12/Math.sqrt(2)))<1e-14,'Intermediate targets follow the arc.');
 assert.equal(model.ANGLE_OPTIONS.length,35);assert.equal(new Set(model.ANGLE_OPTIONS).size,35);
 assert.equal(model.ANGLE_OPTIONS[0],-170);assert.equal(model.ANGLE_OPTIONS.at(-1),170);
 assert.ok(Math.abs(model.ANGLE_OPTIONS.at(-1)*Math.PI/180-robot.IIWA_LIMITS[2])<1e-14);
 assert.equal(model.PATH_REVISION,'iiwa-circle-v2');
 assert.equal(model.PLANNING_REVISION,'iiwa-redundant-graph-v3');
});

test('each of the eight algebraic labels has two distinct admissible starting angles for BOTH planners',async()=>{
 const choices=[[-70,70],[-120,120],[-110,110],[-50,50],[-110,110],[-110,110],[-70,70],[-70,70]];
 for(let branch=0;branch<8;branch++)for(const angle of choices[branch]){
  const result=await model.evaluateChoice(branch,angle);
  assert.equal(result.accepted,true,`${branch+1}/${angle}: ${result.reason}`);
  assert.ok(result.start.mergedBranchIndices.includes(branch));
  assert.ok(Math.abs(result.start.q[2]-angle*Math.PI/180)<1e-12);
  for(const [method,plan] of Object.entries({analytical:result.analytical,numerical:result.numerical})){
   assert.equal(plan.complete,true);assert.equal(plan.samples[0].s,0);assert.equal(plan.samples.at(-1).s,1);
   assert.ok(plan.minLimitMargin>.03);assert.ok(plan.minSigma>.039);assert.ok(plan.maxPoseError<2.1e-10);
   assert.equal(plan.samples.length,method==='analytical'?961:1201);
   let previous=null;
   for(const sample of plan.samples){
    const target=model.targetPose(sample.s),actual=robot.fk(sample.q),error=robot.poseDistance(actual,target);
    assert.ok(error.positionError<2.1e-10&&error.orientationError<2.1e-10,`${method} task pose at ${sample.s}`);
    assert.ok(robot.limitMargin(sample.q)>.03);
    if(previous)assert.ok(Math.hypot(...sample.q.map((v,k)=>v-previous[k]))<.01,'No wrapping jump or discontinuous IK switch.');
    previous=sample.q;
   }
   // Independent rank recomputation across each full path, including its end.
   for(let i=0;i<plan.samples.length;i+=Math.max(1,Math.round((plan.samples.length-1)/40)))assert.ok(planning.configurationMetrics(plan.samples[i].q).sigmaMin>.039);
  }
  assert.ok(result.analytical.q.every(q=>Math.abs(q[2]-angle*Math.PI/180)<1e-12),'These example starts have valid constant-q3 corridors.');
  assert.ok(result.analytical.closure<1e-8);
 }
});

test('invalid finite-choice inputs and an invalid starting posture are rejected by calculation',async()=>{
 for(const [branch,angle] of [[-1,0],[8,0],[0,17],[0,NaN]])assert.equal((await model.evaluateChoice(branch,angle)).accepted,false);
 const bad=await model.evaluateChoice(0,0);
 assert.equal(bad.accepted,false);assert.equal(bad.analytical.complete,false);assert.equal(bad.numerical.complete,false);

});


test('analytical connections change q3 to complete formerly numerical-only starts',async()=>{
 for(const angle of [-80,80]){
  const events=[],result=await model.evaluateChoice(0,angle,{onProgress:event=>events.push(event)}),plan=result.analytical;
  assert.equal(result.start.valid,true);assert.equal(result.numerical.complete,true);
  assert.equal(plan.complete,true);assert.equal(result.accepted,true);
  assert.deepEqual(plan.attempts,[{nProgress:121,nAngles:1,complete:false},{nProgress:121,nAngles:35,complete:true}]);
  assert.equal(plan.samples[0].s,0);assert.equal(plan.samples.at(-1).s,1);
  assert.ok(planning.jointDistance(plan.q[0],result.start.q)<1e-12,'Keep the exact chosen start.');
  assert.ok(Math.abs(plan.q.at(-1)[2]-plan.q[0][2])>.1,'Analytical search can vary the redundant coordinate.');
  assert.ok(plan.minLimitMargin>.03);assert.ok(plan.minSigma>planning.MIN_SINGULAR_VALUE);
  assert.ok(plan.maxPoseError<1e-10);assert.ok(plan.maxStep<.04);
  for(let i=0;i<plan.samples.length;i++){
   const sample=plan.samples[i],actual=robot.fk(sample.q),target=model.targetPose(sample.s);
   assert.ok(robot.poseDistance(actual,target).error<1e-10);
   assert.ok(planning.configurationMetrics(sample.q).valid);
   assert.ok(robot.inverseFixedQ3(target,sample.q[2]).some(root=>planning.jointDistance(root.q,sample.q)<1e-9),'Every analytical sample is a fresh closed-form IK root.');
  }
  for(const planner of ['analytical','numerical']){
   const progress=events.filter(event=>event.planner===planner).map(event=>event.progress);
   assert.equal(progress.at(-1),1);assert.ok(progress.every((p,i)=>p>=0&&p<=1&&(!i||p>=progress[i-1]-1e-12)));
  }
 }
});

test('either validated complete path earns credit, but incomplete, invalid or truncated paths do not',()=>{
 const pass={complete:true,minLimitMargin:.01,minSigma:.1,maxPoseError:1e-12,samples:[{s:0},{s:1}]};
 const fail={...pass,complete:false};
 assert.equal(model.acceptsEitherPlan(pass,fail),true);
 assert.equal(model.acceptsEitherPlan(fail,pass),true);
 assert.equal(model.acceptsEitherPlan(pass,pass),true);
 assert.equal(model.acceptsEitherPlan(fail,fail),false);
 for(const invalid of [{...pass,minLimitMargin:-.01},{...pass,minSigma:0},{...pass,maxPoseError:1e-3},{...pass,samples:[{s:0},{s:.9}]}]){
  assert.equal(model.acceptsEitherPlan(invalid,fail),false);
  assert.equal(model.acceptsEitherPlan(fail,invalid),false);
 }
});

test('a completed analytical route earns credit when the local numerical route hits a joint stop',async()=>{
 const result=await model.evaluateChoice(4,0);
 assert.equal(result.start.valid,true);assert.equal(result.accepted,true);
 assert.equal(result.numerical.complete,false);assert.equal(result.numerical.reason,'joint-limit');
 assert.equal(result.analytical.complete,true);assert.equal(result.analytical.samples.at(-1).s,1);
 assert.ok(result.analytical.minLimitMargin>=-1e-10);
 assert.ok(result.analytical.minSigma>planning.MIN_SINGULAR_VALUE);
 assert.ok(result.analytical.maxPoseError<1e-7);
});

test('the entire 121×35×8 feasibility map records real per-pose checks, not future planner success',async()=>{
 const progress=[],map=await model.buildFeasibilityMap({onProgress:value=>progress.push(value)});
 assert.equal(map.revision,model.PATH_REVISION);assert.deepEqual(map.angleDegrees,model.ANGLE_OPTIONS);
 assert.equal(map.samples.length,121);assert.equal(map.angles.length,35);assert.equal(map.cells.length,121);
 assert.equal(map.stats.evaluations,121*35*8);assert.equal(map.stats.valid,16098);
 assert.equal(map.stats.roots+map.stats.unreachable,map.stats.evaluations);
 assert.ok(progress.every((p,i)=>p>0&&p<=1&&(!i||p>=progress[i-1])));assert.equal(progress.at(-1),1);
 let green=0,grey=0;
 for(let k=0;k<map.samples.length;k++){
  assert.equal(map.cells[k].length,35);assert.deepEqual(map.samples[k],model.targetPose(k/120));
  for(let row=0;row<map.angles.length;row++){
   assert.equal(map.cells[k][row].length,8);
   assert.ok(Math.abs(map.angles[row]-model.ANGLE_OPTIONS[row]*Math.PI/180)<1e-14);
   for(let branch=0;branch<8;branch++){
    const cell=map.cells[k][row][branch];
    if(!cell){grey++;continue;}
    assert.ok(Math.abs(cell.q[2]-map.angles[row])<1e-12);
    assert.ok(cell.mergedBranchIndices.includes(branch));
    const error=robot.poseDistance(robot.fk(cell.q),map.samples[k]);
    assert.ok(error.positionError<1e-7&&error.orientationError<1e-7,'Every returned root solves this circular target pose.');
    if(cell.valid){green++;assert.ok(robot.limitMargin(cell.q)>=-1e-10);assert.ok(cell.sigmaMin>planning.MIN_SINGULAR_VALUE);}
    else{grey++;assert.ok(cell.reason==='joint-limit'||cell.reason==='full-jacobian-singularity'||cell.reason==='pose-residual');}
    if(k%20===0&&row%3===0){
     const metrics=planning.configurationMetrics(cell.q);
     assert.equal(cell.valid,metrics.valid&&error.error<1e-7,'Fresh full-Jacobian and native-limit check agrees with the displayed dot.');
    }
   }
  }
 }
 assert.equal(green,map.stats.valid);assert.equal(green+grey,map.stats.evaluations);
 for(let branch=0;branch<8;branch++)assert.ok(map.stats.branchValid[branch]>0&&map.stats.branchValid[branch]<121*35);
 // A legal starting dot can still lead to a later physical stop under the
 // chosen local strategy. No dot is a claim about that future trajectory.
 const failedRow=model.ANGLE_OPTIONS.indexOf(-150);
 assert.equal(map.cells[0][failedRow][6].valid,true);
 assert.ok(map.cells.some(column=>!column[failedRow][6]?.valid));
 const aborted=new AbortController();aborted.abort();
 await assert.rejects(model.buildFeasibilityMap({signal:aborted.signal}),{name:'AbortError'});
 const interrupted=new AbortController();
 await assert.rejects(model.buildFeasibilityMap({signal:interrupted.signal,onProgress:()=>interrupted.abort()}),{name:'AbortError'});
});

test('a strictly legal start can fail this local run at a physical joint limit while the same task has successful choices',async()=>{
 const result=await model.evaluateChoice(6,-150),plan=result.numerical;
 assert.equal(result.start.valid,true);assert.ok(result.start.limitMargin>.02);
 assert.equal(plan.complete,false);assert.equal(plan.reason,'joint-limit');
 assert.equal(plan.samples.at(-1).s,.0425);assert.equal(plan.failProgress,.045);
 assert.ok(plan.minSigma>.16,'This failure is not full-Jacobian rank loss.');
 assert.ok(plan.failure.q[6]>robot.IIWA_LIMITS[6],'The attempted next posture exceeds the actual +175-degree q7 stop.');
 for(const sample of plan.samples){
  assert.ok(robot.limitMargin(sample.q)>=-1e-10);
  assert.ok(robot.poseDistance(robot.fk(sample.q),model.targetPose(sample.s)).error<1e-7);
 }
 assert.ok(plan.samples.at(-1).q[6]<robot.IIWA_LIMITS[6]);
 // Both-method successes for this same IK7 set are independently verified by
 // the full-loop test above. This stop is not a proof of global infeasibility.
});

test('generic path dispatch preserves every lecture 08 rectangle sample and corner',()=>{
 const rectangle=planning.DEFAULT_RECTANGLE;
 assert.deepEqual(planning.pathSpec(rectangle),planning.rectangleSpec(rectangle));
 for(const count of [5,80,121,401])assert.deepEqual(planning.pathSamples(rectangle,count),planning.rectangleSamples(rectangle,count));
 for(const s of [0,.1,.25,.5,.75,.99,1])assert.deepEqual(planning.pathPose(s,rectangle),planning.rectanglePose(s,rectangle));
 assert.throws(()=>planning.pathSpec({kind:'circle',center:[0,0,0],radius:0}),/positive radius/);
});
