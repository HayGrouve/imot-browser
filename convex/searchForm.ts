'use node'

// The "Search imot.bg" dialog: imot.bg's own search form (read live, cached),
// and its link builder, which turns the filled-in form into a search link that
// is then imported.

import { ConvexError, v } from 'convex/values'
import { action } from './_generated/server'
import type { ActionCtx } from './_generated/server'
import { internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { Fetcher } from './lib/fetcher'
import { fail } from './lib/errors'
import { spend } from './lib/rateLimit'
import { checkWorkspace } from './lib/workspace'
import { optionsV } from './validators'
import { classifyUrl } from '../shared/parse'
import {
  BUILDER_URL,
  IMOT_BASE,
  SEARCH_DEALS,
  buildSearchParams,
  builderResult,
  isSearchDeal,
  locationFormParams,
  parseSearchForm,
} from '../shared/searchform'
import type { SearchDeal, SearchForm } from '../shared/searchform'

const FORM_TTL_MS = 6 * 3600_000

/** imot.bg answered, but not usefully (blocked, changed markup): a coded error for the UI. */
async function fromImot<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof ConvexError) throw err
    const code = (err as { code?: unknown }).code
    fail(code === 'blocked' ? 'blocked' : 'imotUnavailable', {
      message: err instanceof Error ? err.message : String(err),
    })
  }
}

async function formFor(
  ctx: ActionCtx,
  deal: SearchDeal,
  location: string,
): Promise<SearchForm> {
  const key = `${deal}|${location}`
  const cached = await ctx.runQuery(internal.searchForms.cached, { key })
  if (cached && Date.now() - cached.fetchedAt < FORM_TTL_MS)
    return JSON.parse(cached.form) as SearchForm
  await spend(ctx, 'searchForm', 'all')
  const form = await fromImot(async () => {
    const fetcher = new Fetcher({ minIntervalMs: 350, concurrency: 2 })
    // A place's form page has its own address (/search/prodazhbi/grad-sofiya), so ask the builder.
    const url = location
      ? builderResult(
          (await fetcher.post(BUILDER_URL, locationFormParams(deal, location)))
            .html,
        )
      : `${IMOT_BASE}/search/${SEARCH_DEALS[deal].path}`
    if (!url) fail('imotBuilder')
    const res = await fetcher.get(url)
    const schema = res.status === 200 ? parseSearchForm(res.html) : null
    if (!schema?.types.length) fail('formNotRecognised')
    return { ...schema, deal, location }
  })
  await ctx.runMutation(internal.searchForms.store, {
    key,
    form: JSON.stringify(form),
  })
  return form
}

/**
 * The form's option lists for a deal, plus the districts of `location` when one is given.
 * Returned as JSON: its keys (type ids, field names) aren't all valid Convex field names.
 */
export const get = action({
  args: { deal: v.string(), location: v.string() },
  returns: v.string(),
  handler: async (ctx, { deal, location }) => {
    if (!isSearchDeal(deal)) fail('badRequest')
    const base = await formFor(ctx, deal, '')
    if (!location) return JSON.stringify(base)
    if (!base.locations.some((l) => l.value === location))
      fail('unknownLocation')
    return JSON.stringify(await formFor(ctx, deal, location))
  },
})

const queryV = v.object({
  deal: v.string(),
  types: v.array(v.string()),
  location: v.string(),
  districts: v.array(v.string()),
  priceMin: v.string(),
  priceMax: v.string(),
  currency: v.string(),
  ppmMin: v.string(),
  ppmMax: v.string(),
  areaMin: v.string(),
  areaMax: v.string(),
  floorFrom: v.string(),
  floorTo: v.string(),
  sort: v.string(),
  keyword: v.string(),
  yardMin: v.string(),
  yardMax: v.string(),
  status: v.array(v.string()),
  yearFrom: v.string(),
  yearTo: v.string(),
  extras: v.record(v.string(), v.string()),
  photoOnly: v.boolean(),
  videoOnly: v.boolean(),
})

/** Ask imot.bg to build the search link for the filled-in form, then import it. */
export const startSearch = action({
  args: { workspace: v.string(), query: queryV, options: optionsV },
  returns: v.object({ url: v.string(), job: v.id('imports') }),
  handler: async (
    ctx,
    { workspace, query, options },
  ): Promise<{ url: string; job: Id<'imports'> }> => {
    checkWorkspace(workspace)
    await ctx.runMutation(internal.imports.reserve, { workspace })
    const url = await fromImot(async () => {
      const res = await new Fetcher({
        minIntervalMs: 350,
        concurrency: 1,
      }).post(BUILDER_URL, buildSearchParams(query))
      const href = builderResult(res.html)
      const c = href ? classifyUrl(href) : null
      if (c?.kind !== 'search') fail('imotBuilder')
      return c.url
    })
    const job = await ctx.runMutation(internal.imports.enqueueSearch, {
      workspace,
      url,
      options,
    })
    return { url, job }
  },
})
