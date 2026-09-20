const test=require('node:test');
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const G=require('../graph.js'),M=require('../math.js'),F=require('../files.js'),P=require('../python.js');
const I=require('../python-import.js');
const block=(id,type,params)=>({id,type,label:id,params,position:{x:0,y:0}});
const fixture=()=>G.completeOperations(G.validateGraph({nodes:[
  block('k1','scale',{factor:'k1'}),block('k2','scale',{factor:'k2'}),
  block('m','matrix',{rows:3,columns:2,matrix:['x_1','x_10','y_1','y_10','z_1','z_10']})
],edges:[{from:'k1',to:'k2'},{from:'k2',to:'m'}],bindings:{}})).graph;
const output=g=>{const r=G.evaluateGraph(g).get('m');assert.equal(r.error,null);return M.numericMatrix(r.value);};

test('merged factors and matrix symbols remain independently editable after numeric substitution',()=>{
  const graph=fixture(),node=graph.nodes[0];
  assert.equal(graph.nodes.length,1);
  assert.deepEqual(Object.keys(G.matrixSymbolFields(node)),['k1','k2','x_1','x_10','y_1','y_10','z_1','z_10']);
  const values={k1:'2',k2:'3',x_1:'1',x_10:'10',y_1:'2',y_10:'20',z_1:'3',z_10:'30'};
  for(const [name,value] of Object.entries(values))G.setMatrixSymbol(node,name,value);
  assert.deepEqual(output(graph),[[6,60],[12,120],[18,180]]);
  G.setMatrixSymbol(node,'k1','4');assert.deepEqual(output(graph),[[12,120],[24,240],[36,360]]);
  G.setMatrixSymbol(node,'k2','0');assert.deepEqual(output(graph),[[0,0],[0,0],[0,0]]);
  G.setMatrixSymbol(node,'k2','3');assert.deepEqual(output(graph),[[12,120],[24,240],[36,360]]);
  assert.equal(G.matrixSymbolFields(node).k1,'4');
  assert.equal(G.matrixSymbolFields(node).x_10,'10');
  const restored=F.readFile(JSON.parse(JSON.stringify(F.workspaceFile(graph,[],'m')))).graph;
  assert.deepEqual(restored,graph);
  G.setMatrixSymbol(restored.nodes[0],'k1','5');assert.deepEqual(output(restored),[[15,150],[30,300],[45,450]]);
});

test('symbol fields support Greek expressions, incomplete drafts and restoring symbols',()=>{
  const graph=fixture(),node=graph.nodes[0];
  G.setMatrixSymbol(node,'k1','\\alpha_{2}');
  G.setMatrixSymbol(node,'k2','sin(pi/2)');
  assert.ok(G.rawSymbols(node).includes('alpha_2'));
  G.setMatrixSymbol(node,'k1','');assert.ok(G.evaluateGraph(graph).get('m').error);
  assert.equal(G.validateGraph(graph).nodes[0].params.symbolEditor.arguments.k1,'');
  G.setMatrixSymbol(node,'k1','k1');assert.ok(G.rawSymbols(node).includes('k1'));
  assert.throws(()=>G.setMatrixSymbol(node,'missing','2'),/Choose a symbol/);
  assert.throws(()=>G.setMatrixSymbol(node,'k1',2),/must be text/);
});

test('symbol substitution preserves scientific notation and function calls',()=>{
  const node=block('m','matrix',{rows:1,columns:4,matrix:['e','1e-10','sin(q)','sin']});
  G.setMatrixSymbol(node,'e','2');G.setMatrixSymbol(node,'sin','3');G.setMatrixSymbol(node,'q','pi/2');
  assert.deepEqual(output({nodes:[node],edges:[],bindings:{}}),[[2,1e-10,1,3]]);
});

test('copied merged symbol inputs stay isolated and saved functions retain the editor',async()=>{
  const graph=fixture(),node=graph.nodes[0];
  G.setMatrixSymbol(node,'k1','2');
  const copy=structuredClone(node);copy.id='copy';graph.nodes.push(copy);G.isolateSymbols(graph);
  assert.equal(G.matrixSymbolFields(copy).k1,'2');
  assert.notEqual(G.matrixSymbolFields(copy).x_1,G.matrixSymbolFields(node).x_1);
  assert.deepEqual(G.validateGraph(graph),graph);
  G.setMatrixSymbol(copy,'k1','7');assert.equal(G.matrixSymbolFields(node).k1,'2');
  const def=G.functionFromOutput(graph,'copy',{id:'saved',name:'Saved matrix'});
  const call=G.validateGraph({nodes:[block('fn','function',{definition:def,arguments:Object.fromEntries(def.parameters.map(name=>[name,'1']))})],edges:[]});
  const expanded=G.expandFunction(call,'fn');
  const result=expanded.graph.nodes.find(n=>n.id===expanded.outputId);
  assert.equal(G.matrixSymbolFields(result).k1,'7');
  assert.deepEqual(M.numericMatrix(G.evaluateGraph(expanded.graph).get(result.id).value),[[7,7],[7,7],[7,7]]);
  const code=P.generatePython(graph,'copy',{functionName:'calculate'});
  execFileSync('python3',['-c',"namespace={'__name__':'test_module'}\nexec("+JSON.stringify(code)+",namespace)\nimport sympy as sp\nassert namespace['calculate'](*([1]*"+def.parameters.length+"))==sp.Matrix([[7,7],[7,7],[7,7]])"],{timeout:30000});
  const imported=await I.importSource(code);
  assert.deepEqual(imported.graph.nodes[0].params.symbolEditor,copy.params.symbolEditor);
});

test('invalid matrix symbol metadata is rejected without trusting cached matrix entries',()=>{
  const graph=fixture(),node=graph.nodes[0];G.setMatrixSymbol(node,'k1','2');
  const invalid=structuredClone(graph);invalid.nodes[0].params.symbolEditor.matrix.pop();
  assert.throws(()=>G.validateGraph(invalid),/entries/);
  invalid.nodes[0].params.symbolEditor={matrix:node.params.matrix,arguments:JSON.parse('{"__proto__":"2"}')};
  assert.throws(()=>G.validateGraph(invalid),/symbol name/);
  node.params.matrix.fill('0');
  assert.ok(G.validateGraph(graph).nodes[0].params.matrix.some(entry=>entry!=='0'));
});
