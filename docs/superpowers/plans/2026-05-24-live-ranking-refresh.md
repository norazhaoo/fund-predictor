# Live Ranking Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the mobile GitHub Pages app refresh all watched funds in the browser and only re-sort the ranking after the full batch completes.

**Architecture:** Keep GitHub Pages as the only deployment target. Move the watched fund list to `data/funds.json` so both Node and the browser can read it, add browser-safe JSONP quote fetching, and keep the current committed `latest.json` as the immediate fallback snapshot.

**Tech Stack:** Static HTML/CSS/JavaScript, Node test runner, GitHub Pages, Tiantian Fund JSONP quote endpoint.

---

### Task 1: Shared Fund Catalog

**Files:**
- Create: `data/funds.json`
- Modify: `scripts/funds.mjs`
- Modify: `tests/funds.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
import { readFile } from 'node:fs/promises';

test('fund catalog is stored as shared browser-readable JSON', async () => {
  const json = JSON.parse(await readFile('data/funds.json', 'utf8'));
  assert.deepEqual(json.funds.map((fund) => fund.code), ['019633', '016874', '020744', '015903']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL because `data/funds.json` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

Create `data/funds.json` with the four current funds, then load it from `scripts/funds.mjs`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

### Task 2: Browser Batch Ranking Logic

**Files:**
- Create: `assets/live-quotes.js`
- Modify: `tests/static-smoke.test.mjs`

- [ ] **Step 1: Write failing tests**

Add tests that import pure helpers from `assets/live-quotes.js` and verify:
- successful funds sort by `predictedChangePct` descending;
- failed funds sort after successful funds;
- partial batch progress does not produce a sorted replacement list.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL because `assets/live-quotes.js` does not exist.

- [ ] **Step 3: Write minimal implementation**

Implement pure helpers for quote normalization, prediction, final ranking sort, and batch progress state.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

### Task 3: Mobile UI Controls

**Files:**
- Modify: `assets/app.js`
- Modify: `assets/app.css`
- Modify: `tests/static-smoke.test.mjs`

- [ ] **Step 1: Write failing tests**

Add static tests asserting that the app loads `data/funds.json`, exposes sort controls, and shows full-refresh progress text.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL before `assets/app.js` is wired.

- [ ] **Step 3: Write minimal implementation**

Wire `boot()` to load `latest.json`, `history.json`, and `funds.json`; render search/sort controls; start a full batch refresh; show progress; only replace the ranked fund list after all attempts finish.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

### Task 4: Deploy Artifact

**Files:**
- Modify: `.github/workflows/deploy-pages.yml`
- Modify: `.github/workflows/update-fund-data.yml`

- [ ] **Step 1: Write failing static test**

Add a test that workflow files deploy `data/funds.json` via `cp -R assets data _site/`.

- [ ] **Step 2: Run test to verify it passes**

Run: `npm test`
Expected: PASS because `data` is already deployed.

- [ ] **Step 3: Verify locally and push**

Run: `npm test`, serve locally, inspect mobile viewport, commit, push `master`, and confirm GitHub Actions succeeds.
