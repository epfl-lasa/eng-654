'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const main = fs.readFileSync(path.join(__dirname, '../js/main.js'), 'utf8');
const lecture = fs.readFileSync(path.join(__dirname, '../lectures/lecture_06.html'), 'utf8');

async function bootstrap(url) {
  let ready, initialized = false;
  const requested = [];
  const context = vm.createContext({
    URL, console, bootstrapUrl: url,
    document: { addEventListener(event, callback) { assert.equal(event, 'DOMContentLoaded'); ready = callback; } },
    async loadModule(specifier) {
      requested.push(new URL(specifier, url));
      return { initCuspidalityLecture() { initialized = true; } };
    }
  });
  vm.runInContext(main.replaceAll('import.meta.url', 'bootstrapUrl').replace(/\bimport\(/g, 'loadModule('), context);
  await ready();
  assert.ok(initialized, 'The lecture visualization initializer must run.');
  return requested;
}

test('Lecture 06 entry revision bypasses the old cached visualization URL and reaches the ABB initializer', async () => {
  const source = lecture.match(/<script type="module" src="([^"]*main\.js[^\"]*)"/)[1];
  const entry = new URL(source, 'https://course.example/lectures/lecture_06.html');
  const revision = entry.searchParams.get('revision');
  assert.ok(revision, 'Updating only the entry URL cannot refresh its child imports.');
  const requested = await bootstrap(entry.href);
  const visualization = requested.find(url => url.pathname.endsWith('/cuspidalityLecture.js'));
  assert.equal(visualization.searchParams.get('v'), revision);
  assert.notEqual(visualization.searchParams.get('v'), '20260913-8');
  const stylesheet = lecture.match(/href="([^\"]*\/lecture-06\.css[^\"]*)"/)[1];
  assert.equal(new URL(stylesheet, entry).searchParams.get('v'), revision,
    'ABB grid styles need a fresh cache key alongside the visualization code.');
});

test('legacy lecture entry URLs preserve the existing visualization revision', async () => {
  for (const query of ['', '?v=20260831-1', '?v=20260913-8']) {
    const requested = await bootstrap(`https://course.example/js/main.js${query}`);
    assert.ok(requested.length > 0);
    requested.forEach(url => assert.equal(url.searchParams.get('v'), '20260913-8'));
  }
});
