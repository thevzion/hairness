---
name: hairness-x-show-method
description: Show the active method and how work segments compose.
---

Invoke with `$hairness-x-show-method`.
Surface: intent; chat-first.
Route: `hairness work show-method`.

Fixed: `{"controls":{"view":"method","persistence":"none"}}`.
Build compact InvocationDraft. Set `draft.result`=`dashboard`. Call `hairness invoke start --operation hairness/work:inspect --draft-json - --json` before questions. `--auto` advances progress only. Ask returned gaps; else follow `preview.next`.

Keep mission, segment, frame, boundaries and accepted artifacts aligned. Chat-first: `make-*` responds, `save-*` prepares artifacts, `--auto` only advances progress. Dashboards show status, result, links, proof, limits and next. Effects require an explicit checkpoint; the work graph never grants authority.

No authority implied.
