// Course review: conceptual questions and local feedback. No network or answer
// file is required; explanations enter the DOM only after a check is requested.
export const QUIZ_INSTRUCTIONS='Square options: more than one answer is correct. Select all correct options. Round options: choose one.';
export const QUIZ_GROUPS=Object.freeze(['Robot descriptions and coordinates','Solving inverse kinematics','Velocities and singularities','Redundancy and global geometry','Following a complete path']);
const definitions=[
  {id:'urdf',group:0,multiple:true,prompt:'Which statements correctly describe URDF kinematics?',options:[
    ['axis-local','A joint axis is expressed in that joint’s frame.'],
    ['visual-separate','Changing only a visual mesh origin does not change the joint kinematic chain.'],
    ['pose-units','Joint-origin xyz values use metres, and rpy values use radians.'],
    ['mesh-axis','The direction of a link’s longest mesh edge defines its revolute joint axis.']
  ],correct:['axis-local','visual-separate','pose-units'],explanation:'Joint origins and axes define the motion. Visual geometry has separate placement; its shape does not define a joint axis. URDF uses metres and radians.',reference:'lecture_02.html · Joint origin and axis define one kinematic edge'},
  {id:'dh',group:0,multiple:false,prompt:'For the standard D–H convention used in the course, which ordered product gives the pose of frame i expressed in frame i−1?',options:[
    ['standard','Rz(θᵢ) Tz(dᵢ) Tx(aᵢ) Rx(αᵢ)'],
    ['reverse','Rx(αᵢ) Tx(aᵢ) Tz(dᵢ) Rz(θᵢ)'],
    ['all-z','Rz(θᵢ) Tz(dᵢ) Tz(aᵢ) Rz(αᵢ)'],
    ['all-x','Rx(θᵢ) Tx(dᵢ) Tx(aᵢ) Rx(αᵢ)']
  ],correct:['standard'],explanation:'Standard D–H first rotates and translates along zᵢ₋₁, then translates and rotates along xᵢ. This matrix maps coordinates in frame i into frame i−1. Transform order and the chosen convention matter.',reference:'lecture_01.html · Denavit–Hartenberg convention'},
  {id:'tool-twist',group:0,multiple:true,prompt:'Let r = pQ − pP join two points fixed on the same rigid tool. All vectors use one common frame. Which statements are correct?',options:[
    ['point-shift','The velocities satisfy vQ = vP + ω × r.'],
    ['rotation-rank','Expressing the same point’s geometric twist in another orthonormal frame preserves the Jacobian rank.'],
    ['same-linear','The linear velocity is identical at every point on a rotating tool.'],
    ['zero-angular','Changing the tool point makes the angular-velocity rows of its Jacobian zero.']
  ],correct:['point-shift','rotation-rank'],explanation:'A rigid tool has one angular velocity; its linear velocity depends on the reference point. A frame rotation is invertible and therefore preserves Jacobian rank.',reference:'lecture_02.html · Twist at the tool point; lecture_07.html · Evaluate the twist at the tool'},
  {id:'general-6r',group:1,multiple:false,prompt:'For a general nonredundant 6R serial robot and a full-pose target with finitely many isolated IKs, what is the largest possible number of isolated real solutions before joint limits are applied? Count angles modulo 2π.',options:[
    ['six','6'],['eight','8'],['sixteen','16'],['infinite','Always infinitely many']
  ],correct:['sixteen'],explanation:'A general 6R mechanism can attain 16 isolated real pose solutions. Special geometry can lower the maximum; many targets have fewer, and singular targets can have non-isolated families.',reference:'lecture_07.html · ABB CRB degree-16 IK and slice with 16 real IKs'},
  {id:'elimination',group:1,multiple:true,prompt:'Which checks belong in an algebraic IK pipeline?',options:[
    ['half-angle','With t = tan(q/2), treat the missing q = π chart point explicitly or use another chart.'],
    ['reconstruct','Reconstruct the joint angles and verify each candidate using the original FK equations.'],
    ['extraneous','Squaring equations or clearing denominators can introduce candidates that need rejection.'],
    ['complex-real','Every complex root of the elimination polynomial is a real robot configuration.']
  ],correct:['half-angle','reconstruct','extraneous'],explanation:'Elimination produces candidates, not automatically valid real IKs. Recover missing chart cases, reconstruct all variables, and check the original equations before applying joint limits.',reference:'lecture_03.html · Ordered-elimination algorithm; lecture_07.html · Reconstruct and verify IK'},
  {id:'paden-kahan',group:1,multiple:false,prompt:'What geometric problem does Paden–Kahan subproblem 1 solve?',options:[
    ['one-axis','Find a rotation about one given axis that brings one given point onto another.'],
    ['two-axes','Find two rotations about two given axes whose combined action registers the points.'],
    ['distance','Find an axis rotation that places a point at a specified distance from another point.'],
    ['newton','Take one Newton iteration on all six pose equations.']
  ],correct:['one-axis'],explanation:'PK1 is point registration using one axis. Feasibility requires equal axial projections and equal orbit radii; with a nonzero radius, a feasible angle is unique modulo 2π.',reference:'lecture_03.html · Paden–Kahan subproblem 1: point registration'},
  {id:'jacobian-types',group:2,multiple:true,prompt:'How do geometric and analytical Jacobians differ for a full-pose task?',options:[
    ['angular-velocity','The geometric Jacobian maps joint rates to linear and angular velocity.'],
    ['representation','The analytical Jacobian uses rates of the chosen orientation parameters; an orientation-dependent map relates these rates to angular velocity.'],
    ['always-equal','Their orientation rows are always identical, regardless of the orientation representation.'],
    ['chart-physical','An Euler-angle chart singularity always means that the robot’s geometric Jacobian loses rank.']
  ],correct:['angular-velocity','representation'],explanation:'Angular velocity is a physical vector; orientation-coordinate rates depend on the selected chart. At a regular chart the rate mapping is invertible. A chart singularity and a physical kinematic singularity are different issues.',reference:'lecture_05.html · Geometric versus analytical Jacobian'},
  {id:'rectangular-rank',group:2,multiple:false,prompt:'A 7R robot has a 6 × 7 geometric Jacobian and can generically control all six tool-velocity components. Which test establishes full instantaneous task mobility at a configuration?',options:[
    ['rank-six','The Jacobian has rank 6, equivalently all six singular values are nonzero.'],
    ['det-seven','The determinant of the 6 × 7 Jacobian is nonzero.'],
    ['rank-seven','The Jacobian has rank 7.'],
    ['one-free','The robot has seven joints, so no rank test is needed.']
  ],correct:['rank-six'],explanation:'A 6 × 7 matrix has no determinant and cannot have rank 7. Full row rank six means every six-component tool velocity is locally attainable.',reference:'lecture_08.html · Check the full 6 × 7 Jacobian'},
  {id:'null-space',group:2,multiple:true,prompt:'At full row rank, use the exact Moore–Penrose pseudoinverse J⁺ and N = I − J⁺J. Which statements are correct?',options:[
    ['projection','JN = 0, so adding Nη to a joint-rate solution preserves the instantaneous task velocity.'],
    ['costs','A projected negative cost gradient can prefer joint centering, a joint-limit barrier, or a reference posture.'],
    ['unprojected','Any unprojected joint-rate vector may be added without changing the tool velocity.'],
    ['guarantee','A joint-centering cost guarantees completion of every reachable task-space path.']
  ],correct:['projection','costs'],explanation:'The projector supplies internal motion while preserving the current task velocity. A secondary cost expresses a local preference; it does not guarantee global feasibility or eliminate the need for path validation.',reference:'lecture_08.html · Separate primary and secondary motion; Choose a secondary cost'},
  {id:'redundant-family',group:3,multiple:false,prompt:'Near a regular configuration of a 7R robot satisfying six independent fixed-pose constraints, what is the local dimension of the IK set, before joint limits or collisions?',options:[
    ['zero','0: the pose has only one isolated configuration.'],
    ['one','1: a continuous local self-motion family.'],
    ['six','6: one free parameter per pose coordinate.'],
    ['eight','8: eight independent redundant dimensions.']
  ],correct:['one'],explanation:'The local dimension is 7 − rank(J) = 1 at rank six. Finite branch counts arise after selecting a redundancy parameter; they do not describe the entire unfixed 7R IK family.',reference:'lecture_08.html · What is the null space?'},
  {id:'iiwa-parameter',group:3,multiple:true,prompt:'For the course KUKA iiwa 7 model, what must be remembered when q₃ is selected as the redundancy parameter?',options:[
    ['eight-branches','At a fixed q₃ and a regular finite solution, this model’s analytical construction can produce up to eight isolated IKs.'],
    ['limits-filter','Joint limits can remove some of those mathematical configurations.'],
    ['parameter-failure','The fixed-q₃ solve can become singular even while the full 6 × 7 Jacobian retains rank six.'],
    ['universal-eight','Every 7R architecture has exactly eight IKs for every pose and every selected q₃.']
  ],correct:['eight-branches','limits-filter','parameter-failure'],explanation:'Eight is a model-specific maximum for the parameterized solve, not a universal 7R count. Holding q₃ can remove a needed local direction even when changing q₃ would retain full tool mobility.',reference:'lecture_08.html · Parameter singularity versus full-Jacobian rank'},
  {id:'cuspidality',group:3,multiple:false,prompt:'Which observation demonstrates cuspidality for the nonredundant position or pose task being studied?',options:[
    ['nonsingular-change','A continuous nonsingular joint path connects distinct IKs of the same task value.'],
    ['four-iks','One task value has four real IKs.'],
    ['negative-det','The determinant is negative at one configuration.'],
    ['mesh-overlap','Two link meshes appear to overlap from one camera angle.']
  ],correct:['nonsingular-change'],explanation:'Cuspidality concerns a nonsingular change of solution. Several IKs at one task value, or a determinant sign at one configuration, do not establish that global connection.',reference:'lecture_06.html · Nonsingular change of solution; lecture_07.html · Cuspidal 3R paths'},
  {id:'critical-values',group:4,multiple:true,prompt:'For generic folds and cusps of the nonredundant custom 3R position map, which statements are correct?',options:[
    ['fold-pair','Two IK branches coalesce at an ordinary fold; other IKs of that workspace point may remain regular.'],
    ['cusp-triple','Three IK branches coalesce at an ordinary cusp.'],
    ['full-preimage','The full preimage of a workspace critical-value curve can contain both singular and regular configurations.'],
    ['all-singular','Every IK of every point on a workspace critical-value curve must be singular.']
  ],correct:['fold-pair','cusp-triple','full-preimage'],explanation:'A critical value has at least one singular preimage, not necessarily only singular preimages. A fold merges two branches; a cusp merges three. These are multiplicities of merging branches, not the total number of distinct configurations remaining.',reference:'lecture_06.html · Aspects and critical values; Exercise 03 · Boundaries, folds and cusps'},
  {id:'path-feasibility',group:4,multiple:false,prompt:'Every pose of a requested path has at least one IK inside the joint limits. What further condition is required for a nonsingular traversal from a selected starting IK?',options:[
    ['continuous','The selected start must admit a continuous joint path that follows the poses while respecting limits and retaining the required Jacobian rank.'],
    ['nearest-any','Choose any legal IK independently at each pose; discontinuities are harmless.'],
    ['constant-count','Only the number of legal IKs must stay constant.'],
    ['start-only','Only the first pose and first Jacobian need checking.']
  ],correct:['continuous'],explanation:'Pose-wise existence does not establish branch continuity. A selected branch can hit a joint limit or singularity while other IKs remain available at the same workspace point.',reference:'lecture_07.html · Compare every starting IK along one path'},
  {id:'planning-strategies',group:4,multiple:true,prompt:'Which statements correctly compare numerical, analytical, and hybrid path planning?',options:[
    ['hybrid','A hybrid method can enumerate analytical starting IKs and then continue each using Jacobian prediction, pose correction, and feasibility checks.'],
    ['global','Analytical branches and their connections can reveal alternatives that a local numerical run does not explore.'],
    ['one-failure','Failure of one numerical run proves that no starting IK can follow the path.'],
    ['damping','Damping restores a task direction that is absent from a rank-deficient geometric Jacobian.']
  ],correct:['hybrid','global'],explanation:'Local continuation follows a selected branch; global branch information helps compare alternatives. One failed run is not a proof of global infeasibility, and damping cannot restore a missing physical velocity direction.',reference:'lecture_07.html · Numerical, analytical and hybrid path planning'}
];

export const QUIZ_QUESTIONS=Object.freeze(definitions.map(({correct,explanation,reference,...question})=>Object.freeze({...question,key:`quiz.${question.id}`,options:Object.freeze(question.options.map(([id,text])=>Object.freeze({id,text})))})));
export const quizAnswerDefaults=()=>Object.fromEntries(QUIZ_QUESTIONS.map(q=>[q.key,q.multiple?[]:'']));

export function gradeQuiz(answers={}){
  const results=definitions.map(q=>{
    const value=answers[`quiz.${q.id}`],selected=q.multiple?(Array.isArray(value)?value:[]):(typeof value==='string'&&value?[value]:[]);
    const valid=q.multiple?Array.isArray(value)&&selected.every(id=>typeof id==='string'&&q.options.some(option=>option[0]===id)):typeof value==='string';
    const correct=valid&&selected.length===q.correct.length&&new Set(selected).size===selected.length&&q.correct.every(id=>selected.includes(id));
    return {id:q.id,key:`quiz.${q.id}`,correct,answered:selected.length>0,explanation:q.explanation};
  });
  return {passed:results.filter(r=>r.correct).length,total:results.length,results};
}

let instanceCounter=0;
export function mountQuiz(host,{answers={},onChange=()=>{}}={}){
  if(!host?.ownerDocument)throw new Error('Provide an Exercise 04 quiz container.');
  const doc=host.ownerDocument,instance=++instanceCounter,fields=new Map();let values=answers,disabled=false;
  const element=(tag,className,text)=>{const node=doc.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};
  host.replaceChildren();host.append(element('p','ex04-quiz-instructions',QUIZ_INSTRUCTIONS));
  QUIZ_GROUPS.forEach((title,group)=>{
    const section=element('section','ex04-quiz-group');section.append(element('p','ex-kicker ex04-quiz-kicker',`Review ${group+1} · Questions ${group*3+1}–${group*3+3}`),element('h3','ex04-quiz-title',title));
    for(const [index,q] of QUIZ_QUESTIONS.entries())if(q.group===group){
      const field=element('fieldset','ex04-quiz-question');field.dataset.quizQuestion=q.id;
      const legend=element('legend','',`${index+1}. ${q.prompt}`),hint=element('p','ex04-quiz-hint',q.multiple?'Select all correct options. More than one is correct.':'Choose one option.');field.append(legend,hint);
      const inputs=[];
      for(const option of q.options){const label=element('label','ex04-quiz-choice'),input=element('input');input.type=q.multiple?'checkbox':'radio';input.name=`exercise04-quiz-${instance}-${q.id}`;input.value=option.id;input.dataset.quizAnswer=q.key;inputs.push(input);label.append(input,element('span','',option.text));field.append(label);
        input.addEventListener('change',()=>{const value=q.multiple?inputs.filter(input=>input.checked).map(input=>input.value):(inputs.find(input=>input.checked)?.value||'');values[q.key]=value;clearFeedback(q.key);onChange(q.key,q.multiple?value.slice():value);});
      }
      const bar=element('div','ex04-quiz-checkbar'),button=element('button','','Check question'),feedback=element('p','ex04-quiz-feedback');button.type='button';button.dataset.quizCheck=q.id;feedback.setAttribute('role','status');feedback.setAttribute('aria-live','polite');button.addEventListener('click',()=>showFeedback(gradeQuiz(values).results.find(result=>result.key===q.key)));bar.append(button,feedback);field.append(bar);section.append(field);fields.set(q.key,{field,inputs,button,feedback});
    }
    host.append(section);
  });
  function clearFeedback(key){const entry=fields.get(key);delete entry.field.dataset.state;entry.feedback.textContent='';}
  function showFeedback(result){const entry=fields.get(result.key);entry.field.dataset.state=result.correct?'correct':'incorrect';entry.feedback.textContent=result.correct?`Correct. ${result.explanation}`:!result.answered?'Choose your answer before checking.':`Review your selection. ${result.explanation}`;}
  function sync(nextAnswers=values){values=nextAnswers;for(const q of QUIZ_QUESTIONS){const value=values[q.key];for(const input of fields.get(q.key).inputs)input.checked=q.multiple?Array.isArray(value)&&value.includes(input.value):value===input.value;clearFeedback(q.key);}return values;}
  function checkAll(){const grade=gradeQuiz(values);grade.results.forEach(showFeedback);return grade;}
  function setDisabled(value){disabled=Boolean(value);for(const {inputs,button} of fields.values())for(const control of [...inputs,button])control.disabled=disabled;}
  sync(answers);return {sync,checkAll,setDisabled};
}
export const renderQuiz=mountQuiz;
