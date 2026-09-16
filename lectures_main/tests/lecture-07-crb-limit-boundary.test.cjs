const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const atlas=JSON.parse(fs.readFileSync(new URL('../assets/data/lecture07/crb-slice-xy-diverse.json','file://'+__filename)));
const load=async()=>Promise.all(['abbCrbKinematics','abbCrbSlice','abbCrbExamplePath','abbCrbJointLimitCurves'].map(n=>import('../js/viz/'+n+'.js')));
test('q4 boundary curve consists of verified joint-limit IKs and includes both genuine example stops',async()=>{
  const [K,S,E,C]=await load(),slice={...atlas,xmin:-.23,xmax:.23,ymin:-.23,ymax:.23},curve=C.q4LimitCurve(slice);
  assert.ok(curve.lines.length>0);assert.equal(curve.checked,241);
  for(const line of curve.lines)for(let i=0;i<line.length;i+=8){
    const p=line[i],ik=K.inverse(K.makePose([...p,atlas.z],atlas.orientation));
    assert.ok(ik.solutions.some(root=>K.withinLimits(root.q)&&Math.abs(Math.abs(root.q[3])-Math.PI)<1e-6));
  }
  const targets=S.slicePathPoses(E.createCrbExampleLoop().vertices,atlas),roots=K.inverse(targets[0]).solutions;
  for(const i of [3,8]){
    const path=K.followPath(targets,roots[i].q),stop=path.stop;
    assert.equal(stop.joint,3);assert.equal(stop.wrappedEquivalent,true);
    assert.ok(Math.abs(stop.progress-.5837455)<1e-6);assert.ok(Math.abs(stop.boundaryQ[3]-stop.limit)<2e-11);
    assert.ok(Math.abs(stop.attempted)>Math.PI);assert.ok(path.q.every(q=>K.withinLimits(q)));
    const ik=K.inverse(K.makePose(stop.position,atlas.orientation));assert.equal(ik.solutions.filter(root=>root.withinLimits).length,8);
    let distance=Infinity;
    for(const line of curve.lines)for(let k=1;k<line.length;k++){
      const a=line[k-1],b=line[k],v=b.map((x,j)=>x-a[j]),p=stop.position,t=Math.max(0,Math.min(1,v.reduce((s,x,j)=>s+x*(p[j]-a[j]),0)/v.reduce((s,x)=>s+x*x,0)));
      distance=Math.min(distance,Math.hypot(...v.map((x,j)=>a[j]+t*x-p[j])));
    }
    assert.ok(distance<1e-10,'The stop lies on the displayed verified limit curve.');
  }
});
test('the geometric q4-limit equation follows native FK and handles a vertical tool axis explicitly',async()=>{
  const [K,,,C]=await load();
  for(let i=0;i<12;i++)for(const sign of [-1,1]){
    const f=K.fk([.27*i-1,-.8+.15*i,.5-.13*i,sign*Math.PI,-.9+.2*i,.17*i]);
    assert.ok(Math.abs(f.position[0]*f.rotation[1][2]-f.position[1]*f.rotation[0][2])<1e-14);
  }
  const vertical=C.q4LimitCurve({...atlas,orientation:[[1,0,0],[0,1,0],[0,0,1]]});
  assert.deepEqual(vertical.lines,[]);assert.match(vertical.reason,/vertical/);
});
