/* Generate the default Central detail from independent full-pose IK queries.
 * Start tools/serve-crb-ik.sh, then run this file with Node from any directory.
 * Native unresolved cells are recovered with the browser polynomial solver.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const dataDir = path.join(root, 'assets/data/lecture07');
const moduleURL = text => 'data:text/javascript;base64,' + Buffer.from(text).toString('base64');

(async () => {
  const full = JSON.parse(fs.readFileSync(path.join(dataDir, 'crb-slice-xy-diverse.json'), 'utf8'));
  const coefficients = moduleURL(fs.readFileSync(path.join(root, 'js/viz/abbCrbCoefficients.js'), 'utf8'));
  const K = await import(moduleURL(fs.readFileSync(path.join(root, 'js/viz/abbCrbKinematics.js'), 'utf8')
    .replace('./abbCrbCoefficients.js', coefficients)));
  const { computeSlice } = await import(moduleURL(fs.readFileSync(path.join(root, 'js/viz/abbCrbCompute.js'), 'utf8')));
  assert.deepEqual(full.detailBounds, [-.23, .23, -.23, .23]);
  assert.deepEqual(full.jointLimits, K.jointLimits);
  const [xmin, xmax, ymin, ymax] = full.detailBounds;
  const request = { plane: 'xy', nx: 400, ny: 250, xmin, xmax, ymin, ymax,
    z: full.z, orientation: full.orientation };
  let milestone = 0;
  const native = await computeSlice(request, progress => {
    if (progress.done >= milestone) {
      console.log(`Native detail IK: ${progress.done}/${progress.total}`);
      milestone = progress.done + 20000;
    }
  }, { backend: 'rust-native', nativeUrl: process.env.CRBIK_NATIVE_URL || 'http://127.0.0.1:8743' });
  const { counts, limitCounts } = native;
  assert.equal(counts.length, 100000);
  assert.equal(limitCounts.length, counts.length);
  const unresolvedIndices = counts.flatMap((count, i) => count < 0 ? [i] : []);
  const cache = new Map();
  let maxPositionError = 0, maxRotationError = 0, verifiedSolutions = 0;
  const pointAt = i => [xmin + (i % request.nx) * (xmax - xmin) / (request.nx - 1),
    ymin + Math.floor(i / request.nx) * (ymax - ymin) / (request.ny - 1)];
  function verify(i) {
    if (cache.has(i)) return cache.get(i);
    const point = pointAt(i), pose = K.makePose([...point, full.z], full.orientation);
    const result = K.inverse(pose);
    assert.equal(result.diagnostics.resolved, true, `Unresolved independent IK at ${i}`);
    let positionError = 0, rotationError = 0;
    result.solutions.forEach((solution, a) => {
      const error = K.poseError(K.fk(solution.q).matrix, pose);
      assert.ok(error.position < 2e-7 && error.rotation < 2e-7, `FK mismatch at ${i}`);
      positionError = Math.max(positionError, error.position);
      rotationError = Math.max(rotationError, error.rotation);
      const legal = solution.q.every((q, j) => [-1, 0, 1].some(turn => {
        const value = q + turn * 2 * Math.PI;
        return value >= K.jointLimits[j][0] - 1e-10 && value <= K.jointLimits[j][1] + 1e-10;
      }));
      assert.equal(solution.withinLimits, legal, `Limit mismatch at ${i}`);
      for (let b = a + 1; b < result.solutions.length; b++) {
        assert.ok(Math.hypot(...solution.q.map((q, j) => K.wrap(q - result.solutions[b].q[j]))) > 2e-6,
          `Repeated geometric IK at ${i}`);
      }
    });
    verifiedSolutions += result.solutions.length;
    maxPositionError = Math.max(maxPositionError, positionError);
    maxRotationError = Math.max(maxRotationError, rotationError);
    const record = { gridIndex: i, point, count: result.solutions.length,
      limitCount: result.solutions.filter(solution => solution.withinLimits).length,
      maxPositionError: positionError, maxRotationError: rotationError };
    cache.set(i, record);
    return record;
  }
  for (const i of unresolvedIndices) {
    const result = verify(i);
    counts[i] = result.count;
    limitCounts[i] = result.limitCount;
  }
  counts.forEach((count, i) => {
    assert.ok(Number.isInteger(count) && count >= 0 && count <= 16, `Invalid count at ${i}`);
    assert.ok(Number.isInteger(limitCounts[i]) && limitCounts[i] >= 0 && limitCounts[i] <= count,
      `Invalid limit count at ${i}`);
  });
  const histogram = Object.fromEntries([...new Set(counts)].sort((a, b) => a - b)
    .map(count => [count, counts.filter(value => value === count).length]));
  assert.ok(histogram[14] > 0 && histogram[16] > 0, 'The detail must retain its 14- and 16-IK regions');
  const sampleIndices = new Set([0, request.nx - 1, counts.length - request.nx, counts.length - 1,
    ...Array.from({ length: 129 }, (_, i) => (i * 7919 + 109) % counts.length), ...unresolvedIndices]);
  // Sample throughout every geometric and legal count category, including thin regions.
  for (const values of [counts, limitCounts]) for (const count of new Set(values)) {
    const indices = values.flatMap((value, i) => value === count ? [i] : []);
    for (let i = 0; i < 17; i++) sampleIndices.add(indices[Math.floor(i * (indices.length - 1) / 16)]);
  }
  const representativePoints = [];
  for (const i of sampleIndices) {
    const result = verify(i);
    assert.equal(result.count, counts[i], `Native/JS geometric count mismatch at ${i}`);
    assert.equal(result.limitCount, limitCounts[i], `Native/JS legal count mismatch at ${i}`);
    if (!representativePoints.some(point => point.count === result.count)) representativePoints.push(result);
  }
  representativePoints.sort((a, b) => a.count - b.count);
  const atlas = {
    formatVersion: 2, ...request, fixedAxis: 'z', robot: full.robot, frame: full.frame,
    sampleCount: counts.length, sampling: 'vertices', rowOrder: 'y-increasing',
    orientationEulerZYX: full.orientationEulerZYX, orientationDescription: full.orientationDescription,
    detailBounds: full.detailBounds, counts, limitCounts, unresolvedValue: -1, histogram,
    jointLimits: full.jointLimits, limitHandling: full.limitHandling, representativePoints,
    solver: native.solver + '; independent JavaScript real-root recovery and sample verification',
    completeness: 'Numerical algebraic enumeration with FK validation; singular continuous families are not enumerated. Unresolved poses are separate from zero solutions.',
    generation: {
      sourceMetadata: 'crb-slice-xy-diverse.json', targetPoses: counts.length,
      method: 'Independent full-pose IK at every Central detail grid vertex; no cropping or interpolation.',
      backend: native.backend, workers: native.workers, elapsedSeconds: native.elapsedSeconds,
      fallbackPoses: native.fallbackPoses, maxFkError: Math.max(native.maxFkError, maxPositionError, maxRotationError),
      rustUnresolvedPoses: unresolvedIndices.length, rustUnresolvedIndices: unresolvedIndices,
      javascriptRecoveredPoses: unresolvedIndices.length, unresolvedPoses: 0, unresolvedIndices: [],
      independentVerification: {
        method: 'JavaScript 160-bit polynomial real-root isolation, native URDF FK, modulo-2π distinctness, and joint-limit representatives',
        poses: cache.size, solutions: verifiedSolutions, spreadGridPoints: 129,
        sampleIndices: [...cache.keys()].sort((a, b) => a - b),
        maxPositionError, maxRotationError
      }
    }
  };
  assert.deepEqual(atlas.orientation, full.orientation);
  const filename = path.join(dataDir, 'crb-slice-xy-detail.json');
  fs.writeFileSync(filename, JSON.stringify(atlas) + '\n');
  console.log(JSON.stringify({ file: filename, histogram, generation: atlas.generation }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
