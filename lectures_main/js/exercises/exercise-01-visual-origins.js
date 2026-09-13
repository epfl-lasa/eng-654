/* Original visual xyz/rpy from the supplied kuka_iiwa7_misaligned.urdf. */
(function (root) {
  'use strict';

  const initialVisualOrigins = Object.freeze([
    [0, 0, 0, 0, 0, 0],
    [0, 0, -0.0075, 1.5707963267948966, 0, 0],
    [0, 0, 0, 0, -1.5707963267948966, 0],
    [0, 0, 0.026, 0, 0, 1.5707963267948966],
    [0, 0, 0, 0, 0, 0],
    [0, 0, 0.026, -1.5707963267948966, 0, 0],
    [0, 0, 0, 0, 0, 0],
    [0, 0, 0.0005, 0, 0, -1.5707963267948966]
  ].map(Object.freeze));

  const api = Object.freeze({ initialVisualOrigins });
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.Exercise01VisualOrigins = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
