# Contributing

Read [STATUS.md](STATUS.md), [SPEC.md](SPEC.md), and the relevant decision before
changing public behavior.

Change canonical source under `src/`, `schemas/` or `packages/`. Generated
provider outputs are test evidence, not source.

Keep the README, specification, schemas, CLI and tests aligned. Add a durable
test for every recurring correction.

```bash
npm ci --ignore-scripts
npm test
npm run check
npm run conformance
npm run check:providers
npm run check:pack
npm run check:lab
```

Use Conventional Commits. Keep changes focused. New dependencies, executable
Adapters and public contract changes require a concrete consumer and an
accepted decision.
