'use strict';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let abb;
before(async () => {
  const source = fs.readFileSync(path.join(__dirname, '../js/viz/abbIrbKinematics.js'), 'utf8');
  abb = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
});

function close(actual, expected, tolerance = 2e-10) {
  if (Array.isArray(expected)) {
    assert.equal(actual.length, expected.length);
    expected.forEach((value, index) => close(actual[index], value, tolerance));
    return;
  }
  assert.ok(Number.isFinite(actual), `Expected finite value; received ${actual}`);
  assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)),
    `${actual} differs from ${expected}`);
}

// Parse the supplied model rather than copying its lengths or axis convention
// into the reference implementation. Independent FK uses quaternion composition.
const urdf = fs.readFileSync(path.join(__dirname, '../assets/models/abb_irb/irb4600_40_255.urdf'), 'utf8');
const attribute = (source, name) => source.match(new RegExp(`${name}="([^"]*)"`))?.[1];
const vectorAttribute = (source, name) => attribute(source, name).trim().split(/\s+/).map(Number);
const joints = [...urdf.matchAll(/<joint\b([^>]*)>([\s\S]*?)<\/joint>/g)].map(([, head, body]) => ({
  name: attribute(head, 'name'), type: attribute(head, 'type'),
  parent: attribute(body.match(/<parent\b([^>]*)/)[1], 'link'),
  child: attribute(body.match(/<child\b([^>]*)/)[1], 'link'),
  origin: vectorAttribute(body.match(/<origin\b([^>]*)/)[1], 'xyz'),
  rpy: vectorAttribute(body.match(/<origin\b([^>]*)/)[1], 'rpy'),
  axis: body.includes('<axis') ? vectorAttribute(body.match(/<axis\b([^>]*)/)[1], 'xyz') : [0, 0, 0],
  limits: body.includes('<limit') ? ['lower', 'upper'].map(name =>
    Number(attribute(body.match(/<limit\b([^>]*)/)[1], name))) : null
}));

const quaternionProduct = ([w, x, y, z], [v, i, j, k]) => [
  w * v - x * i - y * j - z * k, w * i + x * v + y * k - z * j,
  w * j - x * k + y * v + z * i, w * k + x * j - y * i + z * v
];
const conjugate = ([w, x, y, z]) => [w, -x, -y, -z];
const rotation = (axis, angle) => [Math.cos(angle / 2), ...axis.map(value => value * Math.sin(angle / 2))];
const rotate = (q, vector) => quaternionProduct(quaternionProduct(q, [0, ...vector]), conjugate(q)).slice(1);
const add = (a, b) => a.map((value, index) => value + b[index]);
const subtract = (a, b) => a.map((value, index) => value - b[index]);
const transpose = matrix => matrix[0].map((_, column) => matrix.map(row => row[column]));
const multiply = (a, b) => a.map(row => b[0].map((_, column) =>
  row.reduce((sum, value, index) => sum + value * b[index][column], 0)));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const orientationMatrix = q => transpose([[1, 0, 0], [0, 1, 0], [0, 0, 1]].map(axis => rotate(q, axis)));
const transformMatrix = ({ position, orientation }) => [
  ...orientationMatrix(orientation).map((row, index) => [...row, position[index]]), [0, 0, 0, 1]
];

function independentFK(q) {
  const links = { base_link: { position: [0, 0, 0], orientation: [1, 0, 0, 0] } };
  let jointIndex = 0;
  for (const joint of joints) {
    const parent = links[joint.parent];
    const position = add(parent.position, rotate(parent.orientation, joint.origin));
    const [roll, pitch, yaw] = joint.rpy;
    const originRotation = quaternionProduct(rotation([0, 0, 1], yaw),
      quaternionProduct(rotation([0, 1, 0], pitch), rotation([1, 0, 0], roll)));
    let orientation = quaternionProduct(parent.orientation, originRotation);
    if (joint.type === 'revolute') orientation = quaternionProduct(orientation, rotation(joint.axis, q[jointIndex++]));
    links[joint.child] = { position, orientation };
  }
  return links;
}

function finiteDifferenceJacobian(q, pointAtConfiguration) {
  const step = 1e-6, nominal = independentFK(q);
  const columns = q.map((_, index) => {
    const plus = q.slice(), minus = q.slice();
    plus[index] += step; minus[index] -= step;
    const forward = independentFK(plus), backward = independentFK(minus);
    const linear = subtract(pointAtConfiguration(forward), pointAtConfiguration(backward)).map(value => value / (2 * step));
    const orientationDerivative = subtract(forward.tool0.orientation, backward.tool0.orientation)
      .map(value => value / (2 * step));
    const angular = quaternionProduct(orientationDerivative, conjugate(nominal.tool0.orientation))
      .slice(1).map(value => 2 * value);
    return [...linear, ...angular];
  });
  return transpose(columns);
}

// Cofactor expansion is independent of the production elimination algorithm.
function independentDeterminant(matrix) {
  if (matrix.length === 1) return matrix[0][0];
  return matrix[0].reduce((sum, value, column) => sum + (column % 2 ? -1 : 1) * value *
    independentDeterminant(matrix.slice(1).map(row => row.filter((_, index) => index !== column))), 0);
}

const configurations = [
  [0, 0, 0, 0, 0, 0], [.3, -.6, .8, .4, .9, -.5], [-1.1, .7, -.9, 1.2, -.6, 1.7],
  [2, -1.4, -1.6, -2.3, 1.3, .2], [-2.6, 2.2, -2.4, 5.8, -1.7, -5.3]
];

test('ABB dimensions and joint limits come from the supplied IRB4600-40/2.55 URDF', () => {
  const moving = joints.filter(joint => joint.type === 'revolute');
  const p = abb.ABB_PARAMETERS;
  close(moving.map(joint => Math.hypot(...joint.origin)), [p.d1, p.a1, p.a2, p.a3, p.d4, p.d6]);
  close(moving.map(joint => joint.limits), abb.ABB_JOINT_LIMITS);
  close(moving.map(joint => joint.axis), [[0, 0, 1], [0, 1, 0], [0, 1, 0], [1, 0, 0], [0, 1, 0], [1, 0, 0]]);
});

test('assigned D-H chain and mesh transforms reproduce independently parsed URDF FK', () => {
  const dh6ToFlange = [[0, 0, 1, 0], [0, -1, 0, 0], [1, 0, 0, 0], [0, 0, 0, 1]];
  const dh6ToTool0 = [[-1, 0, 0, 0], [0, -1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
  for (const q of configurations) {
    const reference = independentFK(q), dh = abb.abbDHKinematics(q), mesh = abb.abbUrdfTransforms(q);
    for (const [name, link] of Object.entries(reference)) close(mesh[name], transformMatrix(link));
    close(dh.wrist, reference.link_5.position);
    close(dh.end, reference.tool0.position);
    close(multiply(dh.frames[6], dh6ToFlange), transformMatrix(reference.flange));
    close(multiply(dh.frames[6], dh6ToTool0), transformMatrix(reference.tool0));
  }
});

test('world Jacobian at O5 matches independent position and orientation differentiation', () => {
  for (const q of configurations) {
    const differentiated = finiteDifferenceJacobian(q, links => links.link_5.position);
    close(abb.abbWorldJacobian(q), differentiated, 3e-8);
    close(abb.abbJacobian(q), differentiated, 3e-8);
    close(abb.abbWorldJacobian(q).slice(0, 3).map(row => row.slice(3)), [[0, 0, 0], [0, 0, 0], [0, 0, 0]]);
    close(abb.abbDeterminant(q), independentDeterminant(differentiated), 3e-8);
  }
});

test('preferred ^3J5 follows by rotating both world blocks without a point shift', () => {
  for (const p of [abb.ABB_PARAMETERS, { d1: .2, a1: .3, a2: 1.4, a3: .4, d4: .8, d6: .23 }]) {
    for (const q of configurations) {
      const R30 = transpose(abb.abbDHKinematics(q, p).frames[3].slice(0, 3).map(row => row.slice(0, 3)));
      const world = abb.abbWorldJacobian(q, p);
      const rotated = [...multiply(R30, world.slice(0, 3)), ...multiply(R30, world.slice(3))];
      close(abb.abbPreferredJacobian(q, p), rotated);
      close(abb.abbPreferredJacobian(q, p), abb.abbJacobian(q, { basis: 3, parameters: p }));
      close(abb.abbDeterminant(q, p), independentDeterminant(rotated));
    }
  }
});

test('an arbitrary terminal-body material point agrees with independent differentiation', () => {
  const offsetInTool = [.13, -.21, .18];
  const materialPoint = links => add(links.tool0.position, rotate(links.tool0.orientation, offsetInTool));
  for (const q of configurations) {
    const point = materialPoint(independentFK(q));
    const J = abb.abbJacobian(q, { point });
    close(J, finiteDifferenceJacobian(q, materialPoint), 3e-8);
    close(abb.determinant(J), abb.abbDeterminant(q));
  }
});

test('reference-point shifts and proper basis rotations preserve the full determinant and rank', () => {
  const arbitraryBasis = orientationMatrix(quaternionProduct(rotation([1, 0, 0], .6), rotation([0, 0, 1], -.9)));
  for (const name of ['regular', 'F', 'G', 'wrist']) {
    const q = abb.abbPreset(name), world = abb.abbWorldJacobian(q), wrist = abb.abbDHKinematics(q).wrist;
    const expectedRank = name === 'regular' ? 6 : 5;
    for (const point of [0, 3, 5, 6, [.4, -.7, 1.2]]) {
      for (const basis of [0, 1, 3, 6, arbitraryBasis]) {
        const J = abb.abbJacobian(q, { point, basis });
        close(abb.determinant(J), abb.abbDeterminant(q));
        assert.equal(abb.numericRank(J), expectedRank);
      }
    }
    // Explicit point-shift check: v_P = v_O5 + omega × (p_P - p_O5).
    const point = [.4, -.7, 1.2], offset = subtract(point, wrist);
    const shifted = transpose(transpose(world).map(column => [
      ...add(column.slice(0, 3), cross(column.slice(3), offset)), ...column.slice(3)
    ]));
    close(abb.abbJacobian(q, { point }), shifted);
  }
});

test('each singular preset isolates one factor, obeys joint limits, and loses one task direction', () => {
  for (const name of ['regular', 'F', 'G', 'wrist']) {
    const q = abb.abbPreset(name), factors = abb.abbFactors(q), J = abb.abbPreferredJacobian(q);
    q.forEach((angle, index) => assert.ok(angle >= abb.ABB_JOINT_LIMITS[index][0] &&
      angle <= abb.ABB_JOINT_LIMITS[index][1], `${name}: joint ${index + 1} outside URDF limits`));
    for (const [factor, value] of Object.entries(factors)) {
      if (factor === name) close(value, 0, 1e-12);
      else assert.ok(Math.abs(value) > 1e-3, `${name} unexpectedly also kills ${factor}`);
    }
    const arm = J.slice(0, 3).map(row => row.slice(0, 3));
    const wrist = J.slice(3).map(row => row.slice(3));
    assert.equal(abb.numericRank(J), name === 'regular' ? 6 : 5);
    assert.equal(abb.numericRank(arm), ['F', 'G'].includes(name) ? 2 : 3);
    assert.equal(abb.numericRank(wrist), name === 'wrist' ? 2 : 3);
    close(independentDeterminant(arm), abb.ABB_PARAMETERS.a2 * factors.F * factors.G);
    close(independentDeterminant(wrist), -factors.wrist);
    close(independentDeterminant(J), abb.abbDeterminant(q));
  }
});

test('arm and wrist column dependencies match the rank-loss explanations', () => {
  const { a3, d4 } = abb.ABB_PARAMETERS;
  const F = abb.abbPreferredJacobian(abb.abbPreset('F'));
  F[0].forEach((value, column) => close(a3 * value + d4 * F[2][column], 0));
  const G = abb.abbPreferredJacobian(abb.abbPreset('G'));
  close(G[1], [0, 0, 0, 0, 0, 0]);
  for (const q5 of [0, Math.PI]) {
    const q = abb.abbPreset('regular'); q[4] = q5;
    abb.abbPreferredJacobian(q).forEach(row => close(row[5], Math.cos(q5) * row[3]));
  }
});
