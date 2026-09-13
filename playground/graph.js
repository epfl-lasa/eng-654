/* Graph validation and evaluation are independent of the canvas and DOM. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./math.js'));
  else root.KinematicsGraph = factory(root.KinematicsMath);
})(typeof window !== 'undefined' ? window : globalThis, function (MathEngine) {
  'use strict';
  const TYPES = new Set(['rotation', 'translation', 'transform', 'exponential', 'inverse', 'logarithm', 'function']);
  const DEFAULT_LABELS = { rotation: 'Rotation', translation: 'Translation', transform: 'Transformation',
    exponential: 'Screw exponential', inverse: 'Inverse', logarithm: 'Matrix to screw', function: 'Saved function' };
  const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
  const SCREW_OUTPUT_MESSAGE = 'A screw result contains ω, v and θ. Enter these in an Exponential block to compose its motion.';
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  function string(value, label, limit = 500) {
    if (typeof value !== 'string' || value.length > limit) throw new Error(label + ' must be text of at most ' + limit + ' characters.');
    return value;
  }
  function id(value) {
    if (typeof value !== 'string' || !/^[A-Za-z_0-9-]{1,60}$/.test(value)) throw new Error('Block IDs must use 1–60 letters, digits, underscores, or hyphens.');
    return value;
  }
  function vector(value, label, length = 3) {
    if (!Array.isArray(value) || value.length !== length) throw new Error(label + ' needs ' + length + ' entries.');
    return value.map(entry => string(entry, label + ' entry'));
  }
  function symbolName(name) {
    if (typeof name !== 'string' || !/^[A-Za-z_][A-Za-z_0-9]{0,79}$/.test(name) || DANGEROUS_KEYS.has(name) || name === 'pi') throw new Error('Invalid symbol name: ' + String(name));
    return name;
  }
  const validationContext = () => ({ active: new WeakSet(), count: 0 });
  function cleanParams(type, params, context, depth) {
    if (!object(params)) throw new Error('Each block must have a parameters object.');
    if (type === 'rotation') return { axis: vector(params.axis, 'Rotation axis'), angle: string(params.angle, 'Angle') };
    if (type === 'translation') return { vector: vector(params.vector, 'Translation') };
    if (type === 'transform') return { matrix: vector(params.matrix, 'Transformation matrix', 16) };
    if (type === 'exponential') return { omega: vector(params.omega, 'Angular screw'), v: vector(params.v, 'Linear screw'), theta: string(params.theta, 'Screw parameter') };
    if (type === 'function') {
      const definition = cleanDefinition(params.definition, context, depth + 1);
      if (params.arguments !== undefined && !object(params.arguments)) throw new Error('Function arguments must be an object.');
      const supplied = params.arguments || {}, args = {};
      for (const key of Object.keys(supplied)) {
        symbolName(key);
        if (!definition.parameters.includes(key)) throw new Error('Unknown function argument: ' + key);
      }
      for (const name of definition.parameters) args[name] = Object.hasOwn(supplied, name) ? string(supplied[name], 'Argument ' + name) : name;
      return { definition, arguments: args };
    }
    return {};
  }
  function validateGraph(candidate) { return cleanGraph(candidate, validationContext(), 0); }
  function cleanGraph(candidate, context, depth) {
    if (!object(candidate)) throw new Error('The file must contain a playground object.');
    if (candidate.version !== undefined && candidate.version !== 1) throw new Error('This playground file uses an unsupported version.');
    if (!Array.isArray(candidate.nodes) || candidate.nodes.length > 40) throw new Error('A playground must contain a blocks array with at most 40 blocks.');
    if (!Array.isArray(candidate.edges) || candidate.edges.length > 40) throw new Error('A playground must contain a connections array with at most 40 connections.');
    context.count += candidate.nodes.length;
    if (context.count > 200) throw new Error('Saved functions may contain at most 200 blocks in total.');
    const graph = { version: 1, name: candidate.name === undefined ? 'Untitled playground' : string(candidate.name, 'Playground name', 80),
      angleUnit: candidate.angleUnit === undefined ? 'rad' : candidate.angleUnit, nodes: [], edges: [], bindings: {} };
    if (!['rad', 'deg'].includes(graph.angleUnit)) throw new Error('Angle units must be rad or deg.');
    const ids = new Set(), nodeTypes = new Map();
    for (const source of candidate.nodes) {
      if (!object(source)) throw new Error('Each block must be an object.');
      const nodeId = id(source.id);
      if (ids.has(nodeId)) throw new Error('Every block must have a unique ID.');
      ids.add(nodeId);
      if (!TYPES.has(source.type)) throw new Error('Unknown block type: ' + String(source.type));
      nodeTypes.set(nodeId, source.type);
      const position = source.position;
      if (!object(position) || !Number.isFinite(position.x) || !Number.isFinite(position.y) || Math.abs(position.x) > 100000 || Math.abs(position.y) > 100000) {
        throw new Error('Block positions must be finite coordinates between −100000 and 100000.');
      }
      if (source.showMatrix !== undefined && typeof source.showMatrix !== 'boolean') throw new Error('The matrix display preference must be true or false.');
      graph.nodes.push({ id: nodeId, type: source.type,
        label: source.label === undefined ? DEFAULT_LABELS[source.type] : string(source.label, 'Block label', 80),
        params: cleanParams(source.type, source.params, context, depth), position: { x: position.x, y: position.y }, showMatrix: source.showMatrix === true });
    }
    const parents = new Map();
    for (const edge of candidate.edges) {
      if (!object(edge)) throw new Error('Each connection must be an object.');
      const from = id(edge.from), to = id(edge.to);
      if (!ids.has(from) || !ids.has(to)) throw new Error('A connection refers to a missing block.');
      if (nodeTypes.get(from) === 'logarithm') throw new Error(SCREW_OUTPUT_MESSAGE);
      if (from === to) throw new Error('A block cannot connect to itself.');
      if (parents.has(to)) throw new Error('Each block accepts only one input connection.');
      parents.set(to, from); graph.edges.push({ from, to });
    }
    const complete = new Set(), visiting = new Set();
    function visit(nodeId) {
      if (complete.has(nodeId)) return;
      if (visiting.has(nodeId)) throw new Error('Connections cannot form a cycle.');
      visiting.add(nodeId);
      if (parents.has(nodeId)) visit(parents.get(nodeId));
      visiting.delete(nodeId); complete.add(nodeId);
    }
    ids.forEach(visit);
    if (candidate.bindings !== undefined) {
      if (!object(candidate.bindings) || Object.keys(candidate.bindings).length > 256) throw new Error('Symbol values must be an object with at most 256 entries.');
      for (const [name, value] of Object.entries(candidate.bindings)) {
        symbolName(name);
        // Draft values stay editable. The safe math parser validates them when used.
        graph.bindings[name] = string(value, 'Value for ' + name);
      }
    }
    return graph;
  }
  function validateDefinition(candidate) { return cleanDefinition(candidate, validationContext(), 1); }
  function cleanDefinition(candidate, context, depth) {
    if (!object(candidate) || candidate.version !== 1) throw new Error('A saved function must use definition version 1.');
    if (depth > 8) throw new Error('Saved functions may be nested at most 8 levels deep.');
    if (context.active.has(candidate)) throw new Error('Saved functions cannot contain a recursive definition.');
    context.active.add(candidate);
    try {
      const definition = { version: 1, id: id(candidate.id), name: string(candidate.name, 'Function name', 80), kind: candidate.kind,
        parameters: [], angleUnit: candidate.angleUnit === undefined ? 'rad' : candidate.angleUnit, defaults: {} };
      if (!['rad', 'deg'].includes(definition.angleUnit)) throw new Error('Function angle units must be rad or deg.');
      if (!Array.isArray(candidate.parameters) || candidate.parameters.length > 256) throw new Error('A function needs a parameters array with at most 256 names.');
      definition.parameters = candidate.parameters.map(symbolName);
      if (new Set(definition.parameters).size !== definition.parameters.length) throw new Error('Function parameter names must be unique.');
      if (candidate.defaults !== undefined && !object(candidate.defaults)) throw new Error('Function defaults must be an object.');
      for (const [name, value] of Object.entries(candidate.defaults || {})) {
        symbolName(name);
        if (!definition.parameters.includes(name)) throw new Error('A default refers to an unknown function parameter: ' + name);
        definition.defaults[name] = string(value, 'Default for ' + name);
      }
      let names;
      if (definition.kind === 'graph') {
        definition.graph = cleanGraph(candidate.graph, context, depth);
        // A function carries a fixed angular convention; caller settings never change it.
        definition.graph.angleUnit = definition.angleUnit;
        definition.graph.bindings = {};
        definition.outputId = id(candidate.outputId);
        const chain = ancestorChain(definition.graph, definition.outputId);
        if (chain.length !== definition.graph.nodes.length) throw new Error('A function definition must contain only its output chain.');
        if (chain.at(-1).type === 'logarithm') throw new Error('Save a rotation, translation, or transformation output as a function. A screw result is not a matrix operation.');
        if (['inverse', 'logarithm'].includes(chain[0].type)) throw new Error('Include the input of an inverse or logarithm when saving a function.');
        for (const block of chain) {
          const expressions = block.type === 'function' ? Object.values(block.params.arguments) : Object.values(block.params).flat();
          for (const expression of expressions) MathEngine.parse(expression);
        }
        names = rawSymbols(definition.graph);
      } else if (definition.kind === 'matrix') {
        const dimensions = { rotation: [3, 3], translation: [3, 1], transform: [4, 4] };
        if (!Object.hasOwn(dimensions, candidate.outputKind)) throw new Error('A function output must be rotation, translation, or transform.');
        definition.outputKind = candidate.outputKind;
        const [rows, columns] = dimensions[definition.outputKind];
        if (!Array.isArray(candidate.matrix) || candidate.matrix.length !== rows) throw new Error('The function matrix has the wrong number of rows.');
        definition.matrix = candidate.matrix.map(row => vector(row, 'Function matrix row', columns));
        names = [...new Set(definition.matrix.flatMap(row => row.flatMap(entry => MathEngine.symbols(MathEngine.parse(entry)))))];
        if (definition.outputKind === 'transform' && definition.matrix[3].some((entry, index) =>
          MathEngine.symbols(entry).length || Math.abs(MathEngine.evaluate(entry) - (index === 3 ? 1 : 0)) > 1e-12)) {
          throw new Error('The bottom row must be [0, 0, 0, 1].');
        }
      } else throw new Error('Unknown saved function kind.');
      for (const name of names) if (!definition.parameters.includes(name)) throw new Error('Expose the function symbol “' + name + '” as a parameter.');
      return definition;
    } finally { context.active.delete(candidate); }
  }
  function rawSymbols(candidate) {
    const nodes = Array.isArray(candidate.nodes) ? candidate.nodes : [candidate], found = new Set();
    for (const node of nodes) {
      const expressions = node.type === 'function' ? Object.values(node.params.arguments || {}) : Object.values(node.params || {}).flat();
      for (const expression of expressions) {
        try { for (const name of MathEngine.symbols(MathEngine.parse(expression))) found.add(name); }
        catch (_) { /* Incomplete parameter drafts remain editable. */ }
      }
    }
    return [...found].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  }
  function ancestorChain(graph, nodeId) {
    const nodes = new Map(graph.nodes.map(node => [node.id, node])), parents = new Map(graph.edges.map(edge => [edge.to, edge.from]));
    if (!nodes.has(nodeId)) throw new Error('Choose an existing output block.');
    const chain = [];
    for (let current = nodeId; current !== undefined; current = parents.get(current)) chain.unshift(nodes.get(current));
    return chain;
  }
  function selectedChain(graph, selectedIds) {
    if (!Array.isArray(selectedIds) || !selectedIds.length) throw new Error('Select at least one block to combine.');
    const selected = new Set(selectedIds), nodes = graph.nodes.filter(node => selected.has(node.id));
    if (nodes.length !== selected.size) throw new Error('The selection contains a missing block.');
    const parents = new Map(graph.edges.map(edge => [edge.to, edge.from]));
    const starts = nodes.filter(node => !selected.has(parents.get(node.id)));
    if (starts.length !== 1) throw new Error('Select one connected chain of blocks to combine.');
    const chain = [], seen = new Set();
    let current = starts[0];
    while (current) {
      chain.push(current); seen.add(current.id);
      const children = graph.edges.filter(edge => edge.from === current.id && selected.has(edge.to));
      if (children.length > 1) throw new Error('Combine a single chain, without branches inside the selection.');
      current = children.length ? nodes.find(node => node.id === children[0].to) : null;
    }
    if (chain.length !== selected.size) throw new Error('Select consecutive connected blocks to combine.');
    if (graph.edges.some(edge => selected.has(edge.from) && !selected.has(edge.to) && edge.from !== chain.at(-1).id)) throw new Error('Only the last selected block may connect to blocks outside the selection.');
    if (['inverse', 'logarithm'].includes(chain[0].type)) throw new Error('Include the input of an inverse or logarithm when saving a function.');
    if (parents.has(chain[0].id) && chain.some(node => node.type === 'inverse')) throw new Error('Include the complete input chain before combining an inverse; it acts on that whole input.');
    return chain;
  }
  function definitionFromChain(graph, chain, options = {}) {
    const ids = new Set(chain.map(node => node.id));
    const local = { version: 1, name: options.name || chain.at(-1).label, angleUnit: graph.angleUnit,
      nodes: chain, edges: graph.edges.filter(edge => ids.has(edge.from) && ids.has(edge.to)), bindings: {} };
    const parameters = rawSymbols(local), defaults = {};
    for (const name of parameters) if (Object.hasOwn(graph.bindings, name)) defaults[name] = graph.bindings[name];
    return validateDefinition({ version: 1, id: options.id || 'function_' + chain[0].id, name: options.name || chain.at(-1).label,
      kind: 'graph', parameters, angleUnit: graph.angleUnit, defaults, graph: local, outputId: chain.at(-1).id });
  }
  function captureFunction(candidate, selectedIds, options = {}) {
    const graph = validateGraph(candidate);
    return definitionFromChain(graph, selectedChain(graph, selectedIds), options);
  }
  function functionFromOutput(candidate, nodeId, options = {}) {
    const graph = validateGraph(candidate);
    return definitionFromChain(graph, ancestorChain(graph, nodeId), options);
  }
  function groupSelection(candidate, selectedIds, options = {}) {
    const graph = validateGraph(candidate), chain = selectedChain(graph, selectedIds);
    const definition = definitionFromChain(graph, chain, { id: options.id, name: options.label || options.name });
    const selected = new Set(selectedIds), nodeId = options.nodeId || chain[0].id;
    id(nodeId);
    if (graph.nodes.some(node => node.id === nodeId && !selected.has(node.id))) throw new Error('The combined block needs a unique ID.');
    const combined = { id: nodeId, type: 'function', label: options.label || definition.name,
      params: { definition, arguments: Object.fromEntries(definition.parameters.map(name => [name, name])) },
      position: { ...chain[0].position }, showMatrix: false };
    const nodes = graph.nodes.flatMap(node => node.id === chain[0].id ? [combined] : selected.has(node.id) ? [] : [node]);
    const edges = graph.edges.filter(edge => !(selected.has(edge.from) && selected.has(edge.to))).map(edge => ({
      from: selected.has(edge.from) ? nodeId : edge.from, to: selected.has(edge.to) ? nodeId : edge.to }));
    return { graph: validateGraph({ ...graph, nodes, edges }), nodeId, definition };
  }
  function replacementEdges(graph, from, to) {
    return [...graph.edges.filter(edge => edge.to !== to).map(edge => ({ from: edge.from, to: edge.to })), { from, to }];
  }
  function connect(graph, from, to) {
    const clean = validateGraph(graph);
    return validateGraph({ ...clean, edges: replacementEdges(clean, from, to) }).edges;
  }
  function canConnect(graph, from, to) {
    try { connect(graph, from, to); return null; }
    catch (error) { return error.message; }
  }
  function substitute(expression, replacements) {
    const ast = MathEngine.parse(expression);
    function visit(value) {
      if (value.type === 'symbol' && Object.hasOwn(replacements, value.name)) return MathEngine.parse(replacements[value.name]);
      if (!value.args) return value;
      const result = { ...value, args: value.args.map(visit) };
      return MathEngine.symbols(result).length ? result : MathEngine.num(MathEngine.evaluate(result));
    }
    return visit(ast);
  }
  // Unlike display formatting, this lossless spelling preserves numeric precision
  // and is valid input for the safe expression parser when ungrouping a function.
  function expressionSource(expression) {
    const ast = MathEngine.parse(expression);
    if (ast.type === 'number') return String(ast.value);
    if (ast.type === 'symbol') return ast.name;
    if (ast.type === 'call') return ast.name + '(' + ast.args.map(expressionSource).join(',') + ')';
    if (ast.op === 'neg') return '(-' + expressionSource(ast.args[0]) + ')';
    return '(' + expressionSource(ast.args[0]) + ast.op + expressionSource(ast.args[1]) + ')';
  }
  function preparedParams(node, replacements, bindings, numeric) {
    const scalar = expression => {
      const ast = substitute(expression, replacements);
      return numeric ? MathEngine.num(MathEngine.evaluate(ast, bindings)) : ast;
    };
    return Object.fromEntries(Object.entries(node.params).map(([key, value]) => [key, Array.isArray(value) ? value.map(scalar) : scalar(value)]));
  }
  function evaluateFunction(node, replacements, bindings, numeric) {
    const definition = node.params.definition, argumentsByName = {};
    for (const name of definition.parameters) {
      const ast = substitute(node.params.arguments[name], replacements);
      argumentsByName[name] = numeric ? MathEngine.num(MathEngine.evaluate(ast, bindings)) : ast;
    }
    if (definition.kind === 'matrix') {
      const matrix = definition.matrix.map(row => row.map(entry => substitute(entry, argumentsByName)));
      const value = { kind: definition.outputKind, matrix };
      MathEngine.validateRigid(MathEngine.toHomogeneous(value), bindings, numeric);
      return value;
    }
    const results = evaluateCleanGraph(definition.graph, { numeric, replacements: argumentsByName, bindings });
    const result = results.get(definition.outputId);
    if (result.error) throw new Error('Inside “' + definition.name + '”: ' + result.error);
    return result.value;
  }
  function evaluateGraph(candidate, { numeric = false } = {}) {
    const graph = validateGraph(candidate);
    return evaluateCleanGraph(graph, { numeric, replacements: {}, bindings: graph.bindings });
  }
  function evaluateCleanGraph(graph, { numeric, replacements, bindings }) {
    const nodes = new Map(graph.nodes.map(node => [node.id, node]));
    const parents = new Map(graph.edges.map(edge => [edge.to, edge.from]));
    const results = new Map();
    function evaluateNode(nodeId) {
      if (results.has(nodeId)) return results.get(nodeId);
      const node = nodes.get(nodeId), result = { value: null, ownValue: null, error: null };
      const parentId = parents.get(nodeId), parent = parentId === undefined ? null : evaluateNode(parentId);
      try {
        // Substitute before choosing an operation's formula. In particular,
        // a symbolic angular screw that becomes zero is a prismatic screw.
        // Numeric evaluation also avoids expanding a large symbolic product.
        const block = node.type === 'function' ? node : { ...node, params: preparedParams(node, replacements, bindings, numeric) };
        if (node.type === 'function') result.ownValue = evaluateFunction(node, replacements, bindings, numeric);
        else if (node.type !== 'inverse' && node.type !== 'logarithm') result.ownValue = MathEngine.computeBlock(block, null, bindings, graph.angleUnit);
        if (parent && parent.error) throw new Error('Fix the input from “' + nodes.get(parentId).label + '” first. ' + parent.error);
        if (node.type === 'inverse' || node.type === 'logarithm') {
          result.value = MathEngine.computeBlock(block, parent ? parent.value : null, bindings, graph.angleUnit);
          result.ownValue = result.value;
        } else result.value = MathEngine.compose(parent ? parent.value : null, result.ownValue);
      } catch (error) { result.error = error.message || 'This block could not be calculated.'; }
      results.set(nodeId, result); return result;
    }
    graph.nodes.forEach(node => evaluateNode(node.id));
    return results;
  }
  function expandFunction(candidate, nodeId) {
    const graph = validateGraph(candidate), node = graph.nodes.find(value => value.id === nodeId);
    if (!node || node.type !== 'function') throw new Error('Choose a saved function block to expand.');
    const definition = node.params.definition;
    if (definition.kind !== 'graph') throw new Error('An imported matrix function has no internal canvas blocks to expand.');
    const parent = graph.edges.find(edge => edge.to === nodeId), chain = ancestorChain(definition.graph, definition.outputId);
    if (parent && chain.some(block => block.type === 'inverse')) throw new Error('Disconnect this function’s input before expanding its inverse operation.');
    if (graph.nodes.length - 1 + chain.length > 40) throw new Error('Expanding this function would exceed the 40-block canvas limit.');
    const used = new Set(graph.nodes.map(block => block.id)), remap = new Map();
    for (const block of chain) {
      let suffix = 1, fresh = (nodeId + '_' + block.id).slice(0, 55);
      const stem = fresh;
      while (used.has(fresh)) fresh = stem + '_' + suffix++;
      used.add(fresh); remap.set(block.id, fresh);
    }
    const origin = chain[0].position;
    const nodes = chain.map(block => {
      let params;
      const source = expression => expressionSource(substitute(expression, node.params.arguments));
      if (block.type === 'function') params = { definition: block.params.definition,
        arguments: Object.fromEntries(Object.entries(block.params.arguments).map(([name, value]) => [name, source(value)])) };
      else {
        params = Object.fromEntries(Object.entries(block.params).map(([name, value]) => [name, Array.isArray(value) ? value.map(source) : source(value)]));
        if (definition.angleUnit !== graph.angleUnit) {
          let angular = block.type === 'rotation' ? 'angle' : block.type === 'exponential' ? 'theta' : null;
          if (block.type === 'exponential') {
            const axis = params.omega.map(MathEngine.parse);
            if (axis.every(value => !MathEngine.symbols(value).length)) {
              if (axis.every(value => MathEngine.evaluate(value) === 0)) angular = null;
            } else throw new Error('Match the canvas angle units to this function before expanding a symbolic screw axis.');
          }
          if (angular) params[angular] = '(' + params[angular] + ')*' + (definition.angleUnit === 'deg' ? '(pi/180)' : '(180/pi)');
        }
      }
      return { ...block, id: remap.get(block.id), params,
        position: { x: node.position.x + block.position.x - origin.x, y: node.position.y + block.position.y - origin.y } };
    });
    const firstId = nodes[0].id, outputId = remap.get(definition.outputId);
    const edges = graph.edges.filter(edge => edge.to !== nodeId && edge.from !== nodeId);
    if (parent) edges.push({ from: parent.from, to: firstId });
    for (const edge of graph.edges.filter(edge => edge.from === nodeId)) edges.push({ from: outputId, to: edge.to });
    edges.push(...definition.graph.edges.map(edge => ({ from: remap.get(edge.from), to: remap.get(edge.to) })));
    return { graph: validateGraph({ ...graph, nodes: graph.nodes.flatMap(block => block.id === nodeId ? nodes : [block]), edges }),
      nodeIds: nodes.map(block => block.id), outputId };
  }
  return { validateGraph, evaluateGraph, canConnect, connect, validateDefinition, rawSymbols,
    captureFunction, functionFromOutput, groupSelection, expandFunction };
});
