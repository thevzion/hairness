# hairness/distribution

## Value and use cases

Creates standalone source-owned distributions and plans conservative upstream updates and local state migrations.

## Selection and setup

Selected by every recipe. Provenance and selected materials are pinned in `hairness.lock.json`.

## Capabilities and operations

Owns distribution inspection, update and migration status, plans and typed receipts.

## Inputs, controls and results

Updates accept an explicit source and scope. Migrations declare source/target versions, scopes, structured transforms and validations. Both return a plan before mutation.

## State and artifacts

The lock is canonical provenance and records applied migration digests. Plans, candidates and receipts remain local.

## Effects and safety

Diverged consumer source and local extension ownership return `review-required`. Candidate transforms run in scratch; apply requires an exact checkpoint. The extension never automates Git or publication.

## Providers

No standalone provider command is projected in the alpha surface. Update and creation remain available through deterministic CLI routes.

## Tests and maturity

Official alpha. Tests cover payload boundaries, safe updates, migration idempotence and divergence refusal.
