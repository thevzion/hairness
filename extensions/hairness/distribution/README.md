# hairness/distribution

## Value and use cases

Creates standalone source-owned distributions and plans conservative upstream updates.

## Selection and setup

Selected by every recipe. Provenance and selected materials are pinned in `hairness.lock.json`.

## Capabilities and operations

Owns distribution inspection, update checks, plans and typed update receipts.

## Inputs, controls and results

Updates accept an explicit source and scope and return a plan before any file mutation.

## State and artifacts

The lock is canonical provenance. Update plans and receipts are typed artifacts.

## Effects and safety

Diverged consumer source returns `review-required`. The extension never automates Git or publication.

## Providers

No standalone provider command is projected in the alpha surface. Update and creation remain available through deterministic CLI routes.

## Tests and maturity

Official alpha. Tests cover payload boundaries, safe updates and divergence refusal.
