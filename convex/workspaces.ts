import { v } from 'convex/values'
import { query } from './_generated/server'
import { findWorkspace } from './lib/workspace'

/** How many listings the workspace has; `dataVersion` changes when they change in bulk. */
export const get = query({
  args: { workspace: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      listingCount: v.number(),
      dataVersion: v.number(),
      deleting: v.boolean(),
    }),
  ),
  handler: async (ctx, { workspace }) => {
    const ws = await findWorkspace(ctx, workspace)
    if (!ws) return null
    return {
      listingCount: ws.listingCount,
      dataVersion: ws.dataVersion,
      deleting: !!ws.deleting,
    }
  },
})
