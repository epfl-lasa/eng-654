'use strict';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let abb, ik;
before(async () => {
  const source = fs.readFileSync(path.join(__dirname, '../js/viz/abbIrbKinematics.js'), 'utf8');
  const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  abb = await import(url);
  const ikSource = fs.readFileSync(path.join(__dirname, '../js/viz/abbIrbIk.js'), 'utf8')
    .replace('./abbIrbKinematics.js', url);
  ik = await import(`data:text/javascript;base64,${Buffer.from(ikSource).toString('base64')}`);
});

const attribute = (text, name) => text.match(new RegExp(`${name}="([^"]*)"`))?.[1];
const vector = (text, name) => attribute(text, name).split(/\s+/).map(Number);
const urdf = fs.readFileSync(path.join(__dirname, '../assets/models/abb_irb/irb4600_40_255.urdf'), 'utf8');
const joints = [...urdf.matchAll(/<joint\b([^>]*)>([\s\S]*?)<\/joint>/g)].map(([, head, body]) => ({
  type: attribute(head, 'type'), parent: attribute(body.match(/<parent\b([^>]*)/)[1], 'link'),
  child: attribute(body.match(/<child\b([^>]*)/)[1], 'link'),
  origin: vector(body.match(/<origin\b([^>]*)/)[1], 'xyz'),
  rpy: vector(body.match(/<origin\b([^>]*)/)[1], 'rpy'),
  axis: body.includes('<axis') ? vector(body.match(/<axis\b([^>]*)/)[1], 'xyz') : [0, 0, 0]
}));
const quatProduct = ([w, x, y, z], [v, i, j, k]) => [
  w * v - x * i - y * j - z * k, w * i + x * v + y * k - z * j,
  w * j - x * k + y * v + z * i, w * k + x * j - y * i + z * v
];
const conjugate = ([w, x, y, z]) => [w, -x, -y, -z];
const quat = (axis, angle) => [Math.cos(angle / 2), ...axis.map(value => value * Math.sin(angle / 2))];
const rotate = (q, v) => quatProduct(quatProduct(q, [0, ...v]), conjugate(q)).slice(1);
const add = (a, b) => a.map((value, index) => value + b[index]);
const subtract = (a, b) => a.map((value, index) => value - b[index]);
const transpose = matrix => matrix[0].map((_, column) => matrix.map(row => row[column]));
const matrixOf = q => transpose([[1, 0, 0], [0, 1, 0], [0, 0, 1]].map(v => rotate(q, v)));
const normDifference = (a, b) => Math.hypot(...subtract(a.flat(), b.flat()));
const angleDistance = (a, b) => Math.hypot(...a.map((value, index) => Math.atan2(Math.sin(value - b[index]), Math.cos(value - b[index]))));

// Independent quaternion FK reads the actual source model's axis and offset
// sequence; it does not reuse the D-H parameters or production FK routines.
function sourceFK(q) {
  const links = { base_link: { position: [0, 0, 0], orientation: [1, 0, 0, 0] } };
  let index = 0;
  for (const joint of joints) {
    const parent = links[joint.parent], [roll, pitch, yaw] = joint.rpy;
    const position = add(parent.position, rotate(parent.orientation, joint.origin));
    let orientation = quatProduct(parent.orientation, quatProduct(quat([0, 0, 1], yaw),
      quatProduct(quat([0, 1, 0], pitch), quat([1, 0, 0], roll))));
    if (joint.type === 'revolute') orientation = quatProduct(orientation, quat(joint.axis, q[index++]));
    links[joint.child] = { position, orientation };
  }
  return links;
}
function independentJacobian(q) {
  const epsilon = 1e-6, reference = sourceFK(q);
  return transpose(q.map((_, index) => {
    const plus = q.slice(), minus = q.slice(); plus[index] += epsilon; minus[index] -= epsilon;
    const forward = sourceFK(plus), backward = sourceFK(minus);
    const linear = subtract(forward.link_5.position, backward.link_5.position).map(value => value / (2 * epsilon));
    const derivative = subtract(forward.tool0.orientation, backward.tool0.orientation).map(value => value / (2 * epsilon));
    const angular = quatProduct(derivative, conjugate(reference.tool0.orientation)).slice(1).map(value => 2 * value);
    return [...linear, ...angular];
  }));
}
function cofactorDeterminant(matrix) {
  if (matrix.length === 1) return matrix[0][0];
  return matrix[0].reduce((sum, value, column) => sum + (column % 2 ? -1 : 1) * value *
    cofactorDeterminant(matrix.slice(1).map(row => row.filter((_, index) => index !== column))), 0);
}
function validateSolution(row, target, tolerance = 2e-9) {
  const links = sourceFK(row.q), frame = target.frame || 'tool0';
  assert.ok(normDifference(links.link_5.position, target.wrist) < tolerance);
  assert.ok(normDifference(matrixOf(links[frame].orientation), target.rotation) < tolerance);
  const wristToEnd = rotate(links.flange.orientation, [ik.ABB_PARAMETERS.d6, 0, 0]);
  assert.ok(normDifference(links[frame].position, add(target.wrist, wristToEnd)) < tolerance);
}

test('downward ABB example has eight regular, distinct IKs and every SEW sign combination', () => {
  const { target, solutions } = ik.ABB_IK_EXAMPLE;
  assert.deepEqual(target.wrist, [1.2, 0, 1.5]);
  assert.deepEqual(target.rotation, [[1, 0, 0], [0, -1, 0], [0, 0, -1]]);
  assert.equal(solutions.length, 8);
  assert.deepEqual(solutions.map(row => row.signs), [
    [1, 1, 1], [1, 1, -1], [1, -1, 1], [1, -1, -1],
    [-1, 1, 1], [-1, 1, -1], [-1, -1, 1], [-1, -1, -1]
  ]);
  for (let i = 0; i < solutions.length; i++) {
    const row = solutions[i];
    validateSolution(row, target);
    assert.equal(row.singular, false);
    const { F, G, wrist } = abb.abbFactors(row.q);
    assert.deepEqual(row.signs, [Math.sign(G), Math.sign(F), Math.sign(wrist)]);
    assert.ok(Math.abs(row.determinant) > .17);
    for (let j = 0; j < i; j++) assert.ok(angleDistance(row.q, solutions[j].q) > .1);
  }
  assert.equal(solutions.filter(row => row.withinLimits).length, 4,
    'joint-limited configurations must be distinguished from the eight mathematical branches');
});

test('ABB SEW product matches the independent full Jacobian at all eight IKs', () => {
  for (const row of ik.ABB_IK_EXAMPLE.solutions) {
    const determinant = cofactorDeterminant(independentJacobian(row.q));
    assert.ok(Math.abs(determinant - row.determinant) < 2e-8);
    assert.equal(Math.sign(determinant), -row.signs.reduce((product, sign) => product * sign, 1));
  }
});

test('arbitrary tool0 and flange targets recover the generating configuration and validate every branch', () => {
  for (let sample = 0; sample < 30; sample++) {
    const q = Array.from({ length: 6 }, (_, joint) => 2.7 * Math.sin((sample + 1) * (joint + 2) * .731));
    for (const frame of ['tool0', 'flange']) {
      const links = sourceFK(q), target = { wrist: links.link_5.position,
        rotation: matrixOf(links[frame].orientation), frame };
      const rows = ik.solveAbbIk(target);
      assert.ok(rows.length > 0 && rows.length <= 8);
      assert.ok(rows.some(row => angleDistance(row.q, q) < 2e-8), `missing source configuration ${sample} (${frame})`);
      rows.forEach(row => validateSolution(row, target));
      const helper = ik.abbIkTargetFromQ(q, { frame });
      assert.ok(normDifference(helper.wrist, target.wrist) < 2e-12);
      assert.ok(normDifference(helper.rotation, target.rotation) < 2e-12);
    }
  }
});

test('ABB reachability gives zero, four, or eight regular IKs according to available shoulders', () => {
  const rotation = ik.ABB_DOWNWARD_TOOL_ROTATION;
  assert.equal(ik.solveAbbIk({ wrist: [3, 0, 1.5], rotation }).length, 0);
  const four = ik.solveAbbIk({ wrist: [2.35, 0, ik.ABB_PARAMETERS.d1], rotation });
  assert.equal(four.length, 4);
  assert.ok(four.every(row => row.shoulder === 1));
  four.forEach(row => validateSolution(row, { wrist: [2.35, 0, ik.ABB_PARAMETERS.d1], rotation }));
  assert.equal(ik.solveAbbIk(ik.ABB_IK_EXAMPLE.target).length, 8);
});

test('X-Y-X singular wrists return a correct family representative instead of two fictitious regular branches', () => {
  const arm = [.3, -.4, .6];
  for (const q5 of [0, Math.PI]) {
    const q = [...arm, .8, q5, -1.3], target = ik.abbIkTargetFromQ(q);
    const wrists = ik.solveAbbWrist(arm, target.rotation);
    assert.equal(wrists.length, 1);
    assert.equal(wrists[0].wrist, 0);
    assert.equal(wrists[0].singular, true);
    validateSolution({ q: [...arm, ...wrists[0].q] }, target);
  }
});
