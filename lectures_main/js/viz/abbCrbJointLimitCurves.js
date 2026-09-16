import { fk, makePose, withinLimits, legalRepresentative, poseError } from './abbCrbKinematics.js';

/** At q4=π the positional chain reduces to a planar 2R solve. The last
 * offset is Ry(v)[d6,0,-a5], with v=q2+q3-q5. Tool0's z axis fixes v and
 * the two possible headings q1. Validate the reconstructed native pose. */
export function inverseAtQ4Boundary(position,orientation) {
  const axis=orientation.map(row=>row[2]),horizontal=Math.hypot(axis[0],axis[1]);
  if(horizontal<1e-8)return [];
  const solutions=[],a2=.444,a3=.110,d4=.470,d1=.265,d6=.101,a5=.080,L=Math.hypot(a3,d4),alpha=Math.atan2(d4,a3),target=makePose(position,orientation);
  for(const sign of [1,-1]){
    const q1=Math.atan2(sign*axis[1],sign*axis[0]),v=Math.atan2(-axis[2],sign*horizontal),c=Math.cos(q1),s=Math.sin(q1);
    const x=c*position[0]+s*position[1]-d6*Math.cos(v)+a5*Math.sin(v),z=position[2]-d1+d6*Math.sin(v)+a5*Math.cos(v);
    const cosine=(x*x+z*z-a2*a2-L*L)/(2*a2*L);if(Math.abs(cosine)>1+1e-12)continue;
    const yAxis=[-s,c,0],zAxis=[-axis[2]*c,-axis[2]*s,horizontal*sign],toolY=orientation.map(row=>row[1]);
    const dot=(a,b)=>a.reduce((sum,x,i)=>sum+x*b[i],0),q6=Math.atan2(dot(zAxis,toolY),dot(yAxis,toolY))-Math.PI;
    for(const beta of [Math.acos(Math.max(-1,Math.min(1,cosine))),-Math.acos(Math.max(-1,Math.min(1,cosine)))]){
      const q2=Math.atan2(x,z)-Math.atan2(L*Math.sin(beta),a2+L*Math.cos(beta)),q3=beta-alpha,q=legalRepresentative([q1,q2,q3,Math.PI,q2+q3-v,q6]);
      const error=poseError(fk(q).matrix,target);
      if(error.position<2e-7&&error.rotation<2e-7)solutions.push({q,withinLimits:withinLimits(q)});
    }
  }
  return solutions;
}

/** Native GoFa q4 = ±π: axes 2, 3 and 5 are parallel, and all link
 * translations lie in the same vertical plane. Tool0's z axis lies there too.
 * Consequently x*R[1][2] - y*R[0][2] = 0. This necessary locus also contains
 * q4=0 configurations: retain only portions with a verified legal q4=±π IK.
 * This is a joint-boundary overlay, separate from the pose-wise IK count. */
export function q4LimitCurve(slice, samples = 241) {
  const d = [slice.orientation[0][2], slice.orientation[1][2]], length = Math.hypot(...d);
  if (length < 1e-8) return {lines:[],checked:0,reason:'The tool axis is vertical; the q4 boundary does not project to a single line.'};
  const direction=d.map(x=>x/length),bounds=[[slice.xmin,slice.xmax],[slice.ymin,slice.ymax]];
  let lo=-Infinity,hi=Infinity;
  for(let i=0;i<2;i++) {
    if(Math.abs(direction[i])<1e-12){if(bounds[i][0]>0||bounds[i][1]<0)return {lines:[],checked:0};continue;}
    const ends=bounds[i].map(x=>x/direction[i]);lo=Math.max(lo,Math.min(...ends));hi=Math.min(hi,Math.max(...ends));
  }
  if(lo>=hi)return {lines:[],checked:0};
  const lines=[];let line=[];
  for(let k=0;k<samples;k++) {
    const t=lo+(hi-lo)*k/(samples-1),p=direction.map(x=>x*t),solutions=inverseAtQ4Boundary([...p,slice.z],slice.orientation);
    const valid=solutions.some(root=>root.withinLimits);
    if(valid)line.push(p);else{if(line.length>1)lines.push(line);line=[];}
  }
  if(line.length>1)lines.push(line);
  return {lines,checked:samples,joint:3,limits:[-Math.PI,Math.PI]};
}
