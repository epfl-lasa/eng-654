/* Pure tutorial validation and execution. Student expressions use the safe
 * arithmetic parser; the regular IK branches are calculated from their text.
 */
(function (root, factory) {
    'use strict';
    const api = typeof module === 'object' && module.exports
        ? factory(require('./exercise-02-expressions.js'), require('./exercise-02-model.js'), require('./exercise-02-equations.js'))
        : factory(root.Exercise02Expressions, root.Exercise02Model, root.Exercise02Equations);
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.Exercise02Tutorial = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (math, model, equations) {
    'use strict';
    const scopes = {
        R: ['L', 'U', 'c3'], c3: ['R', 'L', 'U'], s3: ['sigma3', 'c3'], theta3: ['s3', 'c3'],
        E: ['sigmaE', 'rho', 'rho2', 'C'], c2: ['A', 'B', 'E', 'z'], s2: ['A', 'B', 'E', 'z'],
        theta2: ['s2', 'c2'], c1: ['E', 'x', 'C', 'y'], s1: ['E', 'x', 'C', 'y'], theta1: ['s1', 'c1']
    };
    const labels = { R: 'R =', c3: 'c₃ =', s3: 's₃ =', theta3: 'θ₃ =', E: 'E =',
        c2: 'c₂ =', s2: 's₂ =', theta2: 'θ₂ =', c1: 'c₁ =', s1: 's₁ =', theta1: 'θ₁ =' };
    const ROWS = Object.freeze(Object.keys(scopes).map(name => Object.freeze({ id: `eq.${name}`, label: labels[name],
        expected: model.EQUATION_DEFINITIONS[name], variables: Object.freeze(scopes[name]), angle: name.startsWith('theta') })));
    const ROW_BY_ID = Object.freeze(Object.fromEntries(ROWS.map(row => [row.id, row])));
    const choices = Object.freeze({ 'wrist.axes': '5,6,7', 'partition.arm': '1,2,4', 'partition.wrist': '5,6,7',
        method: 'geometric', 'arm.signReason': 'squared-projection', 'wrist.convention': 'zyz',
        'wrist.relative': 'arm-transpose-target', 'wrist.count': '2' });
    const MAIN_KEYS = Object.freeze(['wrist.home.x', 'wrist.home.y', 'wrist.home.z', ...Object.keys(choices),
        ...ROWS.map(row => row.id), 'wrist.r33', 'branches.count']);
    const knownKeys = new Set(MAIN_KEYS);
    const limitKey = /^limits\.arm-[pm]-[pm]-w[pms]$/;
    function validPhi(phi) {
        const limit = model.LIMITS[2];
        if (typeof phi !== 'number' || !Number.isFinite(phi) || phi < limit.lower - 1e-10 || phi > limit.upper + 1e-10) {
            throw new Error('Fixed q3 must be a finite angle within its URDF joint limits.');
        }
        return phi;
    }
    function numeric(text) {
        if (typeof text !== 'string' || text.length > 500 || !text.trim()) throw new Error('Enter a numerical expression.');
        const value = math.parse(text);
        if (math.symbols(value).length) throw new Error('This answer must be a number.');
        return math.evaluate(value);
    }
    function validateEquation(id, answer, phi = model.DEFAULT_PHI) {
        try {
            validPhi(phi);
            const row = ROW_BY_ID[id];
            if (!row || typeof answer !== 'string' || answer.length > 500) return false;
            return equations.checkExpression(answer, row.expected, { variables: row.variables, angle: row.angle,
                samples: model.equationSamples(phi), minSamples: 16 });
        } catch (_) { return false; }
    }
    function lessonQ(phi = model.DEFAULT_PHI) { validPhi(phi); const q = model.DEFAULT_Q.slice(); q[2] = phi; return q; }
    function validateAnswer(key, value, phi = model.DEFAULT_PHI, targetQ) {
        try {
            validPhi(phi);
            if (typeof value !== 'string' || value.length > 500) return false;
            if (Object.hasOwn(ROW_BY_ID, key)) return validateEquation(key, value, phi);
            if (Object.hasOwn(choices, key)) return value.trim() === choices[key];
            if (/^wrist\.home\.[xyz]$/.test(key)) {
                const index = 'xyz'.indexOf(key.at(-1));
                return Math.abs(numeric(value) - model.reduce(phi).homeWrist[index]) <= 1e-6;
            }
            if (key === 'wrist.r33') return equations.checkExpression(value, 'cos(q6)', {
                variables: ['q6'], samples: [-2.02, -1.75, -.9, -.2, .55, 1.3, 1.8, 2.01].map(q6 => ({ q6 })), minSamples: 8
            });
            if (key === 'branches.count') return Math.abs(numeric(value) - model.solveIK(model.fk(lessonQ(phi)), phi).count) < 1e-12;
            if (limitKey.test(key)) {
                const q = targetQ || lessonQ(phi);
                const branch = model.solveIK(model.fk(q), phi).branches.find(row => `limits.${row.id}` === key);
                return Boolean(branch) && value.trim() === (branch.withinLimits ? 'yes' : 'no');
            }
            return false;
        } catch (_) { return false; }
    }
    function plainObject(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
        const prototype = Object.getPrototypeOf(value);
        return prototype === Object.prototype || prototype === null;
    }
    function validateDocument(data) {
        if (!plainObject(data) || data.schemaVersion !== 1 || data.exercise !== 'exercise_02' || data.model !== 'iiwa7') {
            throw new Error('Choose an Exercise 02 iiwa7 response document with schemaVersion 1.');
        }
        if (!plainObject(data.units) || data.units.length !== 'm' || data.units.angle !== 'rad') throw new Error('The response units must be metres and radians.');
        const fixedQ3 = validPhi(data.fixedQ3);
        if (!Array.isArray(data.targetQ) || data.targetQ.length !== 7 || data.targetQ.some(q => typeof q !== 'number' || !Number.isFinite(q))) {
            throw new Error('The target configuration must contain seven finite joint angles.');
        }
        if (!model.checkLimits(data.targetQ).withinLimits) throw new Error('The target configuration must respect every URDF joint limit.');
        if (Math.abs(data.targetQ[2] - fixedQ3) > 1e-10) throw new Error('Target q3 must match the fixed q3 value.');
        if (!plainObject(data.answers)) throw new Error('Responses must be a flat answer object.');
        const answers = {};
        for (const [key, value] of Object.entries(data.answers)) {
            if (!knownKeys.has(key) && !limitKey.test(key)) throw new Error(`Unknown answer key: ${key}.`);
            if (typeof value !== 'string' || value.length > 500) throw new Error(`Answer ${key} must be text of at most 500 characters.`);
            answers[key] = value;
        }
        // Instructor metadata and any claimed completion flags are deliberately
        // omitted. Only freshly checked answers can unlock the tutorial.
        return { schemaVersion: 1, exercise: 'exercise_02', model: 'iiwa7', units: { length: 'm', angle: 'rad' },
            fixedQ3, targetQ: data.targetQ.slice(), answers };
    }
    function runEquations(answers, T, phi = model.DEFAULT_PHI) {
        validPhi(phi); model.validatePose(T);
        if (!plainObject(answers)) throw new Error('Build and check your equations before running IK.');
        const invalid = ROWS.filter(row => !validateEquation(row.id, answers[row.id], phi));
        if (invalid.length) throw new Error(`Check these equations before running IK: ${invalid.map(row => row.id).join(', ')}.`);
        const parsed = Object.fromEntries(ROWS.map(row => [row.id.slice(3), math.parse(answers[row.id])]));
        const input = model.positionContext(T, phi), pw = model.wristPoint(T), branches = [], armBranches = [];
        const evaluate = (name, context) => {
            const value = math.evaluate(parsed[name], context);
            if (!Number.isFinite(value)) throw new Error(`Your ${name} expression produced a non-finite result.`);
            return value;
        };
        function result(messages = []) {
            return { branches, armBranches, wristPoint: pw, fixedQ3: phi, messages, unreachable: branches.length === 0,
                singular: false, count: branches.length, feasibleCount: branches.filter(row => row.withinLimits).length,
                genericEight: branches.length === 8, usedSingularFallback: false, executedStudentEquations: true };
        }
        function singularFallback(reason) {
            const reference = model.solveIK(T, phi);
            return Object.assign({}, reference, { usedSingularFallback: true, executedStudentEquations: false,
                messages: [reason, 'The regular Cramer formulas need a separate singular-family analysis here. These are reference family representatives, not outputs of your regular equation blocks.', ...reference.messages] });
        }
        const rawC3 = evaluate('c3', input);
        if (rawC3 < -1 - 1e-10 || rawC3 > 1 + 1e-10) return result(['The wrist point lies outside the arm reach: |c3| > 1.']);
        const c3 = Math.max(-1, Math.min(1, rawC3));
        if (1 - Math.abs(c3) < 1e-14) return singularFallback('The two elbow signs coincide because sin(theta3) = 0.');
        for (const sigma3 of [1, -1]) {
            const elbow = Object.assign({}, input, { c3, sigma3 });
            elbow.s3 = evaluate('s3', elbow); elbow.theta3 = evaluate('theta3', elbow);
            // R is measured from the target; the student's expansion is also
            // evaluated at the resulting elbow to verify the distance identity.
            if (Math.abs(evaluate('R', elbow) - input.R) > 1e-7) throw new Error('Your distance equation failed at this target.');
            elbow.A = model.L + model.U * elbow.c3;
            elbow.B = -model.U * Math.cos(phi) * elbow.s3;
            elbow.C = -model.U * Math.sin(phi) * elbow.s3;
            const radicand = input.rho2 - elbow.C * elbow.C;
            if (radicand < -1e-10) continue;
            if (radicand < 1e-16 || elbow.A * elbow.A + elbow.B * elbow.B < 1e-16 || input.rho2 < 1e-16) {
                return singularFallback('A signed-projection branch merges or a Cramer determinant vanishes.');
            }
            for (const sigmaE of [1, -1]) {
                const context = Object.assign({}, elbow, { sigmaE });
                for (const name of ['E', 'c2', 's2', 'theta2', 'c1', 's1', 'theta1']) context[name] = evaluate(name, context);
                const theta = [context.theta1, context.theta2, context.theta3].map(model.wrap);
                const armId = `arm-${sigma3 > 0 ? 'p' : 'm'}-${sigmaE > 0 ? 'p' : 'm'}`;
                const armLabel = `sin(theta3) ${sigma3 > 0 ? '+' : '−'}, E ${sigmaE > 0 ? '+' : '−'}`;
                const arm = { id: armId, label: armLabel, theta, sigma3, sigmaE, context, families: [], singular: false };
                armBranches.push(arm);
                const R03 = model.armRotation(theta, phi), R36 = model.multiply(model.transpose(R03), model.rotation(T));
                for (const wrist of model.wristIK(R36)) {
                    if (wrist.singular) return singularFallback('The wrist Euler angles form a continuous family because sin(q6) = 0.');
                    const q = [theta[0], theta[1], phi, theta[2], ...wrist.angles];
                    const residuals = model.residual(q, T);
                    if (residuals.position > 1e-7 || residuals.rotation > 1e-7) throw new Error('Your equation output did not pass the full seven-joint FK check for this target.');
                    if (branches.some(row => row.q.every((value, i) => Math.abs(model.wrap(value - q[i])) < 1e-7))) continue;
                    branches.push(Object.assign({ id: `${armId}-w${wrist.sign > 0 ? 'p' : 'm'}`, q, theta: theta.slice(),
                        armBranch: armId, armLabel, wristBranch: wrist.sign, wristLabel: `sin(q6) ${wrist.sign > 0 ? '+' : '−'}`,
                        sigma3, sigmaE, context, R03, R36, residuals, singular: false, families: [] }, model.checkLimits(q)));
                }
            }
        }
        return result(branches.length ? [] : ['This target has no real signed-projection branch for the chosen fixed q3.']);
    }
    return Object.freeze({ ROWS, ROW_BY_ID, MAIN_KEYS, lessonQ, validateEquation, validateAnswer, validateDocument, runEquations });
}));
