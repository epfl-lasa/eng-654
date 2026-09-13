/* Exported functions import offline. External Python is evaluated only in a
 * short-lived worker, after the caller explicitly requests external import. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./graph.js'));
  else root.KinematicsPythonImport = factory(root.KinematicsGraph);
})(typeof window !== 'undefined' ? window : globalThis, function (Graph) {
  'use strict';

  const MANIFEST_PREFIX = '# KINEMATICS_PLAYGROUND_V1: ';
  // Pinned distribution. The runtime is never requested by offline imports.
  const PYODIDE_URL = 'https://cdn.jsdelivr.net/pyodide/v314.0.6/full/';
  const MAX_SOURCE = 1000000;

  function failure(code, message) {
    const error = new Error(message);
    error.name = 'PythonImportError'; error.code = code;
    return error;
  }
  function checkSource(source) {
    if (typeof source !== 'string' || !source.trim()) throw failure('EMPTY_SOURCE', 'Choose a Python file containing a function.');
    if (source.length > MAX_SOURCE) throw failure('SOURCE_TOO_LARGE', 'The Python file is too large; use a file under 1 MB.');
    return source.replace(/\r\n?/g, '\n');
  }
  function sourceFingerprint(source) {
    const normalized = source.replace(/\r\n?/g, '\n').split('\n').filter(line => !line.startsWith(MANIFEST_PREFIX)).join('\n').replace(/\n+$/, '') + '\n';
    let hash = 0x811c9dc5;
    for (const byte of new TextEncoder().encode(normalized)) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
    return hash.toString(16).padStart(8, '0');
  }
  function decodeManifest(payload) {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(payload) || payload.length % 4) throw failure('INVALID_MANIFEST', 'The Python file contains an invalid playground footer.');
    try {
      const bytes = typeof Buffer !== 'undefined' ? Uint8Array.from(Buffer.from(payload, 'base64')) : Uint8Array.from(atob(payload), c => c.charCodeAt(0));
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch (_) { throw failure('INVALID_MANIFEST', 'The Python file contains an unreadable playground footer.'); }
  }
  // Keep line starts while removing strings and comments, so examples in a
  // docstring cannot appear in the function picker. Python itself checks syntax.
  function functionNames(source) {
    let cleaned = '', index = 0;
    while (index < source.length) {
      const char = source[index];
      if (char === '#') {
        while (index < source.length && source[index] !== '\n') { cleaned += ' '; index++; }
      } else if (char === '"' || char === "'") {
        const quote = source.slice(index, index + 3) === char.repeat(3) ? char.repeat(3) : char;
        cleaned += ' '.repeat(quote.length); index += quote.length;
        while (index < source.length) {
          if (source[index] === '\\') { cleaned += ' '; index++; if (index < source.length) { cleaned += source[index] === '\n' ? '\n' : ' '; index++; } }
          else if (source.slice(index, index + quote.length) === quote) { cleaned += ' '.repeat(quote.length); index += quote.length; break; }
          else { cleaned += source[index] === '\n' ? '\n' : ' '; index++; }
        }
      } else { cleaned += char; index++; }
    }
    return [...cleaned.matchAll(/^def[ \t]+([A-Za-z_][A-Za-z_0-9]*)[ \t]*\(/gm)].map(match => match[1]);
  }
  function inspectSource(source) {
    const normalized = checkSource(source), lines = normalized.split('\n');
    const markers = lines.map((line, index) => line.startsWith(MANIFEST_PREFIX) ? index : -1).filter(index => index >= 0);
    if (!markers.length) return { kind: 'external', functions: functionNames(normalized), requiresRuntime: true };
    if (markers.length !== 1 || lines.slice(markers[0] + 1).some(line => line.trim())) throw failure('INVALID_MANIFEST', 'The playground footer must appear once, at the end of the Python file.');
    const manifest = decodeManifest(lines[markers[0]].slice(MANIFEST_PREFIX.length));
    if (!manifest || typeof manifest !== 'object' || !/^[0-9a-f]{8}$/.test(manifest.codeHash || '')) throw failure('INVALID_MANIFEST', 'The playground footer is missing its source fingerprint.');
    if (sourceFingerprint(normalized) !== manifest.codeHash) throw failure('SOURCE_CHANGED', 'This exported Python file has been edited. Its saved block definition no longer matches the code. Re-export it, or remove the playground footer and explicitly import the edited function as external Python.');
    const definition = Graph.validateDefinition(manifest.definition);
    return { kind: 'playground', functions: functionNames(normalized), requiresRuntime: false, definition };
  }
  function createRuntimeFetch(fetchFunction, runtimeURL) {
    return (input, init = {}) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (!String(url).startsWith(runtimeURL)) return Promise.reject(new Error('Network access is disabled for Python imports.'));
      return fetchFunction(input, { ...init, credentials: 'omit' });
    };
  }

  // This extractor also runs under ordinary Python in the tests. It deliberately
  // accepts mathematical functions, not arbitrary Python applications. The NumPy
  // facade keeps scalars symbolic and implements common matrix-building idioms.
  const EXTRACTION_SOURCE = String.raw`
import ast as _ast
import inspect as _inspect
import json as _json
import types as _types
import sympy as _sp

def _extract_fk(_source, _function_name):
    _tree = _ast.parse(_source, filename="imported_fk.py")
    # Type hints do not affect the FK. Avoid executing annotation expressions.
    for _node in _ast.walk(_tree):
        if isinstance(_node, _ast.FunctionDef): _node.returns = None
        if isinstance(_node, _ast.arg): _node.annotation = None
    _allowed_attrs = set("Matrix ImmutableMatrix MutableDenseMatrix Symbol symbols Rational Integer Float N sin cos tan sqrt acos atan2 pi eye identity zeros ones diag array asarray matrix dot matmul cross vstack hstack concatenate stack linalg norm multi_dot shape T transpose reshape tolist copy simplify expand trigsimp subs applyfunc rows cols".split())
    _forbidden_names = set("eval exec compile open input globals locals vars getattr setattr delattr type super __import__ breakpoint help memoryview".split())
    for _node in _ast.walk(_tree):
        if isinstance(_node, (_ast.Import, _ast.ImportFrom)):
            _modules = [_alias.name for _alias in _node.names] if isinstance(_node, _ast.Import) else [_node.module]
            if isinstance(_node, _ast.ImportFrom) and _node.level:
                raise ValueError("Relative imports are unsupported. Keep the FK helpers in the same file.")
            if any(_module not in ("numpy", "sympy", "math") for _module in _modules):
                raise ValueError("Only numpy, sympy, and math imports are supported for external FK functions.")
        if isinstance(_node, _ast.Attribute) and _node.attr not in _allowed_attrs:
            raise ValueError("Unsupported attribute '" + _node.attr + "'. Use scalar trig functions and ordinary matrix operations.")
        if isinstance(_node, _ast.Name) and (_node.id in _forbidden_names or _node.id.startswith("__")):
            if _node.id != "__name__":
                raise ValueError("Unsupported operation '" + _node.id + "' in the FK source.")
        if isinstance(_node, (_ast.ClassDef, _ast.AsyncFunctionDef, _ast.Await, _ast.Yield, _ast.YieldFrom, _ast.With, _ast.AsyncWith, _ast.Global, _ast.Nonlocal, _ast.Delete)):
            raise ValueError("Use a plain Python function with scalar parameters and a matrix return value.")
        if isinstance(_node, (_ast.FunctionDef, _ast.AsyncFunctionDef)) and _node.decorator_list:
            raise ValueError("Decorated functions are unsupported. Import a plain FK function.")

    def _array(_data, *args, **kwargs):
        return _sp.Matrix(_data)
    def _shape(_shape_value, default_columns=1):
        if isinstance(_shape_value, (tuple, list)):
            if len(_shape_value) == 1: return (int(_shape_value[0]), 1)
            if len(_shape_value) == 2: return tuple(map(int, _shape_value))
            raise ValueError("Only vectors and two-dimensional matrices are supported.")
        return (int(_shape_value), default_columns)
    def _eye(n, m=None, **kwargs):
        return _sp.eye(int(n), int(m) if m is not None else int(n))
    def _zeros(shape, *args, **kwargs):
        rows, cols = _shape(shape)
        return _sp.zeros(rows, cols)
    def _ones(shape, *args, **kwargs):
        rows, cols = _shape(shape)
        return _sp.ones(rows, cols)
    def _dot(a, b):
        a, b = _sp.Matrix(a), _sp.Matrix(b)
        if a.cols == b.cols == 1: return a.dot(b)
        return a * b
    def _multi_dot(values):
        result = _sp.Matrix(values[0])
        for value in values[1:]: result = result * _sp.Matrix(value)
        return result
    def _concatenate(values, axis=0):
        matrices = [_sp.Matrix(value) for value in values]
        return _sp.Matrix.vstack(*matrices) if axis == 0 else _sp.Matrix.hstack(*matrices)
    def _trig(function):
        def wrapped(value):
            return value.applyfunc(function) if isinstance(value, _sp.MatrixBase) else function(value)
        return wrapped

    _scalar = {name: getattr(_sp, name) for name in ("sin", "cos", "tan", "sqrt", "acos", "atan2")}
    _scalar["pi"] = _sp.pi
    _sympy = _types.SimpleNamespace(**{name: getattr(_sp, name) for name in ("Matrix", "ImmutableMatrix", "MutableDenseMatrix", "Symbol", "symbols", "Rational", "Integer", "Float", "N", "eye", "zeros", "ones", "diag", "simplify", "expand", "trigsimp")}, **_scalar)
    _numpy = _types.SimpleNamespace(**{name: _trig(value) if callable(value) else value for name, value in _scalar.items()},
        array=_array, asarray=_array, matrix=_array, eye=_eye, identity=_eye, zeros=_zeros, ones=_ones,
        diag=lambda values: _sp.diag(*values), dot=_dot, matmul=lambda a,b: _sp.Matrix(a)*_sp.Matrix(b),
        cross=lambda a,b: _sp.Matrix(a).cross(_sp.Matrix(b)),
        vstack=lambda values: _concatenate(values,0), hstack=lambda values: _concatenate(values,1),
        concatenate=_concatenate, stack=_concatenate,
        linalg=_types.SimpleNamespace(norm=lambda value: _sp.sqrt(sum(entry**2 for entry in _sp.Matrix(value))), multi_dot=_multi_dot))
    _modules = {"numpy": _numpy, "sympy": _sympy, "math": _types.SimpleNamespace(**_scalar)}
    def _safe_import(name, globals=None, locals=None, fromlist=(), level=0):
        if name not in _modules or level: raise ImportError("Only numpy, sympy, and math are supported.")
        return _modules[name]
    _builtins = {"__import__": _safe_import, "range": range, "enumerate": enumerate, "zip": zip,
        "len": len, "sum": sum, "abs": abs, "min": min, "max": max, "list": list,
        "tuple": tuple, "dict": dict, "float": float, "int": int, "bool": bool, "object": object,
        "True": True, "False": False, "None": None, "ValueError": ValueError,
        "print": lambda *args, **kwargs: None}
    _namespace = {"__builtins__": _builtins, "__name__": "kinematics_import"}
    # Keep module constants and helper functions. Do not run demonstrations,
    # plotting commands, or a __main__ block merely to inspect a function.
    _kept = [node for node in _tree.body if isinstance(node, (_ast.Import, _ast.ImportFrom, _ast.Assign, _ast.AnnAssign, _ast.FunctionDef))]
    _module = _ast.fix_missing_locations(_ast.Module(body=_kept, type_ignores=[]))
    exec(compile(_module, "imported_fk.py", "exec"), _namespace)
    _function = _namespace.get(_function_name)
    if not callable(_function) or not any(isinstance(node, _ast.FunctionDef) and node.name == _function_name for node in _kept):
        raise ValueError("Choose a top-level function defined in this file.")
    _signature = _inspect.signature(_function)
    _parameters = []
    _arguments = []
    _keywords = {}
    _defaults = {}
    for _name, _parameter in _signature.parameters.items():
        if _parameter.kind in (_inspect.Parameter.VAR_POSITIONAL, _inspect.Parameter.VAR_KEYWORD):
            raise ValueError("Variable-length *args and **kwargs are unsupported. Declare scalar parameters explicitly.")
        _symbol = _sp.Symbol(_name, real=True)
        _parameters.append(_name)
        if _parameter.kind == _inspect.Parameter.KEYWORD_ONLY: _keywords[_name] = _symbol
        else: _arguments.append(_symbol)
        if _parameter.default is not _inspect.Parameter.empty:
            try:
                _default = _sp.sympify(_parameter.default)
                if not _default.free_symbols and _default.is_real and _default.is_finite: _defaults[_name] = str(_default).replace("**", "^")
            except Exception: pass
    try:
        _result = _function(*_arguments, **_keywords)
        _matrix = _sp.Matrix(_result)
    except Exception as error:
        raise ValueError("The function must accept independent scalar symbols and return a matrix. Vector arguments, numeric-only casts, and branches depending on joint values cannot be extracted: " + str(error)) from error
    _kinds = {(3,3): "rotation", (3,1): "translation", (4,4): "transform"}
    if _matrix.shape not in _kinds:
        raise ValueError("Return a 3×3 rotation, a 3×1 translation, or a 4×4 homogeneous transform; got " + str(_matrix.shape) + ".")
    _declared = set(_parameters)
    _allowed_functions = {_sp.sin, _sp.cos, _sp.tan, _sp.sqrt, _sp.acos, _sp.atan2}
    _rows = []
    for row in _matrix.tolist():
        _row = []
        for entry in row:
            entry = _sp.simplify(entry)
            if any(str(symbol) not in _declared for symbol in entry.free_symbols):
                raise ValueError("Every free symbol in the result must be a scalar function parameter.")
            if entry.has(_sp.I, _sp.oo, -_sp.oo, _sp.zoo, _sp.nan):
                raise ValueError("The returned matrix contains a complex or non-finite expression.")
            if any(call.func not in _allowed_functions for call in entry.atoms(_sp.Function)):
                raise ValueError("The result uses an unsupported symbolic function. Supported functions: sin, cos, tan, sqrt, acos, atan2.")
            _text = str(entry).replace("**", "^")
            if len(_text) > 500: raise ValueError("A matrix entry is too long. Simplify the FK expression before importing it.")
            _row.append(_text)
        _rows.append(_row)
    return {"version": 1, "id": "python_" + _function_name[:45], "name": _function_name[:80],
        "kind": "matrix", "parameters": _parameters, "angleUnit": "rad", "defaults": _defaults,
        "outputKind": _kinds[_matrix.shape], "matrix": _rows}
`;

  async function workerMain() {
    const send = self.postMessage.bind(self);
    self.onmessage = async event => {
      const { source, functionName, runtimeURL, extractor } = event.data;
      try {
        send({ type: 'status', phase: 'loading', message: 'Loading Python and SymPy for external import. The first use requires an internet connection.' });
        // Runtime files are the only permitted requests, and never carry the
        // playground's credentials. User code gets no network access afterward.
        self.fetch = createRuntimeFetch(self.fetch.bind(self), runtimeURL);
        const { loadPyodide } = await import(runtimeURL + 'pyodide.mjs');
        const pyodide = await loadPyodide({ indexURL: runtimeURL, stdout() {}, stderr() {} });
        send({ type: 'status', phase: 'loading', message: 'Python is ready. Loading the symbolic matrix package…' });
        await pyodide.loadPackage('sympy');
        await pyodide.runPythonAsync('import sympy');
        self.fetch = () => Promise.reject(new Error('Network access is disabled while importing a function.'));
        for (const name of ['XMLHttpRequest', 'WebSocket', 'EventSource', 'Worker']) {
          try { Object.defineProperty(self, name, { value: undefined, configurable: false, writable: false }); } catch (_) { /* Not all worker environments expose these. */ }
        }
        send({ type: 'status', phase: 'extracting', message: 'Evaluating the function with symbolic parameters…' });
        pyodide.globals.set('_import_source', source);
        pyodide.globals.set('_import_name', functionName);
        const result = await pyodide.runPythonAsync(extractor + '\n_json.dumps(_extract_fk(_import_source, _import_name))');
        send({ type: 'result', definition: JSON.parse(result) });
      } catch (error) { send({ type: 'error', message: String(error.message || error).slice(-4000) }); }
    };
  }
  function externalImport(source, options) {
    if (typeof Worker === 'undefined' || typeof URL.createObjectURL !== 'function') throw failure('WORKER_UNAVAILABLE', 'External Python import needs a browser with Web Worker support. Playground-exported files can still import offline.');
    const functionName = options.functionName;
    if (typeof functionName !== 'string' || !/^[A-Za-z_][A-Za-z_0-9]*$/.test(functionName)) throw failure('FUNCTION_REQUIRED', 'Choose the Python function to import.');
    if (!functionNames(source).includes(functionName)) throw failure('FUNCTION_REQUIRED', 'Choose a top-level function defined in this file.');
    if (options.signal?.aborted) throw failure('CANCELLED', 'Python import cancelled.');
    const workerCode = 'const createRuntimeFetch = ' + createRuntimeFetch.toString() + ';\n(' + workerMain.toString() + ')();';
    const url = URL.createObjectURL(new Blob([workerCode], { type: 'text/javascript' }));
    let worker;
    try { worker = new Worker(url, { type: 'module', name: 'kinematics-python-import' }); }
    catch (error) { URL.revokeObjectURL(url); throw failure('WORKER_UNAVAILABLE', 'The browser could not start the isolated Python importer: ' + error.message); }
    const duration = (value, fallback, max) => Number.isFinite(value) ? Math.max(1000, Math.min(max, value)) : fallback;
    return new Promise((resolve, reject) => {
      let finished = false, timer;
      const finish = (error, definition) => {
        if (finished) return;
        finished = true; clearTimeout(timer); worker.terminate(); URL.revokeObjectURL(url);
        options.signal?.removeEventListener('abort', cancel);
        error ? reject(error) : resolve(definition);
      };
      const cancel = () => finish(failure('CANCELLED', 'Python import cancelled.'));
      timer = setTimeout(() => finish(failure('LOAD_TIMEOUT', 'Python took too long to load. Check the connection and try again. Playground exports import without this download.')), duration(options.loadTimeoutMs, 120000, 180000));
      options.signal?.addEventListener('abort', cancel, { once: true });
      worker.onmessage = event => {
        const message = event.data;
        if (message.type === 'status') {
          if (message.phase === 'extracting') {
            clearTimeout(timer);
            timer = setTimeout(() => finish(failure('EXECUTION_TIMEOUT', 'The Python function took too long to extract. Simplify it or remove loops that do not terminate.')), duration(options.timeoutMs, 20000, 60000));
          }
          options.onStatus?.({ phase: message.phase, message: message.message, requiresNetwork: message.phase === 'loading' });
        } else if (message.type === 'result') {
          try { finish(null, Graph.validateDefinition(message.definition)); }
          catch (error) { finish(failure('UNSUPPORTED_RESULT', error.message)); }
        } else if (message.type === 'error') finish(failure('EXTRACTION_FAILED', message.message));
      };
      worker.onerror = event => finish(failure('RUNTIME_FAILED', 'External Python import failed: ' + (event.message || 'the runtime could not load. Check the connection.')));
      worker.postMessage({ source, functionName, runtimeURL: PYODIDE_URL, extractor: EXTRACTION_SOURCE });
    });
  }
  async function importSource(source, options = {}) {
    const info = inspectSource(source);
    if (info.kind === 'playground') {
      options.onStatus?.({ phase: 'complete', message: 'Imported the saved function offline.', requiresNetwork: false });
      return info.definition;
    }
    if (!options.allowExternal) throw failure('EXTERNAL_OPT_IN_REQUIRED', 'This is an external Python file. Choose a function and enable external import to load Python and SymPy on first use.');
    return externalImport(checkSource(source), options);
  }

  return { inspectSource, importSource, sourceFingerprint, createRuntimeFetch, MANIFEST_PREFIX, PYODIDE_URL, EXTRACTION_SOURCE };
});
