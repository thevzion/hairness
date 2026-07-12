import { forgeActor, onboard, ok } from '../_shared.mjs'
export default { id: 'wake-up-ready', actor: forgeActor, async test({ command, checks }) { await onboard(command); const wake = await command(['wake-up'], 300); ok(checks, 'wake-up-result', ['ready', 'blocked'].includes(wake.status)); ok(checks, 'bounded-attention', (wake.attention ?? []).length <= 20) } }
