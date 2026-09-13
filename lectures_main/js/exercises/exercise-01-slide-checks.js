/* Student self-checks: only binary feedback, limited to the selected slide. */
(function (root) {
  'use strict';

  function init() {
    if (document.body.dataset.answerMode !== 'exercise') return;
    const legend = 'Light green: correct · Light red: incorrect. Empty fields stay unmarked.';
    const slides = Array.from(document.querySelectorAll('.slide')).map(slide => ({
      element: slide,
      controls: Array.from(slide.querySelectorAll('[data-field]'))
    })).filter(slide => slide.controls.length);
    const feedback = new Map();
    const isDhField = input => /^(dh|base|tool)\./.test(input.dataset.field);
    const available = typeof root.Exercise01Checker?.evaluate === 'function' &&
      typeof root.Exercise01Answers?.collect === 'function';

    function clearSlide(slide) {
      for (const input of slide.controls) {
        delete input.dataset.result;
        input.removeAttribute('aria-invalid');
        input.removeAttribute('title');
        feedback.get(input).textContent = '';
        feedback.get(input).hidden = true;
      }
      slide.status.textContent = available ? legend : 'Checking is unavailable. Reload this page to try again.';
    }

    function checkSlide(slide) {
      let result;
      try {
        // D–H frame equivalence depends on the table and both fixed transforms,
        // so evaluate the full model but show feedback only on this slide.
        result = root.Exercise01Checker.evaluate(root.Exercise01Answers.collect());
      } catch {
        clearSlide(slide);
        slide.status.textContent = 'Answers could not be checked. Reload this page and try again.';
        return;
      }
      clearSlide(slide);
      let checked = false;
      for (const input of slide.controls) {
        if (!input.value.trim()) continue;
        const correct = result.fields[input.dataset.field]?.status === 'correct';
        const label = correct ? 'Correct' : 'Incorrect';
        input.dataset.result = correct ? 'correct' : 'incorrect';
        input.setAttribute('aria-invalid', String(!correct));
        input.setAttribute('title', label);
        feedback.get(input).textContent = label;
        feedback.get(input).hidden = false;
        checked = true;
      }
      slide.status.textContent = checked ? `Checked answers on this slide. ${legend}` : 'Enter an answer before checking.';
    }

    for (const [index, slide] of slides.entries()) {
      const panel = document.createElement('div');
      panel.className = 'answer-slide-checks';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'answer-check-slide';
      button.textContent = 'Check answers';
      button.disabled = !available;
      const title = slide.element.querySelector('.slide-title');
      button.setAttribute('aria-label', `Check answers: ${title?.textContent || `answer slide ${index + 1}`}`);
      slide.status = document.createElement('p');
      slide.status.className = 'answer-slide-status';
      slide.status.setAttribute('role', 'status');
      slide.status.setAttribute('aria-live', 'polite');
      panel.append(button, slide.status);
      if (title) title.after(panel);
      else slide.element.prepend(panel);

      for (const input of slide.controls) {
        const description = document.createElement('span');
        description.id = `${input.id}-feedback`;
        description.className = 'answer-feedback answer-binary-feedback';
        description.hidden = true;
        input.after(description);
        const describedBy = input.getAttribute('aria-describedby');
        input.setAttribute('aria-describedby', [describedBy, description.id].filter(Boolean).join(' '));
        feedback.set(input, description);
        input.addEventListener('input', () => {
          clearSlide(slide);
          // A change to any D–H/base/tool value may invalidate an equivalent
          // frame assignment that was accepted on the other model slide.
          if (isDhField(input)) {
            for (const related of slides) {
              if (related !== slide && related.controls.some(isDhField)) clearSlide(related);
            }
          }
        });
      }
      clearSlide(slide);
      button.addEventListener('click', () => checkSlide(slide));
    }

    document.addEventListener('exercise01:answers-loaded', () => slides.forEach(clearSlide));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})(typeof globalThis !== 'undefined' ? globalThis : this);
