'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const answers = require('../js/exercises/exercise-01-answers.js');
const { parseNumber } = require('../js/exercises/exercise-01-numbers.js');
const { initialVisualOrigins } = require('../js/exercises/exercise-01-visual-origins.js');
const checker = require('../solutions/js/exercise-01-checker.js');

test('download/import preserves screw and matrix expressions, choices and unfinished answers', () => {
  const entered = { 'dh.1.alpha': '-pi/2', 'dh.1.d': '0.34', 'base.1.4': '0.1 + 0.2', 'tool.3.4': '0.045',
    'tool.1.2': '-1/2', 'poe.2.wy': '-1', 'poe.2.vx': '0.15 + 0.19', 'poe.M.3.4': '0.34 + 0.4 + 0.4 + 0.081 + 0.045',
    'poe.M.1.2': '-pi/2', 'fk.bent.1.4': '0.282843', 'visual.1.roll': '-pi/2', 'visual.3.z': '-0.052', 'concept.visualChangesFK': 'no' };
  const payload = answers.createPayload(entered);
  assert.equal(payload.schemaVersion, 5);
  const restored = answers.parsePayload(JSON.stringify(payload));
  for (const [key, value] of Object.entries(entered)) assert.equal(restored[key], value);
  assert.equal(restored['fk.home.4.4'], '');
  assert.equal(restored['base.4.4'], '');
  assert.equal(restored['poe.1.wx'], '');
  assert.equal(restored['poe.M.4.4'], '');
  assert.equal(Object.keys(restored).length, 248);
  assert.equal(checker.evaluate(restored).fields['fk.home.4.4'].status, 'unanswered');
});

test('older response files retain numeric work while retired written responses are removed', () => {
  const legacy = { ...answers.createPayload({}), schemaVersion: 1, answers: { 'dh.1.d': '0.34', 'visual.3.z': '-0.026', finalExplanation: 'Legacy explanation', 'residual.position': '0' } };
  const restored = answers.parsePayload(JSON.stringify(legacy));
  assert.equal(restored['dh.1.d'], '0.34');
  assert.equal(parseNumber(restored['visual.3.z']).value, -0.052);
  assert.equal(restored['fk.home.1.1'], '');
  assert.equal(Object.hasOwn(restored, 'finalExplanation'), false);
  assert.equal(answers.createPayload(restored).schemaVersion, 5);
});

test('older answer schemas preserve existing work and leave every new PoE response blank', () => {
  const poeKeys = answers.FIELD_KEYS.filter(key => key.startsWith('poe.'));
  assert.equal(poeKeys.length, 58);
  for (const schemaVersion of [1, 2, 3, 4]) {
    const entered = { 'dh.1.alpha': '-pi/2', 'fk.home.4.4': '1', 'visual.4.x': '0.1 + 0.2', 'concept.visualChangesFK': 'no' };
    const legacy = { ...answers.createPayload({}), schemaVersion, answers: entered };
    const restored = answers.parsePayload(JSON.stringify(legacy));
    for (const [key, value] of Object.entries(entered)) assert.equal(restored[key], value);
    for (const key of poeKeys) assert.equal(restored[key], '', `schema ${schemaVersion}: ${key}`);
    for (const key of ['poe.1.wx', 'poe.M.1.1']) {
      assert.throws(() => answers.validatePayload({ ...legacy, answers: { ...entered, [key]: '0' } }), /Unknown answer field: poe\./);
    }
  }
});

test('schema four matrices and visual corrections migrate unchanged into schema five', () => {
  const entered = { 'base.1.4': '0.1 + 0.2', 'tool.3.4': '0.045', 'base.4.4': '1',
    'visual.1.z': '0.015', 'visual.1.roll': '-pi/2', 'visual.3.z': '-0.052',
    'visual.5.roll': ' '.repeat(155) + 'pi/2', 'visual.7.yaw': '', 'dh.1.alpha': '-pi/2' };
  const restored = answers.validatePayload({ ...answers.createPayload({}), schemaVersion: 4, answers: entered });
  for (const [key, value] of Object.entries(entered)) assert.equal(restored[key], value);
  assert.deepEqual(answers.parsePayload(JSON.stringify(answers.createPayload(restored))), restored);
});

test('old xyz/RPY files migrate expressions and ordered rotations into homogeneous matrices', () => {
  for (const schemaVersion of [1, 2]) {
    const legacy = { ...answers.createPayload({}), schemaVersion, answers: {
      'dh.1.d': '0.34', 'visual.3.z': '-0.026', 'fk.home.4.4': '1', 'concept.jointChangesFK': 'yes',
      'base.x': '0.1 + 0.2', 'base.y': '-0.03', 'base.z': '0',
      'base.roll': 'π/2', 'base.pitch': '0', 'base.yaw': 'pi/2',
      'tool.x': '0', 'tool.y': '0', 'tool.z': '0.045',
      'tool.roll': '0', 'tool.pitch': '0', 'tool.yaw': '0'
    } };
    const restored = answers.parsePayload(JSON.stringify(legacy));
    assert.equal(restored['base.1.4'], '0.1 + 0.2');
    assert.equal(restored['base.2.4'], '-0.03');
    assert.equal(restored['tool.3.4'], '0.045');
    const expectedRotation = [0, 0, 1, 1, 0, 0, 0, 1, 0];
    expectedRotation.forEach((value, index) => {
      assert.ok(Math.abs(Number(restored[`base.${Math.floor(index / 3) + 1}.${index % 3 + 1}`]) - value) < 1e-14);
    });
    for (let row = 1; row <= 4; row += 1) {
      for (let column = 1; column <= 4; column += 1) {
        assert.equal(restored[`tool.${row}.${column}`], row === 3 && column === 4 ? '0.045' : String(Number(row === column)));
      }
    }
    assert.deepEqual([1, 2, 3, 4].map(column => restored[`base.4.${column}`]), ['0', '0', '0', '1']);
    for (const key of ['dh.1.d', 'fk.home.4.4', 'concept.jointChangesFK']) assert.equal(restored[key], legacy.answers[key]);
    assert.equal(parseNumber(restored['visual.3.z']).value, -0.052);
    assert.equal(Object.hasOwn(restored, 'base.roll'), false);
    assert.deepEqual(answers.parsePayload(JSON.stringify(answers.createPayload(restored))), restored);
  }
});

test('partial old transforms retain translations without assuming missing angles or answers are zero', () => {
  const legacy = { ...answers.createPayload({}), schemaVersion: 2,
    answers: { 'base.x': '1/10', 'base.roll': 'pi/2', 'base.pitch': '0', 'tool.x': '', 'tool.roll': ' ' } };
  const restored = answers.validatePayload(legacy);
  assert.equal(restored['base.1.4'], '1/10');
  assert.equal(restored['base.2.4'], '');
  assert.equal(restored['base.3.4'], '');
  for (let row = 1; row <= 3; row += 1) {
    for (let column = 1; column <= 3; column += 1) assert.equal(restored[`base.${row}.${column}`], '');
  }
  assert.deepEqual([1, 2, 3, 4].map(column => restored[`base.4.${column}`]), ['0', '0', '0', '1']);
  for (const key of answers.FIELD_KEYS.filter(key => key.startsWith('tool.'))) assert.equal(restored[key], '');
});

test('invalid old rotation expressions reject migration clearly and leave the original work intact', () => {
  for (const expression of ['1/0', 'pi +', 'globalThis.answerInjected = true']) {
    const legacy = { ...answers.createPayload({}), schemaVersion: 2,
      answers: { 'dh.1.d': '0.34', 'tool.z': '0.045', 'tool.yaw': expression } };
    const original = JSON.stringify(legacy);
    assert.throws(() => answers.validatePayload(legacy), /Cannot convert the old tool rotation: tool\.yaw is invalid/);
    assert.equal(JSON.stringify(legacy), original);
    assert.equal(globalThis.answerInjected, undefined);
  }
  assert.throws(() => answers.createPayload({ 'base.x': '0' }), /Unknown answer field/);
  for (const schemaVersion of [1, 2]) {
    assert.throws(() => answers.validatePayload({ ...answers.createPayload({}), schemaVersion,
      answers: { 'base.1.4': '0.1', 'base.x': '0.2' } }), /Unknown answer field: base\.1\.4/);
  }
});

test('shared original visual origins exactly match the supplied misaligned URDF', () => {
  const urdf = fs.readFileSync(path.join(__dirname, '../assets/models/iiwa7/kuka_iiwa7_misaligned.urdf'), 'utf8');
  const supplied = [];
  for (const [, index, body] of urdf.matchAll(/<link name="iiwa_link_(\d)">([\s\S]*?)<\/link>/g)) {
    const origin = body.match(/<visual>\s*<origin\b([^>]+)\/>/)[1];
    supplied[Number(index)] = ['xyz', 'rpy'].flatMap(attribute =>
      origin.match(new RegExp(`\\b${attribute}="([^"]*)"`))[1].trim().split(/\s+/).map(Number));
  }
  assert.deepEqual(initialVisualOrigins, supplied);
  assert.equal(initialVisualOrigins.length, 8);
  assert.ok(Object.isFrozen(initialVisualOrigins));
  assert.ok(initialVisualOrigins.every(Object.isFrozen));
});

test('old absolute visual answers migrate to component differences in metres and radians', () => {
  for (const schemaVersion of [1, 2, 3]) {
    const legacy = { ...answers.createPayload({}), schemaVersion, answers: {
      'visual.1.z': '0.0075', 'visual.1.roll': '0', 'visual.2.pitch': 'pi / 4',
      'visual.3.z': '-0.026', 'visual.3.yaw': '', 'visual.5.roll': '0',
      'visual.7.z': '-0.0005', 'visual.7.yaw': '0', 'visual.4.x': '0.01 + 0.02',
      'dh.1.alpha': '-pi/2', 'fk.home.4.4': '1'
    } };
    if (schemaVersion === 3) legacy.answers['base.1.4'] = '0.1 + 0.2';
    const original = JSON.stringify(legacy);
    const restored = answers.parsePayload(original);
    const expected = { 'visual.1.z': 0.015, 'visual.1.roll': -Math.PI / 2, 'visual.2.pitch': 3 * Math.PI / 4,
      'visual.3.z': -0.052, 'visual.5.roll': Math.PI / 2, 'visual.7.z': -0.001, 'visual.7.yaw': Math.PI / 2 };
    for (const [key, value] of Object.entries(expected)) assert.ok(Math.abs(parseNumber(restored[key]).value - value) < 1e-14, key);
    assert.equal(restored['visual.3.yaw'], '');
    assert.equal(restored['visual.2.roll'], '');
    assert.equal(restored['visual.4.x'], '0.01 + 0.02');
    assert.ok(restored['visual.2.pitch'].includes('pi / 4'));
    assert.equal(restored['dh.1.alpha'], '-pi/2');
    assert.equal(restored['fk.home.4.4'], '1');
    if (schemaVersion === 3) assert.equal(restored['base.1.4'], '0.1 + 0.2');
    assert.equal(JSON.stringify(legacy), original);
    assert.deepEqual(answers.parsePayload(JSON.stringify(answers.createPayload(restored))), restored);
  }
});

test('visual migration preserves unfinished expressions and fits long legacy responses without evaluating text', () => {
  const invalid = 'globalThis.answerInjected = true';
  const longExpression = ' '.repeat(119) + '0';
  const nestedExpression = '('.repeat(23) + '0' + ')'.repeat(23);
  const legacy = { ...answers.createPayload({}), schemaVersion: 3,
    answers: { 'visual.1.roll': invalid, 'visual.2.pitch': nestedExpression, 'visual.3.z': '1/', 'visual.5.roll': longExpression, 'visual.7.yaw': '   ' } };
  const restored = answers.validatePayload(legacy);
  assert.ok(restored['visual.1.roll'].includes(invalid));
  assert.equal(parseNumber(restored['visual.1.roll']).status, 'invalid');
  assert.ok(restored['visual.3.z'].includes('1/'));
  assert.equal(parseNumber(restored['visual.3.z']).status, 'invalid');
  assert.equal(parseNumber(restored['visual.5.roll']).value, Math.PI / 2);
  assert.ok(restored['visual.5.roll'].length > 120);
  assert.equal(parseNumber(nestedExpression).status, 'valid');
  assert.equal(parseNumber(restored['visual.2.pitch']).value, Math.PI / 2);
  assert.equal(restored['visual.7.yaw'], '   ');
  assert.equal(globalThis.answerInjected, undefined);
  assert.deepEqual(answers.parsePayload(JSON.stringify(answers.createPayload(restored))), restored);
  assert.throws(() => answers.createPayload({ 'visual.1.roll': '0'.repeat(161) }), /too long/);
});

test('downloaded reference numeric answers still pass verification after import', () => {
  const restored = answers.parsePayload(JSON.stringify(answers.createPayload(checker.referenceAnswers())));
  const result = checker.evaluate(restored);
  assert.equal(result.fk.status, 'correct');
  assert.equal(result.summary.correct, 248);
  assert.equal(result.summary.incorrect, 0);
});

test('completed answer-key JSON fills every response and passes numeric verification', () => {
  const keyPath = path.join(__dirname, '../solutions/exercise_01_answers.json');
  const restored = answers.parsePayload(fs.readFileSync(keyPath, 'utf8'));
  assert.deepEqual(Object.keys(restored).sort(), answers.FIELD_KEYS.slice().sort());
  for (const [key, value] of Object.entries(restored)) assert.ok(value.trim(), key);
  const result = checker.evaluate(restored);
  assert.equal(result.fk.status, 'correct');
  assert.equal(result.summary.correct, 248);
  assert.equal(result.summary.incorrect, 0);
  assert.equal(result.summary.invalid, 0);
  assert.equal(result.summary.unanswered, 0);
  const solution = fs.readFileSync(path.join(__dirname, '../solutions/exercise_01.html'), 'utf8');
  assert.equal(/exercise_01_answers\.json|download-answer-key|exercise-answer-key|<script[^>]+type="application\/json"/.test(solution), false, 'feedback page must not link to or embed the answer key');
  const student = fs.readFileSync(path.join(__dirname, '../exercises/exercise_01.html'), 'utf8');
  assert.doesNotMatch(student, /exercise_01_answers\.json|download-answer-key/);
});

test('rejects unsupported exercise, version, model and units instead of silently interpreting them', () => {
  for (const patch of [
    { exercise: 'exercise_02' }, { schemaVersion: 6 }, { model: 'other_robot' },
    { units: { length: 'mm', angle: 'rad' } }, { units: { length: 'm', angle: 'deg' } },
    { answers: null }, { answers: [] }
  ]) {
    assert.throws(() => answers.validatePayload({ ...answers.createPayload({}), ...patch }));
  }
});

test('rejects malformed JSON, oversized uploads and oversized individual answers', () => {
  for (const text of ['{broken', 'null', '[]', 'x'.repeat(answers.MAX_FILE_BYTES + 1)]) {
    assert.throws(() => answers.parsePayload(text));
  }
  assert.throws(() => answers.createPayload({ 'dh.1.d': '0'.repeat(121) }));
  assert.throws(() => answers.createPayload({ 'poe.1.wx': '0'.repeat(121) }));
  assert.throws(() => answers.createPayload({ 'poe.M.1.1': '0'.repeat(121) }));
  assert.throws(() => answers.createPayload({ finalExplanation: 'Retired written response' }));
  assert.throws(() => answers.createPayload({ 'dh.1.d': 0.34 }));
});

test('rejects unknown/prototype keys and never evaluates submitted expressions', () => {
  for (const key of ['unknown', '__proto__', 'constructor', 'toString']) {
    assert.throws(() => answers.createPayload(Object.fromEntries([[key, 'malicious']])));
  }
  const html = '<img src=x onerror="globalThis.answerInjected=true">';
  const restored = answers.parsePayload(JSON.stringify(answers.createPayload({ 'fk.home.1.1': html })));
  assert.equal(checker.evaluate(restored).fields['fk.home.1.1'].status, 'invalid');
  assert.equal(globalThis.answerInjected, undefined);
});

test('exercise and feedback clone expose matching labeled fields, with feedback only in the clone', () => {
  for (const directory of ['exercises', 'solutions']) {
    const html = fs.readFileSync(path.join(__dirname, '..', directory, 'exercise_01.html'), 'utf8');
    const fields = Array.from(html.matchAll(/data-field="([^"]+)"/g), match => match[1]);
    assert.deepEqual(fields.slice().sort(), answers.FIELD_KEYS.slice().sort());
    const ids = Array.from(html.matchAll(/\sid="([^"]+)"/g), match => match[1]);
    assert.equal(new Set(ids).size, ids.length);
    for (const field of fields) {
      const id = 'answer-' + field.replace(/\./g, '-');
      assert.ok(html.includes(`id="${id}" data-field="${field}" aria-label="`), field);
      assert.equal(html.includes(`aria-describedby="${id}-feedback"`), directory === 'solutions', field);
      assert.equal(ids.includes(id + '-feedback'), directory === 'solutions', field);
    }
    assert.equal(html.includes('\\square'), false);
    assert.doesNotMatch(html, /<textarea/);
    const poses = Array.from(html.matchAll(/data-fk-pose="([^"]+)" data-q-radians='([^']+)'/g));
    assert.equal(poses.length, 5);
    for (const [, name, q] of poses) assert.deepEqual(JSON.parse(q), checker.poses[name]);
    assert.equal(html.includes('exercise-01-checker.js'), directory === 'solutions');
    assert.equal(html.includes('exercise-01-verification.js'), directory === 'solutions');
  }
});

test('student slides contain no solution link, verification controls, results or checker code', () => {
  const html = fs.readFileSync(path.join(__dirname, '../exercises/exercise_01.html'), 'utf8');
  assert.doesNotMatch(html, /solutions\/|exercise-01-(?:checker|verification)\.js|id="(?:verification|verify-answers|view-results)[^"]*"|Check answers|answer-feedback/);
  const shared = fs.readFileSync(path.join(__dirname, '../js/exercises/exercise-01-answers.js'), 'utf8');
  assert.doesNotMatch(shared, /Exercise01Checker|referenceAnswers|function verify\(/);
  assert.equal(fs.existsSync(path.join(__dirname, '../js/exercises/exercise-01-checker.js')), false);
});
