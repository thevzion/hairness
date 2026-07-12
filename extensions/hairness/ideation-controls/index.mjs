const operations = new Set(['ideate', 'propose'])
const creativeModes = new Set(['divergent', 'lateral', 'convergent'])

export async function handleCommand({ namespace, target, action, rest, flags }) {
  if (!operations.has(namespace)) throw new Error(`Unknown ideation operation: ${namespace}`)
  const creative = flags.creative ?? (namespace === 'ideate' ? 'divergent' : 'convergent')
  if (!creativeModes.has(creative)) throw new Error(`Unknown creative mode: ${creative}`)
  const focus = [target, action, ...rest].filter(Boolean).join(' ') || flags.focus || null
  return {
    summary: `Resolved ${namespace} in ${creative} mode${focus ? ` for ${focus}` : ''}.`,
    status: 'needs-inference',
    operation: { capability: 'hairness/ideation', id: namespace },
    focus,
    creative,
    presentation: flags.present ?? 'auto',
    limits: [namespace === 'propose' ? 'Return one recommendation and expose its main tradeoff.' : 'Ideas are candidates, not decisions or proof.'],
    routes: [],
  }
}
