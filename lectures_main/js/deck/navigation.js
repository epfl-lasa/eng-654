export function initDeckNavigation() {
  const deck = document.getElementById('deck');
  if (!deck) return;

  const slides = Array.from(deck.querySelectorAll('.slide'));
  if (!slides.length) return;

  document.body.classList.add(localStorage.getItem('eng654-mode') || 'mode-deck');

  let index = getStartIndex(slides);
  const revealedSteps = new Map();

  prepareFragments(slides);
  createSlideNumbers();
  createNav();
  update();

  function getStartIndex(slides) {
    const hash = window.location.hash.replace('#slide-', '');
    const n = Number(hash);
    return Number.isInteger(n) && n >= 1 && n <= slides.length ? n - 1 : 0;
  }

  function prepareFragments(slides) {
    slides.forEach(slide => {
      slide.querySelectorAll('[data-reveal="children"], .reveal-children').forEach(group => {
        Array.from(group.children).forEach(child => {
          if (!child.matches('[data-no-fragment]')) child.classList.add('fragment');
        });
      });
      Array.from(slide.querySelectorAll('.fragment')).forEach((el, i) => {
        el.dataset.fragmentIndex = String(i + 1);
      });
      revealedSteps.set(slide, 0);
    });
  }

  function createSlideNumbers() {
    slides.forEach((slide, i) => {
      if (slide.dataset.slideNumber === 'off') return;

      let number = slide.querySelector(':scope > .slide-number');
      if (!number) {
        number = document.createElement('div');
        number.className = 'slide-number';
        slide.appendChild(number);
      }

      number.textContent = String(i + 1).padStart(2, '0') + ' / ' + String(slides.length).padStart(2, '0');
      number.setAttribute('aria-label', 'Slide ' + (i + 1) + ' of ' + slides.length);
    });
  }

  function createNav() {
    const nav = document.createElement('nav');
    nav.className = 'deck-nav';
    nav.innerHTML = `
      <button type="button" data-action="prev" title="Previous">‹</button>
      <div class="deck-progress"><div class="deck-progress-bar"></div></div>
      <span class="slide-counter"></span>
      <button type="button" data-action="toggle-mode" title="Toggle deck/scroll mode">Scroll</button>
      <button type="button" data-action="next" title="Next">›</button>
    `;
    document.body.appendChild(nav);

    nav.querySelector('[data-action="prev"]').addEventListener('click', prev);
    nav.querySelector('[data-action="next"]').addEventListener('click', next);
    nav.querySelector('[data-action="toggle-mode"]').addEventListener('click', toggleMode);
  }

  function currentSlide() { return slides[index]; }
  function fragments(slide) { return Array.from(slide.querySelectorAll('.fragment')); }

  function applyFragments(slide) {
    const visible = revealedSteps.get(slide) || 0;
    fragments(slide).forEach((el, i) => {
      el.classList.toggle('revealed', i < visible);
    });
  }

  function next() {
    const slide = currentSlide();
    const frags = fragments(slide);
    const current = revealedSteps.get(slide) || 0;
    if (current < frags.length && !document.body.classList.contains('mode-scroll')) {
      revealedSteps.set(slide, current + 1);
      applyFragments(slide);
      return;
    }
    goTo(index + 1);
  }

  function prev() {
    const slide = currentSlide();
    const current = revealedSteps.get(slide) || 0;
    if (current > 0 && !document.body.classList.contains('mode-scroll')) {
      revealedSteps.set(slide, current - 1);
      applyFragments(slide);
      return;
    }
    goTo(index - 1);
  }

  function goTo(newIndex) {
    index = Math.max(0, Math.min(slides.length - 1, newIndex));
    update();
  }

  function toggleMode() {
    const scroll = document.body.classList.contains('mode-scroll');
    document.body.classList.toggle('mode-scroll', !scroll);
    document.body.classList.toggle('mode-deck', scroll);
    localStorage.setItem('eng654-mode', scroll ? 'mode-deck' : 'mode-scroll');
    update();
  }

  function update() {
    slides.forEach((slide, i) => {
      slide.classList.toggle('active', i === index);
      const number = slide.querySelector(':scope > .slide-number');
      if (number) number.classList.toggle('is-current', i === index);
      applyFragments(slide);
    });

    if (document.body.classList.contains('mode-deck')) {
      deck.style.transform = `translateX(${-index * 100}vw)`;
    } else {
      deck.style.transform = 'none';
      slides[index].scrollIntoView({ block: 'start', behavior: 'smooth' });
    }

    const counter = document.querySelector('.slide-counter');
    const bar = document.querySelector('.deck-progress-bar');
    const toggle = document.querySelector('[data-action="toggle-mode"]');
    if (counter) counter.textContent = `${index + 1} / ${slides.length}`;
    if (bar) bar.style.width = `${((index + 1) / slides.length) * 100}%`;
    if (toggle) toggle.textContent = document.body.classList.contains('mode-scroll') ? 'Deck' : 'Scroll';
    history.replaceState(null, '', `#slide-${index + 1}`);
  }

  document.addEventListener('keydown', event => {
    const tag = (event.target && event.target.tagName || '').toLowerCase();
    if (['input', 'textarea', 'select'].includes(tag)) return;

    if (['ArrowRight', 'PageDown', ' '].includes(event.key)) {
      event.preventDefault();
      next();
    } else if (['ArrowLeft', 'PageUp'].includes(event.key)) {
      event.preventDefault();
      prev();
    } else if (event.key === 'Home') {
      event.preventDefault();
      goTo(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      goTo(slides.length - 1);
    } else if (event.key.toLowerCase() === 't') {
      event.preventDefault();
      toggleMode();
    } else if (event.key.toLowerCase() === 'f') {
      event.preventDefault();
      if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
      else document.exitFullscreen?.();
    }
  });
}
