# Local contour plotting modules

Lecture 05 uses D3's SVG contour geometry. These pinned ES modules were downloaded
from jsDelivr; module imports were changed to local paths and unavailable source
map references removed. No CDN access is needed at runtime.

- `d3-contour.js`: https://cdn.jsdelivr.net/npm/d3-contour@4.0.2/+esm
- `d3-array.js`: https://cdn.jsdelivr.net/npm/d3-array@3.2.1/+esm
- `internmap.js`: https://cdn.jsdelivr.net/npm/internmap@2.0.3/+esm

The corresponding ISC license files are included in this directory.

D3 supplies filled contours; the lecture overlays analytical zero curves to
preserve the exact crossing branches of the intersecting-axis example.
See https://d3js.org/d3-contour/contour for the sampled-grid coordinate convention.
