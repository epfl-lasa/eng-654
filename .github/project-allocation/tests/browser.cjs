// Serve the repository on 8067 and launch isolated Chromium with CDP on 9267.
// This check stubs Apps Script calls; it never writes to a live spreadsheet.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const base = process.env.ALLOCATION_BASE_URL || 'http://127.0.0.1:8067';
const cdp = process.env.ALLOCATION_CDP_URL || 'http://127.0.0.1:9267';
async function connection(url) {
  const socket = new WebSocket(url), pending = new Map(), errors = [];
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let serial = 0;
  socket.addEventListener('message', event => {
    const data = JSON.parse(event.data);
    if (data.id) {
      const item = pending.get(data.id); if (!item) return;
      pending.delete(data.id); clearTimeout(item.timer);
      data.error ? item.reject(Error(JSON.stringify(data.error))) : item.resolve(data.result);
    } else if (data.method === 'Runtime.exceptionThrown') errors.push(data.params.exceptionDetails);
    else if (data.method === 'Runtime.consoleAPICalled' && data.params.type === 'error') errors.push(data.params.args.map(arg => arg.value || arg.description).join(' '));
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++serial, timer = setTimeout(() => { pending.delete(id); reject(Error('CDP timeout: ' + method)); }, 30000);
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  });
  return { send, errors, close: () => socket.close() };
}

(async () => {
  const info = await (await fetch(cdp + '/json/version')).json();
  const browser = await connection(info.webSocketDebuggerUrl);
  let context, page;
  try {
    context = (await browser.send('Target.createBrowserContext')).browserContextId;
    const target = await browser.send('Target.createTarget', { url: 'about:blank', browserContextId: context });
    const targets = await (await fetch(cdp + '/json/list')).json();
    page = await connection(targets.find(item => item.id === target.targetId).webSocketDebuggerUrl);
    const run = async expression => {
      const result = await page.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    const until = async expression => {
      for (let i = 0; i < 200; i++) { if (await run(expression)) return; await new Promise(resolve => setTimeout(resolve, 50)); }
      throw Error('Timed out: ' + expression);
    };
    const click = selector => run(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const name = (id, value) => run(`(() => { const input=document.getElementById(${JSON.stringify(id)}); input.value=${JSON.stringify(value)}; input.dispatchEvent(new Event('input', {bubbles:true})); })()`);
    await page.send('Runtime.enable'); await page.send('Page.enable');
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
    // Exercise the unconfigured entry point without changing real deployment settings.
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `
      const originalFetch = window.fetch;
      window.fetch = (url, ...args) => url === './config.json'
        ? Promise.resolve(new Response(JSON.stringify({ formUrl: '' }), {status:200}))
        : originalFetch(url, ...args);
    ` });
    await page.send('Page.navigate', { url: base + '/project-allocation/' });
    await until('document.querySelector("#availability")?.textContent.includes("not connected")');
    assert.equal(await run('document.querySelectorAll(".project").length'), 0);
    assert.equal(await run('document.querySelector("#allocation-form").hidden'), true);
    assert.equal(await run('document.querySelector("#submit").disabled'), true);
    // Load a hosted form using an isolated server mock injected before the page script.
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `
      window.calls = []; window.failSubmit = false; window.failCheck = false;
      window.serverOrigin = performance.now();
      window.serverStart = Date.parse(sessionStorage.getItem('testTime') || '2026-09-24T12:00:00+02:00');
      // Deliberately wrong computer clock: only the mock server clock should matter.
      Date.now = () => Date.parse('2040-01-01T00:00:00Z');
      window.setServerTime = value => { window.serverStart = Date.parse(value); window.serverOrigin = performance.now(); document.dispatchEvent(new Event('visibilitychange')); };
      const state = () => {
        const now = window.serverStart + performance.now() - window.serverOrigin;
        const projectsOpenAt = Date.parse('2026-09-23T18:00:00+02:00');
        const submissionsOpenAt = Date.parse('2026-09-23T18:30:00+02:00');
        const submissionsCloseAt = Date.parse('2026-09-25T18:30:00+02:00');
        const ids = [...'ABCDEFGH'].map(c => '1'+c).concat([...'ABCDEFG'].map(c => '2'+c));
        return {serverNow:now, timeZone:'Europe/Zurich', projectsOpenAt, submissionsOpenAt, submissionsCloseAt,
          projectsVisible:now>=projectsOpenAt, submissionsOpen:now>=submissionsOpenAt&&now<submissionsCloseAt,
          projects:now>=projectsOpenAt?ids.map(id=>({id,pdfUrl:'${base}/lectures_main/assets/projects/project_'+id+'.pdf'})):[]};
      };
      const runner = (success, failure) => ({
        withSuccessHandler(fn) { return runner(fn, failure); },
        withFailureHandler(fn) { return runner(success, fn); },
        getAllocationState() { setTimeout(() => success(state()), 10); },
        checkNames(payload) { setTimeout(() => window.failCheck ? failure({message:'private server error'}) : success({duplicates:payload.names.filter((name,i) => /ada/i.test(name) && i === 0)}), 10); },
        submitPreferences(payload) { window.calls.push(payload); setTimeout(() => window.failSubmit ? failure({message:'private server error'}) : success({ok:true, duplicates:['Ada Lovelace']}), 20); }
      });
      window.google = {script:{run:runner()}};
    ` });
    await page.send('Page.reload');
    await until('document.querySelectorAll(".project").length === 15');
    assert.equal(await run('document.querySelectorAll(".project a").length'), 15);
    await name('name1', 'Ada Lovelace'); await name('name2', 'Grace Hopper');
    await until('!document.querySelector("#duplicate-warning").hidden');
    assert.match(await run('document.querySelector("#duplicate-warning").textContent'), /You may still submit/);
    const ids = [...'ABCDEFGH'].map(c => '1' + c).concat([...'ABCDEFG'].map(c => '2' + c));
    for (const first of ids) {
      await click(`[name=priority1][value="${first}"]`);
      assert.equal(await run('document.querySelectorAll("[name=priority2]:disabled").length'), first[0] === '1' ? 8 : 7);
      for (const second of ids) {
        await click(`[name=priority2][value="${second}"]`);
        const actual = await run('document.querySelector("[name=priority2]:checked")?.value || ""');
        if (first[0] === second[0]) assert.notEqual(actual, second);
        else assert.equal(actual, second);
      }
    }
    await click('[name=priority1][value="1A"]');
    await click('[name=priority2][value="2A"]');
    await click('[name=priority1][value="2B"]');
    assert.equal(await run('document.querySelector("[name=priority2]:checked")'), null);
    assert.equal(await run('document.querySelector("#submit").disabled'), true);
    await click('[name=priority2][value="1H"]');
    assert.equal(await run('document.querySelector("#submit").disabled'), false);
    for (const width of [1280, 760, 390]) {
      await page.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 500 });
      assert.ok(await run('document.documentElement.scrollWidth <= innerWidth'), 'no horizontal overflow at ' + width);
    }
    await run('window.scrollTo(0, 0)');
    const screenshot = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    fs.writeFileSync('/tmp/eng654-allocation-mobile.png', Buffer.from(screenshot.data, 'base64'));
    // Failure preserves fields, hides raw errors, and retries reuse the receipt.
    await run('window.failSubmit = true'); await click('#submit');
    await until('document.querySelector("#submit-status").textContent.includes("retry")');
    assert.equal(await run('document.querySelector("#name1").value'), 'Ada Lovelace');
    await click('#submit');
    await until('window.calls.length === 2 && !document.querySelector("#submit").disabled');
    assert.equal(await run('calls[0].requestId === calls[1].requestId'), true);
    await click('[name=priority2][value="1G"]');
    await run('window.failSubmit = false'); await click('#submit');
    await until('!document.querySelector("#success").hidden');
    assert.equal(await run('calls[1].requestId !== calls[2].requestId'), true);
    assert.match(await run('document.querySelector("#receipt").textContent'), /Priority 1: 2B; Priority 2: 1G/);
    assert.equal(await run('document.querySelector("#receipt-warning").hidden'), false);
    assert.equal(await run('document.querySelector("#allocation-form").hidden'), true);
    assert.equal(await run('document.body.textContent.includes("private server error")'), false);
    // Start a fresh page before release; no project titles or links reach its DOM.
    await run("sessionStorage.setItem('testTime', '2026-09-23T17:59:00+02:00')");
    await page.send('Page.reload');
    await until('document.querySelector("#availability")?.textContent.includes("descriptions open")');
    assert.equal(await run('document.querySelectorAll(".project").length'), 0);
    assert.equal(await run('document.querySelector("#allocation-form").hidden'), true);
    // Cross the viewing boundary in the same open tab.
    await run("setServerTime('2026-09-23T17:59:59.500+02:00')");
    await until('document.querySelectorAll(".project").length === 15 && !document.querySelector("#allocation-form").hidden');
    assert.equal(await run('document.querySelector("#submit").disabled'), true);
    await name('name1', 'Solo Student'); await name('name2', 'Solo Student');
    await click('[name=priority1][value="1A"]'); await click('[name=priority2][value="2A"]');
    await run("setServerTime('2026-09-23T18:29:59.500+02:00')");
    await until('!document.querySelector("#submit").disabled');
    await run("setServerTime('2026-09-25T18:29:59.500+02:00')");
    await until('document.querySelector("#submit").disabled && document.querySelector("#availability").textContent.includes("Submissions closed")');
    assert.equal(await run('document.querySelector("#allocation-form").hidden'), false);
    assert.equal(await run('document.querySelectorAll(".project a").length'), 15);
    // Manipulating disabled controls still cannot initiate an RPC outside the window.
    await run('document.querySelector("#submit").disabled=false; document.querySelector("#allocation-form").dispatchEvent(new Event("submit", {cancelable:true,bubbles:true}))');
    assert.equal(await run('window.calls.length'), 0);
    // Existing Part 1 files are served as real PDFs at their expected local URLs.
    for (const letter of 'ABCDEFGH') {
      const response = await fetch(base + '/lectures_main/assets/projects/project_1' + letter + '.pdf');
      assert.equal(response.status, 200);
      assert.ok(Buffer.from(await response.arrayBuffer()).subarray(0, 5).equals(Buffer.from('%PDF-')));
    }
    // Main page exposes only the Projects library, beside GoFa.
    await page.send('Page.navigate', { url: base + '/' });
    await until(`!!document.querySelector('a[href="projects/"]')`);
    assert.equal(await run(`document.querySelector('a[href="projects/"] span').textContent`), 'Projects');
    assert.match(await run(`document.querySelector('a[href="projects/"]').previousElementSibling.textContent`), /GoFa/);
    assert.equal(await run(`document.querySelector('a[href*="project-allocation"]')`), null);
    await page.send('Page.navigate', { url: base + '/projects/' });
    await until('document.querySelectorAll(".project-file-actions").length === 13 && document.querySelectorAll(".unavailable").length === 2');
    assert.equal(await run('document.querySelectorAll(".project-download-card").length'), 15);
    assert.equal(await run('document.querySelectorAll("a[download]").length'), 13);
    assert.equal(await run('document.querySelector(".project-file-actions a").target'), '_blank');
    assert.equal(await run('document.querySelector("a[download]").download'), 'project_1A.pdf');
    assert.equal(await run('document.querySelectorAll(".unavailable a").length'), 0);
    assert.equal(await run('document.body.textContent.toLowerCase().includes("allocation")'), false);
    for (const width of [1280, 760, 390]) {
      await page.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 500 });
      assert.ok(await run('document.documentElement.scrollWidth <= innerWidth'), 'library has no overflow at ' + width);
    }
    const libraryShot = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    fs.writeFileSync('/tmp/eng654-project-library-mobile.png', Buffer.from(libraryShot.data, 'base64'));
    assert.deepEqual(page.errors, []);
    console.log('Browser checks passed: 15 panels, all 225 priority pairs, warnings, retries, receipt, mobile layout, timed release/deadline transitions, Part 1 PDFs, Projects library, downloads, and main-page navigation.');
  } finally {
    if (context) await browser.send('Target.disposeBrowserContext', { browserContextId: context });
    if (page) page.close(); browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
