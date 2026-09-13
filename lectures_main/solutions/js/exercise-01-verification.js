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
        const chainField = /^(dh|base|tool)\./.test(key);
        let detail = outcome.message;
        if (outcome.status === 'correct') {
          detail = chainField ? (result.fk.status === 'correct' ? 'FK verified.' : 'Reference match; check the full chain.') : 'Verified.';
        } else if (outcome.status === 'unanswered') {
          detail = '';

        } else if (outcome.status === 'incorrect' && chainField) {
          detail = result.fk.status === 'incorrect' ? 'Reference differs; FK differs.' : 'Reference differs; complete the chain to verify.';
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
      const fk = document.createElement('p');
      fk.className = 'answer-fk-result';
      fk.dataset.result = result.fk.status;
      fk.textContent = result.fk.message;
      if (Number.isFinite(result.fk.maxPositionError) && Number.isFinite(result.fk.maxRotationError)) {
        fk.textContent += ` Maximum residuals over ${result.fk.testCount} configurations: ${result.fk.maxPositionError.toExponential(3)} m and ${result.fk.maxRotationError.toExponential(3)} rad.`;
      }
      summary.append(totals, fk);
      const limits = document.createElement('p');
      limits.textContent = 'The D–H chain is checked across 26 configurations. Each of the five tool matrices is checked independently, with an absolute tolerance of 0.0001 per entry. Visual origins use the supplied mesh coordinates.';
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
