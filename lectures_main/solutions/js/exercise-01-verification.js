/* Feedback UI shared after students complete the response worksheet. */
(function (root) {
  'use strict';

  function init() {
    if (document.body.dataset.answerMode !== 'solution') return;
    const controls = new Map(Array.from(document.querySelectorAll('[data-field]'), input => [input.dataset.field, input]));
    const verifyButton = document.getElementById('verify-answers');
    const resultSection = document.getElementById('verification-results');
    const summary = document.getElementById('verification-summary');
    const issues = document.getElementById('verification-issues');
    const resultsButton = document.getElementById('view-results');
    const collect = root.Exercise01Answers.collect;
    const announce = root.Exercise01Answers.announce;
    let hasVerified = false;
    let verificationTimer;

    if (!root.Exercise01Checker) {
      verifyButton.disabled = true;
      announce('The checker could not load. Reload this page before verifying responses.', true);
    }

    function worksheetView() {
      document.body.classList.remove('mode-deck');
      document.body.classList.add('mode-scroll');
      document.getElementById('deck').style.transform = 'none';
      document.querySelectorAll('.slide').forEach(slide => {
        slide.inert = false;
        slide.removeAttribute('aria-hidden');
      });
    }
    function showResults() {
      worksheetView();
      resultSection.scrollIntoView({ block: 'start', behavior: 'instant' });
    }

    function verify() {
      if (!root.Exercise01Checker) {
        announce('The checker could not load. Reload this page before verifying responses.', true);
        return;
      }
      const answers = collect();
      const result = root.Exercise01Checker.evaluate(answers);
      hasVerified = true;
      issues.replaceChildren();
      const counts = { correct: 0, incorrect: 0, invalid: 0, unanswered: 0 };
      for (const [key, input] of controls) {
        const outcome = result.fields[key] || {
          status: 'invalid', message: 'This response field could not be checked. Reload the feedback page.'
        };
        counts[outcome.status] += 1;
        input.dataset.result = outcome.status;
        input.setAttribute('aria-invalid', String(['incorrect', 'invalid'].includes(outcome.status)));
        const feedback = document.getElementById(input.id + '-feedback');
        feedback.hidden = false;
        const labels = { correct: 'Correct', incorrect: 'Check value', invalid: 'Invalid', unanswered: 'Unanswered' };
        const chainResult = key.startsWith('poe.') ? result.poe : /^(dh|base|tool)\./.test(key) ? result.fk : null;
        let detail = outcome.message;
        if (outcome.status === 'correct') {
          detail = chainResult ? (chainResult.status === 'correct' ? 'FK verified.' : 'Reference match; check the full chain.') : 'Verified.';
        } else if (outcome.status === 'unanswered') {
          detail = '';

        } else if (outcome.status === 'incorrect' && chainResult) {
          detail = chainResult.status === 'incorrect' ? 'Reference differs; FK differs.' : 'Reference differs; inspect the full model.';
        }
        feedback.textContent = labels[outcome.status] + (detail ? `: ${detail}` : '');
        feedback.title = outcome.message;
        if (['incorrect', 'invalid'].includes(outcome.status)) {
          const item = document.createElement('li');
          const button = document.createElement('button');
          button.type = 'button';
          button.textContent = `${input.getAttribute('aria-label')}: ${outcome.message}`;
          button.addEventListener('click', () => {
            worksheetView();
            input.scrollIntoView({ block: 'center', behavior: 'smooth' });
            input.focus({ preventScroll: true });
          });
          item.appendChild(button);
          issues.appendChild(item);
        }
      }
      summary.replaceChildren();
      const totals = document.createElement('p');
      totals.className = 'answer-result-counts';
      totals.textContent = `${counts.correct} correct · ${counts.incorrect + counts.invalid} need correction · ${counts.unanswered} unanswered`;
      summary.appendChild(totals);
      for (const [name, outcome] of [['PoE', result.poe], ['D–H', result.fk]]) {
        const model = document.createElement('p');
        model.className = 'answer-fk-result';
        model.dataset.result = outcome.status;
        model.textContent = `${name}: ${outcome.message}`;
        if (Number.isFinite(outcome.maxPositionError) && Number.isFinite(outcome.maxRotationError)) {
          model.textContent += ` Maximum residuals over ${outcome.testCount} configurations: ${outcome.maxPositionError.toExponential(3)} m and ${outcome.maxRotationError.toExponential(3)} rad.`;
        }
        summary.appendChild(model);
      }
      const table = document.createElement('table');
      table.className = 'answer-comparison-table';
      const caption = document.createElement('caption');
      caption.textContent = 'Five prescribed poses: computed model FK compared with the URDF';
      const head = document.createElement('thead');
      const header = document.createElement('tr');
      for (const title of ['Pose', 'PoE vs URDF', 'D–H vs URDF']) {
        const cell = document.createElement('th');
        cell.scope = 'col'; cell.textContent = title; header.appendChild(cell);
      }
      head.appendChild(header);
      const body = document.createElement('tbody');
      const poseNames = { home: 'Home', bent: 'Bent', bent_back: 'Bent back', side_reach: 'Side reach', wrist_turn: 'Mixed wrist turn' };
      for (const [pose, checks] of Object.entries(result.poseChecks)) {
        const row = document.createElement('tr');
        const label = document.createElement('th');
        label.scope = 'row'; label.textContent = poseNames[pose]; row.appendChild(label);
        for (const method of ['poe', 'dh']) {
          const cell = document.createElement('td');
          const outcome = checks[method];
          cell.dataset.result = outcome.status;
          cell.textContent = { correct: 'Pass', incorrect: 'Mismatch', invalid: 'Invalid model', unanswered: 'Complete the model' }[outcome.status];
          if (Number.isFinite(outcome.positionError) && Number.isFinite(outcome.rotationError)) {
            cell.textContent += ` · ${outcome.positionError.toExponential(3)} m · ${outcome.rotationError.toExponential(3)} rad`;
          }
          row.appendChild(cell);
        }
        body.appendChild(row);
      }
      table.append(caption, head, body);
      summary.appendChild(table);
      const limits = document.createElement('p');
      limits.textContent = 'PoE and D–H models are checked against the original URDF at the five prescribed poses and over a 26-configuration sample. Each submitted tool matrix is checked independently with an absolute tolerance of 0.0001 per entry. Visual entries are corrections added to the supplied origins. Include the instructor-provided simulator results and before/after visual-repair comparison in your report.';
      limits.className = 'answer-review-note';
      summary.appendChild(limits);
      resultSection.hidden = false;
      resultsButton.hidden = false;
      announce(totals.textContent + '. Use View results for details.');
    }

    document.addEventListener('exercise01:answers-loaded', () => {
      clearTimeout(verificationTimer);
      worksheetView();
      verify();
    });
    document.addEventListener('exercise01:answer-edited', () => {
      if (!hasVerified) return;
      clearTimeout(verificationTimer);
      verificationTimer = setTimeout(verify, 250);
    });
    verifyButton.addEventListener('click', () => { worksheetView(); verify(); });
    resultsButton.addEventListener('click', showResults);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})(typeof globalThis !== 'undefined' ? globalThis : this);
