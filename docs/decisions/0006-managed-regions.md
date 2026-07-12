---
id: 0006-managed-regions
status: accepted
owners: [hairness/maintainer]
signals: [generation, ownership, drift]
paths: [hairness.build.json, src/providers/compiler.mjs]
---

# 0006: Managed regions and entries

Generated Markdown and TOML use content-addressed owner regions. Generated JSON uses identified entries recorded by pointer. The build manifest records the last generated digest.

Hairness preserves foreign content and stops with `review-required` when an owned surface was edited or became ambiguous.
