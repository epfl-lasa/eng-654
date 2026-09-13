'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const E = require('../js/exercises/exercise-02-expressions.js');
const original = require('../../playground/math.js');
const model = require('../js/exercises/exercise-02-model.js');

test('the course-local parser matches playground arithmetic for every tutorial formula', () => {
    for (const phi of [0,Math.PI/6,-Math.PI/2,2.1]) for (const sample of model.equationSamples(phi)) {
        for (const formula of Object.values(model.EQUATION_DEFINITIONS)) {
            assert.equal(E.evaluate(formula,sample),original.evaluate(formula,sample),formula);
            assert.deepEqual(E.symbols(formula),original.symbols(formula));
        }
    }
    assert.deepEqual(Object.keys(E).sort(),['evaluate','parse','symbols']);
});

test('powers, unary signs, pi and supported functions retain their mathematical meaning', () => {
    const examples=[['-2^2',-4],['(-2)^2',4],['2^-3',.125],['2^3^2',512],['1e-3 + .2',.201],
        ['sin(pi/2)',1],['cos(pi)',-1],['tan(pi/4)',1],['sqrt(9)',3],['acos(-1)',Math.PI],
        ['atan2(-1,-1)',-3*Math.PI/4],['atan2(1,-1)',3*Math.PI/4]];
    examples.forEach(([text,value])=>assert.ok(Math.abs(E.evaluate(text)-value)<1e-14,text));
    assert.deepEqual(E.symbols('sin(q3)+q1*pi-q3'),['q1','q3']);
    assert.equal(E.evaluate('cos(theta)',{theta:'pi'}),-1);
});

test('arithmetic text cannot execute code or access prototypes and missing bindings fail', () => {
    for (const text of ['globalThis.process.exit()','constructor','__proto__','prototype','eval(1)',
        '(function(){return 1})()','x[0]','x.y','new Function(1)','Math.sin(1)','x=1','1;2']) {
        assert.throws(()=>E.evaluate(text),text);
    }
    assert.throws(()=>E.evaluate('x',Object.create({x:1})),/Set a value/);
    assert.throws(()=>E.evaluate('x',{x:'x'}),/Set a value/);
    assert.throws(()=>E.evaluate('x',{x:Infinity}),/finite/);
});

test('invalid real domains and excessive input are rejected', () => {
    for (const text of ['1/0','sqrt(-1)','acos(2)','(-1)^.5','1e999']) assert.throws(()=>E.evaluate(text),text);
    assert.throws(()=>E.parse('1'.repeat(501)),/500/);
    assert.throws(()=>E.parse('1+'.repeat(128)+'1'),/256/);
    assert.throws(()=>E.parse('q'.repeat(81)),/80/);
    assert.throws(()=>E.parse('sin(1,2)'),/arguments/);
    assert.throws(()=>E.parse('atan2(1)'),/arguments/);
});

test('standalone browser parser needs no root-level playground assets or network', () => {
    const sandbox={Math};vm.createContext(sandbox);
    const file=path.join(__dirname,'../js/exercises/exercise-02-expressions.js');
    vm.runInContext(fs.readFileSync(file,'utf8'),sandbox);
    assert.equal(sandbox.KinematicsMath,undefined);
    assert.equal(sandbox.Exercise02Expressions.evaluate('sqrt(16)+cos(pi)'),3);
});
