'use strict';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');

let lecture;
before(async () => {
  const filename = path.join(__dirname, '../js/viz/singularityLecture.js');
  const THREE = await import(pathToFileURL(path.join(__dirname, '../vendor/three/build/three.module.js')).href);
  // Exercise the production mathematics without initializing a DOM or WebGL.
  const source = fs.readFileSync(filename, 'utf8')
    .replace(/^import .*;\s*$/gm, '')
    .replace(/\bexport function /g, 'function ')
    .replace(/import\.meta\.url/g, JSON.stringify(pathToFileURL(filename).href));
  const context = vm.createContext({ THREE, URL });
  vm.runInContext(`${source}\nglobalThis.testAPI = {
    course3RDet, dh3FactoredValue, dhKinematics, positionJacobian, screwJacobian,
    symbolicPreferential6R, symbolicPreferential6RDet, preferential6RRows,
    preferential6RFactors, preferential6RPreset, numericRank, determinant,
    parameters: PREFERENTIAL_6R_PARAMETERS
  };`, context, { filename });
  lecture = context.testAPI;
});

function close(actual, expected, tolerance = 2e-10) {
  if (Array.isArray(expected)) {
    assert.equal(actual.length, expected.length);
    expected.forEach((value, index) => close(actual[index], value, tolerance));
    return;
  }
  assert.ok(Number.isFinite(actual), `Expected a finite value, received ${actual}`);
  assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)),
    `${actual} differs from ${expected}`);
}

// Independent FK uses quaternion composition, not THREE matrices or the
// lecture's D-H transforms. This also supplies a separate geometric reference.
const multiplyQuaternion = ([w, x, y, z], [v, i, j, k]) => [
  w*v-x*i-y*j-z*k, w*i+x*v+y*k-z*j, w*j-x*k+y*v+z*i, w*k+x*j-y*i+z*v
];
const conjugate = ([w, x, y, z]) => [w, -x, -y, -z];
function rotation(axis, angle) {
  const q = [Math.cos(angle / 2), 0, 0, 0];
  q[axis + 1] = Math.sin(angle / 2);
  return q;
}
const rotate = (q, vector) => multiplyQuaternion(multiplyQuaternion(q, [0, ...vector]), conjugate(q)).slice(1);
const subtract = (a, b) => a.map((value, index) => value - b[index]);
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];

function independentFK(q, rows) {
  let position = [0, 0, 0], orientation = [1, 0, 0, 0];
  const points = [], axes = [], frames = [{ position, orientation }];
  rows.forEach(([a, alpha, d], index) => {
    points.push(position);
    axes.push(rotate(orientation, [0, 0, 1]));
    const aboutJoint = multiplyQuaternion(orientation, rotation(2, q[index]));
    const offset = rotate(aboutJoint, [a, 0, d]);
    position = position.map((value, component) => value + offset[component]);
    orientation = multiplyQuaternion(aboutJoint, rotation(0, alpha));
    frames.push({ position, orientation });
  });
  return { points, axes, frames, end: position };
}

function finiteDifferencePositionJacobian(q, rows) {
  const step = 1e-6;
  const columns = q.map((_, index) => {
    const plus = q.slice(), minus = q.slice();
    plus[index] += step;
    minus[index] -= step;
    return subtract(independentFK(plus, rows).end, independentFK(minus, rows).end)
      .map(value => value / (2 * step));
  });
  return [0, 1, 2].map(row => columns.map(column => column[row]));
}

function independentScrewJacobian(kinematics, pointIndex, frameIndex) {
  const reference = kinematics.frames[pointIndex].position;
  const basis = conjugate(kinematics.frames[frameIndex].orientation);
  const columns = kinematics.axes.map((axis, index) => [
    ...rotate(basis, cross(axis, subtract(reference, kinematics.points[index]))),
    ...rotate(basis, axis)
  ]);
  return Array.from({ length: 6 }, (_, row) => columns.map(column => column[row]));
}

// Cofactor expansion is independent of the production elimination routine.
function independentDeterminant(matrix) {
  if (matrix.length === 1) return matrix[0][0];
  return matrix[0].reduce((sum, value, column) => sum + (column % 2 ? -1 : 1) * value *
    independentDeterminant(matrix.slice(1).map(row => row.filter((_, index) => index !== column))), 0);
}

const configurations3R = [
  [0, 0, 0], [.4, -.7, .9], [-1.2, 1.1, -.6], [2.4, -2.1, 2.6],
  [.7, Math.PI / 2, .3], [-.2, .8, Math.atan(.5)]
];

test('both plotted 3R determinant families agree with independent FK differentiation', () => {
  for (const a1 of [0, 1]) {
    for (const [d1, alpha3] of [[.3, -.8], [1.7, 1.2]]) {
      const rows = [[a1, Math.PI / 2, d1], [2, Math.PI / 2, 1], [1.5, alpha3, 0]];
      for (const q of configurations3R) {
        const differentiated = finiteDifferencePositionJacobian(q, rows);
        const geometric = lecture.dhKinematics({ q, rows });
        close(lecture.positionJacobian(geometric.axes, geometric.points, geometric.end), differentiated, 2e-8);
        close(lecture.course3RDet(q, a1), independentDeterminant(differentiated), 2e-8);
      }
    }
  }
  // In the intersecting-axis family these are complete singularity lines.
  for (const q3 of [-2.4, -.6, .7, 2.2]) {
    close(lecture.course3RDet([.3, Math.PI / 2, q3], 0), 0);
  }
  // The offset removes that automatic line: its additional term matters.
  assert.ok(Math.abs(lecture.course3RDet([.3, Math.PI / 2, .7], 1)) > .1);
});

test('editable general 3R factorization agrees with independent FK differentiation', () => {
  const geometries = [
    [[.8, .4, .6], [1.7, -1.1, .5], [1.2, .9, .3]],
    [[0, Math.PI / 2, .8], [2, 0, .2], [.7, -.5, 0]],
    [[1, -Math.PI / 2, .3], [.6, 1.8, .7], [1.9, .2, .4]]
  ];
  for (const rows of geometries) {
    for (const q of configurations3R.slice(0, 4)) {
      close(lecture.dh3FactoredValue(q, rows),
        independentDeterminant(finiteDifferencePositionJacobian(q, rows)), 3e-8);
    }
  }
});

test('every symbolic 6R entry and its determinant agree with independent geometric D-H screws', () => {
  const geometries = [
    lecture.parameters,
    { a1: .4, a2: 1.3, a3: .9, a6: .2, d1: .3, d4: .8, d6: .6, alpha2: -.7 },
    { a1: 0, a2: 2.1, a3: .5, a6: .7, d1: 1.4, d4: 1.1, d6: .2, alpha2: 0 }
  ];
  const configurations = [
    [.3, -.6, .8, .4, .9, -.5], [-1.1, .7, -.9, 1.2, -.6, 1.7],
    [2, -1.4, 1.6, -2.3, 1.3, .2]
  ];
  for (const p of geometries) {
    const rows = lecture.preferential6RRows(p);
    for (const q of configurations) {
      const expected = independentScrewJacobian(independentFK(q, rows), 5, 3);
      close(lecture.symbolicPreferential6R(q, p), expected);
      close(lecture.screwJacobian(lecture.dhKinematics({ q, rows }), 5, 3), expected);
      close(lecture.symbolicPreferential6RDet(q, p), independentDeterminant(expected));
    }
  }
});

test('each F, G, and wrist preset isolates one factor and loses exactly one task direction', () => {
  const p = lecture.parameters, rows = lecture.preferential6RRows(p);
  for (const preset of ['regular', 'F', 'G', 'wrist']) {
    const q = lecture.preferential6RPreset(preset);
    const factors = lecture.preferential6RFactors(q, p);
    const J = independentScrewJacobian(independentFK(q, rows), 5, 3);
    const arm = J.slice(0, 3).map(row => row.slice(0, 3));
    const wrist = J.slice(3).map(row => row.slice(3));
    for (const [name, value] of Object.entries(factors)) {
      if (name === preset) close(value, 0, 1e-12);
      else assert.ok(Math.abs(value) > 1e-3, `${preset} unexpectedly collapses ${name}`);
    }
    assert.equal(lecture.numericRank(J), preset === 'regular' ? 6 : 5);
    assert.equal(lecture.numericRank(arm), ['F', 'G'].includes(preset) ? 2 : 3);
    assert.equal(lecture.numericRank(wrist), preset === 'wrist' ? 2 : 3);
    close(independentDeterminant(J), factors.F * factors.G * factors.wrist);
  }
});

test('the arm-plane and wrist-cancellation explanations follow from the displayed columns', () => {
  const p = lecture.parameters;
  const arm = lecture.symbolicPreferential6R(lecture.preferential6RPreset('F'), p).slice(0, 3);
  for (let column = 0; column < 6; column++) {
    close(p.a3 * arm[0][column] + p.d4 * arm[2][column], 0);
  }
  for (const q5 of [0, Math.PI]) {
    const q = lecture.preferential6RPreset('regular');
    q[4] = q5;
    const J = lecture.symbolicPreferential6R(q, p);
    J.forEach(row => close(Math.cos(q5) * row[3] + row[5], 0));
  }
});

test('rigid basis and reference-point changes preserve the full 6R determinant and rank', () => {
  const p = lecture.parameters, rows = lecture.preferential6RRows(p);
  const configurations = ['regular', 'F', 'G', 'wrist'].map(name => lecture.preferential6RPreset(name));
  const combined = lecture.preferential6RPreset('F');
  combined[4] = 0;
  configurations.push(combined);
  for (const q of configurations) {
    const geometric = lecture.dhKinematics({ q, rows });
    const independent = independentFK(q, rows);
    const ordinary = independentScrewJacobian(independent, 6, 0);
    const expectedDeterminant = independentDeterminant(ordinary);
    const expectedRank = lecture.numericRank(ordinary);
    for (const frame of [0, 1, 3, 6]) {
      for (const point of [0, 3, 5, 6]) {
        const J = lecture.screwJacobian(geometric, point, frame);
        close(J, independentScrewJacobian(independent, point, frame));
        close(lecture.determinant(J), expectedDeterminant);
        assert.equal(lecture.numericRank(J), expectedRank);
      }
    }
  }
});
