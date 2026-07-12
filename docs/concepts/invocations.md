# Invocations

An invocation is the traceable operational unit between human intent and a typed Hairness result.

```text
Intent → InvocationDraft → deterministic resolution → InvocationPreview
       → route → ResultGate → InvocationReceipt
```

Intent mode lets the provider model propose a semantic draft. Direct mode accepts an already structured request. Hairness contains no model: both paths validate against the same active Operation and persist the same event types.

Missing flags are not automatically missing information. Explicit inputs win, followed by the model draft, inherited preferences and controls, and trusted extension resolvers. Hairness asks one focused question only when a required field remains absent or ambiguous.

Without `--auto`, a resolved invocation stops at a compact preview. `--auto` removes only that soft confirmation. Trust, ambiguity, budget, authority, target expansion, result validation, publication and partial effects remain hard gates.

Events and receipts live under `.overlay/invocations/<id>/`. They contain operation, resolution, route, limits and result references, never transcripts or internal reasoning.
