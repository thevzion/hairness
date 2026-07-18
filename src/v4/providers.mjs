import { mkdir, readFile, rm, rmdir, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { activeExtensions } from './extensions.mjs'
import { git } from './git.mjs'
import { loadHome, loadLocalConfig } from './home.mjs'
import { HairnessError } from '../lib/errors.mjs'
import { digest, exists, readJson, writeFileAtomic, writeJsonAtomic } from '../lib/io.mjs'

const packageRoot = fileURLToPath(new URL('../../', import.meta.url))
const region = /<!-- hairness:begin id="agent-contract" -->[\s\S]*?<!-- hairness:end id="agent-contract" -->/
const prologueCommand = 'node ./node_modules/@hairness/cli/bin/hairness.mjs prologue'
const coreSkills = [
  { id: 'hairness', summary: 'Orient the user and show the next useful route.' },
  { id: 'hairness-onboarding', summary: 'Configure the smallest useful Home through conversation.' },
  { id: 'hairness-scratch', summary: 'Create or update explicit lightweight working memory.' },
]

export async function buildProviders(root, options = {}) {
  const [home, config, extensions] = await Promise.all([loadHome(root), loadLocalConfig(root), activeExtensions(root)])
  const statePath = join(root, '.hairness', 'build.json')
  const previous = await readJson(statePath, null)
  if (options.check && !previous) throw stale('Local build state is missing.')
  const assets = await loadAssets(extensions)
  const wanted = providerOutputs(home, config, assets)
  const wantedPaths = new Set(wanted.map((entry) => entry.path))

  for (const prior of previous?.outputs ?? []) {
    if (wantedPaths.has(prior.path)) continue
    const path = join(root, prior.path)
    if (!await exists(path)) continue
    if (digest(await readFile(path)) !== prior.digest) throw new HairnessError('generated_output_diverged', `${prior.path} was edited and cannot be removed.`, { exitCode: 5 })
    if (options.check) throw stale(`${prior.path} is a stale generated output.`)
    await rm(path)
    await rmdir(dirname(path)).catch((error) => {
      if (!['ENOENT', 'ENOTEMPTY'].includes(error.code)) throw error
    })
  }

  const outputs = []
  for (const entry of wanted) {
    const path = join(root, entry.path)
    const prior = previous?.outputs?.find((item) => item.path === entry.path)
    const current = await readFile(path, 'utf8').catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error))
    if (prior && current !== null && digest(current) !== prior.digest) throw new HairnessError('generated_output_diverged', `${entry.path} was edited.`, { exitCode: 5 })
    if (options.check && current !== entry.content) throw stale(`${entry.path} needs a rebuild.`)
    if (!options.check && current !== entry.content) await writeFileAtomic(path, entry.content, 0o644)
    outputs.push({ path: entry.path, provider: entry.provider, owner: entry.owner, digest: digest(entry.content) })
  }

  if (!options.check) {
    for (const path of ['.agents/skills/.gitkeep', '.claude/skills/.gitkeep', '.codex/.gitkeep']) {
      if (!await exists(join(root, path))) {
        await mkdir(dirname(join(root, path)), { recursive: true })
        await writeFile(join(root, path), '')
      }
    }
  }

  const managed = []
  for (const provider of ['codex', 'claude']) {
    const active = home.spec.providers.includes(provider)
    const instructionPath = join(root, provider === 'codex' ? 'AGENTS.md' : 'CLAUDE.md')
    const instructionContent = active ? renderAgentContract(config.preferences, assets.instructions) : null
    managed.push(relativeManaged(root, await updateManagedText(instructionPath, instructionContent, options.check)))
    const hookPath = join(root, provider === 'codex' ? '.codex/hooks.json' : '.claude/settings.json')
    managed.push(relativeManaged(root, await updateHookConfig(hookPath, active, options.check)))
  }
  await updateLocalExcludes(root, outputs.map((entry) => entry.path), options.check)

  const state = { version: 1, outputs, managed: managed.filter(Boolean) }
  if (options.check) {
    const comparable = { version: previous.version, outputs: previous.outputs, managed: previous.managed }
    if (JSON.stringify(comparable) !== JSON.stringify(state)) throw stale('Local build state does not match generated assets.')
  } else {
    await writeJsonAtomic(statePath, state)
  }
  return state
}

async function loadAssets(extensions) {
  const instructions = [{
    owner: 'hairness/kernel',
    content: await readFile(join(packageRoot, 'assets/core/instructions.md'), 'utf8'),
  }]
  const skills = []
  const commands = []
  for (const skill of coreSkills) {
    skills.push({ ...skill, owner: 'hairness/kernel', content: await readFile(join(packageRoot, 'assets/core/skills', skill.id, 'skill.md'), 'utf8') })
    commands.push({ id: skill.id, skill: skill.id, summary: skill.summary, owner: 'hairness/kernel' })
  }
  for (const extension of extensions) {
    const owner = extension.manifest.metadata.id
    for (const path of extension.manifest.spec.instructions ?? []) instructions.push({ owner, content: await readFile(join(extension.root, path), 'utf8') })
    for (const skill of extension.manifest.spec.skills ?? []) skills.push({ ...skill, owner, content: await readFile(join(extension.root, skill.path), 'utf8') })
    for (const command of extension.manifest.spec.commands ?? []) commands.push({ ...command, owner })
  }
  return { instructions, skills, commands }
}

function providerOutputs(home, config, assets) {
  const values = []
  for (const provider of home.spec.providers) {
    for (const skill of assets.skills) {
      const command = assets.commands.find((entry) => entry.id === skill.id && entry.skill === skill.id)
      values.push(output(provider, skill.id, skill, command, config))
    }
    for (const command of assets.commands.filter((entry) => entry.id !== entry.skill)) {
      const skill = assets.skills.find((entry) => entry.id === command.skill && entry.owner === command.owner)
      values.push(output(provider, command.id, skill, command, config))
    }
  }
  const paths = values.map((entry) => entry.path)
  if (new Set(paths).size !== paths.length) throw new HairnessError('provider_output_collision', 'Generated provider paths collide.')
  return values.sort((left, right) => left.path.localeCompare(right.path))
}

function output(provider, id, skill, command, config) {
  const root = provider === 'codex' ? '.agents/skills' : '.claude/skills'
  const invocation = command ? provider === 'codex' ? `$${id}` : `/${id}` : id
  const language = config.preferences.responseLanguage ?? 'en'
  const summary = command?.summary ?? skill.summary
  const content = `---\nname: ${id}\ndescription: ${JSON.stringify(summary)}\n---\n\n# ${invocation}\n\nSpeak ${language} from the first reply and preserve the user's language.\n\n${skill.content.trim()}\n\nThis is a generated projection of a provider-neutral Hairness Skill. Persist nothing unless the user explicitly asks.\n`
  return { path: join(root, id, 'SKILL.md'), provider, owner: skill.owner, content }
}

function renderAgentContract(preferences, instructions) {
  const language = preferences.responseLanguage ?? 'en'
  const preferenceLines = Object.entries(preferences).map(([key, value]) => `- ${key}: ${value}`)
  return `<!-- hairness:begin id="agent-contract" -->\n## Hairness Home\n\n### User preferences\n\n${preferenceLines.length ? preferenceLines.join('\n') : '- None configured.'}\n\n### Operating contract\n\n- Speak ${language} from the first reply and preserve the user's language.\n- Use an injected \`<hairness-prologue>\` as orientation. If absent, run \`${prologueCommand}\` once.\n- The Home owns agentic assets; Targets remain independent Git repositories.\n- Sessions are ephemeral. Persist only explicit Scratch notes or accepted documents.\n- Revalidate live evidence; prologue facts and signals are orientation, not guaranteed health.\n\n${instructions.map((entry) => `### ${entry.owner}\n\n${entry.content.trim()}`).join('\n\n')}\n<!-- hairness:end id="agent-contract" -->`
}

async function updateManagedText(path, block, check) {
  const current = await readFile(path, 'utf8').catch((error) => error.code === 'ENOENT' ? '' : Promise.reject(error))
  let next
  if (block) next = region.test(current) ? current.replace(region, block) : `${current.trimEnd()}${current.trim() ? '\n\n' : ''}${block}\n`
  else next = current.replace(region, '').replace(/^\s+|\s+$/g, (match, offset) => offset === 0 ? '' : '\n')
  if (check && current !== next) throw stale(`${path} needs a managed-region rebuild.`)
  if (!check && current !== next) await writeFileAtomic(path, next, 0o644)
  return block ? { path, digest: digest(next) } : null
}

async function updateHookConfig(path, active, check) {
  const currentText = await readFile(path, 'utf8').catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error))
  const current = currentText ? JSON.parse(currentText) : {}
  current.hooks ??= {}
  const entries = (current.hooks.SessionStart ?? []).filter((entry) => !entry.hooks?.some((hook) => hook.command === prologueCommand))
  if (active) entries.push({
    matcher: 'startup|resume|clear|compact',
    hooks: [{ type: 'command', command: prologueCommand }],
  })
  if (entries.length) current.hooks.SessionStart = entries
  else delete current.hooks.SessionStart
  if (!Object.keys(current.hooks).length) delete current.hooks
  const next = `${JSON.stringify(current, null, 2)}\n`
  if (check && currentText !== next) throw stale(`${path} needs a SessionStart hook rebuild.`)
  if (!check && currentText !== next) await writeFileAtomic(path, next, 0o644)
  return active ? { path, digest: digest(next) } : null
}

async function updateLocalExcludes(root, paths, check) {
  const raw = await git(['rev-parse', '--git-path', 'info/exclude'], { cwd: root }).catch(() => null)
  if (!raw) return
  const path = resolve(root, raw)
  const current = await readFile(path, 'utf8').catch((error) => error.code === 'ENOENT' ? '' : Promise.reject(error))
  const pattern = /# hairness:begin generated-provider-outputs\n[\s\S]*?# hairness:end generated-provider-outputs\n?/
  const block = `# hairness:begin generated-provider-outputs\n${[...paths].sort().join('\n')}\n# hairness:end generated-provider-outputs\n`
  const next = pattern.test(current) ? current.replace(pattern, block) : `${current.trimEnd()}${current.trim() ? '\n\n' : ''}${block}`
  if (check && current !== next) throw stale('.git/info/exclude needs a generated-output refresh.')
  if (!check && current !== next) await writeFileAtomic(path, next, 0o644)
}

function stale(message) {
  return new HairnessError('build_stale', message, { exitCode: 5 })
}

function relativeManaged(root, entry) {
  return entry ? { ...entry, path: relative(root, entry.path) } : null
}
