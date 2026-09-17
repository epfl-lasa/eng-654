const test=require('node:test');
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const M=require('../math.js'),G=require('../graph.js'),F=require('../files.js'),P=require('../python.js'),I=require('../python-import.js');
const node=(id,type,params={})=>({id,type,label:id,params,position:{x:0,y:0}});
const matrix=(id,values)=>node(id,'matrix',{rows:values.length,columns:values[0].length,matrix:values.flat().map(String)});
const graph=(nodes,edges=[],bindings={})=>G.validateGraph({version:1,name:'Vector arithmetic',angleUnit:'rad',nodes,edges,bindings});
function output(g,id,numeric=true){const result=G.evaluateGraph(g,{numeric}).get(id);assert.equal(result.error,null);return M.numericMatrix(result.value,g.bindings);}
function python(g,id,check){
  const code=P.generatePython(g,id,{functionName:'calculate'});
  execFileSync('python3',['-c',"namespace={'__name__':'test_module'}\nexec("+JSON.stringify(code)+",namespace)\nimport sympy as sp\n"+check]);
  return code;
}

for(const orientation of ['row','column'])test('add and scale '+orientation+' vectors through saved functions, files and Python',async()=>{
  const shape=a=>orientation==='row'?[a]:a.map(v=>[v]);
  const g=graph([matrix('a',shape(['x',-2,4,0])),matrix('b',shape([3,-2,9,-1])),node('sum','add'),node('scaled','scale',{factor:'\\alpha_{2}'})],
    [{from:'b',to:'sum',input:'b'},{from:'a',to:'sum',input:'a'},{from:'sum',to:'scaled'}],{x:'7',alpha_2:'-2'});
  const expected=shape([-20,8,-26,2]);
  assert.deepEqual(output(g,'sum'),shape([10,-4,13,-1]));
  for(const numeric of [false,true])assert.deepEqual(output(g,'scaled',numeric),expected);
  const def=G.functionFromOutput(g,'scaled',{id:'linear',name:'Linear combination'});
  assert.deepEqual(def.parameters,['alpha_2','x']);
  const call=graph([node('call','function',{definition:def,arguments:{alpha_2:'-2',x:'7'}})]);
  assert.deepEqual(output(call,'call'),expected);
  const expanded=G.expandFunction(call,'call');
  assert.deepEqual(output(expanded.graph,expanded.outputId),expected);
  const restored=F.readFile(JSON.parse(JSON.stringify(F.workspaceFile(g,[def],'scaled'))));
  assert.deepEqual(restored.graph,g);assert.deepEqual(restored.library,[def]);
  const code=python(g,'scaled',"assert namespace['calculate'](-2,7)==sp.Matrix("+JSON.stringify(expected)+")");
  const imported=await I.importSource(code);
  assert.ok(imported.parameters.includes('alpha_2'));
  const importedCall=graph([node('imported','function',{definition:imported,arguments:{alpha_2:'-2',x:'7'}})]);
  assert.deepEqual(output(importedCall,'imported'),expected);
});

test('scaling preserves rectangular dimensions, zero and negative factors, and yields a general matrix',()=>{
  const values=[[1,-2,0],[4,0.5,6]];
  for(const factor of ['0','-2','1/2']){
    const g=graph([matrix('a',values),node('s','scale',{factor})],[{from:'a',to:'s'}]);
    assert.deepEqual(output(g,'s'),values.map(row=>row.map(v=>v*Number(M.evaluate(factor))||0)));
    assert.equal(G.evaluateGraph(g).get('s').value.kind,'matrix');
  }
  const transform=node('pose','transform',{matrix:['1','0','0','1','0','1','0','2','0','0','1','3','0','0','0','1']});
  const g=graph([transform,node('s','scale',{factor:'2'}),node('inv','inverse')],[{from:'pose',to:'s'},{from:'s',to:'inv'}]);
  assert.deepEqual(output(g,'s'),[[2,0,0,2],[0,2,0,4],[0,0,2,6],[0,0,0,2]]);
  assert.match(G.evaluateGraph(g).get('inv').error,/general matrix/);
});

test('addition rejects incompatible vectors and missing or scalar inputs',()=>{
  const missing=graph([node('sum','add')]);assert.match(G.evaluateGraph(missing).get('sum').error,/Connect/);
  for(const [a,b,pattern] of [
    [[[1,2]],[[3]],/length and orientation/],
    [[[1,2]],[[3],[4]],/length and orientation/],
    [[[1,2],[3,4]],[[1,2],[3,4]],/row or column/]
  ]){
    const g=graph([matrix('a',a),matrix('b',b),node('sum','add')],[{from:'a',to:'sum',input:'a'},{from:'b',to:'sum',input:'b'}]);
    assert.match(G.evaluateGraph(g).get('sum').error,pattern);
    python(g,'sum',"try:\n namespace['calculate']()\nexcept ValueError:\n pass\nelse:\n raise AssertionError('Invalid addition accepted')");
  }
  const g=graph([matrix('a',[[2]]),node('det','determinant'),node('sum','add')],[{from:'a',to:'det'},{from:'a',to:'sum',input:'a'},{from:'det',to:'sum',input:'b'}]);
  assert.match(G.evaluateGraph(g).get('sum').error,/scalar/);
});

test('scalar multiplier validates its factor and input in the browser engine and Python',()=>{
  assert.throws(()=>graph([node('s','scale',{factor:2})]),/Scalar factor/);
  const missing=graph([node('s','scale',{factor:'2'})]);assert.match(G.evaluateGraph(missing).get('s').error,/Connect/);
  assert.throws(()=>P.generatePython(missing,'s'),/input|unconnected/i);
  const scalar=graph([matrix('a',[[2]]),node('det','determinant'),node('s','scale',{factor:'2'})],[{from:'a',to:'det'},{from:'det',to:'s'}]);
  assert.match(G.evaluateGraph(scalar).get('s').error,/scalar/);
  python(scalar,'s',"try:\n namespace['calculate']()\nexcept ValueError:\n pass\nelse:\n raise AssertionError('Scalar input accepted')");
  const invalid=graph([matrix('a',[[2]]),node('s','scale',{factor:'2/**'})],[{from:'a',to:'s'}]);
  assert.ok(G.evaluateGraph(invalid).get('s').error);
});

test('factors have independent block scope and Python input argument names cannot collide',()=>{
  const g=graph([matrix('a',[[1,2]]),node('s1','scale',{factor:'k'}),node('s2','scale',{factor:'k'})],[{from:'a',to:'s1'},{from:'a',to:'s2'}]);
  G.isolateSymbols(g);assert.equal(g.nodes[2].params.factor,'k_2');
  g.bindings={k:'2',k_2:'-1'};
  assert.deepEqual(output(g,'s1'),[[2,4]]);assert.deepEqual(output(g,'s2'),[[-1,-2]]);
  const collision=graph([matrix('a',[[2,3]]),node('s','scale',{factor:'input_1'})],[{from:'a',to:'s'}]);
  python(collision,'s',"assert namespace['calculate'](4)==sp.Matrix([[8,12]])");
});

test('combining a complete scalar multiplication preserves output and rejects incomplete input capture',()=>{
  const g=graph([matrix('a',[[1,2],[3,4]]),matrix('b',[[1,0],[0,1]]),node('s','scale',{factor:'2'})],[{from:'a',to:'b'},{from:'b',to:'s'}]);
  assert.throws(()=>G.groupSelection(g,['b','s'],{id:'bad',nodeId:'bad'}),/complete input chain/);
  const grouped=G.groupSelection(g,['a','b','s'],{id:'complete',nodeId:'combined'});
  assert.deepEqual(output(grouped.graph,grouped.nodeId),output(g,'s'));
});
