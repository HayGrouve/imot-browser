'use node'

// The import's steps that fetch pages, each a scheduled action well inside
// Convex's 10-minute limit: search pages (with price-band splitting past
// imot.bg's 1000-result cap), then listing pages in batches, then places that
// need OpenStreetMap. convex/imports.ts saves what they find.

import { createHash } from 'node:crypto'
import { v } from 'convex/values'
import { internalAction } from './_generated/server'
import type { ActionCtx } from './_generated/server'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import { Fetcher, pool } from './lib/fetcher'
import type { Card } from './lib/store'
import type { LogParams, Progress } from './validators'
import { Gazetteer } from '../shared/gazetteer'
import type { GazetteerData } from '../shared/gazetteer'
import {
  MANUAL_SOURCE,
  MAX_LISTINGS,
  NBHD_VERSION,
  locateOffline,
  lookupHood,
  lookupKey,
  mergeDetail,
  onlineLookups,
  splitRange,
} from '../shared/importer'
import type { PlaceTarget } from '../shared/importer'
import {
  MAX_PAGES,
  PAGE_SIZE,
  classifyUrl,
  getPriceRange,
  parseDetailPage,
  parseSearchPage,
  searchPageUrl,
  thumbPhotoUrl,
  withPriceRange,
} from '../shared/parse'
import type { SearchPage } from '../shared/parse'
import {
  NOMINATIM_UA,
  geocodeSettlement,
  nominatimUrl,
  parseNominatim,
} from '../shared/geocode'
import type { NominatimHit } from '../shared/geocode'
import type { ListingFields, Nbhd, Place } from '../shared/types'
import gazetteerData from '../shared/gazetteer-bg.json'

/** Each step hands over to a fresh run of itself after this long. */
const BUDGET_MS = 7 * 60_000
const DETAIL_BATCH = 12

let gazetteer: Gazetteer | null = null
const gaz = () =>
  (gazetteer ??= new Gazetteer(gazetteerData as unknown as GazetteerData))

const sourceKeyFor = (url: string) =>
  createHash('sha1').update(url).digest('hex').slice(0, 10)

class Cancelled extends Error {
  code = 'cancelled'
  constructor() {
    super('cancelled')
  }
}

const codeOf = (err: unknown) => (err as { code?: unknown } | null)?.code
const messageOf = (err: unknown) =>
  err instanceof Error ? err.message : String(err)

/**
 * Collects a step's progress and log lines and sends them every 1.5 s, which is also the
 * heartbeat. When the import is cancelled, the answer aborts the step's requests.
 */
class Reporter {
  readonly abort = new AbortController()
  progress: Partial<Progress> = {}
  private log: Array<{ t: number; code: string; params: LogParams }> = []
  private inputs: Doc<'imports'>['inputs'] | null = null
  private sentRequests = 0
  private timer: ReturnType<typeof setInterval> | null = null
  private sending: Promise<void> = Promise.resolve()
  fetcher: Fetcher

  constructor(
    private ctx: ActionCtx,
    private job: Id<'imports'>,
  ) {
    this.fetcher = new Fetcher({
      minIntervalMs: 350,
      concurrency: 3,
      signal: this.abort.signal,
    })
  }

  start() {
    this.timer = setInterval(() => void this.flush(), 1500)
    return this
  }

  add(code: string, params: LogParams = {}) {
    this.log.push({ t: Date.now(), code, params })
  }

  warn(code: string, params: LogParams = {}) {
    this.add(code, { ...params, level: 'warn' })
  }

  setInputs(inputs: Doc<'imports'>['inputs']) {
    this.inputs = inputs
  }

  get cancelled() {
    return this.abort.signal.aborted
  }

  /** Throws when the import was cancelled. */
  check() {
    if (this.cancelled) throw new Cancelled()
  }

  flush(): Promise<void> {
    this.sending = this.sending.then(async () => {
      const requests = this.fetcher.requests - this.sentRequests
      const log = this.log
      const progress = this.progress
      const inputs = this.inputs
      this.log = []
      this.progress = {}
      this.inputs = null
      this.sentRequests += requests
      try {
        const { stop } = await this.ctx.runMutation(internal.imports.report, {
          job: this.job,
          progress,
          log,
          requests,
          ...(inputs ? { inputs } : {}),
        })
        if (stop) this.abort.abort(new Cancelled())
      } catch {
        // Not sent: keep it for the next try.
        this.log = [...log, ...this.log]
        this.progress = { ...progress, ...this.progress }
        this.sentRequests -= requests
      }
    })
    return this.sending
  }

  async stop() {
    if (this.timer) clearInterval(this.timer)
    await this.flush()
  }
}

async function loadJob(ctx: ActionCtx, job: Id<'imports'>) {
  const doc = await ctx.runQuery(internal.imports.get, { job })
  return doc && doc.status === 'running' ? doc : null
}

async function finish(
  ctx: ActionCtx,
  job: Id<'imports'>,
  err: unknown,
): Promise<void> {
  if (err instanceof Cancelled || codeOf(err) === 'cancelled') {
    await ctx.runMutation(internal.imports.finish, { job, status: 'cancelled' })
    return
  }
  const code = codeOf(err)
  await ctx.runMutation(internal.imports.finish, {
    job,
    status: 'error',
    error: {
      code: typeof code === 'string' ? code : 'error',
      message: messageOf(err),
    },
  })
}

// ---------------------------------------------------------------- step 1: search pages

interface SourceRecord {
  /** The search stopped early: its page count and totals are incomplete. */
  partial: boolean
  key: string
  url: string
  input: string
  paramsText: string
  total: number | null
  capped: boolean
  found: number
  splits: number
  error?: string
}

export const runSearch = internalAction({
  args: { job: v.id('imports') },
  returns: v.null(),
  handler: async (ctx, { job: jobId }) => {
    const job = await loadJob(ctx, jobId)
    if (!job) return null
    const r = new Reporter(ctx, jobId).start()
    const cards = new Map<string, Card>()
    const sources: Array<SourceRecord> = []
    const inputs = job.inputs.map((i) => ({ ...i }))
    const progress = { searchPages: 0, searchPagesTotal: 0, found: 0 }
    let manual = false
    let failure: unknown = null
    let maxWarned = false
    const full = () => cards.size >= MAX_LISTINGS
    const sync = () => {
      r.progress = { ...r.progress, ...progress, found: cards.size }
    }

    const fetchSearchPage = async (
      url: string,
      page: number,
    ): Promise<SearchPage> => {
      r.check()
      const pageUrl = searchPageUrl(url, page)
      const res = await r.fetcher.get(pageUrl)
      if (res.status === 404) {
        throw Object.assign(
          new Error(`imot.bg returned "page not found" for ${pageUrl}`),
          { code: 'searchNotFound' },
        )
      }
      const parsed = parseSearchPage(res.html)
      progress.searchPages++
      sync()
      return parsed
    }

    // Listings each search found (one listing can be in several searches of an import).
    const seen = new Map<string, Set<string>>()
    const addCards = (src: SourceRecord, items: Array<ListingFields>) => {
      let mine = seen.get(src.key)
      if (!mine) seen.set(src.key, (mine = new Set()))
      for (const item of items) {
        const prev = cards.get(item.id)
        if (full() && !prev) {
          if (!maxWarned) {
            r.warn('maxListings', { max: MAX_LISTINGS })
            maxWarned = true
          }
          return
        }
        if (!mine.has(item.id)) {
          mine.add(item.id)
          src.found++
        }
        cards.set(item.id, {
          fields: item,
          sources: [...new Set([...(prev?.sources ?? []), src.key])],
          manual: prev?.manual ?? false,
          offline: null,
        })
      }
      sync()
    }

    const collectSearch = async (src: SourceRecord) => {
      const visit = async (url: string, depth: number): Promise<void> => {
        if (full()) return
        const first = await fetchSearchPage(url, 1)
        progress.searchPagesTotal++
        if (depth === 0) {
          Object.assign(src, {
            total: first.total,
            capped: first.capped,
            paramsText: first.paramsText,
          })
          r.add('searchStarted', {
            input: src.input,
            total: first.total,
            capped: first.capped,
          })
        }
        if (first.capped) {
          const range = getPriceRange(url)
          const parts =
            job.options.autoSplit && depth < 16
              ? splitRange(range.min, range.max)
              : null
          if (parts) {
            src.splits++
            r.add('splitting', { min: range.min, max: range.max })
            for (const [a, b] of parts)
              await visit(withPriceRange(url, a, b), depth + 1)
            return
          }
          r.warn(job.options.autoSplit ? 'cappedCannotSplit' : 'capped', {
            input: src.input,
            min: range.min,
            max: range.max,
          })
        }
        addCards(src, first.items)
        const pages = first.total
          ? Math.min(Math.ceil(first.total / PAGE_SIZE), MAX_PAGES)
          : null
        if (pages) {
          progress.searchPagesTotal += pages - 1
          const rest = Array.from({ length: pages - 1 }, (_, i) => i + 2)
          await pool(rest, 3, async (p) => {
            if (full()) return
            const page = await fetchSearchPage(url, p)
            addCards(src, page.items)
          })
        } else {
          // Unknown total: follow "next" links.
          let page = 1
          let cur = first
          while (cur.hasNext && page < MAX_PAGES && !full()) {
            page++
            progress.searchPagesTotal++
            cur = await fetchSearchPage(url, page)
            addCards(src, cur.items)
          }
        }
      }
      await visit(src.url, 0)
    }

    try {
      for (const [i, entry] of inputs.entries()) {
        r.check()
        const c = classifyUrl(entry.input)
        if (c.kind === 'unsupported') {
          r.warn('unsupportedUrl', {
            input: entry.input,
            reason: c.notes[0] ?? '',
          })
          continue
        }
        if (
          c.notes.includes('removed:plnk') ||
          c.notes.includes('removed:slink')
        )
          r.add('sessionParamRemoved', { input: entry.input })
        if (c.kind === 'listing' && c.id) {
          manual = true
          const prev = cards.get(c.id)
          cards.set(c.id, {
            fields: prev?.fields ?? { id: c.id, url: c.url },
            sources: [...new Set([...(prev?.sources ?? []), MANUAL_SOURCE])],
            manual: true,
            offline: null,
          })
          sync()
          continue
        }
        const src: SourceRecord = {
          partial: false,
          key: sourceKeyFor(c.url),
          url: c.url,
          input: entry.input,
          paramsText: '',
          total: null,
          capped: false,
          found: 0,
          splits: 0,
        }
        // A search that stops early still names its listings' source, but must not
        // overwrite what an earlier complete import recorded (afterSearch).
        let stop: unknown = null
        try {
          await collectSearch(src)
        } catch (err) {
          src.partial = true
          if (codeOf(err) === 'blocked' || r.cancelled) stop = err
          else {
            src.error =
              typeof codeOf(err) === 'string'
                ? (codeOf(err) as string)
                : 'error'
            r.warn('searchFailed', {
              input: entry.input,
              message: messageOf(err),
            })
          }
        }
        if (!stop && !src.found && !src.error)
          r.warn('noResults', { input: entry.input })
        if (!stop && src.capped && src.splits)
          r.add('splitApplied', {
            input: entry.input,
            splits: src.splits,
            found: src.found,
          })
        sources.push(src)
        inputs[i] = { ...entry, paramsText: src.paramsText }
        r.setInputs(inputs)
        if (stop) throw stop
      }
    } catch (err) {
      failure = r.cancelled ? new Cancelled() : err
    }

    // Save what was collected, even when the search stopped early.
    try {
      const g = gaz()
      const list = [...cards.values()].map((card) => ({
        ...card,
        offline: locateOffline(g, card.fields as ListingFields),
      }))
      sync()
      await r.stop()
      for (let k = 0; k < list.length; k += 100)
        await ctx.runMutation(internal.imports.saveCards, {
          job: jobId,
          cards: list.slice(k, k + 100),
        })
      const outcome = failure
        ? failure instanceof Cancelled
          ? 'cancelled'
          : 'error'
        : 'ok'
      const code = codeOf(failure)
      await ctx.runMutation(internal.imports.afterSearch, {
        job: jobId,
        sources: sources.map(({ error, ...s }) => {
          void error
          return s
        }),
        manual,
        outcome,
        ...(outcome === 'error'
          ? {
              error: {
                code: typeof code === 'string' ? code : 'error',
                message: messageOf(failure),
              },
            }
          : {}),
      })
    } catch (err) {
      await finish(ctx, jobId, err)
    }
    return null
  },
})

// ---------------------------------------------------------------- step 2: listing pages

export const runDetails = internalAction({
  args: { job: v.id('imports') },
  returns: v.null(),
  handler: async (ctx, { job: jobId }) => {
    const job = await loadJob(ctx, jobId)
    if (!job) return null
    if (job.cancelRequested) {
      await finish(ctx, jobId, new Cancelled())
      return null
    }
    const started = Date.now()
    const r = new Reporter(ctx, jobId).start()
    const g = gaz()
    try {
      for (;;) {
        r.check()
        const batch = await ctx.runMutation(internal.imports.claimItems, {
          job: jobId,
          count: DETAIL_BATCH,
        })
        if (!batch.length) {
          await r.stop()
          await ctx.runMutation(internal.imports.afterDetails, { job: jobId })
          return null
        }
        const results: Array<{
          item: Id<'importItems'>
          url: string
          outcome: 'ok' | 'gone' | 'failed'
          fields?: Card['fields']
          offline?: Card['offline']
          message?: string
        }> = []
        let stop: unknown = null
        await pool(batch, 3, async (it) => {
          if (stop) return
          try {
            r.check()
            const res = await r.fetcher.get(it.url)
            const d =
              res.status === 404
                ? { gone: true as const }
                : parseDetailPage(res.html)
            if (!d) throw new Error('unrecognised listing page')
            if (d.gone) {
              results.push({ item: it.item, url: it.url, outcome: 'gone' })
              return
            }
            const merged = mergeDetail(it.card, d)
            // Keyed by the ID it was imported under, whatever the page says.
            merged.id = it.card.id
            merged.detailsFetchedAt = job.now
            merged.descriptionFull = !!d.description
            if (!merged.thumb && merged.photos?.length)
              merged.thumb = thumbPhotoUrl(merged.photos[0])
            results.push({
              item: it.item,
              url: it.url,
              outcome: 'ok',
              fields: merged,
              offline: locateOffline(g, merged),
            })
          } catch (err) {
            if (codeOf(err) === 'blocked' || r.cancelled) {
              stop ??= r.cancelled ? new Cancelled() : err
              return
            }
            results.push({
              item: it.item,
              url: it.url,
              outcome: 'failed',
              message: messageOf(err),
            })
          }
        })
        if (results.length)
          await ctx.runMutation(internal.imports.saveDetails, {
            job: jobId,
            results,
          })
        if (stop) throw stop
        if (Date.now() - started > BUDGET_MS) {
          await r.stop()
          await ctx.scheduler.runAfter(0, internal.importer.runDetails, {
            job: jobId,
          })
          return null
        }
      }
    } catch (err) {
      await r.stop()
      await finish(ctx, jobId, err)
    }
    return null
  },
})

// ---------------------------------------------------------------- step 3: places online

interface Target extends PlaceTarget {
  id: Id<'listings'>
}

export const runGeocode = internalAction({
  args: { job: v.id('imports') },
  returns: v.null(),
  handler: async (ctx, { job: jobId }) => {
    const job = await loadJob(ctx, jobId)
    if (!job) return null
    if (job.cancelRequested || !job.options.geocodeOnline) {
      await (job.cancelRequested
        ? finish(ctx, jobId, new Cancelled())
        : ctx.runMutation(internal.imports.finish, {
            job: jobId,
            status: 'done',
          }))
      return null
    }
    const started = Date.now()
    const r = new Reporter(ctx, jobId).start()
    try {
      // Which places and neighbourhoods of this import the gazetteer couldn't settle.
      const settlements = new Map<string, Array<Target>>()
      const hoods = new Map<string, Array<Target>>()
      const add = (map: Map<string, Array<Target>>, k: string, t: Target) => {
        const list = map.get(k)
        if (list) list.push(t)
        else map.set(k, [t])
      }
      let cursor: string | null = null
      for (;;) {
        const page: { done: boolean; cursor: string; rows: Array<Target> } =
          await ctx.runQuery(internal.imports.geocodeTargets, {
            job: jobId,
            cursor,
          })
        for (const t of page.rows) {
          const want = onlineLookups(t)
          if (want.settlement) add(settlements, want.settlement, t)
          if (want.hood) add(hoods, want.hood, t)
        }
        if (page.done) break
        cursor = page.cursor
      }
      const total = settlements.size + hoods.size
      let done = 0
      r.progress = { geocode: 0, geocodeTotal: total }
      if (total)
        r.add('geocoding', {
          settlements: settlements.size,
          neighborhoods: hoods.size,
        })

      let last = 0
      const search = async (
        query: string,
      ): Promise<Array<NominatimHit> | null> => {
        const hit = await ctx.runQuery(internal.geocache.get, { query })
        if (hit) return hit
        r.check()
        // Nominatim's usage policy: at most one request a second, and cache the answers.
        const wait = last + 1100 - Date.now()
        if (wait > 0) await new Promise((res) => setTimeout(res, wait))
        last = Date.now()
        const res = await fetch(nominatimUrl(query), {
          headers: { 'User-Agent': NOMINATIM_UA, Accept: 'application/json' },
          signal: AbortSignal.any([
            r.abort.signal,
            AbortSignal.timeout(30_000),
          ]),
        })
        // Only real answers are cached: a refusal or an error is tried again next time.
        if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`)
        const results = parseNominatim(await res.json())
        await ctx.runMutation(internal.geocache.put, { query, results })
        return results
      }
      const apply = async (
        ids: Array<Id<'listings'>>,
        patch: { place?: Place; nbhd?: Nbhd },
      ) => {
        for (let k = 0; k < ids.length; k += 400)
          await ctx.runMutation(internal.imports.applyGeocode, {
            ids: ids.slice(k, k + 400),
            ...patch,
          })
      }
      const tick = async () => {
        done++
        r.progress = { ...r.progress, geocode: done }
        if (Date.now() - started > BUDGET_MS) {
          await r.stop()
          await ctx.scheduler.runAfter(0, internal.importer.runGeocode, {
            job: jobId,
          })
          return true
        }
        return false
      }

      try {
        for (const list of settlements.values()) {
          const t = list[0]
          const ambiguous = t.place?.match === 'ambiguous'
          const name = t.place?.name || t.settlement || ''
          const kind = t.place?.kind || t.settlementKind
          const found = await geocodeSettlement(search, name, t.oblast, kind, {
            near: ambiguous ? t.place : null,
          })
          if (found) {
            const place: Place = {
              ...(t.place ?? {}),
              key: `osm:${found.lat.toFixed(4)},${found.lon.toFixed(4)}`,
              lookup: lookupKey(t.oblast, name, kind),
              name,
              nameEn: t.place?.nameEn ?? null,
              kind: kind ?? null,
              oblast: t.oblast,
              lat: found.lat,
              lon: found.lon,
              source: 'nominatim',
              match: ambiguous ? 'disambiguated' : 'online',
            }
            await apply(
              list.map((x) => x.id),
              { place },
            )
          }
          if (await tick()) return null
        }
        for (const list of hoods.values()) {
          const t = list[0]
          const found = await lookupHood(
            gaz(),
            search,
            t.neighborhood ?? '',
            t.settlement ?? '',
            t.oblast,
            t.place,
          )
          const nbhd: Nbhd = found
            ? {
                name: t.neighborhood ?? '',
                lat: found.lat,
                lon: found.lon,
                source: 'nominatim',
                v: NBHD_VERSION,
              }
            : {
                name: t.neighborhood ?? '',
                lat: null,
                lon: null,
                source: 'none',
                v: NBHD_VERSION,
              }
          await apply(
            list.map((x) => x.id),
            { nbhd },
          )
          if (await tick()) return null
        }
      } catch (err) {
        if (r.cancelled) throw new Cancelled()
        r.warn('geocodeFailed', { message: messageOf(err) })
      }
      await r.stop()
      await ctx.runMutation(internal.imports.finish, {
        job: jobId,
        status: 'done',
      })
    } catch (err) {
      await r.stop()
      await finish(ctx, jobId, err)
    }
    return null
  },
})
