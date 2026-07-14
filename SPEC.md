# Hairness v0.3 specification

Status: experimental alpha
Package: `@hairness/cli@0.3.0-alpha.0`

**MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are normative.

## 1. Product boundary

Hairness is a lightweight, provider-agnostic harness for agentic assets. The npm
runtime MUST own deterministic composition, validation, local bindings,
checkpoints, receipts, and provider compilation. Providers MUST retain their
models, UI, threads, tools, workers, and scheduling.

A Home MUST own agentic assets and MUST NOT own a Target repository. A Target
MUST remain an independent repository identity with its local path stored only
in Runtime. Integration, installation, registration, or file presence MUST NOT
grant effect authority.

## 2. Document APIs

Public documents MUST declare `apiVersion` and `kind`. There is no global schema
or protocol version.

| Document | API |
| --- | --- |
| Home, HomeLock and SessionOpening | `hairness.dev/home/v1alpha1` |
| Distribution | `hairness.dev/distribution/v1alpha1` |
| Extension | `hairness.dev/extension/v1alpha1` |
| Scratch | `hairness.dev/scratch/v1alpha1` |
| Artifact | `hairness.dev/artifact/v1alpha1` |
| Checkpoint | `hairness.dev/checkpoint/v1alpha1` |
| Receipt | `hairness.dev/receipt/v1alpha1` |

Packages and extensions MUST use SemVer.

## 3. Home and Distribution

A generated Home MUST contain a pinned npm dependency, `hairness.json`,
`hairness.lock.json`, installed extension source, small managed regions in
`AGENTS.md` and `CLAUDE.md`, provider skill sentinel files, and an Overlay.

`hairness.json` MUST select providers, extension IDs, Target identities, language,
and Overlay policy. `hairness.lock.json` MUST record Distribution provenance and
each extension source kind, requested ref, immutable Git commit when applicable,
source digest, and installed base digest. Neither file may contain local Target
paths or generated provider output paths.

A Distribution MUST be bootstrap-only. It MAY contain extensions, defaults,
policies, onboarding contributions, documentation, and tests. It MUST NOT
contain a kernel, CLI, runtime, Overlay, Targets, provider output, or material
graph. After creation it has no synchronization role.

## 4. Extension contract

An Extension manifest MUST contain:

```text
apiVersion
kind: Extension
metadata: id, version, summary
spec: provides, requires, recipes, adapters, schemas, gates, onboarding, tests
```

`provides` and `requires` MUST reference capability IDs. One active composition
MUST NOT contain two providers for the same capability, two recipes with the
same command ID, or a missing requirement.

A Recipe MUST be provider-neutral Markdown. It MUST converse directly and MUST
NOT call the CLI merely to produce chat. An Adapter MUST declare `observe`,
`derive`, or `effect`. Observe and derive adapters MUST NOT request effects. An
effect adapter MUST export separate prepare and apply boundaries.

Onboarding contributions MUST be declarative. Extension code MUST NOT execute
during source inspection. Physical presence MUST NOT activate an extension;
only the Home selection does.

Git extension refs MUST resolve to immutable commits. Update MAY replace an
installed extension mechanically only when its current digest equals its
installed base digest. Divergence MUST stop for explicit adoption or human
merge. Hairness MUST NOT provide a generic three-way merge or migration engine.

## 5. Provider command surface

Standard MUST compile exactly ten human commands: `hairness`,
`hairness-onboarding`, `hairness-scratch`, `hairness-discuss`, `hairness-map`,
`hairness-ideate`, `hairness-propose`, `hairness-recap`, `hairness-plan`, and
`hairness-ship`.

Codex MUST project `$hairness-…`; Claude MUST project `/hairness-…`. A rebuild
MUST produce equivalent semantics. Generated outputs MUST be listed exactly in
Runtime build state and only those exact paths MAY be locally excluded from Git.
Hairness MUST NOT own, ignore, or clear a complete provider directory.

Chat recipes MUST create no operation state or receipt. Recap, map, and plan MUST
render in chat first and MUST persist only the exact accepted payload after an
explicit save request.

## 6. Overlay, Scratch, and Artifact

A provider session MUST begin ephemeral. Without an active Scratch, Hairness
MUST write no work memory. Once attached, notes MAY change only at semantic
boundaries: accepted decisions, changed constraints, handoffs, changed next
steps, park, and close. Transcripts and reasoning traces MUST NOT be stored.

Overlay Git MAY be enabled as a nested local repository. Boundary snapshots
SHOULD be the default; manual snapshots MUST remain available. Hairness MUST NOT
configure a remote or push. Snapshots MUST refuse credential-like paths,
escaping symbolic links, and oversized accidental files.

An Artifact MUST contain one envelope and exactly one canonical payload.
Human-facing payloads SHOULD use Markdown. Machine-consumed payloads MUST use
owner-validated JSON. Git supplies history; internal revision graphs, generated
Markdown mirrors, mandatory relations, labels, and signals MUST NOT exist.
Receipts are separate immutable core records.

## 7. Runtime

Machine state MUST live below `~/.hairness/` in preferences, trust, archives,
and `runtime/<home-id>/`. Runtime MAY contain provider builds, Target bindings,
adaptive checkouts, checkpoints, locks, caches, temporary staging, and logs.
Runtime state MUST NOT be committed to the Home or Overlay.

Legacy Overlays MAY be copied opaquely into archives without schema parsing.
Only user-selected human content MAY be imported through the generic Scratch
importer.

## 8. Effects and receipts

`operation run` MUST accept only observe and derive adapters. `operation prepare`
MUST create a Checkpoint bound to exact inputs, Target identity and state,
evidence, and policy. `operation apply` MUST recompute that state and refuse any
relevant change.

An effect that succeeds, partially succeeds, or has an unknown outcome MUST
produce an immutable Receipt. Partial and unknown outcomes MUST stop replay. Extension
installation and Target registration MUST explicitly grant no operational
authority.

## 9. Onboarding and creation

The create wizard MUST use the platform readline API and ask, in order: language,
setup, providers, detected first Target, and local Overlay Git. Standard MUST be
recommended. Home Git and an initial local commit are mandatory. Overlay Git is
optional and, when selected, receives its own initial local commit.

Creation MUST occur in Runtime staging. Install, build, and doctor MUST pass
before an atomic move to the destination. Failure MUST leave no partial
destination. Creation MUST NOT configure a remote, push, tag, or publication.

Agent onboarding MUST use the selected language from its first reply, save a
resumable draft after every answer, progressively explain Home, Target, Scratch,
persistence and checkpoints, and finish with a short command tour. Composition
changes MUST show an exact diff and require a checkpoint.

## 10. Delivery

Delivery MUST create no durable state until the human accepts a typed
DeliveryBrief. The brief MUST contain outcome, acceptance criteria, scope,
non-goals, Target, base, release impact, and required checks.

Checkout policy MUST be adaptive: reuse a clean, available, compatible checkout;
isolate dirty, occupied, incompatible, or explicitly parallel work in an internal
Git worktree. Scratch remains the work identity. Runtime owns checkout paths and
locks. No public worktree controller, pool, lease, takeover, or hook may exist.

Named stages are `after-implementation`, `before-publish-pr`, `before-merge`, and
`after-merge`. Extensions MAY contribute gates. Scope drift MUST block PR
publication. PR, merge, tag, release, and package publication remain separate
effects. Cleanup MUST refuse dirty or externally used worktrees and MUST NOT
force deletion implicitly.

## 11. Compatibility

v0.3 MUST NOT provide v0.2 command aliases, schema readers, runtime bridges,
Home upgrades, Overlay conversion, migration descriptors, or a legacy
documentation tree. The supported upgrade is to create a new Home. Published
v0.2 packages remain available for users who pin them.
