const test=require('node:test');
const assert=require('node:assert/strict');
const G=require('../graph.js');
const M=require('../math.js');
const fixture=(row=false)=>({version:1,name:'Result',angleUnit:'rad',bindings:{},nodes:[
  {id:'a',type:'matrix',label:'A',params:{rows:row?1:3,columns:row?3:1,matrix:['0.1234567890123456','2','3']},position:{x:0,y:0}},
  {id:'b',type:'matrix',label:'B',params:{rows:row?1:3,columns:row?3:1,matrix:['0','5','6']},position:{x:0,y:200}},
  {id:'out',type:'subtract',label:'Subtract vectors',params:{},position:{x:300,y:0},minimized:true},
  {id:'down',type:'scale',label:'Scale',params:{factor:'2'},position:{x:600,y:0}}
],edges:[{from:'a',to:'out',input:'a'},{from:'b',to:'out',input:'b'},{from:'out',to:'down'}]});
const numeric=(g,id)=>G.evaluateGraph(g).get(id).value.matrix.map(row=>row.map(v=>M.evaluate(v)));
for(const row of [false,true])test('editable '+(row?'row':'column')+' result preserves precision, outgoing edges and source graph',()=>{
  const original=fixture(row), snapshot=structuredClone(original), expected=numeric(original,'down');
  const converted=G.materializeResult(original,'out'), out=converted.nodes.find(n=>n.id==='out');
  assert.equal(out.type,'matrix');assert.equal(out.label,row?'Row vector':'Column vector');
  assert.equal(out.minimized,true);assert.deepEqual(out.position,original.nodes[2].position);
  assert.equal(out.params.matrix[0],'0.1234567890123456');
  assert.deepEqual(converted.edges,[{from:'out',to:'down'}]);
  assert.deepEqual(numeric(converted,'down'),expected);assert.deepEqual(original,snapshot);
  assert.deepEqual(numeric(G.validateGraph(JSON.parse(JSON.stringify(converted))),'down'),expected);
});
test('symbolic result becomes independent while preserving expressions',()=>{
  const graph=fixture();graph.nodes[0].params.matrix=['theta','y','z'];
  const converted=G.materializeResult(graph,'out'), source=converted.nodes[0], out=converted.nodes[2];
  assert.deepEqual(source.params.matrix,['theta','y','z']);
  assert.deepEqual(G.rawSymbols(out).sort(),['theta_2','y_2','z_2']);
  assert.equal(M.evaluate(out.params.matrix[1],{y_2:8}),3);
});
test('invalid or incomplete operations cannot become editable results',()=>{
  const graph=fixture();graph.edges=graph.edges.filter(e=>e.input!=='b');
  assert.throws(()=>G.materializeResult(graph,'out'),/Connect a matrix to b/);
  assert.throws(()=>G.materializeResult(graph,'a'),/operation result/);
  const wrong=fixture();wrong.nodes[1].params={rows:1,columns:3,matrix:['1','2','3']};
  assert.throws(()=>G.materializeResult(wrong,'out'),/orientation/);
});
test('complete calculation leaves only its final result',()=>{
  const graph=fixture(), {graph:completed}=G.completeOperations(graph);
  assert.equal(completed.nodes.length,1);assert.equal(completed.nodes[0].id,'down');assert.equal(completed.nodes[0].type,'matrix');
  assert.deepEqual(completed.edges,[]);assert.deepEqual(numeric(completed,'down'),numeric(graph,'down'));
});
test('shared inputs and their dependencies stay available to other calculations',()=>{
  const graph=fixture();graph.nodes[3].params.factor='';
  graph.nodes.push({id:'other',type:'subtract',label:'Other',params:{},position:{x:900,y:0}});
  graph.edges.push({from:'a',to:'other',input:'a'});
  const result=G.completeOperations(graph).graph;
  assert.deepEqual(result.nodes.map(n=>n.id),['a','out','down','other']);
  assert.deepEqual(result.edges,[{from:'out',to:'down'},{from:'a',to:'other',input:'a'}]);
  assert.equal(result.nodes.find(n=>n.id==='out').minimized,undefined);
});
test('exclusive input chain disappears while unrelated blocks remain',()=>{
  const graph=fixture();graph.nodes.pop();graph.edges=graph.edges.filter(e=>e.to!=='down');
  graph.nodes.unshift({id:'up',type:'matrix',label:'Upstream',params:{rows:3,columns:3,matrix:['1','0','0','0','1','0','0','0','1']},position:{x:-200,y:0}});
  graph.edges.push({from:'up',to:'a'});
  graph.nodes.push({id:'unrelated',type:'matrix',label:'Unrelated',params:{rows:1,columns:1,matrix:['42']},position:{x:900,y:0}});
  const result=G.completeOperations(graph).graph;
  assert.deepEqual(result.nodes.map(n=>n.id),['out','unrelated']);assert.deepEqual(result.edges,[]);
  assert.deepEqual(numeric(result,'out'),numeric(graph,'out'));
});
test('incomplete operations retain their inputs, symbols survive complete operations',()=>{
  const graph=fixture();graph.nodes[3].params.factor='';graph.nodes[0].params.matrix=['theta','y','z'];
  const complete=G.completeOperations(graph).graph;
  assert.deepEqual(G.rawSymbols(complete.nodes.find(n=>n.id==='out')).sort(),['theta','y','z']);
  const incomplete=fixture();incomplete.edges=incomplete.edges.filter(e=>e.input!=='b');
  assert.equal(G.completeOperations(incomplete).graph,incomplete);
});

test('leading scalar materializes rotations, translations, transforms, exponentials and saved functions',()=>{
  const definition={version:1,id:'vector_fn',name:'Vector',kind:'matrix',angleUnit:'rad',parameters:['x'],defaults:{},outputKind:'matrix',matrix:[['x'],['2*x']]};
  const operands=[
    {type:'rotation',params:{axis:['0','0','1'],angle:'pi/2'}},
    {type:'translation',params:{vector:['1','2','3']}},
    {type:'transform',params:{matrix:['1','0','0','1','0','1','0','2','0','0','1','3','0','0','0','1']}},
    {type:'exponential',params:{omega:['0','0','0'],v:['1','0','0'],theta:'2'}},
    {type:'function',params:{definition,arguments:{x:'3'}}}
  ];
  for(const operand of operands){
    const graph={version:1,nodes:[
      {id:'scalar',type:'scale',label:'Scalar multiplier',params:{factor:'2'},position:{x:0,y:0}},
      {id:'entity',...operand,label:'My entity',position:{x:300,y:50}}
    ],edges:[{from:'scalar',to:'entity'}],bindings:{}};
    const original=structuredClone(graph), expected=numeric(graph,'entity');
    const {graph:completed}=G.completeOperations(graph);
    assert.equal(completed.nodes.length,1);
    assert.equal(completed.nodes[0].type,'matrix');
    assert.equal(completed.nodes[0].label,'My entity');
    assert.deepEqual(completed.nodes[0].position,{x:300,y:50});
    assert.deepEqual(completed.edges,[]);
    assert.deepEqual(numeric(completed,'entity'),expected);
    assert.deepEqual(graph,original);
  }
});

test('leading scalar conversion retains shared factors and outgoing connections',()=>{
  const graph={version:1,nodes:[
    {id:'factor',type:'scale',label:'Factor',params:{factor:'k'},position:{x:0,y:0}},
    {id:'a',type:'matrix',label:'A',params:{rows:1,columns:2,matrix:['1','2']},position:{x:300,y:0}},
    {id:'b',type:'matrix',label:'B',params:{rows:2,columns:1,matrix:['3','4']},position:{x:600,y:0}},
    {id:'pending',type:'matrix',label:'Pending',params:{rows:1,columns:1,matrix:['']},position:{x:300,y:200}}
  ],edges:[{from:'factor',to:'a'},{from:'factor',to:'pending'},{from:'a',to:'b'}],bindings:{}};
  const completed=G.completeOperations(graph).graph;
  assert.deepEqual(completed.nodes.map(n=>n.id),['factor','a','b','pending']);
  assert.deepEqual(completed.edges,[{from:'factor',to:'pending'},{from:'a',to:'b'}]);
  const result=G.evaluateGraph(completed).get('b');assert.equal(result.error,null);
  const parameter=G.rawSymbols(completed.nodes.find(n=>n.id==='a'))[0];
  assert.equal(M.evaluate(result.value.matrix[0][0],{[parameter]:2}),22);
  assert.equal(completed.nodes.find(n=>n.id==='factor').type,'scale');
  assert.ok(G.evaluateGraph(completed).get('pending').error);
});
