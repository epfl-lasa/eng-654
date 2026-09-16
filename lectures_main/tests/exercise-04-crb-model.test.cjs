'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let model, robot;
const source = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
const moduleURL = text => `data:text/javascript;base64,${Buffer.from(text).toString('base64')}`;
before(async () => {
  const coefficients = moduleURL(source('js/viz/abbCrbCoefficients.js'));
  const kinematics = moduleURL(source('js/viz/abbCrbKinematics.js').replace('./abbCrbCoefficients.js', coefficients));
  robot = await import(kinematics);
  model = await import(moduleURL(source('js/exercises/exercise-04-crb-model.js').replace('../viz/abbCrbKinematics.js', kinematics)));
});

test('the prescribed XY rectangle closes, keeps orientation fixed, and samples every corner', () => {
  const spec = model.CRB_PATH;
  const start = model.poseAt(0), end = model.poseAt(1);
  assert.ok(robot.poseError(start, end).position < 1e-14);
  for (const [index, vertex] of [[0, 0], [108, 1], [204, 2], [312, 3], [408, 4]]) {
    const pose = model.poseAt(index / 408, .37);
    assert.ok(Math.hypot(...pose.slice(0, 2).map((row, k) => row[3] - spec.verticesXY[vertex][k])) < 1e-14);
    assert.equal(pose[2][3], .37);
    assert.deepEqual(pose.slice(0, 3).map(row => row.slice(0, 3)), spec.rotation);
  }
  assert.throws(() => model.poseAt(1.01), /progress/);
  assert.throws(() => model.enumerateStart(NaN), /Height/);
});

test('default and three other heights have the required numbers of real, continuous, legal paths', { timeout: 60000 }, async () => {
  for (const [height, expectedLegal, expectedComplete] of [[.2, 6, 3], [.35, 6, 6], [.4, 7, 7], [.45, 8, 8]]) {
    const progress = [];
    const result = await model.analyzeHeight(height, p => progress.push(p));
    assert.equal(result.resolved, true, `unresolved IK at z=${height}`);
    assert.equal(result.sampleCount, 409);
    assert.equal(result.layers.length, 409);
    assert.equal(result.legalStartCount, expectedLegal);
    assert.equal(result.completeCount, expectedComplete);
    assert.deepEqual(result.rootCountRange, [8, 8]);
    assert.equal(progress.at(-1).percent, 100);
    assert.ok(progress.every((p, i) => !i || p.percent >= progress[i - 1].percent));
    for (const layer of result.layers) {
      assert.equal(layer.solutions.length, 8);
      for (const root of layer.solutions) {
        assert.ok(root.positionError < 2e-7);
        assert.ok(root.rotationError < 2e-7);
      }
    }
    for (const track of result.tracks) {
      if (!track.start.withinLimits) { assert.equal(track.complete, false); assert.equal(track.q.length, 1); continue; }
      for (let i = 0; i < track.q.length; i++) {
        const q = track.q[i];
        assert.equal(robot.withinLimits(q), true);
        const error = robot.poseError(robot.fk(q).matrix, result.poses[i]);
        assert.ok(error.position < 2e-8 && error.rotation < 2e-8);
        assert.ok(result.layers[i].solutions.some(root => Math.hypot(...q.map((v, k) => robot.wrap(v - root.q[k]))) < 2e-6));
        if (i) assert.ok(Math.max(...q.map((v, k) => Math.abs(v - track.q[i - 1][k]))) < .01, 'no 2π branch jump');
      }
      if (track.complete) {
        assert.equal(track.q.length, 409);
        assert.ok(track.minDet > .019);
        assert.ok(track.minLimitMargin > .016);
      } else {
        assert.equal(height, .2);
        assert.equal(track.stop.kind, 'joint-limit');
        assert.equal(track.stop.joint, 1, 'the real native q2 stop limits this path');
        assert.ok(Math.abs(track.stop.boundaryQ[1] - track.stop.limit) < 1e-9);
        assert.ok(Math.abs(robot.determinant(track.stop.boundaryQ)) > .019);
      }
    }
  }
});

test('an aborted height analysis does not start a long enumeration', async () => {
  const signal = { aborted: true };
  await assert.rejects(model.analyzeHeight(.2, () => {}, { signal }), { name: 'AbortError' });
});
