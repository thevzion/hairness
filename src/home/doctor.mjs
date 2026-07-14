import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { activeExtensions } from '../composition/extensions.mjs'
import { loadHome, loadHomeLock } from './index.mjs'
import { HairnessError } from '../lib/errors.mjs'
import { digest, exists, readJson, treeDigest } from '../lib/io.mjs'
import { buildProviders } from '../providers/v3-compiler.mjs'
import { runtimePaths, targetBindings } from '../runtime/index.mjs'
import { inspectGit } from '../runtime/git.mjs'

export async function doctorHome(root, options = {}) {
  const home = await loadHome(root)
  const lock = await loadHomeLock(root)
  const extensions = await activeExtensions(root, home)
  const limits = []
  if (lock.metadata.id !== home.metadata.id) throw new HairnessError('home_lock_mismatch', 'Home and lock identities differ.')
  for (const extension of extensions) {
    const entry = lock.extensions.find((item) => item.id === extension.manifest.metadata.id)
    if (!entry) throw new HairnessError('extension_unlocked', `${extension.manifest.metadata.id} is active but absent from hairness.lock.json.`)
    const current = await treeDigest(extension.root)
    if (current !== entry.installedBaseDigest) limits.push(`extension-diverged:${entry.id}`)
  }
  if (!options.allowMissingDependency) {
    await access(join(root, 'node_modules', '@hairness', 'cli', 'package.json')).catch(() => {
      throw new HairnessError('dependency_missing', 'Run npm install to restore the pinned @hairness/cli runtime.')
    })
  }
  await buildProviders(root, { check: true })
  const bindings = await targetBindings(home)
  const targets = []
  for (const target of home.spec.targets) {
    const binding = bindings.targets[target.id]
    if (!binding) {
      limits.push(`target-unbound:${target.id}`)
      continue
    }
    const evidence = await inspectGit(binding.path)
    targets.push({ id: target.id, path: binding.path, head: evidence.head, branch: evidence.branch, clean: evidence.clean })
  }
  return { status: limits.length ? 'partial' : 'ready', home: home.metadata.id, extensions: extensions.map((item) => item.manifest.metadata.id), providers: home.spec.providers, targets, limits }
}

