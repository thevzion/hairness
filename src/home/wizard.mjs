import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { resolve } from 'node:path'
import { createHome, previewCreate } from './create.mjs'
import { inspectGit } from '../runtime/git.mjs'

export async function runCreateWizard(destination, options = {}) {
  const io = options.io ?? createInterface({ input, output })
  const stream = options.output ?? output
  const color = Boolean(stream.isTTY && !process.env.NO_COLOR)
  const close = !options.io
  try {
    stream.write(`${style('Hairness Home setup', color)}\nA small deterministic bootstrap; the agent completes onboarding with you.\n\n`)
    const detectedLanguage = detectLanguage()
    const language = options.language ?? await choose(io, `Preferred response language`, [
      { label: `${detectedLanguage} (detected)`, value: detectedLanguage },
      { label: 'English', value: 'en' },
      { label: 'French', value: 'fr' },
    ])
    const preset = options.from ? options.preset ?? 'custom' : options.preset ?? await choose(io, 'Setup', [
      { label: 'Standard (recommended)', value: 'standard' },
      { label: 'Minimal', value: 'minimal' },
      { label: 'Custom distribution', value: 'custom' },
    ])
    const from = preset === 'custom' ? options.from ?? await io.question('Distribution path or Git source: ') : options.from
    const providers = options.providers ?? await choose(io, 'Providers', [
      { label: 'Codex', value: ['codex'] },
      { label: 'Claude', value: ['claude'] },
      { label: 'Codex and Claude', value: ['codex', 'claude'] },
    ])
    const detectedTarget = await inspectGit(options.cwd ?? process.cwd()).then((value) => value.root).catch(() => null)
    let target = options.target
    let workspaceRoot = options.workspaceRoot
    if (target === undefined && workspaceRoot === undefined) {
      const access = await choose(io, 'Repository access', [
        ...(detectedTarget ? [{ label: `Use current repository (${detectedTarget})`, value: 'target' }] : []),
        { label: 'Choose a workspace root for onboarding discovery', value: 'workspace' },
        { label: 'Skip for now', value: 'skip' },
      ])
      if (access === 'target') target = detectedTarget
      else if (access === 'workspace') workspaceRoot = (await io.question('Workspace root: ')).trim()
      else target = null
    }
    const overlayGit = options.overlayGit ?? await choose(io, 'Version Overlay memory with local Git', [
      { label: 'Yes (recommended)', value: true },
      { label: 'No', value: false },
    ])
    const settings = { ...options, language, preset, from, providers, target, workspaceRoot, overlayGit }
    const preview = await previewCreate(resolve(destination), settings)
    stream.write(`\n${style('Creation preview', color)}\n${renderPreview(preview)}\n`)
    const confirmed = options.yes ?? await choose(io, 'Create this Home', [
      { label: 'Create', value: true },
      { label: 'Cancel', value: false },
    ])
    if (!confirmed) return { status: 'cancelled', preview }
    stream.write('\nCreating Home: install → build → doctor → local commit\n')
    const created = await createHome(destination, settings)
    stream.write(`${style('Home ready', color)}\n`)
    return created
  } finally {
    if (close) io.close()
  }
}

function renderPreview(preview) {
  const access = preview.repositoryAccess ? `${preview.repositoryAccess.kind}: ${preview.repositoryAccess.path}` : 'skipped'
  return [
    `Destination: ${preview.destination}`,
    `Runtime: ${preview.dependency}`,
    `Distribution: ${preview.distribution}`,
    `Extensions: ${preview.extensions.join(', ')}`,
    `Providers: ${preview.providers.join(', ')}`,
    `Repository access: ${access}`,
    'Home Git: initialize and create a local initial commit',
    `Overlay Git: ${preview.overlayGit.initialize ? 'initialize and create a local initial commit' : 'disabled'}`,
    `Qualification: ${preview.qualification.join(', ')}`,
    `Will not: ${preview.exclusions.join(', ')}`,
  ].join('\n')
}

function style(value, enabled) {
  return enabled ? `\u001b[1;36m${value}\u001b[0m` : value
}

async function choose(io, question, choices) {
  const lines = choices.map((choice, index) => `  ${index + 1}. ${choice.label}`).join('\n')
  while (true) {
    const answer = (await io.question(`${question}:\n${lines}\n> `)).trim()
    const index = Number(answer || '1') - 1
    if (choices[index]) return choices[index].value
  }
}

function detectLanguage() {
  return /^fr\b/i.test(process.env.LC_ALL ?? process.env.LANG ?? '') ? 'fr' : 'en'
}
