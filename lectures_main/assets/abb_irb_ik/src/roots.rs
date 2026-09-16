//! Balanced companion seeds and adaptive multiprecision polynomial roots.
//!
//! Coefficients are in ascending order. Residuals, correction estimates, conjugacy,
//! separation and Vieta checks are numerical diagnostics, not a root certificate.
//! In particular, a tiny residual alone does not establish that every root was found.

use nalgebra::{DMatrix, linalg::Schur};
use num_complex::Complex64;
use rug::{Complex, Float};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RootMethod {
    Companion,
    Polished,
    Adaptive,
    Reference,
}

#[derive(Clone, Debug)]
pub struct RootOptions {
    pub method: RootMethod,
    pub polish_steps: usize,
}

impl Default for RootOptions {
    fn default() -> Self {
        Self {
            method: RootMethod::Adaptive,
            polish_steps: 2,
        }
    }
}

#[derive(Clone, Debug)]
pub struct RootResult {
    pub roots: Vec<Complex64>,
    /// Precision of final multiprecision root arithmetic and diagnostics.
    /// Companion eigenvalue seeds themselves are always computed in f64.
    pub precision_bits: u32,
    pub used_fallback: bool,
    pub converged: bool,
    pub max_scaled_residual: f64,
    pub iterations: usize,
}

struct Chart {
    reciprocal: bool,
    exponent: i32,
    monic: Vec<f64>,
    score: f64,
}

fn log2_abs(value: &Float) -> f64 {
    let (mantissa, exponent) = value.to_f64_exp();
    mantissa.abs().log2() + f64::from(exponent)
}

/// The exact power-of-two substitution x = 2^exponent y is applied before
/// rounding the coefficients to doubles. For a reciprocal chart x = 1/(2^e y).
fn make_chart(coeff: &[Float], reciprocal: bool) -> Option<Chart> {
    let n = coeff.len() - 1;
    let leading = if reciprocal { &coeff[0] } else { &coeff[n] };
    let constant = if reciprocal { &coeff[n] } else { &coeff[0] };
    let exponent = ((log2_abs(constant) - log2_abs(leading)) / n as f64)
        .round()
        .clamp(-1000.0, 1000.0) as i32;
    let mut monic = Vec::with_capacity(n + 1);
    let mut score = 0.0_f64;
    for i in 0..=n {
        let source = if reciprocal { &coeff[n - i] } else { &coeff[i] };
        let mut value = Float::with_val(128, source / leading);
        value <<= exponent * (i as i32 - n as i32);
        let converted = value.to_f64();
        if !converted.is_finite() || (converted == 0.0 && !value.is_zero()) {
            return None;
        }
        if converted != 0.0 {
            score = score.max(converted.abs().log2());
        }
        monic.push(converted);
    }
    Some(Chart {
        reciprocal,
        exponent,
        monic,
        score,
    })
}

/// Osborne balancing restricted to exact powers of two. Similarity transforms
/// leave eigenvalues unchanged and reduce the companion matrix's dynamic range.
fn balance(matrix: &mut DMatrix<f64>) {
    let n = matrix.nrows();
    for _ in 0..32 {
        let mut changed = false;
        for i in 0..n {
            let row: f64 = (0..n)
                .filter(|&j| j != i)
                .map(|j| matrix[(i, j)].abs())
                .sum();
            let col: f64 = (0..n)
                .filter(|&j| j != i)
                .map(|j| matrix[(j, i)].abs())
                .sum();
            if row == 0.0 || col == 0.0 || !row.is_finite() || !col.is_finite() {
                continue;
            }
            let shift = ((row.log2() - col.log2()) * 0.5)
                .round()
                .clamp(-256.0, 256.0) as i32;
            if shift == 0 {
                continue;
            }
            let factor = 2.0_f64.powi(shift);
            if row / factor + col * factor >= 0.95 * (row + col) {
                continue;
            }
            if (0..n).any(|j| {
                !(matrix[(i, j)] / factor).is_finite() || !(matrix[(j, i)] * factor).is_finite()
            }) {
                continue;
            }
            for j in 0..n {
                matrix[(i, j)] /= factor;
            }
            for j in 0..n {
                matrix[(j, i)] *= factor;
            }
            changed = true;
        }
        if !changed {
            break;
        }
    }
}

fn seeds_from_chart(chart: &Chart) -> Option<Vec<Complex64>> {
    let n = chart.monic.len() - 1;
    let mut matrix = DMatrix::zeros(n, n);
    for i in 1..n {
        matrix[(i, i - 1)] = 1.0;
    }
    for i in 0..n {
        matrix[(i, n - 1)] = -chart.monic[i];
    }
    balance(&mut matrix);
    // nalgebra uses an unbounded loop when max_niter == 0; always set a bound.
    let schur = Schur::try_new(matrix, f64::EPSILON, 10_000)?;
    let scale = 2.0_f64.powi(chart.exponent);
    let roots: Vec<_> = schur
        .complex_eigenvalues()
        .iter()
        .map(|&value| {
            if chart.reciprocal {
                // num_complex's generic division squares the denominator. Mapping
                // in MPFR also avoids overflow in 2^e*y before taking its inverse.
                let mut mapped = Complex::with_val(128, (value.re, value.im));
                mapped *= scale;
                let mut inverse = Complex::with_val(128, 1);
                inverse /= mapped;
                Complex64::new(inverse.real().to_f64(), inverse.imag().to_f64())
            } else {
                value * scale
            }
        })
        .collect();
    roots
        .iter()
        .all(|z| z.re.is_finite() && z.im.is_finite())
        .then_some(roots)
}

fn companion_seeds(coeff: &[Float]) -> Option<Vec<Complex64>> {
    let direct = make_chart(coeff, false);
    let inverse = make_chart(coeff, true);
    match (direct, inverse) {
        (Some(a), Some(b)) => {
            if b.score + 4.0 < a.score {
                seeds_from_chart(&b).or_else(|| seeds_from_chart(&a))
            } else {
                seeds_from_chart(&a).or_else(|| seeds_from_chart(&b))
            }
        }
        (Some(a), None) | (None, Some(a)) => seeds_from_chart(&a),
        (None, None) => None,
    }
}

fn complex_finite(z: &Complex) -> bool {
    z.real().is_finite() && z.imag().is_finite()
}

fn abs(z: &Complex, precision: u32) -> Float {
    Float::with_val(precision, z.abs_ref())
}

/// One Horner pass computes p and p'. Never evaluate rounded double coefficients
/// when polishing: these coefficients retain the evaluator's original precision.
fn horner(coeff: &[Float], z: &Complex, precision: u32) -> (Complex, Complex) {
    let mut p = Complex::with_val(precision, coeff.last().unwrap());
    let mut dp = Complex::new(precision);
    for c in coeff[..coeff.len() - 1].iter().rev() {
        dp *= z;
        dp += &p;
        p *= z;
        p += c;
    }
    (p, dp)
}

fn relative_size(value: &Complex, z: &Complex, precision: u32) -> f64 {
    let mut numerator = abs(value, precision);
    let mut denominator = abs(z, precision);
    denominator += 1;
    numerator /= denominator;
    numerator.to_f64()
}

fn polish(coeff: &[Float], roots: &mut [Complex], steps: usize, precision: u32) -> bool {
    let mut safe = true;
    for root in roots {
        for _ in 0..steps {
            let (mut p, dp) = horner(coeff, root, precision);
            if p == 0 {
                break;
            }
            if dp == 0 {
                safe = false;
                break;
            }
            p /= dp;
            *root -= &p;
            if !complex_finite(root) {
                safe = false;
                break;
            }
            if relative_size(&p, root, precision) < 1e-32 {
                break;
            }
        }
    }
    safe
}

#[derive(Default)]
struct Diagnostics {
    max_residual: f64,
    max_correction: f64,
    vieta_error: f64,
    suspicious: bool,
    finite: bool,
}

/// Reconstructing the monic polynomial catches independently polished guesses
/// that collapse onto the same simple root while leaving another root missing.
fn vieta_error(coeff: &[Float], roots: &[Complex], precision: u32) -> f64 {
    let mut reconstructed = vec![Complex::with_val(precision, 1)];
    for root in roots {
        let mut next = vec![Complex::new(precision); reconstructed.len() + 1];
        for (i, c) in reconstructed.iter().enumerate() {
            next[i] -= c * root;
            next[i + 1] += c;
        }
        reconstructed = next;
    }
    let mut scale = Float::with_val(precision, 1);
    let mut difference = Float::new(precision);
    for (actual, expected) in reconstructed.iter().zip(coeff) {
        let expected = Float::with_val(precision, expected / coeff.last().unwrap());
        let expected_abs = Float::with_val(precision, expected.abs_ref());
        if expected_abs > scale {
            scale = expected_abs;
        }
        let mut delta = actual.clone();
        delta -= expected;
        let magnitude = abs(&delta, precision);
        if magnitude > difference {
            difference = magnitude;
        }
    }
    difference /= scale;
    difference.to_f64()
}

fn diagnose(coeff: &[Float], roots: &[Complex], precision: u32) -> Diagnostics {
    let mut d = Diagnostics {
        finite: true,
        ..Diagnostics::default()
    };
    let mut double_roots = Vec::with_capacity(roots.len());
    for root in roots {
        if !complex_finite(root) {
            d.finite = false;
            return d;
        }
        let (p, dp) = horner(coeff, root, precision);
        let radius = abs(root, precision);
        let mut denominator = Float::new(precision);
        for c in coeff.iter().rev() {
            denominator *= &radius;
            denominator += Float::with_val(precision, c.abs_ref());
        }
        let mut residual = abs(&p, precision);
        if denominator != 0 {
            residual /= denominator;
        }
        d.max_residual = d.max_residual.max(residual.to_f64());
        let correction = if p == 0 {
            0.0
        } else if dp == 0 {
            f64::INFINITY
        } else {
            relative_size(&Complex::with_val(precision, &p / &dp), root, precision)
        };
        d.max_correction = d.max_correction.max(correction);
        let z = Complex64::new(root.real().to_f64(), root.imag().to_f64());
        if !z.re.is_finite() || !z.im.is_finite() {
            d.finite = false;
            return d;
        }
        let imaginary = z.im.abs() / (1.0 + z.re.abs());
        // A double-precision real-root filter should not decide these cases.
        d.suspicious |= imaginary > 1e-25 && imaginary < 1e-8;
        double_roots.push(z);
    }
    for (i, a) in double_roots.iter().enumerate() {
        for b in &double_roots[..i] {
            let separation = (*a - *b).norm() / (1.0 + a.norm().max(b.norm()));
            d.suspicious |= separation < 1e-7;
        }
        if a.im.abs() > 1e-20 * (1.0 + a.re.abs()) {
            let conjugate_error = double_roots
                .iter()
                .map(|b| (*b - a.conj()).norm())
                .fold(f64::INFINITY, f64::min)
                / (1.0 + a.norm());
            d.suspicious |= conjugate_error > 1e-12;
        }
    }
    d.vieta_error = vieta_error(coeff, roots, precision);
    d
}

fn satisfactory(d: &Diagnostics) -> bool {
    d.finite && d.max_residual < 1e-24 && d.max_correction < 5e-14 && d.vieta_error < 1e-20
}

/// Cauchy-circle seeds remain available when finite companion seeds cannot be
/// formed. Arbitrary precision prevents the radius itself overflowing doubles.
fn circle_seeds(coeff: &[Float], precision: u32) -> Vec<Complex> {
    let n = coeff.len() - 1;
    let lead = coeff.last().unwrap();
    let mut radius = Float::with_val(precision, 1);
    for c in &coeff[..n] {
        let ratio = Float::with_val(precision, c / lead).abs();
        if ratio > radius {
            radius = ratio;
        }
    }
    radius += 1;
    (0..n)
        .map(|k| {
            // Transcendental seed accuracy need only be double precision.
            let angle = std::f64::consts::TAU * (k as f64 + 0.37) / n as f64;
            let mut z = Complex::with_val(precision, (angle.cos(), angle.sin()));
            z *= &radius;
            z
        })
        .collect()
}

/// Simultaneous Aberth corrections avoid independent Newton trajectories
/// converging to the same simple root. The iteration and precision are bounded.
fn aberth(coeff: &[Float], roots: &mut [Complex], precision: u32) -> (usize, bool) {
    let n = roots.len();
    let tolerance = 2.0_f64.powi(-(precision.min(240) as i32 / 2));
    // Split identical starting guesses. Keeping all conjugate seeds untouched
    // elsewhere preserves exact real arithmetic on well-conditioned real roots.
    for i in 0..n {
        if (0..i).any(|j| roots[i] == roots[j]) {
            let mut perturbation = abs(&roots[i], precision);
            perturbation += 1;
            perturbation *= 1e-10 * (i + 1) as f64;
            roots[i] += Complex::with_val(precision, (&perturbation, &perturbation));
        }
    }
    for iteration in 1..=240 {
        let mut next = Vec::with_capacity(n);
        let mut max_correction = 0.0_f64;
        let mut valid = true;
        for i in 0..n {
            let (mut newton, derivative) = horner(coeff, &roots[i], precision);
            if newton == 0 {
                next.push(roots[i].clone());
                continue;
            }
            if derivative == 0 {
                valid = false;
                next.push(roots[i].clone());
                continue;
            }
            newton /= derivative;
            let mut repulsion = Complex::new(precision);
            for j in 0..n {
                if i == j {
                    continue;
                }
                let delta = Complex::with_val(precision, &roots[i] - &roots[j]);
                if delta == 0 {
                    valid = false;
                    continue;
                }
                let mut inverse = Complex::with_val(precision, 1);
                inverse /= delta;
                repulsion += inverse;
            }
            let mut denominator = Complex::with_val(precision, 1);
            denominator -= &newton * &repulsion;
            if denominator != 0 {
                newton /= denominator;
            }
            let z = Complex::with_val(precision, &roots[i] - &newton);
            if !complex_finite(&z) {
                return (iteration, false);
            }
            max_correction = max_correction.max(relative_size(&newton, &z, precision));
            next.push(z);
        }
        roots.clone_from_slice(&next);
        if valid && max_correction < tolerance {
            return (iteration, true);
        }
    }
    (240, false)
}

/// Solve a finite polynomial; leading and trailing *exact* zeros are handled
/// explicitly. Tiny nonzero leading coefficients are never silently removed.
/// Roots outside Complex64's finite range produce an error instead of infinity.
pub fn solve_roots(coeff: &[Float], options: &RootOptions) -> Result<RootResult, String> {
    if coeff.is_empty() {
        return Err("polynomial coefficient array is empty".into());
    }
    if coeff.iter().any(|c| !c.is_finite()) {
        return Err("polynomial contains a nonfinite coefficient".into());
    }
    let last = coeff.iter().rposition(|c| !c.is_zero()).ok_or_else(|| {
        "identically zero polynomial has no finite, enumerable root set".to_string()
    })?;
    if last == 0 {
        return Ok(RootResult {
            roots: Vec::new(),
            precision_bits: coeff[0].prec().max(128),
            used_fallback: false,
            converged: true,
            max_scaled_residual: 0.0,
            iterations: 0,
        });
    }
    let zero_count = coeff[..=last].iter().take_while(|c| c.is_zero()).count();
    let coeff = &coeff[zero_count..=last];
    let n = coeff.len() - 1;
    let source_precision = coeff.iter().map(Float::prec).max().unwrap_or(128);
    let precision = source_precision.max(128);
    let mut used_fallback = false;
    let mut iterations = 0;
    let mut roots: Vec<Complex>;
    let mut final_diagnostic = None;
    if n == 0 {
        roots = Vec::new();
    } else if n == 1 {
        let mut value = Float::with_val(precision, -&coeff[0]);
        value /= &coeff[1];
        roots = vec![Complex::with_val(precision, value)];
    } else {
        let seeds = companion_seeds(coeff);
        if seeds.is_none() && matches!(options.method, RootMethod::Companion | RootMethod::Polished)
        {
            return Err("balanced companion eigensolver failed to produce finite seeds".into());
        }
        used_fallback = seeds.is_none();
        roots = seeds
            .map(|values| {
                values
                    .iter()
                    .map(|z| Complex::with_val(precision, (z.re, z.im)))
                    .collect()
            })
            .unwrap_or_else(|| circle_seeds(coeff, precision));
        match options.method {
            RootMethod::Companion => {}
            RootMethod::Polished => {
                polish(coeff, &mut roots, options.polish_steps, precision);
                iterations += options.polish_steps;
            }
            RootMethod::Adaptive | RootMethod::Reference => {
                let reference = options.method == RootMethod::Reference;
                if !reference {
                    polish(coeff, &mut roots, options.polish_steps, precision);
                    iterations += options.polish_steps;
                }
                let diagnostic = if reference || used_fallback {
                    None
                } else {
                    Some(diagnose(coeff, &roots, precision))
                };
                if reference
                    || used_fallback
                    || diagnostic
                        .as_ref()
                        .is_some_and(|d| d.suspicious || !satisfactory(d))
                {
                    used_fallback |= !reference;
                    let high_precision = precision.max(256);
                    for root in &mut roots {
                        root.set_prec(high_precision);
                    }
                    let (count, _) = aberth(coeff, &mut roots, high_precision);
                    iterations += count;
                    polish(coeff, &mut roots, 2, high_precision);
                    iterations += 2;
                } else {
                    // No root changed after these checks. Reuse the full
                    // diagnostic, including the O(n^2) Vieta reconstruction.
                    final_diagnostic = diagnostic;
                }
            }
        }
    }
    let work_precision = roots.first().map(|z| z.prec().0).unwrap_or(precision);
    let diagnostic = final_diagnostic.unwrap_or_else(|| diagnose(coeff, &roots, work_precision));
    if !diagnostic.finite {
        return Err("polynomial has unresolved roots or roots outside the finite f64 range".into());
    }
    let converged = satisfactory(&diagnostic);
    let mut output: Vec<_> = roots
        .iter()
        .map(|z| Complex64::new(z.real().to_f64(), z.imag().to_f64()))
        .collect();
    output.extend(std::iter::repeat_n(Complex64::new(0.0, 0.0), zero_count));
    output.sort_by(|a, b| a.re.total_cmp(&b.re).then(a.im.total_cmp(&b.im)));
    Ok(RootResult {
        roots: output,
        precision_bits: work_precision,
        used_fallback,
        converged,
        max_scaled_residual: diagnostic.max_residual,
        iterations,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn coefficients(values: &[f64]) -> Vec<Float> {
        values.iter().map(|&x| Float::with_val(256, x)).collect()
    }

    fn from_real_roots(roots: &[Float]) -> Vec<Float> {
        let mut coefficients = vec![Float::with_val(256, 1)];
        for root in roots {
            let mut next = vec![Float::new(256); coefficients.len() + 1];
            for (i, c) in coefficients.iter().enumerate() {
                next[i] -= c * root;
                next[i + 1] += c;
            }
            coefficients = next;
        }
        coefficients
    }

    #[test]
    fn exact_zeros_and_constants_have_explicit_semantics() {
        assert!(solve_roots(&coefficients(&[0.0, 0.0]), &RootOptions::default()).is_err());
        assert!(solve_roots(&[], &RootOptions::default()).is_err());
        assert!(
            solve_roots(&coefficients(&[4.0]), &RootOptions::default())
                .unwrap()
                .roots
                .is_empty()
        );
        let result = solve_roots(
            &coefficients(&[0.0, 0.0, -2.0, 1.0, 0.0]),
            &RootOptions::default(),
        )
        .unwrap();
        assert_eq!(
            result.roots,
            vec![
                Complex64::new(0.0, 0.0),
                Complex64::new(0.0, 0.0),
                Complex64::new(2.0, 0.0)
            ]
        );
        assert!(result.converged);
    }

    #[test]
    fn recovers_real_and_conjugate_roots() {
        // (x - 2)(x + 3)(x^2 + 1).
        let coeff: Vec<_> = coefficients(&[-6.0, 1.0, -5.0, 1.0, 1.0])
            .iter()
            .map(|c| Float::with_val(128, c))
            .collect();
        let result = solve_roots(&coeff, &RootOptions::default()).unwrap();
        assert!(result.converged, "{result:?}");
        assert_eq!(result.precision_bits, 128);
        for expected in [
            Complex64::new(-3.0, 0.0),
            Complex64::new(2.0, 0.0),
            Complex64::new(0.0, 1.0),
            Complex64::new(0.0, -1.0),
        ] {
            assert!(result.roots.iter().any(|z| (*z - expected).norm() < 1e-12));
        }
    }

    #[test]
    fn preserves_tiny_leading_coefficients_and_huge_finite_roots() {
        let result = solve_roots(&coefficients(&[-1.0, 1e-100]), &RootOptions::default()).unwrap();
        assert_eq!(result.roots.len(), 1);
        assert!((result.roots[0].re / 1e100 - 1.0).abs() < 1e-14);
        let original = coefficients(&[-4.0, -2.0, 0.5, 1.0]);
        let scaled: Vec<_> = original
            .iter()
            .map(|x| {
                let mut c = x.clone();
                c >>= 1600;
                c
            })
            .collect();
        let a = solve_roots(&original, &RootOptions::default()).unwrap();
        let b = solve_roots(&scaled, &RootOptions::default()).unwrap();
        assert_eq!(a.roots, b.roots);
    }

    #[test]
    fn clustered_roots_trigger_simultaneous_fallback() {
        let close = Float::with_val(256, Float::parse("1.00000001").unwrap());
        let expected = vec![
            Float::with_val(256, -3),
            Float::with_val(256, 1),
            close,
            Float::with_val(256, 2),
        ];
        let coeff: Vec<_> = from_real_roots(&expected)
            .iter()
            .map(|c| Float::with_val(128, c))
            .collect();
        let result = solve_roots(&coeff, &RootOptions::default()).unwrap();
        assert!(result.used_fallback, "{result:?}");
        assert_eq!(result.precision_bits, 256);
        assert!(result.converged, "{result:?}");
        assert_eq!(result.roots.len(), expected.len());
        for (actual, expected) in result.roots.iter().zip(expected) {
            assert!((actual.re - expected.to_f64()).abs() < 1e-11, "{result:?}");
            assert!(actual.im.abs() < 1e-11);
        }
    }

    #[test]
    fn nonfinite_input_is_rejected() {
        assert!(solve_roots(&coefficients(&[1.0, f64::NAN]), &RootOptions::default()).is_err());
    }

    #[test]
    fn widely_separated_roots_are_not_trimmed_away() {
        let expected = coefficients(&[-2.0, 1e-30, 1e30]);
        let result = solve_roots(&from_real_roots(&expected), &RootOptions::default()).unwrap();
        assert!(result.converged, "{result:?}");
        assert_eq!(result.roots.len(), expected.len());
        for (actual, expected) in result.roots.iter().zip(expected) {
            assert!(
                (actual.re / expected.to_f64() - 1.0).abs() < 1e-12,
                "{result:?}"
            );
        }
    }

    #[test]
    fn repeated_roots_preserve_multiplicity_and_request_fallback() {
        let expected = coefficients(&[1.0, 1.0, 1.0, 2.0]);
        let result = solve_roots(&from_real_roots(&expected), &RootOptions::default()).unwrap();
        assert!(result.used_fallback, "{result:?}");
        assert_eq!(result.roots.len(), expected.len());
        // A repeated root need not satisfy the simple-root correction test:
        // callers receive `converged=false` if available precision is insufficient.
        for (actual, expected) in result.roots.iter().zip(expected) {
            assert!(
                (*actual - Complex64::new(expected.to_f64(), 0.0)).norm() < 1e-8,
                "{result:?}"
            );
        }
    }
}
