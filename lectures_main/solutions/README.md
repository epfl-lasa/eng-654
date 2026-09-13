# Exercise 01: responses, feedback, then answers

1. Share `../exercises/exercise_01.html`. Students fill in the response fields, use **Check answers** on each response slide, and download their JSON file. The checks fill correct entries light green and wrong entries light red, showing only whether each answer is right or wrong.
2. Later, share `exercise_01.html` from this folder for detailed feedback. Students upload that JSON, inspect the explanations and model checks, revise values, and check again. This page has no answer-key download or embedded answer file.
3. Finally, share `exercise_01_answers.json` separately. This reference file is complete and matches the current worksheet.

The 19-slide worksheet starts with the supplied URDF in the instructor-provided simulator, with STL meshes unloaded. Students inspect link frames and joint axes, derive the world-space product-of-exponentials (PoE) model and then the standard-D–H model, implement both, and compare their forward kinematics with the simulator at five poses. They then load the STL meshes, repair their placement through visual-origin offsets, and repeat the comparisons to confirm that joint kinematics are unchanged.

There are 248 verifiable responses: 42 PoE screw components, 16 entries in the PoE home matrix, 28 standard-D–H entries, 32 entries across the fixed base/tool homogeneous matrices, 80 entries across five forward-kinematics matrices, 48 visual-origin corrections, and two yes/no choices. The five configurations are Home, Bent, Bent back, Side reach and Mixed wrist turn. The mixed pose uses `[pi/6, pi/4, -pi/6, -pi/2, pi/6, pi/4, pi/2]`; set these joint angles explicitly in the simulator. The home and forward-kinematics matrices describe `world` to `iiwa_link_ee`; enter metres and at least six decimal places for non-exact entries.

The student worksheet and detailed feedback page use the same checker in `../js/exercises/exercise-01-checker.js`. The detailed feedback page checks the PoE and D–H models separately over 26 configurations and also shows explicit checks for each model at the five named poses. The PoE model must use the supplied joint signs and world-space screws. The D–H table and fixed transforms are checked together, allowing equivalent frame conventions. Home and fixed transforms must be rigid homogeneous matrices. Each submitted forward-kinematics matrix is checked independently against the URDF, using an absolute tolerance of 0.0001 per entry. Visual corrections are componentwise differences: repaired XYZ/RPY minus the original values in `kuka_iiwa7_misaligned.urdf`. For example, changing roll from `pi/2` to `0` requires `-pi/2`; unchanged components require `0`. The checker adds the corrections to the supplied origins before comparing the repaired mesh placement with the clean model, accepting equivalent repaired Euler rotations. Visual corrections do not change joint kinematics.

Final submissions comprise runnable `fk_poe(q)` and `fk_dh(q)` code, screw-axis and D–H frame derivations, a five-pose comparison report, the downloaded response JSON, and the repaired URDF. The report includes simulator and model transforms, position/orientation residuals, and the unchanged results after visual repair.

Response files use schema version 5. Screw components use keys such as `poe.1.wx` and `poe.1.vx`; the home matrix uses `poe.M.1.1`. Visual fields such as `visual.1.roll` store corrections, and fixed-transform keys such as `base.1.1` and `tool.3.4` store matrix entries. Version 1–4 files leave all 58 new PoE fields blank and clear the 16 `fk.wrist_turn` entries because the fifth configuration changed. Other pose responses are retained. Version 1–3 files convert nonblank absolute visual-origin entries into corrections by subtracting the supplied origin component. Blank entries remain blank. Version 1 and 2 files also convert valid base/tool XYZ and RPY values into matrix entries. Missing angles leave the rotation block blank; invalid angles produce an import error and keep the current responses. Retired written responses are ignored in version 1 files.

## Release setting

Set `stage` in `../exercise_01_release.json` before a normal website deployment:

| Stage | Published material |
| --- | --- |
| `exercise` | Student worksheet with per-slide right/wrong checks and Module 1; no detailed feedback slides or answer file. |
| `feedback` | Adds the detailed feedback slides and their interface script; the answer JSON remains excluded. |
| `answers` | Adds the final JSON file for separate sharing. |

The checked-in default is `exercise`. The shared checker and the student's per-slide controls are published in every stage. No link from the worksheet reveals the later pages, and the feedback page never offers the full answer file. This controls website publishing, not access to repository source. A browser-based checker necessarily contains the calculations used to assess a response.

Use a local web server for Module 1. The worksheet and feedback page also support local file opening for answer downloads and uploads.

From `lectures_main/`, run the response-format and URDF/FK checks with:

```bash
node --test tests/*.test.js
```

From the repository root, test release staging with:

```bash
python3 -B -m unittest discover -s .github/scripts -p 'test_stage_site.py'
```

## Exercise 02: fixed-redundancy iiwa 7 inverse kinematics

Share `../exercises/exercise_02.html` for the guided tutorial. Students fix original joint 3, switch between the automatically updated D-H and PoE models, identify the wrist, choose a valid position-IK method, assemble their own equations, and complete the wrist and joint-limit questions. Per-step checks report only correct or incorrect and use light green or light red. The reduced positioning coordinates are `(theta1, theta2, theta3) = (q1, q2, q4)`; original `q3 = phi` remains fixed.

`exercise_02.html` in this folder is a separate, 19-slide worked solution. It develops the exact grouped D-H and reduced PoE chains, identifies why Paden–Kahan is the appropriate tutorial choice, derives the elbow distance equation as subproblem 3 (PK3), explains both signed `E` values, back-substitutes with Cramer’s rule, and derives the Z–Y–Z wrist extraction. Step 05 of the student tutorial leaves the geometry and method choice for students to identify; the explanation is available after the correct choice. The saved answer value `method: "geometric"` is retained for compatibility and refers to the Paden–Kahan option. The worked slides include the complete eight-branch numerical example and its joint-limit classification. They do not need to fetch the answer JSON to display the worked solutions.

`exercise_02_answers.json` is the complete reference response file, using schema version 1 and the same flat answer keys as the tutorial. Its `fixedQ3` and `targetQ` reproduce the reference task; its `answers` can be imported into the tutorial for instructor verification. The separate `reference` object records the URDF SHA-256, model conventions, updated D-H and PoE parameters, target transform, intermediate equations, four arm roots, eight complete joint vectors, residuals, and joint-limit violations. All calculation angles in JSON are radians. The solution table uses degrees only for readability.

The reference fixes `q3 = pi/6` and generates the tool target with FK at `[0.35, 0.55, pi/6, -1.1, 0.7, 0.8, -0.45]`. All eight mathematical branches reproduce that pose, and six satisfy the limited-joint `assets/models/iiwa7/iiwa7.urdf`. The two rejected branches exceed joint 7’s lower bound. Eight isolated solutions is a property of this regular target at the fixed redundancy coordinate, not a universal branch count for every target or for the unrestricted seven-joint robot.

The existing site-staging rule excludes the entire `solutions` directory and releases only the explicit Exercise 01 allowlist. Both Exercise 02 reference files therefore remain excluded in every current release stage, including Exercise 01’s `answers` stage. Share the Exercise 02 worked slides and answer JSON separately when appropriate; changing `exercise_01_release.json` does not publish them. There are no student-page links to these instructor files. As with Exercise 01, browser-based checking contains the mathematical rules needed to evaluate answers; this separation controls publishing of the worked reference files, not inspection of the checker’s source.
