# Hairness architecture

The Home is the durable, provider-agnostic place where agents work. It owns
source files, explicit local Overlay state and projections. Targets point to
independent Git repositories. Assets are autonomous, source-owned collections
of agentic material copied under `assets/<namespace>/<name>`.

`@hairness/cli` is the only package and Kernel. It validates the Home, manages
Assets, Targets and Integrations, projects provider outputs, builds the prologue and
stages explicitly approved Adapters. Git owns history; `.hairness/build.json`
records only local output ownership and digests.

Installation and synchronization copy files only. They never execute code.
Adapters run only during an explicitly approved build, inside bounded staging,
and may write only declared outputs.
