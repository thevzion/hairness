---
name: hairness-x-show-structure
description: Show the relationships needed to understand one focus.
---

Invoke with `/hairness-x-show-structure`.
Surface: intent; chat-first.
Route: `hairness map`.

Modifiers: `--present <auto|compact|visual|explicit|summary|diagram|...>` default `auto`.

Fixed: `{"controls":{"persistence":"none","view":"structure"}}`.
Build compact InvocationDraft. Set `draft.result`=`default`. Call `hairness invoke start --operation hairness/understanding:map --draft-json - --json` before questions. `--auto` advances progress only. Ask returned gaps; else follow `preview.next`.

Use only the supplied focus and available proof. `map` organizes relationships, `explain` clarifies a concept, and `compare` exposes tradeoffs. Never invent structure, evidence or a decision. Prefer inline work unless a bounded producer materially protects the main-session context.

No authority implied.
