// Periodic joint-space A*: every connector, grid edge and shortcut is sampled.
// This is a numerical clearance check, not a proof between arbitrary samples.
const TAU = 2 * Math.PI;
const wrap = (x) => ((x + Math.PI) % TAU + TAU) % TAU - Math.PI;
const distance = (a, b) => Math.hypot(wrap(b[0] - a[0]), wrap(b[1] - a[1]));

/** Search one regular aspect of a two-angle torus.
 * Angles are radians. Returned samples are continuously unwrapped; the last
 * sample is equivalent to goal modulo 2π. edgeValidator receives (a,b,samples).
 * Failure means no route at this resolution/clearance, not global infeasibility.
 */
export function searchAspectPath(start, goal, {
  determinant, clearance = .02, resolution = 120, maxStep = .01, edgeValidator
} = {}) {
  const fail = (reason, expanded = 0) => ({ path: [], found: false, reason, minAbsDet: 0, expanded });
  if (!Array.isArray(start) || !Array.isArray(goal) || start.length !== 2 || goal.length !== 2 ||
      ![...start, ...goal].every(Number.isFinite) || typeof determinant !== 'function' ||
      !Number.isFinite(clearance) || clearance < 0 || !Number.isFinite(maxStep) || maxStep <= 0 ||
      !Number.isInteger(resolution) || resolution < 8 || resolution > 512) return fail('Invalid planner inputs.');
  const first = determinant(start), last = determinant(goal), sign = Math.sign(first);
  if (![first, last].every(Number.isFinite) || Math.abs(first) <= clearance || Math.abs(last) <= clearance)
    return fail('An endpoint is singular or inside the requested clearance.');
  if (Math.sign(last) !== sign) return fail('Opposite determinant signs: every continuous path crosses a singularity.');
  const safeValue = (q) => { const d = determinant(q); return Number.isFinite(d) && sign * d > clearance; };
  function edge(a, b) {
    const delta = b.map((v, i) => wrap(v - a[i]));
    const count = Math.max(1, Math.ceil(Math.hypot(...delta) / maxStep));
    const samples = Array.from({ length: count + 1 }, (_, i) => a.map((v, k) => v + delta[k] * i / count));
    return samples.every(safeValue) && (!edgeValidator || edgeValidator(a, b, samples)) ? samples : null;
  }
  function finish(waypoints, expanded) {
    const path = [start.slice()];
    for (let i = 1; i < waypoints.length; i += 1) {
      const samples = edge(path.at(-1), waypoints[i]);
      if (!samples) return fail('The final interpolated path failed its clearance check.', expanded);
      path.push(...samples.slice(1));
    }
    return { path, found: true, reason: 'Numerically checked joint-space path.',
      minAbsDet: Math.min(...path.map((q) => Math.abs(determinant(q)))), expanded };
  }
  if (edge(start, goal)) return finish([start, goal], 0);

  const n = resolution, spacing = TAU / n, count = n * n;
  const coord = (id) => [-Math.PI + spacing * Math.floor(id / n), -Math.PI + spacing * (id % n)];
  const idOf = (i, j) => ((i + n) % n) * n + (j + n) % n;
  const known = new Int8Array(count), closed = new Uint8Array(count);
  const cost = new Float64Array(count).fill(Infinity), parent = new Int32Array(count).fill(-1);
  const valid = (id) => { if (!known[id]) known[id] = safeValue(coord(id)) ? 1 : -1; return known[id] > 0; };
  function connectors(q, toGoal) {
    const cell = q.map((v) => Math.round((wrap(v) + Math.PI) / spacing) % n), result = new Map();
    for (let i = -2; i <= 2; i += 1) for (let j = -2; j <= 2; j += 1) {
      const id = idOf(cell[0] + i, cell[1] + j), point = coord(id);
      if (valid(id) && (toGoal ? edge(point, q) : edge(q, point))) result.set(id, distance(point, q));
    }
    return result;
  }
  const starts = connectors(start, false), goals = connectors(goal, true);
  if (!starts.size || !goals.size) return fail('An endpoint cannot connect to this grid; reduce clearance or refine the grid.');
  const open = new MinHeap();
  for (const [id, g] of starts) { cost[id] = g; open.push({ id, g, f: g + distance(coord(id), goal) }); }
  const offsets = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  let found = -1, expanded = 0;
  while (open.length) {
    const current = open.pop(), id = current.id;
    if (closed[id] || current.g > cost[id] + 1e-12) continue;
    closed[id] = 1; expanded += 1;
    if (goals.has(id)) { found = id; break; }
    const i = Math.floor(id / n), j = id % n, q = coord(id);
    for (const [di, dj] of offsets) {
      const next = idOf(i + di, j + dj);
      if (closed[next] || !valid(next)) continue;
      const nextQ = coord(next), g = cost[id] + spacing * Math.hypot(di, dj);
      if (g >= cost[next] || !edge(q, nextQ)) continue;
      cost[next] = g; parent[next] = id;
      open.push({ id: next, g, f: g + distance(nextQ, goal) });
    }
  }
  if (found < 0) return fail('No connected route was found at this grid resolution and clearance.', expanded);
  const route = [];
  for (let id = found; id >= 0; id = parent[id]) route.push(coord(id));
  route.reverse(); route.unshift(start); route.push(goal);
  // Each shortcut is checked along its whole interpolation, including sign.
  const reduced = [route[0]];
  for (let i = 0; i < route.length - 1;) {
    let next = i + 1;
    for (let j = route.length - 1; j > i + 1; j -= 1) if (edge(route[i], route[j])) { next = j; break; }
    reduced.push(route[next]); i = next;
  }
  return finish(reduced, expanded);
}

class MinHeap {
  constructor() { this.items = []; }
  get length() { return this.items.length; }
  push(item) {
    const a = this.items; a.push(item); let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p].f <= item.f) break; a[i] = a[p]; i = p; }
    a[i] = item;
  }
  pop() {
    const a = this.items, top = a[0], tail = a.pop(); if (!a.length) return top;
    let i = 0;
    while (2 * i + 1 < a.length) {
      let j = 2 * i + 1; if (j + 1 < a.length && a[j + 1].f < a[j].f) j += 1;
      if (a[j].f >= tail.f) break; a[i] = a[j]; i = j;
    }
    a[i] = tail; return top;
  }
}
