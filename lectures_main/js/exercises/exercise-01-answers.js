(function (root) {
  'use strict';

  const NUMERIC_KEYS = [];
  for (let joint = 1; joint <= 7; joint += 1) {
    for (const key of ['thetaOffset', 'd', 'a', 'alpha']) NUMERIC_KEYS.push(`dh.${joint}.${key}`);
  }
  for (const prefix of ['base', 'tool', ...Array.from({ length: 8 }, (_, i) => `visual.${i}`)]) {
    for (const key of ['x', 'y', 'z', 'roll', 'pitch', 'yaw']) NUMERIC_KEYS.push(`${prefix}.${key}`);
  }
  const POSE_NAMES = ['home', 'bent', 'bent_back', 'side_reach', 'wrist_turn'];
  for (const pose of POSE_NAMES) {
    for (let row = 1; row <= 4; row += 1) {
      for (let column = 1; column <= 4; column += 1) NUMERIC_KEYS.push(`fk.${pose}.${row}.${column}`);
    }
  }
  const LEGACY_KEYS = new Set([
    ...Array.from({ length: 7 }, (_, i) => `frame.${i + 1}`),
    'frameConvention', 'finalExplanation', 'chainNotes', 'visualEvidence', 'residual.position', 'residual.orientation'
  ]);
  const FIELD_KEYS = [...NUMERIC_KEYS, 'concept.visualChangesFK', 'concept.jointChangesFK'];
  const ALLOWED_KEYS = new Set(FIELD_KEYS);
  const MAX_FILE_BYTES = 512 * 1024;
  const DRAFT_KEY = 'eng654-exercise-01-answers-v2';

  function validatePayload(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Choose an Exercise 01 answer file.');
    if (![1, 2].includes(payload.schemaVersion) || payload.exercise !== 'exercise_01' || payload.model !== 'iiwa7') {
      throw new Error('This file is not a supported Exercise 01 answer file.');
    }
    if (payload.units?.length !== 'm' || payload.units?.angle !== 'rad') {
      throw new Error('This exercise requires metres and radians. Check the units in your answer file.');
    }
    if (!payload.answers || typeof payload.answers !== 'object' || Array.isArray(payload.answers)) {
      throw new Error('The file does not contain an answer table.');
    }
    const answers = Object.fromEntries(FIELD_KEYS.map(key => [key, '']));
    for (const [key, value] of Object.entries(payload.answers)) {
      if (payload.schemaVersion === 1 && LEGACY_KEYS.has(key)) {
        if (typeof value !== 'string' || value.length > 6000) throw new Error(`Invalid legacy answer for ${key}.`);
        continue;
      }
      if (!ALLOWED_KEYS.has(key)) throw new Error(`Unknown answer field: ${key.slice(0, 80)}.`);
      if (typeof value !== 'string') throw new Error(`The answer for ${key} must be text.`);
      if (value.length > 120) throw new Error(`The answer for ${key} is too long.`);
      answers[key] = value;
    }
    return answers;
  }

  function createPayload(answers) {
    const payload = {
      schemaVersion: 2,
      exercise: 'exercise_01',
      model: 'iiwa7',
      units: { length: 'm', angle: 'rad' },
      exportedAt: new Date().toISOString(),
      answers
    };
    payload.answers = validatePayload(payload);
    return payload;
  }

  function parsePayload(text) {
    if (typeof text !== 'string' || text.length > MAX_FILE_BYTES) throw new Error('Choose an answer file smaller than 512 KB.');
    let payload;
    try { payload = JSON.parse(text); } catch { throw new Error('This file is not valid JSON. Choose the downloaded answer file.'); }
    return validatePayload(payload);
  }

  const api = { FIELD_KEYS, MAX_FILE_BYTES, validatePayload, createPayload, parsePayload };
  root.Exercise01Answers = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof document === 'undefined') return;

  function init() {
    const mode = document.body.dataset.answerMode;
    if (mode !== 'exercise' && mode !== 'solution') return;
    const solutionMode = mode === 'solution';
    const controls = new Map(Array.from(document.querySelectorAll('[data-field]'), input => [input.dataset.field, input]));
    const status = document.getElementById('answer-status');
    const upload = document.getElementById('upload-answers');
    if (typeof ResizeObserver !== 'undefined') {
      const toolbar = document.querySelector('.answer-toolbar');
      new ResizeObserver(() => {
        document.body.style.setProperty('--answer-toolbar-height', `${Math.ceil(toolbar.getBoundingClientRect().height)}px`);
      }).observe(toolbar);
    }

    let saveTimer;
    let importSequence = 0;
    function announce(message, error = false) {
      status.textContent = message;
      status.classList.toggle('answer-status-error', error);
    }
    function collect() {
      return Object.fromEntries(FIELD_KEYS.map(key => [key, controls.get(key)?.value || '']));
    }
    function populate(answers) {
      for (const [key, input] of controls) input.value = answers[key] || '';
    }
    function saveDraft() {
      if (solutionMode) return;
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify(createPayload(collect()))); }
      catch { announce('Browser saving is unavailable. Download your answers to keep a copy.'); }
    }
    if (!solutionMode) {
      try {
        const draft = localStorage.getItem(DRAFT_KEY) || localStorage.getItem('eng654-exercise-01-answers-v1');
        if (draft) {
          populate(parsePayload(draft));
          announce('Restored your saved answers. Download a copy when you are ready.');
        }
      } catch { announce('Saved answers could not be restored. You can load a downloaded copy.'); }
    }

    function downloadFile(payload, filename) {
      validatePayload(payload);
      const json = JSON.stringify(payload, null, 2) + '\n';
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json;charset=utf-8' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    document.getElementById('download-answers').addEventListener('click', () => {
      saveDraft();
      const responses = collect();
      const filled = Object.values(responses).filter(value => value.trim() !== '').length;
      downloadFile(createPayload(responses), 'eng654-exercise-01-answers.json');
      announce(`Downloaded ${filled} of ${FIELD_KEYS.length} filled responses in eng654-exercise-01-answers.json.` +
        (filled < FIELD_KEYS.length ? ' Unfilled fields are blank in the file.' : ''));
    });

    upload.addEventListener('change', async () => {
      const file = upload.files?.[0];
      const sequence = ++importSequence;
      if (!file) return;
      try {
        if (file.size > MAX_FILE_BYTES) throw new Error('Choose an answer file smaller than 512 KB.');
        const answers = parsePayload(await file.text());
        if (sequence !== importSequence) return;
        populate(answers);
        saveDraft();
        announce('Loaded your saved responses. You can continue editing.');
        document.dispatchEvent(new CustomEvent('exercise01:answers-loaded'));
      } catch (error) {
        if (sequence === importSequence) announce(error.message + ' Your current answers were kept.', true);
      } finally { upload.value = ''; }
    });

    for (const input of controls.values()) {
      input.addEventListener('input', () => {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(saveDraft, 200);
        document.dispatchEvent(new CustomEvent('exercise01:answer-edited'));
      });
    }
    window.addEventListener('pagehide', saveDraft);
    // Shared answer-file actions used by the separately loaded instructor UI.
    api.collect = collect;
    api.announce = announce;
    api.downloadFile = downloadFile;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})(typeof globalThis !== 'undefined' ? globalThis : this);
