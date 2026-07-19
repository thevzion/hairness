# Releasing 0.4

## Checkpoint 1: merge

Present the final diff, CI, tarball contents, two Home qualifications, GSD
downstream proof and rendered README. Approval authorizes only merging the
Hairness PR into `main`.

## Checkpoint 2: release

Present the exact main commit and `release/manifest.json` with package order,
versions, SHA-256 values and npm integrities. Approval authorizes:

1. npm publication under `next`;
2. tag `v0.4.0-alpha.0`;
3. GitHub prerelease creation.

The workflow packs in this order:

1. `@hairness/native`
2. `@hairness/starter`
3. `@hairness/cli`

If a version already exists, the workflow compares registry integrity with the
qualified artifact. A match is skipped; a mismatch fails. This makes the npm
step resumable without republishing a version.

## Checkpoint 3: communication

Reinstall from npm in an empty Home. Replace proof Home tarballs with exact
registry versions and requalify both. Present the final images and channel text.
Approval authorizes external posts only.

npm publication, Git tag creation, GitHub prerelease creation, Home migration
merges and external posts remain separate effects.
