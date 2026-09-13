'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const checker = require('../solutions/js/exercise-01-checker.js');

const urdf = fs.readFileSync(path.join(__dirname, '../assets/models/iiwa7/iiwa7.urdf'), 'utf8');
function jointOrigin(name) {
    const block = urdf.match(new RegExp(`<joint\\s+name="${name}"[\\s\\S]*?<\\/joint>`));
    assert.ok(block, `URDF joint ${name} exists`);
    const origin = block[0].match(/<origin\s+([^>]+)\/?\s*>/)[1];
    return ['xyz', 'rpy'].map(attribute => origin.match(new RegExp(`${attribute}="([^"]+)"`))[1].trim().split(/\s+/).map(Number));
}

// The fixture check uses the actual XML and quaternion composition instead of
// the checker's embedded origin table or its rotation-matrix implementation.
function quaternionProduct(a, b) {
    const [w, x, y, z] = a, [v, i, j, k] = b;
    return [w * v - x * i - y * j - z * k, w * i + x * v + y * k - z * j,
        w * j - x * k + y * v + z * i, w * k + x * j - y * i + z * v];
}
function axisQuaternion(axis, angle) {
    const out = [Math.cos(angle / 2), 0, 0, 0]; out[axis + 1] = Math.sin(angle / 2); return out;
}
function rotate(q, p) {
    return quaternionProduct(quaternionProduct(q, [0].concat(p)), [q[0], -q[1], -q[2], -q[3]]).slice(1);
}
function independentUrdfFK(q) {
    let p = [0, 0, 0], rotation = [1, 0, 0, 0];
    function apply(xyz, rpy) {
        const translation = rotate(rotation, xyz);
        p = p.map((value, i) => value + translation[i]);
        const local = quaternionProduct(quaternionProduct(axisQuaternion(2, rpy[2]), axisQuaternion(1, rpy[1])), axisQuaternion(0, rpy[0]));
        rotation = quaternionProduct(rotation, local);
    }
    apply(...jointOrigin('world_iiwa_joint'));
    q.forEach((angle, i) => { apply(...jointOrigin(`iiwa_joint_${i + 1}`)); apply([0, 0, 0], [0, 0, angle]); });
    apply(...jointOrigin('iiwa_joint_ee'));
    const columns = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map(axis => rotate(rotation, axis));
    return [columns[0][0], columns[1][0], columns[2][0], p[0], columns[0][1], columns[1][1], columns[2][1], p[1],
        columns[0][2], columns[1][2], columns[2][2], p[2], 0, 0, 0, 1];
}
function assertMatrixClose(a, b, tolerance = 2e-12) {
    a.forEach((value, i) => assert.ok(Math.abs(value - b[i]) < tolerance, `matrix entry ${i}: ${value} versus ${b[i]}`));
}
function assertChainAccepted(answers) {
    const result = checker.evaluate(answers);
    assert.equal(result.fk.status, 'correct');
    assert.equal(result.fk.testCount, 26);
    Object.keys(answers).filter(key => /^(dh|base|tool)\./.test(key)).forEach(key => assert.equal(result.fields[key].status, 'correct', key));
    return result;
}

test('reference chain matches the actual URDF using independent quaternion FK', () => {
    const reference = checker.referenceAnswers();
    const poses = [Array(7).fill(0), [0.3, -0.4, 0.5, -0.6, 0.7, -0.8, 0.9]];
    for (let i = 1; i <= 30; i += 1) poses.push(Array.from({ length: 7 }, (_, j) => 1.8 * Math.sin(i * (j + 1) * 0.713)));
    for (const q of poses) {
        const expected = independentUrdfFK(q);
        assertMatrixClose(checker.referenceForwardKinematics(q), expected);
        assertMatrixClose(checker.evaluateDhForwardKinematics(reference, q), expected);
    }
    const result = assertChainAccepted(reference);
    assert.equal(result.summary.correct, 170);
    assert.equal(result.summary.unanswered, 0);
    assert.equal(result.summary.total, 170);
    assert.ok(result.fk.maxPositionError < 2e-12);
    assert.ok(result.fk.maxRotationError < 2e-12);
});

test('a wrong DH cell is identified as a reference difference and the chain fails', () => {
    const answers = checker.referenceAnswers(); answers['dh.3.d'] = '0.41';
    const result = checker.evaluate(answers);
    assert.equal(result.fk.status, 'incorrect');
    assert.ok(result.fk.maxPositionError > 0.009);
    assert.equal(result.fields['dh.3.d'].status, 'incorrect');
    assert.match(result.fields['dh.3.d'].message, /does not identify the source/);
    assert.equal(result.fields['dh.2.d'].status, 'correct');
});

test('periodic DH angles and explicit pi expressions are accepted', () => {
    const answers = checker.referenceAnswers();
    answers['dh.1.alpha'] = '-pi/2 + 2*pi';
    answers['dh.5.alpha'] = '−π/2';
    answers['dh.4.thetaOffset'] = '-4*pi';
    answers['dh.1.d'] = '(15 + 19)/100';
    assertChainAccepted(answers);
});

test('alternative base and tool frames pass through complete-chain equivalence', () => {
    const answers = checker.referenceAnswers();
    answers['base.yaw'] = '0.37'; answers['dh.1.thetaOffset'] = '-0.37';
    answers['base.z'] = '0.12'; answers['dh.1.d'] = '0.22';
    answers['dh.7.thetaOffset'] = '0.41'; answers['tool.yaw'] = '-0.41';
    answers['dh.7.d'] = '0.1'; answers['tool.z'] = '0.026';
    assertChainAccepted(answers);
    const rotatedLastFrame = checker.referenceAnswers();
    rotatedLastFrame['dh.7.alpha'] = '0.45'; rotatedLastFrame['tool.roll'] = '-0.45';
    // Translate along the same physical flange axis in the rotated DH7 frame.
    rotatedLastFrame['tool.y'] = String(0.045 * Math.sin(0.45));
    rotatedLastFrame['tool.z'] = String(0.045 * Math.cos(0.45));
    assertChainAccepted(rotatedLastFrame);
});

test('an alternative internal DH frame assignment is accepted', () => {
    const answers = checker.referenceAnswers();
    answers['dh.3.thetaOffset'] = 'pi'; answers['dh.3.alpha'] = '-pi/2';
    answers['dh.4.thetaOffset'] = '-pi';
    assertChainAccepted(answers);
});

test('matching home alone cannot conceal an incorrect DH twist', () => {
    const answers = checker.referenceAnswers();
    answers['dh.1.alpha'] = String(-Math.PI / 2 + 0.25);
    answers['tool.roll'] = '-0.25';
    const home = Array(7).fill(0);
    const actual = checker.evaluateDhForwardKinematics(answers, home);
    const expected = checker.referenceForwardKinematics(home);
    ['x', 'y', 'z'].forEach((column, i) => { answers[`base.${column}`] = String(expected[4 * i + 3] - actual[4 * i + 3]); });
    assertMatrixClose(checker.evaluateDhForwardKinematics(answers, home), expected);
    const result = checker.evaluate(answers);
    assert.equal(result.fk.status, 'incorrect');
    assert.ok(result.fk.maxPositionError > 0.01);
    assert.ok(result.fk.maxRotationError > 0.01);
});

test('blank entries remain unanswered and do not become numeric zero', () => {
    const empty = checker.evaluate({});
    assert.equal(empty.summary.unanswered, 170);
    assert.equal(empty.fk.status, 'unanswered');
    assert.equal(empty.fk.testCount, 0);
    assert.equal(empty.fk.maxPositionError, null);
    const answers = checker.referenceAnswers(); answers['dh.2.d'] = '   ';
    const result = checker.evaluate(answers);
    assert.equal(result.fields['dh.2.d'].status, 'unanswered');
    assert.equal(result.fk.status, 'unanswered');
});

test('arithmetic parser supports precedence, unary signs, decimal exponents and pi', () => {
    const cases = [['2 + 3*4', 14], ['(2+3)*4', 20], ['-(-pi / 2)', Math.PI / 2],
        ['1e-3 + .002', 0.003], ['2*pi/4', Math.PI / 2], ['  PI  ', Math.PI], ['−π', -Math.PI], ['1.', 1]];
    for (const [expression, expected] of cases) {
        const result = checker.parseNumber(expression);
        assert.equal(result.status, 'valid', expression);
        assert.ok(Math.abs(result.value - expected) < 1e-12, expression);
    }
});

test('malicious text, nonfinite expressions and excessive nesting are rejected', () => {
    globalThis.exercise01Injected = false;
    const invalid = ['globalThis.exercise01Injected = true', '(()=>{globalThis.exercise01Injected=true})()',
        'process.exit()', 'Math.PI', 'Infinity', 'NaN', '1/0', '0/0', '1e309', '1e300*1e300',
        '2pi', 'pi**2', '0x20', '1;2', '1,2', '<img onerror=alert(1)>', '(', '1+',
        '('.repeat(25) + '1' + ')'.repeat(25), '1'.repeat(161), {}, [], true, Infinity];
    for (const value of invalid) assert.equal(checker.parseNumber(value).status, 'invalid', String(value));
    assert.equal(globalThis.exercise01Injected, false);
    delete globalThis.exercise01Injected;
    const answers = checker.referenceAnswers(); answers['dh.1.alpha'] = '1/0';
    const result = checker.evaluate(answers);
    assert.equal(result.fields['dh.1.alpha'].status, 'invalid');
    assert.equal(result.fk.status, 'invalid');
    assert.equal(result.fk.testCount, 0);
});

test('visual translations match the reference XML, independently of inertial origins', () => {
    const answers = checker.referenceAnswers();
    for (let i = 0; i <= 7; i += 1) {
        const link = urdf.match(new RegExp(`<link\\s+name="iiwa_link_${i}"[\\s\\S]*?<\\/link>`))[0];
        const visualOrigin = link.match(/<visual>[\s\S]*?<origin\s+([^>]+)\/?\s*>/)[1];
        for (const [attribute, columns] of [['xyz', ['x', 'y', 'z']], ['rpy', ['roll', 'pitch', 'yaw']]]) {
            const expected = visualOrigin.match(new RegExp(`${attribute}="([^"]+)"`))[1].trim().split(/\s+/).map(Number);
            columns.forEach((column, j) => assert.equal(Number(answers[`visual.${i}.${column}`]), expected[j]));
        }
    }
    answers['visual.3.z'] = '0';
    const result = checker.evaluate(answers);
    assert.equal(result.fields['visual.3.z'].status, 'incorrect');
    assert.equal(result.fields['visual.5.z'].status, 'correct');
    assert.equal(result.fk.status, 'correct', 'visual registration does not change joint FK');
});

test('equivalent visual RPY rotations are accepted, including nonperiodic Euler alternatives', () => {
    const answers = checker.referenceAnswers();
    answers['visual.1.roll'] = '2*pi';
    ['roll', 'pitch', 'yaw'].forEach(column => { answers[`visual.2.${column}`] = 'pi'; });
    answers['visual.2.x'] = '0.01';
    const result = checker.evaluate(answers);
    assert.equal(result.fields['visual.1.roll'].status, 'correct');
    ['roll', 'pitch', 'yaw'].forEach(column => assert.equal(result.fields[`visual.2.${column}`].status, 'correct'));
    assert.equal(result.fields['visual.2.x'].status, 'incorrect');
    answers['visual.2.yaw'] = 'pi + 0.1';
    assert.equal(checker.evaluate(answers).fields['visual.2.yaw'].status, 'incorrect');
});

test('obsolete notes and self-reported residuals are outside the verifiable schema', () => {
    const answers = checker.referenceAnswers();
    assert.equal(Object.keys(answers).length, 170);
    assert.equal(Object.keys(answers).filter(key => key.startsWith('fk.')).length, 80);
    const oldKeys = ['frame.1', 'frameConvention', 'finalExplanation', 'residual.position', 'residual.orientation'];
    oldKeys.forEach(key => assert.equal(Object.prototype.hasOwnProperty.call(answers, key), false));
    answers['frame.1'] = 'I used the common normal.';
    answers.frameConvention = 'Standard DH'; answers.finalExplanation = 'See my annotated views.';
    answers['residual.position'] = '0'; answers['residual.orientation'] = '1e-12';
    const result = checker.evaluate(answers);
    oldKeys.forEach(key => assert.equal(Object.prototype.hasOwnProperty.call(result.fields, key), false));
    assert.deepEqual(result.summary, { correct: 170, incorrect: 0, unanswered: 0, invalid: 0, total: 170 });
});

test('five named matrix poses match the prescribed configurations and independent URDF FK', () => {
    const expectedPoses = {
        home: [0, 0, 0, 0, 0, 0, 0],
        bent: [0, Math.PI / 4, 0, -Math.PI / 2, 0, Math.PI / 4, 0],
        bent_back: [0, -Math.PI / 4, 0, Math.PI / 2, 0, -Math.PI / 4, 0],
        side_reach: [Math.PI / 2, Math.PI / 4, 0, -Math.PI / 2, 0, Math.PI / 4, 0],
        wrist_turn: [0, Math.PI / 4, 0, -Math.PI / 2, 0, Math.PI / 4, Math.PI / 2]
    };
    assert.deepEqual(checker.poses, expectedPoses);
    const answers = checker.referenceAnswers();
    for (const [name, q] of Object.entries(expectedPoses)) {
        const expected = independentUrdfFK(q);
        expected.forEach((value, index) => {
            const key = `fk.${name}.${Math.floor(index / 4) + 1}.${index % 4 + 1}`;
            assert.ok(Math.abs(Number(answers[key]) - value) < 2e-12, key);
            // Six-decimal matrix entries from an independent implementation.
            answers[key] = value.toFixed(6);
        });
    }
    assert.equal(checker.evaluate(answers).summary.correct, 170);
    assert.ok(Object.isFrozen(checker.poses));
    assert.ok(Object.isFrozen(checker.poses.bent));
    assert.throws(() => { checker.poses.bent[1] = 0; }, TypeError);
    assert.throws(() => { checker.poses.extra = []; }, TypeError);
});

test('matrix checks distinguish translation, rotation and homogeneous-row mistakes', () => {
    const answers = checker.referenceAnswers();
    answers['fk.home.3.4'] = String(Number(answers['fk.home.3.4']) + 0.01);
    answers['fk.side_reach.1.2'] = String(Number(answers['fk.side_reach.1.2']) + 0.01);
    answers['fk.bent.4.4'] = '0';
    const result = checker.evaluate(answers);
    for (const [key, hint] of [['fk.home.3.4', /translation/], ['fk.side_reach.1.2', /rotation-block/], ['fk.bent.4.4', /homogeneous bottom row/]]) {
        assert.equal(result.fields[key].status, 'incorrect');
        assert.match(result.fields[key].message, hint);
        assert.doesNotMatch(result.fields[key].message, /\d/, 'feedback does not reveal numeric answers');
    }
    assert.equal(result.fields['fk.home.1.1'].status, 'correct');
    assert.equal(result.fk.status, 'correct', 'matrix answers do not modify the DH-chain equivalence check');
    assert.equal(result.summary.incorrect, 3);
});

test('matrix answers are checked against the URDF even if the DH chain is wrong', () => {
    const answers = checker.referenceAnswers();
    answers['tool.z'] = '0.09';
    let result = checker.evaluate(answers);
    assert.equal(result.fk.status, 'incorrect');
    Object.keys(answers).filter(key => key.startsWith('fk.')).forEach(key => assert.equal(result.fields[key].status, 'correct', key));
    const wrongHome = checker.evaluateDhForwardKinematics(answers, checker.poses.home);
    wrongHome.forEach((value, index) => { answers[`fk.home.${Math.floor(index / 4) + 1}.${index % 4 + 1}`] = String(value); });
    result = checker.evaluate(answers);
    assert.equal(result.fields['fk.home.3.4'].status, 'incorrect', 'self-consistency with an incorrect chain is not credited');
    assert.equal(result.fields['fk.bent.3.4'].status, 'correct');
});

test('matrix cells use absolute tolerances and the safe parser', () => {
    const answers = checker.referenceAnswers();
    const near = 'fk.home.1.1', far = 'fk.home.2.2';
    answers[near] = String(Number(answers[near]) + 0.9 * checker.tolerances.matrixCell);
    answers[far] = String(Number(answers[far]) + 1.1 * checker.tolerances.matrixCell);
    answers['fk.home.1.4'] = ' '; answers['fk.home.2.4'] = '1/0';
    answers['fk.home.3.3'] = '1+2*pi';
    const result = checker.evaluate(answers);
    assert.equal(result.fields[near].status, 'correct');
    assert.equal(result.fields[far].status, 'incorrect');
    assert.equal(result.fields['fk.home.1.4'].status, 'unanswered');
    assert.equal(result.fields['fk.home.2.4'].status, 'invalid');
    assert.equal(result.fields['fk.home.3.3'].status, 'incorrect', 'matrix entries are not periodic angles');
});

test('concept choices are automatically checked without manual review', () => {
    const answers = checker.referenceAnswers();
    assert.equal(answers['concept.visualChangesFK'], 'no');
    assert.equal(answers['concept.jointChangesFK'], 'yes');
    answers['concept.visualChangesFK'] = 'yes'; answers['concept.jointChangesFK'] = 'no';
    let result = checker.evaluate(answers);
    assert.equal(result.fields['concept.visualChangesFK'].status, 'incorrect');
    assert.equal(result.fields['concept.jointChangesFK'].status, 'incorrect');
    answers['concept.visualChangesFK'] = ''; answers['concept.jointChangesFK'] = 'maybe';
    result = checker.evaluate(answers);
    assert.equal(result.fields['concept.visualChangesFK'].status, 'unanswered');
    assert.equal(result.fields['concept.jointChangesFK'].status, 'invalid');
    answers['concept.visualChangesFK'] = ' NO '; answers['concept.jointChangesFK'] = 'YES';
    result = checker.evaluate(answers);
    assert.equal(result.fields['concept.visualChangesFK'].status, 'correct');
    assert.equal(result.fields['concept.jointChangesFK'].status, 'correct');
});

test('Node fixtures are fresh and the browser global exposes no answer-key helpers', () => {
    const one = checker.referenceAnswers(); one['dh.1.d'] = '99';
    assert.equal(checker.referenceAnswers()['dh.1.d'], '0.34');
    const sandbox = {};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../solutions/js/exercise-01-checker.js'), 'utf8'), sandbox);
    assert.equal(sandbox.Exercise01Checker.referenceAnswers, undefined);
    assert.equal(sandbox.Exercise01Checker.referenceForwardKinematics, undefined);
    assert.deepEqual(Object.keys(sandbox.Exercise01Checker).sort(), ['evaluate', 'evaluateDhForwardKinematics', 'parseNumber', 'poses', 'tolerances']);
    const result = sandbox.Exercise01Checker.evaluate(checker.referenceAnswers());
    assert.equal(result.fk.status, 'correct');
    assert.equal(result.summary.correct, 170);
});
