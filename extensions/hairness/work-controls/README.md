# hairness/work-controls

## Value and use cases

Preserves missions, segments and frames so long work can be discussed, recapped, planned and resumed.

## Selection and setup

Selected by standard and forge. Work state starts local and append-only.

## Capabilities and operations

Owns work status, history, trace, resume, dashboard, frame, discuss, recap, plan, system-shape, act and execute bindings.

## Inputs, controls and results

Uses the active scope. `make-*` returns chat responses; `save-*` prepares `SegmentDigest` or enriched `WorkPlan` artifacts at semantic boundaries. `work control set|clear|show` persists ordinary session, segment and frame controls; narrower scopes override broader scopes without changing authority constraints.

## State and artifacts

Events preserve trajectory; typed artifacts preserve meaning. Frames are not artifacts.

## Effects and safety

Execute requires an accepted WorkPlan, current constraints and explicit authority.

## Providers

Projects `hairness-work` as the namespace guide and `hairness-cmd-*` intents for method, dashboard, trace, frame, discuss, recap, plan, next, system-wire, system-shape and execution checkpoints.

## Tests and maturity

Official alpha. Tests cover event state, digest gates, resume and bounded producers.
