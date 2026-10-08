const test=require('node:test'),assert=require('node:assert/strict');
require('../dh-model.js');const Measure=require('../dh-measurements.js');
const point=origin=>({type:'point',origin}),line=(origin,direction)=>({type:'line',origin,direction});
const close=(value,expected)=>assert.ok(Math.abs(value-expected)<1e-9,`${value} != ${expected}`);
test('point distances preserve signed components in selection order',()=>{
  const axes=[{label:'z0',direction:[0,0,1]},{label:'x1',direction:[1,0,0]}];
  const first=point([1,2,3]),second=point([4,6,3]),result=Measure.distance(first,second,axes);
  close(result.distance,5);assert.deepEqual(result.displacement,[3,4,0]);close(result.projections[1].value,3);
  close(Measure.distance(second,first,axes).projections[1].value,-3);
});
test('point-to-axis distances use infinite lines and work in either selection order',()=>{
  const p=point([3,2,1]),axis=line([0,0,0],[0,0,4]),result=Measure.distance(p,axis);
  close(result.distance,Math.sqrt(13));assert.deepEqual(result.end,[0,0,1]);
  assert.deepEqual(Measure.distance(axis,p).start,[0,0,1]);
});
test('parallel and antiparallel axes give their perpendicular separation',()=>{
  for(const sign of [1,-1])close(Measure.distance(line([0,0,1],[0,0,1]),line([3,4,8],[0,0,sign])).distance,5);
});
test('skew and intersecting axes use their closest points',()=>{
  close(Measure.distance(line([0,0,0],[1,0,0]),line([0,0,2],[0,1,0])).distance,2);
  const meeting=Measure.distance(line([0,0,0],[1,0,0]),line([1,0,0],[0,1,0]));
  close(meeting.distance,0);assert.deepEqual(meeting.start,[1,0,0]);
});
test('angles use directed axes and retain antiparallel pi',()=>{
  close(Measure.angle(line([0,0,0],[2,0,0]),line([5,0,1],[0,3,0])).angle,Math.PI/2);
  close(Measure.angle(line([0,0,0],[1,0,0]),line([0,0,0],[-1,0,0])).angle,Math.PI);
});
test('D–H task references produce signed theta and alpha rotations',()=>{
  const x=line([0,0,0],[1,0,0]),negativeY=line([0,0,0],[0,-1,0]),z={label:'z0',direction:[0,0,1]};
  const result=Measure.angle(x,negativeY,z);close(result.angle,-Math.PI/2);assert.equal(result.signed,true);assert.equal(result.reference,'z0');
  close(Measure.angle(negativeY,x,z).angle,Math.PI/2);
});
test('a reference parallel to a selected line keeps the ordinary angle',()=>{
  const result=Measure.angle(line([0,0,0],[1,0,0]),line([0,0,0],[0,0,1]),{label:'z0',direction:[0,0,1]});
  close(result.angle,Math.PI/2);assert.equal(result.signed,false);
});
test('an angle requires two lines; coincident points have zero distance',()=>{
  assert.throws(()=>Measure.angle(point([0,0,0]),line([0,0,0],[1,0,0])),/two axes/);
  close(Measure.distance(point([1,2,3]),point([1,2,3])).distance,0);
});
