# Semantic results

ResultContract combines output schema and disposition:

| Disposition | Boundary |
| --- | --- |
| `response` | Provider UI only |
| `run-only` | Canonical run result |
| `scratch` | Disposable owner/run namespace |
| `artifact` | Validated, revisioned semantic meaning |
| `effect` | Exact authority, target, lock, and receipt |

The rule is deliberately conservative: persist meaning at semantic boundaries, not every model output.

Operations may expose several named results. Provider intent commands choose
one through `draft.result`: `make-*` selects a response result, while `save-*`
selects an artifact result. Progress policy and persistence policy are
separate; `--auto` never converts a response into an artifact.
