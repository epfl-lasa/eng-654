# Exercise 01: responses, feedback, then answers

1. Share `../exercises/exercise_01.html`. Students fill in the response fields and download their JSON file.
2. Later, share `exercise_01.html` from this folder. Students upload that JSON, see correct entries and mistakes, revise values, and check again. This page has no answer-key download or embedded answer file.
3. Finally, share `exercise_01_answers.json` separately. This reference file is complete and matches the current worksheet.

There are 170 verifiable responses: 28 standard-D–H entries, 12 fixed base/tool transform values, 48 final visual-origin values, two yes/no choices, and 80 entries across five homogeneous matrices. Written responses and self-reported residuals have been removed. The five configurations are Home, Bent, Bent back, Side reach and Wrist turn, with the same joint angles in the slides and Module 1. Matrices describe `world` to `iiwa_link_ee`; enter metres and at least six decimal places for non-exact entries.

The D–H table and fixed transforms are checked together over 26 configurations, allowing equivalent frame conventions. Each submitted matrix is checked independently against the URDF, using an absolute tolerance of 0.0001 per entry. Visual origins are checked against the supplied mesh coordinates. The intentionally wrong visual origins do not change joint kinematics.

Response files use schema version 2. Earlier version 1 files still load their D–H and visual values; retired written responses are ignored, and the new matrix/choice fields start blank.

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
