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
