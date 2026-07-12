# Artifacts

Artifacts preserve durable orientation produced by runs. Each artifact has one active extension owner, a typed payload, deterministic rendering, revision history, annotations, labels, signals, relations, and a freshness policy.

Artifacts do not replace live proof. A ticket map can orient an implementation, but Hairness revalidates the ticket and codebase state before granting executor authority.

Scratch remains untyped and never enters context automatically.

```bash
hairness artifact list --owner hairness/work-controls
hairness artifact list --label work
hairness artifact related work/composable-forge-recap
hairness artifact graph work/composable-forge-recap
```

`artifact.json` is canonical. Generated Markdown carries Hairness frontmatter and must not be edited directly. The Markdown projection is intentionally human-first: summary, dashboard, decisions, steps, proof, limits and routes appear before the raw `Payload JSON` section. Agents may read it for orientation, but source-owned JSON and live sources remain the proof boundary.
