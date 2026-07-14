import { loadHome } from '../home/index.mjs'
import { HairnessError } from '../lib/errors.mjs'
import { targetBindings } from '../runtime/index.mjs'
import { git, inspectGit } from '../runtime/git.mjs'

const views = new Set(['tree', 'dependencies', 'boundaries', 'flow'])

export async function mapTarget(root, id, options = {}) {
  const home = await loadHome(root)
  const target = home.spec.targets.find((item) => item.id === id)
  if (!target) throw new HairnessError('target_missing', `Target ${id} is not registered.`)
  const bindings = await targetBindings(home)
  const binding = bindings.targets[id]
  if (!binding) throw new HairnessError('target_unbound', `Target ${id} has no local path binding.`)
  const view = options.view ?? 'tree'
  if (!views.has(view)) throw new HairnessError('map_view_invalid', `Unsupported map view: ${view}.`)
  const evidence = await inspectGit(binding.path)
  const files = (await git(['ls-files'], { cwd: binding.path })).split('\n').filter(Boolean)
  const focus = String(options.focus ?? '').toLowerCase()
  const scope = options.scope ? String(options.scope).replace(/^\.\//, '') : null
  const selected = files.filter((file) => (!scope || file === scope || file.startsWith(`${scope}/`)) && (!focus || file.toLowerCase().includes(focus))).slice(0, options.limit ?? 200)
  return {
    status: selected.length < files.length ? 'partial' : 'complete',
    target: { id, head: evidence.head, branch: evidence.branch },
    focus: options.focus ?? null,
    scope,
    view,
    files: selected,
    limits: selected.length < files.length ? [`map-capped:${options.limit ?? 200}`] : [],
    persistence: 'none',
  }
}

