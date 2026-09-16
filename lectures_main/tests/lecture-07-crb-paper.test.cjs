'use strict';
const {test,before}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const file=p=>path.join(__dirname,'..',p),moduleText=s=>`data:text/javascript;base64,${Buffer.from(s).toString('base64')}`;
const artifact=JSON.parse(fs.readFileSync(file('assets/data/lecture07/crb-paper-paths.json')));
let robot,bounds,paths;
before(async()=>{
  const coefficients=moduleText(fs.readFileSync(file('js/viz/abbCrbCoefficients.js'),'utf8'));
  const math=moduleText(fs.readFileSync(file('js/viz/abbCrbKinematics.js'),'utf8').replace('./abbCrbCoefficients.js',coefficients));
  const det=moduleText(fs.readFileSync(file('js/viz/abbCrbDeterminant.js'),'utf8'));
  robot=await import(math);bounds=await import(det);
  paths=await import(moduleText(fs.readFileSync(file('js/viz/abbCrbPaperPaths.js'),'utf8').replace('./abbCrbKinematics.js',math).replace('./abbCrbDeterminant.js',det)));
});
test('published Eq. 6 keeps its printed coordinates, closes rounded endpoint, and discloses limits',()=>{
  const e=artifact.examples[0];assert.deepEqual(e.publishedA,[-.8,.59,2.34,2.72,1.06,-1.84]);assert.deepEqual(e.publishedB,[2.2599,2.1999,2.6677,2.5298,-2.5286,.4831]);
  const a=e.tracks[0].q[0],b=e.tracks[0].q.at(-1),closure=robot.poseError(robot.fk(a).matrix,robot.fk(b).matrix);
  assert.ok(closure.position<1e-12&&closure.rotation<1e-12);assert.ok(e.endpointCorrection<5e-5);assert.ok(Math.hypot(...a.map((v,k)=>v-b[k]))>4);assert.equal(robot.withinLimits(a),false);assert.equal(e.tracks[0].legalSuccess,false);assert.match(e.attribution,/exceeds joint limits/);
  let minimum=Infinity;for(let i=0;i<=10000;i++)minimum=Math.min(minimum,Math.abs(robot.determinant(a.map((v,k)=>v+(b[k]-v)*i/10000))));
  const lower=minimum-bounds.determinantRateBound(a,b)/20000-1e-11;assert.ok(lower>.0052);assert.ok(Math.abs(lower-e.verification.certifiedMinAbsDet)<1e-13);
});
test('MoveL adaptations verify all stored IK layers and disclose independent coordinates',()=>{
  for(const e of artifact.examples.slice(1)){
    assert.match(e.attribution,/independently generated/);assert.equal(e.metrics.initialIks,8);assert.equal(e.metrics.finalIks,10);assert.ok(e.metrics.pathLength>.8);
    for(const layer of e.layers){const target=paths.moveLPose(e,layer.s);for(let i=0;i<layer.q.length;i++){const error=robot.poseError(robot.fk(layer.q[i]).matrix,target);assert.ok(error.position<2e-7&&error.rotation<2e-7);assert.equal(robot.withinLimits(layer.q[i]),layer.legal[i]);}}
    for(const layer of e.layers.filter((_,i)=>i%20===0)){const actual=robot.inverse(paths.moveLPose(e,layer.s));assert.equal(actual.diagnostics.resolved,true);assert.equal(actual.solutions.length,layer.q.length);}
  }
});
test('adaptive continuations track the prescribed full poses and cannot skip a zero determinant',()=>{
  for(const e of artifact.examples.slice(1))for(const t of e.tracks){
    const sign=Math.sign(robot.determinant(t.q[0]));let previous=t.q[0];
    for(let i=0;i<t.q.length;i++){
      const q=t.q[i],error=robot.poseError(robot.fk(q).matrix,paths.moveLPose(e,t.s[i]));assert.ok(error.position<2e-10&&error.rotation<2e-10);
      assert.equal(Math.sign(robot.determinant(q)),sign);
      if(i){const bound=Math.min(Math.abs(robot.determinant(previous)),Math.abs(robot.determinant(q)))-bounds.determinantRateBound(previous,q)/2-1e-13;assert.ok(bound>0);assert.ok(Math.max(...previous.map((v,k)=>Math.abs(v-q[k])))<.1);}
      previous=q;
    }
    const firstStop=t.q.findIndex(q=>!robot.withinLimits(q));assert.equal(firstStop,t.limitStop);assert.equal(t.legalSuccess,t.success&&firstStop<0);
  }
});
test('five legal starts complete the first MoveL; none complete the second',()=>{
  const [a,b]=artifact.examples.slice(1);assert.equal(a.tracks.filter(t=>t.success).length,8);assert.equal(a.tracks.filter(t=>t.legalSuccess).length,5);assert.equal(b.tracks.filter(t=>t.success).length,4);assert.equal(b.tracks.filter(t=>t.legalSuccess).length,0);
  assert.ok(a.startSolutions.every(s=>s.withinLimits));assert.ok(b.startSolutions.every(s=>s.withinLimits));
});
test('failed mathematical branches correspond to actual local two-root disappearances',()=>{
  for(const e of artifact.examples.slice(1))for(const t of e.tracks.filter(t=>!t.success)){
    const s=t.s.at(-1),q=t.q.at(-1),h=1e-6,before=robot.inverse(paths.moveLPose(e,s-h)),after=robot.inverse(paths.moveLPose(e,s+h));
    assert.equal(before.diagnostics.resolved,true);assert.equal(after.diagnostics.resolved,true);assert.equal(before.solutions.length-after.solutions.length,2);
    const distance=solutions=>Math.min(...solutions.map(a=>Math.hypot(...a.q.map((v,k)=>robot.wrap(v-q[k])))));
    assert.ok(distance(before.solutions)<.02);assert.ok(distance(after.solutions)>.8);assert.ok(Math.abs(robot.determinant(q))<2e-6);
    assert.equal(t.boundaryVerification.beforeCount,before.solutions.length);
  }
});
