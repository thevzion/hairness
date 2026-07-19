import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, unlink } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { activeExtensions, validateExtensionConfig } from './packages.mjs'
import { git } from './git.mjs'
import { loadHome, loadLocalConfig } from './home.mjs'
import { HairnessError } from './lib/errors.mjs'
import { digest, exists, readJson, resolvePackageFile, treeFiles, writeFileAtomic, writeJsonAtomic } from './lib/io.mjs'

const managedRegion = /<!-- hairness:begin id="agent-contract" -->[\s\S]*?<!-- hairness:end id="agent-contract" -->/
const prologueCommand = 'node ./node_modules/@hairness/cli/bin/hairness.mjs prologue'

export async function buildHome(root, options = {}) {
  const [home, local] = await Promise.all([loadHome(root), loadLocalConfig(root)])
  const extensions = await activeExtensions(root, home)
  const invalidConfig = await validateExtensionConfig(home, extensions)
  if (invalidConfig.length) throw new HairnessError('extension_config_invalid', `Invalid config for ${invalidConfig.map((entry) => entry.package).join(', ')}.`)
  const statePath = join(root, '.hairness', 'build.json')
  const previous = await readJson(statePath, null)
  if (options.check && !previous) throw stale('Local build state is missing.')

  const assets = await loadAssets(extensions)
  const wanted = [
    ...staticOutputs(assets),
    ...providerOutputs(home, local, assets),
    ...await adapterOutputs(root, options.adapterHomeRoot ?? root, home, extensions),
  ].sort((left, right) => left.path.localeCompare(right.path))
  assertNoOutputCollisions(wanted)
  const outputs = await reconcileOutputs(root, previous?.outputs ?? [], wanted, Boolean(options.check))
  const managed = []
  for (const provider of ['codex', 'claude']) {
    const active = home.spec.providers.includes(provider)
    const instructionPath = join(root, provider === 'codex' ? 'AGENTS.md' : 'CLAUDE.md')
    managed.push(relativeManaged(root, await updateManagedText(instructionPath, active ? renderAgentContract(local.preferences, assets.instructions) : null, options.check)))
    const hookPath = join(root, provider === 'codex' ? '.codex/hooks.json' : '.claude/settings.json')
    managed.push(relativeManaged(root, await updateHookConfig(hookPath, active, options.check)))
  }
  await updateLocalExcludes(root, outputs.map((entry) => entry.path), options.check)
  const state = { version: 1, outputs, managed: managed.filter(Boolean) }
  if (options.check) {
    if (JSON.stringify(previous) !== JSON.stringify(state)) throw stale('Local build state does not match generated assets.')
  } else {
    await writeJsonAtomic(statePath, state)
  }
  return state
}

async function loadAssets(extensions) {
  const instructions = []
  const files = []
  const skills = []
  const commands = []
  for (const extension of extensions) {
    const owner = extension.name
    for (const path of extension.manifest.contributes.instructions ?? []) {
      instructions.push({ owner, content: await readFile(await resolvePackageFile(extension.root, path), 'utf8') })
    }
    for (const file of extension.manifest.contributes.files ?? []) {
      files.push({ owner, path: file.output, content: await readFile(await resolvePackageFile(extension.root, file.path)) })
    }
    for (const skill of extension.manifest.contributes.skills ?? []) {
      skills.push({ ...skill, owner, content: skillBody(await readFile(await resolvePackageFile(extension.root, skill.path), 'utf8')) })
    }
    for (const command of extension.manifest.contributes.commands ?? []) commands.push({ ...command, owner })
  }
  return { instructions, files, skills, commands }
}

function staticOutputs(assets) {
  return assets.files.map((entry) => ({ ...entry, provider: 'static' }))
}

function skillBody(content) {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trimStart()
}

function providerOutputs(home, local, assets) {
  const values = []
  for (const provider of home.spec.providers) {
    for (const skill of assets.skills) {
      const commands = assets.commands.filter((entry) => entry.skill === skill.id && entry.owner === skill.owner)
      if (!commands.length) values.push(providerOutput(provider, skill.id, skill, null, local))
      for (const command of commands) values.push(providerOutput(provider, command.id, skill, command, local))
    }
  }
  return values
}

function providerOutput(provider, id, skill, command, local) {
  const providerRoot = provider === 'codex' ? '.agents/skills' : '.claude/skills'
  const invocation = command ? provider === 'codex' ? `$${id}` : `/${id}` : id
  const language = local.preferences.responseLanguage ?? 'en'
  const summary = command?.summary ?? skill.summary
  const content = `---\nname: ${id}\ndescription: ${JSON.stringify(summary)}\n---\n\n# ${invocation}\n\nSpeak ${language} from the first reply and preserve the user's language.\n\n${skill.content.trim()}\n\nThis file is generated from ${skill.owner}. Persist nothing unless the user asks.\n`
  return { path: join(providerRoot, id, 'SKILL.md'), provider, owner: skill.owner, content }
}

async function adapterOutputs(root, adapterHomeRoot, home, extensions) {
  const values = []
  for (const extension of extensions.filter((entry) => entry.manifest.subtype === 'adapter')) {
    const selection = home.spec.extensions.find((entry) => entry.package === extension.name)
    if (selection?.execution !== 'build') {
      throw new HairnessError('adapter_approval_required', `${extension.name} requires execution: build approval.`)
    }
    await mkdir(join(root, '.hairness'), { recursive: true })
    const outputRoot = await mkdtemp(join(root, '.hairness', 'adapter-'))
    try {
      const entry = await resolvePackageFile(extension.root, extension.manifest.adapter.entry, `${extension.name} adapter entry`)
      await runAdapter(entry, outputRoot, {
        home: { id: home.metadata.id, root: adapterHomeRoot, providers: home.spec.providers },
        config: home.spec.config[extension.name] ?? {},
      }, root)
      const allowed = extension.manifest.adapter.outputs.map((path) => path.replaceAll('\\', '/').replace(/\/+$/, ''))
      for (const file of await treeFiles(outputRoot)) {
        if (!allowed.some((path) => file.path === path || file.path.startsWith(`${path}/`))) {
          throw new HairnessError('adapter_output_undeclared', `${extension.name} wrote undeclared output ${file.path}.`)
        }
        values.push({ path: file.path, provider: 'adapter', owner: extension.name, content: file.content })
      }
    } finally {
      await rm(outputRoot, { recursive: true, force: true })
    }
  }
  return values
}

async function runAdapter(entry, outputRoot, context, stageRoot) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [entry], {
      cwd: dirname(entry),
      env: {
        PATH: process.env.PATH ?? '',
        HOME: '/nonexistent',
        NO_COLOR: '1',
        HAIRNESS_OUTPUT_DIR: outputRoot,
        HAIRNESS_HOME_DIR: context.home.root,
        HAIRNESS_STAGE_DIR: stageRoot,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const stdout = []
    const stderr = []
    let size = 0
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new HairnessError('adapter_timeout', `${entry} exceeded 120 seconds.`))
    }, 120_000)
    for (const stream of [child.stdout, child.stderr]) {
      stream.on('data', (chunk) => {
        size += chunk.length
        if (size > 2 * 1024 * 1024) child.kill('SIGKILL')
        else (stream === child.stdout ? stdout : stderr).push(chunk)
      })
    }
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
  const wantedPaths = new Set(wanted.map((entry) => entry.path))
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
  for (const entry of wanted) {
    const path = join(root, entry.path)
    const prior = previous.find((item) => item.path === entry.path)
    const current = await readFile(path).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error))
    if (current && prior && digest(current) !== prior.digest) throw diverged(entry.path)
    if (current && !prior && digest(current) !== digest(entry.content)) {
      throw new HairnessError('generated_output_collision', `${entry.path} already exists and Hairness does not own it.`, { exitCode: 5 })
    }
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

function renderAgentContract(preferences, instructions) {
  const language = preferences.responseLanguage ?? 'en'
  const preferenceLines = Object.entries(preferences).map(([key, value]) => `- ${key}: ${value}`)
  return `<!-- hairness:begin id="agent-contract" -->\n## Hairness Home\n\n### User preferences\n\n${preferenceLines.length ? preferenceLines.join('\n') : '- None configured.'}\n\n### Operating contract\n\n- Speak ${language} from the first reply and preserve the user's language.\n- Use an injected \`<hairness-prologue>\` as orientation. If absent, run \`${prologueCommand}\` once.\n- The Home owns agentic assets; Targets remain independent Git repositories.\n- Sessions are ephemeral. Persist only explicit Scratch notes or accepted documents.\n- Revalidate live evidence before relying on it.\n\n${instructions.map((entry) => `### ${entry.owner}\n\n${entry.content.trim()}`).join('\n\n')}\n<!-- hairness:end id="agent-contract" -->`
}

async function updateManagedText(path, block, check) {
  const current = await readFile(path, 'utf8').catch((error) => error.code === 'ENOENT' ? '' : Promise.reject(error))
  const next = block
    ? managedRegion.test(current) ? current.replace(managedRegion, block) : `${current.trimEnd()}${current.trim() ? '\n\n' : ''}${block}\n`
    : current.replace(managedRegion, '').trimStart()
  if (check && current !== next) throw stale(`${path} needs a managed-region rebuild.`)
  if (!check && current !== next) await writeFileAtomic(path, next, 0o644)
  return block ? { path, digest: digest(next) } : null
}

async function updateHookConfig(path, active, check) {
  const currentText = await readFile(path, 'utf8').catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error))
  const current = currentText ? JSON.parse(currentText) : {}
  current.hooks ??= {}
  const entries = (current.hooks.SessionStart ?? []).filter((entry) => !entry.hooks?.some((hook) => /@hairness\/cli\/bin\/hairness\.mjs prologue$/.test(hook.command ?? '')))
  if (active) entries.push({ matcher: 'startup|resume|clear|compact', hooks: [{ type: 'command', command: prologueCommand }] })
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

function relativeManaged(root, entry) {
  return entry ? { ...entry, path: relative(root, entry.path) } : null
}

function stale(message) {
  return new HairnessError('build_stale', message, { exitCode: 5 })
}

function diverged(path) {
  return new HairnessError('generated_output_diverged', `${path} was edited.`, { exitCode: 5 })
}
