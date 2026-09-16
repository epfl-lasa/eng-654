import {QUIZ_QUESTIONS,quizAnswerDefaults} from './exercise-04-quiz.js';
export const TEXT_ANSWER_KEYS = Object.freeze([
  ...Array.from({length:3},(_,i)=>`crb.height.${i+1}`), 'crb.explanation',
  ...Array.from({length:8},(_,b)=>[1,2].map(n=>`iiwa.${b}.${n}`)).flat(), 'iiwa.explanation'
]);
export const ANSWER_KEYS = Object.freeze([...TEXT_ANSWER_KEYS,...QUIZ_QUESTIONS.map(q=>q.key)]);
const quizFields=new Map(QUIZ_QUESTIONS.map(q=>[q.key,q]));
export const emptyAnswers = () => ({...Object.fromEntries(TEXT_ANSWER_KEYS.map(key=>[key,''])),...quizAnswerDefaults()});
export function validatePayload(payload) {
  if (!payload || payload.schemaVersion!==1 || payload.exercise!=='exercise_04' || payload.units?.length!=='m' || payload.units?.angle!=='deg') throw new Error('Choose an Exercise 04 response file (metres and degree selections).');
  if (!payload.answers || typeof payload.answers!=='object' || Array.isArray(payload.answers)) throw new Error('The file needs an answers table.');
  const result=emptyAnswers();
  for(const [key,value] of Object.entries(payload.answers)) {
    const question=quizFields.get(key),invalid=()=>{throw new Error(`Invalid response field: ${key.slice(0,80)}.`);};
    if(question){
      const allowed=question.options.map(option=>option.id);
      if(question.multiple){
        if(!Array.isArray(value)||value.length>allowed.length||new Set(value).size!==value.length||value.some(id=>typeof id!=='string'||!allowed.includes(id)))invalid();
        result[key]=allowed.filter(id=>value.includes(id));
      }else{
        if(typeof value!=='string'||(value!==''&&!allowed.includes(value)))invalid();
        result[key]=value;
      }
    }else{
      if(!TEXT_ANSWER_KEYS.includes(key)||typeof value!=='string'||value.length>(key.endsWith('explanation')?4000:50))invalid();
      result[key]=value;
    }
  }
  return result;
}
export function createPayload(answers) {
  const payload={schemaVersion:1,exercise:'exercise_04',model:'abb_crb_15000_and_iiwa7',units:{length:'m',angle:'deg'},exportedAt:new Date().toISOString(),answers};
  payload.answers=validatePayload(payload); return payload;
}
export function parsePayload(text) {
  if(typeof text!=='string'||text.length>524288) throw new Error('Choose a JSON response file smaller than 512 KB.');
  let payload; try { payload=JSON.parse(text); } catch { throw new Error('This file is not valid JSON.'); }
  return validatePayload(payload);
}
