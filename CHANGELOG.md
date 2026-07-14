# Changelog

Hairness uses Conventional Commits as its change ledger. Release preparation
derives this file from accepted commits; ordinary pushes do not add manual
entries.

## Unreleased

### Added

- Added generic Worktree Controls with an anchor-owned controller, central
  workspace/codebase pools, exact checkout handles, writer leases, recovery
  and cleanup attention.
- Added read-only Git worktree, exact-ref and merge-ancestry evidence plus authority-asserted managed Codebase mounts.
- Added a manual, protected npm Trusted Publishing workflow that qualifies Node.js 22 and 24, promotes one exact tarball between jobs and publishes through OIDC without a long-lived npm token.
- Recorded the public npm alpha, exact Git tag, GitHub prerelease and registry digests as durable release evidence.

### Changed

- Isolate each change and release plan in its own managed checkout, synchronize stale bases before qualification and qualify releases from a detached worktree at the exact public commit.
- Dispatch bounded provider-native implementation workers without cockpit history or nested workers, with results fanned back into the owning delivery plan.
- Preserve partial, failed and unknown delivery receipts as immutable evidence and resume only through append-only `accept-deviation`, `retry` or `abort` reconciliation decisions.
- Split local Git tag creation from remote tag push into separate release stages, Runs and checkpoints.
- Preserve pre-commit qualification across the resulting pull-request head while requiring exact PR and CI head agreement at merge.
- Preserve logical workspace or codebase repository references throughout
  Delivery, while resolving paths, remotes and Git common directories live.
- Add proof-backed foreign-controller takeover and opt-in batch cleanup with
  one child receipt per worktree and explicit partial-effect reconciliation.

## 0.2.0-alpha.0 - 2026-07-13

### Changed

- Replaced provider plugins and attachments with tracked repo-local projections.
- Replaced the monolithic work surface with extension-owned Work Controls and separate Understanding and Ideation Controls.
- Consolidated per-CLI source extensions into selected drivers owned by `hairness/sources`.
- Made extension presence inert until selected by the distribution or explicit local configuration.
- Made provider commands submit a typed invocation before asking the user for missing input.
- Separated natural intent mode from direct automation while preserving one canonical request and receipt.
- Replaced sequential forge delivery with policy-driven parallel change plans and aggregated release plans.
- Made authority approval revalidate stored checkpoints, policies, targets and locks before returning an executor capsule.
- Repositioned Hairness as a provider-agnostic harness for agentic systems while keeping Codex and Claude as the initial projections ([#10](https://github.com/thevzion/hairness/pull/10)).
- Completed the release pull-request lifecycle with exact-head CI, squash merge and public `main` verification gates ([#11](https://github.com/thevzion/hairness/pull/11)).
- Preserved bare CLI version reporting while allowing nested release commands to receive their explicit version argument ([#12](https://github.com/thevzion/hairness/pull/12)).

### Added

- Forge and distribution roles, explicit catalogue roots, and selected-only generation.
- Managed Markdown/TOML regions and JSON entries with drift protection.
- Artifact ownership, labels, signals, relations, freshness, filters, and graph queries.
- Constraints, Presentation Controls, operational session opening, provider-independent handoffs, and replayable E2E sandboxes.
- Minimal and standard recipes discovered from explicit forge catalogue roots.
- Evidence-based provider states and behavior evals using native Codex/Claude transports.
- First-class CapabilitySpec, OperationRef and observe/derive/effect route validation.
- Recipe-declared materials, capabilities, source drivers, templates, scripts and tests.
- A deterministic Invocation Engine with append-only events, one-gap resolution, previews, hard gates, receipts and safe `--auto` progression.
- Attention-preserving Codex and Claude command projections with explicit `strict`, `guarded` and `unsupported` host paths.
- Forge-only Initiative and Delivery Controls for local roadmap state, policy-driven change/release plans, release candidates and checkpointed external effects.
- Public alpha documentation, known limitations and a reproducible release runbook.
- Conversational `want-ship`, `ship-it`, PR, merge and release controls with safe preview and non-chainable authority boundaries.
- Typed DeliveryBrief, PullRequestProposal and ReleaseCandidate artifacts with correlated receipts and stale-proof gates.
- Read-only GitHub and npm source drivers plus credential-free URI target locking.
- Native CI enforcement for coherent delivery branches and Conventional pull-request titles.

## 0.1.0-alpha.0

### Added

- Protocol foundation, deterministic core, provider adapters and onboarding.
