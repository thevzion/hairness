# hairness/sources

## Value and use cases

Provides current, read-only evidence through selected deterministic source drivers.

## Selection and setup

Standard selects Git. Forge retains the generic Git, Jira, GitLab and AWS driver catalogue.

## Capabilities and operations

Owns list, doctor and read services plus evidence validation, redaction and freshness.

## Inputs, controls and results

Accepts a selected source operation and returns a typed `SourceEvidence` envelope.

## State and artifacts

Source access is volatile proof, not memory. Credentials are never persisted.

## Effects and safety

Bundled drivers are read-only. Provider connectors remain best-effort adapters.

## Providers

Projects `hairness-source` as the namespace guide and `hairness-x-check-sources` as the provider-facing proof intent.

## Tests and maturity

Official alpha. Tests cover selection, driver operations, evidence and redaction boundaries.
