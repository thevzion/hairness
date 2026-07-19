import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { buildHome } from './build.mjs'
import { loadHome } from './home.mjs'
import { HairnessError } from './lib/errors.mjs'
import { exists, readJson, writeFileAtomic, writeJsonAtomic } from './lib/io.mjs'
import { npm, installArgs } from './npm.mjs'
import {
  activeExtensions,
  dependencyValue,
  inspectPackage,
  packageNameFromSpec,
  readCatalog,
  validateComposition,
  validateHomeInstallSpec,
} from './packages.mjs'

export async function listExtensions(root) {
  const home = await loadHome(root)
  const packageDocument = await readJson(join(root, 'package.json'))
  return Promise.all(home.spec.extensions.map(async (entry) => {
    const extension = await inspectPackage(root, entry.package, 'Extension')
    return {
      package: entry.package,
      version: extension.version,
      source: packageDocument.dependencies?.[entry.package] ?? null,
      subtype: extension.manifest.subtype,
      execution: entry.execution ?? null,
    }
  }))
}

export async function addExtension(root, requestedSpec, options = {}) {
  const spec = await resolveRequestedSpec(root, requestedSpec)
  await validateHomeInstallSpec(root, spec)
  return transaction(root, async () => {
    const beforePackage = await readJson(join(root, 'package.json'))
    await npm(root, installArgs(spec))
    const packageDocument = await readJson(join(root, 'package.json'))
    const name = packageNameFromSpec(spec) ?? addedDependency(beforePackage, packageDocument)
    if (!name) throw new HairnessError('package_identity_missing', `Could not determine the package installed by ${spec}.`)
    const home = await loadHome(root)
    if (home.spec.extensions.some((entry) => entry.package === name)) throw new HairnessError('extension_active', `${name} is already active.`)
    await activate(root, home, packageDocument, name, options.allowBuild)
    await writeJsonAtomic(join(root, 'package.json'), packageDocument, 0o644)
    await npm(root, installArgs())
    await validateComposition(await activeExtensions(root, home))
    await writeJsonAtomic(join(root, 'hairness.json'), home, 0o644)
    await buildHome(root)
    return { status: 'active', package: name }
  })
}

export async function updateExtension(root, name, spec, options = {}) {
  await validateHomeInstallSpec(root, spec)
  if (packageNameFromSpec(spec) && packageNameFromSpec(spec) !== name) throw new HairnessError('package_identity_mismatch', `${spec} does not update ${name}.`)
  return transaction(root, async () => {
    const home = await loadHome(root)
    const selected = home.spec.extensions.find((entry) => entry.package === name)
    if (!selected) throw new HairnessError('extension_inactive', `${name} is not active.`)
    await npm(root, installArgs(spec))
    const extension = await inspectPackage(root, name, 'Extension')
    if (extension.manifest.subtype === 'adapter' && !options.allowBuild) {
      throw new HairnessError('adapter_approval_required', `${name} requires --allow-build when updated.`)
    }
    const packageDocument = await readJson(join(root, 'package.json'))
    for (const required of extension.manifest.requires ?? []) await activate(root, home, packageDocument, required, options.allowBuild)
    await writeJsonAtomic(join(root, 'package.json'), packageDocument, 0o644)
    await npm(root, installArgs())
    await validateComposition(await activeExtensions(root, home))
    await writeJsonAtomic(join(root, 'hairness.json'), home, 0o644)
    await buildHome(root)
    return { status: 'active', action: 'update', package: name, version: extension.version }
  })
}

export async function removeExtension(root, name) {
  return transaction(root, async () => {
    const home = await loadHome(root)
    const extensions = await activeExtensions(root, home)
    if (!home.spec.extensions.some((entry) => entry.package === name)) throw new HairnessError('extension_inactive', `${name} is not active.`)
    const requiredBy = extensions.filter((entry) => (entry.manifest.requires ?? []).includes(name)).map((entry) => entry.name)
    if (requiredBy.length) throw new HairnessError('extension_required', `${name} is required by ${requiredBy.join(', ')}.`)
    home.spec.extensions = home.spec.extensions.filter((entry) => entry.package !== name)
    delete home.spec.config[name]
    await writeJsonAtomic(join(root, 'hairness.json'), home, 0o644)
    await npm(root, ['uninstall', '--ignore-scripts', '--no-audit', '--no-fund', name])
    await buildHome(root)
    return { status: 'removed', package: name }
  })
}

export async function listCatalogs(root) {
  const home = await loadHome(root)
  return Promise.all(home.spec.catalogs.map(async (selection) => {
    const catalog = await readCatalog(root, selection.package)
    return { ...selection, version: catalog.version, entries: Object.keys(catalog.entries).length }
  }))
}

export async function addCatalog(root, id, spec) {
  await validateHomeInstallSpec(root, spec)
  return transaction(root, async () => {
    const home = await loadHome(root)
    if (home.spec.catalogs.some((entry) => entry.id === id)) throw new HairnessError('catalog_exists', `Catalog ${id} already exists.`)
    const beforePackage = await readJson(join(root, 'package.json'))
    await npm(root, installArgs(spec))
    const packageDocument = await readJson(join(root, 'package.json'))
    const name = packageNameFromSpec(spec) ?? addedDependency(beforePackage, packageDocument)
    await readCatalog(root, name)
    home.spec.catalogs.push({ id, package: name })
    await writeJsonAtomic(join(root, 'hairness.json'), home, 0o644)
    return { status: 'active', id, package: name }
  })
}

export async function updateCatalog(root, id, spec) {
  await validateHomeInstallSpec(root, spec)
  return transaction(root, async () => {
    const home = await loadHome(root)
    const selected = home.spec.catalogs.find((entry) => entry.id === id)
    if (!selected) throw new HairnessError('catalog_missing', `Catalog ${id} is not active.`)
    if (packageNameFromSpec(spec) && packageNameFromSpec(spec) !== selected.package) throw new HairnessError('package_identity_mismatch', `${spec} does not update ${selected.package}.`)
    await npm(root, installArgs(spec))
    const catalog = await readCatalog(root, selected.package)
    return { status: 'active', action: 'update', id, package: selected.package, version: catalog.version }
  })
}

export async function removeCatalog(root, id) {
  return transaction(root, async () => {
    const home = await loadHome(root)
    const selected = home.spec.catalogs.find((entry) => entry.id === id)
    if (!selected) throw new HairnessError('catalog_missing', `Catalog ${id} is not active.`)
    home.spec.catalogs = home.spec.catalogs.filter((entry) => entry.id !== id)
    await writeJsonAtomic(join(root, 'hairness.json'), home, 0o644)
    await npm(root, ['uninstall', '--ignore-scripts', '--no-audit', '--no-fund', selected.package])
    return { status: 'removed', id, package: selected.package }
  })
}

export async function searchCatalogs(root, query = '') {
  const home = await loadHome(root)
  const values = []
  for (const selection of home.spec.catalogs) {
    const catalog = await readCatalog(root, selection.package)
    for (const [id, spec] of Object.entries(catalog.entries)) {
      if (!query || id.includes(query) || spec.includes(query)) values.push({ catalog: selection.id, id, spec })
    }
  }
  return values
}

async function resolveRequestedSpec(root, value) {
  if (!value.startsWith('catalog:')) return value
  const reference = value.slice('catalog:'.length)
  const separator = reference.indexOf('/')
  if (separator < 1) throw new HairnessError('catalog_reference_invalid', 'Catalog reference must be catalog:<catalog>/<entry>.')
  const catalogId = reference.slice(0, separator)
  const entryId = reference.slice(separator + 1)
  const home = await loadHome(root)
  const selection = home.spec.catalogs.find((entry) => entry.id === catalogId)
  if (!selection) throw new HairnessError('catalog_missing', `Catalog ${catalogId} is not active.`)
  const catalog = await readCatalog(root, selection.package)
  const spec = catalog.entries[entryId]
  if (!spec) throw new HairnessError('catalog_entry_missing', `${catalogId} has no entry ${entryId}.`)
  return spec
}

async function activate(root, home, packageDocument, name, allowBuild) {
  if (home.spec.extensions.some((entry) => entry.package === name)) return
  const extension = await inspectPackage(root, name, 'Extension')
  for (const required of extension.manifest.requires ?? []) {
    const declared = extension.document.dependencies?.[required]
    if (!declared) throw new HairnessError('extension_dependency_undeclared', `${name} requires ${required} but does not declare it as an npm dependency.`)
    dependencyValue(`${required}@${declared}`, required)
    packageDocument.dependencies[required] ??= declared
    await activate(root, home, packageDocument, required, allowBuild)
  }
  if (extension.manifest.subtype === 'adapter' && !allowBuild) throw new HairnessError('adapter_approval_required', `${name} requires --allow-build.`)
  home.spec.extensions.push({ package: name, ...(extension.manifest.subtype === 'adapter' ? { execution: 'build' } : {}) })
}

async function transaction(root, action) {
  const files = ['package.json', 'package-lock.json', 'hairness.json']
  const backup = new Map()
  for (const file of files) backup.set(file, await readFile(join(root, file)).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error)))
  try {
    return await action()
  } catch (error) {
    for (const [file, content] of backup) {
      const path = join(root, file)
      if (content === null) await rm(path, { force: true })
      else await writeFileAtomic(path, content, 0o644)
    }
    await npm(root, installArgs()).catch(() => {})
    await buildHome(root).catch(() => {})
    throw error
  }
}

function addedDependency(before, after) {
  const prior = new Set(Object.keys(before.dependencies ?? {}))
  const added = Object.keys(after.dependencies ?? {}).filter((name) => !prior.has(name))
  if (added.length !== 1) return null
  return added[0]
}
