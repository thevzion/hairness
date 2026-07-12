---
id: tracked-provenance-safe-updates
status: accepted
owners: [hairness/distribution]
signals: [provenance, update]
paths: [hairness.lock.json, src/distribution/update-engine.mjs]
---

# Tracked provenance and safe updates

Generated repositories track material base digests. Automatic apply is allowed only for intact consumer material; any divergence requires review. Hairness performs no automatic merge or Git automation.
