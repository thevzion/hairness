const modes = ['auto', 'compact', 'visual', 'explicit', 'summary', 'diagram', 'tree', 'table', 'timeline', 'checklist', 'matrix', 'trace']

export async function handleCommand({ target, action, flags, runtime }) {
  if ((target ?? 'modes') === 'modes') return { modes, default: 'auto', maxViews: 3, limits: ['Presentation changes form, never meaning or proof.'], routes: [] }
  if (target !== 'request') throw new Error(`Unknown presentation action: ${target}`)
  const request = { mode: flags.mode ?? action ?? 'auto', maxViews: Number(flags['max-views'] ?? 3) }
  if (!modes.includes(request.mode)) throw new Error(`Unknown presentation mode: ${request.mode}`)
  await runtime.contracts.validateSchema('./schemas/presentation-request.schema.json', request, 'presentation request')
  return { ...request, summary: `Let the main session infer up to ${request.maxViews} sufficient view(s).`, limits: ['Do not invent content, structure, decisions, or proof.'], routes: [] }
}
