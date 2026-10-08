const test=require('node:test');
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const path=require('node:path');
const M=require('../dh-model.js'),R=require('../dh-robots.js');
// Independently read the actual assets and evaluate URDF fixed-axis RPY.
const script=String.raw`
import sys,json,math,xml.etree.ElementTree as E
def vec(node,key,default):
 return [float(v) for v in node.get(key).split()] if node is not None and node.get(key) else default
def origin(node):
 o=node.find('origin'); x,y,z=vec(o,'xyz',[0,0,0]); r,p,yaw=vec(o,'rpy',[0,0,0])
 cr,sr,cp,sp,cy,sy=math.cos(r),math.sin(r),math.cos(p),math.sin(p),math.cos(yaw),math.sin(yaw)
 return [[cy*cp,cy*sp*sr-sy*cr,cy*sp*cr+sy*sr,x],[sy*cp,sy*sp*sr+cy*cr,sy*sp*cr-cy*sr,y],[-sp,cp*sr,cp*cr,z],[0,0,0,1]]
result=[]
for filename in sys.argv[1:]:
 robot=E.parse(filename).getroot()
 result.append({'name':robot.get('name'),'links':[{'name':l.get('name'),'visuals':[]} for l in robot.findall('link')],
 'joints':[{'name':j.get('name'),'type':j.get('type'),'parent':j.find('parent').get('link'),'child':j.find('child').get('link'),'origin':origin(j),'axis':vec(j.find('axis'),'xyz',[1,0,0])} for j in robot.findall('joint') if j.get('type')]})
print(json.dumps(result))
`;
const data=JSON.parse(execFileSync('python3',['-c',script,...R.catalog.map(spec=>path.join(__dirname,'../../lectures_main/assets/models',spec.folder,spec.file))],{encoding:'utf8'}));
const counts=[3,3,6,6,7,6,6,6,6,7];
R.catalog.forEach((spec,index)=>{
  test(`${spec.id}: complete serial chain and one DH row per joint reproduce the asset's endpoint`,()=>{
    const model=R.fromData(data[index],spec);
    assert.equal(model.frames.length,counts[index]);assert.equal(model.rows.length,counts[index]);assert.equal(model.dhFrames.length,counts[index]+1);
    assert.ok(model.normals.at(-1).terminal);
    for(let i=0;i<25;i++) {
      const q=model.frames.map((_,j)=>Math.sin(i*(j+1)*.73));
      const physical=R.linkPoses(model,q)[model.robot.endpoint],dh=M.dhFK(model,q);
      assert.ok(M.distance(physical,M.urdfFK(model,q))<1e-8,`${spec.id}: collapsed URDF chain`);
      assert.ok(M.distance(physical,dh)<1e-6,`${spec.id}: DH mismatch ${M.distance(physical,dh)}`);
    }
    assert.ok(Math.max(...model.dhFrames.flat(2).map(Math.abs))<30,'nearly parallel input axes do not create distant artificial frames');
  });
});
test('6R assets retain their final joint even when tool0 attaches to joint 3',()=>{
  for(const id of ['custom6r','curo6r']) {
    const i=R.catalog.findIndex(s=>s.id===id),model=R.fromData(data[i],R.catalog[i]);
    assert.equal(model.robot.endpoint,'link_6');assert.equal(model.frames.at(-1).name,'joint_6');
  }
});
test('negative FANUC axes retain the joint variable sign',()=>{
  const i=R.catalog.findIndex(s=>s.id==='fanuc'),model=R.fromData(data[i],R.catalog[i]);
  assert.ok(model.frames.some(f=>f.axisSign===-1));
  const q=model.frames.map((_,j)=>(j+1)*.13);assert.ok(M.distance(M.dhFK(model,q),R.linkPoses(model,q)[model.robot.endpoint])<1e-6);
});
test('terminal frame extends case exercises to a complete table without exposing tool orientation as DH twist',()=>{
  for(const fixture of M.fixtures) {
    const model=M.complete(M.scenario(fixture.id));assert.equal(model.rows.length,3);assert.ok(Math.abs(model.rows.at(-1).alpha)<1e-8);
    for(const sign of [1,-1]) {
      const assigned=M.assign(model,model.normals.map(n=>M.scale(n.x,sign)));
      assert.ok(M.distance(M.urdfFK(assigned,[.3,-.5,.9]),M.dhFK(assigned,[.3,-.5,.9]))<1e-8);
    }
  }
});
