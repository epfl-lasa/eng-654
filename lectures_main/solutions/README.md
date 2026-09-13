# Exercise 01: responses, feedback, then answers

1. Share `../exercises/exercise_01.html`. Students fill in the response fields and download their JSON file.
2. Later, share `exercise_01.html` from this folder. Students upload that JSON, see correct entries and mistakes, revise values, and check again. This page has no answer-key download or embedded answer file.
3. Finally, share `exercise_01_answers.json` separately. This reference file is complete and matches the current worksheet.

The 19-slide worksheet starts with the supplied URDF in the instructor-provided simulator, with STL meshes unloaded. Students inspect link frames and joint axes, derive the world-space product-of-exponentials (PoE) model and then the standard-D–H model, implement both, and compare their forward kinematics with the simulator at five poses. They then load the STL meshes, repair their placement through visual-origin offsets, and repeat the comparisons to confirm that joint kinematics are unchanged.

There are 248 verifiable responses: 42 PoE screw components, 16 entries in the PoE home matrix, 28 standard-D–H entries, 32 entries across the fixed base/tool homogeneous matrices, 80 entries across five forward-kinematics matrices, 48 visual-origin corrections, and two yes/no choices. The five configurations are Home, Bent, Bent back, Side reach and Wrist turn, with the same joint angles in the slides and Module 1. The home and forward-kinematics matrices describe `world` to `iiwa_link_ee`; enter metres and at least six decimal places for non-exact entries.

Feedback checks the PoE and D–H models separately over 26 configurations and also shows explicit checks for each model at the five named poses. The PoE model must use the supplied joint signs and world-space screws. The D–H table and fixed transforms are checked together, allowing equivalent frame conventions. Home and fixed transforms must be rigid homogeneous matrices. Each submitted forward-kinematics matrix is checked independently against the URDF, using an absolute tolerance of 0.0001 per entry. Visual corrections are componentwise differences: repaired XYZ/RPY minus the original values in `kuka_iiwa7_misaligned.urdf`. For example, changing roll from `pi/2` to `0` requires `-pi/2`; unchanged components require `0`. The checker adds the corrections to the supplied origins before comparing the repaired mesh placement with the clean model, accepting equivalent repaired Euler rotations. Visual corrections do not change joint kinematics.

Final submissions comprise runnable `fk_poe(q)` and `fk_dh(q)` code, screw-axis and D–H frame derivations, a five-pose comparison report, the downloaded response JSON, and the repaired URDF. The report includes simulator and model transforms, position/orientation residuals, and the unchanged results after visual repair.

Response files use schema version 5. Screw components use keys such as `poe.1.wx` and `poe.1.vx`; the home matrix uses `poe.M.1.1`. Visual fields such as `visual.1.roll` store corrections, and fixed-transform keys such as `base.1.1` and `tool.3.4` store matrix entries. Version 1–4 files preserve previous work and leave all 58 new PoE fields blank. Version 1–3 files convert nonblank absolute visual-origin entries into corrections by subtracting the supplied origin component. Blank entries remain blank. Version 1 and 2 files also convert valid base/tool XYZ and RPY values into matrix entries. Missing angles leave the rotation block blank; invalid angles produce an import error and keep the current responses. Retired written responses are ignored in version 1 files.

## Release setting

Set `stage` in `../exercise_01_release.json` before a normal website deployment:

| Stage | Published material |
| --- | --- |
| `exercise` | Student worksheet and Module 1; no feedback slides or answer file. |
| `feedback` | Adds the feedback slides and checking scripts; the answer JSON remains excluded. |
| `answers` | Adds the final JSON file for separate sharing. |

The checked-in default is `exercise`. No link from the worksheet reveals the later pages, and the feedback page never offers the full answer file. This controls website publishing, not access to repository source. A browser-based checker necessarily contains the calculations used to assess a response.

Use a local web server for Module 1. The worksheet and feedback page also support local file opening for answer downloads and uploads.

From `lectures_main/`, run the response-format and URDF/FK checks with:

```bash
node --test tests/*.test.js
```

From the repository root, test release staging with:

```bash
python3 -B -m unittest discover -s .github/scripts -p 'test_stage_site.py'
```
