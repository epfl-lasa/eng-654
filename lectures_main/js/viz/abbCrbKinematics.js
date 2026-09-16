/** ABB GoFa CRB15000-5/0.95: native URDF coordinates, metres and radians.
 * Algebraic IK follows the supplied Rust degree-16 elimination/back substitution.
 * Real roots are isolated numerically in tan(q6/2) and its reciprocal, using
 * 160-bit fixed-point coefficient/evaluation arithmetic. Returned branches pass
 * independent URDF FK checks. This is numerical enumeration, not a certificate
 * for singular continuous families. */
import { SCALE, mul, div, fixed, coefficients } from './abbCrbCoefficients.js';
// ABB GoFa datasheet 9AKK107991A8564, GoFa 5 movement table: axis 6 is ±270°.
// The uploaded URDF had a narrower ±180° value; geometry and native axes are unchanged.
export const jointLimits=[[-Math.PI,Math.PI],[-Math.PI,Math.PI],[-3.9269908169872414,1.4835298641951802],[-Math.PI,Math.PI],[-Math.PI,Math.PI],[-1.5*Math.PI,1.5*Math.PI]];
export const JOINT_LIMITS=jointLimits;
const TAU=2*Math.PI,D1=.265,A2=.444,A3=.110,D4=.470,A5=.080,D6=.101,L2=A3*A3+D4*D4;
export const wrap=a=>((a+Math.PI)%TAU+TAU)%TAU-Math.PI;
const eye=()=>[[1,0,0],[0,1,0],[0,0,1]];
const rx=a=>{const s=Math.sin(a),c=Math.cos(a);return [[1,0,0],[0,c,-s],[0,s,c]];};
const ry=a=>{const s=Math.sin(a),c=Math.cos(a);return [[c,0,s],[0,1,0],[-s,0,c]];};
const rz=a=>{const s=Math.sin(a),c=Math.cos(a);return [[c,-s,0],[s,c,0],[0,0,1]];};
const RX90=[[1,0,0],[0,0,-1],[0,1,0]],RY90=[[0,0,1],[0,1,0],[-1,0,0]],XLINK6=[[0,0,1],[0,-1,0],[1,0,0]];
export const transpose=a=>a[0].map((_,i)=>a.map(r=>r[i]));
export const mm=(a,b)=>a.map(row=>b[0].map((_,j)=>row.reduce((s,x,k)=>s+x*b[k][j],0)));
const mv=(a,v)=>a.map(r=>r.reduce((s,x,i)=>s+x*v[i],0));
const add=(a,b)=>a.map((v,i)=>v+b[i]);
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const scale=(a,s)=>a.map(x=>x*s);
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const norm=a=>Math.hypot(...a);
const col=(m,i)=>m.map(r=>r[i]);
export const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const pose=(r,p)=>[...r.map((v,i)=>[...v,p[i]]),[0,0,0,1]];
const matrix=t=>Array.isArray(t[0])?t:Array.from({length:4},(_,i)=>t.slice(i*4,i*4+4));
export function makePose(position,rotation=RY90){return pose(rotation,position);}
export function fk(q){
 if(!Array.isArray(q)||q.length!==6||!q.every(Number.isFinite))throw new Error('Six finite joint coordinates are required.');
 let r=eye(),p=[0,0,0];const links={base_link:pose(r,p)},axes=[],origins=[];
 const offsets=[[0,0,D1],[0,0,0],[0,0,A2],[0,0,A3],[D4,0,0],[D6,0,A5]];
 const localAxes=[[0,0,1],[0,1,0],[0,1,0],[1,0,0],[0,1,0],[1,0,0]];
 const rots=[rz,ry,ry,rx,ry,rx];
 for(let i=0;i<6;i++){p=add(p,mv(r,offsets[i]));origins.push(p.slice());axes.push(mv(r,localAxes[i]));r=mm(r,rots[i](q[i]));links[`link_${i+1}`]=pose(r,p);}
 const rotation=mm(r,RY90),T=pose(rotation,p);links.tool0=T;links.flange=links.link_6;
 return {matrix:T,position:p,rotation,links,axes,origins};
}
export function jacobian(q){const f=fk(q);const columns=f.axes.map((a,i)=>[...cross(a,sub(f.position,f.origins[i])),...a]);return transpose(columns);}
export function detMatrix(a){const m=a.map(r=>r.slice());let d=1;for(let i=0;i<m.length;i++){let k=i;for(let j=i+1;j<m.length;j++)if(Math.abs(m[j][i])>Math.abs(m[k][i]))k=j;if(Math.abs(m[k][i])<1e-16)return 0;if(k!==i){[m[i],m[k]]=[m[k],m[i]];d=-d;}const v=m[i][i];d*=v;for(let j=i+1;j<m.length;j++){const s=m[j][i]/v;for(let k=i+1;k<m.length;k++)m[j][k]-=s*m[i][k];}}return d;}
export const determinant=q=>detMatrix(jacobian(q));
export function withinLimits(q,tol=1e-10){return q.every((v,i)=>v>=jointLimits[i][0]-tol&&v<=jointLimits[i][1]+tol);}
/** Select a legal 2π representative, especially q3 in [-225°,85°]. */
export function legalRepresentative(q){return q.map((v,i)=>{v=wrap(v);const [lo,hi]=jointLimits[i];for(const x of [v,v-TAU,v+TAU])if(x>=lo-1e-10&&x<=hi+1e-10)return x;return v;});}
export function rotationError(a,b){const r=mm(transpose(a),b);return Math.atan2(.5*norm([r[2][1]-r[1][2],r[0][2]-r[2][0],r[1][0]-r[0][1]]),Math.max(-1,Math.min(1,(r[0][0]+r[1][1]+r[2][2]-1)/2)));}
export function poseError(a,b){a=matrix(a);b=matrix(b);return {position:norm([0,1,2].map(i=>a[i][3]-b[i][3])),rotation:rotationError(a.slice(0,3).map(r=>r.slice(0,3)),b.slice(0,3).map(r=>r.slice(0,3)))};}
function quaternion(r){let q;const trace=r[0][0]+r[1][1]+r[2][2];if(trace>0){const s=Math.sqrt(trace+1)*2;q=[s/4,(r[2][1]-r[1][2])/s,(r[0][2]-r[2][0])/s,(r[1][0]-r[0][1])/s];}else{let i=0;if(r[1][1]>r[0][0])i=1;if(r[2][2]>r[i][i])i=2;const j=(i+1)%3,k=(i+2)%3,s=Math.sqrt(Math.max(0,1+r[i][i]-r[j][j]-r[k][k]))*2;q=[(r[k][j]-r[j][k])/s,0,0,0];q[i+1]=s/4;q[j+1]=(r[j][i]+r[i][j])/s;q[k+1]=(r[k][i]+r[i][k])/s;}return scale(q,1/norm(q));}
function isqrt(n){if(n<2n)return n;let a=1n<<BigInt(Math.ceil(n.toString(2).length/2));for(;;){const b=(a+n/a)>>1n;if(b>=a)return a;a=b;}}
function highPrecisionCoefficients(p,r){
 let q=quaternion(r).map(fixed);const n=isqrt(q.reduce((s,v)=>s+v*v,0n));q=q.map(v=>div(v,n));const [w,x,y,z]=q;
 const two=2n;const xx=mul(x,x),yy=mul(y,y),zz=mul(z,z),xy=mul(x,y),xz=mul(x,z),yz=mul(y,z),wx=mul(w,x),wy=mul(w,y),wz=mul(w,z);
 const xd=[SCALE-two*(yy+zz),two*(xy+wz),two*(xz-wy)],yd=[two*(xy-wz),SCALE-two*(xx+zz),two*(yz+wx)],zd=[two*(xz+wy),two*(yz-wx),SCALE-two*(xx+yy)];
 const c=p.map((x,i)=>fixed(x)-mul(fixed(D6),zd[i]));const dp=(a,b)=>a.reduce((s,v,i)=>s+mul(v,b[i]),0n);
 return coefficients([dp(c,c),dp(c,xd),dp(c,yd),c[2],xd[2],yd[2]]);
}
const absBig=n=>n<0n?-n:n;
function polyAt(c,x){const t=fixed(x);let v=c[c.length-1];for(let i=c.length-2;i>=0;i--)v=mul(v,t)+c[i];return v;}
/** Critical-point subdivision is exhaustive for simple real roots in [-1,1]. */
function isolate(c,lo=-1,hi=1){
 while(c.length>1&&c[c.length-1]===0n)c=c.slice(0,-1);const n=c.length-1;if(n===0)return [];
 if(n===1){const x=-Number(c[0])/Number(c[1]);return x>=lo-1e-15&&x<=hi+1e-15?[Math.max(lo,Math.min(hi,x))]:[];}
 const critical=isolate(c.slice(1).map((v,i)=>v*BigInt(i+1)),lo,hi),cuts=[lo,...critical.filter(x=>x>lo+1e-15&&x<hi-1e-15),hi],out=[];
 const magnitude=c.reduce((s,v)=>s+absBig(v),0n);const near=magnitude/1000000000000000000000000000000n;
 let a=cuts[0],fa=polyAt(c,a);if(absBig(fa)<=near)out.push(a);
 for(let i=1;i<cuts.length;i++){let b=cuts[i],fb=polyAt(c,b);if(absBig(fb)<=near)out.push(b);if((fa<0n&&fb>0n)||(fa>0n&&fb<0n)){let l=a,h=b,fl=fa;for(let k=0;k<55&&h-l>2e-15;k++){const m=(l+h)/2,fm=polyAt(c,m);if(fm===0n){l=h=m;break;}if((fm<0n)===(fl<0n)){l=m;fl=fm;}else h=m;}out.push((l+h)/2);}a=b;fa=fb;}
 return out.sort((a,b)=>a-b).filter((x,i,v)=>!i||Math.abs(x-v[i-1])>1e-11);
}
function backSubstitute(target,t6){
 const p=target.slice(0,3).map(r=>r[3]),rot=target.slice(0,3).map(r=>r.slice(0,3)),dh=mm(mm(rot,transpose(RY90)),XLINK6),xd=col(dh,0),yd=col(dh,1),zd=col(dh,2),c=sub(p,scale(zd,D6));
 const th6=2*Math.atan(t6),s6=Math.sin(th6),c6=Math.cos(th6),x5=sub(scale(xd,c6),scale(yd,s6)),l5=add(scale(xd,s6),scale(yd,c6)),p2=sub(c,scale(x5,A5)),rho=Math.hypot(p2[0],p2[1]);if(rho<1e-10)return [];
 const z=p2[2]-D1,k=(rho*rho+z*z+A2*A2-L2)/(2*A2),m=Math.hypot(rho,z);if(m<1e-12||Math.abs(k)>m+1e-9)return [];
 const delta=Math.acos(Math.max(-1,Math.min(1,k/m))),out=[];
 for(const radial of [1,-1]){const qr=radial*rho,th1=Math.atan2(p2[1]/qr,p2[0]/qr),s1=Math.sin(th1),c1=Math.cos(th1),l3=[s1,-c1,0],phi=Math.atan2(z,qr);
 for(const th2 of [wrap(phi+delta),wrap(phi-delta)]){const s2=Math.sin(th2),c2=Math.cos(th2),p1=[A2*c1*c2,A2*s1*c2,D1+A2*s2],r=sub(p2,p1),f3=dot(r,l5)**2+A3*A3*dot(l3,l5)**2-A3*A3;if(Math.max(Math.abs(dot(r,r)-L2),Math.abs(dot(r,l3)),Math.abs(f3))>2e-6)continue;
 const cr=cross(l3,r),r02=[[c1*c2,-c1*s2,s1],[s1*c2,-s1*s2,-c1],[s2,c2,0]];
 for(const branch of [1,-1]){const l4=scale(add(scale(r,D4),scale(cr,branch*A3)),1/L2);if(Math.abs(dot(l4,l5))>2e-6)continue;const v3=mv(transpose(r02),l4),th3=Math.atan2(v3[0],-v3[1]),r03=mm(mm(r02,rz(th3)),RX90),v4=mv(transpose(r03),l5),th4=Math.atan2(v4[0],-v4[1]),r04=mm(mm(r03,rz(th4)),RX90),v5=mv(transpose(r04),zd),th5=Math.atan2(v5[0],-v5[1]);
 const q=legalRepresentative([th1,Math.PI/2-th2,-th3,th4-Math.PI,Math.PI-th5,th6]),error=poseError(fk(q).matrix,target);if(error.position<2e-7&&error.rotation<2e-7)out.push({q,withinLimits:withinLimits(q),det:determinant(q),positionError:error.position,rotationError:error.rotation,radialBranch:radial,j4Branch:branch});
 }}}
 return out;
}
export function inverse(input,{respectLimits=false}={}){
 const target=matrix(input);if(target.length!==4||target.some(r=>r.length!==4||!r.every(Number.isFinite)))throw new Error('A finite 4×4 tool0 pose is required.');
 if(target[3].some((v,i)=>Math.abs(v-Number(i===3))>1e-12))throw new Error('The homogeneous final row must be [0, 0, 0, 1].');
 const r=target.slice(0,3).map(v=>v.slice(0,3));if(Math.abs(detMatrix(r)-1)>1e-6||mm(transpose(r),r).some((row,i)=>row.some((v,j)=>Math.abs(v-Number(i===j))>1e-6)))throw new Error('The target rotation must be orthonormal.');
 const dh=mm(mm(r,transpose(RY90)),XLINK6),p=target.slice(0,3).map(v=>v[3]),c=highPrecisionCoefficients(p,dh),magnitude=c.reduce((s,v)=>s+absBig(v),0n);
 if(magnitude===0n)return {solutions:[],diagnostics:{resolved:false,message:'Degenerate polynomial: singular family requires separate treatment.'}};
 const direct=isolate(c),reciprocal=isolate(c.slice().reverse()),roots=[...direct,...reciprocal.filter(x=>Math.abs(x)>1e-14&&Math.abs(x)<1-1e-11).map(x=>1/x)];
 if(absBig(c[16])*100000000000000000000n<magnitude)roots.push(1e16);
 const solutions=[];let rejected=0;
 for(const t of roots){const candidates=backSubstitute(target,t);if(!candidates.length)rejected++;for(const s of candidates)if((!respectLimits||s.withinLimits)&&!solutions.some(a=>norm(a.q.map((v,i)=>wrap(v-s.q[i])))<2e-6))solutions.push(s);}
 // Always test the half-angle chart pole. A pose rounded to doubles can turn
 // an exact q6=π root into an enormous finite root; FK verification decides
 // whether this pole candidate is valid, without labeling a rejected probe
 // as an unresolved polynomial root.
 for(const s of backSubstitute(target,1e16))if((!respectLimits||s.withinLimits)&&!solutions.some(a=>norm(a.q.map((v,i)=>wrap(v-s.q[i])))<2e-6))solutions.push(s);
 solutions.sort((a,b)=>{for(let i=0;i<6;i++)if(Math.abs(a.q[i]-b.q[i])>1e-10)return a.q[i]-b.q[i];return 0;});
 return {solutions,diagnostics:{resolved:rejected===0,realRoots:roots.length,rejectedRoots:rejected,coefficientFractionalBits:160,method:'Degree-16 polynomial, two half-angle charts, critical-point subdivision, URDF FK verification',countConvention:'Distinct geometric IKs modulo 2π; one legal representative per branch, additional axis-6 windings are not counted again.'}};
}
function solveLinear(A,b){const n=b.length,m=A.map((r,i)=>[...r,b[i]]);for(let i=0;i<n;i++){let k=i;for(let j=i+1;j<n;j++)if(Math.abs(m[j][i])>Math.abs(m[k][i]))k=j;if(Math.abs(m[k][i])<1e-14)return null;[m[k],m[i]]=[m[i],m[k]];let v=m[i][i];for(let j=i;j<=n;j++)m[i][j]/=v;for(let k=0;k<n;k++)if(k!==i){v=m[k][i];for(let j=i;j<=n;j++)m[k][j]-=v*m[i][j];}}return m.map(r=>r[n]);}
function residual(target,f){const rt=target.slice(0,3).map(r=>r.slice(0,3)),w=scale([0,1,2].reduce((v,i)=>add(v,cross(col(f.rotation,i),col(rt,i))),[0,0,0]),.5);return [...sub(target.slice(0,3).map(r=>r[3]),f.position),...w];}
/** Local branch continuation; never wraps across mechanical joint stops. */
export function refine(input,seed,{maxIterations=35,tolerance=2e-9,respectLimits=true}={}){
 const target=matrix(input);let q=seed.slice();
 for(let i=0;i<maxIterations;i++){const f=fk(q),e=poseError(f.matrix,target);if(e.position<tolerance&&e.rotation<tolerance)return {q,withinLimits:withinLimits(q),det:determinant(q),positionError:e.position,rotationError:e.rotation};const err=residual(target,f),step=solveLinear(jacobian(q),err);if(!step)return null;const a=Math.min(1,.18/Math.max(...step.map(Math.abs)));q=q.map((v,i)=>v+a*step[i]);if(respectLimits&&!withinLimits(q))return null;}
 return null;
}
function interpolatePose(a,b,t){
 const qa=quaternion(a.slice(0,3).map(r=>r.slice(0,3)));let qb=quaternion(b.slice(0,3).map(r=>r.slice(0,3))),c=dot(qa,qb);if(c<0){qb=scale(qb,-1);c=-c;}
 const angle=Math.acos(Math.min(1,c)),sn=Math.sin(angle);let q=qa.map((v,i)=>angle<1e-8?v*(1-t)+qb[i]*t:(v*Math.sin((1-t)*angle)+qb[i]*Math.sin(t*angle))/sn);q=scale(q,1/norm(q));const [w,x,y,z]=q;
 return makePose(a.slice(0,3).map((r,i)=>r[3]+(b[i][3]-r[3])*t),[[1-2*(y*y+z*z),2*(x*y-w*z),2*(x*z+w*y)],[2*(x*y+w*z),1-2*(x*x+z*z),2*(y*z-w*x)],[2*(x*z-w*y),2*(y*z+w*x),1-2*(x*x+y*y)]]);
}
/** Refine the first mechanical stop on this continuous, unwrapped branch.
 * Pose-wise IK may choose another 2π representative; doing that during motion
 * would jump across a bounded revolute joint's stop. */
function locateLimitStop(targets,i,previous,attempted,parameters){
 let lo=0,hi=1,safe=previous.slice();
 for(let k=0;k<32;k++){const t=(lo+hi)/2,result=refine(interpolatePose(matrix(targets[i-1]),matrix(targets[i]),t),previous,{respectLimits:false,tolerance:1e-12,maxIterations:50});if(!result)break;if(withinLimits(result.q,0)){lo=t;safe=result.q;}else hi=t;}
 const candidates=attempted.map((v,j)=>({joint:j,limit:v<jointLimits[j][0]?jointLimits[j][0]:jointLimits[j][1],outside:v<jointLimits[j][0]||v>jointLimits[j][1]})).filter(v=>v.outside);
 const hit=candidates.sort((a,b)=>Math.abs(safe[a.joint]-a.limit)-Math.abs(safe[b.joint]-b.limit))[0],representative=legalRepresentative(attempted);
 return {kind:'joint-limit',joint:hit.joint,limit:hit.limit,range:jointLimits[hit.joint].slice(),lastSafe:previous[hit.joint],attempted:attempted[hit.joint],boundaryQ:safe,position:fk(safe).position,
  progress:parameters[i-1]+(parameters[i]-parameters[i-1])*lo,attemptProgress:parameters[i],wrappedEquivalent:withinLimits(representative)&&Math.abs(representative[hit.joint]-attempted[hit.joint])>Math.PI};
}
export function followPath(targets,startQ,{minDet=1e-5,maxJointStep=.16,subdivisions=4}={}){
 const qs=[startQ.slice()],sign=Math.sign(determinant(startQ));let q=startQ.slice(),smallestDet=Math.abs(determinant(q));
 const distances=[0];for(let i=1;i<targets.length;i++)distances.push(distances.at(-1)+norm(matrix(targets[i]).slice(0,3).map((r,k)=>r[3]-matrix(targets[i-1])[k][3])));const total=distances.at(-1),parameters=distances.map((v,i)=>total>1e-12?v/total:i/Math.max(1,targets.length-1));
 const finish=(complete,failedAt,reason,stop=null)=>{let maxPositionError=0,maxRotationError=0;qs.forEach((q,i)=>{if(targets[i]){const e=poseError(fk(q).matrix,targets[i]);maxPositionError=Math.max(maxPositionError,e.position);maxRotationError=Math.max(maxRotationError,e.rotation);}});return {q:qs,s:parameters.slice(0,qs.length),success:complete,failIndex:failedAt,qs,complete,failedAt,reason,stop,minDet:smallestDet,minLimitMargin:Math.min(...qs.flatMap(q=>q.map((v,i)=>Math.min(v-jointLimits[i][0],jointLimits[i][1]-v)))),maxPositionError,maxRotationError};};
 if(!withinLimits(q)||Math.abs(determinant(q))<minDet)return finish(false,0,'Starting configuration violates limits or the singularity margin.');
 for(let i=1;i<targets.length;i++){const s=refine(targets[i],q,{respectLimits:false});if(!s)return finish(false,i,'Local IK did not converge.');if(!withinLimits(s.q)){const stop=locateLimitStop(targets,i,q,s.q,parameters);return finish(false,i,`A joint limit is reached: q${stop.joint+1} = ${(stop.limit*180/Math.PI).toFixed(0)}° at s = ${stop.progress.toFixed(4)}.`,stop);}if(Math.max(...s.q.map((v,k)=>Math.abs(v-q[k])))>maxJointStep)return finish(false,i,'The local branch requires an excessive joint step near a singularity.');for(let j=1;j<=subdivisions;j++){const v=q.map((x,k)=>x+(s.q[k]-x)*j/subdivisions),d=determinant(v);smallestDet=Math.min(smallestDet,Math.abs(d));if(Math.sign(d)!==sign||Math.abs(d)<minDet)return finish(false,i,'The singularity margin is reached.');}q=s.q;qs.push(q);}
 return finish(true,null,'The selected branch follows the full path within the tested joint-limit and nonsingularity margins.');
}
