/* Safe numeric expressions shared by Exercise 01 imports and feedback. */
(function (root) {
    'use strict';

    // Recursive-descent arithmetic grammar: literals, pi, parentheses, unary
    // signs and + - * /. Never evaluate submitted text as JavaScript.
    function parseNumber(input) {
        if (input === undefined || input === null || (typeof input === 'string' && input.trim() === '')) {
            return { status: 'unanswered', value: null, message: 'Enter a value; a blank entry is not zero.' };
        }
        if (typeof input === 'number') {
            return Number.isFinite(input) ? { status: 'valid', value: input, message: '' }
                : { status: 'invalid', value: null, message: 'The value must be finite.' };
        }
        if (typeof input !== 'string' || input.length > 160) {
            return { status: 'invalid', value: null, message: 'Use a numeric expression of at most 160 characters.' };
        }
        const source = input.replace(/π/g, 'pi').replace(/−/g, '-');
        let position = 0;
        let tokens = 0;
        let depth = 0;
        function skip() { while (/\s/.test(source.charAt(position)) && position < source.length) position += 1; }
        function token() { tokens += 1; if (tokens > 128) throw new Error('Expression is too complex.'); }
        function finite(value) { if (!Number.isFinite(value)) throw new Error('The expression must have a finite result.'); return value; }
        function primary() {
            depth += 1;
            if (depth > 24) throw new Error('Expression nesting is too deep.');
            skip();
            let value;
            const character = source.charAt(position);
            if (character === '+' || character === '-') {
                position += 1; token(); value = (character === '-' ? -1 : 1) * primary();
            } else if (character === '(') {
                position += 1; token(); value = expression(); skip();
                if (source.charAt(position) !== ')') throw new Error('Close each parenthesis.');
                position += 1; token();
            } else if (source.slice(position, position + 2).toLowerCase() === 'pi') {
                position += 2; token(); value = Math.PI;
            } else {
                const match = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(source.slice(position));
                if (!match) throw new Error('Use numbers, pi, parentheses and + - * / only.');
                position += match[0].length; token(); value = Number(match[0]);
            }
            depth -= 1;
            return finite(value);
        }
        function term() {
            let value = primary(); skip();
            while (source.charAt(position) === '*' || source.charAt(position) === '/') {
                const operator = source.charAt(position); position += 1; token();
                const right = primary(); value = finite(operator === '*' ? value * right : value / right); skip();
            }
            return value;
        }
        function expression() {
            let value = term(); skip();
            while (source.charAt(position) === '+' || source.charAt(position) === '-') {
                const operator = source.charAt(position); position += 1; token();
                const right = term(); value = finite(operator === '+' ? value + right : value - right); skip();
            }
            return value;
        }
        try {
            const value = expression(); skip();
            if (position !== source.length) throw new Error('Use explicit multiplication, such as 2*pi; no other text is allowed.');
            return { status: 'valid', value, message: '' };
        } catch (error) {
            return { status: 'invalid', value: null, message: error.message };
        }
    }


    const api = Object.freeze({ parseNumber });
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.Exercise01Numbers = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
