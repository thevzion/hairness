# Releasing 0.4

## Checkpoint 1: merge

Present the final diff, CI-equivalent Node 22/24 runs, the single CLI tarball,
official registry validation, two Home qualifications, GSD 1.6.1 proof and the
rendered README. Approval authorizes only merging Hairness into `main`.

## Checkpoint 2: release

Present the exact main commit and `release/manifest.json` containing
`@hairness/cli@0.4.0-alpha.0`, SHA-256 and npm integrity. Approval authorizes:

1. npm publication under `next`;
2. tag `v0.4.0-alpha.0`;
3. GitHub prerelease creation.

If that npm version exists, the workflow compares its integrity with the
qualified artifact. An identical version is skipped; a mismatch stops. Nothing
is republished.

## Checkpoint 3: communication

Create a fresh Home through npm, requalify the two real Homes with the registry
runtime, then present final commands, image and channel copy. Approval authorizes
downstream Home merges and external posts.

These effects remain separate even when their evidence is prepared together.
