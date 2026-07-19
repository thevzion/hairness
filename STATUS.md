# Hairness status

Target: `0.4.0-alpha.0`

## Implemented

- clean branch from `origin/main` without history rewrite;
- `@hairness/cli`, `@hairness/native` and `@hairness/starter`;
- Home v1alpha3 with `package-lock.json` as the only dependency lock;
- exact npm, Git and local package sources;
- transactional Extension and Catalog lifecycle;
- static Extension assets and approved Adapter builds with path ownership;
- Codex and Claude projections, Targets, Integrations, doctor and prologue;
- official GSD Adapter package pinned to `@opengsd/gsd-core@1.6.1`;
- private downstream team Extension and Starter proof;
- two real Homes qualified from candidate tarballs.

## Current gate

Checkpoint 1 is the next effect boundary. It requires the final diff, full CI
matrix, tarball contents, both Home qualifications, downstream GSD proof and
rendered README.

No merge, npm publication, tag, GitHub prerelease or external communication is
authorized before its matching checkpoint.

## Deferred

- web marketplace;
- friend-specific Homes;
- public downstream team packages;
- complete downstream ticket loop;
- Product Hunt and marketing site;
- broader brand system.
