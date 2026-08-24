/*
  ENG-654 deck navigation runtime.
  Plain (non-module) script on purpose: navigation must work even if a
  visualization module or Three.js import fails.
*/
(function () {
  'use strict';

  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else {
      fn();
    }
  }

  ready(function initDeckNavigationRuntime() {
    const deck = document.getElementById('deck');
    if (!deck || deck.dataset.navReady === 'true') return;
    deck.dataset.navReady = 'true';

    const slides = Array.from(deck.querySelectorAll('.slide'));
    if (!slides.length) return;

    const storedMode = localStorage.getItem('eng654-mode');
    document.body.classList.remove('mode-deck', 'mode-scroll');
    document.body.classList.add(storedMode === 'mode-scroll' ? 'mode-scroll' : 'mode-deck');

    let index = getStartIndex();
    const revealedSteps = new Map();

    prepareFragments();
    createSlideNumbers();
    createNavigationBar();
    update({ jump: true });

    function getStartIndex() {
      const raw = window.location.hash.replace('#slide-', '');
      const n = Number(raw);
      if (Number.isInteger(n) && n >= 1 && n <= slides.length) return n - 1;
      return 0;
    }

    function prepareFragments() {
      slides.forEach((slide) => {
        slide.querySelectorAll('[data-reveal="children"], .reveal-children').forEach((group) => {
          Array.from(group.children).forEach((child) => {
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

    function createNavigationBar() {
      let nav = document.querySelector('.deck-nav');
      if (nav) nav.remove();

      nav = document.createElement('nav');
      nav.className = 'deck-nav';
      nav.setAttribute('aria-label', 'Slide navigation');
      nav.innerHTML = [
        '<button type="button" class="nav-button" data-action="prev" title="Previous slide / previous reveal" aria-label="Previous slide">‹</button>',
        '<button type="button" class="nav-button" data-action="next" title="Next slide / next reveal" aria-label="Next slide">›</button>'
      ].join('');
      document.body.appendChild(nav);

      nav.querySelector('[data-action="prev"]')?.addEventListener('click', previous);
      nav.querySelector('[data-action="next"]')?.addEventListener('click', next);
      nav.querySelector('[data-action="toggle-mode"]')?.addEventListener('click', toggleMode);
      nav.querySelector('[data-action="fullscreen"]')?.addEventListener('click', toggleFullscreen);
    }

    function currentSlide() {
      return slides[index];
    }

    function fragments(slide) {
      return Array.from(slide.querySelectorAll('.fragment'));
    }

    function applyFragments(slide) {
      const visible = revealedSteps.get(slide) || 0;
      fragments(slide).forEach((el, i) => {
        el.classList.toggle('revealed', i < visible);
      });
    }

    function next() {
      if (document.body.classList.contains('mode-deck')) {
        const slide = currentSlide();
        const frags = fragments(slide);
        const current = revealedSteps.get(slide) || 0;
        if (current < frags.length) {
          revealedSteps.set(slide, current + 1);
          applyFragments(slide);
          return;
        }
      }
      goTo(index + 1);
    }

    function previous() {
      if (document.body.classList.contains('mode-deck')) {
        const slide = currentSlide();
        const current = revealedSteps.get(slide) || 0;
        if (current > 0) {
          revealedSteps.set(slide, current - 1);
          applyFragments(slide);
          return;
        }
      }
      goTo(index - 1);
    }

    function goTo(newIndex, opts = {}) {
      index = Math.max(0, Math.min(slides.length - 1, newIndex));
      update(opts);
    }

    function toggleMode() {
      const isScroll = document.body.classList.contains('mode-scroll');
      document.body.classList.toggle('mode-scroll', !isScroll);
      document.body.classList.toggle('mode-deck', isScroll);
      localStorage.setItem('eng654-mode', isScroll ? 'mode-deck' : 'mode-scroll');
      update({ jump: true });
    }

    function toggleFullscreen() {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen?.();
      } else {
        document.exitFullscreen?.();
      }
    }

    function update(opts = {}) {
      slides.forEach((slide, i) => {
        slide.classList.toggle('active', i === index);
        const number = slide.querySelector(':scope > .slide-number');
        if (number) number.classList.toggle('is-current', i === index);
        applyFragments(slide);
      });

      if (document.body.classList.contains('mode-deck')) {
        deck.style.transform = 'translateX(' + (-index * 100) + 'vw)';
      } else {
        deck.style.transform = 'none';
        slides[index].scrollIntoView({
          block: 'start',
          behavior: opts.jump ? 'auto' : 'smooth'
        });
      }

      const counter = document.querySelector('.slide-counter');
      const bar = document.querySelector('.deck-progress-bar');
      const toggle = document.querySelector('[data-action="toggle-mode"]');

      if (counter) counter.textContent = (index + 1) + ' / ' + slides.length;
      if (bar) bar.style.width = (((index + 1) / slides.length) * 100) + '%';
      if (toggle) toggle.textContent = document.body.classList.contains('mode-scroll') ? 'Deck' : 'Scroll';

      history.replaceState(null, '', '#slide-' + (index + 1));
    }

    document.addEventListener('keydown', function (event) {
      const tag = (event.target && event.target.tagName || '').toLowerCase();
      if (['input', 'textarea', 'select', 'button'].includes(tag)) return;

      if (['ArrowRight', 'PageDown', ' '].includes(event.key)) {
        event.preventDefault();
        next();
      } else if (['ArrowLeft', 'PageUp'].includes(event.key)) {
        event.preventDefault();
        previous();
      } else if (event.key === 'Home') {
        event.preventDefault();
        goTo(0, { jump: true });
      } else if (event.key === 'End') {
        event.preventDefault();
        goTo(slides.length - 1, { jump: true });
      } else if (event.key.toLowerCase() === 't') {
        event.preventDefault();
        toggleMode();
      } else if (event.key.toLowerCase() === 'f') {
        event.preventDefault();
        toggleFullscreen();
      }
    });

    window.addEventListener('hashchange', function () {
      const target = getStartIndex();
      if (target !== index) goTo(target, { jump: true });
    });
  });
})();
