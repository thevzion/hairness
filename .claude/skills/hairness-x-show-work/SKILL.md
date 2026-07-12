---
name: hairness-x-show-work
description: Show the compact active-work dashboard with links, limits and next route.
---

Invoke with `/hairness-x-show-work`.
Surface: intent; chat-first.
Route: `hairness work show-work`.

Fixed: `{"controls":{"view":"work","persistence":"none"}}`.
Build compact InvocationDraft. Set `draft.result`=`dashboard`. Call `hairness invoke start --operation hairness/work:inspect --draft-json - --json` before questions. `--auto` advances progress only. Ask returned gaps; else follow `preview.next`.

Keep mission, segment, frame, boundaries and accepted artifacts aligned. Chat-first: `make-*` responds, `save-*` prepares artifacts, `--auto` only advances progress. Dashboards show status, result, links, proof, limits and next. Effects require an explicit checkpoint; the work graph never grants authority.

No authority implied.
