# Contributing

Use Node.js 22 or newer.

```bash
npm install
npm run check
npm test
npm run conformance
npm run check:providers
npm run check:pack
hairness maintain test run forge-smoke
hairness maintain status --json
```

Keep public behavior aligned across README, SPEC, CLI, provider projections, and tests. Add protocol infrastructure to the core, provider syntax to the compiler, and capability behavior to extensions. Do not add compatibility layers for the archived harness.

Change extension-owned capabilities and command sources instead of generated skills. Keep `STATUS.md` aligned with the active Work Controls segment. Run `hairness build --check` and `hairness maintain impact` before a Git checkpoint. Never commit `.overlay/` or sensitive data.

## Extension contributions

Start from a repeated user need and state the human command, operations, inputs, sources, results, effects and proof. Prototype locally first. A PR under `extensions/hairness/` transfers long-term maintenance to the Hairness project and therefore requires an accepted proposal, a complete extension README and behavioral tests.

Community extensions should remain in their publisher repository. Hairness may later index an immutable release and digest without taking ownership. Use the issue forms for extension proposals, protocol RFCs, provider bugs and documentation gaps.

Maturity is explicit: `experimental`, `community`, `verified` or `official`. Verification never implies trust or authority.
