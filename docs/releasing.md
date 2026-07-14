# Releasing

The architectural reset and package publication are separate PRs.

After the reset PR merges:

1. open a release PR for `0.3.0-alpha.0` against the exact merge commit;
2. run Node.js 22/24, tests, check, conformance, provider, package, README, and
   fresh packed-tarball lab gates;
3. approve npm publication as its own checkpoint;
4. reconcile registry integrity with the packed artifact;
5. create the exact Git tag as a separate checkpoint;
6. create the GitHub prerelease as a separate checkpoint.

Do not publish from the architectural reset branch. npm publish, tag, and GitHub
Release are distinct effects and must not inherit authority from one another.
