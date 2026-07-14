import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { activeExtensions } from '../composition/extensions.mjs'
import { loadHome } from '../home/index.mjs'
import { HairnessError } from '../lib/errors.mjs'
import { digest, exists, now, readJson, writeFileAtomic, writeJsonAtomic } from '../lib/io.mjs'
import { ensureRuntime } from '../runtime/index.mjs'

const supportedProviders = new Set(['codex', 'claude'])
const regionPattern = /<!-- hairness:begin id="agent-contract" -->[\s\S]*?<!-- hairness:end id="agent-contract" -->/g

function providerPath(provider, recipeId) {
  const root = provider === 'codex' ? '.agents/skills' : '.claude/skills'
  return join(root, recipeId, 'SKILL.md')
}

function providerInvocation(provider, recipeId) {
  return provider === 'codex' ? `$${recipeId}` : `/${recipeId}`
}

function renderRecipe(provider, extension, recipe, content, language) {
  const invocation = providerInvocation(provider, recipe.id)
  return `---\nname: ${recipe.id}\ndescription: ${recipe.summary}\n---\n\n# ${invocation}\n\nSpeak ${language} from the first reply and keep using the user's language. This is a provider-neutral Hairness recipe owned by \`${extension.manifest.metadata.id}\`.\n\n${content.trim()}\n\nDo not persist chat output unless the user explicitly asks to save it. Access never grants effect authority.\n`
}

function agentContract(language) {
  return `<!-- hairness:begin id="agent-contract" -->\n## Hairness Home\n\n- Speak ${language} from the first reply and preserve the user's language.\n- The Home owns agentic assets; Targets remain independent repositories.\n- Sessions are ephemeral until attached to a Scratch. Never store transcripts or reasoning.\n- Chat recipes are direct conversation. Persist only explicit Scratch notes or accepted Artifacts.\n- Effects require an exact prepared checkpoint and revalidation.\n- Use live Target evidence for current truth; Artifacts only orient.\n<!-- hairness:end id="agent-contract" -->`
}

async function mergeAgentContract(path, language, check) {
  const current = await readFile(path, 'utf8').catch((error) => error.code === 'ENOENT' ? '' : Promise.reject(error))
  const block = agentContract(language)
  const next = regionPattern.test(current)
    ? current.replace(regionPattern, block)
    : `${current.trimEnd()}${current.trim() ? '\n\n' : ''}${block}\n`
  regionPattern.lastIndex = 0
  if (check && current !== next) throw new HairnessError('build_stale', `${path} needs a Hairness managed-region rebuild.`, { exitCode: 5 })
  if (!check && current !== next) await writeFileAtomic(path, next, 0o644)
  return digest(next)
}

async function updateLocalExcludes(root, paths, check) {
  const gitDirectory = await readFile(join(root, '.git'), 'utf8').catch(() => null)
  let info
  if (gitDirectory?.startsWith('gitdir: ')) info = join(resolve(root, gitDirectory.slice(8).trim()), 'info', 'exclude')
  else info = join(root, '.git', 'info', 'exclude')
  if (!await exists(dirname(info))) return
  const current = await readFile(info, 'utf8').catch((error) => error.code === 'ENOENT' ? '' : Promise.reject(error))
  const begin = '# hairness:begin generated-provider-outputs'
  const end = '# hairness:end generated-provider-outputs'
  const pattern = /# hairness:begin generated-provider-outputs\n[\s\S]*?# hairness:end generated-provider-outputs\n?/g
  const block = `${begin}\n${paths.sort().join('\n')}\n${end}\n`
  const next = pattern.test(current) ? current.replace(pattern, block) : `${current.trimEnd()}${current.trim() ? '\n\n' : ''}${block}`
  if (check && current !== next) throw new HairnessError('build_stale', '.git/info/exclude needs a provider output refresh.', { exitCode: 5 })
  if (!check && current !== next) await writeFileAtomic(info, next, 0o644)
}

export async function buildProviders(root, options = {}) {
  const home = await loadHome(root)
  const runtime = await ensureRuntime(home)
  const extensions = await activeExtensions(root, home)
  const previous = await readJson(runtime.build, { outputs: [] })
  const wanted = []

  for (const provider of home.spec.providers) {
    if (!supportedProviders.has(provider)) throw new HairnessError('provider_unsupported', `Unsupported provider: ${provider}.`)
    for (const extension of extensions) {
      for (const recipe of extension.manifest.spec.recipes) {
        const source = join(extension.root, recipe.path)
        const content = await readFile(source, 'utf8')
        const path = providerPath(provider, recipe.id)
        wanted.push({ path, owner: extension.manifest.metadata.id, provider, content: renderRecipe(provider, extension, recipe, content, home.spec.language) })
      }
    }
  }

  const names = wanted.map((item) => `${item.provider}:${item.path}`)
  if (new Set(names).size !== names.length) throw new HairnessError('provider_output_collision', 'Provider output paths collide.')
  const byPath = new Map(wanted.map((item) => [item.path, item]))

  for (const prior of previous.outputs ?? []) {
    if (byPath.has(prior.path)) continue
    const path = join(root, prior.path)
    if (!await exists(path)) continue
    const currentDigest = digest(await readFile(path))
    if (currentDigest !== prior.digest) throw new HairnessError('generated_output_diverged', `${prior.path} was edited and cannot be removed automatically.`, { exitCode: 5 })
    if (!options.check) await rm(dirname(path), { recursive: true, force: true })
    else throw new HairnessError('build_stale', `${prior.path} is a stale generated output.`, { exitCode: 5 })
  }

  const outputs = []
  for (const item of wanted) {
    const path = join(root, item.path)
    const contentDigest = digest(item.content)
    const prior = (previous.outputs ?? []).find((entry) => entry.path === item.path)
    if (prior && await exists(path) && digest(await readFile(path)) !== prior.digest) {
      throw new HairnessError('generated_output_diverged', `${item.path} was edited.`, { exitCode: 5 })
    }
    const current = await readFile(path, 'utf8').catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error))
    if (options.check && current !== item.content) throw new HairnessError('build_stale', `${item.path} needs a rebuild.`, { exitCode: 5 })
    if (!options.check && current !== item.content) await writeFileAtomic(path, item.content, 0o644)
    outputs.push({ path: item.path, provider: item.provider, owner: item.owner, digest: contentDigest })
  }

  for (const path of ['.agents/skills/.gitkeep', '.claude/skills/.gitkeep']) {
    if (!await exists(join(root, path)) && !options.check) {
      await mkdir(dirname(join(root, path)), { recursive: true })
      await writeFile(join(root, path), '')
    }
  }
  const managed = []
  if (home.spec.providers.includes('codex')) managed.push({ path: 'AGENTS.md', digest: await mergeAgentContract(join(root, 'AGENTS.md'), home.spec.language, options.check) })
  if (home.spec.providers.includes('claude')) managed.push({ path: 'CLAUDE.md', digest: await mergeAgentContract(join(root, 'CLAUDE.md'), home.spec.language, options.check) })
  await updateLocalExcludes(root, outputs.map((item) => item.path), options.check)

  const state = { home: home.metadata.id, builtAt: now(), outputs, managed }
  if (!options.check) await writeJsonAtomic(runtime.build, state)
  return state
}
