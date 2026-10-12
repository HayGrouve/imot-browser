import { paginationOptsValidator } from 'convex/server'
import { v } from 'convex/values'
import { internalMutation, mutation, query } from './_generated/server'
import { internal } from './_generated/api'
import type { Doc } from './_generated/dataModel'
import { fail } from './lib/errors'
import { isActive, latestJob } from './lib/jobs'
import { removeListing } from './lib/store'
import { bumpData, checkWorkspace, findWorkspace } from './lib/workspace'

/** A listing row as the browser gets it (without the bookkeeping columns). */
function forClient(row: Doc<'listings'>) {
  const { _id, _creationTime, workspace, lastJob, photosStored, ...rest } = row
  ;(void _id,
    void _creationTime,
    void workspace,
    void lastJob,
    void photosStored)
  return rest
}

/** The workspace's listings, a page at a time (the browser reads them all). */
export const page = query({
  args: { workspace: v.string(), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { workspace, paginationOpts }) => {
    checkWorkspace(workspace)
    const result = await ctx.db
      .query('listings')
      .withIndex('by_workspace_imot', (q) => q.eq('workspace', workspace))
      .paginate(paginationOpts)
    return { ...result, page: result.page.map(forClient) }
  },
})

function detailsForClient(row: Doc<'listingDetails'>) {
  const { _id, _creationTime, workspace, ...rest } = row
  ;(void _id, void _creationTime, void workspace)
  return rest
}

/** The heavy part of one listing: description, photos, features, contact. */
export const details = query({
  args: { workspace: v.string(), imotId: v.string() },
  handler: async (ctx, { workspace, imotId }) => {
    checkWorkspace(workspace)
    const row = await ctx.db
      .query('listingDetails')
      .withIndex('by_workspace_imot', (q) =>
        q.eq('workspace', workspace).eq('imotId', imotId),
      )
      .unique()
    return row ? detailsForClient(row) : null
  },
})

/** The heavy parts of up to 200 listings (the CSV export). */
export const detailsMany = query({
  args: { workspace: v.string(), imotIds: v.array(v.string()) },
  handler: async (ctx, { workspace, imotIds }) => {
    checkWorkspace(workspace)
    if (imotIds.length > 200) fail('badRequest')
    const out = []
    for (const imotId of imotIds) {
      const row = await ctx.db
        .query('listingDetails')
        .withIndex('by_workspace_imot', (q) =>
          q.eq('workspace', workspace).eq('imotId', imotId),
        )
        .unique()
      if (row) out.push(detailsForClient(row))
    }
    return out
  },
})

/** "Delete all data": every listing and search of the workspace, in the background. */
export const removeAll = mutation({
  args: { workspace: v.string() },
  returns: v.null(),
  handler: async (ctx, { workspace }) => {
    checkWorkspace(workspace)
    const ws = await findWorkspace(ctx, workspace)
    if (!ws) return null
    if (ws.deleting) fail('deleting')
    if (isActive(await latestJob(ctx, workspace))) fail('busy')
    await ctx.db.patch('workspaces', ws._id, { deleting: true })
    await ctx.scheduler.runAfter(0, internal.listings.deleteBatch, {
      workspace,
    })
    return null
  },
})

export const deleteBatch = internalMutation({
  args: { workspace: v.string() },
  returns: v.null(),
  handler: async (ctx, { workspace }) => {
    const ws = await findWorkspace(ctx, workspace)
    if (!ws) return null
    const rows = await ctx.db
      .query('listings')
      .withIndex('by_workspace_imot', (q) => q.eq('workspace', workspace))
      .take(200)
    for (const row of rows) await removeListing(ctx, row)
    if (rows.length === 200) {
      await ctx.db.patch('workspaces', ws._id, {
        listingCount: Math.max(0, ws.listingCount - rows.length),
      })
      await ctx.scheduler.runAfter(0, internal.listings.deleteBatch, {
        workspace,
      })
      return null
    }
    const sources = await ctx.db
      .query('sources')
      .withIndex('by_workspace_key', (q) => q.eq('workspace', workspace))
      .collect()
    for (const s of sources) await ctx.db.delete('sources', s._id)
    await bumpData(ctx, ws, { listingCount: 0, deleting: false })
    return null
  },
})
