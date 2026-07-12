---
name: hairness-x-open-frame
description: Open one bounded work frame after a lightweight checkpoint.
---

Invoke with `/hairness-x-open-frame`.
Surface: intent; chat-first.
Route: `hairness work open-frame`.

Fixed: `{"controls":{"persistence":"state-checkpoint"}}`.
Build compact InvocationDraft. Set `draft.result`=`default`. Call `hairness invoke start --operation hairness/work:open-frame --draft-json - --json` before questions. `--auto` advances progress only. Ask returned gaps; else follow `preview.next`.

Keep mission, segment, frame, boundaries and accepted artifacts aligned. Chat-first: `make-*` responds, `save-*` prepares artifacts, `--auto` only advances progress. Dashboards show status, result, links, proof, limits and next. Effects require an explicit checkpoint; the work graph never grants authority.

No authority implied.
