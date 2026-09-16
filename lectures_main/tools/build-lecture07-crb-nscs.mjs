/** Regenerate the Lecture 07 CRB nonsingular change of solution.
 * Run: node --experimental-default-type=module lectures_main/tools/build-lecture07-crb-nscs.mjs
 * Search verified IK branches from 1,000 supplied FK targets; test a joint-space
 * segment between every legal same-sign pair; select a large visible loop.
 */
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import * as m from '../js/viz/abbCrbKinematics.js';
import {trigonometricDeterminant,determinantRateBound} from '../js/viz/abbCrbDeterminant.js';
const path=p=>fileURLToPath(new URL(p,import.meta.url));
const cases=JSON.parse(fs.readFileSync(path('../assets/abb_irb_ik/tests/data/reference_1000.json'))).cases;
let best=null,testedPairs=0;
for(let index=0;index<cases.length;index++){
 const c=cases[index],solutions=c.solutions.map(q=>m.legalRepresentative(q)).filter(q=>m.withinLimits(q)).map(q=>({q,det:m.determinant(q)}));
 for(let i=0;i<solutions.length;i++)for(let j=i+1;j<solutions.length;j++){
  const a=solutions[i],b=solutions[j],distance=Math.hypot(...a.q.map((v,k)=>v-b.q[k]));
  if(Math.sign(a.det)!==Math.sign(b.det)||distance<1.5||distance>7||Math.min(Math.abs(a.det),Math.abs(b.det))<.001)continue;
  let ds=[],qs=[],okay=true;testedPairs++;
  for(let k=0;k<=100;k++){const q=a.q.map((v,l)=>v+(b.q[l]-v)*k/100),d=trigonometricDeterminant(q);if(Math.sign(d)!==Math.sign(a.det)||Math.abs(d)<.0001){okay=false;break;}ds.push(Math.abs(d));qs.push(q);}
  if(!okay)continue;
  const poses=qs.map(q=>m.fk(q).matrix),extent=[0,1,2].map(k=>Math.max(...poses.map(p=>p[k][3]))-Math.min(...poses.map(p=>p[k][3]))),score=Math.min(...ds)*Math.hypot(...extent);
  if(Math.hypot(...extent)>=.15&&(!best||score>best.score))best={caseIndex:index,i,j,score,start:a.q,end:b.q,extent,distance};
 }
}
if(!best)throw new Error('No verified candidate found.');
const q=Array.from({length:401},(_,i)=>best.start.map((v,k)=>v+(best.end[k]-v)*i/400)),poses=q.map(q=>m.fk(q).matrix),dets=q.map(m.determinant);
const startSolutions=m.inverse(poses[0]).solutions;
const nearest=q=>startSolutions.reduce((best,s,i)=>Math.hypot(...s.q.map((v,k)=>m.wrap(v-q[k])))<best.distance?{index:i,distance:Math.hypot(...s.q.map((v,k)=>m.wrap(v-q[k])))}:best,{index:-1,distance:Infinity}).index;
const denseIntervals=10000,globalDerivativeBound=determinantRateBound(best.start,best.end);
let sampledMin=Infinity,maxFkError=0,missingAlongPath=0;
for(let i=0;i<=denseIntervals;i++){const x=best.start.map((v,k)=>v+(best.end[k]-v)*i/denseIntervals);sampledMin=Math.min(sampledMin,Math.abs(trigonometricDeterminant(x)));}
const certifiedLowerBound=sampledMin-globalDerivativeBound/(2*denseIntervals)-1e-11;
if(certifiedLowerBound<=0)throw new Error('The segment has no positive whole-interval determinant bound.');
// Re-solve the full pose at every animation sample and recover the path branch.
for(let i=0;i<q.length;i++){
 const r=m.inverse(poses[i]),nearest=r.solutions.reduce((v,s)=>Math.min(v,Math.hypot(...q[i].map((x,k)=>m.wrap(x-s.q[k])))),Infinity);
 if(!r.diagnostics.resolved||nearest>2e-6)missingAlongPath++;
 maxFkError=Math.max(maxFkError,...r.solutions.map(s=>Math.max(s.positionError,s.rotationError)));
}
if(missingAlongPath)throw new Error(`${missingAlongPath} FK/IK samples failed branch recovery.`);
const closure=m.poseError(poses[0],poses.at(-1));
const data={formatVersion:1,robot:'ABB CRB15000-5/0.95',frame:'tool0',type:'nonsingular-change-of-solution',orientation:'Varies along the path; the complete tool pose closes exactly.',q,poses,determinants:dets,startSolutions,startIndex:nearest(q[0]),endIndex:nearest(q.at(-1)),jointLimits:m.jointLimits,jointLimitSource:'ABB GoFa datasheet 9AKK107991A8564; axis 6 ±270 degrees',metrics:{sampleCount:q.length,minDet:sampledMin,minLimitMargin:Math.min(...q.flatMap(q=>q.map((v,k)=>Math.min(v-m.jointLimits[k][0],m.jointLimits[k][1]-v)))),positionClosure:closure.position,rotationClosure:closure.rotation,jointEndpointDistance:best.distance,taskExtent:best.extent,maxPositionError:maxFkError,maxRotationError:maxFkError},verification:{searchedFkTargets:cases.length,testedSameSignJointSegments:testedPairs,selectedReferenceCase:best.caseIndex,verifiedFkIkSamples:q.length,missingAlongPath,wholeSegment:{method:'Termwise trigonometric derivative bound, with a 1e-11 determinant roundoff allowance',denseIntervals,globalDerivativeBound,sampledMinAbsDet:sampledMin,certifiedMinAbsDet:certifiedLowerBound},jointLimits:'The path is a straight line in native joint coordinates inside their convex limit box; no angle wrap crosses a mechanical stop.',collisionChecking:'Not performed; this example establishes kinematic nonsingularity and joint-limit feasibility.'}};
fs.writeFileSync(path('../assets/data/lecture07/crb-nscs.json'),JSON.stringify(data));
console.log(JSON.stringify({metrics:data.metrics,verification:data.verification,startIndex:data.startIndex,endIndex:data.endIndex},null,2));
