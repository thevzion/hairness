---
name: hairness-x-discuss
description: Discuss one bounded frame without effects or persistence.
---

Invoke with `$hairness-x-discuss`.
Surface: intent; chat-first.
Route: `hairness work discuss`.

Modifiers: `--present <auto|compact|visual|explicit|summary|diagram|...>` default `auto`.

Fixed: `{"controls":{"persistence":"none"}}`.
Build compact InvocationDraft. Set `draft.result`=`default`. Call `hairness invoke start --operation hairness/work:discuss --draft-json - --json` before questions. `--auto` advances progress only. Ask returned gaps; else follow `preview.next`.

Keep mission, segment, frame, boundaries and accepted artifacts aligned. Chat-first: `make-*` responds, `save-*` prepares artifacts, `--auto` only advances progress. Dashboards show status, result, links, proof, limits and next. Effects require an explicit checkpoint; the work graph never grants authority.

No authority implied.
