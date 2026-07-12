import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { changeImpact } from '../extensions/hairness/maintainer/index.mjs'
import { validateContract } from '../src/core/contracts.mjs'

const exec = promisify(execFile)
const root = new URL('../', import.meta.url).pathname
const report = await changeImpact({ root, runtime: { contracts: { validate: validateContract } } })
if (report.decision === 'must-update' || report.decision === 'needs-split') {
  console.error(`${report.decision}: ${report.summary}`)
  for (const route of report.routes) console.error(`- ${route}`)
  process.exitCode = 1
} else if (report.decision === 'review-required') {
  const dirty = (await exec('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' })).stdout.trim()
  if (dirty && !process.env.CI) {
    console.log(`review-required: ${report.summary}; the Git checkpoint must record its justification.`)
    process.exit(0)
  }
  let message = ''
  try { message = (await exec('git', ['-C', root, 'log', '-1', '--format=%B'], { encoding: 'utf8' })).stdout } catch {}
  if (!/^Impact-Review:\s+\S.+$/m.test(message)) {
    console.error('review-required: add a justified Impact-Review: footer to the commit.')
    process.exitCode = 1
  }
}
