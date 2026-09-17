/* Student FK templates for the exact custom_3R.urdf model, in metres/radians. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./graph.js'));
  else root.KinematicsPresets = factory(root.KinematicsGraph);
})(typeof window !== 'undefined' ? window : globalThis, function (Graph) {
  'use strict';

  const source = '../lectures_main/assets/models/custom_3R/custom_3R.urdf';
  const descriptions = {
    'custom3r-poe': {
      label: 'Custom 3R · PoE FK',
      description: 'Three space screw exponentials followed by the home pose M. Screws are expressed in base_link at q = 0; the output is the pose of tool0 in base_link. Set q1, q2 and q3 in radians.',
      formula: 'T(q) = exp([S₁]q1) · exp([S₂]q2) · exp([S₃]q3) · M'
    },
    'custom3r-dh': {
      label: 'Custom 3R · D-H FK',
      description: 'Three 4 × 4 D-H transformations. Expand each block into Rz(q) · Tz(d) · Tx(a) · Rx(α). Their product is the pose of tool0 in base_link. The first d = 1 m includes both 0.5 m URDF joint-origin heights; q1, q2 and q3 are in radians.',
      formula: 'T(q) = ⁰T₁(q1) · ¹T₂(q2) · ²T₃(q3)'
    }
  };
  const names = Object.freeze(Object.keys(descriptions));

  function metadata(name) {
    if (!Object.hasOwn(descriptions, name)) return null;
    return { ...descriptions[name], source, baseFrame: 'base_link', toolFrame: 'tool0' };
  }
  function node(id, type, label, params, x, showMatrix = false) {
    return { id, type, label, params, position: { x, y: 50 }, showMatrix };
  }
  const connectChain = nodes => nodes.slice(1).map((block, index) => ({ from: nodes[index].id, to: block.id }));

  function dhBlock(index, a, alpha, d) {
    const q = 'q' + index, label = '^' + (index - 1) + 'T_' + index;
    const operations = [
      node('rz', 'rotation', 'Rz(' + q + ')', { axis: ['0', '0', '1'], angle: q }, 0),
      node('tz', 'translation', 'Tz(' + d + ')', { vector: ['0', '0', d] }, 310),
      node('tx', 'translation', 'Tx(' + a + ')', { vector: [a, '0', '0'] }, 620),
      node('rx', 'rotation', 'Rx(' + alpha + ')', { axis: ['1', '0', '0'], angle: alpha }, 930)
    ];
    const definition = Graph.validateDefinition({
      version: 1, id: 'custom3r_dh_' + index, name: label, kind: 'graph',
      parameters: [q], defaults: {}, angleUnit: 'rad', outputId: 'rx',
      graph: { version: 1, name: label + ' · D-H operations', angleUnit: 'rad',
        nodes: operations, edges: connectChain(operations), bindings: {} }
    });
    return node('b' + index, 'function', label, { definition, arguments: { [q]: q } }, 30 + (index - 1) * 310, true);
  }

  function create(name) {
    if (!Object.hasOwn(descriptions, name)) throw new Error('Unknown kinematics preset: ' + String(name));
    let nodes;
    if (name === 'custom3r-poe') {
      // The home joint axes in base_link are z, y, z, through points
      // (0,0,0.5), (1,0,1), (3,1.25,1). For each revolute screw, v = −ω × r.
      // Visual mesh offsets never enter FK; the fixed tool0 origin does.
      nodes = [
        node('b1', 'exponential', 'Joint 1 · S₁', { omega: ['0', '0', '1'], v: ['0', '0', '0'], theta: 'q1' }, 30),
        node('b2', 'exponential', 'Joint 2 · S₂', { omega: ['0', '1', '0'], v: ['-1', '0', '1'], theta: 'q2' }, 340),
        node('b3', 'exponential', 'Joint 3 · S₃', { omega: ['0', '0', '1'], v: ['1.25', '-3', '0'], theta: 'q3' }, 650),
        node('b4', 'transform', 'Home pose · M', { matrix: [
          '1', '0', '0', '4.5',
          '0', '1', '0', '1.25',
          '0', '0', '1', '1.25',
          '0', '0', '0', '1'
        ] }, 960)
      ];
    } else {
      // Standard D-H order: Rz(q_i) Tz(d_i) Tx(a_i) Rx(alpha_i).
      // These D-H intermediate frames differ from the URDF link frames,
      // but frame 0 is base_link and frame 3 is exactly tool0.
      nodes = [dhBlock(1, '1', '-pi/2', '1'), dhBlock(2, '2', 'pi/2', '1.25'), dhBlock(3, '1.5', '0', '0.25')];
    }
    return Graph.validateGraph({ version: 1, name: descriptions[name].label, angleUnit: 'rad',
      bindings: {}, nodes, edges: connectChain(nodes) });
  }

  return { names, metadata, create };
});
