# KUKA iiwa 7 Windows IK executable

Analytical Rust IK for the native `models/iiwa7/iiwa7.urdf` geometry. Supply a
target pose and **q3, the third native joint angle in radians**. Fixing q3 gives
a wrist-partitioned 6R chain. The executable returns all isolated real solutions
modulo whole turns, up to eight, and verifies each with FK.

This is a **native Windows x64 console executable**, intended for Windows
10/11 x64. It runs with Windows system DLLs and statically linked compiler
support; no MinGW installation, Rust, WSL, or external URDF is needed at
runtime. Python 3 is optional and used only for the example caller.

## Example calls

Open PowerShell in this directory:

```powershell
.\iiwa7-ik.exe solve-pose --input pose.json
.\iiwa7-ik.exe solve-pose --input pose.json --useful-only
python example_script.py
python example_script.py --useful-only
```

Or send a single JSON object on stdin followed by EOF:

```powershell
echo '{"pose":[-0.3664404775042923,-0.4762924875117099,0.34911314922081393,-0.5127319024430761,-0.4812309966767833,0.5445534784622869,-0.4571479335501771],"q3":0.5}' | .\iiwa7-ik.exe solve-pose
```

`pose.json` is the FK of `[0.4, -0.7, 0.5, 1.8, -0.9, 0.8, 0.3]` radians.
`example-output.json` contains its complete unfiltered result.
The example returns eight solutions by default and four with `--useful-only`.

## Input

`pose` is `[px, py, pz, qw, qx, qy, qz]`. Position is in **metres**, relative
to `iiwa_link_0`/`world`. The quaternion maps target-frame vectors into the base
frame, uses **w, x, y, z** order, and is automatically normalized. All values
must be finite and the quaternion must be nonzero.

`q3` is required in **radians** and preserved exactly in every solution. The
other six output angles use `[-pi, pi)`. Equivalent whole-turn configurations
are represented once. An out-of-limit supplied q3 stays out of limits even if
a whole-turn-equivalent q3 could fit.

Optional `frame` is `"iiwa_link_ee"` (default, alias `"tool0"`) or
`"iiwa_link_7"` (alias `"link7"`). Link ee includes the fixed 0.045 m
translation from link 7. The solver uses the standard aligned URDF, including
its two 0.0607 m wrist-origin shifts; it does not support the misaligned model.

## Output and useful-only flag

The JSON output contains `solutions` and `diagnostics`. Each solution has:

- `q`: seven joint angles `[q1, q2, q3, q4, q5, q6, q7]` in radians.
- `within_limits`: whether all seven joint coordinates satisfy native hard limits.
- `position_error` and `rotation_error`: verified FK errors in metres and radians.
- `branch` and `merged_branches`: elbow/shoulder/wrist branch labels.
- `free_parameters`: singular-family parameters, empty for isolated configurations.

**Default: all IK branches, including those outside joint limits.** Toggle
**`--useful-only`**, or set **`"respect_limits": true`** in JSON, to retain only
joint-limit-valid configurations. The CLI flag enables filtering regardless of
the JSON field. Omit the flag and use `respect_limits: false` to return all.
The Python function exposes this as `useful_only=True`.

Hard limits are +/-170 degrees for q1/q3/q5, +/-120 degrees for q2/q4/q6,
and +/-175 degrees for q7, with `1e-12` rad of checking tolerance. Angles are
never clamped. “Useful” checks joint positions; collisions and motion paths
are not evaluated. Candidate FK tolerances are `2e-8` metres/radians.

Exit **0** means a completed solve, including `solutions: []` for an unreachable
pose or an empty filtered result. Invalid input exits **1**, with
`{"error":"message"}` on stdout and a message on stderr. Check both exit
status and the solutions array. Unknown JSON fields are rejected.
