/* Guided iiwa7 IK tutorial. Instructor answer files are never fetched here. */
(function () {
    'use strict';
    const M = window.Exercise02Model, K = window.Exercise02Expressions, Q = window.Exercise02Equations;
    const T = window.Exercise02Tutorial;
    const $ = selector => document.querySelector(selector);
    const $$ = selector => Array.from(document.querySelectorAll(selector));
    const STORAGE = 'eng654.exercise02.v1';
    const ORDER = ['setup', 'model', 'home', 'partition', 'method', 'elbow', 'radial', 'backsub', 'wrist', 'verify', 'pose', 'limits'];
    const FIELDS = {
        home: ['wrist.home.x', 'wrist.home.y', 'wrist.home.z', 'wrist.axes'],
        partition: ['partition.arm', 'partition.wrist'], method: ['method'],
        elbow: ['eq.R', 'eq.c3', 'eq.s3', 'eq.theta3'], radial: ['eq.E', 'arm.signReason'],
        backsub: ['eq.c2', 'eq.s2', 'eq.theta2', 'eq.c1', 'eq.s1', 'eq.theta1'],
        wrist: ['wrist.relative', 'wrist.convention', 'wrist.r33', 'wrist.count'], verify: ['branches.count']
    };
    const stageFor = key => Object.keys(FIELDS).find(stage => FIELDS[stage].includes(key)) || 'limits';
    let state = fresh(), lessonResult = null, ownResult = null, allowed = {}, passed = {};
    let selectedBranch = null;
    const builders = {}, scenes = {};
    function fresh() {
        return { schemaVersion: 1, exercise: 'exercise_02', model: 'iiwa7', units: { length: 'm', angle: 'rad' },
            fixedQ3: M.DEFAULT_PHI, targetQ: M.DEFAULT_Q.slice(), answers: {}, applied: false, reviewed: false, checked: {} };
    }
    const format = (n, digits = 6) => Math.abs(n) < 0.5 * 10 ** -digits ? '0' : Number(n.toFixed(digits)).toString();
    function element(tag, text, className) {
        const node = document.createElement(tag);
        if (text !== undefined && text !== null) node.textContent = text;
        if (className) node.className = className;
        return node;
    }
    function matrix(matrixValue, label) {
        const host = element('div', null, 'ex02-matrix-host');
        if (label) host.append(element('p', label));
        const grid = element('div', null, 'ex02-matrix');
        grid.style.gridTemplateColumns = `repeat(${matrixValue[0].length}, auto)`;
        grid.setAttribute('role', 'img'); grid.setAttribute('aria-label', (label || 'Matrix') + ': ' + matrixValue.map(row => row.map(v => format(v)).join(', ')).join('; '));
        matrixValue.forEach(row => row.forEach(value => grid.append(element('span', format(value)))));
        host.append(grid); return host;
    }
    function table(headers, rows) {
        const wrap = element('div', null, 'ex02-table-wrap'), node = element('table', null, 'ex02-table');
        wrap.tabIndex = 0; wrap.setAttribute('role', 'region'); wrap.setAttribute('aria-label', headers.join(', '));
        const head = element('thead'), tr = element('tr');
        headers.forEach(label => { const th = element('th', label); th.scope = 'col'; tr.append(th); });
        head.append(tr); node.append(head);
        const body = element('tbody');
        rows.forEach(values => { const row = element('tr'); values.forEach((value, i) => {
            const cell = element(i ? 'td' : 'th', value); if (!i) cell.scope = 'row'; row.append(cell);
        }); body.append(row); });
        node.append(body); wrap.append(node); return wrap;
    }
    function lessonQ() { const q = M.DEFAULT_Q.slice(); q[2] = state.fixedQ3; return q; }
    function homeQ() { return [0, 0, state.fixedQ3, 0, 0, 0, 0]; }
    function valid(key) { return T.validateAnswer(key, state.answers[key] || '', state.fixedQ3); }
    function stageCorrect(stage) {
        if (stage === 'setup') return state.applied;
        if (stage === 'model') return state.reviewed;
        if (stage === 'pose') return !!ownResult;
        if (stage === 'limits') return !!ownResult && ownResult.branches.length > 0 && ownResult.branches.every(branch => state.answers['limits.' + branch.id] === (branch.withinLimits ? 'yes' : 'no'));
        return (FIELDS[stage] || []).every(valid) && (stage !== 'verify' || !!lessonResult);
    }
    function updateGates() {
        let open = true, completed = 0;
        ORDER.forEach((stage, i) => {
            allowed[stage] = open;
            passed[stage] = !!(open && (['setup', 'model', 'pose'].includes(stage) || state.checked[stage]) && stageCorrect(stage));
            const section = $(`[data-stage="${stage}"]`), content = section.querySelector('[data-stage-content]');
            content.hidden = !open; content.inert = !open;
            section.querySelector('.stage-lock').hidden = open;
            if (!open) section.querySelector('.stage-lock').textContent = 'Complete the preceding step to unlock this slide.';
            const next = $(`[data-continue="${stage}"]`);
            if (next) { next.hidden = !passed[stage] || stage === 'limits'; next.href = '#slide-' + (i + 3); }
            const status = $(`[data-status="${stage}"]`);
            if (status) status.textContent = passed[stage] ? (stage === 'model' ? 'Derivation recorded. Next step unlocked.' : 'Correct. Next step unlocked.') : state.checked[stage] && open ? 'Some answers are incorrect.' : '';
            if (passed[stage]) completed += 1;
            open = !!passed[stage];
        });
        $('#progress').textContent = `${completed} / ${ORDER.length} steps complete`;
        $('#arm-representation-area').hidden = !passed.partition;
        $('#arm-results').hidden = !passed.backsub;
        $('#wrist-example').hidden = !passed.wrist;
        $('#method-remediation').hidden = !(allowed.method && state.checked.method && !valid('method'));
        $('#completion').hidden = !passed.limits;
        if (scenes.home) scenes.home.update(homeQ(), { showWrist: !!passed.home, showAxes: true,
            caption: passed.home ? 'Wrist centre identified · reduced home' : 'Reduced home · joint axes from the URDF' });
        if (scenes.method) scenes.method.update(homeQ(), { showWrist: !!passed.home, showAxes: true, caption: 'Inspect the reduced robot' });
        if (passed.backsub) renderArmResults();
        if (passed.wrist) renderWristExample();
    }
    function invalidateFrom(stage) {
        const index = ORDER.indexOf(stage);
        ORDER.slice(index).forEach(name => { delete state.checked[name]; });
        if (index <= ORDER.indexOf('verify')) { lessonResult = null; $('#lesson-results').hidden = true; }
        if (index <= ORDER.indexOf('pose')) {
            ownResult = null; selectedBranch = null;
            $('#own-solve-status').textContent = '';
        }
    }
    function mark(key, correct, nonempty) {
        const wrap = $(`[data-answer-wrap="${key}"]`);
        if (!wrap) return;
        if (!nonempty) { delete wrap.dataset.result; wrap.querySelector('.answer-result').textContent = ''; wrap.querySelectorAll('input,select').forEach(input => input.removeAttribute('aria-invalid')); return; }
        wrap.dataset.result = correct ? 'correct' : 'incorrect';
        wrap.querySelector('.answer-result').textContent = correct ? 'Correct' : 'Incorrect';
        wrap.querySelectorAll('input,select').forEach(input => input.setAttribute('aria-invalid', String(!correct)));
    }
    function showFeedback(stage) {
        if (builders[stage]) builders[stage].checkAll();
        (FIELDS[stage] || []).filter(key => !key.startsWith('eq.')).forEach(key => mark(key, valid(key), !!state.answers[key]));
    }
    function record(key, value) {
        state.answers[key] = value;
        invalidateFrom(stageFor(key));
        if (stageFor(key) === 'limits') $('#limit-summary').textContent = '';
        mark(key, false, false); updateGates(); save();
    }
    function responseDocument() {
        return { schemaVersion: 1, exercise: 'exercise_02', model: 'iiwa7', units: { length: 'm', angle: 'rad' },
            fixedQ3: state.fixedQ3, targetQ: state.targetQ.slice(), answers: Object.assign({}, state.answers),
            session: { applied: state.applied, reviewed: state.reviewed, checked: state.checked,
                ranLesson: !!lessonResult, ranOwn: !!ownResult } };
    }
    function save() {
        try { localStorage.setItem(STORAGE, JSON.stringify(responseDocument())); }
        catch (_) { $('#file-status').textContent = 'Browser storage is unavailable. Download your responses to keep them.'; }
    }
    function renderRepresentation() {
        const representation = state.representation || 'dh';
        $$('[data-phi]').forEach(node => { node.textContent = format(state.fixedQ3); });
        $$('[data-representation]').forEach(button => { button.setAttribute('aria-pressed', String(button.dataset.representation === representation)); });
        const full = $('#full-representation'), arm = $('#arm-representation'); full.replaceChildren(); arm.replaceChildren();
        if (representation === 'dh') {
            full.append(element('h3', 'Derive the D-H representation'));
            full.append(element('p', 'Use standard D-H: Aᵢ = Rz(θᵢ) Tz(dᵢ) Tx(aᵢ) Rx(αᵢ). Distances are in metres and angles in radians.'));
            full.append(element('p', 'Assign the frames and construct your parameter table. Identify which transform becomes constant when q₃ is fixed, evaluate it for your chosen φ, and write the complete world-to-tool chain. Include the fixed base and tool transforms from your model.'));
            full.append(element('p', 'Explain how you group the factors into six variable joint transforms while preserving their order. Check your result at the reduced home configuration and at several nonzero joint configurations.'));
            arm.append(element('p', 'Use your D-H derivation to extract the positioning chain. Write its three variable groups, account for the frozen joint transform, and derive the wrist point in world coordinates. Keep the frame convention explicit in your notes.'));
        } else {
            full.append(element('h3', 'Derive the PoE representation'));
            full.append(element('p', 'Starting from the original seven-joint space screws and home transform, fix q₃ at φ. Determine the six active screw axes in world coordinates at the reduced home and calculate the new home transform.'));
            full.append(element('p', 'Show how the frozen joint affects each remaining screw. Write the reduced product of exponentials and verify that it agrees with your D-H model and the URDF at the same configurations.'));
            arm.append(element('p', 'Use your reduced space screws to write the positioning chain acting on the home wrist point you identified. State which original screw corresponds to each reduced coordinate and verify the wrist position with your D-H chain.'));
        }
        const lesson = lessonQ();
        $('#lesson-q').textContent = '[' + lesson.map(n => format(n)).join(', ') + ']';
        $('#lesson-target').replaceChildren(matrix(M.fk(lesson), 'Target T_d = world → iiwa_link_ee'));
        $('#lesson-geometry-note').textContent = 'Count the independent elbow signs, signed radial projections and wrist flips. This reference stays nonsingular throughout the permitted φ range.';
    }
    function renderArmResults() {
        const target = M.fk(lessonQ());
        let result;
        try { result = T.runEquations(state.answers, target, state.fixedQ3); }
        catch (error) { $('#arm-results').replaceChildren(element('p', error.message, 'ex02-note')); return; }
        const unique = new Map(); result.branches.forEach(b => { if (!unique.has(b.armBranch)) unique.set(b.armBranch, b); });
        const host = $('#arm-results');
        host.replaceChildren(element('h3', 'Your four positioning branches, evaluated at the reference target'),
            table(['Branch', 'θ₁ [rad]', 'θ₂ [rad]', 'θ₃ [rad]'], [...unique.values()].map(b => [b.armBranch, format(b.q[0]), format(b.q[1]), format(b.q[3])])));
    }
    function renderWristExample() {
        const host = $('#wrist-example');
        host.replaceChildren(element('p', 'With W = Rw, use the sign of sin(q₆) consistently in all three angles. In the regular case:', 'ex02-note'),
            element('p', 'q₆ = atan2(σw √(W₁₃² + W₂₃²), W₃₃)\nq₅ = atan2(σw W₂₃, σw W₁₃)\nq₇ = atan2(σw W₃₂, −σw W₃₁),     σw = ±1', 'ex02-formula'),
            element('p', 'When sin(q₆) = 0, the outer angles are coupled. For q₆ = 0 only q₅ + q₇ is determined; report a family instead of claiming two distinct wrist solutions.'));
        host.querySelector('.ex02-formula').style.whiteSpace = 'pre-wrap';
    }
    function renderBranches(result, host, classify) {
        host.replaceChildren();
        const maxP = Math.max(0, ...result.branches.map(b => b.residuals.position));
        const maxR = Math.max(0, ...result.branches.map(b => b.residuals.rotation));
        host.append(element('p', `${result.branches.length} ${result.singular ? 'representative' : 'distinct'} solutions. Maximum FK error: ${maxP.toExponential(2)} m in position; ${maxR.toExponential(2)} rad in orientation.`));
        if (result.usedSingularFallback) host.append(element('p', 'Your regular formulas reach a singular case. The entries below are representatives from a separate singular-case analysis, not an enumeration of a continuous family.', 'ex02-note'));
        (result.messages || []).forEach(message => host.append(element('p', message, 'ex02-note')));
        const tab = table(['Branch / signs', 'q₁', 'q₂', 'q₃ fixed', 'q₄', 'q₅', 'q₆', 'q₇', ...(classify ? ['All limits?'] : [])],
            result.branches.map((b, i) => [`${i + 1} · ${b.sigma3 > 0 ? '+' : '−'} / ${b.sigmaE > 0 ? '+' : '−'} / ${b.wristBranch > 0 ? '+' : b.wristBranch < 0 ? '−' : 'family'}`, ...b.q.map(n => format(n)), ...(classify ? [''] : [])]));
        tab.querySelector('table').setAttribute('aria-label', 'IK joint angles in radians, signs in order: sin theta3, E, sin q6');
        host.append(element('p', 'Angles in radians. Signs are ordered: sin(θ₃), E, sin(q₆). Scroll sideways on a narrow screen to see all seven joints.'));
        tab.querySelectorAll('tbody tr').forEach((row, i) => {
            const branch = result.branches[i];
            if (classify) {
                row.dataset.branch = branch.id;
                const first = row.children[0], button = element('button', first.textContent); button.type = 'button';
                button.setAttribute('aria-label', 'Show branch ' + (i + 1)); first.replaceChildren(button);
                button.addEventListener('click', () => selectBranch(branch.id));
                const key = 'limits.' + branch.id, cell = row.lastElementChild;
                cell.dataset.answerWrap = key;
                const select = element('select', null, 'ex02-limits-select'); select.dataset.answer = key;
                select.setAttribute('aria-label', 'Branch ' + (i + 1) + ' respects all joint limits?');
                [['', 'Choose…'], ['yes', 'Yes'], ['no', 'No']].forEach(([value, text]) => { const option = element('option', text); option.value = value; select.append(option); });
                select.value = state.answers[key] || '';
                select.addEventListener('change', () => record(key, select.value));
                cell.append(select, element('small', '', 'answer-result'));
            }
        });
        host.append(tab);
        const families = [...new Set(result.branches.flatMap(b => b.families || []).filter(Boolean))];
        families.forEach(family => host.append(element('p', 'Singular family: ' + family, 'ex02-note')));
    }
    function selectBranch(id) {
        if (!ownResult) return;
        const branch = ownResult.branches.find(b => b.id === id); if (!branch) return;
        selectedBranch = id;
        $$('[data-branch]').forEach(row => row.classList.toggle('selected-branch', row.dataset.branch === id));
        scenes.branch.update(branch.q, { showWrist: true, showAxes: true, caption: 'IK branch ' + (ownResult.branches.indexOf(branch) + 1) + ' · same tool pose' });
    }
    function buildSliders() {
        const host = $('#target-sliders'); host.replaceChildren();
        M.LIMITS.forEach((limit, i) => {
            const row = element('div', null, 'ex02-joint-slider' + (i === 2 ? ' is-fixed' : ''));
            const label = element('label', `q${i + 1}`); label.htmlFor = 'target-q' + (i + 1);
            const range = element('input'); range.type = 'range'; range.min = limit.lower; range.max = limit.upper; range.step = '0.001';
            range.id = 'target-q' + (i + 1); range.value = state.targetQ[i]; range.disabled = i === 2;
            range.setAttribute('aria-label', `q${i + 1} in radians`);
            const input = element('input'); input.type = 'number'; input.min = limit.lower; input.max = limit.upper; input.step = '0.001'; input.value = format(state.targetQ[i]); input.disabled = i === 2;
            input.setAttribute('aria-label', `Numeric q${i + 1} in radians`);
            range.addEventListener('input', () => { input.value = format(Number(range.value)); changeTarget(i, Number(range.value)); });
            input.addEventListener('change', () => {
                const value = Number(input.value);
                if (!input.value.trim() || !Number.isFinite(value) || value < limit.lower || value > limit.upper) {
                    input.value = format(state.targetQ[i]); $('#pose-message').textContent = `q${i + 1} must lie within its displayed URDF limits.`; return;
                }
                range.value = value; changeTarget(i, value);
            });
            row.append(label, range, input); host.append(row);
        });
    }
    function changeTarget(i, value) {
        state.targetQ[i] = value;
        clearOwnResult(); $('#pose-message').textContent = '';
        updateTarget(); updateGates(); save();
    }
    function clearOwnResult() {
        ownResult = null; selectedBranch = null; delete state.checked.limits;
        Object.keys(state.answers).filter(key => key.startsWith('limits.')).forEach(key => { delete state.answers[key]; });
        $('#own-solve-status').textContent = '';
    }
    function updateTarget() {
        scenes.target.update(state.targetQ, { showWrist: true, showAxes: true, caption: 'Your FK target · q₃ stays fixed' });
        $('#own-target').replaceChildren(matrix(M.fk(state.targetQ), 'Your target T_d'));
    }
    function checkStage(stage) {
        if (!allowed[stage]) return;
        state.checked[stage] = true;
        if (stage === 'limits') {
            ownResult.branches.forEach(branch => {
                const key = 'limits.' + branch.id;
                mark(key, state.answers[key] === (branch.withinLimits ? 'yes' : 'no'), !!state.answers[key]);
            });
        } else {
            showFeedback(stage);
            if (stage === 'verify' && valid('branches.count')) {
                try {
                    lessonResult = T.runEquations(state.answers, M.fk(lessonQ()), state.fixedQ3);
                    renderBranches(lessonResult, $('#lesson-results'), false);
                } catch (error) { lessonResult = null; $('#lesson-results').replaceChildren(element('p', error.message, 'ex02-note')); }
                $('#lesson-results').hidden = false;
            }
        }
        updateGates(); save();
        if (stage === 'limits') $('#limit-summary').textContent = passed.limits ? `${ownResult.feasibleCount} of ${ownResult.branches.length} listed configurations respect all URDF limits.` : '';
    }
    function loadDocument(raw, restored) {
        const clean = T.validateDocument(raw);
        state = Object.assign(fresh(), clean);
        state.applied = raw.session ? raw.session.applied === true : true;
        state.reviewed = raw.session ? raw.session.reviewed === true : true;
        state.checked = {};
        const requestedChecks = raw.session && raw.session.checked && typeof raw.session.checked === 'object' ? raw.session.checked : Object.fromEntries(ORDER.map(s => [s, true]));
        ORDER.forEach(stage => { if (requestedChecks[stage] === true) state.checked[stage] = true; });
        lessonResult = null; ownResult = null; selectedBranch = null;
        $('#fixed-q3').value = format(state.fixedQ3, 12);
        $$('[data-answer]').filter(node => !node.dataset.answer.startsWith('limits.')).forEach(node => {
            const value = state.answers[node.dataset.answer] || '';
            if (node.type === 'radio') node.checked = node.value === value; else node.value = value;
        });
        $$('[data-answer-wrap]').forEach(wrap => { delete wrap.dataset.result; const feedback = wrap.querySelector('.answer-result'); if (feedback) feedback.textContent = ''; });
        Object.values(builders).forEach(builder => builder.setAnswers(state.answers));
        renderRepresentation(); buildSliders(); updateTarget(); updateGates();
        // Imported answers pass through the same checks as typed answers.
        Object.keys(FIELDS).forEach(stage => { if (state.checked[stage] && allowed[stage]) showFeedback(stage); });
        if (allowed.verify && state.checked.verify && valid('branches.count') && (!raw.session || raw.session.ranLesson)) {
            lessonResult = T.runEquations(state.answers, M.fk(lessonQ()), state.fixedQ3);
            renderBranches(lessonResult, $('#lesson-results'), false); $('#lesson-results').hidden = false;
        } else $('#lesson-results').hidden = true;
        updateGates();
        if (allowed.pose && (!raw.session || raw.session.ranOwn)) solveOwn(false);
        if (allowed.limits && state.checked.limits) checkStage('limits');
        $('#setup-message').textContent = state.applied ? `Original q₃ fixed at ${format(state.fixedQ3)} rad (${format(state.fixedQ3 * 180 / Math.PI, 2)}°).` : '';
        $('#file-status').textContent = restored ? 'Saved responses restored in this browser.' : 'Responses loaded and checked. Your equations and target pose are restored.';
        save();
    }
    function solveOwn(clearFeedback) {
        if (!allowed.pose) return;
        if (clearFeedback) delete state.checked.limits;
        try { ownResult = T.runEquations(state.answers, M.fk(state.targetQ), state.fixedQ3); }
        catch (error) { ownResult = null; $('#own-solve-status').textContent = error.message; updateGates(); save(); return; }
        renderBranches(ownResult, $('#own-results'), true);
        $('#own-solve-status').textContent = `${ownResult.branches.length} ${ownResult.singular ? 'representative' : 'distinct'} solutions verified by FK.`;
        $('#limit-summary').textContent = '';
        updateGates();
        if (ownResult.branches.length) selectBranch(ownResult.branches[0].id);
        save();
    }
    function initialise() {
        if (!M || !K || !Q || !T || !window.Exercise02Scene) throw new Error('An exercise component could not be loaded. Reload the page.');
        const toolbar = $('.answer-toolbar');
        const measureToolbar = () => document.body.style.setProperty('--answer-toolbar-height', Math.ceil(toolbar.getBoundingClientRect().height) + 'px');
        measureToolbar();
        if (typeof ResizeObserver !== 'undefined') new ResizeObserver(measureToolbar).observe(toolbar);
        else window.addEventListener('resize', measureToolbar);
        ['home', 'method', 'target', 'branch'].forEach(name => { scenes[name] = window.Exercise02Scene.create($('#' + name + '-preview'), { model: M }); });
        ['elbow', 'radial', 'backsub'].forEach(stage => {
            builders[stage] = Q.create($('#' + stage + '-builder'), {
                rows: T.ROWS.filter(row => FIELDS[stage].includes(row.id)).map(row => Object.assign({}, row, { label: row.label.replace(/\s*=$/, ''), samples: () => M.equationSamples(state.fixedQ3) })),
                getContext: () => ({ phi: state.fixedQ3 }),
                onChange(answers, change) {
                    if (change) record(change.id, change.expression);
                    else { Object.assign(state.answers, answers); invalidateFrom(stage); updateGates(); save(); }
                }
            });
        });
        $$('[data-answer]').forEach(input => input.addEventListener(input.type === 'radio' ? 'change' : 'input', () => record(input.dataset.answer, input.value)));
        $$('[data-check]').forEach(button => button.addEventListener('click', () => checkStage(button.dataset.check)));
        $$('[data-representation]').forEach(button => button.addEventListener('click', () => { state.representation = button.dataset.representation; renderRepresentation(); }));
        $('#apply-q3').addEventListener('click', () => {
            try {
                const expression = K.parse($('#fixed-q3').value);
                if (K.symbols(expression).length) throw new Error('Enter a numerical value or an expression using pi.');
                const phi = K.evaluate(expression);
                if (phi < M.LIMITS[2].lower || phi > M.LIMITS[2].upper) throw new Error('q₃ must lie between −170° and 170°.');
                if (Math.abs(phi - state.fixedQ3) > 1e-12) {
                    state.answers = {}; state.reviewed = false; state.checked = {};
                    $$('[data-answer]').forEach(input => { if (input.type === 'radio') input.checked = false; else input.value = ''; });
                    Object.values(builders).forEach(builder => builder.setAnswers({}));
                    $$('[data-answer-wrap]').forEach(wrap => { delete wrap.dataset.result; wrap.querySelector('.answer-result').textContent = ''; });
                    state.fixedQ3 = phi; state.targetQ = lessonQ();
                    invalidateFrom('model');
                }
                state.applied = true;
                $('#setup-message').textContent = `Original q₃ fixed at ${format(phi)} rad (${format(phi * 180 / Math.PI, 2)}°).`;
                renderRepresentation(); buildSliders(); updateTarget(); updateGates(); save();
            } catch (error) { $('#setup-message').textContent = error.message; }
        });
        $('#review-model').addEventListener('click', () => { if (!allowed.model) return; state.reviewed = true; updateGates(); save(); });
        $('#reset-target').addEventListener('click', () => { state.targetQ = lessonQ(); clearOwnResult(); buildSliders(); updateTarget(); updateGates(); save(); });
        $('#solve-own').addEventListener('click', () => solveOwn(true));
        $('#download-responses').addEventListener('click', () => {
            const blob = new Blob([JSON.stringify(responseDocument(), null, 2) + '\n'], { type: 'application/json' });
            const url = URL.createObjectURL(blob), anchor = element('a'); anchor.href = url; anchor.download = 'exercise_02_responses.json'; anchor.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000); $('#file-status').textContent = 'Responses downloaded. Keep the JSON with your derivation notes.';
        });
        $('#load-responses').addEventListener('change', async event => {
            const file = event.target.files[0]; if (!file) return;
            try {
                if (file.size > 1024 * 1024) throw new Error('Choose a response JSON file smaller than 1 MB.');
                loadDocument(JSON.parse(await file.text()), false);
            } catch (error) { $('#file-status').textContent = 'Could not load responses: ' + error.message; }
            event.target.value = '';
        });
        $('#limit-reference').append(table(['URDF joint limits', ...M.LIMITS.map(l => l.name)], [
            ['Lower [rad]', ...M.LIMITS.map(l => format(l.lower))], ['Upper [rad]', ...M.LIMITS.map(l => format(l.upper))]
        ]));
        renderRepresentation(); buildSliders(); updateTarget(); updateGates();
        try { const saved = localStorage.getItem(STORAGE); if (saved) loadDocument(JSON.parse(saved), true); }
        catch (_) { $('#file-status').textContent = 'Saved data could not be restored. A fresh worksheet is ready.'; }
        // Small read-only status surface for integration checks; no answer key.
        window.Exercise02App = Object.freeze({ snapshot: () => JSON.parse(JSON.stringify({ document: responseDocument(), allowed, passed,
            lesson: lessonResult, own: ownResult, selectedBranch })) });
        document.body.dataset.exerciseReady = 'true';
    }
    try { initialise(); }
    catch (error) { $('#file-status').textContent = error.message; console.error(error); }
}());
