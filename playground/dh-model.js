/* Standard D–H geometry. Column vectors, right-handed frames, radians/metres. */
(function (root) {
  'use strict';
  const EPS = 1e-9;
  const add = (a, b) => a.map((v, i) => v + b[i]);
  const sub = (a, b) => a.map((v, i) => v - b[i]);
  const scale = (a, s) => a.map(v => v * s);
  const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
  const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
  const norm = a => Math.hypot(...a);
  function unit(a) { const n = norm(a); if (n < EPS) throw Error('An axis must be nonzero.'); return scale(a, 1/n); }
  const identity = () => [[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]];
  const multiply = (a, b) => a.map(row => b[0].map((_, c) => row.reduce((s, v, k) => s + v * b[k][c], 0)));
  const chain = (...matrices) => matrices.reduce(multiply, identity());
  const origin = t => t.slice(0,3).map(row => row[3]);
  const axis = (t, i) => t.slice(0,3).map(row => row[i]);
  function pose(x, y, z, p) { return [0,1,2].map(i => [x[i],y[i],z[i],p[i]]).concat([[0,0,0,1]]); }
  function inverse(t) {
    const r = [0,1,2].map(i => [0,1,2].map(j => t[j][i]));
    const p = origin(t);
    return r.map(row => [...row, -dot(row,p)]).concat([[0,0,0,1]]);
  }
  function rotation(direction, angle) {
    const [x,y,z] = unit(direction), c = Math.cos(angle), s = Math.sin(angle), v = 1-c;
    return [[x*x*v+c,x*y*v-z*s,x*z*v+y*s,0], [y*x*v+z*s,y*y*v+c,y*z*v-x*s,0], [z*x*v-y*s,z*y*v+x*s,z*z*v+c,0], [0,0,0,1]];
  }
  const rx = angle => rotation([1,0,0],angle);
  const ry = angle => rotation([0,1,0],angle);
  const rz = angle => rotation([0,0,1],angle);
  function translation(p) { const t = identity(); p.forEach((v,i) => {t[i][3] = v;}); return t; }
  const rpyPose = (xyz, rpy) => chain(translation(xyz), rz(rpy[2]), ry(rpy[1]), rx(rpy[0]));
  function toRPY(t) {
    const pitch = Math.atan2(-t[2][0], Math.hypot(t[0][0],t[1][0]));
    if (Math.abs(Math.cos(pitch)) < EPS) return [0,pitch,Math.atan2(-t[0][1],t[1][1])];
    return [Math.atan2(t[2][1],t[2][2]),pitch,Math.atan2(t[1][0],t[0][0])];
  }
  const dh = ({theta,d,a,alpha}) => chain(rz(theta),translation([0,0,d]),translation([a,0,0]),rx(alpha));
  const angle = (from, to, about) => Math.atan2(dot(about,cross(from,to)),dot(from,to));
  const distance = (a,b) => Math.max(...a.flat().map((v,i) => Math.abs(v-b.flat()[i])));

  // Closest points on the two infinite axis lines. Parallel normals are anchored
  // at p; intersecting/coincident lines need a chosen perpendicular direction.
  function commonNormal(p, z, q, w, preferred = [1,0,0]) {
    z = unit(z); w = unit(w);
    const delta = sub(q,p), b = dot(z,w), denominator = dot(cross(z,w),cross(z,w));
    let s = 0, t;
    if (denominator > EPS*EPS) {
      s = (dot(delta,z) - b*dot(delta,w))/denominator;
      t = (b*dot(delta,z) - dot(delta,w))/denominator;
    } else t = -dot(delta,w);
    const start = add(p,scale(z,s)), end = add(q,scale(w,t)), separation = sub(end,start), length = norm(separation);
    let x, kind;
    if (denominator < EPS*EPS) {
      kind = length < EPS ? 'coincident' : (b < 0 ? 'antiparallel' : 'parallel');
      if (length > EPS) x = unit(separation);
      else {
        let perpendicular = sub(preferred,scale(z,dot(preferred,z)));
        if (norm(perpendicular) < EPS) perpendicular = cross(z,Math.abs(z[0]) < .8 ? [1,0,0] : [0,1,0]);
        x = unit(perpendicular);
      }
    } else { kind = length < EPS ? 'intersecting' : 'skew'; x = length < EPS ? unit(cross(z,w)) : unit(separation); }
    return {start,end,x,length,kind};
  }
  function validNormal(candidate, z, w) {
    return norm(candidate) > EPS && Math.abs(dot(unit(candidate),unit(z))) < 1e-7 && Math.abs(dot(unit(candidate),unit(w))) < 1e-7;
  }
  function validCommonNormal(candidate, normal, z, w) {
    return validNormal(candidate,z,w) && (normal.length < EPS || Math.abs(Math.abs(dot(unit(candidate),normal.x))-1) < 1e-7);
  }
  function frame(x, z, p) { x = unit(x); z = unit(z); return pose(x,unit(cross(z,x)),z,p); }
  function parameters(from, to) {
    const z = axis(from,2), x = axis(to,0), displacement = sub(origin(to),origin(from));
    return {theta:angle(axis(from,0),x,z), d:dot(displacement,z), a:dot(displacement,x), alpha:angle(z,axis(to,2),x)};
  }

  // Fixtures describe physical URDF-style frames, independently of a D–H table.
  // Axis indices refer to each joint's local coordinates, never world axes.
  const fixtures = [
    {id:'skew',name:'Skew axes & offsets',summary:'Three perpendicular joint directions with separated axis lines. Both link offsets and a joint-angle offset are needed.',
      frames:[{xyz:[0,0,.35],rpy:[0,-Math.PI/2,0],axis:0},{xyz:[1,.25,.8],rpy:[0,0,0],axis:1},{xyz:[1.8,.8,1.3],rpy:[0,Math.PI/2,0],axis:2}]},
    {id:'parallel',name:'Parallel axes',summary:'The common-normal direction is fixed by the separation, but its position along the axes is a choice. We anchor each normal at the preceding supplied origin.',
      frames:[{xyz:[0,0,.35],rpy:[0,-Math.PI/2,0],axis:0},{xyz:[1,0,.9],rpy:[Math.PI/2,0,Math.PI/6],axis:1},{xyz:[1.6,.8,1.4],rpy:[0,0,Math.PI/4],axis:2}]},
    {id:'intersecting',name:'Intersecting axes',summary:'At an intersection the link length a is zero. The cross product gives a normal direction; either sign can define a valid frame.',
      frames:[{xyz:[0,0,.35],rpy:[0,-Math.PI/2,0],axis:0},{xyz:[0,0,.9],rpy:[0,0,0],axis:1},{xyz:[.6,.6,.9],rpy:[0,Math.PI/2,0],axis:2}]},
    {id:'coincident',name:'Coincident axes',summary:'There is no unique normal direction. Choose any perpendicular x direction; keep it consistent. Here we start with world +x.',
      frames:[{xyz:[0,0,.35],rpy:[0,-Math.PI/2,0],axis:0},{xyz:[0,0,.9],rpy:[Math.PI/2,0,Math.PI/6],axis:1},{xyz:[0,0,1.4],rpy:[0,0,Math.PI/4],axis:2}]},
    {id:'antiparallel',name:'Antiparallel axes',summary:'Parallel lines can have opposite positive joint directions. Their twist is ±π, rather than zero; the signs of joint variables follow those positive directions.',
      frames:[{xyz:[0,0,.35],rpy:[0,-Math.PI/2,0],axis:0},{xyz:[1,0,.9],rpy:[-Math.PI/2,0,0],axis:1},{xyz:[1.6,.8,1.4],rpy:[0,0,Math.PI/4],axis:2}]}
  ];
  function scenario(id = 'skew') {
    const fixture = fixtures.find(item => item.id === id);
    if (!fixture) throw Error('Unknown geometry.');
    const world = fixture.frames.map(f => rpyPose(f.xyz,f.rpy));
    const axes = world.map((t,i) => axis(t,fixture.frames[i].axis));
    const normals = [0,1].map(i => commonNormal(origin(world[i]),axes[i],origin(world[i+1]),axes[i+1]));
    return assign({...fixture,world,axes,normals,tool:rpyPose([.35,.15,.2],[.2,-.1,.3])},normals.map(n => n.x));
  }
  function assign(model, directions) {
    directions.forEach((x,i) => {if (!validCommonNormal(x,model.normals[i],model.axes[i],model.axes[i+1] || model.axes[i])) throw Error('x must follow a common normal joining both joint axes.');});
    const dhFrames = [frame(directions[0],model.axes[0],model.baseOrigin || origin(model.world[0])),
      ...directions.map((x,i) => frame(x,model.axes[Math.min(i+1,model.axes.length-1)],model.normals[i].end))];
    const rows = directions.map((_,i) => parameters(dhFrames[i],dhFrames[i+1]));
    const relatives = model.world.map((t,i) => i ? multiply(inverse(model.world[i-1]),t) : t);
    return {...model,dhFrames,rows,relatives,base:dhFrames[0],toolOffset:chain(inverse(dhFrames.at(-1)),model.world.at(-1),model.tool)};
  }
  function complete(model) {
    if (model.terminalIncluded) return model;
    const z = model.axes.at(-1), p = model.normals.at(-1).end;
    const end = origin(multiply(model.world.at(-1),model.tool)), delta = sub(end,p);
    const start = add(p,scale(z,dot(delta,z))), perpendicular = sub(end,start), length = norm(perpendicular);
    const x = length > EPS ? unit(perpendicular) : axis(model.dhFrames.at(-1),0);
    const terminal = {start,end,x,length,kind:length>EPS?'parallel':'coincident',terminal:true};
    return assign({...model,terminalIncluded:true,normals:[...model.normals,terminal]},[...model.normals.map(n=>n.x),x]);
  }
  function jointPoses(model, q = []) {
    let t = identity();
    return model.relatives.map((relative,i) => {
      const local = model.frames[i].localAxis || [0,1,2].map(j=>j===model.frames[i].axis ? (model.frames[i].axisSign || 1) : 0);
      const before = multiply(t,relative); t = multiply(before,rotation(local,q[i] || 0));
      return {before,after:t};
    });
  }
  function urdfFK(model, q = []) {
    let t = identity();
    model.relatives.forEach((relative,i) => { const local = model.frames[i].localAxis || [0,1,2].map(j=>j===model.frames[i].axis ? (model.frames[i].axisSign || 1) : 0); t = chain(t,relative,rotation(local,q[i] || 0)); });
    return multiply(t,model.tool);
  }
  function dhFK(model, q = [], rows = model.rows) {
    return chain(model.base,...rows.map((row,i) => dh({...row,theta:row.theta+(q[i] || 0)})),...(model.terminalIncluded ? [] : [rz(q[model.axes.length-1] || 0)]),model.toolOffset);
  }
  // Match the exercise's rotate-z, translate-z, rotate-x, translate-x order.
  // Tx(a) and Rx(alpha) commute since both act along/about the same x axis.
  function motionPose(model, row, values, stage, progress = 1) {
    const order = ['theta','d','alpha','a'];
    const v = Object.fromEntries(order.map((key,i) => [key, i < stage ? values[key] : i === stage ? values[key]*progress : 0]));
    return chain(model.dhFrames[row],rz(v.theta),translation([0,0,v.d]),rx(v.alpha),translation([v.a,0,0]));
  }
  const api = {EPS,add,sub,scale,dot,cross,norm,unit,identity,multiply,chain,origin,axis,pose,inverse,rotation,rx,ry,rz,translation,rpyPose,toRPY,dh,angle,distance,commonNormal,validNormal,validCommonNormal,frame,parameters,fixtures,scenario,assign,complete,jointPoses,urdfFK,dhFK,motionPose};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.DHModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
