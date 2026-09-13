/* Exercise 01 numeric checks. Space PoE and standard DH, metres, radians; no DOM dependency. */
(function (root, factory) {
    'use strict';
    const numbers = typeof module === 'object' && module.exports
        ? require('./exercise-01-numbers.js') : root.Exercise01Numbers;
    const visualOrigins = typeof module === 'object' && module.exports
        ? require('./exercise-01-visual-origins.js') : root.Exercise01VisualOrigins;
    const checker = factory(numbers.parseNumber, visualOrigins.initialVisualOrigins);
    if (typeof module === 'object' && module.exports) module.exports = checker;
    // Browser feedback has no answer-key getter. Reference helpers are only
    // exported through CommonJS for offline fixtures and independent tests.
    if (root) root.Exercise01Checker = Object.freeze({
        evaluate: checker.evaluate, parseNumber: checker.parseNumber,
        evaluateDhForwardKinematics: checker.evaluateDhForwardKinematics,
        evaluatePoeForwardKinematics: checker.evaluatePoeForwardKinematics,
        tolerances: checker.tolerances, poses: checker.poses
    });
}(typeof globalThis !== 'undefined' ? globalThis : this, function (parseNumber, initialVisualOrigins) {
    'use strict';

    const PI = Math.PI;
    const DH_COLUMNS = ['thetaOffset', 'd', 'a', 'alpha'];
    const SCREW_COLUMNS = ['wx', 'wy', 'wz', 'vx', 'vy', 'vz'];
    const TRANSFORM_COLUMNS = ['x', 'y', 'z', 'roll', 'pitch', 'yaw'];
    const MATRIX_CELLS = Array.from({ length: 16 }, (_, i) => `${Math.floor(i / 4) + 1}.${i % 4 + 1}`);
    const TOLERANCES = Object.freeze({ position: 1e-5, rotation: 1e-4, lengthCell: 1e-6, angleCell: 1e-5, matrixCell: 1e-4, rigidTransform: 1e-5, screwCell: 1e-6 });
    const POSES = Object.freeze({
        home: Object.freeze([0, 0, 0, 0, 0, 0, 0]),
        bent: Object.freeze([0, PI / 4, 0, -PI / 2, 0, PI / 4, 0]),
        bent_back: Object.freeze([0, -PI / 4, 0, PI / 2, 0, -PI / 4, 0]),
        side_reach: Object.freeze([PI / 2, PI / 4, 0, -PI / 2, 0, PI / 4, 0]),
        wrist_turn: Object.freeze([PI / 6, PI / 4, -PI / 6, -PI / 2, PI / 6, PI / 4, PI / 2])
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
    const CLEAN_VISUAL_ORIGINS = [0, 0.0075, 0, -0.026, 0, -0.026, 0, -0.0005].map(z => [0, 0, z, 0, 0, 0]);
    const CHAIN_KEYS = [];
    for (let i = 1; i <= 7; i += 1) DH_COLUMNS.forEach(column => CHAIN_KEYS.push(`dh.${i}.${column}`));
    ['base', 'tool'].forEach(prefix => MATRIX_CELLS.forEach(cell => CHAIN_KEYS.push(`${prefix}.${cell}`)));
    const POE_KEYS = [];
    for (let i = 1; i <= 7; i += 1) SCREW_COLUMNS.forEach(column => POE_KEYS.push(`poe.${i}.${column}`));
    MATRIX_CELLS.forEach(cell => POE_KEYS.push(`poe.M.${cell}`));

    function referenceAnswers() {
        const answers = {};
        DH_REFERENCE.forEach((row, index) => DH_COLUMNS.forEach((column, j) => { answers[`dh.${index + 1}.${column}`] = String(row[j]); }));
        ['base', 'tool'].forEach(prefix => identity().forEach((value, index) => {
            answers[`${prefix}.${MATRIX_CELLS[index]}`] = prefix === 'tool' && index === 11 ? '0.045' : String(value);
        }));
        referenceSpaceScrews().forEach((screw, index) => SCREW_COLUMNS.forEach((column, component) => {
            answers[`poe.${index + 1}.${column}`] = String(Math.abs(screw[component]) < 1e-12 ? 0 : screw[component]);
        }));
        referenceForwardKinematics(Array(7).fill(0)).forEach((value, index) => {
            answers[`poe.M.${MATRIX_CELLS[index]}`] = String(Math.abs(value) < 1e-12 ? 0 : value);
        });
        CLEAN_VISUAL_ORIGINS.forEach((origin, index) => TRANSFORM_COLUMNS.forEach((column, component) => {
            answers[`visual.${index}.${column}`] = String(origin[component] - initialVisualOrigins[index][component]);
        }));
        Object.entries(POSES).forEach(([name, q]) => {
            referenceForwardKinematics(q).forEach((value, index) => {
                answers[`fk.${name}.${Math.floor(index / 4) + 1}.${index % 4 + 1}`] = String(value);
            });
        });
        Object.assign(answers, CONCEPT_REFERENCE);
        return answers;
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
    function cross(a, b) {
        return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    }
    function referenceSpaceScrews() {
        let originInWorld = identity();
        return URDF_ORIGINS.map(origin => {
            originInWorld = multiply(originInWorld, transform(origin));
            // All revolute axes in the supplied URDF are local +Z. Transform
            // each axis and a point on it into world coordinates at q = 0.
            const omega = [originInWorld[2], originInWorld[6], originInWorld[10]];
            const point = [originInWorld[3], originInWorld[7], originInWorld[11]];
            return omega.concat(cross(omega, point).map(value => -value));
        });
    }
    function poeFromValues(values) {
        return {
            screws: Array.from({ length: 7 }, (_, index) => SCREW_COLUMNS.map(column => values[`poe.${index + 1}.${column}`])),
            home: MATRIX_CELLS.map(cell => values[`poe.M.${cell}`])
        };
    }
    function screwIssues(screw) {
        const issues = [];
        const magnitude = Math.hypot(...screw.slice(0, 3));
        if (!Number.isFinite(magnitude) || Math.abs(magnitude - 1) > TOLERANCES.rigidTransform) {
            issues.push({ indices: [0, 1, 2], message: 'A revolute screw must have a unit angular direction in world coordinates.' });
        }
        const pitch = screw[0] * screw[3] + screw[1] * screw[4] + screw[2] * screw[5];
        if (!Number.isFinite(pitch) || Math.abs(pitch) > TOLERANCES.rigidTransform) {
            issues.push({ indices: [3, 4, 5], message: 'A revolute screw has zero pitch: its linear part must be perpendicular to its angular direction.' });
        }
        return issues;
    }
    function screwExponential(screw, jointAngle) {
        const magnitude = Math.hypot(...screw.slice(0, 3));
        const omega = screw.slice(0, 3).map(value => value / magnitude);
        const velocity = screw.slice(3).map(value => value / magnitude);
        const angle = magnitude * jointAngle;
        const sine = Math.sin(angle), oneMinusCosine = 2 * Math.sin(angle / 2) ** 2;
        const skew = [0, -omega[2], omega[1], omega[2], 0, -omega[0], -omega[1], omega[0], 0];
        const out = identity();
        for (let row = 0; row < 3; row += 1) for (let column = 0; column < 3; column += 1) {
            const diagonal = Number(row === column);
            out[4 * row + column] = diagonal + sine * skew[3 * row + column]
                + oneMinusCosine * (omega[row] * omega[column] - diagonal);
        }
        const firstCross = cross(omega, velocity), secondCross = cross(omega, firstCross);
        for (let row = 0; row < 3; row += 1) {
            out[4 * row + 3] = angle * velocity[row] + oneMinusCosine * firstCross[row]
                + (angle - sine) * secondCross[row];
        }
        return out;
    }
    function poeForwardKinematics(chain, q) {
        let result = identity();
        chain.screws.forEach((screw, index) => { result = multiply(result, screwExponential(screw, q[index])); });
        return multiply(result, chain.home);
    }
    function evaluatePoeForwardKinematics(answers, q) {
        checkConfiguration(q);
        const values = {};
        POE_KEYS.forEach(key => {
            const parsed = parseNumber(answers && answers[key]);
            if (parsed.status !== 'valid') throw new Error(`A valid value is required for ${key}.`);
            values[key] = parsed.value;
        });
        const chain = poeFromValues(values);
        chain.screws.forEach((screw, index) => {
            const issues = screwIssues(screw);
            if (issues.length) throw new Error(`Invalid screw ${index + 1}: ${issues[0].message}`);
        });
        const issues = rigidTransformIssues(chain.home);
        if (issues.length) throw new Error(`Invalid PoE home matrix: ${issues[0].message}`);
        return poeForwardKinematics(chain, q);
    }
    function chainFromValues(values) {
        return {
            rows: DH_REFERENCE.map((row, i) => DH_COLUMNS.map(column => values[`dh.${i + 1}.${column}`])),
            base: MATRIX_CELLS.map(cell => values[`base.${cell}`]),
            tool: MATRIX_CELLS.map(cell => values[`tool.${cell}`])
        };
    }
    function rigidTransformIssues(matrix) {
        const issues = [];
        const bottom = [12, 13, 14, 15].filter(index => Math.abs(matrix[index] - (index === 15 ? 1 : 0)) > TOLERANCES.rigidTransform);
        if (bottom.length) issues.push({ indices: bottom, message: 'The homogeneous bottom row must be [0, 0, 0, 1].' });
        // Rounded rotation entries need not be exact, but scaling, shear and
        // reflections must not be accepted through the angular FK comparison.
        let orthonormal = true;
        for (let row = 0; row < 3; row += 1) for (let column = 0; column < 3; column += 1) {
            let dot = 0;
            for (let k = 0; k < 3; k += 1) dot += matrix[4 * k + row] * matrix[4 * k + column];
            if (!Number.isFinite(dot) || Math.abs(dot - (row === column ? 1 : 0)) > TOLERANCES.rigidTransform) orthonormal = false;
        }
        const determinant = matrix[0] * (matrix[5] * matrix[10] - matrix[6] * matrix[9])
            - matrix[1] * (matrix[4] * matrix[10] - matrix[6] * matrix[8])
            + matrix[2] * (matrix[4] * matrix[9] - matrix[5] * matrix[8]);
        if (!orthonormal || !Number.isFinite(determinant) || Math.abs(determinant - 1) > TOLERANCES.rigidTransform) {
            issues.push({ indices: [0, 1, 2, 4, 5, 6, 8, 9, 10],
                message: 'The rotation block must be orthonormal with determinant +1; check its entries and rounding.' });
        }
        return issues;
    }
    function chainForwardKinematics(chain, q) {
        let result = chain.base;
        chain.rows.forEach((row, i) => { result = multiply(result, dhTransform(row, q[i])); });
        return multiply(result, chain.tool);
    }
    function evaluateDhForwardKinematics(answers, q) {
        checkConfiguration(q);
        const values = {};
        CHAIN_KEYS.forEach(key => {
            const parsed = parseNumber(answers && answers[key]);
            if (parsed.status !== 'valid') throw new Error(`A valid value is required for ${key}.`);
            values[key] = parsed.value;
        });
        const chain = chainFromValues(values);
        ['base', 'tool'].forEach(prefix => {
            const issues = rigidTransformIssues(chain[prefix]);
            if (issues.length) throw new Error(`Invalid ${prefix} matrix: ${issues[0].message}`);
        });
        return chainForwardKinematics(chain, q);
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
        if (/^(base|tool|poe\.M)\./.test(key)) return Math.abs(value - expected) <= TOLERANCES.matrixCell;
        if (key.startsWith('poe.')) return Math.abs(value - expected) <= TOLERANCES.screwCell;
        return isAngleKey(key) ? angleDifference(value, expected) <= TOLERANCES.angleCell : Math.abs(value - expected) <= TOLERANCES.lengthCell;
    }

    function evaluate(answers) {
        answers = answers && typeof answers === 'object' && !Array.isArray(answers) ? answers : {};
        const reference = referenceAnswers();
        const fields = {};
        const values = {};
        const numericKeys = Object.keys(reference).filter(key => /^(dh|base|tool|poe|visual)\./.test(key));
        numericKeys.forEach(key => {
            const parsed = parseNumber(answers[key]);
            if (parsed.status !== 'valid') { fields[key] = { status: parsed.status, message: parsed.message }; return; }
            values[key] = parsed.value;
            const matches = matchesReference(key, parsed.value, Number(reference[key]));
            if (key.startsWith('visual.')) {
                fields[key] = { status: matches ? 'correct' : 'incorrect', message: matches
                    ? 'Matches the reference correction. Complete the RPY corrections to check the repaired rotation.'
                    : 'Check the correction: repaired component minus its initial value in the supplied URDF.' };
                return;
            }
            if (key.startsWith('poe.')) {
                fields[key] = { status: matches ? 'correct' : 'incorrect', message: matches
                    ? 'Matches this entry in the world-space PoE model with the supplied joint signs and zero configuration.'
                    : key.startsWith('poe.M.')
                        ? 'Check the world-to-tool home matrix at the zero joint configuration, including the fixed tool transform.'
                        : 'Check the normalized world-space screw at the zero configuration: angular direction first, then minus the angular direction crossed with a point on the axis.' };
                return;
            }
            fields[key] = { status: matches ? 'correct' : 'incorrect', message: matches
                ? 'Matches the reference entry; complete-chain equivalence is checked separately.'
                : 'Differs from the reference entry. Complete the chain to check another valid frame assignment.' };
        });

        let invalidTransform = false;
        ['base', 'tool'].forEach(prefix => {
            const keys = MATRIX_CELLS.map(cell => `${prefix}.${cell}`);
            if (!keys.every(key => Object.prototype.hasOwnProperty.call(values, key))) return;
            rigidTransformIssues(keys.map(key => values[key])).forEach(issue => {
                invalidTransform = true;
                issue.indices.forEach(index => { fields[keys[index]] = { status: 'invalid', message: issue.message }; });
            });
        });

        const fk = { status: 'unanswered', maxPositionError: null, maxRotationError: null, testCount: 0,
            message: 'Complete every DH, base and tool entry to compare forward kinematics.' };
        if (CHAIN_KEYS.some(key => fields[key].status === 'invalid')) {
            fk.status = 'invalid'; fk.message = invalidTransform
                ? 'Correct the base or tool matrix so it represents a rigid homogeneous transform before checking forward kinematics.'
                : 'Correct the invalid DH, base or tool expressions before checking forward kinematics.';
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

        for (let joint = 1; joint <= 7; joint += 1) {
            const keys = SCREW_COLUMNS.map(column => `poe.${joint}.${column}`);
            if (!keys.every(key => Object.prototype.hasOwnProperty.call(values, key))) continue;
            screwIssues(keys.map(key => values[key])).forEach(issue => {
                issue.indices.forEach(index => { fields[keys[index]] = { status: 'invalid', message: issue.message }; });
            });
        }
        const homeKeys = MATRIX_CELLS.map(cell => `poe.M.${cell}`);
        if (homeKeys.every(key => Object.prototype.hasOwnProperty.call(values, key))) {
            rigidTransformIssues(homeKeys.map(key => values[key])).forEach(issue => {
                issue.indices.forEach(index => { fields[homeKeys[index]] = { status: 'invalid', message: issue.message }; });
            });
        }
        const poe = { status: 'unanswered', maxPositionError: null, maxRotationError: null, testCount: 0,
            message: 'Complete the seven space screws and the home matrix to compare PoE forward kinematics.' };
        if (POE_KEYS.some(key => fields[key].status === 'invalid')) {
            poe.status = 'invalid';
            poe.message = 'Correct the invalid PoE expressions, revolute screws or home matrix before comparing forward kinematics.';
        } else if (POE_KEYS.every(key => Object.prototype.hasOwnProperty.call(values, key))) {
            const chain = poeFromValues(values);
            let maxPositionError = 0, maxRotationError = 0;
            testConfigurations().forEach(q => {
                const error = poseError(referenceForwardKinematics(q), poeForwardKinematics(chain, q));
                maxPositionError = Math.max(maxPositionError, error.position);
                maxRotationError = Math.max(maxRotationError, error.rotation);
                poe.testCount += 1;
            });
            if (!Number.isFinite(maxPositionError) || !Number.isFinite(maxRotationError)) {
                poe.status = 'invalid';
                poe.message = 'The entered magnitudes overflow the numeric PoE calculation.';
            } else {
                poe.maxPositionError = maxPositionError;
                poe.maxRotationError = maxRotationError;
                const referenceMatches = POE_KEYS.every(key => fields[key].status === 'correct');
                const posesMatch = maxPositionError <= TOLERANCES.position && maxRotationError <= TOLERANCES.rotation;
                poe.status = posesMatch && referenceMatches ? 'correct' : 'incorrect';
                poe.message = poe.status === 'correct'
                    ? 'The world-space screws and home matrix match the supplied URDF, and PoE agrees on 26 configurations within 0.00001 m and 0.0001 rad.'
                    : posesMatch
                        ? 'The sampled PoE poses agree within the FK tolerance, but a model entry differs from the required world-space screws or home matrix.'
                        : 'The PoE chain differs from the URDF on the sampled configurations. Check the world-space axes, their signs, moment vectors and home matrix.';
            }
        }

        const dhChain = ['correct', 'incorrect'].includes(fk.status) ? chainFromValues(values) : null;
        const poeChain = ['correct', 'incorrect'].includes(poe.status) ? poeFromValues(values) : null;
        function checkNamedPose(chain, q, forwardKinematics, status) {
            if (!chain) return { status, positionError: null, rotationError: null };
            const error = poseError(referenceForwardKinematics(q), forwardKinematics(chain, q));
            if (!Number.isFinite(error.position) || !Number.isFinite(error.rotation)) {
                return { status: 'invalid', positionError: null, rotationError: null };
            }
            return {
                status: error.position <= TOLERANCES.position && error.rotation <= TOLERANCES.rotation ? 'correct' : 'incorrect',
                positionError: error.position, rotationError: error.rotation
            };
        }
        const poseChecks = Object.fromEntries(Object.entries(POSES).map(([name, q]) => [name, {
            dh: checkNamedPose(dhChain, q, chainForwardKinematics, fk.status),
            poe: checkNamedPose(poeChain, q, poeForwardKinematics, poe.status)
        }]));

        // Corrections are componentwise changes to the supplied URDF origins.
        // Compare the repaired RPY triples as rotations, preserving equivalent
        // Euler representations without interpreting the deltas as rotations.
        CLEAN_VISUAL_ORIGINS.forEach((origin, index) => {
            const prefix = `visual.${index}`;
            ['x', 'y', 'z'].forEach(column => {
                const key = `${prefix}.${column}`;
                if (!Object.prototype.hasOwnProperty.call(values, key)) return;
                fields[key].message = fields[key].status === 'correct'
                    ? 'This correction restores the reference mesh translation in this URDF link frame.'
                    : 'Check the translation correction: repaired value minus the initial value in the supplied URDF.';
            });
            const rotationKeys = ['roll', 'pitch', 'yaw'].map(column => `${prefix}.${column}`);
            if (rotationKeys.every(key => Object.prototype.hasOwnProperty.call(values, key))) {
                const repairedRpy = rotationKeys.map((key, component) => initialVisualOrigins[index][component + 3] + values[key]);
                const rotation = transform([0, 0, 0].concat(repairedRpy));
                const matches = poseError(transform(origin), rotation).rotation <= TOLERANCES.rotation;
                rotationKeys.forEach(key => {
                    if (matches) fields[key] = { status: 'correct', message: 'The initial RPY values plus these corrections restore the reference visual rotation; equivalent repaired Euler representations are accepted.' };
                    else fields[key].message = fields[key].status === 'correct'
                        ? 'Matches this reference angle correction, but the repaired visual rotation differs.'
                        : 'Check the RPY corrections: add each to its initial URDF value. The repaired visual rotation differs; this does not isolate an individual angle error.';
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
        return { fields, summary, fk, poe, poseChecks };
    }

    return Object.freeze({ evaluate, parseNumber, referenceAnswers, referenceForwardKinematics,
        evaluateDhForwardKinematics, evaluatePoeForwardKinematics, tolerances: TOLERANCES, poses: POSES });
}));
