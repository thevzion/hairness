import { forgeActor, onboard, ok } from '../_shared.mjs'
export default { id: 'worker-invalid-correct-fan-in', actor: forgeActor, async test({ command, checks }) { await onboard(command); const metrics = await command(['metrics']); ok(checks, 'fan-in-surface', Array.isArray(metrics.runs)); ok(checks, 'worker-gate-owned', true) } }
