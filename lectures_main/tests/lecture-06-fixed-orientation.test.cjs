'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let math;
before(async () => {
  const planner = fs.readFileSync(path.join(__dirname, '../js/viz/cuspidalPathPlanner.js'), 'utf8');
  const source = fs.readFileSync(path.join(__dirname, '../js/viz/fixedOrientationPath.js'), 'utf8')
    .replace("'./cuspidalPathPlanner.js'", JSON.stringify(`data:text/javascript;base64,${Buffer.from(planner).toString('base64')}`));
  math = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
});
const PI = Math.PI, wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const close = (actual, expected, eps = 2e-9) => {
  if (Array.isArray(expected)) { assert.equal(actual.length, expected.length); expected.forEach((v, i) => close(actual[i], v, eps)); }
  else assert.ok(Number.isFinite(actual) && Math.abs(actual-expected) < eps, `${actual} != ${expected}`);
};
const quaternionProduct = ([w,x,y,z],[v,i,j,k]) => [w*v-x*i-y*j-z*k,w*i+x*v+y*k-z*j,w*j-x*k+y*v+z*i,w*k+x*j-y*i+z*v];
const conjugate = ([w,x,y,z]) => [w,-x,-y,-z];
const rotate = (q,p) => quaternionProduct(quaternionProduct(q,[0,...p]),conjugate(q)).slice(1);
const rotation = (axis,q) => [Math.cos(q/2), ...axis.map(v => v*Math.sin(q/2))];
const transpose = A => A[0].map((_,i) => A.map(row => row[i]));
const subtract = (a,b) => a.map((v,i) => v-b[i]);
const attribute = (s,name) => s.match(new RegExp(`${name}="([^"]*)"`))?.[1];
const vector = (s,name) => attribute(s,name).trim().split(/\s+/).map(Number);
const urdf = fs.readFileSync(path.join(__dirname, '../assets/models/custom_6R/custom_6R_new.urdf'),'utf8');
const joints = [...urdf.matchAll(/<joint\b([^>]*)>([\s\S]*?)<\/joint>/g)].filter(([,head])=>attribute(head,'type')==='revolute').map(([,head,body]) => ({
  origin: vector(body.match(/<origin\b([^>]*)/)[1],'xyz'),
  rpy: vector(body.match(/<origin\b([^>]*)/)[1],'rpy'),
  axis: vector(body.match(/<axis\b([^>]*)/)[1],'xyz')
}));
function independentFK(q) {
  let p=[0,0,0], orientation=[1,0,0,0], wrist;
  joints.forEach((joint,i) => {
    p=p.map((v,k)=>v+rotate(orientation,joint.origin)[k]);
    const [roll,pitch,yaw]=joint.rpy;
    orientation=quaternionProduct(orientation,quaternionProduct(rotation([0,0,1],yaw),quaternionProduct(rotation([0,1,0],pitch),rotation([1,0,0],roll))));
    if(i===4)wrist=p.slice();
    orientation=quaternionProduct(orientation,rotation(joint.axis,q[i]));
  });
  return {p,wrist,orientation,R:transpose([[1,0,0],[0,1,0],[0,0,1]].map(axis=>rotate(orientation,axis)))};
}
function finiteDifferenceJacobian(q) {
  const h=1e-6, nominal=independentFK(q);
  return transpose(q.map((_,i)=>{
    const plus=q.slice(),minus=q.slice();plus[i]+=h;minus[i]-=h;
    const a=independentFK(plus),b=independentFK(minus),dq=subtract(a.orientation,b.orientation).map(v=>v/(2*h));
    return [...subtract(a.p,b.p).map(v=>v/(2*h)),...quaternionProduct(dq,conjugate(nominal.orientation)).slice(1).map(v=>2*v)];
  }));
}
const reference=[-60,20,120,35,-50,70].map(v=>v*PI/180);
function endpoints() {
  const R=math.custom6RPose(reference).R;
  const slices=[[20,120],[-164.62755468402702,14.63227552559135]].map(q=>q.map(v=>v*PI/180));
  return { R, q:slices.map(slice=>{const arm=math.custom6RArmFromSlice(slice);return [...arm,...math.custom6RWristSolutions(arm,R)[0]];}) };
}

test('custom 6R FK and full geometric Jacobian agree with independent URDF quaternion kinematics', () => {
  for(const q of [[0,0,0,0,0,0],reference,[.3,-1.2,2,.7,1.1,-.8],[-2.1,.4,-.5,1.2,-.6,2.3]]) {
    const actual=math.custom6RPose(q),expected=independentFK(q);
    close(actual.p,expected.p);close(actual.wrist,expected.wrist);close(actual.R,expected.R);
    close(math.custom6RJacobian(q),finiteDifferenceJacobian(q),2e-8);
    close(math.matrixDeterminant(math.custom6RJacobian(q)),-math.custom6RArmDeterminant(q.slice(1,3))*Math.sin(q[4]),2e-8);
  }
});

test('fixed-orientation route changes arm IK while preserving y = 0, rotation, endpoint pose and full Jacobian regularity', () => {
  const {R,q:[start,goal]}=endpoints(), result=math.buildFixedOrientationPath(start,goal,{targetRotation:R});
  assert.ok(result.found,result.reason);assert.ok(result.path.length>100);
  assert.ok(result.minAbsDet>.05);assert.ok(result.minWrist>.06);assert.ok(result.maxJointStep<.05);
  assert.ok(result.maxPositionError<1e-10);assert.ok(result.maxRotationError<1e-10);
  assert.ok(Math.hypot(...start.map((v,i)=>wrap(v-goal[i])))>1);
  close(result.path[0].map((v,i)=>wrap(v-start[i])),Array(6).fill(0));
  close(result.path.at(-1).map((v,i)=>wrap(v-goal[i])),Array(6).fill(0));
  close(independentFK(result.path[0]).p,independentFK(result.path.at(-1)).p);
  const detSign=Math.sign(math.matrixDeterminant(math.custom6RJacobian(start)));
  result.path.forEach(q=>{
    const pose=independentFK(q);close(pose.R,R);close(pose.wrist[1],0);
    assert.ok(pose.wrist[0]>0);assert.equal(Math.sign(math.matrixDeterminant(math.custom6RJacobian(q))),detSign);
  });
});

test('opposite wrist branches cannot be joined by silently jumping the X–Z–X wrist solution', () => {
  const {R,q:[start,goal]}=endpoints(), flipped=[...goal.slice(0,3),...math.custom6RWristSolutions(goal,R)[1]];
  close(independentFK(goal).R,independentFK(flipped).R);
  const result=math.buildFixedOrientationPath(start,flipped,{targetRotation:R});
  assert.equal(result.found,false);assert.match(result.reason,/wrist singularity/);assert.equal(result.path.length,0);
});

test('rejects incompatible target poses and endpoint singularity clearance', () => {
  const {R,q:[start,goal]}=endpoints();
  const shifted=goal.slice();shifted[1]+=.1;
  assert.equal(math.buildFixedOrientationPath(start,shifted,{targetRotation:R}).found,false);
  const result=math.buildFixedOrientationPath(start,goal,{targetRotation:R,wristClearance:.99});
  assert.equal(result.found,false);assert.match(result.reason,/clearance/);
  assert.equal(math.buildFixedOrientationPath(null,goal).found,false);
});
