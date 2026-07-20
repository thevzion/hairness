import { join } from 'node:path'
import { buildHome } from './build.mjs'
import { RUNTIME, loadHome, loadLocalConfig } from './home.mjs'
import { doctorIntegrations } from './integrations.mjs'
import { installedItems, itemStatus } from './items.mjs'
import { exists } from './lib/io.mjs'
import { doctorTargets } from './targets.mjs'

export async function doctorHome(root, options = {}) {
  const [home, local, targets, integrations, installed] = await Promise.all([
    loadHome(root),
    loadLocalConfig(root),
    doctorTargets(root),
    doctorIntegrations(root),
    installedItems(root),
  ])
  const extensions = await Promise.all(installed.map(itemStatus))
  const limits = [...targets.limits, ...integrations.limits]
  if (home.runtime !== RUNTIME) limits.push(`runtime-mismatch:${home.runtime}`)
  if (await exists(join(root, 'hairness.lock.json'))) limits.push('legacy-home-lock-present')
  for (const extension of extensions) if (extension.state !== 'clean') limits.push(`extension-${extension.state}:${extension.id}`)
  let build = 'ready'
  try {
    await buildHome(root, { check: true, adapterHomeRoot: options.adapterHomeRoot })
  } catch (error) {
    build = 'stale'
    limits.push(`build:${error.code ?? 'invalid'}`)
  }
  return {
    status: limits.length ? 'partial' : 'ready',
    home: { id: root.split('/').at(-1), providers: home.providers },
    profile: local.preferences,
    kernel: { runtime: home.runtime, current: RUNTIME },
    extensions,
    targets: targets.targets,
    integrations: integrations.integrations,
    build,
    limits,
    routes: repairRoutes(limits),
  }
}

function repairRoutes(limits) {
  const routes = []
  if (limits.some((limit) => limit.startsWith('build:'))) routes.push('hairness build')
  if (limits.some((limit) => limit.startsWith('target-'))) routes.push('hairness target doctor')
  if (limits.some((limit) => limit.startsWith('integration-'))) routes.push('hairness integration doctor')
  if (limits.some((limit) => limit.startsWith('extension-'))) routes.push('hairness status')
  if (limits.some((limit) => limit.startsWith('runtime-'))) routes.push('use hairness.json#runtime')
  return [...new Set(routes)]
}
