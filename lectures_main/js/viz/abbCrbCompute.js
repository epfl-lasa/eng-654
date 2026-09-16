/** Native Rust/Rayon when available; otherwise a bounded pool of real JS workers.
 * Both backends enumerate independent full poses and keep unresolved cells at -1.
 * Native setup: bash lectures_main/tools/serve-crb-ik.sh
 */
const DEFAULT_NATIVE_URL = 'http://127.0.0.1:8743';
const abortError = () => new DOMException('Slice calculation cancelled.', 'AbortError');
const cancelled = signal => { if (signal?.aborted) throw abortError(); };
const now = () => performance.now();

export function validateSliceRequest(slice) {
  if (!['xy', 'xz'].includes(slice?.plane)) throw new Error('Choose an xy or xz slice.');
  const xy = slice.plane === 'xy', rows = xy ? slice.ny : slice.nz;
  const low = xy ? slice.ymin : slice.zmin, high = xy ? slice.ymax : slice.zmax;
  if (![slice.nx, rows].every(v => Number.isInteger(v) && v >= 2 && v <= 400)
    || ![slice.xmin, slice.xmax, low, high, xy ? slice.z : slice.y].every(Number.isFinite)
    || slice.xmin >= slice.xmax || low >= high) throw new Error('Invalid slice bounds or sampling dimensions (2–400).');
  const r = slice.orientation;
  if (!Array.isArray(r) || r.length !== 3 || r.some(row => !Array.isArray(row) || row.length !== 3 || !row.every(Number.isFinite))) throw new Error('A finite 3×3 orientation is required.');
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    if (Math.abs(r.reduce((sum, row) => sum + row[i] * row[j], 0) - Number(i === j)) > 1e-6) throw new Error('Orientation must be orthonormal.');
  }
  const det = r[0][0]*(r[1][1]*r[2][2]-r[1][2]*r[2][1])-r[0][1]*(r[1][0]*r[2][2]-r[1][2]*r[2][0])+r[0][2]*(r[1][0]*r[2][1]-r[1][1]*r[2][0]);
  if (Math.abs(det - 1) > 1e-6) throw new Error('Orientation determinant must be +1.');
  return slice.nx * rows;
}

async function nativeAvailable(base, signal) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 500);
  const cancel = () => controller.abort(); signal?.addEventListener('abort', cancel, { once: true });
  try {
    const response = await fetch(base + '/health', { signal: controller.signal, cache: 'no-store', credentials: 'omit' });
    const info = response.ok ? await response.json() : null;
    return info?.backend === 'rust-native' && info.protocol === 1 ? info : null;
  } catch { cancelled(signal); return null; }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
}

function checkedResult(result, total) {
  if (!result || !Array.isArray(result.counts) || !Array.isArray(result.limitCounts) || result.counts.length !== total || result.limitCounts.length !== total
    || result.counts.some((v, i) => !Number.isInteger(v) || v < -1 || v > 16 || !Number.isInteger(result.limitCounts[i]) || (v < 0 ? result.limitCounts[i] !== -1 : result.limitCounts[i] < 0 || result.limitCounts[i] > v))) throw new Error('The IK backend returned an invalid count map.');
  return { ...result, unresolved: result.counts.filter(v => v < 0).length };
}

async function nativeSlice(slice, onProgress, signal, base, total) {
  const response = await fetch(base + '/slice', { method: 'POST', body: JSON.stringify(slice),
    headers: { 'Content-Type': 'application/json' }, signal, credentials: 'omit', cache: 'no-store' });
  if (!response.ok) { const error = await response.json().catch(() => ({})); throw new Error(error.error || 'Native IK request failed: HTTP ' + response.status); }
  if (!response.body) throw new Error('The browser cannot read the native IK stream.');
  const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '', result;
  const accept = row => {
    if (!row.trim()) return; const message = JSON.parse(row);
    if (message.error) throw new Error(message.error);
    if (message.result) result = checkedResult(message.result, total);
    else onProgress?.(message);
  };
  try {
    for (;;) {
      cancelled(signal); const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let newline; while ((newline = buffer.indexOf('\n')) >= 0) { accept(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1); }
      if (done) break;
    }
    if (buffer.trim()) accept(buffer);
    if (!result) throw new Error('Native IK stream ended before the result.');
    return result;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

/** The native adaptive solver occasionally leaves a few roots unresolved.
 * Retry only those poses with the independent browser polynomial charts.
 * A second unresolved result stays -1; it never becomes a zero-IK pose. */
async function recoverNative(slice, result, onProgress, signal) {
  const indexes = result.counts.map((value, i) => value < 0 ? i : -1).filter(i => i >= 0);
  if (!indexes.length) return result;
  result = { ...result, nativeUnresolved: indexes.length, recoveredPoses: 0 };
  if (typeof Worker === 'undefined' || indexes.length > 512) return { ...result, recoverySkipped: 'Browser recovery unavailable or more than 512 unresolved poses.' };
  const started = now();
  return new Promise((resolve, reject) => {
    let worker, cursor = 0, finished = false;
    const cleanup = () => { signal?.removeEventListener('abort', abort); worker?.terminate(); };
    const abort = () => { if (finished) return; finished = true; cleanup(); reject(abortError()); };
    const finish = error => {
      if (finished) return; finished = true; cleanup();
      result.unresolved = result.counts.filter(v => v < 0).length;
      result.recoveryBackend = 'javascript-workers'; result.recoveryWorkers = 1; result.recoverySeconds = (now() - started) / 1000;
      result.solver += '; independent browser polynomial recovery at ' + cursor + ' unresolved poses';
      if (error) result.recoveryError = error.message;
      resolve(result);
    };
    const assign = () => worker.postMessage({ slice, start: indexes[cursor], end: indexes[cursor] + 1 });
    signal?.addEventListener('abort', abort, { once: true });
    try {
      cancelled(signal);
      worker = new Worker(new URL('./abbCrbSliceWorker.js', import.meta.url), { type: 'module' });
      worker.onerror = event => finish(new Error(event.message || 'Browser recovery failed.'));
      worker.onmessage = ({ data }) => {
        if (finished) return;
        if (data.error) { finish(new Error(data.error)); return; }
        const i = indexes[cursor++];
        if (data.counts[0] >= 0) { result.counts[i] = data.counts[0]; result.limitCounts[i] = data.limitCounts[0]; result.recoveredPoses++; }
        result.maxFkError = Math.max(result.maxFkError || 0, data.maxFkError);
        onProgress?.({ start: i, counts: [result.counts[i]], limitCounts: [result.limitCounts[i]], done: result.counts.length,
          total: result.counts.length, backend: 'rust-native', workers: result.workers, unresolved: indexes.length - result.recoveredPoses,
          recovery: { done: cursor, total: indexes.length }, recoveryBackend: 'javascript-workers', elapsedSeconds: result.elapsedSeconds + (now() - started) / 1000 });
        if (cursor === indexes.length) finish(); else assign();
      };
      assign();
    } catch (error) { if (signal?.aborted) abort(); else finish(error); }
  });
}

async function parallelSlice(slice, onProgress, signal, maxWorkers, fallbackReason) {
  const total = validateSliceRequest(slice), started = now();
  const cores = Math.max(1, Number(globalThis.navigator?.hardwareConcurrency) || 2);
  const workers = Math.max(1, Math.min(8, cores > 1 ? cores - 1 : 1, Math.floor(maxWorkers || 8), Math.ceil(total / 64)));
  const counts = new Array(total).fill(-1), limitCounts = new Array(total).fill(-1), pool = [];
  let next = 0, done = 0, unresolved = 0, maxFkError = 0, settled = false;
  return new Promise((resolve, reject) => {
    const cleanup = () => { signal?.removeEventListener('abort', abort); pool.forEach(worker => worker.terminate()); };
    const fail = error => { if (settled) return; settled = true; cleanup(); reject(error); };
    const abort = () => fail(abortError());
    signal?.addEventListener('abort', abort, { once: true });
    const assign = worker => {
      if (next >= total || settled) return;
      const start = next; next = Math.min(total, next + 64); worker.postMessage({ slice, start, end: next });
    };
    try {
      cancelled(signal);
      onProgress?.({ done: 0, total, backend: 'javascript-workers', workers, reset: true, fallbackReason });
      for (let i = 0; i < workers; i++) {
        const worker = new Worker(new URL('./abbCrbSliceWorker.js', import.meta.url), { type: 'module' }); pool.push(worker);
        worker.onerror = event => fail(new Error(event.message || 'A browser IK worker failed.'));
        worker.onmessage = ({ data }) => {
          if (settled) return;
          try {
            if (data.error) throw new Error(data.error);
            data.counts.forEach((value, j) => { counts[data.start + j] = value; limitCounts[data.start + j] = data.limitCounts[j]; });
            done += data.counts.length; unresolved += data.unresolved; maxFkError = Math.max(maxFkError, data.maxFkError);
            onProgress?.({ ...data, done, total, unresolved, backend: 'javascript-workers', workers, elapsedSeconds: (now() - started) / 1000 });
            if (done === total) {
              const result = checkedResult({ ...slice, counts, limitCounts, unresolved, maxFkError,
                source: 'live', backend: 'javascript-workers', workers, elapsedSeconds: (now() - started) / 1000,
                solver: 'Parallel browser degree-16 polynomial enumeration with 160-bit coefficients and native FK checks', fallbackReason }, total);
              settled = true; cleanup(); resolve(result);
            } else assign(worker);
          } catch (error) { fail(error); }
        };
        assign(worker);
      }
    } catch (error) { fail(error); }
  });
}

export async function computeSlice(slice, onProgress, { signal, backend = 'auto', maxWorkers,
  nativeUrl = globalThis.CRBIK_NATIVE_URL || DEFAULT_NATIVE_URL } = {}) {
  const total = validateSliceRequest(slice), started = now(); cancelled(signal);
  if (!['auto', 'rust-native', 'javascript-workers'].includes(backend)) throw new Error('Unknown IK backend.');
  if (maxWorkers !== undefined && (!Number.isInteger(maxWorkers) || maxWorkers < 1)) throw new Error('The worker limit must be a positive integer.');
  const base = nativeUrl.replace(/\/$/, ''); let fallbackReason;
  if (backend !== 'javascript-workers') {
    const info = await nativeAvailable(base, signal);
    if (info) {
      try { let result = await nativeSlice(slice, onProgress, signal, base, total); result = await recoverNative(slice, result, onProgress, signal); return { ...result, wallSeconds: (now() - started) / 1000 }; }
      catch (error) { cancelled(signal); if (backend === 'rust-native') throw error; fallbackReason = 'Native calculation interrupted; restarted with browser workers.'; }
    } else if (backend === 'rust-native') throw new Error('Native Rust IK is unavailable. Start tools/serve-crb-ik.sh.');
    else fallbackReason = 'Native service unavailable; using parallel browser workers.';
  }
  cancelled(signal); const result = await parallelSlice(slice, onProgress, signal, maxWorkers, fallbackReason);
  return { ...result, wallSeconds: (now() - started) / 1000 };
}
