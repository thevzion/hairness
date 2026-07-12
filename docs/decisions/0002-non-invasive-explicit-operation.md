---
id: 0002-non-invasive-explicit-operation
status: accepted
owners: [hairness/constraints]
signals: [authority, integration]
paths: [src/core/authority.mjs, extensions/hairness/constraints]
---

# 0002: Non-invasive integration, explicit operation

Hairness does not capture codebases, providers, Git workflows, runtimes, or team conventions. Integrations are explicit and removable.

Operational intentions may mutate real targets after authority is granted. Access never implies authority.
