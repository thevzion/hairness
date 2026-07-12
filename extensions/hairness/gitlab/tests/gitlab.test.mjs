import test from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { sourceOperations } from '../index.mjs'

test('GitLab source owns project and merge request reads', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hairness-gitlab-'))
  const bin = join(root, 'glab.mjs')
  await writeFile(bin, '#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({path:process.argv[3]}))\n'); await chmod(bin, 0o755)
  process.env.HAIRNESS_GITLAB_BIN = bin
  assert.match((await sourceOperations.mr({ input: { project: 'team/app', iid: 2 } })).path, /merge_requests\/2/)
})
