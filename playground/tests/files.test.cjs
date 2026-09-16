const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../graph.js');
const F = require('../files.js');
const example = require('../examples/exercise-01-iiwa7-twists.json');
const simple = { version: 1, name: 'Symbols', angleUnit: 'rad', bindings: { a: '2' }, edges: [],
  nodes: [{ id: 'p', type: 'translation', label: 'Point', params: { vector: ['a', '0', '0'] }, position: { x: 12, y: 34 } }] };
const definition = () => G.functionFromOutput(simple, 'p', { id: 'saved_point', name: 'Point function' });

test('workspace round trip preserves operation ports, library, selected output and bindings', () => {
  const graph = G.validateGraph(example), library = [definition()];
  const file = JSON.parse(JSON.stringify(F.workspaceFile(graph, library, 'space_screws')));
  const restored = F.readFile(file);
  assert.deepEqual(restored, { graph, library, selected: 'space_screws' });
  assert.equal(G.evaluateGraph(restored.graph).get('space_screws').error, null);
  const symbolic = F.readFile(F.workspaceFile(simple, [], 'p'));
  assert.deepEqual(symbolic.graph.bindings, { a: '2' });
  assert.equal(symbolic.graph.nodes[0].params.vector[0], 'a');
});

test('legacy graph files preserve the current library', () => {
  const library = [definition()], restored = F.readFile(example, library);
  assert.deepEqual(restored.graph, G.validateGraph(example));
  assert.deepEqual(restored.library, library);
});

test('library uploads merge, deduplicate and preserve conflicting saved definitions', () => {
  const original = definition(), edited = { ...original, name: 'Edited point' };
  const imported = F.readFile(F.libraryFile([original]), [original]);
  assert.equal(imported.graph, null); assert.equal(imported.library.length, 1);
  const merged = F.readFile(F.libraryFile([edited]), [original]).library;
  assert.equal(merged.length, 2); assert.notEqual(merged[0].id, merged[1].id);
  assert.equal(merged[1].name, 'Edited point');
  assert.deepEqual(merged[0], original);
});

test('malformed uploads fail without changing the graph or saved operations', () => {
  const file = F.workspaceFile(example, [definition()], 'space_screws');
  const before = JSON.stringify(file), library = [definition()], saved = JSON.stringify(library);
  assert.throws(() => F.readFile({ ...file, version: 2 }, library), /unsupported/);
  assert.throws(() => F.readFile({ ...file, graph: { ...file.graph, edges: [{ from: 'missing', to: 'space_screws', input: 'c0' }] } }, library), /missing/);
  assert.throws(() => F.readFile({ ...file, library: [{}] }, library), /version/);
  assert.throws(() => F.readFile({ format: 'unrelated', version: 1 }, library), /unsupported/);
  assert.throws(() => F.readFile({ ...file, library: Array.from({ length: 61 }, definition) }, library), /60/);
  assert.equal(JSON.stringify(file), before); assert.equal(JSON.stringify(library), saved);
});
