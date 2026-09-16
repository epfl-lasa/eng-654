//! Regenerate the exact 100,000-query Lecture 07 XZ atlas from the supplied solver.
//! cargo run --release --offline --manifest-path lectures_main/assets/abb_irb_ik/Cargo.toml --example lecture07_atlas_xz > lectures_main/assets/data/lecture07/crb-slice-xz.json
use crb15000_ik::{Frame,SolveOptions,solve_matrix,JOINT_LIMITS,Pose,RootMethod};
use rayon::prelude::*;
use serde_json::json;
fn main(){
 let nx=400usize;let ny=250usize;let min=-1.1;let max=1.1;let zmin=-0.75;let zmax=1.4;let y=0.2;
 let (sx,cx)=(0.4_f64).sin_cos();let (sy,cy)=(1.1_f64).sin_cos();let (sz,cz)=(0.3_f64).sin_cos();
 let r=[[cz*cy,cz*sy*sx-sz*cx,cz*sy*cx+sz*sx],[sz*cy,sz*sy*sx+cz*cx,sz*sy*cx-cz*sx],[-sy,cy*sx,cy*cx]];
 let opts=SolveOptions{frame:Frame::Tool0,..SolveOptions::default()};
 let start=std::time::Instant::now();
 let data:Vec<_>=(0..nx*ny).into_par_iter().map(|i|{
  let x=min+(max-min)*(i%nx)as f64/(nx-1)as f64;let z=zmin+(zmax-zmin)*(i/nx)as f64/(ny-1)as f64;
  let p=Pose::new(r[0][0],r[0][1],r[0][2],x,r[1][0],r[1][1],r[1][2],y,r[2][0],r[2][1],r[2][2],z,0.,0.,0.,1.);
  let report=solve_matrix(&p,&opts).or_else(|_|{let mut retry=opts.clone();retry.coefficient_precision=512;retry.root_options.method=RootMethod::Reference;solve_matrix(&p,&retry)});
  match report{Ok(s)=>{
   let legal=s.solutions.iter().filter(|s|s.q.iter().zip(JOINT_LIMITS).all(|(&v,[lo,hi])|[-1.,0.,1.].iter().any(|&k|v+k*std::f64::consts::TAU>=lo-1e-10&&v+k*std::f64::consts::TAU<=hi+1e-10))).count();
   (s.solutions.len()as i32,legal as i32,s.diagnostics.used_fallback,s.solutions.iter().map(|v|v.position_error.max(v.rotation_error)).fold(0.,f64::max))
  },Err(_)=>(-1,-1,false,0.)}
 }).collect();
 let counts:Vec<_>=data.iter().map(|x|x.0).collect();let legal:Vec<_>=data.iter().map(|x|x.1).collect();
 let out=json!({"formatVersion":2,"plane":"xz","fixedAxis":"y","robot":"ABB CRB15000-5/0.95","frame":"tool0","nx":nx,"nz":ny,"sampleCount":nx*ny,"xmin":min,"xmax":max,"zmin":zmin,"zmax":zmax,"y":y,"orientation":r,"orientationEulerZYX":[0.3,1.1,0.4],"orientationDescription":"Rz(0.3) Ry(1.1) Rx(0.4), radians","sampling":"vertices","rowOrder":"z-increasing","counts":counts,"limitCounts":legal,"unresolvedValue":-1,"solver":"Supplied Rust adaptive degree-16 solver, 128–320-bit coefficients and roots, reference-mode retry at 512 bits", "jointLimits":JOINT_LIMITS,"limitHandling":"Distinct geometric IKs modulo 2π; one legal representative per branch. Joint 3 may be below −π; axis 6 uses ABB GoFa 5 ±270° movement range. Additional axis-6 windings are not counted twice.","generation":{"targetPoses":nx*ny,"elapsedSeconds":start.elapsed().as_secs_f64(),"fallbackPoses":data.iter().filter(|v|v.2).count(),"unresolvedPoses":data.iter().filter(|v|v.0<0).count(),"maxFkError":data.iter().map(|v|v.3).fold(0.,f64::max)},"completeness":"Numerical algebraic enumeration with FK validation; singular continuous families are not enumerated and unresolved roots are kept separate from zero solutions."});
 println!("{}",serde_json::to_string(&out).unwrap());
}
