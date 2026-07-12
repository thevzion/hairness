# Replayable E2E testing

Hairness tests operational flows with declared actors and isolated attempts.

```text
.overlay/test-runs/<suite>/<attempt>/
├── manifest.json
├── workspace/
├── home/
├── fixtures/
├── evidence/
└── result.json
```

A TestActor is declared by an extension-owned Node test module. It maps exact gap IDs to answers and validates the effects, targets, exclusions, and content hash of each checkpoint it accepts. It cannot approve an unknown checkpoint or use a generic confirmation flag.

The runner, sandbox implementation, receipts, schemas, actors, and suites belong to `hairness/maintainer`. They live under `extensions/hairness/maintainer/testing/` and write attempts only inside the maintainer overlay namespace. This keeps `minimal` free of the E2E system.

Every deterministic step records its command, duration, exit code, output bytes, and assertions. Local budgets are 250 ms for `onboarding next`, 300 ms for a wake-up refresh, and 500 ms for SessionOpening; shared CI uses a one-second process ceiling.

Provider evals use the installed Codex or Claude CLI as transport. `fast`, `balanced`, and `deep` resolve to local provider preferences and low, medium, or high effort. Raw provider streams and transcripts are discarded; only gate results, response digests, model identity, duration, and compact limits remain in the local receipt. Provider stdin is closed, each attempt is bounded, and transport or authentication failures become explicit limits. A provider-facing change requires three passing fast attempts before a Git checkpoint; milestone attestations require ten cockpit passes.

```bash
hairness maintain test list
hairness maintain test run forge-smoke
hairness maintain test show <attempt>
hairness maintain test replay <attempt>
hairness maintain test clean --older-than 7d
```

Successful attempts retain the receipt and compact evidence. Failed attempts retain the sandbox for seven days. Replay creates a new attempt so the original evidence remains immutable.
