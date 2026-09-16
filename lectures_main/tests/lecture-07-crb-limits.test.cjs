'use strict';
const {test,before}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const file=p=>path.join(__dirname,'..',p);
const asModule=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
let robot,poses,solutions,tracks;
const atlas=JSON.parse(fs.readFileSync(file('assets/data/lecture07/crb-slice-xz.json')));
before(async()=>{
 const coefficientUrl=asModule(fs.readFileSync(file('js/viz/abbCrbCoefficients.js'),'utf8'));
 const robotUrl=asModule(fs.readFileSync(file('js/viz/abbCrbKinematics.js'),'utf8').replace('./abbCrbCoefficients.js',coefficientUrl));
 robot=await import(robotUrl);
 const slice=await import(asModule(fs.readFileSync(file('js/viz/abbCrbSlice.js'),'utf8').replace('./abbCrbKinematics.js',robotUrl)));
 poses=slice.slicePathPoses(atlas.demonstrationPath.vertices,atlas);solutions=robot.inverse(poses[0]).solutions;
 tracks=solutions.map(s=>robot.followPath(poses,s.q));
});

test('GoFa 5 axis 6 uses ABB’s ±270° range consistently in URDF, runtime and atlas',()=>{
 assert.deepEqual(robot.jointLimits[5],[-1.5*Math.PI,1.5*Math.PI]);
 const urdf=fs.readFileSync(file('assets/models/abb_gofa/crb15000_5_95.urdf'),'utf8'),joint=urdf.match(/<joint name="joint_6"[\s\S]*?<\/joint>/)[0];
 assert.deepEqual(['lower','upper'].map(k=>Number(joint.match(new RegExp(k+'="([^"]+)"'))[1])),robot.jointLimits[5]);
 assert.deepEqual(atlas.jointLimits,robot.jointLimits);
 assert.match(atlas.jointLimitSource.document,/9AKK107991A8564/);
 assert.equal(robot.withinLimits([0,0,0,0,0,-Math.PI-.01]),true);
 assert.equal(robot.withinLimits([0,0,0,0,0,1.5*Math.PI+.01]),false);
});

test('IK3 crosses −180° on axis 6 continuously and stops later at the real axis-2 limit',()=>{
 const t=tracks[2];
 assert.equal(t.failIndex,635);assert.equal(t.stop.kind,'joint-limit');assert.equal(t.stop.joint,1);
 assert.equal(t.stop.limit,-Math.PI);assert.ok(Math.abs(t.stop.progress-.661158671189812)<1e-9);
 assert.ok(t.q[191][5]<-Math.PI,'The old false axis-6 stop is passed.');
 assert.ok(t.q.every(q=>robot.withinLimits(q)));
 for(let i=1;i<t.q.length;i++)assert.ok(Math.max(...t.q[i].map((v,k)=>Math.abs(v-t.q[i-1][k])))<.16,'Continuous native joint coordinates; no 2π jump.');
 assert.ok(Math.abs(t.stop.boundaryQ[1]+Math.PI)<1e-9);
 assert.ok(robot.withinLimits(t.stop.boundaryQ,1e-9));
 assert.ok(Math.abs(robot.determinant(t.stop.boundaryQ))>.022);
 assert.ok(t.stop.lastSafe>-Math.PI&&t.stop.attempted<-Math.PI);
 const next=robot.refine(poses[t.failIndex],t.q.at(-1),{respectLimits:false});
 const before=robot.inverse(poses[t.failIndex-1]),after=robot.inverse(poses[t.failIndex]);
 assert.deepEqual([before,after].map(r=>[r.solutions.length,r.solutions.filter(s=>s.withinLimits).length]),[[8,6],[8,6]]);
 const equivalent=after.solutions.find(s=>Math.hypot(...s.q.map((v,i)=>robot.wrap(v-next.q[i])))<1e-7);
 assert.ok(equivalent.withinLimits);assert.ok(Math.abs(equivalent.q[1]-next.q[1]-2*Math.PI)<1e-8);
 assert.equal(t.stop.wrappedEquivalent,true);
});

test('all six remaining failures name a verified joint boundary, while IK6 and IK7 close legally',()=>{
 assert.deepEqual(tracks.map((t,i)=>t.success?i+1:null).filter(Boolean),[6,7]);
 for(const t of tracks){
  if(t.success){assert.equal(t.stop,null);assert.ok(Math.hypot(...t.q[0].map((v,k)=>v-t.q.at(-1)[k]))<1e-8);continue;}
  const {joint,limit,boundaryQ,position,progress}=t.stop;
  assert.ok(Math.abs(boundaryQ[joint]-limit)<1e-9);assert.ok(robot.withinLimits(boundaryQ,1e-9));
  assert.ok(Math.abs(position[1]-.2)<1e-11);
  assert.ok(robot.rotationError(robot.fk(boundaryQ).rotation,atlas.orientation)<1e-11);
  assert.ok(progress>t.s.at(-1)&&progress<t.stop.attemptProgress);
  assert.match(t.reason,/joint limit/);
 }
});
