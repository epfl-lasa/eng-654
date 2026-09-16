'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
let searchAspectPath, lecture;
const PI = Math.PI, wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
before(async () => {
  ({ searchAspectPath } = await import(pathToFileURL(path.join(__dirname, '../js/viz/cuspidalPathPlanner.js')).href));
  const filename = path.join(__dirname, '../js/viz/cuspidalityLecture.js');
  const THREE = await import(pathToFileURL(path.join(__dirname, '../vendor/three/build/three.module.js')).href);
  const source = fs.readFileSync(filename, 'utf8').replace(/^import .*;\s*$/gm, '').replace(/export (async )?function /g, '$1function ').replace(/import\.meta\.url/g, JSON.stringify(pathToFileURL(filename).href));
  const context = vm.createContext({ THREE, URL });
  vm.runInContext(`${source}\nglobalThis.testAPI={det3, p:CUSTOM_3R_URDF_DH};`, context, { filename });
  lecture = context.testAPI;
});

function validateDense(result, start, goal, det, clearance) {
  assert.equal(result.found, true, result.reason);
  const first = result.path[0], last = result.path.at(-1), sign = Math.sign(det(start));
  start.forEach((v, i) => assert.ok(Math.abs(v - first[i]) < 1e-12));
  goal.forEach((v, i) => assert.ok(Math.abs(wrap(v - last[i])) < 1e-12));
  for (let i = 1; i < result.path.length; i += 1) {
    const a = result.path[i - 1], b = result.path[i];
    assert.ok(Math.hypot(...b.map((v, k) => v - a[k])) <= .010001);
    // Independently check ten times finer than the planner, including interiors.
    for (let k = 0; k <= 10; k += 1) assert.ok(sign * det(a.map((v, j) => v + (b[j] - v) * k / 10)) > clearance);
  }
}

test('opposite-sign IK branches cannot be joined through a regular aspect', () => {
  const result = searchAspectPath([0, .6], [0, -.6], { determinant: q => Math.sin(q[1]) });
  assert.equal(result.found, false); assert.match(result.reason, /Opposite determinant signs/);
});

test('same determinant sign alone does not imply a connected aspect', () => {
  const result = searchAspectPath([.4, 0], [.4 + PI, 0], { determinant: q => Math.sin(2 * q[0]), resolution: 48 });
  assert.equal(result.found, false); assert.ok(result.expanded > 0);
});

test('search detours around singular values crossed twice by direct interpolation', () => {
  // A negative island surrounded by a positive connected aspect.
  const determinant = q => 2 - Math.cos(q[0]) - Math.cos(q[1]) - .4;
  const start = [-1.5, 0], goal = [1.5, 0];
  const result = searchAspectPath(start, goal, { determinant, clearance: .05, resolution: 72 });
  assert.ok(result.expanded > 0); validateDense(result, start, goal, determinant, .05);
});

test('periodic boundary routes are continuous for positive and negative angles', () => {
  for (const direction of [1, -1]) {
    const start = [direction * 3.05, .6], goal = [-direction * 3.05, .6], determinant = q => Math.sin(q[1]);
    const result = searchAspectPath(start, goal, { determinant });
    validateDense(result, start, goal, determinant, .02);
    assert.ok(Math.abs(result.path.at(-1)[0] - start[0]) < .2);
  }
});

test('a requested edge constraint is checked on direct paths and all shortcuts', () => {
  const start = [-1.2, 0], goal = [1.2, 0];
  const outside = q => Math.hypot(wrap(q[0]), wrap(q[1])) > .7;
  const result = searchAspectPath(start, goal, {
    determinant: () => 1, resolution: 64, edgeValidator: (_a, _b, samples) => samples.every(outside)
  });
  validateDense(result, start, goal, () => 1, .02);
  assert.ok(result.expanded > 0); assert.ok(result.path.every(outside));
});

test('endpoint clearance is checked before attaching endpoints to the grid', () => {
  for (const goal of [[1, 0], [1, .009]]) {
    const result = searchAspectPath([0, .7], goal, { determinant: q => Math.sin(q[1]), clearance: .01 });
    assert.equal(result.found, false); assert.match(result.reason, /endpoint/);
  }
});

// Independent closed-form FK from the URDF's Rz(q1), Ry(q2), Rz(q3) joints.
function urdfPosition([q1, q2, q3]) {
  const u = 2 + 1.5 * Math.cos(q3), X = 1 + Math.cos(q2) * u + .75 * Math.sin(q2), Y = 1.25 + 1.5 * Math.sin(q3);
  return [Math.cos(q1) * X - Math.sin(q1) * Y, Math.sin(q1) * X + Math.cos(q1) * Y, 1 - Math.sin(q2) * u + .75 * Math.cos(q2)];
}
function numericDet(q) {
  const h = 1e-5;
  const cols = q.map((_, k) => {
    const a = q.slice(), b = q.slice(); a[k] += h; b[k] -= h;
    return urdfPosition(a).map((v, i) => (v - urdfPosition(b)[i]) / (2 * h));
  });
  const [a, b, c] = cols;
  return a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
}

test('actual course 3R IKs admit a regular closed y=0 loop of discrete joint samples', () => {
  const endpoints = [[-35, -10, -170], [-14.6556883192, -6.6055592987, -147.6075456696], [178.4024280182, -147.5329051962, -61.1502417161], [-69.0983199015, -61.9762166618, 166.6779007736]].map(q => q.map(v => v * PI / 180));
  const determinant = q => lecture.det3([0, ...q], lecture.p);
  let result, selected;
  outer: for (let i = 0; i < endpoints.length; i += 1) for (let j = i + 1; j < endpoints.length; j += 1) {
    if (determinant(endpoints[i].slice(1)) * determinant(endpoints[j].slice(1)) < 0) continue;
    result = searchAspectPath(endpoints[i].slice(1), endpoints[j].slice(1), { determinant, clearance: .02, resolution: 120 });
    if (result.found) { selected = [endpoints[i], endpoints[j]]; break outer; }
  }
  assert.ok(selected, 'The four course IKs must include a connected same-aspect pair.');
  validateDense(result, selected[0].slice(1), selected[1].slice(1), determinant, .02);
  for (const azimuth of [0, PI]) {
    const complete = result.path.map(slice => {
      const p0 = urdfPosition([0, ...slice]); return [azimuth - Math.atan2(p0[1], p0[0]), ...slice];
    });
    const points = complete.map(urdfPosition);
    assert.ok(points.every(p => Math.abs(p[1]) < 2e-14));
    assert.ok(Math.hypot(...points[0].map((v, i) => v - points.at(-1)[i])) < 1e-9);
    assert.ok(complete.every(q => Math.abs(numericDet(q)) > .01999));
    assert.ok(Math.hypot(...complete[0].map((v, i) => wrap(v - complete.at(-1)[i]))) > .1);
  }
});
