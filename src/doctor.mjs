import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { activeExtensions, validateExtensionConfig } from './extensions.mjs'
import { loadHome, loadHomeLock, loadLocalConfig } from './home.mjs'
import { doctorIntegrations } from './integrations.mjs'
import { buildProviders } from './providers/compiler.mjs'
import { doctorTargets } from './targets.mjs'

export async function doctorHome(root) {
  const [home, lock, config] = await Promise.all([loadHome(root), loadHomeLock(root), loadLocalConfig(root)])
  const extensions = await activeExtensions(root, home)
  const [targets, integrations, configLimits, dependency] = await Promise.all([
    doctorTargets(root),
    doctorIntegrations(root),
    validateExtensionConfig(home, extensions),
    access(join(root, 'node_modules', '@hairness', 'cli', 'package.json')).then(() => 'installed', () => 'missing'),
  ])
  const limits = [...targets.limits, ...integrations.limits]
  if (home.metadata.id !== lock.metadata.id) limits.push('lock-home-mismatch')
  for (const extension of extensions) {
    const entry = lock.extensions.find((item) => item.id === extension.manifest.metadata.id)
    if (!entry) limits.push(`extension-unlocked:${extension.manifest.metadata.id}`)
    else if (entry.digest !== extension.digest) limits.push(`extension-diverged:${extension.manifest.metadata.id}`)
  }
  for (const item of configLimits) limits.push(`extension-config-invalid:${item.id}`)
  if (dependency === 'missing') limits.push('kernel-dependency-missing')
  let build = 'ready'
  try {
    await buildProviders(root, { check: true })
  } catch (error) {
    build = 'stale'
    limits.push(`build:${error.code ?? 'invalid'}`)
  }
  return {
    status: limits.length ? 'partial' : 'ready',
    home: { id: home.metadata.id, providers: home.spec.providers },
    profile: config.preferences,
    kernel: { ...lock.kernel, dependency },
    extensions: extensions.map((extension) => ({ id: extension.manifest.metadata.id, version: extension.manifest.metadata.version })),
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
  if (limits.some((limit) => limit.startsWith('extension-'))) routes.push('hairness extension doctor')
  return [...new Set(routes)]
}
