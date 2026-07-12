---
name: hairness-x-plan-system-shape
description: Draft a target-shape plan using the reshape-system controls.
---

Invoke with `$hairness-x-plan-system-shape`.
Surface: intent; chat-first.
Route: `hairness work plan-system-shape`.

Modifiers: `--present <auto|compact|visual|explicit|summary|diagram|...>` default `auto`.

Fixed: `{"controls":{"planKind":"system-shape","persistence":"none"}}`.
Build compact InvocationDraft. Set `draft.result`=`response`. Call `hairness invoke start --operation hairness/work:plan --draft-json - --json` before questions. `--auto` advances progress only. Ask returned gaps; else follow `preview.next`.

Keep mission, segment, frame, boundaries and accepted artifacts aligned. Chat-first: `make-*` responds, `save-*` prepares artifacts, `--auto` only advances progress. Dashboards show status, result, links, proof, limits and next. Effects require an explicit checkpoint; the work graph never grants authority.

No authority implied.
