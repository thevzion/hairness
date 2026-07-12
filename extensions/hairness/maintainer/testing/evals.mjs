import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { join } from 'node:path'

const suites = {
  'cockpit-language': { prompt: 'Use the injected Hairness opening. Reply with one short sentence confirming the active language. Do not use tools.', gates: ['language', 'tool-count:0', 'compact'] },
  'cockpit-wake-up': { prompt: 'Run the Hairness wake-up behavior from the fresh opening. Return the highest-priority signal and next route. Do not refresh.', gates: ['route', 'tool-count:0', 'compact'] },
  'cockpit-help': { prompt: 'Explain the primary Hairness commands only. Keep the answer compact.', gates: ['route', 'no-exploration', 'compact'] },
}
const effort = { fast: 'low', balanced: 'medium', deep: 'high' }
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

function runCommand(file, args, { cwd, timeout = 300_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''; let stderr = ''
    const append = (current, chunk) => `${current}${chunk}`.slice(-10 * 1024 * 1024)
    child.stdout.on('data', (chunk) => { stdout = append(stdout, chunk) })
    child.stderr.on('data', (chunk) => { stderr = append(stderr, chunk) })
    const timer = setTimeout(() => {
      try { process.platform === 'win32' ? child.kill('SIGKILL') : process.kill(-child.pid, 'SIGKILL') } catch {}
    }, timeout)
    child.on('error', reject)
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      if (code === 0) resolve(stdout)
      else {
        const error = new Error(signal ? 'Provider transport timed out.' : `Provider transport exited with code ${code}.`)
        error.code = signal ? 'provider-timeout' : /authenticate|oauth|login/i.test(`${stdout}\n${stderr}`) ? 'provider-authentication-failed' : 'provider-failed'
        error.cause = stderr.slice(-1000)
        reject(error)
      }
    })
  })
}

async function runProvider(root, plan) {
  const started = performance.now()
  const openingOutput = await runCommand(process.execPath, [join(root, 'bin/hairness.mjs'), 'session', 'opening', '--host', plan.provider, '--json'], { cwd: root, timeout: 5_000 })
  const opening = JSON.parse(openingOutput).data
  const prompt = `Hairness SessionOpening:\n${JSON.stringify(opening)}\n\nUser intent:\n${plan.prompt}`
  let stdout
  if (plan.provider === 'codex') {
    const args = ['exec', '--ephemeral', '--json', '--sandbox', 'read-only', '-C', root, '-c', `model_reasoning_effort="${effort[plan.profile]}"`]
    if (plan.model) args.push('--model', plan.model)
    args.push(prompt)
    stdout = await runCommand('codex', args, { cwd: root })
  } else {
    const args = ['--print', '--output-format', 'json', '--effort', effort[plan.profile], '--permission-mode', 'plan', '--no-session-persistence']
    if (plan.model) args.push('--model', plan.model)
    args.push(prompt)
    stdout = await runCommand('claude', args, { cwd: root })
  }
  const durationMs = Math.round((performance.now() - started) * 100) / 100
  if (plan.provider !== 'codex') return { durationMs, text: JSON.parse(stdout).result ?? '', toolCount: 0 }
  const events = stdout.trim().split('\n').flatMap((line) => { try { return [JSON.parse(line)] } catch { return [] } })
  const text = events.flatMap((event) => event.type === 'item.completed' && event.item?.type === 'agent_message' ? [event.item.text] : []).at(-1) ?? ''
  const toolCount = events.filter((event) => event.type === 'item.completed' && ['command_execution', 'mcp_tool_call', 'web_search'].includes(event.item?.type)).length
  return { durationMs, text, toolCount }
}

function evaluate(plan, response) {
  const { text, toolCount } = response
  const lower = text.toLowerCase()
  const gates = {
    language: plan.language === 'fr' ? /[àâçéèêëîïôùûü]|\b(je|la|le|en|français)\b/i.test(text) : true,
    route: /hairness|route|onboarding|wake-up|help/i.test(text),
    'tool-count:0': toolCount === 0,
    compact: text.length > 0 && text.length < 1200,
    'no-exploration': !/searched|explored|inspected files/.test(lower),
  }
  return plan.gates.map((gate) => ({ gate, ok: gates[gate] ?? false }))
}

export async function command({ root, runtime, action, rest, flags }) {
  const mode = action ?? 'list'
  if (mode === 'list') return { suites: Object.entries(suites).map(([id, value]) => ({ id, gates: value.gates })) }
  if (mode === 'plan') {
    const suite = rest[0] ?? flags.suite; const provider = flags.provider; const profile = flags.profile
    if (!suites[suite] || !['codex', 'claude'].includes(provider) || !['fast', 'balanced', 'deep'].includes(profile)) throw new Error('Usage: hairness maintain eval plan <suite> --provider <codex|claude> --profile <fast|balanced|deep>')
    const preferences = await runtime.distribution.preferences()
    const model = preferences.providers?.[provider]?.profiles?.[profile]?.model ?? null
    const plan = { id: `eval-${hash({ suite, provider, profile, model }).slice(0, 16)}`, suite, provider, profile, model, language: preferences.interaction?.language ?? 'en', repetitions: profile === 'fast' ? 3 : 1, ...suites[suite] }
    plan.checkpointId = `checkpoint-${hash(plan).slice(0, 16)}`
    await runtime.overlay.write(`evals/plans/${plan.id}.json`, plan)
    return { ...plan, status: model ? 'ready' : 'needs-input', limits: model ? [] : [`No local ${provider}.${profile} model preference; provider default will be recorded as unresolved.`], routes: [`hairness maintain eval run ${suite} --checkpoint ${plan.checkpointId}`] }
  }
  if (mode === 'run') {
    const suite = rest[0] ?? flags.suite
    const plans = await runtime.overlay.list('evals/plans')
    let plan = null
    for (const file of plans) { const candidate = await runtime.overlay.read(`evals/plans/${file}`); if (candidate.suite === suite && candidate.checkpointId === flags.checkpoint) plan = candidate }
    if (!plan) throw new Error('Eval checkpoint is missing or stale.')
    const attempts = []
    for (let index = 0; index < plan.repetitions; index += 1) {
      const started = performance.now()
      let response; let transportLimit = null
      try { response = await runProvider(root, plan) } catch (error) { response = { durationMs: Math.round((performance.now() - started) * 100) / 100, text: '', toolCount: 0 }; transportLimit = error.code ?? 'provider-failed' }
      const gates = evaluate(plan, response)
      const attempt = { id: `eval-attempt-${randomUUID()}`, suite, provider: plan.provider, profile: plan.profile, model: plan.model ?? 'provider-default-unresolved', durationMs: response.durationMs, responseDigest: `sha256:${hash(response.text)}`, toolCount: response.toolCount, gates, status: !transportLimit && gates.every((gate) => gate.ok) ? 'passed' : 'failed', limits: transportLimit ? [transportLimit] : [], observedAt: new Date().toISOString() }
      await runtime.overlay.write(`evals/attempts/${attempt.id}.json`, attempt); attempts.push(attempt)
    }
    const limits = [...new Set([...attempts.flatMap((attempt) => attempt.limits), ...(plan.model ? [] : ['Actual model could not be resolved from local preferences.'])])]
    return { summary: `${attempts.filter((item) => item.status === 'passed').length}/${attempts.length} provider evals passed.`, status: attempts.every((item) => item.status === 'passed') ? 'passed' : 'failed', attempts, limits, routes: [] }
  }
  if (mode === 'show') return runtime.overlay.read(`evals/attempts/${rest[0] ?? flags.attempt}.json`, null)
  if (mode === 'attest') {
    const attempts = await Promise.all(rest.map((id) => runtime.overlay.read(`evals/attempts/${id}.json`, null)))
    if (attempts.some((attempt) => !attempt || attempt.status !== 'passed')) throw new Error('Only complete passing attempts can be attested.')
    return { schemaVersion: 2, protocolVersion: '0.2', digest: `sha256:${hash(attempts)}`, suites: [...new Set(attempts.map((item) => item.suite))], providers: [...new Set(attempts.map((item) => item.provider))], profiles: [...new Set(attempts.map((item) => item.profile))], passes: attempts.length, observedAt: new Date().toISOString(), limits: [], routes: [] }
  }
  throw new Error(`Unknown maintain eval action: ${mode}`)
}
