'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const modelDirectory = path.join(__dirname, '../assets/models/iiwa7');
const reference = fs.readFileSync(path.join(modelDirectory, 'iiwa7.urdf'), 'utf8');
const altered = fs.readFileSync(path.join(modelDirectory, 'kuka_iiwa7_misaligned.urdf'), 'utf8');
const moduleHtml = fs.readFileSync(path.join(__dirname, '../../modules/module1/index.html'), 'utf8');

function visualOrigins(xml) {
  const result = {};
  for (const match of xml.matchAll(/<link name="([^"]+)">([\s\S]*?)<\/link>/g)) {
    const visual = match[2].match(/<visual>([\s\S]*?)<\/visual>/);
    if (!visual) continue;
    const origin = visual[1].match(/<origin\s+([^>]+)\/>/)[1];
    result[match[1]] = Object.fromEntries(['xyz', 'rpy'].map(key => [key,
      origin.match(new RegExp(`${key}="([^"]+)"`))[1].trim().split(/\s+/).map(Number)
    ]));
  }
  return result;
}

function maskVisualOrigins(xml) {
  return xml.replace(/<visual>[\s\S]*?<\/visual>/g, visual =>
    visual.replace(/<origin\s+[^>]+\/>/, '<origin VISUAL_ORIGIN />'));
}

test('misaligned clone changes only visual origins and keeps all other URDF bytes intact', () => {
  assert.equal(maskVisualOrigins(altered), maskVisualOrigins(reference));
  const before = visualOrigins(reference);
  const after = visualOrigins(altered);
  assert.equal(Object.keys(after).length, 8);
  const changed = Object.keys(after).filter(name => JSON.stringify(before[name]) !== JSON.stringify(after[name]));
  assert.deepEqual(changed, ['iiwa_link_1', 'iiwa_link_2', 'iiwa_link_3', 'iiwa_link_5', 'iiwa_link_7']);
  const expected = {
    iiwa_link_1: { xyz: [0, 0, -0.0075], rpy: [Math.PI / 2, 0, 0] },
    iiwa_link_2: { xyz: [0, 0, 0], rpy: [0, -Math.PI / 2, 0] },
    iiwa_link_3: { xyz: [0, 0, 0.026], rpy: [0, 0, Math.PI / 2] },
    iiwa_link_5: { xyz: [0, 0, 0.026], rpy: [-Math.PI / 2, 0, 0] },
    iiwa_link_7: { xyz: [0, 0, 0.0005], rpy: [0, 0, -Math.PI / 2] }
  };
  for (const name of changed) {
    assert.deepEqual(after[name], expected[name]);
    after[name].xyz.forEach((value, i) => assert.ok(value === before[name].xyz[i] || value === -before[name].xyz[i]));
    after[name].rpy.forEach(value => assert.ok([0, Math.PI / 2, -Math.PI / 2].includes(value)));
  }
});

test('all eight default visual meshes resolve by the same basename matching used in Module 01', () => {
  const visuals = Array.from(altered.matchAll(/<visual>([\s\S]*?)<\/visual>/g), match => match[1]);
  assert.equal(visuals.length, 8);
  for (const visual of visuals) {
    const filename = visual.match(/<mesh filename="([^"]+)"/)[1];
    assert.ok(fs.statSync(path.join(modelDirectory, path.posix.basename(filename))).size > 0);
  }
  assert.match(moduleHtml, /DEFAULT_DATA_ROOT=new URL\('\.\.\/\.\.\/lectures_main\/assets\/models\/iiwa7\/'/);
  assert.match(moduleHtml, /DEFAULT_URDF_NAME='kuka_iiwa7_misaligned\.urdf'/);
  assert.match(moduleHtml, /fetchDefaultFile\(new URL\(name,DEFAULT_DATA_ROOT\)/);
});

test('the five exact preview poses match the exercise and lie inside the canonical physical limits', () => {
  const source = moduleHtml.match(/const POSE_PRESETS=([\s\S]*?);\n/)[1];
  const presets = JSON.parse(JSON.stringify(vm.runInNewContext('(' + source + ')')));
  assert.deepEqual(presets, {
    home: [0, 0, 0, 0, 0, 0, 0],
    bent: [0, Math.PI / 4, 0, -Math.PI / 2, 0, Math.PI / 4, 0],
    bent_back: [0, -Math.PI / 4, 0, Math.PI / 2, 0, -Math.PI / 4, 0],
    side_reach: [Math.PI / 2, Math.PI / 4, 0, -Math.PI / 2, 0, Math.PI / 4, 0],
    wrist_turn: [0, Math.PI / 4, 0, -Math.PI / 2, 0, Math.PI / 4, Math.PI / 2]
  });
  for (let i = 1; i <= 7; i += 1) {
    const joint = reference.match(new RegExp(`<joint name="iiwa_joint_${i}"[^>]*>([\\s\\S]*?)<\\/joint>`))[1];
    const limit = joint.match(/<limit\s+([^>]+)\/>/)[1];
    const lower = Number(limit.match(/lower="([^"]+)"/)[1]);
    const upper = Number(limit.match(/upper="([^"]+)"/)[1]);
    for (const pose of Object.values(presets)) assert.ok(pose[i - 1] >= lower && pose[i - 1] <= upper);
  }
});

test('numeric repair input accepts radians and pi expressions without evaluating code or treating blanks as zero', () => {
  const source = moduleHtml.match(/function parseTransformNumber\(text\)\{[\s\S]*?\n\}(?=\nfunction nums)/)[0];
  const parse = vm.runInNewContext('(' + source + ')');
  for (const [input, expected] of [['0', 0], ['-0.026', -0.026], ['1e-3', 0.001], ['pi/2', Math.PI / 2], ['-pi/2', -Math.PI / 2], ['3*pi/4', 3 * Math.PI / 4], ['−π / 2', -Math.PI / 2]]) {
    assert.equal(parse(input), expected);
  }
  for (const input of ['', ' ', 'NaN', 'Infinity', '1e999', 'pi/0', '1 2', 'Math.PI/2', 'alert(1)', '0;process.exit()']) {
    assert.throws(() => parse(input), input);
  }
});
