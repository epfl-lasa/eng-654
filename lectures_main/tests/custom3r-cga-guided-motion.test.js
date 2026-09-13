'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the actual pure controller without loading the browser/Three.js UI.
const source = fs.readFileSync(path.join(__dirname, '../js/viz/custom3rIk.js'), 'utf8');
const controllerSource = source.match(/export function createCgaGuidedMotion\([\s\S]*?\n\}/)[0];
const createMotion = vm.runInNewContext('(' + controllerSource.replace(/^export /, '') + ')');
const radians = degrees => degrees * Math.PI / 180;
const branches = [
  [8.560853671659, -46.888070562430, -97.515419825156],
  [-169.572383340993, -132.273182994342, -39.698098590009]
].map(q => q.map(radians));
const angles = state => Array.from(state.q);

for (const [index, branch] of branches.entries()) {
  test(`branch ${index + 1}: guide joints 2, 3, 1 with automatic return motions`, () => {
    const motion = createMotion(branches);
    const { state } = motion;
    assert.equal(state.phase, 'target');
    assert.equal(motion.moveJoint(0, branch[0]), null, 'joint 1 is locked initially');
    assert.equal(motion.moveJoint(2, branch[2]), null, 'joint 3 is locked initially');

    const secondSnap = motion.moveJoint(1, branch[1] + radians(2));
    assert.equal(secondSnap.branchIndex, index);
    assert.equal(state.phase, 'reversing');
    assert.equal(state.q[1], branch[1], 'preserve the unrounded snapped angle');
    assert.equal(motion.moveJoint(1, branch[1]), null, 'no repeated snap during playback');
    motion.advance(1.999);
    assert.equal(state.q[1], branch[1], 'hold the exact θ₂ snap just before two seconds');
    motion.advance(.001);
    assert.equal(state.q[1], branch[1], 'hold the exact θ₂ snap for the full two seconds');
    assert.equal(state.phase, 'reversing');
    motion.advance(.001);
    assert.ok(Math.abs(state.q[1]) < Math.abs(branch[1]) && Math.abs(state.q[1]) > 0);
    assert.equal(state.phase, 'reversing', 'start reversing just after two seconds');
    motion.advance(2);
    assert.equal(state.phase, 'theta3');
    assert.deepEqual(angles(state), [0, 0, 0]);

    assert.equal(motion.moveJoint(1, radians(30)), null, 'joint 2 stays locked at home');
    assert.equal(motion.moveJoint(2, branch[2] - radians(2)).joint, 2);
    assert.equal(state.phase, 'restoring');
    assert.equal(state.q[2], branch[2]);
    motion.advance(1.999);
    assert.deepEqual(angles(state), [0, 0, branch[2]], 'hold the θ₃ snap just before two seconds');
    motion.advance(.001);
    assert.deepEqual(angles(state), [0, 0, branch[2]], 'hold the θ₃ snap for the full two seconds');
    assert.equal(state.phase, 'restoring');
    motion.advance(.001);
    assert.ok(Math.abs(state.q[1]) > 0 && Math.abs(state.q[1]) < Math.abs(branch[1]));
    assert.equal(state.q[2], branch[2], 'keep θ₃ snapped as restoration starts');
    assert.equal(state.phase, 'restoring', 'start restoring just after two seconds');
    motion.advance(2);
    assert.equal(state.phase, 'theta1');
    assert.deepEqual(angles(state), [0, branch[1], branch[2]]);

    assert.equal(motion.moveJoint(0, branch[0] + radians(2)).joint, 0);
    assert.equal(state.phase, 'complete');
    assert.deepEqual(angles(state), branch);
    assert.equal(motion.moveJoint(0, branch[0]), null, 'only one completion event');
  });
}

test('outside the snap tolerance, the active joint follows the user', () => {
  const motion = createMotion([branches[0]]);
  const value = branches[0][1] + radians(4.1);
  assert.equal(motion.moveJoint(1, value), null);
  assert.equal(motion.state.phase, 'theta2');
  assert.ok(Math.abs(motion.state.q[1] - value) < 1e-14);
  assert.equal(motion.moveJoint(1, branches[0][1] + radians(3.9)).joint, 1);
});

test('changing the target during either automatic motion discards the old branch', () => {
  for (const phase of ['reversing', 'restoring']) {
    const motion = createMotion(branches);
    motion.moveJoint(1, branches[0][1]);
    if (phase === 'restoring') {
      motion.advance(4);
      motion.moveJoint(2, branches[0][2]);
    }
    assert.equal(motion.state.phase, phase);
    motion.reset([branches[1]]);
    motion.advance(10);
    assert.equal(motion.state.phase, 'target');
    assert.equal(motion.state.branchIndex, null);
    assert.deepEqual(angles(motion.state), [0, 0, 0]);
    assert.equal(motion.moveJoint(1, branches[1][1]).branchIndex, 0);
  }
});

test('an unreachable target locks joints and a new reachable target restores the workflow', () => {
  const motion = createMotion([]);
  assert.equal(motion.state.phase, 'unreachable');
  for (let joint = 0; joint < 3; joint++) assert.equal(motion.moveJoint(joint, 1), null);
  motion.reset(branches);
  assert.equal(motion.state.phase, 'target');
  assert.equal(motion.moveJoint(1, NaN), null);
  assert.deepEqual(angles(motion.state), [0, 0, 0]);
});

test('snapping respects equivalent angles across the minus/plus pi boundary', () => {
  const branch = [radians(179), radians(-179), radians(179)];
  const motion = createMotion([branch]);
  assert.equal(motion.moveJoint(1, radians(179)).joint, 1);
  motion.advance(4);
  assert.equal(motion.moveJoint(2, radians(-179)).joint, 2);
  motion.advance(4);
  assert.equal(motion.moveJoint(0, radians(-179)).joint, 0);
  assert.deepEqual(angles(motion.state), branch);
});
