# hairness/delivery-controls

## Value and use cases

Turns one accepted initiative into a sequential delivery plan, explicit Git checkpoints, receipts and a release candidate.

## Selection and setup

Forge-only and dependent on Initiative and Work Controls.

## Capabilities and operations

Owns delivery plan, status, checkpoint, receipt and release-candidate preparation.

## Inputs, controls and results

Plans bind one initiative to ordered steps. Each external effect requires a fresh checkpoint and typed receipt.

## State and artifacts

Plans and receipts stay owner-scoped. Release candidates are revisioned artifacts and may contain a launch kit.

## Effects and safety

The handler never stages, commits, pushes, opens or merges a PR, tags, releases or publishes. Native agents act only after confirmation.

## Providers

Projects `hairness-ship` in forge compositions.

## Tests and maturity

Experimental alpha. Tests prove sequential steps, checkpoint stability, receipts and zero Git effects from handlers.
