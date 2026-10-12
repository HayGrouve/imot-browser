/// <reference types="vite/client" />
// Convex skips files with more than one dot, so this never deploys.
import rateLimiterTest from '@convex-dev/rate-limiter/test'
import { convexTest } from 'convex-test'
import schema from './schema'

// Function modules only: tests, this file and `.d.ts` all have extra dots.
export const modules = import.meta.glob([
  './**/*.ts',
  './_generated/*.js',
  '!./**/*.*.ts',
])

export function setupConvex() {
  const t = convexTest(schema, modules)
  rateLimiterTest.register(t, 'rateLimiter')
  return t
}

export type TestConvex = ReturnType<typeof setupConvex>
