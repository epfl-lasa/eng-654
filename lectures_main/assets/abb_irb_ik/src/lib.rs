//! Analytical IK for the fixed ABB CRB15000-5/0.95 geometry.

pub mod coefficients;
pub mod kinematics;
pub mod roots;

use rayon::prelude::*;
use serde::Serialize;

pub use kinematics::{Frame, IkSolution, JOINT_LIMITS, Pose, fk, matrix_from_pose};
pub use roots::{RootMethod, RootOptions};

#[derive(Clone, Debug)]
pub struct SolveOptions {
    pub frame: Frame,
    pub respect_limits: bool,
    pub coefficient_precision: u32,
    pub root_options: RootOptions,
    pub position_tolerance: f64,
    pub rotation_tolerance: f64,
    pub root_imag_tolerance: f64,
}

impl Default for SolveOptions {
    fn default() -> Self {
        Self {
            frame: Frame::Tool0,
            respect_limits: false,
            coefficient_precision: 128,
            root_options: RootOptions::default(),
            position_tolerance: 2e-7,
            rotation_tolerance: 2e-7,
            root_imag_tolerance: 1e-12,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct SolveDiagnostics {
    pub coefficient_precision_bits: u32,
    pub root_precision_bits: u32,
    pub used_fallback: bool,
    pub root_iterations: usize,
    pub roots_converged: bool,
    pub polynomial_roots: usize,
    pub real_roots: usize,
    pub rejected_real_roots: usize,
    pub max_scaled_residual: f64,
}

#[derive(Clone, Debug, Serialize)]
pub struct SolveReport {
    pub solutions: Vec<IkSolution>,
    pub diagnostics: SolveDiagnostics,
}

/// Solve one target pose. Adaptive mode reports unresolved roots as an error.
pub fn solve_matrix(target: &Pose, options: &SolveOptions) -> Result<SolveReport, String> {
    if options.coefficient_precision < 64 {
        return Err("coefficient precision must be at least 64 bits".into());
    }
    for tolerance in [
        options.position_tolerance,
        options.rotation_tolerance,
        options.root_imag_tolerance,
    ] {
        if !tolerance.is_finite() || tolerance <= 0.0 {
            return Err("verification tolerances must be positive and finite".into());
        }
    }
    let prepared = kinematics::PreparedPose::new(target, options.frame)?;
    let adaptive = matches!(options.root_options.method, RootMethod::Adaptive);
    let reference = matches!(options.root_options.method, RootMethod::Reference);
    let initial_precision = if reference {
        options.coefficient_precision.max(272)
    } else {
        options.coefficient_precision
    };
    let mut precision = initial_precision;
    let mut total_iterations = 0;
    let mut used_fallback = false;
    let (root_result, infinity_candidate) = loop {
        let coeff = coefficients::coefficients_from_pose(
            prepared.dh_position,
            prepared.dh_quaternion,
            precision,
        );
        let scale = coeff
            .iter()
            .map(|value| rug::Float::with_val(precision, value.abs_ref()))
            .fold(rug::Float::new(precision), |a, b| if a > b { a } else { b });
        let threshold = rug::Float::with_val(precision, &scale * 1e-20);
        let infinity_candidate =
            scale > 0 && rug::Float::with_val(precision, coeff[16].abs_ref()) <= threshold;
        match roots::solve_roots(&coeff, &options.root_options) {
            Ok(result) => {
                total_iterations += result.iterations;
                used_fallback |= result.used_fallback;
                if result.converged || !adaptive || precision >= initial_precision.max(320) {
                    if (adaptive || reference) && !result.converged {
                        return Err(format!("polynomial roots unresolved at {precision} bits"));
                    }
                    break (result, infinity_candidate);
                }
            }
            Err(error) => {
                if !adaptive || precision >= initial_precision.max(320) {
                    return Err(error);
                }
            }
        }
        precision = if precision < 256 {
            256
        } else {
            initial_precision.max(320)
        };
        used_fallback = true;
    };

    let mut real_roots: Vec<f64> = root_result
        .roots
        .iter()
        .filter(|z| z.im.abs() <= options.root_imag_tolerance * (1.0 + z.re.abs()))
        .map(|z| z.re)
        .collect();
    real_roots.sort_by(f64::total_cmp);
    let real_count = real_roots.len();
    if infinity_candidate {
        real_roots.push(1e16);
    }
    let mut solutions: Vec<IkSolution> = Vec::with_capacity(16);
    let mut rejected_real_roots = 0;
    for (index, root) in real_roots.into_iter().enumerate() {
        let candidates =
            prepared.back_substitute(root, options.position_tolerance, options.rotation_tolerance);
        if index < real_count && candidates.is_empty() {
            rejected_real_roots += 1;
        }
        for solution in candidates {
            if options.respect_limits && !solution.within_limits {
                continue;
            }
            if !solutions
                .iter()
                .any(|previous| kinematics::wrapped_joint_distance(&solution.q, &previous.q) < 2e-6)
            {
                solutions.push(solution);
            }
        }
    }
    // A converged polynomial root can still fail geometric verification.
    // Retry with freshly evaluated coefficients, with the same bounded limit.
    // This does not manufacture solutions for unsupported singular branches.
    if adaptive && rejected_real_roots > 0 && precision < initial_precision.max(320) {
        let mut retry_options = options.clone();
        retry_options.coefficient_precision = if precision < 256 { 256 } else { 320 };
        let mut report = solve_matrix(target, &retry_options)?;
        report.diagnostics.used_fallback = true;
        report.diagnostics.root_iterations += total_iterations;
        return Ok(report);
    }
    // Stable output order for serial/parallel callers and cross-language tests.
    solutions.sort_by(|a, b| {
        a.q.iter()
            .zip(b.q.iter())
            .map(|(x, y)| x.total_cmp(y))
            .find(|order| !order.is_eq())
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    Ok(SolveReport {
        solutions,
        diagnostics: SolveDiagnostics {
            coefficient_precision_bits: precision,
            root_precision_bits: root_result.precision_bits,
            used_fallback,
            root_iterations: total_iterations,
            roots_converged: root_result.converged,
            polynomial_roots: root_result.roots.len(),
            real_roots: real_count,
            rejected_real_roots,
            max_scaled_residual: root_result.max_scaled_residual,
        },
    })
}

pub fn solve_pose(
    position: [f64; 3],
    quaternion_wxyz: [f64; 4],
    options: &SolveOptions,
) -> Result<SolveReport, String> {
    solve_matrix(&matrix_from_pose(position, quaternion_wxyz)?, options)
}

/// Parallelize independent poses; output order matches the input order.
/// Use a Rayon ThreadPool::install call to select a private worker pool.
pub fn solve_batch(targets: &[Pose], options: &SolveOptions) -> Vec<Result<SolveReport, String>> {
    targets
        .par_iter()
        .map(|target| solve_matrix(target, options))
        .collect()
}
