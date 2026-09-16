const {test,before}=require('node:test');
const assert=require('node:assert/strict');
let Q,A;
const key={
 'quiz.urdf':['axis-local','visual-separate','pose-units'],
 'quiz.dh':'standard',
 'quiz.tool-twist':['point-shift','rotation-rank'],
 'quiz.general-6r':'sixteen',
 'quiz.elimination':['half-angle','reconstruct','extraneous'],
 'quiz.paden-kahan':'one-axis',
 'quiz.jacobian-types':['angular-velocity','representation'],
 'quiz.rectangular-rank':'rank-six',
 'quiz.null-space':['projection','costs'],
 'quiz.redundant-family':'one',
 'quiz.iiwa-parameter':['eight-branches','limits-filter','parameter-failure'],
 'quiz.cuspidality':'nonsingular-change',
 'quiz.critical-values':['fold-pair','cusp-triple','full-preimage'],
 'quiz.path-feasibility':'continuous',
 'quiz.planning-strategies':['hybrid','global']
};
before(async()=>{Q=await import('../js/exercises/exercise-04-quiz.js');A=await import('../js/exercises/exercise-04-answers.js');});

test('the review has exactly fifteen distinct questions and the checkbox promise is true',()=>{
 assert.equal(Q.QUIZ_QUESTIONS.length,15);assert.equal(new Set(Q.QUIZ_QUESTIONS.map(q=>q.id)).size,15);assert.equal(Q.QUIZ_QUESTIONS.filter(q=>q.multiple).length,8);
 assert.equal(Q.QUIZ_GROUPS.length,5);for(let group=0;group<5;group++)assert.equal(Q.QUIZ_QUESTIONS.filter(q=>q.group===group).length,3);
 assert.match(Q.QUIZ_INSTRUCTIONS,/Square options: more than one answer is correct/);assert.match(Q.QUIZ_INSTRUCTIONS,/Round options: choose one/);
 for(const q of Q.QUIZ_QUESTIONS){assert.equal(q.options.length,4);assert.equal(new Set(q.options.map(o=>o.id)).size,4);assert.ok(q.options.every(o=>o.id&&o.text));assert.equal('correct' in q,false);assert.equal('explanation' in q,false);if(q.multiple)assert.ok(key[q.key].length>=2);else assert.equal(typeof key[q.key],'string');}
});

test('every multi-answer grade uses an exact set, independent of order',()=>{
 assert.equal(Q.gradeQuiz(key).passed,15);assert.equal(Q.gradeQuiz(A.emptyAnswers()).passed,0);
 for(const q of Q.QUIZ_QUESTIONS.filter(q=>q.multiple)){
  const correct=key[q.key],grade=value=>Q.gradeQuiz({...key,[q.key]:value}).results.find(r=>r.key===q.key);
  assert.equal(grade(correct.slice().reverse()).correct,true);
  for(let i=0;i<correct.length;i++)assert.equal(grade(correct.filter((_,j)=>i!==j)).correct,false);
  for(const wrong of q.options.map(o=>o.id).filter(id=>!correct.includes(id)))assert.equal(grade([...correct,wrong]).correct,false);
  assert.equal(grade([...correct,correct[0]]).correct,false);assert.equal(grade(correct.join(',')).correct,false);assert.equal(grade(['unrecognized']).correct,false);
 }
});

test('single-answer questions reject every distractor, arrays and blank selections',()=>{
 for(const q of Q.QUIZ_QUESTIONS.filter(q=>!q.multiple)){
  const grade=value=>Q.gradeQuiz({...key,[q.key]:value}).results.find(r=>r.key===q.key);
  assert.equal(grade(key[q.key]).correct,true);assert.equal(grade('').answered,false);assert.equal(grade([key[q.key]]).correct,false);
  for(const option of q.options.filter(o=>o.id!==key[q.key]))assert.equal(grade(option.id).correct,false);
 }
});

test('grading leaves saved responses unchanged and files preserve string/array types',()=>{
 const answers={...A.emptyAnswers(),...structuredClone(key)},before=JSON.stringify(answers);Q.gradeQuiz(answers);assert.equal(JSON.stringify(answers),before);
 const parsed=A.parsePayload(JSON.stringify(A.createPayload(answers)));assert.equal(Q.gradeQuiz(parsed).passed,15);
 parsed['quiz.urdf'].push('mesh-axis');assert.equal(answers['quiz.urdf'].length,3);assert.equal(Q.gradeQuiz(parsed).passed,14);
});

test('the questions distinguish physical rank, chart failure, multiplicity and continuity',()=>{
 const byId=id=>Q.QUIZ_QUESTIONS.find(q=>q.id===id);
 assert.match(byId('dh').prompt,/frame i expressed in frame i−1/);
 assert.match(byId('general-6r').prompt,/finitely many isolated/);assert.match(byId('general-6r').prompt,/modulo 2π/);
 assert.match(byId('redundant-family').prompt,/six independent/);assert.match(byId('iiwa-parameter').options[0].text,/this model/);
 assert.match(byId('rectangular-rank').prompt,/6 × 7/);assert.match(byId('paden-kahan').prompt,/Paden–Kahan/);
 assert.match(byId('critical-values').options[0].text,/other IKs.*regular/);
 assert.match(Q.gradeQuiz(key).results.find(r=>r.id==='critical-values').explanation,/not the total number of distinct/);
 assert.match(byId('path-feasibility').options[0].text,/continuous joint path/);
});
