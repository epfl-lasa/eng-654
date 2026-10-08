/* Measurements use world coordinates and directed, infinite axis lines. */
(function(root) {
  'use strict';
  const M=root.DHModel;
  function closest(point,line) {
    const z=M.unit(line.direction);
    return M.add(line.origin,M.scale(z,M.dot(M.sub(point,line.origin),z)));
  }
  function distance(first,second,projections=[]) {
    let start,end;
    if(first.type==='point'&&second.type==='point'){start=first.origin;end=second.origin;}
    else if(first.type==='point'){start=first.origin;end=closest(start,second);}
    else if(second.type==='point'){end=second.origin;start=closest(end,first);}
    else {const normal=M.commonNormal(first.origin,first.direction,second.origin,second.direction);start=normal.start;end=normal.end;}
    const displacement=M.sub(end,start);
    return {distance:M.norm(displacement),start:[...start],end:[...end],displacement,
      projections:first.type==='point'&&second.type==='point'?projections.map(axis=>({label:axis.label,value:M.dot(displacement,M.unit(axis.direction))})):[]};
  }
  function angle(first,second,reference=null) {
    if(first.type!=='line'||second.type!=='line')throw Error('Choose two axes to measure an angle.');
    const a=M.unit(first.direction),b=M.unit(second.direction),unsigned=Math.acos(Math.max(-1,Math.min(1,M.dot(a,b))));
    const axis=reference?M.unit(reference.direction):null;
    const signed=!!axis&&Math.abs(M.dot(a,axis))<1e-6&&Math.abs(M.dot(b,axis))<1e-6;
    return {angle:signed?M.angle(a,b,axis):unsigned,unsigned,signed,reference:signed?reference.label:null};
  }
  const api={distance,angle};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  root.DHMeasurements=api;
})(typeof window!=='undefined'?window:globalThis);
