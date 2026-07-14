
<!-- hairness:begin id="agent-contract" owner="hairness/cockpit" schema="1" digest="sha256:fcb3e10c948162322d1f436fdcbd5bc9d5e300336a06f661441e3cb47a6c9dbf" -->
## Hairness agent contract

- Use the injected SessionOpening directly. If it is absent, run `hairness opening --json` exactly once before broad exploration and obey its language instruction.
- For wake-up, reuse the fresh opening's three attention signals without tools. Run `hairness wake-up --json` exactly once only when the opening is absent, stale, or the user explicitly requests refresh.
- Express work through the active command surface when a routed capability exists.
- Render provider responses as compact dashboards when local state, sources, artifacts or routes matter: status, result, links, proof, limits, next route.
- Artifacts orient; live sources prove current truth.
- Treat checkpoints, worker capsules, inherited constraints, targets, and exclusions as hard boundaries.
- Route every Hairness-controlled versioned mutation through a managed Worktree handle with the exact live writer lease; never mutate the anchor or an unmanaged checkout.
- Do not infer authority from a command, mount, artifact, extension, or prior operation.
- Keep the main session compact; delegate only bounded work and always fan results back in.
- Use deterministic routes when inference adds no value; keep semantic choices in the main session.
- Use `producer` for non-mutating typed outcomes and `executor` only for explicitly granted effects.
- Never load this cockpit, provider conversation history, or nested agents into a worker.
- Keep `.overlay/` local and never store secrets, credentials, customer data, transcripts, or reasoning there.
- Keep scratch disposable; promote only validated extension-owned artifacts.
- Return uncertainty, stale evidence, blocked routes, and partial effects as explicit limits.
- Preserve provider-native threads and UI; Hairness owns contracts and fan-in, not the provider runtime.
- Run the repository validation commands before claiming an implementation complete.
- Read generated Markdown as a projection of canonical JSON, never as its source of truth.
- Revalidate volatile sources before an executor checkpoint, even when an artifact looks current.
- Keep worktree handoff, takeover, synchronization, repair and cleanup explicit; a merge or inactive session never transfers authority or deletes a checkout.
- Stop and request a split when one capsule cannot complete the assignment inside its budget and boundary.
<!-- hairness:end id="agent-contract" -->

<!-- hairness:begin id="forge-guidance" owner="hairness/maintainer" schema="1" digest="sha256:1d3e6180a55f872f4ca7bdf1b99daf1ec4305bc9e10aa5e49b669c54d4a6ae99" -->
## Forge maintenance

- Read the documentation index, then only the ADRs relevant to the changed owner or path.
- Read `STATUS.md` before opening new scope and keep its current chantier aligned with Work Controls.
- Change canonical extension or core sources, never generated provider projections directly.
- Run `hairness maintain impact` before a Git checkpoint.
- Run `hairness build --check` after provider command, instruction, extension, or guidance changes.
- Keep README, SPEC, and owner documentation aligned with every public behavior change.
- Physical presence never activates an extension; only the distribution manifest and explicit local configuration do.
- Turn recurring corrections into a durable rule, decision, schema, gate, or test.
<!-- hairness:end id="forge-guidance" -->
