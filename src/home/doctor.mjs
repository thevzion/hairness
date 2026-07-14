import { access } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { activeExtensions, inspectHomeConfig } from '../composition/extensions.mjs'
import { loadHome, loadHomeLock } from './index.mjs'
import { readJson, treeDigest } from '../lib/io.mjs'
import { buildProviders } from '../providers/v3-compiler.mjs'
import { activeScratch } from '../scratch/index.mjs'
import { doctorTargets } from '../targets/index.mjs'
import { doctorSources } from '../sources/index.mjs'
import { listArtifacts } from '../artifacts/index.mjs'
import { loadProfile } from '../profile/index.mjs'
import { overlayPaths } from '../overlay/index.mjs'

export async function doctorHome(root, options = {}) {
  const home = await loadHome(root)
  const lock = await loadHomeLock(root)
  const extensions = await activeExtensions(root, home)
  const limits = []
  const routes = []
  if (lock.metadata.id !== home.metadata.id) limits.push('home-lock-mismatch')

  for (const extension of extensions) {
    const entry = lock.extensions.find((item) => item.id === extension.manifest.metadata.id)
    if (!entry) limits.push(`extension-unlocked:${extension.manifest.metadata.id}`)
    else if (await treeDigest(extension.root) !== entry.installedBaseDigest) limits.push(`extension-diverged:${entry.id}`)
  }

  const config = await inspectHomeConfig(root, home, extensions)
  limits.push(...config.limits.map((item) => item.code))
  const profile = await loadProfile(root, { optional: true })
  if (!profile) {
    limits.push('profile-missing')
    routes.push('hairness onboarding status')
  }

  if (!options.allowMissingDependency) {
    const localPackage = await readJson(join(root, 'package.json'), {})
    if (localPackage.name !== '@hairness/cli') {
      await access(join(root, 'node_modules', '@hairness', 'cli', 'package.json')).catch(() => {
        limits.push('dependency-missing:@hairness/cli')
        routes.push('npm install')
      })
    }
  }

  let build = { status: 'ready' }
  if (profile) {
    try { await buildProviders(root, { check: true }) } catch (error) {
      build = { status: 'stale', error: { code: error.code, message: error.message } }
      limits.push(`provider-build:${error.code}`)
      routes.push('hairness build')
    }
  } else build = { status: 'blocked', error: { code: 'profile-missing' } }

  const targets = await doctorTargets(root)
  const sources = await doctorSources(root)
  limits.push(...targets.limits, ...sources.limits)
  const onboardingDraft = await readJson(overlayPaths(root).onboardingDraft, null)
  const onboarding = { status: onboardingDraft?.status ?? 'not-started', configured: onboardingDraft?.status === 'complete' }
  const scratch = await activeScratch(root, options.session, { readOnly: true })
  const maps = await targetMaps(root, targets.targets)
  const critical = limits.filter((limit) => !limit.startsWith('target-recommended-') && !limit.startsWith('source-recommended-'))
  return {
    status: critical.length ? 'partial' : 'ready',
    home: { id: home.metadata.id, providers: home.spec.providers, extensions: home.spec.extensions },
    profile,
    onboarding,
    build,
    targets: targets.targets,
    sources: sources.sources,
    maps,
    scratch,
    limits: [...new Set(limits)],
    routes: [...new Set(routes)],
  }
}

async function targetMaps(root, targets) {
  const heads = new Map(targets.map((target) => [target.id, target.evidence?.head ?? null]))
  return (await listArtifacts(root)).filter((item) => item.metadata.owner === 'hairness/work' && item.metadata.type === 'target-map').map((item) => {
    const target = item.spec.provenance?.target ?? null
    const head = item.spec.provenance?.head ?? null
    return {
      id: item.metadata.id,
      target,
      head,
      freshness: target && head && heads.get(target) ? (heads.get(target) === head ? 'current' : 'stale') : 'unknown',
      path: relative(root, join(overlayPaths(root).artifacts, item.metadata.owner, item.metadata.type, item.metadata.id)),
    }
  })
}
