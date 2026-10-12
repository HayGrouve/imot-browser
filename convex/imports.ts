// Imports: the queue (one import runs at a time, for imot.bg's sake), their
// progress and log, cancelling, and the steps' writes. The steps that fetch
// pages run in convex/importer.ts.

import { v } from 'convex/values'
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from './_generated/server'
import type { MutationCtx } from './_generated/server'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import { fail } from './lib/errors'
import { isActive, latestJob } from './lib/jobs'
import { spend } from './lib/rateLimit'
import {
  bumpData,
  checkWorkspace,
  ensureWorkspace,
  findWorkspace,
} from './lib/workspace'
import {
  WORKSPACE_LISTINGS_MAX,
  findDetails,
  findListing,
  removeListing,
  saveCard,
  saveDetailPage,
} from './lib/store'
import {
  jobInputV,
  listingFieldsV,
  logParamsV,
  nbhdV,
  offlineV,
  optionsV,
  placeV,
} from './validators'
import type { LogParams } from './validators'
import { MANUAL_SOURCE } from '../shared/importer'
import { storedSlim } from '../shared/listing'

/** A running import that hasn't reported for this long has died; the next one starts. */
const STALLED_MS = 10 * 60_000
const LOG_MAX = 300
const MAX_INPUTS = 200

const EMPTY_PROGRESS = {
  searchPages: 0,
  searchPagesTotal: 0,
  found: 0,
  details: 0,
  detailsTotal: 0,
  detailsSkipped: 0,
  geocode: 0,
  geocodeTotal: 0,
}

// ---------------------------------------------------------------- what the browser reads

/** The workspace's latest import, with its last log lines and its place in the queue. */
export const current = query({
  args: { workspace: v.string() },
  handler: async (ctx, { workspace }) => {
    checkWorkspace(workspace)
    const job = await latestJob(ctx, workspace)
    if (!job) return null
    const log = await ctx.db
      .query('importLogs')
      .withIndex('by_job', (q) => q.eq('job', job._id))
      .order('desc')
      .take(14)
    let ahead = 0
    if (job.status === 'queued') {
      const running = await ctx.db
        .query('imports')
        .withIndex('by_status', (q) => q.eq('status', 'running'))
        .first()
      const queued = await ctx.db
        .query('imports')
        .withIndex('by_status', (q) => q.eq('status', 'queued'))
        .take(50)
      ahead =
        (running ? 1 : 0) +
        queued.filter((j) => j._creationTime < job._creationTime).length
    }
    return {
      id: job._id,
      status: job.status,
      phase: job.phase,
      progress: job.progress,
      result: job.result,
      warnings: job.warnings,
      error: job.error ?? null,
      inputs: job.inputs,
      searchUrl: job.searchUrl ?? null,
      ahead,
      log: log
        .reverse()
        .map(({ _id, t, code, params }) => ({ id: _id, t, code, params })),
    }
  },
})

// ---------------------------------------------------------------- starting and cancelling

async function assertCanStart(ctx: MutationCtx, workspace: string) {
  const ws = await ensureWorkspace(ctx, workspace)
  if (ws.deleting) fail('deleting')
  if (isActive(await latestJob(ctx, workspace))) fail('busy')
  return ws
}

/** Start the oldest queued import when none is running. */
async function claimNext(ctx: MutationCtx) {
  const running = await ctx.db
    .query('imports')
    .withIndex('by_status', (q) => q.eq('status', 'running'))
    .first()
  if (running) return
  const next = await ctx.db
    .query('imports')
    .withIndex('by_status', (q) => q.eq('status', 'queued'))
    .order('asc')
    .first()
  if (!next) return
  const now = Date.now()
  await ctx.db.patch('imports', next._id, {
    status: 'running',
    phase: 'search',
    now: new Date(now).toISOString(),
    startedAt: now,
    heartbeatAt: now,
  })
  await ctx.scheduler.runAfter(0, internal.importer.runSearch, {
    job: next._id,
  })
}

async function enqueue(
  ctx: MutationCtx,
  {
    workspace,
    inputs,
    options,
    searchUrl,
  }: {
    workspace: string
    inputs: Array<string>
    options: Doc<'imports'>['options']
    searchUrl?: string
  },
): Promise<Id<'imports'>> {
  await assertCanStart(ctx, workspace)
  const now = Date.now()
  const id = await ctx.db.insert('imports', {
    workspace,
    status: 'queued',
    phase: 'queued',
    now: new Date(now).toISOString(),
    heartbeatAt: now,
    options,
    inputs: inputs.map((input) => ({ input })),
    progress: EMPTY_PROGRESS,
    result: { added: 0, updated: 0, priceChanged: 0, total: 0, requests: 0 },
    warnings: 0,
    detailFailures: 0,
    cancelRequested: false,
    ...(searchUrl ? { searchUrl } : {}),
  })
  await ctx.scheduler.runAfter(0, internal.imports.dropOldLogs, {
    workspace,
    keep: id,
  })
  await claimNext(ctx)
  return id
}

/** Import pasted imot.bg links (searches and single listings). */
export const start = mutation({
  args: { workspace: v.string(), inputs: v.string(), options: optionsV },
  handler: async (ctx, { workspace, inputs, options }) => {
    checkWorkspace(workspace)
    // Every pasted token goes to the job, so non-imot.bg links are reported as skipped.
    const list = [
      ...new Set(
        inputs
          .split(/\s+/)
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    ].slice(0, MAX_INPUTS)
    if (!list.some((s) => /imot\.bg/i.test(s))) fail('noLinks')
    await assertCanStart(ctx, workspace)
    await spend(ctx, 'importPerWorkspace', workspace)
    await spend(ctx, 'importAll', 'all')
    return await enqueue(ctx, { workspace, inputs: list, options })
  },
})

/** Before asking imot.bg to build a search link: the workspace may start an import. */
export const reserve = internalMutation({
  args: { workspace: v.string() },
  handler: async (ctx, { workspace }) => {
    checkWorkspace(workspace)
    await assertCanStart(ctx, workspace)
    await spend(ctx, 'importPerWorkspace', workspace)
    await spend(ctx, 'importAll', 'all')
  },
})

/** Import the search link imot.bg built for the search dialog. */
export const enqueueSearch = internalMutation({
  args: { workspace: v.string(), url: v.string(), options: optionsV },
  handler: async (ctx, { workspace, url, options }) =>
    await enqueue(ctx, { workspace, inputs: [url], options, searchUrl: url }),
})

export const cancel = mutation({
  args: { workspace: v.string() },
  handler: async (ctx, { workspace }) => {
    checkWorkspace(workspace)
    const job = await latestJob(ctx, workspace)
    if (!job || !isActive(job)) return
    if (job.status === 'queued') {
      await ctx.db.patch('imports', job._id, {
        status: 'cancelled',
        phase: 'done',
        finishedAt: Date.now(),
      })
      await addLog(ctx, job._id, [
        { code: 'cancelled', params: { level: 'error' } },
      ])
      return
    }
    await ctx.db.patch('imports', job._id, { cancelRequested: true })
  },
})

// ---------------------------------------------------------------- progress and log

async function addLog(
  ctx: MutationCtx,
  job: Id<'imports'>,
  lines: Array<{ code: string; params: LogParams; t?: number }>,
) {
  if (!lines.length) return
  for (const { code, params, t } of lines)
    await ctx.db.insert('importLogs', { job, t: t ?? Date.now(), code, params })
  // Keep the newest LOG_MAX lines; the job counts them, so only the excess is read.
  const doc = await ctx.db.get('imports', job)
  const count = (doc?.logCount ?? 0) + lines.length
  if (count > LOG_MAX) {
    const old = await ctx.db
      .query('importLogs')
      .withIndex('by_job', (q) => q.eq('job', job))
      .order('asc')
      .take(count - LOG_MAX)
    for (const row of old) await ctx.db.delete('importLogs', row._id)
  }
  if (doc)
    await ctx.db.patch('imports', job, { logCount: Math.min(count, LOG_MAX) })
}

/** Only a workspace's latest import shows its log: earlier imports' lines go. */
export const dropOldLogs = internalMutation({
  args: { workspace: v.string(), keep: v.id('imports') },
  returns: v.null(),
  handler: async (ctx, { workspace, keep }) => {
    const jobs = await ctx.db
      .query('imports')
      .withIndex('by_workspace', (q) => q.eq('workspace', workspace))
      .collect()
    let more = false
    for (const job of jobs) {
      if (job._id === keep || !job.logCount) continue
      const rows = await ctx.db
        .query('importLogs')
        .withIndex('by_job', (q) => q.eq('job', job._id))
        .take(400)
      for (const row of rows) await ctx.db.delete('importLogs', row._id)
      if (rows.length === 400) more = true
      else await ctx.db.patch('imports', job._id, { logCount: 0 })
    }
    if (more)
      await ctx.scheduler.runAfter(0, internal.imports.dropOldLogs, {
        workspace,
        keep,
      })
    return null
  },
})

const logLineV = v.object({
  t: v.number(),
  code: v.string(),
  params: logParamsV,
})

const progressPatchV = v.object({
  searchPages: v.optional(v.number()),
  searchPagesTotal: v.optional(v.number()),
  found: v.optional(v.number()),
  details: v.optional(v.number()),
  detailsTotal: v.optional(v.number()),
  detailsSkipped: v.optional(v.number()),
  geocode: v.optional(v.number()),
  geocodeTotal: v.optional(v.number()),
})

export const get = internalQuery({
  args: { job: v.id('imports') },
  handler: async (ctx, { job }) => await ctx.db.get('imports', job),
})

/**
 * A step reports in: progress, new log lines, requests made. Also its heartbeat. Answers
 * whether the import should stop (cancelled, or no longer running).
 */
export const report = internalMutation({
  args: {
    job: v.id('imports'),
    progress: v.optional(progressPatchV),
    log: v.optional(v.array(logLineV)),
    requests: v.optional(v.number()),
    inputs: v.optional(v.array(jobInputV)),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get('imports', args.job)
    if (!job || job.status !== 'running') return { stop: true }
    const log = args.log ?? []
    const warnings = log.filter(
      (l) => l.params.level === 'warn' || l.params.level === 'error',
    ).length
    await ctx.db.patch('imports', job._id, {
      heartbeatAt: Date.now(),
      ...(args.progress
        ? { progress: { ...job.progress, ...args.progress } }
        : {}),
      ...(args.inputs ? { inputs: args.inputs } : {}),
      warnings: job.warnings + warnings,
      result: {
        ...job.result,
        requests: job.result.requests + (args.requests ?? 0),
      },
    })
    await addLog(ctx, job._id, log)
    return { stop: job.cancelRequested }
  },
})

// ---------------------------------------------------------------- step 1: search pages

const cardV = v.object({
  fields: listingFieldsV,
  sources: v.array(v.string()),
  manual: v.boolean(),
  offline: offlineV,
})

/** Save a batch of the search's cards; queue the listing pages that need reading. */
export const saveCards = internalMutation({
  args: { job: v.id('imports'), cards: v.array(cardV) },
  handler: async (ctx, { job: jobId, cards }) => {
    const job = await ctx.db.get('imports', jobId)
    if (!job || job.status !== 'running') return
    const ws = await ensureWorkspace(ctx, job.workspace)
    let count = ws.listingCount
    let added = 0
    let updated = 0
    let priceChanged = 0
    let queued = 0
    let reused = 0
    let skipped = 0
    for (const card of cards) {
      const out = await saveCard(ctx, job, card, count < WORKSPACE_LISTINGS_MAX)
      if (out.kind === 'skipped') {
        skipped++
        continue
      }
      if (out.added) {
        added++
        count++
      } else updated++
      if (out.priceChanged) priceChanged++
      if (out.reused) reused++
      if (out.needsDetails) {
        queued++
        await ctx.db.insert('importItems', {
          job: jobId,
          imotId: card.fields.id,
          url: card.fields.url ?? '',
          manual: card.manual,
          claimed: false,
        })
      }
    }
    await ctx.db.patch('workspaces', ws._id, { listingCount: count })
    await ctx.db.patch('imports', jobId, {
      result: {
        ...job.result,
        added: job.result.added + added,
        updated: job.result.updated + updated,
        priceChanged: job.result.priceChanged + priceChanged,
      },
      progress: {
        ...job.progress,
        detailsTotal: job.progress.detailsTotal + queued,
        detailsSkipped: job.progress.detailsSkipped + reused,
      },
    })
    if (skipped)
      await addLog(ctx, jobId, [
        {
          code: 'workspaceFull',
          params: { max: WORKSPACE_LISTINGS_MAX, level: 'warn' },
        },
      ])
  },
})

const sourceV = v.object({
  partial: v.boolean(),
  key: v.string(),
  url: v.string(),
  input: v.string(),
  paramsText: v.string(),
  total: v.union(v.null(), v.number()),
  capped: v.boolean(),
  found: v.number(),
  splits: v.number(),
})

async function upsertSource(
  ctx: MutationCtx,
  job: Doc<'imports'>,
  {
    partial,
    ...src
  }: Omit<
    Doc<'sources'>,
    '_id' | '_creationTime' | 'workspace' | 'lastImportAt' | 'prevImportAt'
  > & { partial: boolean },
) {
  const prev = await ctx.db
    .query('sources')
    .withIndex('by_workspace_key', (q) =>
      q.eq('workspace', job.workspace).eq('key', src.key),
    )
    .unique()
  if (!prev) {
    await ctx.db.insert('sources', {
      workspace: job.workspace,
      ...src,
      lastImportAt: job.now,
    })
    return
  }
  // A search that stopped early keeps what its last complete import recorded:
  // otherwise its unread listings would look removed ("no longer listed").
  if (partial) return
  // Remember the previous import so the UI can flag listings that are new since then.
  await ctx.db.patch('sources', prev._id, {
    ...src,
    lastImportAt: job.now,
    ...(prev.lastImportAt !== job.now
      ? { prevImportAt: prev.lastImportAt }
      : {}),
  })
}

/** The search pages are read and their cards saved: record the searches, then move on. */
export const afterSearch = internalMutation({
  args: {
    job: v.id('imports'),
    sources: v.array(sourceV),
    manual: v.boolean(),
    outcome: v.union(
      v.literal('ok'),
      v.literal('cancelled'),
      v.literal('error'),
    ),
    error: v.optional(v.object({ code: v.string(), message: v.string() })),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get('imports', args.job)
    if (!job || job.status !== 'running') return
    for (const src of args.sources) await upsertSource(ctx, job, src)
    if (args.manual)
      await upsertSource(ctx, job, {
        partial: false,
        key: MANUAL_SOURCE,
        url: null,
        input: 'manual',
        paramsText: '',
        total: null,
        capped: false,
        found: 0,
        splits: 0,
      })
    const ws = await ensureWorkspace(ctx, job.workspace)
    await bumpData(ctx, ws)
    if (args.outcome !== 'ok' || job.cancelRequested) {
      await finishJob(
        ctx,
        job,
        args.outcome === 'error' ? 'error' : 'cancelled',
        args.error,
      )
      return
    }
    if (job.progress.detailsSkipped && job.options.details)
      await addLog(ctx, job._id, [
        {
          code: 'detailsSkipped',
          params: { count: job.progress.detailsSkipped },
        },
      ])
    if (job.progress.detailsTotal > 0) {
      await ctx.db.patch('imports', job._id, { phase: 'details' })
      await ctx.scheduler.runAfter(0, internal.importer.runDetails, {
        job: job._id,
      })
    } else {
      await ctx.db.patch('imports', job._id, { phase: 'geocode' })
      await ctx.scheduler.runAfter(0, internal.importer.runGeocode, {
        job: job._id,
      })
    }
  },
})

// ---------------------------------------------------------------- step 2: listing pages

/** Hand the importer the next listing pages to read, with what their cards say. */
export const claimItems = internalMutation({
  args: { job: v.id('imports'), count: v.number() },
  handler: async (ctx, { job: jobId, count }) => {
    const job = await ctx.db.get('imports', jobId)
    if (!job || job.status !== 'running') return []
    const items = await ctx.db
      .query('importItems')
      .withIndex('by_job_claimed', (q) =>
        q.eq('job', jobId).eq('claimed', false),
      )
      .take(count)
    const out = []
    for (const item of items) {
      await ctx.db.patch('importItems', item._id, { claimed: true })
      const row = await findListing(ctx, job.workspace, item.imotId)
      if (!row) {
        await ctx.db.delete('importItems', item._id)
        continue
      }
      const details = item.manual
        ? null
        : await findDetails(ctx, job.workspace, item.imotId)
      out.push({
        item: item._id,
        url: item.url,
        manual: item.manual,
        // A pasted listing link has no card: the page says everything.
        card: item.manual
          ? { id: item.imotId, url: item.url }
          : {
              id: item.imotId,
              ...storedSlim(row),
              ...(details?.locationRaw
                ? { locationRaw: details.locationRaw }
                : {}),
            },
      })
    }
    return out
  },
})

const pageResultV = v.object({
  item: v.id('importItems'),
  url: v.string(),
  outcome: v.union(v.literal('ok'), v.literal('gone'), v.literal('failed')),
  fields: v.optional(listingFieldsV),
  offline: v.optional(offlineV),
  message: v.optional(v.string()),
})

export const saveDetails = internalMutation({
  args: { job: v.id('imports'), results: v.array(pageResultV) },
  handler: async (ctx, { job: jobId, results }) => {
    const job = await ctx.db.get('imports', jobId)
    if (!job || job.status !== 'running') return
    const ws = await ensureWorkspace(ctx, job.workspace)
    let removed = 0
    let failures = job.detailFailures
    const log: Array<{ code: string; params: LogParams }> = []
    for (const r of results) {
      const item = await ctx.db.get('importItems', r.item)
      if (!item) continue
      await ctx.db.delete('importItems', item._id)
      if (r.outcome === 'ok' && r.fields) {
        await saveDetailPage(ctx, job, r.fields, r.offline ?? null)
        continue
      }
      if (r.outcome === 'failed') {
        failures++
        if (failures <= 5)
          log.push({
            code: 'detailFailed',
            params: { url: r.url, message: r.message ?? '', level: 'warn' },
          })
      } else if (item.manual) {
        log.push({ code: 'listingGone', params: { url: r.url, level: 'warn' } })
      }
      // A pasted link whose page can't be read leaves nothing worth keeping.
      const row = await findListing(ctx, job.workspace, item.imotId)
      if (item.manual && row && !row.title) {
        await removeListing(ctx, row)
        removed++
      }
    }
    if (removed)
      await ctx.db.patch('workspaces', ws._id, {
        listingCount: Math.max(0, ws.listingCount - removed),
      })
    await ctx.db.patch('imports', jobId, {
      heartbeatAt: Date.now(),
      detailFailures: failures,
      warnings: job.warnings + log.length,
      progress: {
        ...job.progress,
        details: job.progress.details + results.length,
      },
    })
    await addLog(ctx, jobId, log)
  },
})

/** Every listing page is read: on to locating places online. */
export const afterDetails = internalMutation({
  args: { job: v.id('imports') },
  handler: async (ctx, { job: jobId }) => {
    const job = await ctx.db.get('imports', jobId)
    if (!job || job.status !== 'running') return
    if (job.detailFailures > 5)
      await addLog(ctx, jobId, [
        {
          code: 'detailFailedMore',
          params: { count: job.detailFailures - 5, level: 'warn' },
        },
      ])
    await bumpData(ctx, await ensureWorkspace(ctx, job.workspace))
    await ctx.db.patch('imports', jobId, {
      phase: 'geocode',
      heartbeatAt: Date.now(),
      warnings: job.warnings + (job.detailFailures > 5 ? 1 : 0),
    })
    await ctx.scheduler.runAfter(0, internal.importer.runGeocode, {
      job: jobId,
    })
  },
})

// ---------------------------------------------------------------- step 3: places online

/** A page of this import's listings, as the online geocoder needs them. */
export const geocodeTargets = internalQuery({
  args: {
    job: v.id('imports'),
    cursor: v.union(v.null(), v.string()),
  },
  handler: async (ctx, { job, cursor }) => {
    const page = await ctx.db
      .query('listings')
      .withIndex('by_lastJob', (q) => q.eq('lastJob', job))
      .paginate({ cursor, numItems: 400 })
    return {
      done: page.isDone,
      cursor: page.continueCursor,
      rows: page.page.map((l) => ({
        id: l._id,
        settlement: l.settlement ?? null,
        settlementKind: l.settlementKind ?? null,
        oblast: l.oblast ?? null,
        neighborhood: l.neighborhood ?? null,
        place: l.place,
        hasNbhd: !!l.nbhd,
      })),
    }
  },
})

export const applyGeocode = internalMutation({
  args: {
    ids: v.array(v.id('listings')),
    place: v.optional(placeV),
    nbhd: v.optional(nbhdV),
  },
  handler: async (ctx, { ids, place, nbhd }) => {
    for (const id of ids) {
      const row = await ctx.db.get('listings', id)
      if (!row) continue
      await ctx.db.patch('listings', id, {
        ...(place ? { place } : {}),
        ...(nbhd ? { nbhd } : {}),
      })
    }
  },
})

// ---------------------------------------------------------------- finishing

async function finishJob(
  ctx: MutationCtx,
  job: Doc<'imports'>,
  status: 'done' | 'cancelled' | 'error',
  error?: { code: string; message: string },
) {
  const ws = await findWorkspace(ctx, job.workspace)
  await ctx.db.patch('imports', job._id, {
    status,
    phase: 'done',
    finishedAt: Date.now(),
    result: { ...job.result, total: ws?.listingCount ?? 0 },
    ...(error ? { error } : {}),
  })
  if (status !== 'done')
    await addLog(ctx, job._id, [
      {
        code: status === 'cancelled' ? 'cancelled' : 'failed',
        params: { message: error?.message ?? '', level: 'error' },
      },
    ])
  if (ws) await bumpData(ctx, ws)
  await ctx.scheduler.runAfter(0, internal.imports.dropItems, { job: job._id })
  await claimNext(ctx)
}

export const finish = internalMutation({
  args: {
    job: v.id('imports'),
    status: v.union(
      v.literal('done'),
      v.literal('cancelled'),
      v.literal('error'),
    ),
    error: v.optional(v.object({ code: v.string(), message: v.string() })),
  },
  handler: async (ctx, { job: jobId, status, error }) => {
    const job = await ctx.db.get('imports', jobId)
    if (!job || job.status !== 'running') return
    await finishJob(ctx, job, job.cancelRequested ? 'cancelled' : status, error)
  },
})

/** The work queue of a finished import, in batches. */
export const dropItems = internalMutation({
  args: { job: v.id('imports') },
  handler: async (ctx, { job }) => {
    const items = await ctx.db
      .query('importItems')
      .withIndex('by_job_claimed', (q) => q.eq('job', job))
      .take(500)
    for (const item of items) await ctx.db.delete('importItems', item._id)
    if (items.length === 500)
      await ctx.scheduler.runAfter(0, internal.imports.dropItems, { job })
  },
})

/** Cron: an import whose step died (it stopped reporting) ends, so the queue moves on. */
export const watchdog = internalMutation({
  args: {},
  handler: async (ctx) => {
    const running = await ctx.db
      .query('imports')
      .withIndex('by_status', (q) => q.eq('status', 'running'))
      .collect()
    for (const job of running) {
      if (Date.now() - job.heartbeatAt < STALLED_MS) continue
      await finishJob(ctx, job, 'error', {
        code: 'stalled',
        message: 'The import stopped responding',
      })
    }
    await claimNext(ctx)
  },
})
