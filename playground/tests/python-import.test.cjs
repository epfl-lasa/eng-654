const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const Importer = require('../python-import.js');
const Python = require('../python.js');
const Graph = require('../graph.js');
const MathEngine = require('../math.js');

const definition = () => ({ version: 1, id: 'fk_rotation', name: 'Rotating frame', kind: 'matrix', parameters: ['theta'], angleUnit: 'rad', defaults: { theta: 'pi/2' }, outputKind: 'rotation', matrix: [['cos(theta)', '-sin(theta)', '0'], ['sin(theta)', 'cos(theta)', '0'], ['0', '0', '1']] });
function extract(source, functionName = 'FK') {
  const script = Importer.EXTRACTION_SOURCE + '\nimport sys\n_data = _json.loads(sys.argv[1])\nprint(_json.dumps(_extract_fk(_data["source"], _data["name"])))';
  const output = execFileSync('python3', ['-c', script, JSON.stringify({ source, name: functionName })], { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] });
  return Graph.validateDefinition(JSON.parse(output));
}
function numericMatrix(value, bindings) { return value.matrix.map(row => row.map(entry => MathEngine.evaluate(MathEngine.parse(entry), bindings))); }
function near(actual, expected) {
  actual.flat().forEach((value, index) => assert.ok(Math.abs(value - expected.flat()[index]) < 1e-10, `${value} != ${expected.flat()[index]}`));
}

test('exported callable imports offline as the same validated definition', async () => {
  const original = Graph.validateDefinition(definition());
  const source = Python.exportFunction(original, { functionName: 'FK' });
  const info = Importer.inspectSource(source);
  assert.equal(info.kind, 'playground');
  assert.equal(info.requiresRuntime, false);
  assert.ok(info.functions.includes('FK'));
  const statuses = [];
  assert.deepEqual(await Importer.importSource(source, { onStatus: value => statuses.push(value) }), original);
  assert.equal(statuses[0].requiresNetwork, false);
});

test('source fingerprints match exporter UTF-8 and newline handling', async () => {
  const source = Python.exportFunction({ ...definition(), name: 'Rotation θ · é' }, { functionName: 'FK' });
  assert.equal(Importer.sourceFingerprint(source), Python.sourceFingerprint(source));
  assert.deepEqual(await Importer.importSource(source.replace(/\n/g, '\r\n')), await Importer.importSource(source));
  assert.deepEqual(await Importer.importSource(source + '\n\n'), await Importer.importSource(source));
});

test('edited exports and malformed or duplicated manifests never import stale metadata', async () => {
  const source = Python.exportFunction(definition(), { functionName: 'FK' });
  await assert.rejects(Importer.importSource('# changed\n' + source, { allowExternal: true, functionName: 'FK' }), { code: 'SOURCE_CHANGED' });
  await assert.rejects(Importer.importSource(source + 'print("extra code")\n'), { code: 'INVALID_MANIFEST' });
  const footer = source.split('\n').find(line => line.startsWith(Importer.MANIFEST_PREFIX));
  await assert.rejects(Importer.importSource(source + footer), { code: 'INVALID_MANIFEST' });
  assert.throws(() => Importer.inspectSource('def FK(): pass\n' + Importer.MANIFEST_PREFIX + '%%%'), { code: 'INVALID_MANIFEST' });
});

test('manifest matrix symbols still pass normal graph-definition validation', async () => {
  const wrong = { ...definition(), parameters: [], defaults: {} };
  const code = 'def FK():\n    return 1\n';
  await assert.rejects(Importer.importSource(code + Python.encodeManifest(wrong, code)), /Expose the function symbol/);
});

test('function picker excludes comments, docstrings, and methods', () => {
  const source = '# def fake(): pass\n"""\ndef docstring_fake(): pass\n"""\nclass Robot:\n    def method(self): pass\ndef FK(\n theta, a\n):\n return None\ndef helper(x):\n return x';
  assert.deepEqual(Importer.inspectSource(source), { kind: 'external', functions: ['FK', 'helper'], requiresRuntime: true });
});

test('external Python requires explicit opt-in and never starts a runtime on inspection', async () => {
  await assert.rejects(Importer.importSource('def FK(theta):\n return theta'), { code: 'EXTERNAL_OPT_IN_REQUIRED' });
  assert.throws(() => Importer.inspectSource(''), { code: 'EMPTY_SOURCE' });
  assert.throws(() => Importer.inspectSource('a'.repeat(1000001)), { code: 'SOURCE_TOO_LARGE' });
});

test('runtime downloads accept URL and Request objects and omit credentials', async () => {
  const requests = [];
  const fetch = Importer.createRuntimeFetch(async (input, init) => { requests.push({ input, init }); return 'downloaded'; }, Importer.PYODIDE_URL);
  for (const input of [Importer.PYODIDE_URL + 'pyodide.asm.wasm', new URL('python_stdlib.zip', Importer.PYODIDE_URL), new Request(Importer.PYODIDE_URL + 'pyodide-lock.json')]) {
    assert.equal(await fetch(input, { credentials: 'include' }), 'downloaded');
  }
  assert.equal(requests.length, 3);
  assert.ok(requests.every(request => request.init.credentials === 'omit'));
  await assert.rejects(fetch(new URL('https://example.com/private')), /Network access is disabled/);
  await assert.rejects(fetch(new Request('http://localhost/private')), /Network access is disabled/);
  assert.equal(requests.length, 3);
});

test('external SymPy FK retains ordered scalar parameters and numeric defaults', () => {
  const value = extract(`import sympy as sp
def FK(theta, a=2, *, d=sp.pi/4):
    c, s = sp.cos(theta), sp.sin(theta)
    return sp.Matrix([[c,-s,0,a*c],[s,c,0,a*s],[0,0,1,d],[0,0,0,1]])
`);
  assert.deepEqual(value.parameters, ['theta', 'a', 'd']);
  assert.deepEqual(value.defaults, { a: '2', d: 'pi/4' });
  near(numericMatrix(value, { theta: Math.PI / 2, a: 2, d: 0.4 }), [[0,-1,0,0],[1,0,0,2],[0,0,1,0.4],[0,0,0,1]]);
});

test('ordinary NumPy array and matrix-product FK extracts symbolically', () => {
  const value = extract(`import numpy as np
def rz(theta: float) -> np.ndarray:
    c, s = np.cos(theta), np.sin(theta)
    return np.array([[c,-s,0,0],[s,c,0,0],[0,0,1,0],[0,0,0,1]],dtype=float)
def FK(theta, a, d):
    translation = np.eye(4, dtype=float)
    translation[0,3] = a
    translation[2,3] = d
    return rz(theta) @ translation
`);
  assert.deepEqual(value.parameters, ['theta', 'a', 'd']);
  near(numericMatrix(value, { theta: Math.PI / 2, a: 2, d: 0.4 }), [[0,-1,0,0],[1,0,0,2],[0,0,1,0.4],[0,0,0,1]]);
});

test('NumPy vector and matrix assembly supports object arrays and slices', () => {
  const value = extract(`from numpy import array, eye, cos, sin
def FK(theta, a):
    T = eye(4)
    T[:3,:3] = array([[cos(theta),-sin(theta),0],[sin(theta),cos(theta),0],[0,0,1]],dtype=object)
    T[:3,3] = array([a,0,0])
    return T
`);
  near(numericMatrix(value, { theta: 0, a: 3 }), [[1,0,0,3],[0,1,0,0],[0,0,1,0],[0,0,0,1]]);
  assert.equal(extract('from math import sin\ndef FK(q):\n return [sin(q),0,0]\n').outputKind, 'translation');
});

test('unsupported Python programs fail with clear diagnostics', () => {
  for (const [source, pattern] of [
    ['import js\ndef FK(q): return q', /Only numpy, sympy, and math/],
    ['def FK(q):\n return open("secret")', /Unsupported operation 'open'/],
    ['def FK(q):\n return q.__class__', /Unsupported attribute '__class__'/],
    ['def FK(q):\n return [q[0],0,0]', /independent scalar symbols/],
    ['def FK(q):\n if q > 0: return [q,0,0]\n return [0,0,0]', /branches depending on joint values/],
    ['def FK(*args): return [0,0,0]', /Variable-length/],
    ['def FK(q): return [[q,0],[0,1]]', /3×3 rotation/],
    ['import sympy as sp\ndef FK(q): return [sp.Symbol("hidden"),0,0]', /Every free symbol/],
  ]) assert.throws(() => extract(source), pattern);
});

test('worker import cancellation terminates its isolated worker', async () => {
  const previous = global.Worker;
  let terminated = 0;
  global.Worker = class {
    postMessage() {}
    terminate() { terminated++; }
  };
  try {
    const controller = new AbortController();
    const promise = Importer.importSource('def FK(q): return [q,0,0]', { allowExternal: true, functionName: 'FK', signal: controller.signal });
    controller.abort();
    await assert.rejects(promise, { code: 'CANCELLED' });
    assert.equal(terminated, 1);
  } finally { global.Worker = previous; }
});

test('worker execution timeout terminates instead of blocking the page', async () => {
  const previous = global.Worker;
  let terminated = 0;
  global.Worker = class {
    postMessage() { queueMicrotask(() => this.onmessage({ data: { type: 'status', phase: 'extracting', message: 'Extracting' } })); }
    terminate() { terminated++; }
  };
  try {
    await assert.rejects(Importer.importSource('def FK(q):\n while True: pass', { allowExternal: true, functionName: 'FK', timeoutMs: 1000 }), { code: 'EXECUTION_TIMEOUT' });
    assert.equal(terminated, 1);
  } finally { global.Worker = previous; }
});
