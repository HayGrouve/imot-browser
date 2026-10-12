// Everything CI runs, in order: format, lint, typecheck, knip, tests, build.
import { spawnSync } from 'node:child_process'

const steps = ['check', 'lint', 'typecheck', 'knip', 'test', 'build']

for (const step of steps) {
  console.log(`\n▶ pnpm ${step}`)
  const result = spawnSync('pnpm', ['run', step], {
    stdio: 'inherit',
    env: process.env,
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
