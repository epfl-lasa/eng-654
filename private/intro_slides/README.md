# ENG-654 course introduction

Twelve slides for Aude Billard to introduce the course and tutors.

Open `intro.html` in Chrome, Firefox or Edge. The CSS and images are local, so no web server or internet connection is needed.

## Presenting

- Right / left arrows, Page Down / Page Up or the small bottom-right controls move between slides.
- `F` toggles fullscreen. `N` opens Slide suggestions.
- Slide suggestions provide brief context, video descriptions and timings, and connections between slides. Research and media references remain in the Sources section below and in the tutor slides’ source panels.
- Videos use native controls. Playing one pauses the others by default. On slide 2, **Play all** starts all four clips together from the beginning and allows them to keep playing simultaneously. Leaving a slide pauses its videos and restores individual playback.
- Slide suggestions appear over the projected slide. Closing the panel restores the slide alone; the panel shares the presentation display.

## Slide order

1. Welcome and course title
2. Motion planning is everywhere: four successful real-world motion videos
3. When motion fails: Jaco
4. From industry to everyday life
5. Global analysis and guarantees
6. Part I: serial robots and motion planning
7. Durgesh Salunkhe introduction
8. Part II: parallel robot design, kinematics and interaction
9. Redundancy for intuitive interaction: parallel robot demonstration
10. Part II outline: how to design parallel robots
11. Arda Yigit introduction
12. Course objectives and handover

Slide 6 introduces the PUMA 560 robot with 6 joints, the KUKA iiwa lightweight robot with 7 joints, and custom robots with 3 and 6 joints, in that order. The slides use joint counts and plain-language explanations instead of robot shorthand. Technical course topics retain their names where useful, with short explanations.

## Media assets

The opening slide uses `assets/images/aude_profile.jpg` alongside the course title.

Slide 7 integrates `instructor_intro.html` with `durgesh_profile.jpg`, CNRS and EPFL logos, experience, publications and course message. Slide 11 uses the matching `arda_intro.html` with `arda_profile.jpg`, Laval University and CNRS research experience, ten years in robot design and model-based control, T-RO and JMR, and the course survival-kit message. Their shared layout and embedded fonts are preserved. The six videos are configured below. Slide 4 uses `kinova.webp`, `ur5_hri.png` and `abb_crb.jpeg` from left to right in three image strips.

The tutor slides embed the supplied `ijrr_logo.png`, `laval_logo.png`, `tro_logo.png` and `jmr_logo.jpg` from `assets/images`. Their `data-logo-source` attributes record the source files; replacing a logo file requires updating its embedded data URL too. Full journal names appear below IJRR and T-RO in grey.

Copy files into the package and edit `js/media-config.js` if your filenames differ:

| Item | Default path |
| --- | --- |
| Top-left motion video | `assets/videos/robot_painting.mkv` |
| Top-right motion video | `assets/videos/yaskawa_manipulation.MOV` |
| Bottom-left motion video | `assets/videos/yaskawa_tv_manipulation_2.MOV` |
| Bottom-right motion video | `assets/videos/humanoid_motion.webm` |
| Jaco failure video | `assets/videos/jaco_failure.mp4` |
| Parallel robot interaction excerpt | `assets/videos/arda_parallel_robot_interaction.mp4` |
| Durgesh photograph | `assets/images/durgesh_profile.jpg` |
| Arda photograph | `assets/images/arda_profile.jpg` |

The tutor slides are in `assets/tutors/instructor_intro.html` and `assets/tutors/arda_intro.html`. Their portraits embed the original JPEG bytes as data URLs so they display inside sandboxed iframes when opening `intro.html` locally. Each portrait's `data-profile-source` attribute records the original file; changing that file requires updating the embedded image too. Arrow keys and Slide suggestions shortcuts continue to work when either has focus. An alternative tutor slide can replace all of slide 7 or 11. Set `durgeshSlide` or `ardaSlide` in `js/media-config.js` to the path of a PNG/JPG/WebP image or self-contained HTML file. For a PowerPoint slide, export that slide as a PNG first. An image replacement is shown without cropping. A self-contained HTML replacement runs in a sandboxed iframe. The outer deck's bottom-right arrows also remain available.

Slide 9 joins 00:57–01:14 and 01:29–02:00 of `arda_parallel_robot.mp4`, in that order. The original is preserved. The combined H.264 MP4 keeps the source resolution and frame rate, has no audio because the source is silent, and runs approximately 48 seconds (47.981 seconds at the source frame boundaries).

## Editing

The three CSS files from the source ZIP are included unchanged. `css/intro.css` adds presentation-specific layouts. Slide text and slide suggestions are in `intro.html`. `js/intro.js` controls presentation navigation and media. There are no 3D views, animations or interactive exercises in this introduction.

The course objectives distinguish continuous verification from sample checks and model-based feasibility from physical safety.

## Sources

Course content follows the uploaded slide-by-slide plan, updated with the requested second part on parallel robots. Durgesh’s slide and its source references come from the uploaded `instructor_intro.html`. Arda’s biography, research topics, experience and publication venues were supplied by the instructor, as were both updated portraits. The Jaco failure cause is not asserted without supporting data.

- Steven M. LaValle, *Planning Algorithms*, [Chapter 4: The Configuration Space](https://lavalle.pl/planning/ch4.pdf).
- J.-P. Merlet, [*Parallel Robots*](https://link.springer.com/content/pdf/10.1007/1-4020-4133-0.pdf).
- J.-P. Merlet, [Parallel robot performance analysis](https://www-sop.inria.fr/coprin/PDF/merlet_braunschweig98.pdf).
- J.-P. Merlet, [Trajectory verification of parallel manipulators in the workspace](https://www-sop.inria.fr/coprin/PDF/merlet_ieee94.pdf).
- EPFL, [Parallel robotics and the Delta robot](https://www.epfl.ch/labs/rehassist/research/industrial-robotics/parallel-robotics/).
- EPFL, [Reymond Clavel receives the Joseph F. Engelberger Robotics Award](https://actu.epfl.ch/news/reymond-clavel-receives-joseph-f-engelberger-robot/).
- Reymond Clavel, [Delta robot patent US4976582A](https://patents.google.com/patent/US4976582A/en).
- Jaco failure video: [Achille Verheye on Medium](https://achille0.medium.com/under-the-radar-cuspidal-robots-7091eca01271).
- Robot painting video: [YouTube](https://www.youtube.com/watch?v=d4G7Ul62ibE).
- Humanoid motion video: [YouTube](https://www.youtube.com/watch?v=rTej9ym9UQc).
- Kinova image: [Kinova’s Jaco page](https://www.kinovarobotics.com/fr/produit/jaco).
- ABB CRB image: [IEEE Xplore](https://ieeexplore.ieee.org/stamp/stamp.jsp?arnumber=10711794).
- UR5 interaction image: [Springer article](https://link.springer.com/article/10.1007/s00170-020-05363-1).
- Other robot photographs and the parallel interaction video are supplied course assets.
