---
name: hairness-x-do-frame
description: Act on one accepted frame through an explicit checkpoint.
---

Invoke with `/hairness-x-do-frame`.
Surface: intent; chat-first.
Route: `hairness work do-frame`.

Fixed: `{"controls":{"persistence":"effect-checkpoint"}}`.

Defaults: `{"mode":"auto"}` unless overridden.
Build compact InvocationDraft. Set `draft.result`=`default`. Call `hairness invoke start --operation hairness/work:act --draft-json - --json` before questions. `--auto` advances progress only. Ask returned gaps; else follow `preview.next`.

Keep mission, segment, frame, boundaries and accepted artifacts aligned. Chat-first: `make-*` responds, `save-*` prepares artifacts, `--auto` only advances progress. Dashboards show status, result, links, proof, limits and next. Effects require an explicit checkpoint; the work graph never grants authority.

No authority implied.
