import { v } from 'convex/values'
import { internalMutation, mutation, query } from './_generated/server'
import { internal } from './_generated/api'
import { fail } from './lib/errors'
import { isActive, latestJob } from './lib/jobs'
import { removeListing } from './lib/store'
import { bumpData, checkWorkspace, findWorkspace } from './lib/workspace'

/** The workspace's imported searches. */
export const list = query({
  args: { workspace: v.string() },
  handler: async (ctx, { workspace }) => {
    checkWorkspace(workspace)
    const rows = await ctx.db
      .query('sources')
      .withIndex('by_workspace_key', (q) => q.eq('workspace', workspace))
      .collect()
    return rows.map(({ _id, _creationTime, workspace: _w, ...rest }) => {
      ;(void _id, void _creationTime, void _w)
      return rest
    })
  },
})

/** Remove a search, and the listings that came only from it (in the background). */
export const remove = mutation({
  args: { workspace: v.string(), key: v.string() },
  returns: v.null(),
  handler: async (ctx, { workspace, key }) => {
    checkWorkspace(workspace)
    const ws = await findWorkspace(ctx, workspace)
    if (!ws) return null
    if (ws.deleting) fail('deleting')
    if (isActive(await latestJob(ctx, workspace))) fail('busy')
    const row = await ctx.db
      .query('sources')
      .withIndex('by_workspace_key', (q) =>
        q.eq('workspace', workspace).eq('key', key),
      )
      .unique()
    if (!row) return null
    await ctx.db.delete('sources', row._id)
    await ctx.db.patch('workspaces', ws._id, { deleting: true })
    await ctx.scheduler.runAfter(0, internal.sources.detachBatch, {
      workspace,
      key,
      cursor: null,
    })
    return null
  },
})

export const detachBatch = internalMutation({
  args: {
    workspace: v.string(),
    key: v.string(),
    cursor: v.union(v.null(), v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { workspace, key, cursor }) => {
    const ws = await findWorkspace(ctx, workspace)
    if (!ws) return null
    const page = await ctx.db
      .query('listings')
      .withIndex('by_workspace_imot', (q) => q.eq('workspace', workspace))
      .paginate({ cursor, numItems: 200 })
    let removed = 0
    for (const row of page.page) {
      if (!row.sources.includes(key)) continue
      const sources = row.sources.filter((s) => s !== key)
      if (sources.length) await ctx.db.patch('listings', row._id, { sources })
      else {
        await removeListing(ctx, row)
        removed++
      }
    }
    const listingCount = Math.max(0, ws.listingCount - removed)
    if (!page.isDone) {
      await ctx.db.patch('workspaces', ws._id, { listingCount })
      await ctx.scheduler.runAfter(0, internal.sources.detachBatch, {
        workspace,
        key,
        cursor: page.continueCursor,
      })
      return null
    }
    await bumpData(ctx, ws, { listingCount, deleting: false })
    return null
  },
})
