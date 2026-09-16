const test = require('node:test');
const assert = require('node:assert/strict');
const K = require('../math.js');
const G = require('../graph.js');
const F = require('../files.js');
const matrixNode = (id, values) => ({ id, type: 'matrix', label: id, position: { x: 0, y: 0 },
  params: { rows: values.length, columns: values[0].length, matrix: values.flat().map(String) } });
const operation = (id, type) => ({ id, type, label: id, params: {}, position: { x: 0, y: 0 } });
const graph = (nodes, edges = [], bindings = {}) => ({ version: 1, name: 'Matrix dimensions', angleUnit: 'rad', nodes, edges, bindings });

test('row vectors, column vectors and rectangular matrices survive workspace and saved-operation round trips', () => {
  for (const [rows, columns] of [[1, 1], [1, 8], [8, 1], [2, 7], [7, 2], [12, 12]]) {
    const entries = Array.from({ length: rows }, (_, i) => Array.from({ length: columns }, (_, j) => `${i + 1}*a+${j}`));
    const source = graph([matrixNode('m', entries)], [], { a: '2' });
    const definition = G.functionFromOutput(source, 'm', { id: 'matrix_function', name: 'General matrix' });
    const saved = F.workspaceFile(source, [definition], 'm'), before = JSON.stringify(saved);
    const restored = F.readFile(JSON.parse(before));
    assert.equal(JSON.stringify(saved), before);
    assert.equal(restored.graph.nodes[0].params.rows, rows); assert.equal(restored.graph.nodes[0].params.columns, columns);
    const numeric = G.evaluateGraph(restored.graph, { numeric: true }).get('m');
    assert.equal(numeric.error, null); assert.equal(numeric.value.kind, 'matrix');
    assert.deepEqual(K.numericMatrix(numeric.value), entries.map((row, i) => row.map((_, j) => 2 * (i + 1) + j)));
    const fn = { ...operation('f', 'function'), params: { definition: restored.library[0], arguments: { a: '3' } } };
    const value = G.evaluateGraph(graph([fn]), { numeric: true }).get('f');
    assert.equal(value.error, null); assert.equal(value.value.kind, 'matrix');
    assert.deepEqual(K.numericMatrix(value.value), entries.map((row, i) => row.map((_, j) => 3 * (i + 1) + j)));
  }
});

test('symbolic rectangular multiplication preserves vector orientation and never coerces values into poses', () => {
  const row = K.computeBlock(matrixNode('r', [['a', 2, 3]]));
  const column = K.computeBlock(matrixNode('c', [[4], ['b'], [6]]));
  const dot = K.compose(row, column), outer = K.compose(column, row);
  assert.equal(dot.kind, 'matrix'); assert.equal(outer.kind, 'matrix');
  assert.deepEqual(K.numericMatrix(dot, { a: 5, b: 7 }), [[52]]);
  assert.deepEqual(K.numericMatrix(outer, { a: 5, b: 7 }), [[20, 8, 12], [35, 14, 21], [30, 12, 18]]);
  assert.deepEqual(K.numericMatrix(K.computeBlock(operation('d', 'determinant'), dot), { a: 5, b: 7 }), [[52]]);
  const a = K.computeBlock(matrixNode('a', [[1, 2, 3], [4, 5, 6]]));
  const b = K.computeBlock(matrixNode('b', [[1, 0, 2, 0], [0, 1, 0, 2], [1, 1, 1, 1]]));
  assert.deepEqual(K.numericMatrix(K.compose(a, b)), [[4, 5, 5, 7], [10, 11, 14, 16]]);
  assert.throws(() => K.compose(a, row), /2 × 3 cannot multiply 1 × 3/);
});

test('nonsquare determinant errors include dimensions, leave source matrices intact and clear old scalar results', () => {
  for (const [rows, columns] of [[1, 4], [4, 1], [2, 5], [5, 2]]) {
    const values = Array.from({ length: rows }, (_, i) => Array.from({ length: columns }, (_, j) => String(i + j + 1)));
    const source = graph([matrixNode('m', values), operation('det', 'determinant'), matrixNode('other', [[9]])], [{ from: 'm', to: 'det' }]);
    const before = JSON.stringify(source), input = K.computeBlock(source.nodes[0]), inputBefore = JSON.stringify(input);
    assert.throws(() => K.computeBlock(source.nodes[1], input), new RegExp(`square matrix.*${rows} × ${columns}`));
    assert.equal(JSON.stringify(input), inputBefore);
    for (const numeric of [false, true]) {
      const results = G.evaluateGraph(source, { numeric });
      assert.equal(results.get('m').error, null); assert.equal(results.get('other').error, null);
      assert.match(results.get('det').error, new RegExp(`square matrix.*${rows} × ${columns}`));
      assert.equal(results.get('det').value, null); assert.equal(results.get('det').ownValue, null);
    }
    assert.equal(JSON.stringify(source), before);
  }
  const source = graph([matrixNode('m', [[1, 2], [3, 4]]), operation('det', 'determinant')], [{ from: 'm', to: 'det' }]);
  assert.deepEqual(K.numericMatrix(G.evaluateGraph(source).get('det').value), [[-2]]);
  source.nodes[0] = matrixNode('m', [[1, 2, 3], [4, 5, 6]]);
  const changed = G.evaluateGraph(source).get('det');
  assert.equal(changed.value, null); assert.match(changed.error, /square matrix.*2 × 3/);
});
