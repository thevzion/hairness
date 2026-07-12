---
id: 0012-agentic-foundation-controls
status: accepted
owners: [hairness/distribution, hairness/work-controls, hairness/understanding-controls, hairness/ideation-controls]
signals: [capability, operation, controls, source-driver]
paths: [schemas/capability.schema.json, extensions/hairness, catalog]
---

# Agentic foundation and composable controls

Hairness defines Capability → Operation → Route → Result as its public executable grammar. Commands reference operations rather than loose capability labels.

Persistent work is owned by Work Controls. Understanding, ideation, presentation, and constraints remain separate extensions so distributions can select the smallest useful cockpit. Concrete sources become drivers of one Sources extension; the kernel has no source IDs.

This replaces the earlier monolithic work and per-CLI extension layout before publication, with no compatibility shim.
