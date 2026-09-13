/* Generate readable Python from the same safe expression trees used by the playground. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./math.js'), require('./graph.js'));
  else root.KinematicsPython = factory(root.KinematicsMath, root.KinematicsGraph);
})(typeof window !== 'undefined' ? window : globalThis, function (math, graphApi) {
  'use strict';

  const quote = value => JSON.stringify(String(value));
  const comment = value => String(value).split(/\r\n?|\n|\u2028|\u2029/)
    .map(line => '# ' + line.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')).join('\n');
  const functions = new Set(['sin', 'cos', 'tan', 'sqrt', 'acos', 'atan2']);
  function parseExpression(value) {
    if (typeof value !== 'string' && typeof value !== 'number') throw new Error('Python export needs text or numeric expressions.');
    return math.parse(value);
  }
  function expressionCode(ast, names) {
    if (ast.type === 'number') {
      if (!Number.isFinite(ast.value)) throw new Error('Only finite real numbers can be exported.');
      const value = String(ast.value);
      return /[.eE]/.test(value) ? 'sp.Rational(' + quote(value) + ')' : value;
    }
    if (ast.type === 'symbol' && /^[A-Za-z_][A-Za-z_0-9]*$/.test(ast.name)) {
      return ast.name === 'pi' ? 'sp.pi' : names ? names.get(ast.name) : 'sym_' + ast.name;
    }
    if (ast.type === 'call' && functions.has(ast.name)) {
      return 'sp.' + ast.name + '(' + ast.args.map(child => expressionCode(child, names)).join(', ') + ')';
    }
    if (ast.type === 'op') {
      if (ast.op === 'neg') return '(-' + expressionCode(ast.args[0], names) + ')';
      const operator = { '+': '+', '-': '-', '*': '*', '/': '/', '^': '**' }[ast.op];
      if (operator) return '(' + expressionCode(ast.args[0], names) + ' ' + operator + ' ' + expressionCode(ast.args[1], names) + ')';
    }
    throw new Error('This expression cannot be exported as Python.');
  }

  const HELPERS = {
    skew: `def skew(vector):
    """Build the matrix [vector]x, so skew(vector) * p = vector.cross(p)."""
    x, y, z = vector
    return sp.Matrix([[0, -z, y], [z, 0, -x], [-y, x, 0]])`,
    rotation: `def rotation(axis, angle, angle_unit="rad"):
    """Rotate about a direction through the origin, using the right-hand rule."""
    axis = sp.Matrix(axis)
    length = sp.sqrt(axis.dot(axis))
    if length == 0:
        raise ValueError("The rotation axis cannot be zero.")
    # Axis components and point coordinates use the same reference frame.
    # Rodrigues' formula uses a unit axis and an angle in radians.
    omega = axis / length
    theta = angle * sp.pi / 180 if angle_unit == "deg" else angle
    W = skew(omega)
    return sp.eye(3) + sp.sin(theta) * W + (1 - sp.cos(theta)) * W**2`,
    homogeneous: `def homogeneous(rotation_matrix, position=None):
    """Put a rotation and translation into a 4 x 4 homogeneous matrix."""
    if position is None:
        position = sp.zeros(3, 1)
    T = sp.eye(4)
    T[:3, :3] = rotation_matrix
    T[:3, 3] = sp.Matrix(position)
    return T


def as_matrix(value):
    # Screw coordinates are a result, not a matrix to multiply implicitly.
    if isinstance(value, dict):
        raise ValueError("Enter omega, v and theta in an Exponential block before composing this screw.")
    return value


def to_homogeneous(value):
    """Promote a rotation or translation before composing unlike block types."""
    matrix = as_matrix(value)
    if matrix.shape == (4, 4):
        return matrix
    if matrix.shape == (3, 3):
        return homogeneous(matrix)
    if matrix.shape == (3, 1):
        return homogeneous(sp.eye(3), matrix)
    raise ValueError("Expected a 3 x 3 rotation, 3-vector, or 4 x 4 transform.")`,
    compose: `def compose(left, right):
    """An A -> B connection computes A * B, acting on column vectors."""
    A, B = as_matrix(left), as_matrix(right)
    if A.shape == (3, 3) and B.shape == (3, 3):
        return A * B
    if A.shape == (3, 1) and B.shape == (3, 1):
        return A + B
    # For example, R -> p means [R, 0] * [I, p] = [R, R*p].
    # The rightmost transformation acts first on a point.
    return to_homogeneous(A) * to_homogeneous(B)`,
    exponential: `def screw_exponential(omega, v, displacement, angle_unit="rad"):
    """Evaluate exp([S] * theta), where S = (omega, v)."""
    # Both omega and v are expressed in the same reference frame.
    omega, v = sp.Matrix(omega), sp.Matrix(v)
    length = sp.sqrt(omega.dot(omega))
    if length == 0:
        # A prismatic screw has no angular component: theta is a distance.
        # The angle-unit control does not convert this displacement.
        return homogeneous(sp.eye(3), v * displacement)
    theta = displacement * sp.pi / 180 if angle_unit == "deg" else displacement
    W = skew(omega)
    phase = length * theta
    # These formulas also work when omega has not been normalized.
    R = sp.eye(3) + sp.sin(phase) / length * W
    R += (1 - sp.cos(phase)) / length**2 * W**2
    # G integrates the rotation along the screw motion; p = G * v.
    G = theta * sp.eye(3) + (1 - sp.cos(phase)) / length**2 * W
    G += (phase - sp.sin(phase)) / length**3 * W**2
    return homogeneous(R, G * v)`,
    rigid: `def check_rigid(T):
    """Check the defining conditions of a rigid homogeneous transformation."""
    if T.shape != (4, 4) or any(sp.simplify(T[3, i] - (1 if i == 3 else 0)) != 0 for i in range(4)):
        raise ValueError("A homogeneous matrix must end with [0, 0, 0, 1].")
    if not T.free_symbols:
        # Numeric input must be orthonormal and have determinant +1.
        R = T[:3, :3]
        errors = list(R.T * R - sp.eye(3)) + [R.det() - 1]
        if any(abs(complex(sp.N(error))) > 1e-6 for error in errors):
            raise ValueError("The rotation must be orthonormal with determinant +1.")
    return T`,
    inverse: `def rigid_inverse(value):
    """Invert a rigid motion without a general matrix-inversion algorithm."""
    matrix = as_matrix(value)
    if matrix.shape == (3, 1):
        return -matrix
    if matrix.shape == (3, 3):
        check_rigid(to_homogeneous(matrix))
        return matrix.T
    T = check_rigid(to_homogeneous(matrix))
    R, p = T[:3, :3], T[:3, 3]
    # Inverse rotation is R.T; inverse translation is expressed in that frame.
    return homogeneous(R.T, -R.T * p)`,
    logarithm: `def matrix_to_screw(value):
    """Extract a principal screw (omega, v, theta) from a numeric rigid motion."""
    T_symbolic = check_rigid(to_homogeneous(value))
    if T_symbolic.free_symbols:
        raise ValueError("Set numeric symbol values before extracting a screw.")
    T = np.array(T_symbolic.evalf(), dtype=float)
    if not np.isfinite(T).all():
        raise ValueError("The transformation must contain finite real values.")
    R, p = T[:3, :3], T[:3, 3]
    cosine = np.clip((np.trace(R) - 1) / 2, -1.0, 1.0)
    antisymmetric = np.array([R[2, 1] - R[1, 2], R[0, 2] - R[2, 0], R[1, 0] - R[0, 1]])
    sine = np.linalg.norm(antisymmetric) / 2
    theta = np.arctan2(sine, cosine)
    if theta < 1e-10:
        # Pure translation: choose a unit direction and put its length in theta.
        theta = np.linalg.norm(p)
        omega = np.zeros(3)
        v = p / theta if theta > 1e-12 else np.zeros(3)
    else:
        if np.pi - theta < 1e-5:
            # Near 180 degrees, division by sin(theta) is unstable.
            # Recover the axis from the largest diagonal component instead.
            diagonal = np.maximum(0, (np.diag(R) + 1) / 2)
            k = int(np.argmax(diagonal))
            omega = np.zeros(3)
            omega[k] = np.sqrt(diagonal[k])
            for j in range(3):
                if j != k:
                    omega[j] = (R[k, j] + R[j, k]) / (4 * omega[k])
            if np.dot(omega, antisymmetric) < 0:
                omega = -omega
            omega /= np.linalg.norm(omega)
        else:
            omega = antisymmetric / (2 * np.sin(theta))
        W = np.array(skew(omega), dtype=float)
        # G^-1 is evaluated with a series near zero to avoid cancellation.
        coefficient = theta / 12 + theta**3 / 720 if theta < 1e-4 else 1 / theta - 0.5 / np.tan(theta / 2)
        inverse_G = np.eye(3) / theta - W / 2 + coefficient * (W @ W)
        v = inverse_G @ p
    # Rotational theta is in radians; a prismatic theta is a distance.
    return {"omega": sp.Matrix(omega), "v": sp.Matrix(v),
            "theta": float(theta), "matrix": T_symbolic}`
  };

  const MANIFEST_PREFIX = '# KINEMATICS_PLAYGROUND_V1: ';
  const PYTHON_RESERVED = new Set(('False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case sp np input_value output value angle_unit ' +
    'skew rotation homogeneous as_matrix to_homogeneous compose screw_exponential check_rigid rigid_inverse matrix_to_screw').split(' '));
  function pythonIdentifier(value, fallback = 'kinematic_function') {
    const greek = { θ: 'theta', α: 'alpha', ω: 'omega', ξ: 'xi', φ: 'phi' };
    let name = String(value || fallback).normalize('NFKD').replace(/[θαωξφ]/g, letter => greek[letter])
      .replace(/[^A-Za-z_0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 70) || fallback;
    if (/^[0-9]/.test(name) || PYTHON_RESERVED.has(name)) name = 'fn_' + name;
    return name;
  }
  function sourceFingerprint(source) {
    const canonical = String(source).replace(/\r\n?/g, '\n').split('\n')
      .filter(line => !line.startsWith(MANIFEST_PREFIX)).join('\n').replace(/\n+$/, '') + '\n';
    let hash = 0x811c9dc5;
    for (const byte of new TextEncoder().encode(canonical)) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
    return hash.toString(16).padStart(8, '0');
  }
  function encodeManifest(definition, source) {
    const bytes = new TextEncoder().encode(JSON.stringify({ definition, codeHash: sourceFingerprint(source) }));
    const encoded = typeof Buffer !== 'undefined' ? Buffer.from(bytes).toString('base64')
      : btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''));
    return MANIFEST_PREFIX + encoded + '\n';
  }
  const indent = source => String(source).split('\n').map(line => line ? '    ' + line : '').join('\n');
  function ancestorChain(graph, nodeId, standalone = false) {
    if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) throw new Error('A block graph is required.');
    const nodes = new Map(graph.nodes.map(node => [node.id, node])), chain = [], visiting = new Set();
    function visit(id) {
      if (visiting.has(id)) throw new Error('A connection cycle cannot be exported.');
      visiting.add(id);
      const node = nodes.get(id);
      if (!node) throw new Error('Select an existing block to export.');
      const inputs = standalone ? [] : graph.edges.filter(edge => edge.to === id);
      if (inputs.length > 1) throw new Error('Each block can have only one input.');
      if (inputs.length) {
        if (nodes.get(inputs[0].from)?.type === 'logarithm') throw new Error('A screw result contains ω, v and θ. Enter these in an Exponential block to compose its motion.');
        visit(inputs[0].from);
      }
      chain.push(node);
    }
    visit(nodeId); return chain;
  }
  function parameterExpressions(node) {
    const p = node.params || {};
    if (node.type === 'rotation') return [...(p.axis || ['0', '0', '1']), p.angle === undefined ? 'theta' : p.angle];
    if (node.type === 'translation') return p.vector || ['0', '0', '0'];
    if (node.type === 'transform') return (p.matrix || []).flat();
    if (node.type === 'exponential') return [...(p.omega || ['0', '0', '1']), ...(p.v || ['0', '0', '0']), p.theta === undefined ? 'theta' : p.theta];
    if (node.type === 'function') return p.definition.parameters.map(name => p.arguments?.[name] === undefined ? name : p.arguments[name]);
    return [];
  }
  const nodeSymbols = node => [...new Set(parameterExpressions(node).flatMap(value => math.symbols(parseExpression(value))))].sort();
  function normalizedNode(node) {
    const p = node.params || {}, params = {};
    if (node.type === 'rotation') { params.axis = p.axis || ['0', '0', '1']; params.angle = p.angle === undefined ? 'theta' : p.angle; }
    else if (node.type === 'translation') params.vector = p.vector || ['0', '0', '0'];
    else if (node.type === 'transform') params.matrix = (p.matrix || []).flat();
    else if (node.type === 'exponential') { params.omega = p.omega || ['0', '0', '1']; params.v = p.v || ['0', '0', '0']; params.theta = p.theta === undefined ? 'theta' : p.theta; }
    else if (node.type === 'function') { params.definition = p.definition; params.arguments = p.arguments || {}; }
    return { id: String(node.id), type: node.type, label: String(node.label || node.type),
      params, position: node.position || { x: 0, y: 0 }, showMatrix: node.showMatrix === true };
  }
  function generatePython(graph, nodeId, options = {}) {
    if (!math) throw new Error('Load math.js before python.js.');
    const selected = graph?.nodes?.find(node => node.id === nodeId);
    if (!selected) throw new Error('Select a block to export.');
    const unary = selected.type === 'inverse' || selected.type === 'logarithm';
    const standalone = options.scope === 'block' && !unary;
    const chain = ancestorChain(graph, nodeId, standalone);
    const parameters = [...new Set(chain.flatMap(nodeSymbols))].sort();
    const name = options.functionName || (standalone ? selected.label || selected.type : 'forward_kinematics');
    const defaults = Object.fromEntries(parameters.filter(parameter => Object.hasOwn(graph.bindings || {}, parameter))
      .map(parameter => [parameter, String(graph.bindings[parameter])]));
    const definition = { version: 1, id: 'exported_function', name, kind: 'graph', parameters,
      angleUnit: graph.angleUnit === 'deg' ? 'deg' : 'rad', defaults,
      graph: { version: 1, name, angleUnit: graph.angleUnit === 'deg' ? 'deg' : 'rad', bindings: {},
        nodes: chain.map(normalizedNode), edges: chain.slice(1).map((node, index) => ({ from: String(chain[index].id), to: String(node.id) })) },
      outputId: String(nodeId) };
    const hasScrewResult = selected.type === 'logarithm';
    return compileExport(definition, { ...options, allowScrew: hasScrewResult,
      note: options.scope === 'block' && unary ? 'This unary operation includes its input chain so the exported function is callable on its own.' : '' });
  }
  function exportFunction(definition, options = {}) {
    return compileExport(definition, options);
  }
  function compileExport(inputDefinition, options) {
    const sourceDefinition = JSON.parse(JSON.stringify(inputDefinition));
    const definition = graphApi?.validateDefinition && !options.allowScrew ? graphApi.validateDefinition(sourceDefinition) : sourceDefinition;
    const usedNames = new Set(PYTHON_RESERVED), parameterIdentifiers = new Set(), needed = new Set(), declarations = [];
    function uniqueName(preferred) {
      const base = pythonIdentifier(preferred); let candidate = base, suffix = 2;
      while (usedNames.has(candidate) || parameterIdentifiers.has(candidate)) candidate = base + '_' + suffix++;
      usedNames.add(candidate); return candidate;
    }
    function parameterNames(parameters) {
      const names = new Map(), used = new Set(PYTHON_RESERVED);
      for (const name of parameters) {
        const base = /^value_\d+$/.test(name) ? 'arg_' + name : pythonIdentifier(name, 'parameter'); let id = base, suffix = 2;
        while (used.has(id)) id = base + '_' + suffix++;
        used.add(id); names.set(name, id);
      }
      return names;
    }
    function reserveParameterNames(def, depth = 0) {
      if (depth > 8) throw new Error('Reusable functions can be nested at most eight levels.');
      for (const name of parameterNames(def.parameters || []).values()) parameterIdentifiers.add(name);
      for (const node of def.graph?.nodes || []) if (node.type === 'function') reserveParameterNames(node.params.definition, depth + 1);
    }
    reserveParameterNames(definition);
    function source(value, names) {
      const ast = parseExpression(value);
      for (const name of math.symbols(ast)) if (!names.has(name)) throw new Error('Declare the function parameter ' + name + '.');
      return expressionCode(ast, names);
    }
    function vector(values, fallback, names) {
      const array = values === undefined ? fallback : values;
      if (!Array.isArray(array) || array.length !== 3) throw new Error('Vectors need three components.');
      return '[' + array.map(value => source(value, names)).join(', ') + ']';
    }
    function matrixCode(rows, names) {
      return 'sp.Matrix([\n' + rows.map(row => '    [' + row.map(value => source(value, names)).join(', ') + ']').join(',\n') + '\n])';
    }
    function functionText(name, parameters, body, label) {
      const rows = [comment(label), ...body];
      return 'def ' + name + '(' + parameters.join(', ') + '):\n' + indent(rows.join('\n'));
    }
    function compileDefinition(def, preferredName, depth = 0) {
      if (depth > 8) throw new Error('Reusable functions can be nested at most eight levels.');
      const name = uniqueName(preferredName || def.name), parameters = def.parameters || [], names = parameterNames(parameters);
      if (def.kind === 'matrix') {
        let matrix = matrixCode(def.matrix, names);
        if (def.outputKind === 'transform') { needed.add('rigid'); matrix = 'check_rigid(' + matrix + ')'; }
        if (def.outputKind === 'rotation') { needed.add('homogeneous'); needed.add('rigid'); matrix = 'check_rigid(to_homogeneous(' + matrix + '))[:3, :3]'; }
        declarations.push(functionText(name, parameters.map(parameter => names.get(parameter)), ['return ' + matrix], 'Reusable matrix function: ' + def.name));
        return { name, parameters, pythonParameters: parameters.map(parameter => names.get(parameter)) };
      }
      if (def.kind !== 'graph') throw new Error('A reusable function must contain a graph or a matrix.');
      const chain = ancestorChain(def.graph, def.outputId), body = [];
      chain.forEach((node, index) => {
        const ownParameters = parameters.filter(parameter => nodeSymbols(node).includes(parameter));
        const ownNames = parameterNames(ownParameters), functionName = uniqueName(name + '_block_' + (index + 1) + '_' + (node.label || node.type));
        const p = node.params || {}, unit = quote(def.angleUnit === 'deg' ? 'deg' : 'rad');
        const unary = node.type === 'inverse' || node.type === 'logarithm';
        let operation;
        if (node.type === 'rotation') {
          needed.add('skew'); needed.add('rotation');
          operation = 'rotation(' + vector(p.axis, ['0', '0', '1'], ownNames) + ', ' + source(p.angle === undefined ? 'theta' : p.angle, ownNames) + ', ' + unit + ')';
        } else if (node.type === 'translation') operation = 'sp.Matrix(' + vector(p.vector, ['0', '0', '0'], ownNames) + ')';
        else if (node.type === 'transform') {
          const entries = (p.matrix || []).flat();
          if (entries.length !== 16) throw new Error('A homogeneous matrix needs 16 entries.');
          needed.add('rigid'); operation = 'check_rigid(' + matrixCode(Array.from({ length: 4 }, (_, row) => entries.slice(row * 4, row * 4 + 4)), ownNames) + ')';
        } else if (node.type === 'exponential') {
          needed.add('skew'); needed.add('homogeneous'); needed.add('exponential');
          operation = 'screw_exponential(' + vector(p.omega, ['0', '0', '1'], ownNames) + ', ' + vector(p.v, ['0', '0', '0'], ownNames) + ', ' + source(p.theta === undefined ? 'theta' : p.theta, ownNames) + ', ' + unit + ')';
        } else if (unary) {
          if (!index) throw new Error('Connect an input before exporting ' + node.type + '.');
          needed.add('homogeneous'); needed.add('rigid'); needed.add(node.type);
          if (node.type === 'logarithm') needed.add('skew');
          operation = (node.type === 'inverse' ? 'rigid_inverse' : 'matrix_to_screw') + '(input_value)';
        } else if (node.type === 'function') {
          const inner = compileDefinition(p.definition, p.definition.name, depth + 1);
          operation = inner.name + '(' + inner.parameters.map(parameter => source(p.arguments?.[parameter] === undefined ? parameter : p.arguments[parameter], ownNames)).join(', ') + ')';
        } else throw new Error('Unknown block type: ' + node.type);
        declarations.push(functionText(functionName, unary ? ['input_value'] : ownParameters.map(parameter => ownNames.get(parameter)), ['return ' + operation], 'Block ' + (index + 1) + ': ' + (node.label || node.type)));
        const call = functionName + '(' + (unary ? 'value_' + index : ownParameters.map(parameter => names.get(parameter)).join(', ')) + ')';
        body.push(comment(node.label || node.type));
        if (!index || unary) body.push('value_' + (index + 1) + ' = ' + call);
        else { needed.add('homogeneous'); needed.add('compose'); body.push('value_' + (index + 1) + ' = compose(value_' + index + ', ' + call + ')'); }
      });
      body.push('return value_' + chain.length);
      declarations.push(functionText(name, parameters.map(parameter => names.get(parameter)), body,
        'Composed function: ' + def.name + '. Connections multiply left to right.'));
      return { name, parameters, pythonParameters: parameters.map(parameter => names.get(parameter)) };
    }
    const exported = compileDefinition(definition, options.functionName || definition.name);
    const examples = exported.parameters.map(parameter => {
      const value = definition.defaults?.[parameter];
      if (options.includeBindings && value !== undefined && String(value).trim() !== '') {
        const ast = parseExpression(value);
        if (math.symbols(ast).length) throw new Error('The value for ' + parameter + ' must be a numeric expression.');
        math.evaluate(ast);
        return 'sym_' + parameter + ' = ' + expressionCode(ast) + '  # Example value of ' + parameter;
      }
      return 'sym_' + parameter + ' = sp.Symbol(' + quote(parameter) + ', real=True)';
    });
    // Check a fully specified numeric example using the same real domain as the UI.
    if (options.includeBindings && exported.parameters.every(parameter => String(definition.defaults?.[parameter] ?? '').trim() !== '')) {
      if (definition.kind === 'matrix') definition.matrix.flat().forEach(value => math.evaluate(parseExpression(value), definition.defaults || {}));
      else if (graphApi?.evaluateGraph) {
        const results = graphApi.evaluateGraph({ ...definition.graph, bindings: definition.defaults || {} }, { numeric: true });
        const result = results.get(definition.outputId);
        if (result?.error) throw new Error(result.error);
      }
    }
    const hasLog = needed.has('logarithm'), lines = [
      '# Kinematic playground — reusable Python functions.',
      '# Requires SymPy' + (hasLog ? ' and NumPy.' : '.'),
      '# Vectors are columns. A -> B means A * B; B acts first on a point.',
      '# Function parameters stay variable; the __main__ section is only an example.',
      '# Extracted rotational screw angles are in radians.',
      'import sympy as sp'
    ];
    if (hasLog) lines.push('import numpy as np');
    if (options.note) lines.push('', comment(options.note));
    for (const helper of ['skew', 'rotation', 'homogeneous', 'compose', 'exponential', 'rigid', 'inverse', 'logarithm']) {
      if (needed.has(helper)) lines.push('', '', HELPERS[helper]);
    }
    for (const declaration of declarations) lines.push('', '', declaration);
    const example = [...examples, 'output = ' + exported.name + '(' + exported.parameters.map(parameter => 'sym_' + parameter).join(', ') + ')'];
    if (options.allowScrew) example.push('print("omega:")', 'sp.pprint(output["omega"])', 'print("v:")', 'sp.pprint(output["v"])', 'print("theta =", output["theta"])');
    else example.push('sp.pprint(sp.simplify(output))');
    lines.push('', '', '# Import this file and call ' + exported.name + '(' + exported.pythonParameters.join(', ') + ') with new values.',
      'if __name__ == "__main__":', indent(example.join('\n')));
    let result = lines.join('\n') + '\n';
    if (!options.allowScrew) result += encodeManifest(definition, result);
    return result;
  }
  return { generatePython, exportFunction, pythonIdentifier, sourceFingerprint, encodeManifest, MANIFEST_PREFIX };
});
