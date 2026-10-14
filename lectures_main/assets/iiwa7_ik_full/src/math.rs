pub type Vec3 = [f64; 3];
pub type Mat3 = [[f64; 3]; 3];
pub const X: Vec3 = [1.0, 0.0, 0.0];
pub const Y: Vec3 = [0.0, 1.0, 0.0];
pub const Z: Vec3 = [0.0, 0.0, 1.0];
pub const I: Mat3 = [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]];
pub const C: Mat3 = [[-1.0, 0.0, 0.0], [0.0, 0.0, 1.0], [0.0, 1.0, 0.0]];
pub const D: Mat3 = [[1.0, 0.0, 0.0], [0.0, 0.0, -1.0], [0.0, 1.0, 0.0]];

pub fn add(a: Vec3, b: Vec3) -> Vec3 {
    std::array::from_fn(|i| a[i] + b[i])
}
pub fn sub(a: Vec3, b: Vec3) -> Vec3 {
    std::array::from_fn(|i| a[i] - b[i])
}
pub fn scale(a: Vec3, s: f64) -> Vec3 {
    a.map(|v| v * s)
}
pub fn dot(a: Vec3, b: Vec3) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
pub fn norm(a: Vec3) -> f64 {
    a[0].hypot(a[1]).hypot(a[2])
}
pub fn cross(a: Vec3, b: Vec3) -> Vec3 {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}
pub fn project(a: Vec3, k: Vec3) -> Vec3 {
    sub(a, scale(k, dot(a, k)))
}
pub fn mv(a: Mat3, b: Vec3) -> Vec3 {
    a.map(|row| dot(row, b))
}
pub fn transpose(a: Mat3) -> Mat3 {
    std::array::from_fn(|i| std::array::from_fn(|j| a[j][i]))
}
pub fn mm(a: Mat3, b: Mat3) -> Mat3 {
    let bt = transpose(b);
    std::array::from_fn(|i| std::array::from_fn(|j| dot(a[i], bt[j])))
}
pub fn rz(a: f64) -> Mat3 {
    let (s, c) = a.sin_cos();
    [[c, -s, 0.0], [s, c, 0.0], [0.0, 0.0, 1.0]]
}
pub fn rotation(k: Vec3, a: f64) -> Mat3 {
    let (s, c) = a.sin_cos();
    let skew = [[0.0, -k[2], k[1]], [k[2], 0.0, -k[0]], [-k[1], k[0], 0.0]];
    std::array::from_fn(|i| {
        std::array::from_fn(|j| c * I[i][j] + (1.0 - c) * k[i] * k[j] + s * skew[i][j])
    })
}
pub fn wrap(a: f64) -> f64 {
    use std::f64::consts::{PI, TAU};
    if (-PI..PI).contains(&a) {
        a
    } else {
        (a + PI).rem_euclid(TAU) - PI
    }
}
pub fn rotation_error(a: Mat3, b: Mat3) -> f64 {
    let r = mm(a, transpose(b));
    let s = 0.5 * norm([r[2][1] - r[1][2], r[0][2] - r[2][0], r[1][0] - r[0][1]]);
    let c = ((r[0][0] + r[1][1] + r[2][2] - 1.0) * 0.5).clamp(-1.0, 1.0);
    s.atan2(c)
}
