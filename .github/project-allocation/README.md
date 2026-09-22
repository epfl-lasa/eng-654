# Activate project allocation

The public entry point is `project-allocation/index.html`; the main page links to
it beside the ABB GoFa asset. The form is implemented and can be previewed locally,
but submissions remain disabled until the following one-time Google deployment.
An editable spreadsheet URL is not an API credential.

## Source files and locations

These paths are relative to the **repository root** (`eng-654/`), not to this
README's directory or to the Google Apps Script editor:

| Local repository file | Use in Google Apps Script |
| --- | --- |
| [`.github/project-allocation/Code.gs`](Code.gs) | Copy into the script file `Code.gs` |
| [`project-allocation/index.html`](../../project-allocation/index.html) | Copy into a new HTML file named `Index` |
| [`project-allocation/config.json`](../../project-allocation/config.json) | Keep in the repository; set the deployed web app URL here |

`Code.gs` has an uppercase **C**. The `.github` directory is hidden in some local
file browsers; enable **Show Hidden Files** to see it. These are local source
files: new changes appear on GitHub only after they have been committed and
pushed. The course website intentionally does not publish the `.github` files.

## One-time setup (spreadsheet owner)

1. Open the supplied allocation spreadsheet. Choose **Extensions → Apps Script**.
2. In your local repository, open [`.github/project-allocation/Code.gs`](Code.gs)
   and copy all its contents. In the Apps Script editor, paste them into `Code.gs`,
   replacing the default sample code. If that editor file is missing, add a
   **Script** file named **Code**.
3. In the Apps Script editor, add an **HTML** file named **Index** (the editor
   supplies `.html`). Open the local
   [`project-allocation/index.html`](../../project-allocation/index.html), copy
   its complete contents, and paste them into the editor's `Index.html`. The
   source includes its own CSS and JS; no build or external libraries are needed.
4. Under **Project Settings → Script Properties**, add:
   - `SPREADSHEET_ID`: the value between `/d/` and `/edit` in the supplied sheet URL.
   - `SHEET_NAME`: `Project allocation` (optional; this is the default).
   Keep these settings in Apps Script, never in the public configuration.
5. Select `setupAllocation` in the editor and run it. Authorize access under
   the account that owns or can edit the supplied spreadsheet. This creates the
   allocation tab and the columns `group`, `priority 1`, `priority 2` without
   changing other tabs. An existing target tab must have these three headers.
6. **Deploy → New deployment → Web app**. Set **Execute as: Me** and access to
   **Anyone** so students do not need spreadsheet access. If your institution
   restricts that option, choose the allowed audience and test with a student
   account. Deploy and copy the web app URL ending in `/exec` (not `/dev`).
7. Put that URL into `project-allocation/config.json`, for example:
   ```json
   { "formUrl": "https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec" }
   ```
8. Publish the course site using its normal GitHub Pages workflow. Its student
   entry link will be `https://epfl-lasa.github.io/eng-654/project-allocation/`.

The public entry point redirects to the deployed form. Google hosts the form and
its server calls; there are no cross-origin sheet requests, spreadsheet links,
spreadsheet IDs, or service credentials in the student page. This backend and its
instructions are under `.github`, which the site's staging script excludes.
Only the web app URL is public. Anyone permitted to open that web app can submit.

## If the page opens but checks and submissions fail

Opening the form verifies HTML delivery only. Both operations also need authorized
spreadsheet access under the account selected in **Execute as**.

1. In **Project Settings → Script Properties**, check `SPREADSHEET_ID`. Use the
   spreadsheet ID (between `/d/` and `/edit`), not the script project or deployment
   ID. The updated backend also accepts the complete Google Sheets URL.
2. Select `setupAllocation` in the Apps Script editor and click **Run**.
   Approve the requested spreadsheet access. The execution log should say
   `Allocation setup succeeded`. If it fails, the editor shows the actual cause;
   fix that error before trying the public form again.
3. In **Deploy → Manage deployments → Edit**, confirm **Execute as: Me** uses an
   account with edit access to the spreadsheet. If you replaced `Code.gs` or
   `Index.html`, select **New version → Deploy** to update the existing `/exec`
   link. Saving editor changes alone does not update that link.
4. With the updated backend, failed checks and submissions log the original error
   privately under **Executions**. The student page continues to show only a
   generic error, without spreadsheet addresses or configuration.

## Zurich-time release and submission window

The 2026 schedule is enforced by the Apps Script server (`Europe/Zurich`, CEST):

| Event | Zurich time | UTC |
| --- | --- | --- |
| Project descriptions become visible | 23 September 2026, 18:00 | 23 September, 16:00 |
| Submissions open | 23 September 2026, 18:30 | 23 September, 16:30 |
| Submissions close | 25 September 2026, 18:30 | 25 September, 16:30 |

The opening instant is included; the closing instant is excluded. There is no
closing date for viewing projects. Before release, the server withholds the
project catalog and the form hides the project panels. The entry link remains
available and shows the schedule. The client uses server time plus elapsed time,
refreshes while a tab is open, and resynchronizes on return to the tab. The server
also rejects submissions outside the window, including requests that wait for a
write lock across the deadline. Student clock or timezone changes cannot extend
submission access.

The timing gate controls the allocation form and its project catalog. The PDFs
are public static website files once published; direct PDF URLs are not protected
by this form's schedule.

To activate this update, copy **both** the latest `Code.gs` and
`project-allocation/index.html` into Apps Script (`Code.gs` and `Index.html`), then
**Deploy → Manage deployments → Edit → New version → Deploy**. Keep the same
web app URL in `config.json`. Saving source alone does not update the deployment.

## Project PDF links and publication

Every link uses this exact, case-sensitive path on the course website:
`lectures_main/assets/projects/project_<ID>.pdf`.

The live check on 23 September 2026 returned **404 for all 15 files**. The eight
Part 1 files exist locally and have valid PDF signatures, but were untracked and
not published. Part 2A–2G are absent locally. The old numbered PDFs under
`assets/projects/` are different files and are not substituted for these projects.

Publish the eight supplied PDFs together with the course changes. Add the seven
Part 2 files under the same directory using `project_2A.pdf` through
`project_2G.pdf`, then publish them too. The existing Pages staging process
includes this directory; updating the Apps Script deployment does not upload
these PDF files. After a successful Pages deployment, verify the PDF URLs again.

## Verify before sharing

During the submission window, use a disposable copy of the spreadsheet for an end-to-end smoke test, then deploy
against the intended sheet. Browser and backend tests below use fake services and
never write to the real sheet.

- Submit two names with 1A first and 2A second; verify one row plus a blank row.
- Repeat a name (including case/spacing changes): a warning must appear, and a
  new deliberate submission must still succeed. A solo student repeats their name.
- Choose Part 2 first, then Part 1. Changing Priority 1 to the opposite part must
  clear the now-invalid Priority 2. The server also rejects forged same-part pairs.
- Test a student account or private browser session to confirm deployment access.
- Open the PDF links. Part 1A–1H are present; upload Part 2 files as
  `lectures_main/assets/projects/project_2A.pdf` through `project_2G.pdf`.

Both names appear on separate lines in the `group` cell. Existing-name checks scan
all tabs for exact names after Unicode, case and whitespace normalization. They
recognize names in separate cells, on separate lines, and joined by ` & ` or `;`.
They do not guess nicknames, misspellings, or reversed surname/first-name order.
Only matched names already entered by the current student are returned to them.

Writes use a script-wide lock, enforce valid IDs from different parts, treat
formula-like names as text, and save a request receipt in a cell note. Retrying an
unchanged submission after a lost response reuses that receipt; a fresh form is
allowed to submit again. Do not remove receipt notes if retries must be deduplicated.

When changing the HTML or backend, copy the new source into Apps Script and use
**Deploy → Manage deployments → Edit → New version → Deploy** to keep the same URL.
Changes made only to GitHub do not update an existing Apps Script deployment.

## Local checks

```bash
node --test .github/project-allocation/tests/backend.test.cjs
python3 -B -m unittest discover -s .github/scripts -p 'test_stage_site.py'
```

Official references: [web app deployment](https://developers.google.com/apps-script/guides/web),
[client/server calls](https://developers.google.com/apps-script/guides/html/communication),
[concurrency locks](https://developers.google.com/apps-script/reference/lock/lock-service).

For the isolated browser checks (mocked server, including all 225 project pairs,
clock-independent release/deadline transitions, and local Part 1 PDF responses):

```bash
python3 -m http.server 8067 --bind 127.0.0.1
# In another terminal, use a disposable browser profile:
chromium --headless --remote-debugging-port=9267 --user-data-dir=/tmp/eng654-allocation-browser about:blank
# In a third terminal:
node .github/project-allocation/tests/browser.cjs
```
