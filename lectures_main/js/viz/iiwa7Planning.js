import { fk, jacobian, inverseFixedQ3, IIWA_LIMITS, IIWA_BRANCH_LABELS } from './iiwa7Kinematics.js';

// All coordinates are native URDF joint coordinates. A joint that crosses its
// physical stop is never made admissible by wrapping or clipping its angle.
const PI = Math.PI, DEG = PI / 180, BRANCHES = 8;
export const CHARACTERISTIC_LENGTH = .4;
export const MIN_SINGULAR_VALUE = 1e-4;
export const NULL_SPACE_COSTS = Object.freeze([
  { id: 'none', label: 'None · minimum-norm velocity' },
  { id: 'centering', label: 'Joint centering' },
  { id: 'limits', label: 'Joint-limit barrier' },
  { id: 'posture', label: 'Stay near the starting posture' }
]);
export const ANALYTICAL_COSTS = Object.freeze([
  { id: 'travel', label: 'Least joint travel' },
  { id: 'limits', label: 'Joint-limit margin' }
]);

// A supplied geometric path: its four corners are not a time law. The robot
// pauses at corners in a physical stop-and-go implementation; no velocity or
// acceleration feasibility is inferred from these kinematic samples.
export const DEFAULT_RECTANGLE = Object.freeze({
  center: [.45, 0, .60], width: .22, height: .28,
  R: [[-1, 0, 0], [0, 1, 0], [0, 0, -1]]
});
export const DEFAULT_START = Object.freeze({ angle: -30 * DEG, branch: 4 });

export function rectangleSpec(spec = DEFAULT_RECTANGLE) {
  const center = (spec.center || DEFAULT_RECTANGLE.center).map(Number);
  const width = Number(spec.width ?? DEFAULT_RECTANGLE.width);
  const height = Number(spec.height ?? DEFAULT_RECTANGLE.height);
  const R = (spec.R || DEFAULT_RECTANGLE.R).map(row => row.slice());
  if (center.length !== 3 || center.some(x => !Number.isFinite(x)) ||
      !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0)
    throw new Error('The rectangle needs a finite centre and positive side lengths.');
  return { center, width, height, R };
}

export function rectanglePose(progress, input = DEFAULT_RECTANGLE) {
  const spec = input, { center, width, height } = spec;
  const s = Math.max(0, Math.min(1, progress));
  const edge = Math.min(3, Math.floor(s * 4)), t = s === 1 ? 1 : s * 4 - edge;
  const corners = [[-.5, -.5], [.5, -.5], [.5, .5], [-.5, .5], [-.5, -.5]];
  const a = corners[edge], b = corners[edge + 1];
  return { s, edge, p: [center[0] + width * (a[0] + t * (b[0] - a[0])),
    center[1] + height * (a[1] + t * (b[1] - a[1])), center[2]], R: spec.R };
}

export function rectangleSamples(input = DEFAULT_RECTANGLE, nProgress = 81) {
  const spec = rectangleSpec(input);
  // Include every corner exactly. This prevents a coarse interpolation from
  // replacing a rectangle corner with a diagonal shortcut.
  const steps = 4 * Math.max(1, Math.round((nProgress - 1) / 4));
  return Array.from({ length: steps + 1 }, (_, k) => rectanglePose(k / steps, spec));
}

/** A supplied planar path. Existing rectangle inputs keep their exact shape
 * and corner sampling; circles use their actual curved pose at every check. */
export function pathSpec(input = DEFAULT_RECTANGLE) {
  if (input.kind !== 'circle') return rectangleSpec(input);
  const center = (input.center || []).map(Number), radius = Number(input.radius);
  const startAngle = Number(input.startAngle ?? -Math.PI / 2);
  const R = (input.R || DEFAULT_RECTANGLE.R).map(row => row.slice());
  if (center.length !== 3 || center.some(x => !Number.isFinite(x)) ||
      !Number.isFinite(radius) || radius <= 0 || !Number.isFinite(startAngle))
    throw new Error('The circle needs a finite centre, positive radius and finite starting angle.');
  return { kind: 'circle', center, radius, startAngle, R };
}

export function pathPose(progress, input = DEFAULT_RECTANGLE) {
  if (input.kind !== 'circle') return rectanglePose(progress, input);
  const s = Math.max(0, Math.min(1, progress));
  const angle = input.startAngle + (s === 1 ? 0 : 2 * Math.PI * s);
  return { s, p: [input.center[0] + input.radius * Math.cos(angle),
    input.center[1] + input.radius * Math.sin(angle), input.center[2]], R: input.R };
}

export function pathSamples(input = DEFAULT_RECTANGLE, nProgress = 81) {
  if (input.kind !== 'circle') return rectangleSamples(input, nProgress);
  const spec = pathSpec(input), steps = Math.max(4, Math.round(nProgress - 1));
  return Array.from({ length: steps + 1 }, (_, k) => pathPose(k / steps, spec));
}

export function jointDistance(a, b) { return Math.hypot(...a.map((v, i) => v - b[i])); }
const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const transpose = A => A[0].map((_, j) => A.map(row => row[j]));
const matvec = (A, v) => A.map(row => dot(row, v));
const gram = A => A.map(a => A.map(b => dot(a, b)));
const yieldTask = () => new Promise(resolve => setTimeout(resolve, 0));

export function solveLinear(A, rhs) {
  const M = A.map((row, i) => [...row, rhs[i]]), n = rhs.length;
  for (let c = 0; c < n; c++) {
    let pivot = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[pivot][c])) pivot = r;
    if (Math.abs(M[pivot][c]) < 1e-15) return null;
    [M[c], M[pivot]] = [M[pivot], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      for (let j = c; j <= n; j++) M[r][j] -= f * M[c][j];
    }
  }
  const x = Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let sum = M[r][n];
    for (let j = r + 1; j < n; j++) sum -= M[r][j] * x[j];
    x[r] = sum / M[r][r];
  }
  return x.every(Number.isFinite) ? x : null;
}

function symmetricEigenvalues(input) {
  const A = input.map(row => row.slice()), n = A.length;
  for (let iteration = 0; iteration < 100; iteration++) {
    let p = 0, q = 1, max = Math.abs(A[p][q]);
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++)
      if (Math.abs(A[i][j]) > max) { p = i; q = j; max = Math.abs(A[i][j]); }
    if (max < 1e-13) break;
    const tau = (A[q][q] - A[p][p]) / (2 * A[p][q]);
    const t = (tau >= 0 ? 1 : -1) / (Math.abs(tau) + Math.sqrt(1 + tau * tau));
    const c = 1 / Math.sqrt(1 + t * t), s = t * c;
    const apq = A[p][q];
    A[p][p] -= t * apq; A[q][q] += t * apq;
    A[p][q] = A[q][p] = 0;
    for (let r = 0; r < n; r++) if (r !== p && r !== q) {
      const arp = A[r][p], arq = A[r][q];
      A[r][p] = A[p][r] = c * arp - s * arq;
      A[r][q] = A[q][r] = s * arp + c * arq;
    }
  }
  return A.map((row, i) => row[i]).sort((a, b) => a - b);
}

export function configurationMetrics(q) {
  const J = jacobian(q), scaled = J.map((row, r) => row.map(x => x * (r < 3 ? 1 : CHARACTERISTIC_LENGTH)));
  const eigenvalues = symmetricEigenvalues(gram(scaled));
  const sigmaMin = Math.sqrt(Math.max(0, eigenvalues[0]));
  const limitMargin = Math.min(...q.map((x, j) => IIWA_LIMITS[j] - Math.abs(x)));
  const manipulability = Math.sqrt(eigenvalues.reduce((product, v) => product * Math.max(0, v), 1));
  const valid = limitMargin >= -1e-10 && sigmaMin > MIN_SINGULAR_VALUE;
  return { sigmaMin, limitMargin, manipulability, valid,
    reason: limitMargin < -1e-10 ? 'joint-limit' : sigmaMin <= MIN_SINGULAR_VALUE ? 'full-jacobian-singularity' : null };
}

export function poseDifference(current, target) {
  const E = target.R.map(row => current.R.map(other => dot(row, other)));
  const cross = [E[2][1] - E[1][2], E[0][2] - E[2][0], E[1][0] - E[0][1]];
  const sine = Math.hypot(...cross) / 2, cosine = clamp((E[0][0] + E[1][1] + E[2][2] - 1) / 2, -1, 1);
  const angle = Math.atan2(sine, cosine);
  let omega;
  if (sine > 1e-10) omega = cross.map(v => v * angle / (2 * sine));
  else if (cosine > 0) omega = cross.map(v => v / 2);
  else {
    // Stable logarithm at a half-turn; ordinary continuation never needs a
    // half-turn correction, but a user-supplied starting pose can be opposite.
    const k = [E[0][0], E[1][1], E[2][2]].indexOf(Math.max(E[0][0], E[1][1], E[2][2]));
    omega = [0, 0, 0]; omega[k] = Math.sqrt(Math.max(0, (E[k][k] + 1) / 2));
    for (let j = 0; j < 3; j++) if (j !== k) omega[j] = (E[j][k] + E[k][j]) / (4 * Math.max(omega[k], 1e-12));
    const norm = Math.hypot(...omega); omega = omega.map(x => angle * x / norm);
  }
  return [...target.p.map((v, i) => v - current.p[i]), ...omega];
}

export function nullSpaceCost(q, cost = 'centering', reference = q) {
  if (cost === 'none' || cost === 'travel') return 0;
  if (cost === 'posture') return .5 * q.reduce((sum, v, i) => sum + (v - reference[i]) ** 2, 0);
  if (cost === 'centering') return .5 * q.reduce((sum, v, i) => sum + (v / IIWA_LIMITS[i]) ** 2, 0);
  if (cost === 'limits') return -q.reduce((sum, v, i) => sum + Math.log(Math.max(1e-12, 1 - (v / IIWA_LIMITS[i]) ** 2)), 0);
  if (cost === 'manipulability') return -Math.log(Math.max(1e-20,
    configurationMetrics(q).manipulability / CHARACTERISTIC_LENGTH ** 6));
  throw new Error(`Unknown null-space cost: ${cost}`);
}

export function costGradient(q, cost = 'centering', reference = q) {
  if (cost === 'none' || cost === 'travel') return q.map(() => 0);
  if (cost === 'posture') return q.map((v, i) => v - reference[i]);
  if (cost === 'centering') return q.map((v, i) => v / IIWA_LIMITS[i] ** 2);
  if (cost === 'limits') return q.map((v, i) => 2 * v / Math.max(1e-8, IIWA_LIMITS[i] ** 2 - v * v));
  const h = 1e-5;
  return q.map((_, j) => {
    const plus = q.slice(), minus = q.slice(); plus[j] += h; minus[j] -= h;
    return (nullSpaceCost(plus, cost, reference) - nullSpaceCost(minus, cost, reference)) / (2 * h);
  });
}

/** Exact full-row-rank right pseudoinverse and orthogonal null projection. */
export function projectedVelocity(q, taskVelocity, cost = 'none', gain = 0, reference = q) {
  const J = jacobian(q), JT = transpose(J), G = gram(J);
  const taskDual = solveLinear(G, taskVelocity);
  if (!taskDual) return null;
  const primary = matvec(JT, taskDual), gradient = costGradient(q, cost, reference);
  // A scalar rescaling of a projected gradient changes its rate, not its
  // descent direction. It keeps the barrier's speed finite near a joint stop.
  const gradientScale = Math.max(1, Math.hypot(...gradient) / 12);
  const bounded = gradient.map(v => v / gradientScale);
  const dual = solveLinear(G, matvec(J, bounded));
  if (!dual) return null;
  const removed = matvec(JT, dual), nullVelocity = bounded.map((v, j) => -gain * (v - removed[j]));
  return { qdot: primary.map((v, j) => v + nullVelocity[j]), primary, nullVelocity, gradientScale };
}

function correctPose(target, seed, iterations = 12) {
  let q = seed.slice();
  for (let iteration = 0; iteration < iterations; iteration++) {
    const error = poseDifference(fk(q), target), norm = Math.hypot(...error);
    if (norm < 2e-10) return { q, error: norm };
    const step = projectedVelocity(q, error);
    if (!step || Math.hypot(...step.qdot) > .5) return null;
    q = q.map((v, j) => v + step.qdot[j]);
  }
  const error = Math.hypot(...poseDifference(fk(q), target));
  return error < 1e-7 ? { q, error } : null;
}

function state(q, target) {
  const pose = fk(q), error = Math.hypot(...poseDifference(pose, target));
  return { s: target.s, q: q.slice(), p: pose.p, error, ...configurationMetrics(q) };
}

function summarize(samples, complete, reason, extra = {}) {
  // Associate each actually followed posture with its algebraic chart label.
  // Numerical null-space motion can move between these labels; drawing every
  // sample on the initial branch's map would conceal that change.
  for (const sample of samples) {
    // An analytical edge already has the exact solver's chart labels. Only
    // numerical states and the initial posture need this extra IK lookup.
    if (Number.isInteger(sample.branchIndex) && sample.mergedBranchIndices?.length) continue;
    let root = null, best = 1e-6;
    for (const candidate of inverseFixedQ3(fk(sample.q), sample.q[2])) {
      const distance = jointDistance(candidate.q, sample.q);
      if (distance < best) { best = distance; root = candidate; }
    }
    sample.branchIndex = root?.branchIndex ?? null;
    sample.mergedBranchIndices = root?.mergedBranchIndices?.slice() || [];
  }
  return { samples, q: samples.map(sample => sample.q), complete, reason,
    minLimitMargin: samples.length ? Math.min(...samples.map(x => x.limitMargin)) : null,
    minSigma: samples.length ? Math.min(...samples.map(x => x.sigmaMin)) : null,
    maxPoseError: samples.length ? Math.max(...samples.map(x => x.error)) : null,
    maxStep: samples.length > 1 ? Math.max(...samples.slice(1).map((x, j) => jointDistance(x.q, samples[j].q))) : 0,
    closure: samples.length > 1 ? jointDistance(samples[0].q, samples.at(-1).q) : 0, ...extra };
}

export async function planNumerical(input, seedQ, options = {}) {
  const spec = pathSpec(input), targets = pathSamples(spec, (options.nSteps ?? 400) + 1);
  const cost = options.cost ?? 'centering', gain = options.gain ?? .8, reference = (options.reference || seedQ).slice();
  let q = seedQ.slice();
  const first = state(q, targets[0]), samples = [first];
  if (!first.valid || first.error > 1e-7) return summarize(samples, false, first.reason || 'start-pose-mismatch');
  for (let k = 1; k < targets.length; k++) {
    const previous = targets[k - 1], target = targets[k], ds = target.s - previous.s;
    const dx = poseDifference(fk(q), target).map(v => v / ds);
    const predictor = projectedVelocity(q, dx, cost, gain, reference);
    if (!predictor) return summarize(samples, false, 'full-jacobian-singularity', { failProgress: target.s });
    const seed = q.map((v, j) => v + ds * predictor.qdot[j]);
    const corrected = correctPose(target, seed);
    if (!corrected) return summarize(samples, false, 'numerical-correction-failed', { failProgress: target.s });
    if (jointDistance(q, corrected.q) > .15) return summarize(samples, false, 'continuation-step-too-large', { failProgress: target.s });
    const next = state(corrected.q, target);
    if (!next.valid) return summarize(samples, false, next.reason, { failProgress: target.s, failure: next });
    // Validate two intermediate corrected poses as well as the endpoint. These
    // are actual FK/rank/limit evaluations, never interpolated feasibility flags.
    for (const f of [1 / 3, 2 / 3]) {
      const midTarget = pathPose(previous.s + ds * f, spec);
      const mid = correctPose(midTarget, q.map((v, j) => v + f * (corrected.q[j] - v)));
      if (!mid) return summarize(samples, false, 'intermediate-correction-failed', { failProgress: midTarget.s });
      const check = state(mid.q, midTarget);
      if (!check.valid) return summarize(samples, false, check.reason, { failProgress: midTarget.s, failure: check });
      samples.push(check);
    }
    q = corrected.q; samples.push(next);
    if (k % 16 === 0) { options.onProgress?.(k / (targets.length - 1)); await yieldTask(); }
  }
  options.onProgress?.(1);
  return summarize(samples, true, null, { cost, gain, strategy: 'numerical', validation: 'dense sampled FK, native joint limits and full-Jacobian rank' });
}

function branchIndex(root, fallback) {
  if (Number.isInteger(root.branchIndex)) return root.branchIndex;
  if (Number.isInteger(root.branch)) return root.branch;
  return fallback;
}

function evaluatedRoots(target, angle) {
  const slots = Array(BRANCHES).fill(null);
  inverseFixedQ3(target, angle).forEach((root, index) => {
    const id = branchIndex(root, index), metrics = configurationMetrics(root.q);
    // At a chart merger two algebraic labels can denote the same physical
    // configuration. Preserve both labels on the map without inventing a new
    // distinct IK or calling the merged branch unreachable.
    for (const labelIndex of root.mergedBranchIndices || [id]) {
      slots[labelIndex] = { ...root, branchIndex: labelIndex, label: IIWA_BRANCH_LABELS[labelIndex], ...metrics,
        valid: metrics.valid && root.error < 1e-7,
        reason: metrics.reason || (root.error >= 1e-7 ? 'pose-residual' : null) };
    }
  });
  return slots;
}

export async function buildRedundancyMap(input = DEFAULT_RECTANGLE, options = {}) {
  const spec = pathSpec(input), samples = pathSamples(spec, options.nProgress ?? 81);
  const nAngles = Math.max(3, Math.round(options.nAngles ?? 69));
  const range = options.angleRange || [-IIWA_LIMITS[2], IIWA_LIMITS[2]];
  const angles = Array.from({ length: nAngles }, (_, row) => range[0] + row * (range[1] - range[0]) / (nAngles - 1));
  const cells = [], stats = { evaluations: 0, roots: 0, valid: 0, limits: 0, singular: 0, unreachable: 0, branchValid: Array(BRANCHES).fill(0) };
  for (let k = 0; k < samples.length; k++) {
    if (options.signal?.aborted) { const error = new Error('Feasibility-map calculation cancelled.'); error.name = 'AbortError'; throw error; }
    const column = angles.map(angle => evaluatedRoots(samples[k], angle)); cells.push(column);
    column.forEach(roots => roots.forEach((root, branch) => {
      stats.evaluations++;
      if (!root) { stats.unreachable++; return; }
      stats.roots++;
      if (root.valid) { stats.valid++; stats.branchValid[branch]++; }
      else if (root.reason === 'joint-limit') stats.limits++;
      else if (root.reason === 'full-jacobian-singularity') stats.singular++;
    }));
    if (k % 2 === 0) { options.onProgress?.((k + 1) / samples.length); await yieldTask(); }
  }
  let defaultStart = null, best = -Infinity;
  cells[0].forEach((roots, row) => roots.forEach((root, branch) => {
    if (!root?.valid) return;
    const score = root.limitMargin + .15 * root.sigmaMin - .015 * Math.abs(angles[row]);
    if (score > best) { best = score; defaultStart = { row, branch }; }
  }));
  if (JSON.stringify(spec) === JSON.stringify(rectangleSpec(DEFAULT_RECTANGLE))) {
    const row = angles.reduce((best, value, i) => Math.abs(value - DEFAULT_START.angle) < Math.abs(angles[best] - DEFAULT_START.angle) ? i : best, 0);
    if (cells[0][row][DEFAULT_START.branch]?.valid) defaultStart = { row, branch: DEFAULT_START.branch };
  }
  options.onProgress?.(1);
  return { spec, samples, angles, cells, stats, defaultStart,
    definition: 'Each dot is a fresh fixed-q3 analytical IK solve followed by native-limit and full 6×7 Jacobian-rank checks.' };
}

function closestRoot(target, angle, predicted) {
  let best = null, distance = Infinity;
  for (const root of inverseFixedQ3(target, angle)) {
    const d = jointDistance(root.q, predicted);
    if (d < distance) { best = root; distance = d; }
  }
  return best && distance < .15 ? best : null;
}

/** A chart connection is checked through fresh analytical IK solves. A zero of
 * a 6×6 fixed-q3 minor is not automatically rejected as a robot singularity. */
export function validateAnalyticalConnection(spec, a, b, subdivisions = 4) {
  if (jointDistance(a.q, b.q) > .45) return null;
  const states = [];
  let previous = a.q;
  for (let i = 1; i <= subdivisions; i++) {
    const t = i / subdivisions, target = pathPose(a.s + t * (b.s - a.s), spec);
    const expected = a.q.map((v, j) => v + t * (b.q[j] - v));
    const root = i === subdivisions ? b : closestRoot(target, expected[2], expected);
    if (!root || jointDistance(previous, root.q) > .22) return null;
    const check = analyticalState(root, target);
    if (!check.valid || check.error > 1e-7) return null;
    states.push(check); previous = root.q;
  }
  return states;
}

function analyticalState(root, target) {
  return { ...state(root.q, target),
    branchIndex: root.mergedBranchIndices?.[0] ?? root.branchIndex,
    mergedBranchIndices: root.mergedBranchIndices?.slice() || [] };
}

function graphNodeCost(q, cost) {
  if (cost === 'limits') return .2 * nullSpaceCost(q, 'limits');
  if (cost === 'manipulability') return .15 * nullSpaceCost(q, 'manipulability');
  return 0;
}

export async function planAnalytical(map, options = {}) {
  const { cells, samples: targets, angles, spec } = map;
  const row = options.row ?? map.defaultStart?.row, branch = options.branch ?? map.defaultStart?.branch;
  const first = cells[0]?.[row]?.[branch], cost = options.cost ?? 'travel';
  if (!first?.valid) return summarize([], false, 'invalid-start');
  const width = angles.length * BRANCHES, encode = (r, b) => r * BRANCHES + b;
  const decode = id => ({ row: Math.floor(id / BRANCHES), branch: id % BRANCHES });
  const get = (k, id) => { const d = decode(id); return cells[k][d.row][d.branch]; };
  let costs = new Float64Array(width).fill(Infinity); costs[encode(row, branch)] = 0;
  const parents = [null], edgePaths = [null]; let reached = 0, checkedEdges = 0;
  let yieldedAt = performance.now();
  for (let k = 1; k < targets.length; k++) {
    const next = new Float64Array(width).fill(Infinity), parent = new Int16Array(width).fill(-1);
    const incoming = Array.from({ length: width }, () => []), paths = new Array(width);
    for (let from = 0; from < width; from++) {
      if (!Number.isFinite(costs[from])) continue;
      const a = get(k - 1, from), source = decode(from), ds = targets[k].s - targets[k - 1].s;
      for (let r = Math.max(0, source.row - 1); r <= Math.min(angles.length - 1, source.row + 1); r++) {
        for (let b = 0; b < BRANCHES; b++) {
          const candidate = cells[k][r][b]; if (!candidate?.valid) continue;
          const distance = jointDistance(a.q, candidate.q); if (distance > .45) continue;
          const id = encode(r, b), score = costs[from] + distance + ds * graphNodeCost(candidate.q, cost);
          incoming[id].push({ from, score, a, candidate });
        }
      }
    }
    for (let id = 0; id < width; id++) {
      // The cheapest valid incoming edge is the same DP result as repeatedly
      // replacing the best predecessor. Test it first to avoid checking more
      // expensive predecessors that cannot improve the answer. Stable sorting
      // preserves the original source-order tie break.
      incoming[id].sort((a, b) => a.score - b.score);
      for (const edge of incoming[id]) {
        checkedEdges++;
        const path = validateAnalyticalConnection(spec, { ...edge.a, s: targets[k - 1].s },
          { ...edge.candidate, s: targets[k].s }, 8);
        if (!path) continue;
        next[id] = edge.score; parent[id] = edge.from; paths[id] = path;
        break;
      }
      if (performance.now() - yieldedAt > 12) {
        options.onProgress?.((k - 1 + (id + 1) / width) / (targets.length - 1));
        await yieldTask(); yieldedAt = performance.now();
      }
    }
    if (!next.some(Number.isFinite)) break;
    reached = k; costs = next; parents.push(parent); edgePaths.push(paths);
    if (k % 2 === 0) { options.onProgress?.(k / (targets.length - 1)); await yieldTask(); yieldedAt = performance.now(); }
  }
  let id = 0;
  for (let j = 1; j < width; j++) if (costs[j] < costs[id]) id = j;
  const corridor = [];
  for (let k = reached; k >= 0; k--) {
    corridor.push({ k, ...decode(id) }); if (k) id = parents[k][id];
  }
  corridor.reverse();
  const states = [state(first.q, targets[0])];
  for (let k = 1; k < corridor.length; k++) {
    const b = corridor[k];
    // These are the same eight independently validated analytical states used
    // to accept the selected edge, not interpolated playback configurations.
    states.push(...edgePaths[b.k][encode(b.row, b.branch)]);
  }
  options.onProgress?.(1);
  return summarize(states, reached === targets.length - 1,
    reached === targets.length - 1 ? null : 'no-sampled-corridor',
    { corridor, checkedEdges, cost, strategy: 'analytical',
      validation: 'fresh analytical IK and full-Jacobian/native-limit checks at eight subdivisions per selected graph edge' });
}
