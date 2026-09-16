'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Regression checks for the lecture's two different 3R examples. The displayed
// closed forms are checked against quaternion FK and central differentiation.
const configurations = [
  [0, 0, 0], [.4, -.7, .9], [-1.2, 1.1, -.6], [2.4, -2.1, 2.6],
  [.7, Math.PI / 2, .3], [-.2, .8, Math.atan(.5)],
];
const add = (a, b) => a.map((value, i) => value + b[i]);
const subtract = (a, b) => a.map((value, i) => value - b[i]);
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0],
];
const multiply = ([w, x, y, z], [v, i, j, k]) => [
  w*v-x*i-y*j-z*k, w*i+x*v+y*k-z*j, w*j-x*k+y*v+z*i, w*k+x*j-y*i+z*v,
];
const rotation = (axis, angle) => [Math.cos(angle / 2), ...axis.map(value => value * Math.sin(angle / 2))];
const rotate = (q, v) => multiply(multiply(q, [0, ...v]), [q[0], -q[1], -q[2], -q[3]]).slice(1);
function close(actual, expected, tolerance = 3e-10) {
  if (Array.isArray(expected)) {
    assert.equal(actual.length, expected.length);
    expected.forEach((value, index) => close(actual[index], value, tolerance));
  } else {
    assert.ok(Number.isFinite(actual));
    assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)),
      `${actual} differs from ${expected}`);
  }
}
function columnsToRows(columns) {
  return [0, 1, 2].map(row => columns.map(column => column[row]));
}
function derivative(position, q) {
  const step = 1e-6;
  return columnsToRows(q.map((_, index) => {
    const plus = q.slice(), minus = q.slice();
    plus[index] += step;
    minus[index] -= step;
    return subtract(position(plus), position(minus)).map(value => value / (2 * step));
  }));
}

function readUrdfJoints(filename) {
  const urdf = fs.readFileSync(path.join(__dirname, '../assets/models/custom_3R', filename), 'utf8');
  return [...urdf.matchAll(/<joint\s+([^>]+)>([\s\S]*?)<\/joint>/g)].map(([, attributes, body]) => {
    const attribute = (text, name) => text.match(new RegExp(`${name}="([^"]+)"`))?.[1];
    const origin = body.match(/<origin\s+([^>]+)\/>/)[1];
    return {
      type: attribute(attributes, 'type'),
      offset: attribute(origin, 'xyz').split(/\s+/).map(Number),
      rpy: attribute(origin, 'rpy').split(/\s+/).map(Number),
      axis: body.match(/<axis xyz="([^"]+)"/)?.[1].split(/\s+/).map(Number),
    };
  });
}
const joints = readUrdfJoints('custom_3R_new.urdf');

function urdfFK(q, modelJoints = joints) {
  let position = [0, 0, 0], orientation = [1, 0, 0, 0], jointIndex = 0;
  const origins = [], axes = [];
  for (const joint of modelJoints) {
    position = add(position, rotate(orientation, joint.offset));
    const [roll, pitch, yaw] = joint.rpy;
    const fixed = multiply(multiply(rotation([0, 0, 1], yaw), rotation([0, 1, 0], pitch)), rotation([1, 0, 0], roll));
    orientation = multiply(orientation, fixed);
    if (joint.type !== 'fixed') {
      origins.push(position.slice());
      axes.push(rotate(orientation, joint.axis));
      orientation = multiply(orientation, rotation(joint.axis, q[jointIndex++]));
    }
  }
  assert.equal(jointIndex, 3);
  return { position, origins, axes };
}

function displayedUrdfSymbols([q1, q2, q3]) {
  const c1 = Math.cos(q1), s1 = Math.sin(q1), c2 = Math.cos(q2), s2 = Math.sin(q2);
  const c3 = Math.cos(q3), s3 = Math.sin(q3), L = 2 + 1.5*c3;
  const A = 1 + L*c2 + .75*s2, B = 1.25 + 1.5*s3;
  return {
    position: [c1*A-s1*B, s1*A+c1*B, 1-L*s2+.75*c2],
    origins: [[0, 0, .5], [c1, s1, 1], [c1*(1+2*c2)-1.25*s1, s1*(1+2*c2)+1.25*c1, 1-2*s2]],
    axes: [[0, 0, 1], [-s1, c1, 0], [c1*s2, s1*s2, c2]],
  };
}

test('course URDF symbolic tool position, joint origins, and axes match the actual model', () => {
  for (const q of configurations) {
    const actual = displayedUrdfSymbols(q), expected = urdfFK(q);
    close(actual.position, expected.position);
    close(actual.origins, expected.origins);
    close(actual.axes, expected.axes);
  }
});

test('cross products from the displayed URDF symbols equal differentiated tool motion', () => {
  for (const q of configurations) {
    const { position, origins, axes } = displayedUrdfSymbols(q);
    const matrix = columnsToRows(axes.map((axis, i) => cross(axis, subtract(position, origins[i]))));
    close(matrix, derivative(angles => urdfFK(angles).position, q), 2e-8);
    if (q.every(value => value === 0)) close(matrix, [[-1.25, .75, 0], [4.5, 0, 1.5], [0, -3.5, 0]]);
  }
});

// The original and extended terminal links vary h, while new_0 varies a.
// These are separate geometric changes and must not share one offset formula.
function actualUrdfJacobian([q1, q2, q3], a, h) {
  const c1 = Math.cos(q1), s1 = Math.sin(q1), c2 = Math.cos(q2), s2 = Math.sin(q2);
  const c3 = Math.cos(q3), s3 = Math.sin(q3), L = 2 + 1.5*c3, B = 1.25 + 1.5*s3;
  const D = L*c2 + h*s2, A = a + D, C = -L*s2 + h*c2;
  return [
    [-s1*A-c1*B, c1*C, -1.5*(c1*c2*s3+s1*c3)],
    [c1*A-s1*B, s1*C, 1.5*(c1*c3-s1*c2*s3)],
    [0, -D, 1.5*s2*s3],
  ];
}

test('full Jacobians and determinants distinguish the supplied terminal and first-axis offsets', () => {
  for (const [filename, a, h] of [
    ['custom_3R.urdf', 1, .25],
    ['custom_3R_new.urdf', 1, .75],
    ['custom_3R_new_0.urdf', 0, .75],
  ]) {
    const modelJoints = readUrdfJoints(filename);
    for (const q of configurations) {
      const matrix = actualUrdfJacobian(q, a, h);
      close(matrix, derivative(angles => urdfFK(angles, modelJoints).position, q), 2e-8);
      const c2 = Math.cos(q[1]), s2 = Math.sin(q[1]), c3 = Math.cos(q[2]), s3 = Math.sin(q[2]);
      const L = 2 + 1.5*c3;
      close(cofactorDeterminant(matrix), 1.5*(a*L*s3+(L*c2+h*s2)*(2*s3-1.25*c3)));
    }
  }
  for (const q of configurations) {
    const c1 = Math.cos(q[0]), s1 = Math.sin(q[0]), c2 = Math.cos(q[1]), s2 = Math.sin(q[1]);
    const straight = actualUrdfJacobian(q, 1, .25), extended = actualUrdfJacobian(q, 1, .75);
    const intersecting = actualUrdfJacobian(q, 0, .75);
    close(extended.map((row, i) => subtract(row, straight[i])), [
      [-.5*s1*s2, .5*c1*c2, 0], [.5*c1*s2, .5*s1*c2, 0], [0, -.5*s2, 0],
    ]);
    close(extended.map((row, i) => subtract(row, intersecting[i])), [
      [-s1, 0, 0], [c1, 0, 0], [0, 0, 0],
    ]);
  }
});

test('a position singularity can retain two independent columns', () => {
  const q = [.4, 0, Math.atan(1.25 / 3)];
  const J = actualUrdfJacobian(q, 1, .75);
  close(cofactorDeterminant(J), 0);
  assert.equal(rank(J), 2);
  const columns = columnsToRows(J);
  assert.ok(Math.hypot(...cross(columns[0], columns[1])) > 1);
});

function independentDHPosition(q, a1, d1, alpha3) {
  let position = [0, 0, 0], orientation = [1, 0, 0, 0];
  const rows = [[a1, d1, Math.PI / 2], [2, 1, Math.PI / 2], [1.5, 0, alpha3]];
  rows.forEach(([a, d, alpha], index) => {
    orientation = multiply(orientation, rotation([0, 0, 1], q[index]));
    position = add(position, rotate(orientation, [a, 0, d]));
    orientation = multiply(orientation, rotation([1, 0, 0], alpha));
  });
  return position;
}

function displayedDHJacobian([q1, q2, q3], a1) {
  const c1 = Math.cos(q1), s1 = Math.sin(q1), c2 = Math.cos(q2), s2 = Math.sin(q2);
  const c3 = Math.cos(q3), s3 = Math.sin(q3), L = 2 + 1.5*c3, M = 1 + 1.5*s3;
  const zeroOffset = [
    [-s1*L*c2+c1*M, -c1*L*s2, 1.5*(s1*c3-c1*c2*s3)],
    [c1*L*c2+s1*M, -s1*L*s2, -1.5*(c1*c3+s1*c2*s3)],
    [0, L*c2, -1.5*s2*s3],
  ];
  zeroOffset[0][0] -= a1*s1;
  zeroOffset[1][0] += a1*c1;
  return zeroOffset;
}

test('both displayed D-H Jacobians and their general offset determinant agree with independent differentiation', () => {
  for (const a1 of [0, .35, 1, 1.8]) {
    for (const [d1, alpha3] of [[.3, -.8], [1.7, 1.2]]) {
      for (const q of configurations) {
        const matrix = displayedDHJacobian(q, a1);
        close(matrix, derivative(angles => independentDHPosition(angles, a1, d1, alpha3), q), 2e-8);
        const [a, b, c] = matrix;
        const determinant = a[0]*(b[1]*c[2]-b[2]*c[1]) - a[1]*(b[0]*c[2]-b[2]*c[0]) + a[2]*(b[0]*c[1]-b[1]*c[0]);
        const c2 = Math.cos(q[1]), c3 = Math.cos(q[2]), s3 = Math.sin(q[2]);
        close(determinant, .75*(3*c3+4)*(c2*(c3-2*s3)-a1*s3));
      }
    }
  }
});

const transpose = matrix => matrix[0].map((_, column) => matrix.map(row => row[column]));
const matrixProduct = (a, b) => a.map(row => b[0].map((_, column) =>
  row.reduce((sum, value, index) => sum + value * b[index][column], 0)));
const matrixVector = (matrix, vector) => matrix.map(row => row.reduce((sum, value, i) => sum + value * vector[i], 0));
const identity = size => Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, column) => Number(row === column)));
const zero3 = () => Array.from({ length: 3 }, () => [0, 0, 0]);
const blockMatrix = (a, b, c, d) => [...a.map((row, i) => [...row, ...b[i]]), ...c.map((row, i) => [...row, ...d[i]])];
function cofactorDeterminant(matrix) {
  if (matrix.length === 1) return matrix[0][0];
  return matrix[0].reduce((sum, value, column) => sum + (-1) ** column * value *
    cofactorDeterminant(matrix.slice(1).map(row => row.filter((_, index) => index !== column))), 0);
}
function rank(matrix) {
  const a = matrix.map(row => row.slice());
  let pivotRow = 0;
  for (let column = 0; column < a[0].length && pivotRow < a.length; column++) {
    let selected = pivotRow;
    for (let row = pivotRow + 1; row < a.length; row++) {
      if (Math.abs(a[row][column]) > Math.abs(a[selected][column])) selected = row;
    }
    if (Math.abs(a[selected][column]) < 1e-10) continue;
    [a[pivotRow], a[selected]] = [a[selected], a[pivotRow]];
    for (let row = pivotRow + 1; row < a.length; row++) {
      const scale = a[row][column] / a[pivotRow][column];
      for (let k = column; k < a[0].length; k++) a[row][k] -= scale * a[pivotRow][k];
    }
    pivotRow++;
  }
  return pivotRow;
}
function rpyRotation([phi, theta, psi]) {
  const q = multiply(multiply(rotation([0, 0, 1], psi), rotation([0, 1, 0], theta)), rotation([1, 0, 0], phi));
  return columnsToRows(identity(3).map(axis => rotate(q, axis)));
}

test('Euler-rate inverse and reordered adjoints match differentiated rotations and rigid point motion', () => {
  // Obtain each world angular-velocity column from dR/dangle R^T, rather than
  // differentiating or reusing the displayed trigonometric E expression.
  for (const angles of [[.3, -.4, .8], [-1.1, .7, -2.2], [.9, -1.2, 2.5]]) {
    const [, theta, psi] = angles, ct = Math.cos(theta), st = Math.sin(theta);
    const cp = Math.cos(psi), sp = Math.sin(psi), Rt = transpose(rpyRotation(angles));
    const E = [[cp*ct, -sp, 0], [sp*ct, cp, 0], [-st, 0, 1]];
    const inverseE = [[cp/ct, sp/ct, 0], [-sp, cp, 0], [cp*Math.tan(theta), sp*Math.tan(theta), 1]];
    const step = 1e-6;
    const independentE = columnsToRows(angles.map((_, joint) => {
      const plus = angles.slice(), minus = angles.slice();
      plus[joint] += step;
      minus[joint] -= step;
      const rp = rpyRotation(plus), rm = rpyRotation(minus);
      const derivativeR = rp.map((row, i) => row.map((value, j) => (value - rm[i][j]) / (2 * step)));
      const skew = matrixProduct(derivativeR, Rt);
      return [(skew[2][1]-skew[1][2])/2, (skew[0][2]-skew[2][0])/2, (skew[1][0]-skew[0][1])/2];
    }));
    close(E, independentE, 2e-8);
    close(matrixProduct(inverseE, E), identity(3));
    close(cofactorDeterminant(E), ct);
    const v = [.4, -.8, .3], rates = [-.6, .2, .9];
    const T = blockMatrix(identity(3), zero3(), zero3(), inverseE);
    close(matrixVector(T, [...v, ...matrixVector(independentE, rates)]), [...v, ...rates], 2e-8);
  }
  for (const theta of [Math.PI / 2, -Math.PI / 2]) {
    const E = [[Math.cos(theta), 0, 0], [0, 1, 0], [-Math.sin(theta), 0, 1]];
    close(cofactorDeterminant(E), 0);
    assert.equal(rank(E), 2);
  }

  const Rt = transpose(rpyRotation([.4, -.5, .7]));
  const r = [.6, -.3, .8], v = [-.2, .4, .5], omega = [.7, .3, -.4];
  const skewR = [[0, -r[2], r[1]], [r[2], 0, -r[0]], [-r[1], r[0], 0]];
  const shiftBlock = matrixProduct(Rt, skewR).map(row => row.map(value => -value));
  const angularFirst = blockMatrix(Rt, zero3(), shiftBlock, Rt);
  const linearFirst = blockMatrix(Rt, shiftBlock, zero3(), Rt);
  const Pi = blockMatrix(zero3(), identity(3), identity(3), zero3());
  close(matrixProduct(matrixProduct(Pi, angularFirst), transpose(Pi)), linearFirst);
  close(matrixVector(Pi, [...omega, ...v]), [...v, ...omega]);
  close(matrixVector(linearFirst, [...v, ...omega]), [
    ...matrixVector(Rt, add(v, cross(omega, r))), ...matrixVector(Rt, omega),
  ]);
  close(cofactorDeterminant(angularFirst), 1);
  close(cofactorDeterminant(linearFirst), 1);
  close(cofactorDeterminant(Pi), -1);

  // A row-order change has odd permutation parity for two groups of three.
  // Distinguish that signed determinant change from an adjoint transformation.
  const regularJ = identity(6).map((row, i) => row.map((value, j) => value * (i + 1) + .07 * Math.sin(2*i-j)));
  const deficientJ = regularJ.map(row => [...row.slice(0, 5), row[2]]);
  for (const [J, expectedRank] of [[regularJ, 6], [deficientJ, 5]]) {
    const reorderedJ = matrixProduct(Pi, J), representedJ = matrixProduct(linearFirst, J);
    assert.equal(rank(J), expectedRank);
    assert.equal(rank(reorderedJ), expectedRank);
    assert.equal(rank(representedJ), expectedRank);
    close(cofactorDeterminant(reorderedJ), -cofactorDeterminant(J));
    close(cofactorDeterminant(representedJ), cofactorDeterminant(J));
  }
});
