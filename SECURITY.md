# Security policy

Report vulnerabilities privately through GitHub Security Advisories. Do not
publish credentials, customer data, transcripts or hidden reasoning in an issue.

Extensions are trusted source. Hairness validates manifests, paths, symlinks and
provider-neutral sources before activation; inspection does not import extension
code. Git sources are pinned to an immutable commit and local divergence blocks
mechanical updates. Home installation uses `npm install --ignore-scripts`.

Target bindings are ignored symlinks and grant no authority. Integration
declarations never install or authenticate a CLI/provider. Generated provider
output is path-exact and unmanaged native files are preserved. Local machine
state stays in ignored `.hairness/`; tracked Overlay contains only human
preferences, Scratches and deliberately accepted documents.
