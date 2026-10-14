# KUKA iiwa 7 fixed-q3 inverse kinematics

Rust analytical IK for [`../models/iiwa7/iiwa7.urdf`](../models/iiwa7/iiwa7.urdf).
Supply a target pose and the **third native URDF joint angle `q3` in radians**.
Fixing that joint leaves a wrist-partitioned 6R chain with unknowns
`q1, q2, q4, q5, q6, q7`. The executable returns all isolated real solutions
modulo whole turns, up to eight per pose, and verifies every returned solution
by forward kinematics. Continuous singular families have explicit free-parameter
metadata and selectable representatives.

This is fixed geometry. The free-joint URDF has the same kinematics, but useful
solution filtering uses the hard limits in `iiwa7.urdf`. The separately supplied
`kuka_iiwa7_misaligned.urdf` is not supported.

## Run the supplied executable

`iiwa7_ik_full` contains the Rust source, derivation, tests, and benchmark reports.
The sibling [`../iiwa7_ik`](../iiwa7_ik) contains the same runtime folder layout
as the ABB GoFa package:

```text
iiwa7_ik/
  iiwa7-ik-linux-x86_64/
    iiwa7-ik
    example_script.py
    README.md
    pose.json
    example-output.json
  iiwa7-ik-windows-x86_64/
    iiwa7-ik.exe
    example_script.py
    README.md
    pose.json
    example-output.json
```

The distributable [`../iiwa7_ik.zip`](../iiwa7_ik.zip) contains both folders,
including checksum files and validation reports. Both copies of
`example_script.py` are identical and automatically select the executable for
the operating system. The canonical caller is [`examples/example_script.py`](examples/example_script.py).

The Linux binary needs glibc **2.35 or newer**, `libm`, and `libgcc_s`.
The Windows binary is a native x64 console executable whose compiler support
is linked statically; it imports only Windows system DLLs. Rust and the URDF
are not needed at runtime. The optional Python example uses only the standard library.

From the executable's directory:

```sh
./iiwa7-ik solve-pose --input pose.json
./iiwa7-ik solve-pose --input pose.json --useful-only
python3 example_script.py
python3 example_script.py --useful-only
```

On Windows, open PowerShell in `iiwa7-ik-windows-x86_64`:

```powershell
.\iiwa7-ik.exe solve-pose --input pose.json
.\iiwa7-ik.exe solve-pose --input pose.json --useful-only
python example_script.py
python example_script.py --useful-only
```

Alternatively send one JSON object on stdin, then EOF:

```sh
echo '{"pose":[-0.3664404775042923,-0.4762924875117099,0.34911314922081393,-0.5127319024430761,-0.4812309966767833,0.5445534784622869,-0.4571479335501771],"q3":0.5}' | ./iiwa7-ik solve-pose
```

## Input and frames

```json
{
  "pose": [-0.3664404775042923, -0.4762924875117099, 0.34911314922081393,
           -0.5127319024430761, -0.4812309966767833, 0.5445534784622869,
           -0.4571479335501771],
  "q3": 0.5,
  "frame": "iiwa_link_ee",
  "respect_limits": false
}
```

`pose` is `[px, py, pz, qw, qx, qy, qz]`. Position is in **metres**, expressed
in `iiwa_link_0`, which coincides with `world` in this URDF. The quaternion
rotates vectors from the target link frame into the base frame; its order is
**w, x, y, z**. Any finite nonzero quaternion is normalized automatically.
The example is the FK of `[0.4, -0.7, 0.5, 1.8, -0.9, 0.8, 0.3]` radians.

`q3` is required, finite, and measured in radians. It is **joint 3**, not the
third unknown of the reduced chain, an elbow angle, or a SEW angle. Every solution
preserves the supplied numerical `q3`. Changing it can change reachability and
the available branches. The other six angles are returned in `[-pi, pi)`.
Solutions differing only by `2*pi` in those six angles are represented once.
If you supply `q3` outside its hard limit, all solutions are tagged out of limits
even if a whole-turn-equivalent third-joint angle would fit.

`frame` defaults to `"iiwa_link_ee"` (alias `"tool0"`), including the fixed
0.045 m tool translation after link 7. Use `"iiwa_link_7"` (alias `"link7"`)
to target the flange frame before that translation. A custom tool requires
converting its pose to one of these frames before calling the solver.

Unknown input fields are rejected so misspelled filter or frame options do not
silently change behavior. `./iiwa7-ik --help` lists the command-line interface.

## All solutions and the useful-only flag

By default, **joint limits do not remove any IK solution**. Each solution has:

- `q`: `[q1, q2, q3, q4, q5, q6, q7]`, in radians.
- `within_limits`: whether all seven supplied joint coordinates satisfy the native hard limits.
- `position_error`: FK position error in metres.
- `rotation_error`: FK rotation error in radians, using a stable `atan2` measure.
- `branch` and `merged_branches`: elbow/shoulder/wrist branch labels.
- `free_parameters`: descriptions of singular continuous families, empty for isolated solutions.

Toggle **`--useful-only`** to return only joint-limit-valid configurations.
The equivalent JSON switch is **`"respect_limits": true`**, and the Python
function uses **`useful_only=True`**. A CLI flag enables filtering even if the
JSON field is false. To return all branches, omit the CLI flag and set the JSON
field to false, its default. No angle is clamped to a limit.

| Joint | Hard range in radians | Degrees |
| --- | --- | --- |
| q1, q3, q5 | +/-2.9670597283903604 | +/-170 |
| q2, q4, q6 | +/-2.0943951023931953 | +/-120 |
| q7 | +/-3.0543261909900763 | +/-175 |

Limit checks allow `1e-12` rad of roundoff. “Useful” here means satisfying joint
position limits; it does not check collisions, velocity, torque, or motion paths.

`diagnostics` reports candidate, duplicate, FK-rejection, and limit-filter counts,
plus `has_continuous_families`. Every returned candidate passes position and
orientation tolerances of `2e-8` metres/radians. The tolerances allow floating-point
arithmetic at branch mergers; the measured generic-pose errors are much smaller.

A completed solve exits **0**, including an unreachable pose or a filter that
leaves `solutions: []`. Invalid input produces `{"error":"message"}` on stdout,
a message on stderr, and exit **1**. Check the exit status and the solutions array.

## Paden–Kahan decomposition

The implementation in [`src/subproblems.rs`](src/subproblems.rs) solves SP1, SP2,
and SP3 directly with geometric circle intersections. It uses no numerical IK
seeds, optimization, polynomial root searches, or joint-limit restrictions while
constructing branches. The subproblem definitions follow the
[Paden–Kahan geometric approach and IK-Geo formulation](https://github.com/rpiRobotics/ik-geo);
see also the [IK-Geo paper](https://arxiv.org/abs/2211.05737). The formulas here
are implemented specifically for this URDF.

Let `R(k,t)` be a right-hand rotation about unit axis `k`, and let `ex, ey, ez`
be Cartesian basis vectors. This code uses the SP2 **product convention**:

```text
SP1: R(k,t) p = q
SP2: R(k1,t1) R(k2,t2) p = q
SP3: ||R(k,t) p - q|| = d
```

The robot geometry reduces to shoulder height `h = 0.34`, upper-arm and forearm
lengths `a = b = 0.4`, and wrist-to-target distance `d = 0.126` for link ee
or `d = 0.081` for link 7. The URDF's two 0.0607 m wrist-origin shifts lie along
joint axes and cancel when constructing the common wrist centre.

First partition the target into position and wrist orientation:

```text
w = p_target - d R_target ez - h ez
```

**Position IK:** solve SP3

```text
||R(-ey,q4) b ez - (-a ez)|| = ||w||
```

to obtain the two elbow roots. Equivalently,
`cos(q4) = (||w||^2 - a^2 - b^2)/(2ab)`. The code evaluates a factored
half-angle expression to retain accuracy near folded elbows. For each elbow,
construct

```text
v = a ez + R(ez,q3) R(-ey,q4) b ez
  = [-b sin(q4) cos(q3), -b sin(q4) sin(q3), a+b cos(q4)]
```

and solve SP2 `R(ez,q1) R(ey,q2) v = w`. The intermediate circle intersection
has the constraints `c.y = v.y`, `c.z = w.z`, and `||c|| = ||v||`, hence
`c.x = +/-sqrt(v.x^2 + v.z^2 - w.z^2)`. SP1 on each circle recovers q1/q2.
There are at most four position branches; a position can be unreachable at
the requested q3 even if it lies inside the unconstrained 0.8 m reach sphere.

**Wrist IK:** build `R4` from the first four native joint transforms, then
`W = R4^T R_target`. The constant native URDF rotations are

```text
C = [-1 0 0; 0 0 1; 0 1 0]
D = [ 1 0 0; 0 0 -1; 0 1 0]
W = C Rz(q5) D Rz(q6) C Rz(q7)
```

Applying this equation to `ez` eliminates q7. Solve SP2
`R(ez,q5) R(-ey,q6) ez = C^T W ez` for the two wrist branches, then solve
SP1 for q7 from the remaining rotation of `ex`. Multiplying the two elbow,
two shoulder, and two wrist roots gives up to **eight** isolated solutions.

`E+/-` denotes the elbow sign, `S+/-` the two shoulder circle intersections,
and `W+/-` the wrist sign. These labels identify algebraic branches for fixed q3.

## Singular poses and continuous families

At an exact branch merger, fewer distinct isolated configurations exist. At a
base-axis, fully folded arm, or straight/folded wrist singularity, some joint
angles become free and the solution set can be infinite. A finite JSON array
cannot list an infinite family. The solver returns verified representatives
with `free_parameters`, rather than claiming those are all members of a family.

Default free-angle representatives use zero. Optional JSON lets you choose
other members in radians:

```json
"singular_samples": {"q1": 0.7, "q2": -0.4, "q5": 0.8}
```

These samples affect only angles identified as free. `free_parameters` gives
the joint name and whether the wrist must be recomputed. For free q1 or q2,
change the corresponding `singular_samples` value and solve the same target
again; the wrist is recalculated automatically. For a free wrist q5, the
complete family follows the reported `q7_slope`:

```text
q5(new) = q5(representative) + t
q7(new) = q7(representative) - cos(q6) t     (modulo 2*pi)
```

Near a merger, values within a few floating-point ulps are treated as the merged
case, and every representative still has to pass FK verification. A limit filter
applies to the returned **representatives** of a continuous family. If a selected
representative fails limits, another family member may still be useful; choose
different singular samples to inspect it. Unfiltered solves retain the family
metadata. No finite benchmark proves completeness at every floating-point
singular boundary.

## Python example

[`../iiwa7_ik/iiwa7-ik-linux-x86_64/example_script.py`](../iiwa7_ik/iiwa7-ik-linux-x86_64/example_script.py)
calls the binary through `subprocess` and JSON, like the ABB GoFa example.
The default pose returns eight branches, or four with `--useful-only`, so the
example demonstrates the filter. The reusable function is:

```python
from example_script import EXAMPLE_POSE, solve_ik

report = solve_ik(EXAMPLE_POSE, q3=0.5, useful_only=False)
for solution in report["solutions"]:
    print(solution["q"], solution["within_limits"])
```

Use `--pose PX PY PZ QW QX QY QZ --q3 ANGLE` for a custom CLI example,
or `--binary PATH` to use another build. Python only launches the Rust executable;
all IK computations remain in Rust.

## Build, test, and generate FK targets

From the repository root, with Rust/Cargo installed:

```sh
cargo build --release --locked --manifest-path lectures_main/assets/iiwa7_ik_full/Cargo.toml
cargo test --release --locked --manifest-path lectures_main/assets/iiwa7_ik_full/Cargo.toml
python3 lectures_main/assets/iiwa7_ik_full/scripts/verify_urdf.py
node lectures_main/assets/iiwa7_ik_full/scripts/verify_branches.cjs
```

The source has no native numerical-library dependencies. `Cargo.lock` pins the
tested dependencies; this package was built with Rust 1.95.0. On another OS/CPU,
build on that platform; Windows produces `target/release/iiwa7-ik.exe`. This
distribution includes native Linux and Windows x86_64 binaries in `../iiwa7_ik`.

To cross-compile the supplied Windows build from Linux, install MinGW-w64,
add the Rust target, and run:

```sh
rustup target add x86_64-pc-windows-gnu
bash lectures_main/assets/iiwa7_ik_full/scripts/build_windows.sh
```

The output is `target/x86_64-pc-windows-gnu/release/iiwa7-ik.exe` inside this
source project. The script links compiler and threading support statically.
`IIWA7_MINGW_ROOT` can select an extracted local MinGW installation.

Windows validation runs the native executable under Wine, compares its branches
with Linux, checks the shared Python caller, and repeats both million-pose
accuracy benchmarks. Reproduce with:

```sh
python3 lectures_main/assets/iiwa7_ik_full/scripts/verify_windows.py --benchmark-samples 1000000
```

See [`windows_validation_results.json`](windows_validation_results.json) for
Windows accuracy results. The Windows executable has been validated under Wine
on Linux; it has not been run on a physical Windows machine. Timings under Wine
do not measure performance on a native Windows installation.

The `fk` command produces JSON directly accepted by `solve-pose`:

```sh
echo '{"q":[0.4,-0.7,0.5,1.8,-0.9,0.8,0.3]}' | ./iiwa7-ik fk > target.json
./iiwa7-ik solve-pose --input target.json
```

For Rust callers, `fk(&[f64; 7], Frame)` returns a `Pose`; `solve(Pose, q3,
SolveOptions)` returns `Result<SolveReport, String>`. `Pose::from_array` accepts
the same position/quaternion format as the CLI. Set `SolveOptions.respect_limits`
to enable filtering.

## Million-configuration accuracy benchmark

Two serial release-build benchmarks were run on **2026-10-14**, each with
**1,000,000 independently sampled configurations** and SplitMix64 seed 654:
one covers all seven angles in `[-pi, pi)`, and one uses native hard-limit ranges.
Both solve **without** limit filtering. The in-limit input distribution is
selected separately from the solver's useful-only output filter.

For each configuration, the benchmark builds its target using an independent
FK implementation of the literal URDF `Rz(yaw) Ry(pitch) Rx(roll)` origin chain,
round-trips its quaternion, fixes the original q3, solves IK, and checks:

- All eight generic branches were returned.
- The original seed was recovered modulo `2*pi`, with maximum joint difference below `2e-6` rad.
- Every returned solution matches the target under the independent FK evaluator within `2e-8` metres/radians.
- The supplied q3 was preserved exactly.

The independently parsed XML check in `scripts/verify_urdf.py` also confirms that
the benchmark's literal origins and limits match the actual supplied file and
checks both target frames. `scripts/verify_branches.cjs` compares all branches
against the existing JavaScript IK formulation.

Measured on an Intel Core i7-1360P, one worker, Rust 1.95.0:

| Metric | Unrestricted inputs | Within-limit inputs |
| --- | ---: | ---: |
| Solved poses / recovered seeds | 1,000,000 / 1,000,000 | 1,000,000 / 1,000,000 |
| Verified returned configurations | 8,000,000 | 8,000,000 |
| Missed poses / seeds / invalid outputs | 0 / 0 / 0 | 0 / 0 / 0 |
| Maximum position error | 7.794e-16 m | 9.017e-16 m |
| Maximum rotation error | 1.180e-15 rad | 1.196e-15 rad |
| Maximum seed joint difference | 1.163e-7 rad | 3.575e-9 rad |
| Maximum q3 difference | 0 | 0 |
| Timed IK total | 6.572 s | 6.376 s |
| Mean IK time per pose | 6.572 microseconds | 6.376 microseconds |

The timer includes candidate construction, deduplication, and the solver's FK
verification; it excludes RNG, target FK, independent output checks, and JSON
I/O. It measures serial batches, not process-launch latency. Timings depend on
hardware and system load. Raw reports and provenance are in
[`benchmark_results.json`](benchmark_results.json).

To reproduce from the executable directory:

```sh
./iiwa7-ik benchmark --samples 1000000 --seed 654 > benchmark-unrestricted.json
./iiwa7-ik benchmark --samples 1000000 --seed 654 --within-limits > benchmark-limited.json
```

The benchmark exits 1 if an accuracy, seed-recovery, or eight-branch-count check
fails. It keeps bounded batches in memory; the default sample count is one million.
