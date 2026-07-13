# Invocations

An invocation is the traceable operational unit between human intent and a typed Hairness result.

```text
Intent → InvocationDraft → deterministic resolution → InvocationPreview
       → route → ResultGate → InvocationReceipt
```

Intent mode lets the provider model propose a semantic draft. Direct mode accepts an already structured request. Hairness contains no model: both paths validate against the same active Operation and persist the same event types.

Missing flags are not automatically missing information. Explicit inputs win, followed by the model draft, inherited preferences and controls, and trusted extension resolvers. Hairness asks one focused question only when a required field remains absent or ambiguous.

Without `--auto`, a resolved invocation stops at a compact preview. `--auto` removes only that soft confirmation. Trust, ambiguity, budget, authority, target expansion, result validation, publication and partial effects remain hard gates.

Events, immutable semantic results and receipts live under
`.overlay/invocations/<id>/`. Events and receipts contain references and
digests; `result.json` contains the validated semantic payload. None stores a
transcript, internal reasoning, or raw provider response.

Every post-epoch Run has one Invocation root. Runs created by a ContextPlan
inherit the plan root; worker `inspect`, `source`, `effect`, `submit` and `fail`
actions append RunEvents instead of opening more Invocations. Nested workers
are forbidden. A required split returns `needs-split` to the parent.

Interrupted Invocations remain open until `invoke complete`, `invoke block`, or
`invoke cancel`. A rejected result is correctable; an accepted result is
immutable. `invoke list` and `invoke show` expose reconciliation without
inferring a result from an interrupted provider session.

Provider projections keep this path short: infer a draft, call Hairness first, ask only a returned gap, and render the typed result. The build rejects capability command instructions above 1 KiB and router instructions above 2 KiB. `hairness maintain metrics` derives resolution latency, resolver reuse, gap counts, instruction bytes and ResultGate first-pass counts from canonical local state.
