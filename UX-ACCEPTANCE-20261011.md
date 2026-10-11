# Canvas-first guided editing — acceptance record

Scope: isolated `codex/canvas-first-ux` worktree, based on main `8e38fa6cc1ded82aecda13a5980d2a98b6422d14`. Main rechecked on 2026-10-11; no open PRs existed when work began. No merge or production deployment is part of this change. No private photographs or existing projects were accessed. All browser fixtures are generated JPEG files in fresh browser contexts.

## Retained advantages and changes

- Keep five suggested stages, contextual explanations, crop/original comparison, focal anchors, confirmation invalidation, optional review, multiple output ratios, undo/redo, local drafts, portable project ZIPs and leave reminders.
- Core tools remain available in every stage: import, create a selected-photo page, photo pool toggle, format/carousel controls, shuffle, photo adjustments, preview, settings, fit, zoom, save and download. Empty-state actions explain missing prerequisites; format controls remain usable before import. The workflow never disables navigation.
- Compact stage guidance, optional explanations and floating desktop settings reserve height for the canvas. Ordinary page shuffle and free editing stay outside per-group advanced settings. Global shuffle remains under More. Per-group settings retain their open state across normal rerenders.
- Desktop fit uses one carousel panel, allows horizontal scrolling, and synchronizes the displayed percentage with the actual 820px-based width. Manual zoom keeps fit disabled across edits. Mobile fit magnifies one panel, supports long-carousel zoom, avoids forced low-resolution compositing, and keeps resize handles at 24 screen pixels. Undo/redo retain the current view.
- Replace from the unused pool without moving any existing slots; converts automatic geometry into free geometry, resets replacement crop/focus/review state, and supports undo/redo. Insertion into a desktop free layout creates a visible slot without repositioning neighbors.
- Desktop snapping now uses six screen pixels instead of 1.2% of the full carousel width. The old rule caused excessive snapping on ten-panel canvases.
- Increment service worker/cache-busted shared assets for this version; no backend or paid dependency added.

## Baseline risks reproduced

On the unchanged main client, import 201, deselect all, manually select three, then use the upper CTA. It still says “選取未使用照片” and selects 201 instead of building three. Preview return from stage four leaves `data-lp-step=4` and free editing hidden. Both behaviors are corrected in the new client and tested in Chromium.

## Validation

| Criterion | Result |
| --- | --- |
| Empty desktop/mobile choose carousel and 1:1 before import | PASS, real Chromium |
| 201 imported, manually select 3, upper CTA creates exactly 3 | PASS, desktop and mobile |
| Ten consecutive shuffles without opening advanced settings | PASS, desktop and mobile |
| Import/replace during layout, preserve stage, zoom, replacement slot and every neighboring slot | PASS, desktop and mobile |
| Desktop free-layout insertion creates a visible slot, without moving neighbors | PASS, actual engine and Chromium render |
| Undo/redo retains imported references and zoom | PASS, desktop and mobile |
| 1366×768 and 1440×900, 3/10 panels: panel width ≥250px and height ≥300px, accurate drag within snapping tolerance | PASS, Chromium |
| 390×844, 3/10 panels: readable panel and accurate drag; resize handle remains ≤26px | PASS, Chromium narrow viewport; not physical-device testing |
| 9:16 fit, settings expanded without changing canvas size; manual zoom and scroll retained | PASS, Chromium |
| Per-group crop controls stay expanded after a normal rerender | PASS, actual Chromium interaction |
| Preview return exposes immediate editing | PASS, desktop and mobile |
| Crop change invalidates affected confirmation | PASS, desktop and mobile |
| Skip review and actually download output | PASS, desktop and mobile |
| Actual IndexedDB save/reload/restore preserves complete project snapshot | PASS, desktop and mobile |
| Actual project ZIP download/reimport preserves complete project snapshot | PASS, desktop and mobile |
| Existing IG distribution, seams, JPEG dimensions and encoder errors | PASS, `tests/ig-regression.cjs` |
| Existing focal geometry, locks, history, templates, multiple formats without mutating current work | PASS, `tests/editor-plus.cjs` |
| iOS/Android physical pinch, force-close, native share, offline CDN availability | NOT RUN |
| Real multiformat ZIP downloads and decoded JPEG content | PASS, desktop and mobile; 108 actual JPEG files verified |
| PDF parsing, page sizes, picture placement and rendered output | PASS, automatic and free/cross-page cases, 4 pages total |
| PPTX OPC integrity, parser open, slide count, media, geometry and picture layers | PASS, 4 slides total; native PowerPoint opening remains PENDING (Mac locked) |
| Production deployment | NOT RUN, not authorized |

No unresolved automated test failure. Native browser-owned leaving prompts and mobile forced termination retain their existing limitations. Removing the mobile compositing hint improves tested clarity; physical-device gesture smoothness still needs review.

## Reproduce tests and preview

Existing suites: `node tests/ig-regression.cjs` and `node tests/editor-plus.cjs`.

For browser tests, install Playwright into a temporary dependency directory and install Chromium. Serve this checkout with `python3 -m http.server 8765`, then run the following using a `NODE_PATH` pointing to that temporary directory's `node_modules`:

- `node tests/ux-browser.cjs`
- `node tests/ux-persistence-browser.cjs`
- `node tests/ux-canvas-browser.cjs`

Screenshots/results/synthetic project ZIPs are written under ignored `evidence/`. Library stores desktop/mobile review screenshots; confirmed file IDs are supplied in the task handoff. The local preview is a development server, not a published production preview.

## 2026-10-11 additional actual-output verification

`tests/export-artifacts-browser.cjs` drives the actual shared UI: chooses all four output ratios, visits and confirms all 24 size previews, downloads the ZIP, and asserts that export does not change the project snapshot. It covers desktop and mobile, two groups of three carousel panels, and both automatic layout and slot-preserving replacement/cross-page/focal-crop editing. It also downloads current-format ZIPs and automatic/free desktop PDF/PPTX files through More. All photos are seven uniquely colored and labeled synthetic JPEG fixtures.

`tests/verify-export-artifacts.py` reads the downloaded bytes. Six ZIPs pass CRC and exact filename checks. All 108 JPEGs decode, have the required 1080x1440, 1080x1350, 1080x1080 or 1080x1920 dimensions, and match the expected fixture identity/order. Identity stamps remain visible across each rendered photograph, including a photo spanning two panels. Four multiformat archives contain 24 JPEGs each; the two current-format archives contain six each.

Two PDFs open without repair, each with two 324x135mm pages. The actual rendered image rectangles match the project's cells and all four PDF pages were visually inspected. Two PPTX packages pass ZIP/OPC parsing and load through python-pptx, each with two 324x135mm slides and three image objects per slide. Embedded pictures, positions, dimensions and layer order match the project, including the intentional overlap from the replaced photo spanning two panels. An OOXML picture compositor reconstructs all four slides from the actual embedded media/coordinates; its rendered output matches the PDF with mean RGB pixel differences of 0.0998–0.2347 on a 0–255 scale. This is structural/derived-render evidence, not a claim of native PowerPoint rendering.

Native PowerPoint opening is PENDING: the computer-use tool reported the Mac locked and automatic unlock unsuccessful. No alternate native-UI automation or lock bypass was attempted. This does not block independent headless exports and artifact parsing. Physical iOS/Android gestures, native share/force-close, and offline CDN behavior remain unverified. No application bug was found in these export cases.

Reproduce with Playwright/Chromium as above, then `node tests/export-artifacts-browser.cjs` and `PYTHONPATH=<temporary validation dependencies> python3 tests/verify-export-artifacts.py`. Validation dependencies are pymupdf, Pillow and python-pptx, installed only in a temporary directory. Actual products and detailed machine-readable evidence are under ignored `evidence/exports/`; a single deliverable archive contains the files and verification results.
