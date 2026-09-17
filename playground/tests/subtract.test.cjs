const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const K = require('../math.js');
const G = require('../graph.js');
const P = require('../python.js');
const node = (id, type, params = {}) => ({id, type, label:id, params, position:{x:0,y:0}});
const matrix = (id, values) => node(id, 'matrix', {rows:values.length,columns:values[0].length,matrix:values.flat().map(String)});
const graph = (a,b) => ({version:1,name:'Difference',angleUnit:'rad',bindings:{x:'7'},nodes:[matrix('a',a),matrix('b',b),node('difference','subtract')],edges:[{from:'b',to:'difference',input:'b'},{from:'a',to:'difference',input:'a'}]});

for (const orientation of ['row','column']) {
  test(`subtract ${orientation} vectors symbolically, numerically, as a saved block, and in Python`, () => {
    const shape = a => orientation==='row'?[a]:a.map(v=>[v]);
    const source = graph(shape(['x',-2,4,0]),shape([3,-2,9,-1]));
    const expected = shape([4,0,-5,1]);
    const cleaned = G.validateGraph(JSON.parse(JSON.stringify(source)));
    for (const numeric of [false,true]) {
      const result=G.evaluateGraph(cleaned,{numeric}).get('difference');
      assert.equal(result.error,null);
      assert.deepEqual(K.numericMatrix(result.value,{x:7}),expected);
    }
    const definition=G.functionFromOutput(cleaned,'difference',{id:'difference_fn',name:'difference_fn'});
    const saved={...cleaned,nodes:[node('call','function',{definition,arguments:{x:'7'}})],edges:[]};
    assert.deepEqual(K.numericMatrix(G.evaluateGraph(saved).get('call').value),expected);
    const expanded=G.expandFunction(saved,'call');
    assert.deepEqual(K.numericMatrix(G.evaluateGraph(expanded.graph).get(expanded.outputId).value),expected);
    const code=P.generatePython(cleaned,'difference',{functionName:'difference'});
    execFileSync('python3',['-c',`namespace={'__name__':'test_module'}\nexec(${JSON.stringify(code)},namespace)\nimport sympy as sp\nassert namespace['difference'](7)==sp.Matrix(${JSON.stringify(expected)})`]);
  });
}

test('subtraction rejects missing operands, mismatched lengths/orientations, matrices, and scalar inputs', () => {
  const missing=graph([[1,2]],[[3,4]]);missing.edges.pop();
  assert.match(G.evaluateGraph(missing).get('difference').error,/Connect.*a/);
  for(const [a,b,pattern] of [
    [[[1,2]],[[3]],/same length and orientation/],
    [[[1,2]],[[3],[4]],/same length and orientation/],
    [[[1,2],[3,4]],[[1,2],[3,4]],/row or column vectors/]
  ]) {
    const source=graph(a,b),result=G.evaluateGraph(source).get('difference');
    assert.equal(result.value,null);assert.match(result.error,pattern);
    const code=P.generatePython(source,'difference',{functionName:'difference'});
    execFileSync('python3',['-c',`namespace={'__name__':'test_module'}\nexec(${JSON.stringify(code)},namespace)\ntry:\n namespace['difference']()\nexcept ValueError:\n pass\nelse:\n raise AssertionError('Invalid subtraction accepted')`]);
  }
  assert.throws(()=>K.computeBlock(node('s','subtract'),{a:{kind:'scalar',matrix:[[K.num(1)]]},b:K.computeBlock(matrix('b',[[2]]))}),/scalar/);
});
