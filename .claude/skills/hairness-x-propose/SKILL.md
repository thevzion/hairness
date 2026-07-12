---
name: hairness-x-propose
description: Recommend one direction with its tradeoff, risk and confidence.
---

Invoke with `/hairness-x-propose`.
Surface: intent; chat-first.
Route: `hairness propose`.

Modifiers: `--creative <divergent|lateral|convergent>` default `divergent`; `--present <auto|compact|visual|explicit|summary|diagram|...>` default `auto`.

Fixed: `{"controls":{"persistence":"none"}}`.
Build compact InvocationDraft. Set `draft.result`=`default`. Call `hairness invoke start --operation hairness/ideation:propose --draft-json - --json` before questions. `--auto` advances progress only. Ask returned gaps; else follow `preview.next`.

`ideate` opens candidate directions; it does not manufacture decisions. `propose` converges toward one recommendation and names its tradeoff, risk and confidence. Creative mode changes the exploration strategy, never the available proof.

No authority implied.
