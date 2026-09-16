'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
let M, K, P;
before(async () => {
  const load = filename => import(pathToFileURL(path.join(__dirname, '..', filename)).href);
  [M, K, P] = await Promise.all([load('js/exercises/exercise-04-iiwa-model.js'),
    load('js/viz/iiwa7Kinematics.js'), load('js/viz/iiwa7Planning.js')]);
});

test('the hot matrix product preserves the previous floating-point operation order', () => {
  const reference = (a, b) => a.map(row => b[0].map((_, j) =>
    row.reduce((sum, value, k) => sum + value * b[k][j], 0)));
  let seed = 18371;
  const value = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return (seed / 2 ** 32 - .5) * 10 ** (seed % 9 - 4);
  };
  for (const [rows, inner, columns] of [[3, 3, 3], [4, 4, 4], [2, 7, 6], [1, 3, 1]]) {
    for (let sample = 0; sample < 100; sample++) {
      const a = Array.from({ length: rows }, () => Array.from({ length: inner }, value));
      const b = Array.from({ length: inner }, () => Array.from({ length: columns }, value));
      const aBefore = structuredClone(a), bBefore = structuredClone(b);
      assert.deepEqual(K.matMul(a, b), reference(a, b));
      assert.deepEqual(a, aBefore); assert.deepEqual(b, bBefore);
    }
  }
});

test('faster graph search preserves the measured minimum-travel routes and all eight edge checks', async () => {
  const map = await M.buildFeasibilityMap();
  // Recorded from the exhaustive predecessor-order planner before optimization.
  const cases = [
    { branch: 0, angle: -80, changes: [[0, 9, 0], [47, 10, 0]], travel: 4.021128631130621, oldEdges: 1424 },
    { branch: 0, angle: 80, changes: [[0, 25, 0], [39, 24, 0]], travel: 3.987979062138794, oldEdges: 1209 },
    { branch: 4, angle: 0, changes: [[0, 17, 4], [3, 16, 4], [7, 15, 4], [10, 14, 4],
      [38, 13, 4], [44, 12, 4], [45, 11, 4], [46, 10, 4], [47, 9, 4], [48, 8, 4],
      [49, 7, 4], [50, 6, 4]], travel: 6.07962193507315, oldEdges: 1680 }
  ];
  for (const example of cases) {
    const row = M.ANGLE_OPTIONS.indexOf(example.angle), progress = [];
    const result = await P.planAnalytical(map, { row, branch: example.branch,
      cost: 'travel', onProgress: value => progress.push(value) });
    assert.equal(result.complete, true);
    assert.equal(result.samples.length, 961);
    const changes = result.corridor.filter((node, i, nodes) => !i
      || node.row !== nodes[i - 1].row || node.branch !== nodes[i - 1].branch)
      .map(node => [node.k, node.row, node.branch]);
    assert.deepEqual(changes, example.changes);
    let travel = 0;
    for (let i = 8; i < result.q.length; i += 8) travel += P.jointDistance(result.q[i], result.q[i - 8]);
    assert.ok(Math.abs(travel - example.travel) < 1e-12);
    // Count expensive operations, rather than imposing machine-specific timing.
    assert.ok(result.checkedEdges < example.oldEdges * .7);
    assert.equal(progress.at(-1), 1);
    assert.ok(progress.every((value, i) => value >= 0 && value <= 1 && (!i || value >= progress[i - 1])));
    for (let i = 1; i < result.corridor.length; i++) {
      const a = result.corridor[i - 1], b = result.corridor[i];
      const independentlyChecked = P.validateAnalyticalConnection(map.spec,
        { ...map.cells[a.k][a.row][a.branch], s: map.samples[a.k].s },
        { ...map.cells[b.k][b.row][b.branch], s: map.samples[b.k].s }, 8);
      assert.ok(independentlyChecked);
      assert.deepEqual(result.samples.slice(1 + (i - 1) * 8, 1 + i * 8), independentlyChecked);
    }
  }
});
