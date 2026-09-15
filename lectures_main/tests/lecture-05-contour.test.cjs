'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Check the plotted zero curves against the lecture's actual determinant,
// without initializing its Three.js scenes or requiring a browser.
const lecture = fs.readFileSync(path.join(__dirname, '../js/viz/singularityLecture.js'), 'utf8');
const course3RDet = vm.runInNewContext(`(${lecture.match(/function course3RDet\([^\n]+/)[0]})`);
const plot = import('../js/viz/determinantMap.js');

for (const a1 of [0, 1]) {
  test(`a₁=${a1}: every zero-curve vertex has a zero determinant`, async () => {
    const { course3RZeroCurves } = await plot;
    const curves = course3RZeroCurves(a1);
    assert.ok(curves.length >= 4, 'include all branches in the periodic joint-angle domain');
    for (const line of curves) {
      assert.ok(line.length >= 2);
      for (const [q2, q3] of line) {
        assert.ok(Math.abs(q2) <= Math.PI && Math.abs(q3) <= Math.PI);
        assert.ok(Math.abs(course3RDet([0, q2, q3], a1)) < 1e-10);
      }
    }
  });
}

test('intersecting axes retain both vertical branches and both horizontal branches', async () => {
  const { course3RZeroCurves } = await plot;
  const curves = course3RZeroCurves(0);
  const vertical = curves.filter(line => line[0][0] === line.at(-1)[0]);
  const horizontal = curves.filter(line => line[0][1] === line.at(-1)[1]);
  assert.deepEqual(vertical.map(line => line[0][0]), [-Math.PI / 2, Math.PI / 2]);
  assert.equal(horizontal.length, 2);
  // Interpolate each complete segment: the whole line, including its crossings,
  // must be singular; zero endpoints alone do not establish this.
  for (const line of curves) {
    for (let i = 0; i <= 128; i++) {
      const q = line[0].map((value, axis) => value + (line[1][axis] - value) * i / 128);
      assert.ok(Math.abs(course3RDet([0, ...q], 0)) < 1e-10);
    }
  }
});

test('offset-axis curves include two roots for every generic q₂ slice without long jumps', async () => {
  const { course3RZeroCurves } = await plot;
  const curves = course3RZeroCurves(1);
  for (let index = 1; index < 1024; index += 17) {
    const q2 = -Math.PI + 2 * Math.PI * index / 1024;
    if (Math.abs(Math.cos(q2)) < 1e-10) continue; // ±π denote the same periodic root.
    const matches = curves.flat().filter(point => Math.abs(point[0] - q2) < 1e-12);
    assert.equal(matches.length, 2, `two roots per full period at q₂=${q2}`);
  }
  for (const line of curves) {
    for (let i = 1; i < line.length; i++) {
      assert.ok(Math.abs(line[i][1] - line[i - 1][1]) < .04, 'never connect across a ±π wrap');
    }
  }
});
