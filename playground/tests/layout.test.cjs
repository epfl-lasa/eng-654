const test=require('node:test');
const assert=require('node:assert/strict');
const G=require('../graph.js');
const node=id=>({id,position:{x:10000,y:-10000}});
function checkLayout(graph,sizes=new Map(),aspect=1.5){
  const original=JSON.stringify(graph),positions=G.layoutPositions(graph,sizes,aspect);
  assert.equal(JSON.stringify(graph),original,'layout leaves graph data intact');
  assert.equal(positions.size,graph.nodes.length);
  const size=id=>sizes.get(id)||{width:196,height:154};
  for(const a of graph.nodes){
    const p=positions.get(a.id),s=size(a.id);assert.ok(Number.isFinite(p.x)&&Number.isFinite(p.y));
    for(const b of graph.nodes){if(a===b)continue;const q=positions.get(b.id),t=size(b.id);
      assert.ok(p.x+s.width<=q.x||q.x+t.width<=p.x||p.y+s.height<=q.y||q.y+t.height<=p.y,`${a.id} overlaps ${b.id}`);
    }
  }
  for(const edge of graph.edges)assert.ok(positions.get(edge.from).x+size(edge.from).width<positions.get(edge.to).x);
  assert.deepEqual(G.layoutPositions({...graph,nodes:graph.nodes.map(n=>({...n,position:positions.get(n.id)}))},sizes,aspect),positions);
  return positions;
}
test('branched DAG and multiple input ports lay out without overlaps, using measured block sizes',()=>{
  const graph={nodes:['out','a','b','c','d'].map(node),edges:[{from:'a',to:'b'},{from:'a',to:'c'},{from:'b',to:'out',input:'a'},{from:'c',to:'out',input:'b'},{from:'d',to:'c'}]};
  checkLayout(graph,new Map([['a',{width:350,height:270}],['c',{width:420,height:500}]]));
});
test('disconnected blocks pack into rows and empty/single canvases are valid',()=>{
  assert.equal(checkLayout({nodes:[],edges:[]}).size,0);
  assert.deepEqual(checkLayout({nodes:[node('one')],edges:[]}).get('one'),{x:0,y:0});
  const positions=checkLayout({nodes:Array.from({length:20},(_,i)=>node(String(i))),edges:[]});
  assert.ok(new Set([...positions.values()].map(p=>p.x)).size>1);
  assert.ok(new Set([...positions.values()].map(p=>p.y)).size>1);
});
test('120-block chains and disconnected calculations stay deterministic and preserve dependencies',()=>{
  const nodes=Array.from({length:120},(_,i)=>node(String(i)));
  checkLayout({nodes,edges:nodes.slice(1).map((n,i)=>({from:String(i),to:n.id}))},new Map(),0.5);
  checkLayout({nodes,edges:nodes.slice(1).filter((_,i)=>i%4!==0).map(n=>({from:String(Number(n.id)-1),to:n.id}))},new Map(),2);
});
