// OpenStreetMap Nominatim answers, shared by every workspace (its usage
// policy asks for caching).

import { v } from 'convex/values'
import { internalMutation, internalQuery } from './_generated/server'

const hitV = v.object({
  lat: v.number(),
  lon: v.number(),
  type: v.string(),
  addresstype: v.string(),
  name: v.string(),
  display: v.string(),
})

export const get = internalQuery({
  args: { query: v.string() },
  returns: v.union(v.null(), v.array(hitV)),
  handler: async (ctx, { query }) => {
    const row = await ctx.db
      .query('geocache')
      .withIndex('by_query', (q) => q.eq('query', query))
      .first()
    return row?.results ?? null
  },
})

export const put = internalMutation({
  args: { query: v.string(), results: v.array(hitV) },
  returns: v.null(),
  handler: async (ctx, { query, results }) => {
    const row = await ctx.db
      .query('geocache')
      .withIndex('by_query', (q) => q.eq('query', query))
      .first()
    if (row) await ctx.db.patch('geocache', row._id, { results })
    else await ctx.db.insert('geocache', { query, results })
    return null
  },
})
