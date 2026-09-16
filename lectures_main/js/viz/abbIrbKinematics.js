// ABB IRB 4600-40/2.55, from assets/models/abb_irb/irb4600_40_255.urdf.
// Angles are radians, distances are metres, matrices are nested row-major arrays.
// The world frame is the URDF base_link. Twists are ordered [linear; angular].
export const ABB_PARAMETERS = Object.freeze({
  d1: 0.495, a1: 0.175, a2: 1.095, a3: 0.175, d4: 1.270, d6: 0.135
});

export const ABB_JOINT_LIMITS = Object.freeze([
  [-Math.PI, Math.PI], [-Math.PI / 2, 5 * Math.PI / 6],
  [-Math.PI, 5 * Math.PI / 12], [-20 * Math.PI / 9, 20 * Math.PI / 9],
  [-25 * Math.PI / 36, 2 * Math.PI / 3], [-20 * Math.PI / 9, 20 * Math.PI / 9]
].map(limit => Object.freeze(limit)));

const identity = size => Array.from({ length: size }, (_, row) =>
  Array.from({ length: size }, (_, column) => Number(row === column)));
const multiply = (a, b) => a.map(row => b[0].map((_, column) =>
  row.reduce((sum, value, index) => sum + value * b[index][column], 0)));
const transpose = matrix => matrix[0].map((_, column) => matrix.map(row => row[column]));
const subtract = (a, b) => a.map((value, index) => value - b[index]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const rotate = (matrix, vector) => matrix.map(row =>
  row.reduce((sum, value, index) => sum + value * vector[index], 0));
const position = transform => transform.slice(0, 3).map(row => row[3]);
const orientation = transform => transform.slice(0, 3).map(row => row.slice(0, 3));
const columnsToRows = columns => transpose(columns);

// Standard D-H: Rz(q_i + thetaOffset) Tz(d) Tx(a) Rx(alpha).
// These are assigned D-H frames, not the mesh/link frames in the URDF.
export function abbDHRows(parameters = ABB_PARAMETERS) {
  const p = { ...ABB_PARAMETERS, ...parameters };
  return [
    { thetaOffset: 0, d: p.d1, a: p.a1, alpha: -Math.PI / 2 },
    { thetaOffset: -Math.PI / 2, d: 0, a: p.a2, alpha: 0 },
    { thetaOffset: 0, d: 0, a: p.a3, alpha: -Math.PI / 2 },
    { thetaOffset: 0, d: p.d4, a: 0, alpha: Math.PI / 2 },
    { thetaOffset: 0, d: 0, a: 0, alpha: -Math.PI / 2 },
    { thetaOffset: 0, d: p.d6, a: 0, alpha: 0 }
  ];
}

function dhTransform(theta, { d, a, alpha }) {
  const c = Math.cos(theta), s = Math.sin(theta);
  const ca = Math.cos(alpha), sa = Math.sin(alpha);
  return [[c, -s * ca, s * sa, a * c], [s, c * ca, -c * sa, a * s],
    [0, sa, ca, d], [0, 0, 0, 1]];
}

export function abbDHKinematics(q, parameters = ABB_PARAMETERS) {
  const frames = [identity(4)], points = [], axes = [];
  abbDHRows(parameters).forEach((row, index) => {
    const previous = frames[index];
    points.push(position(previous));
    axes.push(previous.slice(0, 3).map(values => values[2]));
    frames.push(multiply(previous, dhTransform(q[index] + row.thetaOffset, row)));
  });
  return { frames, points, axes, wrist: position(frames[5]), end: position(frames[6]) };
}

function axisTransform(axis, angle, offset = [0, 0, 0]) {
  const c = Math.cos(angle), s = Math.sin(angle), transform = identity(4);
  const i = (axis + 1) % 3, j = (axis + 2) % 3;
  transform[i][i] = c; transform[i][j] = -s;
  transform[j][i] = s; transform[j][j] = c;
  offset.forEach((value, index) => { transform[index][3] = value; });
  return transform;
}

// Mesh transforms retain the original URDF axes z, y, y, x, y, x.
export function abbUrdfTransforms(q, parameters = ABB_PARAMETERS) {
  const p = { ...ABB_PARAMETERS, ...parameters };
  const offsets = [[0, 0, p.d1], [p.a1, 0, 0], [0, 0, p.a2],
    [0, 0, p.a3], [p.d4, 0, 0], [p.d6, 0, 0]];
  const axes = [2, 1, 1, 0, 1, 0];
  const transforms = { base_link: identity(4), base: identity(4) };
  let current = transforms.base_link;
  q.forEach((angle, index) => {
    current = multiply(current, axisTransform(axes[index], angle, offsets[index]));
    transforms[`link_${index + 1}`] = current;
  });
  transforms.flange = current.map(row => row.slice());
  transforms.tool0 = multiply(current, axisTransform(1, Math.PI / 2));
  return transforms;
}

// Full geometric Jacobian of the terminal body's velocity field. `point` is a
// world xyz or a D-H frame-origin index; `basis` is a D-H frame index or a proper
// world-from-basis rotation matrix. Defaults give ^0J_5 at the wrist centre O5.
// Choosing an upstream origin evaluates the SAME terminal body's velocity field
// there; it does not give that upstream link's own material-point Jacobian.
// A moving basis resolves the absolute twist; no relative-frame velocity is subtracted.
export function abbJacobian(q, { point = 5, basis = 0, parameters = ABB_PARAMETERS } = {}) {
  const kinematics = abbDHKinematics(q, parameters);
  const reference = typeof point === 'number' ? position(kinematics.frames[point]) : point;
  const worldFromBasis = typeof basis === 'number' ? orientation(kinematics.frames[basis]) : basis;
  const basisFromWorld = transpose(worldFromBasis);
  return columnsToRows(kinematics.axes.map((axis, index) => [
    ...rotate(basisFromWorld, cross(axis, subtract(reference, kinematics.points[index]))),
    ...rotate(basisFromWorld, axis)
  ]));
}

// Differentiating p5 = [cos(q1) rho, sin(q1) rho, d1 + H] gives the top block.
// The bottom block is the six world-expressed unit joint axes.
export function abbWorldJacobian(q, parameters = ABB_PARAMETERS) {
  const p = { ...ABB_PARAMETERS, ...parameters };
  const [q1, q2, q3, q4, q5] = q;
  const c1 = Math.cos(q1), s1 = Math.sin(q1), s2 = Math.sin(q2);
  const cp = Math.cos(q2 + q3), sp = Math.sin(q2 + q3);
  const c4 = Math.cos(q4), s4 = Math.sin(q4), c5 = Math.cos(q5), s5 = Math.sin(q5);
  const V = p.a3 * sp + p.d4 * cp, U = p.a3 * cp - p.d4 * sp;
  const rho = p.a1 + p.a2 * s2 + V, H = p.a2 * Math.cos(q2) + U;
  const axial = c5 * cp - c4 * s5 * sp;
  return [
    [-s1 * rho, c1 * H, c1 * U, 0, 0, 0],
    [c1 * rho, s1 * H, s1 * U, 0, 0, 0],
    [0, -(p.a2 * s2 + V), -V, 0, 0, 0],
    [0, -s1, -s1, c1 * cp, c1 * s4 * sp - s1 * c4, c1 * axial - s1 * s4 * s5],
    [0, c1, c1, s1 * cp, s1 * s4 * sp + c1 * c4, s1 * axial + c1 * s4 * s5],
    [1, 0, 0, -sp, s4 * cp, -c5 * sp - c4 * s5 * cp]
  ];
}

// Same point O5, resolved along D-H frame 3: ^3J5 = diag(R03^T,R03^T) ^0J5.
export function abbPreferredJacobian(q, parameters = ABB_PARAMETERS) {
  const p = { ...ABB_PARAMETERS, ...parameters };
  const [, q2, q3, q4, q5] = q;
  const c3 = Math.cos(q3), s3 = Math.sin(q3), c4 = Math.cos(q4), s4 = Math.sin(q4);
  const c5 = Math.cos(q5), s5 = Math.sin(q5), cp = Math.cos(q2 + q3), sp = Math.sin(q2 + q3);
  const rho = p.a1 + p.a2 * Math.sin(q2) + p.a3 * sp + p.d4 * cp;
  return [
    [0, p.a2 * s3 - p.d4, -p.d4, 0, 0, 0],
    [-rho, 0, 0, 0, 0, 0],
    [0, p.a2 * c3 + p.a3, p.a3, 0, 0, 0],
    [cp, 0, 0, 0, s4, -c4 * s5],
    [0, -1, -1, 0, -c4, -s4 * s5],
    [-sp, 0, 0, 1, 0, c5]
  ];
}

export function abbFactors(q, parameters = ABB_PARAMETERS) {
  const p = { ...ABB_PARAMETERS, ...parameters }, [, q2, q3, , q5] = q;
  return {
    F: p.a3 * Math.sin(q3) + p.d4 * Math.cos(q3),
    G: p.a1 + p.a2 * Math.sin(q2) + p.a3 * Math.sin(q2 + q3) + p.d4 * Math.cos(q2 + q3),
    wrist: Math.sin(q5)
  };
}

export function abbDeterminant(q, parameters = ABB_PARAMETERS) {
  const { F, G, wrist } = abbFactors(q, parameters);
  return -(parameters.a2 ?? ABB_PARAMETERS.a2) * F * G * wrist;
}

// Each singular preset kills one factor while leaving the other two nonzero.
export function abbPreset(name = 'regular', parameters = ABB_PARAMETERS) {
  const p = { ...ABB_PARAMETERS, ...parameters };
  const q = [20, 15, -35, 25, 35, -20].map(angle => angle * Math.PI / 180);
  if (name === 'F') q[2] = -Math.atan2(p.d4, p.a3);
  else if (name === 'G') {
    const B = p.a2 + p.a3 * Math.cos(q[2]) - p.d4 * Math.sin(q[2]);
    const C = p.a3 * Math.sin(q[2]) + p.d4 * Math.cos(q[2]);
    const radius = Math.hypot(B, C);
    if (Math.abs(p.a1) > radius) throw new RangeError('This geometry has no real G = 0 preset.');
    q[1] = Math.asin(-p.a1 / radius) - Math.atan2(C, B);
  } else if (name === 'wrist') q[4] = 0;
  else if (name !== 'regular') throw new RangeError(`Unknown ABB preset: ${name}`);
  return q;
}

export function determinant(matrix) {
  const a = matrix.map(row => row.slice());
  let result = 1;
  for (let column = 0; column < a.length; column++) {
    let pivot = column;
    for (let row = column + 1; row < a.length; row++) {
      if (Math.abs(a[row][column]) > Math.abs(a[pivot][column])) pivot = row;
    }
    if (a[pivot][column] === 0) return 0;
    if (pivot !== column) { [a[pivot], a[column]] = [a[column], a[pivot]]; result *= -1; }
    const value = a[column][column];
    result *= value;
    for (let row = column + 1; row < a.length; row++) {
      const factor = a[row][column] / value;
      for (let next = column + 1; next < a.length; next++) a[row][next] -= factor * a[column][next];
    }
  }
  return result;
}

export function numericRank(matrix, relativeTolerance = 1e-10) {
  const a = matrix.map(row => row.slice());
  const tolerance = Math.max(...a.flat().map(Math.abs), 1) * relativeTolerance;
  let rank = 0;
  for (let column = 0; column < a[0].length && rank < a.length; column++) {
    let pivot = rank;
    for (let row = rank + 1; row < a.length; row++) {
      if (Math.abs(a[row][column]) > Math.abs(a[pivot][column])) pivot = row;
    }
    if (Math.abs(a[pivot][column]) <= tolerance) continue;
    [a[pivot], a[rank]] = [a[rank], a[pivot]];
    for (let row = rank + 1; row < a.length; row++) {
      const factor = a[row][column] / a[rank][column];
      for (let next = column; next < a[0].length; next++) a[row][next] -= factor * a[rank][next];
    }
    rank++;
  }
  return rank;
}
