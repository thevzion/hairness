export async function handleCommand({ root, namespace, target, action, flags, runtime }) {
  if (namespace === 'distribution') return runtime.distribution.update.inspect()
  if (namespace === 'migrate') {
    const mode = target ?? 'status'
    if (mode === 'status') return runtime.distribution.migration.status({ to: flags.to ?? 'current' })
    if (mode === 'plan') return runtime.distribution.migration.plan({ to: flags.to ?? 'current' })
    if (mode === 'apply') {
      if (!action || !flags.checkpoint) throw new Error('Usage: hairness migrate apply <plan-id> --checkpoint <id>')
      return runtime.distribution.migration.apply(action, flags.checkpoint)
    }
    throw new Error(`Unknown migrate action: ${mode}`)
  }
  const mode = target ?? 'check'
  if (mode === 'check') return runtime.distribution.update.check()
  if (mode === 'doctor') return runtime.distribution.update.doctor()
  if (mode === 'plan') {
    const plan = await runtime.distribution.update.plan({ to: flags.to, scope: flags.scope ?? 'all' })
    const artifact = {
      schemaVersion: 2,
      protocolVersion: '0.2',
      id: `distribution/${plan.id}`,
      type: 'distribution-update-plan',
      owner: 'hairness/distribution',
      revision: plan.id,
      runId: plan.id,
      summary: `Update ${plan.scope} is ${plan.status}.`,
      metadata: { labels: ['distribution', 'update'], signals: ['distribution.update'], relations: [], freshness: { policy: 'manual' }, provenance: { kind: 'extension', id: 'hairness/distribution', version: '0.2.0-alpha.0' } },
      payload: { planId: plan.id, scope: plan.scope, changes: plan.changes.map(({ candidateRoot, ...change }) => change), status: plan.status, checkpointId: plan.checkpointId },
      createdAt: plan.createdAt,
    }
    await runtime.artifacts.stage(plan.id, artifact)
    await runtime.artifacts.promote(plan.id)
    return { ...plan, artifact: { id: artifact.id, revision: artifact.revision } }
  }
  if (mode === 'apply') {
    const planId = action
    if (!planId || !flags.checkpoint) throw new Error('Usage: hairness update apply <plan-id> --checkpoint <id>')
    const receipt = await runtime.distribution.update.apply(planId, flags.checkpoint)
    const runId = `receipt-${planId}`
    const artifact = {
      schemaVersion: 2,
      protocolVersion: '0.2',
      id: `distribution/${planId}-receipt`,
      type: 'distribution-update-receipt',
      owner: 'hairness/distribution',
      revision: runId,
      runId,
      summary: `Applied update ${planId}.`,
      metadata: { labels: ['distribution', 'receipt'], signals: ['distribution.update'], relations: [], freshness: { policy: 'manual' }, provenance: { kind: 'extension', id: 'hairness/distribution', version: '0.2.0-alpha.0' } },
      payload: receipt,
      createdAt: receipt.completedAt,
    }
    await runtime.artifacts.stage(runId, artifact)
    await runtime.artifacts.promote(runId)
    return { ...receipt, artifact: { id: artifact.id, revision: artifact.revision } }
  }
  throw new Error(`Unknown update action: ${mode}`)
}

export async function attentionSignals({ runtime }) {
  try {
    const report = await runtime.distribution.update.doctor()
    return report.status === 'review-required' ? [{ state: 'active', priority: 55, summary: report.summary, route: 'hairness update doctor' }] : []
  } catch (error) {
    return [{ state: 'blocked', priority: 75, summary: error.message, route: 'hairness update doctor' }]
  }
}
