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
