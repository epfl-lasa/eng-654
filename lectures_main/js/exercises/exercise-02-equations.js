/* Equation blocks for Exercise 02. Expressions are parsed, never executed. */
(function (root, factory) {
    'use strict';
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./exercise-02-expressions.js'));
    else root.Exercise02Equations = factory(root.Exercise02Expressions);
})(typeof window !== 'undefined' ? window : globalThis, function (math) {
    'use strict';

    const DRAG_TYPE = 'application/x-exercise-02-equation';
    const DEFAULT_PALETTE = ['+', '-', '*', '/', '^', '(', ')', ',', '0', '1', '2', 'pi', 'sqrt(', 'sin(', 'cos(', 'atan2('];
    const BAD_NAMES = new Set(['__proto__', 'constructor', 'prototype']);
    let nextInstance = 0;

    function assertMath() {
        if (!math || !math.parse || !math.evaluate) throw new Error('Load exercise-02-expressions.js before the equation builder.');
    }

    // The tokens retain their exact text. Editing an incomplete expression is
    // allowed; correctness is checked only when the student chooses Check.
    function tokenize(source) {
        return String(source || '').match(/(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z_][A-Za-z_0-9]*\s*\(|[A-Za-z_][A-Za-z_0-9]*|[+\-*/^(),]|[^\s]/g) || [];
    }

    function defaultSamples(names, variables) {
        return Array.from({ length: 24 }, (_, i) => {
            const sample = Object.create(null);
            names.forEach((name, j) => {
                const range = variables && !Array.isArray(variables) ? variables[name] : null;
                if (Array.isArray(range) && range.length > 2) sample[name] = range[(i + j) % range.length];
                else {
                    const lower = Array.isArray(range) ? Number(range[0]) : 0.3;
                    const upper = Array.isArray(range) ? Number(range[1]) : 1.7;
                    sample[name] = lower + (upper - lower) * (0.5 + 0.47 * Math.sin((i + 1) * (j + 1) * 1.731 + j));
                }
            });
            return sample;
        });
    }

    /**
     * Check equivalent expressions at deterministic, non-singular samples.
     * Correlated kinematic symbols (R, E, c3, etc.) must be supplied together
     * in options.samples, usually using Exercise02Math.equationSamples(phi).
     * This is a numerical equivalence check, not a symbolic proof.
     */
    function checkExpression(answer, expected, options) {
        assertMath();
        options = options || {};
        try {
            if (typeof answer !== 'string' || !answer.trim()) return false;
            const candidate = math.parse(answer);
            const alternatives = (Array.isArray(expected) ? expected : [expected]).map(item => math.parse(item));
            const names = [...new Set(alternatives.flatMap(item => math.symbols(item)).concat(math.symbols(candidate)))];
            const allowedNames = options.variables ? (Array.isArray(options.variables) ? options.variables : Object.keys(options.variables)) : null;
            if (allowedNames && math.symbols(candidate).some(name => !allowedNames.includes(name))) return false;
            const samples = Array.isArray(options.samples) ? options.samples : defaultSamples(names, options.variables);
            const requiredSamples = options.minSamples === undefined ? (names.length ? 3 : 1) : Math.max(1, options.minSamples);
            const tolerance = options.tolerance === undefined ? 1e-7 : options.tolerance;
            return alternatives.some(reference => {
                let checked = 0;
                for (const sample of samples) {
                    let correct;
                    try { correct = math.evaluate(reference, sample); }
                    catch (_) { continue; } // A singular reference sample is outside this equation's domain.
                    if (!Number.isFinite(correct)) continue;
                    let actual;
                    try { actual = math.evaluate(candidate, sample); }
                    catch (_) { return false; }
                    if (!Number.isFinite(actual)) return false;
                    const difference = options.angle ? Math.atan2(Math.sin(actual - correct), Math.cos(actual - correct)) : actual - correct;
                    if (Math.abs(difference) > tolerance * (1 + Math.abs(correct))) return false;
                    checked += 1;
                }
                return checked >= requiredSamples;
            });
        } catch (_) { return false; }
    }

    function paletteItem(item) {
        if (typeof item === 'string') return { value: item, label: item };
        return { value: String(item.value === undefined ? '' : item.value), label: String(item.label || item.value || ''), description: String(item.description || '') };
    }

    function create(container, options) {
        assertMath();
        if (!container || !container.ownerDocument) throw new Error('Choose a container for the equation builder.');
        options = options || {};
        const document = container.ownerDocument;
        const instanceId = 'ex02-equations-' + (++nextInstance);
        const rows = Array.isArray(options.rows) ? options.rows : [];
        const rowMap = new Map();
        const cleanup = [];
        let activeRow = null;
        let dragging = null;
        let disposed = false;

        function element(tag, className, text) {
            const node = document.createElement(tag);
            if (className) node.className = className;
            if (text !== undefined) node.textContent = text;
            return node;
        }
        function listen(node, event, handler) {
            node.addEventListener(event, handler);
            cleanup.push(() => node.removeEventListener(event, handler));
        }
        function getContext() { return typeof options.getContext === 'function' ? options.getContext() || {} : {}; }
        function getAnswers() {
            const answers = {};
            rowMap.forEach((row, id) => { answers[id] = row.input.value; });
            return answers;
        }
        function emit(row) {
            if (typeof options.onChange === 'function') options.onChange(getAnswers(), row ? { id: row.spec.id, expression: row.input.value } : null);
        }
        function clearResult(row) {
            delete row.wrapper.dataset.result;
            row.input.removeAttribute('aria-invalid');
            row.feedback.textContent = '';
        }
        function activate(row) {
            const changed = activeRow !== row;
            activeRow = row;
            rowMap.forEach(candidate => candidate.wrapper.classList.toggle('is-active', candidate === row));
            palette.setAttribute('aria-label', 'Equation blocks for ' + row.spec.label);
            paletteTarget.textContent = 'Building ' + row.spec.label + ' · choose a row to change';
            // A palette block must remain in the DOM until a native drag has
            // ended. Entering another row may change the insertion target.
            if (changed && !dragging) renderPalette(row);
        }
        function renderChips(row, focusIndex) {
            row.dropzone.replaceChildren();
            row.tokens.forEach((value, index) => {
                const chip = element('button', 'ex02-equation-chip', value);
                chip.type = 'button';
                chip.draggable = true;
                chip.dataset.index = String(index);
                chip.setAttribute('aria-label', value + ', block ' + (index + 1) + '. Use Alt and arrow keys to move, Delete to remove.');
                chip.title = 'Drag to reorder · Delete to remove · Alt + arrow to move';
                // Chip elements are recreated as a row changes, so their
                // listeners are garbage-collected with the removed elements.
                chip.addEventListener('click', () => {
                    activate(row);
                    rowMap.forEach(candidate => candidate.dropzone.querySelectorAll('.is-selected').forEach(item => item.classList.remove('is-selected')));
                    chip.classList.add('is-selected');
                });
                chip.addEventListener('dragstart', event => {
                    activate(row);
                    dragging = { source: instanceId, rowId: row.spec.id, index, value };
                    event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(dragging));
                    event.dataTransfer.setData('text/plain', value);
                    event.dataTransfer.effectAllowed = 'copyMove';
                    chip.classList.add('is-dragging');
                });
                chip.addEventListener('dragend', () => { dragging = null; chip.classList.remove('is-dragging'); clearDragStyles(); if (activeRow) renderPalette(activeRow); });
                chip.addEventListener('keydown', event => {
                    if (event.key === 'Delete' || event.key === 'Backspace') {
                        event.preventDefault(); removeChip(row, index);
                    } else if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
                        event.preventDefault();
                        const target = index + (event.key === 'ArrowLeft' ? -1 : 1);
                        if (target >= 0 && target < row.tokens.length) {
                            const values = row.tokens.slice(); values.splice(index, 1); values.splice(target, 0, value);
                            updateFromTokens(row, values, target);
                        }
                    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                        event.preventDefault();
                        const target = row.dropzone.children[index + (event.key === 'ArrowLeft' ? -1 : 1)];
                        if (target) target.focus();
                    }
                });
                row.dropzone.append(chip);
            });
            if (!row.tokens.length) row.dropzone.append(element('span', 'ex02-equation-drop-hint', 'Drop blocks here, or click a block below.'));
            if (focusIndex !== undefined && row.tokens.length) row.dropzone.children[Math.min(focusIndex, row.tokens.length - 1)].focus();
        }
        function updateFromTokens(row, tokens, focusIndex) {
            row.tokens = tokens;
            row.input.value = tokens.join(' ');
            clearResult(row);
            renderChips(row, focusIndex); emit(row);
        }
        function removeChip(row, index) {
            const tokens = row.tokens.slice(); tokens.splice(index, 1);
            updateFromTokens(row, tokens, Math.max(0, index - 1));
            if (!tokens.length) row.input.focus();
        }
        function insertText(row, value) {
            if (!row) return;
            const start = row.input.selectionStart === null ? row.input.value.length : row.input.selectionStart;
            const end = row.input.selectionEnd === null ? start : row.input.selectionEnd;
            // Spaces prevent two adjacent number/symbol blocks from silently
            // becoming a different number or symbol: multiplication needs *.
            const left = row.input.value.slice(0, start), right = row.input.value.slice(end);
            const inserted = (left && !/\s$/.test(left) ? ' ' : '') + value + (right && !/^\s/.test(right) ? ' ' : '');
            if ((left + inserted + right).length > 500) return;
            row.input.value = left + inserted + right;
            row.tokens = tokenize(row.input.value);
            clearResult(row); renderChips(row); emit(row);
            row.input.focus(); row.input.setSelectionRange(start + inserted.length, start + inserted.length);
        }
        function clearDragStyles() {
            rowMap.forEach(row => {
                row.dropzone.classList.remove('is-drop-target');
                row.dropzone.querySelectorAll('.is-drop-before').forEach(chip => chip.classList.remove('is-drop-before'));
            });
        }
        function dropIndex(row, event) {
            const chips = [...row.dropzone.querySelectorAll('.ex02-equation-chip')];
            for (let i = 0; i < chips.length; i += 1) {
                const rect = chips[i].getBoundingClientRect();
                if (event.clientY < rect.top || event.clientY <= rect.bottom && event.clientX < rect.left + rect.width / 2) return i;
            }
            return row.tokens.length;
        }
        function readDrag(event) {
            try {
                const source = event.dataTransfer.getData(DRAG_TYPE);
                if (source) return JSON.parse(source);
            } catch (_) { return null; }
            const value = event.dataTransfer.getData('text/plain');
            return value && value.length <= 500 ? { value } : null;
        }
        function check(id) {
            const row = rowMap.get(id);
            if (!row) return false;
            const context = getContext();
            let correct = false;
            try {
                if (typeof row.spec.check === 'function') correct = row.spec.check(row.input.value, context) === true;
                else {
                    const expected = typeof row.spec.expected === 'function' ? row.spec.expected(context) : row.spec.expected;
                    const samples = typeof row.spec.samples === 'function' ? row.spec.samples(context) : row.spec.samples || context.samples;
                    correct = checkExpression(row.input.value, expected, { samples, variables: row.spec.variables,
                        tolerance: row.spec.tolerance, angle: row.spec.angle, minSamples: row.spec.minSamples });
                }
            } catch (_) { correct = false; }
            row.wrapper.dataset.result = correct ? 'correct' : 'incorrect';
            row.input.setAttribute('aria-invalid', String(!correct));
            row.feedback.textContent = correct ? 'Correct' : 'Incorrect';
            if (typeof options.onCheck === 'function') options.onCheck(id, correct, getAnswers());
            return correct;
        }

        const wrapper = element('div', 'ex02-equation-builder');
        const instructions = element('p', 'ex02-equation-instructions', 'Choose an equation, then drag or click blocks to build it. You can also type. Use * for multiplication and radians for angles.');
        wrapper.append(instructions);
        const rowList = element('div', 'ex02-equation-rows');
        const palette = element('div', 'ex02-equation-palette');
        const paletteLabel = element('span', 'ex02-equation-palette-label', 'Equation blocks');
        const paletteTarget = element('span', 'ex02-equation-palette-target');
        paletteTarget.setAttribute('aria-live', 'polite');
        palette.append(paletteLabel, paletteTarget);
        palette.setAttribute('role', 'group');
        function renderPalette(row) {
            const allowed = row.spec.variables && (Array.isArray(row.spec.variables) ? row.spec.variables : Object.keys(row.spec.variables));
            const symbols = row.spec.tokens || allowed || [];
            const items = (options.palette || symbols.concat(DEFAULT_PALETTE)).map(paletteItem).filter(item => {
                if (!item.value) return false;
                if (!allowed) return true;
                try { return math.symbols(item.value).every(name => allowed.includes(name)); }
                catch (_) { return true; } // Operators and open function blocks are intentionally incomplete.
            });
            const seen = new Set();
            palette.replaceChildren(paletteLabel, paletteTarget);
            items.forEach(item => {
                if (seen.has(item.value)) return;
                seen.add(item.value);
                const button = element('button', 'ex02-equation-token', item.label);
                button.type = 'button'; button.draggable = true;
                button.dataset.value = item.value;
                if (item.description) button.title = item.description;
                palette.append(button);
            });
        }
        listen(palette, 'click', event => {
            const button = event.target.closest('.ex02-equation-token');
            if (button && palette.contains(button)) insertText(activeRow, button.dataset.value);
        });
        listen(palette, 'dragstart', event => {
            const button = event.target.closest('.ex02-equation-token');
            if (!button || !palette.contains(button)) return;
            dragging = { source: instanceId, value: button.dataset.value };
            event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(dragging));
            event.dataTransfer.setData('text/plain', button.dataset.value);
            event.dataTransfer.effectAllowed = 'copy';
        });
        listen(palette, 'dragend', () => { dragging = null; clearDragStyles(); if (activeRow) renderPalette(activeRow); });

        rows.forEach((spec, index) => {
            const id = String(spec.id || 'equation-' + (index + 1));
            if (BAD_NAMES.has(id) || rowMap.has(id)) throw new Error('Equation row IDs must be unique, safe names.');
            spec = Object.assign({}, spec, { id, label: String(spec.label || id) });
            const rowWrapper = element('div', 'ex02-equation-row');
            rowWrapper.dataset.equationId = id;
            const heading = element('div', 'ex02-equation-heading');
            const label = element('label', 'ex02-equation-label', spec.label + ' =');
            label.htmlFor = instanceId + '-' + index;
            heading.append(label);
            const feedback = element('span', 'ex02-equation-feedback');
            feedback.setAttribute('role', 'status'); feedback.setAttribute('aria-live', 'polite');
            heading.append(feedback); rowWrapper.append(heading);
            if (spec.prompt) rowWrapper.append(element('p', 'ex02-equation-prompt', spec.prompt));
            const dropzone = element('div', 'ex02-equation-dropzone');
            dropzone.tabIndex = 0; dropzone.setAttribute('role', 'group');
            dropzone.setAttribute('aria-label', 'Blocks for ' + spec.label);
            rowWrapper.append(dropzone);
            const entry = element('div', 'ex02-equation-entry');
            const input = element('input', 'ex02-equation-input');
            input.type = 'text'; input.id = label.htmlFor; input.autocomplete = 'off'; input.spellcheck = false; input.maxLength = 500;
            input.setAttribute('aria-label', 'Expression for ' + spec.label);
            input.placeholder = 'Build or type an expression';
            const checkButton = element('button', 'ex02-equation-check', 'Check'); checkButton.type = 'button';
            const clearButton = element('button', 'ex02-equation-clear', 'Clear'); clearButton.type = 'button';
            clearButton.setAttribute('aria-label', 'Clear ' + spec.label);
            entry.append(input, checkButton, clearButton); rowWrapper.append(entry);
            const row = { spec, wrapper: rowWrapper, input, dropzone, feedback, tokens: [] };
            rowMap.set(id, row); rowList.append(rowWrapper); renderChips(row);
            listen(rowWrapper, 'focusin', () => activate(row));
            listen(rowWrapper, 'pointerdown', () => activate(row));
            listen(input, 'input', () => { row.tokens = tokenize(input.value); clearResult(row); renderChips(row); emit(row); });
            listen(input, 'keydown', event => { if (event.key === 'Enter') { event.preventDefault(); check(id); } });
            listen(checkButton, 'click', () => check(id));
            listen(clearButton, 'click', () => { updateFromTokens(row, []); input.focus(); });
            listen(dropzone, 'dragover', event => {
                event.preventDefault(); event.stopPropagation(); activate(row); clearDragStyles();
                dropzone.classList.add('is-drop-target');
                const target = dropzone.children[dropIndex(row, event)];
                if (target && target.classList.contains('ex02-equation-chip')) target.classList.add('is-drop-before');
                event.dataTransfer.dropEffect = dragging && dragging.rowId ? 'move' : 'copy';
            });
            listen(dropzone, 'dragleave', event => { if (!dropzone.contains(event.relatedTarget)) clearDragStyles(); });
            listen(dropzone, 'drop', event => {
                event.preventDefault(); event.stopPropagation(); clearDragStyles();
                const data = readDrag(event);
                if (!data || typeof data.value !== 'string' || data.value.length > 500) return;
                let position = dropIndex(row, event);
                const tokens = row.tokens.slice();
                let movedFrom = null;
                if (data.source === instanceId && data.rowId && rowMap.has(data.rowId)) {
                    const source = rowMap.get(data.rowId);
                    if (!Number.isInteger(data.index) || source.tokens[data.index] !== data.value) return;
                    if (source === row) { tokens.splice(data.index, 1); if (data.index < position) position -= 1; }
                    else movedFrom = source;
                }
                tokens.splice(position, 0, data.value);
                if (tokens.join(' ').length > 500) return;
                if (movedFrom) { const sourceTokens = movedFrom.tokens.slice(); sourceTokens.splice(data.index, 1); updateFromTokens(movedFrom, sourceTokens); }
                updateFromTokens(row, tokens, position); activate(row); dragging = null; renderPalette(row);
            });
        });
        wrapper.append(palette, rowList);
        wrapper.append(element('p', 'ex02-equation-keyboard-help', 'Select a block and press Delete to remove it. Alt + ← / → reorders a block. Enter checks the typed expression.'));
        // Keep lecture navigation shortcuts from taking over the editor.
        listen(wrapper, 'keydown', event => event.stopPropagation());
        container.append(wrapper);
        const toolbar = document.querySelector('.ex02-toolbar');
        if (toolbar) {
            const positionPalette = () => wrapper.style.setProperty('--ex02-equation-toolbar-offset', Math.ceil(toolbar.getBoundingClientRect().height + 8) + 'px');
            positionPalette();
            const Resize = document.defaultView && document.defaultView.ResizeObserver;
            if (Resize) { const observer = new Resize(positionPalette); observer.observe(toolbar); cleanup.push(() => observer.disconnect()); }
        }
        if (rowMap.size) activate(rowMap.values().next().value);
        return {
            getAnswers,
            setAnswers(answers) {
                rowMap.forEach((row, id) => {
                    const source = answers && Object.hasOwn(answers, id) ? answers[id] : '';
                    row.input.value = typeof source === 'string' ? source.slice(0, 500) : '';
                    row.tokens = tokenize(row.input.value); clearResult(row); renderChips(row);
                });
            },
            check,
            checkAll() { const results = {}; rowMap.forEach((_, id) => { results[id] = check(id); }); return results; },
            reset() { this.setAnswers({}); emit(null); },
            dispose() { if (!disposed) { cleanup.forEach(remove => remove()); wrapper.remove(); disposed = true; } }
        };
    }

    return Object.freeze({ create, checkExpression, tokenize });
});
