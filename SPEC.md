# Hairness protocol specification

Status: pre-alpha
Protocol version: 0.2
Implementation version: 0.2.0-alpha.0

## 1. Conventions

The terms **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are normative. Explanatory passages marked as rationale are non-normative.

The protocol version describes observable interoperability contracts. The implementation version describes one source distribution. A source-owned distribution MAY change its implementation freely while it continues to satisfy its declared protocol version.

## 2. Design thesis

Hairness is a provider-native, company-owned context and authority control plane for the main coding session. A Hairness repository MAY be a stable session home whose mounted codebases and checkouts are operation targets. It makes an engineering ecosystem legible through source-owned distributions, deterministic commands, and bounded execution without replacing the provider runtime.

The protocol is governed by four laws:

1. One intent enters a plan.
2. Every route has a typed return contract.
3. No fan-out exists without a declared fan-in.
4. Integration grants access, not authority.

Rationale: models add value at semantic boundaries. Discovery, validation, lifecycle state, locks, mechanical merging, and rendering should be deterministic whenever possible.

## 3. Non-goals

Hairness is not:

- a replacement for a provider's native agent runtime or UI;
- an autonomous workflow engine that hides decisions;
- a requirement that participating codebases adopt Hairness files;
- a store for provider reasoning, transcripts, credentials, or production data;
- a runtime dependency that a source-owned distribution must continuously track;
- a replacement for autonomous execution loops or their internal runtime.

## 4. Vocabulary

- **Main session:** the provider session that communicates with the human and owns compact context.
- **Intent:** the requested outcome and its initial boundaries.
- **Command:** a validated CLI invocation derived from an intent.
- **ContextPlan:** an ordered set of routes and its fan-in contract.
- **Route:** a deterministic action or bounded worker assignment.
- **Assignment:** the goal, inputs, authority requirements, budget, and expected result for a route.
- **Capsule:** the minimum worker-visible projection of an assignment.
- **Producer:** a worker profile that MUST NOT mutate declared target codebases.
- **Executor:** a worker profile allowed to perform explicitly granted effects.
- **Run:** the persisted lifecycle of one planned route.
- **Result:** the canonical typed outcome of a run.
- **Artifact:** a durable, revisioned orientation result.
- **Effect:** a mutation or external action.
- **Grant:** the scoped authority to perform declared effects.
- **Checkpoint:** the human-visible projection of proposed authority.
- **Receipt:** the typed record of effects, proof, tests, limits, and recovery.
- **ContextPacket:** the bounded fan-in returned to the main session.
- **Forge:** a source-owned repository that contains the full extension catalogue but activates only its declared composition.
- **Integration footprint:** the declared guidance, skills, hooks, worker profiles, and configuration projected into a repository.
- **Distribution:** a standalone source repository materialized from a recipe.
- **Provider command:** the host-native human interface compiled from an extension-owned logical command.
- **Intent preset:** a provider command that binds a frequent action and resolves remaining arguments without granting authority.
- **Source:** a typed proof surface accessed through a declared transport.
- **Attention signal:** a compact state, priority, summary, and route contribution to the cockpit.
- **Workframe:** a persistent mission, segment, or frame that records trajectory without recording conversation.
- **Constraint:** a restriction inherited from session to segment, frame, and operation.
- **Managed region:** a content-addressed block or entry owned by one active extension inside an otherwise human-owned file.
- **ResultContract:** the schema and semantic disposition of a command or worker result.
- **Methodology binding:** a declarative link from a provider-native method to an existing Hairness capability and ResultContract.
- **Checkout:** one local materialization of a stable CodebaseContract.
- **TargetSet:** the exact, digested collection of checkout baselines addressed by an operation.
- **Distribution lock:** the tracked recipe, provenance, update source, and base digest of each source-owned material.

## 5. Main-session contract

The main session MUST receive only context relevant to the current human intent and active operational signals. Session-start orientation MUST be bounded. This implementation limits the prologue to 4 KiB and each ContextPacket to 8 KiB.

The main session MUST NOT receive complete worker transcripts or provider reasoning by default. It MAY request precise source references or artifact components on demand.

The main session MAY map natural language to a command. The CLI MUST validate the command and MUST NOT embed an LLM.

## 6. Intent, plans, and routes

An Intent MUST state an outcome. A ContextPlan MUST contain at least one Route and one fan-in declaration.

Each Route MUST declare:

- a stable ID;
- kind `deterministic`, `producer`, or `executor`;
- requirement `required` or `optional`;
- expected result schema;
- budget and relevant limits;
- fan-in destination.

A required route failure MUST prevent plan success. An optional route failure MUST appear as a limit in the final ContextPacket.

A deterministic merge MAY combine compatible typed components. Semantic reconciliation MUST be expressed as a producer route.

## 7. Assignments and capsules

An Assignment MUST define goal, resolved inputs, expected outcome, budget, exclusions, and required authority. Its Capsule MUST expose no more than:

- run and task identity;
- profile and goal;
- precise references;
- allowed source and effect routes;
- targets and exclusions;
- workload class;
- ResultContract;
- submit, fail, and suspension routes.

Workers MUST NOT receive the main prologue or complete cockpit. Workers MUST NOT create nested workers in protocol 0.2. A worker that cannot complete one bounded assignment MUST return `needs-split`.

## 8. Run lifecycle

Each planned route MUST have one RouteRun containing `task.json`, core-owned append-only `events.jsonl`, and canonical `result.json` when a result exists.

Valid states are:

```text
planned, ready, running, needs-input, needs-budget, needs-authority,
needs-split, succeeded, failed, invalid, cancelled, unknown
```

The core MUST validate every transition. Budget exhaustion MUST preserve state and return `needs-budget`. One automatic correction MAY follow an invalid worker result; a second invalid result MUST terminate as `invalid`.

Native thread resume SHOULD be used when available. Replacement workers MAY continue the same logical run from persisted state when native resume is unavailable.

## 9. Producers and artifacts

A producer MUST NOT mutate declared target codebases. It MAY write only its run and artifact staging area.

Every ProviderCommand, Assignment, WorkerCapsule, and methodology binding MUST carry one ResultContract. Its disposition MUST be `response`, `run-only`, `scratch`, `artifact`, or `effect`. `response` remains provider UI output. `run-only` remains canonical run state. `scratch` MUST be namespaced by binding or owner and run. `artifact` MUST identify its semantic owner and type and pass atomic promotion. `effect` MUST satisfy the executor contract.

Producer outcomes SHOULD become artifacts only at a durable semantic boundary. Intermediate or external raw output SHOULD remain `run-only` or `scratch`.

An artifact MUST have a stable ID, owner, type, current revision, revision history, structured JSON payload, generated human rendering, and separate append-only annotations. It MUST declare labels, signals, typed relations, a freshness policy, and validated provenance. Provenance kind MUST be `extension`, `methodology`, `worker`, or `import`. Methodology provenance MUST NOT create a competing artifact type: the semantic capability remains the artifact owner. Promotion from staging MUST be atomic: all declared components validate or none are promoted.

Artifacts orient. Current source access proves. An artifact MUST NOT claim freshness it did not verify.

## 10. Executors, effects, and receipts

An executor MUST receive an EffectGrant before mutation. The Grant MUST identify intent, targets, allowed effects, exclusions, proof, and expiry or run scope.

A Checkpoint MUST present resolved targets, proposed effects, risk, exclusions, proof plan, and operations that will not occur. Any new target or effect MUST return `needs-authority` and require a delta checkpoint.

The main session performing an inline mutation MUST obey the same contract.

A ChangeReceipt MUST contain summary, affected targets, files or external resources, effect status, diff statistics where applicable, tests, proof, limits, and recovery route. Partial effects MUST produce a partial receipt. The core MUST NOT claim generic rollback.

## 11. Locks and recovery

Executor locks MUST be keyed by canonical target realpath and acquired atomically for a multi-target operation. Producers MAY run concurrently; this implementation permits at most three per plan. Executors MUST run sequentially within one plan.

A dirty checkout MAY be used only after its baseline is recorded and no intended path overlaps existing changes. Overlap MUST suspend the run.

Crash, missing valid receipt, or ambiguous target state MUST quarantine the target as `unknown`. Locks MUST NOT be optimistically released. Recovery or explicit human resolution MUST clear quarantine.

## 12. ContextPacket

Fan-in MUST return one ContextPacket containing:

- intent and status;
- compact result summary;
- required proof references;
- effects and tests where relevant;
- explicit limits;
- active blocks or quarantine;
- next valid routes;
- measured byte size.

Provider token and cost metrics MAY be included when the provider exposes them. Raw source dumps and complete diffs MUST NOT be included by default.

## 13. Integration and trust

Hairness follows: **No intrusion is not no mutation. Non-invasive integration, explicit operation.**

An integration MUST be explicit, inspectable, and removable. Shared provider projections MUST live in the repository and MUST be derived from active source-owned extensions. A mount, projection, hook, manifest, or extension MUST NOT imply mutation authority.

A codebase MAY adopt a local manifest, onboarding, or hook. Hairness MUST NOT require this footprint when an external contract is sufficient.

Workspace and local-extension trust MUST be established before executable code or hooks load. Trust, user preferences, and global locks MAY live in user-level state. Shared provider projections MUST NOT depend on user-level installation state.

## 14. Overlay

`.overlay/` is local and MUST NOT be versioned. It contains configuration, named codebase mounts, runs, artifacts, scratch, local extensions, local-only projections, and extension-owned state. The core MUST NOT provide a general-purpose test runtime.

Scratch MUST NOT be automatically injected, promoted, or treated as durable truth. Cleanup MUST be explicit in protocol 0.2.

Secrets, tokens, cookies, passwords, credentials, auth artifacts, customer data, and private production data MUST NOT be stored in the overlay.

## 15. Extension contract

An extension MUST have a validated manifest and unique command ownership. It MAY declare provider commands, methodology bindings, intent modifiers, relation types, managed guidance, intent presets, services, schemas, deterministic collectors, assignments, artifact types, renderers, reducers, onboarding gaps, attention signals, source operations, required codebases, and available effects.

A MethodologyBinding MUST identify supported providers, capabilities, and one ResultContract. It MAY reference owner-local instructions and an input schema. A binding MUST normalize its useful result into an existing semantic contract; raw output MUST NOT be promoted automatically. A coded adapter is required only when declarative invocation and normalization cannot control the method safely.

An extension handler MUST receive a frozen runtime scoped to its owner. The runtime MUST expose contracts, distribution data, runs, plans, artifact operations, authority primitives, sources, extension calls, and owner-scoped overlay state. Its overlay operations MUST be confined to `.overlay/extensions-state/<extension-id>/`. It MUST NOT expose an unscoped target or external-system mutation primitive.

An extension handler MAY read, validate, plan, or return a typed result. It MUST NOT directly mutate a target or grant itself authority. An extension MUST NOT import another extension by physical path. A service call MUST target a declared dependency; missing dependencies and service cycles MUST block readiness.

Every declared service, source operation, and contribution MUST have a matching module export. An extension without commands MAY omit `handleCommand`. Source aggregation MUST resolve declared operations by owner and MUST NOT branch on concrete source IDs in the core.

Each ProviderCommand MUST reference an instruction file inside its owner directory. Provider projections MUST compile that content with the common safety footer. Each promoted artifact type MUST have exactly one enabled owner and MUST validate its payload against the owner's declared JSON Schema before promotion.

Onboarding contributions MUST be declarative manifest data. Extension code MUST NOT execute before workspace trust. Dynamic attention contributions MAY execute only after trust and MUST contain only `state`, `priority`, `summary`, and `route`.

Shared extensions are registered by the distribution manifest. Local extensions MUST use the same contract, be explicitly configured, and be trusted before load.

A local extension link MUST reference an explicit filesystem source, validate dependency closure, and require a matching checkpoint before configuration, trust, symlink, or local-projection changes. Unlinking MUST remove only Hairness-owned local references and MUST NOT mutate the external source. Linking grants no authority.

Prologue contributions MUST be typed signals containing only state, priority, summary, and route.

## 16. Codebase contract

A CodebaseContract MUST provide a stable ID, repository identity, and requirement policy. It MAY provide accepted remotes, relationships, source proof, test commands, branch policy, discovery hints, onboarding gaps, and local-manifest discovery. A Checkout MUST reference that stable ID plus a checkout ID and canonical realpath. Multiple checkouts MUST NOT create multiple repository identities.

The distribution owns the canonical repository identity. The local absolute path MUST remain local configuration, and live Git remotes MUST prove the mounted clone. A codebase mount grants visibility only. Mutation requires an executor grant.

A mount MUST use `.overlay/codebases/<codebase-id>/<checkout-id>` and default the checkout ID to `default`. A plan addressing a codebase MUST freeze a TargetBaseline containing codebase, checkout, realpath, branch, HEAD, dirty state, and digest. An absent or ambiguous checkout MUST return `needs-input`. Effect grants and locks MUST address the exact TargetSet digest.

A workspace MAY declare additional local-only codebase contracts. Local contracts MUST NOT replace shared IDs, enter shared projections, or become team requirements. Mount and unmount operations MUST be checkpointed, MUST validate canonical paths and Git identity, and MUST preserve the target checkout. A missing remote MUST be reported as `remote-pending`; a conflicting remote MUST be rejected.

## 17. Provider projection contract

A provider projection MUST use native repository-scoped primitives for guidance, skills, hooks, workers, permissions, and UI visibility. Provider doctor MUST report capabilities as `strict`, `best-effort`, or `unsupported` from probes, not version assumptions alone.

The compiler MUST project only active logical commands and MUST expose producer/executor profiles. It MUST preserve a minimal worker capsule and structured result handoff. The shared projection MUST contain no absolute path.

Missing required capability MUST stop execution and expose explicit inline, headless, or discuss routes. A provider projection MUST NOT silently degrade.

Provider/core protocol mismatch MUST stop and route to doctor or rebuild.

Provider integration MUST NOT require a plugin, marketplace, global registration, attachment, or symlink. A fresh clone MUST contain its shared projections. `hairness build` MUST reconstruct them; `hairness build --check` MUST detect drift without mutation.

Markdown and TOML projections MUST use content-addressed managed regions. JSON projections MUST use owned entries recorded by JSON pointer. The compiler MUST preserve foreign content. It MUST return `review-required` rather than overwrite a modified or ambiguous owned region.

## 18. Distribution and command contract

A DistributionRecipe MUST declare branding, starter, selected extensions, providers, sources, and codebases. Materialization MUST copy the selected source into a standalone repository and record provenance without creating a runtime dependency.

`create` MUST default to role `distribution` and starter `standard`. A team distribution MUST include only the operational runtime, selected extensions, schemas, provider projections, smoke tests, and copied MIT notice. It MUST NOT include the reference project SPEC, ADRs, roadmap, changelog, maintainer documentation, dormant catalogue, or forge bootstrap. `hairness/maintainer` MUST NOT be selected by `standard`.

Role `forge` MUST be explicit. A generated forge MAY include the generic catalogue, bootstrap, maintainer, qualification suites, and organization-specific forge guidance. It MUST NOT copy the reference project's historical roadmap or changelog.

Requirement policy MUST be one of `required`, `recommended`, or `optional`. A missing required resource MUST block readiness; a recommended resource MUST produce a non-blocking attention signal; an optional resource MUST remain silent until requested.

A ProviderCommand MUST have one extension owner, typed arguments, a logical ID, required capabilities, an owner-local instruction path, and an expected result. An IntentPreset MAY bind action, mode, budget, result type, and argument-resolution rules. It MUST NOT bind an EffectGrant or checkpoint approval.

Provider projections MUST be derived from canonical extension-owned command sources and MUST be versioned with the distribution. Local-extension projections MUST remain ignored and MUST be recorded separately.

A forge MUST declare `role: forge` and one or more `catalogRoots`. Physical presence in a catalogue MUST NOT activate an extension. A generated distribution MUST declare `role: distribution`, MUST copy only selected extensions, and MUST contain no dormant catalogue.

`extension add` MUST inspect an explicit path, tarball, or package specification, compute dependency closure, present one checkpoint, and rebuild projections. It MUST NOT use an implicit registry.

Every generated repository MUST contain a tracked DistributionLock with recipe digest, GeneratedFrom, configured update source, and material records. The lock MUST contain no absolute path. A consumer root is private and `UNLICENSED` by default and MUST contain `LICENSES/Hairness-MIT.txt`; it MUST NOT imply that the consumer repository itself uses MIT.

Update discovery MUST occur only on explicit invocation. Session opening and wake-up MUST NOT access the update source. An update plan MUST materialize a candidate in scratch and compare base, current, and next content per atomic scope. New content, intact replacement, intact deletion, and intact managed regions MAY be safe. Consumer divergence, dependency changes, owner conflicts, or edited managed regions MUST return `review-required`. An apply MUST reject the complete scope if any change is ambiguous, require the exact checkpoint, update the lock, rebuild projections, and emit a receipt. It MUST NOT perform a three-way merge, Git mutation, remote operation, publish, or silent rollback. Crash or missing final validation MUST return `unknown` with a recovery route.

When the maintainer extension is active, a versioned project status document MAY declare at most one current chantier and three next chantiers. Each chantier MUST identify its outcome, state, gate, and evidence. When a current chantier exists, its ID MUST match the active Workframes segment.

## 19. CLI contract

The canonical grammar is:

```text
hairness <namespace> <target> [action]
```

Human-readable output is the default. `--json` MUST produce a versioned envelope with `schemaVersion`, `protocolVersion`, `ok`, `data` or `error`, `limits`, and `routes`. Non-success outcomes MUST use documented non-zero exit codes.

The run result is canonical. Provider messages are UI projections.

## 20. Onboarding contract

Onboarding MUST resolve one highest-priority gap at a time and return two or three concrete choices. Answers MUST be collected without external mutation.

Before apply, onboarding MUST render one complete checkpoint describing trust, local configuration, source identity reads, codebase mounts, projection verification, risks, and exclusions. Apply MUST write only local state and MUST be followed by doctor checks.

Extensions MAY contribute typed gaps. The core owns prioritization and rendering.

The first visible gap SHOULD confirm interaction language. Preference resolution MUST apply protocol invariants, distribution defaults, user preferences, workspace configuration, then an explicit current-prompt override. SessionOpening MUST instruct the provider to use the effective language for commentary, questions, and final answers.

A provider doctor MUST distinguish `blocked`, `stale`, `projected`, `verification-required`, and `verified`. File presence alone MUST NOT prove hook execution. A compatible SessionStart receipt MUST be local, content-addressed to the projection and hook, and contain no session content.

## 21. Session intelligence contract

Hairness MUST open or resume one local HairnessSession without requiring a provider ID. It MAY associate multiple provider session references later. An absent provider reference MUST be reported as `provider-session-unbound`, not block a digest. Transcript access MUST require workspace opt-in and MUST remain an allowlisted, volatile source.

Hairness MUST promote only validated `session-handoff` artifacts. It MUST delete processed inbox events and MUST NOT promote transcripts, hidden prompts, or model reasoning.

## 22. Workframes contract

Workframes MUST persist an append-only event log and a reconstructible compact projection. One mission MAY contain multiple segments; only one segment MAY be active. A frame MUST belong to one segment. Closing a segment MUST close its open frames and MUST require a valid `segment-digest` artifact.

A closed segment MUST remain immutable. Resuming its subject MUST open a new segment linked by `continues`. `resume` MUST derive a compact ContextPacket from digests, relations, and artifact references without replaying a transcript.

A frame is trajectory state, not an artifact. Semantic boundaries MUST produce extension-owned artifacts. `hairness-work-execute` MUST require an accepted `work-plan`, its effective constraints, and an exact checkpoint. Workframes MUST NOT grant effects itself.

## 23. Constraints and presentation

Constraints MUST inherit from session to segment, frame, and operation. A child scope MAY only narrow its parent. Removing a constraint MUST require an explicit command at the owning scope.

Effective authority MUST be the intersection of requested effects, checkpoint grant, worker capsule, and the current extension-contributed `EffectPolicy`. The core MUST NOT know named constraint semantics. A checkpoint and its grant MUST record the effective policy digest. The policy MUST be recomputed before an effect; a newly denied effect revokes the earlier grant immediately. No grant MAY persist beyond one operation.

Presentation Controls MAY select `summary`, `diagram`, `tree`, `table`, `timeline`, `checklist`, `matrix`, or `trace`. `auto` MUST select no more than three views and SHOULD select the smallest sufficient set. Presentation MAY change form; it MUST NOT invent meaning, structure, decisions, or proof.

Intent modifiers MUST be extension-owned. A provider command MUST explicitly opt into each accepted modifier. A quick command MUST compose existing primitives rather than duplicate their capabilities.

## 24. Replayable testing

When `hairness/maintainer` is selected, each E2E attempt MUST have an isolated workspace, home, fixtures, evidence, manifest, and receipt under its extension-owned overlay namespace. Test cases and their actors MUST be extension-owned Node modules. A TestActor MUST answer only declared gaps and approve only declared checkpoint effects, targets, exclusions, and hashes. Generic auto-approval is forbidden. A distribution without the maintainer extension MUST NOT contain Hairness E2E machinery.

Provider evals MUST use provider-native CLIs rather than a Hairness model runtime. They MUST NOT persist raw streams, transcripts, or hidden reasoning. A receipt MUST retain only the resolved provider/model/profile, duration, gate outcomes, content digest, limits, and timestamp. Provider-facing changes MUST obtain three passing `fast` attempts before a Git checkpoint; milestones SHOULD require ten cockpit passes plus one native UI smoke per provider.

The core MUST aggregate `SessionContribution` values without knowing their sections or owners. Each contribution MUST be no larger than 512 bytes and the complete `SessionOpening` MUST be no larger than 4 KiB. No extension may contribute before workspace trust. The cockpit extension owns the human/provider rendering.

Successful attempts SHOULD retain only compact evidence and receipt. Failed attempts SHOULD retain their full sandbox for seven days. Replay MUST create a new attempt; it MUST NOT mutate the original.

## 25. Source contract

A SourceOperation MUST declare its source, transport, access class, input contract, and result contract. SourceEvidence MUST record operation, transport, observation time, summary, proof, limits, and freshness.

Strict source proof MUST use a deterministic local CLI or API transport. Provider tools MAY assist a discussion but MUST NOT satisfy a strict gate without a conforming transport adapter.

## 26. Security and data policy

Every external input and executable manifest MUST be validated at the trust boundary. Commands MUST avoid shell interpolation for untrusted values. Effects MUST be allowlisted.

Hairness MUST NOT persist model reasoning, hidden prompts, credentials, private customer data, or production records. Source references SHOULD be precise and minimal rather than copied wholesale.

## 27. Conformance

A conforming core MUST validate the protocol schemas, enforce run transitions, enforce fan-in, enforce authority, and generate bounded ContextPackets.

A conforming provider projection MUST pass native capability probes, pass drift checks, and preserve the capsule/result boundary.

A conforming extension MUST validate its manifest, own commands and artifacts uniquely, implement every declared surface, use only declared dependency services, and route effects through core authority.

A conforming forge or distribution MUST declare its role and protocol version, validate active extensions, keep local state outside version control, and pass the protocol conformance suite.

Protocol `0.2` is a clean break from the unpublished `0.1` pre-alpha contracts. A conforming `0.2` implementation MUST NOT silently accept `0.1` manifests.
