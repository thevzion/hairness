---
name: hairness-explain
description: Explain one concept from available meaning and proof.
---

Invoke with `$hairness-explain`.

Accepted modifiers:
- `--present <auto|compact|visual|explicit|summary|diagram|tree|table|timeline|checklist|matrix|trace>` (default: `auto`)

Infer a compact InvocationDraft from the request and current opening. Before asking a question, call `hairness invoke start --operation hairness/understanding:explain --draft-json - --json`. Add `--auto` only when explicitly requested. Ask only a returned gap; otherwise follow `preview.next` and render the typed result.

# Understanding Controls

Use only the supplied focus and available proof. `map` organizes relationships, `explain` clarifies a concept, and `compare` exposes tradeoffs. Never invent structure, evidence or a decision. Prefer inline work unless a bounded producer materially protects the main-session context.

No authority is implied. Keep checkpoints and worker capsules exact.
