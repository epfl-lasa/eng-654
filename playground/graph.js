/* Graph validation and evaluation are independent of the canvas and DOM. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./math.js'));
  else root.KinematicsGraph = factory(root.KinematicsMath);
})(typeof window !== 'undefined' ? window : globalThis, function (MathEngine) {
  'use strict';
  const TYPES = new Set(['rotation', 'translation', 'transform', 'exponential', 'inverse', 'logarithm', 'function', 'matrix', 'scale', 'add', 'subtract', 'cross', 'columns', 'stack', 'determinant']);
  const DEFAULT_LABELS = { rotation: 'Rotation', translation: 'Translation', transform: 'Transformation',
    exponential: 'Screw exponential', inverse: 'Inverse', logarithm: 'Matrix to screw', function: 'Saved function',
    matrix: 'Matrix', scale: 'Scalar multiplier', add: 'Add vectors', subtract: 'Subtract vectors', cross: 'Cross product', columns: 'Select columns', stack: 'Stack rows', determinant: 'Determinant' };
  const EXPRESSION_KEYS = { rotation: ['axis', 'angle'], translation: ['vector'], transform: ['matrix'],
    exponential: ['omega', 'v', 'theta'], matrix: ['matrix'], scale: ['factor'] };
  const INPUT_OPERATIONS = new Set(['inverse', 'logarithm', 'scale', 'add', 'subtract', 'cross', 'columns', 'stack', 'determinant']);
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
  function dimension(value, label) {
    if (!Number.isInteger(value) || value < 1 || value > 12) throw new Error(label + ' must be an integer between 1 and 12.');
    return value;
  }
  function inputPorts(node) {
    if (node.type === 'add' || node.type === 'subtract' || node.type === 'cross' || node.type === 'stack') return ['a', 'b'];
    if (node.type === 'columns') return (node.params.columns || []).map((_, index) => 'c' + index);
    return ['input'];
  }
  function expressionParams(node) {
    const params = node.params || {};
    if (node.type === 'function') return Object.values(params.arguments || {});
    return (EXPRESSION_KEYS[node.type] || []).flatMap(key => Array.isArray(params[key]) ? params[key] : [params[key]]);
  }
  function mapExpressionParams(node, fn) {
    const params = { ...node.params };
    for (const key of EXPRESSION_KEYS[node.type] || []) params[key] = Array.isArray(params[key]) ? params[key].map(fn) : fn(params[key]);
    return params;
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
    if (type === 'scale') return { factor: string(params.factor, 'Scalar factor') };
    if (type === 'matrix') {
      const rows = dimension(params.rows, 'Rows'), columns = dimension(params.columns, 'Columns');
      return { rows, columns, matrix: vector(params.matrix, 'Matrix', rows * columns) };
    }
    if (type === 'columns') {
      if (!Array.isArray(params.columns) || params.columns.length < 1 || params.columns.length > 12) throw new Error('Select between 1 and 12 columns.');
      return { columns: params.columns.map(column => dimension(column, 'Column number')),
        rowStart: dimension(params.rowStart, 'First row'), rowCount: dimension(params.rowCount, 'Row count') };
    }
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
    if (!Array.isArray(candidate.nodes) || candidate.nodes.length > 120) throw new Error('A playground must contain a blocks array with at most 120 blocks.');
    if (!Array.isArray(candidate.edges) || candidate.edges.length > 240) throw new Error('A playground must contain a connections array with at most 240 connections.');
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
      if (source.minimized !== undefined && typeof source.minimized !== 'boolean') throw new Error('The minimized display preference must be true or false.');
      graph.nodes.push({ id: nodeId, type: source.type,
        label: source.label === undefined ? DEFAULT_LABELS[source.type] : string(source.label, 'Block label', 80),
        params: cleanParams(source.type, source.params, context, depth), position: { x: position.x, y: position.y }, showMatrix: source.showMatrix === true,
        ...(source.minimized === true ? { minimized: true } : {}) });
    }
    const parents = new Map(), occupied = new Set(), nodesById = new Map(graph.nodes.map(node => [node.id, node]));
    for (const edge of candidate.edges) {
      if (!object(edge)) throw new Error('Each connection must be an object.');
      const from = id(edge.from), to = id(edge.to);
      if (!ids.has(from) || !ids.has(to)) throw new Error('A connection refers to a missing block.');
      if (nodeTypes.get(from) === 'logarithm') throw new Error(SCREW_OUTPUT_MESSAGE);
      if (from === to) throw new Error('A block cannot connect to itself.');
      const input = edge.input === undefined ? 'input' : edge.input;
      if (!inputPorts(nodesById.get(to)).includes(input)) throw new Error('Unknown input port “' + String(input) + '” on ' + nodesById.get(to).label + '.');
      const slot = to + ':' + input;
      if (occupied.has(slot)) throw new Error('Each input port accepts only one input connection.');
      occupied.add(slot);
      if (!parents.has(to)) parents.set(to, []);
      parents.get(to).push(from);
      graph.edges.push(input === 'input' ? { from, to } : { from, to, input });
    }
    const complete = new Set(), visiting = new Set();
    function visit(nodeId) {
      if (complete.has(nodeId)) return;
      if (visiting.has(nodeId)) throw new Error('Connections cannot form a cycle.');
      visiting.add(nodeId);
      if (parents.has(nodeId)) parents.get(nodeId).forEach(visit);
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
        for (const block of chain) {
          if (INPUT_OPERATIONS.has(block.type) && inputPorts(block).some(input => !definition.graph.edges.some(edge => edge.to === block.id && (edge.input || 'input') === input))) {
            throw new Error('Include the input of every operation when saving a function; “' + block.label + '” has an unconnected input.');
          }
          const expressions = expressionParams(block);
          for (const expression of expressions) MathEngine.parse(expression);
        }
        names = rawSymbols(definition.graph);
      } else if (definition.kind === 'matrix') {
        const dimensions = { rotation: [3, 3], translation: [3, 1], transform: [4, 4], scalar: [1, 1] };
        if (candidate.outputKind === 'matrix') {
          const rows = dimension(candidate.matrix && candidate.matrix.length, 'Function matrix rows');
          const columns = dimension(candidate.matrix && candidate.matrix[0] && candidate.matrix[0].length, 'Function matrix columns');
          dimensions.matrix = [rows, columns];
        }
        if (!Object.hasOwn(dimensions, candidate.outputKind)) throw new Error('A function output must be a rotation, translation, transform, matrix, or scalar.');
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
      const expressions = expressionParams(node);
      for (const expression of expressions) {
        try { for (const name of MathEngine.symbols(MathEngine.parse(expression))) found.add(name); }
        catch (_) { /* Incomplete parameter drafts remain editable. */ }
      }
    }
    return [...found].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  }
  // Canvas symbols belong to one block. Function definitions retain their own
  // parameter scope; only their exposed arguments participate in this rename.
  function isolateSymbols(graph, editedId) {
    const reserved = new Set([...rawSymbols(graph), ...Object.keys(graph.bindings)]), owners = new Set(), changes = [];
    const nodes = [...graph.nodes].sort((a, b) => Number(a.id === editedId) - Number(b.id === editedId));
    for (const node of nodes) {
      const renames = Object.create(null);
      for (const name of rawSymbols(node)) {
        if (owners.has(name)) {
          let suffix = 2, next;
          do { next = name.slice(0, 73) + '_' + suffix++; } while (reserved.has(next));
          reserved.add(next); renames[name] = next;
          if (Object.hasOwn(graph.bindings, name)) graph.bindings[next] = graph.bindings[name];
          changes.push({nodeId:node.id, from:name, to:next});
        }
        owners.add(renames[name] || name);
      }
      if (!Object.keys(renames).length) continue;
      const rename = expression => MathEngine.normalizeInput(expression).replace(/[A-Za-z_][A-Za-z_0-9]*/g, name => renames[name] || name);
      if (node.type === 'function') node.params.arguments = Object.fromEntries(Object.entries(node.params.arguments).map(([key, value]) => [key, rename(value)]));
      else node.params = mapExpressionParams(node, rename);
    }
    return changes;
  }
  function ancestorChain(graph, nodeId) {
    const nodes = new Map(graph.nodes.map(node => [node.id, node])), parents = new Map();
    for (const edge of graph.edges) {
      if (!parents.has(edge.to)) parents.set(edge.to, []);
      parents.get(edge.to).push(edge.from);
    }
    if (!nodes.has(nodeId)) throw new Error('Choose an existing output block.');
    const chain = [], visited = new Set();
    function visit(current) {
      if (visited.has(current)) return;
      visited.add(current);
      (parents.get(current) || []).forEach(visit);
      chain.push(nodes.get(current));
    }
    visit(nodeId);
    return chain;
  }
  function selectedChain(graph, selectedIds) {
    if (!Array.isArray(selectedIds) || !selectedIds.length) throw new Error('Select at least one block to combine.');
    const selected = new Set(selectedIds), nodes = graph.nodes.filter(node => selected.has(node.id));
    if (nodes.length !== selected.size) throw new Error('The selection contains a missing block.');
    if (nodes.some(node => ['add', 'subtract', 'cross', 'columns', 'stack'].includes(node.type))) throw new Error('Save the output as a function to include every operand of a multi-input calculation. Combining a selection requires a single chain.');
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
    if (parents.has(chain[0].id) && chain.some(node => node.type === 'determinant')) throw new Error('Include the complete input chain before combining a determinant; it acts on that whole input.');
    if (parents.has(chain[0].id) && chain.some(node => node.type === 'scale')) throw new Error('Include the complete input chain before combining a scalar multiplier; it acts on that whole input.');
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
    const edges = graph.edges.filter(edge => !(selected.has(edge.from) && selected.has(edge.to))).map(edge => ({ ...edge,
      from: selected.has(edge.from) ? nodeId : edge.from, to: selected.has(edge.to) ? nodeId : edge.to }));
    return { graph: validateGraph({ ...graph, nodes, edges }), nodeId, definition };
  }
  function replacementEdges(graph, from, to, input) {
    return [...graph.edges.filter(edge => edge.to !== to || (edge.input || 'input') !== input), input === 'input' ? { from, to } : { from, to, input }];
  }
  function connect(graph, from, to, input = 'input') {
    const clean = validateGraph(graph);
    return validateGraph({ ...clean, edges: replacementEdges(clean, from, to, input) }).edges;
  }
  function canConnect(graph, from, to, input = 'input') {
    try { connect(graph, from, to, input); return null; }
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
    return mapExpressionParams(node, scalar);
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
      if (!['matrix', 'scalar'].includes(value.kind)) MathEngine.validateRigid(MathEngine.toHomogeneous(value), bindings, numeric);
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
    const parents = new Map();
    for (const edge of graph.edges) {
      if (!parents.has(edge.to)) parents.set(edge.to, []);
      parents.get(edge.to).push(edge);
    }
    const results = new Map();
    function evaluateNode(nodeId) {
      if (results.has(nodeId)) return results.get(nodeId);
      const node = nodes.get(nodeId), result = { value: null, ownValue: null, error: null };
      const incoming = parents.get(nodeId) || [], inputs = {};
      for (const edge of incoming) inputs[edge.input || 'input'] = evaluateNode(edge.from);
      const parent = inputs.input;
      try {
        // Substitute before choosing an operation's formula. In particular,
        // a symbolic angular screw that becomes zero is a prismatic screw.
        // Numeric evaluation also avoids expanding a large symbolic product.
        const block = node.type === 'function' ? node : { ...node, params: preparedParams(node, replacements, bindings, numeric) };
        if (node.type === 'function') result.ownValue = evaluateFunction(node, replacements, bindings, numeric);
        else if (!INPUT_OPERATIONS.has(node.type)) result.ownValue = MathEngine.computeBlock(block, null, bindings, graph.angleUnit);
        for (const edge of incoming) {
          const upstream = inputs[edge.input || 'input'];
          if (upstream.error) throw new Error('Fix the input from “' + nodes.get(edge.from).label + '” first. ' + upstream.error);
        }
        if (INPUT_OPERATIONS.has(node.type)) {
          const operand = ['add', 'subtract', 'cross', 'columns', 'stack'].includes(node.type)
            ? Object.fromEntries(Object.entries(inputs).map(([input, upstream]) => [input, upstream.value])) : parent ? parent.value : null;
          result.value = MathEngine.computeBlock(block, operand, bindings, graph.angleUnit);
          result.ownValue = result.value;
        } else result.value = MathEngine.compose(parent ? parent.value : null, result.ownValue);
      } catch (error) { result.error = error.message || 'This block could not be calculated.'; }
      results.set(nodeId, result); return result;
    }
    graph.nodes.forEach(node => evaluateNode(node.id));
    return results;
  }
  function materializeResult(candidate, nodeId, { consumeInputs = false } = {}) {
    const graph=validateGraph(candidate), node=graph.nodes.find(node=>node.id===nodeId);
    if(!node||!['add','subtract','scale','cross','columns','stack'].includes(node.type))throw new Error('Choose a vector or matrix operation result.');
    const result=evaluateGraph(graph).get(nodeId);
    if(result.error||!result.value?.matrix)throw new Error(result.error||'Connect valid inputs before editing the result.');
    const consumed=new Set();
    if(consumeInputs){
      const visit=id=>graph.edges.filter(edge=>edge.to===id).forEach(edge=>{if(!consumed.has(edge.from)){consumed.add(edge.from);visit(edge.from);}});
      visit(nodeId);
    }
    const matrix=result.value.matrix, rows=matrix.length, columns=matrix[0].length;
    node.type='matrix';node.label=columns===1?'Column vector':rows===1?'Row vector':'Matrix';
    node.params={rows,columns,matrix:matrix.flat().map(expressionSource)};
    graph.edges=graph.edges.filter(edge=>edge.to!==nodeId);
    if(consumeInputs){
      // Preserve sources needed by a different calculation, including their ancestors.
      let changed=true;
      while(changed){
        changed=false;
        for(const id of consumed)if(graph.edges.some(edge=>edge.from===id&&!consumed.has(edge.to))){consumed.delete(id);changed=true;}
      }
      graph.nodes=graph.nodes.filter(node=>!consumed.has(node.id));
      graph.edges=graph.edges.filter(edge=>!consumed.has(edge.from)&&!consumed.has(edge.to));
      delete node.minimized;
    }
    isolateSymbols(graph,nodeId);
    return validateGraph(graph);
  }
  function completeOperations(candidate) {
    let graph=candidate;
    const completed=[], failed=new Set();
    while(true){
      const results=evaluateGraph(graph);
      const ready=[...graph.nodes].reverse().find(node=>!failed.has(node.id)&&['add','subtract','scale','cross','columns','stack'].includes(node.type)&&!results.get(node.id).error&&results.get(node.id).value?.matrix);
      if(!ready)break;
      try{graph=materializeResult(graph,ready.id,{consumeInputs:true});completed.push(ready.id);}
      catch(_){failed.add(ready.id);}
    }
    return {graph,completed:completed.filter(id=>graph.nodes.some(node=>node.id===id))};
  }
  function expandFunction(candidate, nodeId) {
    const graph = validateGraph(candidate), node = graph.nodes.find(value => value.id === nodeId);
    if (!node || node.type !== 'function') throw new Error('Choose a saved function block to expand.');
    const definition = node.params.definition;
    if (definition.kind !== 'graph') throw new Error('An imported matrix function has no internal canvas blocks to expand.');
    const parent = graph.edges.find(edge => edge.to === nodeId), chain = ancestorChain(definition.graph, definition.outputId);
    if (parent && chain.some(block => block.type === 'inverse')) throw new Error('Disconnect this function’s input before expanding its inverse operation.');
    if (parent && chain.some(block => ['add', 'subtract', 'cross', 'columns', 'stack', 'determinant'].includes(block.type))) throw new Error('Disconnect this function’s input before expanding its multi-input or determinant calculation.');
    if (graph.nodes.length - 1 + chain.length > 120) throw new Error('Expanding this function would exceed the 120-block canvas limit.');
    if (parent && chain.some(block => block.type === 'scale')) throw new Error('Disconnect this function’s input before expanding its scalar multiplier.');
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
        params = mapExpressionParams(block, source);
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
    for (const edge of graph.edges.filter(edge => edge.from === nodeId)) edges.push({ ...edge, from: outputId });
    edges.push(...definition.graph.edges.map(edge => ({ ...edge, from: remap.get(edge.from), to: remap.get(edge.to) })));
    return { graph: validateGraph({ ...graph, nodes: graph.nodes.flatMap(block => block.id === nodeId ? nodes : [block]), edges }),
      nodeIds: nodes.map(block => block.id), outputId };
  }
  function layoutPositions(graph, sizes = new Map(), aspectRatio = 1.5) {
    const size = node => sizes.get(node.id) || {width:196, height:154};
    const parents = new Map(graph.nodes.map(node => [node.id, new Set()]));
    const neighbors = new Map(graph.nodes.map(node => [node.id, new Set()]));
    for (const edge of graph.edges) {
      parents.get(edge.to).add(edge.from);
      neighbors.get(edge.to).add(edge.from); neighbors.get(edge.from).add(edge.to);
    }
    const ranks = new Map();
    function rank(id) {
      if (!ranks.has(id)) ranks.set(id, Math.max(-1, ...[...parents.get(id)].map(rank)) + 1);
      return ranks.get(id);
    }
    const seen = new Set(), components = [];
    for (const root of graph.nodes) {
      if (seen.has(root.id)) continue;
      const ids = new Set(), queue = [root.id]; seen.add(root.id);
      for (const id of queue) {
        ids.add(id);
        for (const neighbor of neighbors.get(id)) if (!seen.has(neighbor)) { seen.add(neighbor); queue.push(neighbor); }
      }
      const layers = [];
      for (const node of graph.nodes.filter(node => ids.has(node.id))) (layers[rank(node.id)] ||= []).push(node);
      const heights = layers.map(layer => layer.reduce((height, node) => height + size(node).height, 0) + (layer.length - 1) * 55);
      const height = Math.max(...heights), positions = new Map();
      let x = 0;
      layers.forEach((layer, i) => {
        // Keep each column centred, with enough room for expanded matrices.
        let y = (height - heights[i]) / 2;
        for (const node of layer) { positions.set(node.id, {x, y}); y += size(node).height + 55; }
        x += Math.max(...layer.map(node => size(node).width)) + 90;
      });
      components.push({positions, width:x - 90, height});
    }
    // Pack disconnected calculations into rows instead of one very tall column.
    const targetWidth = Math.max(0, ...components.map(c => c.width), Math.sqrt(components.reduce((area, c) => area + (c.width + 90) * (c.height + 75), 0) * aspectRatio));
    const positions = new Map();
    let x = 0, y = 0, rowHeight = 0;
    for (const component of components) {
      if (x && x + component.width > targetWidth) { x = 0; y += rowHeight + 75; rowHeight = 0; }
      for (const [id, position] of component.positions) positions.set(id, {x:position.x + x, y:position.y + y});
      x += component.width + 90; rowHeight = Math.max(rowHeight, component.height);
    }
    return positions;
  }
  return { validateGraph, evaluateGraph, canConnect, connect, inputPorts, validateDefinition, rawSymbols, isolateSymbols, layoutPositions,
    captureFunction, functionFromOutput, groupSelection, expandFunction, materializeResult, completeOperations };
});
