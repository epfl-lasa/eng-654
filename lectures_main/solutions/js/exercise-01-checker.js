/* Exercise 01 numeric checks. Standard DH, metres, radians; no DOM dependency. */
(function (root, factory) {
    'use strict';
    const checker = factory();
    if (typeof module === 'object' && module.exports) module.exports = checker;
    // Browser feedback has no answer-key getter. Reference helpers are only
    // exported through CommonJS for offline fixtures and independent tests.
    if (root) root.Exercise01Checker = Object.freeze({
        evaluate: checker.evaluate, parseNumber: checker.parseNumber,
        evaluateDhForwardKinematics: checker.evaluateDhForwardKinematics,
        tolerances: checker.tolerances, poses: checker.poses
    });
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const PI = Math.PI;
    const DH_COLUMNS = ['thetaOffset', 'd', 'a', 'alpha'];
    const TRANSFORM_COLUMNS = ['x', 'y', 'z', 'roll', 'pitch', 'yaw'];
    const TOLERANCES = Object.freeze({ position: 1e-5, rotation: 1e-4, lengthCell: 1e-6, angleCell: 1e-5, matrixCell: 1e-4 });
    const POSES = Object.freeze({
        home: Object.freeze([0, 0, 0, 0, 0, 0, 0]),
        bent: Object.freeze([0, PI / 4, 0, -PI / 2, 0, PI / 4, 0]),
        bent_back: Object.freeze([0, -PI / 4, 0, PI / 2, 0, -PI / 4, 0]),
        side_reach: Object.freeze([PI / 2, PI / 4, 0, -PI / 2, 0, PI / 4, 0]),
        wrist_turn: Object.freeze([0, PI / 4, 0, -PI / 2, 0, PI / 4, PI / 2])
    });
    const CONCEPT_REFERENCE = Object.freeze({ 'concept.visualChangesFK': 'no', 'concept.jointChangesFK': 'yes' });
    const DH_REFERENCE = [
        [0, 0.34, 0, -PI / 2], [0, 0, 0, PI / 2],
        [0, 0.4, 0, PI / 2], [0, 0, 0, -PI / 2],
        [0, 0.4, 0, -PI / 2], [0, 0, 0, PI / 2], [0, 0.081, 0, 0]
    ];
    // Independently encoded joint origins from assets/models/iiwa7/iiwa7.urdf.
    // These are URDF xyz/rpy, not DH rows. The paired 0.0607 offsets must be
    // retained here even though they cancel in the downstream end-frame FK.
    const URDF_ORIGINS = [
        [0, 0, 0.15, 0, 0, 0], [0, 0, 0.19, PI / 2, 0, PI],
        [0, 0.21, 0, PI / 2, 0, PI], [0, 0, 0.19, PI / 2, 0, 0],
        [0, 0.21, 0, -PI / 2, PI, 0], [0, 0.0607, 0.19, PI / 2, 0, 0],
        [0, 0.081, 0.0607, -PI / 2, PI, 0]
    ];
    const VISUAL_Z = [0, 0.0075, 0, -0.026, 0, -0.026, 0, -0.0005];
    const CHAIN_KEYS = [];
    for (let i = 1; i <= 7; i += 1) DH_COLUMNS.forEach(column => CHAIN_KEYS.push(`dh.${i}.${column}`));
    ['base', 'tool'].forEach(prefix => TRANSFORM_COLUMNS.forEach(column => CHAIN_KEYS.push(`${prefix}.${column}`)));

    function referenceAnswers() {
        const answers = {};
        DH_REFERENCE.forEach((row, index) => DH_COLUMNS.forEach((column, j) => { answers[`dh.${index + 1}.${column}`] = String(row[j]); }));
        ['base', 'tool'].forEach(prefix => TRANSFORM_COLUMNS.forEach(column => {
            answers[`${prefix}.${column}`] = prefix === 'tool' && column === 'z' ? '0.045' : '0';
        }));
        VISUAL_Z.forEach((z, index) => TRANSFORM_COLUMNS.forEach(column => { answers[`visual.${index}.${column}`] = column === 'z' ? String(z) : '0'; }));
        Object.entries(POSES).forEach(([name, q]) => {
            referenceForwardKinematics(q).forEach((value, index) => {
                answers[`fk.${name}.${Math.floor(index / 4) + 1}.${index % 4 + 1}`] = String(value);
            });
        });
        Object.assign(answers, CONCEPT_REFERENCE);
        return answers;
    }

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
                position += 2; token(); value = PI;
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

    function identity() { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }
    function multiply(a, b) {
        const out = Array(16).fill(0);
        for (let r = 0; r < 4; r += 1) for (let c = 0; c < 4; c += 1) {
            for (let k = 0; k < 4; k += 1) out[4 * r + c] += a[4 * r + k] * b[4 * k + c];
        }
        return out;
    }
    function transform(values) {
        const [x, y, z, roll, pitch, yaw] = values;
        const cr = Math.cos(roll), sr = Math.sin(roll), cp = Math.cos(pitch), sp = Math.sin(pitch), cy = Math.cos(yaw), sy = Math.sin(yaw);
        return [cy * cp, cy * sp * sr - sy * cr, cy * sp * cr + sy * sr, x,
            sy * cp, sy * sp * sr + cy * cr, sy * sp * cr - cy * sr, y,
            -sp, cp * sr, cp * cr, z, 0, 0, 0, 1];
    }
    function dhTransform(row, q) {
        const [offset, d, a, alpha] = row;
        const ct = Math.cos(q + offset), st = Math.sin(q + offset), ca = Math.cos(alpha), sa = Math.sin(alpha);
        return [ct, -st * ca, st * sa, a * ct, st, ct * ca, -ct * sa, a * st, 0, sa, ca, d, 0, 0, 0, 1];
    }
    function checkConfiguration(q) {
        if (!Array.isArray(q) || q.length !== 7 || !q.every(Number.isFinite)) throw new Error('A configuration must contain seven finite joint angles in radians.');
    }
    function referenceForwardKinematics(q) {
        checkConfiguration(q);
        let result = identity();
        URDF_ORIGINS.forEach((origin, i) => {
            result = multiply(multiply(result, transform(origin)), transform([0, 0, 0, 0, 0, q[i]]));
        });
        return multiply(result, transform([0, 0, 0.045, 0, 0, 0]));
    }
    function chainFromValues(values) {
        return {
            rows: DH_REFERENCE.map((row, i) => DH_COLUMNS.map(column => values[`dh.${i + 1}.${column}`])),
            base: TRANSFORM_COLUMNS.map(column => values[`base.${column}`]),
            tool: TRANSFORM_COLUMNS.map(column => values[`tool.${column}`])
        };
    }
    function chainForwardKinematics(chain, q) {
        let result = transform(chain.base);
        chain.rows.forEach((row, i) => { result = multiply(result, dhTransform(row, q[i])); });
        return multiply(result, transform(chain.tool));
    }
    function evaluateDhForwardKinematics(answers, q) {
        checkConfiguration(q);
        const values = {};
        CHAIN_KEYS.forEach(key => {
            const parsed = parseNumber(answers && answers[key]);
            if (parsed.status !== 'valid') throw new Error(`A valid value is required for ${key}.`);
            values[key] = parsed.value;
        });
        return chainForwardKinematics(chainFromValues(values), q);
    }
    function poseError(a, b) {
        if (!a.every(Number.isFinite) || !b.every(Number.isFinite)) return { position: Infinity, rotation: Infinity };
        const relative = Array(9).fill(0);
        for (let r = 0; r < 3; r += 1) for (let c = 0; c < 3; c += 1) {
            for (let k = 0; k < 3; k += 1) relative[3 * r + c] += a[4 * k + r] * b[4 * k + c];
        }
        const sine = Math.hypot(relative[7] - relative[5], relative[2] - relative[6], relative[3] - relative[1]) / 2;
        const cosine = Math.max(-1, Math.min(1, (relative[0] + relative[4] + relative[8] - 1) / 2));
        return { position: Math.hypot(a[3] - b[3], a[7] - b[7], a[11] - b[11]), rotation: Math.atan2(sine, cosine) };
    }
    function testConfigurations() {
        const poses = [Array(7).fill(0), [0.35, -0.55, 0.4, -0.8, 0.5, 0.65, -0.3],
            [-1.1, 0.7, -0.6, 1.0, -0.8, -0.5, 0.9], [0.8, 1.2, -1.0, -0.4, 1.3, 0.9, -1.2],
            [-0.5, -1.3, 1.1, 0.7, -1.4, 1.0, 0.6], [1.6, -0.4, -1.2, -1.1, 0.7, -1.2, -0.9]];
        const limits = [2.967, 2.094, 2.967, 2.094, 2.967, 2.094, 3.054];
        let seed = 65401;
        for (let i = 0; i < 20; i += 1) poses.push(limits.map(limit => {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            return (2 * seed / 4294967296 - 1) * limit * 0.85;
        }));
        return poses;
    }
    function angleDifference(a, b) { return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))); }
    function isAngleKey(key) { return /\.(thetaOffset|alpha|roll|pitch|yaw)$/.test(key); }
    function matchesReference(key, value, expected) {
        return isAngleKey(key) ? angleDifference(value, expected) <= TOLERANCES.angleCell : Math.abs(value - expected) <= TOLERANCES.lengthCell;
    }

    function evaluate(answers) {
        answers = answers && typeof answers === 'object' && !Array.isArray(answers) ? answers : {};
        const reference = referenceAnswers();
        const fields = {};
        const values = {};
        const numericKeys = Object.keys(reference).filter(key => /^(dh|base|tool|visual)\./.test(key));
        numericKeys.forEach(key => {
            const parsed = parseNumber(answers[key]);
            if (parsed.status !== 'valid') { fields[key] = { status: parsed.status, message: parsed.message }; return; }
            values[key] = parsed.value;
            const matches = matchesReference(key, parsed.value, Number(reference[key]));
            fields[key] = { status: matches ? 'correct' : 'incorrect', message: matches
                ? 'Matches the reference entry; complete-chain equivalence is checked separately.'
                : 'Differs from the reference entry. Complete the chain to check another valid frame assignment.' };
        });

        const fk = { status: 'unanswered', maxPositionError: null, maxRotationError: null, testCount: 0,
            message: 'Complete every DH, base and tool entry to compare forward kinematics.' };
        if (CHAIN_KEYS.some(key => fields[key].status === 'invalid')) {
            fk.status = 'invalid'; fk.message = 'Correct the invalid DH, base or tool expressions before checking forward kinematics.';
        } else if (CHAIN_KEYS.every(key => Object.prototype.hasOwnProperty.call(values, key))) {
            const chain = chainFromValues(values);
            let maxPositionError = 0;
            let maxRotationError = 0;
            testConfigurations().forEach(q => {
                const error = poseError(referenceForwardKinematics(q), chainForwardKinematics(chain, q));
                maxPositionError = Math.max(maxPositionError, error.position);
                maxRotationError = Math.max(maxRotationError, error.rotation);
                fk.testCount += 1;
            });
            if (!Number.isFinite(maxPositionError) || !Number.isFinite(maxRotationError)) {
                fk.status = 'invalid'; fk.message = 'The entered magnitudes overflow the numeric FK calculation.';
            } else {
                fk.maxPositionError = maxPositionError; fk.maxRotationError = maxRotationError;
                fk.status = maxPositionError <= TOLERANCES.position && maxRotationError <= TOLERANCES.rotation ? 'correct' : 'incorrect';
                fk.message = fk.status === 'correct'
                    ? 'The complete chain agrees with the URDF on 26 configurations within 0.00001 m and 0.0001 rad. The five matrix answers are checked separately.'
                    : 'The complete chain differs from the URDF on the sampled configurations. Reference comparisons below do not isolate the cause.';
                CHAIN_KEYS.forEach(key => {
                    if (fk.status === 'correct') fields[key] = { status: 'correct', message: 'Accepted through complete-chain FK equivalence, including alternative DH/base/tool frame assignments.' };
                    else fields[key].message = fields[key].status === 'correct'
                        ? 'Matches this reference entry, but the complete chain fails the FK comparison.'
                        : 'Differs from this reference entry and the complete chain fails FK. This comparison does not identify the source of the mismatch.';
                });
            }
        }

        // Visual origins are expressed in fixed URDF link frames. RPY triples
        // are compared as rotations so equivalent Euler representations pass.
        VISUAL_Z.forEach((z, index) => {
            const prefix = `visual.${index}`;
            ['x', 'y', 'z'].forEach(column => {
                const key = `${prefix}.${column}`;
                if (!Object.prototype.hasOwnProperty.call(values, key)) return;
                fields[key].message = fields[key].status === 'correct'
                    ? 'Matches the reference mesh translation in this URDF link frame.'
                    : 'Does not match the reference mesh translation in this URDF link frame.';
            });
            const rotationKeys = ['roll', 'pitch', 'yaw'].map(column => `${prefix}.${column}`);
            if (rotationKeys.every(key => Object.prototype.hasOwnProperty.call(values, key))) {
                const rotation = transform([0, 0, 0].concat(rotationKeys.map(key => values[key])));
                const matches = poseError(identity(), rotation).rotation <= TOLERANCES.rotation;
                rotationKeys.forEach(key => {
                    if (matches) fields[key] = { status: 'correct', message: 'The complete RPY rotation matches the reference visual origin; equivalent Euler representations are accepted.' };
                    else fields[key].message = fields[key].status === 'correct'
                        ? 'Matches this reference angle, but the complete visual-origin rotation differs.'
                        : 'Differs from this reference angle and the complete visual-origin rotation differs; this does not isolate an individual Euler-angle error.';
                });
            }
        });
        // Check submitted world-to-iiwa_link_ee matrices against the URDF,
        // independently of the student's DH table and fixed transforms.
        Object.keys(POSES).forEach(name => {
            for (let row = 1; row <= 4; row += 1) for (let column = 1; column <= 4; column += 1) {
                const key = `fk.${name}.${row}.${column}`;
                const parsed = parseNumber(answers[key]);
                if (parsed.status !== 'valid') { fields[key] = { status: parsed.status, message: parsed.message }; continue; }
                const matches = Math.abs(parsed.value - Number(reference[key])) <= TOLERANCES.matrixCell;
                const hint = row === 4
                    ? 'Check the homogeneous bottom row; it is independent of the joint configuration.'
                    : column === 4
                        ? 'Check the world-to-end-frame translation in metres, including the fixed tool transform.'
                        : 'Check this rotation-block entry and the order of the composed rotations.';
                fields[key] = { status: matches ? 'correct' : 'incorrect', message: matches
                    ? 'Matches the URDF forward-kinematics matrix for this configuration within the matrix-entry tolerance.'
                    : hint };
            }
        });
        Object.entries(CONCEPT_REFERENCE).forEach(([key, expected]) => {
            const answer = answers[key];
            if (answer === undefined || answer === null || (typeof answer === 'string' && answer.trim() === '')) {
                fields[key] = { status: 'unanswered', message: 'Select an answer.' };
            } else if (typeof answer !== 'string' || !['yes', 'no'].includes(answer.trim().toLowerCase())) {
                fields[key] = { status: 'invalid', message: 'Choose one of the available yes/no answers.' };
            } else {
                const matches = answer.trim().toLowerCase() === expected;
                fields[key] = { status: matches ? 'correct' : 'incorrect', message: matches
                    ? 'Correct.' : 'Check which URDF elements define the kinematic chain.' };
            }
        });
        const summary = { correct: 0, incorrect: 0, unanswered: 0, invalid: 0, total: 0 };
        Object.values(fields).forEach(field => { summary[field.status] += 1; summary.total += 1; });
        return { fields, summary, fk };
    }

    return Object.freeze({ evaluate, parseNumber, referenceAnswers, referenceForwardKinematics,
        evaluateDhForwardKinematics, tolerances: TOLERANCES, poses: POSES });
}));
