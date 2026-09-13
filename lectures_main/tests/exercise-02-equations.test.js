'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const equations = require('../js/exercises/exercise-02-equations.js');

// Independent, non-singular arm configurations exercise both elbow signs and
// both radial signs; fixed link lengths alone must not make a numeric answer pass.
const samples = Array.from({ length: 24 }, (_, i) => {
    const L = .4, U = .4, phi = .5;
    const theta1 = .15 + Math.sin(i * .73), theta2 = (i % 4 < 2 ? 1 : -1) * (.7 + (i % 5) * .17);
    const theta3 = (i % 2 ? 1 : -1) * (.55 + (i % 7) * .2);
    const c1 = Math.cos(theta1), s1 = Math.sin(theta1), c2 = Math.cos(theta2), s2 = Math.sin(theta2);
    const c3 = Math.cos(theta3), s3 = Math.sin(theta3);
    const A = L + U * c3, B = -U * Math.cos(phi) * s3, C = -U * Math.sin(phi) * s3;
    const E = A * s2 + B * c2, z = A * c2 - B * s2;
    const x = c1 * E - s1 * C, y = s1 * E + c1 * C, rho2 = x * x + y * y;
    return { L, U, phi, theta1, theta2, theta3, c1, s1, c2, s2, c3, s3, A, B, C, E, z, x, y,
        rho2, R: rho2 + z * z, sigma3: Math.sign(s3), sigmaE: Math.sign(E) };
});

test('equivalent law-of-cosines rearrangements pass while a single-pose number does not', () => {
    const expected = '(R-L^2-U^2)/(2*L*U)', variables = ['R', 'L', 'U'];
    assert.equal(equations.checkExpression('(R-(L*L+U*U))/(L*U*2)', expected, { samples, variables }), true);
    assert.equal(equations.checkExpression(String(samples[0].c3), expected, { samples, variables }), false);
    assert.equal(equations.checkExpression('(R+L^2-U^2)/(2*L*U)', expected, { samples, variables }), false);
});

test('per-row symbol whitelist rejects the left-hand side and undeclared variables', () => {
    assert.equal(equations.checkExpression('c3', '(R-L^2-U^2)/(2*L*U)', { samples, variables: ['R', 'L', 'U'] }), false);
    assert.equal(equations.checkExpression('cos(theta3)', '(R-L^2-U^2)/(2*L*U)', { samples, variables: ['R', 'L', 'U'] }), false);
});

test('elbow and radial sign blocks are required across both branches', () => {
    assert.equal(equations.checkExpression('sqrt(1-c3*c3)*sigma3', 'sigma3*sqrt(1-c3^2)', { samples }), true);
    assert.equal(equations.checkExpression('sqrt(1-c3^2)', 'sigma3*sqrt(1-c3^2)', { samples }), false);
    assert.equal(equations.checkExpression('sigmaE*(rho2-C*C)^0.5', 'sigmaE*sqrt(rho2-C^2)', { samples }), true);
    assert.equal(equations.checkExpression('sqrt(rho2-C^2)', 'sigmaE*sqrt(rho2-C^2)', { samples }), false);
});

test('Cramer expressions accept commuting terms and reject swapped signs', () => {
    const pairs = [
        ['(E*B+z*A)/(B*B+A*A)', '(B*E+A*z)/(A^2+B^2)'],
        ['(E*A-z*B)/(B*B+A*A)', '(A*E-B*z)/(A^2+B^2)'],
        ['(x*E+y*C)/(C*C+E*E)', '(E*x+C*y)/(E^2+C^2)'],
        ['(y*E-x*C)/(C*C+E*E)', '(E*y-C*x)/(E^2+C^2)']
    ];
    pairs.forEach(([answer, reference]) => assert.equal(equations.checkExpression(answer, reference, { samples }), true));
    assert.equal(equations.checkExpression('(A*E+B*z)/(A^2+B^2)', pairs[1][1], { samples }), false);
    assert.equal(equations.checkExpression('(E*y+C*x)/(E^2+C^2)', pairs[3][1], { samples }), false);
});

test('atan2 convention is checked across signs, allowing equivalent wrapped angles', () => {
    assert.equal(equations.checkExpression('atan2(s3,c3)+2*pi', 'atan2(s3,c3)', { samples, angle: true }), true);
    assert.equal(equations.checkExpression('atan2(c3,s3)', 'atan2(s3,c3)', { samples, angle: true }), false);
    assert.equal(equations.checkExpression('acos(c3)', 'atan2(s3,c3)', { samples, angle: true }), false);
});

test('safe parser rejects executable code, invalid domains, and degenerate sample sets', () => {
    for (const answer of ['globalThis.process.exit()', 'constructor', '(function(){return 1})()', 'sqrt(-1)', '1/0']) {
        assert.equal(equations.checkExpression(answer, 'x', { samples: [{ x: 1 }, { x: 2 }, { x: 3 }] }), false);
    }
    assert.equal(equations.checkExpression('x', 'sqrt(x)', { samples: [{ x: -1 }, { x: -2 }, { x: -3 }] }), false);
    assert.equal(equations.checkExpression('x', 'x', { samples: [{ x: 1 }] }), false);
    assert.equal(equations.checkExpression('x/x', '1', { samples: [{ x: 0 }, { x: 1 }, { x: 2 }] }), false);
    assert.equal(equations.checkExpression('', '1'), false);
});

test('default samples vary symbols independently, with constant expressions handled directly', () => {
    assert.equal(equations.checkExpression('x*x+2*x*y+y*y', '(x+y)^2'), true);
    assert.equal(equations.checkExpression('x+y', 'x*y'), false);
    assert.equal(equations.checkExpression('sqrt(4)', '2'), true);
});

test('tokenization preserves explicit operations and incomplete editable expressions', () => {
    assert.deepEqual(equations.tokenize('sigma3 * sqrt(1 - c3^2)'), ['sigma3', '*', 'sqrt(', '1', '-', 'c3', '^', '2', ')']);
    assert.deepEqual(equations.tokenize('atan2(s3, c3)'), ['atan2(', 's3', ',', 'c3', ')']);
    assert.deepEqual(equations.tokenize('2.4e-3 * (R -'), ['2.4e-3', '*', '(', 'R', '-']);
});
