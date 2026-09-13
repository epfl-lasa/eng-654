'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const M = require('../js/exercises/exercise-02-model.js');
const T = require('../js/exercises/exercise-02-tutorial.js');
const document = require('../solutions/exercise_02_answers.json');
const answers = document.answers;
const clone = value => JSON.parse(JSON.stringify(value));

test('all 24 tutorial answers and eight reference limit answers validate', () => {
    assert.equal(T.MAIN_KEYS.length, 24); assert.equal(T.ROWS.length, 11);
    for (const [key, value] of Object.entries(answers)) assert.equal(T.validateAnswer(key, value, document.fixedQ3), true, key);
    assert.equal(T.validateAnswer('method', 'algebraic'), false);
    assert.equal(T.validateAnswer('wrist.home.z', '1.266'), false);
    assert.equal(T.validateAnswer('wrist.r33', 'cos(q5)'), false);
    assert.equal(T.validateAnswer('wrist.r33', 'sqrt(cos(q6)^2)'), false);
    assert.equal(T.validateAnswer('branches.count', '7'), false);
    assert.equal(T.validateAnswer('unknown', 'yes'), false);
});

test('strict equation scopes reject circular references, future angles and sampled constants', () => {
    for (const row of T.ROWS) {
        assert.equal(T.validateEquation(row.id, row.id.slice(3)), false, row.id);
        assert.equal(T.validateEquation(row.id, '0.5'), false, row.id);
    }
    assert.equal(T.validateEquation('eq.c2', 'cos(theta2)'), false);
    assert.equal(T.validateEquation('eq.c1', 'cos(theta1)'), false);
    assert.equal(T.validateEquation('eq.theta3', 'atan2(s3,sqrt(c3^2))'), false);
    assert.equal(T.validateEquation('eq.E', 'sigmaE*sqrt(rho2-C^2)'), true);
    assert.equal(T.validateEquation('eq.c2', '(A*z+B*E)/(B^2+A^2)'), true);
    assert.equal(T.validateEquation('eq.theta2', 'atan2(s2,c2)+2*pi'), true);
    assert.equal(T.validateEquation('eq.c3', 'globalThis.process.exit()'), false);
});

test('instructor document is safely sanitized and unfinished answers are retained', () => {
    const sanitized = T.validateDocument(document);
    assert.deepEqual(Object.keys(sanitized), ['schemaVersion','exercise','model','units','fixedQ3','targetQ','answers']);
    assert.equal(sanitized.reference, undefined); assert.deepEqual(sanitized.answers, answers);
    const unfinished = clone(document); unfinished.answers = { method: 'wrong', 'eq.c3': '', 'eq.s3': 'sigma3*sqrt(' };
    assert.deepEqual(T.validateDocument(unfinished).answers, unfinished.answers);
    sanitized.targetQ[0] = 0; assert.equal(document.targetQ[0], .35);
});

test('malformed, mismatched and unsafe imported documents are rejected before mutation', () => {
    const mutations = [d => {d.schemaVersion=2;},d => {d.exercise='exercise_01';},d => {d.model='other';},
        d=>{d.units.angle='deg';},d=>{d.fixedQ3=4;},d=>{d.fixedQ3=NaN;},d=>{d.targetQ=[0,0];},
        d=>{d.targetQ[1]=Infinity;},d=>{d.targetQ[0]=4;},d=>{d.targetQ[2]=0;},d=>{d.answers=[];},
        d=>{d.answers.unknown='yes';},d=>{d.answers.method={value:'geometric'};},d=>{d.answers.method='x'.repeat(501);},
        d=>{d.answers=JSON.parse('{"__proto__":"bad"}');},d=>{d.answers['limits.arm-p-p-wx']='yes';}];
    mutations.forEach((mutate,i)=>{const d=clone(document);mutate(d);assert.throws(()=>T.validateDocument(d),`mutation ${i}`);});
    const singular = clone(document); singular.answers={'limits.arm-p-p-ws':'yes'};
    assert.deepEqual(T.validateDocument(singular).answers, singular.answers);
});

test('student expressions calculate all eight full IK branches with stable IDs and FK verification', () => {
    for (const phi of [-2.9, -Math.PI/2, 0, Math.PI/6, Math.PI/2, 2.9]) {
        const q = T.lessonQ(phi), target = M.fk(q), calculated = T.runEquations(answers,target,phi), reference=M.solveIK(target,phi);
        assert.equal(calculated.count,8);assert.equal(calculated.executedStudentEquations,true);assert.equal(calculated.usedSingularFallback,false);
        assert.equal(calculated.feasibleCount,reference.feasibleCount);
        assert.deepEqual(calculated.branches.map(b=>b.id),reference.branches.map(b=>b.id));
        calculated.branches.forEach((branch,i)=>{
            assert.ok(branch.residuals.position<1e-12);assert.ok(branch.residuals.rotation<1e-12);
            branch.q.forEach((value,j)=>assert.ok(Math.abs(M.wrap(value-reference.branches[i].q[j]))<1e-11));
        });
        assert.equal(T.validateAnswer('branches.count','8',phi),true);
    }
});

test('runner truly uses student text instead of replacing it with the reference solution', () => {
    const target=M.fk(document.targetQ), amended=Object.assign({},answers,{'eq.theta1':'atan2(s1,c1)+1e-9'});
    // This change is within checker tolerance but remains visible numerically.
    assert.equal(T.validateEquation('eq.theta1',amended['eq.theta1']),true);
    const actual=T.runEquations(amended,target,document.fixedQ3), exact=M.solveIK(target,document.fixedQ3);
    actual.branches.forEach((branch,i)=>assert.ok(Math.abs(M.wrap(branch.q[0]-exact.branches[i].q[0])-1e-9)<1e-13));
    assert.equal(actual.usedSingularFallback,false);
});

test('runner cannot bypass failed equations or ignore the R derivation', () => {
    const target=M.fk(document.targetQ);
    assert.throws(()=>T.runEquations({},target,document.fixedQ3),/Check these equations/);
    assert.throws(()=>T.runEquations(Object.assign({},answers,{'eq.R':'0'}),target,document.fixedQ3),/eq.R/);
    assert.throws(()=>T.runEquations(Object.assign({},answers,{'eq.theta2':'theta2'}),target,document.fixedQ3),/eq.theta2/);
});

test('singular poses explicitly use family analysis and never claim regular student formulas produced it', () => {
    const poses=[
        [0,0,.52,0,0,0,0],
        [.3,.1,.52,0,.4,.8,.9],
        [.3,1.4,.52,0,.4,.8,.9],
        [.35,.55,.52,-1.1,.7,0,-.45]
    ];
    poses.forEach(q=>{
        const result=T.runEquations(answers,M.fk(q),q[2]);
        assert.equal(result.usedSingularFallback,true);assert.equal(result.executedStudentEquations,false);
        assert.equal(result.singular,true);assert.equal(result.genericEight,false);
        assert.ok(result.messages.some(message=>message.includes('not outputs of your regular equation blocks')));
        result.branches.forEach(b=>assert.ok(b.residuals.position<1e-7));
    });
});

test('unreachable targets return explicit empty student results', () => {
    const target=M.identity();target[0][3]=2;
    const outside=T.runEquations(answers,target,document.fixedQ3);
    assert.equal(outside.unreachable,true);assert.equal(outside.count,0);assert.equal(outside.usedSingularFallback,false);
    const obstruction=M.identity();obstruction[2][3]=M.H+.6+M.TOOL;
    const obstructed=T.runEquations(answers,obstruction,Math.PI/2);
    assert.equal(obstructed.unreachable,true);assert.equal(obstructed.count,0);
});

test('browser UMD loads and executes without modules, DOM or network', () => {
    const sandbox={console,Math};vm.createContext(sandbox);
    for (const file of ['js/exercises/exercise-02-expressions.js','js/exercises/exercise-02-model.js','js/exercises/exercise-02-equations.js','js/exercises/exercise-02-tutorial.js']) {
        const absolute=path.join(__dirname,'..',file);
        vm.runInContext(fs.readFileSync(absolute,'utf8'),sandbox);
    }
    sandbox.sourceAnswers=JSON.stringify(answers);
    const count=vm.runInContext('Exercise02Tutorial.runEquations(JSON.parse(sourceAnswers),Exercise02Model.fk(Exercise02Model.DEFAULT_Q),Exercise02Model.DEFAULT_PHI).count',sandbox);
    assert.equal(count,8);
});
