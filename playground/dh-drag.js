/* Geometry for dragging a frame along/about a fixed world-space axis. */
(function(root){
  const M=typeof module==='object'&&module.exports?require('./dh-model.js'):root.DHModel;
  function axisParameter(rayOrigin,rayDirection,origin,direction){
    const r=M.unit(rayDirection),a=M.unit(direction),w=M.sub(rayOrigin,origin),b=M.dot(a,r),denominator=1-b*b;
    if(denominator<1e-4)return null;
    return (M.dot(a,w)-b*M.dot(r,w))/denominator;
  }
  function rotationDelta(from,to,direction){
    const a=M.unit(direction),u=M.sub(from,M.scale(a,M.dot(from,a))),v=M.sub(to,M.scale(a,M.dot(to,a)));
    if(M.norm(u)<1e-9||M.norm(v)<1e-9)return null;
    return Math.atan2(M.dot(a,M.cross(M.unit(u),M.unit(v))),M.dot(M.unit(u),M.unit(v)));
  }
  const api={axisParameter,rotationDelta};
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.DHDrag=api;
})(typeof window!=='undefined'?window:globalThis);
