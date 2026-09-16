/** Reproduce Eq. (6) and regenerate independent MoveL adaptations of Fig. 3.
 * node --experimental-default-type=module lectures_main/tools/build-lecture07-crb-paper.mjs
 */
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {inverse,wrap,jointLimits} from '../js/viz/abbCrbKinematics.js';
import {paperSource,publishedConnection,moveLExamples,moveLPose,traceMoveL} from '../js/viz/abbCrbPaperPaths.js';

const examples=[publishedConnection()];
for(const specification of moveLExamples){
  const layers=[];
  for(let i=0;i<=200;i++){
    const result=inverse(moveLPose(specification,i/200));
    if(!result.diagnostics.resolved)throw new Error(`${specification.id}: unresolved IK layer ${i}`);
    layers.push({s:i/200,q:result.solutions.map(solution=>solution.q),legal:result.solutions.map(solution=>solution.withinLimits)});
  }
  const starts=inverse(specification.A).solutions,finalLayer=layers.at(-1);
  const tracks=starts.map((solution,index)=>{
    const track=traceMoveL(specification,solution.q);
    const nearest=finalLayer.q.map(q=>Math.hypot(...q.map((v,k)=>wrap(v-track.q.at(-1)[k]))));
    track.startIndex=index;track.endIndex=track.success?nearest.indexOf(Math.min(...nearest)):-1;
    if(track.success&&Math.min(...nearest)>1e-6)throw new Error('The final branch does not match enumerated IK.');
    if(!track.success){
      const last=track.s.at(-1),delta=1e-6,q=track.q.at(-1);
      const before=inverse(moveLPose(specification,last-delta)),after=inverse(moveLPose(specification,last+delta));
      const distance=solutions=>Math.min(...solutions.map(a=>Math.hypot(...a.q.map((v,k)=>wrap(v-q[k])))));
      track.boundaryVerification={delta,beforeCount:before.solutions.length,afterCount:after.solutions.length,
        beforeDistance:distance(before.solutions),afterDistance:distance(after.solutions),
        resolved:before.diagnostics.resolved&&after.diagnostics.resolved};
      if(!track.boundaryVerification.resolved||before.solutions.length-after.solutions.length!==2)throw new Error('The stopping branch lacks a verified local two-root disappearance.');
      for(const offset of [-1e-4,-delta,delta,1e-4]){
        const s=last+offset,r=inverse(moveLPose(specification,s));
        if(!r.diagnostics.resolved)throw new Error('Unresolved extra boundary layer.');
        layers.push({s,q:r.solutions.map(solution=>solution.q),legal:r.solutions.map(solution=>solution.withinLimits)});
      }
    }
    return track;
  });
  layers.sort((a,b)=>a.s-b.s);
  examples.push({...specification,type:'movel',
    attribution:'Same path type as Fig. 3; independently generated coordinates and recomputed outcomes. These are not the unpublished Fig. 3 endpoint poses.',
    source:paperSource,startSolutions:starts,layers,points:layers.map(layer=>moveLPose(specification,layer.s).slice(0,3).map(row=>row[3])),tracks,
    metrics:{initialIks:starts.length,finalIks:layers.at(-1).q.length,initialLegalIks:starts.filter(s=>s.withinLimits).length,
      mathematicalCompletions:tracks.filter(track=>track.success).length,legalCompletions:tracks.filter(track=>track.legalSuccess).length,
      minSampledIks:Math.min(...layers.map(layer=>layer.q.length)),maxSampledIks:Math.max(...layers.map(layer=>layer.q.length)),
      pathLength:Math.hypot(...specification.end.map((v,k)=>v-specification.A[k][3])),
      maxPositionError:Math.max(...tracks.map(track=>track.maxPositionError)),maxRotationError:Math.max(...tracks.map(track=>track.maxRotationError))},
    verification:{targetLayers:layers.length,adaptiveTracking:true,maximumJointStep:.1,
      method:'Same-sign local continuation with recursive step refinement. Every accepted joint segment has a positive determinant derivative bound. Native joint stops are checked without wrapping.',
      limitation:'Numerical sampled path analysis. Collision, torque, velocity and acceleration limits are outside this calculation.'},
  });
  console.log(specification.id,JSON.stringify(examples.at(-1).metrics));
}
const result={formatVersion:1,robot:'ABB CRB15000-5/0.95',frame:'tool0',source:paperSource,jointLimits,jointLimitSource:'ABB GoFa datasheet 9AKK107991A8564; axis 6 ±270 degrees',
  note:'The paper Fig. 6 path is reproduced with a disclosed rounding correction. MoveL paths are independently generated adaptations of Fig. 3.',examples};
fs.writeFileSync(fileURLToPath(new URL('../assets/data/lecture07/crb-paper-paths.json',import.meta.url)),JSON.stringify(result));
console.log('Published Fig. 6:',JSON.stringify({closure:examples[0].closure,correction:examples[0].endpointCorrection,lowerBound:examples[0].verification.certifiedMinAbsDet}));
