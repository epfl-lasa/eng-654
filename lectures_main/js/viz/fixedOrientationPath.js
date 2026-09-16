import { searchAspectPath } from './cuspidalPathPlanner.js';

// The joint origins and axes in assets/models/custom_6R/custom_6R_new.urdf.
// The final three axes intersect at joint 5; their rotation sequence is X–Z–X.
const PI = Math.PI;
const PARAMETERS = { baseHeight: 1, a1: 1, a2: 2, armEnd: 2.5, d2: 1.25, d3: .75, toolOffset: 1.5 };
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const unwrapNear = (angle, reference) => reference + wrap(angle - reference);
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const sub = (a, b) => a.map((x, i) => x - b[i]);
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const transpose = (A) => A[0].map((_, i) => A.map(row => row[i]));
const product = (A, B) => A.map(row => transpose(B).map(col => dot(row, col)));
const apply = (R, p) => R.map(row => dot(row, p));
const add = (a, b) => a.map((x, i) => x + b[i]);
const rx = (a) => [[1,0,0],[0,Math.cos(a),-Math.sin(a)],[0,Math.sin(a),Math.cos(a)]];
const ry = (a) => [[Math.cos(a),0,Math.sin(a)],[0,1,0],[-Math.sin(a),0,Math.cos(a)]];
const rz = (a) => [[Math.cos(a),-Math.sin(a),0],[Math.sin(a),Math.cos(a),0],[0,0,1]];
const rotationError = (A, B) => Math.max(...A.flatMap((row, i) => row.map((x, j) => Math.abs(x - B[i][j]))));
const distance = (a, b) => Math.hypot(...sub(a, b));
const jointDistance = (a, b) => Math.hypot(...a.map((x, i) => wrap(x - b[i])));

export function custom6RArmRotation(arm) {
  return product(product(rz(arm[0]), ry(arm[1])), rz(arm[2]));
}

export function custom6RWristPoint(q) {
  const { a1, a2, armEnd: L, d2, d3, baseHeight } = PARAMETERS;
  const B = a2 + L*Math.cos(q[2]), X = a1 + Math.cos(q[1])*B + Math.sin(q[1])*d3;
  const Y = d2 + L*Math.sin(q[2]), Z = baseHeight - Math.sin(q[1])*B + Math.cos(q[1])*d3;
  return [Math.cos(q[0])*X-Math.sin(q[0])*Y, Math.sin(q[0])*X+Math.cos(q[0])*Y, Z];
}

export function custom6RArmFromSlice(slice, previous) {
  const p = custom6RWristPoint([0,...slice]);
  const q1 = -Math.atan2(p[1], p[0]);
  return [previous ? unwrapNear(q1, previous[0]) : q1, ...slice];
}

export function custom6RSlice(slice) {
  const p = custom6RWristPoint([0,...slice]);
  return [Math.hypot(p[0], p[1]), p[2]];
}

export function custom6RArmDeterminant(slice) {
  const { a1, a2, armEnd: L, d2, d3 } = PARAMETERS;
  const [q2,q3] = slice, B = a2+L*Math.cos(q3), D = d2+L*Math.sin(q3);
  const X = Math.cos(q2)*B+Math.sin(q2)*d3;
  return L*((a1+X)*B*Math.sin(q3)-D*Math.cos(q3)*X);
}

export function custom6RPose(q) {
  const wrist = custom6RWristPoint(q);
  const R = product(product(product(custom6RArmRotation(q), rx(q[3])), rz(q[4])), rx(q[5]));
  return { R, wrist, p: add(wrist, apply(R, [PARAMETERS.toolOffset,0,0])) };
}

export function custom6RJacobian(q) {
  const rotations = [rz(q[0]), ry(q[1]), rz(q[2]), rx(q[3]), rz(q[4]), rx(q[5])];
  const origins = [[0,0,.5],[1,0,.5],[2,1.25,0],[1.5,0,.75],[1,0,0],[1.5,0,0]];
  const localAxes = [[0,0,1],[0,1,0],[0,0,1],[1,0,0],[0,0,1],[1,0,0]];
  let R = [[1,0,0],[0,1,0],[0,0,1]], p = [0,0,0];
  const axes = [], points = [];
  for (let i = 0; i < 6; i += 1) {
    p = add(p, apply(R, origins[i])); points.push(p);
    axes.push(apply(R, localAxes[i])); R = product(R, rotations[i]);
  }
  const columns = axes.map((axis, i) => [...cross(axis, sub(p, points[i])), ...axis]);
  return transpose(columns);
}

export function matrixDeterminant(matrix) {
  const A = matrix.map(row => row.slice()); let result = 1;
  for (let col = 0; col < A.length; col += 1) {
    let pivot = col;
    for (let row = col+1; row < A.length; row += 1) if (Math.abs(A[row][col]) > Math.abs(A[pivot][col])) pivot = row;
    if (Math.abs(A[pivot][col]) < 1e-14) return 0;
    if (pivot !== col) { [A[pivot], A[col]] = [A[col], A[pivot]]; result *= -1; }
    const value = A[col][col]; result *= value;
    for (let row = col+1; row < A.length; row += 1) {
      const scale = A[row][col]/value;
      for (let j = col+1; j < A.length; j += 1) A[row][j] -= scale*A[col][j];
    }
  }
  return result;
}

export function custom6RWristSolutions(arm, targetRotation) {
  const M = product(transpose(custom6RArmRotation(arm)), targetRotation);
  const b = Math.acos(Math.max(-1, Math.min(1, M[0][0])));
  if (Math.abs(Math.sin(b)) < 1e-9) return [];
  return [b,-b].map(q5 => {
    const sign = Math.sign(Math.sin(q5));
    return [Math.atan2(sign*M[2][0], sign*M[1][0]), q5, Math.atan2(sign*M[0][2], -sign*M[0][1])];
  });
}

/** Search a joint-space aspect, then lift every sample onto one continuous,
 * nonsingular wrist branch at the selected, constant end-effector orientation.
 * This is a discrete kinematic path; it does not check collision or dynamics. */
export function buildFixedOrientationPath(start, goal, options = {}) {
  const armClearance = options.armClearance ?? .04;
  const wristClearance = options.wristClearance ?? .06;
  const fullClearance = options.fullClearance ?? .004;
  const fail = (reason, extra = {}) => ({ found: false, path: [], armPath: [], reason, ...extra });
  if (![start,goal].every(q => Array.isArray(q) && q.length === 6 && q.every(Number.isFinite))) return fail('Choose two complete, finite IK solutions.');
  const targetRotation = options.targetRotation || custom6RPose(start).R;
  const initial = custom6RPose(start), final = custom6RPose(goal);
  if (rotationError(initial.R, targetRotation) > 2e-5 || rotationError(final.R, targetRotation) > 2e-5) return fail('Both endpoints must have the selected fixed orientation.');
  if (distance(initial.wrist, final.wrist) > 2e-5) return fail('Select two IK solutions of the same wrist-center target.');
  if (Math.abs(initial.wrist[1]) > 2e-5 || initial.wrist[0] < 0) return fail('The selected wrist center must be in the positive-x, y = 0 slice.');
  const branch = Math.sign(Math.sin(start[4]));
  if (!branch || branch !== Math.sign(Math.sin(goal[4]))) return fail('The selected wrist branches have opposite signs of sin(q₅); a continuous change would cross a wrist singularity.');
  const wristMargin = slice => {
    const arm = custom6RArmFromSlice(slice);
    const M = product(transpose(custom6RArmRotation(arm)), targetRotation);
    return Math.sqrt(Math.max(0, 1-M[0][0]*M[0][0]));
  };
  const safe = slice => {
    const wrist = wristMargin(slice), arm = Math.abs(custom6RArmDeterminant(slice));
    return wrist >= wristClearance && arm*wrist >= fullClearance;
  };
  if (![start.slice(1,3),goal.slice(1,3)].every(safe)) return fail('An endpoint is too close to an arm or wrist singularity for the requested clearance.');
  const search = searchAspectPath(start.slice(1,3), goal.slice(1,3), {
    determinant: custom6RArmDeterminant,
    clearance: armClearance,
    resolution: options.resolution ?? 144,
    maxStep: options.maxStep ?? .008,
    edgeValidator: (_a, _b, samples) => samples.every(safe)
  });
  if (!search.found) return fail(`No fixed-orientation path found at this grid resolution and clearance. ${search.reason || ''}`, { expanded: search.expanded });
  const path = []; let previous = start;
  let minAbsDet = Infinity, minArmDet = Infinity, minWrist = Infinity, maxPositionError = 0, maxRotationError = 0, maxJointStep = 0;
  for (const slice of search.path) {
    const arm = custom6RArmFromSlice(slice, previous);
    const wrists = custom6RWristSolutions(arm, targetRotation);
    const wrist = wrists.find(w => Math.sign(Math.sin(w[1])) === branch);
    if (!wrist) return fail('Wrist continuation reached a singular orientation.');
    const q = [...arm, ...wrist.map((angle, i) => unwrapNear(angle, previous[i+3]))];
    const pose = custom6RPose(q), expected = custom6RSlice(slice);
    const fullDet = matrixDeterminant(custom6RJacobian(q));
    minAbsDet = Math.min(minAbsDet, Math.abs(fullDet));
    minArmDet = Math.min(minArmDet, Math.abs(custom6RArmDeterminant(slice)));
    minWrist = Math.min(minWrist, Math.abs(Math.sin(q[4])));
    maxPositionError = Math.max(maxPositionError, distance(pose.wrist, [expected[0],0,expected[1]]));
    maxRotationError = Math.max(maxRotationError, rotationError(pose.R, targetRotation));
    if (path.length) maxJointStep = Math.max(maxJointStep, Math.max(...q.map((v, i) => Math.abs(v-previous[i]))));
    if (Math.abs(fullDet) < fullClearance || maxPositionError > 2e-6 || maxRotationError > 2e-6) return fail('The dense full-Jacobian or FK check rejected this path.');
    path.push(q); previous = q;
  }
  if (jointDistance(path[0], start) > 2e-4 || jointDistance(path.at(-1), goal) > 2e-4) return fail('Continuous wrist recovery did not reach the selected complete IK endpoint.');
  if (maxJointStep > .2) return fail('Wrist variation is too large between samples; use finer joint-space sampling.');
  return { found: true, path, armPath: search.path, expanded: search.expanded, minAbsDet, minArmDet, minWrist, maxPositionError, maxRotationError, maxJointStep, reason: '' };
}
