import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { resolve } from 'node:path'
import { createHome, previewCreate } from './create.mjs'
import { inspectGit } from '../runtime/git.mjs'

export async function runCreateWizard(destination, options = {}) {
  const io = options.io ?? createInterface({ input, output })
  const close = !options.io
  try {
    const detectedLanguage = detectLanguage()
    const language = options.language ?? await choose(io, `Preferred response language`, [
      { label: `${detectedLanguage} (detected)`, value: detectedLanguage },
      { label: 'English', value: 'en' },
      { label: 'French', value: 'fr' },
    ])
    const preset = options.preset ?? await choose(io, 'Setup', [
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
    const target = options.target !== undefined ? options.target : detectedTarget
      ? await choose(io, `First Target detected at ${detectedTarget}`, [
          { label: 'Use detected repository', value: detectedTarget },
          { label: 'Skip', value: null },
        ])
      : null
    const overlayGit = options.overlayGit ?? await choose(io, 'Version Overlay memory with local Git', [
      { label: 'Yes (recommended)', value: true },
      { label: 'No', value: false },
    ])
    const settings = { ...options, language, preset, from, providers, target, overlayGit }
    const preview = await previewCreate(resolve(destination), settings)
    output.write(`\nCreation preview\n${JSON.stringify(preview, null, 2)}\n`)
    const confirmed = options.yes ?? await choose(io, 'Create this Home', [
      { label: 'Create', value: true },
      { label: 'Cancel', value: false },
    ])
    if (!confirmed) return { status: 'cancelled', preview }
    return createHome(destination, settings)
  } finally {
    if (close) io.close()
  }
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

