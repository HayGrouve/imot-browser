'use node'

// The "Search imot.bg" dialog: imot.bg's own search form (read live, cached),
// and its link builder, which turns the filled-in form into a search link that
// is then imported. A drawn area becomes one search per place it reaches into.

import { ConvexError, v } from 'convex/values'
import type { Infer } from 'convex/values'
import { action } from './_generated/server'
import type { ActionCtx } from './_generated/server'
import { internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { Fetcher } from './lib/fetcher'
import { fail } from './lib/errors'
import { spend } from './lib/rateLimit'
import { checkWorkspace } from './lib/workspace'
import { optionsV } from './validators'
import {
  MAX_AREA_SEARCHES,
  planArea,
  planProblem,
  validArea,
} from '../shared/area'
import type { DistrictsData } from '../shared/area'
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
import type { SearchDeal, SearchForm, SearchQuery } from '../shared/searchform'
import districtsData from '../shared/districts-bg.json'

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

/** `fetcher`: the caller's, when it also reads imot.bg, so the requests keep one pace. */
async function formFor(
  ctx: ActionCtx,
  deal: SearchDeal,
  location: string,
  fetcher = new Fetcher({ minIntervalMs: 350, concurrency: 2 }),
): Promise<SearchForm> {
  const key = `${deal}|${location}`
  const cached = await ctx.runQuery(internal.searchForms.cached, { key })
  if (cached && Date.now() - cached.fetchedAt < FORM_TTL_MS)
    return JSON.parse(cached.form) as SearchForm
  await spend(ctx, 'searchForm', 'all')
  const form = await fromImot(async () => {
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

/** imot.bg's link builder: the search link for a filled-in form. */
async function linkFor(fetcher: Fetcher, query: SearchQuery): Promise<string> {
  const res = await fetcher.post(BUILDER_URL, buildSearchParams(query))
  const href = builderResult(res.html)
  const c = href ? classifyUrl(href) : null
  if (c?.kind !== 'search') fail('imotBuilder')
  return c.url
}

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
    const url = await fromImot(() =>
      linkFor(new Fetcher({ minIntervalMs: 350, concurrency: 1 }), query),
    )
    const job = await ctx.runMutation(internal.imports.enqueueSearch, {
      workspace,
      urls: [url],
      options,
    })
    return { url, job }
  },
})

const areaSearchV = v.object({
  location: v.string(),
  districts: v.number(),
  url: v.string(),
})

/**
 * Search inside a drawn area: per place it reaches into, the districts whose point is inside
 * (shared/area.ts), with the form's other filters. All the links go into one import.
 */
export const startAreaSearch = action({
  args: {
    workspace: v.string(),
    query: queryV.omit('location', 'districts'),
    area: v.array(v.array(v.number())),
    options: optionsV,
  },
  returns: v.object({
    searches: v.array(areaSearchV),
    job: v.id('imports'),
  }),
  handler: async (
    ctx,
    { workspace, query, area, options },
  ): Promise<{
    searches: Array<Infer<typeof areaSearchV>>
    job: Id<'imports'>
  }> => {
    checkWorkspace(workspace)
    if (!isSearchDeal(query.deal)) fail('badRequest')
    const deal = query.deal
    const poly = validArea(area)
    if (!poly) fail('badArea')
    // The plan is made here, from the area: a district list from the browser isn't trusted.
    const plan = planArea(poly, districtsData as unknown as DistrictsData)
    const problem = planProblem(plan)
    if (problem)
      fail(problem, {
        searches: plan.searches.length,
        max: MAX_AREA_SEARCHES,
      })
    await ctx.runMutation(internal.imports.reserve, { workspace })
    const fetcher = new Fetcher({ minIntervalMs: 350, concurrency: 1 })
    const searches: Array<Infer<typeof areaSearchV>> = []
    for (const s of plan.searches) {
      // imot.bg's builder drops districts it doesn't know, and with none left it would search
      // the whole place: keep to the ones its form offers today.
      const form = await formFor(ctx, deal, s.location, fetcher)
      const districts = s.districts.filter((d) => form.districts.includes(d))
      if (!districts.length) continue
      const url = await fromImot(() =>
        linkFor(fetcher, { ...query, location: s.location, districts }),
      )
      searches.push({ location: s.location, districts: districts.length, url })
    }
    if (!searches.length) fail('areaEmpty')
    const job = await ctx.runMutation(internal.imports.enqueueSearch, {
      workspace,
      urls: searches.map((s) => s.url),
      options,
    })
    return { searches, job }
  },
})
