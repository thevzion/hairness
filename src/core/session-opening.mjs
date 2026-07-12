import { validateContract } from './contracts.mjs'

function measure(value) { return Buffer.byteLength(JSON.stringify(value)) }

export async function aggregateSessionOpening({ host = 'unknown', profile, distribution, trusted, contributions = [], limits = [] }) {
  const ordered = [...contributions].sort((left, right) => right.priority - left.priority)
  for (const contribution of ordered) {
    contribution.byteSize = measure({ ...contribution, byteSize: 0 })
    if (contribution.byteSize > 512) throw new Error(`${contribution.owner} session contribution exceeds 512 bytes.`)
    await validateContract('SessionContribution', contribution)
  }
  const language = profile.language ?? 'en'
  const opening = {
    schemaVersion: 2,
    protocolVersion: '0.2',
    host: ['codex', 'claude'].includes(host) ? host : 'unknown',
    profile,
    distribution,
    trusted,
    instruction: `Respond in ${language} for commentary, questions and final answers, unless the current user prompt explicitly requests another language.`,
    contributions: ordered,
    routes: [...new Set(ordered.flatMap((item) => item.routes))].slice(0, 8),
    limits: [...new Set([...limits, ...ordered.flatMap((item) => item.limits)])],
    byteSize: 0,
    observedAt: new Date().toISOString(),
  }
  opening.byteSize = measure(opening)
  opening.byteSize = measure(opening)
  if (opening.byteSize > 4096) throw new Error('Hairness SessionOpening exceeds 4 KiB.')
  return validateContract('SessionOpening', opening)
}
