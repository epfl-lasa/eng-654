const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
require('../js/exercises/exercise-02-expressions.js');
const key=JSON.parse(fs.readFileSync('lectures_main/solutions/exercise_03_answers.json'));
const bonus=key.reference.bonus;
const trees=bonus.matrixExpressions.map(row=>row.map(globalThis.Exercise02Expressions.parse));
const mv=(a,v)=>a.map(row=>row.reduce((sum,x,i)=>sum+x*v[i],0));
const point=t=>t.slice(0,3).map(row=>row[3]);
const rotation=t=>t.slice(0,3).map(row=>row.slice(0,3));
const minus=(a,b)=>a.map((x,i)=>x-b[i]);
function variables(q){
  const vars={...bonus.lengths};
  q.forEach((v,i)=>{vars['c'+(i+1)]=Math.cos(v);vars['s'+(i+1)]=Math.sin(v);});
  vars.s23=Math.sin(q[1]+q[2]);vars.c23=Math.cos(q[1]+q[2]);
  vars.r=vars.a2*vars.s2+vars.a3*vars.s23;vars.h=vars.a5+vars.d4*vars.s5;
  return vars;
}
function symbolic(q){
  const vars=variables(q);
  return trees.map(row=>row.map(tree=>globalThis.Exercise02Expressions.evaluate(tree,vars)));
}
test('bonus determinant expression matches the full tool Jacobian, including aligned wrist directions',async()=>{
  const k=await import('../js/viz/abbCrbKinematics.js');
  const expression=globalThis.Exercise02Expressions.parse(bonus.determinant.expression);
  assert.equal(key.answers['bonus.determinant'],bonus.determinant.expression);
  const configurations=[bonus.numeric.q,...Array.from({length:40},(_,i)=>Array.from({length:6},(_,j)=>Math.PI*Math.sin(i*1.71+j*.92)))];
  for(const q5 of [0,Math.PI]){const q=bonus.numeric.q.slice();q[4]=q5;configurations.push(q);}
  for(const q of configurations){
    const actual=globalThis.Exercise02Expressions.evaluate(expression,variables(q));
    assert.ok(Math.abs(actual-k.detMatrix(k.jacobian(q)))<3e-14);
  }
  const aligned=bonus.numeric.q.slice();aligned[4]=0;
  assert.ok(Math.abs(k.detMatrix(k.jacobian(aligned)))>.001,'The wrist offset can preserve full rank when sin(q5)=0.');
});
test('instructor bonus matrix is the full tool twist shifted to O4 and expressed in frame 3',async()=>{
  const k=await import('../js/viz/abbCrbKinematics.js');
  const configurations=[bonus.numeric.q,...Array.from({length:18},(_,i)=>Array.from({length:6},(_,j)=>1.8*Math.sin(i*1.71+j*.92)))];
  for(const q of configurations){
    const f=k.fk(q),R30=k.transpose(rotation(f.links.link_3)),p4=point(f.links.link_4),J=symbolic(q);
    const columns=f.axes.map((axis,i)=>[...mv(R30,k.cross(axis,minus(p4,f.origins[i]))),...mv(R30,axis)]);
    J.forEach((row,r)=>row.forEach((value,c)=>assert.ok(Math.abs(value-columns[c][r])<3e-14)));
    assert.ok(Math.abs(k.detMatrix(J)-k.detMatrix(k.jacobian(q)))<3e-14);
    // Hold the reference point's TOOL coordinates fixed during differentiation.
    // Its world position equals O4 at q, but it follows the full tool motion.
    const offset=mv(k.transpose(f.rotation),minus(p4,f.position));
    const virtualPoint=angles=>{const pose=k.fk(angles),shift=mv(pose.rotation,offset);return pose.position.map((v,i)=>v+shift[i]);};
    for(let c=0;c<6;c++){
      const plus=q.slice(),sub=q.slice(),h=1e-6;plus[c]+=h;sub[c]-=h;
      const velocity=mv(R30,minus(virtualPoint(plus),virtualPoint(sub)).map(v=>v/(2*h)));
      velocity.forEach((value,r)=>assert.ok(Math.abs(value-J[r][c])<8e-9));
    }
  }
});
test('the saved bonus checkpoint and uploadable answer agree with the symbolic matrix',()=>{
  const J=symbolic(bonus.numeric.q);
  J.forEach((row,r)=>row.forEach((value,c)=>assert.ok(Math.abs(value-bonus.numeric.matrix[r][c])<2e-14)));
  bonus.matrixExpressions.forEach((row,r)=>row.forEach((expression,c)=>assert.equal(key.answers[`bonus.J.${r+1}.${c+1}`],expression)));
  assert.equal(Object.keys(key.answers).filter(name=>name.startsWith('bonus.J.')).length,36);
  assert.ok(key.answers['bonus.crb-jacobian'].length>500&&key.answers['bonus.crb-jacobian'].length<=4000);
  assert.ok(Math.hypot(...J.slice(0,3).map(row=>row[5]))>.1,'The full tool-twist column 6 remains present after shifting to O4.');
});
