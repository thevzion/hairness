## Forge maintenance

- Read the documentation index, then only the ADRs relevant to the changed owner or path.
- Read `STATUS.md` before opening new scope and keep its current chantier aligned with Work Controls.
- Change canonical extension or core sources, never generated provider projections directly.
- Run `hairness maintain impact` before a Git checkpoint.
- Run `hairness build --check` after provider command, instruction, extension, or guidance changes.
- Keep README, SPEC, and owner documentation aligned with every public behavior change.
- Physical presence never activates an extension; only the distribution manifest and explicit local configuration do.
- Turn recurring corrections into a durable rule, decision, schema, gate, or test.
