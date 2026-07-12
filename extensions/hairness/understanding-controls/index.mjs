const operations = new Set(['map', 'explain', 'compare'])

export async function handleCommand({ namespace, target, action, rest, flags }) {
  if (!operations.has(namespace)) throw new Error(`Unknown understanding operation: ${namespace}`)
  const focus = [target, action, ...rest].filter(Boolean).join(' ') || flags.focus || null
  return {
    summary: `Resolved ${namespace}${focus ? ` for ${focus}` : ''}.`,
    status: 'needs-inference',
    operation: { capability: 'hairness/understanding', id: namespace },
    focus,
    sourcePolicy: flags.sources ?? 'orient',
    presentation: flags.present ?? 'auto',
    limits: ['The main session must distinguish source proof from inference.'],
    routes: [],
  }
}
