/** Instructor-only Apps Script backend. Never put spreadsheet settings in HTML. */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Project allocation · ENG-654')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// September 2026 in Europe/Zurich is CEST (UTC+02:00). Explicit offsets make
// these instants independent of the script owner's or student's timezone.
function allocationSchedule_() {
  var now = Date.now();
  var projectsOpenAt = Date.parse('2026-09-23T18:00:00+02:00');
  var submissionsOpenAt = Date.parse('2026-09-23T18:30:00+02:00');
  var submissionsCloseAt = Date.parse('2026-09-25T18:30:00+02:00');
  return {
    serverNow: now, timeZone: 'Europe/Zurich',
    projectsOpenAt: projectsOpenAt,
    submissionsOpenAt: submissionsOpenAt,
    submissionsCloseAt: submissionsCloseAt,
    projectsVisible: now >= projectsOpenAt,
    submissionsOpen: now >= submissionsOpenAt && now < submissionsCloseAt
  };
}

function getAllocationState() {
  var state = allocationSchedule_();
  // Do not send the project catalog or PDF links before project viewing opens.
  state.projects = [];
  if (state.projectsVisible) {
    ['1A', '1B', '1C', '1D', '1E', '1F', '1G', '1H', '2A', '2B', '2C', '2D', '2E', '2F', '2G'].forEach(function (id) {
      state.projects.push({ id: id, pdfUrl: 'https://epfl-lasa.github.io/eng-654/lectures_main/assets/projects/project_' + id + '.pdf' });
    });
  }
  return state;
}

function submissionWindowError_() {
  var schedule = allocationSchedule_();
  if (schedule.submissionsOpen) return null;
  return { ok: false, code: schedule.serverNow < schedule.submissionsOpenAt ? 'NOT_OPEN' : 'CLOSED', schedule: schedule };
}

function checkNames(payload) {
  try {
    var names = validateNames_(payload && payload.names);
    if (!allocationSchedule_().submissionsOpen) return { duplicates: [] };
    return { duplicates: duplicates_(openBook_(), names) };
  } catch (error) {
    logFailure_('checkNames', error);
    throw new Error('The previous-submission check is unavailable.');
  }
}

function submitPreferences(payload) {
  var lock = LockService.getScriptLock();
  try {
    var entry = validateEntry_(payload);
    var windowError = submissionWindowError_();
    if (windowError) return windowError;
    lock.waitLock(30000);
    // A request may wait in the lock queue across the closing instant.
    windowError = submissionWindowError_();
    if (windowError) return windowError;
    var book = openBook_();
    var sheet = allocationSheet_(book);
    var lastRow = sheet.getLastRow();
    var fingerprint = JSON.stringify([entry.names, entry.priority1, entry.priority2]);
    // A receipt note, stored with the row, survives retries and script restarts.
    if (lastRow > 1) {
      var notes = sheet.getRange(2, 1, lastRow - 1, 1).getNotes();
      var savedRows = sheet.getRange(2, 1, lastRow - 1, 3).getDisplayValues();
      for (var i = 0; i < notes.length; i++) {
        var receipt;
        try { receipt = JSON.parse(notes[i][0]); } catch (_) { continue; }
        if (receipt && receipt.requestId === entry.requestId) {
          if (receipt.fingerprint !== fingerprint) throw new Error('Retry payload changed.');
          // A note is prepared before the values; only acknowledge a completed row.
          if (savedRows[i][0] !== entry.names.join('\n') || savedRows[i][1] !== entry.priority1 || savedRows[i][2] !== entry.priority2) continue;
          return { ok: true, duplicates: receipt.duplicates || [] };
        }
      }
    }
    var duplicates = duplicates_(book, entry.names);
    windowError = submissionWindowError_();
    if (windowError) return windowError;
    // Header in row 1; group rows 2, 4, 6, ...; a blank row follows every group.
    var row = lastRow <= 1 ? 2 : lastRow + 2;
    if (sheet.getMaxRows() < row + 1) sheet.insertRowsAfter(sheet.getMaxRows(), row + 1 - sheet.getMaxRows());
    var range = sheet.getRange(row, 1, 2, 3);
    range.setNumberFormat('@');
    // Leading apostrophe makes formula-like names literal text in Sheets.
    var group = entry.names.join('\n');
    if (/^[=+@-]/.test(group)) group = "'" + group;
    sheet.getRange(row, 1).setWrap(true).setNote(JSON.stringify({
      requestId: entry.requestId, fingerprint: fingerprint, duplicates: duplicates
    }));
    range.setValues([[group, entry.priority1, entry.priority2], ['', '', '']]);
    SpreadsheetApp.flush();
    return { ok: true, duplicates: duplicates };
  } catch (error) {
    logFailure_('submitPreferences', error);
    // Do not return service errors, document identifiers or internal configuration.
    throw new Error('Your submission could not be confirmed. Please retry.');
  } finally {
    if (lock.hasLock()) lock.releaseLock();
  }
}

function validateNames_(names) {
  if (!Array.isArray(names) || names.length !== 2) throw new Error('Two names required.');
  return names.map(function (name) {
    if (typeof name !== 'string') throw new Error('Invalid name.');
    var value = name.normalize('NFKC').trim().replace(/\s+/gu, ' ');
    if (!value || value.length > 120 || /[\x00-\x1f\x7f]/.test(value)) throw new Error('Invalid name.');
    return value;
  });
}

function validateEntry_(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('Invalid entry.');
  var names = validateNames_(payload.names);
  var pattern = /^(1[A-H]|2[A-G])$/;
  if (typeof payload.priority1 !== 'string' || typeof payload.priority2 !== 'string' ||
      !pattern.test(payload.priority1) || !pattern.test(payload.priority2) ||
      payload.priority1[0] === payload.priority2[0]) throw new Error('Choose one project per part.');
  if (typeof payload.requestId !== 'string' || !/^[a-f0-9-]{36}$/i.test(payload.requestId)) throw new Error('Invalid receipt.');
  return { names: names, priority1: payload.priority1, priority2: payload.priority2, requestId: payload.requestId };
}

function openBook_() {
  var value = (PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID') || '').trim();
  if (!value) throw new Error('Set SPREADSHEET_ID in Project Settings > Script Properties to the allocation spreadsheet ID.');
  // Accept either the ID or a pasted spreadsheet link, never a script project URL.
  var link = value.match(/^https:\/\/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]+)(?:[/?#]|$)/);
  var id = link ? link[1] : value;
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('SPREADSHEET_ID must be a spreadsheet ID or Google Sheets URL, not an Apps Script URL.');
  return SpreadsheetApp.openById(id);
}

function allocationSheet_(book) {
  var name = PropertiesService.getScriptProperties().getProperty('SHEET_NAME') || 'Project allocation';
  var sheet = book.getSheetByName(name) || book.insertSheet(name);
  var headers = ['group', 'priority 1', 'priority 2'];
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, 3).setValues([headers]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 300);
    sheet.setColumnWidths(2, 2, 140);
  } else {
    var actual = sheet.getRange(1, 1, 1, 3).getDisplayValues()[0];
    if (actual.some(function (value, i) { return value.trim().toLowerCase() !== headers[i]; })) {
      throw new Error('Existing tab has a different layout; choose an empty allocation tab.');
    }
  }
  return sheet;
}

function normalizeName_(name) {
  return String(name).normalize('NFKC').trim().replace(/^'/, '').replace(/\s+/gu, ' ').toLowerCase();
}

function duplicates_(book, names) {
  var existing = new Set();
  // Inspect existing tabs too; never send other students' names to the browser.
  book.getSheets().forEach(function (sheet) {
    if (sheet.getLastRow() < 1) return;
    var rows = sheet.getDataRange().getDisplayValues();
    rows.forEach(function (row) {
      row.forEach(function (cell) {
        if (!cell) return;
        existing.add(normalizeName_(cell));
        // Our group cells use line breaks; also recognise common manual separators.
        String(cell).split(/\r?\n|\s+&\s+|;/).forEach(function (name) {
          if (name.trim()) existing.add(normalizeName_(name));
        });
      });
    });
  });
  return names.filter(function (name, index) {
    return existing.has(normalizeName_(name)) && names.findIndex(function (other) {
      return normalizeName_(other) === normalizeName_(name);
    }) === index;
  });
}

// Server logs are visible to the instructor in Apps Script > Executions only.
function logFailure_(operation, error) {
  console.error(operation + ': ' + (error && error.stack ? error.stack : String(error)));
}

/** Visible in the editor's Run dropdown; only the executing owner can run setup. */
function setupAllocation() {
  var user = Session.getActiveUser().getEmail();
  if (!user || user !== Session.getEffectiveUser().getEmail()) {
    throw new Error('Run setupAllocation from the Apps Script editor as the deployment owner.');
  }
  initializeAllocation_();
}

/** Internal setup implementation; trailing underscore keeps it private. */
function initializeAllocation_() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    allocationSheet_(openBook_());
    SpreadsheetApp.flush();
    console.log('Allocation setup succeeded: spreadsheet access and the allocation tab are ready.');
  }
  finally { lock.releaseLock(); }
}
