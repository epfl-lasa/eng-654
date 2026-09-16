# CRB15000 inverse kinematics in Rust

This crate ports the fixed-geometry ABB CRB 15000-5/0.95 analytical IK solver to Rust. It evaluates the pose-only degree-16 polynomial, solves its roots, reconstructs joint configurations, and verifies every returned configuration by URDF forward kinematics. Rayon distributes independent target poses across CPU workers.

Distances are in metres, joint angles and rotation errors are in radians, and joint coordinates follow the original URDF. The default target frame is `tool0`; `link6` and `dh6` are also supported. The Python solver remains available separately.

## Build and test

Run from the repository root:

```sh
cargo build --release --manifest-path rust/Cargo.toml
cargo test --release --manifest-path rust/Cargo.toml
```

Tested with Rust 1.95.0. The arbitrary-precision dependency uses GMP/MPFR/MPC through `rug`; a first build may compile its native dependencies and require a C build toolchain. Subsequent runs use the compiled executable at `rust/target/release/crb15000-ik`. `Cargo.lock` pins the tested dependencies.

## Benchmark 1,000 poses

```sh
cargo run --release --manifest-path rust/Cargo.toml -- benchmark --samples 1000
```

The benchmark uses the stored Python fixture with NumPy seed 42: 1,000 identical target poses and 7,628 reference joint configurations from the 80-digit Python Aberth solver. It compares alternative configurations as well as successful poses, using wrapped joint-angle differences. Recovering one configuration per pose is not sufficient to pass the branch comparison.

Select the worker count or measure individual serial solves:

```sh
cargo run --release --manifest-path rust/Cargo.toml -- benchmark --threads 4 --repeat 5
cargo run --release --manifest-path rust/Cargo.toml -- benchmark --sequential
cargo run --release --manifest-path rust/Cargo.toml -- benchmark --method companion
cargo run --release --manifest-path rust/Cargo.toml -- benchmark --method reference --json
```

`--samples` selects a prefix of the fixture. `--repeat` repeats the measured batch. `--json` produces machine-readable results. Use the release build when comparing timings.

The timer excludes fixture loading, pose construction, pool setup, warm-up and
validation. Parallel **amortized time per pose** is batch wall time divided by
the number of solves; worker latency measures an individual solve during the
batch. For single-request latency, use `--sequential`. Accuracy and branch counts
refer to one batch, even when `--repeat` times multiple batches.

### Measured results

Release build on an Intel Core i7-1360P, Rust 1.95.0. Each row averages five
batches of the same 1,000 target poses; loading and validation are excluded.
Full machine-readable results and command arguments are in
[`benchmark_results.json`](benchmark_results.json).

| Method | Workers | Mean 1,000-pose batch time | Missing reference configurations |
| --- | ---: | ---: | ---: |
| Adaptive, sequential | 1 | 0.782 s | 0 |
| Adaptive, Rayon | 4 | 0.209 s | 0 |
| Adaptive, Rayon | 8 | 0.135 s | 0 |
| Adaptive, Rayon | 16 | **0.097 s** | **0** |
| Companion only | 8 | 0.085 s | 22 |
| Two Newton steps | 8 | 0.129 s | 2 |
| High-precision reference | 8 | 0.425 s | 0 |

Adaptive mode recovered all **7,628 reference configurations and all 1,000 seed
configurations**. Maximum FK position error was `6.392e-15 m`; maximum rotation
error was `6.645e-14 rad`. Ten poses used fallback refinement. The 16-worker
amortized cost was `96.657 microseconds/pose`; sequential cost was
`781.529 microseconds/pose`. These timings depend on hardware and system load.

To reproduce the whole table after building, run
`python3 scripts/benchmark_rust.py`. The script records a fresh JSON report.

## Root-solving methods

| `--method` | Behavior |
| --- | --- |
| `companion` | Double-precision companion-matrix eigenvalues, without high-precision root polishing. Useful for comparing the original `np.roots`-only approach. |
| `polished` | Companion roots followed by two Newton steps using high-precision coefficients. |
| `adaptive` (default) | Polished roots plus convergence checks and high-precision fallback for difficult polynomials. |
| `reference` | High-precision simultaneous root refinement for reference comparisons. |

The default coefficient precision is 128 bits. Coefficients use the generated pose-only formula with the D–H constants already substituted; no symbolic elimination or polynomial division occurs while solving a pose. The adaptive path can re-evaluate coefficients at 256 and 320 bits. Reference mode uses at least 272 bits.

Further implementation details:

- Companion matrices use power-of-two variable scaling and balancing; reciprocal polynomials handle roots spanning an awkward numerical range.
- Newton polishing evaluates the polynomial and derivative together with Horner's method, using the original high-precision coefficients.
- Adaptive checks include scaled residuals, Newton corrections, root separation, ambiguous imaginary components, conjugate pairing, and reconstruction of coefficients from all roots. Difficult cases use simultaneous Aberth refinement.
- If a real root fails geometric verification, adaptive mode retries with newly
  evaluated coefficients at higher precision, within the same 320-bit default limit.
- Pose orientation and geometry are prepared once and reused for every candidate root.
- Fixed-size matrix operations implement FK and analytical back substitution.
- Constant frame conversions use rotation transposes.
- Every returned branch passes position and rotation checks; default tolerances are `2e-7` metres/radians.
- Equivalent joint configurations are deduplicated modulo `2π`.
- Batches preserve input order across Rayon workers.

Rotation error uses an `atan2` formula that resolves tiny angles. The Python version uses `acos`, which has a roundoff floor near zero; very small reported rotation errors therefore differ between implementations.

## Solve matrices from JSON

The `solve` command reads an object from standard input. Each pose contains 16 numbers in **row-major** order, including the final homogeneous row `[0, 0, 0, 1]`.

```sh
cargo run --release --manifest-path rust/Cargo.toml -- solve --threads 4 <<'JSON'
{
  "frame": "tool0",
  "poses": [
    [0, 0, 1, 0.571,
     0, 1, 0, 0,
     -1, 0, 0, 0.899,
     0, 0, 0, 1]
  ]
}
JSON
```

The sample is the zero-joint `tool0` pose. The output includes verified joint configurations and root diagnostics for each input pose. Each array element is `{"Ok": report}` or `{"Err": message}`. Input errors are preserved at their original positions, and the process exits nonzero if any pose fails. `--input poses.json` reads a file instead of stdin. `--method` selects the same methods as the benchmark.

## Library API

```rust
use crb15000_ik::{Frame, SolveOptions, fk, solve_batch, solve_matrix, solve_pose};

fn main() -> Result<(), String> {
    let options = SolveOptions {
        frame: Frame::Tool0,
        ..SolveOptions::default()
    };
    let target = fk(&[0.2, -0.5, 0.7, 1.1, -0.3, 0.9], options.frame);
    let report = solve_matrix(&target, &options)?;
    for solution in &report.solutions {
        println!("{:?}, position error = {} m", solution.q, solution.position_error);
    }

    // Quaternion order is [w, x, y, z]; nonzero quaternions are normalized.
    let _report = solve_pose([0.571, 0.0, 0.899], [1.0, 0.0, 1.0, 0.0], &options)?;
    let reports = solve_batch(&[target, target], &options);
    assert_eq!(reports.len(), 2);
    Ok(())
}
```

`solve_matrix` and `solve_pose` return `Result<SolveReport, String>`. A report contains `solutions` and `diagnostics`; `solve_batch` returns one result per input pose, so one invalid target does not discard other results.

Solutions include six wrapped joint angles, position/rotation errors, the `within_limits` flag, the half-angle root `t6`, and the two back-substitution branch identifiers. Diagnostics report `coefficient_precision_bits` and `root_precision_bits` separately, fallback use, root iterations, convergence, real and complex root counts, geometric rejections, and the scaled polynomial residual before conversion to double precision. Final FK errors measure the returned double-precision joint configurations. Set `respect_limits: true` to retain only configurations whose wrapped angles satisfy the existing limits.

To use a private Rayon pool, wrap `solve_batch` in `rayon::ThreadPoolBuilder::new().num_threads(n).build()?.install(...)` in the calling application. Parallelism is across target poses; a single degree-16 root solve remains within one worker.

## Scope and completeness

This retains the Python solver's generic-pose formulation. Base-axis singular branches with radial distance below `1e-10` need a separate analytical treatment; continuous singular solution families are not enumerated. The `q6 = π` half-angle chart is tested through a large finite half-angle candidate when the leading coefficient nearly vanishes.

Joint angles remain wrapped to `[-π, π)`, and joint-limit tagging preserves the Python behavior. In particular, the third joint's native lower limit extends below `-π`, so limit checking on wrapped representatives can exclude an equivalent unwrapped configuration.

Agreement with all stored reference branches is a regression check, not a mathematical completeness certificate for every pose. FK checks establish the accuracy of returned solutions; they do not certify that no branches are missing. Adaptive/reference modes return an error when polynomial roots remain unresolved instead of treating that case as an unreachable pose. Certified root isolation is not implemented in this port.

## Regenerate source or reference data

```sh
python3 scripts/generate_rust_coefficients.py
python3 scripts/export_rust_reference.py
```

The first command regenerates `rust/src/coefficients.rs` from the fixed pose-coefficient recipe. The second recreates `rust/tests/data/reference_1000.json` using Python, NumPy, mpmath and the original 80-digit Aberth solver. Neither Python nor the regeneration tools are needed to run the compiled Rust solver.

## Lecture 07 live slice service

From the teaching repository root, start the native solver for the browser:

```sh
bash lectures_main/tools/serve-crb-ik.sh
```

The loopback service at `http://127.0.0.1:8743` runs this crate's original
Rust/Rug adaptive solver through a bounded Rayon pool. It streams full-pose
IK counts and joint-limit counts as tiles finish. The browser automatically
uses parallel JavaScript workers when this optional service is unavailable;
rare unresolved native queries receive explicitly reported browser recovery.
No unresolved query is counted as zero. The added service binary does not
change the existing `cargo run` CLI default.

See [launch instructions, backend behavior and verification](../../tools/CRB_IK_SERVICE.md).
The browser integration is `js/viz/abbCrbCompute.js`; the protocol is
`GET /health` and streaming NDJSON `POST /slice`. The supplied GMP dependency
currently rejects the installed WASM cross-compilation target, so this service
retains the original native high-precision implementation rather than replacing
it with a lower-precision solver.
