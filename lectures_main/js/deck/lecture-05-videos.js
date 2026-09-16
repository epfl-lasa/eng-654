/* Lecture 05 media remains independent of the visualization module graph. */
(function () {
  'use strict';

  function initialize() {
    const videos = [...document.querySelectorAll('.lecture-05 .l5-video video')];
    if (!videos.length) return;
    const visible = new WeakMap();
    const slides = [...new Set(videos.map((video) => video.closest('.slide')))];

    function pauseOutsideSlide() {
      const deckMode = document.body.classList.contains('mode-deck');
      videos.forEach((video) => {
        if (document.hidden || (deckMode
          ? !video.closest('.slide').classList.contains('active')
          : visible.get(video) === false)) video.pause();
      });
    }

    // Navigation changes the active class even when it replaces the URL hash.
    const navigation = new MutationObserver(pauseOutsideSlide);
    slides.forEach((slide) => navigation.observe(slide, { attributes: true, attributeFilter: ['class'] }));
    navigation.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    const visibility = new IntersectionObserver((entries) => {
      entries.forEach((entry) => visible.set(entry.target, entry.isIntersecting));
      pauseOutsideSlide();
    }, { threshold: 0 });
    videos.forEach((video) => {
      visibility.observe(video);
      video.addEventListener('play', () => {
        videos.forEach((other) => { if (other !== video) other.pause(); });
        pauseOutsideSlide();
      });
      // Let native controls handle playback, volume, and seeking keys.
      video.addEventListener('keydown', (event) => {
        if ([' ', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) event.stopPropagation();
      });
    });
    document.addEventListener('visibilitychange', pauseOutsideSlide);
    window.addEventListener('pagehide', () => videos.forEach((video) => video.pause()));
    pauseOutsideSlide();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();
