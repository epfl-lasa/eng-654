const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const K = require('../math.js');
const G = require('../graph.js');
const P = require('../presets.js');

// Independent reference: read joint origins/axes directly from the requested
// URDF and multiply origin * axis rotation, including the fixed tool joint.
// This intentionally does not use the playground's rotation/D-H/PoE helpers.
const urdf = fs.readFileSync(path.join(__dirname, '../../lectures_main/assets/models/custom_3R/custom_3R.urdf'), 'utf8');
const joints = [...urdf.matchAll(/<joint\s+([^>]+)>([\s\S]*?)<\/joint>/g)].map(match => {
  const attribute = (text, name) => text.match(new RegExp('\\b' + name + '="([^"]*)"'))?.[1];
  const tag = name => match[2].match(new RegExp('<' + name + '\\s+([^>]+)\\s*/>'))?.[1] || '';
  const vector = (text, name, fallback) => (attribute(text, name) || fallback).trim().split(/\s+/).map(Number);
  return { name: attribute(match[1], 'name'), type: attribute(match[1], 'type'),
    parent: attribute(tag('parent'), 'link'), child: attribute(tag('child'), 'link'),
    xyz: vector(tag('origin'), 'xyz', '0 0 0'), rpy: vector(tag('origin'), 'rpy', '0 0 0'),
    axis: vector(tag('axis'), 'xyz', '1 0 0') };
});
const identity = () => Array.from({ length: 4 }, (_, i) => Array.from({ length: 4 }, (_, j) => Number(i === j)));
const multiply = (A, B) => A.map(row => B[0].map((_, j) => row.reduce((sum, a, k) => sum + a * B[k][j], 0)));
function rotation(axis, theta) {
  const length = Math.hypot(...axis), [x, y, z] = axis.map(value => value / length);
  const c = Math.cos(theta), s = Math.sin(theta), t = 1 - c;
  return [[t*x*x+c,t*x*y-s*z,t*x*z+s*y,0], [t*x*y+s*z,t*y*y+c,t*y*z-s*x,0],
    [t*x*z-s*y,t*y*z+s*x,t*z*z+c,0], [0,0,0,1]];
}
function origin(joint) {
  const [r, p, y] = joint.rpy;
  const matrix = multiply(multiply(rotation([0,0,1], y), rotation([0,1,0], p)), rotation([1,0,0], r));
  joint.xyz.forEach((value, index) => { matrix[index][3] = value; });
  return matrix;
}
function urdfFK(q) {
  let result = identity(), current = 'base_link', index = 0;
  while (current !== 'tool0') {
    const joint = joints.find(item => item.parent === current);
    assert.ok(joint, 'URDF chain reaches tool0');
    result = multiply(result, origin(joint));
    if (joint.type === 'revolute') result = multiply(result, rotation(joint.axis, q[index++]));
    current = joint.child;
  }
  assert.equal(index, 3);
  return result;
}
function close(actual, expected, tolerance = 2e-10) {
  if (Array.isArray(expected)) {
    assert.equal(actual.length, expected.length);
    expected.forEach((value, index) => close(actual[index], value, tolerance));
  } else assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);
}
const configurations = [[0,0,0], [.3,-.5,.8], [-2.7,.4,-1.9], [Math.PI/2,-Math.PI/2,Math.PI], [Math.PI,Math.PI,-Math.PI]];
function output(graph, q, outputId = graph.nodes.at(-1).id) {
  const bindings = Object.fromEntries(q.map((value, index) => ['q' + (index + 1), String(value)]));
  const results = G.evaluateGraph({ ...graph, bindings }, { numeric: true });
  for (const result of results.values()) assert.equal(result.error, null);
  return K.numericMatrix(results.get(outputId).value);
}

test('custom 3R templates identify the exact source and create independent editable graphs', () => {
  assert.deepEqual(P.names, ['custom3r-poe', 'custom3r-dh']);
  for (const name of P.names) {
    const details = P.metadata(name);
    assert.match(details.source, /\/custom_3R\/custom_3R\.urdf$/);
    assert.equal(details.baseFrame, 'base_link'); assert.equal(details.toolFrame, 'tool0');
    assert.match(details.description, /radians/);
    const first = P.create(name), second = P.create(name);
    assert.equal(first.angleUnit, 'rad'); assert.deepEqual(first.bindings, {});
    assert.deepEqual(G.rawSymbols(first), ['q1', 'q2', 'q3']);
    first.nodes[0].label = 'Student edit'; first.bindings.q1 = '1';
    assert.notEqual(second.nodes[0].label, first.nodes[0].label); assert.equal(second.bindings.q1, undefined);
  }
  assert.equal(P.metadata('missing'), null);
  assert.throws(() => P.create('missing'), /Unknown/);
});

test('PoE template contains three space screws and the actual URDF tool home pose', () => {
  const graph = P.create('custom3r-poe');
  assert.deepEqual(graph.nodes.map(node => node.type), ['exponential', 'exponential', 'exponential', 'transform']);
  let home = identity();
  joints.filter(joint => joint.type === 'revolute').forEach((joint, index) => {
    home = multiply(home, origin(joint));
    const r = home.slice(0, 3).map(row => row[3]);
    const omega = home.slice(0, 3).map(row => row.slice(0, 3).reduce((sum, value, k) => sum + value * joint.axis[k], 0));
    const [x, y, z] = omega, [a, b, c] = r;
    const v = [z*b-y*c, x*c-z*a, y*a-x*b];
    close(graph.nodes[index].params.omega.map(Number), omega);
    close(graph.nodes[index].params.v.map(Number), v);
    assert.equal(graph.nodes[index].params.theta, 'q' + (index + 1));
  });
  close(output(graph, [0,0,0]), [[1,0,0,4.5],[0,1,0,1.25],[0,0,1,1.25],[0,0,0,1]]);
  close(graph.nodes[3].params.matrix.map(Number), urdfFK([0,0,0]).flat());
});

test('both custom 3R FK templates match independent URDF FK at multiple joint configurations', () => {
  for (const name of P.names) {
    const graph = P.create(name);
    for (const q of configurations) close(output(graph, q), urdfFK(q));
    const symbolic = G.evaluateGraph(graph).get(graph.nodes.at(-1).id);
    assert.equal(symbolic.error, null);
    assert.deepEqual(K.getSymbols(symbolic.value), ['q1', 'q2', 'q3']);
    close(K.numericMatrix(symbolic.value, { q1: '.3', q2: '-.5', q3: '.8' }), urdfFK([.3,-.5,.8]));
  }
});

test('each of three displayed D-H matrices expands into the four standard operations without changing FK', () => {
  const graph = P.create('custom3r-dh');
  assert.equal(graph.nodes.length, 3);
  assert.deepEqual(graph.nodes.map(node => node.label), ['^0T_1', '^1T_2', '^2T_3']);
  graph.nodes.forEach((node, index) => {
    assert.equal(node.type, 'function'); assert.equal(node.showMatrix, true);
    assert.deepEqual(node.params.definition.parameters, ['q' + (index + 1)]);
    assert.deepEqual(node.params.definition.graph.nodes.map(block => block.type), ['rotation', 'translation', 'translation', 'rotation']);
    const own = G.evaluateGraph(graph).get(node.id).ownValue;
    assert.equal(own.kind, 'transform'); assert.equal(own.matrix.length, 4); assert.equal(own.matrix[0].length, 4);
    const expanded = G.expandFunction(graph, node.id);
    assert.equal(expanded.nodeIds.length, 4); assert.equal(expanded.graph.nodes.length, 6);
    const outputId = index === 2 ? expanded.outputId : 'b3';
    for (const q of configurations) close(output(expanded.graph, q, outputId), urdfFK(q));
  });
  let expanded = graph, outputId;
  for (const node of graph.nodes) {
    const result = G.expandFunction(expanded, node.id);
    expanded = result.graph; outputId = result.outputId;
  }
  assert.equal(expanded.nodes.length, 12); assert.equal(expanded.edges.length, 11);
  for (const q of configurations) close(output(expanded, q, outputId), urdfFK(q));
});

test('either FK template can be saved as a reusable symbolic function and called with new joint values', () => {
  for (const name of P.names) {
    const original = P.create(name);
    const definition = G.functionFromOutput(original, original.nodes.at(-1).id, { id: 'fk_custom3r', name: 'Custom 3R FK' });
    assert.deepEqual(definition.parameters, ['q1', 'q2', 'q3']);
    const graph = { version: 1, name: 'Saved FK', angleUnit: 'rad', edges: [], bindings: {}, nodes: [{
      id: 'fk', type: 'function', label: 'FK(q1, q2, q3)', params: { definition,
        arguments: { q1: 'q1', q2: 'q2', q3: 'q3' } }, position: { x: 0, y: 0 }, showMatrix: true
    }] };
    for (const q of configurations) close(output(graph, q), urdfFK(q));
    const roundTrip = G.validateGraph(JSON.parse(JSON.stringify(graph)));
    close(output(roundTrip, [.3,-.5,.8]), urdfFK([.3,-.5,.8]));
  }
});
