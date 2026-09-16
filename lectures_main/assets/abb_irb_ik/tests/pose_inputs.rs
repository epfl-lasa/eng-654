//! Frame conversion, half-angle chart boundaries, and batch error isolation.
use crb15000_ik::kinematics::wrapped_joint_distance;
use crb15000_ik::{Frame, SolveOptions, SolveReport, fk, solve_batch, solve_matrix};
use std::f64::consts::PI;

fn seed_recovered(report: &SolveReport, seed: &[f64; 6]) -> bool {
    report
        .solutions
        .iter()
        .any(|solution| wrapped_joint_distance(&solution.q, seed) < 2e-6)
}

#[test]
fn complete_solver_recovers_same_seed_in_all_frames() {
    let seed = [0.2, -0.5, 0.7, 1.1, -0.3, 0.9];
    for frame in [Frame::Tool0, Frame::Link6, Frame::Dh6] {
        let options = SolveOptions {
            frame,
            ..SolveOptions::default()
        };
        let target = fk(&seed, frame);
        let report = solve_matrix(&target, &options)
            .unwrap_or_else(|error| panic!("{frame:?} failed: {error}"));
        assert!(report.diagnostics.roots_converged, "{frame:?}");
        assert!(seed_recovered(&report, &seed), "{frame:?}: {report:?}");
        assert!(report.solutions.iter().all(|solution| {
            solution.position_error <= options.position_tolerance
                && solution.rotation_error <= options.rotation_tolerance
        }));
    }
}

#[test]
fn half_angle_infinity_and_nearby_wrist_angles_recover_seed() {
    let options = SolveOptions::default();
    let mut failures = Vec::new();
    for q6 in [
        PI,
        -PI,
        PI - 1e-4,
        -PI + 1e-4,
        PI - 1e-8,
        -PI + 1e-8,
        PI - 1e-12,
        -PI + 1e-12,
    ] {
        let seed = [0.2, -0.5, 0.7, 1.1, -0.3, q6];
        let target = fk(&seed, options.frame);
        match solve_matrix(&target, &options) {
            Ok(report) if seed_recovered(&report, &seed) => {
                assert!(report.diagnostics.roots_converged, "q6={q6:.17}");
            }
            Ok(report) => {
                let nearest = report
                    .solutions
                    .iter()
                    .map(|solution| wrapped_joint_distance(&solution.q, &seed))
                    .fold(f64::INFINITY, f64::min);
                failures.push(format!(
                    "q6={q6:.17}: missing seed, nearest={nearest:e}, diagnostics={:?}",
                    report.diagnostics
                ));
            }
            Err(error) => failures.push(format!("q6={q6:.17}: {error}")),
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[test]
fn mixed_batch_preserves_order_and_isolates_invalid_poses() {
    let options = SolveOptions::default();
    let first_seed = [0.2, -0.5, 0.7, 1.1, -0.3, 0.9];
    let second_seed = [-0.8, 0.3, -1.2, -0.6, 0.7, -0.4];
    let first = fk(&first_seed, options.frame);
    let second = fk(&second_seed, options.frame);
    let mut invalid_row = first;
    invalid_row[(3, 1)] = 0.5;
    let mut invalid_position = second;
    invalid_position[(1, 3)] = f64::NAN;
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(2)
        .build()
        .unwrap();
    let reports =
        pool.install(|| solve_batch(&[first, invalid_row, second, invalid_position], &options));
    assert_eq!(reports.len(), 4);
    assert!(seed_recovered(reports[0].as_ref().unwrap(), &first_seed));
    assert!(reports[1].is_err());
    assert!(seed_recovered(reports[2].as_ref().unwrap(), &second_seed));
    assert!(reports[3].is_err());
}
