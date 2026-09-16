const test = require('node:test');
const assert = require('node:assert/strict');
const K = require('../math.js');

const rotation = (axis, angle) => ({ type: 'rotation', params: { axis, angle } });
const translation = vector => ({ type: 'translation', params: { vector } });
const exponential = (omega, v, theta) => ({ type: 'exponential', params: { omega, v, theta } });
function close(actual, expected, tolerance = 1e-9) {
  if (Array.isArray(expected)) {
    assert.equal(actual.length, expected.length);
    expected.forEach((value, i) => close(actual[i], value, tolerance));
  } else assert.ok(Math.abs(actual - expected) < tolerance, `${actual} differs from ${expected}`);
}
const matrix = (block, input = null, bindings = {}, unit = 'rad') => K.numericMatrix(K.computeBlock(block, input, bindings, unit), bindings);

test('safe expressions preserve symbols, respect precedence, and reject executable input', () => {
  close(K.evaluate(K.parse('-2^2 + 2^-2')), -3.75);
  close(K.evaluate(K.parse('sin(pi/2) + sqrt(4) + atan2(1,0)')), 3 + Math.PI / 2);
  close(K.evaluate(K.parse('2^3^2')), 512);
  close(K.evaluate(K.parse('a*cos(theta) + 1e-3'), { a: 2, theta: 'pi/3' }), 1.001);
  assert.deepEqual(K.symbols(K.parse('z + a*sin(theta) + pi')), ['a', 'theta', 'z']);
  assert.throws(() => K.parse('globalThis.alert(1)'));
  assert.throws(() => K.parse('constructor(1)'));
  for (const reserved of ['__proto__', 'constructor', 'prototype']) assert.throws(() => K.parse(reserved), /reserved.*another symbol/);
  assert.throws(() => K.parse('a'.repeat(81)), /80 characters/);
  assert.equal(K.symbols(K.parse('a'.repeat(80)))[0].length, 80);
  assert.throws(() => K.parse('sin(1,2)'));
  assert.throws(() => K.parse('1/0'));
  assert.throws(() => K.parse('sqrt(-1)'));
  assert.throws(() => K.evaluate(K.parse('x')));
  assert.throws(() => K.evaluate(K.parse('x'), { x: '' }));
  assert.throws(() => K.parse('x'.repeat(501)), /shorter/);
  assert.throws(() => K.parse('1+'.repeat(128) + '1'), /complex/);
  assert.equal(K.format(K.parse('0*x + 1*y')), 'y');
  assert.equal(K.format(K.parse('-sin(theta)*-sin(alpha)')), 'sin(theta)·sin(alpha)');
  assert.equal(K.format(K.parse('-a*b')), '−(a·b)');
  assert.equal(K.format(K.parse('-2*-a')), '2·a');
  close(K.evaluate(K.parse('-a * -b'), { a: -2, b: 3 }), -6);
  assert.equal(K.evaluate(K.parse('1e-15')), 1e-15);
});

test('cardinal rotations remain compact and symbols are not replaced by bindings', () => {
  const value = K.computeBlock(rotation(['0', '0', '2'], 'theta'), null, { theta: 1 });
  assert.equal(K.format(value.matrix[0][0]), 'cos(theta)');
  assert.deepEqual(K.getSymbols(value), ['theta']);
  close(K.numericMatrix(value, { theta: Math.PI / 2 }), [[0, -1, 0], [1, 0, 0], [0, 0, 1]]);
  close(matrix(rotation(['1', '0', '0'], '90'), null, {}, 'deg'), [[1, 0, 0], [0, 0, -1], [0, 1, 0]]);
  close(matrix(rotation(['0', '1', '0'], 'q'), null, { q: 90 }, 'deg'), [[0, 0, 1], [0, 1, 0], [-1, 0, 0]]);
  assert.throws(() => K.computeBlock(rotation(['0', '0', '0'], '1')));
  assert.throws(() => K.computeBlock(rotation(['u', 'v', 'w'], '1'), null, { u: 0, v: 0, w: 0 }), /zero vector/);
  const lateBoundAxis = K.computeBlock(rotation(['u', '0', '0'], 'theta'));
  assert.throws(() => K.numericMatrix(lateBoundAxis, { u: 0, theta: 1 }), /Division by zero/);
  assert.throws(() => K.validatedMatrix(lateBoundAxis, { u: 0, theta: 1 }), /Division by zero/);
  const arbitrary = K.computeBlock(rotation(['u', 'v', 'w'], 'theta'), null, { u: 1, v: 2, w: 3, theta: 45 }, 'deg');
  const numeric = K.computeBlock(rotation(['1', '2', '3'], 'pi/4'));
  close(K.numericMatrix(arbitrary, { u: 1, v: 2, w: 3, theta: 45 }), K.numericMatrix(numeric));
  assert.deepEqual(K.getSymbols(arbitrary), ['theta', 'u', 'v', 'w']);
  assert.match(K.format(K.computeBlock(rotation(['0', '0', '1'], 'theta'), null, {}, 'deg').matrix[0][0]), /theta.*pi\/180/);
});

test('matrix composition promotes mixed blocks and preserves multiplication order', () => {
  const R = K.computeBlock(rotation(['0', '0', '1'], 'pi/2'));
  const p = K.computeBlock(translation(['1', '0', '0']));
  close(K.numericMatrix(K.compose(R, p)), [[0, -1, 0, 0], [1, 0, 0, 1], [0, 0, 1, 0], [0, 0, 0, 1]]);
  close(K.numericMatrix(K.compose(p, R)), [[0, -1, 0, 1], [1, 0, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]);
  assert.equal(K.compose(R, R).kind, 'rotation');
  close(K.numericMatrix(K.compose(p, p)), [[2], [0], [0]]);
});

test('a symbolic D-H chain matches the standard homogeneous transform', () => {
  const blocks = [rotation(['0', '0', '1'], 'theta'), translation(['0', '0', 'd']), translation(['a', '0', '0']), rotation(['1', '0', '0'], 'alpha')];
  const result = blocks.reduce((input, block) => K.computeBlock(block, input), null);
  assert.deepEqual(K.getSymbols(result), ['a', 'alpha', 'd', 'theta']);
  assert.equal(K.format(result.matrix[0][2]), 'sin(theta)·sin(alpha)');
  const bindings = { theta: 0.7, alpha: -0.8, a: 2.3, d: -0.2 };
  const c = Math.cos(bindings.theta), s = Math.sin(bindings.theta), ca = Math.cos(bindings.alpha), sa = Math.sin(bindings.alpha);
  close(K.numericMatrix(result, bindings), [[c, -s * ca, s * sa, bindings.a * c], [s, c * ca, -c * sa, bindings.a * s], [0, sa, ca, bindings.d], [0, 0, 0, 1]]);
});

test('screw exponential handles offset axes, helical pitch, pure translation, and nonunit omega', () => {
  // Axis z through (1,0,0): v = -omega cross point = (0,-1,0).
  close(matrix(exponential(['0', '0', '1'], ['0', '-1', '0'], 'pi/2')), [[0, -1, 0, 1], [1, 0, 0, -1], [0, 0, 1, 0], [0, 0, 0, 1]]);
  close(matrix(exponential(['0', '0', '0'], ['1', '2', '-1'], '3')), [[1, 0, 0, 3], [0, 1, 0, 6], [0, 0, 1, -3], [0, 0, 0, 1]]);
  close(matrix(exponential(['0', '0', '0'], ['1', '0', '0'], '3'), null, {}, 'deg'), [[1, 0, 0, 3], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]);
  close(matrix(exponential(['0', '0', '2'], ['0', '-2', '1'], 'pi/4')), [[0, -1, 0, 1], [1, 0, 0, -1], [0, 0, 1, Math.PI / 4], [0, 0, 0, 1]]);
  const symbolic = K.computeBlock(exponential(['0', '0', '1'], ['0', '-a', '0'], 'theta'));
  close(K.numericMatrix(symbolic, { a: 2, theta: Math.PI / 2 }), [[0, -1, 0, 2], [1, 0, 0, -2], [0, 0, 1, 0], [0, 0, 0, 1]]);
});

test('rigid inverse composes to identity and rejects non-rigid transforms', () => {
  const value = K.computeBlock(exponential(['1', '2', '-1'], ['2', '-1', '0.5'], '0.8'));
  const inverse = K.computeBlock({ type: 'inverse' }, value);
  close(K.numericMatrix(K.compose(value, inverse)), K.numericMatrix(K.identity(4)));
  close(K.numericMatrix(K.inverseValue(K.computeBlock(translation(['1', '2', '3'])))), [[-1], [-2], [-3]]);
  const invalid = ['2', '0', '0', '0', '0', '1', '0', '0', '0', '0', '1', '0', '0', '0', '0', '1'];
  assert.throws(() => K.computeBlock({ type: 'transform', params: { matrix: invalid } }), /orthonormal/);
  invalid[0] = '1'; invalid[15] = '2';
  assert.throws(() => K.computeBlock({ type: 'transform', params: { matrix: invalid } }), /bottom row/);
  invalid[15] = '1'; invalid[0] = '-1';
  assert.throws(() => K.computeBlock({ type: 'transform', params: { matrix: invalid } }), /determinant/);
  invalid[0] = 'scale';
  const symbolic = K.computeBlock({ type: 'transform', params: { matrix: invalid } });
  assert.throws(() => K.inverseValue(symbolic, { scale: 2 }), /orthonormal/);
  close(K.numericMatrix(K.inverseValue(symbolic, { scale: 1 }), { scale: 1 }), K.numericMatrix(K.identity(4)));
  assert.throws(() => K.computeBlock({ type: 'inverse' }));
  close(K.validatedMatrix(K.computeBlock(rotation(['0', '0', '1'], 'theta')), { theta: 0 }), K.numericMatrix(K.identity(4)));
});

test('dense symbolic chains stop at a bounded expression size while numeric chains stay usable', () => {
  const symbolicBlock = rotation(['u', 'v', 'w'], 'theta');
  let symbolic = null;
  assert.throws(() => {
    for (let i = 0; i < 40; i++) symbolic = K.computeBlock(symbolicBlock, symbolic);
  }, /Expression too large/);
  let numeric = null;
  for (let i = 0; i < 40; i++) numeric = K.computeBlock(rotation(['1', '2', '3'], '0.03'), numeric);
  close(K.numericMatrix(numeric), matrix(rotation(['1', '2', '3'], '1.2')));
});

test('screw logarithm round trips finite rotations, pi, tiny angles, and translations', () => {
  const axes = [[1, 0, 0], [0, 1, 0], [0, 0, -1], [1, 2, -3]];
  for (const axis of axes) for (const theta of [0, 1e-8, 0.6, Math.PI - 1e-7, Math.PI, -1.8]) {
    const length = Math.hypot(...axis), omega = axis.map(a => a / length);
    const original = K.computeBlock(exponential(omega, [0.3, -0.7, 1.1], theta));
    const result = K.computeBlock({ type: 'logarithm' }, original);
    const reconstructed = K.exponential(result.screw.omega, result.screw.v, result.screw.theta);
    close(K.numericMatrix(reconstructed), K.numericMatrix(original), 2e-8);
  }
  const original = K.computeBlock(translation(['2', '-3', '4']));
  const { screw } = K.logValue(original);
  close(screw.omega.map(a => K.evaluate(a)), [0, 0, 0]);
  close(K.numericMatrix(K.exponential(screw.omega, screw.v, screw.theta)), K.numericMatrix(K.toHomogeneous(original)));
  assert.throws(() => K.logValue(K.computeBlock(rotation(['0', '0', '1'], 'theta'))), /theta/);
  close(K.evaluate(K.logValue(K.computeBlock(rotation(['0', '0', '1'], 'theta')), { theta: 0.5 }).screw.theta), 0.5);
});

test('screw coordinates are terminal while their retained transform remains available for preview', () => {
  const input = K.computeBlock(rotation(['0', '0', '1'], 'pi/3'));
  const screw = K.logValue(input);
  for (const action of [() => K.compose(screw, input), () => K.compose(input, screw), () => K.inverseValue(screw), () => K.logValue(screw)]) {
    assert.throws(action, /Enter these in an Exponential block/);
  }
  close(K.validatedMatrix(screw), K.validatedMatrix(input));
});

const generalMatrix = rows => K.computeBlock({ type: 'matrix', params: { rows: rows.length, columns: rows[0].length, matrix: rows.flat().map(String) } });

test('cross products preserve order, symbols and the world screw formula v = p × omega', () => {
  const p = generalMatrix([['x'], ['y'], ['z']]), omega = generalMatrix([[0], [0], [1]]);
  const v = K.computeBlock({ type: 'cross' }, { a: p, b: omega });
  assert.equal(v.kind, 'matrix');
  assert.deepEqual(K.getSymbols(v), ['x', 'y']);
  close(K.numericMatrix(v, { x: 2, y: 3 }), [[3], [-2], [0]]);
  close(K.numericMatrix(K.computeBlock({ type: 'cross' }, { a: omega, b: p }), { x: 2, y: 3 }), [[-3], [2], [0]]);
  close(K.cross([1, 2, 3], [4, 5, 6]).map(entry => K.evaluate(entry)), [-3, 6, -3]);
  assert.throws(() => K.computeBlock({ type: 'cross' }, { a: p }), /Connect.*b/);
  assert.throws(() => K.computeBlock({ type: 'cross' }, { a: generalMatrix([[1, 2, 3]]), b: omega }), /3 × 1/);
});

test('column assembly selects and reorders source columns and a common row slice', () => {
  const source = generalMatrix([[1, 2, 3], [4, 5, 6], [7, 8, 9], [10, 11, 12]]);
  const other = generalMatrix([[20], [30], [40], [50]]);
  const columns = { type: 'columns', params: { columns: [3, 1, 1], rowStart: 2, rowCount: 2 } };
  close(K.numericMatrix(K.computeBlock(columns, { c0: source, c1: other, c2: source })), [[6, 30, 4], [9, 40, 7]]);
  assert.throws(() => K.computeBlock(columns, { c0: other, c1: other, c2: source }), /outside/);
  assert.throws(() => K.computeBlock({ ...columns, params: { ...columns.params, rowStart: 4 } }, { c0: source, c1: other, c2: source }), /outside/);
  assert.throws(() => K.computeBlock(columns, { c0: source }), /Connect.*column 2/);
  const stack = K.computeBlock({ type: 'stack' }, { a: other, b: other });
  close(K.numericMatrix(stack), [[20], [30], [40], [50], [20], [30], [40], [50]]);
  assert.throws(() => K.computeBlock({ type: 'stack' }, { a: other, b: source }), /same number/);
});

test('determinants handle symbolic zero pivots, pivot swaps, singularities and small nonzero values', () => {
  const symbolic = generalMatrix([['a', 'b', '0'], ['0', 'c', 'd'], ['e', '0', 'f']]);
  const result = K.computeBlock({ type: 'determinant' }, symbolic);
  assert.equal(result.kind, 'scalar');
  assert.deepEqual(K.getSymbols(result), ['a', 'b', 'c', 'd', 'e', 'f']);
  close(K.numericMatrix(result, { a: 2, b: 3, c: 5, d: 7, e: 11, f: 13 }), [[361]]);
  close(K.numericMatrix(result, { a: 0, b: 3, c: 0, d: 7, e: 11, f: 0 }), [[231]]);
  close(K.evaluate(K.determinant([[0, 2], [3, 4]])), -6);
  close(K.evaluate(K.determinant([[1, 2, 3], [2, 4, 6], [1, 1, 1]])), 0);
  assert.equal(K.evaluate(K.determinant([[1e-14, 0], [0, 1e-14]])), 1e-28);
  assert.equal(K.numberText(1e-28), '1e-28');
  assert.equal(K.numberText(-0), '0');
  assert.equal(K.evaluate(K.determinant([['a']]), { a: -3 }), -3);
  assert.throws(() => K.computeBlock({ type: 'determinant' }, generalMatrix([[1, 2, 3], [4, 5, 6]])), /square.*2 × 3/);
});

test('general matrices use dimensional multiplication and never become rigid motions by shape', () => {
  const R = K.computeBlock(rotation(['0', '0', '1'], 'pi/2'));
  const p = generalMatrix([[1], [0], [0]]);
  const product = K.compose(R, p);
  assert.equal(product.kind, 'matrix');
  close(K.numericMatrix(product), [[0], [1], [0]]);
  const square = generalMatrix([[1, 2, 3], [0, 1, 4], [0, 0, 1]]);
  assert.throws(() => K.compose(p, square), /dimensions/);
  for (const value of [p, square, generalMatrix(K.numericMatrix(K.identity(4)))]) {
    assert.throws(() => K.toHomogeneous(value), /general matrix/);
    assert.throws(() => K.validatedMatrix(value), /general matrix/);
    assert.throws(() => K.inverseValue(value), /general matrix/);
    assert.throws(() => K.logValue(value), /general matrix/);
  }
  const scalar = K.computeBlock({ type: 'determinant' }, square);
  assert.throws(() => K.compose(scalar, p), /scalar/);
  assert.throws(() => K.computeBlock({ type: 'columns', params: { columns: [1], rowStart: 1, rowCount: 1 } }, { c0: scalar }), /scalar/);
});
