# Generic extension catalogue

This catalogue is verified against extension manifests. Physical presence in the forge never activates an extension.

| Extension | Capability | Minimal | Standard | Forge |
| --- | --- | ---: | ---: | ---: |
| `hairness/cockpit` | opening, help, onboarding and wake-up rendering | yes | yes | yes |
| `hairness/distribution` | provenance and conservative updates | yes | yes | yes |
| `hairness/work-controls` | persistent work, recap, plan, act and execute | no | yes | yes |
| `hairness/understanding-controls` | map, explain and compare | no | yes | yes |
| `hairness/ideation-controls` | ideate, propose and creative strategy | no | yes | yes |
| `hairness/presentation-controls` | bounded presentation policies and views | no | yes | yes |
| `hairness/constraints` | inherited effect policies | no | yes | yes |
| `hairness/session-intelligence` | local continuity and semantic handoff | no | yes | yes |
| `hairness/codebase` | repository identity, mounts and bounded maps | no | yes | yes |
| `hairness/sources` | selected read-only source drivers and evidence | no | Git only | full generic catalogue |
| `hairness/maintainer` | forge status, impact, tests and evals | no | no | yes |

The generic source driver catalogue currently contains Git, Jira, GitLab, and AWS. Standard selects Git only; generation removes every unselected driver.
