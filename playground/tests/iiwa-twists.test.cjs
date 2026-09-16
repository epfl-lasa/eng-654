const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const K = require('../math.js');
const G = require('../graph.js');
const example = require('../examples/generate-iiwa-twists.cjs');
const saved = require('../examples/exercise-01-iiwa7-twists.json');
const answers = require('../../lectures_main/solutions/exercise_01_answers.json').answers;

function close(actual, expected, tolerance = 1e-9) {
  if (Array.isArray(expected)) {
    assert.equal(actual.length, expected.length);
    expected.forEach((value, i) => close(actual[i], value, tolerance));
  } else assert.ok(Math.abs(actual - expected) < tolerance, `${actual} differs from ${expected}`);
}
const multiply = (a, b) => a.map(row => b[0].map((_, j) => row.reduce((sum, value, k) => sum + value * b[k][j], 0)));
const identity = () => [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// Numeric FK uses only the raw URDF data and elementary rotations. It does not
// reuse the generator's origin expressions or the playground's matrix product.
function urdfChain(joints, q = Array(7).fill(0)) {
  let world = identity(), index = 0;
  const frames = [];
  for (const joint of joints) {
    const [r, p, y] = joint.rpy.map(Number), [x, yy, z] = joint.xyz.map(Number);
    const cr = Math.cos(r), sr = Math.sin(r), cp = Math.cos(p), sp = Math.sin(p), cy = Math.cos(y), sy = Math.sin(y);
    const Rx = [[1, 0, 0, 0], [0, cr, -sr, 0], [0, sr, cr, 0], [0, 0, 0, 1]];
    const Ry = [[cp, 0, sp, 0], [0, 1, 0, 0], [-sp, 0, cp, 0], [0, 0, 0, 1]];
    const Rz = [[cy, -sy, 0, 0], [sy, cy, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
    const translation = [[1, 0, 0, x], [0, 1, 0, yy], [0, 0, 1, z], [0, 0, 0, 1]];
    world = multiply(world, multiply(translation, multiply(Rz, multiply(Ry, Rx))));
    if (joint.type === 'revolute') {
      assert.deepEqual(joint.axis.map(Number), [0, 0, 1]);
      frames.push(world);
      const c = Math.cos(q[index]), s = Math.sin(q[index]);
      world = multiply(world, [[c, -s, 0, 0], [s, c, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]);
      index++;
    }
  }
  return { frames, M: world };
}

function evaluate(graph = saved, numeric = true) {
  const results = G.evaluateGraph(graph, { numeric });
  for (const [id, result] of results) assert.equal(result.error, null, id + ': ' + result.error);
  return id => K.numericMatrix(results.get(id).value);
}

test('downloadable iiwa graph regenerates from the exact exercise URDF and opens with the seven screws', () => {
  assert.deepEqual(saved, example.create());
  assert.deepEqual(G.validateGraph(saved), saved);
  assert.equal(saved.nodes.at(-1).id, 'space_screws');
  assert.equal(saved.nodes.length, 40);
  assert.equal(saved.edges.length, 64);
  assert.equal(saved.nodes.filter(node => node.type === 'cross').length, 7);
  assert.equal(saved.nodes.filter(node => node.type === 'stack').length, 7);
  assert.equal(saved.nodes.filter(node => node.type === 'transform').length, 9);
  const chain = example.parseJoints(fs.readFileSync(example.sourcePath, 'utf8'));
  assert.equal(chain[0].parent, 'world');
  assert.equal(chain.at(-1).child, 'iiwa_link_ee');
  assert.equal(chain.filter(joint => joint.type === 'fixed').length, 2);
});

test('both symbolic and numeric evaluation reproduce all 42 Exercise 01 screw entries and home M', () => {
  const components = ['wx', 'wy', 'wz', 'vx', 'vy', 'vz'];
  const expectedScrews = components.map(component => Array.from({ length: 7 }, (_, i) => Number(answers[`poe.${i + 1}.${component}`])));
  const expectedM = Array.from({ length: 4 }, (_, i) => Array.from({ length: 4 }, (_, j) => Number(answers[`poe.M.${i + 1}.${j + 1}`])));
  for (const numeric of [false, true]) {
    const output = evaluate(saved, numeric);
    close(output('space_screws'), expectedScrews);
    close(output('home_M'), expectedM);
    for (let joint = 1; joint <= 7; joint++) close(output('twist_' + joint), expectedScrews.map(row => [row[joint - 1]]));
  }
});

test('the graph axes, axis points and cross products follow independently propagated URDF frames', () => {
  const joints = example.parseJoints(fs.readFileSync(example.sourcePath, 'utf8'));
  const expected = urdfChain(joints), output = evaluate();
  expected.frames.forEach((frame, index) => {
    const joint = index + 1, omega = frame.slice(0, 3).map(row => row[2]), point = frame.slice(0, 3).map(row => row[3]);
    close(output('world_joint_' + joint), frame);
    close(output('omega_' + joint), omega.map(value => [value]));
    close(output('point_' + joint), point.map(value => [value]));
    close(output('linear_' + joint), cross(point, omega).map(value => [value]));
  });
  close(output('home_M'), expected.M);
});

test('the derived space screws reproduce URDF FK away from home and the home tool velocity', () => {
  const joints = example.parseJoints(fs.readFileSync(example.sourcePath, 'utf8'));
  const output = evaluate(), S = output('space_screws'), M = output('home_M');
  for (const q of [[0.3, -0.5, 0.2, 0.7, -0.1, 0.4, -0.25], [-0.8, 0.4, -0.6, -0.3, 0.7, -0.5, 0.2], [0, Math.PI / 4, 0, -Math.PI / 2, 0, Math.PI / 4, 0]]) {
    let pose = identity();
    for (let i = 0; i < 7; i++) {
      const xi = S.map(row => row[i]);
      const motion = K.computeBlock({ type: 'exponential', params: { omega: xi.slice(0, 3).map(String), v: xi.slice(3).map(String), theta: String(q[i]) } });
      pose = multiply(pose, K.numericMatrix(motion));
    }
    close(multiply(pose, M), urdfChain(joints, q).M);
  }
  const epsilon = 1e-6, point = M.slice(0, 3).map(row => row[3]);
  for (let i = 0; i < 7; i++) {
    const qPlus = Array(7).fill(0), qMinus = Array(7).fill(0);
    qPlus[i] = epsilon; qMinus[i] = -epsilon;
    const plus = urdfChain(joints, qPlus).M, minus = urdfChain(joints, qMinus).M;
    const measured = plus.slice(0, 3).map((row, j) => (row[3] - minus[j][3]) / (2 * epsilon));
    const rotationalVelocity = cross(S.slice(0, 3).map(row => row[i]), point);
    close(measured, rotationalVelocity.map((value, j) => value + S[j + 3][i]), 1e-8);
  }
});

test('all seven square six-column minors vanish at home; no determinant is taken of the six-by-seven matrix', () => {
  assert.deepEqual(saved.edges.find(edge => edge.to === 'minor_determinant'), { from: 'six_column_minor', to: 'minor_determinant' });
  for (let omitted = 1; omitted <= 7; omitted++) {
    const graph = structuredClone(saved);
    graph.nodes.find(node => node.id === 'six_column_minor').params.columns = [1, 2, 3, 4, 5, 6, 7].filter(column => column !== omitted);
    close(evaluate(graph)('minor_determinant'), [[0]]);
  }
  // Rows 2–4 contain a nonzero 3-by-3 minor; the remaining rows are zero.
  // This proves the README's exact rank-three statement at this home pose.
  const rankWitness = structuredClone(saved);
  rankWitness.nodes.find(node => node.id === 'six_column_minor').params = { columns: [1, 2, 4], rowStart: 2, rowCount: 3 };
  rankWitness.edges = rankWitness.edges.filter(edge => edge.to !== 'six_column_minor' || ['c0', 'c1', 'c2'].includes(edge.input));
  close(evaluate(rankWitness)('minor_determinant'), [[-0.4]]);
});

test('changing a URDF joint origin changes the derived screws and M instead of retaining canned answers', () => {
  const xml = fs.readFileSync(example.sourcePath, 'utf8');
  const changed = xml.replace(/(<joint name="iiwa_joint_2"[\s\S]*?<origin\b[^>]*xyz=")0 0 0\.19"/, '$10 0 0.29"');
  assert.notEqual(changed, xml);
  const output = evaluate(example.create(changed));
  close(output('linear_2'), [[-0.44], [0], [0]]);
  close(output('home_M')[2][3], 1.366);
  const unsupported = xml.replace(/(<joint name="iiwa_joint_1"[\s\S]*?<axis xyz=")0 0 1"/, '$11 0 0"');
  assert.throws(() => example.create(unsupported), /declared axis/);
});
