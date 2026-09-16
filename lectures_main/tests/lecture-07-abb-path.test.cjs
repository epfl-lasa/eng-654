'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const data = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
let math, abb, ik, analysis;
before(async () => {
  const root = path.join(__dirname, '../js/viz');
  const source = name => fs.readFileSync(path.join(root, name), 'utf8');
  const ku = data(source('abbIrbKinematics.js'));
  const iu = data(source('abbIrbIk.js').replace('./abbIrbKinematics.js', ku));
  [abb, ik, math] = await Promise.all([import(ku), import(iu), import(data(source('lecture07AbbIrbPaths.js')
    .replace('./abbIrbKinematics.js', ku).replace('./abbIrbIk.js', iu)))]);
  analysis = math.analyzeAbbPath();
});

test('XY tool rectangle crosses a genuine four-to-two POSITIONAL IK boundary', () => {
  assert.equal(analysis.mathematicalStarts, 8);
  assert.equal(analysis.validStarts, 4);
  assert.equal(analysis.completed, 2);
  const { targets, roots, positionCounts } = analysis;
  assert.equal(targets.length, 361);
  assert.deepEqual(targets[0].position, targets.at(-1).position);
  for (const target of targets) assert.equal(target.position[2], 1.1);
  assert.equal(Math.max(...targets.map(t => t.position[0])) - Math.min(...targets.map(t => t.position[0])), .8500000000000001);
  assert.ok(Math.abs(Math.max(...targets.map(t => t.position[1])) - Math.min(...targets.map(t => t.position[1])) - .55) < 1e-12);
  assert.deepEqual(targets.filter((_,i) => i % 90 === 0).map(t=>t.position), math.abbPathVertices());
  assert.equal(positionCounts.filter(n=>n===2).length,146);
  assert.equal(positionCounts.filter(n=>n===4).length,215);
  assert.equal(positionCounts[0],4);
  targets.forEach((target,i) => {
    const arm = ik.solveAbbArm(target.wrist);
    assert.equal(arm.length, positionCounts[i]);
    assert.equal(roots[i].length, 2 * arm.length);
    for (const row of arm) {
      const q = [...row.q, 0, 0, 0];
      assert.ok(Math.hypot(...abb.abbDHKinematics(q).wrist.map((v,j)=>v-target.wrist[j])) < 1e-10);
    }
  });
  const radius = math.abbPositionSliceBoundaries().fourToTwo;
  assert.equal(math.abbPositionIkCount([radius-1e-5,0,1.1]),4);
  assert.equal(math.abbPositionIkCount([radius+1e-5,0,1.1]),2);
  assert.equal(math.abbPositionIkCount([math.abbPositionSliceBoundaries().twoToZero+1e-5,0,1.1]),0);
});

test('tool-based numerical continuation agrees with analytical SEW tracking, including positional folds', () => {
  for (let i = 0; i < analysis.numerical.length; i++) {
    const numeric = analysis.numerical[i], analytic = analysis.analytical[i];
    assert.equal(numeric.success, analytic.success);
    assert.equal(numeric.failIndex, analytic.failIndex);
    assert.equal(numeric.failure?.kind, analytic.failure?.kind);
    assert.ok(numeric.maxError < 2e-9);
    for (let sample = 0; sample < numeric.states.length; sample++) {
      const distance = Math.hypot(...numeric.states[sample].map((value, j) => value - analytic.states[sample][j]));
      assert.ok(distance < 1e-7, `seed ${i}, sample ${sample}: numerical/analytical difference ${distance}`);
    }
    if (numeric.failIndex === 0) continue;
    for (const q of numeric.states) {
      assert.equal(math.abbPathLimitViolation(q), null);
      assert.ok(Math.abs(abb.abbDeterminant(q)) > .15);
    }
    if (numeric.success) {
      assert.equal(numeric.states.length, analysis.targets.length);
      assert.ok(numeric.closure < 1e-8);
      assert.ok(numeric.maxStep < .055);
    } else {
      assert.equal(numeric.failure.kind, 'positional-fold');
      assert.equal(numeric.failIndex,71);
      assert.equal(analysis.positionCounts[70],4);
      assert.equal(analysis.positionCounts[71],2);
      assert.equal(ik.solveAbbArm(analysis.targets[71].wrist).some(row=>row.shoulder===numeric.seed.shoulder),false);
      const foldRadius=math.abbPositionSliceBoundaries().fourToTwo;
      const foldTarget=math.abbPathTarget([Math.sqrt(foldRadius**2-.3**2),.3,1.1]);
      const foldRoots=ik.solveAbbIk(foldTarget).filter(row=>row.shoulder===numeric.seed.shoulder);
      assert.ok(foldRoots.length>0);
      assert.ok(foldRoots.every(row=>Math.abs(row.determinant)<1e-7),'branch ends at actual zero determinant, not a joint stop');
    }
  }
});

test('actual tool FK and its orientation follow the target independently of the wrist target', () => {
  for (const track of analysis.analytical.filter(row => row.failIndex !== 0)) {
    track.states.forEach((q, i) => {
      const end = abb.abbDHKinematics(q).end;
      assert.ok(Math.hypot(...end.map((value, j) => value - analysis.targets[i].position[j])) < 1e-10);
      const target = ik.abbIkTargetFromQ(q);
      assert.ok(Math.hypot(...target.rotation.flat().map((value, j) => value - ik.ABB_DOWNWARD_TOOL_ROTATION.flat()[j])) < 1e-10);
      assert.ok(Math.abs(analysis.targets[i].wrist[2]-analysis.targets[i].position[2]-.135)<1e-12);
    });
  }
});

test('world tool Jacobian differentiates all six native URDF joints and preserves determinant', () => {
  const configurations = [[.2,.35,-.7,.5,.6,-.4],[-.6,.8,-1.2,-.7,.9,.3]];
  for(const q of configurations){
    const J=math.abbToolWorldJacobian(q),h=1e-6,center=abb.abbUrdfTransforms(q).tool0;
    assert.ok(Math.abs(abb.determinant(J)-abb.abbDeterminant(q))<1e-11);
    for(let j=0;j<6;j++){
      const plus=q.slice(),minus=q.slice();plus[j]+=h;minus[j]-=h;
      const a=abb.abbUrdfTransforms(minus).tool0,b=abb.abbUrdfTransforms(plus).tool0;
      for(let k=0;k<3;k++)assert.ok(Math.abs((b[k][3]-a[k][3])/(2*h)-J[k][j])<2e-9);
      const omega=Array.from({length:3},(_,r)=>Array.from({length:3},(_,c)=>[0,1,2].reduce((sum,k)=>sum+(b[r][k]-a[r][k])/(2*h)*center[c][k],0)));
      [omega[2][1],omega[0][2],omega[1][0]].forEach((v,k)=>assert.ok(Math.abs(v-J[k+3][j])<2e-9));
    }
    assert.ok(Math.abs(J[0][3])+Math.abs(J[1][3])+Math.abs(J[2][3])>.01,'wrist rotation moves the tool point');
  }
});

test('orientation error detects a half-turn and numerical inversion reports a singular seed', () => {
  const q = [0, 0, 0, 0, 0, 0], target = ik.abbIkTargetFromQ(q);
  const halfTurn = target.rotation.map((row, i) => row.map(value => value * (i === 0 ? 1 : -1)));
  assert.ok(Math.abs(Math.hypot(...math.abbPathPoseError(q, { ...target, rotation: halfTurn }).slice(3)) - Math.PI) < 1e-10);
  target.position[0] += .01;
  assert.equal(math.solveAbbPathNumerically(target, q).failure.kind, 'singularity');
});

test('tool velocity follows each straight edge and timing rests at every rectangle corner', () => {
  const urdf = fs.readFileSync(path.join(__dirname,'../assets/models/abb_irb/irb4600_40_255.urdf'),'utf8');
  const speeds = [...urdf.matchAll(/<limit\b[^>]*velocity="([^"]+)"/g)].map(match=>Number(match[1]));
  math.ABB_PATH_SPEED_LIMITS.forEach((v,i)=>assert.ok(Math.abs(v-speeds[i])<1e-13));
  const track=analysis.numerical.find(t=>t.success),h=1e-6;
  for(let i=20;i<340;i+=31){
    const q=track.states[i],s=i/360,rate=.13,rates=math.abbPathJointVelocity(q,s,rate);
    const a=abb.abbUrdfTransforms(q.map((v,k)=>v-h*rates[k])),b=abb.abbUrdfTransforms(q.map((v,k)=>v+h*rates[k]));
    const before=math.abbPathPosition(s-h*rate),after=math.abbPathPosition(s+h*rate);
    const expected=after.map((v,k)=>(v-before[k])/(2*h));
    for(let k=0;k<3;k++)assert.ok(Math.abs((b.tool0[k][3]-a.tool0[k][3])/(2*h)-expected[k])<2e-8);
    for(let k=0;k<3;k++)for(let j=0;j<3;j++)assert.ok(Math.abs(b.tool0[k][j]-a.tool0[k][j])/(2*h)<2e-8,'Fixed orientation has zero angular speed');
  }
  for(let corner=0;corner<=4;corner++){
    const state=math.abbRectangleClock(corner*3,12);
    assert.equal(state.s,corner/4);assert.equal(state.velocity,0);
    assert.ok(Math.abs(math.abbRectangleTime(corner/4,12)-corner*3)<1e-12);
  }
  for(let i=0;i<=100;i++){
    const s=i/100,t=math.abbRectangleTime(s,12);
    assert.ok(Math.abs(math.abbRectangleClock(t,12).s-s)<1e-12);
  }
});
