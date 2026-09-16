'use strict';
const {test,before}=require('node:test');
const assert=require('node:assert/strict');
let api;
before(async()=>{api=await import('../js/viz/lecture07CustomMath.js');});

const CUSP_Q=[-2.147837153458024,1.2513001011022162];
const distance=(a,b)=>Math.hypot(...a.map((x,i)=>x-b[i]));
function verifyRoots(point){const roots=api.solveSliceIK(point);assert.ok(roots.length<=4,`quartic returned ${roots.length} roots at ${point}`);for(const q of roots)assert.ok(distance(api.slicePosition(q),point)<2e-7);for(let i=0;i<roots.length;i++)for(let j=0;j<i;j++)assert.ok(api.torusDistance(roots[i],roots[j])>1e-10);return roots;}
function foldNearCusp(q3){const u=2+1.5*Math.cos(q3),f=2*Math.sin(q3)-1.25*Math.cos(q3),A=u*f,B=.25*f;return [-1,1].map(sign=>[api.wrap(Math.atan2(B,A)+sign*Math.acos(-u*Math.sin(q3)/Math.hypot(A,B))),q3]).sort((a,b)=>api.torusDistance(a,CUSP_Q)-api.torusDistance(b,CUSP_Q))[0];}
function imageTangent([q2,q3]){const u=2+1.5*Math.cos(q3),U=u*Math.cos(q2)+.25*Math.sin(q2),Z=-u*Math.sin(q2)+.25*Math.cos(q2),rho=api.slicePosition([q2,q3])[0],t=[(1+U)*Z/rho,-U],length=Math.hypot(...t);return t.map(x=>x/length);}
function polynomial(roots){let c=[1];for(const root of roots){const next=Array(c.length+1).fill(0);c.forEach((v,i)=>{next[i]-=root*v;next[i+1]+=v;});c=next;}return c;}

test('multiple polynomial roots are counted once and resolvable close roots stay distinct',()=>{
  for(const [input,expected] of [[[-.5,.25,.25,.75],[-.5,.25,.75]],[[-.5,.25,.25,.25],[-.5,.25]],[[-.7,.1,.100001,.6],[-.7,.1,.100001,.6]]]){
    for(const scale of [1e-100,1,1e100]){const roots=api.realPolynomialRoots(polynomial(input).map(c=>c*scale),[-1,1]);assert.equal(roots.length,expected.length);roots.forEach((x,i)=>assert.ok(Math.abs(x-expected[i])<3e-9));}
  }
});

test('exact cusp has one triple configuration plus one regular IK; neighboring folds have three distinct IKs',()=>{
  assert.deepEqual(api.slicePosition(CUSP_Q),api.CUSTOM_CUSP);
  const cusp=verifyRoots(api.CUSTOM_CUSP);assert.equal(cusp.length,2);assert.ok(cusp.some(q=>api.torusDistance(q,CUSP_Q)<1e-10));assert.equal(cusp.filter(q=>Math.abs(api.customDeterminant(q))>1e-6).length,1);
  for(const offset of [.03,.01,.003,.001,.0003,.0001]){const singular=foldNearCusp(CUSP_Q[1]+offset),roots=verifyRoots(api.slicePosition(singular));assert.equal(roots.length,3,`fold offset ${offset}`);assert.ok(roots.some(q=>api.torusDistance(q,singular)<1e-8));}
});

test('transverse fold perturbations preserve two versus four IKs down to 1e-11 metres',()=>{
  const q=foldNearCusp(1.5),p=api.slicePosition(q),t=imageTangent(q),normal=[-t[1],t[0]];
  for(const epsilon of [1e-3,1e-5,1e-7,1e-9,1e-11])for(const sign of [-1,1]){const roots=verifyRoots(p.map((x,i)=>x+sign*epsilon*normal[i]));assert.equal(roots.length,sign<0?4:2,`fold side ${sign}, offset ${epsilon}`);assert.ok(roots.every(q=>Math.abs(api.customDeterminant(q))>1e-7));}
});

test('cusp interior and exterior remain distinct over six orders of positional perturbation',()=>{
  const tangent=imageTangent(CUSP_Q);
  for(const epsilon of [1e-3,1e-4,1e-5,1e-6,1e-7,1e-8,1e-9])for(const sign of [-1,1])assert.equal(verifyRoots(api.CUSTOM_CUSP.map((x,i)=>x+sign*epsilon*tangent[i])).length,sign<0?4:2,`cusp side ${sign}, offset ${epsilon}`);
  // Below coefficient/input roundoff a triple merger cannot be distinguished
  // reliably from three nearby roots. Such queries still must not invent >4.
  for(const epsilon of [1e-10,1e-12,1e-14])for(let k=0;k<100;k++)verifyRoots(api.CUSTOM_CUSP.map((x,i)=>x+epsilon*(i?Math.sin(k):Math.cos(k))));
});

test('regular critical-value preimage approaches the singular curve tangentially at the cusp',()=>{
  const singular=foldNearCusp(CUSP_Q[1]+.001),roots=verifyRoots(api.slicePosition(singular));
  const regular=roots.filter(q=>Math.abs(api.customDeterminant(q))>1e-6).sort((a,b)=>api.torusDistance(a,CUSP_Q)-api.torusDistance(b,CUSP_Q))[0];
  const a=singular.map((x,i)=>api.wrap(x-CUSP_Q[i])),b=regular.map((x,i)=>api.wrap(x-CUSP_Q[i]));
  assert.ok(Math.abs(a.reduce((sum,x,i)=>sum+x*b[i],0)/(Math.hypot(...a)*Math.hypot(...b)))>.99999);
  assert.ok(api.torusDistance(regular,CUSP_Q)<.003);assert.ok(Math.abs(api.customDeterminant(regular))>1e-5);
});

test('both half-angle charts recover pi, nearby roots, and every generating critical configuration',()=>{
  for(const delta of [0,1e-3,-1e-3,1e-7,-1e-7,1e-10,-1e-10]){const q=[.7,api.wrap(Math.PI+delta)],roots=verifyRoots(api.slicePosition(q));assert.ok(roots.some(r=>api.torusDistance(r,q)<1e-9));}
  for(const q of api.customCriticalCurves(400).joint.flat()){const roots=verifyRoots(api.slicePosition(q));assert.ok(roots.some(r=>api.torusDistance(r,q)<1e-5));assert.ok(roots.length===1||roots.length===3);}
  for(let k=0;k<2000;k++){const q=[Math.sin(k*1.91)*Math.PI,Math.cos(k*2.13)*Math.PI],roots=verifyRoots(api.slicePosition(q));assert.ok(roots.some(r=>api.torusDistance(r,q)<1e-5));assert.ok(roots.length===2||roots.length===4);}
});
