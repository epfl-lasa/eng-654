# ENG-654 HTML Lecture Template

This repository is a reusable HTML/CSS/JS lecture-deck template for **Kinematics-Grounded Motion Planning for Robots**.

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
css/                       separated style layers
js/deck/                   slide navigation, reveal logic, scroll/deck modes
js/viz/                    importable visualization modules
assets/images/             photos and raster figures
assets/svg/                reusable SVG figures
assets/videos/             mp4/gif assets
assets/models/             URDF, mesh, robot assets
vendor/three/              local Three.js path used by import map
templates/                 copy-paste slide patterns
docs/                      authoring notes and uploaded lecture plan
```

## Main conventions

- Theme: EPFL red, black, white; secondary scientific palette in `css/base.css`.
- Typography: responsive `clamp(...)` variables in `:root`.
- 2D SVG convention: mathematics is **y-up**; SVG drawing uses `svgY(y) = -y`.
- 3D Three.js convention: robotics world is **z-up**. The root group is rotated by `Rx(-Math.PI/2)` in `js/viz/threeUtils.js`.
- Step reveals: add `.reveal-children` or `data-reveal="children"` to a flex/grid container.
- Toggle modes: press `T` or the navbar button to switch between deck side-scroll and infinite scroll.
- Fullscreen: press `F`.

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
- Bottom bar buttons: previous, next, scroll/deck toggle, fullscreen



## Slide numbers

Slide numbers are injected automatically by `js/deck/nav-runtime.js` as a subtle overlay in the bottom-left corner. To hide the number on a particular slide, add `data-slide-number="off"` to that `<section class="slide">`.
