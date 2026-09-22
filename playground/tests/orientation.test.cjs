const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const M = require('../math.js'), G = require('../graph.js'), F = require('../files.js'), P = require('../python.js');
const node = (id, type, params = {}) => ({ id, type, params, position: { x: 0, y: 0 }, label: id });
const matrix = (values) => M.computeBlock({ type: 'matrix', params: {
  rows: values.length, columns: values[0].length, matrix: values.flat().map(String)
} });
const vector = values => matrix(values.map(value => [value]));
const convert = (type, value, bindings = {}) => M.computeBlock({ type }, value, bindings);
const numbers = value => M.numericMatrix(value);
function close(actual, expected, tolerance = 2e-10) {
  if (Array.isArray(expected)) {
    assert.equal(actual.length, expected.length);
    expected.forEach((value, i) => close(actual[i], value, tolerance));
  } else assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
}
function source(type, values, angleUnit = 'rad') {
  return G.validateGraph({ nodes: [node('input', 'matrix', {
    rows: values.length, columns: values[0].length, matrix: values.flat().map(String)
  }), node('convert', type)], edges: [{ from: 'input', to: 'convert' }], angleUnit });
}
// Independent, explicit fixed-axis rotation formula.
function urdfRotation([r, p, y]) {
  const sr = Math.sin(r), cr = Math.cos(r), sp = Math.sin(p), cp = Math.cos(p), sy = Math.sin(y), cy = Math.cos(y);
  return [[cy*cp, cy*sp*sr-sy*cr, cy*sp*cr+sy*sr],
    [sy*cp, sy*sp*sr+cy*cr, sy*sp*cr-cy*sr], [-sp, cp*sr, cp*cr]];
}

test('identity and principal rotations use scalar-first qw,qx,qy,qz', () => {
  close(numbers(convert('rotationQuaternion', matrix([[1,0,0],[0,1,0],[0,0,1]]))), [[1],[0],[0],[0]]);
  for (let axis = 0; axis < 3; axis++) {
    const q = [0,0,0,0]; q[axis+1] = 1;
    const expected = Array.from({ length: 3 }, (_, i) => Array.from({ length: 3 }, (_, j) => i === j ? i === axis ? 1 : -1 : 0));
    const rotation = convert('rotationQuaternion', vector(q));
    close(numbers(rotation), expected);
    close(numbers(convert('rotationQuaternion', rotation)), q.map(value => [value]));
  }
  const half = Math.SQRT1_2;
  close(numbers(convert('rotationQuaternion', vector([half,0,0,half]))), [[0,-1,0],[1,0,0],[0,0,1]]);
});

test('all six conversion directions preserve URDF orientation, including pi and gimbal lock', () => {
  const cases = [[0,0,0], [.3,-.6,1.2], [Math.PI,.2,-2.5], [.8,Math.PI/2,1.1], [-.7,-Math.PI/2,2.4],
    [Math.PI-1e-10,0,0], [0,1e-11,-2e-11], [.3,Math.PI/2-1e-8,-.9]];
  for (let i=0;i<30;i++) cases.push([Math.sin(i)*3.1, Math.cos(i*1.7)*2.8, Math.sin(i*.7)*3]);
  for (const angles of cases) {
    const input = vector(angles), expected = urdfRotation(angles);
    const rotation = convert('rotationRPY', input), quaternion = convert('quaternionRPY', input);
    close(numbers(rotation), expected);
    close(numbers(convert('rotationQuaternion', quaternion)), expected);
    close(numbers(convert('rotationQuaternion', convert('rotationQuaternion', rotation))), expected);
    for (const rpy of [convert('rotationRPY', rotation), convert('quaternionRPY', quaternion)]) {
      close(numbers(convert('rotationRPY', rpy)), expected);
      assert.ok(Math.abs(numbers(rpy)[1][0]) <= Math.PI/2 + 1e-12);
      if (Math.abs(Math.cos(angles[1])) < 1e-12) assert.equal(numbers(rpy)[0][0], 0);
    }
  }
});

test('row and column inputs agree; nonunit quaternions normalize without overflow or underflow', () => {
  const q = [.5,-.5,.5,-.5], expected = numbers(convert('rotationQuaternion', vector(q)));
  for (const scale of [1,-1,7,1e300,1e-300]) {
    const values = q.map(value => value*scale);
    close(numbers(convert('rotationQuaternion', matrix([values]))), expected);
    close(numbers(convert('rotationQuaternion', vector(values))), expected);
  }
  for (const type of ['quaternionRPY','rotationRPY']) {
    close(numbers(convert(type, matrix([[.3,.4,.5]]))), numbers(convert(type, vector([.3,.4,.5]))));
  }
  const g = source('rotationRPY', [[0,0,'pi/2']], 'deg');
  close(numbers(G.evaluateGraph(g).get('convert').value), [[0,-1,0],[1,0,0],[0,0,1]]);
});

test('conversion errors identify missing inputs, invalid shapes, zero quaternions and invalid rotations', () => {
  for (const type of ['rotationQuaternion','quaternionRPY','rotationRPY']) {
    assert.throws(() => convert(type, null), /Connect/);
    assert.throws(() => convert(type, matrix([[1,0],[0,1]])), /Connect/);
  }
  for (const type of ['rotationQuaternion','quaternionRPY']) assert.throws(() => convert(type, vector([0,0,0,0])), /zero/);
  for (const type of ['rotationQuaternion','rotationRPY']) {
    assert.throws(() => convert(type, matrix([[2,0,0],[0,1,0],[0,0,1]])), /orthonormal/);
    assert.throws(() => convert(type, matrix([[-1,0,0],[0,1,0],[0,0,1]])), /determinant/);
  }
});

test('symbolic forward conversions and bound extraction remain live', () => {
  const angles = vector(['roll','pitch','yaw']), bindings = { roll:.4, pitch:-.7, yaw:1.1 };
  const rotation = convert('rotationRPY', angles), quaternion = convert('quaternionRPY', angles);
  close(M.numericMatrix(rotation, bindings), urdfRotation([.4,-.7,1.1]));
  close(numbers(convert('rotationQuaternion', quaternion, bindings)), urdfRotation([.4,-.7,1.1]));
  assert.throws(() => convert('rotationRPY', rotation), /numeric values/);
  close(numbers(convert('rotationRPY', rotation, bindings)), [[.4],[-.7],[1.1]]);
  const symbolicQ = convert('rotationQuaternion', vector(['qw','qx','qy','qz']));
  close(M.numericMatrix(symbolicQ, {qw:2,qx:0,qy:0,qz:2}), [[0,-1,0],[1,0,0],[0,0,1]]);
});

test('conversions survive workspace imports, reusable functions, expansion, and upstream edits', () => {
  for (const type of ['rotationQuaternion','quaternionRPY','rotationRPY']) {
    const input = type === 'rotationQuaternion' ? [['qw','qx','qy','qz']] : [['roll','pitch','yaw']];
    const g = source(type, input);
    g.bindings = type === 'rotationQuaternion' ? {qw:'2',qx:'1',qy:'-2',qz:'3'} : {roll:'.3',pitch:'-.4',yaw:'.7'};
    const expected = G.evaluateGraph(g, {numeric:true}).get('convert');
    assert.equal(expected.error, null);
    const def = G.functionFromOutput(g, 'convert', {id:'saved',name:'Convert orientation'});
    const restored = F.readFile(JSON.parse(JSON.stringify(F.workspaceFile(g,[def],'convert'))));
    close(numbers(G.evaluateGraph(restored.graph,{numeric:true}).get('convert').value), numbers(expected.value));
    const saved = G.validateGraph({nodes:[node('f','function',{definition:def,arguments:Object.fromEntries(Object.entries(g.bindings).map(([k,v])=>[k,String(v)]))})],edges:[]});
    close(numbers(G.evaluateGraph(saved).get('f').value), numbers(expected.value));
    const expanded = G.expandFunction(saved,'f');
    close(numbers(G.evaluateGraph(expanded.graph).get(expanded.outputId).value), numbers(expected.value));
    assert.equal(G.completeOperations(g).graph.nodes.at(-1).type,type, 'Conversion remains live instead of freezing its output');
  }
});

test('Python exports match all six directions and support scalar-first symbolic inputs', () => {
  const cases = [
    ['rotationQuaternion', [[0,-1,0],[1,0,0],[0,0,1]]], ['rotationQuaternion', [[0,1,0,0]]],
    ['quaternionRPY', [[.7,.2,-.3,.4]]], ['quaternionRPY', [[.5,-.3,.8]]],
    ['rotationRPY', [[.5,-.3,.8]]], ['rotationRPY', urdfRotation([.6,Math.PI/2,-.8])]
  ];
  let script = 'import sympy as sp\n';
  for (const [type, values] of cases) {
    const g = source(type, values), output = G.evaluateGraph(g).get('convert');
    assert.equal(output.error, null);
    const code = P.generatePython(g,'convert',{functionName:'convert_orientation'});
    script += `namespace={'__name__':'test_module'}\nexec(${JSON.stringify(code)},namespace)\n`;
    script += `actual=namespace['convert_orientation']()\nexpected=sp.Matrix(${JSON.stringify(numbers(output.value))})\nassert actual.shape == expected.shape\nassert max(abs(float(x)) for x in actual-expected)<2e-10\n`;
  }
  const symbolic = source('rotationQuaternion',[['qw','qx','qy','qz']]);
  script += `namespace={'__name__':'test_module'}\nexec(${JSON.stringify(P.generatePython(symbolic,'convert',{functionName:'convert_orientation'}))},namespace)\n`;
  script += "assert max(abs(float(x)) for x in namespace['convert_orientation'](1,0,0,0)-sp.eye(3))<1e-12\n";
  execFileSync('python3',['-c',script],{timeout:30000});
});
