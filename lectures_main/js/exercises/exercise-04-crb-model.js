/** Exercise 04: one prescribed, constant-orientation ABB GoFa tool path.
 * The student varies only the height. No successful answer heights are stored
 * in this module. Counts distinguish geometric IKs modulo 2π, as in Lecture 07.
 */
import {
  inverse, makePose, followPath, jointLimits,
} from '../viz/abbCrbKinematics.js';

const c = Math.cos, s = Math.sin;
const multiply = (a, b) => a.map(row => b[0].map((_, j) => row.reduce((sum, x, k) => sum + x * b[k][j], 0)));
const rx = a => [[1, 0, 0], [0, c(a), -s(a)], [0, s(a), c(a)]];
const ry = a => [[c(a), 0, s(a)], [0, 1, 0], [-s(a), 0, c(a)]];
const rz = a => [[c(a), -s(a), 0], [s(a), c(a), 0], [0, 0, 1]];
const rotation = multiply(rz(.3), multiply(ry(1.1), rx(.4)));
const vertices = [[.31, .12], [.49, .12], [.49, .28], [.31, .28], [.31, .12]];
const lengths = [.18, .16, .18, .16];
const perimeter = .68;

export const CRB_PATH = Object.freeze({
  center: Object.freeze([.4, .2]), width: .18, height: .16,
  verticesXY: Object.freeze(vertices.map(p => Object.freeze(p))),
  rotation: Object.freeze(rotation.map(row => Object.freeze(row))),
  rotationExpression: 'Rz(0.3) Ry(1.1) Rx(0.4)',
  defaultZ: .2, zRange: Object.freeze([.05, .9]), perimeter,
  // 408 uniform arclength intervals place all four corners exactly on samples.
  intervals: 408, minDet: 1e-5, maxJointStep: .08, subdivisions: 8,
});
export const defaultZ = CRB_PATH.defaultZ;
export const JOINT_LIMITS = jointLimits;

function checkHeight(z) {
  if (!Number.isFinite(z) || z < CRB_PATH.zRange[0] || z > CRB_PATH.zRange[1]) {
    throw new RangeError(`Height must lie between ${CRB_PATH.zRange[0]} and ${CRB_PATH.zRange[1]} m.`);
  }
}

/** s is normalized distance along the rectangle; the tool orientation is fixed. */
export function poseAt(s, z = defaultZ) {
  checkHeight(z);
  if (!Number.isFinite(s) || s < 0 || s > 1) throw new RangeError('Path progress must lie between 0 and 1.');
  let distance = s * perimeter, edge = 0;
  while (edge < 3 && distance > lengths[edge]) distance -= lengths[edge++];
  const t = Math.min(1, Math.max(0, distance / lengths[edge]));
  const xy = vertices[edge].map((v, i) => v + (vertices[edge + 1][i] - v) * t);
  return makePose([...xy, z], rotation);
}

/** Enumerate all geometric starting IKs, including explicitly flagged illegal ones. */
export function enumerateStart(z = defaultZ) {
  return inverse(poseAt(0, z), { respectLimits: false });
}

const yieldToUI = () => new Promise(resolve => setTimeout(resolve, 0));
function checkAbort(signal) {
  if (signal?.aborted) {
    const error = new Error('Height analysis cancelled.'); error.name = 'AbortError'; throw error;
  }
}

/** Enumerate the roots at every sampled pose, then continue each starting IK.
 * Continuation preserves unwrapped native joint coordinates. It never chooses
 * a new 2π representative to jump across a physical joint stop.
 *
 * progress receives {phase, done, total, percent}. Results contain the complete
 * and stopped tracks, all sampled IK layers, and the actual stopping reason.
 * This is a numerical verification at the reported resolution, not a proof
 * about arbitrary heights or singular continuous IK families.
 */
export async function analyzeHeight(z = defaultZ, progress = () => {}, { signal } = {}) {
  checkHeight(z); checkAbort(signal);
  const samples = Array.from({ length: CRB_PATH.intervals + 1 }, (_, i) => i / CRB_PATH.intervals);
  const poses = samples.map(s => poseAt(s, z));
  const layers = [];
  for (let i = 0; i < poses.length; i++) {
    checkAbort(signal);
    const result = inverse(poses[i], { respectLimits: false });
    layers.push({ s: samples[i], ...result, count: result.solutions.length,
      legalCount: result.solutions.filter(root => root.withinLimits).length });
    if (i % 12 === 0 || i === poses.length - 1) {
      progress({ phase: 'enumerate', done: i + 1, total: poses.length, percent: 70 * (i + 1) / poses.length });
      await yieldToUI();
    }
  }
  const solutions = layers[0].solutions, tracks = [];
  for (let i = 0; i < solutions.length; i++) {
    checkAbort(signal);
    const result = followPath(poses, solutions[i].q, CRB_PATH);
    tracks.push({ index: i, label: `IK ${i + 1}`, start: solutions[i], ...result });
    progress({ phase: 'continue', done: i + 1, total: solutions.length, percent: 70 + 30 * (i + 1) / solutions.length });
    await yieldToUI();
  }
  progress({ phase: 'complete', done: tracks.length, total: tracks.length, percent: 100 });
  return {
    z, poses, samples, solutions, tracks, layers, sampleCount: poses.length,
    geometricStartCount: solutions.length,
    legalStartCount: solutions.filter(root => root.withinLimits).length,
    completeCount: tracks.filter(track => track.complete).length,
    rootCountRange: [Math.min(...layers.map(layer => layer.count)), Math.max(...layers.map(layer => layer.count))],
    legalCountRange: [Math.min(...layers.map(layer => layer.legalCount)), Math.max(...layers.map(layer => layer.legalCount))],
    resolved: layers.every(layer => layer.diagnostics.resolved),
    diagnostics: layers[0].diagnostics,
    countConvention: 'Distinct geometric starting IKs modulo 2π; one legal native representative per branch. Continuation keeps joint angles unwrapped.',
  };
}
