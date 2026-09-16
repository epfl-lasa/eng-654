'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const data = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
let K, P, map, seed, numerical, analytical;
before(async () => {
  const directory = path.join(__dirname, '../js/viz');
  const source = name => fs.readFileSync(path.join(directory, name), 'utf8');
  const url = data(source('iiwa7Kinematics.js'));
  K = await import(url);
  P = await import(data(source('iiwa7Planning.js').replace('./iiwa7Kinematics.js', url)));
  map = await P.buildRedundancyMap();
  seed = map.cells[0][map.defaultStart.row][map.defaultStart.branch].q;
  numerical = await P.planNumerical(map.spec, seed);
  analytical = await P.planAnalytical(map);
});

test('the supplied 22 × 28 cm rectangle has constant orientation and exact corners', () => {
  const samples = P.rectangleSamples(P.DEFAULT_RECTANGLE, 81);
  assert.equal(samples.length, 81);
  assert.deepEqual(samples.map(s => s.p[2]), Array(81).fill(.6));
  assert.ok(samples.every(s => s.R === P.DEFAULT_RECTANGLE.R || JSON.stringify(s.R) === JSON.stringify(P.DEFAULT_RECTANGLE.R)));
  assert.deepEqual(samples[0].p, samples.at(-1).p);
  for (const k of [0, 20, 40, 60, 80]) assert.equal(samples[k].s, k / 80);
  assert.ok(Math.abs(Math.max(...samples.map(s => s.p[0])) - Math.min(...samples.map(s => s.p[0])) - .22) < 1e-12);
  assert.ok(Math.abs(Math.max(...samples.map(s => s.p[1])) - Math.min(...samples.map(s => s.p[1])) - .28) < 1e-12);
});

test('every map dot is based on an analytical IK solve, with eight generic starting roots', () => {
  assert.equal(map.stats.evaluations, 81 * 69 * 8);
  assert.deepEqual(map.defaultStart, { row: 28, branch: 4 });
  assert.ok(Math.abs(map.angles[28] + Math.PI / 6) < 1e-12);
  const starts = map.cells[0][28];
  assert.equal(starts.filter(Boolean).length, 8);
  assert.equal(starts.filter(root => root.valid).length, 2);
  let good = 0, bad = 0;
  for (let k = 0; k < map.samples.length; k += 5) {
    for (let row = 0; row < map.angles.length; row += 3) {
      const actual = K.inverseFixedQ3(map.samples[k], map.angles[row]);
      for (let branch = 0; branch < 8; branch++) {
        const root = map.cells[k][row][branch];
        const expected = actual.find(candidate => candidate.branchIndex === branch || candidate.mergedBranchIndices?.includes(branch));
        assert.equal(Boolean(root), Boolean(expected));
        if (!root) continue;
        assert.ok(P.jointDistance(root.q, expected.q) < 1e-12);
        assert.ok(K.poseDistance(K.fk(root.q), map.samples[k]).error < 1e-8);
        assert.equal(root.valid, K.limitMargin(root.q) >= -1e-10 && root.sigmaMin > P.MIN_SINGULAR_VALUE);
        root.valid ? good++ : bad++;
      }
    }
  }
  assert.ok(good > 500 && bad > 500);
});

test('the projected secondary motion lies in the full Jacobian null space and decreases its cost', () => {
  const task = [.03, -.02, .015, .04, -.03, .02];
  for (const option of P.NULL_SPACE_COSTS) {
    const velocity = P.projectedVelocity(seed, task, option.id, .8, seed.map(x => x + .1));
    const J = K.jacobian(seed);
    for (let row = 0; row < 6; row++) {
      assert.ok(Math.abs(J[row].reduce((sum, v, j) => sum + v * velocity.qdot[j], 0) - task[row]) < 2e-11);
      assert.ok(Math.abs(J[row].reduce((sum, v, j) => sum + v * velocity.nullVelocity[j], 0)) < 2e-11);
    }
    const gradient = P.costGradient(seed, option.id, seed.map(x => x + .1));
    assert.ok(gradient.reduce((sum, v, j) => sum + v * velocity.nullVelocity[j], 0) <= 1e-10);
  }
});

test('fixed-q3 chart collapse is distinguished from loss of full robot Jacobian rank', () => {
  const q4 = 1.3, q3 = .8;
  const A = .4 + .4 * Math.cos(q4), B = -.4 * Math.sin(q4) * Math.cos(q3);
  const q = [.3, -Math.atan2(B, A), q3, q4, .2, 1.1, .2];
  const roots = K.inverseFixedQ3(K.fk(q), q3);
  assert.equal(roots.length, 4);
  assert.ok(roots.every(root => root.chartSingular && root.mergedBranchIndices.length === 2));
  const quality = P.configurationMetrics(q);
  assert.equal(quality.valid, true);
  assert.ok(quality.sigmaMin > .14);
  assert.ok(P.configurationMetrics(Array(7).fill(0)).sigmaMin < 1e-8);
});

test('the default numerical path completes with a substantial native joint margin and full rank', () => {
  assert.equal(numerical.complete, true);
  assert.equal(numerical.samples.length, 1201);
  assert.equal(numerical.samples.at(-1).s, 1);
  assert.ok(numerical.minLimitMargin > .3495, `${numerical.minLimitMargin} rad`);
  assert.ok(numerical.minSigma > .14);
  assert.ok(numerical.maxPoseError < 2.1e-10);
  assert.ok(numerical.maxStep < .005);
  // Independent midpoint FK/rank/limit checks between every pair of recorded
  // animation states. These are dense samples, not an interval certificate.
  for (let i = 1; i < numerical.samples.length; i++) {
    const a = numerical.samples[i - 1], b = numerical.samples[i];
    const q = a.q.map((v, j) => (v + b.q[j]) / 2);
    assert.ok(K.limitMargin(q) > .3494);
    assert.ok(P.configurationMetrics(q).sigmaMin > .14);
    assert.ok(K.poseDistance(K.fk(q), P.rectanglePose((a.s + b.s) / 2, map.spec)).error < 2e-6);
    assert.equal(b.branchIndex, 4);
    assert.ok(b.mergedBranchIndices.includes(4));
  }
});

test('all available null-space strategies follow the same pose path but choose different redundant motions', async () => {
  const paths = [];
  for (const option of P.NULL_SPACE_COSTS) {
    const plan = option.id === 'centering' ? numerical : await P.planNumerical(map.spec, seed, { cost: option.id });
    assert.equal(plan.complete, true, option.id);
    assert.ok(plan.minLimitMargin > .3495);
    assert.ok(plan.minSigma > .14);
    assert.ok(plan.maxPoseError < 2.1e-10);
    paths.push(plan);
  }
  const q3 = paths.map(plan => plan.q.at(-1)[2]);
  assert.ok(Math.max(...q3) - Math.min(...q3) > .1);
  assert.ok(P.nullSpaceCost(paths[2].q.at(-1), 'limits') < P.nullSpaceCost(paths[0].q.at(-1), 'limits'));
});

test('another legal start hits a real joint stop; physically different 2π angles are never wrapped into validity', async () => {
  const other = map.cells[0][28][3];
  assert.equal(other.valid, true);
  const failed = await P.planNumerical(map.spec, other.q);
  assert.equal(failed.complete, false);
  assert.equal(failed.reason, 'joint-limit');
  assert.ok(failed.failProgress > .07 && failed.failProgress < .08);
  assert.ok(failed.failure.limitMargin < 0);
  assert.ok(failed.failure.sigmaMin > .1, 'a physical joint stop must not be called a robot singularity');
  const rotated = seed.slice(); rotated[0] += 2 * Math.PI;
  assert.ok(K.poseDistance(K.fk(rotated), K.fk(seed)).error < 1e-12);
  assert.equal((await P.planNumerical(map.spec, rotated)).reason, 'joint-limit');
});

test('global analytical planning validates a complete closed joint path through real IK connections', () => {
  assert.equal(analytical.complete, true);
  assert.equal(analytical.corridor.length, map.samples.length);
  assert.equal(analytical.samples.length, 641);
  assert.ok(analytical.minLimitMargin > .3495);
  assert.ok(analytical.minSigma > .14);
  assert.ok(analytical.maxPoseError < 1e-12);
  assert.ok(analytical.closure < 1e-12);
  assert.ok(analytical.checkedEdges > 100);
  for (const node of analytical.corridor) assert.equal(map.cells[node.k][node.row][node.branch].valid, true);
});

test('the joint-limit barrier and global graph rescue the legal start that centering could not follow', async () => {
  const start = map.cells[0][28][3];
  const local = await P.planNumerical(map.spec, start.q, { cost: 'limits' });
  const global = await P.planAnalytical(map, { row: 28, branch: 3, cost: 'limits' });
  assert.equal(local.complete, true);
  assert.equal(global.complete, true);
  assert.ok(local.minSigma > .09);
  assert.ok(global.minSigma > .13);
  // The initial q1 is only 0.338° from its native stop, so no route can have a
  // larger whole-path margin unless the starting configuration also changes.
  assert.ok(Math.abs(global.minLimitMargin - start.limitMargin) < 1e-12);
  assert.ok(global.q.at(-1)[2] - start.q[2] < -1.5);
  assert.ok(P.jointDistance(local.q.at(-1), global.q.at(-1)) > .1);
  for (let k = 1; k < global.corridor.length; k++) {
    const a = global.corridor[k - 1], b = global.corridor[k];
    const dense = P.validateAnalyticalConnection(map.spec,
      { ...map.cells[a.k][a.row][a.branch], s: map.samples[a.k].s },
      { ...map.cells[b.k][b.row][b.branch], s: map.samples[b.k].s }, 32);
    assert.ok(dense, `dense analytical connection ${k}`);
    assert.ok(dense.every(sample => sample.limitMargin > .5 * Math.PI / 180));
  }
});

test('edited unreachable rectangles are actually recomputed and produce no fabricated corridor', async () => {
  const impossible = await P.buildRedundancyMap({ ...map.spec, center: [2, 0, .6] }, { nProgress: 9, nAngles: 9 });
  assert.equal(impossible.stats.valid, 0);
  assert.equal(impossible.stats.roots, 0);
  assert.equal(impossible.defaultStart, null);
  assert.equal((await P.planAnalytical(impossible)).reason, 'invalid-start');
});
