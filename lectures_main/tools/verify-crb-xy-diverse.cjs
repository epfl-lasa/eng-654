/* Independently validate and annotate the native Rust 100k XY atlas.
 * Run after examples/lecture07_atlas_xy_diverse.rs. The browser solver uses
 * fixed-point coefficients and real-root isolation in two half-angle charts.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),file=path.join(root,'assets/data/lecture07/crb-slice-xy-diverse.json');
const moduleURL=text=>'data:text/javascript;base64,'+Buffer.from(text).toString('base64');
(async()=>{
 const coeff=moduleURL(fs.readFileSync(path.join(root,'js/viz/abbCrbCoefficients.js'),'utf8'));
 const K=await import(moduleURL(fs.readFileSync(path.join(root,'js/viz/abbCrbKinematics.js'),'utf8').replace('./abbCrbCoefficients.js',coeff)));
 const atlas=JSON.parse(fs.readFileSync(file,'utf8'));
 const pointAt=i=>[atlas.xmin+(i%atlas.nx)*(atlas.xmax-atlas.xmin)/(atlas.nx-1),atlas.ymin+Math.floor(i/atlas.nx)*(atlas.ymax-atlas.ymin)/(atlas.ny-1)];
 const poseAt=p=>K.makePose([...p,atlas.z],atlas.orientation);
 const cache=new Map();let maxPositionError=0,maxRotationError=0;
 function verify(point){
  const key=point.join(',');if(cache.has(key))return cache.get(key);
  const result=K.inverse(poseAt(point));assert.equal(result.diagnostics.resolved,true,`unresolved independent enumeration at ${key}`);
  let minSeparation=Infinity,minAbsDet=Infinity,maxP=0,maxR=0;
  for(let i=0;i<result.solutions.length;i++){
   const a=result.solutions[i],err=K.poseError(K.fk(a.q).matrix,poseAt(point));maxP=Math.max(maxP,err.position);maxR=Math.max(maxR,err.rotation);minAbsDet=Math.min(minAbsDet,Math.abs(K.determinant(a.q)));
   assert.ok(err.position<2e-7&&err.rotation<2e-7);
   for(let j=i+1;j<result.solutions.length;j++)minSeparation=Math.min(minSeparation,Math.hypot(...a.q.map((v,k)=>K.wrap(v-result.solutions[j].q[k]))));
  }
  assert.ok(minSeparation>2e-6,'Roots must be distinct modulo 2π');
  maxPositionError=Math.max(maxPositionError,maxP);maxRotationError=Math.max(maxRotationError,maxR);
  const record={result,count:result.solutions.length,limitCount:result.solutions.filter(r=>r.withinLimits).length,minRootSeparation:Number.isFinite(minSeparation)?minSeparation:null,minAbsDet:Number.isFinite(minAbsDet)?minAbsDet:null,maxPositionError:maxP,maxRotationError:maxR};cache.set(key,record);return record;
 }
 const originalUnresolved=atlas.generation.rustUnresolvedIndices||atlas.generation.unresolvedIndices||[];
 for(const i of originalUnresolved){const v=verify(pointAt(i));atlas.counts[i]=v.count;atlas.limitCounts[i]=v.limitCount;}
 atlas.generation.rustUnresolvedIndices=originalUnresolved;
 atlas.generation.javascriptRecoveredPoses=originalUnresolved.length;
 atlas.generation.unresolvedIndices=atlas.counts.flatMap((c,i)=>c<0?[i]:[]);
 atlas.generation.unresolvedPoses=atlas.generation.unresolvedIndices.length;
 atlas.histogram=Object.fromEntries([...new Set(atlas.counts)].sort((a,b)=>a-b).map(c=>[c,atlas.counts.filter(v=>v===c).length]));
 const highCountIndices=atlas.counts.flatMap((c,i)=>c>=14?[i]:[]);
 const sampleIndices=new Set([...highCountIndices,...Array.from({length:257},(_,i)=>(i*7919+109)%atlas.sampleCount)]);
 for(const i of sampleIndices){const v=verify(pointAt(i));assert.equal(v.count,atlas.counts[i],`Rust/JS count disagreement at grid ${i}`);assert.equal(v.limitCount,atlas.limitCounts[i],`limit count disagreement at grid ${i}`);}
 const representativePoints=[];
 for(const count of [4,6,8,10,12,14,16]){
  const candidates=atlas.counts.flatMap((c,index)=>{
   if(c!==count)return[];const x=index%atlas.nx,y=Math.floor(index/atlas.nx);let neighbours=0;
   for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){const xx=x+dx,yy=y+dy;if(xx>=0&&xx<atlas.nx&&yy>=0&&yy<atlas.ny&&atlas.counts[yy*atlas.nx+xx]===count)neighbours++;}
   return[{index,neighbours}];
  }).sort((a,b)=>b.neighbours-a.neighbours).slice(0,32);
  assert.ok(candidates.length,`Missing ${count}-IK region`);
  let chosen;
  for(const candidate of candidates){const p=pointAt(candidate.index),v=verify(p);assert.equal(v.count,count);if(!chosen||v.minAbsDet>chosen.verification.minAbsDet)chosen={count,point:p,limitCount:v.limitCount,gridIndex:candidate.index,neighbours:candidate.neighbours,verification:{minRootSeparation:v.minRootSeparation,minAbsDet:v.minAbsDet,maxPositionError:v.maxPositionError,maxRotationError:v.maxRotationError}};}
  representativePoints.push(chosen);
 }
 atlas.representativePoints=representativePoints;
 atlas.detailBounds=[-.23,.23,-.23,.23];
 atlas.demonstrationPoint=[0,-.075];delete atlas.defaultPoint;
 const vertices=Array.from({length:121},(_,i)=>[.1+.1*Math.cos(Math.PI+2*Math.PI*i/120),-.075+.1*Math.sin(Math.PI+2*Math.PI*i/120)]);
 vertices[0]=atlas.demonstrationPoint.slice();vertices[120]=atlas.demonstrationPoint.slice();
 const targets=[];
 for(let i=1;i<vertices.length;i++){const a=vertices[i-1],b=vertices[i],n=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/.003));for(let j=0;j<n;j++)targets.push(poseAt(a.map((v,k)=>v+(b[k]-v)*j/n)));}
 targets.push(poseAt(vertices.at(-1)));
 const starts=verify(atlas.demonstrationPoint),tracks=starts.result.solutions.map((s,index)=>({index,...K.followPath(targets,s.q)}));
 atlas.demonstrationPath={vertices,center:[.1,-.075],radius:.1,samples:121,description:'A 20 cm diameter XY circle, starting in the 16-IK region. Every pose has the same tool orientation.',verification:{samplingStep:.003,targetSamples:targets.length,geometricStartCount:starts.count,legalStartCount:starts.limitCount,completeIndices:tracks.filter(t=>t.complete).map(t=>t.index),tracks:tracks.map(t=>({index:t.index,complete:t.complete,reason:t.reason,pointCount:t.q.length,minAbsDet:t.minDet,minLimitMargin:t.minLimitMargin,maxPositionError:t.maxPositionError,maxRotationError:t.maxRotationError,stop:t.stop}))}};
 assert.equal(starts.count,16);assert.ok(tracks.some(t=>t.complete)&&tracks.some(t=>!t.complete));
 atlas.generation.independentVerification={method:'JavaScript real-root isolation in two half-angle charts, native URDF FK and distinctness modulo 2π',poses:cache.size,all14And16GridPoints:highCountIndices.length,spreadGridPoints:257,maxPositionError,maxRotationError};
 atlas.generation.search={candidateSlices:17,samplesPerCandidate:21202,selection:'All seven requested even IK counts in one slice, with a comparatively large 16-IK region.'};
 fs.writeFileSync(file,JSON.stringify(atlas));
 console.log(JSON.stringify({histogram:atlas.histogram,recovered:originalUnresolved.length,unresolved:atlas.generation.unresolvedPoses,representativePoints,demonstration:atlas.demonstrationPath.verification,independentVerification:atlas.generation.independentVerification},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
