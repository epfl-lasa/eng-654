import { inverse, makePose } from './abbCrbKinematics.js';

/** Active rotations: tool orientation in world coordinates, Rz(yaw) Ry(pitch) Rx(roll). */
export function orientationZYX([yaw, pitch, roll]) {
  const c=Math.cos, s=Math.sin, cy=c(yaw),sy=s(yaw),cp=c(pitch),sp=s(pitch),cr=c(roll),sr=s(roll);
  return [[cy*cp,cy*sp*sr-sy*cr,cy*sp*cr+sy*sr],
    [sy*cp,sy*sp*sr+cy*cr,sy*sp*cr-cy*sr],[-sp,cp*sr,cp*cr]];
}

export const slicePosition = (point, slice) => slice.plane === 'xy' ? [point[0], point[1], slice.z] : [point[0], slice.y, point[1]];
export const sliceProjection = (point, slice) => slice.plane === 'xy' ? point.slice(0,2) : [point[0],point[2]];

export function slicePathPoses(vertices, slice) {
  const targets=[];
  for (let k=1;k<vertices.length;k++) {
    const a=vertices[k-1],b=vertices[k],n=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/.003));
    for(let j=0;j<n;j++)targets.push(makePose(slicePosition(a.map((v,i)=>v+(b[i]-v)*j/n),slice),slice.orientation));
  }
  if(vertices.length)targets.push(makePose(slicePosition(vertices.at(-1),slice),slice.orientation));
  if(targets.length>4000)throw new Error('Choose a shorter path (at most 12 metres at this resolution).');
  return targets;
}

/** A count of zero is a resolved unreachable pose; -1 means enumeration was unresolved.
 * The legacy x-z format remains supported for saved lecture assets and tests.
 */
export function calculateSlice(slice, onProgress) {
  const xy=slice.plane==='xy',rows=xy?slice.ny:slice.nz;
  const {nx,xmin,xmax,orientation}=slice,lo=xy?slice.ymin:slice.zmin,hi=xy?slice.ymax:slice.zmax,fixed=xy?slice.z:slice.y;
  if(![nx,rows].every(n=>Number.isInteger(n)&&n>=2&&n<=400)||![xmin,xmax,lo,hi,fixed].every(Number.isFinite)||xmin>=xmax||lo>=hi)throw new Error('Invalid planar slice sampling.');
  const counts=new Array(nx*rows),limitCounts=new Array(nx*rows);
  let unresolved=0;
  for(let row=0;row<rows;row++) {
    for(let ix=0;ix<nx;ix++) {
      const point=[xmin+ix*(xmax-xmin)/(nx-1),lo+row*(hi-lo)/(rows-1)];
      const result=inverse(makePose(slicePosition(point,slice),orientation)),index=row*nx+ix;
      if(result.diagnostics?.resolved===false){counts[index]=-1;limitCounts[index]=-1;unresolved++;}
      else {counts[index]=result.solutions.length;limitCounts[index]=result.solutions.filter(s=>s.withinLimits).length;}
    }
    onProgress?.({done:(row+1)*nx,total:nx*rows,unresolved,start:row*nx,
      counts:counts.slice(row*nx,(row+1)*nx),limitCounts:limitCounts.slice(row*nx,(row+1)*nx)});
  }
  return {...slice,counts,limitCounts,unresolved,source:'live'};
}
