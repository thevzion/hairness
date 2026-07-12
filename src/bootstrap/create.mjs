import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { cp, lstat, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { HairnessError } from '../core/errors.mjs'
import { PROTOCOL_VERSION, SCHEMA_VERSION, readJson, userPaths, writeJsonAtomic } from '../core/io.mjs'
import { validateContract } from '../core/contracts.mjs'
import { digestMaterial } from '../distribution/update-engine.mjs'

const exec = promisify(execFile)
const sourceRoot = fileURLToPath(new URL('../../', import.meta.url))
const implementationVersion = '0.2.0-alpha.0'

function slug(value) {
  const output = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  if (!output) throw new HairnessError('invalid_distribution_name', `Cannot derive a name from ${value}.`, { exitCode: 2 })
  return output
}

function createId(target) {
  return createHash('sha256').update(resolve(target)).digest('hex').slice(0, 12)
}

function statePath(id) {
  return join(userPaths().creates, `${id}.json`)
}

function gaps(target, recipes) {
  const name = slug(basename(target))
  const detectedLanguage = (process.env.LANG ?? Intl.DateTimeFormat().resolvedOptions().locale ?? 'en').toLowerCase().startsWith('fr') ? 'fr' : 'en'
  const languageOptions = detectedLanguage === 'fr'
    ? [{ value: 'fr', label: 'Français (détecté)' }, { value: 'en', label: 'English' }]
    : [{ value: 'en', label: 'English (detected)' }, { value: 'fr', label: 'Français' }]
  return [
    { id: 'language', question: 'Confirm the language Hairness should use.', options: languageOptions },
    { id: 'name', question: 'What is the distribution name?', allowCustom: true, options: [{ value: name, label: name }] },
    { id: 'displayName', question: 'What display name should providers show?', allowCustom: true, options: [{ value: name, label: name }] },
    { id: 'providerPrefix', question: 'Which provider command prefix should Hairness use?', allowCustom: true, options: [{ value: name, label: name }, { value: 'hairness', label: 'hairness' }] },
    { id: 'cliAlias', question: 'Should the distribution add a CLI alias?', allowCustom: true, options: [{ value: 'none', label: 'No alias' }, { value: name, label: name }] },
    { id: 'starter', question: 'Which starter should Hairness materialize?', options: recipes.map((recipe) => ({ value: recipe.id, label: recipe.displayName })) },
    { id: 'extensions', question: 'Which initial extensions should be copied?', allowCustom: true, options: [{ value: 'preset', label: 'Use starter extensions' }] },
    { id: 'providers', question: 'Which repo-local provider projections should be generated?', options: [{ value: 'both', label: 'Codex and Claude' }, { value: 'codex', label: 'Codex' }, { value: 'claude', label: 'Claude' }] },
    { id: 'codebases', question: 'Which codebase catalog should be created?', options: [{ value: 'preset', label: 'Use starter codebases' }, { value: 'later', label: 'Configure later' }] }
  ]
}

async function loadState(id) {
  const state = await readJson(statePath(id), null)
  if (!state) throw new HairnessError('create_unknown', `Unknown create operation: ${id}`, { exitCode: 2 })
  return state
}

async function saveState(state) {
  await mkdir(userPaths().creates, { recursive: true })
  await writeJsonAtomic(statePath(state.id), state)
  return state
}

export async function startCreate(target, preset = 'standard') {
  if (!target) throw new HairnessError('usage', 'Usage: hairness create <target> or hairness create start <target>', { exitCode: 2 })
  const absolute = resolve(target)
  const id = createId(absolute)
  const recipes = await availableRecipes()
  const selectedRecipe = recipes.find((recipe) => recipe.id === preset)
  if (!selectedRecipe) throw new HairnessError('starter_unavailable', `Starter is unavailable from configured catalog roots: ${preset}`, { exitCode: 4 })
  const state = {
    schemaVersion: SCHEMA_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    id,
    target: absolute,
    status: 'collecting',
    role: selectedRecipe.role,
    answers: { starter: preset },
    gaps: gaps(absolute, recipes),
    actions: []
  }
  await saveState(state)
  return nextCreateGap(id)
}

export async function nextCreateGap(id) {
  const state = await loadState(id)
  const gap = state.gaps.find((candidate) => state.answers[candidate.id] === undefined)
  if (!gap) return { summary: 'Distribution answers are complete.', status: 'ready', createId: id, routes: [`hairness create plan ${id}`], limits: [] }
  return { ...gap, createId: id, position: Object.keys(state.answers).length, total: state.gaps.length }
}

export async function answerCreate(id, gapId, value) {
  if (!gapId || value === undefined) throw new HairnessError('usage', 'Usage: hairness create answer <id> --gap <gap> --value <value>', { exitCode: 2 })
  const state = await loadState(id)
  const gap = state.gaps.find((candidate) => candidate.id === gapId)
  if (!gap) throw new HairnessError('create_gap_unknown', `Unknown create gap: ${gapId}`, { exitCode: 2 })
  if (!gap.allowCustom && !gap.options.some((option) => option.value === value)) throw new HairnessError('create_answer_invalid', `Invalid value for ${gapId}: ${value}`, { exitCode: 2 })
  state.answers[gapId] = value
  state.status = state.gaps.every((candidate) => state.answers[candidate.id] !== undefined) ? 'ready' : 'collecting'
  await saveState(state)
  return nextCreateGap(id)
}

async function availableRecipes() {
  const forge = await readJson(join(sourceRoot, 'hairness.json'))
  const values = []
  for (const catalogRoot of forge.catalogRoots ?? []) {
    const directory = resolve(sourceRoot, catalogRoot)
    for (const name of await readdir(directory).catch(() => [])) {
      if (!name.endsWith('.json')) continue
      const value = await readJson(join(directory, name), null)
      if (!value?.id || !value?.extensions) continue
      values.push(await validateContract('DistributionRecipe', value))
    }
  }
  return values.sort((left, right) => left.id.localeCompare(right.id))
}

async function recipe(state) {
  const value = (await availableRecipes()).find((candidate) => candidate.id === state.answers.starter)
  if (!value) throw new HairnessError('starter_unavailable', `Starter is unavailable from configured catalog roots: ${state.answers.starter}`, { exitCode: 4 })
  return value
}

function selectedProviders(value) {
  return value === 'both' ? ['codex', 'claude'] : [value]
}

function selectedExtensions(state, value) {
  if (state.answers.extensions === 'preset') return value.extensions
  return [...new Set(state.answers.extensions.split(',').map((item) => item.trim()).filter(Boolean))]
}

export async function planCreate(id) {
  const state = await loadState(id)
  const missing = state.gaps.find((gap) => state.answers[gap.id] === undefined)
  if (missing) throw new HairnessError('create_incomplete', `Answer ${missing.id} before planning.`, { routes: [`hairness create next ${id}`] })
  const selectedRecipe = await recipe(state)
  state.role = selectedRecipe.role
  const extensions = selectedExtensions(state, selectedRecipe)
  const providers = selectedProviders(state.answers.providers)
  const codebases = state.answers.codebases === 'preset' ? selectedRecipe.codebases : []
  const actions = [
    { type: 'write-distribution', target: state.target },
    { type: 'copy-extensions', target: extensions.join(',') },
    { type: 'install-dependencies', target: state.target },
    { type: 'initialize-git', target: state.target },
    ...providers.map((provider) => ({ type: 'build-provider', target: provider })),
  ]
  const checkpointId = `create-${createHash('sha256').update(JSON.stringify({ target: state.target, answers: state.answers, actions })).digest('hex').slice(0, 12)}`
  state.actions = actions
  await saveState(state)
  return {
    checkpointId,
    createId: id,
    mode: 'external',
    intent: `Create the ${state.answers.displayName} Hairness ${state.role}.`,
    targets: [state.target],
    effects: actions.map((action) => action.type),
    exclusions: ['remote creation', 'commit', 'push', 'tag', 'publish'],
    risk: 'Writes a new repository, runs npm install, initializes local Git, and generates selected repo-local provider surfaces.',
    recipe: selectedRecipe.id,
    extensions,
    providers,
    codebases,
    actions
  }
}

async function assertEmptyTarget(target) {
  try {
    const stat = await lstat(target)
    if (!stat.isDirectory()) throw new HairnessError('create_target_exists', `Target is not a directory: ${target}`, { exitCode: 2 })
    const entries = await readdir(target)
    if (entries.length) throw new HairnessError('create_target_not_empty', `Target is not empty: ${target}`, { exitCode: 2 })
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
}

function materialPath(path) {
  const target = resolve(sourceRoot, path)
  if (relative(sourceRoot, target).startsWith('..')) throw new HairnessError('recipe_material_escape', `Recipe material escapes the package: ${path}.`, { exitCode: 2 })
  return target
}

async function copyBase(target, selectedRecipe) {
  for (const material of selectedRecipe.materials) {
    const destination = resolve(target, material.target)
    if (relative(target, destination).startsWith('..')) throw new HairnessError('recipe_target_escape', `Recipe target escapes the distribution: ${material.target}.`, { exitCode: 2 })
    await mkdir(dirname(destination), { recursive: true })
    await cp(materialPath(material.source), destination, { recursive: true })
  }
  await mkdir(join(target, 'LICENSES'), { recursive: true })
  await cp(join(sourceRoot, 'LICENSE'), join(target, 'LICENSES', 'Hairness-MIT.txt'))
  await mkdir(join(target, 'scripts'), { recursive: true })
  for (const name of selectedRecipe.scripts) await cp(materialPath(join('scripts', name)), join(target, 'scripts', name))
  if (selectedRecipe.tests.includes('smoke')) {
    await mkdir(join(target, 'tests'), { recursive: true })
    await cp(materialPath('templates/distribution-tests/smoke.test.mjs.template'), join(target, 'tests', 'smoke.test.mjs'))
  }
}

async function copyExtensions(target, ids) {
  for (const id of ids) {
    const [owner, name] = id.split('/')
    const source = join(sourceRoot, 'extensions', owner, name)
    const destination = join(target, 'extensions', owner, name)
    await cp(source, destination, { recursive: true })
  }
}

async function selectSourceDrivers(target, selected) {
  const root = join(target, 'extensions', 'hairness', 'sources')
  const manifestPath = join(root, 'extension.json')
  const manifest = await readJson(manifestPath, null)
  if (!manifest) return
  const keep = new Set(selected)
  for (const path of manifest.sourceDrivers ?? []) {
    const id = path.split('/').at(-2)
    if (!keep.has(id)) await rm(join(root, 'drivers', id), { recursive: true, force: true })
  }
  manifest.sourceDrivers = (manifest.sourceDrivers ?? []).filter((path) => keep.has(path.split('/').at(-2)))
  await writeJsonAtomic(manifestPath, manifest)
}

function generatedReadme(state, selectedRecipe) {
  return `# ${state.answers.displayName}\n\nThis source-owned Hairness distribution gives coding agents the shared context and commands required by this team.\n\n## Start\n\n\`\`\`bash\nnpm install\nhairness onboarding next\nhairness build --check\n\`\`\`\n\nProvider commands are already versioned in this repository. Start a new provider session after installation.\n\n## Distribution\n\n- Protocol: 0.2\n- Starter: ${selectedRecipe.id}\n- Provider prefix: ${state.answers.providerPrefix}\n- Local state: \`.overlay/\`\n\nUse \`hairness help\` to inspect the active command surface.\n`
}

function generatedStatus(state) {
  return `# ${state.answers.displayName} Status\n\nCurrent target: \`0.2.0-alpha.0\`\n\n## Now\n\nNo active chantier.\n\n## Next\n\n- \`onboard-distribution\`\n  - Outcome: The distribution is trusted, mounted and verified by its selected providers.\n  - State: planned\n  - Gate: Onboarding and provider doctors pass.\n  - Evidence: Local onboarding and SessionStart receipts.\n\n## Blocked\n\n- None.\n\n## Release gates\n\n- Distribution checks pass on Node.js 22 and 24.\n\n## References\n\n- [Roadmap](ROADMAP.md)\n- [Documentation](docs/README.md)\n`
}

async function distributionLock(state, selectedRecipe, extensions) {
  const roots = [
    ...selectedRecipe.materials.map((material) => ({ path: material.target, owner: 'hairness/distribution', scope: 'core' })),
    ...selectedRecipe.scripts.map((name) => ({ path: `scripts/${name}`, owner: 'hairness/distribution', scope: 'core' })),
    ...extensions.map((id) => ({ path: `extensions/${id}`, owner: id, scope: `extension:${id}` })),
  ]
  const materials = []
  for (const item of roots) materials.push({ id: `material-${item.path.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')}`, owner: item.owner, path: item.path, sourcePath: item.path, version: implementationVersion, baseDigest: await digestMaterial(join(state.target, item.path)), policy: 'vendored', scope: item.scope })
  return {
    schemaVersion: 2,
    protocolVersion: '0.2',
    role: state.role,
    recipe: { id: selectedRecipe.id, digest: `sha256:${createHash('sha256').update(JSON.stringify(selectedRecipe)).digest('hex')}` },
    generatedFrom: { source: '@hairness/hairness', implementationVersion, protocolVersion: '0.2', createdAt: new Date().toISOString() },
    updateSource: { kind: 'npm', spec: '@hairness/hairness', channel: 'next' },
    materials,
  }
}

export async function applyCreate(id, checkpointId, options = {}) {
  const plan = await planCreate(id)
  if (checkpointId !== plan.checkpointId) throw new HairnessError('checkpoint_mismatch', 'Create checkpoint does not match the current plan.', { exitCode: 2 })
  const state = await loadState(id)
  const selectedRecipe = await recipe(state)
  await assertEmptyTarget(state.target)
  await mkdir(state.target, { recursive: true })
  await copyBase(state.target, selectedRecipe)
  const activeExtensions = plan.extensions
  const materializedExtensions = [...new Set([...activeExtensions, ...(selectedRecipe.catalogExtensions ?? [])])]
  await copyExtensions(state.target, materializedExtensions)
  if (activeExtensions.includes('hairness/sources')) await selectSourceDrivers(state.target, selectedRecipe.sourceDrivers)

  const manifest = {
    $schema: './schemas/distribution.schema.json',
    schemaVersion: SCHEMA_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    implementationVersion,
    role: state.role,
    catalogRoots: state.role === 'forge' ? ['./catalog', './extensions'] : [],
    name: slug(state.answers.name),
    displayName: state.answers.displayName,
    providerPrefix: slug(state.answers.providerPrefix),
    ...(state.answers.cliAlias !== 'none' ? { cliAlias: slug(state.answers.cliAlias) } : {}),
    generatedFrom: { source: '@hairness/hairness', implementationVersion, protocolVersion: PROTOCOL_VERSION, createdAt: new Date().toISOString() },
    core: './src/core/index.mjs',
    defaults: { interaction: { language: state.answers.language } },
    extensions: activeExtensions.map((extensionId) => ({ id: extensionId, path: `./extensions/${extensionId}` })),
    sources: selectedRecipe.sources,
    codebases: plan.codebases
  }
  await validateContract('DistributionManifest', manifest)
  await writeJsonAtomic(join(state.target, 'hairness.json'), manifest)
  const sourcePackage = JSON.parse(await readFile(join(sourceRoot, 'package.json'), 'utf8'))
  sourcePackage.name = `${slug(state.answers.name)}-hairness`
  sourcePackage.private = true
  sourcePackage.license = 'UNLICENSED'
  delete sourcePackage.files
  for (const [name, command] of Object.entries(sourcePackage.scripts)) {
    const script = /scripts\/([^ ]+\.mjs)/.exec(command)?.[1]
    if (script && !selectedRecipe.scripts.includes(script)) delete sourcePackage.scripts[name]
  }
  await writeJsonAtomic(join(state.target, 'package.json'), sourcePackage)
  await writeFile(join(state.target, 'README.md'), generatedReadme(state, selectedRecipe))
  if (state.role === 'forge') await writeFile(join(state.target, 'STATUS.md'), generatedStatus(state))
  await writeFile(join(state.target, '.gitignore'), '.overlay/\nnode_modules/\ncoverage/\n.DS_Store\n*.log\n.claude/settings.local.json\n')
  await writeJsonAtomic(join(state.target, 'hairness.lock.json'), await distributionLock(state, selectedRecipe, materializedExtensions))

  if (options.install !== false) await exec('npm', ['install'], { cwd: state.target, encoding: 'utf8' })
  if (options.git !== false) await exec('git', ['init', '-b', 'main'], { cwd: state.target, encoding: 'utf8' })
  if (options.build !== false) {
    for (const provider of plan.providers) {
      await exec(process.execPath, [join(state.target, 'bin', 'hairness.mjs'), 'build', '--provider', provider], {
        cwd: state.target,
        env: { ...process.env, HAIRNESS_ROOT: state.target },
        encoding: 'utf8'
      })
    }
  }
  state.status = 'applied'
  await saveState(state)
  return { summary: `Created ${state.answers.displayName}.`, status: 'applied', target: state.target, providers: plan.providers, extensions: activeExtensions, limits: [], routes: [`cd ${state.target}`, 'hairness onboarding next'] }
}

export async function createStatus(id) {
  return loadState(id)
}

export async function createCommand(args, flags = {}) {
  const [modeOrTarget, idOrTarget] = args
  if (!modeOrTarget) throw new HairnessError('usage', 'Usage: hairness create <target>|start|status|next|answer|plan|apply', { exitCode: 2 })
  if (!['start', 'status', 'next', 'answer', 'plan', 'apply'].includes(modeOrTarget)) return startCreate(modeOrTarget, flags.preset ?? 'standard')
  if (modeOrTarget === 'start') return startCreate(idOrTarget, flags.preset ?? 'standard')
  if (modeOrTarget === 'status') return createStatus(idOrTarget)
  if (modeOrTarget === 'next') return nextCreateGap(idOrTarget)
  if (modeOrTarget === 'answer') return answerCreate(idOrTarget, flags.gap, flags.value)
  if (modeOrTarget === 'plan') return planCreate(idOrTarget)
  if (!flags.checkpoint) throw new HairnessError('usage', 'create apply requires --checkpoint.', { exitCode: 2 })
  return applyCreate(idOrTarget, flags.checkpoint, { install: !flags['no-install'], git: !flags['no-git'], build: !flags['no-build'] })
}

export async function interactiveCreate(target, preset = 'standard') {
  let next = await startCreate(target, preset)
  const input = createInterface({ input: stdin, output: stdout })
  try {
    while (next.question) {
      const choices = next.options.map((option) => `${option.value} (${option.label})`).join(', ')
      const value = await input.question(`${next.question}\n${choices}\n> `)
      next = await answerCreate(next.createId, next.id, value || next.options[0].value)
    }
    const plan = await planCreate(next.createId)
    stdout.write(`${JSON.stringify(plan, null, 2)}\n`)
    const confirmation = await input.question(`Type ${plan.checkpointId} to apply:\n> `)
    if (confirmation !== plan.checkpointId) throw new HairnessError('checkpoint_required', 'Create was not applied.', { exitCode: 2 })
    return applyCreate(next.createId, confirmation)
  } finally {
    input.close()
  }
}
