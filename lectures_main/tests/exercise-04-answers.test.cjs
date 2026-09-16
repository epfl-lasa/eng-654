const {test,before}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
let A;
before(async()=>{A=await import('../js/exercises/exercise-04-answers.js');});
test('student response files and the separate instructor key share the upload schema',()=>{
 const key=fs.readFileSync(path.join(__dirname,'../solutions/exercise_04_answers.json'),'utf8');
 const answers=A.parsePayload(key);assert.equal(Object.keys(answers).length,36);
 assert.deepEqual(A.parsePayload(JSON.stringify(A.createPayload(answers))),answers);
 assert.equal(new Set([1,2,3].map(i=>answers[`crb.height.${i}`])).size,3);
 for(let b=0;b<8;b++)assert.notEqual(answers[`iiwa.${b}.1`],answers[`iiwa.${b}.2`]);
});
test('legacy schema-1 files retain text responses and receive empty quiz fields',()=>{
 const old={schemaVersion:1,exercise:'exercise_04',units:{length:'m',angle:'deg'},answers:{'crb.height.1':'0.5','iiwa.0.1':'-80'}};
 const answers=A.validatePayload(old);assert.equal(answers['crb.height.1'],'0.5');assert.equal(answers['iiwa.0.1'],'-80');assert.deepEqual(answers['quiz.urdf'],[]);assert.equal(answers['quiz.dh'],'');
 const fresh=A.emptyAnswers();answers['quiz.urdf'].push('axis-local');assert.deepEqual(fresh['quiz.urdf'],[]);
});
test('quiz uploads preserve whitelisted selections and reject wrong types, extras and duplicates',()=>{
 const p=A.createPayload(A.emptyAnswers()),answers={...p.answers,'quiz.urdf':['pose-units','axis-local'],'quiz.dh':'standard'};
 const parsed=A.validatePayload({...p,answers});assert.deepEqual(parsed['quiz.urdf'],['axis-local','pose-units']);assert.equal(parsed['quiz.dh'],'standard');
 assert.deepEqual(A.parsePayload(JSON.stringify(A.createPayload(parsed))),parsed);
 for(const value of ['axis-local',[['axis-local']],['unknown'],['axis-local','axis-local'],[null],Array(100).fill('axis-local')])assert.throws(()=>A.validatePayload({...p,answers:{'quiz.urdf':value}}));
 for(const value of [['standard'],'unknown',null,12])assert.throws(()=>A.validatePayload({...p,answers:{'quiz.dh':value}}));
 assert.throws(()=>A.validatePayload({...p,answers:{'quiz.unknown':[]}}));
});
test('uploads reject the wrong exercise, wrong units, malformed and oversized answer content',()=>{
 const p=A.createPayload(A.emptyAnswers());
 assert.throws(()=>A.validatePayload({...p,exercise:'exercise_03'}));
 assert.throws(()=>A.validatePayload({...p,units:{length:'m',angle:'rad'}}));
 assert.throws(()=>A.validatePayload({...p,answers:{unknown:'1'}}));
 assert.throws(()=>A.validatePayload({...p,answers:{'crb.height.1':.35}}));
 assert.throws(()=>A.parsePayload('{bad json'));
 assert.throws(()=>A.parsePayload(' '.repeat(524289)));
 assert.throws(()=>A.validatePayload({...p,answers:{'iiwa.explanation':'x'.repeat(4001)}}));
});
test('student exercise files have no link or import of the instructor answer file',()=>{
 for(const name of ['exercises/exercise_04.html','js/exercises/exercise-04.js','js/exercises/exercise-04-crb-model.js','js/exercises/exercise-04-iiwa-model.js']){
 const source=fs.readFileSync(path.join(__dirname,'..',name),'utf8');
 assert.doesNotMatch(source,/solutions\/|exercise_04_answers\.json|exercise04-(?:crb|iiwa)-solutions\.json/);
 }
});
