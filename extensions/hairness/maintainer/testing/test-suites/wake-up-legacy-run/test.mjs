import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { forgeActor, onboard, ok } from '../_shared.mjs'
export default { id: 'wake-up-legacy-run', actor: forgeActor, async test({ sandbox, command, checks }) { await onboard(command); const path = join(sandbox.workspace, '.overlay/runs/legacy-01'); await mkdir(path, { recursive: true }); await writeFile(join(path, 'task.json'), JSON.stringify({ schemaVersion: 1, protocolVersion: '0.1' })); const wake = await command(['wake-up'], 300); ok(checks, 'legacy-run-contained', wake.attention.some((item) => /incompatible local run/.test(item.summary))) } }
