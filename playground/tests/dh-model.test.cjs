const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../dh-model.js');
function close(actual,expected,tolerance=1e-9) {
  if (Array.isArray(expected)) {assert.equal(actual.length,expected.length);expected.forEach((v,i)=>close(actual[i],v,tolerance));}
  else assert.ok(Math.abs(actual-expected)<tolerance,`${actual} != ${expected}`);
}
function explicitDH({theta:t,d,a,alpha:r}) {
  const c=Math.cos(t),s=Math.sin(t),cr=Math.cos(r),sr=Math.sin(r);
  return [[c,-s*cr,s*sr,a*c],[s,c*cr,-c*sr,a*s],[0,sr,cr,d],[0,0,0,1]];
}
function explicitRPY(xyz,[r,p,y]) {
  const cr=Math.cos(r),sr=Math.sin(r),cp=Math.cos(p),sp=Math.sin(p),cy=Math.cos(y),sy=Math.sin(y);
  return [[cy*cp,cy*sp*sr-sy*cr,cy*sp*cr+sy*sr,xyz[0]],
    [sy*cp,sy*sp*sr+cy*cr,sy*sp*cr-cy*sr,xyz[1]],[-sp,cp*sr,cp*cr,xyz[2]],[0,0,0,1]];
}
test('standard DH matches the closed-form homogeneous matrix with signed lengths and offsets',()=>{
  for(let i=0;i<25;i++) {
    const row={theta:Math.sin(i)*3,alpha:Math.cos(i*1.2)*3,d:Math.sin(i*2)*1.2,a:Math.cos(i*.7)*2};
    close(M.dh(row),explicitDH(row));
    close(M.chain(M.rz(row.theta),M.translation([0,0,row.d]),M.rx(row.alpha),M.translation([row.a,0,0])),explicitDH(row));
  }
});
test('URDF fixed-axis RPY and extraction preserve poses, including both gimbal locks',()=>{
  const angles=[[.3,-.7,1.2],[.8,Math.PI/2,1.1],[-.7,-Math.PI/2,2.4],[0,-Math.PI/2,0],[Math.PI/2,0,.4]];
  for(const rpy of angles) {
    const t=M.rpyPose([1,-2,.4],rpy);close(t,explicitRPY([1,-2,.4],rpy));
    close(M.rpyPose(M.origin(t),M.toRPY(t)),t);close(M.multiply(t,M.inverse(t)),M.identity());
  }
});
test('skew common normal finds closest points on infinite lines, independent of origin placement',()=>{
  const n=M.commonNormal([0,0,.35],[0,0,1],[1,.25,.8],[0,1,0]);
  assert.equal(n.kind,'skew');close(n.start,[0,0,.8]);close(n.end,[1,0,.8]);close(n.x,[1,0,0]);close(n.length,1);
  const shifted=M.commonNormal([0,0,10],[0,0,1],[1,-5,.8],[0,1,0]);close(shifted.start,n.start);close(shifted.end,n.end);
});
test('parallel, antiparallel, intersecting and coincident cases retain valid perpendicular frames',()=>{
  const cases=[
    {p:[0,0,1],z:[0,0,1],q:[2,0,5],w:[0,0,1],kind:'parallel',length:2},
    {p:[0,0,1],z:[0,0,1],q:[2,0,5],w:[0,0,-1],kind:'antiparallel',length:2},
    {p:[0,0,0],z:[0,0,1],q:[0,3,1],w:[0,1,0],kind:'intersecting',length:0},
    {p:[0,0,1],z:[0,0,1],q:[0,0,5],w:[0,0,1],kind:'coincident',length:0}
  ];
  for(const c of cases) {
    const n=M.commonNormal(c.p,c.z,c.q,c.w);assert.equal(n.kind,c.kind);close(n.length,c.length);
    close(M.norm(M.cross(M.sub(n.start,c.p),c.z)),0);close(M.norm(M.cross(M.sub(n.end,c.q),c.w)),0);
    close(M.dot(M.sub(n.end,n.start),c.z),0);close(M.dot(M.sub(n.end,n.start),c.w),0);
    assert.ok(M.validNormal(n.x,c.z,c.w));
  }
});
test('perpendicular direction alone is insufficient for separated parallel axes',()=>{
  const n=M.commonNormal([0,0,0],[0,0,1],[1,0,2],[0,0,1]);
  assert.ok(M.validNormal([0,1,0],[0,0,1],[0,0,1]));
  assert.equal(M.validCommonNormal([0,1,0],n,[0,0,1],[0,0,1]),false);
  assert.ok(M.validCommonNormal([-1,0,0],n,[0,0,1],[0,0,1]));
  const model=M.scenario('parallel');assert.throws(()=>M.assign(model,[[0,1,0],model.normals[1].x]),/joining/);
});
test('coincident axes allow any perpendicular x, including a different offered direction',()=>{
  const model=M.scenario('coincident');
  const directions=model.normals.map((n,i)=>M.unit(M.cross(model.axes[i],n.x)));
  const assigned=M.assign(model,directions);
  for(const q of [[0,0,0],[.6,-.9,1.3]]) close(M.dhFK(assigned,q),M.urdfFK(model,q));
});
test('the skew fixture has independently known offsets and signed twists',()=>{
  const model=M.scenario('skew');
  close(Object.values(model.rows[0]),[0,.45,1,-Math.PI/2]);
  close(Object.values(model.rows[1]),[-Math.PI/2,.8,.5,-Math.PI/2]);
});
for(const fixture of M.fixtures) {
  test(`${fixture.id}: all assigned frames are right-handed and rows reproduce their relative transforms`,()=>{
    const model=M.scenario(fixture.id);
    for(const t of model.dhFrames) {
      const x=M.axis(t,0),y=M.axis(t,1),z=M.axis(t,2);
      close(M.cross(x,y),z);close(M.dot(x,y),0);[x,y,z].forEach(a=>close(M.norm(a),1));
    }
    model.rows.forEach((row,i)=>close(M.multiply(M.inverse(model.dhFrames[i]),model.dhFrames[i+1]),explicitDH(row)));
  });
  test(`${fixture.id}: URDF and DH agree at home and 40 nonzero joint configurations, for either normal sign`,()=>{
    const model=M.scenario(fixture.id);
    const configurations=[[0,0,0],...Array.from({length:40},(_,i)=>[Math.sin(i)*3,Math.cos(i*.7)*2.8,Math.sin(i*1.4)*2.7])];
    for(const sign1 of [1,-1]) for(const sign2 of [1,-1]) {
      const assigned=M.assign(model,[M.scale(model.normals[0].x,sign1),M.scale(model.normals[1].x,sign2)]);
      for(const q of configurations) close(M.dhFK(assigned,q),M.urdfFK(model,q));
    }
  });
}
test('motion previews align x, reach the common normal, align z, then coincide with the target',()=>{
  for(const fixture of M.fixtures) {
    const model=M.scenario(fixture.id);
    model.rows.forEach((values,row)=>{
      const target=model.dhFrames[row+1];
      const turned=M.motionPose(model,row,values,0);close(M.axis(turned,0),M.axis(target,0));
      const translated=M.motionPose(model,row,values,1);
      close(M.norm(M.cross(M.sub(M.origin(target),M.origin(translated)),M.axis(target,0))),0);
      const twisted=M.motionPose(model,row,values,2);close(M.axis(twisted,2),M.axis(target,2));
      close(M.motionPose(model,row,values,3),target);
    });
  }
});
test('fixed boundary frames are necessary, and perturbing a DH offset changes the EE pose',()=>{
  const model=M.scenario('skew'),q=[.3,-.7,.5];
  const incomplete=M.chain(...model.rows.map((r,i)=>M.dh({...r,theta:r.theta+q[i]})),M.rz(q[2]));
  assert.ok(M.distance(incomplete,M.urdfFK(model,q))>.1);
  const wrong=model.rows.map(r=>({...r}));wrong[1].d+=.1;
  assert.ok(M.distance(M.dhFK(model,q,wrong),M.urdfFK(model,q))>.05);
});
test('near-parallel distinct axes still yield a finite, perpendicular common normal',()=>{
  const z=[0,0,1],w=M.unit([1e-5,0,1]);
  const n=M.commonNormal([0,0,0],z,[1,1,1],w);
  assert.equal(n.kind,'skew');assert.ok([...n.start,...n.end,...n.x].every(Number.isFinite));
  close(M.dot(M.sub(n.end,n.start),z),0,1e-5);close(M.dot(M.sub(n.end,n.start),w),0,1e-5);
});
