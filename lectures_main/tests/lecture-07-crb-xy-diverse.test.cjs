'use strict';
const {test,before}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base=path.join(__dirname,'..');
const atlas=JSON.parse(fs.readFileSync(path.join(base,'assets/data/lecture07/crb-slice-xy-diverse.json'),'utf8'));
const moduleURL=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
let K,S;
const pointAt=i=>[atlas.xmin+(i%atlas.nx)*(atlas.xmax-atlas.xmin)/(atlas.nx-1),atlas.ymin+Math.floor(i/atlas.nx)*(atlas.ymax-atlas.ymin)/(atlas.ny-1)];
before(async()=>{
 const coefficients=moduleURL(fs.readFileSync(path.join(base,'js/viz/abbCrbCoefficients.js'),'utf8'));
 const kinematics=moduleURL(fs.readFileSync(path.join(base,'js/viz/abbCrbKinematics.js'),'utf8').replace('./abbCrbCoefficients.js',coefficients));
 K=await import(kinematics);S=await import(moduleURL(fs.readFileSync(path.join(base,'js/viz/abbCrbSlice.js'),'utf8').replace('./abbCrbKinematics.js',kinematics)));
});
const solve=point=>K.inverse(K.makePose([...point,atlas.z],atlas.orientation));
function verifyRoots(point,result){
 assert.equal(result.diagnostics.resolved,true);
 for(let i=0;i<result.solutions.length;i++){
  const a=result.solutions[i],error=K.poseError(K.fk(a.q).matrix,K.makePose([...point,atlas.z],atlas.orientation));
  assert.ok(error.position<2e-7&&error.rotation<2e-7);
  for(let j=i+1;j<result.solutions.length;j++)assert.ok(Math.hypot(...a.q.map((v,k)=>K.wrap(v-result.solutions[j].q[k])))>2e-6);
 }
}
test('one fixed XY pose slice contains all seven requested IK-count regions in 100000 samples',()=>{
 assert.equal(atlas.plane,'xy');assert.equal(atlas.fixedAxis,'z');assert.equal(atlas.frame,'tool0');assert.equal(atlas.z,.5);
 assert.deepEqual(atlas.orientationEulerZYX,[0,-.28,1.47]);assert.deepEqual(atlas.orientation,S.orientationZYX(atlas.orientationEulerZYX));
 assert.equal(atlas.nx*atlas.ny,100000);assert.equal(atlas.sampleCount,100000);assert.equal(atlas.counts.length,100000);assert.equal(atlas.limitCounts.length,100000);assert.equal(atlas.generation.targetPoses,100000);
 assert.deepEqual(atlas.histogram,{0:41584,2:128,4:12005,6:428,8:45166,10:372,12:135,14:94,16:88});
 for(const count of [4,6,8,10,12,14,16])assert.ok(atlas.counts.filter(c=>c===count).length>=80);
 for(let i=0;i<atlas.counts.length;i++){assert.ok(Number.isInteger(atlas.counts[i])&&atlas.counts[i]>=0&&atlas.counts[i]<=16&&atlas.counts[i]%2===0);assert.ok(atlas.limitCounts[i]>=0&&atlas.limitCounts[i]<=atlas.counts[i]);}
 assert.deepEqual(atlas.detailBounds,[-.23,.23,-.23,.23]);
});
test('representative buttons identify regular, distinct roots with independent FK and honest limit counts',()=>{
 assert.deepEqual(atlas.representativePoints.map(p=>p.count),[4,6,8,10,12,14,16]);
 for(const p of atlas.representativePoints){
  assert.deepEqual(p.point,pointAt(p.gridIndex));const result=solve(p.point);verifyRoots(p.point,result);
  assert.equal(result.solutions.length,p.count);assert.equal(result.solutions.filter(s=>s.withinLimits).length,p.limitCount);assert.equal(atlas.counts[p.gridIndex],p.count);
  assert.ok(Math.min(...result.solutions.map(s=>Math.abs(s.det)))>1e-3,'choose a regular point inside the region');
 }
});
test('every 14/16-IK pixel is independently recovered; counts do not duplicate 2π windings',()=>{
 let checked=0;
 for(let i=0;i<atlas.counts.length;i++)if(atlas.counts[i]>=14){const point=pointAt(i),result=solve(point);verifyRoots(point,result);assert.equal(result.solutions.length,atlas.counts[i]);assert.equal(result.solutions.filter(s=>s.withinLimits).length,atlas.limitCounts[i]);checked++;}
 assert.equal(checked,182);assert.equal(atlas.generation.independentVerification.all14And16GridPoints,checked);
});
test('Rust recovery provenance distinguishes unresolved enumeration from unreachable poses',()=>{
 assert.equal(atlas.generation.rustUnresolvedPoses,8);assert.equal(atlas.generation.rustUnresolvedIndices.length,8);assert.equal(atlas.generation.javascriptRecoveredPoses,8);assert.equal(atlas.generation.unresolvedPoses,0);assert.deepEqual(atlas.generation.unresolvedIndices,[]);
 for(const i of atlas.generation.rustUnresolvedIndices){const result=solve(pointAt(i));assert.equal(result.diagnostics.resolved,true);assert.equal(result.solutions.length,atlas.counts[i]);}
 assert.ok(atlas.generation.independentVerification.maxPositionError<1e-10);assert.ok(atlas.generation.independentVerification.maxRotationError<1e-9);
});
test('the visible XY circle starts at 16 IKs and has two complete native-limit continuations',()=>{
 const example=atlas.demonstrationPath,vertices=example.vertices,poses=S.slicePathPoses(vertices,atlas);
 assert.deepEqual(atlas.demonstrationPoint,[0,-.075]);assert.deepEqual(vertices[0],atlas.demonstrationPoint);assert.deepEqual(vertices.at(-1),atlas.demonstrationPoint);assert.equal(vertices.length,121);assert.equal(poses.length,241);
 for(const point of vertices)assert.ok(Math.abs(Math.hypot(point[0]-.1,point[1]+.075)-.1)<1e-14);
 const starts=solve(atlas.demonstrationPoint);assert.equal(starts.solutions.length,16);assert.equal(starts.solutions.filter(s=>s.withinLimits).length,10);
 const tracks=starts.solutions.map(s=>K.followPath(poses,s.q));assert.deepEqual(tracks.flatMap((t,i)=>t.complete?[i]:[]),[5,8]);assert.deepEqual(example.verification.completeIndices,[5,8]);
 for(const [i,t]of tracks.entries()){
  assert.equal(t.complete,example.verification.tracks[i].complete);
  if(t.complete){assert.ok(t.minDet>.006);assert.ok(t.minLimitMargin>.04);assert.ok(t.maxPositionError<1e-8&&t.maxRotationError<1e-8);assert.equal(t.q.length,poses.length);}
 }
 assert.ok(tracks.some(t=>t.stop?.kind==='joint-limit'));assert.ok(tracks.some(t=>t.reason==='Local IK did not converge.'));
});
