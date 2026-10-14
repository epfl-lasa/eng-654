//! Paden-Kahan SP1, SP2 (product convention), and SP3 about unit axes.
//! Empty results mean no exact real solution; no least-squares IK is emitted.
use crate::math::*;
const EPS: f64 = 2e-12;

#[derive(Clone, Copy, Debug)]
pub struct Angle {
    pub value: f64,
    pub free: bool,
}
#[derive(Clone, Copy, Debug)]
pub struct Pair {
    pub first: Angle,
    pub second: Angle,
}

/// SP1: R(k, theta) p = q. On-axis points leave theta free.
pub fn sp1(k: Vec3, p: Vec3, q: Vec3, free_value: f64) -> Option<Angle> {
    let u = project(p, k);
    let v = project(q, k);
    let nu = norm(u);
    let nv = norm(v);
    if (dot(k, p) - dot(k, q)).abs() > EPS || (nu - nv).abs() > EPS {
        return None;
    }
    if nu.max(nv) < EPS {
        return Some(Angle {
            value: free_value,
            free: true,
        });
    }
    Some(Angle {
        value: dot(k, cross(u, v)).atan2(dot(u, v)),
        free: false,
    })
}

/// SP2: R(k1, theta1) R(k2, theta2) p = q, with intersecting,
/// nonparallel axes. Intersect the two rotation circles at intermediate c.
pub fn sp2(k1: Vec3, k2: Vec3, p: Vec3, q: Vec3, free1: f64, free2: f64) -> Vec<Pair> {
    if (norm(p) - norm(q)).abs() > EPS {
        return vec![];
    }
    let cosine = dot(k1, k2);
    let denominator = 1.0 - cosine * cosine;
    assert!(denominator > EPS, "SP2 requires nonparallel axes");
    let d1 = dot(k1, q);
    let d2 = dot(k2, p);
    let c0 = add(
        scale(k1, (d1 - cosine * d2) / denominator),
        scale(k2, (d2 - cosine * d1) / denominator),
    );
    let n = scale(cross(k1, k2), 1.0 / denominator.sqrt());
    // Both circles give the same height. Use the less cancellation-prone
    // circle, preserving tiny wrist angles via the target's transverse norm.
    let r1 = norm(project(q, k1));
    let m1 = norm(project(c0, k1));
    let r2 = norm(project(p, k2));
    let m2 = norm(project(c0, k2));
    if r1 < m1 - EPS || r2 < m2 - EPS {
        return vec![];
    }
    let (r, m) = if r1 <= r2 { (r1, m1) } else { (r2, m2) };
    let height = ((r - m).max(0.0) * (r + m)).sqrt();
    let mut result = Vec::with_capacity(2);
    for sign in [1.0, -1.0] {
        if sign < 0.0 && height < EPS {
            break;
        }
        let c = add(c0, scale(n, sign * height));
        if let (Some(first), Some(second)) = (sp1(k1, c, q, free1), sp1(k2, p, c, free2)) {
            result.push(Pair { first, second });
        }
    }
    result
}

/// SP3: ||R(k, theta) p - q|| = distance. Rodrigues' formula reduces
/// the distance constraint to a triangle in the plane normal to k.
/// A factored half-angle formula avoids cancellation near folded elbows.
pub fn sp3(k: Vec3, p: Vec3, q: Vec3, distance: f64) -> Vec<Angle> {
    let u = project(p, k);
    let v = project(q, k);
    let a = dot(q, u);
    let b = dot(q, cross(k, p));
    let ru = norm(u);
    let rv = norm(v);
    let gap = dot(k, sub(p, q)).abs();
    if ru.min(rv) < EPS {
        return if (norm(sub(p, q)) - distance).abs() <= EPS {
            vec![Angle {
                value: 0.0,
                free: true,
            }]
        } else {
            vec![]
        };
    }
    if distance < gap - EPS {
        return vec![];
    }
    let mut d = ((distance - gap).max(0.0) * (distance + gap)).sqrt();
    let low = (ru - rv).abs();
    let high = ru + rv;
    if d < low - EPS || d > high + EPS {
        return vec![];
    }
    d = d.clamp(low, high);
    // Preserve branch mergers after a few ulps of target FK arithmetic.
    if high - d <= 8.0 * f64::EPSILON * high {
        d = high;
    }
    if d - low <= 8.0 * f64::EPSILON * high {
        d = low;
    }
    let numerator = ((d - low) * (d + low)).sqrt();
    let denominator = ((high - d) * (high + d)).sqrt();
    let beta = 2.0 * numerator.atan2(denominator);
    let offset = b.atan2(a);
    let mut angles = vec![Angle {
        value: wrap(offset + beta),
        free: false,
    }];
    let second = wrap(offset - beta);
    if wrap(second - angles[0].value).abs() > EPS {
        angles.push(Angle {
            value: second,
            free: false,
        });
    }
    angles.sort_by(|a, b| b.value.total_cmp(&a.value));
    angles
}
