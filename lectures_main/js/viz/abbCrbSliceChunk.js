import { inverse, makePose } from './abbCrbKinematics.js';

/** Independent cells permit exact parallel enumeration without sharing solver state. */
export function calculateSliceChunk(slice, start, end) {
  const xy = slice.plane === 'xy', rows = xy ? slice.ny : slice.nz;
  const lo = xy ? slice.ymin : slice.zmin, hi = xy ? slice.ymax : slice.zmax;
  const counts = [], limitCounts = [];
  let unresolved = 0, maxFkError = 0;
  for (let index = start; index < end; index++) {
    const x = slice.xmin + index % slice.nx * (slice.xmax - slice.xmin) / (slice.nx - 1);
    const v = lo + Math.floor(index / slice.nx) * (hi - lo) / (rows - 1);
    const result = inverse(makePose(xy ? [x, v, slice.z] : [x, slice.y, v], slice.orientation));
    if (result.diagnostics?.resolved === false) { counts.push(-1); limitCounts.push(-1); unresolved++; }
    else { counts.push(result.solutions.length); limitCounts.push(result.solutions.filter(s => s.withinLimits).length); }
    for (const solution of result.solutions) maxFkError = Math.max(maxFkError, solution.positionError, solution.rotationError);
  }
  return { start, counts, limitCounts, unresolved, maxFkError };
}
