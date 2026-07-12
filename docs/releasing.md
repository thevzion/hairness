# Releasing

Release preparation is a separate, explicit operation.

1. Require a clean tree and passing Node 22 and 24 CI.
2. Generate the changelog from Conventional Commits.
3. Inspect the npm tarball and repo-local provider projections.
4. Confirm version, protocol compatibility, license, provenance, and rollback.
5. Publish only after a dedicated external checkpoint.

The pre-alpha package is MIT and public-ready, but publication remains an explicit external checkpoint.

The current private development repository contains historical private composition work. It MUST NOT be made public in place: rewritten commits can remain reachable through pull-request refs and cached views. Public release therefore uses two repositories:

1. Create a checksummed bundle of the private repository.
2. Rename it to `hairness-private-archive` and keep it private.
3. Update every archive clone remote before the old name is reused.
4. Create a new public `thevzion/hairness` from the verified clean root.
5. Publish npm only after public CI and install smokes pass.

Pre-release versions use the npm dist-tag `next`; release preparation MUST NOT publish an alpha as `latest`.

```bash
npm publish --dry-run --access public --tag next
```

The rename, public repository creation, push, tag and npm publish require separate checkpoints.
