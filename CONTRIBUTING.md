# Contributing

Hairness values small contracts, direct recipes, and evidence-backed behavior.

1. Read [STATUS.md](STATUS.md), [SPEC.md](SPEC.md), and only the relevant ADR.
2. Change canonical runtime or `assets/extensions/` source, never generated
   `.agents/skills/` or `.claude/skills/` output.
3. Keep public behavior, schemas, README examples, and tests aligned.
4. Add a durable test for every recurring correction.
5. Run the full local matrix:

```bash
npm install
npm test
npm run check
npm run conformance
npm run check:providers
npm run check:pack
```

Use Conventional Commits. Keep PRs coherent around one outcome. Do not add
compatibility shims, dependencies, provider abstractions, persistence, or effect
authority without an accepted contract and concrete use case.

Extensions should begin as the smallest useful shape—often `extension.json` and
one Markdown recipe. Add an adapter only when deterministic reads or real effects
are necessary. Security reports follow [SECURITY.md](SECURITY.md).
