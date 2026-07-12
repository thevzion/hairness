# Generic extension catalogue

`hairness extension list --json` is the machine-readable source for the active composition. This page describes the generic catalogue shipped by `@hairness/hairness`.

| Extension | Outcome | Minimal | Standard | Durable output |
| --- | --- | ---: | ---: | --- |
| `hairness/cockpit` | Main-session help, onboarding and wake-up | yes | yes | Context packets |
| `hairness/distribution` | Provenance lock and conservative source-owned updates | yes | yes | Update plans and receipts |
| `hairness/workframes` | Persistent work trajectory and accepted plans | no | yes | Segment digests, work plans |
| `hairness/presentation-controls` | Smallest useful result views | no | yes | Presentation requests |
| `hairness/constraints` | Inherited operation-scoped effect policies | no | yes | Local constraint state |
| `hairness/session-intelligence` | Provider associations and semantic handoffs | no | yes | Session handoffs |
| `hairness/maintainer` | Forge status, impact, qualification and release preparation | no | no | Receipts and attestations |
| `hairness/codebase` | Repository identity, mounts and bounded maps | no | yes | Codebase and system maps |
| `hairness/source-controls` | Typed access to selected deterministic sources | no | yes | Source evidence |
| `hairness/git` | Branch, remote, divergence and overlap proof | no | yes | Read-only evidence |
| `hairness/jira` | Issue and hierarchy proof through the local CLI | no | no | Read-only evidence |
| `hairness/gitlab` | Project, merge request, approval and pipeline proof | no | no | Read-only evidence |
| `hairness/aws` | CLI version, profiles and caller identity proof | no | no | Read-only evidence |

Extensions outside a recipe remain catalogue source in the forge and are never copied into generated distributions implicitly.
