# eng-654

The ENG-654 course website is a static site. Preview it from the repository root
with `python3 -m http.server 8000`, then open <http://localhost:8000>.

Deployment is configured in [.github/workflows/pages.yml](.github/workflows/pages.yml).
It uploads the site directly and uses actions that support Node.js 24, including
`upload-pages-artifact@v5`, whose nested uploader replaces `upload-artifact@v4`.

To activate this workflow:

1. In the repository's **Settings → Pages → Build and deployment**, set **Source**
   to **GitHub Actions**. This replaces GitHub's automatic branch-based workflow.
2. Push this workflow to `main`. Subsequent pushes to `main` deploy automatically.
   If it was pushed before changing the Pages setting, open **Actions → Deploy
   site to GitHub Pages → Run workflow** and select `main`.
3. Confirm the deployment succeeds at <https://epfl-lasa.github.io/eng-654/>.

The workflow publishes the repository's non-hidden files, including the lecture
decks and `private/intro_slides/`, which were also included by the previous build.
The upload action excludes hidden files and directories, including `.git` and
`.github`.

In [run 34470233361](https://github.com/epfl-lasa/eng-654/actions/runs/34470233361),
the build and artifact upload succeeded. The Node.js 20 annotation was a warning;
the deployment failed with `Timeout reached, aborting!` after remaining in
`updating_pages` for ten minutes. Updating the action versions removes the Node.js
warning, but does not by itself resolve a GitHub Pages service timeout. If that
timeout recurs, check [GitHub Status](https://www.githubstatus.com/) and rerun the
workflow. If it persists, contact GitHub Support with the failed run URL.
