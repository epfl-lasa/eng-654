'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let math, joints;
before(async () => {
  const source = fs.readFileSync(path.join(__dirname, '../js/viz/iiwa7Kinematics.js'), 'utf8');
  math = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const urdf = fs.readFileSync(path.join(__dirname, '../assets/models/iiwa7/iiwa7.urdf'), 'utf8');
  const values = (body, element, attribute) => new RegExp(`<${element}\\b[^>]*\\b${attribute}="([^"]+)"`).exec(body)?.[1].trim().split(/\s+/).map(Number);
  joints = Array.from({ length: 8 }, (_, i) => {
    const name = i === 7 ? 'iiwa_joint_ee' : `iiwa_joint_${i + 1}`;
    const body = new RegExp(`<joint\\s+name="${name}"\\s+type="[^"]+">([\\s\\S]*?)</joint>`).exec(urdf)[1];
    return { xyz: values(body, 'origin', 'xyz'), rpy: values(body, 'origin', 'rpy'),
      lower: values(body, 'limit', 'lower')?.[0], upper: values(body, 'limit', 'upper')?.[0], speed: values(body, 'limit', 'velocity')?.[0] };
  });
});

// Independent homogeneous-transform evaluator: parse the native URDF and use
// general Rz(yaw) Ry(pitch) Rx(roll), rather than the production geometry.
const multiply = (a, b) => a.map(row => b[0].map((_, j) => row.reduce((sum, value, k) => sum + value * b[k][j], 0)));
const eye = () => [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
function urdfFK(q) {
  let T = eye();
  for (let i = 0; i < joints.length; i++) {
    const { xyz, rpy: [r, p, y] } = joints[i];
    const cr = Math.cos(r), sr = Math.sin(r), cp = Math.cos(p), sp = Math.sin(p), cy = Math.cos(y), sy = Math.sin(y);
    const F = [[cy * cp, cy * sp * sr - sy * cr, cy * sp * cr + sy * sr, xyz[0]],
      [sy * cp, sy * sp * sr + cy * cr, sy * sp * cr - cy * sr, xyz[1]], [-sp, cp * sr, cp * cr, xyz[2]], [0, 0, 0, 1]];
    const a = q[i] ?? 0, c = Math.cos(a), s = Math.sin(a);
    T = multiply(multiply(T, F), [[c, -s, 0, 0], [s, c, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]);
  }
  return { p: T.slice(0, 3).map(row => row[3]), R: T.slice(0, 3).map(row => row.slice(0, 3)) };
}
let seed = 982451653;
const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
const jointDistance = (a, b) => Math.hypot(...a.map((v, i) => math.wrapAngle(v - b[i])));

test('exact FK and joint limits match independently parsed native URDF including the tool', () => {
  joints.slice(0, 7).forEach((joint, i) => {
    assert.equal(math.IIWA_LIMITS[i], joint.upper);
    assert.equal(-math.IIWA_LIMITS[i], joint.lower);
    assert.equal(math.IIWA_SPEED_LIMITS[i], joint.speed);
  });
  for (let k = 0; k < 160; k++) {
    const q = math.IIWA_LIMITS.map(limit => (2 * random() - 1) * limit);
    const actual = math.fk(q), expected = urdfFK(q);
    assert.ok(math.poseDistance(actual, expected).error < 2e-15);
    assert.equal(actual.origins.length, 7);
    assert.equal(actual.axes.length, 7);
    assert.equal(actual.transforms.length, 7);
  }
  assert.ok(Math.abs(math.fk(Array(7).fill(0)).p[2] - 1.266) < 1e-14);
});

test('world geometric Jacobian matches independent FK finite differences for all seven joints', () => {
  const h = 2e-6;
  for (let k = 0; k < 24; k++) {
    const q = math.IIWA_LIMITS.map(limit => (2 * random() - 1) * limit * .9);
    const J = math.jacobian(q), pose = urdfFK(q);
    assert.equal(J.length, 6);
    assert.ok(J.every(row => row.length === 7));
    for (let j = 0; j < 7; j++) {
      const a = q.slice(), b = q.slice(); a[j] -= h; b[j] += h;
      const fa = urdfFK(a), fb = urdfFK(b);
      const pdot = fb.p.map((v, i) => (v - fa.p[i]) / (2 * h));
      const Rdot = fb.R.map((row, i) => row.map((v, l) => (v - fa.R[i][l]) / (2 * h)));
      const omega = multiply(Rdot, pose.R[0].map((_, i) => pose.R.map(row => row[i])));
      const velocity = [...pdot, (omega[2][1] - omega[1][2]) / 2, (omega[0][2] - omega[2][0]) / 2, (omega[1][0] - omega[0][1]) / 2];
      velocity.forEach((v, i) => assert.ok(Math.abs(v - J[i][j]) < 2e-9, `Jacobian row ${i}, column ${j}`));
    }
  }
});

test('analytical fixed-q3 solver enumerates eight distinct roots and verifies every one against URDF', () => {
  const source = [.4, .7, -.5, 1.2, .3, .8, -.6], target = urdfFK(source);
  const roots = math.inverseFixedQ3(target, source[2]);
  assert.equal(roots.length, 8);
  assert.deepEqual(roots.map(root => root.branchIndex), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(new Set(roots.map(root => root.branch)).size, 8);
  assert.ok(roots.every(root => !root.chartSingular && root.freeParameters.length === 0 && root.valid));
  for (const root of roots) {
    assert.ok(math.poseDistance(urdfFK(root.q), target).error < 5e-13);
    assert.ok(Math.abs(root.q[2] - source[2]) < 1e-14);
    assert.equal(root.valid, root.limitMargin >= -1e-9);
    assert.ok(roots.filter(other => jointDistance(root.q, other.q) < 1e-8).length === 1);
  }
});

test('analytical IK recovers each of 300 deterministic native-range postures without numerical seeding', () => {
  for (let k = 0; k < 300; k++) {
    const q = math.IIWA_LIMITS.map(limit => (2 * random() - 1) * limit * .97);
    const target = urdfFK(q), roots = math.solveIK(target.p, target.R, q[2]);
    assert.ok(roots.length > 0 && roots.length <= 8);
    assert.ok(roots.some(root => root.valid && jointDistance(q, root.q) < 2e-7), `source posture ${k} was not recovered`);
    for (const root of roots) assert.ok(math.poseDistance(urdfFK(root.q), target).error < 2e-7);
  }
});

test('mathematical roots outside native limits remain visible and are labelled invalid', () => {
  const q = [.4, .7, -.5, 2.5, .3, .8, -.6], roots = math.inverseFixedQ3(urdfFK(q), q[2]);
  assert.equal(roots.length, 8);
  assert.ok(roots.every(root => !root.valid && root.limitMargin < 0));
  assert.ok(roots.some(root => jointDistance(root.q, q) < 1e-9));
});

test('unreachable targets and empty q3 slices return no invented roots', () => {
  assert.deepEqual(math.inverseFixedQ3({ p: [5, 0, 1], R: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] }, 0), []);
  const q = [.2, .7, 0, 1.4, .5, .7, .9], pose = urdfFK(q);
  assert.ok(math.inverseFixedQ3(pose, 0).length > 0);
  assert.deepEqual(math.inverseFixedQ3(pose, Math.PI / 2), []);
  assert.deepEqual(math.inverseFixedQ3(pose, NaN), []);
});

test('wrist and axis poles expose a family or merger instead of claiming eight isolated roots', () => {
  for (const q of [[.4, .7, -.5, 1.2, .3, 0, -.6], Array(7).fill(0)]) {
    const pose = urdfFK(q), roots = math.inverseFixedQ3(pose, q[2]);
    assert.ok(roots.length > 0 && roots.length < 8);
    assert.ok(roots.some(root => root.chartSingular && root.freeParameters.length > 0));
    assert.ok(roots.some(root => root.mergedBranchIndices.length > 1));
    roots.forEach(root => assert.ok(math.poseDistance(urdfFK(root.q), pose).error < 2e-7));
  }
});
