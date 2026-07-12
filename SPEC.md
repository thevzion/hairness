# Hairness protocol specification

Status: pre-alpha  
Protocol: `0.2`  
Implementation: `0.2.0-alpha.0`

## 1. Conventions

**MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are normative. The protocol version identifies interoperable contracts. The implementation version identifies one distribution of those contracts.

## 2. Thesis

Hairness treats agentic assets as software. It provides a provider-native, source-owned control plane for the main session so the human and agent can share current reality, reason together, and apply bounded leverage.

The kernel MUST own only grammar and generic guarantees. Extensions MUST own behavior. A distribution MUST own selection.

Hairness is not a model runtime, daemon, transcript store, project manager, autonomous execution loop, or required footprint inside mounted codebases.

## 3. Canonical model

An **AgenticAsset** is a conceptual, versioned unit that changes what an agent can understand or do. Protocol `0.2` does not define a universal asset registry.

A **CapabilitySpec** MUST declare a stable ID, owner, version, summary, and globally unique operations. An **Operation** MUST declare:

- an ID and class `observe`, `derive`, or `effect`;
- one or more typed ResultOptions and exactly one declared default;
- declared sources and effects;
- supported route kinds;
- accepted modifiers.

An `observe` or `derive` operation MUST declare no effects and MUST NOT return disposition `effect`. An `effect` operation MUST declare at least one effect and MUST return disposition `effect`.

An **OperationRef** MUST contain capability and operation IDs. Provider commands, routes, assignments, and capsules MUST resolve to one active OperationRef.

## 4. Routes

A RouteSpec MUST use kind `deterministic`, `inline`, `worker`, or `external`. A worker route MUST declare profile `producer` or `executor`; other routes MUST NOT declare a worker profile.

An observe/derive worker MUST use `producer`. An effect worker MUST use `executor`. The route kind MUST be supported by its operation.

Every fan-out MUST declare one fan-in. Every required route MUST return a valid typed result before the plan can succeed. Optional failure MUST return as an explicit limit. Mechanical reduction MAY merge compatible typed results; semantic reconciliation MUST be an operation.

An InvocationDraft MAY be proposed by a provider model or constructed directly. Hairness MUST validate it into one InvocationRequest referencing an active Operation. Resolution MUST prefer explicit inputs, then the provider draft, effective local state, distribution defaults, and trusted extension resolvers. Only an unresolved required ambiguity MAY become an InvocationGap.

An InvocationPreview MUST remain below 4 KiB and expose resolved inputs, controls, route, expected result, effects, gaps, limits, and next action. `--auto` MAY bypass only preview confirmation. It MUST NOT bypass trust, ambiguity, budget escalation, authority, target or effect expansion, result validation, publication, or partial effects.

Invocation events MUST be append-only and state MUST be reconstructible from them. Events and receipts MUST NOT contain transcripts, provider output, or internal reasoning.

Provider projections MUST direct a main-session model to submit an InvocationDraft before asking a user question. The model MUST ask only an InvocationGap returned by Hairness. A host adapter MUST report `strict`, `guarded`, or `unsupported` and MUST NOT claim a native fast hook when it uses the agent-first-call fallback.

## 5. Main session

The main session is the provider session communicating with the human. It MUST receive minimum sufficient context, current proof references, limits, and routes. It MUST NOT receive worker transcripts, hidden reasoning, or the full cockpit inside workers.

SessionOpening MUST be constructed locally in less than 500 ms, stay below 4 KiB, and contain no extension contribution above 512 bytes. ContextPacket MUST stay below 8 KiB. The effective language MUST govern commentary, questions, and final responses unless the current prompt explicitly overrides it.

The CLI MUST be deterministic and MUST NOT embed an LLM. Semantic choices MAY remain with the native main-session model.

## 6. Plans, runs, and workers

An Intent MUST state an outcome. A ContextPlan MUST contain routes and fan-in. An Assignment MUST contain its OperationRef, goal, outcome, workload, exact inputs, targets, exclusions, sources, requested effects, and ResultContract.

A WorkerCapsule MUST expose only the assignment identity, OperationRef, profile, goal, outcome, precise inputs, targets, exclusions, allowlists, workload, ResultContract, and submit/fail/source/effect routes. Workers MUST NOT spawn nested workers in protocol `0.2`.

Run states are:

```text
planned ready running needs-input needs-budget needs-authority needs-split
succeeded failed invalid cancelled unknown
```

The kernel MUST validate transitions and persist task, append-only events, and canonical result. An invalid result MUST be rejected before promotion and MAY be corrected within the same logical run.

## 7. Results and artifacts

Result disposition MUST be `response`, `run-only`, `scratch`, `artifact`, or `effect`. Provider text is a projection; the typed result is canonical.

An artifact MUST have a stable ID, active owner, type, revision history, JSON payload, generated rendering, append-only annotations, labels, signals, relations, freshness, and provenance. The owner extension MUST provide its payload schema. Promotion MUST be atomic.

Scratch MUST remain local, namespaced, non-authoritative, and never auto-promoted. Artifacts orient; current source evidence proves.

## 8. Effects, authority, and recovery

Integration grants no authority. An effect requires:

```text
requested effect
∩ checkpoint grant
∩ worker capsule
∩ current extension policies
∩ exact target and valid lock
```

A checkpoint MUST show intent, resolved targets, effects, exclusions, proof, risk, and non-actions. Grants MUST be operation-scoped and store the effective policy digest. Policy MUST be recomputed before every effect; a newly denied effect MUST revoke the grant.

Locks MUST use canonical target realpaths and be acquired atomically. A dirty target requires a recorded baseline and no overlap. Crash, partial receipt, or ambiguous state MUST produce `unknown` or a partial receipt and a recovery route. The kernel MUST NOT promise generic rollback.

## 9. Extension contract

An extension MUST contain a validated `extension.json`, its declared README and capability files, and only its owned implementation, schemas, instructions, contributions, and tests. It MUST declare a summary, discovery category, tags, and maturity. Category metadata MUST NOT change the stable `<owner>/<name>` ID or physical path. Declared paths MUST remain inside the extension.

Cross-extension service calls MUST declare dependencies. Cycles, duplicate command owners, duplicate operation IDs, duplicate artifact types, missing exports, and unselected modifiers MUST block doctor and build.

The frozen runtime MAY expose contracts, distribution reads, runs, plans, artifacts, authority, declared extension services, and owner-scoped overlay state. It MUST NOT expose generic source or target mutation primitives. Extension state MUST be limited to `.overlay/extensions-state/<extension-id>/`.

Physical presence MUST NOT activate an extension. Removing an extension MUST remove all its capabilities, commands, services, contributions, source drivers, schemas, and provider projections.

## 10. Controls and composition

Controls are ordinary extensions:

- Work Controls own mission, segment, frame, discuss, recap, plan, act, execute, SegmentDigest, and WorkPlan.
- Understanding Controls own map, explain, and compare.
- Ideation Controls own ideate, propose, and creative strategy.
- Presentation Controls own presentation policies and views.
- Constraints own named restrictions and their inheritance.

Intent composition MAY combine operation, focus, source policy, boundary, execution mode, budget, and accepted modifiers. A modifier MAY change strategy or form; it MUST NOT invent evidence, meaning, structure, or authority. A quick command MUST reference an existing operation rather than duplicate a capability.

Work Controls MUST keep an append-only event log and reconstructible current state. Only one segment MAY be active. Closing a segment MUST require a valid SegmentDigest and make the segment immutable. Resuming a closed subject MUST open a related segment. Work state MUST NOT contain transcripts or reasoning.

## 11. Sources

The kernel MUST NOT know concrete source IDs. The `hairness/sources` extension owns source discovery, selection, doctor, evidence validation, redaction, and freshness. Source drivers MUST be declared assets with read-only operations and optional parser modules.

`hairness.json.sources` selects drivers. A generated distribution MUST copy only selected drivers. A forge MAY retain a dormant catalogue, but dormant assets MUST NOT execute or appear in shared projections.

SourceEvidence MUST record source, operation, transport, observation time, summary, data, proof, and limits. Credentials and secrets MUST be redacted and MUST NOT be stored.

## 12. Onboarding and trust

The generic onboarding engine MUST own only language, profile, workspace trust, providers, answer state, checkpoint, and apply lifecycle. Before explicit trust, extension code MUST NOT execute.

After the trust decision, active extensions MAY contribute questions, gaps, validations, setup actions, and attention. Answers MUST cause no external mutation. Apply MUST require the exact checkpoint and MUST grant no business authority.

Provider doctor states are `blocked`, `stale`, `projected`, `verification-required`, and `verified`. File presence MUST NOT prove hook execution. Verification requires a compatible local receipt from a new trusted provider task.

## 13. Provider projections

Provider commands MUST be compiled from active extension-owned definitions. Commands of kind `capability` or `preset` MUST reference an active OperationRef. The bridge router MAY omit one.

Shared projections MUST be tracked and repo-local. Managed regions and entries MUST preserve foreign content, reject ambiguous edits, and remove only intact owned content. Local-extension projections MUST remain ignored and separately inventoried.

Adapters MUST translate only host syntax. Providers retain model execution, native workers, sandbox, tools, UI, and thread visibility. Plugins, marketplaces, global registrations, and absolute shared paths are outside protocol `0.2`.

## 14. Distributions and lifecycle

A MaterialSet MUST declare an owner, dependency sets, and exact source-to-target entries. A DistributionRecipe MUST declare its role, material sets, active extensions, capabilities, source drivers, source requirements, providers, codebases, templates, scripts, and tests. Create MUST resolve a deterministic MaterialGraph from declared dependencies, MUST reject cycles and conflicting targets, and MUST NOT infer dependencies by parsing source code or branch on private owners.

`minimal` MUST contain only kernel, cockpit, and distribution lifecycle. `standard` MAY add team controls and selected Git support. `forge` MAY add maintainer behavior and a dormant generic catalogue.

A generated distribution MUST contain its own README and configuration, selected source only, and the required Hairness MIT notice. It MUST NOT inherit upstream SPEC, STATUS, ROADMAP, maintainer documentation, project license, unselected driver, test, or catalogue.

Create MUST NOT commit, create a remote, push, tag, release, or publish. A DistributionLock MUST record recipe digest, provenance, update source, selected material, and base digests without absolute paths.

Update MUST be explicit and conservative. Intact owned material MAY update mechanically. Consumer divergence, changed dependencies, owner conflicts, or edited managed regions MUST require review. Update MUST NOT silently merge or mutate Git.

## 15. Codebases and local state

A CodebaseContract MUST identify one repository, accepted remotes, requirement, and tests. A mount MUST identify a named local checkout and capture canonical realpath, remote, branch, HEAD, and dirty baseline. Mounting MUST NOT grant authority or mutate the checkout.

`.hairness/` MAY contain only tracked distribution-owned policies and explicitly published artifacts. `.overlay/` MUST remain unversioned and MAY hold local config, mounts, runs, artifacts, scratch, local extensions, local projections, and owner-scoped state. `~/.hairness/` MAY hold preferences, trust, and global realpath locks. Presence in any state directory MUST NOT activate an extension or grant authority.

Hairness MUST NOT store secrets, credentials, auth artifacts, customer data, private production data, transcripts, or hidden reasoning.

## 16. Session intelligence

A local HairnessSession MUST exist without requiring a provider ID. Provider references MAY bind later. Missing provider binding MUST be a limit, not a digest blocker.

Transcript input requires explicit opt-in and an allowlisted volatile inbox. Only a validated semantic handoff MAY be promoted; the inbox MUST then be removed.

## 17. Testing and conformance

Replayable Hairness E2E machinery MUST belong to `hairness/maintainer`; distributions without that extension MUST not contain it. Test actors MUST answer only declared gaps and approve only declared checkpoint targets, effects, exclusions, and hashes. Generic auto-approval is forbidden.

Conformance requires:

- schema and ownership validation;
- command parity across selected providers;
- selected-only minimal, standard, and forge payloads;
- effect refusal without authority;
- invalid worker result rejection, correction, and fan-in;
- no secrets, transcripts, private paths, dormant assets, or private composition in the package.

## 18. CLI and errors

The canonical grammar is `hairness <namespace> <target> [action]`. Human output is default. `--json` MUST return a versioned envelope with `schemaVersion`, `protocolVersion`, `ok`, `data` or `error`, `limits`, and `routes`.

Errors MUST have a stable code, summary, limits, routes, and non-zero exit code. The typed run result remains canonical.
