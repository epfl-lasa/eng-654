import { ABB_PARAMETERS, ABB_JOINT_LIMITS, abbUrdfTransforms, abbJacobian, abbDeterminant } from './abbIrbKinematics.js';
import { ABB_DOWNWARD_TOOL_ROTATION, solveAbbArm, solveAbbIk } from './abbIrbIk.js';

// A large XY rectangle at the actual tool point O6. Its outer edges enter
// the two-position-IK region; the inner vertex admits four position IKs.
export const ABB_PATH_SPEC = Object.freeze({ x0: 1.4, x1: 2.25, y0: .3, y1: .85, z: 1.1, samples: 361 });
export const ABB_PATH_DET_CUTOFF = 1e-5;
// Native URDF speed limits, radians per second (175,175,175,250,250,360 deg/s).
export const ABB_PATH_SPEED_LIMITS = Object.freeze([175,175,175,250,250,360].map(v => v * Math.PI / 180));
const TAU = 2 * Math.PI;
const norm = vector => Math.hypot(...vector);
const key = row => row.signs.join(',');
const transpose = matrix => matrix[0].map((_, i) => matrix.map(row => row[i]));
const multiply = (a, b) => a.map(row => b[0].map((_, j) => row.reduce((sum, value, k) => sum + value * b[k][j], 0)));

export function abbPathTarget(position, rotation = ABB_DOWNWARD_TOOL_ROTATION) {
  return { position: position.slice(), wrist: position.map((value, i) => value - ABB_PARAMETERS.d6 * rotation[i][2]),
    rotation, frame: 'tool0' };
}

export function abbPathVertices(spec = ABB_PATH_SPEC) {
  return [[spec.x0, spec.y0, spec.z], [spec.x1, spec.y0, spec.z],
    [spec.x1, spec.y1, spec.z], [spec.x0, spec.y1, spec.z], [spec.x0, spec.y0, spec.z]];
}

// s assigns one quarter of the progress interval to each straight edge.
export function abbPathPosition(progress, spec = ABB_PATH_SPEC) {
  const vertices = abbPathVertices(spec), scaled = Math.max(0, Math.min(1, progress)) * 4;
  if (scaled === 4) return vertices[4].slice();
  const edge = Math.min(3, Math.floor(scaled)), fraction = scaled - edge;
  return vertices[edge].map((value, i) => value + fraction * (vertices[edge + 1][i] - value));
}

export function abbPathTargets(spec = ABB_PATH_SPEC) {
  return Array.from({ length: spec.samples }, (_, i) => abbPathTarget(abbPathPosition(i / (spec.samples - 1), spec)));
}

// Geometric Jacobian at the tool origin, expressed in world coordinates.
// Keep the shared abbWorldJacobian default at O5 for the earlier lectures.
export const abbToolWorldJacobian = q => abbJacobian(q, { point: 6 });

export function abbPositionIkCount(position, rotation = ABB_DOWNWARD_TOOL_ROTATION) {
  return solveAbbArm(abbPathTarget(position, rotation).wrist).length;
}

// Outer reach boundary for each signed shoulder. These circles are exact for
// this fixed-height, downward-tool slice; their regular regions have 0/2/4 IKs.
export function abbPositionSliceBoundaries(spec = ABB_PATH_SPEC) {
  const p = ABB_PARAMETERS, height = spec.z + p.d6 - p.d1;
  const reach = Math.sqrt((p.a2 + Math.hypot(p.a3, p.d4)) ** 2 - height ** 2);
  return { fourToTwo: reach - p.a1, twoToZero: reach + p.a1 };
}

// Rest at all four corners: one rest-to-rest quintic clock per edge. This is
// a playback timing law, not a claim of a globally smooth rectangular curve.
export function abbRectangleClock(time, duration = 1) {
  const u = Math.max(0, Math.min(1, time / duration)), segment = Math.min(3, Math.floor(4 * u)), local = 4 * u - segment;
  const s = local ** 3 * (10 + local * (-15 + 6 * local));
  return { s: (segment + s) / 4, velocity: 30 * local ** 2 * (1 - local) ** 2 / duration };
}

export function abbRectangleTime(progress, duration = 1) {
  if (progress <= 0) return 0;
  if (progress >= 1) return duration;
  const segment = Math.min(3, Math.floor(progress * 4)), fraction = progress * 4 - segment;
  let lo = 0, hi = 1;
  for (let i = 0; i < 48; i++) { const mid = (lo + hi) / 2, s = mid ** 3 * (10 + mid * (-15 + 6 * mid)); if (s < fraction) lo = mid; else hi = mid; }
  return (segment + (lo + hi) / 2) * duration / 4;
}

export function abbPathPoseError(q, target) {
  const transforms = abbUrdfTransforms(q), actual = transforms.tool0.slice(0, 3).map(row => row.slice(0, 3));
  const E = multiply(target.rotation, transpose(actual));
  const cosine = Math.max(-1, Math.min(1, (E[0][0] + E[1][1] + E[2][2] - 1) / 2));
  const angle = Math.acos(cosine);
  const skew = [E[2][1] - E[1][2], E[0][2] - E[2][0], E[1][0] - E[0][1]];
  const scale = angle < 1e-7 ? .5 : angle / (2 * Math.sin(angle));
  let angular = skew.map(value => value * scale);
  if (Math.PI - angle < 1e-5) {
    // At pi, the antisymmetric part vanishes. Recover the axis from R + I.
    const diagonal = E.map((row, i) => row[i]), pivot = diagonal.indexOf(Math.max(...diagonal));
    const axis = [0, 0, 0]; axis[pivot] = Math.sqrt(Math.max(0, (E[pivot][pivot] + 1) / 2));
    for (let i = 0; i < 3; i++) if (i !== pivot) axis[i] = (E[i][pivot] + E[pivot][i]) / (4 * axis[pivot]);
    angular = axis.map(value => value * angle);
  }
  const targetPosition = target.position || target.wrist.map((value, i) => value + ABB_PARAMETERS.d6 * target.rotation[i][2]);
  return [...targetPosition.map((value, i) => value - transforms.tool0[i][3]), ...angular];
}

export function abbPathLimitViolation(q) {
  const joint = q.findIndex((value, i) => value < ABB_JOINT_LIMITS[i][0] - 1e-9 || value > ABB_JOINT_LIMITS[i][1] + 1e-9);
  if (joint < 0) return null;
  const value = q[joint], limit = ABB_JOINT_LIMITS[joint][value < ABB_JOINT_LIMITS[joint][0] ? 0 : 1];
  return { kind: 'joint-limit', joint, value, limit,
    message: `q${joint + 1} ${value < limit ? '<' : '>'} ${Math.round(limit * 180 / Math.PI)}°` };
}

// Keep physical revolute coordinates continuous; never wrap a forbidden jump
// through a hard stop. Select an equivalent root near the previous coordinate.
function nearbyCoordinates(q, reference) {
  return q.map((angle, i) => angle + TAU * Math.round((reference[i] - angle) / TAU));
}

function linearSolve(matrix, rhs) {
  const a = matrix.map((row, i) => [...row, rhs[i]]), n = rhs.length;
  for (let i = 0; i < n; i++) {
    let pivot = i;
    for (let j = i + 1; j < n; j++) if (Math.abs(a[j][i]) > Math.abs(a[pivot][i])) pivot = j;
    if (Math.abs(a[pivot][i]) < 1e-11) return null;
    [a[i], a[pivot]] = [a[pivot], a[i]];
    const scale = a[i][i];
    for (let j = i; j <= n; j++) a[i][j] /= scale;
    for (let k = 0; k < n; k++) if (k !== i) {
      const value = a[k][i];
      for (let j = i; j <= n; j++) a[k][j] -= value * a[i][j];
    }
  }
  return a.map(row => row[n]);
}

export function abbPathJointVelocity(q, progress, progressRate, spec = ABB_PATH_SPEC) {
  const vertices = abbPathVertices(spec), edge = Math.min(3, Math.floor(Math.max(0, Math.min(1, progress)) * 4));
  const velocity = [...vertices[edge].map((value, i) => 4 * (vertices[edge + 1][i] - value) * progressRate), 0, 0, 0];
  return linearSolve(abbToolWorldJacobian(q), velocity);
}

export function solveAbbPathNumerically(target, seed) {
  let q = seed.slice();
  for (let iteration = 0; iteration < 24; iteration++) {
    const error = abbPathPoseError(q, target);
    if (norm(error) < 2e-9) return { q, iterations: iteration, error: norm(error) };
    if (Math.abs(abbDeterminant(q)) < ABB_PATH_DET_CUTOFF) return { failure: { kind: 'singularity', message: '|det J| below cutoff' } };
    const step = linearSolve(abbToolWorldJacobian(q), error);
    if (!step) return { failure: { kind: 'singularity', message: 'Jacobian inversion failed' } };
    const scale = Math.max(1, norm(step) / .16);
    q = q.map((value, i) => value + step[i] / scale);
  }
  return { failure: { kind: 'convergence', message: 'Newton corrector did not converge in 24 iterations' } };
}

function segmentFailure(a, b) {
  let previous = abbDeterminant(a);
  for (let k = 1; k <= 4; k++) {
    const q = a.map((value, j) => value + (b[j] - value) * k / 4), determinant = abbDeterminant(q);
    if (Math.abs(determinant) < ABB_PATH_DET_CUTOFF || determinant * previous < 0)
      return { kind: 'singularity', message: 'Jacobian singularity on the continuation segment' };
    previous = determinant;
  }
  return null;
}

export function trackAbbPath(targets, seed, { method = 'numerical', roots } = {}) {
  const states = [seed.q.slice()], initialViolation = abbPathLimitViolation(seed.q);
  const result = { seed, method, states, success: false, failure: initialViolation,
    failIndex: initialViolation ? 0 : null, maxError: norm(abbPathPoseError(seed.q, targets[0])),
    minDet: Math.abs(abbDeterminant(seed.q)), maxStep: 0 };
  if (initialViolation) return result;
  for (let i = 1; i < targets.length; i++) {
    const previous = states.at(-1);
    let solved;
    if (method === 'analytical') {
      const row = (roots?.[i] || solveAbbIk(targets[i])).find(candidate => key(candidate) === key(seed));
      solved = row ? { q: nearbyCoordinates(row.q, previous) }
        : { failure: { kind: 'positional-fold', message: 'The selected shoulder/elbow branch ends at the 4→2 positional-IK boundary' } };
    } else {
      // Differential predictor: J qdot = Vd, or equivalently J Δq = Δx
      // for this sampled step. A Newton corrector removes the FK residual.
      const delta = linearSolve(abbToolWorldJacobian(previous), abbPathPoseError(previous, targets[i]));
      solved = delta ? solveAbbPathNumerically(targets[i], previous.map((value,k) => value+delta[k]))
        : { failure: { kind:'singularity', message:'Jacobian predictor is singular' } };
    }
    if (solved.failure && !solveAbbArm(targets[i].wrist).some(arm => arm.shoulder === seed.shoulder && arm.elbow === seed.elbow)) {
      solved.failure = { kind: 'positional-fold', message: 'The selected shoulder/elbow branch ends at the 4→2 positional-IK boundary' };
    }
    const failure = solved.failure || abbPathLimitViolation(solved.q) || segmentFailure(previous, solved.q);
    if (failure) { result.failure = failure; result.failIndex = i; return result; }
    const error = norm(abbPathPoseError(solved.q, targets[i]));
    if (error > 1e-7) {
      result.failure = { kind: 'residual', message: 'The FK pose residual exceeds tolerance' };
      result.failIndex = i; return result;
    }
    result.maxError = Math.max(result.maxError, error);
    result.minDet = Math.min(result.minDet, Math.abs(abbDeterminant(solved.q)));
    result.maxStep = Math.max(result.maxStep, norm(solved.q.map((value, j) => value - previous[j])));
    states.push(solved.q);
  }
  result.success = true;
  result.closure = norm(states[0].map((value, i) => value - states.at(-1)[i]));
  return result;
}

let cache;
export function analyzeAbbPath() {
  if (cache) return cache;
  const targets = abbPathTargets(), roots = targets.map(target => solveAbbIk(target));
  const numerical = roots[0].map(seed => trackAbbPath(targets, seed));
  const analytical = roots[0].map(seed => trackAbbPath(targets, seed, { method: 'analytical', roots }));
  cache = { targets, roots, numerical, analytical, positionCounts: targets.map(target => solveAbbArm(target.wrist).length),
    mathematicalStarts: roots[0].length,
    validStarts: roots[0].filter(row => row.withinLimits).length,
    completed: analytical.filter(track => track.success).length };
  return cache;
}
