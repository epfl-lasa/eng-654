'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const url = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const DEG = Math.PI / 180;
let K, buildSelfMotionSweep, sweep;
const pose = { p: [.45, 0, .6], R: [[-1, 0, 0], [0, 1, 0], [0, 0, -1]] };
before(async () => {
  const source = name => fs.readFileSync(path.join(__dirname, '../js/viz', name), 'utf8');
  const kinematics = url(source('iiwa7Kinematics.js'));
  K = await import(kinematics);
  ({ buildSelfMotionSweep } = await import(url(source('iiwa7SelfMotion.js').replace('./iiwa7Kinematics.js', kinematics))));
  sweep = buildSelfMotionSweep(pose);
});

test('all eight exact fixed-centre IK curves connect across the entire requested q3 range', () => {
  assert.equal(sweep.sampleCount, 681);
  assert.equal(sweep.fullSweep, true);
  assert.ok(Math.abs(sweep.angles[0] / DEG + 170) < 1e-12);
  assert.ok(Math.abs(sweep.angles.at(-1) / DEG - 170) < 1e-12);
  for (const branch of sweep.branches) for (let i = 0; i < branch.length; i++) {
    const sample = branch[i];
    assert.ok(sample);
    assert.equal(sample.connectedToPrevious, i > 0);
    assert.ok(K.poseDistance(K.fk(sample.q), pose).error < 1e-12);
    assert.ok(Math.abs(sample.q[2] - sweep.angles[i]) < 1e-12);
    if (i) assert.ok(Math.hypot(...sample.q.map((v, j) => v - branch[i - 1].q[j])) < .095);
  }
});

test('angle seams are unwrapped and physical limits use the continuous joint coordinates', () => {
  const wrist = sweep.branches[1];
  assert.ok(Math.min(...wrist.map(sample => sample.q[4])) < -350 * DEG);
  const shoulder = sweep.branches[2];
  assert.ok(Math.min(...shoulder.map(sample => sample.q[0])) < -240 * DEG);
  let formerlyMisclassified = 0;
  for (const branch of sweep.branches) {
    assert.ok(branch.some(sample => !sample.valid));
    for (const sample of branch) {
      assert.ok(Math.abs(sample.limitMargin - K.limitMargin(sample.q)) < 1e-12);
      assert.equal(sample.valid, K.limitMargin(sample.q) >= -1e-9);
      if (!sample.valid && K.limitMargin(sample.q.map(K.wrapAngle)) >= 0) formerlyMisclassified++;
    }
  }
  assert.ok(formerlyMisclassified > 100);
});

test('unreachable intervals at the old rectangle-start pose remain actual gaps', () => {
  const old = buildSelfMotionSweep({ ...pose, p: [.34, -.14, .6] });
  assert.equal(old.fullSweep, false);
  for (const samples of old.branches) {
    assert.equal(samples[160], null); // q3 = -90 degrees: no fixed-q3 solution.
    assert.equal(samples[520], null); // q3 = +90 degrees.
    let checked = false;
    for (let row = 1; row < samples.length; row++) if (samples[row] && !samples[row - 1]) {
      assert.equal(samples[row].connectedToPrevious, false);
      checked = true;
    }
    assert.equal(checked, true);
  }
});
