# Changelog

Hairness uses Conventional Commits as its change ledger. Release preparation
derives this file from accepted commits; ordinary pushes do not add manual
entries.

## Unreleased

### Changed

- Replaced provider plugins and attachments with tracked repo-local projections.
- Replaced the monolithic work surface with extension-owned Work Controls and separate Understanding and Ideation Controls.
- Consolidated per-CLI source extensions into selected drivers owned by `hairness/sources`.
- Made extension presence inert until selected by the distribution or explicit local configuration.
- Made provider commands submit a typed invocation before asking the user for missing input.
- Separated natural intent mode from direct automation while preserving one canonical request and receipt.

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
- Forge-only Initiative and Delivery Controls for local roadmap state, sequential delivery plans, release candidates and checkpointed external effects.
- Public alpha documentation, known limitations and a reproducible release runbook.

## 0.1.0-alpha.0

### Added

- Protocol foundation, deterministic core, provider adapters and onboarding.
