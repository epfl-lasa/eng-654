/* Exercise 02 scalar expressions, extracted from the playground arithmetic
 * parser. Keeping this dependency inside lectures_main supports the normal
 * course server as well as offline file:// use. Expressions are never code.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.Exercise02Expressions = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const FUNCTIONS = Object.freeze({ sin: Math.sin, cos: Math.cos, tan: Math.tan,
    sqrt: Math.sqrt, acos: Math.acos, atan2: Math.atan2 });
  const RESERVED_NAMES = new Set(['__proto__', 'constructor', 'prototype']);
  const expressionSizes = new WeakMap();
  const MAX_EXPRESSION_SIZE = 2000;
  const expressionTooLarge = () => new Error('Expression too large; shorten this formula.');
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
  return Object.freeze({ parse, evaluate, symbols });
}));
