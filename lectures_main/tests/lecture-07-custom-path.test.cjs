'use strict';
const {test,before}=require('node:test');
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
const fs=require('node:fs');
let api;
before(async()=>{api=await import(pathToFileURL(path.join(__dirname,'../js/viz/lecture07CustomMath.js')).href);});

function determinant(columns){const [a,b,c]=columns;return a[0]*(b[1]*c[2]-b[2]*c[1])-b[0]*(a[1]*c[2]-a[2]*c[1])+c[0]*(a[1]*b[2]-a[2]*b[1]);}
test('position equations match the source URDF in its native joint coordinates',()=>{
  const xml=fs.readFileSync(path.join(__dirname,'../assets/models/custom_3R/custom_3R.urdf'),'utf8');
  const numbers=value=>value.split(/\s+/).map(Number);
  const joints=['joint_1','joint_2','joint_3','tool0_fixed_joint'].map(name=>{
    const body=xml.match(new RegExp(`<joint name="${name}"[^>]*>([\\s\\S]*?)</joint>`))[1],xyz=numbers(body.match(/<origin[^>]*xyz="([^"]+)"/)[1]),rpy=numbers(body.match(/<origin[^>]*rpy="([^"]+)"/)[1]),axis=numbers(body.match(/<axis[^>]*xyz="([^"]+)"/)?.[1]||'0 0 1');
    return{xyz,rpy,axis};
  });
  const rotate=(p,axis,angle)=>{const c=Math.cos(angle),s=Math.sin(angle),dot=axis.reduce((sum,a,i)=>sum+a*p[i],0),cross=[axis[1]*p[2]-axis[2]*p[1],axis[2]*p[0]-axis[0]*p[2],axis[0]*p[1]-axis[1]*p[0]];return p.map((v,i)=>v*c+cross[i]*s+axis[i]*dot*(1-c));};
  for(let k=0;k<80;k++){
    const q=[Math.sin(k)*3,Math.sin(k*2.1)*3,Math.cos(k*1.7)*3];let p=[0,0,0];
    for(let i=3;i>=0;i--){const j=joints[i];p=rotate(p,j.axis,q[i]||0);for(let axis=0;axis<3;axis++)p=rotate(p,[0,1,2].map(a=>a===axis?1:0),j.rpy[axis]);p=p.map((v,a)=>v+j.xyz[a]);}
    assert.ok(Math.hypot(...api.customPosition(q).map((v,i)=>v-p[i]))<3e-14);
  }
});
test('closed-form determinant agrees with independently differentiated world position',()=>{
  for(let k=0;k<80;k++){
    const q=[Math.sin(k)*3,Math.sin(k*2.1)*3,Math.cos(k*1.7)*3],h=1e-6;
    const columns=q.map((_,axis)=>{const a=q.slice(),b=q.slice();a[axis]+=h;b[axis]-=h;return api.customPosition(a).map((x,i)=>(x-api.customPosition(b)[i])/(2*h));});
    assert.ok(Math.abs(determinant(columns)-api.customDeterminant(q.slice(1)))<2e-8);
  }
});
test('quartic IK enumerates exact roots and recovers seeded configurations including q3=pi',()=>{
  for(let k=0;k<120;k++){
    const q=[Math.sin(k*1.91)*Math.PI,k===0?Math.PI:Math.cos(k*2.13)*Math.PI],target=api.slicePosition(q),roots=api.solveSliceIK(target);
    assert.ok(roots.some(r=>api.torusDistance(r,q)<1e-5),`missing ${q}`);
    assert.ok(roots.length<=4);
    roots.forEach(r=>assert.ok(Math.hypot(...api.slicePosition(r).map((x,i)=>x-target[i]))<2e-7));
  }
  assert.deepEqual(api.solveSliceIK([10,10]),[]);
});
test('verified cusp loop starts with four IKs and has real closed, open and failed continuations',()=>{
  const a=api.analyzeCustomPath(api.DEFAULT_CUSTOM_PATH);
  assert.equal(a.starts.length,4);assert.equal(a.regular.length,1);assert.equal(a.nonsingular.length,1);assert.equal(a.infeasible.length,2);
  assert.ok(a.regular[0].closure<1e-8);assert.ok(a.nonsingular[0].closure>1.6);
  assert.ok(a.nonsingular[0].minDet>1.18);assert.equal(a.secondLap.success,false);
  a.infeasible.forEach(t=>{assert.ok(t.path.length<a.workspace.length);assert.ok(t.minDet<.001);assert.match(t.reason,/fold/);});
  for(const track of a.tracks){
    for(let i=0;i<track.path.length;i++){
      const actual=api.customPosition(api.sliceConfiguration(track.path[i]));
      assert.ok(Math.abs(actual[1])<1e-12);assert.ok(Math.hypot(actual[0]-track.reached[i][0],actual[2]-track.reached[i][1])<2e-7);
      if(!i)continue;
      const start=track.path[i-1],end=track.path[i],sign=Math.sign(api.customDeterminant(start));
      const nativeStart=api.sliceConfiguration(start),nativeEnd=api.sliceConfiguration(end);
      assert.ok(Math.hypot(...nativeEnd.map((q,j)=>q-nativeStart[j]))<.055001,'a wrapped angle must not jump across a native joint stop');
      if(track.success)assert.ok(nativeEnd.every(q=>Math.PI-Math.abs(q)>.398));
      // Check ten interior points independently of the continuation acceptance test.
      for(let n=0;n<=10;n++)assert.ok(sign*api.customDeterminant(start.map((q,j)=>q+api.wrap(end[j]-q)*n/10))>0);
    }
  }
});
test('arbitrary shared polygon coordinates are retained exactly and missing cases stay missing',()=>{
  const state={vertices:[[3,1],[3.1,1.1],[3,1.2],[2.9,1.1]]},vertices=api.pathVertices(state),a=api.analyzeCustomPath(state);
  assert.deepEqual(vertices,state.vertices);state.vertices.forEach(v=>assert.ok(a.workspace.some(p=>p[0]===v[0]&&p[1]===v[1])));
  assert.deepEqual(a.workspace[0],a.workspace.at(-1));assert.equal(a.nonsingular.length,0);assert.equal(a.infeasible.length,0);assert.equal(a.regular.length,4);
  const unreachable=api.analyzeCustomPath({vertices:[[10,10],[11,10],[10,11]]});
  assert.equal(unreachable.tracks.length,0);assert.equal(unreachable.regular.length,0);assert.equal(unreachable.nonsingular.length,0);
});
test('native joint-limit failures remain distinct from singular-fold failures',()=>{
  const a=api.analyzeCustomPath({rho:1.55,z:.7,width:.45,height:.5,rotation:90});
  const limits=a.infeasible.filter(t=>t.termination==='joint-limit');assert.ok(limits.length>=2);
  limits.forEach(t=>{const last=api.sliceConfiguration(t.path.at(-1));assert.ok(Math.min(...last.map(q=>Math.PI-Math.abs(q)))<1e-5);assert.match(t.reason,/joint limit/);assert.ok(Math.abs(api.customDeterminant(t.path.at(-1)))>.1);});
});
test('critical-value SVG source curves are exact zeroes of this same URDF model',()=>{
  const curves=api.customCriticalCurves(300);
  curves.joint.flat().forEach(q=>assert.ok(Math.abs(api.customDeterminant(q))<1e-12));
  curves.workspace.forEach((line,i)=>line.forEach((point,j)=>assert.deepEqual(point,api.slicePosition(curves.joint[i][j]))));
});
