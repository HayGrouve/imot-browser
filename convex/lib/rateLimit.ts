import { HOUR, RateLimiter } from '@convex-dev/rate-limiter'
import { components } from '../_generated/api'
import type { ActionCtx, MutationCtx } from '../_generated/server'
import { fail } from './errors'

/**
 * The app is open (no sign-in yet), so these keep it from hammering imot.bg
 * and OpenStreetMap on anyone's behalf. Only one import runs at a time anyway.
 */
const limits = new RateLimiter(components.rateLimiter, {
  /** Imports a browser can start: a steady 12 an hour, 4 in a row. */
  importPerWorkspace: {
    kind: 'token bucket',
    rate: 12,
    period: HOUR,
    capacity: 4,
  },
  /** Imports everyone together can start. */
  importAll: { kind: 'token bucket', rate: 60, period: HOUR, capacity: 10 },
  /** imot.bg search-form reads that miss the cache. */
  searchForm: { kind: 'token bucket', rate: 120, period: HOUR, capacity: 30 },
})

type LimitName = 'importPerWorkspace' | 'importAll' | 'searchForm'

/** Spends one use of a limit, or fails with `rateLimited`. */
export async function spend(
  ctx: MutationCtx | ActionCtx,
  name: LimitName,
  key: string,
) {
  const status = await limits.limit(ctx, name, { key })
  if (!status.ok) fail('rateLimited', { retryAfterMs: status.retryAfter })
}
