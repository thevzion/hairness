# Hairness 0.4.0-alpha.0

Hairness 0.4 is a clean reconstruction around one concrete contract: an agent
Home is an npm project that composes versioned packages.

The release contains:

- `@hairness/cli`, the local Kernel;
- `@hairness/native`, the fundamental Hairness Extension;
- `@hairness/starter`, the default personal Home Starter;
- exact npm, Git and local Extension sources;
- optional package Catalogs;
- transactional add, update, remove and rollback;
- controlled Adapter builds with declared output ownership;
- Codex and Claude projections;
- independent Targets and credential-free Integration bindings.

`package-lock.json` is the only dependency lock. `hairness.json` owns
composition. `.hairness/build.json` owns local generated-file digests.

The prerelease is qualified on Node.js 22 and 24, two real personal Homes, a
private team Starter, and a separate GSD Adapter pinned to GSD Core 1.6.1.
Private downstream packages and repository details are not part of the public
release.

This alpha has no in-place migration from the removed 0.3 architecture. Create
a new Home or migrate an existing Home on an isolated branch.
