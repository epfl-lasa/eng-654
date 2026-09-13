'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const checker = require('../solutions/js/exercise-01-checker.js');

const urdf = fs.readFileSync(path.join(__dirname, '../assets/models/iiwa7/iiwa7.urdf'), 'utf8');
const misalignedUrdf = fs.readFileSync(path.join(__dirname, '../assets/models/iiwa7/kuka_iiwa7_misaligned.urdf'), 'utf8');
const visualColumns = ['x', 'y', 'z', 'roll', 'pitch', 'yaw'];
const screwColumns = ['wx', 'wy', 'wz', 'vx', 'vy', 'vz'];
function visualOrigin(source, index) {
    const link = source.match(new RegExp(`<link\\s+name="iiwa_link_${index}"[\\s\\S]*?<\\/link>`))[0];
    const origin = link.match(/<visual>[\s\S]*?<origin\s+([^>]+)\/?\s*>/)[1];
    return ['xyz', 'rpy'].flatMap(attribute => origin.match(new RegExp(`${attribute}="([^"]+)"`))[1].trim().split(/\s+/).map(Number));
}
function jointOrigin(name, source = urdf) {
    const block = source.match(new RegExp(`<joint\\s+name="${name}"[\\s\\S]*?<\\/joint>`));
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
function independentUrdfScrews(source) {
    let point = [0, 0, 0], rotation = [1, 0, 0, 0];
    function apply(xyz, rpy) {
        const translation = rotate(rotation, xyz);
        point = point.map((value, i) => value + translation[i]);
        rotation = quaternionProduct(rotation,
            quaternionProduct(quaternionProduct(axisQuaternion(2, rpy[2]), axisQuaternion(1, rpy[1])), axisQuaternion(0, rpy[0])));
    }
    apply(...jointOrigin('world_iiwa_joint', source));
    return Array.from({ length: 7 }, (_, i) => {
        const name = `iiwa_joint_${i + 1}`;
        apply(...jointOrigin(name, source));
        const block = source.match(new RegExp(`<joint\\s+name="${name}"[\\s\\S]*?<\\/joint>`))[0];
        const axis = block.match(/<axis\s+xyz="([^"]+)"/)[1].trim().split(/\s+/).map(Number);
        const omega = rotate(rotation, axis);
        return omega.concat([omega[2] * point[1] - omega[1] * point[2],
            omega[0] * point[2] - omega[2] * point[0], omega[1] * point[0] - omega[0] * point[1]]);
    });
}
function assertMatrixClose(a, b, tolerance = 2e-12) {
    a.forEach((value, i) => assert.ok(Math.abs(value - b[i]) < tolerance, `matrix entry ${i}: ${value} versus ${b[i]}`));
}
function setFixedTransform(answers, prefix, translation = [0, 0, 0], rpy = [0, 0, 0], decimals) {
    // Build independent matrix fixtures from quaternion-rotated basis vectors.
    const rotation = quaternionProduct(quaternionProduct(axisQuaternion(2, rpy[2]), axisQuaternion(1, rpy[1])), axisQuaternion(0, rpy[0]));
    const columns = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map(axis => rotate(rotation, axis));
    for (let row = 1; row <= 4; row += 1) for (let column = 1; column <= 4; column += 1) {
        const value = row === 4 ? Number(column === 4) : column === 4 ? translation[row - 1] : columns[column - 1][row - 1];
        answers[`${prefix}.${row}.${column}`] = decimals === undefined ? String(value) : value.toFixed(decimals);
    }
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
        assertMatrixClose(checker.evaluatePoeForwardKinematics(reference, q), expected);
    }
    const result = assertChainAccepted(reference);
    assert.equal(result.summary.correct, 248);
    assert.equal(result.summary.unanswered, 0);
    assert.equal(result.summary.total, 248);
    assert.ok(result.fk.maxPositionError < 2e-12);
    assert.ok(result.fk.maxRotationError < 2e-12);
    assert.equal(result.poe.status, 'correct');
    assert.equal(result.poe.testCount, 26);
    assert.ok(result.poe.maxPositionError < 2e-12);
    assert.ok(result.poe.maxRotationError < 2e-12);
});

test('space screws and home matrix follow the actual URDF joint axes and zero configuration', () => {
    const answers = checker.referenceAnswers();
    const expected = [[0, 0, 1, 0, 0, 0], [0, 1, 0, -0.34, 0, 0], [0, 0, 1, 0, 0, 0],
        [0, -1, 0, 0.74, 0, 0], [0, 0, 1, 0, 0, 0], [0, 1, 0, -1.14, 0, 0], [0, 0, 1, 0, 0, 0]];
    for (const source of [urdf, misalignedUrdf]) {
        independentUrdfScrews(source).forEach((screw, index) => {
            assertMatrixClose(screw, expected[index]);
            screwColumns.forEach((column, component) => {
                const key = `poe.${index + 1}.${column}`;
                assert.ok(Math.abs(Number(answers[key]) - screw[component]) < 2e-12, key);
                answers[key] = screw[component].toFixed(6);
            });
        });
    }
    const home = independentUrdfFK(Array(7).fill(0));
    assertMatrixClose(home, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1.266, 0, 0, 0, 1]);
    home.forEach((value, index) => {
        const key = `poe.M.${Math.floor(index / 4) + 1}.${index % 4 + 1}`;
        assert.ok(Math.abs(Number(answers[key]) - value) < 2e-12, key);
        answers[key] = value.toFixed(6);
    });
    assert.equal(checker.evaluate(answers).summary.correct, 248, 'six-decimal URDF-derived PoE entries pass');
});

test('PoE exponentials preserve the URDF joint signs and multiplication order', () => {
    const answers = checker.referenceAnswers();
    for (const [joint, sign, x, z] of [[1, 1, 0.926, 0.34], [3, -1, -0.526, 0.74], [5, 1, 0.126, 1.14]]) {
        const q = Array(7).fill(0); q[joint] = Math.PI / 2;
        assertMatrixClose(checker.evaluatePoeForwardKinematics(answers, q),
            [0, 0, sign, x, 0, 1, 0, 0, -sign, 0, 0, z, 0, 0, 0, 1]);
    }
    const q = [Math.PI / 2, Math.PI / 2, 0, 0, 0, 0, 0];
    assertMatrixClose(checker.evaluatePoeForwardKinematics(answers, q),
        [0, -1, 0, 0, 0, 0, 1, 0.926, -1, 0, 0, 0.34, 0, 0, 0, 1]);
});

test('wrong screw direction, moment sign and row order are rejected independently of DH', () => {
    const edits = [
        answers => screwColumns.forEach(column => { answers[`poe.2.${column}`] = String(-Number(answers[`poe.2.${column}`])); }),
        answers => { answers['poe.2.vx'] = '0.34'; },
        answers => {
            const second = screwColumns.map(column => answers[`poe.2.${column}`]);
            screwColumns.forEach((column, i) => {
                answers[`poe.2.${column}`] = answers[`poe.4.${column}`];
                answers[`poe.4.${column}`] = second[i];
            });
        },
        answers => {
            [1, 0, 0, 0, 0.34, 0].forEach((value, i) => { answers[`poe.2.${screwColumns[i]}`] = String(value); });
        }
    ];
    for (const edit of edits) {
        const answers = checker.referenceAnswers(); edit(answers);
        const result = checker.evaluate(answers);
        assert.equal(result.poe.status, 'incorrect');
        assert.equal(result.poe.testCount, 26);
        assert.ok(result.poe.maxPositionError > 0.01 || result.poe.maxRotationError > 0.01);
        assert.equal(result.fk.status, 'correct');
        assert.equal(result.poseChecks.home.poe.status, 'correct', 'home alone cannot verify screws');
        assert.equal(result.poseChecks.bent.poe.status, 'incorrect');
        assert.equal(result.poseChecks.bent.dh.status, 'correct');
    }
});

test('PoE entries retain strict reference checks when FK residuals happen to fit the tolerance', () => {
    const answers = checker.referenceAnswers();
    answers['poe.2.vx'] = String(Number(answers['poe.2.vx']) + 2 * checker.tolerances.screwCell);
    const result = checker.evaluate(answers);
    assert.ok(result.poe.maxPositionError < checker.tolerances.position);
    assert.ok(result.poe.maxRotationError < checker.tolerances.rotation);
    assert.equal(result.fields['poe.2.vx'].status, 'incorrect');
    assert.equal(result.poe.status, 'incorrect');
    assert.match(result.poe.message, /model entry differs/);
    answers['poe.2.vx'] = '-0.34 + 2*pi';
    assert.equal(checker.evaluate(answers).fields['poe.2.vx'].status, 'incorrect', 'screw components are not periodic angles');
});

test('PoE rejects nonunit angular vectors, nonzero pitch and malformed home transforms', () => {
    const cases = [
        { key: 'poe.1.wz', value: '0', hint: /unit angular/ },
        { key: 'poe.2.wy', value: '2', hint: /unit angular/ },
        { key: 'poe.1.vz', value: '0.1', hint: /zero pitch/ },
        { key: 'poe.M.4.4', value: '0', hint: /homogeneous bottom row/ },
        { key: 'poe.M.1.1', value: '2', hint: /orthonormal/ },
        { key: 'poe.M.1.2', value: '0.1', hint: /orthonormal/ },
        { key: 'poe.M.3.3', value: '-1', hint: /determinant/ }
    ];
    for (const { key, value, hint } of cases) {
        const answers = checker.referenceAnswers(); answers[key] = value;
        const result = checker.evaluate(answers);
        assert.equal(result.fields[key].status, 'invalid', key);
        assert.match(result.fields[key].message, hint);
        assert.equal(result.poe.status, 'invalid');
        assert.equal(result.poe.testCount, 0);
        assert.equal(result.fk.status, 'correct');
        assert.deepEqual(result.poseChecks.home.poe, { status: 'invalid', positionError: null, rotationError: null });
        assert.throws(() => checker.evaluatePoeForwardKinematics(answers, checker.poses.home), /Invalid (screw|PoE home matrix)/);
    }
});

test('the PoE home matrix includes the fixed tool frame and must use the world frame', () => {
    const answers = checker.referenceAnswers(); answers['poe.M.3.4'] = '1.221';
    let result = checker.evaluate(answers);
    assert.equal(result.poe.status, 'incorrect');
    assert.equal(result.fields['poe.M.3.4'].status, 'incorrect');
    assert.ok(Math.abs(result.poseChecks.home.poe.positionError - 0.045) < 2e-12);
    setFixedTransform(answers, 'poe.M', [0, 0, 1.266], [0, 0, Math.PI / 2]);
    result = checker.evaluate(answers);
    assert.equal(result.poe.status, 'incorrect');
    assert.ok(Math.abs(result.poseChecks.home.poe.rotationError - Math.PI / 2) < 2e-12);
});

test('all five named pose checks are independent of manually entered FK matrices and visual repairs', () => {
    const answers = checker.referenceAnswers();
    answers['fk.home.1.1'] = '99'; answers['visual.1.roll'] = '0';
    let result = checker.evaluate(answers);
    assert.deepEqual(Object.keys(result.poseChecks), Object.keys(checker.poses));
    for (const [name, q] of Object.entries(checker.poses)) {
        for (const method of ['dh', 'poe']) {
            assert.equal(result.poseChecks[name][method].status, 'correct');
            assert.ok(result.poseChecks[name][method].positionError < 2e-12);
            assert.ok(result.poseChecks[name][method].rotationError < 2e-12);
        }
        assertMatrixClose(checker.evaluatePoeForwardKinematics(answers, q), independentUrdfFK(q));
    }
    answers['dh.3.d'] = '0.41';
    result = checker.evaluate(answers);
    for (const name of Object.keys(checker.poses)) {
        assert.equal(result.poseChecks[name].dh.status, 'incorrect');
        assert.equal(result.poseChecks[name].poe.status, 'correct');
    }
});

test('missing or invalid PoE inputs do not block DH and invalid configurations are rejected', () => {
    const answers = checker.referenceAnswers(); answers['poe.M.4.4'] = '';
    let result = checker.evaluate(answers);
    assert.equal(result.poe.status, 'unanswered');
    assert.equal(result.poe.testCount, 0);
    assert.equal(result.fk.status, 'correct');
    assert.deepEqual(result.poseChecks.bent.poe, { status: 'unanswered', positionError: null, rotationError: null });
    assert.throws(() => checker.evaluatePoeForwardKinematics(answers, checker.poses.home), /poe.M.4.4/);
    answers['poe.M.4.4'] = '1'; answers['poe.1.wz'] = '1/0';
    result = checker.evaluate(answers);
    assert.equal(result.poe.status, 'invalid');
    assert.equal(result.fields['poe.1.wz'].status, 'invalid');
    const complete = checker.referenceAnswers(); complete['dh.1.d'] = '';
    result = checker.evaluate(complete);
    assert.equal(result.poe.status, 'correct');
    assert.deepEqual(result.poseChecks.home.dh, { status: 'unanswered', positionError: null, rotationError: null });
    for (const q of [[], [0, 0, 0, 0, 0, 0, NaN], [0, 0, 0, 0, 0, 0, Infinity], '0']) {
        assert.throws(() => checker.evaluatePoeForwardKinematics(checker.referenceAnswers(), q), /seven finite joint angles/);
    }
});

test('finite PoE inputs that overflow the FK computation are reported as invalid', () => {
    const answers = checker.referenceAnswers(); answers['poe.1.vx'] = '1e308';
    const result = checker.evaluate(answers);
    assert.equal(result.poe.status, 'invalid');
    assert.match(result.poe.message, /overflow/);
    assert.equal(result.poe.maxPositionError, null);
    assert.equal(result.poe.maxRotationError, null);
    assert.equal(result.fk.status, 'correct');
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
    setFixedTransform(answers, 'base', [0, 0, 0.12], [0, 0, 0.37]);
    answers['dh.1.thetaOffset'] = '-0.37'; answers['dh.1.d'] = '0.22';
    setFixedTransform(answers, 'tool', [0, 0, 0.026], [0, 0, -0.41]);
    answers['dh.7.thetaOffset'] = '0.41'; answers['dh.7.d'] = '0.1';
    assertChainAccepted(answers);
    const rotatedLastFrame = checker.referenceAnswers();
    rotatedLastFrame['dh.7.alpha'] = '0.45';
    // Translate along the same physical flange axis in the rotated DH7 frame.
    setFixedTransform(rotatedLastFrame, 'tool', [0, 0.045 * Math.sin(0.45), 0.045 * Math.cos(0.45)], [-0.45, 0, 0]);
    assertChainAccepted(rotatedLastFrame);
});

test('six-decimal alternative fixed matrices retain valid rigid transforms and FK equivalence', () => {
    const answers = checker.referenceAnswers();
    setFixedTransform(answers, 'base', [0, 0, 0.12], [0, 0, 0.37], 6);
    answers['dh.1.thetaOffset'] = '-0.37'; answers['dh.1.d'] = '0.22';
    answers['dh.7.alpha'] = '0.45';
    setFixedTransform(answers, 'tool', [0, 0.045 * Math.sin(0.45), 0.045 * Math.cos(0.45)], [-0.45, 0, 0], 6);
    assertChainAccepted(answers);
});

test('invalid fixed matrix bottom rows, scaling, shear and reflections cannot pass FK', () => {
    const cases = [
        { key: 'base.4.4', value: '0', hint: /homogeneous bottom row/ },
        { key: 'tool.4.1', value: '0.01', hint: /homogeneous bottom row/ },
        { key: 'tool.1.1', value: '2', hint: /orthonormal/ },
        { key: 'base.1.2', value: '0.1', hint: /orthonormal/ },
        { key: 'tool.3.3', value: '-1', hint: /determinant/ },
        { key: 'base.1.1', value: '1e300', hint: /orthonormal/ }
    ];
    for (const { key, value, hint } of cases) {
        const answers = checker.referenceAnswers();
        answers[key] = value;
        const result = checker.evaluate(answers);
        assert.equal(result.fk.status, 'invalid', key);
        assert.equal(result.fk.testCount, 0, key);
        assert.equal(result.fields[key].status, 'invalid', key);
        assert.match(result.fields[key].message, hint);
        assert.throws(() => checker.evaluateDhForwardKinematics(answers, checker.poses.home), /Invalid (base|tool) matrix/);
        assert.equal(result.fields['fk.home.1.1'].status, 'correct', 'independent tool-pose responses remain verifiable');
    }
});

test('invalid fixed matrices are reported even while the DH table is incomplete', () => {
    const answers = checker.referenceAnswers();
    answers['dh.1.d'] = '';
    answers['base.4.4'] = '2';
    const result = checker.evaluate(answers);
    assert.equal(result.fields['dh.1.d'].status, 'unanswered');
    assert.equal(result.fields['base.4.4'].status, 'invalid');
    assert.equal(result.fk.status, 'invalid');
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
    setFixedTransform(answers, 'tool', [0, 0, 0.045], [-0.25, 0, 0]);
    const home = Array(7).fill(0);
    const actual = checker.evaluateDhForwardKinematics(answers, home);
    const expected = checker.referenceForwardKinematics(home);
    for (let row = 1; row <= 3; row += 1) answers[`base.${row}.4`] = String(expected[4 * row - 1] - actual[4 * row - 1]);
    assertMatrixClose(checker.evaluateDhForwardKinematics(answers, home), expected);
    const result = checker.evaluate(answers);
    assert.equal(result.fk.status, 'incorrect');
    assert.ok(result.fk.maxPositionError > 0.01);
    assert.ok(result.fk.maxRotationError > 0.01);
});

test('blank entries remain unanswered and do not become numeric zero', () => {
    const empty = checker.evaluate({});
    assert.equal(empty.summary.unanswered, 248);
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

test('visual corrections equal clean minus supplied origins from the two XML files', () => {
    const answers = checker.referenceAnswers();
    for (let i = 0; i <= 7; i += 1) {
        const repaired = visualOrigin(urdf, i), initial = visualOrigin(misalignedUrdf, i);
        visualColumns.forEach((column, j) => assert.equal(Number(answers[`visual.${i}.${column}`]), repaired[j] - initial[j]));
    }
    assert.equal(Number(answers['visual.1.z']), 0.015, 'translation correction includes the original sign flip');
    assert.equal(Number(answers['visual.3.z']), -0.052);
    assert.equal(Number(answers['visual.7.z']), -0.001);
    assert.equal(Number(answers['visual.1.roll']), -Math.PI / 2);
    assert.equal(checker.evaluate(answers).summary.correct, 248);
    answers['visual.3.z'] = '0';
    const result = checker.evaluate(answers);
    assert.equal(result.fields['visual.3.z'].status, 'incorrect');
    assert.match(result.fields['visual.3.z'].message, /correction/);
    assert.equal(result.fields['visual.5.z'].status, 'correct');
    assert.equal(result.fk.status, 'correct', 'visual corrections do not change joint FK');
});

test('zero corrections pass unchanged visual origins and fail components that need repair', () => {
    const answers = checker.referenceAnswers();
    for (let i = 0; i <= 7; i += 1) visualColumns.forEach(column => { answers[`visual.${i}.${column}`] = '0'; });
    const result = checker.evaluate(answers);
    for (const index of [0, 4, 6]) visualColumns.forEach(column => {
        assert.equal(result.fields[`visual.${index}.${column}`].status, 'correct');
    });
    for (const key of ['visual.1.z', 'visual.1.roll', 'visual.2.pitch', 'visual.3.z', 'visual.3.yaw', 'visual.5.z', 'visual.5.roll', 'visual.7.z', 'visual.7.yaw']) {
        assert.equal(result.fields[key].status, 'incorrect', key);
    }
    assert.equal(result.fk.status, 'correct');
});

test('absolute repaired values and corrections with reversed signs fail changed visual components', () => {
    for (const mode of ['absolute', 'reversed']) {
        const answers = checker.referenceAnswers();
        for (const index of [1, 2, 3, 5, 7]) {
            const repaired = visualOrigin(urdf, index), initial = visualOrigin(misalignedUrdf, index);
            visualColumns.forEach((column, component) => {
                answers[`visual.${index}.${column}`] = String(mode === 'absolute' ? repaired[component] : initial[component] - repaired[component]);
            });
        }
        const result = checker.evaluate(answers);
        for (const key of ['visual.1.z', 'visual.1.roll', 'visual.2.pitch', 'visual.3.z', 'visual.3.yaw', 'visual.5.z', 'visual.5.roll', 'visual.7.z', 'visual.7.yaw']) {
            assert.equal(result.fields[key].status, 'incorrect', `${mode}: ${key}`);
        }
        assert.equal(result.fk.status, 'correct');
    }
});

test('RPY corrections accept equivalent repaired Euler rotations after adding the initial values', () => {
    const answers = checker.referenceAnswers();
    answers['visual.1.roll'] = '-pi/2 + 2*pi';
    const initial = visualOrigin(misalignedUrdf, 2);
    ['roll', 'pitch', 'yaw'].forEach((column, component) => { answers[`visual.2.${column}`] = String(Math.PI - initial[component + 3]); });
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
    assert.equal(Object.keys(answers).length, 248);
    assert.equal(Object.keys(answers).filter(key => key.startsWith('fk.')).length, 80);
    const oldKeys = ['frame.1', 'frameConvention', 'finalExplanation', 'residual.position', 'residual.orientation'];
    oldKeys.forEach(key => assert.equal(Object.prototype.hasOwnProperty.call(answers, key), false));
    answers['frame.1'] = 'I used the common normal.';
    answers.frameConvention = 'Standard DH'; answers.finalExplanation = 'See my annotated views.';
    answers['residual.position'] = '0'; answers['residual.orientation'] = '1e-12';
    const result = checker.evaluate(answers);
    oldKeys.forEach(key => assert.equal(Object.prototype.hasOwnProperty.call(result.fields, key), false));
    assert.deepEqual(result.summary, { correct: 248, incorrect: 0, unanswered: 0, invalid: 0, total: 248 });
});

test('five named matrix poses match the prescribed configurations and independent URDF FK', () => {
    const expectedPoses = {
        home: [0, 0, 0, 0, 0, 0, 0],
        bent: [0, Math.PI / 4, 0, -Math.PI / 2, 0, Math.PI / 4, 0],
        bent_back: [0, -Math.PI / 4, 0, Math.PI / 2, 0, -Math.PI / 4, 0],
        side_reach: [Math.PI / 2, Math.PI / 4, 0, -Math.PI / 2, 0, Math.PI / 4, 0],
        wrist_turn: [Math.PI / 6, Math.PI / 4, -Math.PI / 6, -Math.PI / 2, Math.PI / 6, Math.PI / 4, Math.PI / 2]
    };
    assert.deepEqual(checker.poses, expectedPoses);
    assert.ok(checker.poses.wrist_turn.every(angle => Math.abs(angle) > 0), 'the fifth pose exercises every joint, including joints 3 and 5');
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
    assert.equal(checker.evaluate(answers).summary.correct, 248);
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
    answers['tool.3.4'] = '0.09';
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
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/exercises/exercise-01-numbers.js'), 'utf8'), sandbox);
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/exercises/exercise-01-visual-origins.js'), 'utf8'), sandbox);
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../solutions/js/exercise-01-checker.js'), 'utf8'), sandbox);
    assert.equal(sandbox.Exercise01Checker.referenceAnswers, undefined);
    assert.equal(sandbox.Exercise01Checker.referenceForwardKinematics, undefined);
    assert.deepEqual(Object.keys(sandbox.Exercise01Checker).sort(), ['evaluate', 'evaluateDhForwardKinematics', 'evaluatePoeForwardKinematics', 'parseNumber', 'poses', 'tolerances']);
    const result = sandbox.Exercise01Checker.evaluate(checker.referenceAnswers());
    assert.equal(result.fk.status, 'correct');
    assert.equal(result.poe.status, 'correct');
    assert.equal(result.summary.correct, 248);
    assertMatrixClose(sandbox.Exercise01Checker.evaluatePoeForwardKinematics(checker.referenceAnswers(), checker.poses.bent), independentUrdfFK(checker.poses.bent));
});
