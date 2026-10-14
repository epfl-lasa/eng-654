// Compare every Rust branch with the existing independently formulated JS IK.
// Run after cargo build --release; this is a repository-only verification tool.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const binary = path.join(root, 'target', 'release', process.platform === 'win32' ? 'iiwa7-ik.exe' : 'iiwa7-ik');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'iiwa7-branches-'));
process.on('exit', () => fs.rmSync(temporary, { recursive: true, force: true }));
function call(command, request) {
  const input = path.join(temporary, 'request.json');
  fs.writeFileSync(input, JSON.stringify(request));
  const result = spawnSync(binary, [command, '--input', input], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000,
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
(async () => {
  const source = fs.readFileSync(path.resolve(root, '../../js/viz/iiwa7Kinematics.js'), 'utf8');
  const reference = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  let seed = 654;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  let branches = 0, maxJointError = 0;
  for (let i = 0; i < 1000; i++) {
    const q = Array.from({ length: 7 }, () => (2 * random() - 1) * Math.PI);
    const request = call('fk', { q });
    const rust = call('solve-pose', request).solutions;
    const target = reference.fk(q);
    const js = reference.inverseFixedQ3(target, q[2]);
    assert.equal(rust.length, 8);
    assert.equal(js.length, 8);
    const distance = (a, b) => Math.max(...a.map((v, j) => Math.abs(reference.wrapAngle(v - b[j]))));
    for (const s of js) {
      const nearest = Math.min(...rust.map(r => distance(s.q, r.q)));
      assert.ok(nearest < 2e-6, `missing JS branch for sample ${i}: ${nearest}`);
      maxJointError = Math.max(maxJointError, nearest);
      branches++;
    }
    for (const s of rust) assert.ok(js.some(r => distance(s.q, r.q) < 2e-6));
  }
  console.log(JSON.stringify({ passed: true, poses: 1000, matched_branches: branches,
    maximum_joint_difference_rad: maxJointError }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
