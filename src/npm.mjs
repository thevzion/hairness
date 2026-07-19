import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { HairnessError } from './lib/errors.mjs'

const exec = promisify(execFile)

export async function npm(root, args) {
  try {
    return await exec('npm', args, {
      cwd: root,
      env: {
        ...process.env,
        npm_config_ignore_scripts: 'true',
        npm_config_audit: 'false',
        npm_config_fund: 'false',
        npm_config_update_notifier: 'false',
      },
      maxBuffer: 24 * 1024 * 1024,
    })
  } catch (error) {
    throw new HairnessError('npm_failed', error.stderr?.trim() || error.message, {
      exitCode: 4,
      cause: error,
      details: { args },
    })
  }
}

export function installArgs(...specs) {
  return ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--save-exact', ...specs]
}
