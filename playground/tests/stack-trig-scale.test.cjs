const test = require('node:test');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const M = require('../math.js'), G = require('../graph.js'), P = require('../python.js'), F = require('../files.js');
const node = (id,type,params={}) => ({id,type,label:id,params,position:{x:0,y:0}});
const matrix = (id,values) => node(id,'matrix',{rows:values.length,columns:values[0].length,matrix:values.flat().map(String)});
const graph = (nodes,edges=[]) => G.validateGraph({version:1,nodes,edges,bindings:{},angleUnit:'rad'});
const result = (g,id) => {const r=G.evaluateGraph(g).get(id);assert.equal(r.error,null);return r.value;};
const numeric = (g,id) => M.numericMatrix(result(g,id));
const python = (g,id,check) => execFileSync('python3',['-c',"namespace={'__name__':'test_module'}\nexec("+JSON.stringify(P.generatePython(g,id,{functionName:'calculate'}))+",namespace)\nimport sympy as sp\n"+check],{timeout:30000});

test('stack columns preserves A/B order, dimensions, editable results, files and saved functions',()=>{
  for(const [a,b] of [[[[1],[2]],[[3],[4]]],[[[1,2]],[[3,4,5]]],[[[1,2],[3,4]],[[5],[6]]]]){
    const expected=a.map((row,i)=>[...row,...b[i]]);
    const g=graph([matrix('a',a),matrix('b',b),node('s','stackColumns')],[{from:'b',to:'s',input:'b'},{from:'a',to:'s',input:'a'}]);
    assert.deepEqual(numeric(g,'s'),expected);
    const def=G.functionFromOutput(g,'s',{id:'joined',name:'Joined columns'});
    const saved=graph([node('f','function',{definition:def,arguments:{}})]);
    assert.deepEqual(numeric(saved,'f'),expected);
    const expanded=G.expandFunction(saved,'f');assert.deepEqual(numeric(expanded.graph,expanded.outputId),expected);
    assert.deepEqual(F.readFile(JSON.parse(JSON.stringify(F.workspaceFile(g,[def],'s')))).graph,g);
    const completed=G.completeOperations(g);assert.equal(completed.graph.nodes.length,1);
    assert.equal(completed.graph.nodes[0].label,'s','custom name survives materialization');
    assert.deepEqual(numeric(completed.graph,'s'),expected);
    python(g,'s',"assert namespace['calculate']()==sp.Matrix("+JSON.stringify(expected)+")");
  }
});

test('stack columns rejects missing, unequal-height and oversized inputs',()=>{
  for(const [a,b,pattern] of [[[[1],[2]],[[3]],/same number of rows/],[[Array(12).fill(1)],[[2]],/at most 12 columns/]]){
    const g=graph([matrix('a',a),matrix('b',b),node('s','stackColumns')],[{from:'a',to:'s',input:'a'},{from:'b',to:'s',input:'b'}]);
    assert.match(G.evaluateGraph(g).get('s').error,pattern);
  }
  assert.match(G.evaluateGraph(graph([node('s','stackColumns')])).get('s').error,/Connect/);
});

test('scalar multiplication works before and after row vectors, column vectors and rectangular matrices',()=>{
  for(const values of [[[1,-2,3]],[[1],[-2],[3]],[[1,2,3],[4,5,6]]])for(const before of [true,false]){
    const g=graph([matrix('a',values),node('s','scale',{factor:'-2'})],[before?{from:'s',to:'a'}:{from:'a',to:'s'}]);
    const id=before?'a':'s', expected=values.map(row=>row.map(x=>-2*x));
    assert.deepEqual(numeric(g,id),expected);
    const completed=G.completeOperations(g).graph;
    assert.deepEqual(completed.nodes.map(n=>n.id),[id]);
    assert.equal(completed.nodes[0].type,'matrix');
    assert.deepEqual(completed.edges,[]);
    assert.deepEqual(numeric(completed,id),expected);
    const def=G.functionFromOutput(g,id,{id:'scaled',name:'Scaled'});
    assert.deepEqual(numeric(graph([node('f','function',{definition:def,arguments:{}})]),'f'),expected);
    python(g,id,"assert namespace['calculate']()==sp.Matrix("+JSON.stringify(expected)+")");
  }
});

test('chained factors remain scalar until connected to a matrix and survive reuse',()=>{
  const g=graph([node('a','scale',{factor:'2'}),node('b','scale',{factor:'3'}),matrix('m',[[1,2]])],[{from:'a',to:'b'},{from:'b',to:'m'}]);
  assert.equal(result(g,'b').kind,'multiplier');assert.deepEqual(numeric(g,'m'),[[6,12]]);
  const completed=G.completeOperations(g).graph;
  assert.deepEqual(completed.nodes.map(n=>n.id),['m']);
  assert.deepEqual(numeric(completed,'m'),[[6,12]]);
  python(g,'m',"assert namespace['calculate']()==sp.Matrix([[6,12]])");
});

test('determinants simplify trigonometric squares, products, angle sums and symbolic singularity',()=>{
  const det=matrix=>M.determinant(matrix);
  assert.equal(M.format(det([['cos(t)','-sin(t)'],['sin(t)','cos(t)']])),'1');
  assert.equal(M.format(det([['a*cos(t)','-sin(t)'],['a*sin(t)','cos(t)']])),'a');
  assert.equal(M.format(det([['sin(t)^2+cos(t)^2','1'],['1','1']])),'0');
  const rotation=(axis,angle)=>M.computeBlock({type:'rotation',params:{axis,angle}});
  const product=M.compose(M.compose(rotation(['1','0','0'],'x'),rotation(['0','1','0'],'y')),rotation(['0','0','1'],'z'));
  assert.equal(M.format(det(product.matrix)),'1');
  const jacobian=[['-l1*sin(q1)-l2*sin(q1+q2)','-l2*sin(q1+q2)'],['l1*cos(q1)+l2*cos(q1+q2)','l2*cos(q1+q2)']];
  const simplified=det(jacobian);assert.equal(M.symbols(simplified).includes('q1'),false);
  for(const q2 of [0,.3,-1])assert.ok(Math.abs(M.evaluate(simplified,{l1:2,l2:3,q2})-6*Math.sin(q2))<1e-12);
  assert.ok(Math.abs(M.evaluate(det([['1e-10','0'],['0','1e-10']])) / 1e-20 - 1) < 1e-14); // Keep tiny nonzero values.
  const g=graph([matrix('r',[['cos(t)','-sin(t)'],['sin(t)','cos(t)']]),node('d','determinant')],[{from:'r',to:'d'}]);
  python(g,'d',"t=sp.Symbol('t', real=True)\nassert namespace['calculate'](t)==1");
});
