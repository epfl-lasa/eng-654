import {customPosition,customDeterminant,slicePosition,solveSliceIK,customCriticalCurves,torusDistance} from '../viz/lecture07CustomMath.js';
export {customPosition,customDeterminant,slicePosition,solveSliceIK,customCriticalCurves,torusDistance};
const PI=Math.PI;
export const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export function geometry(q){
  const [q1,q2]=q,c1=Math.cos(q1),s1=Math.sin(q1),c2=Math.cos(q2),s2=Math.sin(q2);
  return {p:customPosition(q),origins:[[0,0,.5],[c1,s1,1],[c1*(1+2*c2)-1.25*s1,s1*(1+2*c2)+1.25*c1,1-2*s2]],axes:[[0,0,1],[-s1,c1,0],[c1*s2,s1*s2,c2]]};
}
export function geometricJacobian(q){const {p,origins,axes}=geometry(q),cols=axes.map((z,i)=>[...cross(z,p.map((v,j)=>v-origins[i][j])),...z]);return Array.from({length:6},(_,r)=>cols.map(c=>c[r]));}
export function bindings(q){const [q1,q2,q3]=q,c1=Math.cos(q1),c2=Math.cos(q2),c3=Math.cos(q3),s1=Math.sin(q1),s2=Math.sin(q2),s3=Math.sin(q3),u=2+1.5*c3,X=1+u*c2+.25*s2,Y=1.25+1.5*s3,Z=1-u*s2+.25*c2;return {q1,q2,q3,c1,c2,c3,s1,s2,s3,u,X,Y,Z,a1:1,a2:2,a3:1.5,d1:1,d2:1.25,d3:.25};}
export function compileExpression(source){const parser=globalThis.Exercise02Expressions;if(!parser)throw Error('Expression parser did not load.');const tree=parser.parse(source),allowed=bindings([0,0,0]);for(const symbol of parser.symbols(tree))if(!Object.hasOwn(allowed,symbol))throw Error(`Unknown symbol ${symbol}. Use q1…q3, c1…c3, s1…s3, u, X, Y, Z or the listed dimensions.`);return q=>parser.evaluate(tree,bindings(q));}
export const CHECK_CONFIGURATIONS=Array.from({length:43},(_,k)=>k===0?[0,0,0]:[Math.sin(k*1.713)*3.12,Math.sin(k*2.197+.3)*3.12,Math.cos(k*1.331)*3.12]);
export function checkExpression(source,reference){try{const fn=compileExpression(source);for(const q of CHECK_CONFIGURATIONS){const actual=fn(q),expected=reference(q);if(!Number.isFinite(actual)||Math.abs(actual-expected)>2e-6*(1+Math.abs(expected)))return {correct:false,message:'Does not agree with the geometric model at every validation configuration.'};}return {correct:true,message:'Agrees at 43 varied configurations (numerical identity check).'};}catch(error){return {correct:false,message:error.message};}}
// Edge roots include touching zeros, so an equivalent expression such as det²
// remains visible. Poles are rejected by their residual instead of drawn as roots.
export function zeroContours(fn,{n=110,bounds=[[-PI,PI],[-PI,PI]]}={}){
  const [[xmin,xmax],[ymin,ymax]]=bounds,dx=(xmax-xmin)/n,dy=(ymax-ymin)/n,values=[],sample=(x,y)=>{try{const v=fn([0,x,y]);return Number.isFinite(v)?v:NaN;}catch{return NaN;}};
  let invalid=0,allZero=true;for(let j=0;j<=n;j++){values[j]=[];for(let i=0;i<=n;i++){const v=sample(xmin+i*dx,ymin+j*dy);values[j][i]=v;if(!Number.isFinite(v))invalid++;if(v!==0)allZero=false;}}
  if(allZero)return {segments:[],allZero:true,invalid};
  const cache=new Map(),segments=[];
  function edge(i,j,vertical){const key=`${i},${j},${+vertical}`;if(cache.has(key))return cache.get(key);const a=[xmin+i*dx,ymin+j*dy],b=[a[0]+(vertical?0:dx),a[1]+(vertical?dy:0)],fa=values[j][i],fb=values[j+(vertical?1:0)][i+(vertical?0:1)],f=t=>sample(a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t);let t=null;
    if(Number.isFinite(fa)&&Number.isFinite(fb)){
      if(fa===0)t=0;else if(fb===0)t=1;else if(fa*fb<0){let lo=0,hi=1,left=fa;for(let k=0;k<38;k++){const m=(lo+hi)/2,v=f(m);if((v>0)===(left>0)){lo=m;left=v;}else hi=m;}const root=(lo+hi)/2;if(Math.abs(f(root))<1e-8*Math.max(1,Math.abs(fa),Math.abs(fb)))t=root;}
      else {const f0=Math.abs(fa),f1=Math.abs(fb),near0=Math.abs(f(1e-4)),near1=Math.abs(f(1-1e-4));if(near0<f0&&near1<f1){let lo=0,hi=1;for(let k=0;k<48;k++){const a=lo+(hi-lo)*.38196601125,b=lo+(hi-lo)*.61803398875;if(Math.abs(f(a))<Math.abs(f(b)))hi=b;else lo=a;}const root=(lo+hi)/2;if(Math.abs(f(root))<1e-12*Math.max(f0,f1))t=root;}}
    }
    const result=t===null?null:a.map((x,k)=>x+t*(b[k]-x));cache.set(key,result);return result;
  }
  for(let j=0;j<n;j++)for(let i=0;i<n;i++){const points=[edge(i,j,false),edge(i+1,j,true),edge(i,j+1,false),edge(i,j,true)].filter(Boolean).filter((p,k,a)=>!a.slice(0,k).some(r=>Math.hypot(p[0]-r[0],p[1]-r[1])<1e-9));if(points.length===2)segments.push(points);else if(points.length>2){while(points.length>1){const a=points.shift();points.sort((b,c)=>Math.hypot(a[0]-b[0],a[1]-b[1])-Math.hypot(a[0]-c[0],a[1]-c[1]));segments.push([a,points.shift()]);}}}
  return {segments,allZero:false,invalid};
}
export function countGrid({joint=false,n=64}={}){const bounds=joint?[[-PI,PI],[-PI,PI]]:[[0,5],[-3,5]],cells=[];for(let j=0;j<n;j++)for(let i=0;i<n;i++){const p=bounds.map(([lo,hi],a)=>lo+((a?j:i)+.5)*(hi-lo)/n),count=solveSliceIK(joint?slicePosition(p):p).length;cells.push({p,count});}return {bounds,cells,n};}
// Invert exact critical values and retain their REGULAR preimages. Those are
// characteristic configurations: count-region boundaries without rank loss here.
export function characteristicSamples(curves,stride=18){const points=[];for(const line of curves.joint)for(let i=0;i<line.length;i+=stride){const singular=line[i],p=slicePosition(singular);for(const q of solveSliceIK(p))if(Math.abs(customDeterminant(q))>.025)points.push({q,p,det:customDeterminant(q),singular});}return points;}
export function checkRegionPair(answers){try{const qA=['a2','a3'].map(k=>compileExpression(answers[`region.${k}`])([0,0,0])),qB=['b2','b3'].map(k=>compileExpression(answers[`region.${k}`])([0,0,0]));if([...qA,...qB].some(x=>Math.abs(x)>PI))return {correct:false,message:'Keep each angle within [−π, π].'};const counts=[qA,qB].map(q=>solveSliceIK(slicePosition(q)).length),dets=[qA,qB].map(customDeterminant);return {correct:counts[0]===2&&counts[1]===4&&dets[0]*dets[1]>0&&Math.min(...dets.map(Math.abs))>.05,message:`Your A maps to ${counts[0]} IKs; B maps to ${counts[1]} IKs. det Jₚ: ${dets.map(x=>x.toFixed(3)).join(', ')}. Need 2 and 4, both regular, with the same sign.`,counts,dets};}catch(error){return {correct:false,message:error.message};}}
