---
id: tracked-provenance-safe-updates
status: superseded
owners: [hairness/distribution]
signals: [provenance, update]
paths: [hairness.lock.json, src/distribution/update-engine.mjs]
---

# Tracked provenance and safe updates

Superseded by [ADR 0013](0013-v0-3-clean-architectural-reset.md).

Generated repositories track material base digests. Automatic apply is allowed only for intact consumer material; any divergence requires review. Hairness performs no automatic merge or Git automation.
