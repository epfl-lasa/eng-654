//! Reproducible search for a fixed-orientation XY section with many IK counts.
//! Uses existing FK-verified 16-IK reference poses as candidate orientations.
//! Add --rounded to reproduce the eleven rounded height/orientation candidates,
//! or pass a JSON file containing [{"z":0.5,"euler":[0,-0.28,1.47]}, ...].
//! cargo run --release --offline --example lecture07_xy_diversity_search > /tmp/crb-xy-search.json
use crb15000_ik::{Pose, RootMethod, SolveOptions, solve_matrix};
use rayon::prelude::*;
use serde_json::{Value, json};
use std::collections::BTreeMap;
fn solve(p: &Pose) -> (i32, bool) {
    let opt = SolveOptions::default();
    let first = solve_matrix(p, &opt);
    let report = match first {
        Ok(s) if s.diagnostics.roots_converged && s.diagnostics.rejected_real_roots == 0 => Ok(s),
        _ => {
            let mut retry = opt.clone();
            retry.coefficient_precision = 512;
            retry.root_options.method = RootMethod::Reference;
            solve_matrix(p, &retry)
        }
    };
    match report {
        Ok(s) if s.diagnostics.roots_converged && s.diagnostics.rejected_real_roots == 0 => {
            (s.solutions.len() as i32, s.diagnostics.used_fallback)
        }
        _ => (-1, false),
    }
}
fn main() {
    let data: Value =
        serde_json::from_str(include_str!("../tests/data/reference_1000.json")).unwrap();
    let cases = data["cases"].as_array().unwrap();
    let inputs: Vec<(usize, Vec<f64>)> = if let Some(file) = std::env::args().nth(1) {
        let config: Value = if file == "--rounded" {
            json!([
             {"z":0.5,"euler":[0.,-0.28,1.47]},{"z":0.65,"euler":[0.,-0.28,1.47]},{"z":0.73,"euler":[0.,-0.28,1.47]},{"z":0.85,"euler":[0.,-0.28,1.47]},{"z":0.9,"euler":[0.,-0.28,1.47]},{"z":0.95,"euler":[0.,-0.28,1.47]},{"z":1.0,"euler":[0.,-0.28,1.47]},
             {"z":0.51,"euler":[0.,0.7,1.05]},{"z":0.75,"euler":[0.,0.7,1.05]},{"z":0.9,"euler":[0.,0.7,1.05]},{"z":1.0,"euler":[0.,0.7,1.05]}
            ])
        } else {
            serde_json::from_str(&std::fs::read_to_string(file).unwrap()).unwrap()
        };
        config
            .as_array()
            .unwrap()
            .iter()
            .enumerate()
            .map(|(i, c)| {
                let e = c["euler"].as_array().unwrap();
                let (sz, cz) = e[0].as_f64().unwrap().sin_cos();
                let (sy, cy) = e[1].as_f64().unwrap().sin_cos();
                let (sx, cx) = e[2].as_f64().unwrap().sin_cos();
                let z = c["z"].as_f64().unwrap();
                (
                    i,
                    vec![
                        cz * cy,
                        cz * sy * sx - sz * cx,
                        cz * sy * cx + sz * sx,
                        0.,
                        sz * cy,
                        sz * sy * sx + cz * cx,
                        sz * sy * cx - cz * sx,
                        0.,
                        -sy,
                        cy * sx,
                        cy * cx,
                        z,
                        0.,
                        0.,
                        0.,
                        1.,
                    ],
                )
            })
            .collect()
    } else {
        cases
            .iter()
            .enumerate()
            .filter(|(_, c)| c["solutions"].as_array().unwrap().len() == 16)
            .map(|(i, c)| {
                (
                    i,
                    c["pose"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(|v| v.as_f64().unwrap())
                        .collect(),
                )
            })
            .collect()
    };
    let start = std::time::Instant::now();
    let mut candidates = Vec::new();
    for (index, original) in inputs {
        let matrix = Pose::from_row_slice(&original);
        let euler = [
            matrix[(1, 0)].atan2(matrix[(0, 0)]),
            (-matrix[(2, 0)]).asin(),
            matrix[(2, 1)].atan2(matrix[(2, 2)]),
        ];
        let mut hist = BTreeMap::<i32, usize>::new();
        let mut slices = Vec::new();
        for (name, bound, n) in [("full", 0.95, 81usize), ("detail", 0.23, 121usize)] {
            let points: Vec<_> = (0..n * n)
                .into_par_iter()
                .map(|i| {
                    let x = -bound + 2. * bound * (i % n) as f64 / (n - 1) as f64;
                    let y = -bound + 2. * bound * (i / n) as f64 / (n - 1) as f64;
                    let mut p = matrix;
                    p[(0, 3)] = x;
                    p[(1, 3)] = y;
                    let (count, fallback) = solve(&p);
                    (x, y, count, fallback)
                })
                .collect();
            let mut sh = BTreeMap::<i32, usize>::new();
            for &(_, _, c, _) in &points {
                *sh.entry(c).or_default() += 1;
                *hist.entry(c).or_default() += 1;
            }
            let representatives: Vec<_> = sh
                .keys()
                .filter(|&&c| c >= 4)
                .map(|&count| {
                    let (idx, p) = points
                        .iter()
                        .enumerate()
                        .filter(|(_, p)| p.2 == count)
                        .max_by_key(|(i, _)| {
                            let x = i % n;
                            let y = i / n;
                            if x < 2 || y < 2 || x + 2 >= n || y + 2 >= n {
                                return 0usize;
                            }
                            (y - 2..=y + 2)
                                .flat_map(|yy| (x - 2..=x + 2).map(move |xx| yy * n + xx))
                                .filter(|&j| points[j].2 == count)
                                .count()
                        })
                        .unwrap();
                    json!({"count":count,"position":[p.0,p.1,matrix[(2,3)]],"gridIndex":idx})
                })
                .collect();
            slices.push(json!({"name":name,"bound":bound,"n":n,"histogram":sh,"representatives":representatives}));
        }
        let diversity = [4, 6, 8, 10, 12, 14, 16]
            .iter()
            .filter(|c| hist.contains_key(c))
            .count();
        eprintln!(
            "reference {index}: z={:.6}, Euler={euler:?}, diversity={diversity}, histogram={hist:?}, elapsed={:.1}s",
            matrix[(2, 3)],
            start.elapsed().as_secs_f64()
        );
        candidates.push(json!({"referenceIndex":index,"z":matrix[(2,3)],"orientation":[[matrix[(0,0)],matrix[(0,1)],matrix[(0,2)]],[matrix[(1,0)],matrix[(1,1)],matrix[(1,2)]],[matrix[(2,0)],matrix[(2,1)],matrix[(2,2)]]],"orientationEulerZYX":euler,"seedPosition":[matrix[(0,3)],matrix[(1,3)],matrix[(2,3)]],"histogram":hist,"diversity":diversity,"slices":slices}));
    }
    println!(
        "{}",
        serde_json::to_string_pretty(
            &json!({"candidates":candidates,"elapsedSeconds":start.elapsed().as_secs_f64()})
        )
        .unwrap()
    );
}
