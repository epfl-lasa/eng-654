const test = require('node:test');
const assert = require('node:assert/strict');
const K = require('../math.js');
const G = require('../graph.js');
const block = (id, type, params, x = 0) => ({ id, type, params, label: id, position: { x, y: 70 }, showMatrix: false });
const translation = (id, x = '1') => block(id, 'translation', { vector: [x, '0', '0'] });
const edge = (from, to) => ({ from, to });
const graph = (nodes, edges = [], bindings = {}, angleUnit = 'rad') => ({ version: 1, name: 'Test', angleUnit, nodes, edges, bindings });
const call = (id, definition, args = {}) => block(id, 'function', { definition, arguments: args });
const numeric = (source, id) => {
  const result = G.evaluateGraph(source, { numeric: true }).get(id);
  assert.equal(result.error, null);
  return K.numericMatrix(result.value);
};
function close(actual, expected, tolerance = 1e-10) {
  if (Array.isArray(expected)) { assert.equal(actual.length, expected.length); expected.forEach((value, i) => close(actual[i], value, tolerance)); }
  else assert.ok(Math.abs(actual - expected) < tolerance, `${actual} differs from ${expected}`);
}
function dh() {
  const nodes = [block('rz', 'rotation', { axis: ['0', '0', '1'], angle: 'q1' }, 20),
    block('tz', 'translation', { vector: ['0', '0', 'd'] }, 350),
    block('tx', 'translation', { vector: ['a', '0', '0'] }, 680),
    block('rx', 'rotation', { axis: ['1', '0', '0'], angle: 'alpha' }, 1010)];
  return graph(nodes, [edge('rz', 'tz'), edge('tz', 'tx'), edge('tx', 'rx')], { q1: '0.7', d: '0.2', a: '2.3', alpha: '-0.8' });
}

test('grouping a D-H chain preserves numeric and symbolic results and arbitrary notation', () => {
  const source = dh(), definition = G.captureFunction(source, ['tx', 'rz', 'rx', 'tz'], { id: 'dh', name: '^0T_1' });
  assert.deepEqual(definition.parameters, ['a', 'alpha', 'd', 'q1']);
  assert.equal(definition.name, '^0T_1'); assert.deepEqual(definition.defaults, source.bindings);
  assert.deepEqual(definition.graph.bindings, {});
  const grouped = G.groupSelection(source, ['tx', 'rz', 'rx', 'tz'], { id: 'dh', nodeId: 'combined', label: '^0T_1' });
  assert.equal(grouped.graph.nodes.length, 1);
  assert.deepEqual(grouped.graph.nodes[0].position, source.nodes[0].position);
  close(numeric(grouped.graph, 'combined'), numeric(source, 'rx'));
  const symbolic = G.evaluateGraph(grouped.graph).get('combined');
  assert.equal(symbolic.error, null);
  close(K.numericMatrix(symbolic.value, source.bindings), numeric(source, 'rx'));
  assert.deepEqual(K.getSymbols(symbolic.value), ['a', 'alpha', 'd', 'q1']);
  assert.deepEqual(G.validateGraph(JSON.parse(JSON.stringify(grouped.graph))), grouped.graph);
});

test('grouping rewires both external boundaries while preserving independent branches and positions', () => {
  const source = dh();
  source.nodes.push(translation('before', '0.8'), translation('after', '0.4'), translation('branch', '3'), translation('independent', '9'));
  source.edges.push(edge('before', 'rz'), edge('rx', 'after'), edge('rx', 'branch'));
  source.nodes.find(n => n.id === 'independent').position = { x: -124, y: 500 };
  const grouped = G.groupSelection(source, ['rz', 'tz', 'tx', 'rx'], { nodeId: 'dh', label: '^0T_1' });
  assert.deepEqual(grouped.graph.edges, [edge('before', 'dh'), edge('dh', 'after'), edge('dh', 'branch')]);
  for (const id of ['after', 'branch', 'independent']) close(numeric(grouped.graph, id), numeric(source, id));
  close(numeric(grouped.graph, 'dh'), numeric(source, 'rx'));
  assert.deepEqual(grouped.graph.nodes.find(n => n.id === 'independent').position, { x: -124, y: 500 });
  const own = G.evaluateGraph(grouped.graph, { numeric: true }).get('dh').ownValue;
  close(K.numericMatrix(own), numeric(dh(), 'rx'));
});

test('whole-output capture excludes unrelated branches and saves bound q as a reusable formal', () => {
  const source = dh(); source.nodes.push(translation('other', 'hidden'));
  source.edges.push(edge('tz', 'other')); source.bindings.hidden = '3';
  const definition = G.functionFromOutput(source, 'rx', { name: 'Robot FK', id: 'robot_fk' });
  assert.equal(definition.graph.nodes.length, 4);
  assert.ok(!definition.parameters.includes('hidden'));
  assert.equal(definition.parameters.includes('q1'), true);
  const instance = call('fk', definition, { a: '3', alpha: '0', d: '0', q1: 'q_new+pi/2' });
  const canvas = graph([instance], [], { q_new: '0' });
  assert.deepEqual(G.rawSymbols(canvas), ['q_new']);
  close(numeric(canvas, 'fk'), [[0, -1, 0, 0], [1, 0, 0, 3], [0, 0, 1, 0], [0, 0, 0, 1]]);
  assert.deepEqual(K.getSymbols(G.evaluateGraph(canvas).get('fk').value), ['q_new']);
});

test('saved angle conventions survive different canvas units and nested functions', () => {
  const definition = G.functionFromOutput(graph([block('r', 'rotation', { axis: ['0', '0', '1'], angle: 'q' })], [], { q: '90' }, 'deg'), 'r', { id: 'turn_deg', name: 'Degrees' });
  const inner = graph([call('f', definition, { q: 'angle' }), translation('t')], [edge('f', 't')], {}, 'rad');
  const outer = G.functionFromOutput(inner, 't', { id: 'nested', name: 'Nested' });
  const canvas = graph([call('fk', outer, { angle: '90' })], [], {}, 'deg');
  close(numeric(canvas, 'fk'), [[0, -1, 0, 0], [1, 0, 0, 1], [0, 0, 1, 0], [0, 0, 0, 1]]);
});

test('numeric function arguments are substituted before prismatic screw formula selection', () => {
  const source = graph([block('e', 'exponential', { omega: ['w', '0', '0'], v: ['1', '0', '0'], theta: 'q' })], [], {}, 'deg');
  const definition = G.functionFromOutput(source, 'e', { id: 'screw', name: 'Screw' });
  const canvas = graph([call('f', definition, { w: 'axis', q: 'travel' })], [], { axis: '0', travel: '3' });
  close(numeric(canvas, 'f'), [[1, 0, 0, 3], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]);
});

test('captured inverse consumes its internal chain and can be followed by another transform', () => {
  const source = graph([translation('t', 'd'), block('inv', 'inverse', {})], [edge('t', 'inv')], { d: '4' });
  const definition = G.functionFromOutput(source, 'inv', { id: 'inverse', name: 'Inverse motion' });
  const canvas = graph([translation('before', '1'), call('f', definition, { d: '4' }), translation('after', '2')], [edge('before', 'f'), edge('f', 'after')]);
  close(numeric(canvas, 'after'), [[-1], [0], [0]]);
  assert.throws(() => G.expandFunction(canvas, 'f'), /Disconnect/);
  assert.throws(() => G.captureFunction(source, ['inv']), /Include the input/);
  source.nodes.unshift(translation('extra')); source.edges.unshift(edge('extra', 't'));
  assert.throws(() => G.captureFunction(source, ['t', 'inv']), /complete input chain/);
});

test('selection must have one linear boundary and a matrix-valued output', () => {
  const source = dh();
  assert.throws(() => G.captureFunction(source, []), /Select/);
  assert.throws(() => G.captureFunction(source, ['rz', 'missing']), /missing/);
  assert.throws(() => G.captureFunction(source, ['rz', 'tx']), /connected|consecutive/);
  source.nodes.push(translation('branch')); source.edges.push(edge('tz', 'branch'));
  assert.throws(() => G.captureFunction(source, ['rz', 'tz', 'tx', 'rx']), /last selected/);
  assert.throws(() => G.captureFunction(source, ['rz', 'tz', 'tx', 'rx', 'branch']), /branches/);
  const screw = graph([translation('t'), block('log', 'logarithm', {})], [edge('t', 'log')]);
  assert.throws(() => G.functionFromOutput(screw, 'log'), /screw result/);
});

test('expansion substitutes instance arguments, rewires branches, and preserves precision', () => {
  const source = dh();
  const grouped = G.groupSelection(source, source.nodes.map(n => n.id), { nodeId: 'dh' }).graph;
  grouped.nodes[0].params.arguments = { q1: 'theta+0.1234567890123456', a: '2.1234567890123456', alpha: '0', d: '1' };
  grouped.bindings.theta = '0.5';
  grouped.nodes.push(translation('before'), translation('after'), translation('branch'));
  grouped.edges.push(edge('before', 'dh'), edge('dh', 'after'), edge('dh', 'branch'));
  const expanded = G.expandFunction(grouped, 'dh');
  assert.equal(expanded.nodeIds.length, 4);
  assert.equal(expanded.graph.nodes.some(n => n.id === 'dh'), false);
  close(numeric(expanded.graph, 'after'), numeric(grouped, 'after'), 1e-13);
  close(numeric(expanded.graph, 'branch'), numeric(grouped, 'branch'), 1e-13);
  assert.deepEqual(G.rawSymbols(expanded.graph), ['theta']);
});

test('expansion converts angular units but preserves prismatic travel and nested conventions', () => {
  const local = graph([block('r', 'rotation', { axis: ['0', '0', '1'], angle: 'q' }),
    block('slide', 'exponential', { omega: ['0', '0', '0'], v: ['1', '0', '0'], theta: 'd' })], [edge('r', 'slide')], {}, 'deg');
  const definition = G.functionFromOutput(local, 'slide', { id: 'deg_move', name: 'Move' });
  const canvas = graph([call('f', definition, { q: '90', d: '3' })]);
  const expanded = G.expandFunction(canvas, 'f');
  close(numeric(expanded.graph, expanded.outputId), numeric(canvas, 'f'));
  assert.equal(expanded.graph.nodes[1].params.theta, '3');
});

test('matrix functions evaluate symbolic expressions and validate matrix output types', () => {
  const definition = G.validateDefinition({ version: 1, id: 'r', name: 'Imported rotation', kind: 'matrix', parameters: ['q'], angleUnit: 'rad', defaults: { q: '0' }, outputKind: 'rotation',
    matrix: [['cos(q)', '-sin(q)', '0'], ['sin(q)', 'cos(q)', '0'], ['0', '0', '1']] });
  const canvas = graph([call('f', definition, { q: 'theta' }), translation('t')], [edge('f', 't')], { theta: 'pi/2' });
  close(numeric(canvas, 't'), [[0, -1, 0, 0], [1, 0, 0, 1], [0, 0, 1, 0], [0, 0, 0, 1]]);
  assert.throws(() => G.expandFunction(canvas, 'f'), /no internal/);
  const invalid = structuredClone(definition); invalid.matrix[0][0] = '2';
  assert.match(G.evaluateGraph(graph([call('bad', invalid, { q: '0' })]), { numeric: true }).get('bad').error, /orthonormal/);
});

test('definition validation rejects undeclared or unsafe symbols and malformed data', () => {
  const definition = G.functionFromOutput(dh(), 'rx', { id: 'dh', name: 'D-H' });
  let changed = structuredClone(definition); changed.parameters = ['q1']; assert.throws(() => G.validateDefinition(changed), /unknown function parameter|Expose/);
  changed = structuredClone(definition); changed.defaults = JSON.parse('{"__proto__":"1"}'); assert.throws(() => G.validateDefinition(changed), /Invalid symbol/);
  changed = structuredClone(definition); changed.parameters.push('constructor'); assert.throws(() => G.validateDefinition(changed), /Invalid symbol/);
  changed = structuredClone(definition); changed.graph.nodes[0].params.angle = 'q1 +'; assert.throws(() => G.validateDefinition(changed), /Expected/);
  changed = structuredClone(definition); changed.graph.nodes.push(translation('other')); assert.throws(() => G.validateDefinition(changed), /only its output chain/);
  assert.throws(() => G.validateGraph(graph([call('f', definition, { unknown: '1' })])), /Unknown function argument/);
  const instance = call('f', definition); instance.params.arguments = JSON.parse('{"__proto__":"1"}');
  assert.throws(() => G.validateGraph(graph([instance])), /Invalid symbol/);
});

test('cyclic definitions, excessive nesting, and total nested size cannot hang validation', () => {
  const base = G.functionFromOutput(graph([translation('t', 'd')]), 't', { id: 'base', name: 'Base' });
  const cyclic = { ...base, graph: graph([]), outputId: 'f' };
  cyclic.graph.nodes.push(call('f', cyclic, { d: 'd' }));
  assert.throws(() => G.validateDefinition(cyclic), /recursive/);
  let nested = base;
  for (let i = 0; i < 7; i++) nested = { ...base, id: 'nest' + i, graph: graph([call('f', nested, { d: 'd' })]), outputId: 'f' };
  assert.doesNotThrow(() => G.validateDefinition(nested));
  const tooDeep = { ...base, graph: graph([call('f', nested, { d: 'd' })]), outputId: 'f' };
  assert.throws(() => G.validateDefinition(tooDeep), /8 levels/);
  const chain = graph(Array.from({ length: 40 }, (_, i) => translation('n' + i)), Array.from({ length: 39 }, (_, i) => edge('n' + i, 'n' + (i + 1))));
  const large = G.functionFromOutput(chain, 'n39', { id: 'large', name: 'Large' });
  const calls = graph(Array.from({ length: 5 }, (_, i) => call('f' + i, large)));
  assert.throws(() => G.validateGraph(calls), /200 blocks/);
});

test('function errors preserve separate branches and editable argument drafts', () => {
  const definition = G.functionFromOutput(graph([translation('t', 'd')]), 't', { id: 'move', name: 'Move' });
  const source = graph([call('f', definition, { d: 'unfinished +' }), translation('child'), translation('other')], [edge('f', 'child')]);
  const results = G.evaluateGraph(source);
  assert.match(results.get('f').error, /Expected/);
  assert.match(results.get('child').error, /Fix the input/);
  assert.equal(results.get('other').error, null);
});

test('a long symbolic FK is saved as operations and remains numerically callable', () => {
  const nodes = Array.from({ length: 10 }, (_, i) => block('e' + i, 'exponential', {
    omega: ['u', 'v', 'w'], v: ['0', '0', '0'], theta: 'q' + (i + 1)
  }));
  const source = graph(nodes, nodes.slice(1).map((node, i) => edge(nodes[i].id, node.id)));
  const definition = G.functionFromOutput(source, 'e9', { id: 'fk_long', name: 'Symbolic FK' });
  assert.deepEqual(definition.parameters, ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8', 'q9', 'q10', 'u', 'v', 'w']);
  const args = Object.fromEntries(definition.parameters.map(name => [name, name === 'u' ? '1' : name === 'v' ? '2' : name === 'w' ? '3' : '0.01']));
  const canvas = graph([call('fk', definition, args)]);
  const expected = K.computeBlock(block('expected', 'rotation', { axis: ['1', '2', '3'], angle: String(Math.sqrt(14) * 0.1) }));
  const result = numeric(canvas, 'fk');
  close(result, K.numericMatrix(K.toHomogeneous(expected)));
});
