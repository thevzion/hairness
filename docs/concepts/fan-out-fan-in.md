# Fan-out and fan-in

Fan-out distributes only work that benefits from separation. A single bounded task uses one route.

Every ContextPlan declares how route results return:

- deterministic merge combines compatible structured components;
- semantic reduction uses one producer assignment;
- required failures block success;
- optional failures become explicit limits.

The main session receives the reduction, proof references, and limits—not a bundle of raw worker output.

Parallel delivery uses one plan, managed worktree and writer lease per worker.
Workers receive neither provider conversation history nor permission to create
nested workers. Their results fan back into the owning plan; a checkout or
lease collision is a blocked result, not an invitation to share a working tree.
