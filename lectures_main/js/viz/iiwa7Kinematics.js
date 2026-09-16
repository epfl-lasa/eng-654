// Exact native iiwa7.urdf kinematics, including the fixed iiwa_link_ee tool.
// All angles are radians; positions are metres; matrices are nested row-major.
export const IIWA_LIMITS = Object.freeze([
  2.9670597283903604, 2.0943951023931953, 2.9670597283903604,
  2.0943951023931953, 2.9670597283903604, 2.0943951023931953,
  3.0543261909900763,
]);
export const IIWA_SPEED_LIMITS = Object.freeze([10, 10, 10, 10, 10, 10, 10]);
export const IIWA_GEOMETRY = Object.freeze({ shoulderHeight: .34, upperArm: .4, forearm: .4, toolOffset: .126 });
export const IIWA_BRANCH_LABELS = Object.freeze(Array.from({ length: 8 }, (_, i) =>
  `E${i < 4 ? '+' : '−'} S${i % 4 < 2 ? '+' : '−'} W${i % 2 === 0 ? '+' : '−'}`));

const I = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
// The URDF rotations Rz(pi)Rx(pi/2) and Ry(pi)Rx(-pi/2) are equal.
const C = [[-1, 0, 0], [0, 0, 1], [0, 1, 0]];
const D = [[1, 0, 0], [0, 0, -1], [0, 1, 0]];
const ROTATIONS = [I, C, C, D, C, D, C];
const TRANSLATIONS = [[0, 0, .15], [0, 0, .19], [0, .21, 0], [0, 0, .19], [0, .21, 0], [0, .0607, .19], [0, .081, .0607]];
const TAU = 2 * Math.PI;
const clamp = x => Math.max(-1, Math.min(1, x));
const arcCos = x => Math.acos(Math.abs(1 - Math.abs(x)) < 1e-14 ? Math.sign(x) : clamp(x));
export const wrapAngle = a => ((a + Math.PI) % TAU + TAU) % TAU - Math.PI;
export const transpose = A => A[0].map((_, i) => A.map(row => row[i]));
// IK validates every candidate with FK, so this small matrix product is its
// hottest operation. Keep the same summation order without nested callbacks.
export function matMul(A, B) {
  const result = new Array(A.length), columns = B[0].length;
  for (let i = 0; i < A.length; i++) {
    const row = A[i], output = new Array(columns);
    for (let j = 0; j < columns; j++) {
      let sum = 0;
      for (let k = 0; k < row.length; k++) sum += row[k] * B[k][j];
      output[j] = sum;
    }
    result[i] = output;
  }
  return result;
}
export const matVec = (A, x) => A.map(row => row.reduce((v, a, i) => v + a * x[i], 0));
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const rotationZ = a => [[Math.cos(a), -Math.sin(a), 0], [Math.sin(a), Math.cos(a), 0], [0, 0, 1]];
const add = (a, b) => a.map((v, i) => v + b[i]);
const subtract = (a, b) => a.map((v, i) => v - b[i]);

export function fk(q) {
  if (!q || q.length !== 7 || !q.every(Number.isFinite)) throw new TypeError('Expected seven finite joint angles.');
  let p = [0, 0, 0], R = I;
  const origins = [], axes = [], transforms = [];
  for (let i = 0; i < 7; i++) {
    p = add(p, matVec(R, TRANSLATIONS[i]));
    R = matMul(R, ROTATIONS[i]);
    origins.push(p.slice());
    axes.push(R.map(row => row[2]));
    R = matMul(R, rotationZ(q[i]));
    transforms.push({ p: p.slice(), R });
  }
  p = add(p, matVec(R, [0, 0, .045]));
  return { p, R, origins, axes, transforms };
}

// Geometric Jacobian at O_ee, expressed in the world frame, linear rows first.
export function jacobian(q) {
  const frame = fk(q);
  const columns = frame.axes.map((axis, j) => [...cross(axis, subtract(frame.p, frame.origins[j])), ...axis]);
  return transpose(columns);
}

export function limitMargin(q) { return Math.min(...q.map((v, i) => IIWA_LIMITS[i] - Math.abs(v))); }

export function poseDistance(a, b) {
  const positionError = Math.hypot(...subtract(a.p, b.p));
  const delta = matMul(a.R, transpose(b.R));
  const sin = .5 * Math.hypot(delta[2][1] - delta[1][2], delta[0][2] - delta[2][0], delta[1][0] - delta[0][1]);
  const cos = clamp((delta[0][0] + delta[1][1] + delta[2][2] - 1) / 2);
  const orientationError = Math.atan2(sin, cos);
  return { positionError, orientationError, error: Math.max(positionError, orientationError) };
}

/**
 * Genuine closed-form IK with the native third joint held at q3.
 *
 * Let w = p_ee - .126 R_ee e_z - .34 e_z. The URDF's .0607-m
 * wrist-origin shifts lie along joint axes and cancel in this wrist centre.
 * With a=b=.4, c4=(w.w-a²-b²)/(2ab), A=a+b c4,
 * B=-b s4 c3 and C=-b s4 s3, we have
 *   Rz(-q1)w = [A s2+B c2, C, A c2-B s2].
 * Thus q4 has two elbow roots, q2 has two shoulder roots, and the final
 * three axes give two wrist roots. The eight labels identify these algebraic
 * signs, not globally valid SEW classes for a redundant robot.
 *
 * At branch mergers duplicate configurations are returned only once, with
 * mergedBranchIndices. At an underdetermined chart pole a verified canonical
 * representative is returned with freeParameters; it is not eight isolated IKs.
 */
export function inverseFixedQ3(pose, q3) {
  if (!Number.isFinite(q3) || !pose?.p || pose.p.length !== 3 || !pose.p.every(Number.isFinite)
      || !pose?.R || pose.R.length !== 3 || pose.R.some(row => row.length !== 3 || !row.every(Number.isFinite))) return [];
  const { upperArm: a, forearm: b, shoulderHeight: h, toolOffset: d } = IIWA_GEOMETRY;
  const w = pose.p.map((v, i) => v - d * pose.R[i][2] - (i === 2 ? h : 0));
  const c4raw = (w.reduce((sum, v) => sum + v * v, 0) - a * a - b * b) / (2 * a * b);
  if (Math.abs(c4raw) > 1 + 2e-10) return [];
  const q4abs = arcCos(c4raw), roots = [];
  q3 = wrapAngle(q3);
  for (let e = 0; e < 2; e++) {
    const q4 = (e === 0 ? 1 : -1) * q4abs;
    const A = a + b * Math.cos(q4), B = -b * Math.sin(q4) * Math.cos(q3), Cq = -b * Math.sin(q4) * Math.sin(q3);
    const H = Math.hypot(A, B), cylindrical = Math.hypot(w[0], w[1]);
    if (Math.abs(w[2]) > H + 2e-10) continue;
    const shoulderPole = H < 1e-10;
    const beta = shoulderPole ? 0 : arcCos(w[2] / H);
    for (let s = 0; s < 2; s++) {
      const q2 = shoulderPole ? 0 : (s === 0 ? beta : -beta) - Math.atan2(B, A);
      const x = A * Math.sin(q2) + B * Math.cos(q2);
      const azimuthPole = cylindrical < 1e-10 && Math.hypot(x, Cq) < 1e-10;
      const q1 = azimuthPole ? 0 : Math.atan2(w[1], w[0]) - Math.atan2(Cq, x);
      const arm = [q1, q2, q3, q4, 0, 0, 0];
      const R4 = fk(arm).transforms[3].R;
      const W = matMul(transpose(R4), pose.R);
      const q6abs = arcCos(W[1][2]);
      for (let f = 0; f < 2; f++) {
        const q6 = (f === 0 ? 1 : -1) * q6abs, s6 = Math.sin(q6);
        const wristPole = Math.abs(s6) < 1e-9;
        let q5, q7;
        if (wristPole) {
          q5 = 0;
          const residual = matMul(transpose(matMul(matMul(C, matMul(D, rotationZ(q6))), C)), W);
          q7 = Math.atan2(residual[1][0], residual[0][0]);
        } else {
          q5 = Math.atan2(-W[2][2] / s6, W[0][2] / s6);
          q7 = Math.atan2(W[1][1] / s6, -W[1][0] / s6);
        }
        const q = [q1, q2, q3, q4, q5, q6, q7].map(wrapAngle);
        const errors = poseDistance(fk(q), pose);
        if (errors.error > 2e-7) continue;
        const branchIndex = 4 * e + 2 * s + f;
        const previous = roots.find(row => Math.hypot(...row.q.map((v, i) => wrapAngle(v - q[i]))) < 2e-7);
        if (previous) { previous.mergedBranchIndices.push(branchIndex); continue; }
        const margin = limitMargin(q);
        const chartSingular = Math.abs(Math.sin(q4)) < 1e-9 || Math.abs(Math.sin(beta)) < 1e-9 || shoulderPole || azimuthPole || wristPole;
        const freeParameters = [...(shoulderPole ? ['q2'] : []), ...(azimuthPole ? ['q1'] : []), ...(wristPole ? ['q5 (with coupled q7)'] : [])];
        roots.push({ q, branchIndex, branch: `E${e ? '-' : '+'}S${s ? '-' : '+'}W${f ? '-' : '+'}`,
          label: IIWA_BRANCH_LABELS[branchIndex], valid: margin >= -1e-9, limitMargin: margin,
          ...errors, chartSingular, wristSingular: wristPole, shoulderSingular: shoulderPole || azimuthPole || Math.abs(Math.sin(beta)) < 1e-9,
          elbowSingular: Math.abs(Math.sin(q4)) < 1e-9, freeParameters, mergedBranchIndices: [branchIndex] });
      }
    }
  }
  return roots;
}

export const solveIK = (p, R, q3) => inverseFixedQ3({ p, R }, q3);
