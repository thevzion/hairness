# Sources and drivers

`hairness/sources` is an extension-owned engine for selected proof transports. It owns list, doctor, read, evidence validation, redaction, and freshness.

Drivers are declared assets:

```text
drivers/<id>/
├── driver.json
└── index.mjs   optional parser/transport implementation
```

The distribution selects drivers in `hairness.json.sources`. Minimal selects none. Standard selects Git. A forge can retain Git, Jira, GitLab, and AWS as dormant catalogue material. Generation physically removes unselected drivers.

Business extensions depend on `hairness/sources` and call its services. The kernel knows no Git, Jira, GitLab, AWS, CLI, connector, or MCP ID.

Local CLIs can provide strict deterministic proof. MCP and provider connectors can be drivers or best-effort assistance. SourceEvidence records the exact operation, transport, observation time, proof, data, limits, and freshness without credentials.
