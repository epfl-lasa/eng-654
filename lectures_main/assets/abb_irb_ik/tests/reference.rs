//! Compare complete IK branch sets against the original 80-digit Python solver.

use crb15000_ik::coefficients::coefficients_from_pose;
use crb15000_ik::kinematics::PreparedPose;
use crb15000_ik::{Frame, Pose, SolveOptions, solve_batch, solve_matrix};
use rug::Float;
use serde::Deserialize;
use std::sync::OnceLock;

#[derive(Deserialize)]
struct Fixture {
    cases: Vec<ReferenceCase>,
}

#[derive(Deserialize)]
struct ReferenceCase {
    q_seed: [f64; 6],
    pose: [f64; 16],
    solutions: Vec<[f64; 6]>,
    coefficients: Option<Vec<String>>,
}

fn fixture() -> &'static Fixture {
    static FIXTURE: OnceLock<Fixture> = OnceLock::new();
    FIXTURE.get_or_init(|| {
        serde_json::from_str(include_str!("data/reference_1000.json"))
            .expect("valid Python reference fixture")
    })
}

// Independent periodic-distance implementation: atan2(sin Δ, cos Δ) gives
// equivalent angles on the two sides of the +/-pi boundary the same distance.
fn joint_distance(a: &[f64; 6], b: &[f64; 6]) -> f64 {
    a.iter()
        .zip(b)
        .map(|(a, b)| {
            let difference = a - b;
            difference.sin().atan2(difference.cos()).powi(2)
        })
        .sum::<f64>()
        .sqrt()
}

#[test]
fn recovers_all_7628_python_branches_and_all_1000_seeds() {
    let reference = fixture();
    assert_eq!(reference.cases.len(), 1000);
    let expected_total: usize = reference
        .cases
        .iter()
        .map(|case| case.solutions.len())
        .sum();
    assert_eq!(expected_total, 7628, "reference branch count changed");

    let options = SolveOptions::default();
    let mut failures = Vec::new();
    let mut actual_total = 0;
    let mut maximum_match_error = 0.0_f64;
    for (index, case) in reference.cases.iter().enumerate() {
        let target = Pose::from_row_slice(&case.pose);
        let report = match solve_matrix(&target, &options) {
            Ok(report) => report,
            Err(error) => {
                failures.push(format!("case {index}: solver error: {error}"));
                continue;
            }
        };
        actual_total += report.solutions.len();
        let reference_distances: Vec<f64> = case
            .solutions
            .iter()
            .map(|expected| {
                report
                    .solutions
                    .iter()
                    .map(|actual| joint_distance(&actual.q, expected))
                    .fold(f64::INFINITY, f64::min)
            })
            .collect();
        let actual_distances: Vec<f64> = report
            .solutions
            .iter()
            .map(|actual| {
                case.solutions
                    .iter()
                    .map(|expected| joint_distance(&actual.q, expected))
                    .fold(f64::INFINITY, f64::min)
            })
            .collect();
        let seed_distance = report
            .solutions
            .iter()
            .map(|actual| joint_distance(&actual.q, &case.q_seed))
            .fold(f64::INFINITY, f64::min);
        let largest_distance = reference_distances
            .iter()
            .chain(&actual_distances)
            .copied()
            .fold(0.0_f64, f64::max);
        maximum_match_error = maximum_match_error.max(largest_distance);
        let missing = reference_distances
            .iter()
            .filter(|&&distance| distance >= 2e-6)
            .count();
        let extra = actual_distances
            .iter()
            .filter(|&&distance| distance >= 2e-6)
            .count();
        if missing != 0
            || extra != 0
            || seed_distance >= 2e-6
            || report.solutions.len() != case.solutions.len()
        {
            failures.push(format!(
                "case {index}: returned {}/{}; missing {missing}, extra {extra}, \
                 worst branch distance {largest_distance:.3e}, seed distance {seed_distance:.3e}; \
                 diagnostics {:?}",
                report.solutions.len(),
                case.solutions.len(),
                report.diagnostics,
            ));
        }
    }
    assert!(
        failures.is_empty(),
        "{} cases failed (first five):\n{}",
        failures.len(),
        failures
            .iter()
            .take(5)
            .cloned()
            .collect::<Vec<_>>()
            .join("\n")
    );
    assert_eq!(actual_total, expected_total);
    eprintln!(
        "Matched {actual_total} branches; maximum wrapped joint error {maximum_match_error:.3e} rad"
    );
}

#[test]
fn rayon_preserves_input_order_and_serial_results() {
    let targets: Vec<Pose> = fixture()
        .cases
        .iter()
        .take(32)
        .map(|case| Pose::from_row_slice(&case.pose))
        .collect();
    let options = SolveOptions::default();
    let serial: Vec<_> = targets
        .iter()
        .map(|target| solve_matrix(target, &options).unwrap())
        .collect();
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(4)
        .build()
        .unwrap();
    let parallel = pool.install(|| solve_batch(&targets, &options));
    assert_eq!(parallel.len(), targets.len());
    for (index, (serial, parallel)) in serial.iter().zip(parallel).enumerate() {
        assert_eq!(
            serde_json::to_value(serial).unwrap(),
            serde_json::to_value(parallel.unwrap()).unwrap(),
            "parallel result differs at input {index}"
        );
    }
}

#[test]
fn pose_coefficients_match_python_and_high_precision_evaluation() {
    let mut checked = 0;
    let mut maximum_python_relative_error = 0.0_f64;
    let mut maximum_precision_relative_error = 0.0_f64;
    for (index, case) in fixture().cases.iter().enumerate() {
        let Some(expected) = &case.coefficients else {
            continue;
        };
        checked += 1;
        let pose = Pose::from_row_slice(&case.pose);
        let prepared = PreparedPose::new(&pose, Frame::Tool0).unwrap();
        let normal = coefficients_from_pose(prepared.dh_position, prepared.dh_quaternion, 128);
        let higher = coefficients_from_pose(prepared.dh_position, prepared.dh_quaternion, 256);
        let expected: Vec<Float> = expected
            .iter()
            .map(|value| Float::with_val(256, Float::parse(value).unwrap()))
            .collect();
        assert_eq!(normal.len(), 17);
        assert_eq!(expected.len(), 17);
        let scale = expected
            .iter()
            .map(|value| value.to_f64().abs())
            .fold(0.0_f64, f64::max);
        assert!(scale > 0.0);
        for (power, ((normal, higher), expected)) in
            normal.iter().zip(&higher).zip(&expected).enumerate()
        {
            let precision_error = Float::with_val(256, normal - higher).abs().to_f64() / scale;
            maximum_precision_relative_error =
                maximum_precision_relative_error.max(precision_error);
            assert!(
                precision_error < 1e-28,
                "case {index}, coefficient {power}: 128/256-bit relative error {precision_error:.3e}"
            );
            // Python and Rust independently extract/normalize a double quaternion
            // from the target matrix. Their final bits may differ, so this check
            // includes that double-precision input discrepancy. Exact invariants
            // have a stricter cross-language coefficient test in coefficients.rs.
            let python_error = Float::with_val(256, normal - expected).abs().to_f64() / scale;
            maximum_python_relative_error = maximum_python_relative_error.max(python_error);
            assert!(
                python_error < 1e-13,
                "case {index}, coefficient {power}: Python relative error {python_error:.3e}"
            );
        }
    }
    assert_eq!(checked, 16);
    eprintln!(
        "Maximum coefficient difference from Python relative to polynomial scale: {maximum_python_relative_error:.3e}"
    );
    eprintln!(
        "Maximum 128/256-bit coefficient difference relative to polynomial scale: {maximum_precision_relative_error:.3e}"
    );
}
