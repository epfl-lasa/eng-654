'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const M = require('../js/exercises/exercise-02-model.js');
const xml = fs.readFileSync(path.join(__dirname, '../assets/models/iiwa7/iiwa7.urdf'), 'utf8');

// Independent XML + quaternion FK. It never uses the model's D-H table,
// screw table, matrix rotations or jointFrames implementation.
function joint(name) {
    const block = xml.match(new RegExp(`<joint\\s+name="${name}"[\\s\\S]*?<\\/joint>`))[0];
    const origin = block.match(/<origin\s+([^>]+)\/?\s*>/)[1];
    const [xyz, rpy] = ['xyz', 'rpy'].map(key => origin.match(new RegExp(`${key}="([^"]+)"`))[1].trim().split(/\s+/).map(Number));
    const limit = block.match(/<limit\s+([^>]+)\/?\s*>/);
    return { xyz, rpy, limits: limit ? ['lower', 'upper'].map(key => Number(limit[1].match(new RegExp(`${key}="([^"]+)"`))[1])) : null };
}
const origins = [joint('world_iiwa_joint'), ...Array.from({ length: 7 }, (_, i) => joint(`iiwa_joint_${i + 1}`)), joint('iiwa_joint_ee')];
function qp(a, b) {
    const [w, x, y, z] = a, [v, i, j, k] = b;
    return [w*v-x*i-y*j-z*k,w*i+x*v+y*k-z*j,w*j-x*k+y*v+z*i,w*k+x*j-y*i+z*v];
}
function qa(axis, angle) { const a = [Math.cos(angle / 2), 0, 0, 0]; a[axis + 1] = Math.sin(angle / 2); return a; }
function rotate(q, v) { return qp(qp(q, [0, ...v]), [q[0], -q[1], -q[2], -q[3]]).slice(1); }
function independentFK(q) {
    let p = [0, 0, 0], r = [1, 0, 0, 0];
    function apply(origin) {
        const offset = rotate(r, origin.xyz); p = p.map((x, i) => x + offset[i]);
        const [roll, pitch, yaw] = origin.rpy;
        r = qp(r, qp(qp(qa(2, yaw), qa(1, pitch)), qa(0, roll)));
    }
    apply(origins[0]);
    q.forEach((angle, i) => { apply(origins[i + 1]); r = qp(r, qa(2, angle)); });
    apply(origins[8]);
    const columns = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map(axis => rotate(r, axis));
    return [0, 1, 2].map(i => [...columns.map(column => column[i]), p[i]]).concat([[0, 0, 0, 1]]);
}
function close(a, b, tolerance = 4e-12) {
    if (Array.isArray(a)) { assert.equal(a.length, b.length); a.forEach((value, i) => close(value, b[i], tolerance)); }
    else assert.ok(Math.abs(a - b) <= tolerance, `${a} differs from ${b} by ${Math.abs(a - b)}`);
}
function configuration(seed) { return M.LIMITS.map((limit, i) => Math.sin(seed * (0.27 + i * .13) + i * .41) * limit.upper * .89); }
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];

test('D-H FK matches actual iiwa7 URDF quaternion FK in 250 distinct configurations', () => {
    close(M.fk([0, 0, 0, 0, 0, 0, 0]), [[1,0,0,0],[0,1,0,0],[0,0,1,1.266],[0,0,0,1]]);
    for (let i = 0; i < 250; i++) { const q = configuration(i + .37); close(M.fk(q), independentFK(q)); }
});

test('physical limits match the actual URDF and are distinct from soft limits', () => {
    M.LIMITS.forEach((limit, i) => { close([limit.lower, limit.upper], origins[i + 1].limits); });
    assert.equal(M.checkLimits(M.DEFAULT_Q).withinLimits, true);
    const q = M.DEFAULT_Q.slice(); q[6] = 176 * Math.PI / 180;
    assert.deepEqual(M.checkLimits(q).violations.map(row => row.joint), [7]);
});

test('PoE conjugation and home update match exact FK for every selectable frozen q3', () => {
    for (let i = 0; i < 80; i++) {
        const q = configuration(i + .63), phi = q[2], reduced = M.reduce(phi);
        close(M.reducedPoeFK([q[0], q[1], q[3], q[4], q[5], q[6]], phi), independentFK(q));
        close(reduced.M, M.fk([0, 0, phi, 0, 0, 0, 0]));
        close(reduced.homeWrist, [0, 0, 1.14]);
        close(M.wristPoint(reduced.M), reduced.homeWrist);
        assert.equal(reduced.dhRows[2].fixed, true); close(reduced.fixedFactor, M.dhFactor(3, phi));
        assert.deepEqual(reduced.armScrews.map(screw => screw.joint), [1, 2, 4]);
        close(reduced.armScrews[2].omega, [Math.sin(phi), -Math.cos(phi), 0]);
        const angles = [q[0], q[1], q[3]], armPoe = angles.reduce((T, angle, j) =>
            M.multiply(T, M.screwExponential(reduced.armScrews[j], angle)), M.identity());
        close(M.apply(armPoe, reduced.homeWrist), M.armFK(angles, phi));
    }
});

test('wrist is the common point of actual URDF axes 5, 6 and 7; remove the full 126 mm tool offset', () => {
    for (let i = 0; i < 40; i++) {
        const q = configuration(i + .21), T = independentFK(q), pw = M.wristPoint(T), frames = M.jointFrames(q);
        close(M.armFK([q[0], q[1], q[3]], q[2]), pw);
        close(M.wristPosition(q), pw);
        frames.slice(4).forEach(frame => close(cross(pw.map((x, j) => x - frame.origin[j]), frame.axis), [0,0,0]));
        const urdfTool = M.identity(); urdfTool[2][3] = .045;
        close(M.multiply(frames[6].transform, urdfTool), T);
    }
});

test('default tutorial pose gives eight unique exact branches, six within joint limits', () => {
    const T = independentFK(M.DEFAULT_Q), result = M.solveIK(T, M.DEFAULT_PHI);
    assert.equal(result.count, 8); assert.equal(result.genericEight, true); assert.equal(result.feasibleCount, 6);
    assert.equal(result.armBranches.length, 4); assert.deepEqual(result.messages, []);
    assert.equal(new Set(result.branches.map(branch => branch.id)).size, 8);
    result.branches.forEach(branch => {
        close(independentFK(branch.q), T); close(branch.q[2], M.DEFAULT_PHI);
        assert.ok(branch.residuals.position < 1e-12); assert.ok(branch.residuals.rotation < 1e-12);
    });
    assert.ok(result.branches.some(branch => branch.q.every((angle, i) => Math.abs(angle - M.DEFAULT_Q[i]) < 1e-10)));
    assert.deepEqual(result.branches.filter(branch => !branch.withinLimits).map(branch => branch.violations.map(v => v.joint)), [[7], [7]]);
});

test('analytic IK recovers each sampled configuration without seed solving or fabricated branches', () => {
    for (let i = 0; i < 150; i++) {
        const q = configuration(i + .31), T = independentFK(q), result = M.solveIK(T, q[2]);
        assert.equal(result.unreachable, false); assert.ok(result.count > 0 && result.count <= 8);
        assert.ok(result.branches.some(branch => branch.q.every((angle, j) => Math.abs(M.wrap(angle - q[j])) < 1e-7)), `Original pose ${i} is present.`);
        result.branches.forEach(branch => close(independentFK(branch.q), T, 1e-10));
    }
});

test('four-arm geometry identities and Cramer backsubstitution cover both independent signs', () => {
    for (const phi of [0, Math.PI/6, Math.PI/2, -1.7, 2.9]) {
        const samples = M.equationSamples(phi);
        assert.equal(new Set(samples.map(s => `${s.sigma3}/${s.sigmaE}`)).size, 4);
        assert.ok(new Set(samples.map(s => s.c2.toFixed(4))).size >= 3);
        for (const key of ['c1', 's1', 'c2', 's2', 'c3', 's3']) {
            assert.ok(samples.some(s => s[key] < -.1), `${key} fixtures include a negative value.`);
            assert.ok(samples.some(s => s[key] > .1), `${key} fixtures include a positive value.`);
        }
        samples.forEach(s => {
            close(s.R, s.L*s.L+s.U*s.U+2*s.L*s.U*s.c3);
            close(s.x, s.c1*s.E-s.s1*s.C); close(s.y, s.s1*s.E+s.c1*s.C);
            close(s.z, s.A*s.c2-s.B*s.s2); close(s.E, s.A*s.s2+s.B*s.c2);
            close(s.E, s.sigmaE*Math.sqrt(s.rho2-s.C*s.C));
            close(s.c2, (s.B*s.E+s.A*s.z)/(s.A*s.A+s.B*s.B));
            close(s.s2, (s.A*s.E-s.B*s.z)/(s.A*s.A+s.B*s.B));
            close(s.c1, (s.E*s.x+s.C*s.y)/s.rho2); close(s.s1, (s.E*s.y-s.C*s.x)/s.rho2);
        });
    }
});

test('equation checker fixtures reject lost-quadrant angle formulas and self references', () => {
    const checker = require('../js/exercises/exercise-02-equations.js');
    for (const phi of [0, Math.PI / 6, -Math.PI / 3, Math.PI / 2]) {
        const samples = M.equationSamples(phi);
        for (const index of [1, 2, 3]) {
            const key = `theta${index}`, c = `c${index}`, s = `s${index}`;
            const options = { samples, variables: [c, s], angle: true };
            assert.equal(checker.checkExpression(`atan2(${s},${c})`, M.EQUATION_DEFINITIONS[key], options), true);
            assert.equal(checker.checkExpression(`atan2(${s},sqrt(${c}^2))`, M.EQUATION_DEFINITIONS[key], options), false,
                `${key} cannot replace the signed cosine with its magnitude.`);
            assert.equal(checker.checkExpression(`atan2(sqrt(${s}^2),${c})`, M.EQUATION_DEFINITIONS[key], options), false,
                `${key} cannot discard the sign of its sine.`);
            assert.equal(checker.checkExpression(key, M.EQUATION_DEFINITIONS[key], options), false,
                `${key} cannot use the unknown angle as its own answer.`);
            assert.equal(checker.checkExpression(String(samples[0][key]), M.EQUATION_DEFINITIONS[key], options), false,
                `${key} needs a function, not one numerical fixture value.`);
        }
    }
});

test('R03 transpose Rd is exactly a Z-Y-Z wrist and both branches reconstruct it', () => {
    const q = M.DEFAULT_Q, R03 = M.armRotation([q[0], q[1], q[3]], q[2]);
    const W = M.multiply(M.transpose(R03), M.rotation(M.fk(q)));
    close(W[2][2], Math.cos(q[5])); close(W[0][2], Math.cos(q[4])*Math.sin(q[5]));
    close(W[1][2], Math.sin(q[4])*Math.sin(q[5])); close(W[2][0], -Math.sin(q[5])*Math.cos(q[6]));
    close(W[2][1], Math.sin(q[5])*Math.sin(q[6]));
    const answers = M.wristIK(W); assert.equal(answers.length, 2);
    answers.forEach(answer => close(M.fk(q.slice(0, 4).concat(answer.angles)), M.fk(q)));
});

test('unreachable outer reach and frozen-q3 radial obstruction return no solutions', () => {
    const distant = M.identity(); distant[0][3] = 2; distant[2][3] = .4;
    assert.equal(M.solveIK(distant, M.DEFAULT_PHI).unreachable, true);
    const obstruction = M.identity(); obstruction[2][3] = M.H + .6 + M.TOOL;
    const result = M.solveIK(obstruction, Math.PI / 2);
    assert.equal(result.count, 0); assert.ok(result.messages.some(text => text.includes('rho')));
});

test('singular arm and wrist cases report families or merged branches instead of claiming eight', () => {
    const home = M.solveIK(M.fk([0,0,M.DEFAULT_PHI,0,0,0,0]), M.DEFAULT_PHI);
    assert.equal(home.singular, true); assert.equal(home.genericEight, false);
    assert.ok(home.messages.some(text => text.includes('theta1 is free')));
    home.branches.forEach(branch => close(M.fk(branch.q), M.fk([0,0,M.DEFAULT_PHI,0,0,0,0])));
    const q = M.DEFAULT_Q.slice(); q[5] = 0;
    const wrist = M.solveIK(M.fk(q), q[2]);
    assert.equal(wrist.singular, true); assert.ok(wrist.messages.some(text => text.includes('q5 + q7')));
    assert.ok(wrist.count < 8);
    const foldedQ = [.2,.4,.5,Math.PI,.3,.7,-.2], folded = M.solveIK(M.fk(foldedQ), foldedQ[2]);
    assert.equal(folded.singular, true); assert.ok(folded.messages.some(text => text.includes('theta2 is free')));
    folded.branches.forEach(branch => close(M.fk(branch.q), M.fk(foldedQ), 1e-8));
});

test('invalid target matrices, non-finite angles and wrong dimensions fail explicitly', () => {
    assert.throws(() => M.fk([0,0,0]), /seven/);
    assert.throws(() => M.fk([0,0,0,0,NaN,0,0]), /finite/);
    assert.throws(() => M.reduce(Infinity), /finite/);
    assert.throws(() => M.solveIK([[1]], 0), /homogeneous/);
    const reflection = M.identity(); reflection[0][0] = -1;
    assert.throws(() => M.solveIK(reflection, 0), /determinant/);
    const scaled = M.identity(); scaled[0][0] = 2;
    assert.throws(() => M.solveIK(scaled, 0), /orthonormal/);
});

test('UMD model loads in an offline browser global without require or DOM', () => {
    const sandbox = { Math, console }; vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/exercises/exercise-02-model.js'), 'utf8'), sandbox);
    assert.equal(sandbox.Exercise02Model.solveIK(sandbox.Exercise02Model.fk(sandbox.Exercise02Model.DEFAULT_Q), Math.PI/6).count, 8);
});
