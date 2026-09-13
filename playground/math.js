/* Kinematic expressions and matrix operations. No expression is evaluated as code. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KinematicsMath = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const FUNCTIONS = Object.freeze({ sin: Math.sin, cos: Math.cos, tan: Math.tan,
    sqrt: Math.sqrt, acos: Math.acos, atan2: Math.atan2 });
  const RESERVED_NAMES = new Set(['__proto__', 'constructor', 'prototype']);
  const SCREW_OUTPUT_MESSAGE = 'A screw result contains ω, v and θ. Enter these in an Exponential block to compose its motion.';
  const expressionSizes = new WeakMap();
  const MAX_EXPRESSION_SIZE = 2000;
  const expressionTooLarge = () => new Error('Expression too large; use numeric block parameters or shorten the chain.');
  function expressionSize(a) {
    if (expressionSizes.has(a)) return expressionSizes.get(a);
    const size = 1 + (a.args || []).reduce((sum, child) => sum + expressionSize(child), 0);
    if (size > MAX_EXPRESSION_SIZE) throw expressionTooLarge();
    expressionSizes.set(a, size); return size;
  }
  function checked(a) { expressionSize(a); return a; }
  const num = value => {
    if (!Number.isFinite(value)) throw new Error('This expression has no finite real value.');
    return { type: 'number', value: Object.is(value, -0) ? 0 : value };
  };
  const sym = name => ({ type: 'symbol', name });
  const isNum = (a, value) => a.type === 'number' && (value === undefined || a.value === value);
  const same = (a, b) => a === b || a.type === b.type && (a.type === 'number' ? a.value === b.value
    : a.type === 'symbol' ? a.name === b.name
      : a.op === b.op && a.name === b.name && a.args.length === b.args.length && a.args.every((child, i) => same(child, b.args[i])));
  function op(operator, a, b) {
    if (operator === 'neg') {
      if (isNum(a)) return num(-a.value);
      if (a.type === 'op' && a.op === 'neg') return a.args[0];
      return checked({ type: 'op', op: 'neg', args: [a] });
    }
    if (operator === '+' && isNum(a, 0)) return b;
    if ((operator === '+' || operator === '-') && isNum(b, 0)) return a;
    if (operator === '+' && b.type === 'op' && b.op === 'neg') return op('-', a, b.args[0]);
    if (operator === '+' && a.type === 'op' && a.op === 'neg') return op('-', b, a.args[0]);
    if (operator === '-' && b.type === 'op' && b.op === '-' && same(a, b.args[0])) return b.args[1];
    if (operator === '-' && same(a, b)) return num(0);
    if (operator === '-' && isNum(a, 0)) return op('neg', b);
    if (operator === '*' && (isNum(a, 0) || isNum(b, 0))) return num(0);
    if (operator === '*' && isNum(a, 1)) return b;
    if (operator === '*' && isNum(b, 1)) return a;
    if (operator === '*' && isNum(a, -1)) return op('neg', b);
    if (operator === '*' && isNum(b, -1)) return op('neg', a);
    if (operator === '*') {
      const negative = value => isNum(value) ? value.value < 0 : value.type === 'op' && value.op === 'neg';
      const magnitude = value => isNum(value) ? num(Math.abs(value.value)) : negative(value) ? value.args[0] : value;
      const aNegative = negative(a), bNegative = negative(b);
      if (aNegative || bNegative) {
        const product = op('*', magnitude(a), magnitude(b));
        return aNegative === bNegative ? product : op('neg', product);
      }
    }
    if (operator === '/' && isNum(b, 0)) throw new Error('Division by zero.');
    if (operator === '/' && isNum(b, 1)) return a;
    if (operator === '/' && isNum(a, 0)) return num(0);
    if (operator === '^' && isNum(b, 0)) return num(1);
    if (operator === '^' && isNum(b, 1)) return a;
    if (isNum(a) && isNum(b)) {
      if (operator === '+') return num(a.value + b.value);
      if (operator === '-') return num(a.value - b.value);
      if (operator === '*') return num(a.value * b.value);
      if (operator === '/') return num(a.value / b.value);
      if (operator === '^') return num(a.value ** b.value);
    }
    return checked({ type: 'op', op: operator, args: [a, b] });
  }
  function call(name, args) {
    if (!Object.hasOwn(FUNCTIONS, name)) throw new Error('Unknown function: ' + name);
    if (args.length !== (name === 'atan2' ? 2 : 1)) throw new Error(name + ' has the wrong number of arguments.');
    function numericCall(values) {
      const result = FUNCTIONS[name](...values);
      // Clean trigonometric roundoff at nonzero multiples of pi / 2, while
      // retaining small input angles and full precision in every matrix entry.
      return num(['sin', 'cos'].includes(name) && Math.abs(values[0]) > 0.1 && Math.abs(result) < 1e-14 ? 0 : result);
    }
    if (args.every(a => isNum(a))) return numericCall(args.map(a => a.value));
    // Exact multiples of pi are especially useful in D-H tables.
    if (args.every(a => symbols(a).length === 0)) return numericCall(args.map(a => evaluate(a)));
    return checked({ type: 'call', name, args });
  }

  function parse(source) {
    if (source && typeof source === 'object' && source.type) return checked(source);
    if (typeof source === 'number') return num(source);
    const text = String(source === undefined ? '' : source).trim();
    if (!text) throw new Error('Enter a number or a symbol.');
    if (text.length > 500) throw new Error('Please use an expression shorter than 500 characters.');
    const tokens = [];
    const regex = /\s*(?:(\d+(?:\.\d*)?|\.\d+)([eE][+-]?\d+)?|([A-Za-z_][A-Za-z_0-9]*)|([+\-*/^(),]))/y;
    let position = 0;
    while (position < text.length) {
      regex.lastIndex = position;
      const match = regex.exec(text);
      if (!match) throw new Error('Unexpected character at position ' + (position + 1) + '. Use * for multiplication.');
      if (match[3] && RESERVED_NAMES.has(match[3])) throw new Error('The name ' + match[3] + ' is reserved; use another symbol name.');
      if (match[3] && match[3].length > 80) throw new Error('Symbol names must be at most 80 characters; use a shorter name.');
      tokens.push(match[1] ? { kind: 'number', value: Number(match[1] + (match[2] || '')) }
        : match[3] ? { kind: 'name', value: match[3] } : { kind: match[4] });
      if (tokens.length > 256) throw new Error('This expression is too complex. Use fewer than 256 tokens.');
      position = regex.lastIndex;
    }
    let i = 0;
    const peek = kind => tokens[i] && tokens[i].kind === kind;
    const take = kind => { if (!peek(kind)) throw new Error('Expected ' + kind + '.'); return tokens[i++]; };
    function primary() {
      if (peek('number')) return num(take('number').value);
      if (peek('name')) {
        const name = take('name').value;
        if (!peek('(')) return sym(name);
        take('('); const args = [sum()];
        while (peek(',')) { take(','); args.push(sum()); }
        take(')'); return call(name, args);
      }
      if (peek('(')) { take('('); const result = sum(); take(')'); return result; }
      throw new Error('Expected a number, symbol, or parenthesized expression.');
    }
    function power() { const a = primary(); return peek('^') ? (take('^'), op('^', a, unary())) : a; }
    function unary() { if (peek('+')) { take('+'); return unary(); } if (peek('-')) { take('-'); return op('neg', unary()); } return power(); }
    function product() { let a = unary(); while (peek('*') || peek('/')) { const operator = tokens[i++].kind; a = op(operator, a, unary()); } return a; }
    function sum() { let a = product(); while (peek('+') || peek('-')) { const operator = tokens[i++].kind; a = op(operator, a, product()); } return a; }
    const result = sum();
    if (i !== tokens.length) throw new Error('Unexpected input. Use * between multiplied expressions.');
    return result;
  }

  function evaluate(expression, bindings = {}) {
    const a = parse(expression);
    if (a.type === 'number') return a.value;
    if (a.type === 'symbol') {
      if (a.name === 'pi') return Math.PI;
      if (!Object.hasOwn(bindings, a.name) || String(bindings[a.name]).trim() === '') throw new Error('Set a value for ' + a.name + '.');
      const value = typeof bindings[a.name] === 'number' ? bindings[a.name] : evaluate(parse(bindings[a.name]), {});
      if (!Number.isFinite(value)) throw new Error('The value for ' + a.name + ' must be finite.');
      return value;
    }
    const values = a.args.map(child => evaluate(child, bindings));
    if (a.type === 'call') return num(FUNCTIONS[a.name](...values)).value;
    if (a.op === 'neg') return -values[0];
    return op(a.op, num(values[0]), num(values[1])).value;
  }
  function symbols(expression) {
    const found = new Set();
    const visited = new WeakSet();
    function visit(a) {
      if (visited.has(a)) return;
      visited.add(a);
      if (a.type === 'symbol' && a.name !== 'pi') found.add(a.name);
      if (a.args) a.args.forEach(visit);
    }
    visit(parse(expression)); return [...found].sort();
  }
  function numberText(value) {
    if (Math.abs(value) < 1e-10) return '0';
    if (Number.isInteger(value)) return String(value);
    return String(Number(value.toPrecision(6)));
  }
  function format(expression) {
    const priority = a => a.type !== 'op' ? 10 : ({ '+': 1, '-': 1, '*': 2, '/': 2, neg: 3, '^': 4 })[a.op];
    function show(a, minimum = 0) {
      if (a.type === 'number') return numberText(a.value);
      if (a.type === 'symbol') return a.name;
      if (a.type === 'call') return a.name + '(' + a.args.map(x => show(x)).join(', ') + ')';
      const p = priority(a);
      let text;
      if (a.op === 'neg') text = '−' + show(a.args[0], p);
      else {
        const operator = ({ '+': ' + ', '-': ' − ', '*': '·', '/': '/', '^': '^' })[a.op];
        text = show(a.args[0], a.op === '^' ? p + 1 : p) + operator + show(a.args[1], ['-', '/'].includes(a.op) ? p + 1 : p);
      }
      if (text.length > 12000) throw expressionTooLarge();
      return p < minimum ? '(' + text + ')' : text;
    }
    return show(parse(expression));
  }
  function tex(expression) {
    const a = parse(expression);
    if (a.type === 'number') return numberText(a.value);
    if (a.type === 'symbol') {
      if (a.name === 'pi') return '\\pi';
      const match = /^(theta|alpha|beta|gamma|delta|omega|phi|psi|rho)(?:_?(\d+))?$/.exec(a.name);
      if (match) return '\\' + match[1] + (match[2] ? '_{' + match[2] + '}' : '');
      return a.name.replace(/_/g, '\\_');
    }
    if (a.type === 'call') return a.name === 'sqrt' ? '\\sqrt{' + tex(a.args[0]) + '}'
      : '\\operatorname{' + a.name + '}\\left(' + a.args.map(tex).join(',') + '\\right)';
    if (a.op === '/') return '\\frac{' + tex(a.args[0]) + '}{' + tex(a.args[1]) + '}';
    if (a.op === '^') return '{\\left(' + tex(a.args[0]) + '\\right)}^{' + tex(a.args[1]) + '}';
    const wrap = child => child.type === 'op' && ['+', '-'].includes(child.op) ? '\\left(' + tex(child) + '\\right)' : tex(child);
    if (a.op === 'neg') return '-' + wrap(a.args[0]);
    return wrap(a.args[0]) + ({ '+': '+', '-': '-', '*': '\\,' })[a.op] + wrap(a.args[1]);
  }

  const add = (a, b) => op('+', a, b);
  const sub = (a, b) => op('-', a, b);
  const mul = (a, b) => op('*', a, b);
  const div = (a, b) => op('/', a, b);
  const neg = a => op('neg', a);
  const square = a => op('^', a, num(2));
  const identity = n => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => num(i === j ? 1 : 0)));
  const matrixMap = (a, fn) => a.map((row, i) => row.map((value, j) => fn(value, i, j)));
  const matrixAdd = (a, b) => matrixMap(a, (value, i, j) => add(value, b[i][j]));
  const matrixScale = (a, scalar) => matrixMap(a, value => mul(scalar, value));
  const transpose = a => a[0].map((_, j) => a.map(row => row[j]));
  const dot = (a, b) => a.reduce((result, value, i) => add(result, mul(value, b[i])), num(0));
  const norm = vector => call('sqrt', [vector.reduce((sum, a) => add(sum, square(a)), num(0))]);
  const skew = w => [[num(0), neg(w[2]), w[1]], [w[2], num(0), neg(w[0])], [neg(w[1]), w[0], num(0)]];
  function multiply(a, b) {
    if (!a.length || !b.length || a[0].length !== b.length) throw new Error('Matrix dimensions do not match.');
    return a.map(row => b[0].map((_, j) => dot(row, b.map(other => other[j]))));
  }
  function vector(values, label) {
    if (!Array.isArray(values) || values.length !== 3) throw new Error(label + ' needs three components.');
    return values.map(parse);
  }
  const asColumn = a => a.map(value => [value]);
  function homogeneous(rotation, position = [num(0), num(0), num(0)]) {
    return [...rotation.map((row, i) => [...row, position[i]]), [num(0), num(0), num(0), num(1)]];
  }
  function toHomogeneous(value) {
    if (Array.isArray(value)) {
      if (value.length === 4 && value[0].length === 4) return value;
      if (value.length === 3 && value[0].length === 3) return homogeneous(value);
      if (value.length === 3 && value[0].length === 1) return homogeneous(identity(3), value.map(row => row[0]));
      throw new Error('Expected a rotation, translation, or homogeneous matrix.');
    }
    if (!value || !value.matrix) throw new Error('Connect a matrix to this input.');
    return toHomogeneous(value.matrix);
  }
  function angle(value, unit) { const result = parse(value); return unit === 'deg' ? mul(result, div(sym('pi'), num(180))) : result; }
  function rotation(axis, theta) {
    const length = norm(axis);
    if (isNum(length, 0)) throw new Error('The rotation axis cannot be the zero vector.');
    const w = axis.map(a => div(a, length));
    const W = skew(w);
    const cos = call('cos', [theta]);
    const sin = call('sin', [theta]);
    return matrixAdd(matrixAdd(identity(3), matrixScale(W, sin)), matrixScale(multiply(W, W), sub(num(1), cos)));
  }
  function exponential(omega, v, theta) {
    const length = norm(omega);
    if (isNum(length, 0)) return homogeneous(identity(3), v.map(a => mul(a, theta)));
    const W = skew(omega), W2 = multiply(W, W);
    const phase = mul(length, theta), sin = call('sin', [phase]), cos = call('cos', [phase]);
    const R = matrixAdd(matrixAdd(identity(3), matrixScale(W, div(sin, length))), matrixScale(W2, div(sub(num(1), cos), square(length))));
    const G = matrixAdd(matrixAdd(matrixScale(identity(3), theta), matrixScale(W, div(sub(num(1), cos), square(length)))),
      matrixScale(W2, div(sub(phase, sin), mul(square(length), length))));
    return homogeneous(R, multiply(G, asColumn(v)).map(row => row[0]));
  }
  function numericMatrix(value, bindings = {}) {
    const matrix = Array.isArray(value) ? value : value && value.matrix;
    if (!matrix) throw new Error('No matrix is available.');
    return matrix.map(row => row.map(a => evaluate(a, bindings)));
  }
  function getSymbols(value) {
    const expressions = (value.matrix || []).flat();
    if (value.screw) expressions.push(...value.screw.omega, ...value.screw.v, value.screw.theta);
    return [...new Set(expressions.flatMap(symbols))].sort();
  }
  function validateRigid(matrix, bindings = {}, requireNumeric = false) {
    matrix = toHomogeneous(matrix);
    let values;
    try { values = numericMatrix(matrix, bindings); }
    catch (error) { if (!requireNumeric && getSymbols({ matrix }).some(name => !Object.hasOwn(bindings, name))) return; throw error; }
    if (values[3].some((a, i) => Math.abs(a - (i === 3 ? 1 : 0)) > 1e-12)) throw new Error('The bottom row must be [0, 0, 0, 1].');
    const R = values.slice(0, 3).map(row => row.slice(0, 3));
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      const scalar = R.reduce((sum, row) => sum + row[i] * row[j], 0);
      if (Math.abs(scalar - (i === j ? 1 : 0)) > 1e-6) throw new Error('The upper-left 3 × 3 matrix must be an orthonormal rotation.');
    }
    const det = R[0][0] * (R[1][1] * R[2][2] - R[1][2] * R[2][1]) - R[0][1] * (R[1][0] * R[2][2] - R[1][2] * R[2][0]) + R[0][2] * (R[1][0] * R[2][1] - R[1][1] * R[2][0]);
    if (Math.abs(det - 1) > 1e-6) throw new Error('A rotation matrix must have determinant +1.');
  }
  function validatedMatrix(value, bindings = {}) {
    const matrix = toHomogeneous(value);
    validateRigid(matrix, bindings, true);
    return numericMatrix(matrix, bindings);
  }
  function inverseValue(value, bindings = {}) {
    if (!value) throw new Error('Connect a block before taking its inverse.');
    if (value.kind === 'screw') throw new Error(SCREW_OUTPUT_MESSAGE);
    if (value.kind === 'translation') return { kind: 'translation', matrix: matrixMap(value.matrix, neg) };
    const T = toHomogeneous(value);
    validateRigid(T, bindings);
    const Rt = transpose(T.slice(0, 3).map(row => row.slice(0, 3)));
    if (value.kind === 'rotation') return { kind: 'rotation', matrix: Rt };
    const p = multiply(Rt, asColumn(T.slice(0, 3).map(row => row[3]))).map(row => neg(row[0]));
    return { kind: 'transform', matrix: homogeneous(Rt, p) };
  }
  function logValue(value, bindings = {}) {
    if (!value) throw new Error('Connect a rotation or transformation before extracting its screw.');
    if (value.kind === 'screw') throw new Error(SCREW_OUTPUT_MESSAGE);
    const source = toHomogeneous(value);
    validateRigid(source, bindings, true);
    const T = numericMatrix(source, bindings), R = T.slice(0, 3).map(row => row.slice(0, 3)), p = T.slice(0, 3).map(row => row[3]);
    const cosine = Math.max(-1, Math.min(1, (R[0][0] + R[1][1] + R[2][2] - 1) / 2));
    const antisymmetric = [R[2][1] - R[1][2], R[0][2] - R[2][0], R[1][0] - R[0][1]];
    const sine = Math.hypot(...antisymmetric) / 2;
    let theta = Math.atan2(sine, cosine), omega, v;
    if (theta < 1e-10) {
      theta = Math.hypot(...p);
      omega = [0, 0, 0]; v = theta > 1e-12 ? p.map(a => a / theta) : [0, 0, 0];
    } else {
      if (Math.PI - theta < 1e-5) {
        const diagonal = R.map((row, i) => Math.max(0, (row[i] + 1) / 2));
        const k = diagonal.indexOf(Math.max(...diagonal));
        omega = [0, 0, 0]; omega[k] = Math.sqrt(diagonal[k]);
        for (let j = 0; j < 3; j++) if (j !== k) omega[j] = (R[k][j] + R[j][k]) / (4 * omega[k]);
        if (omega.reduce((sum, a, i) => sum + a * antisymmetric[i], 0) < 0) omega = omega.map(a => -a);
        const length = Math.hypot(...omega); omega = omega.map(a => a / length);
      } else omega = antisymmetric.map(a => a / (2 * Math.sin(theta)));
      const W = skew(omega.map(num)), W2 = multiply(W, W);
      const coefficient = theta < 1e-4 ? theta / 12 + theta ** 3 / 720 : (1 / theta - 0.5 / Math.tan(theta / 2));
      const inverseG = matrixAdd(matrixAdd(matrixScale(identity(3), num(1 / theta)), matrixScale(W, num(-0.5))), matrixScale(W2, num(coefficient)));
      v = numericMatrix(multiply(inverseG, asColumn(p.map(num)))).map(row => row[0]);
    }
    return { kind: 'screw', matrix: T.map(row => row.map(num)), screw: { omega: omega.map(num), v: v.map(num), theta: num(theta) } };
  }
  function compose(a, b) {
    if (a && a.kind === 'screw' || b && b.kind === 'screw') throw new Error(SCREW_OUTPUT_MESSAGE);
    if (!a) return b;
    if (a.kind === 'rotation' && b.kind === 'rotation') return { kind: 'rotation', matrix: multiply(a.matrix, b.matrix) };
    if (a.kind === 'translation' && b.kind === 'translation') return { kind: 'translation', matrix: matrixAdd(a.matrix, b.matrix) };
    return { kind: 'transform', matrix: multiply(toHomogeneous(a), toHomogeneous(b)) };
  }
  function computeBlock(block, inputValue = null, bindings = {}, angleUnit = 'rad') {
    const params = block.params || {};
    let own;
    if (block.type === 'rotation') {
      const axis = vector(params.axis || ['0', '0', '1'], 'Axis');
      const names = [...new Set(axis.flatMap(symbols))];
      if (names.every(name => Object.hasOwn(bindings, name)) && evaluate(norm(axis), bindings) === 0) throw new Error('The rotation axis cannot be the zero vector.');
      own = { kind: 'rotation', matrix: rotation(axis, angle(params.angle === undefined ? 'theta' : params.angle, angleUnit)) };
    }
    else if (block.type === 'translation') own = { kind: 'translation', matrix: asColumn(vector(params.vector || ['0', '0', '0'], 'Translation')) };
    else if (block.type === 'transform') {
      let entries = params.matrix;
      if (Array.isArray(entries) && entries.length === 4 && Array.isArray(entries[0])) entries = entries.flat();
      if (!Array.isArray(entries) || entries.length !== 16) throw new Error('A homogeneous transformation needs 16 entries.');
      const matrix = Array.from({ length: 4 }, (_, i) => entries.slice(4 * i, 4 * i + 4).map(parse));
      if (matrix[3].some((a, i) => symbols(a).length || Math.abs(evaluate(a) - (i === 3 ? 1 : 0)) > 1e-12)) throw new Error('The bottom row must be [0, 0, 0, 1].');
      validateRigid(matrix, bindings);
      own = { kind: 'transform', matrix };
    } else if (block.type === 'exponential') {
      const omega = vector(params.omega || ['0', '0', '1'], 'Angular screw'), v = vector(params.v || ['0', '0', '0'], 'Linear screw');
      // A prismatic screw's parameter is a displacement, not an angle.
      const theta = angle(params.theta === undefined ? 'theta' : params.theta, omega.every(a => isNum(a, 0)) ? 'rad' : angleUnit);
      own = { kind: 'transform', matrix: exponential(omega, v, theta), screw: { omega, v, theta } };
    } else if (block.type === 'inverse') return inverseValue(inputValue, bindings);
    else if (block.type === 'logarithm') return logValue(inputValue, bindings);
    else throw new Error('Unknown block type: ' + block.type);
    return compose(inputValue, own);
  }
  return { parse, format, tex, evaluate, symbols, num, numberText, multiply, toHomogeneous, numericMatrix,
    getSymbols, computeBlock, compose, inverseValue, logValue, identity, rotation, exponential,
    validateRigid: (matrix, bindings = {}, requireNumeric = true) => validateRigid(matrix, bindings, requireNumeric), validatedMatrix };
});
