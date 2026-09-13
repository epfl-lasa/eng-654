/* Exact iiwa7 inverse kinematics for Exercise 02. Metres, radians, column vectors.
 * The public D-H frames are the teaching frames from Exercise 01; their final
 * transform equals world -> iiwa_link_ee in assets/models/iiwa7/iiwa7.urdf.
 * Original joint q3 is fixed. Reduced arm angles are (q1, q2, q4).
 */
(function (root, factory) {
    'use strict';
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.Exercise02Model = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    const PI = Math.PI;
    const H = 0.34, L = 0.4, U = 0.4, TOOL = 0.126;
    const EPS = 1e-10;
    const DEFAULT_PHI = PI / 6;
    const DEFAULT_Q = Object.freeze([0.35, 0.55, DEFAULT_PHI, -1.1, 0.7, 0.8, -0.45]);
    const LIMITS = Object.freeze([170, 120, 170, 120, 170, 120, 175].map((deg, i) => Object.freeze({
        joint: i + 1, name: `q${i + 1}`, lower: -deg * PI / 180, upper: deg * PI / 180,
        lowerDegrees: -deg, upperDegrees: deg
    })));
    const DH = Object.freeze([
        [H, 0, -PI / 2], [0, 0, PI / 2], [L, 0, PI / 2],
        [0, 0, -PI / 2], [U, 0, -PI / 2], [0, 0, PI / 2], [0.081, 0, 0]
    ].map((row, i) => Object.freeze({ joint: i + 1, d: row[0], a: row[1], alpha: row[2], thetaOffset: 0 })));
    const SCREWS = Object.freeze([
        [[0, 0, 1], [0, 0, 0]], [[0, 1, 0], [-H, 0, 0]],
        [[0, 0, 1], [0, 0, 0]], [[0, -1, 0], [H + L, 0, 0]],
        [[0, 0, 1], [0, 0, 0]], [[0, 1, 0], [-H - L - U, 0, 0]],
        [[0, 0, 1], [0, 0, 0]]
    ].map((row, i) => Object.freeze({ joint: i + 1, omega: Object.freeze(row[0]), v: Object.freeze(row[1]) })));
    const EQUATION_DEFINITIONS = Object.freeze({
        R: 'L^2+U^2+2*L*U*c3',
        c3: '(R-L^2-U^2)/(2*L*U)',
        s3: 'sigma3*sqrt(1-c3^2)',
        theta3: 'atan2(s3,c3)',
        E: 'sigmaE*sqrt(rho^2-C^2)',
        c2: '(B*E+A*z)/(A^2+B^2)',
        s2: '(A*E-B*z)/(A^2+B^2)',
        theta2: 'atan2(s2,c2)',
        c1: '(E*x+C*y)/(E^2+C^2)',
        s1: '(E*y-C*x)/(E^2+C^2)',
        theta1: 'atan2(s1,c1)'
    });
    const identity = () => [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
    const clamp = value => Math.min(1, Math.max(-1, value));
    const dot = (a, b) => a.reduce((sum, x, i) => sum + x * b[i], 0);
    const norm = vector => Math.hypot(...vector);
    const transpose = matrix => matrix[0].map((_, j) => matrix.map(row => row[j]));
    const multiply = (a, b) => a.map(row => b[0].map((_, j) => row.reduce((sum, x, k) => sum + x * b[k][j], 0)));
    const rotation = T => T.slice(0, 3).map(row => row.slice(0, 3));
    const position = T => T.slice(0, 3).map(row => row[3]);
    const apply = (T, p) => T.slice(0, 3).map(row => dot(row.slice(0, 3), p) + row[3]);
    const wrap = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
    function finite(value, label) {
        if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be a finite number.`);
        return value;
    }
    function joints(q) {
        if (!Array.isArray(q) || q.length !== 7) throw new Error('A configuration must contain seven joint angles.');
        q.forEach((angle, i) => finite(angle, `q${i + 1}`));
        return q;
    }
    function dh(theta, d, a, alpha) {
        const c = Math.cos(theta), s = Math.sin(theta), ca = Math.cos(alpha), sa = Math.sin(alpha);
        return [[c, -s * ca, s * sa, a * c], [s, c * ca, -c * sa, a * s],
            [0, sa, ca, d], [0, 0, 0, 1]];
    }
    function dhFactor(index, angle) {
        const row = DH[index - 1];
        if (!row) throw new Error('D-H joint index must be between 1 and 7.');
        return dh(finite(angle, 'Angle'), row.d, row.a, row.alpha);
    }
    function fk(q) {
        joints(q);
        let T = identity();
        q.forEach((angle, i) => { T = multiply(T, dhFactor(i + 1, angle)); });
        const tool = identity(); tool[2][3] = 0.045;
        return multiply(T, tool);
    }
    function armTransform(theta, phi = DEFAULT_PHI) {
        if (!Array.isArray(theta) || theta.length !== 3) throw new Error('Reduced arm needs theta1, theta2, theta3.');
        theta.forEach((angle, i) => finite(angle, `theta${i + 1}`)); finite(phi, 'Fixed q3');
        return multiply(multiply(multiply(dhFactor(1, theta[0]), dhFactor(2, theta[1])), dhFactor(3, phi)), dhFactor(4, theta[2]));
    }
    function armFK(theta, phi = DEFAULT_PHI) {
        return apply(armTransform(theta, phi), [0, 0, U]);
    }
    function jointFrames(q) {
        joints(q);
        // Keep both 60.7 mm offsets: they move the URDF link origins along
        // wrist axes, even though they cancel in the final D-H/tool pose.
        const origins = [
            [[0, 0, .15], [0, 0, 0]], [[0, 0, .19], [PI / 2, 0, PI]],
            [[0, .21, 0], [PI / 2, 0, PI]], [[0, 0, .19], [PI / 2, 0, 0]],
            [[0, .21, 0], [-PI / 2, PI, 0]], [[0, .0607, .19], [PI / 2, 0, 0]],
            [[0, .081, .0607], [-PI / 2, PI, 0]]
        ];
        let T = identity();
        return origins.map(([xyz, rpy], i) => {
            const [r, p, y] = rpy;
            const Ry = [[Math.cos(p), 0, Math.sin(p), 0], [0, 1, 0, 0], [-Math.sin(p), 0, Math.cos(p), 0], [0, 0, 0, 1]];
            const origin = multiply(multiply(dh(y, 0, 0, 0), Ry), dh(0, 0, 0, r));
            xyz.forEach((value, j) => { origin[j][3] = value; });
            T = multiply(T, origin);
            const beforeRotation = T, point = position(T), axis = T.slice(0, 3).map(row => row[2]);
            T = multiply(T, dh(q[i], 0, 0, 0));
            return { joint: i + 1, name: `iiwa_joint_${i + 1}`, origin: point, position: point.slice(), axis,
                transform: T, matrix: T, beforeRotation };
        });
    }
    function validatePose(T) {
        if (!Array.isArray(T) || T.length !== 4 || T.some(row => !Array.isArray(row) || row.length !== 4 || row.some(x => typeof x !== 'number' || !Number.isFinite(x)))) {
            throw new Error('The target must be a finite 4 × 4 homogeneous matrix.');
        }
        if (T[3].some((x, i) => Math.abs(x - (i === 3 ? 1 : 0)) > 1e-8)) throw new Error('The last matrix row must be [0, 0, 0, 1].');
        const R = rotation(T), gram = multiply(transpose(R), R);
        if (gram.some((row, i) => row.some((x, j) => Math.abs(x - (i === j ? 1 : 0)) > 1e-7))) throw new Error('The target rotation must be orthonormal.');
        const determinant = R[0][0] * (R[1][1] * R[2][2] - R[1][2] * R[2][1])
            - R[0][1] * (R[1][0] * R[2][2] - R[1][2] * R[2][0])
            + R[0][2] * (R[1][0] * R[2][1] - R[1][1] * R[2][0]);
        if (Math.abs(determinant - 1) > 1e-7) throw new Error('The target rotation must have determinant +1.');
        return T;
    }
    function wristPoint(T) {
        validatePose(T);
        return T.slice(0, 3).map(row => row[3] - TOOL * row[2]);
    }
    function screwExponential(screw, angle) {
        finite(angle, 'Screw angle');
        const w = screw.omega, v = screw.v;
        if (Math.abs(norm(w) - 1) > 1e-8) throw new Error('This model uses unit revolute screw axes.');
        const W = [[0, -w[2], w[1]], [w[2], 0, -w[0]], [-w[1], w[0], 0]];
        const W2 = multiply(W, W), c = Math.cos(angle), s = Math.sin(angle);
        const T = identity();
        for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
            T[i][j] = (i === j ? 1 : 0) + s * W[i][j] + (1 - c) * W2[i][j];
            T[i][3] += ((i === j ? angle : 0) + (1 - c) * W[i][j] + (angle - s) * W2[i][j]) * v[j];
        }
        return T;
    }
    function reduce(phi = DEFAULT_PHI) {
        finite(phi, 'Fixed q3');
        const Cphi = screwExponential(SCREWS[2], phi), Rphi = rotation(Cphi);
        // exp(S3 phi) exp(Sj qj) = exp(Ad_Cphi Sj qj) exp(S3 phi).
        // S3 goes through the world origin, so its adjoint has zero translation.
        const screws = SCREWS.filter(row => row.joint !== 3).map(row => ({
            joint: row.joint,
            omega: row.joint > 3 ? Rphi.map(r => dot(r, row.omega)) : row.omega.slice(),
            v: row.joint > 3 ? Rphi.map(r => dot(r, row.v)) : row.v.slice()
        }));
        const M = multiply(Cphi, fk([0, 0, 0, 0, 0, 0, 0]));
        const dhRows = DH.map(row => Object.assign({}, row, { fixed: row.joint === 3,
            theta: row.joint === 3 ? phi : `q${row.joint}`, thetaSymbol: row.joint === 3 ? 'phi' : `q${row.joint}` }));
        const homeWrist = [0, 0, H + L + U];
        return { phi, fixedQ3: phi, activeJoints: [1, 2, 4, 5, 6, 7], armJoints: [1, 2, 4], wristJoints: [5, 6, 7],
            dhRows, fixedFactor: dhFactor(3, phi), dhFactors: [
                { name: 'B1', rows: [1], expression: 'A1(q1)' },
                { name: 'B2', rows: [2, 3], expression: 'A2(q2) A3(phi)', composite: true },
                { name: 'B3', rows: [4], expression: 'A4(q4)' }
            ], screws, M, Cphi, poe: { screws, M, Cphi }, armScrews: screws.slice(0, 3),
            homeWrist, wristHome: homeWrist.slice(), armPoint: [0, 0, U], toolOffset: TOOL,
            homeTransform: M, a1: 0, method: 'geometric' };
    }
    function reducedPoeFK(activeQ, phi = DEFAULT_PHI) {
        if (!Array.isArray(activeQ) || activeQ.length !== 6) throw new Error('The reduced chain needs six active angles.');
        const model = reduce(phi);
        const product = activeQ.reduce((T, angle, i) => multiply(T, screwExponential(model.screws[i], angle)), identity());
        return multiply(product, model.M);
    }
    function jointLimitStatus(q) {
        joints(q);
        const violations = LIMITS.filter((limit, i) => q[i] < limit.lower - 1e-9 || q[i] > limit.upper + 1e-9)
            .map(limit => ({ joint: limit.joint, name: limit.name, value: q[limit.joint - 1], lower: limit.lower, upper: limit.upper }));
        return { withinLimits: violations.length === 0, violations };
    }
    function poseResidual(actual, target) {
        const p = position(actual), pd = position(target);
        const error = multiply(transpose(rotation(actual)), rotation(target));
        // atan2 avoids acos roundoff at a perfectly matched orientation.
        const sine = 0.5 * Math.hypot(error[2][1] - error[1][2], error[0][2] - error[2][0], error[1][0] - error[0][1]);
        const cosine = clamp((error[0][0] + error[1][1] + error[2][2] - 1) / 2);
        return { position: norm(p.map((x, i) => x - pd[i])), rotation: Math.atan2(sine, cosine),
            matrix: Math.max(...actual.flatMap((row, i) => row.map((x, j) => Math.abs(x - target[i][j])))) };
    }
    function getEquationContext(armBranch, target, phi = DEFAULT_PHI) {
        const theta = Array.isArray(armBranch) ? (armBranch.length === 7 ? [armBranch[0], armBranch[1], armBranch[3]] : armBranch)
            : armBranch.theta || [armBranch.q[0], armBranch.q[1], armBranch.q[3]];
        const pw = target ? (Array.isArray(target[0]) ? wristPoint(target) : target) : armFK(theta, phi);
        const [x, y] = pw, z = pw[2] - H, rho = Math.hypot(x, y), R = rho * rho + z * z;
        const [theta1, theta2, theta3] = theta;
        const c1 = Math.cos(theta1), s1 = Math.sin(theta1), c2 = Math.cos(theta2), s2 = Math.sin(theta2), c3 = Math.cos(theta3), s3 = Math.sin(theta3);
        const A = L + U * c3, B = -U * Math.cos(phi) * s3, C = -U * Math.sin(phi) * s3;
        const E = A * s2 + B * c2;
        return { H, L, U, phi, x, y, z, rho, rho2: rho * rho, R, A, B, C, E,
            c1, s1, c2, s2, c3, s3, theta1, theta2, theta3,
            sigma3: s3 < 0 ? -1 : 1, sigmaE: E < 0 ? -1 : 1 };
    }
    function positionContext(T, phi = DEFAULT_PHI) {
        finite(phi, 'Fixed q3');
        const pw = wristPoint(T), [x, y] = pw, z = pw[2] - H, rho2 = x * x + y * y;
        return { x, y, z, rho2, rho: Math.sqrt(rho2), R: rho2 + z * z, H, L, U, phi };
    }
    function equationSamples(phi = DEFAULT_PHI) {
        finite(phi, 'Fixed q3');
        const samples = [];
        // Cover all atan2 quadrants, including negative c2 and c3. With these
        // pairs, E has the requested sign for every phi and stays away from
        // zero; all fixture angles remain within the physical joint limits.
        const firstAngles = [-2.35, -0.65, 0.72, 2.44];
        const secondAngles = [1.10, 1.40, 1.75, 2.02];
        const thirdAngles = [0.73, 1.27, 1.83, 2.01];
        for (const sigma3 of [-1, 1]) for (const sigmaE of [-1, 1]) for (let i = 0; i < firstAngles.length; i++) {
            samples.push(getEquationContext([firstAngles[i], sigmaE * secondAngles[i], sigma3 * thirdAngles[i]], null, phi));
        }
        return samples;
    }
    function solveArm(pw, phi = DEFAULT_PHI) {
        if (!Array.isArray(pw) || pw.length !== 3) throw new Error('Wrist point needs three coordinates.');
        pw.forEach((x, i) => finite(x, `Wrist coordinate ${i + 1}`)); finite(phi, 'Fixed q3');
        const [x, y] = pw, z = pw[2] - H, rho2 = x * x + y * y, R = rho2 + z * z;
        const rawC3 = (R - L * L - U * U) / (2 * L * U), messages = [], branches = [];
        if (rawC3 < -1 - EPS || rawC3 > 1 + EPS) return { branches, messages: ['The wrist point is outside the arm reach.'], unreachable: true, singular: false };
        // Squared-distance roundoff otherwise turns an exactly straight arm
        // into spurious +/-1e-8 rad elbow branches after taking a square root.
        const boundedC3 = clamp(rawC3), c3 = 1 - Math.abs(boundedC3) < 1e-14 ? Math.sign(boundedC3) : boundedC3;
        const magnitude = Math.sqrt(Math.max(0, 1 - c3 * c3));
        const elbowSigns = magnitude < 1e-8 ? [1] : [1, -1];
        if (elbowSigns.length === 1) messages.push('The elbow branches coincide because sin(theta3) = 0.');
        for (const sigma3 of elbowSigns) {
            const s3 = sigma3 * magnitude, theta3 = Math.atan2(s3, c3);
            const A = L + U * c3, B = -U * Math.cos(phi) * s3, C = -U * Math.sin(phi) * s3;
            const radicand = rho2 - C * C;
            if (radicand < -EPS) continue;
            const eMagnitude = Math.sqrt(Math.max(0, radicand)), radialSigns = eMagnitude < 1e-8 ? [1] : [1, -1];
            if (radialSigns.length === 1) messages.push('The two signed radial branches coincide because E = 0.');
            for (const sigmaE of radialSigns) {
                const E = sigmaE * eMagnitude, D = A * A + B * B;
                let theta1 = 0, theta2 = 0;
                const families = [];
                if (D < 1e-16) {
                    if (Math.abs(z) > 1e-7 || Math.abs(E) > 1e-7) continue;
                    families.push('theta2 is free at the completely folded arm; theta2 = 0 is a representative.');
                } else theta2 = Math.atan2(A * E - B * z, B * E + A * z);
                if (rho2 < 1e-16) families.push('theta1 is free on axis 1; theta1 = 0 is a representative.');
                else theta1 = Math.atan2(E * y - C * x, E * x + C * y);
                const theta = [wrap(theta1), wrap(theta2), wrap(theta3)];
                if (norm(armFK(theta, phi).map((value, i) => value - pw[i])) > 1e-7) continue;
                const context = getEquationContext(theta, pw, phi);
                branches.push({ id: `arm-${sigma3 > 0 ? 'p' : 'm'}-${sigmaE > 0 ? 'p' : 'm'}`,
                    label: `sin(theta3) ${sigma3 > 0 ? '+' : '−'}, E ${sigmaE > 0 ? '+' : '−'}`,
                    theta, sigma3, sigmaE, context, families, singular: families.length > 0 || elbowSigns.length === 1 || radialSigns.length === 1 });
            }
        }
        if (!branches.length) messages.push('This wrist point is unreachable for the chosen fixed q3: rho² − C² < 0.');
        branches.forEach(branch => messages.push(...branch.families));
        return { branches, messages: [...new Set(messages)], unreachable: branches.length === 0, singular: branches.some(branch => branch.singular) };
    }
    function solveWrist(relativeRotation) {
        const W = relativeRotation, cb = clamp(W[2][2]), sb = Math.hypot(W[0][2], W[1][2]);
        if (sb > 1e-8) return [1, -1].map(sign => ({
            angles: [Math.atan2(sign * W[1][2], sign * W[0][2]), Math.atan2(sign * sb, cb), Math.atan2(sign * W[2][1], -sign * W[2][0])].map(wrap),
            sign, singular: false, family: null
        }));
        if (cb >= 0) {
            const total = Math.atan2(W[1][0], W[0][0]);
            return [{ angles: [total / 2, 0, total / 2], sign: 0, singular: true,
                family: `Wrist singularity: q6 = 0; q5 + q7 = ${total}. The displayed pair is one representative.` }];
        }
        const difference = Math.atan2(-W[1][0], -W[0][0]);
        return [{ angles: [difference / 2, PI, -difference / 2], sign: 0, singular: true,
            family: `Wrist singularity: q6 = pi; q5 − q7 = ${difference}. The displayed pair is one representative.` }];
    }
    function solveIK(T, phi = DEFAULT_PHI) {
        validatePose(T); finite(phi, 'Fixed q3');
        const pw = wristPoint(T), arm = solveArm(pw, phi), branches = [], messages = arm.messages.slice();
        for (const armBranch of arm.branches) {
            const R03 = rotation(armTransform(armBranch.theta, phi)), W = multiply(transpose(R03), rotation(T));
            for (const wrist of solveWrist(W)) {
                const q = [armBranch.theta[0], armBranch.theta[1], phi, armBranch.theta[2], ...wrist.angles];
                const residuals = poseResidual(fk(q), T);
                if (residuals.position > 1e-7 || residuals.rotation > 1e-7) {
                    messages.push('A numerically degenerate branch failed forward verification and was omitted.'); continue;
                }
                if (branches.some(branch => branch.q.every((value, i) => Math.abs(wrap(value - q[i])) < 1e-7))) continue;
                if (wrist.family) messages.push(wrist.family);
                branches.push(Object.assign({ id: `${armBranch.id}-w${wrist.sign < 0 ? 'm' : wrist.sign > 0 ? 'p' : 's'}`,
                    q, theta: armBranch.theta.slice(), armBranch: armBranch.id, armLabel: armBranch.label,
                    wristBranch: wrist.sign, wristLabel: wrist.sign === 0 ? 'singular family representative' : `sin(q6) ${wrist.sign > 0 ? '+' : '−'}`,
                    sigma3: armBranch.sigma3, sigmaE: armBranch.sigmaE, context: armBranch.context,
                    R03, R36: W, residuals, singular: armBranch.singular || wrist.singular,
                    families: armBranch.families.concat(wrist.family ? [wrist.family] : []) }, jointLimitStatus(q)));
            }
        }
        return { branches, armBranches: arm.branches, wristPoint: pw, fixedQ3: phi,
            messages: [...new Set(messages)], unreachable: branches.length === 0,
            singular: branches.some(branch => branch.singular), count: branches.length,
            feasibleCount: branches.filter(branch => branch.withinLimits).length,
            genericEight: branches.length === 8 && !branches.some(branch => branch.singular) };
    }
    return Object.freeze({ H, L, U, TOOL, DEFAULT_PHI, DEFAULT_Q, LIMITS, DH, SCREWS, EQUATION_DEFINITIONS,
        metadata: Object.freeze({ model: 'iiwa7', urdf: '../assets/models/iiwa7/iiwa7.urdf', frame: 'world → iiwa_link_ee',
            lengthUnit: 'm', angleUnit: 'rad', convention: 'standard D-H: Rz(theta) Tz(d) Tx(a) Rx(alpha)',
            reducedAngles: ['q1', 'q2', 'q4'], wristConvention: 'intrinsic Z-Y-Z', jointLimits: 'URDF physical lower / upper limits' }),
        identity, multiply, transpose, rotation, position, apply, wrap, dh, dhFactor, fk, armTransform, armFK, jointFrames,
        validatePose, wristPoint, reduce, reducedPoeFK, screwExponential, jointLimitStatus, poseResidual,
        getEquationContext, positionContext, equationSamples, solveArm, solveWrist, solveIK,
        armRotation: (theta, phi) => rotation(armTransform(theta, phi)),
        wristPosition: q => wristPoint(fk(q)), wristIK: solveWrist,
        residual: (q, T) => poseResidual(fk(q), T), checkLimits: jointLimitStatus });
}));
