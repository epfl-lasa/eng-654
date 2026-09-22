const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');

function fixture(options = {}) {
  let locked = false, failFlush = false, nextId = 0;
  const tabs = [], logs = [], openedIds = [];
  let now = Date.parse(options.now || '2026-09-24T12:00:00+02:00');
  class ServerDate extends Date { static now() { return now; } }
  class Sheet {
    constructor(name) { this.name = name; this.values = []; this.notes = []; this.maxRows = 3; }
    getLastRow() { return this.values.reduce((last, row, i) => row.some(Boolean) ? i + 1 : last, 0); }
    getMaxRows() { return this.maxRows; }
    insertRowsAfter(_, count) { this.maxRows += count; }
    setFrozenRows() {} setColumnWidth() {} setColumnWidths() {}
    getDataRange() { return this.getRange(1, 1, this.getLastRow(), 3); }
    getRange(row, column, height = 1, width = 1) {
      const sheet = this;
      function write(target, values) { values.forEach((cells, i) => cells.forEach((value, j) => { target[row - 1 + i] ||= []; target[row - 1 + i][column - 1 + j] = value; })); }
      function read(target) { return Array.from({ length: height }, (_, i) => Array.from({ length: width }, (_, j) => target[row - 1 + i]?.[column - 1 + j] || '')); }
      return {
        setValues(values) { assert.ok(locked, 'writes must hold the script lock'); write(sheet.values, values); return this; },
        getDisplayValues() { return read(sheet.values).map(cells => cells.map(value => value.replace(/^'/, ''))); },
        getNotes() { return read(sheet.notes); },
        setNote(value) { write(sheet.notes, [[value]]); return this; },
        setNumberFormat() { return this; }, setFontWeight() { return this; }, setWrap() { return this; }
      };
    }
  }
  const book = { getSheetByName: name => tabs.find(tab => tab.name === name), insertSheet: name => { const sheet = new Sheet(name); tabs.push(sheet); return sheet; }, getSheets: () => tabs };
  const context = vm.createContext({
    Date: ServerDate,
    console: { error: value => logs.push(value), log: value => logs.push(value) },
    Session: { getActiveUser: () => ({ getEmail: () => options.activeEmail === undefined ? 'owner@example.test' : options.activeEmail }), getEffectiveUser: () => ({ getEmail: () => 'owner@example.test' }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: key => key === 'SPREADSHEET_ID' ? (options.spreadsheetId === undefined ? 'private-test-id' : options.spreadsheetId) : null }) },
    LockService: { getScriptLock: () => ({ waitLock: () => { assert.equal(locked, false); locked = true; if (options.lockAt) now = Date.parse(options.lockAt); }, hasLock: () => locked, releaseLock: () => { locked = false; } }) },
    SpreadsheetApp: { openById: id => { openedIds.push(id); if (options.denied) throw Error('Permission denied for private-test-id'); return book; }, flush: () => { if (failFlush) { failFlush = false; throw Error('Lost response'); } } }
  });
  vm.runInContext(source, context);
  const payload = (overrides = {}) => ({ names: ['Ada Lovelace', 'Grace Hopper'], priority1: '1A', priority2: '2G', requestId: '00000000-0000-4000-8000-' + String(++nextId).padStart(12, '0'), ...overrides });
  return { api: context, book, payload, logs, openedIds, setNow: value => { now = Date.parse(value); }, failNextFlush: () => { failFlush = true; }, unlocked: () => !locked };
}

test('writes exact columns, two names in one group cell, and one blank row after each group', () => {
  const f = fixture();
  f.api.submitPreferences(f.payload());
  f.api.submitPreferences(f.payload({ priority1: '2A', priority2: '1H' }));
  assert.deepEqual(f.book.getSheets()[0].values, [
    ['group', 'priority 1', 'priority 2'], ['Ada Lovelace\nGrace Hopper', '1A', '2G'], ['', '', ''],
    ['Ada Lovelace\nGrace Hopper', '2A', '1H'], ['', '', '']
  ]);
  assert.ok(f.unlocked());
});

test('server accepts every valid cross-part pair and rejects every same-part pair', () => {
  const f = fixture();
  const ids = [...'ABCDEFGH'].map(c => '1' + c).concat([...'ABCDEFG'].map(c => '2' + c));
  for (const priority1 of ids) for (const priority2 of ids) {
    const entry = f.payload({ priority1, priority2 });
    if (priority1[0] === priority2[0]) assert.throws(() => f.api.submitPreferences(entry));
    else assert.equal(f.api.submitPreferences(entry).ok, true);
  }
  assert.equal(f.book.getSheets()[0].getLastRow(), 224);
  assert.ok(f.unlocked());
});

test('rejects missing names, forged IDs, malformed requests and invalid receipt IDs', () => {
  const f = fixture();
  for (const change of [{ names: ['', 'A'] }, { names: ['A'] }, { names: ['A', 1] }, { names: ['A'.repeat(121), 'B'] }, { priority1: '1I' }, { priority2: '2H' }, { priority2: '=1+1' }, { requestId: 'bad' }]) {
    assert.throws(() => f.api.submitPreferences(f.payload(change)));
  }
  assert.throws(() => f.api.submitPreferences(null));
  assert.equal(f.book.getSheets().length, 0);
  assert.ok(f.unlocked());
});

test('duplicate names normalize whitespace/case/Unicode, warn and never block a new submission', () => {
  const f = fixture();
  f.api.submitPreferences(f.payload());
  const result = f.api.checkNames({ names: ['  ADA   LOVELACE ', 'Someone New'] });
  assert.deepEqual(Array.from(result.duplicates), ['ADA LOVELACE']);
  const result2 = f.api.submitPreferences(f.payload({ names: ['Ａｄａ Lovelace', 'ADA LOVELACE'] }));
  assert.equal(result2.ok, true);
  assert.equal(result2.duplicates.length, 1);
  assert.equal(f.book.getSheets()[0].getLastRow(), 4);
});

test('recognizes existing names on other tabs and only returns matching entered names', () => {
  const f = fixture();
  const other = f.book.insertSheet('Existing groups');
  other.values = [['group', '', ''], ['Alex Doe & Sam Roe', '', ''], ['Pat Poe; Lee Doe', '', '']];
  assert.deepEqual(Array.from(f.api.checkNames({ names: ['SAM ROE', 'Pat Poe'] }).duplicates), ['SAM ROE', 'Pat Poe']);
});

test('a solo student enters the same name twice without a false existing-name warning', () => {
  const f = fixture();
  const result = f.api.submitPreferences(f.payload({ names: ['Ada Lovelace', 'Ada Lovelace'] }));
  assert.equal(result.duplicates.length, 0);
  assert.equal(f.book.getSheets()[0].values[1][0], 'Ada Lovelace\nAda Lovelace');
});

test('lost response can be retried without an extra row; a fresh request is still allowed', () => {
  const f = fixture();
  const entry = f.payload();
  f.failNextFlush();
  assert.throws(() => f.api.submitPreferences(entry));
  assert.equal(f.api.submitPreferences(entry).ok, true);
  assert.equal(f.book.getSheets()[0].getLastRow(), 2);
  assert.throws(() => f.api.submitPreferences({ ...entry, priority2: '2A' }));
  assert.equal(f.book.getSheets()[0].getLastRow(), 2);
  assert.equal(f.api.submitPreferences(f.payload()).ok, true);
  assert.equal(f.book.getSheets()[0].getLastRow(), 4);
});

test('formula-like names are stored as literal text', () => {
  const f = fixture();
  f.api.submitPreferences(f.payload({ names: ['=IMPORTXML("anything")', '+Other'] }));
  assert.ok(f.book.getSheets()[0].values[1][0].startsWith("'="));
});

test('refuses to overwrite an unrelated target tab and hides internal errors', () => {
  const f = fixture();
  const sheet = f.book.insertSheet('Project allocation'); sheet.values = [['Existing data']];
  assert.throws(() => f.api.submitPreferences(f.payload()), /^Error: Your submission could not be confirmed/);
  assert.deepEqual(sheet.values, [['Existing data']]);
  assert.ok(f.unlocked());
});

test('student files contain no sheet address or backend settings; setup is excluded from site staging', () => {
  const root = path.resolve(__dirname, '../../..');
  const html = fs.readFileSync(path.join(root, 'project-allocation/index.html'), 'utf8');
  assert.doesNotMatch(html, /docs\.google\.com\/spreadsheets|SPREADSHEET_ID|1JPc9j/);
  assert.match(fs.readFileSync(path.join(root, '.github/scripts/stage_site.py'), 'utf8'), /"\.github"/);
});


test('setup explains missing configuration and accepts a spreadsheet URL or trimmed ID', () => {
  const missing = fixture({ spreadsheetId: '' });
  assert.throws(() => missing.api.initializeAllocation_(), /Set SPREADSHEET_ID/);
  assert.ok(missing.unlocked());
  const invalid = fixture({ spreadsheetId: 'https://script.google.com/macros/s/deployment/exec' });
  assert.throws(() => invalid.api.initializeAllocation_(), /not an Apps Script URL/);
  for (const value of [' private-test-id ', 'https://docs.google.com/spreadsheets/d/private-test-id/edit?gid=0#gid=0']) {
    const f = fixture({ spreadsheetId: value });
    f.api.initializeAllocation_();
    assert.deepEqual(f.openedIds, ['private-test-id']);
    assert.equal(f.book.getSheets()[0].getLastRow(), 1);
    assert.match(f.logs[0], /setup succeeded/);
  }
});

test('connection failures are logged privately while both public methods hide internal details', () => {
  const f = fixture({ denied: true });
  assert.throws(() => f.api.checkNames({ names: ['A', 'B'] }), /^Error: The previous-submission check is unavailable\.$/);
  assert.throws(() => f.api.submitPreferences(f.payload()), /^Error: Your submission could not be confirmed\. Please retry\.$/);
  assert.equal(f.logs.length, 2);
  assert.match(f.logs[0], /checkNames:.*Permission denied for private-test-id/);
  assert.match(f.logs[1], /submitPreferences:.*Permission denied for private-test-id/);
  assert.ok(f.unlocked());
});


test('visible setup function works for the owner and rejects anonymous or other web app users', () => {
  const owner = fixture();
  owner.api.setupAllocation();
  assert.equal(owner.book.getSheets()[0].getLastRow(), 1);
  assert.match(owner.logs[0], /setup succeeded/);
  for (const activeEmail of ['', 'student@example.test']) {
    const visitor = fixture({ activeEmail });
    assert.throws(() => visitor.api.setupAllocation(), /Run setupAllocation from the Apps Script editor/);
    assert.equal(visitor.openedIds.length, 0);
    assert.equal(visitor.book.getSheets().length, 0);
  }
});


test('Zurich schedule releases projects at 18:00 and accepts submissions only in the specified window', () => {
  for (const [now, visible, open] of [
    ['2026-09-23T17:59:59.999+02:00', false, false],
    ['2026-09-23T18:00:00+02:00', true, false],
    ['2026-09-23T18:29:59.999+02:00', true, false],
    ['2026-09-23T18:30:00+02:00', true, true],
    ['2026-09-25T18:29:59.999+02:00', true, true],
    ['2026-09-25T18:30:00+02:00', true, false],
    ['2030-01-01T00:00:00Z', true, false]
  ]) {
    const f = fixture({ now });
    const state = f.api.getAllocationState({ serverNow: Date.parse('2026-09-24T10:00:00Z') });
    assert.equal(state.timeZone, 'Europe/Zurich');
    assert.equal(state.projectsVisible, visible, now);
    assert.equal(state.projects.length, visible ? 15 : 0, now);
    assert.equal(state.submissionsOpen, open, now);
    assert.equal(state.projectsOpenAt, Date.parse('2026-09-23T16:00:00Z'));
    assert.equal(state.submissionsOpenAt, Date.parse('2026-09-23T16:30:00Z'));
    assert.equal(state.submissionsCloseAt, Date.parse('2026-09-25T16:30:00Z'));
    const result = f.api.submitPreferences(f.payload({ serverNow: Date.parse('2026-09-24T10:00:00Z') }));
    assert.equal(result.ok, open, now);
    if (!open) { assert.equal(f.openedIds.length, 0); assert.equal(f.book.getSheets().length, 0); }
  }
});

test('server rechecks the deadline after waiting for another submission', () => {
  const f = fixture({ now: '2026-09-25T18:29:59.999+02:00', lockAt: '2026-09-25T18:30:00+02:00' });
  const result = f.api.submitPreferences(f.payload());
  assert.equal(result.ok, false);
  assert.equal(result.code, 'CLOSED');
  assert.equal(f.openedIds.length, 0);
  assert.ok(f.unlocked());
});

test('project catalog keeps the exact PDF filenames for every project', () => {
  const f = fixture();
  for (const project of f.api.getAllocationState().projects) {
    assert.equal(project.pdfUrl, 'https://epfl-lasa.github.io/eng-654/lectures_main/assets/projects/project_' + project.id + '.pdf');
  }
});
