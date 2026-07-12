# Maintaining Hairness

Use Conventional Commits and keep each commit owned by one subsystem. Run the
impact gate before claiming a change complete; update contracts, tests,
provider projections, packaging, or documentation when the gate requires it.
CI fetches full history and validates the non-merge commits introduced by each
pull request rather than GitHub's synthetic merge commit.

Change canonical extension sources, never generated projections. Managed regions protect human content while making ownership inspectable.

Before any private-distribution cutover, materialize a standalone preview under
`.overlay/scratch/distributions/<id>/<run-id>` and run its manifests, tests,
protocol conformance, and provider parity checks. A preview performs no provider
installation, remote write, or legacy overlay import.

```bash
npm run check
npm test
npm run conformance
npm run check:pack
hairness build --check
hairness maintain test run forge-smoke
```

Shared provider projections and `hairness.build.json` belong in Git. Local-only projections and all `.overlay/` state do not.
