# hairness/delivery-controls

## Value and use cases

Turns accepted briefs into policy-driven change plans and aggregates merged changes into explicit release plans.

## Selection and setup

Forge-only and dependent on Initiative, Work and Sources. The distribution configures repository, branch, merge, check and release policy.

## Capabilities and operations

Owns brief drafting/promotion, idempotent change and release plans, next-boundary previews, checkpoints, receipts, pull-request proposals and release candidates.

## Inputs, controls and results

An initiative may carry multiple parallel change plans. Each external effect requires fresh policy/evidence, one stored checkpoint and a correlated typed receipt.

## State and artifacts

Drafts, plans and receipts stay owner-scoped. Delivery briefs, pull-request proposals and release candidates are typed revisioned artifacts.

## Effects and safety

The handler never stages, commits, pushes, opens or merges a PR, tags, releases or publishes. `--auto` cannot cross effects; stale, partial or unknown proof blocks. Native agents act only after exact Run/checkpoint approval.

## Providers

Projects `hairness-cmd-want-ship`, `hairness-cmd-ship-it`, `hairness-publish-pr`, `hairness-merge-pr` and `hairness-publish-release` with exact Codex/Claude parity.

## Tests and maturity

Experimental alpha. Tests prove parallel/idempotent plans, generic policy, stale gates, diff-bound PR proposals, release aggregation, safe auto mode and zero provider effects from handlers.
