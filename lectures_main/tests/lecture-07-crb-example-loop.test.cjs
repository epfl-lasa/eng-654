'use strict';
const {test,before}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const base=path.join(__dirname,'..');
const slice=JSON.parse(fs.readFileSync(path.join(base,'assets/data/lecture07/crb-slice-xy-diverse.json'),'utf8'));
let K,S,E,example,poses,enumerations;
before(async()=>{
 const load=name=>import(pathToFileURL(path.join(base,'js/viz',name)).href);
 [K,S,E]=await Promise.all([load('abbCrbKinematics.js'),load('abbCrbSlice.js'),load('abbCrbExamplePath.js')]);
 example=E.createCrbExampleLoop();poses=S.slicePathPoses(example.vertices,slice);
 enumerations=poses.map(target=>K.inverse(target));
});

test('the enlarged 30 cm circle preserves the rich starting point and fits the central detail view',()=>{
 assert.equal(example.radius,.15);assert.ok(example.radius>=1.5*slice.demonstrationPath.radius-1e-14);
 assert.deepEqual(example.center,[.042,.069]);assert.deepEqual(example.startPoint,slice.demonstrationPoint);
 assert.equal(example.vertices.length,121);assert.equal(poses.length,361);
 assert.deepEqual(example.vertices[0],[0,-.075]);assert.deepEqual(example.vertices.at(-1),example.vertices[0]);
 for(const point of example.vertices){
  assert.ok(Math.abs(Math.hypot(point[0]-.042,point[1]-.069)-.15)<1e-14);
  assert.ok(point.every(x=>x>-.23&&x<.23),'The complete loop remains visible in the existing detail bounds.');
 }
 for(const pose of poses){
  assert.equal(pose[2][3],.5);assert.deepEqual(pose.slice(0,3).map(row=>row.slice(0,3)),slice.orientation);
 }
 const edited=E.createCrbExampleLoop();edited.vertices[0][0]=9;edited.center[0]=9;
 assert.deepEqual(E.createCrbExampleLoop().vertices[0],[0,-.075]);assert.equal(E.CRB_EXAMPLE_LOOP.center[0],.042);
});

test('the actual sampled path crosses a substantial region with exactly eight IKs after native-limit filtering',()=>{
 assert.equal(enumerations[0].solutions.length,16);assert.equal(enumerations[0].solutions.filter(s=>s.withinLimits).length,10);
 const allHistogram={},legalHistogram={},legalCounts=[];
 for(let k=0;k<poses.length;k++){
  const result=enumerations[k];assert.equal(result.diagnostics.resolved,true,`Full root enumeration at path sample ${k}`);
  const solutions=result.solutions,legal=solutions.filter(s=>s.withinLimits);
  allHistogram[solutions.length]=(allHistogram[solutions.length]||0)+1;
  legalHistogram[legal.length]=(legalHistogram[legal.length]||0)+1;legalCounts.push(legal.length);
  for(let i=0;i<solutions.length;i++){
   const root=solutions[i],error=K.poseError(K.fk(root.q).matrix,poses[k]);
   assert.ok(error.position<2e-7&&error.rotation<2e-7,'Every counted root reproduces the tool pose by native FK.');
   assert.equal(root.withinLimits,K.withinLimits(root.q));
   for(let j=i+1;j<solutions.length;j++)assert.ok(Math.hypot(...root.q.map((v,n)=>K.wrap(v-solutions[j].q[n])))>2e-6,'Do not count additional 2π windings as distinct IKs.');
  }
 }
 assert.deepEqual(allHistogram,{8:305,10:13,12:18,14:3,16:22});
 assert.deepEqual(legalHistogram,{6:97,7:16,8:205,10:39,11:2,12:2});
 assert.ok(legalCounts.slice(86,278).every(n=>n===8),'Over half the loop lies in one continuous sampled eight-legal-IK interval.');
 assert.equal(legalCounts[85],7);assert.equal(legalCounts[278],7);
 // Also check a small two-dimensional neighbourhood, rather than accepting a
 // single eight-root point at a boundary or confusing all-real with legal.
 for(const dx of [-.003,0,.003])for(const dy of [-.003,0,.003]){
  const target=K.makePose([.084+dx,.213+dy,.5],slice.orientation),all=K.inverse(target),limited=K.inverse(target,{respectLimits:true});
  assert.equal(all.diagnostics.resolved,true);assert.equal(limited.diagnostics.resolved,true);
  assert.equal(all.solutions.filter(s=>K.withinLimits(s.q)).length,8);assert.equal(limited.solutions.length,8);
 }
});

test('three legal continuations complete the larger loop; others stop without wrapping across physical joints',()=>{
 const starts=enumerations[0].solutions,tracks=starts.map(s=>K.followPath(poses,s.q));
 assert.deepEqual(tracks.flatMap((t,i)=>t.complete?[i]:[]),[0,1,10]);
 for(const index of [0,1,10]){
  const track=tracks[index];assert.equal(track.q.length,poses.length);assert.equal(track.s.at(-1),1);
  assert.ok(track.minDet>.0035);assert.ok(track.minLimitMargin>.026);assert.ok(track.maxPositionError<2e-9&&track.maxRotationError<2e-9);
  const sign=Math.sign(K.determinant(track.q[0]));
  for(let k=0;k<track.q.length;k++){
   const q=track.q[k],error=K.poseError(K.fk(q).matrix,poses[k]);
   assert.equal(K.withinLimits(q),true);assert.ok(error.position<2e-9&&error.rotation<2e-9);
   if(k){
    const previous=track.q[k-1];assert.ok(Math.max(...q.map((v,j)=>Math.abs(v-previous[j])))<.16);
    for(let n=1;n<=8;n++){
     const between=previous.map((v,j)=>v+(q[j]-v)*n/8),det=K.determinant(between);
     assert.equal(Math.sign(det),sign);assert.ok(Math.abs(det)>.0035);
    }
   }
  }
  const end=track.q.at(-1),distances=starts.map(s=>Math.hypot(...s.q.map((v,j)=>K.wrap(v-end[j]))));
  assert.equal(distances.indexOf(Math.min(...distances)),({0:7,1:6,10:10})[index]);assert.ok(Math.min(...distances)<1e-7);
 }
 // IK4 and IK9 start legally but reach opposite q4 stops, even while the
 // workspace point remains reachable by other legal configurations.
 for(const index of [3,8]){
  assert.equal(starts[index].withinLimits,true);assert.equal(tracks[index].complete,false);
  assert.equal(tracks[index].stop.kind,'joint-limit');assert.equal(tracks[index].stop.joint,3);
  assert.ok(Math.abs(tracks[index].stop.progress-.5837)<.001);
  assert.ok(tracks[index].q.every(q=>K.withinLimits(q)));
 }
 assert.ok(tracks.some((t,i)=>starts[i].withinLimits&&!t.complete&&t.reason==='Local IK did not converge.'));
});
