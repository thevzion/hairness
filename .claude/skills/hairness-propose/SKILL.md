---
name: hairness-propose
description: Recommend one direction with its tradeoff, risk and confidence.
---

Invoke with `/hairness-propose`.

Accepted modifiers:
- `--creative <divergent|lateral|convergent>` (default: `divergent`)
- `--present <auto|compact|visual|explicit|summary|diagram|tree|table|timeline|checklist|matrix|trace>` (default: `auto`)

Infer a compact InvocationDraft from the request and current opening. Before asking a question, call `hairness invoke start --operation hairness/ideation:propose --draft-json - --json`. Add `--auto` only when explicitly requested. Ask only a returned gap; otherwise follow `preview.next` and render the typed result.

# Ideation Controls

`ideate` opens candidate directions; it does not manufacture decisions. `propose` converges toward one recommendation and names its tradeoff, risk and confidence. Creative mode changes the exploration strategy, never the available proof.

No authority is implied. Keep checkpoints and worker capsules exact.
