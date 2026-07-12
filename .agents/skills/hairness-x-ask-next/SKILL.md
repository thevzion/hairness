---
name: hairness-x-ask-next
description: Ask the one next question that unblocks the active work.
---

Invoke with `$hairness-x-ask-next`.
Surface: intent; chat-first.
Route: `hairness work ask-next`.

Fixed: `{"controls":{"view":"question","persistence":"none"}}`.
Build compact InvocationDraft. Set `draft.result`=`dashboard`. Call `hairness invoke start --operation hairness/work:inspect --draft-json - --json` before questions. `--auto` advances progress only. Ask returned gaps; else follow `preview.next`.

Keep mission, segment, frame, boundaries and accepted artifacts aligned. Chat-first: `make-*` responds, `save-*` prepares artifacts, `--auto` only advances progress. Dashboards show status, result, links, proof, limits and next. Effects require an explicit checkpoint; the work graph never grants authority.

No authority implied.
