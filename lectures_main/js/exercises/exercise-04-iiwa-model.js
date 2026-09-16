/** Exercise 04, task 1: exact iiwa 7 pose tracking in native URDF coordinates.
 * This module contains the challenge and its evaluators, not an answer key.
 * A completed numerical task loop may finish at another redundant posture.
 */
import { fk, inverseFixedQ3, IIWA_BRANCH_LABELS, IIWA_LIMITS } from '../viz/iiwa7Kinematics.js';
import { pathSpec, pathPose, pathSamples as samplePath, configurationMetrics,
  buildRedundancyMap, planAnalytical, planNumerical, MIN_SINGULAR_VALUE } from '../viz/iiwa7Planning.js';

export const PATH_REVISION = 'iiwa-circle-v2';
export const PLANNING_REVISION = 'iiwa-redundant-graph-v3';
export const PATH_SPEC = Object.freeze({
  kind: 'circle', center: Object.freeze([.50, 0, .55]), radius: .12, startAngle: -Math.PI / 2,
  R: Object.freeze([Object.freeze([1, 0, 0]), Object.freeze([0, -1, 0]), Object.freeze([0, 0, -1])])
});
export const ANGLE_OPTIONS = Object.freeze(Array.from({ length: 35 }, (_, i) => -170 + i * 10));
export const BRANCH_LABELS = IIWA_BRANCH_LABELS;
export const JOINT_LIMITS = IIWA_LIMITS;
export const PLANNING_POLICY = Object.freeze({
  analytical: 'Your q3 selection fixes the starting posture. Exact analytical IK connects candidates over the full redundant-angle range and all eight sets; q3 may change. Failed coarse searches are refined, with every connection checked for continuity, joint limits and full Jacobian rank.',
  numerical: 'Right pseudoinverse with joint-limit barrier in the null space, gain 0.8; q3 may change while the tool follows the given pose path.',
  validity: 'Native joint limits, full 6×7 Jacobian rank and tool position/orientation are checked at dense intermediate samples. This is sampled kinematic validation; a failed finite graph search does not prove global infeasibility.',
  acceptance: 'A choice is correct when either planner completes the entire pose path with all validity checks satisfied.'
});
export const initialPose = () => pathPose(0, PATH_SPEC);
export const targetPose = progress => pathPose(progress, PATH_SPEC);
export const pathSamples = (count = 121) => samplePath(PATH_SPEC, count);

/** Green cells certify this sampled pose only, not a future numerical path.
 * All eight fixed-q3 algebraic sets are included over the complete task loop. */
export async function buildFeasibilityMap({ onProgress, signal } = {}) {
  const map = await buildRedundancyMap(PATH_SPEC, {
    nProgress: 121, nAngles: ANGLE_OPTIONS.length,
    angleRange: [ANGLE_OPTIONS[0] * Math.PI / 180, ANGLE_OPTIONS.at(-1) * Math.PI / 180],
    onProgress, signal,
  });
  if (!planningMaps.has('121/35')) planningMaps.set('121/35', Promise.resolve(map));
  return { ...map, revision: PATH_REVISION, angleDegrees: ANGLE_OPTIONS.slice() };
}

/** Angles exposed to the exercise UI are in degrees; all returned q are radians. */
export function getStartCandidates(branch, angleDegrees) {
  if (!ANGLE_OPTIONS.includes(Number(angleDegrees))) return [];
  const roots = inverseFixedQ3(initialPose(), Number(angleDegrees) * Math.PI / 180);
  return roots.filter(root => branch == null || root.mergedBranchIndices.includes(Number(branch)))
    .map(root => ({ ...root, ...configurationMetrics(root.q) }));
}
export const getStartCandidate = (branch, angleDegrees) => getStartCandidates(branch, angleDegrees)[0] || null;

async function fixedAngleMap(branch, angleDegrees) {
  const angle = angleDegrees * Math.PI / 180;
  // Step 03 already calculated these exact analytical roots for its map.
  // Reuse the selected row instead of recomputing it on every answer check.
  const shared = planningMaps.get('121/35');
  if (shared) {
    const map = await shared;
    const row = map.angles.findIndex(value => Math.abs(value - angle) < 1e-12);
    if (row >= 0) return { spec: map.spec, samples: map.samples, angles: [map.angles[row]],
      cells: map.cells.map(column => [column[row]]), defaultStart: { row: 0, branch } };
  }
  const spec = pathSpec(PATH_SPEC), samples = samplePath(spec, 121);
  const cells = samples.map(target => {
    const slots = Array(8).fill(null);
    for (const root of inverseFixedQ3(target, angle)) {
      const metrics = configurationMetrics(root.q);
      for (const label of root.mergedBranchIndices) slots[label] = {
        ...root, ...metrics, branchIndex: label, valid: metrics.valid && root.error < 1e-7
      };
    }
    return [slots];
  });
  return { spec, samples, angles: [angle], cells, defaultStart: { row: 0, branch } };
}

// These maps describe the supplied path, independently of the chosen start.
// Reuse their analytical roots across answer checks, never a numerical track.
const planningMaps = new Map();
async function planningMap(nProgress, nAngles, onProgress) {
  const key = `${nProgress}/${nAngles}`;
  if (!planningMaps.has(key)) {
    const pending = buildRedundancyMap(PATH_SPEC, { nProgress, nAngles, onProgress });
    planningMaps.set(key, pending);
    pending.catch(() => planningMaps.delete(key));
  }
  const map = await planningMaps.get(key);
  onProgress?.(1);
  return map;
}

async function planFromStart(branch, angleDegrees, onProgress) {
  // A constant-angle corridor is a cheap first attempt, not a constraint on
  // the analytical planner. If it fails, search the full (s, q3, IK-set) graph.
  let best = await planAnalytical(await fixedAngleMap(branch, angleDegrees), {
    row: 0, branch, cost: 'travel', onProgress: p => onProgress?.(.1 * p)
  });
  const attempts = [{ nProgress: 121, nAngles: 1, complete: best.complete }];
  for (const [index, [nProgress, nAngles]] of [[121, 35], [241, 69]].entries()) {
    if (best.complete) break;
    const offset = .1 + .45 * index;
    const map = await planningMap(nProgress, nAngles, p => onProgress?.(offset + .15 * p));
    const angle = angleDegrees * Math.PI / 180;
    const row = map.angles.findIndex(value => Math.abs(value - angle) < 1e-12);
    const result = await planAnalytical(map, {
      row, branch, cost: 'travel', onProgress: p => onProgress?.(offset + .15 + .3 * p)
    });
    attempts.push({ nProgress, nAngles, complete: result.complete });
    if (result.complete || (result.samples.at(-1)?.s ?? 0) >= (best.samples.at(-1)?.s ?? 0)) best = result;
  }
  onProgress?.(1);
  return { ...best, attempts, startingAngleDegrees: angleDegrees,
    redundancy: 'q3 may vary over its full native joint range' };
}

const failed = reason => ({ complete: false, reason, samples: [], q: [], minLimitMargin: null,
  minSigma: null, maxPoseError: null, maxStep: 0, closure: 0 });
const validResult = result => result.complete && result.samples?.[0]?.s === 0
  && result.samples?.at(-1)?.s === 1 && result.minLimitMargin >= -1e-10
  && result.minSigma > MIN_SINGULAR_VALUE && result.maxPoseError < 1e-7;
export const acceptsEitherPlan = (analytical, numerical) => validResult(analytical) || validResult(numerical);

/** Evaluate the actual chosen starting configuration using both planners.
 * branch is a zero-based algebraic IK label (0…7), angleDegrees a listed choice.
 * onProgress receives {planner:'analytical'|'numerical', progress:0…1}.
 */
export async function evaluateChoice(branch, angleDegrees, { onProgress } = {}) {
  branch = Number(branch); angleDegrees = Number(angleDegrees);
  if (!Number.isInteger(branch) || branch < 0 || branch >= 8 || !ANGLE_OPTIONS.includes(angleDegrees)) {
    return { accepted: false, branch, angleDegrees, start: null, reason: 'invalid-choice',
      analytical: failed('invalid-choice'), numerical: failed('invalid-choice') };
  }
  const start = getStartCandidate(branch, angleDegrees);
  if (!start?.valid) {
    const reason = start?.reason || 'no-starting-IK';
    return { accepted: false, branch, angleDegrees, start, reason,
      analytical: failed(reason), numerical: failed(reason) };
  }
  const analytical = await planFromStart(branch, angleDegrees,
    progress => onProgress?.({ planner: 'analytical', progress }));
  const numerical = await planNumerical(PATH_SPEC, start.q, {
    nSteps: 400, cost: 'limits', gain: .8,
    onProgress: progress => onProgress?.({ planner: 'numerical', progress })
  });
  const accepted = acceptsEitherPlan(analytical, numerical);
  return { accepted, branch, angleDegrees, label: BRANCH_LABELS[branch], start,
    analytical, numerical, reason: accepted ? null : analytical.reason || numerical.reason || 'validation-failed',
    initialPose: fk(start.q), policy: PLANNING_POLICY };
}
