const test = require('node:test');
const assert = require('node:assert/strict');
const K = require('../math.js');
const G = require('../graph.js');
const node = (id, type = 'translation', params = { vector: ['1', '0', '0'] }) => ({ id, type, params, label: id, position: { x: 0, y: 0 }, showMatrix: false });
const graph = (nodes, edges = [], bindings = {}) => ({ version: 1, name: 'Test', angleUnit: 'rad', nodes, edges, bindings });
const edge = (from, to) => ({ from, to });
function close(actual, expected, tolerance = 1e-9) {
  if (Array.isArray(expected)) { assert.equal(actual.length, expected.length); expected.forEach((value, i) => close(actual[i], value, tolerance)); }
  else assert.ok(Math.abs(actual - expected) < tolerance, `${actual} differs from ${expected}`);
}

test('validation sanitizes imports and preserves editable draft expressions', () => {
  const source = graph([node('a')]);
  source.nodes[0].params.vector[0] = 'unfinished +'; source.nodes[0].params.unexpected = 'discard';
  source.nodes[0].extra = { nested: 'discard' }; source.extra = 'discard'; source.bindings.x = 'unfinished +';
  const cleaned = G.validateGraph(source);
  assert.equal(cleaned.extra, undefined); assert.equal(cleaned.nodes[0].extra, undefined);
  assert.equal(cleaned.nodes[0].params.unexpected, undefined);
  assert.equal(cleaned.nodes[0].params.vector[0], 'unfinished +'); assert.equal(cleaned.bindings.x, 'unfinished +');
  cleaned.nodes[0].position.x = 10; assert.equal(source.nodes[0].position.x, 0);
  assert.match(G.evaluateGraph(cleaned).get('a').error, /Expected/);
});

test('validation rejects malformed graphs, duplicate parents, cycles, and dangling edges', () => {
  assert.throws(() => G.validateGraph(null));
  assert.throws(() => G.validateGraph({ ...graph([]), version: 2 }), /version/);
  assert.throws(() => G.validateGraph(graph(Array.from({ length: 41 }, (_, i) => node('n' + i)))), /40/);
  assert.throws(() => G.validateGraph(graph([node('a'), node('a')])), /unique/);
  assert.throws(() => G.validateGraph(graph([node('a')], [edge('a', 'missing')])), /missing/);
  assert.throws(() => G.validateGraph(graph([node('a')], [edge('a', 'a')])), /itself/);
  assert.throws(() => G.validateGraph(graph([node('a'), node('b'), node('c')], [edge('a', 'c'), edge('b', 'c')])), /one input/);
  assert.throws(() => G.validateGraph(graph([node('a'), node('b'), node('c')], [edge('a', 'b'), edge('b', 'c'), edge('c', 'a')])), /cycle/);
  assert.throws(() => G.validateGraph(graph([{ ...node('a'), position: { x: Infinity, y: 0 } }])), /finite/);
  assert.throws(() => G.validateGraph(graph([{ ...node('a'), label: 'x'.repeat(81) }])), /80/);
  assert.throws(() => G.validateGraph(graph([node('a', 'translation', { vector: ['1', '2'] })])), /three|3 entries/);
});

test('new connections replace one input, allow branching, and reject actual cycles', () => {
  const source = graph([node('a'), node('b'), node('c')], [edge('a', 'b'), edge('a', 'c')]);
  assert.equal(G.canConnect(source, 'b', 'c'), null);
  assert.deepEqual(G.connect(source, 'b', 'c'), [edge('a', 'b'), edge('b', 'c')]);
  assert.deepEqual(source.edges, [edge('a', 'b'), edge('a', 'c')]);
  assert.match(G.canConnect(source, 'b', 'a'), /cycle/);
  assert.match(G.canConnect(source, 'a', 'a'), /itself/);
  assert.match(G.canConnect(source, 'missing', 'c'), /missing/);
  assert.equal(G.canConnect(source, 'a', 'b'), null);
});

test('screw extraction outputs coordinates and cannot feed matrix operations', () => {
  const source = graph([node('a'), node('log', 'logarithm', {}), node('b')], [edge('a', 'log')]);
  assert.equal(G.evaluateGraph(source).get('log').value.kind, 'screw');
  assert.match(G.canConnect(source, 'log', 'b'), /Enter these in an Exponential block/);
  assert.throws(() => G.validateGraph({ ...source, edges: [...source.edges, edge('log', 'b')] }), /Enter these in an Exponential block/);
});

test('graph evaluation matches a D-H transform independently of node order', () => {
  const rz = node('rz', 'rotation', { axis: ['0', '0', '1'], angle: 'theta' });
  const tz = node('tz', 'translation', { vector: ['0', '0', 'd'] });
  const tx = node('tx', 'translation', { vector: ['a', '0', '0'] });
  const rx = node('rx', 'rotation', { axis: ['1', '0', '0'], angle: 'alpha' });
  const bindings = { theta: '0.7', alpha: '-0.8', a: '2.3', d: '-0.2' };
  const results = G.evaluateGraph(graph([rx, tx, tz, rz], [edge('rz', 'tz'), edge('tz', 'tx'), edge('tx', 'rx')], bindings));
  const c = Math.cos(0.7), s = Math.sin(0.7), ca = Math.cos(-0.8), sa = Math.sin(-0.8);
  assert.equal(results.get('rx').error, null);
  close(K.numericMatrix(results.get('rx').value, bindings), [[c, -s * ca, s * sa, 2.3 * c], [s, c * ca, -c * sa, 2.3 * s], [0, sa, ca, -0.2], [0, 0, 0, 1]]);
  assert.equal(results.get('rx').ownValue.kind, 'rotation');
  assert.equal(results.get('rx').value.kind, 'transform');
});

test('shared inputs are computed once and inverse and logarithm consume accumulated values', () => {
  const source = graph([node('a'), node('b'), node('c'), node('inv', 'inverse', {}), node('log', 'logarithm', {})],
    [edge('a', 'b'), edge('a', 'c'), edge('b', 'inv'), edge('c', 'log')]);
  const original = K.computeBlock, calls = new Map();
  K.computeBlock = function (block, ...args) { calls.set(block.id, (calls.get(block.id) || 0) + 1); return original(block, ...args); };
  try {
    const results = G.evaluateGraph(source);
    assert.deepEqual([...calls.values()], [1, 1, 1, 1, 1]);
    close(K.numericMatrix(results.get('inv').value), [[-2], [0], [0]]);
    assert.equal(results.get('log').value.kind, 'screw');
    close(K.evaluate(results.get('log').value.screw.theta), 2);
    assert.strictEqual(results.get('log').ownValue, results.get('log').value);
  } finally { K.computeBlock = original; }
});

test('upstream errors propagate while independent blocks and own matrices remain available', () => {
  const broken = node('broken', 'rotation', { axis: ['0', '0', '0'], angle: '1' });
  const results = G.evaluateGraph(graph([broken, node('child'), node('other'), node('inv', 'inverse', {})], [edge('broken', 'child')]));
  assert.match(results.get('broken').error, /zero vector/);
  assert.match(results.get('child').error, /broken/);
  assert.equal(results.get('child').value, null);
  assert.equal(results.get('child').ownValue.kind, 'translation');
  assert.equal(results.get('other').error, null);
  assert.match(results.get('inv').error, /Connect/);
});

test('symbol binding drafts remain data and unsafe or unresolved expressions cannot execute', () => {
  const source = graph([node('a', 'translation', { vector: ['x', '0', '0'] })], [], { x: 'globalThis.alert(1)' });
  const cleaned = G.validateGraph(source);
  assert.equal(cleaned.bindings.x, 'globalThis.alert(1)');
  assert.throws(() => K.numericMatrix(G.evaluateGraph(cleaned).get('a').value, cleaned.bindings), /Unexpected/);
  source.bindings.x = 'other';
  assert.throws(() => K.numericMatrix(G.evaluateGraph(source).get('a').value, source.bindings), /other/);
  source.bindings.x = '';
  assert.equal(G.validateGraph(source).bindings.x, '');
  source.bindings = JSON.parse('{"__proto__":"1"}');
  assert.throws(() => G.validateGraph(source), /Invalid symbol/);
  source.bindings = { constructor: '1' }; assert.throws(() => G.validateGraph(source), /Invalid symbol/);
  source.bindings = { x: 2 }; assert.throws(() => G.validateGraph(source), /text/);
  source.bindings = { x: '2'.repeat(501) }; assert.throws(() => G.validateGraph(source), /500/);
});

test('numeric evaluation substitutes screw symbols before selecting rotational or prismatic formulas', () => {
  const exponential = node('exp', 'exponential', { omega: ['w', '0', '0'], v: ['1', '0', '0'], theta: 'amount' });
  const source = { ...graph([exponential, node('log', 'logarithm', {})], [edge('exp', 'log')], { w: '0', amount: '3' }), angleUnit: 'deg' };
  let results = G.evaluateGraph(source, { numeric: true });
  assert.equal(results.get('exp').error, null);
  close(K.numericMatrix(results.get('exp').value), [[1, 0, 0, 3], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]);
  assert.equal(results.get('log').error, null);
  close(K.evaluate(results.get('log').value.screw.theta), 3);
  assert.deepEqual(K.getSymbols(G.evaluateGraph(source).get('exp').value), ['amount', 'w']);
  source.bindings = { w: '1', amount: '90' };
  results = G.evaluateGraph(source, { numeric: true });
  close(K.numericMatrix(results.get('exp').value), [[1, 0, 0, Math.PI / 2], [0, 0, -1, 0], [0, 1, 0, 0], [0, 0, 0, 1]]);
  close(K.evaluate(results.get('log').value.screw.theta), Math.PI / 2);
});

test('numeric evaluation reports invalid bindings and propagates errors only to descendants', () => {
  const source = graph([node('a', 'translation', { vector: ['x', '0', '0'] }), node('child'), node('other')], [edge('a', 'child')], { x: 'globalThis.alert(1)' });
  let results = G.evaluateGraph(source, { numeric: true });
  assert.match(results.get('a').error, /Unexpected/);
  assert.match(results.get('child').error, /Fix the input/);
  assert.equal(results.get('other').error, null);
  source.bindings.x = 'unknown'; results = G.evaluateGraph(source, { numeric: true });
  assert.match(results.get('a').error, /Set a value for unknown/);
  source.bindings.x = ''; results = G.evaluateGraph(source, { numeric: true });
  assert.match(results.get('a').error, /Set a value for x/);
});

test('numeric evaluation remains available when a symbolic product exceeds the expression limit', () => {
  const nodes = Array.from({ length: 15 }, (_, i) => node('n' + i, 'rotation', { axis: ['u', 'v', 'w'], angle: 'theta' }));
  const edges = nodes.slice(1).map((n, i) => edge(nodes[i].id, n.id));
  const source = graph(nodes, edges, { u: '1', v: '2', w: '3', theta: '0.03' });
  assert.match(G.evaluateGraph(source).get('n14').error, /Expression too large/);
  const results = G.evaluateGraph(source, { numeric: true });
  assert.equal(results.get('n14').error, null);
  const expected = K.computeBlock(node('expected', 'rotation', { axis: ['1', '2', '3'], angle: '0.45' }));
  close(K.numericMatrix(results.get('n14').value), K.numericMatrix(expected));
});
