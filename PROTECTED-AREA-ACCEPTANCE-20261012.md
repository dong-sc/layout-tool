# Rectangular protected area — 2026-10-12

Base: main `ae973bfa42c5cce7f77cb7ad55a618f41a614541` (PR #12), retaining PR #11 identity assets. Independent worktree and branch `codex/protected-area`. Review only: this feature is not merged or deployed.

## Confirmed scope

The user requested a reserved area where photos cannot be placed, leaving space for composition or later text. The user confirmed on this turn: “符合，先做矩形保護區”. Direct text editing is outside this first implementation.

## Behavior

- A stable **保護區** button in the Edit tool group opens settings for one rectangle per layout group. Carousel groups can choose which individual panel holds it.
- Position and dimensions are normalized to the selected panel, with a configurable solid background color. Numeric controls and direct canvas drag/resize are available on desktop and mobile.
- Automatic layout splits the usable region into disjoint surrounding rectangles and allocates every photo among them. Repeated shuffling retains the protected rectangle. Candidate plans are retained in the snapshot, so a color-only change preserves photo positions and undo restores the actual layout.
- Free photos move out of the reserved area; where necessary they scale down uniformly. Locked positions must be unlocked before changing the rectangle geometry. Cancelled pointer gestures do not commit a change.
- The solid area is shown in the editing canvas, page thumbnails, previews, single/multiple-format JPEGs, PDF and PPTX. Editor labels, outlines and handles are excluded from output.
- Undo/redo, IndexedDB drafts, downloaded/reimported project ZIPs and reusable layout templates retain the optional rectangle. Legacy projects/templates without this field remain valid. Invalid geometry is rejected.
- At least 20% of the chosen panel remains available for photos. Each side is at least 5% of that panel; numeric inputs reject out-of-bounds geometry. If a carousel is shortened past the selected panel, it displays on the final remaining panel, retaining its normalized coordinates.
- Asset query version `protected1`, service-worker cache `layout-tool-v14-protected`; existing logo/favicon assets retained. No backend, cloud storage, private-photo access or user draft changes.

## Validation

| Check | Result |
|---|---|
| Existing Node IG/shared-editor suites and full-client smoke initialization | PASS |
| Protected automatic geometry at 1/3/10 panels and 1:1/4:5/9:16 ratios, all 30 photos present | PASS, desktop/mobile engines |
| Ten consecutive shuffles; protected area remains unchanged and no photo intersects it | PASS |
| Color-only change preserves photo positions; invalid inputs/locked geometry rejected | PASS |
| Actual visible UI adds/edits/removes area; scaled drag/resize and undo/redo | PASS, desktop and mobile emulation |
| Free-photo drag into the reserved area is constrained | PASS |
| Actual IndexedDB reload + restore, and downloaded project ZIP + reimport | PASS, desktop/mobile emulation |
| Original-file project data and optional rectangle validation; template preservation | PASS |
| Exact preview pixels; actual JPEG decoding, rendered PDF, parsed PPTX full-page overlay | PASS: sampled blank-region grid is the intended solid color, no editor markings |
| Native settings/tool groups/help, portrait canvas, 3/10-panel accurate drag | PASS, 1366×768, 1440×900, mobile emulation 390×844 |
| Existing 201-photo select-only-three, repeated shuffles, preview return, replacement/insert, reviews and draft/project regressions | PASS |
| Existing export suite: 108 decoded JPEGs, 4 rendered PDF pages and 4 parsed PPTX slides with ordering/geometry consistency | PASS |
| Physical iOS/Android gestures, native share, native PowerPoint opening | NOT RUN |
| New feature merge/deployment | NOT RUN; review only |

The browser harness initially found a missing explicit accessible name on the carousel-panel select; this was corrected in the UI. Adding accurate page thumbnails then required scoping drag-test locators to the main canvas. Geometry and output assertions were retained.

## Reproduce

Use fresh browser contexts and generated fixtures. No existing photos, projects, Opera tabs or personal drafts are read.

```sh
node tests/ig-regression.cjs
node tests/editor-plus.cjs
python3 -m http.server 8767 --bind 127.0.0.1
NODE_PATH=/tmp/dong-ux-browser/node_modules node tests/protected-area-browser.cjs
PYTHONPATH=/tmp/dong-export-verify python3 tests/verify-protected-exports.py
LAYOUT_TEST_URL=http://127.0.0.1:8767/ NODE_PATH=/tmp/dong-ux-browser/node_modules node tests/operability-browser.cjs
LAYOUT_TEST_URL=http://127.0.0.1:8767/ NODE_PATH=/tmp/dong-ux-browser/node_modules node tests/ux-canvas-browser.cjs
LAYOUT_TEST_URL=http://127.0.0.1:8767/ NODE_PATH=/tmp/dong-ux-browser/node_modules node tests/ux-browser.cjs
LAYOUT_TEST_URL=http://127.0.0.1:8767/ NODE_PATH=/tmp/dong-ux-browser/node_modules node tests/ux-persistence-browser.cjs
LAYOUT_TEST_URL=http://127.0.0.1:8767/ NODE_PATH=/tmp/dong-ux-browser/node_modules node tests/export-artifacts-browser.cjs
PYTHONPATH=/tmp/dong-export-verify python3 tests/verify-export-artifacts.py
```

Screenshots and actual fixture exports are ignored under `evidence/`. Review deliverables and Library identity records are ignored under `preview-deliverables/`. Recheck latest main before any later approved release.
