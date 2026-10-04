import { build } from 'esbuild'
import { mkdirSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

mkdirSync('work/tests', { recursive: true })
const tests = ['window-test', 'asset-test', 'recovery-test', 'player-test', 'studio-test']
for (const test of tests) {
  const source = `scripts/${test}.ts`
  if (!existsSync(source)) throw new Error(`Missing test: ${source}`)
  const outfile = join('work/tests', `${test}.mjs`)
  await build({ entryPoints: [source], bundle: true, platform: 'node', format: 'esm', outfile,
    alias: { '@shared': './src/shared' }, external: ['recovery-test', 'studio-test'].includes(test) ? ['./exportHtml'] : [], logLevel: 'warning' })
  const result = spawnSync(process.execPath, [outfile], { stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
