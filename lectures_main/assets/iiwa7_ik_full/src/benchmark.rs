//! Deterministic FK->IK benchmark; reference FK uses literal URDF RPY
//! transforms evaluated trigonometrically, independently of solver constants.
use crate::{math::*, *};
use serde::Serialize;
use std::sync::OnceLock;
use std::time::Instant;

// Preserve literal XML values for the independent geometry comparison.
#[allow(clippy::approx_constant)]
pub const URDF_RPY: [[f64; 3]; 7] = [
    [0.0, 0.0, 0.0],
    [1.5707963267948966, 0.0, 3.141592653589793],
    [1.5707963267948966, 0.0, 3.141592653589793],
    [1.5707963267948966, 0.0, 0.0],
    [-1.5707963267948966, 3.141592653589793, 0.0],
    [1.5707963267948966, 0.0, 0.0],
    [-1.5707963267948966, 3.141592653589793, 0.0],
];
pub const URDF_XYZ: [[f64; 3]; 7] = [
    [0.0, 0.0, 0.15],
    [0.0, 0.0, 0.19],
    [0.0, 0.21, 0.0],
    [0.0, 0.0, 0.19],
    [0.0, 0.21, 0.0],
    [0.0, 0.06070, 0.19],
    [0.0, 0.081, 0.06070],
];

pub fn reference_fk(q: &[f64; 7], frame: Frame) -> Pose {
    static ROTATIONS: OnceLock<[Mat3; 7]> = OnceLock::new();
    let origins = ROTATIONS.get_or_init(|| {
        URDF_RPY.map(|[r, p, y]| mm(mm(rotation(Z, y), rotation(Y, p)), rotation(X, r)))
    });
    let mut r = I;
    let mut p = [0.0; 3];
    for i in 0..7 {
        p = add(p, mv(r, URDF_XYZ[i]));
        r = mm(r, mm(origins[i], rz(q[i])));
    }
    if matches!(frame, Frame::Ee) {
        p = add(p, mv(r, [0.0, 0.0, 0.045]));
    }
    Pose { p, r }
}

pub struct SplitMix64(pub u64);
impl SplitMix64 {
    pub fn uniform(&mut self) -> f64 {
        self.0 = self.0.wrapping_add(0x9e3779b97f4a7c15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58476d1ce4e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d049bb133111eb);
        z ^= z >> 31;
        ((z >> 11) as f64) * (1.0 / 9007199254740992.0)
    }
    pub fn configuration(&mut self, limited: bool) -> [f64; 7] {
        std::array::from_fn(|i| {
            (2.0 * self.uniform() - 1.0)
                * if limited {
                    LIMITS[i]
                } else {
                    std::f64::consts::PI
                }
        })
    }
}

#[derive(Serialize)]
pub struct Failure {
    pub sample: usize,
    pub q: [f64; 7],
    pub returned_solutions: usize,
    pub nearest_joint_error_rad: Option<f64>,
}

#[derive(Serialize)]
pub struct BenchmarkReport {
    pub samples: usize,
    pub seed: u64,
    pub distribution: &'static str,
    pub frame: Frame,
    pub workers: usize,
    pub input_fk: &'static str,
    pub timing_scope: &'static str,
    pub solver_seconds: f64,
    pub microseconds_per_pose: f64,
    pub poses_per_second: f64,
    pub total_seconds: f64,
    pub solved_poses: usize,
    pub missed_poses: usize,
    pub recovered_seed_configurations: usize,
    pub missed_seed_configurations: usize,
    pub seed_joint_tolerance_rad: f64,
    pub maximum_seed_joint_error_rad: f64,
    pub returned_solutions: usize,
    pub solution_count_histogram: [usize; 9],
    pub poses_with_eight_solutions: usize,
    pub within_limits_solutions: usize,
    pub rejected_by_fk: usize,
    pub invalid_returned_solutions: usize,
    pub maximum_position_error_m: f64,
    pub rms_position_error_m: f64,
    pub maximum_rotation_error_rad: f64,
    pub rms_rotation_error_rad: f64,
    pub maximum_q3_error_rad: f64,
    pub first_failures: Vec<Failure>,
    pub passed: bool,
}

pub fn run(
    samples: usize,
    seed: u64,
    limited: bool,
    frame: Frame,
) -> Result<BenchmarkReport, String> {
    if samples == 0 {
        return Err("samples must be positive".into());
    }
    let options = SolveOptions {
        frame,
        ..Default::default()
    };
    let mut warmup = SplitMix64(seed);
    for _ in 0..256 {
        let q = warmup.configuration(limited);
        std::hint::black_box(solve(reference_fk(&q, frame), q[2], options)?);
    }
    let start = Instant::now();
    let mut report = BenchmarkReport {
        samples,
        seed,
        distribution: if limited {
            "uniform within iiwa7.urdf hard limits"
        } else {
            "uniform [-pi, pi) for all seven joints"
        },
        frame,
        workers: 1,
        input_fk: "literal iiwa7.urdf RPY/XYZ origin chain; quaternion round trip",
        timing_scope: "serial solve() calls including candidate FK verification; excludes input FK, RNG, JSON and independent output validation",
        solver_seconds: 0.0,
        microseconds_per_pose: 0.0,
        poses_per_second: 0.0,
        total_seconds: 0.0,
        solved_poses: 0,
        missed_poses: 0,
        recovered_seed_configurations: 0,
        missed_seed_configurations: 0,
        seed_joint_tolerance_rad: 2e-6,
        maximum_seed_joint_error_rad: 0.0,
        returned_solutions: 0,
        solution_count_histogram: [0; 9],
        poses_with_eight_solutions: 0,
        within_limits_solutions: 0,
        rejected_by_fk: 0,
        invalid_returned_solutions: 0,
        maximum_position_error_m: 0.0,
        rms_position_error_m: 0.0,
        maximum_rotation_error_rad: 0.0,
        rms_rotation_error_rad: 0.0,
        maximum_q3_error_rad: 0.0,
        first_failures: vec![],
        passed: false,
    };
    let mut rng = SplitMix64(seed);
    let mut pos_squared = 0.0;
    let mut rot_squared = 0.0;
    // Bounded memory; only solve calls in each batch are timed.
    for offset in (0..samples).step_by(4096) {
        let inputs: Vec<_> = (0..4096.min(samples - offset))
            .map(|_| {
                let q = rng.configuration(limited);
                let target = Pose::from_array(reference_fk(&q, frame).to_array()).unwrap();
                (q, target)
            })
            .collect();
        let timer = Instant::now();
        let results: Vec<_> = inputs
            .iter()
            .map(|(q, p)| solve(*p, q[2], options))
            .collect();
        report.solver_seconds += timer.elapsed().as_secs_f64();
        for (index, ((original, target), result)) in inputs.iter().zip(results).enumerate() {
            let result = result?;
            let count = result.solutions.len();
            report.solution_count_histogram[count] += 1;
            report.poses_with_eight_solutions += usize::from(count == 8);
            report.returned_solutions += count;
            report.rejected_by_fk += result.diagnostics.rejected_by_fk;
            if count == 0 {
                if report.first_failures.len() < 16 {
                    report.first_failures.push(Failure {
                        sample: offset + index,
                        q: *original,
                        returned_solutions: 0,
                        nearest_joint_error_rad: None,
                    });
                }
                report.missed_poses += 1;
                report.missed_seed_configurations += 1;
                continue;
            }
            report.solved_poses += 1;
            let nearest = result
                .solutions
                .iter()
                .map(|s| joint_distance(&s.q, original))
                .fold(f64::INFINITY, f64::min);
            report.maximum_seed_joint_error_rad = report.maximum_seed_joint_error_rad.max(nearest);
            if nearest <= report.seed_joint_tolerance_rad {
                report.recovered_seed_configurations += 1;
            } else {
                report.missed_seed_configurations += 1;
                if report.first_failures.len() < 16 {
                    report.first_failures.push(Failure {
                        sample: offset + index,
                        q: *original,
                        returned_solutions: count,
                        nearest_joint_error_rad: Some(nearest),
                    });
                }
            }
            for solution in result.solutions {
                let actual = reference_fk(&solution.q, frame);
                let pe = norm(sub(actual.p, target.p));
                let re = rotation_error(actual.r, target.r);
                let q3e = (solution.q[2] - original[2]).abs();
                report.maximum_position_error_m = report.maximum_position_error_m.max(pe);
                report.maximum_rotation_error_rad = report.maximum_rotation_error_rad.max(re);
                report.maximum_q3_error_rad = report.maximum_q3_error_rad.max(q3e);
                report.within_limits_solutions += usize::from(solution.within_limits);
                if pe > VERIFY_TOL || re > VERIFY_TOL || q3e != 0.0 {
                    report.invalid_returned_solutions += 1;
                }
                pos_squared += pe * pe;
                rot_squared += re * re;
            }
        }
    }
    if report.returned_solutions > 0 {
        report.rms_position_error_m = (pos_squared / report.returned_solutions as f64).sqrt();
        report.rms_rotation_error_rad = (rot_squared / report.returned_solutions as f64).sqrt();
    }
    report.total_seconds = start.elapsed().as_secs_f64();
    report.microseconds_per_pose = report.solver_seconds * 1e6 / samples as f64;
    report.poses_per_second = samples as f64 / report.solver_seconds;
    report.passed = report.missed_poses == 0
        && report.missed_seed_configurations == 0
        && report.invalid_returned_solutions == 0
        && report.poses_with_eight_solutions == samples;
    Ok(report)
}
