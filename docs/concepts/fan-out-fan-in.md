# Fan-out and fan-in

Fan-out distributes only work that benefits from separation. A single bounded task uses one route.

Every ContextPlan declares how route results return:

- deterministic merge combines compatible structured components;
- semantic reduction uses one producer assignment;
- required failures block success;
- optional failures become explicit limits.

The main session receives the reduction, proof references, and limits—not a bundle of raw worker output.
