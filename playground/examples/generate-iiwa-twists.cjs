/* Rebuild the worked graph from Exercise 01's joint data, never from its answers. */
const fs = require('node:fs');
const path = require('node:path');

const sourcePath = path.resolve(__dirname, '../../lectures_main/assets/models/iiwa7/kuka_iiwa7_misaligned.urdf');
const outputPath = path.join(__dirname, 'exercise-01-iiwa7-twists.json');

function attributes(text) {
  return Object.fromEntries([...text.matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)].map(match => [match[1], match[2]]));
}
function parseJoints(xml) {
  const joints = [];
  for (const match of xml.matchAll(/<joint\b([^>]*)>([\s\S]*?)<\/joint>/g)) {
    const header = attributes(match[1]);
    // Transmission references have a joint name but no kinematic joint type.
    if (!header.type) continue;
    const element = tag => attributes(match[2].match(new RegExp('<' + tag + '\\b([^>]*)/?' + '>'))?.[1] || '');
    const origin = element('origin');
    const triple = value => (value || '0 0 0').trim().split(/\s+/).map(entry => {
      if (!Number.isFinite(Number(entry))) throw new Error('Non-numeric URDF origin or axis.');
      return entry;
    });
    const joint = { name: header.name, type: header.type, parent: element('parent').link,
      child: element('child').link, xyz: triple(origin.xyz), rpy: triple(origin.rpy), axis: triple(element('axis').xyz) };
    if ([joint.xyz, joint.rpy, joint.axis].some(values => values.length !== 3)) throw new Error('URDF vectors require three components.');
    joints.push(joint);
  }
  const byChild = new Map(joints.map(joint => [joint.child, joint]));
  const chain = [], seen = new Set();
  for (let child = 'iiwa_link_ee'; child !== 'world';) {
    if (seen.has(child)) throw new Error('The URDF joint graph contains a cycle.');
    seen.add(child);
    const joint = byChild.get(child);
    if (!joint) throw new Error('No world-to-iiwa_link_ee chain in the URDF.');
    chain.unshift(joint); child = joint.parent;
  }
  return chain;
}

function angleExpression(value) {
  const quarterTurns = Math.round(Number(value) / (Math.PI / 2));
  if (Math.abs(Number(value) - quarterTurns * Math.PI / 2) > 1e-12) return value;
  if (quarterTurns === 0) return '0';
  if (quarterTurns === 1) return 'pi/2';
  if (quarterTurns === -1) return '-pi/2';
  if (quarterTurns === 2) return 'pi';
  if (quarterTurns === -2) return '-pi';
  return quarterTurns + '*pi/2';
}

function originMatrix(joint) {
  // URDF fixed-axis RPY: R = Rz(yaw) Ry(pitch) Rx(roll).
  const [roll, pitch, yaw] = joint.rpy.map(angleExpression);
  const cr = 'cos(' + roll + ')', sr = 'sin(' + roll + ')';
  const cp = 'cos(' + pitch + ')', sp = 'sin(' + pitch + ')';
  const cy = 'cos(' + yaw + ')', sy = 'sin(' + yaw + ')';
  return [
    cy + '*' + cp, cy + '*' + sp + '*' + sr + '-' + sy + '*' + cr, cy + '*' + sp + '*' + cr + '+' + sy + '*' + sr, joint.xyz[0],
    sy + '*' + cp, sy + '*' + sp + '*' + sr + '+' + cy + '*' + cr, sy + '*' + sp + '*' + cr + '-' + cy + '*' + sr, joint.xyz[1],
    '-' + sp, cp + '*' + sr, cp + '*' + cr, joint.xyz[2],
    '0', '0', '0', '1'
  ];
}

function create(xml = fs.readFileSync(sourcePath, 'utf8')) {
  const joints = parseJoints(xml), nodes = [], edges = [];
  const node = (id, type, label, params, x, y) => {
    const value = { id, type, label, params, position: { x, y }, showMatrix: false };
    nodes.push(value); return value;
  };
  const edge = (from, to, input) => edges.push(input === undefined ? { from, to } : { from, to, input });
  let previous = null, index = 0;
  for (const joint of joints) {
    if (!['fixed', 'revolute'].includes(joint.type)) throw new Error('The worked graph expects fixed and revolute joints.');
    const movable = joint.type === 'revolute';
    if (movable) {
      index++;
      if (joint.axis.some((entry, component) => Number(entry) !== (component === 2 ? 1 : 0))) {
        throw new Error('Column 3 extracts the declared axis only when that axis is [0, 0, 1].');
      }
    }
    const id = movable ? 'world_joint_' + index : joint.child === 'iiwa_link_ee' ? 'home_M' : 'world_base';
    const x = movable ? 350 + 340 * (index - 1) : joint.child === 'iiwa_link_ee' ? 2730 : 10;
    const label = movable ? '^worldT_J' + index + '(0)' : joint.child === 'iiwa_link_ee' ? 'M = ^worldT_ee(0)' : '^worldT_0 · fixed base';
    node(id, 'transform', label, { matrix: originMatrix(joint) }, x, 20);
    if (previous) edge(previous, id);
    previous = id;
    if (!movable) continue;

    node('omega_' + index, 'columns', '^worldω_' + index + ' · axis = column 3', { columns: [3], rowStart: 1, rowCount: 3 }, x, 340);
    node('point_' + index, 'columns', '^worldp_J' + index + ' · point = column 4', { columns: [4], rowStart: 1, rowCount: 3 }, x, 660);
    edge(id, 'omega_' + index, 'c0'); edge(id, 'point_' + index, 'c0');

    node('linear_' + index, 'cross', '^worldv_' + index + ' = ^worldp_J' + index + ' × ^worldω_' + index, {}, x, 980);
    edge('point_' + index, 'linear_' + index, 'a'); edge('omega_' + index, 'linear_' + index, 'b');

    node('twist_' + index, 'stack', '^worldξ_' + index + ' = [^worldω_' + index + '; ^worldv_' + index + ']', {}, x, 1300);
    edge('omega_' + index, 'twist_' + index, 'a'); edge('linear_' + index, 'twist_' + index, 'b');
  }
  if (index !== 7) throw new Error('Expected seven revolute joints for the KUKA iiwa 7 example.');

  node('six_column_minor', 'columns', 'Selected square matrix · columns 1–6', { columns: [1, 2, 3, 4, 5, 6], rowStart: 1, rowCount: 6 }, 1710, 1660);
  for (let column = 0; column < 6; column++) edge('space_screws', 'six_column_minor', 'c' + column);
  node('minor_determinant', 'determinant', 'det(columns 1–6) = 0 at home', {}, 2050, 1660);
  edge('six_column_minor', 'minor_determinant');

  // Put the main answer last so opening the file selects this output.
  node('space_screws', 'columns', '^worldJ_s(0) = [^worldξ_1 … ^worldξ_7]', { columns: [1, 1, 1, 1, 1, 1, 1], rowStart: 1, rowCount: 6 }, 1370, 1660);
  for (let joint = 1; joint <= 7; joint++) edge('twist_' + joint, 'space_screws', 'c' + (joint - 1));
  return { version: 1, name: 'Exercise 01 · KUKA iiwa 7 · world twists at home', angleUnit: 'rad', nodes, edges, bindings: {} };
}

if (require.main === module) {
  fs.writeFileSync(outputPath, JSON.stringify(create(), null, 2) + '\n');
  process.stdout.write('Wrote ' + path.relative(process.cwd(), outputPath) + '\n');
}
module.exports = { create, parseJoints, sourcePath, outputPath };
