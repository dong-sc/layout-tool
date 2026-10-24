# Photo resource and interrupted-operation recovery

Baseline: GitHub `dong-sc/layout-tool` main `a1c4a7dc3e0888136567d238365df0d57e149cc6` (fetched 2026-10-24). The original local checkout was clean at `d0f75ba` and was left unchanged. Existing October draft persistence, multi-ratio output, tile-based JPEG export and decode fallback URL cleanup were confirmed on current main and were not reimplemented.

## Changes

- Desktop and mobile photo imports close decoded bitmaps even if canvas drawing fails, reject null preview encoding, clear temporary preview canvas backing stores, and revoke preview URLs if image decode fails.
- Crop failures close the original bitmap and clear the failed canvas.
- Draft/project asset restoration stages preview resources; any failure releases all staged URLs, including previews from earlier photos in the batch. Existing project state is still replaced only after asset import completes.
- Base PDF/PPTX/JPEG export rejects duplicate concurrent calls and calls while photo import is active. Completion, encoding failures, and canceled mobile sharing release the export lock through `finally`.

## Measured before / after

Synthetic Node VM resource instrumentation, not browser RSS or heap profiling. Test bitmap dimensions were 6000×4000 and preview canvas 1500×1000.

| Failure path | Before | After |
| --- | --- | --- |
| Preview image decode rejection, each client | 1 live preview URL, 1,500,000 uncleared canvas pixels | 0 URLs, 0 canvas pixels |
| Preview draw rejection, each client | 1 unclosed bitmap, 1,500,000 uncleared canvas pixels | 0 unclosed bitmaps, 0 canvas pixels |
| Draft restore: second photo fails | 1 staged URL left active | 0 staged URLs |
| Two concurrent base JPEG exports | 2 export/download executions | 1 export/download execution; a later request works |

With `LAYOUT_TEST_ROOT` pointing to files extracted from baseline, the baseline failed the new resource test at `index.html image: preview URLs leaked` (actual 1, expected 0). Baseline measurements were made from `git show a1c4a7d:<file>`, not user photos. Full resource counters are available locally in `evidence/resource-recovery-metrics.json` (ignored by the repository).

## Executed validation

- `node tests/resource-recovery.cjs`: both clients; failed preview image decode, null encoding, failed drawing, crop failure, successful preview ownership; draft restore failure on second source, image decode, encoding, and drawing.
- `node tests/ig-regression.cjs`: both clients; 2–20 panel distribution, output dimensions/order/seams, concurrent export exclusion, retry after encoding failure, null encoding rejection.
- `node tests/editor-plus.cjs`: both clients; protected areas, locks, geometry/aspect ratio, undo/redo, original-file drafts, templates, project validation, compact UI initialization.
- `git diff --check`.

No package/build step exists in this static repository. These use DOM/canvas/IndexedDB mocks; browser pixel output, browser memory pressure, mobile device sharing, actual PDF/PPTX opening and interrupted IndexedDB writes were not rerun. No deployments, pushes, notifications, remote data changes, or real customer images were involved.

## Recovery

Changes are isolated on `audit/layout-recovery-memory`. Before integrating, discard this isolated checkout to abandon the work; after integration, revert its single commit. No browser database migrations or persisted schema changes were added.

## Follow-up: bounded IndexedDB recovery and read-only PR checks

The existing `openDB` had no blocked handler or deadline; a blocked or silent open kept `saveChain` pending, so later saves could not proceed. A transaction with no completion/error/abort callback had the same issue.

- Blocked opens now reject immediately. Silent opens reject at 15 seconds. A late upgrade is aborted, and a connection delivered after rejection is closed. Successful connections close on `versionchange` to avoid blocking another tab's upgrade.
- Silent transactions reject at 30 seconds, attempt an abort, and close their connection. Completion, error, abort, and synchronous setup failure clear the deadline.
- Existing save failure guidance becomes reachable and leaves `draftPending` true. A later save can proceed through `saveChain` and clear the pending state after success.
- `tests/indexeddb-recovery.cjs` uses a deterministic fake clock and synthetic requests; no real browser storage or customer files are accessed. Against original main, it fails with `blocked open must settle: actual pending, expected rejected`; patched code passes all cases, including a successful save after a stalled write.
- `.github/workflows/offline-tests.yml` runs on PRs/manual dispatch, grants only `contents: read`, uses Node 24 with no dependency install, and executes shared syntax plus all four regression scripts. It has no deployment, credentials, notifications, remote data access, or write permissions. Existing deployment health is not assessed or changed by this workflow.

Additional executed commands: `node --check editor-plus.js`, `node tests/indexeddb-recovery.cjs`; all three prior regression scripts and `git diff --check` rerun successfully. Workflow commands were executed locally; GitHub Actions execution is pending because this branch was not pushed. Real multi-tab blocked IndexedDB, mobile background suspension, and large-photo write latency remain untested in a browser. Deadlines provide a recoverable error instead of an indefinite saving state; slower writes may require retrying or downloading a project backup.
