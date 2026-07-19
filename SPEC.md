# Hairness 0.4 specification

Status: alpha
Packages: `@hairness/cli`, `@hairness/native`, `@hairness/starter`

The terms MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are normative.

## 1. Product boundary

Hairness is a local kernel for agent Homes. It composes package-owned agentic
assets into native provider files. It does not replace provider runtimes,
models, sessions, tools or user interfaces.

A Home MUST own its composition and generated assets. A Target MUST remain an
independent Git repository. Binding a Target or Integration MUST NOT grant
authority to mutate it.

## 2. Public documents

| Document | API |
| --- | --- |
| Home | `hairness.dev/home/v1alpha3` |
| Package manifest | `hairness.dev/package/v1alpha1` |
| Catalog index | `hairness.dev/catalog/v1alpha1` |
| Prologue model | `hairness.dev/prologue/v1alpha1` |

Public documents MUST reject unknown fields. Package versions MUST use SemVer.

## 3. Home

A Home MUST contain:

- `package.json` with direct dependencies for the CLI, Starter, active
  Extensions and active Catalogs;
- `package-lock.json` as its only dependency lock;
- `hairness.json` for provider, package, Target, Integration and namespaced
  Extension configuration;
- `.overlay/config.json` for bounded personal preferences and local Integration
  bindings;
- ignored `.hairness/build.json` for generated output owners and digests.

`hairness.lock.json` MUST NOT exist.

Tracked configuration MUST NOT contain local Target paths. A local Target binding
MUST be an ignored `targets/<id>` symbolic link whose Git remote matches the
declared repository identity.

## 4. Package kinds

`package.json#hairness` is canonical.

### Starter

A Starter declares providers, required Extensions, optional Catalogs, template
files, Extension config, Targets and Integrations. Creation MUST promote every
required package to a direct Home dependency. A Starter has no runtime role
after creation.

### Extension

An Extension declares a summary, subtype and contributions. Static contributions
MAY include instructions, Skills, command projections, explicit files and a
bounded prologue contributor.

Composition MUST reject missing required Extensions, duplicate Skill IDs,
duplicate command outputs, invalid config and output owner collisions. Installed
package presence MUST NOT activate an Extension; only `hairness.json` does.

### Adapter

An Adapter is an executable Extension subtype. Its manifest MUST declare one
Node entry and one or more output roots.

An Adapter MUST run only during `hairness build`, only when its Home selection
contains `execution: "build"`, and only after the user supplied
`--allow-build` during add, update or creation.

Hairness MUST run it in staging with a bounded environment, time and output
size. Symbolic links, undeclared paths, owner collisions and writes over
unmanaged files MUST fail before partial output is accepted. Adapter output is
trusted package code, not an operating-system sandbox.

### Catalog

A Catalog points to a JSON object whose entry IDs map to exact package specs.
Catalog installation is optional. Direct Extension installation MUST remain
available.

## 5. Package sources

Accepted package specs are:

- exact npm versions such as `@acme/review@1.2.3`;
- Git URLs ending in an exact SemVer tag or 40-character commit SHA;
- local `file:` packages, normally tracked under the Home.

SemVer ranges, branches, `HEAD`, dist-tags and unversioned registry names MUST be
rejected.

Every npm install, update, removal, recovery and creation MUST disable lifecycle
scripts. A failed lifecycle operation MUST restore `package.json`,
`package-lock.json`, `hairness.json` and the last valid build.

## 6. Build

`hairness build` MUST:

1. validate Home and package manifests;
2. validate Extension composition and namespaced config;
3. load static and provider contributions;
4. run approved Adapters in staging;
5. validate every desired output and owner before writing;
6. refuse divergence from previously recorded digests;
7. update exact Git-local exclude entries;
8. write `.hairness/build.json` atomically.

`hairness build --check` MUST perform no write and MUST fail when the desired
composition, managed regions, hook configuration, excludes or output digests
differ.

Hairness MUST preserve unmanaged files in provider directories.

## 7. Creation

`hairness create` MUST build in a sibling temporary directory and atomically
rename a qualified Home to the requested destination. The destination MUST
remain absent on failure.

Creation MUST install exact packages with lifecycle scripts disabled, copy the
Starter template without symbolic links, build provider and Adapter outputs,
run structural doctor checks, initialize Git and create one initial commit. It
MUST configure no remote and perform no push.

Unbound Starter Targets and Integrations MAY leave a new Home operational but
partial until onboarding binds local access.

## 8. Targets and Integrations

Target discovery MUST be read-only, ignore symbolic-link traversal and common
dependency caches, inspect Git remotes, and return all candidates without
choosing between clones.

Target bind MUST verify remote identity before creating a local symbolic link.
Target removal MUST remove only the Home binding and declaration.

An Integration declares allowed CLI or provider accessors. A local binding MUST
select one declared accessor for one active provider. Hairness MUST NOT install,
authenticate or persist credentials for an Integration.

## 9. Prologue and memory

The prologue MUST separate preferences, observed facts and repair signals. An
Extension contributor MUST execute in a separate bounded Node process and return
only typed facts and signals. Secret-like output MUST be rejected.

Sessions are ephemeral. Hairness Native MAY persist an explicit Scratch only
when the user requests it. It MUST NOT persist transcripts or hidden reasoning.

## 10. Release

Core packages MUST be qualified and published in this order:

1. `@hairness/native@0.4.0-alpha.0`
2. `@hairness/starter@0.4.0-alpha.0`
3. `@hairness/cli@0.4.0-alpha.0`

They MUST use the `next` dist-tag. A resumed release MUST compare an existing
registry version with the qualified artifact integrity and MUST NOT republish a
matching version. A mismatch MUST stop the release.

npm publication, Git tag creation and GitHub prerelease creation are separate
approved effects.

## 11. Compatibility

Hairness 0.4 is a clean reconstruction. It has no reader, migration engine or
compatibility shim for the removed 0.3 source model, schemas, lockfile,
Distributions, extension registry or operation framework.

Existing consumers migrate on independent branches by replacing the package
graph and Home document. Target repositories and explicit human memory remain
independent of the Kernel reset.
