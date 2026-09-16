/** After running the Rust atlas example, recover any unresolved queries with the
 * independent real-root isolator and record the default path's branch outcomes.
 * No unresolved query is silently converted to zero IK solutions.
 */
import fs from 'node:fs';import {fileURLToPath} from 'node:url';
import * as m from '../js/viz/abbCrbKinematics.js';
const filename=fileURLToPath(new URL('../assets/data/lecture07/crb-slice.json',import.meta.url));
const a=JSON.parse(fs.readFileSync(filename));const unresolved=[];
for(let i=0;i<a.counts.length;i++)if(a.counts[i]<0){
 const x=a.xmin+(i%a.nx)*(a.xmax-a.xmin)/(a.nx-1),y=a.ymin+Math.floor(i/a.nx)*(a.ymax-a.ymin)/(a.ny-1),r=m.inverse(m.makePose([x,y,a.z],a.orientation));
 const record={index:i,position:[x,y,a.z],resolved:r.diagnostics.resolved,method:r.diagnostics.method};
 if(r.diagnostics.resolved){a.counts[i]=r.solutions.length;a.limitCounts[i]=r.solutions.filter(s=>s.withinLimits).length;record.realCount=a.counts[i];record.limitCount=a.limitCounts[i];record.maxFkError=Math.max(0,...r.solutions.map(s=>Math.max(s.positionError,s.rotationError)));}
 unresolved.push(record);
}
if(unresolved.length){a.generation.rustUnresolvedPoses=unresolved.length;a.generation.browserPolynomialFallback=unresolved;}
a.generation.unresolvedPoses=a.counts.filter(x=>x<0).length;
a.jointLimits=m.jointLimits;
a.jointLimitSource='ABB GoFa datasheet 9AKK107991A8564, GoFa 5 movement table; axis 6 corrected to ±270 degrees.';
a.solver='Supplied Rust adaptive degree-16 solver; unresolved queries rechecked with the browser 160-bit coefficient / real-root isolation port.';
a.demonstrationPoint=[.65,.2];a.demonstrationPath={type:'circle',center:[.4,.2],radius:.25,samples:241};
const poses=Array.from({length:241},(_,i)=>m.makePose([.4+.25*Math.cos(2*Math.PI*i/240),.2+.25*Math.sin(2*Math.PI*i/240),a.z],a.orientation));
a.demonstrationResults=m.inverse(poses[0]).solutions.map((s,i)=>{const r=m.followPath(poses,s.q);return {startIndex:i,success:r.success,failIndex:r.failIndex,reason:r.reason,minDet:r.minDet,minLimitMargin:r.minLimitMargin};});
fs.writeFileSync(filename,JSON.stringify(a));console.log({samples:a.sampleCount,rustUnresolved:a.generation.rustUnresolvedPoses,stillUnresolved:a.generation.unresolvedPoses,demonstrationResults:a.demonstrationResults});
