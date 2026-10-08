const test=require('node:test'),assert=require('node:assert/strict'),D=require('../dh-drag.js');
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-9,`${actual} != ${expected}`);
test('axis dragging finds signed travel from a perspective ray',()=>{
  close(D.axisParameter([0,-5,3],[2,5,-3],[0,0,0],[1,0,0]),2);
  close(D.axisParameter([0,-5,3],[-2,5,-3],[0,0,0],[1,0,0]),-2);
});
test('axis dragging is independent of reference origin and direction magnitude',()=>{
  close(D.axisParameter([4,-2,8],[2,5,-3],[4,3,5],[10,0,0]),2);
  close(D.axisParameter([4,-2,8],[2,5,-3],[4,3,5],[-10,0,0]),-2);
});
test('head-on translation uses a fallback instead of unstable division',()=>{
  assert.equal(D.axisParameter([0,0,3],[0,0,-1],[0,0,0],[0,0,1]),null);
  assert.equal(D.axisParameter([0,0,3],[.00001,0,-1],[0,0,0],[0,0,1]),null);
});
test('rotation follows the right-hand rule about x as well as z',()=>{
  close(D.rotationDelta([0,1,0],[0,0,1],[1,0,0]),Math.PI/2);
  close(D.rotationDelta([0,0,1],[0,1,0],[1,0,0]),-Math.PI/2);
  close(D.rotationDelta([1,0,0],[0,1,0],[0,0,1]),Math.PI/2);
});
test('rotation crosses the angle branch cut continuously and can accumulate turns',()=>{
  const circle=a=>[Math.cos(a),Math.sin(a),0];
  close(D.rotationDelta(circle(179*Math.PI/180),circle(-179*Math.PI/180),[0,0,1]),2*Math.PI/180);
  let total=0;for(let i=0;i<48;i++)total+=D.rotationDelta(circle(i*Math.PI/12),circle((i+1)*Math.PI/12),[0,0,1]);close(total,4*Math.PI);
});
test('rotation ignores displacement along its axis and handles the pivot safely',()=>{
  close(D.rotationDelta([7,2,9],[-3,9,2],[1,0,0]),Math.atan2(-77,36));
  assert.equal(D.rotationDelta([1,0,0],[0,1,0],[1,0,0]),null);
});
