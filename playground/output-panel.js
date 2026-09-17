(function () {
  'use strict';
  const button = document.getElementById('toggle-output');
  const content = document.getElementById('output-content');
  const panel = document.querySelector('.output-panel');
  if (!button || !content || !panel) return;
  const storageKey = 'kinematic-building-blocks-output-expanded-v1';
  let expanded = false;
  try { expanded = localStorage.getItem(storageKey) === 'true'; } catch (_) { /* The panel works without browser storage. */ }
  function sync() {
    document.body.classList.toggle('output-collapsed', !expanded);
    document.body.classList.toggle('output-expanded', expanded);
    panel.dataset.expanded = String(expanded);
    button.setAttribute('aria-expanded', String(expanded));
    content.hidden = !expanded;
    for (const tool of panel.querySelector('.output-toolbar').children) if (tool !== button) tool.hidden = !expanded;
    const error = content.querySelector('.error-message')?.textContent;
    button.querySelector('.disclosure-sign').textContent = expanded ? '−' : '+';
    button.querySelector('.disclosure-label').textContent = expanded ? 'Collapse output' : error ? 'Show error' : 'Expand output';
    button.title = expanded ? 'Give more space to the playground' : error || 'Show the full selected output';
    button.classList.toggle('output-has-error', !!error);
    button.setAttribute('aria-label', expanded ? 'Collapse output' : error ? `Expand output: ${error}` : 'Expand output');
  }
  button.addEventListener('click', () => {
    expanded = !expanded;
    try { localStorage.setItem(storageKey, String(expanded)); } catch (_) { /* Optional preference. */ }
    sync();
    window.dispatchEvent(new Event('resize'));
  });
  new MutationObserver(sync).observe(content, { childList: true, subtree: true, characterData: true });
  sync();
  const operations = document.getElementById('operations-panel');
  if (operations) {
    try { operations.open = localStorage.getItem('kinematic-building-blocks-operations-expanded-v1') !== 'false'; } catch (_) {}
    operations.addEventListener('toggle', () => {
      try { localStorage.setItem('kinematic-building-blocks-operations-expanded-v1', String(operations.open)); } catch (_) {}
      window.dispatchEvent(new Event('resize'));
    });
  }
})();
