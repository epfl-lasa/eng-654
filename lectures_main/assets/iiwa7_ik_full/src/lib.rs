pub mod benchmark;
pub mod math;
pub mod subproblems;
use math::*;
use serde::{Deserialize, Serialize};

pub const LIMITS: [f64; 7] = [
    2.9670597283903604,
    2.0943951023931953,
    2.9670597283903604,
    2.0943951023931953,
    2.9670597283903604,
    2.0943951023931953,
    3.0543261909900763,
];
pub const SHOULDER: f64 = 0.34;
pub const ARM: f64 = 0.4;
const VERIFY_TOL: f64 = 2e-8;
const DEDUP_TOL: f64 = 1e-9;

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
pub enum Frame {
    #[default]
    #[serde(rename = "iiwa_link_ee", alias = "tool0")]
    Ee,
    #[serde(rename = "iiwa_link_7", alias = "link7")]
    Link7,
}
impl Frame {
    pub fn offset(self) -> f64 {
        match self {
            Self::Ee => 0.126,
            Self::Link7 => 0.081,
        }
    }
}
#[derive(Clone, Copy, Debug)]
pub struct Pose {
    pub p: Vec3,
    pub r: Mat3,
}
impl Pose {
    /// Input [px, py, pz, qw, qx, qy, qz]. Scale before normalizing to
    /// avoid overflow/underflow even for very large/small finite quaternions.
    pub fn from_array(a: [f64; 7]) -> Result<Self, String> {
        if !a.iter().all(|v| v.is_finite()) {
            return Err("pose must contain seven finite numbers".into());
        }
        let max = a[3..].iter().fold(0.0_f64, |m, v| m.max(v.abs()));
        if max == 0.0 {
            return Err("quaternion must be nonzero".into());
        }
        let mut quat = [a[3] / max, a[4] / max, a[5] / max, a[6] / max];
        let length = quat.iter().map(|v| v * v).sum::<f64>().sqrt();
        for v in &mut quat {
            *v /= length;
        }
        let [w, x, y, z] = quat;
        let r = [
            [
                1.0 - 2.0 * (y * y + z * z),
                2.0 * (x * y - z * w),
                2.0 * (x * z + y * w),
            ],
            [
                2.0 * (x * y + z * w),
                1.0 - 2.0 * (x * x + z * z),
                2.0 * (y * z - x * w),
            ],
            [
                2.0 * (x * z - y * w),
                2.0 * (y * z + x * w),
                1.0 - 2.0 * (x * x + y * y),
            ],
        ];
        Ok(Self {
            p: [a[0], a[1], a[2]],
            r,
        })
    }
    pub fn to_array(self) -> [f64; 7] {
        let r = self.r;
        // Select the largest quaternion component for stability at 180 deg.
        let terms = [
            1.0 + r[0][0] + r[1][1] + r[2][2],
            1.0 + r[0][0] - r[1][1] - r[2][2],
            1.0 - r[0][0] + r[1][1] - r[2][2],
            1.0 - r[0][0] - r[1][1] + r[2][2],
        ];
        let index = (0..4)
            .max_by(|&i, &j| terms[i].total_cmp(&terms[j]))
            .unwrap();
        let t = terms[index].max(0.0).sqrt() * 0.5;
        let d = 4.0 * t;
        let q = match index {
            0 => [
                t,
                (r[2][1] - r[1][2]) / d,
                (r[0][2] - r[2][0]) / d,
                (r[1][0] - r[0][1]) / d,
            ],
            1 => [
                (r[2][1] - r[1][2]) / d,
                t,
                (r[0][1] + r[1][0]) / d,
                (r[0][2] + r[2][0]) / d,
            ],
            2 => [
                (r[0][2] - r[2][0]) / d,
                (r[0][1] + r[1][0]) / d,
                t,
                (r[1][2] + r[2][1]) / d,
            ],
            _ => [
                (r[1][0] - r[0][1]) / d,
                (r[0][2] + r[2][0]) / d,
                (r[1][2] + r[2][1]) / d,
                t,
            ],
        };
        [self.p[0], self.p[1], self.p[2], q[0], q[1], q[2], q[3]]
    }
}

#[derive(Clone, Copy, Debug, Default, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct SingularSamples {
    pub q1: f64,
    pub q2: f64,
    pub q5: f64,
}
#[derive(Clone, Copy, Debug, Default)]
pub struct SolveOptions {
    pub frame: Frame,
    pub respect_limits: bool,
    pub singular_samples: SingularSamples,
}
#[derive(Debug, Serialize)]
pub struct FreeParameter {
    pub joint: &'static str,
    pub recompute_wrist: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub q7_slope: Option<f64>,
}
#[derive(Debug, Serialize)]
pub struct Solution {
    pub q: [f64; 7],
    pub within_limits: bool,
    pub position_error: f64,
    pub rotation_error: f64,
    pub branch: String,
    pub merged_branches: Vec<String>,
    pub free_parameters: Vec<FreeParameter>,
}
#[derive(Debug, Default, Serialize)]
pub struct Diagnostics {
    pub candidates: usize,
    pub rejected_by_fk: usize,
    pub duplicates: usize,
    pub filtered_by_limits: usize,
    pub has_continuous_families: bool,
}
#[derive(Debug, Serialize)]
pub struct SolveReport {
    pub solutions: Vec<Solution>,
    pub diagnostics: Diagnostics,
}

fn arm_rotation(q: &[f64; 7]) -> Mat3 {
    let mut r = I;
    for (i, origin) in [I, C, C, D].iter().enumerate() {
        r = mm(mm(r, *origin), rz(q[i]));
    }
    r
}

/// Direct URDF-origin FK. The two 0.0607 m origin shifts cancel at the
/// common wrist centre; neither is a lateral spherical-wrist offset.
pub fn fk(q: &[f64; 7], frame: Frame) -> Pose {
    let translations = [
        [0.0, 0.0, 0.15],
        [0.0, 0.0, 0.19],
        [0.0, 0.21, 0.0],
        [0.0, 0.0, 0.19],
        [0.0, 0.21, 0.0],
        [0.0, 0.0607, 0.19],
        [0.0, 0.081, 0.0607],
    ];
    let mut p = [0.0; 3];
    let mut r = I;
    for (i, origin) in [I, C, C, D, C, D, C].iter().enumerate() {
        p = add(p, mv(r, translations[i]));
        r = mm(mm(r, *origin), rz(q[i]));
    }
    if matches!(frame, Frame::Ee) {
        p = add(p, mv(r, [0.0, 0.0, 0.045]));
    }
    Pose { p, r }
}

pub fn within_limits(q: &[f64; 7]) -> bool {
    q.iter()
        .zip(LIMITS)
        .all(|(v, limit)| v.abs() <= limit + 1e-12)
}
pub fn joint_distance(a: &[f64; 7], b: &[f64; 7]) -> f64 {
    a.iter()
        .zip(b)
        .map(|(x, y)| wrap(x - y).abs())
        .fold(0.0, f64::max)
}

/// All isolated solutions modulo 2pi, plus representatives and explicit
/// free parameters for singular continuous families. q3 is preserved exactly.
pub fn solve(target: Pose, q3: f64, options: SolveOptions) -> Result<SolveReport, String> {
    if !q3.is_finite() {
        return Err("q3 must be finite and in radians".into());
    }
    if !target
        .p
        .iter()
        .chain(target.r.iter().flatten())
        .all(|v| v.is_finite())
    {
        return Err("target pose must be finite".into());
    }
    let orthogonal = mm(transpose(target.r), target.r);
    if (0..3).any(|i| (0..3).any(|j| (orthogonal[i][j] - I[i][j]).abs() > 1e-10))
        || dot(target.r[0], cross(target.r[1], target.r[2])) < 0.0
    {
        return Err("target orientation must be a proper rotation matrix".into());
    }
    let samples = options.singular_samples;
    if ![samples.q1, samples.q2, samples.q5]
        .iter()
        .all(|v| v.is_finite())
    {
        return Err("singular samples must be finite angles in radians".into());
    }
    let mut report = SolveReport {
        solutions: Vec::with_capacity(8),
        diagnostics: Diagnostics::default(),
    };
    let w = sub(
        sub(target.p, scale(mv(target.r, Z), options.frame.offset())),
        scale(Z, SHOULDER),
    );
    if norm(w) > 2.0 * ARM + 1e-11 {
        return Ok(report);
    }
    let negative_y = scale(Y, -1.0);
    // Position: SP3 fixes elbow q4 from shoulder-to-wrist distance.
    for elbow in subproblems::sp3(negative_y, scale(Z, ARM), scale(Z, -ARM), norm(w)) {
        let q4 = elbow.value;
        let v = add(
            scale(Z, ARM),
            mv(rz(q3), mv(rotation(negative_y, q4), scale(Z, ARM))),
        );
        // SP2 then fixes q1 and q2: Rz(q1) Ry(q2) v = w.
        for (shoulder_index, arm) in subproblems::sp2(Z, Y, v, w, samples.q1, samples.q2)
            .iter()
            .enumerate()
        {
            let mut q = [
                wrap(arm.first.value),
                wrap(arm.second.value),
                q3,
                q4,
                0.0,
                0.0,
                0.0,
            ];
            let w_rotation = mm(transpose(arm_rotation(&q)), target.r);
            let u = mv(transpose(C), mv(w_rotation, Z));
            // Wrist: SP2, Rz(q5) R(-ey,q6) ez = C^T W ez.
            for wrist in subproblems::sp2(Z, negative_y, Z, u, samples.q5, 0.0) {
                q[4] = wrap(wrist.first.value);
                q[5] = wrap(wrist.second.value);
                let before_q7 = mm(mm(mm(mm(C, rz(q[4])), D), rz(q[5])), C);
                let residual = mm(transpose(before_q7), w_rotation);
                // Final SP1 recovers q7 from the residual rotation of ex.
                let Some(last) = subproblems::sp1(Z, X, mv(residual, X), 0.0) else {
                    continue;
                };
                q[6] = wrap(last.value);
                report.diagnostics.candidates += 1;
                let actual = fk(&q, options.frame);
                let position_error = norm(sub(actual.p, target.p));
                let rotation_error = rotation_error(actual.r, target.r);
                if position_error > VERIFY_TOL || rotation_error > VERIFY_TOL {
                    report.diagnostics.rejected_by_fk += 1;
                    continue;
                }
                let branch = format!(
                    "E{}S{}W{}",
                    if q4 >= 0.0 { "+" } else { "-" },
                    if shoulder_index == 0 { "+" } else { "-" },
                    if q[5] >= 0.0 { "+" } else { "-" }
                );
                if let Some(previous) = report
                    .solutions
                    .iter_mut()
                    .find(|s| joint_distance(&s.q, &q) < DEDUP_TOL)
                {
                    previous.merged_branches.push(branch);
                    report.diagnostics.duplicates += 1;
                    continue;
                }
                let mut free_parameters = vec![];
                if arm.first.free {
                    free_parameters.push(FreeParameter {
                        joint: "q1",
                        recompute_wrist: true,
                        q7_slope: None,
                    });
                }
                if arm.second.free {
                    free_parameters.push(FreeParameter {
                        joint: "q2",
                        recompute_wrist: true,
                        q7_slope: None,
                    });
                }
                if wrist.first.free {
                    free_parameters.push(FreeParameter {
                        joint: "q5",
                        recompute_wrist: false,
                        q7_slope: Some(-q[5].cos()),
                    });
                }
                report.diagnostics.has_continuous_families |= !free_parameters.is_empty();
                let within_limits = within_limits(&q);
                if options.respect_limits && !within_limits {
                    report.diagnostics.filtered_by_limits += 1;
                    continue;
                }
                report.solutions.push(Solution {
                    q,
                    within_limits,
                    position_error,
                    rotation_error,
                    merged_branches: vec![branch.clone()],
                    branch,
                    free_parameters,
                });
            }
        }
    }
    Ok(report)
}
