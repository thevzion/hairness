---
id: 0003-open-code-distributions
status: superseded
owners: [hairness/maintainer]
signals: [forge, distribution]
paths: [src/distribution/create.mjs, catalog]
---

# 0003: Open-code distributions

Superseded by [ADR 0013](0013-v0-3-clean-architectural-reset.md).

Hairness adopts a source-owned distribution model inspired by shadcn/ui. The
CLI copies core and selected extension sources into a standalone repository.
The generated distribution owns its code and records provenance without a
runtime or synchronization dependency on the generator.
