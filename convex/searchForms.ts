// imot.bg's parsed search forms, shared by every workspace (6 h).

import { v } from 'convex/values'
import { internalMutation, internalQuery } from './_generated/server'

export const cached = internalQuery({
  args: { key: v.string() },
  returns: v.union(
    v.null(),
    v.object({ form: v.string(), fetchedAt: v.number() }),
  ),
  handler: async (ctx, { key }) => {
    const row = await ctx.db
      .query('searchForms')
      .withIndex('by_key', (q) => q.eq('key', key))
      .first()
    return row ? { form: row.form, fetchedAt: row.fetchedAt } : null
  },
})

export const store = internalMutation({
  args: { key: v.string(), form: v.string() },
  returns: v.null(),
  handler: async (ctx, { key, form }) => {
    const row = await ctx.db
      .query('searchForms')
      .withIndex('by_key', (q) => q.eq('key', key))
      .first()
    if (row)
      await ctx.db.patch('searchForms', row._id, {
        form,
        fetchedAt: Date.now(),
      })
    else
      await ctx.db.insert('searchForms', { key, form, fetchedAt: Date.now() })
    return null
  },
})
