import type { QueryCtx } from '../_generated/server'
import type { Doc } from '../_generated/dataModel'

export async function latestJob(ctx: QueryCtx, workspace: string) {
  return await ctx.db
    .query('imports')
    .withIndex('by_workspace', (q) => q.eq('workspace', workspace))
    .order('desc')
    .first()
}

export const isActive = (job: Doc<'imports'> | null) =>
  job?.status === 'queued' || job?.status === 'running'
