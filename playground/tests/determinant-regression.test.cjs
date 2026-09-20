const test=require('node:test');
const assert=require('node:assert/strict');
const M=require('../math.js'),G=require('../graph.js'),P=require('../presets.js');

// Independent cofactor expansion: no playground determinant or simplifier.
function cofactorDet(matrix){
  if(matrix.length===1)return matrix[0][0];
  return matrix[0].reduce((sum,entry,column)=>sum+(column%2?-1:1)*entry*
    cofactorDet(matrix.slice(1).map(row=>row.filter((_,j)=>j!==column))),0);
}
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-9*(1+Math.abs(expected)),`${actual} != ${expected}`);
const configurations=[{q1:0,q2:0,q3:0},{q1:.2,q2:-.7,q3:1.3},{q1:-1.2,q2:.4,q3:-2.1}];

for(const name of P.names)test(name+' pose determinant is one, including after expansion',()=>{
  let graph=P.create(name);
  graph.nodes.push({id:'det',type:'determinant',label:'Determinant',params:{},position:{x:1400,y:0}});
  graph.edges.push({from:graph.nodes.at(-2).id,to:'det'});
  for(const expand of [false,true]){
    if(expand)for(const node of [...graph.nodes])if(node.type==='function')graph=G.expandFunction(graph,node.id).graph;
    const symbolic=G.evaluateGraph(graph).get('det');assert.equal(symbolic.error,null);
    assert.equal(M.format(symbolic.value.matrix[0][0]),'1');
    for(const bindings of configurations){
      const numeric=G.evaluateGraph({...graph,bindings:Object.fromEntries(Object.entries(bindings).map(([k,v])=>[k,String(v)]))},{numeric:true});
      const source=graph.edges.find(edge=>edge.to==='det').from;
      const expected=cofactorDet(M.numericMatrix(numeric.get(source).value));
      near(expected,1);near(M.evaluate(numeric.get('det').value.matrix[0][0]),expected);
    }
  }
});

test('scaled or singular versions of the 3R pose are not simplified to one',()=>{
  const graph=P.create('custom3r-dh'),T=G.evaluateGraph(graph).get('b3').value;
  const scaled=M.computeBlock({type:'scale',params:{factor:'k'}},T);
  const det=M.determinant(scaled.matrix);
  assert.deepEqual(M.symbols(det),['k']);
  for(const k of [0,2,-3])near(M.evaluate(det,{k}),k**4);
  const duplicate=T.matrix.map(row=>[...row]);duplicate[1]=[...duplicate[0]];
  assert.equal(M.evaluate(M.determinant(duplicate)),0);
  const swap=T.matrix.map(row=>[...row]);[swap[0],swap[1]]=[swap[1],swap[0]];
  assert.equal(M.evaluate(M.determinant(swap)),-1);
});

// Position Jacobian d(T[0:3,3])/d(q1,q2,q3), independently differentiated
// from the preset's standard D-H matrices using exact rational lengths.
const jacobian=[
  [
    "-sin(q1)*sin(q2)/4 - 3*sin(q1)*cos(q2)*cos(q3)/2 - 2*sin(q1)*cos(q2) - sin(q1) - 3*sin(q3)*cos(q1)/2 - 5*cos(q1)/4",
    "-3*sin(q2)*cos(q1)*cos(q3)/2 - 2*sin(q2)*cos(q1) + cos(q1)*cos(q2)/4",
    "-3*sin(q1)*cos(q3)/2 - 3*sin(q3)*cos(q1)*cos(q2)/2"
  ],
  [
    "-3*sin(q1)*sin(q3)/2 - 5*sin(q1)/4 + sin(q2)*cos(q1)/4 + 3*cos(q1)*cos(q2)*cos(q3)/2 + 2*cos(q1)*cos(q2) + cos(q1)",
    "-3*sin(q1)*sin(q2)*cos(q3)/2 - 2*sin(q1)*sin(q2) + sin(q1)*cos(q2)/4",
    "-3*sin(q1)*sin(q3)*cos(q2)/2 + 3*cos(q1)*cos(q3)/2"
  ],
  [
    "0",
    "-sin(q2)/4 - 3*cos(q2)*cos(q3)/2 - 2*cos(q2)",
    "3*sin(q2)*sin(q3)/2"
  ]
];
test('3R position Jacobian has its own configuration-dependent determinant',()=>{
  const matrix=jacobian.map(row=>row.map(M.parse)),det=M.determinant(matrix);
  assert.notEqual(M.format(det),'1');
  assert.equal(M.evaluate(det,configurations[0]),-105/16);
  for(const bindings of configurations)near(M.evaluate(det,bindings),cofactorDet(M.numericMatrix(matrix,bindings)));
  assert.notEqual(M.evaluate(det,configurations[0]),M.evaluate(det,configurations[1]));
});

test('trigonometric simplification agrees with independent determinants across general matrices',()=>{
  let seed=7281;
  const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32);
  const entries=['sin(q)','cos(q)','sin(r)','cos(r)','sin(q+r)','cos(q-r)','2*sin(q)','cos(q)^2','sin(r)^2','1','-2','0','a','a*cos(q)','sin(q)*cos(r)'];
  for(let i=0;i<240;i++){
    const n=2+i%3,matrix=Array.from({length:n},()=>Array.from({length:n},()=>M.parse(entries[Math.floor(random()*entries.length)])));
    const det=M.determinant(matrix);
    for(let j=0;j<3;j++){
      const bindings={q:random()*4-2,r:random()*4-2,a:random()*4-2};
      near(M.evaluate(det,bindings),cofactorDet(M.numericMatrix(matrix,bindings)));
    }
  }
});
