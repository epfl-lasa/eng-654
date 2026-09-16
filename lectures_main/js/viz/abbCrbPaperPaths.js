/** Paper coordinates and independent continuation for the supplied CRB URDF.
 * Source: Elias & Wen (2025), arXiv:2501.18505v2, Eq. (6), Fig. 6.
 * The two MoveL examples are independently generated: the authors' Fig. 3
 * endpoint poses are not included in the public example script.
 */
import {fk, makePose, inverse, refine, determinant, jointLimits, withinLimits, poseError} from './abbCrbKinematics.js';
import {determinantRateBound} from './abbCrbDeterminant.js';

export const paperSource = {
  title: 'Path Planning and Optimization for Cuspidal 6R Manipulators',
  authors: 'Alexander J. Elias and John T. Wen', year: 2025,
  url: 'https://arxiv.org/abs/2501.18505',
  repository: 'https://github.com/rpiRobotics/cuspidal-path-planning',
  sourceCommit: '0dbb7d240f325e230fff175293350f995d3e2acb',
};
export const publishedA = [-.8,.59,2.34,2.72,1.06,-1.84];
export const publishedB = [2.2599,2.1999,2.6677,2.5298,-2.5286,.4831];
export const moveLExamples = [
  {id:'movel-partial',title:'MoveL · some legal starts finish',
    A:[[.6496766946789848,.02555405037654146,-.7597810098313477,.06450434091587368],[-.6653183999480125,-.464417987319463,-.584523190082956,.5941008026259333],[-.3677929024350603,.8852473798681881,-.28471996304246383,.3261434509926242],[0,0,0,1]],
    end:[-.16412638910114766,-.10010983124375344,.6767324831755832]},
  {id:'movel-blocked',title:'MoveL · no legal start finishes',
    A:[[-.4406798063064381,.8640579859395058,-.24332099220553288,-.0589997423293609],[-.8976410845658321,-.42612289666414643,.11251559997633004,.08164997342735517],[-.006464643315493041,.2679982721450307,.963397703191201,1.2689507843266332],[0,0,0,1]],
    end:[-.14745171889662742,.10531234778463841,.2000403022579849]},
];

export function moveLPose(example,s) {
  const a=example.A.slice(0,3).map(row=>row[3]);
  return makePose(a.map((v,k)=>v+(example.end[k]-v)*s),example.A.slice(0,3).map(row=>row.slice(0,3)));
}

/** Follow the unique regular branch using adaptive predictor correction.
 * A derivative bound checks every interpolated joint segment, so a coarse
 * numerical jump is never accepted just because both endpoint poses match.
 * Failure near a fold is reported as a continuation boundary, not as a
 * general proof about all possible task paths between these endpoint poses.
 */
export function traceMoveL(example,start,{intervals=400}={}) {
  const q=[start.slice()],s=[0],sign=Math.sign(determinant(start));
  let minDet=Math.abs(determinant(start)),segmentLowerBound=Infinity;
  function advance(t,depth=0) {
    const last=s.at(-1),a=q.at(-1);
    const solution=refine(moveLPose(example,t),a,{respectLimits:false,tolerance:1e-11,maxIterations:40});
    let lower=-Infinity,okay=false;
    if(solution){
      const d=Math.abs(solution.det),step=Math.max(...a.map((v,k)=>Math.abs(v-solution.q[k])));
      lower=Math.min(d,Math.abs(determinant(a)))-determinantRateBound(a,solution.q)/2-1e-13;
      okay=Math.sign(solution.det)===sign&&d>1e-8&&step<.10&&lower>0;
    }
    if(!okay){
      if(depth>=24||t-last<1e-10)return false;
      return advance((last+t)/2,depth+1)&&advance(t,depth+1);
    }
    q.push(solution.q);s.push(t);minDet=Math.min(minDet,Math.abs(solution.det));segmentLowerBound=Math.min(segmentLowerBound,lower);return true;
  }
  let success=true;
  for(let i=1;i<=intervals;i++)if(!advance(i/intervals)){success=false;break;}
  const limitStop=q.findIndex(values=>!withinLimits(values));
  const stopJoint=limitStop<0?-1:q[limitStop].findIndex((v,k)=>v<jointLimits[k][0]||v>jointLimits[k][1]);
  let maxPositionError=0,maxRotationError=0;
  q.forEach((values,i)=>{const e=poseError(fk(values).matrix,moveLPose(example,s[i]));maxPositionError=Math.max(maxPositionError,e.position);maxRotationError=Math.max(maxRotationError,e.rotation);});
  return {q,s,success,minDet,segmentLowerBound,limitStop,stopJoint,
    legalSuccess:success&&limitStop<0,maxPositionError,maxRotationError,
    reason:success?'The regular branch reaches the final pose.':'The branch approaches a singular continuation boundary.'};
}

export function publishedConnection(samples=401) {
  const target=fk(publishedA).matrix;
  const refined=refine(target,publishedB,{respectLimits:false,tolerance:1e-13});
  if(!refined)throw new Error('The printed paper endpoint could not be refined.');
  const q=Array.from({length:samples},(_,i)=>publishedA.map((v,k)=>v+(refined.q[k]-v)*i/(samples-1)));
  const L=determinantRateBound(publishedA,refined.q),intervals=10000;
  let minDet=Infinity;
  for(let i=0;i<=intervals;i++)minDet=Math.min(minDet,Math.abs(determinant(publishedA.map((v,k)=>v+(refined.q[k]-v)*i/intervals))));
  const lower=minDet-L/(2*intervals)-1e-11;
  if(lower<=0)throw new Error('The paper connection lacks a positive determinant bound.');
  return {id:'published-nscs',title:'Published NSCS · Eq. (6), Fig. 6',type:'nonsingular-change-of-solution',
    attribution:'Eq. (6), Fig. 6 of Elias & Wen (2025). The printed final joint vector is refined to remove four-decimal rounding. This published example exceeds joint limits.',
    source:paperSource,publishedA,publishedB,refinedB:refined.q,
    endpointCorrection:Math.max(...refined.q.map((v,k)=>Math.abs(v-publishedB[k]))),
    originalClosure:poseError(target,fk(publishedB).matrix),closure:poseError(target,fk(refined.q).matrix),
    startSolutions:inverse(target).solutions,
    points:q.map(values=>fk(values).position),
    tracks:[{q,s:q.map((_,i)=>i/(samples-1)),success:true,legalSuccess:false,limitStop:0,stopJoint:2,minDet,segmentLowerBound:lower,reason:'Same full tool pose; a different IK. The published path violates joint limits.'}],
    verification:{denseIntervals:intervals,globalDerivativeBound:L,certifiedMinAbsDet:lower},
  };
}
