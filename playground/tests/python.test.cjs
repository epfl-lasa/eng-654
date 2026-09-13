const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { generatePython, exportFunction, sourceFingerprint, MANIFEST_PREFIX } = require('../python.js');

const graph = (nodes, bindings = {}, angleUnit = 'rad') => ({
  nodes: nodes.map((node, i) => ({ id: String(i), ...node })),
  edges: nodes.slice(1).map((_, i) => ({ from: String(i), to: String(i + 1) })),
  bindings, angleUnit
});
const run = (source, check) => execFileSync('python3', ['-c', source + '\n' + check], { encoding: 'utf8', timeout: 30000 });
const runModule = (source, check) => run('', 'namespace = {"__name__": "saved_kinematics"}\nexec(' + JSON.stringify(source) + ', namespace)\nimport sympy as sp\n' + check);
const asDefinition = (example, name) => ({
  version: 1, id: 'saved_' + name, name, kind: 'graph', angleUnit: example.angleUnit,
  parameters: [...new Set(example.nodes.flatMap(node => {
    if (node.type === 'function') return Object.values(node.params.arguments).flatMap(value => require('../math.js').symbols(value));
    return Object.values(node.params || {}).flat().flatMap(value => require('../math.js').symbols(value));
  }))].sort(), defaults: example.bindings || {}, outputId: example.nodes.at(-1).id,
  graph: { ...example, nodes: example.nodes.map(node => ({ ...node, label: node.label || node.type, params: node.params || {}, position: { x: 0, y: 0 }, showMatrix: false })) }
});

test('a symbolic D-H chain exports executable and exact SymPy expressions', () => {
  const example = graph([
    { type: 'rotation', params: { axis: ['0', '0', '1'], angle: 'theta' } },
    { type: 'translation', params: { vector: ['0', '0', 'd'] } },
    { type: 'translation', params: { vector: ['a', '0', '0'] } },
    { type: 'rotation', params: { axis: ['1', '0', '0'], angle: 'alpha' } }
  ]);
  const source = generatePython(example, '3');
  assert.match(source, /rightmost transformation acts first/);
  run(source, `
c, s = sp.cos(sym_theta), sp.sin(sym_theta)
ca, sa = sp.cos(sym_alpha), sp.sin(sym_alpha)
expected = sp.Matrix([[c, -s*ca, s*sa, sym_a*c],
                      [s, c*ca, -c*sa, sym_a*s],
                      [0, sa, ca, sym_d], [0, 0, 0, 1]])
assert sp.simplify(output - expected) == sp.zeros(4)
`);
});

test('bound D-H parameters respect degrees and remain exact', () => {
  const example = graph([
    { type: 'rotation', params: { axis: ['0', '0', '2'], angle: 'theta' } },
    { type: 'translation', params: { vector: ['0', '0', 'd'] } },
    { type: 'translation', params: { vector: ['a', '0', '0'] } },
    { type: 'rotation', params: { axis: ['1', '0', '0'], angle: 'alpha' } }
  ], { theta: '90', alpha: '90', a: '2', d: '3' }, 'deg');
  run(generatePython(example, '3', { includeBindings: true }), `
assert output == sp.Matrix([[0, 0, 1, 0], [1, 0, 0, 2], [0, 1, 0, 3], [0, 0, 0, 1]])
`);
});

test('screw exponential uses the offset axis and prismatic displacement correctly', () => {
  const revolute = graph([{ type: 'exponential', params: { omega: ['0', '0', '1'], v: ['0', '-2', '0'], theta: 'pi/2' } }]);
  run(generatePython(revolute, '0'), `
assert output == sp.Matrix([[0, -1, 0, 2], [1, 0, 0, -2], [0, 0, 1, 0], [0, 0, 0, 1]])
`);
  const prismatic = graph([{ type: 'exponential', params: { omega: ['0', '0', '0'], v: ['1', '2', '0'], theta: '3' } }], {}, 'deg');
  run(generatePython(prismatic, '0'), 'assert output[:3, 3] == sp.Matrix([3, 6, 0])');
});

test('matrix logarithm round-trips near pi, identity and pure translation', () => {
  for (const angle of ['pi', 'pi-0.000001', '0']) {
    const example = graph([
      { type: 'exponential', params: { omega: ['1', '2', '3'], v: ['0.4', '-0.8', '0.1'], theta: '(' + angle + ')/sqrt(14)' } },
      { type: 'logarithm' }
    ]);
    run(generatePython(example, '1'), `
rebuilt = screw_exponential(output['omega'], output['v'], output['theta'])
assert np.allclose(np.array(rebuilt, dtype=float), np.array(output['matrix'], dtype=float), atol=1e-6)
`);
  }
  const translation = graph([
    { type: 'exponential', params: { omega: ['0', '0', '0'], v: ['0', '2', '0'], theta: '3' } },
    { type: 'logarithm' }
  ]);
  run(generatePython(translation, '1'), `
assert np.allclose(np.array(output['omega'], dtype=float).flatten(), [0, 0, 0])
assert np.allclose(np.array(output['v'], dtype=float).flatten(), [0, 1, 0])
assert output['theta'] == 6
`);
});

test('translation composition and inverse match block semantics', () => {
  const example = graph([
    { type: 'translation', params: { vector: ['1', '2', '3'] } },
    { type: 'translation', params: { vector: ['4', '5', '6'] } },
    { type: 'inverse' }
  ]);
  run(generatePython(example, '2'), 'assert output == sp.Matrix([-5, -7, -9])');
});

test('symbols, labels and malicious expressions cannot inject generated Python', () => {
  const example = graph([{ type: 'translation', label: 'Vector\nraise RuntimeError("injected")\rraise RuntimeError("carriage return")\u0000', params: { vector: ['lambda', 'sp', 'sin(theta)'] } }]);
  const source = generatePython(example, '0');
  assert.match(source, /# raise RuntimeError/);
  run(source, `
assert output[0] == sp.Symbol('lambda', real=True)
assert output[1] == sp.Symbol('sp', real=True)
assert output[2] == sp.sin(sp.Symbol('theta', real=True))
`);
  for (const expression of ["__import__('os').system('echo bad')", '1; print(1)', 'sp.pi', '[1][0]']) {
    example.nodes[0].params.vector[0] = expression;
    assert.throws(() => generatePython(example, '0'));
  }
});

test('export rejects cycles and multiple input edges', () => {
  const example = graph([{ type: 'translation' }, { type: 'translation' }]);
  example.edges.push({ from: '1', to: '0' });
  assert.throws(() => generatePython(example, '1'), /cycle/);
  example.edges = [{ from: '0', to: '1' }, { from: '0', to: '1' }];
  assert.throws(() => generatePython(example, '1'), /one input/);
});

test('screw coordinates are terminal and never silently compose their retained transform', () => {
  for (const type of ['rotation', 'translation', 'transform', 'exponential', 'inverse', 'logarithm']) {
    const example = graph([
      { type: 'translation', params: { vector: ['0', '0', '1'] } },
      { type: 'logarithm' },
      { type }
    ]);
    assert.throws(() => generatePython(example, '2'), /Enter these in an Exponential block/);
  }
  const example = graph([
    { type: 'translation', params: { vector: ['0', '0', '1'] } },
    { type: 'logarithm' }
  ]);
  run(generatePython(example, '1'), `
try:
    to_homogeneous(output)
except ValueError as error:
    assert "Exponential block" in str(error)
else:
    raise AssertionError("Screw coordinates must not silently become a matrix")
`);
});

test('numeric export uses the same finite real input domain as the playground', () => {
  const example = graph([{ type: 'translation', params: { vector: ['sqrt(a)', '0', '0'] } }], { a: '-1' });
  assert.throws(() => generatePython(example, '0', { includeBindings: true }), /finite real/);
  example.bindings.a = '4';
  run(generatePython(example, '0', { includeBindings: true }), 'assert output == sp.Matrix([2, 0, 0])');
});

test('saved FK functions accept new configurations and importing does not run the example', () => {
  const example = graph([
    { type: 'exponential', params: { omega: ['0', '0', '1'], v: ['0', '0', '0'], theta: 'q1' } },
    { type: 'exponential', params: { omega: ['0', '0', '1'], v: ['0', '-1', '0'], theta: 'q2' } },
    { type: 'translation', params: { vector: ['2', '0', '0'] } }
  ], { q1: '0', q2: '0' });
  const source = generatePython(example, '2', { functionName: 'FK', includeBindings: true });
  assert.match(source, /def FK\(q1, q2\):/);
  assert.match(source, /def FK_block_1_/);
  runModule(source, `
assert 'output' not in namespace, 'Import must not execute the example'
FK = namespace['FK']
home = FK(0, 0)
assert home[:3, 3] == sp.Matrix([2, 0, 0])
turned = sp.simplify(FK(sp.pi/2, sp.pi/2))
assert turned[:3, 3] == sp.Matrix([-1, 1, 0])
assert home != turned
`);
});

test('block scope exports only the selected primitive; unary scope includes its input', () => {
  const example = graph([
    { type: 'rotation', params: { axis: ['0', '0', '1'], angle: 'q' } },
    { type: 'translation', params: { vector: ['a', '0', '0'] } }
  ]);
  const source = generatePython(example, '1', { scope: 'block', functionName: 'Translate' });
  assert.match(source, /def Translate\(a\):/);
  assert.doesNotMatch(source, /def rotation\(/);
  runModule(source, "assert namespace['Translate'](3) == sp.Matrix([3, 0, 0])");
  example.nodes.push({ id: '2', type: 'inverse' });
  example.edges.push({ from: '1', to: '2' });
  const inverse = generatePython(example, '2', { scope: 'block', functionName: 'UndoMotion' });
  assert.match(inverse, /includes its input chain/);
  runModule(inverse, "assert namespace['UndoMotion'](3, 0)[:3, 3] == sp.Matrix([-3, 0, 0])");
});

test('nested graph and matrix functions preserve their parameter mappings and angle units', () => {
  const turn = asDefinition(graph([{ type: 'rotation', params: { axis: ['0', '0', '1'], angle: 'q' } }], {}, 'deg'), 'Turn');
  const move = { version: 1, id: 'saved_move', name: 'Move', kind: 'matrix', parameters: ['h'], defaults: {}, angleUnit: 'rad', outputKind: 'translation', matrix: [['h'], ['0'], ['0']] };
  const example = graph([
    { type: 'function', params: { definition: turn, arguments: { q: '2*t' } } },
    { type: 'function', params: { definition: move, arguments: { h: 'a' } } }
  ]);
  const source = exportFunction(asDefinition(example, 'NestedFK'));
  runModule(source, `
FK = namespace['NestedFK']
assert sp.simplify(FK(3, 45))[:3, 3] == sp.Matrix([0, 3, 0])
assert sp.simplify(FK(2, 0))[:3, 3] == sp.Matrix([2, 0, 0])
`);
});

test('display names and parameter names cannot shadow generated functions or intermediate values', () => {
  const example = graph([
    { type: 'translation', label: 'A', params: { vector: ['value_1', '0', '0'] } },
    { type: 'translation', label: 'B', params: { vector: ['value_1', '0', '0'] } }
  ]);
  const source = generatePython(example, '1', { functionName: '^0T_1' });
  assert.match(source, /def fn_0T_1\(arg_value_1\):/);
  runModule(source, "assert namespace['fn_0T_1'](4) == sp.Matrix([8, 0, 0])");
});

test('reimport metadata covers source edits and preserves the full reusable definition', () => {
  const definition = asDefinition(graph([{ type: 'rotation', params: { axis: ['0', '0', '1'], angle: 'q1' } }], { q1: 'pi/4' }), 'Joint');
  const source = exportFunction(definition, { functionName: 'FK' });
  assert.match(source, /def FK\(q1\):/);
  const line = source.split('\n').find(value => value.startsWith(MANIFEST_PREFIX));
  assert.ok(line);
  const manifest = JSON.parse(Buffer.from(line.slice(MANIFEST_PREFIX.length), 'base64').toString('utf8'));
  assert.equal(manifest.definition.name, 'Joint');
  assert.deepEqual(manifest.definition.parameters, ['q1']);
  assert.equal(manifest.definition.defaults.q1, 'pi/4');
  assert.equal(manifest.codeHash, sourceFingerprint(source));
  assert.equal(sourceFingerprint(source.replace(/\n/g, '\r\n')), manifest.codeHash);
  assert.notEqual(sourceFingerprint(source.replace('return rotation(', 'return 2 * rotation(')), manifest.codeHash);
});
