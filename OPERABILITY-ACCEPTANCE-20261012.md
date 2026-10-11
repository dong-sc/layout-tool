# Restore operability and keep steps as instructions — 2026-10-12

Base: production main `2e14f3ead78274d41e03191a81500a82fd4ec56e`. Isolated branch `codex/restore-operability`; no production merge or deployment in this task.

## Requested behavior

The production toolbar presents its actions as one line of text without clear visual hierarchy, and previously visible page controls are hidden in a floating settings panel. Restore the prior direct operation style, retaining the added editing/export capabilities. The five suggested steps should explain the tool, rather than create a separate operating mode.

## Changes

The review branch retains the approved identity/logo/favicon release from PR #11, including its service-worker asset list.

- Restore desktop native page ratio, carousel count/ratio, ordering, margin, gutter, layout scale, no-crop, background, signature, resolution and quality controls to the always-visible header. Restore native PDF/PPTX and all-page shuffle buttons there too.
- Group bordered tools as Photos, Edit, Output/Project and View/Undo. Use a filled primary create action, outlined import, distinct JPEG export, standard secondary buttons and explicit disabled states. Photo pool toggle reports its visible state. Empty zoom labels are removed.
- Remove the five-stage navigation and duplicate stage-specific CTAs. A thin explanation row opens five concise instructions. Review and other formats have stable direct buttons. Help never changes the project or available tools.
- Keep mobile ratio pills and carousel controls visible and wrapped within a narrow viewport; restore its native Settings button. Detailed mobile settings retain the existing sheet.
- Fix mobile fit and preview return to fit the complete selected panel within available height as well as width. Preserve manual zoom, precise dragging and screen-sized handles.
- Preserve original/crop review, confirmation invalidation, skip-review export, locked geometry, multi-format output, undo/redo, local drafts and portable project ZIPs. Update asset URLs to `workspace2`, service worker cache `v13-workspace`; draft storage schema is unchanged.

## Validation

| Check | Result |
| --- | --- |
| Existing IG and shared editor Node regression suites | PASS |
| Native settings visible before import; mobile carousel 1:1 directly reachable | PASS |
| Four functional tool groups; direct review and formats; help has five instructions and preserves project | PASS |
| 201 imported photos, select exactly three; ten repeated shuffles | PASS, desktop and mobile emulation |
| Desktop 1366×768 / 1440×900 portrait, 3/10-panel carousel: readable, accurate dragging | PASS |
| Mobile emulation 390×844, 3/10 panels: full panel inside editing surface, accurate dragging and handle size | PASS |
| Native settings/help preserve view; preview returns to editable controls | PASS |
| Import/replace/insert retains neighbors; undo/redo retains photos and zoom | PASS |
| Crop changes invalidate review; skip-review download | PASS |
| Actual IndexedDB reload/restore and downloaded project ZIP reimport | PASS, desktop/mobile emulation |
| Actual multi-format ZIPs: 108 decoded JPEGs, CRC, dimensions, identities and ordering | PASS |
| Two PDFs, four rendered pages; two parsed PPTXs, four slides, media/geometry/layering vs PDF | PASS |
| Physical iOS/Android touch, native share/force-close, native PowerPoint opening | NOT RUN |
| Production merge/deployment for this correction | NOT RUN; review only |

Drag verification initially exposed the previous width-only mobile fit: the drag start could be above the clipped editing surface. It now fits the whole panel. An export harness failure came from a missing close after replacement; the test now closes the adjustment dialog through the visible UI. These failures were investigated rather than bypassed or weakened.

## Reproduce

Requires Node, Playwright Chromium, Python with PyMuPDF/Pillow/python-pptx. Fixtures are generated in fresh contexts; no private photos or existing user drafts are accessed.

```sh
node tests/ig-regression.cjs
node tests/editor-plus.cjs
python3 -m http.server 8766 --bind 127.0.0.1
LAYOUT_TEST_URL=http://127.0.0.1:8766/ NODE_PATH=/tmp/dong-ux-browser/node_modules node tests/operability-browser.cjs
LAYOUT_TEST_URL=http://127.0.0.1:8766/ NODE_PATH=/tmp/dong-ux-browser/node_modules node tests/ux-browser.cjs
LAYOUT_TEST_URL=http://127.0.0.1:8766/ NODE_PATH=/tmp/dong-ux-browser/node_modules node tests/ux-persistence-browser.cjs
LAYOUT_TEST_URL=http://127.0.0.1:8766/ NODE_PATH=/tmp/dong-ux-browser/node_modules node tests/ux-canvas-browser.cjs
LAYOUT_TEST_URL=http://127.0.0.1:8766/ NODE_PATH=/tmp/dong-ux-browser/node_modules node tests/export-artifacts-browser.cjs
PYTHONPATH=/tmp/dong-export-verify python3 tests/verify-export-artifacts.py
```

Results/screenshots/fixture exports are ignored under `evidence/`; immutable review deliverables and Library confirmations are under ignored `preview-deliverables/`. Concurrent legitimate logo/favicon work must be retained when preparing any later merge; check current main again before release.
