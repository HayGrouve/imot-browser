import type { MutationCtx, QueryCtx } from '../_generated/server'
import type { Doc } from '../_generated/dataModel'
import { fail } from './errors'

/** The browser's random key (crypto.randomUUID): it is the only access check there is. */
export function checkWorkspace(key: string) {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(key)) fail('badWorkspace')
}

export async function findWorkspace(
  ctx: QueryCtx,
  key: string,
): Promise<Doc<'workspaces'> | null> {
  checkWorkspace(key)
  return await ctx.db
    .query('workspaces')
    .withIndex('by_key', (q) => q.eq('key', key))
    .unique()
}

export async function ensureWorkspace(
  ctx: MutationCtx,
  key: string,
): Promise<Doc<'workspaces'>> {
  const found = await findWorkspace(ctx, key)
  if (found) return found
  const id = await ctx.db.insert('workspaces', {
    key,
    listingCount: 0,
    dataVersion: 0,
  })
  return (await ctx.db.get('workspaces', id))!
}

/** Open browsers reload their listings when this changes. */
export async function bumpData(
  ctx: MutationCtx,
  ws: Doc<'workspaces'>,
  patch: Partial<Doc<'workspaces'>> = {},
) {
  await ctx.db.patch('workspaces', ws._id, {
    ...patch,
    dataVersion: ws.dataVersion + 1,
  })
}
