# hairness/delivery-controls

## Value and use cases

Turns accepted briefs into policy-driven change plans and aggregates merged changes into explicit release plans.

## Selection and setup

Forge-only and dependent on Initiative, Work, Sources and Worktree Controls. The distribution configures repository, branch, merge, check and release policy; Worktree Controls remains the sole owner of checkout placement, handles and writer leases.

## Capabilities and operations

Owns brief drafting/promotion, idempotent change and release plans, next-boundary previews, checkpoints, append-only receipt reconciliation, pull-request proposals and release candidates.

## Inputs, controls and results

An initiative may carry multiple parallel change plans, each with one distinct managed checkout. Delivery stores only the WorktreeHandle reference and policy digest; path, HEAD and writer lease are resolved live before every relevant boundary. Each external effect requires fresh policy/evidence, one stored checkpoint and a correlated typed receipt. Release PR, CI, sync and merge receipts share the exact pull-request head; verification, detached candidate checkout, qualification and the release candidate share the exact public `main` commit.

## State and artifacts

Drafts, plans, receipts, reconciliation checkpoints and reconciliation decisions stay owner-scoped. A partial or unknown receipt is never rewritten: an exact, fresh checkpoint records `accept-deviation`, `retry` or `abort` as a separate decision. Delivery briefs, pull-request proposals and release candidates are typed revisioned artifacts.

## Effects and safety

The handler never stages, commits, pushes, opens or merges a PR, tags, releases or publishes. `--auto` cannot cross effects or apply a reconciliation decision; stale, partial or unknown proof blocks. Native agents act only after exact Run/checkpoint approval. Local tag creation and remote tag push are distinct release stages and grants.

Change delivery follows `prepare → implement → sync-base → qualify → publish-pr → ci → merge → verify-main`. Release delivery follows `collect → prepare → release-pr → ci → sync-base → merge → verify-main → candidate-checkout → qualify → npm-publish → git-tag-create → git-tag-push → github-release`. A later sync invalidates qualification, pull-request proposal and CI evidence tied to the previous HEAD. Published branches require an exact remote HEAD and `force-with-lease`. After `verify-main`, branch and candidate handles become `cleanup-ready`; close remains a separate Worktree checkpoint.

## Providers

Projects `hairness-cmd-want-ship`, `hairness-cmd-ship-it`, `hairness-publish-pr`, `hairness-merge-pr` and `hairness-publish-release` with exact Codex/Claude parity.

## Tests and maturity

Experimental alpha. Tests prove parallel/idempotent plans and distinct handles, generic policy, writer checkout resolution, stale-base resync, HEAD invalidation, diff-bound PR proposals, detached release qualification, cleanup separation, safe auto mode and zero provider effects from handlers.
