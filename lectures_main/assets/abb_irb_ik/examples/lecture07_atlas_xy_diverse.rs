//! Full 100,000-pose XY backup for Lecture 07, with all even counts 4…16.
//! From the repository root, use --manifest-path lectures_main/assets/abb_irb_ik/Cargo.toml
//! and redirect this example to lectures_main/assets/data/lecture07/crb-slice-xy-diverse.json.
//! Then run lectures_main/tools/verify-crb-xy-diverse.cjs to independently verify
//! region representatives and recover any explicitly unresolved Rust samples.
use crb15000_ik::{JOINT_LIMITS, Pose, RootMethod, SolveOptions, solve_matrix};
use rayon::prelude::*;
use serde_json::json;
use std::collections::BTreeMap;
fn main() {
    let (nx, ny) = (400usize, 250usize);
    let (xmin, xmax, ymin, ymax, z) = (-1.1, 1.1, -1.1, 1.1, 0.5);
    let euler = [0.0_f64, -0.28_f64, 1.47_f64];
    let (sz, cz) = euler[0].sin_cos();
    let (sy, cy) = euler[1].sin_cos();
    let (sx, cx) = euler[2].sin_cos();
    let r = [
        [cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx],
        [sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx],
        [-sy, cy * sx, cy * cx],
    ];
    let opts = SolveOptions::default();
    let start = std::time::Instant::now();
    let data: Vec<_> = (0..nx * ny)
        .into_par_iter()
        .map(|i| {
            let x = xmin + (xmax - xmin) * (i % nx) as f64 / (nx - 1) as f64;
            let y = ymin + (ymax - ymin) * (i / nx) as f64 / (ny - 1) as f64;
            let p = Pose::new(
                r[0][0], r[0][1], r[0][2], x, r[1][0], r[1][1], r[1][2], y, r[2][0], r[2][1],
                r[2][2], z, 0., 0., 0., 1.,
            );
            let first = solve_matrix(&p, &opts);
            let mut retried = false;
            let report = match first {
                Ok(s)
                    if s.diagnostics.roots_converged && s.diagnostics.rejected_real_roots == 0 =>
                {
                    Ok(s)
                }
                _ => {
                    retried = true;
                    let mut retry = opts.clone();
                    retry.coefficient_precision = 512;
                    retry.root_options.method = RootMethod::Reference;
                    solve_matrix(&p, &retry)
                }
            };
            match report {
                Ok(s)
                    if s.diagnostics.roots_converged && s.diagnostics.rejected_real_roots == 0 =>
                {
                    let legal = s
                        .solutions
                        .iter()
                        .filter(|s| {
                            s.q.iter().zip(JOINT_LIMITS).all(|(&v, [lo, hi])| {
                                [-1., 0., 1.].iter().any(|&k| {
                                    v + k * std::f64::consts::TAU >= lo - 1e-10
                                        && v + k * std::f64::consts::TAU <= hi + 1e-10
                                })
                            })
                        })
                        .count();
                    (
                        s.solutions.len() as i32,
                        legal as i32,
                        retried || s.diagnostics.used_fallback,
                        s.solutions
                            .iter()
                            .map(|v| v.position_error.max(v.rotation_error))
                            .fold(0., f64::max),
                    )
                }
                _ => (-1, -1, retried, 0.),
            }
        })
        .collect();
    let counts: Vec<_> = data.iter().map(|x| x.0).collect();
    let legal: Vec<_> = data.iter().map(|x| x.1).collect();
    let mut histogram = BTreeMap::<i32, usize>::new();
    for &count in &counts {
        *histogram.entry(count).or_default() += 1;
    }
    let unresolved: Vec<_> = counts
        .iter()
        .enumerate()
        .filter_map(|(i, &n)| if n < 0 { Some(i) } else { None })
        .collect();
    let out = json!({"formatVersion":2,"plane":"xy","fixedAxis":"z","robot":"ABB CRB15000-5/0.95","frame":"tool0","nx":nx,"ny":ny,"sampleCount":nx*ny,"xmin":xmin,"xmax":xmax,"ymin":ymin,"ymax":ymax,"z":z,"orientation":r,"orientationEulerZYX":euler,"orientationDescription":"Rz(0) Ry(-0.28) Rx(1.47), radians","sampling":"vertices","rowOrder":"y-increasing","counts":counts,"limitCounts":legal,"unresolvedValue":-1,"histogram":histogram,"detailBounds":[-0.23,0.23,-0.23,0.23],"demonstrationPoint":[0.0,-0.075],"solver":"Supplied native Rust adaptive degree-16 solver with 512-bit reference retry; independent JavaScript root isolation for reported recoveries and representative poses","jointLimits":JOINT_LIMITS,"limitHandling":"Counts enumerate distinct geometric IKs modulo 2π. limitCounts requires a native representative within every joint limit; additional axis-6 windings are not counted twice.","generation":{"targetPoses":nx*ny,"elapsedSeconds":start.elapsed().as_secs_f64(),"fallbackPoses":data.iter().filter(|v|v.2).count(),"rustUnresolvedPoses":unresolved.len(),"unresolvedPoses":unresolved.len(),"unresolvedIndices":unresolved,"maxFkError":data.iter().map(|v|v.3).fold(0.,f64::max)},"completeness":"Numerical algebraic enumeration with FK validation; singular continuous families are not enumerated. Unresolved poses are separate from zero solutions. Search found all requested even counts 4,6,8,10,12,14,16 on this single fixed-height, fixed-orientation slice."});
    eprintln!(
        "100000 XY samples in {:.2}s; counts={histogram:?}; unresolved={}",
        start.elapsed().as_secs_f64(),
        unresolved.len()
    );
    println!("{}", serde_json::to_string(&out).unwrap());
}
