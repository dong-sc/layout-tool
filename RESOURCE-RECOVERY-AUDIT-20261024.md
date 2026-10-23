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
