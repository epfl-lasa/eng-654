const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../math.js');
const G = require('../graph.js');
const P = require('../python.js');
const node = (id, angle) => ({id, type:'rotation', label:id, position:{x:0,y:0}, params:{axis:['0','0','1'],angle}});

test('Greek names, Unicode, LaTeX commands and braced subscripts use the same parser', () => {
  for (const [name, glyph] of Object.entries(M.GREEK)) {
    assert.equal(M.parse(name + '_12').name, name + '_12');
    assert.equal(M.parse('\\' + name + '_{12}').name, name + '_12');
    assert.equal(M.parse(glyph + '_12').name, name + '_12');
    assert.equal(M.pretty(name + '_12'), glyph + '₁₂');
    assert.equal(M.tex(name + '_12'), '\\' + name + '_{12}');
  }
  assert.equal(M.evaluate('\\frac{\\pi}{2}'), Math.PI/2);
  assert.equal(M.evaluate('\\sin(\\theta_{2})', {theta_2:Math.PI/2}), 1);
  assert.equal(M.evaluate('\\sqrt{9} + 2^{3}'), 11);
  assert.deepEqual(M.symbols('alpha_2 + \\phi_{12} + theta_2'), ['alpha_2','phi_12','theta_2']);
  assert.throws(() => M.parse('\\unknown{2}'), /Unexpected character/);
});

test('colliding symbols are isolated per block, persist and keep independent numeric output', () => {
  const graph = G.validateGraph({nodes:[node('a','\\theta_{2}'),node('b','theta_2'),node('c','theta_2_2')],edges:[],bindings:{theta_2:'pi/6'}});
  G.isolateSymbols(graph);
  assert.deepEqual(graph.nodes.map(n=>G.rawSymbols(n)), [['theta_2'],['theta_2_3'],['theta_2_2']]);
  graph.bindings.theta_2_3='pi/2';
  const result=G.evaluateGraph(graph,{numeric:true});
  assert.ok(Math.abs(M.evaluate(result.get('a').value.matrix[0][0])-Math.sqrt(3)/2)<1e-12);
  assert.ok(Math.abs(M.evaluate(result.get('b').value.matrix[0][0]))<1e-12);
  assert.deepEqual(G.isolateSymbols(graph), []);
  assert.deepEqual(G.validateGraph(JSON.parse(JSON.stringify(graph))), graph);
  assert.match(P.generatePython(graph,'b'), /theta_2_3/);
});

test('editing an earlier block preserves the other owner and repeated uses within one block', () => {
  const graph=G.validateGraph({nodes:[node('a','2*phi_12'),node('b','phi_12')],edges:[],bindings:{phi_12:'0.4'}});
  graph.nodes[0].params.axis=['phi_12','0','1'];
  G.isolateSymbols(graph,'a');
  assert.equal(graph.nodes[0].params.angle,'2*phi_12_2');
  assert.equal(graph.nodes[0].params.axis[0],'phi_12_2');
  assert.equal(graph.nodes[1].params.angle,'phi_12');
});

test('function instances isolate exposed arguments without renaming internal parameters', () => {
  const source=G.validateGraph({nodes:[node('a','theta')],edges:[],bindings:{theta:'0.2'}});
  const definition=G.functionFromOutput(source,'a',{id:'turn',name:'Turn'});
  source.nodes.push({id:'b',type:'function',label:'Turn',position:{x:100,y:0},params:{definition,arguments:{theta:'theta'}}});
  G.isolateSymbols(source);
  assert.equal(source.nodes[1].params.arguments.theta,'theta_2');
  assert.equal(definition.graph.nodes[0].params.angle,'theta');
  source.bindings.theta_2='0.7';
  const expanded=G.expandFunction(source,'b');
  G.isolateSymbols(expanded.graph);
  assert.deepEqual(G.rawSymbols(expanded.graph.nodes.find(n=>n.id===expanded.outputId)),['theta_2']);
});
