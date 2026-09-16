# ENG-654 Lecture and Exercise Decks

This repository contains the lecture and exercise decks for **Kinematics-Grounded Motion Planning for Robots**. The eight lectures form one sequence: robot modelling → inverse kinematics → singularities and global IK structure → branch-aware and redundant motion planning.

## Run locally

```bash
chmod +x start_server.sh
./start_server.sh
```

Open: <http://localhost:8000>

Do not open the lecture files with `file://` when using JavaScript modules or Three.js.

## Repository structure

```text
lectures/                  eight lecture documents
exercises/                 four assignment briefing decks
solutions/                 feedback slides and answer files, released in stages
css/                       separated style layers
js/deck/                   slide navigation, reveal logic, scroll/deck modes
js/exercises/              response downloads/imports and shared answer checks
js/viz/                    importable visualization modules
assets/images/             photos and raster figures
assets/svg/                reusable SVG figures
assets/videos/             mp4/gif assets
assets/models/             URDF, mesh, robot assets
vendor/three/              local Three.js path used by import map
templates/                 copy-paste slide patterns
docs/                      authoring notes and uploaded lecture plan
```

## Exercise 01 responses

Open `exercises/exercise_01.html` for the 19-slide workflow: load only the supplied URDF in the instructor-provided simulator, derive PoE and standard-D–H models, implement both, and compare their forward kinematics at five named poses. Load the STL meshes last and repair their placement through visual-origin offsets, then confirm that the tool poses are unchanged. The worksheet has 248 responses: 42 screw components, 16 PoE home-matrix entries, 28 D–H entries, 32 fixed-transform entries, 80 pose-matrix entries, 48 visual corrections, and two choices. **Download responses** saves schema version 5 JSON; **Load saved responses** restores partial work, leaving new PoE fields and the revised Mixed wrist turn matrix blank when importing older files. Submit both FK implementations, their derivations, the five-pose comparison report, response JSON, and repaired URDF. Set the five joint configurations as specified in the worksheet. Module 1 starts with `kuka_iiwa7_misaligned.urdf` and its deliberate visual-origin errors.

Each slide with response fields has a **Check answers** button. It checks that slide and fills correct entries light green and wrong entries light red, without showing solutions or detailed explanations. Students can revise their entries and check again, and still download or reload partial work.

The instructor shares this worksheet with its per-slide checks first, the detailed feedback slides later, and the final answer file separately. Publishing follows the `stage` value in `exercise_01_release.json`: `exercise`, `feedback`, then `answers`. The default is `exercise`; the shared checker and student controls are published at every stage.

## Exercise 02 tutorial

Open `exercises/exercise_02.html` for the 13-slide iiwa 7 IK tutorial. Students fix original q₃, inspect the automatically updated D-H or PoE model, identify the home wrist point and choose Paden–Kahan after inspecting the robot geometry. Step 05 gives no geometric hints; the PK3 distance construction is introduced only after the correct choice. Correct answers unlock the next step. A wrong method choice links to the condition on Lecture 02 slide 30 in a new tab.

Students build eleven expressions using draggable symbol blocks or typed formulas, then answer the wrist rotation questions. The solver executes their validated expressions and checks each branch against the full URDF-equivalent FK. The reference target has eight solutions, six within the URDF limits at q₃ = π/6. Students can generate another target through FK and classify its branches; singular cases explicitly report merged branches or family representatives. **Download responses** and **Load responses** preserve the equations, fixed angle, target and checks in schema version 1 JSON.

Instructor materials are `solutions/exercise_02.html` and `solutions/exercise_02_answers.json`; the existing site staging excludes both. The student tutorial never requests the answer file. The robot views load the actual iiwa 7 URDF and eight STL meshes, with adjustable opacity, extended joint axes, URDF frames and labels. Run the course’s local server to load these views; Three.js and all model assets are stored in the repository, so no internet connection is needed.

Run the model, expression and tutorial checks from the repository root with `node --test lectures_main/tests/exercise-02-*.test.*`.

The optional end-to-end browser check is `node lectures_main/tests/browser/exercise-02-flow.cjs`. It expects a local Chromium browser with remote debugging on port 9256 and a repository-root preview server on port 8050; override these using `EXERCISE02_CDP_PORT` and `EXERCISE02_PREVIEW_URL`. It clears only Exercise 02 responses in that test browser, exercises the gates and file import, and writes screenshots to `/tmp`.

The STL viewer check is `node lectures_main/tests/browser/exercise-02-stl.cjs`, using the same browser with WebGL enabled. Its default preview URL is `http://127.0.0.1:8052/exercises/exercise_02.html` (serve `lectures_main` on port 8052), also overridable with `EXERCISE02_PREVIEW_URL`. It verifies actual mesh and frame placement, joint axes, display controls, camera interaction, FK/IK motion, and mobile layout.

## Main conventions

- Theme: EPFL red, black, white; secondary scientific palette in `css/base.css`.
- Typography: responsive `clamp(...)` variables in `:root`.
- 2D SVG convention: mathematics is **y-up**; SVG drawing uses `svgY(y) = -y`.
- 3D Three.js convention: robotics world is **z-up**. The root group is rotated by `Rx(-Math.PI/2)` in `js/viz/threeUtils.js`.
- Step reveals: add `.reveal-children` or `data-reveal="children"` to a flex/grid container.
- Toggle modes: press `T` to switch between deck side-scroll and infinite scroll.
- Fullscreen: press `F`.
- 3D labels: use the **Labels** control inside each Three.js scene.
- STL visibility: use the **STL opacity** slider; geometric annotations remain visible while the mesh fades.

## Three.js note

The repository is wired for local Three.js through the import map in each lecture file:

```html
"three": "../vendor/three/build/three.module.js",
"three/addons/": "../vendor/three/examples/jsm/"
```

A small local fallback is included so the template can be opened immediately. To replace it with official Three.js files when you have internet:

```bash
./tools/fetch_three.sh
```

This downloads `three.module.js` and `OrbitControls.js` into `vendor/three/`.

## Creating a new slide

Every slide is one `<section class="slide">...</section>` inside `<main id="deck">`.

```html
<section class="slide">
  <h2 class="slide-title">My slide title</h2>
  <div class="layout-40-60">
    <div>
      <p class="lead">Main concept.</p>
    </div>
    <div class="visual-container">
      <img class="technical-figure" src="../assets/svg/example.svg" alt="Example">
    </div>
  </div>
</section>
```

## Navigation controls

Navigation is handled by `js/deck/nav-runtime.js`, a plain non-module script. This is deliberate: the lecture controls continue working even if a Three.js or other visualization import fails.

- Right arrow, PageDown, Space: next reveal / next slide
- Left arrow, PageUp: previous reveal / previous slide
- Home / End: first / last slide
- T: toggle deck mode and scroll mode
- F: fullscreen
- Bottom bar buttons: previous and next



## Slide numbers

Slide numbers are injected automatically by `js/deck/nav-runtime.js` as a subtle overlay in the bottom-left corner. To hide the number on a particular slide, add `data-slide-number="off"` to that `<section class="slide">`.


## Lecture PDF snapshots

The lecture library links to `assets/pdf/lecture_01.pdf` through `lecture_08.pdf`. Each PDF has one page per slide, with all text fragments revealed, rendered robot scenes and plots, and slide-title bookmarks. Videos use their final frame; path demonstrations show their computed endpoint.

To regenerate the snapshots, serve `lectures_main` over HTTP, start Chromium with a remote-debugging port, and run from the repository root:

```bash
CDP_URL=http://127.0.0.1:9256 \
LECTURE_BASE_URL=http://127.0.0.1:8052 \
node lectures_main/tools/export-lecture-pdfs.cjs
```

The exporter requires Node 22+ and Python 3 with `pypdf` and `Pillow`. It uses a disposable browser context, leaves existing tabs and saved lecture settings untouched, and captures at 1440 × 900 with a device scale of 2. The PDFs preserve selectable slide text. Canvas slides use the exact browser snapshot as their visible layer, retaining the native text below it for selection and search. Print-only layout changes stay in that context. Temporary per-slide PDFs, canvas-slide screenshots, and a capture manifest are retained in the reported review directory. Set `PDF_SCREENSHOTS=1` to also retain screenshots of text-only slides.

Set `LECTURES=07,08` to regenerate selected lectures. `PDF_WORK_DIR` chooses the review directory, and `PDF_OUTPUT_DIR` overrides the PDF destination. `PDF_RESUME=1` reuses completed pages in that review directory; use it only while the lecture sources are unchanged. `SLIDES=1,22` is available for reviewing individual pages; use a separate `PDF_OUTPUT_DIR` when making partial exports. To replace selected pages of an existing complete export, combine `PDF_RESUME=1 PDF_RECAPTURE=1` with `SLIDES`; the merge retains the other pages in slide order.
