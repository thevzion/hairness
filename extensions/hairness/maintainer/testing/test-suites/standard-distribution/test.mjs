import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { forgeActor, ok } from '../_shared.mjs'
export default { id: 'standard-distribution', actor: forgeActor, async test({ sandbox, checks }) { const recipe = JSON.parse(await readFile(join(sandbox.workspace, 'catalog/standard.json'), 'utf8')); ok(checks, 'standard-team-ready', recipe.extensions.includes('hairness/workframes') && recipe.extensions.includes('hairness/maintainer')); ok(checks, 'standard-generic-only', recipe.extensions.every((id) => id.startsWith('hairness/'))) } }
