---
id: 0004-self-hosted-forge
status: superseded
owners: [hairness/maintainer]
signals: [forge, catalogue, self-hosting]
paths: [hairness.json, extensions, catalog]
---

# 0004: Self-hosted forge

Superseded by [ADR 0013](0013-v0-3-clean-architectural-reset.md).

The Hairness repository is a forge: it develops the full catalogue but activates only the standard maintainer composition declared in `hairness.json`.

Generated distributions copy selected extensions and contain no dormant catalogue. Physical presence never activates code.
