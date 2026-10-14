use iiwa7_ik::{
    benchmark::{SplitMix64, reference_fk},
    math::*,
    subproblems::*,
    *,
};

fn assert_pose(a: Pose, b: Pose, tolerance: f64) {
    assert!(
        norm(sub(a.p, b.p)) < tolerance,
        "position: {:?} vs {:?}",
        a.p,
        b.p
    );
    assert!(rotation_error(a.r, b.r) < tolerance, "rotation mismatch");
}

#[test]
fn paden_kahan_subproblems_and_degenerate_cases() {
    assert!((sp1(Z, X, Y, 0.0).unwrap().value - std::f64::consts::FRAC_PI_2).abs() < 1e-14);
    assert!(sp1(Z, Z, Z, 0.7).unwrap().free);
    assert!(sp1(Z, X, Z, 0.0).is_none());
    let target = mv(rotation(Z, 0.8), mv(rotation(Y, -0.6), [0.3, 0.1, 0.5]));
    let pairs = sp2(Z, Y, [0.3, 0.1, 0.5], target, 0.0, 0.0);
    assert_eq!(pairs.len(), 2);
    for pair in pairs {
        let actual = mv(
            rotation(Z, pair.first.value),
            mv(rotation(Y, pair.second.value), [0.3, 0.1, 0.5]),
        );
        assert!(norm(sub(actual, target)) < 1e-14);
    }
    let angles = sp3(Y, scale(Z, 0.4), scale(Z, -0.4), 0.6);
    assert_eq!(angles.len(), 2);
    for angle in angles {
        assert!(
            (norm(sub(
                mv(rotation(Y, angle.value), scale(Z, 0.4)),
                scale(Z, -0.4)
            )) - 0.6)
                .abs()
                < 1e-14
        );
    }
    assert!(sp3(Y, scale(Z, 0.4), scale(Z, -0.4), 0.9).is_empty());
}

#[test]
fn generic_pose_has_all_eight_distinct_verified_branches() {
    let q = [0.4, -0.7, 0.5, 1.2, -0.9, 0.8, 0.3];
    let target = reference_fk(&q, Frame::Ee);
    let result = solve(target, q[2], Default::default()).unwrap();
    assert_eq!(result.solutions.len(), 8);
    assert!(
        result
            .solutions
            .iter()
            .any(|s| joint_distance(&s.q, &q) < 1e-12)
    );
    for (i, s) in result.solutions.iter().enumerate() {
        assert_eq!(s.q[2], q[2]);
        assert_pose(reference_fk(&s.q, Frame::Ee), target, 1e-12);
        assert!(s.free_parameters.is_empty());
        assert!(
            result.solutions[..i]
                .iter()
                .all(|other| joint_distance(&s.q, &other.q) > 1e-9)
        );
    }
}

#[test]
fn random_round_trips_cover_both_frames_and_unrestricted_angles() {
    let mut rng = SplitMix64(42);
    for frame in [Frame::Ee, Frame::Link7] {
        for _ in 0..2000 {
            let q = rng.configuration(false);
            let target = reference_fk(&q, frame);
            assert_pose(fk(&q, frame), target, 1e-14);
            let parsed = Pose::from_array(target.to_array()).unwrap();
            assert_pose(parsed, target, 1e-14);
            let result = solve(
                parsed,
                q[2],
                SolveOptions {
                    frame,
                    ..Default::default()
                },
            )
            .unwrap();
            assert_eq!(
                result.solutions.len(),
                8,
                "seed {q:?}; diagnostics {:?}",
                result.diagnostics
            );
            assert!(
                result
                    .solutions
                    .iter()
                    .any(|s| joint_distance(&s.q, &q) < 2e-6),
                "seed {q:?}"
            );
            for s in result.solutions {
                assert_pose(reference_fk(&s.q, frame), target, 2e-8);
            }
        }
    }
}

#[test]
fn limit_filter_preserves_seed_and_fixed_q3_turns() {
    let q = [0.4, -0.7, 0.5, 1.8, -0.9, 0.8, 0.3];
    let target = fk(&q, Frame::Ee);
    let all = solve(target, q[2], Default::default()).unwrap();
    let filtered = solve(
        target,
        q[2],
        SolveOptions {
            respect_limits: true,
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(filtered.solutions.len(), 4);
    assert_eq!(
        filtered.solutions.len(),
        all.solutions.iter().filter(|s| s.within_limits).count()
    );
    assert!(filtered.solutions.iter().all(|s| within_limits(&s.q)));
    let supplied_q3 = q[2] + std::f64::consts::TAU;
    let turned = solve(target, supplied_q3, Default::default()).unwrap();
    assert_eq!(turned.solutions.len(), 8);
    assert!(
        turned
            .solutions
            .iter()
            .all(|s| s.q[2] == supplied_q3 && !s.within_limits)
    );
    assert!(
        solve(
            target,
            supplied_q3,
            SolveOptions {
                respect_limits: true,
                ..Default::default()
            }
        )
        .unwrap()
        .solutions
        .is_empty()
    );
    for i in 0..7 {
        let mut boundary = [0.0; 7];
        boundary[i] = LIMITS[i];
        assert!(within_limits(&boundary));
        boundary[i] += 1e-8;
        assert!(!within_limits(&boundary));
    }
}

#[test]
fn singular_families_and_near_singular_poses() {
    use std::f64::consts::{PI, TAU};
    for q in [
        [0.0; 7],
        [0.0, 0.0, 0.5, 0.0, 0.4, 0.0, -0.9],
        [0.2, -0.4, 0.3, PI, 0.5, 0.6, -0.8],
        [0.4, -0.7, 0.5, 1.2, -0.9, 0.0, 0.3],
        [0.4, -0.7, 0.5, 1.2, -0.9, PI, 0.3],
        [0.4, -0.7, 0.5, 1e-9, -0.9, 0.8, 0.3],
        [0.4, -0.7, 0.5, 1.2, -0.9, 1e-10, 0.3],
        [0.4, -0.7, 0.5, 1.2, -0.9, PI - 1e-10, 0.3],
        [0.8, -0.6, 0.0, 1.2, 0.9, 0.4, -0.8], // wrist centre on base axis
        [0.4, -0.7, PI / 2.0, 1.2, -0.9, 0.8, 0.3],
        [0.4, -0.7, 0.5 + TAU, 1.2, -0.9, 0.8, 0.3],
    ] {
        let target = reference_fk(&q, Frame::Ee);
        let result = solve(target, q[2], Default::default()).unwrap();
        assert!(!result.solutions.is_empty(), "seed {q:?}");
        for s in &result.solutions {
            assert_pose(reference_fk(&s.q, Frame::Ee), target, 2e-8);
            for parameter in &s.free_parameters {
                if let Some(slope) = parameter.q7_slope {
                    let mut changed = s.q;
                    changed[4] += 0.73;
                    changed[6] += slope * 0.73;
                    assert_pose(reference_fk(&changed, Frame::Ee), target, 2e-8);
                }
            }
        }
    }
    let zero = solve(fk(&[0.0; 7], Frame::Ee), 0.0, Default::default()).unwrap();
    assert!(zero.diagnostics.has_continuous_families);
    assert!(
        zero.solutions
            .iter()
            .any(|s| s.free_parameters.iter().any(|p| p.joint == "q1"))
    );
    let folded = [0.0, 0.0, 0.5, PI, 0.0, 0.0, 0.0];
    let target = reference_fk(&folded, Frame::Ee);
    let sampled = solve(
        target,
        folded[2],
        SolveOptions {
            singular_samples: SingularSamples {
                q1: 0.7,
                q2: -0.4,
                q5: 0.8,
            },
            ..Default::default()
        },
    )
    .unwrap();
    assert!(
        sampled
            .solutions
            .iter()
            .any(|s| (s.q[0] - 0.7).abs() < 1e-12 && (s.q[1] + 0.4).abs() < 1e-12)
    );
    for s in sampled.solutions {
        assert_pose(reference_fk(&s.q, Frame::Ee), target, 2e-8);
    }
}

#[test]
fn unreachable_targets_and_invalid_inputs() {
    let mut far = fk(&[0.0; 7], Frame::Ee);
    far.p[0] = 3.0;
    assert!(
        solve(far, 0.0, Default::default())
            .unwrap()
            .solutions
            .is_empty()
    );
    let mut center = fk(&[0.0; 7], Frame::Ee);
    center.p = [0.0, 0.0, 0.34 + 0.126 + 0.2];
    assert!(
        solve(center, std::f64::consts::FRAC_PI_2, Default::default())
            .unwrap()
            .solutions
            .is_empty()
    );
    assert!(Pose::from_array([0.0; 7]).is_err());
    assert!(Pose::from_array([f64::NAN, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0]).is_err());
    assert!(solve(far, f64::NAN, Default::default()).is_err());
    let mut bad = fk(&[0.0; 7], Frame::Ee);
    bad.r[0][0] = 2.0;
    assert!(solve(bad, 0.0, Default::default()).is_err());
    for s in [1e-300, 1e300, -2.0] {
        assert_pose(
            Pose::from_array([0.0, 0.0, 0.0, s, 0.0, s, 0.0]).unwrap(),
            Pose::from_array([0.0, 0.0, 0.0, 1.0, 0.0, 1.0, 0.0]).unwrap(),
            1e-14,
        );
    }
}

#[test]
fn benchmark_checks_original_configuration_and_all_returned_solutions() {
    let result = benchmark::run(1000, 654, false, Frame::Ee).unwrap();
    assert!(result.passed);
    assert_eq!(result.recovered_seed_configurations, 1000);
    assert_eq!(result.returned_solutions, 8000);
    assert_eq!(result.maximum_q3_error_rad, 0.0);
}
