const NS='http://www.w3.org/2000/svg',PI=Math.PI;
let nextId=0;
const node=(tag,attrs={},text)=>{const e=document.createElementNS(NS,tag);Object.entries(attrs).forEach(([k,v])=>e.setAttribute(k,v));if(text!=null)e.textContent=text;return e;};
function ticks(min,max){const rough=(max-min)/5,magnitude=10**Math.floor(Math.log10(rough)),step=[1,2,2.5,5,10].find(x=>x*magnitude>=rough)*magnitude,result=[];for(let x=Math.ceil(min/step)*step;x<=max+step*1e-8;x+=step)result.push(+x.toPrecision(8));return result;}
const label=x=>String(x).replace('-','−');

// Vector curves and type remain sharp on projectors and at any browser zoom.
export function createLecturePathPlot(svg,{joint=false,onPoint=null,initialBounds=null,zoomable=false,overviewBounds=null}={}) {
  const copyBounds=b=>b&&{x:[...b.x],y:[...b.y]};
  const id=`l7-path-plot-${++nextId}`;let model={},map=null,key='',dynamic,view=copyBounds(initialBounds),pan=null,toolbar=null,viewMode=initialBounds?'custom':'zoomed';
  svg.style.cssText='position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none';
  svg.setAttribute('role','img');svg.setAttribute('aria-label',joint?'Joint-space trajectory and exact singularity curves':'Task-space path and exact critical-value curves');
  function pathD(lines){return lines.map(points=>points.map((p,i)=>{const [x,y]=map.toPx(...p);return`${i?'L':'M'}${x.toFixed(2)},${y.toFixed(2)}`;}).join('')).join('');}
  function draw(){
    const w=svg.clientWidth,h=svg.clientHeight;if(w<20||h<20)return;
    let xr=[-PI,PI],yr=[-PI,PI];
    if(view){xr=[...view.x];yr=[...view.y];}
    else if(!joint){const points=[...(model.path||[]),...(model.cusp?[model.cusp]:[])];if(!points.length)return;const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);xr=[Math.max(0,Math.min(...xs)-.22),Math.max(...xs)+.22];yr=[Math.min(...ys)-.22,Math.max(...ys)+.22];}
    const pad={l:55,r:18,t:zoomable||overviewBounds?87:55,b:49};let pw=Math.max(1,w-pad.l-pad.r),ph=Math.max(1,h-pad.t-pad.b);
    if(!joint&&!view){const scale=Math.max((xr[1]-xr[0])/pw,(yr[1]-yr[0])/ph),cx=(xr[0]+xr[1])/2,cy=(yr[0]+yr[1])/2;xr=[cx-scale*pw/2,cx+scale*pw/2];yr=[cy-scale*ph/2,cy+scale*ph/2];}
    if(!joint&&view){const scale=Math.min(pw/(xr[1]-xr[0]),ph/(yr[1]-yr[0])),width=(xr[1]-xr[0])*scale,height=(yr[1]-yr[0])*scale;pad.l+=(pw-width)/2;pad.t+=(ph-height)/2;pw=width;ph=height;}
    map={w,h,xr,yr,pad,pw,ph,toPx:(x,y)=>[pad.l+(x-xr[0])/(xr[1]-xr[0])*pw,pad.t+(yr[1]-y)/(yr[1]-yr[0])*ph]};
    svg.dataset.plotBounds=JSON.stringify({x:xr,y:yr});
    svg.dataset.plotViewMode=viewMode;
    const nextKey=JSON.stringify([w,h,xr,yr,viewMode]);
    if(nextKey!==key){
      key=nextKey;svg.setAttribute('viewBox',`0 0 ${w} ${h}`);svg.replaceChildren();
      const defs=node('defs'),clip=node('clipPath',{id});clip.append(node('rect',{x:pad.l,y:pad.t,width:pw,height:ph}));defs.append(clip);svg.append(defs);
      svg.append(node('rect',{width:w,height:h,fill:'#fff'}));
      const staticLayer=node('g',{'clip-path':`url(#${id})`});staticLayer.append(node('rect',{x:pad.l,y:pad.t,width:pw,height:ph,fill:'#fcfcfb'}));
      const angleTicks=[-PI,-PI/2,0,PI/2,PI],angleLabels=['−π','−π/2','0','π/2','π'];
      for(const [axis,values] of [['x',joint?angleTicks:ticks(...xr)],['y',joint?angleTicks:ticks(...yr)]])values.forEach((value,i)=>{
        const p=axis==='x'?map.toPx(value,yr[0]):map.toPx(xr[0],value),text=joint?angleLabels[i]:label(value);
        staticLayer.append(node('line',axis==='x'?{x1:p[0],x2:p[0],y1:pad.t,y2:pad.t+ph,stroke:'#e3e6e8','stroke-width':1}:{x1:pad.l,x2:pad.l+pw,y1:p[1],y2:p[1],stroke:'#e3e6e8','stroke-width':1}));
        svg.append(node('text',axis==='x'?{x:p[0],y:pad.t+ph+21,'text-anchor':'middle','font-size':11,fill:'#48515b'}:{x:pad.l-9,y:p[1]+4,'text-anchor':'end','font-size':11,fill:'#48515b'},text));
      });
      const d=pathD(model.curves||[]);staticLayer.append(node('path',{d,fill:'none',stroke:'#fff','stroke-width':4.5,'stroke-linejoin':'round'}),node('path',{d,fill:'none',stroke:'#b33227','stroke-width':1.5,'stroke-linejoin':'round','stroke-linecap':'round','data-critical-curves':''}));
      svg.prepend(defs);svg.append(staticLayer);
      svg.append(node('rect',{x:pad.l,y:pad.t,width:pw,height:ph,fill:'none',stroke:'#7a838c','stroke-width':1}));
      svg.append(node('text',{x:pad.l+pw/2,y:pad.t+ph+40,'text-anchor':'middle','font-size':12,'font-weight':600,fill:'#20252b'},joint?'q₂ [rad]':'ρ [m]'));
      svg.append(node('text',{transform:`translate(${pad.l-40} ${pad.t+ph/2}) rotate(-90)`,'text-anchor':'middle','font-size':12,'font-weight':600,fill:'#20252b'},joint?'q₃ [rad]':'z [m]'));
      const legendY=pad.t-18;
      svg.append(node('line',{x1:pad.l,y1:legendY,x2:pad.l+18,y2:legendY,stroke:'#b33227','stroke-width':2}));
      svg.append(node('text',{x:pad.l+24,y:legendY+4,'font-size':10,fill:'#48515b'},joint?'det Jₚ = 0':viewMode==='full'?`critical values · z: ${label(yr[0])}…${label(yr[1])} m`:'critical values'));
      dynamic=node('g',{'clip-path':`url(#${id})`});svg.append(dynamic);
    }
    dynamic.replaceChildren();
    const lines=points=>{if(!joint)return[points];const result=[];let segment=[];for(const p of points){if(segment.length&&p.some((v,i)=>Math.abs(v-segment.at(-1)[i])>PI)){result.push(segment);segment=[];}segment.push(p);}if(segment.length)result.push(segment);return result;};
    const stroke=(points,color,width,dash)=>{if(!points?.length)return;dynamic.append(node('path',{d:pathD(lines(points)),fill:'none',stroke:color,'stroke-width':width,'stroke-dasharray':dash||'none','stroke-linejoin':'round','stroke-linecap':'round'}));};
    stroke(model.path,'#27313a',2,'5 4');stroke(model.reached,'#245e96',3);
    if(model.vertices&&!joint)model.vertices.forEach((p,i)=>{const [x,y]=map.toPx(...p);dynamic.append(node('rect',{x:x-3,y:y-3,width:6,height:6,fill:'#27313a'}));if(!i)dynamic.append(node('text',{x:x+9,y:y-10,'font-size':11,'font-weight':700,fill:'#27313a'},`start · ${model.startCount??'?'} IKs`));});
    if(model.cusp&&!joint){const [x,y]=map.toPx(...model.cusp),start=model.vertices?.[0]&&map.toPx(...model.vertices[0]),crowded=start&&Math.hypot(start[0]-x,start[1]-y)<75;dynamic.append(node('path',{d:`M${x-5},${y-5}L${x+5},${y+5}M${x-5},${y+5}L${x+5},${y-5}`,stroke:'#b33227','stroke-width':2}));dynamic.append(node('text',{x:x+(crowded?-8:8),y:y+(crowded?-9:15),'text-anchor':crowded?'end':'start','font-size':10,fill:'#9d2c22'},'cusp'));}
    for(const [p,color,r]of [[model.start,'#fff',5],[model.point,'#245e96',5]])if(p){const [cx,cy]=map.toPx(...p);dynamic.append(node('circle',{cx,cy,r,fill:color,stroke:'#27313a','stroke-width':1.5}));}
    if(zoomable&&[...(model.path||[]),...(model.cusp?[model.cusp]:[])].some(p=>p[0]<xr[0]||p[0]>xr[1]||p[1]<yr[0]||p[1]>yr[1])){
      const x=pad.l+pw/2,y=pad.t+18;dynamic.append(node('rect',{x:x-139,y:y-12,width:278,height:32,fill:'#fffffff0'}));
      const notice=node('text',{x,y,'text-anchor':'middle','font-size':11,fill:'#48515b','data-view-notice':''},'Path or cusp outside this view.');notice.append(node('tspan',{x,dy:14},'Use Fit path / cusp to include them.'));dynamic.append(notice);
    }
  }
  const observer=new ResizeObserver(draw);observer.observe(svg);
  function eventPoint(event){
    if(!map)return null;
    const screen=svg.createSVGPoint();screen.x=event.clientX;screen.y=event.clientY;
    const matrix=svg.getScreenCTM();if(!matrix)return null;const {x,y}=screen.matrixTransform(matrix.inverse());
    if(x<map.pad.l||x>map.pad.l+map.pw||y<map.pad.t||y>map.pad.t+map.ph)return null;
    return {pixel:[x,y],world:[map.xr[0]+(x-map.pad.l)/map.pw*(map.xr[1]-map.xr[0]),map.yr[1]-(y-map.pad.t)/map.ph*(map.yr[1]-map.yr[0])]};
  }
  function zoom(factor,anchor){
    if(!map)return;
    const point=anchor||[(map.xr[0]+map.xr[1])/2,(map.yr[0]+map.yr[1])/2];
    factor=Math.max(.005/Math.min(map.xr[1]-map.xr[0],map.yr[1]-map.yr[0]),Math.min(factor,100/Math.max(map.xr[1]-map.xr[0],map.yr[1]-map.yr[0])));
    viewMode='custom';view={x:map.xr.map(x=>point[0]+(x-point[0])*factor),y:map.yr.map(y=>point[1]+(y-point[1])*factor)};draw();
  }
  function resetView(){viewMode=initialBounds?'custom':'zoomed';view=copyBounds(initialBounds);draw();}
  function fitPath(){viewMode='zoomed';view=null;draw();if(map)view={x:[...map.xr],y:[...map.yr]};}
  function setView(mode){viewMode=mode;view=mode==='full'?copyBounds(overviewBounds):null;toolbar?.querySelectorAll('[data-plot-view]').forEach(button=>{const active=button.dataset.plotView===mode;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});draw();}
  function pointerDown(event){
    if(event.button!==0)return;const point=eventPoint(event);if(!point)return;
    if(zoomable&&event.shiftKey){pan={id:event.pointerId,pixel:point.pixel,x:[...map.xr],y:[...map.yr]};svg.setPointerCapture(event.pointerId);svg.style.cursor='grabbing';event.preventDefault();return;}
    onPoint?.(point.world);
  }
  function pointerMove(event){
    if(!pan||event.pointerId!==pan.id||!map)return;
    const screen=svg.createSVGPoint();screen.x=event.clientX;screen.y=event.clientY;const p=screen.matrixTransform(svg.getScreenCTM().inverse());
    const dx=(p.x-pan.pixel[0])/map.pw*(pan.x[1]-pan.x[0]),dy=(p.y-pan.pixel[1])/map.ph*(pan.y[1]-pan.y[0]);
    viewMode='custom';view={x:pan.x.map(x=>x-dx),y:pan.y.map(y=>y+dy)};draw();
  }
  function pointerUp(event){if(!pan||event.pointerId!==pan.id)return;pan=null;svg.style.cursor='';if(svg.hasPointerCapture(event.pointerId))svg.releasePointerCapture(event.pointerId);}
  function wheel(event){const point=eventPoint(event);if(!point)return;event.preventDefault();zoom(Math.exp(Math.max(-1,Math.min(1,event.deltaY*.0015))),point.world);}
  if(onPoint||zoomable)svg.addEventListener('pointerdown',pointerDown);
  if(zoomable){
    svg.addEventListener('wheel',wheel,{passive:false});svg.addEventListener('pointermove',pointerMove);svg.addEventListener('pointerup',pointerUp);svg.addEventListener('pointercancel',pointerUp);
    toolbar=document.createElement('div');toolbar.className='l7-controls';toolbar.dataset.plotTools='';toolbar.style.cssText='position:absolute;top:29px;left:55px;right:18px;z-index:3;gap:5px;flex-wrap:nowrap';
    const resetTitle=initialBounds?`Reset to ρ: ${initialBounds.x.join('…')} m and z: ${initialBounds.y.join('…')} m`:'Reset plot view';
    for(const [action,title,text,fn]of [['out','Zoom out','−',()=>zoom(1.5)],['in','Zoom in','+',()=>zoom(1/1.5)],['reset',resetTitle,'Reset axes',resetView],['fit','Fit the path and the native model cusp','Fit path / cusp',fitPath]]){const button=document.createElement('button');button.type='button';button.dataset.plotAction=action;button.title=title;button.setAttribute('aria-label',title);button.textContent=text;button.addEventListener('click',fn);toolbar.append(button);}
    const hint=document.createElement('span');hint.style.cssText='font-size:10px;color:#48515b;margin-left:4px';hint.textContent='Wheel: zoom · Shift-drag: pan';toolbar.append(hint);svg.after(toolbar);
  }
  if(overviewBounds){
    toolbar=document.createElement('div');toolbar.className='l7-controls';toolbar.dataset.plotViews='';toolbar.setAttribute('role','group');toolbar.setAttribute('aria-label','Critical-value plot view');toolbar.style.cssText='position:absolute;top:29px;left:55px;right:18px;z-index:3;gap:5px;flex-wrap:nowrap';
    for(const [mode,text,title]of [['zoomed','Zoomed','Zoom to the shared path and cusp'],['full','Full',`Show every critical-value curve: ρ ${overviewBounds.x.join('…')} m; z ${overviewBounds.y.join('…')} m`]]){const button=document.createElement('button');button.type='button';button.dataset.plotView=mode;button.textContent=text;button.title=title;button.setAttribute('aria-label',title);button.addEventListener('click',()=>setView(mode));toolbar.append(button);}
    svg.after(toolbar);setView('zoomed');
  }
  return {render(next){model=next;draw();},resetView,fitPath,zoom,dispose(){observer.disconnect();toolbar?.remove();svg.removeEventListener('pointerdown',pointerDown);svg.removeEventListener('wheel',wheel);svg.removeEventListener('pointermove',pointerMove);svg.removeEventListener('pointerup',pointerUp);svg.removeEventListener('pointercancel',pointerUp);}};
}
