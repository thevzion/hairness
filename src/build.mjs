import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, unlink } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { installedAssets } from './assets.mjs'
import { loadHome, loadLocalConfig } from './home.mjs'
import { HairnessError } from './lib/errors.mjs'
import { digest, exists, readJson, resolvePackageFile, treeFiles, writeFileAtomic, writeJsonAtomic } from './lib/io.mjs'

const managedRegion = /<!-- hairness:begin id="agent-contract" -->[\s\S]*?<!-- hairness:end id="agent-contract" -->/

export async function buildHome(root, options = {}) {
  const [home, local, installed] = await Promise.all([loadHome(root), loadLocalConfig(root), installedAssets(root)])
  const statePath = join(root, '.hairness', 'build.json')
  const previous = await readJson(statePath, null)
  const invalid = installed.find((asset) => asset.invalid)
  if (invalid) throw new HairnessError('asset_invalid', `${invalid.id} is invalid: ${invalid.invalid.message}`)
  const materials = await loadMaterials(installed)
  const adapterBuild = await adapterOutputs(root, options.adapterHomeRoot ?? root, home, installed, options.allowAdapters ?? [], options.check, previous)
  const wanted = [...providerOutputs(home, local, materials), ...adapterBuild.outputs].sort((left, right) => left.path.localeCompare(right.path))
  assertNoOutputCollisions(wanted)
  const outputs = await reconcileOutputs(root, previous?.outputs ?? [], wanted, Boolean(options.check))
  const managed = []
  for (const provider of ['codex', 'claude']) {
    const active = home.providers.includes(provider)
    const instructionPath = join(root, provider === 'codex' ? 'AGENTS.md' : 'CLAUDE.md')
    managed.push(relativeManaged(root, await updateManagedText(instructionPath, active ? renderAgentContract(home, local.preferences, materials.instructions) : null, options.check)))
    const hookPath = join(root, provider === 'codex' ? '.codex/hooks.json' : '.claude/settings.json')
    managed.push(relativeManaged(root, await updateHookConfig(hookPath, active, home.runtime, options.check)))
  }
  const state = { version: 1, outputs, managed: managed.filter(Boolean), adapters: adapterBuild.adapters }
  if (options.check) {
    if (previous && JSON.stringify(previous) !== JSON.stringify(state)) throw stale('Local build state does not match generated assets.')
  } else await writeJsonAtomic(statePath, state)
  return state
}

async function loadMaterials(assets) {
  const instructions = []
  const skills = []
  for (const asset of assets) {
    const owner = asset.manifest.name
    for (const file of asset.manifest.files) {
      if (!['hairness:instruction', 'hairness:skill'].includes(file.type)) continue
      const content = await readFile(await resolvePackageFile(asset.root, file.path, `${owner} asset`), 'utf8')
      if (file.type === 'hairness:instruction') instructions.push({ owner, content })
      else skills.push({ id: file.id, summary: file.description, owner, content: skillBody(content) })
    }
  }
  return { instructions, skills }
}

function skillBody(content) {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trimStart()
}

function providerOutputs(home, local, materials) {
  const values = []
  for (const provider of home.providers) for (const skill of materials.skills) values.push(providerOutput(provider, skill, local))
  return values
}

function providerOutput(provider, skill, local) {
  const providerRoot = provider === 'codex' ? '.agents/skills' : '.claude/skills'
  const invocation = provider === 'codex' ? `$${skill.id}` : `/${skill.id}`
  const language = local.preferences.responseLanguage ?? 'en'
  const content = `---\nname: ${skill.id}\ndescription: ${JSON.stringify(skill.summary)}\n---\n\n# ${invocation}\n\nSpeak ${language} from the first reply and preserve the user's language.\n\n${skill.content.trim()}\n\nThis file is generated from ${skill.owner}. Persist nothing unless the user asks.\n`
  return { path: join(providerRoot, skill.id, 'SKILL.md'), provider, owner: skill.owner, content }
}

async function adapterOutputs(root, adapterHomeRoot, home, assets, allowed, check, previous) {
  const values = []
  const built = []
  const approvals = new Set(Array.isArray(allowed) ? allowed : allowed ? [allowed] : [])
  for (const asset of assets.filter((entry) => entry.manifest.adapter)) {
    const adapter = asset.manifest.adapter
    if (!approvals.has(adapter.id) && !approvals.has(asset.manifest.name)) {
      if (check) {
        if (!(previous?.adapters ?? []).includes(asset.manifest.name)) throw stale(`${adapter.id} has not completed an approved build.`)
        values.push(...(previous?.outputs ?? []).filter((entry) => entry.provider === 'adapter' && entry.owner === asset.manifest.name).map((entry) => ({ ...entry, content: null })))
        built.push(asset.manifest.name)
        continue
      }
      throw new HairnessError('adapter_approval_required', `${adapter.id} requires --allow-adapter ${adapter.id}.`)
    }
    await mkdir(join(root, '.hairness'), { recursive: true })
    const outputRoot = await mkdtemp(join(root, '.hairness', 'adapter-'))
    try {
      const entry = await resolvePackageFile(asset.root, adapter.entry, `${adapter.id} adapter entry`)
      await runAdapter(entry, outputRoot, {
        home: { id: home.name, root: adapterHomeRoot, providers: home.providers },
        config: home.config[asset.manifest.name] ?? {},
      }, root)
      const declared = adapter.outputs.map((path) => path.replaceAll('\\', '/').replace(/\/+$/, ''))
      for (const file of await treeFiles(outputRoot)) {
        if (!declared.some((path) => file.path === path || file.path.startsWith(`${path}/`))) throw new HairnessError('adapter_output_undeclared', `${adapter.id} wrote undeclared output ${file.path}.`)
        if (['AGENTS.md', 'CLAUDE.md', '.codex/hooks.json', '.claude/settings.json'].includes(file.path)) throw new HairnessError('adapter_output_reserved', `${adapter.id} wrote reserved managed output ${file.path}.`)
        values.push({ path: file.path, provider: 'adapter', owner: asset.manifest.name, content: file.content })
      }
      built.push(asset.manifest.name)
    } finally {
      await rm(outputRoot, { recursive: true, force: true })
    }
  }
  return { outputs: values, adapters: built.sort() }
}

async function runAdapter(entry, outputRoot, context, stageRoot) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [entry], {
      cwd: dirname(entry),
      env: { PATH: process.env.PATH ?? '', HOME: '/nonexistent', NO_COLOR: '1', HAIRNESS_OUTPUT_DIR: outputRoot, HAIRNESS_HOME_DIR: context.home.root, HAIRNESS_STAGE_DIR: stageRoot },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const stdout = []
    const stderr = []
    let size = 0
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new HairnessError('adapter_timeout', `${entry} exceeded 120 seconds.`)) }, 120_000)
    for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => { size += chunk.length; if (size > 2 * 1024 * 1024) child.kill('SIGKILL'); else (stream === child.stdout ? stdout : stderr).push(chunk) })
    child.on('error', reject)
    child.on('close', (code) => {
      clearTimeout(timer)
      if (size > 2 * 1024 * 1024) reject(new HairnessError('adapter_output_too_large', `${entry} emitted more than 2 MiB.`))
      else if (code !== 0) reject(new HairnessError('adapter_failed', Buffer.concat(stderr).toString('utf8').trim() || `${entry} exited ${code}.`))
      else resolvePromise(Buffer.concat(stdout).toString('utf8'))
    })
    child.stdin.end(JSON.stringify(context))
  })
}

async function reconcileOutputs(root, previous, wanted, check) {
  const normalized = []
  for (const entry of wanted) {
    if (entry.content !== null) normalized.push(entry)
    else {
      const current = await readFile(join(root, entry.path)).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error))
      if (!current || digest(current) !== entry.digest) throw stale(`${entry.path} needs an approved Adapter rebuild.`)
      normalized.push({ ...entry, content: current })
    }
  }
  const wantedPaths = new Set(normalized.map((entry) => entry.path))
  const removals = []
  for (const prior of previous) {
    if (wantedPaths.has(prior.path)) continue
    const path = join(root, prior.path)
    if (!await exists(path)) continue
    if (digest(await readFile(path)) !== prior.digest) throw diverged(prior.path)
    if (check) throw stale(`${prior.path} is a stale generated output.`)
    removals.push(path)
  }
  const outputs = []
  const writes = []
  for (const entry of normalized) {
    const path = join(root, entry.path)
    const prior = previous.find((item) => item.path === entry.path)
    const current = await readFile(path).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error))
    if (current && prior && digest(current) !== prior.digest) throw diverged(entry.path)
    if (current && !prior && digest(current) !== digest(entry.content)) throw new HairnessError('generated_output_collision', `${entry.path} already exists and Hairness does not own it.`, { exitCode: 5 })
    if (check && (!current || digest(current) !== digest(entry.content))) throw stale(`${entry.path} needs a rebuild.`)
    if (!check && (!current || digest(current) !== digest(entry.content))) writes.push({ path, content: entry.content })
    outputs.push({ path: entry.path, provider: entry.provider, owner: entry.owner, digest: digest(entry.content) })
  }
  for (const path of removals) await unlink(path)
  for (const entry of writes) await writeFileAtomic(entry.path, entry.content, 0o644)
  return outputs
}

function assertNoOutputCollisions(outputs) {
  const owners = new Map()
  for (const output of outputs) {
    if (owners.has(output.path)) throw new HairnessError('generated_output_collision', `${output.path} is owned by both ${owners.get(output.path)} and ${output.owner}.`)
    owners.set(output.path, output.owner)
  }
}

function renderAgentContract(home, preferences, instructions) {
  const language = preferences.responseLanguage ?? 'en'
  const prologueCommand = `npx --yes ${home.runtime} prologue`
  const preferenceLines = Object.entries(preferences).map(([key, value]) => `- ${key}: ${value}`)
  return `<!-- hairness:begin id="agent-contract" -->\n## Hairness Home\n\n### User preferences\n\n${preferenceLines.length ? preferenceLines.join('\n') : '- None configured.'}\n\n### Operating contract\n\n- Speak ${language} from the first reply and preserve the user's language.\n- Use an injected \`<hairness-prologue>\` as orientation. If absent, run \`${prologueCommand}\` once.\n- The Home owns agentic assets and explicit human memory; Targets remain independent Git repositories.\n- Sessions are ephemeral. Persist only explicit Scratch notes or accepted documents.\n- Revalidate live evidence before relying on it.\n\n${instructions.map((entry) => `### ${entry.owner}\n\n${entry.content.trim()}`).join('\n\n')}\n<!-- hairness:end id="agent-contract" -->`
}

async function updateManagedText(path, block, check) {
  const current = await readFile(path, 'utf8').catch((error) => error.code === 'ENOENT' ? '' : Promise.reject(error))
  const next = block ? managedRegion.test(current) ? current.replace(managedRegion, block) : `${current.trimEnd()}${current.trim() ? '\n\n' : ''}${block}\n` : current.replace(managedRegion, '').trimStart()
  if (check && current !== next) throw stale(`${path} needs a managed-region rebuild.`)
  if (!check && current !== next) await writeFileAtomic(path, next, 0o644)
  return block ? { path, digest: digest(next) } : null
}

async function updateHookConfig(path, active, runtime, check) {
  const currentText = await readFile(path, 'utf8').catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error))
  const current = currentText ? JSON.parse(currentText) : {}
  current.hooks ??= {}
  const entries = (current.hooks.SessionStart ?? []).filter((entry) => !entry.hooks?.some((hook) => /hairness.* prologue$/.test(hook.command ?? '')))
  if (active) entries.push({ matcher: 'startup|resume|clear|compact', hooks: [{ type: 'command', command: `npx --yes ${runtime} prologue` }] })
  if (entries.length) current.hooks.SessionStart = entries
  else delete current.hooks.SessionStart
  if (!Object.keys(current.hooks).length) delete current.hooks
  const next = `${JSON.stringify(current, null, 2)}\n`
  if (check && currentText !== next) throw stale(`${path} needs a SessionStart hook rebuild.`)
  if (!check && currentText !== next) await writeFileAtomic(path, next, 0o644)
  return active ? { path, digest: digest(next) } : null
}

function relativeManaged(root, entry) { return entry ? { ...entry, path: relative(root, entry.path) } : null }
function stale(message) { return new HairnessError('build_stale', message, { exitCode: 5 }) }
function diverged(path) { return new HairnessError('generated_output_diverged', `${path} was edited.`, { exitCode: 5 }) }
