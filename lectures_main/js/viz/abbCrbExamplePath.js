/** The Lecture 07 XY example keeps the existing 16-real-IK starting point.
 * Its 30 cm diameter fits inside the central ±0.23 m map. Counts depend on
 * height and orientation: they are always recomputed by the active lab.
 */
export const CRB_EXAMPLE_LOOP = Object.freeze({
  center: Object.freeze([.042, .069]),
  radius: .15,
  startPoint: Object.freeze([0, -.075]),
  startAngle: Math.atan2(-.144, -.042),
  samples: 121,
  bounds: Object.freeze([-.108, .192, -.081, .219]),
});

/** Counterclockwise circle, p(0) = p(1) exactly. Positions are metres. */
export function crbExampleLoopPoint(progress) {
  const s = Math.max(0, Math.min(1, progress));
  if (s === 0 || s === 1) return [...CRB_EXAMPLE_LOOP.startPoint];
  const angle = CRB_EXAMPLE_LOOP.startAngle + 2 * Math.PI * s;
  return CRB_EXAMPLE_LOOP.center.map((v, i) =>
    v + CRB_EXAMPLE_LOOP.radius * (i === 0 ? Math.cos(angle) : Math.sin(angle)));
}

/** Compatible with the lab's editable-polyline path and 3 mm pose sampling. */
export function createCrbExampleLoop() {
  return {
    ...CRB_EXAMPLE_LOOP,
    center: [...CRB_EXAMPLE_LOOP.center],
    startPoint: [...CRB_EXAMPLE_LOOP.startPoint],
    bounds: [...CRB_EXAMPLE_LOOP.bounds],
    vertices: Array.from({ length: CRB_EXAMPLE_LOOP.samples },
      (_, i) => crbExampleLoopPoint(i / (CRB_EXAMPLE_LOOP.samples - 1))),
  };
}
