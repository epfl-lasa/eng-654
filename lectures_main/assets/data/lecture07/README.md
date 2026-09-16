# Lecture 07 — ABB GoFa CRB15000-5/0.95 data

All distances are metres and all joint coordinates are radians in the supplied
URDF's native coordinates. The target is `tool0`, including its fixed rotation
from `link_6`. No industrial IRB 4600 geometry is used for this collaborative robot.

## Default XY full slice and Central detail

`crb-slice-xy-diverse.json` is the default full XY slice. Its fixed pose metadata
is z = 0.5 m and Rz(0) Ry(−0.28) Rx(1.47), with the exact rotation matrix stored
in `orientation`.

`crb-slice-xy-detail.json` uses that same height and exact orientation on a new
400 × 250 vertex grid with x,y ∈ [−0.23,0.23] m. Its **100,000 full-pose IK
queries are independently evaluated**; counts are not cropped or interpolated
from the full slice. Rows increase with y, and x varies fastest. `counts`
enumerates distinct geometric branches modulo 2π; `limitCounts` counts those
with a representative inside every native joint limit.

| Number of IKs | Central detail poses |
| --- | ---: |
| 8 | 86,098 |
| 10 | 6,670 |
| 12 | 2,993 |
| 14 | 2,250 |
| 16 | 1,989 |

The native batch took 8.98 seconds on this machine. The independent JavaScript
polynomial solver recovered all 47 unresolved native queries, leaving **zero
unresolved cells**. It also verified geometric and legal counts at 371 grid
poses covering every count category and 129 distributed sample positions.
All 3,992 independently checked branches passed native URDF FK and distinctness
checks; maximum position and rotation errors were below 6 × 10⁻¹³ m and
7 × 10⁻¹² rad. Verification indexes and generation provenance are stored in
`generation`; representative samples are in `representativePoints`.

Regenerate and verify without changing the full slice:

```sh
# Start the service in another terminal if it is not already running.
bash lectures_main/tools/serve-crb-ik.sh
node lectures_main/tools/build-lecture07-crb-detail.cjs
```

The generator writes the detail asset only after all recovery, count, FK,
joint-limit, and independent-sample checks pass. Set `CRBIK_NATIVE_URL` to use
a different local native-service address.

## XZ atlas and live-calculation backup

`crb-slice-xz.json` contains **100,000 target poses** at the vertices of a
400 × 250 grid: x ∈ [−1.1,1.1], z ∈ [−0.75,1.4], fixed y = 0.2, and fixed
tool orientation Rz(0.3) Ry(1.1) Rx(0.4). Rows increase with z; x varies fastest.
The explicit `plane`, `fixedAxis`, `y`, `nx`, and `nz` fields prevent confusing
the horizontal and vertical plot coordinates with physical world coordinates.
`orientationEulerZYX` stores yaw, pitch, roll in radians.

All-real IK counts vary across this slice even before limits are imposed:

| Number of IKs | Grid poses |
| --- | ---: |
| 0 | 39,777 |
| 2 | 135 |
| 4 | 12,551 |
| 6 | 362 |
| 8 | 47,157 |
| 10 | 18 |

The supplied Rust solver generated the batch in 6.36 seconds on this machine,
using adaptive root precision at 105 poses and leaving **zero unresolved poses**.
Every returned configuration passed native tool0 FK validation; the largest
position/rotation residual was below 5.6 × 10⁻¹³. A separate browser-polynomial
check agrees at 134 deterministic sample cells, including every count category
and the ten-IK region. These cell indexes and verification errors are recorded
in `generation.independentBrowserChecks`. The legacy XY atlas remains below as
data provenance; the default XY view uses the full and detail artifacts above.

The default **0.8 m diameter circle** has centre (x,z) = (0.3,0.55) and starts
at (0.7,0.55). All eight starting IKs respect limits. With the same 3 mm task
sampling used by the live lab, six continuations reach joint limits and
**IKs 6 and 7 complete all 961 samples**, returning to their initial native
joint configurations. Their minimum limit margins are 8.30° and 8.52°.
Every accepted sample keeps y and the complete tool orientation fixed to the
solver tolerance, with position and rotation errors below 2 × 10⁻⁹.

The supplied URDF originally restricted axis 6 to ±180°. ABB's GoFa 5
movement table specifies **±270°**; the URDF, browser and Rust limit tables
are corrected consistently. See the
[ABB GoFa datasheet, 9AKK107991A8564](https://library.e.abb.com/public/24de2251a42d4f9badda0232508ff242/9AKK107991A8564_en_F_GoFa%E2%84%A2%20CRB%2015000%20datasheet.pdf).
Geometric IK counts are modulo 2π: one legal representative is counted for
each branch, including q3 below −π where required. Additional legal axis-6
windings are not counted again. The 100,000 count values are unchanged by
this correction because every q6 branch already has a representative in ±180°.

**IK 3 now passes the old false q6 stop** near s = 0.199. It reaches the
actual q2 = −180° limit at s = 0.6611586712, at tool position
(0.08814960, 0.2, 0.21074277) m. Both adjacent sampled poses have eight real
IKs and six with legal representatives. The pose-wise solver can exchange
q2 near −180° for an equivalent angle near +180°; continuous motion cannot
make that 360° jump. This is why constant workspace counts do not guarantee
continuous legal tracking. `stop` records the refined joint-limit event,
last safe and attempted angles, and its normalized Cartesian path distance.

The two successful trajectories have sampled minimum |det J| of 0.01972
and 0.01435. Applying the termwise determinant derivative bound separately
to each linear joint segment establishes |det J| > 0.01611 and 0.01019,
respectively, between animation samples as well. These results are recorded
in `demonstrationResults`; the vertex path and sampling recipe are stored in
`demonstrationPath` and `demonstrationVerification`. As with the other examples,
these are kinematic checks; no collision model is applied.

Regenerate and verify from the repository root:

```sh
cargo run --release --offline --manifest-path lectures_main/assets/abb_irb_ik/Cargo.toml --example lecture07_atlas_xz > lectures_main/assets/data/lecture07/crb-slice-xz.json
node lectures_main/tools/finish-lecture07-crb-xz-atlas.mjs
node --test lectures_main/tests/lecture-07-crb-xz.test.cjs
```

## Legacy XY atlas

`crb-slice.json` contains **100,000 target poses**, one at every vertex of a
400 × 250 grid with x,y ∈ [−0.95,0.95], z = 0.2, and fixed tool orientation
Rz(0.3) Ry(1.1) Rx(0.4). Rows increase with y; x varies fastest. `counts` records
all returned mathematical IK branches; `limitCounts` records branches with a
representative inside every physical joint limit. In particular, joint 3 has a
valid interval below −π; checking only the wrapped interval would lose branches.

The supplied Rust solver solved the batch in about 11 seconds on this machine.
Five queries remained unresolved even after a 512-bit reference retry. The
browser port of the same polynomial/back-substitution recovered these five with
an independent real-root isolator, with maximum FK errors below 3 × 10⁻¹⁵.
These recoveries are individually recorded in `generation.browserPolynomialFallback`.
Unresolved queries use **−1**, never zero; this artifact has zero unresolved queries.

This is numerical algebraic enumeration with geometric verification, not a
mathematical completeness certificate for singular continuous solution families.
The browser solver recovered all 7,628 stored reference branches at all 1,000
supplied test poses, with no missing or additional configurations.

The default example is a 0.5 m diameter circle with centre (0.4,0.2), starting
at (0.65,0.2). There are eight legal starting IKs. Seven local continuations
reach different mechanical joint limits; one follows the entire fixed-orientation
path. The selected branch and failure index are recorded in `demonstrationResults`.

Regenerate from the repository root:

```sh
cargo run --release --offline --manifest-path lectures_main/assets/abb_irb_ik/Cargo.toml --example lecture07_atlas > lectures_main/assets/data/lecture07/crb-slice.json
node --experimental-default-type=module lectures_main/tools/finish-lecture07-crb-atlas.mjs
```

## Nonsingular change of solution

`crb-nscs.json` has 401 native joint configurations and their full FK poses. The
path closes the **complete tool pose**, with endpoint position and rotation errors
around 10⁻¹⁵, while the distinct joint endpoints differ by 6.58 rad in Euclidean
joint distance. Its visible task-space extent is approximately
0.662 × 0.646 × 0.644 m. Tool orientation varies along this particular loop.

The generator examined 1,000 FK targets and 7,216 same-sign, joint-limit-feasible
IK pairs. The chosen joint-space segment stays inside the convex joint-limit box,
with a minimum distance to any stop of 0.02038 rad. Every one of its 401 animation
poses was re-solved by IK and the path branch recovered; maximum FK verification
error was below 2.3 × 10⁻¹³.

The geometric Jacobian uses linear velocity first. Its determinant is a finite
trigonometric polynomial in q₂…q₅. A termwise product-rule bound gives
|d(det J)/dt| ≤ 3.848941 for this joint segment, t ∈ [0,1]. On 10,000 intervals,
the sampled minimum |det J| is 0.00774536. Subtracting L/(2 × 10,000), plus a
10⁻¹¹ allowance for arithmetic roundoff, establishes **|det J| > 0.00755291
throughout the segment**, including all points between animation samples.
The exact polynomial identity is independently checked against the URDF Jacobian.

This demonstrates kinematic nonsingularity and joint-limit feasibility; collision
checking is outside this example's scope.

Regenerate:

```sh
node --experimental-default-type=module lectures_main/tools/build-lecture07-crb-nscs.mjs
```

## Paper example and independently generated MoveL paths

`crb-paper-paths.json` supports the paper comparison panel. Source:
Alexander J. Elias and John T. Wen, *Path Planning and Optimization for Cuspidal
6R Manipulators*, arXiv:2501.18505v2 (2025),
[paper](https://arxiv.org/abs/2501.18505),
[author code](https://github.com/rpiRobotics/cuspidal-path-planning).
The inspected source commit is `0dbb7d240f325e230fff175293350f995d3e2acb`.

The **published NSCS** uses Eq. (6)/Fig. 6. Its printed joint endpoints are
retained verbatim in the data. The final endpoint is refined by at most
0.00004657 rad to remove the paper's four-decimal rounding; FK then closes
the full pose to about 10⁻¹⁶. A determinant derivative bound establishes
|det J| > 0.00522377 throughout the joint segment. As the paper explicitly
states, this example exceeds joint limits. It is separate from the legal
searched connection in `crb-nscs.json` and is never labeled a feasible
hardware motion.

The **two MoveL examples use independently generated coordinates** and the
same fixed-orientation straight-line path type as Fig. 3. They do not reproduce
that figure's particular endpoints or its six-path result. The public
[`example_moveL.m`](https://github.com/rpiRobotics/cuspidal-path-planning/blob/0dbb7d240f325e230fff175293350f995d3e2acb/%2Bgofa/plotting/example_moveL.m)
randomizes endpoint poses and notes that the saved pose still needs converting
to code; its GoFa MAT file is absent from that commit.

Both new lines start with eight legal IKs and end at a pose with ten IKs.
The 0.811 m line has eight mathematical continuations, five of which respect
the corrected manufacturer joint limits. The 1.073 m line has four mathematical continuations
and no complete legal continuation. Its other four starting branches approach
folds. At each fold, separate IK queries immediately before and after the
boundary verify a two-root disappearance; the tracked root is recovered
before the boundary and absent after it. These checks are stored per track.

The data contains 201 full IK layers per line, with extra layers near folds.
Continuation adapts its step size: a coarse fixed step can falsely reject a
regular path near a small determinant. Every accepted segment has a positive
bound on |det J|, using the same trigonometric derivative bound as the legal
NSCS. All adaptive FK samples match the desired full poses to better than
10⁻¹¹. Joint angles are never wrapped across native mechanical stops. The
physical limit check uses the ABB GoFa 5 datasheet's ±270° joint 6 range.
The uploaded URDF, Rust constants and browser model have been corrected from
±180°; the previous three-completion result used that overly narrow limit.
This is numerical path analysis; collisions and motion dynamics are not checked.

Regenerate and verify:

```sh
node --experimental-default-type=module lectures_main/tools/build-lecture07-crb-paper.mjs
node --test lectures_main/tests/lecture-07-crb-paper.test.cjs
```

## Browser IK implementation and checks

`abbCrbCoefficients.js` translates the supplied Rust coefficient expressions to
160-bit fixed-point BigInt arithmetic. The real-root solver uses derivative
critical points in two compact half-angle charts, followed by the Rust solver's
geometric back-substitution and independent FK validation. Arbitrary clicked
points therefore enumerate algebraic IK candidates rather than relying on a
finite set of numerical starting guesses. Difficult or degenerate cases are
reported separately. The root UI runs these calculations in a worker.

```sh
python3 lectures_main/tools/generate-crb-browser-coefficients.py
node --test lectures_main/tests/lecture-07-crb.test.cjs
```

The browser regression checks mesh loading, the count map, point selection,
actual mouse-drawn paths, shared vertices, all-start comparison, and animation
reset/replay in a disposable browser context. Start a local lecture server and
Chromium with remote debugging enabled, then run:

```sh
CDP_URL=http://127.0.0.1:9256 LECTURE_URL=http://127.0.0.1:8052/lectures/lecture_07.html node lectures_main/tests/lecture-07-browser.cjs
```
