// Exact native joint coordinates of assets/models/custom_3R/custom_3R.urdf.
// Distances are metres. This module has no rendering dependencies.
const PI = Math.PI;
export const CUSTOM_DH = Object.freeze({ a1:1, a2:2, a3:1.5, d1:1, d2:1.25, d3:.25, A1:-PI/2, A2:PI/2, A3:0 });
export const CUSTOM_URDF = '../../assets/models/custom_3R/custom_3R.urdf';
// Searched and verified: four starting IKs, one closed continuation, one
// nonsingular change, and two genuine fold terminations. All sides are in metres.
export const DEFAULT_CUSTOM_PATH = Object.freeze({rho:2.58,z:3,width:1,height:.55,rotation:90});
export const CUSTOM_CUSP = Object.freeze([2.73161495116401,2.9346218213643667]);
export const wrap = a => Math.atan2(Math.sin(a),Math.cos(a));
export const torusDistance = (a,b) => Math.hypot(...a.map((x,i)=>wrap(x-b[i])));
export function customPosition([q1,q2,q3]) {
  const u=2+1.5*Math.cos(q3),x=1+u*Math.cos(q2)+.25*Math.sin(q2),y=1.25+1.5*Math.sin(q3);
  return [Math.cos(q1)*x-Math.sin(q1)*y,Math.sin(q1)*x+Math.cos(q1)*y,1-u*Math.sin(q2)+.25*Math.cos(q2)];
}
export function slicePosition(q) { const p=customPosition([0,...q]);return [Math.hypot(p[0],p[1]),p[2]]; }
export function sliceConfiguration(q) { const p=customPosition([0,...q]);return [-Math.atan2(p[1],p[0]),...q]; }
export function customDeterminant([q2,q3]) {
  const u=2+1.5*Math.cos(q3),U=u*Math.cos(q2)+.25*Math.sin(q2);
  return 1.5*(u*Math.sin(q3)+U*(2*Math.sin(q3)-1.25*Math.cos(q3)));
}

// Derivative roots partition the line into monotone intervals. A stationary
// value within coefficient/evaluation roundoff is one multiple root, and its
// adjacent intervals must not also manufacture two sign-change roots. This
// backward-error test scales with the evaluated terms, not a fixed FK or angle
// tolerance: resolvable, closely spaced roots off a fold remain distinct.
export function realPolynomialRoots(input,range=null) {
  const c=input.slice();while(c.length>1&&c.at(-1)===0)c.pop();
  const degree=c.length-1;if(!degree)return [];
  const bound=range?null:1+Math.max(...c.slice(0,-1).map(a=>Math.abs(a/c.at(-1)))),[lower,upper]=range||[-bound,bound];
  if(degree===1){const root=-c[0]/c[1];return root>=lower&&root<=upper?[root]:[];}
  const coefficientNorm=Math.max(...c.map(Math.abs));
  const evaluate=x=>{let value=c.at(-1),magnitude=Math.abs(value);for(let i=degree-1;i>=0;i--){value=value*x+c[i];magnitude=magnitude*Math.abs(x)+Math.abs(c[i]);}return {value,zero:Math.abs(value)<=8*Number.EPSILON*Math.max(magnitude,coefficientNorm)};};
  const critical=realPolynomialRoots(c.slice(1).map((a,i)=>a*(i+1)),[lower,upper]).filter(x=>x>lower&&x<upper);
  const cuts=[lower,...critical,upper].map(x=>({x,...evaluate(x)})),roots=[];
  // Several adjacent stationary values can all be indistinguishable from zero
  // at a higher-order merger. They represent one unresolved multiple-root
  // cluster, not several independently verified roots.
  for(let i=0;i<cuts.length;i++)if(cuts[i].zero){let j=i;while(j+1<cuts.length&&cuts[j+1].zero)j++;roots.push((cuts[i].x+cuts[j].x)/2);i=j;}
  for(let i=1;i<cuts.length;i++) {
    const a=cuts[i-1],b=cuts[i];if(a.zero||b.zero||(a.value>0)===(b.value>0))continue;
    let lo=a.x,hi=b.x,fa=a.value;
    for(let k=0;k<75;k++){const mid=(lo+hi)/2;if(mid===lo||mid===hi)break;const fm=evaluate(mid).value;if(fm===0){lo=hi=mid;break;}if((fa>0)===(fm>0)){lo=mid;fa=fm;}else hi=mid;}
    roots.push((lo+hi)/2);
  }
  return roots.sort((a,b)=>a-b);
}

export function solveSliceIK([rho,z]) {
  if(!Number.isFinite(rho)||!Number.isFinite(z)||rho<0)return [];
  const Z=z-1,K=(rho*rho+Z*Z-8.875)/2;
  // t=tan(q3/2), D=1+t². X D=(1+K−3)−3.75t+(1+K+3)t²,
  // Y D=1.25+3t+1.25t². Eliminate q2 using X²+Y²=rho².
  const X=[K-2,-3.75,K+4],Y=[1.25,3,1.25],coefficients=[0,0,0,0,0];
  for(let i=0;i<3;i++)for(let j=0;j<3;j++)coefficients[i+j]+=X[i]*X[j]+Y[i]*Y[j];
  coefficients[0]-=rho*rho;coefficients[2]-=2*rho*rho;coefficients[4]-=rho*rho;
  // Two bounded half-angle charts cover the circle, including q3=pi exactly.
  // Inverting the chart avoids huge root bounds and an approximate extra root
  // at pi when the leading coefficient is small but nonzero.
  const angles=[...realPolynomialRoots(coefficients,[-1,1]).map(t=>2*Math.atan(t)),...realPolynomialRoots(coefficients.slice().reverse(),[-1,1]).map(t=>2*Math.atan2(1,t))];
  const roots=[];
  for(const q3 of angles) {
    const U=K-3*Math.cos(q3)-1.875*Math.sin(q3),u=2+1.5*Math.cos(q3),q=[wrap(Math.atan2(.25,u)-Math.atan2(Z,U)),wrap(q3)];
    if(Math.hypot(...slicePosition(q).map((x,i)=>x-[rho,z][i]))<2e-7&&!roots.some(r=>torusDistance(r,q)<1e-10))roots.push(q);
  }
  return roots.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
}

export function pathVertices(state) {
  if(Array.isArray(state.vertices))return state.vertices.map(p=>p.slice());
  const a=state.rotation*PI/180,c=Math.cos(a),s=Math.sin(a);
  return [[-.5,-.5],[.5,-.5],[.5,.5],[-.5,.5]].map(([x,y])=>[state.rho+c*x*state.width-s*y*state.height,state.z+s*x*state.width+c*y*state.height]);
}
export function workspacePath(state,spacing=.006) {
  const vertices=pathVertices(state),points=[];
  if(vertices.length<2)return [];
  for(let edge=0;edge<vertices.length;edge++) {
    const a=vertices[edge],b=vertices[(edge+1)%vertices.length],n=Math.max(2,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/spacing));
    for(let i=0;i<n;i++)points.push(a.map((v,k)=>v+(b[k]-v)*i/n));
  }
  points.push(vertices[0].slice());return points;
}

// A continuation step is accepted only on the current determinant-sign branch,
// with bounded joint motion. Adaptive task-space subdivision prevents a coarse
// sample from jumping between unrelated roots near a fold.
function continueStep(a,b,q,depth=0) {
  const sign=Math.sign(customDeterminant(q)),candidates=solveSliceIK(b).filter(r=>Math.sign(customDeterminant(r))===sign);
  candidates.sort((r,s)=>torusDistance(r,q)-torusDistance(s,q));
  const next=candidates[0],distance=next?torusDistance(next,q):Infinity;
  const currentNative=sliceConfiguration(q),nextNative=next&&sliceConfiguration(next),crossesLimit=!!nextNative&&nextNative.some((x,i)=>Math.abs(x-currentNative[i])>PI);
  if(next&&distance<.055&&!crossesLimit&&Math.hypot(...nextNative.map((x,i)=>x-currentNative[i]))<.055) {
    const regular=[.25,.5,.75].every(f=>sign*customDeterminant(q.map((x,i)=>x+wrap(next[i]-x)*f))>1e-7);
    if(regular)return {q:next,nodes:[{q:next,point:b}]};
  }
  if(depth>=19){const atLimit=crossesLimit&&distance<.055&&currentNative.some(x=>PI-Math.abs(x)<1e-5);return {nodes:[],termination:atLimit?'joint-limit':'singularity',error:atLimit?'Selected IK reaches a native joint limit (±π); wrapping the angle would jump across the stop.':'Selected IK reaches a singular fold; no regular continuation on this branch.'};}
  const middle=a.map((v,i)=>(v+b[i])/2),first=continueStep(a,middle,q,depth+1);
  if(!first.q)return first;const second=continueStep(middle,b,first.q,depth+1);
  return {...second,nodes:first.nodes.concat(second.nodes)};
}
export function trackCustomPath(workspace,seed) {
  const path=[seed.slice()],reached=[workspace[0].slice()];
  let q=seed.slice(),failIndex=null,reason='',termination=null,minDet=Math.abs(customDeterminant(q));
  if(minDet<1e-7)return {path,reached,success:false,failIndex:0,minDet,closure:Infinity,termination:'singularity',reason:'The starting IK is singular.'};
  for(let i=1;i<workspace.length;i++) {
    const step=continueStep(workspace[i-1],workspace[i],q);
    for(const node of step.nodes){q=node.q;path.push(q);reached.push(node.point.slice());minDet=Math.min(minDet,Math.abs(customDeterminant(q)));}
    if(!step.q){failIndex=i;reason=step.error;termination=step.termination;break;}
  }
  const success=failIndex===null,closure=success?torusDistance(sliceConfiguration(path[0]),sliceConfiguration(path.at(-1))):Infinity;
  return {path,reached,success,failIndex,minDet,closure,reason,termination};
}
export function analyzeCustomPath(state,spacing=.006) {
  const workspace=workspacePath(state,spacing),starts=workspace.length?solveSliceIK(workspace[0]):[];
  const tracks=starts.map((seed,branch)=>({...trackCustomPath(workspace,seed),branch}));
  const successful=tracks.filter(t=>t.success),regular=successful.filter(t=>t.closure<1e-5),nonsingular=successful.filter(t=>t.closure>=1e-5),infeasible=tracks.filter(t=>!t.success);
  const secondLap=nonsingular.length?trackCustomPath(workspace,nonsingular[0].path.at(-1)):null;
  return {workspace,starts,tracks,successful,regular,nonsingular,infeasible,secondLap};
}

export function customCriticalCurves(samples=4800) {
  const curves=[],parameters=Array.from({length:samples+1},(_,i)=>-PI+2*PI*i/samples);
  const boundaryValue=q3=>{const u=2+1.5*Math.cos(q3),factor=2*Math.sin(q3)-1.25*Math.cos(q3);return (u*u+.25**2)*factor*factor-u*u*Math.sin(q3)**2;};
  // Include exact ends of the two inverse-cosine branches. A uniform q3 grid
  // alone leaves visible gaps where those branches meet with a vertical tangent.
  const boundaries=[];
  for(let i=1;i<parameters.length;i++){let lo=parameters[i-1],hi=parameters[i],fa=boundaryValue(lo);if(fa*boundaryValue(hi)>=0)continue;for(let k=0;k<55;k++){const mid=(lo+hi)/2;if((boundaryValue(mid)>0)===(fa>0))lo=mid;else hi=mid;}boundaries.push((lo+hi)/2);}
  parameters.push(...boundaries);parameters.sort((a,b)=>a-b);
  for(const sign of [-1,1]) {
    const evaluate=q3=>{
      const u=2+1.5*Math.cos(q3),factor=2*Math.sin(q3)-1.25*Math.cos(q3),A=u*factor,B=.25*factor,rhs=-u*Math.sin(q3),norm=Math.hypot(A,B);
      return norm&&Math.abs(rhs)<=norm+1e-12?[wrap(Math.atan2(B,A)+sign*Math.acos(Math.max(-1,Math.min(1,rhs/norm)))),q3]:null;
    };
    // A uniform q3 grid undersamples the square-root ends of acos and can draw
    // chords longer than half a metre. Refine the exact zero curve by distance
    // and chord error in workspace, retaining fine sampling on the joint torus.
    const refine=(a,b,depth=0)=>{
      const middle=evaluate((a[1]+b[1])/2);if(!middle)return [b];
      const pa=slicePosition(a),pb=slicePosition(b),pm=slicePosition(middle),delta=pb.map((x,i)=>x-pa[i]),length=Math.hypot(...delta),t=length?Math.max(0,Math.min(1,pm.reduce((sum,x,i)=>sum+(x-pa[i])*delta[i],0)/length**2)):0;
      const error=Math.hypot(...pm.map((x,i)=>x-pa[i]-t*delta[i]));
      if(depth<24&&(length>.008||torusDistance(a,b)>.004||error>1e-5))return [...refine(a,middle,depth+1),...refine(middle,b,depth+1)];
      return [b];
    };
    let line=[];
    const append=q=>{
      if(line.length&&Math.abs(q[0]-line.at(-1)[0])>PI){
        // At a chart seam, end and restart at the same physical configuration.
        // Never connect +pi to -pi through the middle of the joint-space plot.
        const before=line.at(-1);let lo=before[1],hi=q[1];
        for(let k=0;k<45;k++){const mid=(lo+hi)/2,value=evaluate(mid);if(Math.abs(value[0]-before[0])<PI)lo=mid;else hi=mid;}
        const q3=(lo+hi)/2,edge=Math.sign(before[0])*PI;line.push([edge,q3]);curves.push(line);line=[[-edge,q3]];
      }
      line.push(q);
    };
    for(const q3 of parameters) {
      const q=evaluate(q3);
      if(q){const additions=line.length?refine(line.at(-1),q):[q];additions.forEach(append);}else if(line.length){curves.push(line);line=[];}
    }
    if(line.length)curves.push(line);
  }
  return {joint:curves,workspace:curves.map(line=>line.map(slicePosition))};
}
