'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');

test('critical-value curves have no coarse chords or false joint-chart bridges',async()=>{
  const {customCriticalCurves,customDeterminant,slicePosition}=await import('../js/viz/lecture07CustomMath.js');
  const {joint,workspace}=customCriticalCurves();
  let longestChord=0,longestJointStep=0,vertices=0;
  joint.forEach((line,index)=>line.forEach((q,i)=>{
    assert.ok(Math.abs(customDeterminant(q))<1e-12,'Every curve vertex lies on the exact singular set.');
    assert.deepEqual(workspace[index][i],slicePosition(q));vertices++;
    if(i){
      longestJointStep=Math.max(longestJointStep,Math.hypot(...q.map((v,k)=>v-line[i-1][k])));
      longestChord=Math.max(longestChord,Math.hypot(...workspace[index][i].map((v,k)=>v-workspace[index][i-1][k])));
    }
  }));
  assert.ok(vertices>10000,'The full critical-value image is sampled finely for zoomed vector plots.');
  assert.ok(longestChord<.00801,'No long straight chords replace the square-root ends of the curve.');
  assert.ok(longestJointStep<.00401,'No ±pi chart crossing is drawn through the joint plot.');
  const points=workspace.flat();
  assert.ok(Math.min(...points.map(p=>p[0]))<1e-4,'The inner curve near the rho = 0 boundary is retained.');
  assert.ok(Math.max(...points.map(p=>p[1]))>4.5089,'The upper lobe is retained even beyond the editor default axes.');
});
