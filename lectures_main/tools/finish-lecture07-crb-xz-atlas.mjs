/** Finish the native-tool0, fixed-y Lecture 07 CRB atlas.
 * First run the supplied Rust solver:
 * cargo run --release --offline --manifest-path lectures_main/assets/abb_irb_ik/Cargo.toml --example lecture07_atlas_xz > lectures_main/assets/data/lecture07/crb-slice-xz.json
 * Then run this file with Node. Unresolved queries remain errors until the
 * independent browser polynomial solver resolves them; zero is never a fallback.
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as m from '../js/viz/abbCrbKinematics.js';
import { determinantRateBound } from '../js/viz/abbCrbDeterminant.js';

const filename=fileURLToPath(new URL('../assets/data/lecture07/crb-slice-xz.json',import.meta.url));
const atlas=JSON.parse(fs.readFileSync(filename));
atlas.jointLimits=m.jointLimits;
atlas.jointLimitSource={document:'ABB GoFa datasheet 9AKK107991A8564, GoFa 5 movement table',url:'https://library.e.abb.com/public/24de2251a42d4f9badda0232508ff242/9AKK107991A8564_en_F_GoFa%E2%84%A2%20CRB%2015000%20datasheet.pdf',correctedAxis:6,oldRangeDegrees:[-180,180],rangeDegrees:[-270,270]};
atlas.limitHandling='Distinct geometric IKs modulo 2π; one legal representative per branch. Joint 3 may be below −π; axis 6 uses ABB’s ±270° range. Additional axis-6 windings are not counted twice. Counts are unchanged by the axis-6 correction because every geometric branch already has a representative in ±180°. Continuous path tracking never wraps at ±180°.';
const pointAt=i=>[atlas.xmin+(i%atlas.nx)*(atlas.xmax-atlas.xmin)/(atlas.nx-1),atlas.zmin+Math.floor(i/atlas.nx)*(atlas.zmax-atlas.zmin)/(atlas.nz-1)];
const target=point=>m.makePose([point[0],atlas.y,point[1]],atlas.orientation);
const fallback=[];
for(let i=0;i<atlas.counts.length;i++)if(atlas.counts[i]<0){
  const position=pointAt(i),r=m.inverse(target(position));
  if(!r.diagnostics.resolved)throw new Error(`Both solvers left atlas cell ${i} unresolved.`);
  atlas.counts[i]=r.solutions.length;
  atlas.limitCounts[i]=r.solutions.filter(s=>s.withinLimits).length;
  fallback.push({index:i,position:[position[0],atlas.y,position[1]],realCount:atlas.counts[i],limitCount:atlas.limitCounts[i],method:r.diagnostics.method});
}
atlas.generation.rustUnresolvedPoses=fallback.length;
atlas.generation.browserPolynomialFallback=fallback;
atlas.generation.unresolvedPoses=atlas.counts.filter(v=>v<0).length;
const histogram=values=>Object.fromEntries([...new Set(values)].sort((a,b)=>a-b).map(n=>[n,values.filter(v=>v===n).length]));
atlas.histogram={allReal:histogram(atlas.counts),insideLimits:histogram(atlas.limitCounts)};

// Check every count category and a deterministic spread of independent queries.
const checked=new Set([...fallback.map(r=>r.index),...Array.from({length:128},(_,i)=>(i*1543+391)%100000)]);
for(const count of new Set(atlas.counts))checked.add(atlas.counts.indexOf(count));
let maxFkError=0;
for(const i of checked){
  const r=m.inverse(target(pointAt(i)));
  if(!r.diagnostics.resolved||r.solutions.length!==atlas.counts[i]||r.solutions.filter(s=>s.withinLimits).length!==atlas.limitCounts[i])throw new Error(`Rust/browser disagreement at cell ${i}.`);
  for(const s of r.solutions)maxFkError=Math.max(maxFkError,s.positionError,s.rotationError);
}
atlas.generation.independentBrowserChecks={sampledCells:checked.size,indexes:[...checked],maxFkError};

atlas.demonstrationPoint=[.7,.55];
const spec=atlas.demonstrationPath={type:'circle',center:[.3,.55],radius:.4,samples:241};
spec.vertices=Array.from({length:spec.samples},(_,i)=>{const t=2*Math.PI*i/(spec.samples-1);return [spec.center[0]+spec.radius*Math.cos(t),spec.center[1]+spec.radius*Math.sin(t)];});
spec.vertices[spec.vertices.length-1]=[...spec.vertices[0]];
// Match the live lab's discrete interpolation of these task-space vertices.
const targets=[];
for(let k=1;k<spec.vertices.length;k++){
  const a=spec.vertices[k-1],b=spec.vertices[k],n=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/.003));
  for(let j=0;j<n;j++)targets.push(target(a.map((v,l)=>v+(b[l]-v)*j/n)));
}
targets.push(target(spec.vertices.at(-1)));
const inverse=m.inverse(targets[0]);
if(!inverse.diagnostics.resolved)throw new Error('Example start is unresolved.');
atlas.demonstrationResults=inverse.solutions.map((s,i)=>{
  const r=m.followPath(targets,s.q);
  const closure=r.success?m.poseError(m.fk(r.q[0]).matrix,m.fk(r.q.at(-1)).matrix):null;
  let wholeSegmentMinAbsDet=Infinity;
  if(r.success)for(let k=1;k<r.q.length;k++){
    const a=r.q[k-1],b=r.q[k];
    wholeSegmentMinAbsDet=Math.min(wholeSegmentMinAbsDet,Math.min(Math.abs(m.determinant(a)),Math.abs(m.determinant(b)))-determinantRateBound(a,b)/2-1e-11);
  }
  if(r.success&&wholeSegmentMinAbsDet<=0)throw new Error('No positive determinant bound between animation samples.');
  return {startIndex:i,withinLimits:s.withinLimits,success:r.success,failIndex:r.failIndex,reason:r.reason,stop:r.stop,minDet:r.minDet,wholeSegmentMinAbsDet:r.success?wholeSegmentMinAbsDet:null,minLimitMargin:r.minLimitMargin,trackedSamples:r.q.length,maxPositionError:r.maxPositionError,maxRotationError:r.maxRotationError,endpointJointDistance:r.success?Math.hypot(...r.q.at(-1).map((v,k)=>v-r.q[0][k])):null,poseClosure:closure};
});
atlas.demonstrationVerification={targetSamples:targets.length,vertexSamples:spec.samples,maximumTaskStep:.003,startingIKs:inverse.solutions.length,legalStartingIKs:inverse.solutions.filter(s=>s.withinLimits).length,completeBranches:atlas.demonstrationResults.filter(r=>r.success).length,endpoint:'Every completed branch returns to its initial native joint configuration.'};
if(atlas.demonstrationVerification.startingIKs!==8||atlas.demonstrationVerification.legalStartingIKs!==8||atlas.demonstrationVerification.completeBranches!==2||atlas.demonstrationResults.some(r=>r.success?r.endpointJointDistance>1e-6:!/joint limit/.test(r.reason)))throw new Error('Example outcomes changed; inspect before publishing.');
fs.writeFileSync(filename,JSON.stringify(atlas));
console.log(JSON.stringify({histogram:atlas.histogram,generation:atlas.generation,demonstrationVerification:atlas.demonstrationVerification,demonstrationResults:atlas.demonstrationResults},null,2));
