'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const answers = require('../js/exercises/exercise-01-answers.js');
const checker = require('../solutions/js/exercise-01-checker.js');

test('download/import preserves numeric expressions, choices and unfinished matrices', () => {
  const entered = { 'dh.1.alpha': '-pi/2', 'dh.1.d': '0.34', 'fk.bent.1.4': '0.282843', 'concept.visualChangesFK': 'no' };
  const payload = answers.createPayload(entered);
  assert.equal(payload.schemaVersion, 2);
  const restored = answers.parsePayload(JSON.stringify(payload));
  for (const [key, value] of Object.entries(entered)) assert.equal(restored[key], value);
  assert.equal(restored['fk.home.4.4'], '');
  assert.equal(Object.keys(restored).length, 170);
  assert.equal(checker.evaluate(restored).fields['fk.home.4.4'].status, 'unanswered');
});

test('older response files retain numeric work while retired written responses are removed', () => {
  const legacy = { ...answers.createPayload({}), schemaVersion: 1, answers: { 'dh.1.d': '0.34', 'visual.3.z': '-0.026', finalExplanation: 'Legacy explanation', 'residual.position': '0' } };
  const restored = answers.parsePayload(JSON.stringify(legacy));
  assert.equal(restored['dh.1.d'], '0.34');
  assert.equal(restored['visual.3.z'], '-0.026');
  assert.equal(restored['fk.home.1.1'], '');
  assert.equal(Object.hasOwn(restored, 'finalExplanation'), false);
  assert.equal(answers.createPayload(restored).schemaVersion, 2);
});

test('downloaded reference numeric answers still pass verification after import', () => {
  const restored = answers.parsePayload(JSON.stringify(answers.createPayload(checker.referenceAnswers())));
  const result = checker.evaluate(restored);
  assert.equal(result.fk.status, 'correct');
  assert.equal(result.summary.correct, 170);
  assert.equal(result.summary.incorrect, 0);
});

test('completed answer-key JSON fills every response and passes numeric verification', () => {
  const keyPath = path.join(__dirname, '../solutions/exercise_01_answers.json');
  const restored = answers.parsePayload(fs.readFileSync(keyPath, 'utf8'));
  assert.deepEqual(Object.keys(restored).sort(), answers.FIELD_KEYS.slice().sort());
  for (const [key, value] of Object.entries(restored)) assert.ok(value.trim(), key);
  const result = checker.evaluate(restored);
  assert.equal(result.fk.status, 'correct');
  assert.equal(result.summary.correct, 170);
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
    { exercise: 'exercise_02' }, { schemaVersion: 3 }, { model: 'other_robot' },
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
  assert.doesNotMatch(html, /solutions\/|verification|verify-answers|view-results|Check answers|answer-feedback/);
  const shared = fs.readFileSync(path.join(__dirname, '../js/exercises/exercise-01-answers.js'), 'utf8');
  assert.doesNotMatch(shared, /Exercise01Checker|referenceAnswers|function verify\(/);
  assert.equal(fs.existsSync(path.join(__dirname, '../js/exercises/exercise-01-checker.js')), false);
});
