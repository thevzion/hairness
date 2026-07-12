export async function handleCommand({ target, action, rest, flags, runtime }) {
  const mode = target ?? 'list'
  if (mode === 'list') return { sources: await runtime.sources.list() }
  if (mode === 'doctor') return runtime.sources.doctor(action)
  if (mode === 'read') {
    if (!action || !rest[0]) throw new Error('Usage: hairness source read <source> <operation> [--input JSON]')
    return runtime.sources.read(action, rest[0], flags.input ? JSON.parse(flags.input) : {})
  }
  throw new Error(`Unknown source action: ${mode}`)
}
