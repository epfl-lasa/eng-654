'use strict';
const {test,before}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
let robot,det;
const file=p=>path.join(__dirname,'..',p);
const asModule=s=>`data:text/javascript;base64,${Buffer.from(s).toString('base64')}`;
before(async()=>{
 const coefficients=asModule(fs.readFileSync(file('js/viz/abbCrbCoefficients.js'),'utf8'));
 robot=await import(asModule(fs.readFileSync(file('js/viz/abbCrbKinematics.js'),'utf8').replace('./abbCrbCoefficients.js',coefficients)));
 det=await import(asModule(fs.readFileSync(file('js/viz/abbCrbDeterminant.js'),'utf8')));
});
const attr=(text,name)=>text.match(new RegExp(`${name}="([^"]*)"`))?.[1];
const vec=(text,name)=>attr(text,name).split(/\s+/).map(Number);
const urdf=fs.readFileSync(file('assets/models/abb_gofa/crb15000_5_95.urdf'),'utf8');
const joints=[...urdf.matchAll(/<joint\b([^>]*)>([\s\S]*?)<\/joint>/g)].map(([,head,body])=>({
 type:attr(head,'type'),parent:attr(body.match(/<parent\b([^>]*)/)[1],'link'),child:attr(body.match(/<child\b([^>]*)/)[1],'link'),origin:vec(body.match(/<origin\b([^>]*)/)[1],'xyz'),rpy:vec(body.match(/<origin\b([^>]*)/)[1],'rpy'),axis:body.includes('<axis')?vec(body.match(/<axis\b([^>]*)/)[1],'xyz'):[0,0,0],limits:body.includes('<limit')?[Number(attr(body,'lower')),Number(attr(body,'upper'))]:null
}));
const product=([w,x,y,z],[v,i,j,k])=>[w*v-x*i-y*j-z*k,w*i+x*v+y*k-z*j,w*j-x*k+y*v+z*i,w*k+x*j-y*i+z*v];
const conjugate=([w,x,y,z])=>[w,-x,-y,-z];
const quat=(a,t)=>[Math.cos(t/2),...a.map(x=>x*Math.sin(t/2))];
const rotate=(q,v)=>product(product(q,[0,...v]),conjugate(q)).slice(1);
const add=(a,b)=>a.map((x,i)=>x+b[i]);
const minus=(a,b)=>a.map((x,i)=>x-b[i]);
const trans=m=>m[0].map((_,i)=>m.map(r=>r[i]));
const rot=q=>trans([[1,0,0],[0,1,0],[0,0,1]].map(v=>rotate(q,v)));
const distance=(a,b)=>Math.hypot(...minus(a.flat(),b.flat()));
const qdistance=(a,b)=>Math.hypot(...a.map((v,i)=>Math.atan2(Math.sin(v-b[i]),Math.cos(v-b[i]))));
function sourceFK(q){
 const links={base_link:{p:[0,0,0],r:[1,0,0,0]}};let i=0;
 for(const j of joints){const p=links[j.parent],position=add(p.p,rotate(p.r,j.origin)),[rx,ry,rz]=j.rpy;let r=product(p.r,product(quat([0,0,1],rz),product(quat([0,1,0],ry),quat([1,0,0],rx))));if(j.type==='revolute')r=product(r,quat(j.axis,q[i++]));links[j.child]={p:position,r};}
 return links;
}
function numericJacobian(q){const h=1e-6,ref=sourceFK(q).tool0;return trans(q.map((_,k)=>{const a=q.slice(),b=q.slice();a[k]+=h;b[k]-=h;const u=sourceFK(a).tool0,v=sourceFK(b).tool0;return [...minus(u.p,v.p).map(x=>x/(2*h)),...product(minus(u.r,v.r).map(x=>x/(2*h)),conjugate(ref.r)).slice(1).map(x=>2*x)];}));}
function cofactor(m){if(m.length===1)return m[0][0];return m[0].reduce((s,v,i)=>s+(i%2?-1:1)*v*cofactor(m.slice(1).map(r=>r.filter((_,j)=>i!==j))),0);}
const atlas=JSON.parse(fs.readFileSync(file('assets/data/lecture07/crb-slice.json')));
const loop=JSON.parse(fs.readFileSync(file('assets/data/lecture07/crb-nscs.json')));

test('CRB FK and every mesh frame match independent quaternion propagation through the supplied URDF',()=>{
 for(let i=0;i<40;i++){const q=robot.jointLimits.map(([l,h],k)=>l+(h-l)*(.5+.44*Math.sin((i+1)*(k+2)*.617))),source=sourceFK(q),f=robot.fk(q);
  for(const [name,T]of Object.entries(f.links)){assert.ok(distance(T.slice(0,3).map(r=>r[3]),source[name].p)<3e-14,name);assert.ok(distance(T.slice(0,3).map(r=>r.slice(0,3)),rot(source[name].r))<3e-14,name);}
 }
});
test('all 7,628 reference branches at all 1,000 poses are recovered by the browser polynomial solver',()=>{
 const fixture=JSON.parse(fs.readFileSync(file('assets/abb_irb_ik/tests/data/reference_1000.json')));let count=0;
 for(let i=0;i<fixture.cases.length;i++){const c=fixture.cases[i],result=robot.inverse(c.pose);assert.equal(result.diagnostics.resolved,true,`unresolved pose ${i}`);assert.equal(result.solutions.length,c.solutions.length,`branch count ${i}`);for(const q of c.solutions)assert.ok(result.solutions.some(s=>qdistance(q,s.q)<2e-6),`missing branch ${i}`);for(const s of result.solutions){const f=sourceFK(s.q).tool0;assert.ok(distance(f.p,[c.pose[3],c.pose[7],c.pose[11]])<2e-8);assert.ok(distance(rot(f.r),[c.pose.slice(0,3),c.pose.slice(4,7),c.pose.slice(8,11)])<2e-8);}count+=result.solutions.length;}
 assert.equal(count,7628);
});
test('native joint 3 representatives below −π are included without wrapping across mechanical stops',()=>{
 assert.deepEqual(robot.jointLimits,joints.filter(j=>j.type==='revolute').map(j=>j.limits));
 const legal=robot.legalRepresentative([.2,-.5,3,1,-.3,.9]);assert.ok(legal[2]<-Math.PI);assert.equal(robot.withinLimits(legal),true);
 const q=[.2,-.5,2,1,-.3,.9];assert.equal(robot.withinLimits(robot.legalRepresentative(q)),false);
 const result=robot.inverse(robot.fk(legal).matrix);assert.ok(result.solutions.some(s=>s.withinLimits&&distance(s.q,legal)<2e-8));
});
test('trigonometric determinant and geometric Jacobian agree with independent URDF finite differences',()=>{
 for(let i=0;i<18;i++){const q=robot.jointLimits.map(([l,h],k)=>l+(h-l)*(.5+.4*Math.sin((i+1)*(k+1)*.79)));const J=numericJacobian(q),expected=cofactor(J);assert.ok(distance(robot.jacobian(q),J)<3e-9);assert.ok(Math.abs(det.trigonometricDeterminant(q)-expected)<3e-10);assert.ok(Math.abs(robot.determinant(q)-expected)<3e-10);}
});
test('atlas records exactly 100,000 solved poses, legal counts, and honest recovery provenance',()=>{
 assert.equal(atlas.sampleCount,100000);assert.equal(atlas.nx*atlas.ny,100000);assert.equal(atlas.counts.length,100000);assert.equal(atlas.limitCounts.length,100000);assert.equal(atlas.z,.2);assert.equal(atlas.rowOrder,'y-increasing');assert.equal(atlas.generation.targetPoses,100000);assert.equal(atlas.generation.unresolvedPoses,0);assert.equal(atlas.generation.rustUnresolvedPoses,5);
 for(let i=0;i<atlas.counts.length;i++){assert.ok(atlas.counts[i]>=0&&atlas.counts[i]<=16);assert.ok(atlas.limitCounts[i]>=0&&atlas.limitCounts[i]<=atlas.counts[i]);}
 const indexes=[...atlas.generation.browserPolynomialFallback.map(r=>r.index),...Array.from({length:64},(_,i)=>(i*1543+391)%100000)];
 for(const i of indexes){const x=atlas.xmin+(i%atlas.nx)*(atlas.xmax-atlas.xmin)/(atlas.nx-1),y=atlas.ymin+Math.floor(i/atlas.nx)*(atlas.ymax-atlas.ymin)/(atlas.ny-1),r=robot.inverse(robot.makePose([x,y,atlas.z],atlas.orientation));assert.equal(r.diagnostics.resolved,true);assert.equal(r.solutions.length,atlas.counts[i],`atlas ${i}`);assert.equal(r.solutions.filter(s=>s.withinLimits).length,atlas.limitCounts[i],`limit count ${i}`);}
});
test('large fixed-orientation XY path starts with eight legal IKs; seven meet limits and one completes',()=>{
 const targets=Array.from({length:241},(_,i)=>robot.makePose([.4+.25*Math.cos(2*Math.PI*i/240),.2+.25*Math.sin(2*Math.PI*i/240),.2],atlas.orientation)),solutions=robot.inverse(targets[0]).solutions;
 assert.equal(solutions.length,8);assert.ok(solutions.every(s=>s.withinLimits));const results=solutions.map(s=>robot.followPath(targets,s.q));assert.equal(results.filter(s=>s.success).length,1);
 for(const r of results){assert.ok(r.q.every(q=>robot.withinLimits(q)));if(r.success){assert.equal(r.q.length,241);assert.ok(r.minDet>.005);assert.ok(r.maxPositionError<2e-9);assert.ok(r.maxRotationError<2e-9);}else{assert.match(r.reason,/[Jj]oint.*limit/);assert.ok(r.failIndex>0&&r.failIndex<241);}}
});
test('CRB NSCS closes the full tool pose on a distinct IK within joint limits and stays nonsingular between all samples',()=>{
 assert.equal(loop.q.length,401);assert.ok(distance(loop.q[0],loop.q.at(-1))>6);const closure=robot.poseError(robot.fk(loop.q[0]).matrix,robot.fk(loop.q.at(-1)).matrix);assert.ok(closure.position<2e-12&&closure.rotation<2e-12);assert.notEqual(loop.startIndex,loop.endIndex);assert.ok(loop.metrics.minLimitMargin>.02);
 for(let i=0;i<loop.q.length;i++){assert.ok(robot.withinLimits(loop.q[i]));assert.ok(distance(robot.fk(loop.q[i]).matrix,loop.poses[i])<2e-13);}
 const proof=loop.verification.wholeSegment,a=loop.q[0],b=loop.q.at(-1),L=det.determinantRateBound(a,b);assert.ok(Math.abs(L-proof.globalDerivativeBound)<1e-12);let min=Infinity;const sign=Math.sign(robot.determinant(a));
 for(let i=0;i<=10000;i++){const q=a.map((v,k)=>v+(b[k]-v)*i/10000),d=robot.determinant(q);assert.equal(Math.sign(d),sign);min=Math.min(min,Math.abs(d));}
 const lowerBound=min-L/20000-1e-11;assert.ok(lowerBound>.0075);assert.ok(Math.abs(lowerBound-proof.certifiedMinAbsDet)<2e-14);assert.equal(loop.verification.missingAlongPath,0);
});

test('both half-angle charts include q6 = π and input poses reject invalid homogeneous rows',()=>{
 const q=[.2,-.5,-.7,1.1,-.3,Math.PI],target=robot.fk(q).matrix,result=robot.inverse(target);
 assert.ok(result.solutions.some(s=>qdistance(s.q,q)<2e-6));
 target[3][0]=1;assert.throws(()=>robot.inverse(target),/homogeneous/);
});
