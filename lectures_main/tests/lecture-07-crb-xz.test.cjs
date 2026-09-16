'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const file = p => path.join(__dirname, '..', p);
const asModule = s => `data:text/javascript;base64,${Buffer.from(s).toString('base64')}`;
const atlas = JSON.parse(fs.readFileSync(file('assets/data/lecture07/crb-slice-xz.json')));
let robot, rateBound;
before(async () => {
  const coefficients = asModule(fs.readFileSync(file('js/viz/abbCrbCoefficients.js'), 'utf8'));
  robot = await import(asModule(fs.readFileSync(file('js/viz/abbCrbKinematics.js'), 'utf8').replace('./abbCrbCoefficients.js', coefficients)));
  ({ determinantRateBound: rateBound } = await import(asModule(fs.readFileSync(file('js/viz/abbCrbDeterminant.js'), 'utf8'))));
});
const pointAt = i => [atlas.xmin + i % atlas.nx * (atlas.xmax - atlas.xmin) / (atlas.nx - 1), atlas.zmin + Math.floor(i / atlas.nx) * (atlas.zmax - atlas.zmin) / (atlas.nz - 1)];
const target = p => robot.makePose([p[0], atlas.y, p[1]], atlas.orientation);

test('the fixed-y XZ backup contains 100,000 solved poses and multiple unrestricted IK counts', () => {
  assert.equal(atlas.plane, 'xz');
  assert.equal(atlas.fixedAxis, 'y');
  assert.equal(atlas.y, .2);
  assert.equal(atlas.nx * atlas.nz, 100000);
  assert.equal(atlas.sampleCount, 100000);
  assert.equal(atlas.rowOrder, 'z-increasing');
  assert.equal(atlas.generation.unresolvedPoses, 0);
  assert.equal(atlas.counts.length, 100000);
  assert.equal(atlas.limitCounts.length, 100000);
  assert.deepEqual([...new Set(atlas.counts)].sort((a, b) => a - b), [0, 2, 4, 6, 8, 10]);
  for (let i = 0; i < atlas.counts.length; i++) {
    assert.ok(atlas.counts[i] >= 0 && atlas.counts[i] <= 16);
    assert.ok(atlas.limitCounts[i] >= 0 && atlas.limitCounts[i] <= atlas.counts[i]);
  }
  const [yaw, pitch, roll] = atlas.orientationEulerZYX;
  const [sx, cx, sy, cy, sz, cz] = [Math.sin(roll), Math.cos(roll), Math.sin(pitch), Math.cos(pitch), Math.sin(yaw), Math.cos(yaw)];
  assert.deepEqual(atlas.orientation, [[cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx], [sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx], [-sy, cy * sx, cy * cx]]);
  for (const i of atlas.generation.independentBrowserChecks.indexes) {
    const r = robot.inverse(target(pointAt(i)));
    assert.equal(r.diagnostics.resolved, true, `unresolved browser query ${i}`);
    assert.equal(r.solutions.length, atlas.counts[i], `all-real count ${i}`);
    assert.equal(r.solutions.filter(s => s.withinLimits).length, atlas.limitCounts[i], `legal count ${i}`);
    for (const s of r.solutions) {
      const error = robot.poseError(robot.fk(s.q).matrix, target(pointAt(i)));
      assert.ok(error.position < 2e-8 && error.rotation < 2e-8, `native FK ${i}`);
    }
  }
});

test('the 0.8 m XZ loop keeps y and orientation fixed: eight legal starts, six limit failures, two closed nonsingular branches', () => {
  const vertices = atlas.demonstrationPath.vertices, poses = [];
  assert.deepEqual(vertices[0], atlas.demonstrationPoint);
  assert.deepEqual(vertices.at(-1), vertices[0]);
  assert.equal(atlas.demonstrationPath.radius * 2, .8);
  for (let k = 1; k < vertices.length; k++) {
    const a = vertices[k - 1], b = vertices[k], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / .003));
    for (let j = 0; j < n; j++) poses.push(target(a.map((v, l) => v + (b[l] - v) * j / n)));
  }
  poses.push(target(vertices.at(-1)));
  assert.equal(poses.length, 961);
  const solutions = robot.inverse(poses[0]).solutions;
  assert.equal(solutions.length, 8);
  assert.ok(solutions.every(s => s.withinLimits));
  const tracks = solutions.map(s => robot.followPath(poses, s.q));
  assert.equal(tracks.filter(t => t.success).length, 2);
  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i], stored = atlas.demonstrationResults[i];
    assert.equal(t.success, stored.success);
    assert.equal(t.failIndex, stored.failIndex);
    assert.ok(t.q.every(q => robot.withinLimits(q)));
    assert.ok(t.maxPositionError < 2e-9 && t.maxRotationError < 2e-9);
    if (!t.success) { assert.match(t.reason, /joint limit/); continue; }
    assert.ok(i === 5 || i === 6);
    assert.ok(t.minDet > .014);
    assert.ok(t.minLimitMargin > .144);
    assert.ok(Math.hypot(...t.q.at(-1).map((v, k) => v - t.q[0][k])) < 1e-8);
    let lowerBound = Infinity;
    for (let k = 1; k < t.q.length; k++) {
      const a = t.q[k - 1], b = t.q[k];
      lowerBound = Math.min(lowerBound, Math.min(Math.abs(robot.determinant(a)), Math.abs(robot.determinant(b))) - rateBound(a, b) / 2 - 1e-11);
      const fk = robot.fk(b);
      assert.ok(Math.abs(fk.position[1] - .2) < 2e-9);
      assert.ok(robot.rotationError(fk.rotation, atlas.orientation) < 2e-9);
    }
    assert.ok(lowerBound > .01, 'positive determinant bound between every pair of animation samples');
    assert.ok(Math.abs(lowerBound - stored.wholeSegmentMinAbsDet) < 1e-12);
  }
});
