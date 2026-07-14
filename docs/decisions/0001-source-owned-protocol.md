---
id: 0001-source-owned-protocol
status: superseded
owners: [hairness/maintainer]
signals: [protocol, distribution]
paths: [SPEC.md, src/distribution]
---

# 0001: Source-owned protocol

Superseded by [ADR 0013](0013-v0-3-clean-architectural-reset.md).

Hairness is a protocol and reference implementation designed to be cloned and modified. A clone owns its code and history. Compatibility is declared through the protocol version, not a required upstream dependency.

Private team distributions start from a one-time seed with fresh history and independent ownership.
