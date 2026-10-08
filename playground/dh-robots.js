/* Read the course's URDF assets; preserve the complete link tree for rendering. */
(function (root) {
  'use strict';
  const M = root.DHModel;
  const catalog = [
    {id:'custom3r',name:'custom_3R · 3 joints',folder:'custom_3R',file:'custom_3R.urdf'},
    {id:'curo3r',name:'CuRo3R · 3 joints',folder:'CuRo3R',file:'CuRo3R.urdf'},
    {id:'custom6r',name:'custom_6R · 6 joints',folder:'custom_6R',file:'custom_6R_new.urdf'},
    {id:'curo6r',name:'CuRo6R · 6 joints',folder:'CuRo6R',file:'CuRo6R.urdf'},
    {id:'iiwa7',name:'KUKA iiwa 7 · 7 joints',folder:'iiwa7',file:'iiwa7.urdf'},
    {id:'gofa',name:'ABB GoFa · 6 joints',folder:'abb_gofa',file:'crb15000_5_95.urdf'},
    {id:'irb4600',name:'ABB IRB 4600 · 6 joints',folder:'abb_irb',file:'irb4600_40_255.urdf'},
    {id:'puma',name:'Puma 560 · 6 joints',folder:'puma',file:'puma560_robot.urdf'},
    {id:'fanuc',name:'FANUC CRX-10iA/L · 6 joints',folder:'fanuc_crx10ia_support',file:'crx10ial.urdf'},
    {id:'enlight',name:'Enlight-L · 7 joints',folder:'enlight',file:'Enlight-L.urdf'}
  ];
  const child=(node,tag)=>[...(node?.children || [])].find(n=>n.localName===tag);
  const children=(node,tag)=>[...(node?.children || [])].filter(n=>n.localName===tag);
  function numbers(text,fallback) {const value=text?text.trim().split(/\s+/).map(Number):fallback; if(value.length!==3 || !value.every(Number.isFinite)) throw Error('Invalid URDF vector.');return value;}
  function parse(xml) {
    const document = new DOMParser().parseFromString(xml,'application/xml');
    if(document.querySelector('parsererror')) throw Error('Invalid robot XML.');
    const robot=document.documentElement;
    const origin=node=>{const o=child(node,'origin');return M.rpyPose(numbers(o?.getAttribute('xyz'),[0,0,0]),numbers(o?.getAttribute('rpy'),[0,0,0]));};
    const links=children(robot,'link').map(link=>({name:link.getAttribute('name'),visuals:children(link,'visual').map(visual=>{
      const geometry=child(visual,'geometry'),mesh=child(geometry,'mesh');
      if(mesh) return {kind:'mesh',file:mesh.getAttribute('filename').split('/').at(-1),scale:numbers(mesh.getAttribute('scale'),[1,1,1]),origin:origin(visual)};
      const box=child(geometry,'box'),cylinder=child(geometry,'cylinder'),sphere=child(geometry,'sphere');
      if(box)return {kind:'box',size:numbers(box.getAttribute('size'),[1,1,1]),origin:origin(visual)};
      if(cylinder)return {kind:'cylinder',radius:Number(cylinder.getAttribute('radius')),length:Number(cylinder.getAttribute('length')),origin:origin(visual)};
      if(sphere)return {kind:'sphere',radius:Number(sphere.getAttribute('radius')),origin:origin(visual)};
      return null;
    }).filter(Boolean)}));
    const joints=children(robot,'joint').filter(j=>j.hasAttribute('type')).map(j=>({name:j.getAttribute('name'),type:j.getAttribute('type'),parent:child(j,'parent')?.getAttribute('link'),child:child(j,'child')?.getAttribute('link'),origin:origin(j),axis:numbers(child(j,'axis')?.getAttribute('xyz'),[1,0,0])}));
    return {name:robot.getAttribute('name'),links,joints};
  }
  function fromData(data, spec) {
    const names=new Set(data.links.map(l=>l.name));
    const joints=data.joints.filter(j=>names.has(j.parent)&&names.has(j.child));
    const incoming=new Set(joints.map(j=>j.child));
    const roots=data.links.filter(l=>!incoming.has(l.name));
    let best=null;
    function visit(link,t,path,active,visited) {
      if(visited.has(link)) throw Error('Cyclic robot tree.');
      const seen=new Set(visited);seen.add(link);
      const outgoing=joints.filter(j=>j.parent===link);
      if(!outgoing.length && (!best || active.length>best.active.length)) best={root:path[0]?.parent || link,link,t,path,active};
      outgoing.forEach(j=>{
        if(!['fixed','revolute','continuous'].includes(j.type)) throw Error('This exercise requires revolute joints.');
        const pose=M.multiply(t,j.origin);
        visit(j.child,pose,[...path,j],j.type==='fixed'?active:[...active,{joint:j,world:pose}],seen);
      });
    }
    roots.forEach(l=>visit(l.name,M.identity(),[],[],new Set()));
    if(!best || best.active.length<2) throw Error('No serial robot chain found.');
    const world=best.active.map(a=>a.world);
    const frames=best.active.map(({joint,world:t})=>{
      const localAxis=M.unit(joint.axis),axis=localAxis.findIndex(v=>Math.abs(v)>1-1e-7);
      if(axis<0)throw Error('A joint axis is not aligned with a local frame arrow.');
      return {xyz:M.origin(t),rpy:M.toRPY(t),axis,axisSign:Math.sign(localAxis[axis]),localAxis,name:joint.name,link:joint.child};
    });
    const axes=world.map((t,i)=>M.scale(M.axis(t,frames[i].axis),frames[i].axisSign));
    const normals=world.slice(0,-1).map((t,i)=>M.commonNormal(M.origin(t),axes[i],M.origin(world[i+1]),axes[i+1]));
    const p=M.origin(world[0]),z=axes[0],baseOrigin=M.sub(p,M.scale(z,M.dot(p,z)));
    const tool=M.multiply(M.inverse(world.at(-1)),best.t);
    const model=M.assign({id:spec.id,name:spec.name,summary:`${frames.length} revolute joints · end frame ${best.link}`,world,frames,axes,normals,baseOrigin,tool,robot:{...data,joints,root:best.root,endpoint:best.link,spec}},normals.map(n=>n.x));
    return M.complete(model);
  }
  const cache=new Map();
  function load(id) {
    if(!cache.has(id)) {
      const spec=catalog.find(r=>r.id===id);if(!spec)throw Error('Unknown robot.');
      const url=new URL(`../lectures_main/assets/models/${spec.folder}/${spec.file}`,root.location.href);
      const pending=fetch(url).then(r=>{if(!r.ok)throw Error(`Could not load ${spec.name}.`);return r.text();}).then(xml=>fromData(parse(xml),spec));
      cache.set(id,pending);pending.catch(()=>cache.delete(id));
    }
    return cache.get(id).then(model=>structuredClone(model));
  }
  function linkPoses(model,q=[]) {
    const robot=model.robot,poses={[robot.root]:M.identity()},byName=new Map(model.frames.map((f,i)=>[f.name,i]));
    function visit(link) {robot.joints.filter(j=>j.parent===link).forEach(j=>{
      const angle=byName.has(j.name)?q[byName.get(j.name)] || 0:0;
      poses[j.child]=M.chain(poses[link],j.origin,j.type==='fixed'?M.identity():M.rotation(j.axis,angle));visit(j.child);
    });}
    visit(robot.root);return poses;
  }
  const api={catalog,parse,fromData,load,linkPoses};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  root.DHRobots=api;
})(typeof window!=='undefined'?window:globalThis);
