# Maintaining Hairness

The repository dogfoods Standard plus the explicit `hairness/maintainer`
extension. Maintainer is not part of either public preset.

Canonical assets live under `assets/extensions/`; provider projections do not.
Read [STATUS](../STATUS.md), [SPEC](../SPEC.md), and the relevant decision before
changing a public owner. Keep contracts, source, projections, examples, and tests
in one commit boundary.

Required local checks:

```bash
npm test
npm run check
npm run conformance
npm run check:providers
npm run check:pack
npm run check:lab
```

Release qualification additionally runs Node.js 22 and 24 and a fresh Home from
the exact packed tarball. Never test a release by importing the source checkout
when the user will receive the tarball.
