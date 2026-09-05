# ENG-654 project handouts

Seventeen projects for groups of two. Project numbers 3, 9, and 11 were removed; the agreed numbering is retained.

Each `.tex` file is standalone. The accompanying PDFs are compiled from those sources.

| Project | Description | PDF |
| --- | --- | --- |
| [1](project_1.tex) | Identifying and Tracking the Eight IK Branches of the PUMA 560 | [PDF](project_1.pdf) |
| [2](project_2.tex) | Geometry and Cuspidality in Orthogonal 3R Robots | [PDF](project_2.pdf) |
| [4](project_4.tex) | Joint Limits and IK Distribution in Orthogonal 3R Robots | [PDF](project_4.pdf) |
| [5](project_5.tex) | From Positioning-Arm Geometry to 6R Cuspidality | [PDF](project_5.pdf) |
| [6](project_6.tex) | Offset-Wrist IK through the FANUC CRX Case Study | [PDF](project_6.pdf) |
| [7](project_7.tex) | Signed IK Classification of PUMA 560 and UR5 | [PDF](project_7.pdf) |
| [8](project_8.tex) | Redundancy and Feasible IK Families in 7R Robots | [PDF](project_8.pdf) |
| [10](project_10.tex) | Branch-Dependent Planning with the PUMA Positioning Arm | [PDF](project_10.pdf) |
| [12](project_12.tex) | Nonsingular Posture Change on custom_3R | [PDF](project_12.pdf) |
| [13](project_13.tex) | Repeated Contour Execution on custom_3R | [PDF](project_13.pdf) |
| [14](project_14.tex) | Contour Placement for PUMA 560 | [PDF](project_14.pdf) |
| [15](project_15.tex) | Lifting a custom_3R Posture-Change Loop to custom_6R | [PDF](project_15.pdf) |
| [16](project_16.tex) | Orientation-Dependent Connectivity on custom_6R | [PDF](project_16.pdf) |
| [17](project_17.tex) | Global IK-Map Planning for KUKA iiwa 7 | [PDF](project_17.pdf) |
| [18](project_18.tex) | Local versus Global Joint-Limit Avoidance on iiwa 7 | [PDF](project_18.pdf) |
| [19](project_19.tex) | Apparent Barriers in iiwa 7 Redundancy Charts | [PDF](project_19.pdf) |
| [20](project_20.tex) | Repeatable Closed-Path Motion on iiwa 7 | [PDF](project_20.pdf) |

Compile a handout from this directory using:

```bash
pdflatex -interaction=nonstopmode -halt-on-error project_2.tex
pdflatex -interaction=nonstopmode -halt-on-error project_2.tex
```

Use the corresponding number for another project. Two runs resolve PDF navigation links.

The handouts identify additional instructor-supplied IK implementations, parameter sets, and path seeds; the project folder contains the descriptions, not those future starter packages.
