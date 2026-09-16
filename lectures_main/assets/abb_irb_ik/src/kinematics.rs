//! Fixed-geometry ABB CRB 15000-5/0.95 forward kinematics and IK back substitution.
//!
//! Joint angles use the native URDF coordinates. All matrices and vectors in the
//! geometric path have fixed size; the only allocations hold returned branches.

use nalgebra::{Matrix3, Matrix4, Vector3};
use serde::Serialize;
use std::f64::consts::{FRAC_PI_2, PI, TAU};

pub type Pose = Matrix4<f64>;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Frame {
    #[default]
    Tool0,
    Link6,
    Dh6,
}

#[derive(Clone, Debug, Serialize)]
pub struct IkSolution {
    pub q: [f64; 6],
    pub position_error: f64,
    pub rotation_error: f64,
    pub within_limits: bool,
    pub t6: f64,
    pub radial_branch: i32,
    pub j4_branch: i32,
}

pub const JOINT_LIMITS: [[f64; 2]; 6] = [
    [-PI, PI],
    [-PI, PI],
    [-3.9269908169872414, 1.4835298641951802],
    [-PI, PI],
    [-PI, PI],
    // ABB GoFa datasheet 9AKK107991A8564: GoFa 5 axis 6 movement is ±270°.
    [-1.5 * PI, 1.5 * PI],
];

const D1: f64 = 0.265;
const A2: f64 = 0.444;
const A3: f64 = 0.110;
const D4: f64 = 0.470;
const A5: f64 = 0.080;
const D6: f64 = 0.101;
const L2: f64 = A3 * A3 + D4 * D4;

#[inline]
fn wrap(a: f64) -> f64 {
    (a + PI).rem_euclid(TAU) - PI
}

/// Euclidean distance of joint angles after independently wrapping differences.
pub fn wrapped_joint_distance(a: &[f64; 6], b: &[f64; 6]) -> f64 {
    a.iter()
        .zip(b.iter())
        .map(|(&x, &y)| wrap(x - y).powi(2))
        .sum::<f64>()
        .sqrt()
}

#[inline]
fn rx(s: f64, c: f64) -> Matrix3<f64> {
    Matrix3::new(1.0, 0.0, 0.0, 0.0, c, -s, 0.0, s, c)
}

#[inline]
fn ry(s: f64, c: f64) -> Matrix3<f64> {
    Matrix3::new(c, 0.0, s, 0.0, 1.0, 0.0, -s, 0.0, c)
}

#[inline]
fn rz(s: f64, c: f64) -> Matrix3<f64> {
    Matrix3::new(c, -s, 0.0, s, c, 0.0, 0.0, 0.0, 1.0)
}

#[inline]
fn x_link6() -> Matrix3<f64> {
    Matrix3::new(0.0, 0.0, 1.0, 0.0, -1.0, 0.0, 1.0, 0.0, 0.0)
}

#[inline]
fn ry90() -> Matrix3<f64> {
    Matrix3::new(0.0, 0.0, 1.0, 0.0, 1.0, 0.0, -1.0, 0.0, 0.0)
}

#[inline]
fn make_pose(r: &Matrix3<f64>, p: &Vector3<f64>) -> Pose {
    Matrix4::new(
        r[(0, 0)],
        r[(0, 1)],
        r[(0, 2)],
        p[0],
        r[(1, 0)],
        r[(1, 1)],
        r[(1, 2)],
        p[1],
        r[(2, 0)],
        r[(2, 1)],
        r[(2, 2)],
        p[2],
        0.0,
        0.0,
        0.0,
        1.0,
    )
}

/// Forward kinematics from the original URDF joint origins and axes.
pub fn fk(q: &[f64; 6], frame: Frame) -> Pose {
    let [(s1, c1), (s2, c2), (s3, c3), (s4, c4), (s5, c5), (s6, c6)] = q.map(f64::sin_cos);
    let mut p = Vector3::new(0.0, 0.0, D1);
    let mut r = rz(s1, c1) * ry(s2, c2);
    p += r.column(2) * A2;
    r *= ry(s3, c3);
    p += r.column(2) * A3;
    r *= rx(s4, c4);
    p += r.column(0) * D4;
    r *= ry(s5, c5);
    p += r.column(0) * D6 + r.column(2) * A5;
    r *= rx(s6, c6);
    r = match frame {
        Frame::Tool0 => r * ry90(),
        Frame::Link6 => r,
        Frame::Dh6 => r * x_link6().transpose(),
    };
    make_pose(&r, &p)
}

fn normalized_quaternion(q: [f64; 4]) -> Result<[f64; 4], String> {
    if !q.iter().all(|x| x.is_finite()) {
        return Err("quaternion must contain only finite numbers".into());
    }
    // Scaling also accepts extremely large/small finite, nonzero quaternions.
    let scale = q.iter().fold(0.0_f64, |s, x| s.max(x.abs()));
    if scale == 0.0 {
        return Err("zero quaternion".into());
    }
    let scaled = q.map(|x| x / scale);
    let n = scaled.iter().map(|x| x * x).sum::<f64>().sqrt();
    Ok(scaled.map(|x| x / n))
}

fn rotation_from_quaternion([w, x, y, z]: [f64; 4]) -> Matrix3<f64> {
    Matrix3::new(
        1.0 - 2.0 * (y * y + z * z),
        2.0 * (x * y - w * z),
        2.0 * (x * z + w * y),
        2.0 * (x * y + w * z),
        1.0 - 2.0 * (x * x + z * z),
        2.0 * (y * z - w * x),
        2.0 * (x * z - w * y),
        2.0 * (y * z + w * x),
        1.0 - 2.0 * (x * x + y * y),
    )
}

fn quaternion_from_rotation(r: &Matrix3<f64>) -> Result<[f64; 4], String> {
    let trace = r.trace();
    let q = if trace > 0.0 {
        let s = (trace + 1.0).sqrt() * 2.0;
        [
            0.25 * s,
            (r[(2, 1)] - r[(1, 2)]) / s,
            (r[(0, 2)] - r[(2, 0)]) / s,
            (r[(1, 0)] - r[(0, 1)]) / s,
        ]
    } else if r[(0, 0)] > r[(1, 1)] && r[(0, 0)] > r[(2, 2)] {
        let s = (1.0 + r[(0, 0)] - r[(1, 1)] - r[(2, 2)]).max(0.0).sqrt() * 2.0;
        [
            (r[(2, 1)] - r[(1, 2)]) / s,
            0.25 * s,
            (r[(0, 1)] + r[(1, 0)]) / s,
            (r[(0, 2)] + r[(2, 0)]) / s,
        ]
    } else if r[(1, 1)] > r[(2, 2)] {
        let s = (1.0 + r[(1, 1)] - r[(0, 0)] - r[(2, 2)]).max(0.0).sqrt() * 2.0;
        [
            (r[(0, 2)] - r[(2, 0)]) / s,
            (r[(0, 1)] + r[(1, 0)]) / s,
            0.25 * s,
            (r[(1, 2)] + r[(2, 1)]) / s,
        ]
    } else {
        let s = (1.0 + r[(2, 2)] - r[(0, 0)] - r[(1, 1)]).max(0.0).sqrt() * 2.0;
        [
            (r[(1, 0)] - r[(0, 1)]) / s,
            (r[(0, 2)] + r[(2, 0)]) / s,
            (r[(1, 2)] + r[(2, 1)]) / s,
            0.25 * s,
        ]
    };
    normalized_quaternion(q)
}

pub fn matrix_from_pose(position: [f64; 3], quat_wxyz: [f64; 4]) -> Result<Pose, String> {
    if !position.iter().all(|x| x.is_finite()) {
        return Err("position must contain only finite numbers".into());
    }
    let q = normalized_quaternion(quat_wxyz)?;
    Ok(make_pose(
        &rotation_from_quaternion(q),
        &Vector3::from(position),
    ))
}

/// Angle between rotations, stable both at zero and pi.
fn rotation_error(a: &Matrix3<f64>, b: &Matrix3<f64>) -> f64 {
    let relative = a.transpose() * b;
    let sin = Vector3::new(
        relative[(2, 1)] - relative[(1, 2)],
        relative[(0, 2)] - relative[(2, 0)],
        relative[(1, 0)] - relative[(0, 1)],
    )
    .norm()
        * 0.5;
    let cos = ((relative.trace() - 1.0) * 0.5).clamp(-1.0, 1.0);
    sin.atan2(cos)
}

/// Geometry shared by coefficient evaluation and every root's back substitution.
#[derive(Clone, Debug)]
pub struct PreparedPose {
    pub dh_position: [f64; 3],
    pub dh_quaternion: [f64; 4],
    c: Vector3<f64>,
    xd: Vector3<f64>,
    yd: Vector3<f64>,
    zd: Vector3<f64>,
    target_position: Vector3<f64>,
    target_rotation: Matrix3<f64>,
    frame: Frame,
}

impl PreparedPose {
    pub fn new(target: &Pose, frame: Frame) -> Result<Self, String> {
        if !target.iter().all(|x| x.is_finite()) {
            return Err("pose must contain only finite numbers".into());
        }
        if target[(3, 0)].abs() > 1e-12
            || target[(3, 1)].abs() > 1e-12
            || target[(3, 2)].abs() > 1e-12
            || (target[(3, 3)] - 1.0).abs() > 1e-12
        {
            return Err("pose must have homogeneous final row [0, 0, 0, 1]".into());
        }
        let target_rotation = target.fixed_view::<3, 3>(0, 0).into_owned();
        if (target_rotation.transpose() * target_rotation - Matrix3::identity()).norm() > 1e-6
            || (target_rotation.determinant() - 1.0).abs() > 1e-6
        {
            return Err("pose rotation must be orthonormal with determinant +1".into());
        }
        let target_position = target.fixed_view::<3, 1>(0, 3).into_owned();
        let dh_rotation = match frame {
            Frame::Tool0 => target_rotation * ry90().transpose() * x_link6().transpose(),
            Frame::Link6 => target_rotation * x_link6().transpose(),
            Frame::Dh6 => target_rotation,
        };
        let dh_quaternion = quaternion_from_rotation(&dh_rotation)?;
        let normalized = rotation_from_quaternion(dh_quaternion);
        let xd = normalized.column(0).into_owned();
        let yd = normalized.column(1).into_owned();
        let zd = normalized.column(2).into_owned();
        Ok(Self {
            dh_position: target_position.into(),
            dh_quaternion,
            c: target_position - D6 * zd,
            xd,
            yd,
            zd,
            target_position,
            target_rotation,
            frame,
        })
    }

    /// Recover every geometrically valid branch for one real half-angle root.
    /// Base-axis singularities retain the Python solver's unsupported behavior.
    pub fn back_substitute(&self, t6: f64, pos_tol: f64, rot_tol: f64) -> Vec<IkSolution> {
        if !(t6.is_finite() && pos_tol >= 0.0 && rot_tol >= 0.0) {
            return Vec::new();
        }
        let th6 = 2.0 * t6.atan();
        let (s6, c6) = th6.sin_cos();
        let x5 = c6 * self.xd - s6 * self.yd;
        let l5 = s6 * self.xd + c6 * self.yd;
        let p2 = self.c - A5 * x5;
        let rho = p2[0].hypot(p2[1]);
        if rho < 1e-10 {
            return Vec::new();
        }
        let z = p2[2] - D1;
        let k = (rho * rho + z * z + A2 * A2 - L2) / (2.0 * A2);
        let m = rho.hypot(z);
        if m < 1e-12 || k.abs() > m + 1e-9 {
            return Vec::new();
        }
        let delta = (k / m).clamp(-1.0, 1.0).acos();
        let mut out = Vec::new();
        for radial_branch in [1, -1] {
            let qrad = f64::from(radial_branch) * rho;
            let th1 = (p2[1] / qrad).atan2(p2[0] / qrad);
            let (s1, c1) = th1.sin_cos();
            let l3 = Vector3::new(s1, -c1, 0.0);
            let phi = z.atan2(qrad);
            for th2 in [wrap(phi + delta), wrap(phi - delta)] {
                let (s2, c2) = th2.sin_cos();
                let p1 = Vector3::new(A2 * c1 * c2, A2 * s1 * c2, D1 + A2 * s2);
                let r = p2 - p1;
                let f1 = r.norm_squared() - L2;
                let f2 = r.dot(&l3);
                let f3 = r.dot(&l5).powi(2) + A3 * A3 * l3.dot(&l5).powi(2) - A3 * A3;
                if f1.abs().max(f2.abs()).max(f3.abs()) > 2e-6 {
                    continue;
                }
                let cross = l3.cross(&r);
                // Rz(theta1) Rx(pi/2) Rz(theta2), with the fixed twist exact.
                let r02 = Matrix3::new(c1 * c2, -c1 * s2, s1, s1 * c2, -s1 * s2, -c1, s2, c2, 0.0);
                for j4_branch in [1, -1] {
                    let l4 = (D4 * r + f64::from(j4_branch) * A3 * cross) / L2;
                    if l4.dot(&l5).abs() > 2e-6 {
                        continue;
                    }
                    let v3 = r02.transpose() * l4;
                    let th3 = v3[0].atan2(-v3[1]);
                    let (s3, c3) = th3.sin_cos();
                    let r03 = r02 * rz(s3, c3) * rx(1.0, 0.0);
                    let v4 = r03.transpose() * l5;
                    let th4 = v4[0].atan2(-v4[1]);
                    let (s4, c4) = th4.sin_cos();
                    let r04 = r03 * rz(s4, c4) * rx(1.0, 0.0);
                    let v5 = r04.transpose() * self.zd;
                    let th5 = v5[0].atan2(-v5[1]);
                    let q = [th1, FRAC_PI_2 - th2, -th3, th4 - PI, PI - th5, th6].map(wrap);
                    let actual = fk(&q, self.frame);
                    let pe = (actual.fixed_view::<3, 1>(0, 3) - self.target_position).norm();
                    let re = rotation_error(
                        &actual.fixed_view::<3, 3>(0, 0).into_owned(),
                        &self.target_rotation,
                    );
                    if pe <= pos_tol && re <= rot_tol {
                        let within_limits = q
                            .iter()
                            .zip(JOINT_LIMITS)
                            .all(|(&qi, [lo, hi])| qi >= lo - 1e-12 && qi <= hi + 1e-12);
                        out.push(IkSolution {
                            q,
                            position_error: pe,
                            rotation_error: re,
                            within_limits,
                            t6,
                            radial_branch,
                            j4_branch,
                        });
                    }
                }
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fk_matches_python_urdf_reference() {
        let q = [0.2, -0.5, 0.7, 1.1, -0.3, 0.9];
        let expected = Pose::new(
            0.08419359823168605,
            0.02808754409886614,
            0.996053476417454,
            0.36242022302563975,
            0.9196122899783901,
            -0.3871030958781912,
            -0.066816384833521,
            -0.02317270916024155,
            0.38369867622589304,
            0.9216085302491586,
            -0.05842125327723751,
            0.7018516361817526,
            0.0,
            0.0,
            0.0,
            1.0,
        );
        assert!((fk(&q, Frame::Tool0) - expected).norm() < 1e-14);
    }

    #[test]
    fn known_root_recovers_seed_in_every_frame() {
        let q = [0.2, -0.5, 0.7, 1.1, -0.3, 0.9];
        let t6 = (q[5] * 0.5_f64).tan();
        for frame in [Frame::Tool0, Frame::Link6, Frame::Dh6] {
            let prepared = PreparedPose::new(&fk(&q, frame), frame).unwrap();
            let solutions = prepared.back_substitute(t6, 1e-12, 1e-12);
            assert!(
                solutions
                    .iter()
                    .any(|s| wrapped_joint_distance(&s.q, &q) < 1e-12)
            );
        }
    }

    #[test]
    fn zero_pose_root_returns_four_python_branches() {
        let prepared = PreparedPose::new(&fk(&[0.0; 6], Frame::Tool0), Frame::Tool0).unwrap();
        let solutions = prepared.back_substitute(0.0, 1e-12, 1e-12);
        assert_eq!(solutions.len(), 4);
        let references = [
            [0.0; 6],
            [
                0.0,
                1.4071003471887433,
                -2.6817837973259837,
                0.0,
                1.27468345013724,
                0.0,
            ],
            [-PI, -1.4071003471887433, 0.0, -PI, 1.7344923064010498, 0.0],
            [-PI, 0.0, -2.6817837973259837, -PI, 0.45980885626380896, 0.0],
        ];
        for reference in references {
            assert!(
                solutions
                    .iter()
                    .any(|s| wrapped_joint_distance(&s.q, &reference) < 1e-12)
            );
        }
    }

    #[test]
    fn accepts_normalized_pose_and_rejects_invalid_inputs() {
        assert!(matrix_from_pose([0.0; 3], [0.0; 4]).is_err());
        assert!(matrix_from_pose([f64::NAN, 0.0, 0.0], [1.0, 0.0, 0.0, 0.0]).is_err());
        assert!(matrix_from_pose([0.0; 3], [f64::INFINITY, 0.0, 0.0, 0.0]).is_err());
        let identity = matrix_from_pose([0.0; 3], [1e300, 0.0, 0.0, 0.0]).unwrap();
        assert_eq!(identity, Pose::identity());
        let mut reflected = Pose::identity();
        reflected[(0, 0)] = -1.0;
        assert!(PreparedPose::new(&reflected, Frame::Tool0).is_err());
        let mut invalid_row = Pose::identity();
        invalid_row[(3, 0)] = 0.1;
        assert!(PreparedPose::new(&invalid_row, Frame::Tool0).is_err());
    }

    #[test]
    fn rotation_error_resolves_subnanoradian_angles() {
        let theta: f64 = 1e-10;
        let (s, c) = theta.sin_cos();
        assert!((rotation_error(&Matrix3::identity(), &rz(s, c)) - theta).abs() < 1e-20);
        assert!((rotation_error(&Matrix3::identity(), &rz(0.0, -1.0)) - PI).abs() < 1e-15);
    }
}
