(() => {
  'use strict';
  const status = document.getElementById('library-status');

  async function addProject(id) {
    const card = document.createElement('article');
    card.className = 'project-download-card';
    const title = document.createElement('h3');
    title.textContent = 'Project ' + id;
    const message = document.createElement('p');
    message.className = 'project-file-status';
    message.textContent = 'Checking PDF…';
    card.append(title, message);
    document.getElementById('part' + id[0] + '-projects').append(card);
    const filename = 'project_' + id + '.pdf';
    const path = '../lectures_main/assets/projects/' + filename;
    try {
      const response = await fetch(path, { method: 'HEAD', cache: 'no-store' });
      if (!response.ok || !/application\/pdf/i.test(response.headers.get('Content-Type') || '')) {
        card.classList.add('unavailable');
        message.textContent = response.status === 404
          ? (id === '2G' ? 'Will be updated soon.' : 'Description not yet available.')
          : 'PDF unavailable. Please try again later.';
        return;
      }
      message.remove();
      const actions = document.createElement('div'); actions.className = 'project-file-actions';
      const view = document.createElement('a');
      view.href = path; view.target = '_blank'; view.rel = 'noopener';
      view.textContent = 'View PDF ↗'; view.setAttribute('aria-label', 'View Project ' + id + ' PDF');
      const download = document.createElement('a');
      download.href = path; download.download = filename;
      download.textContent = 'Download ↓'; download.setAttribute('aria-label', 'Download Project ' + id + ' PDF');
      actions.append(view, download); card.append(actions);
    } catch (_) {
      card.classList.add('unavailable');
      message.textContent = 'Could not load the description. Please try again later.';
    }
  }

  function showProjects() {
    status.textContent = 'Project descriptions are available to view and download.';
    document.getElementById('project-library').hidden = false;
    for (const [part, letters] of [[1, 'ABCDEFGH'], [2, 'ABCDEFG']]) {
      for (const letter of letters) addProject(part + letter);
    }
  }

  showProjects();
})();
