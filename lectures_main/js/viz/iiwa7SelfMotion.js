import { inverseFixedQ3, limitMargin, wrapAngle } from './iiwa7Kinematics.js';

const DEG = Math.PI / 180;

/**
 * Exact fixed-pose IK curves in native joint coordinates. Algebraic solutions
 * are sampled before angles are unwrapped, so a drawing never bridges an
 * unreachable q3 interval. Each connected component is anchored to one native
 * solution; crossing +/-pi then continues the same joint motion instead of
 * replacing it by a different revolution. Limits apply to that unwrapped q.
 */
export function buildSelfMotionSweep(pose, { min = -170 * DEG, max = 170 * DEG, step = .5 * DEG, anchor = -30 * DEG } = {}) {
  const count = Math.max(2, Math.ceil((max - min) / step) + 1);
  const angles = Array.from({ length: count }, (_, i) => min + (max - min) * i / (count - 1));
  const roots = angles.map(angle => inverseFixedQ3(pose, angle));
  const anchorRow = angles.reduce((best, value, i) => Math.abs(value - anchor) < Math.abs(angles[best] - anchor) ? i : best, 0);
  const branches = Array.from({ length: 8 }, (_, branch) => {
    const samples = roots.map((row, i) => {
      const root = row.find(item => item.mergedBranchIndices.includes(branch));
      return root ? { ...root, q: root.q.slice(), angle: angles[i], row: i, connectedToPrevious: false } : null;
    });
    let first = 0;
    while (first < count) {
      while (first < count && !samples[first]) first++;
      if (first === count) break;
      let last = first;
      // A large change or an underdetermined chart is a real continuation
      // question. Leave a gap rather than inventing a segment between roots.
      while (last + 1 < count && samples[last + 1] &&
        !samples[last].freeParameters.length && !samples[last + 1].freeParameters.length &&
        Math.hypot(...samples[last + 1].q.map((value, j) => wrapAngle(value - samples[last].q[j]))) < .65) last++;
      const seed = Math.max(first, Math.min(last, anchorRow));
      for (const direction of [-1, 1]) for (let row = seed + direction; row >= first && row <= last; row += direction) {
        const previous = samples[row - direction].q;
        samples[row].q = samples[row].q.map((value, j) => j === 2 ? angles[row] : previous[j] + wrapAngle(value - previous[j]));
      }
      for (let row = first; row <= last; row++) {
        samples[row].connectedToPrevious = row > first;
        samples[row].limitMargin = limitMargin(samples[row].q);
        samples[row].valid = samples[row].limitMargin >= -1e-9;
        samples[row].reason = samples[row].valid ? '' : 'The continuous joint motion exceeds a native joint limit.';
      }
      first = last + 1;
    }
    return samples;
  });
  return { pose, angles, branches, anchorRow, sampleCount: count,
    fullSweep: branches.every(samples => samples.every((sample, i) => sample && (!i || sample.connectedToPrevious))) };
}
