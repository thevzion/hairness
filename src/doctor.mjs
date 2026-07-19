import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { buildHome } from './build.mjs'
import { loadHome, loadLocalConfig } from './home.mjs'
import { doctorIntegrations } from './integrations.mjs'
import { exists, readJson } from './lib/io.mjs'
import { activeExtensions, inspectPackage, validateDependencySource, validateExtensionConfig } from './packages.mjs'
import { doctorTargets } from './targets.mjs'

export async function doctorHome(root, options = {}) {
  const [home, local, packageDocument, targets, integrations] = await Promise.all([
    loadHome(root),
    loadLocalConfig(root),
    readJson(join(root, 'package.json')),
    doctorTargets(root),
    doctorIntegrations(root),
  ])
  const extensions = await activeExtensions(root, home)
  const configLimits = await validateExtensionConfig(home, extensions)
  const limits = [...targets.limits, ...integrations.limits]
  if (!await exists(join(root, 'package-lock.json'))) limits.push('package-lock-missing')
  if (await exists(join(root, 'hairness.lock.json'))) limits.push('legacy-home-lock-present')
  for (const name of ['@hairness/cli', home.spec.starter, ...home.spec.extensions.map((entry) => entry.package), ...home.spec.catalogs.map((entry) => entry.package)]) {
    const source = packageDocument.dependencies?.[name]
    if (!source) {
      limits.push(`package-not-direct:${name}`)
      continue
    }
    try {
      await validateDependencySource(root, name, source)
    } catch (error) {
      limits.push(`package-source-invalid:${name}:${error.code ?? 'invalid'}`)
    }
  }
  for (const entry of configLimits) limits.push(`extension-config-invalid:${entry.package}`)
  const dependency = await access(join(root, 'node_modules', '@hairness', 'cli', 'package.json')).then(() => 'installed', () => 'missing')
  if (dependency === 'missing') limits.push('kernel-dependency-missing')
  let build = 'ready'
  try {
    await buildHome(root, { check: true, adapterHomeRoot: options.adapterHomeRoot })
  } catch (error) {
    build = 'stale'
    limits.push(`build:${error.code ?? 'invalid'}`)
  }
  const starter = await inspectPackage(root, home.spec.starter, 'Starter')
  return {
    status: limits.length ? 'partial' : 'ready',
    home: { id: home.metadata.id, providers: home.spec.providers },
    profile: local.preferences,
    kernel: { package: '@hairness/cli', source: packageDocument.dependencies?.['@hairness/cli'] ?? null, dependency },
    starter: { package: starter.name, version: starter.version },
    extensions: extensions.map((extension) => ({ package: extension.name, version: extension.version, subtype: extension.manifest.subtype })),
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
