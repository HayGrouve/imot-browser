// @vitest-environment edge-runtime
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { api, internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { setupConvex } from './test.setup'
import type { TestConvex } from './test.setup'

const WS = 'workspace-aaaaaaaaaaaa1'
const WS2 = 'workspace-bbbbbbbbbbbb2'
const OPTIONS = { details: true, autoSplit: true, geocodeOnline: true }
const SEARCH = 'https://www.imot.bg/obiavi/prodazhbi/grad-gabrovo/kashta'

// Scheduled steps fetch imot.bg: with fake timers they never run unless a test runs them.
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-12T10:00:00Z'))
})
afterEach(() => {
  vi.useRealTimers()
})

function card(
  id: string,
  extra: Record<string, unknown> = {},
  source = 'src1',
) {
  return {
    fields: {
      id,
      url: `https://www.imot.bg/obiava-${id}-prodava-kashta`,
      title: 'Продава КЪЩА',
      deal: 'sale',
      type: 'house',
      typeBg: 'КЪЩА',
      settlement: 'Габрово',
      settlementKind: 'city',
      oblast: 'Габрово',
      price: 100000,
      currency: 'EUR',
      photoCount: 4,
      thumb: 'https://imotstatic1.focus.bg/imot/photosimotbg/1/1/x_1.jpg',
      photos: [
        'https://imotstatic1.focus.bg/imot/photosimotbg/1/1/big1/x_1.jpg',
      ],
      description: 'Къща с двор',
      features: ['Тухла'],
      agency: { name: 'АГЕНЦИЯ', url: null, logo: null },
      ...extra,
    },
    sources: [source],
    manual: false,
    offline: null,
  }
}

async function startJob(t: TestConvex, workspace = WS, inputs = SEARCH) {
  return await t.mutation(api.imports.start, {
    workspace,
    inputs,
    options: OPTIONS,
  })
}

const job = (t: TestConvex, id: Id<'imports'>) =>
  t.run(async (ctx) => (await ctx.db.get('imports', id))!)

const listings = (t: TestConvex, workspace = WS) =>
  t.run((ctx) =>
    ctx.db
      .query('listings')
      .withIndex('by_workspace_imot', (q) => q.eq('workspace', workspace))
      .collect(),
  )

const errorCodeOf = async (p: Promise<unknown>) => {
  try {
    await p
  } catch (err) {
    return (err as { data?: { code?: string } }).data?.code
  }
  return null
}

describe('the queue', () => {
  test('one import runs at a time; the next waits its turn', async () => {
    const t = setupConvex()
    const first = await startJob(t)
    expect((await job(t, first)).status).toBe('running')
    const second = await startJob(t, WS2)
    expect((await job(t, second)).status).toBe('queued')
    expect(
      (await t.query(api.imports.current, { workspace: WS2 }))?.ahead,
    ).toBe(1)
    // A browser has one import at a time.
    expect(await errorCodeOf(startJob(t))).toBe('busy')

    await t.mutation(internal.imports.finish, { job: first, status: 'done' })
    expect((await job(t, first)).status).toBe('done')
    expect((await job(t, second)).status).toBe('running')
  })

  test('a queued import is cancelled at once; a running one when its step reports', async () => {
    const t = setupConvex()
    const first = await startJob(t)
    const second = await startJob(t, WS2)
    await t.mutation(api.imports.cancel, { workspace: WS2 })
    expect((await job(t, second)).status).toBe('cancelled')

    await t.mutation(api.imports.cancel, { workspace: WS })
    expect((await job(t, first)).cancelRequested).toBe(true)
    const { stop } = await t.mutation(internal.imports.report, { job: first })
    expect(stop).toBe(true)
    await t.mutation(internal.imports.finish, { job: first, status: 'done' })
    expect((await job(t, first)).status).toBe('cancelled')
  })

  test('pasted text needs an imot.bg link, and the workspace key is checked', async () => {
    const t = setupConvex()
    expect(await errorCodeOf(startJob(t, WS, 'hello world'))).toBe('noLinks')
    expect(await errorCodeOf(startJob(t, 'x', SEARCH))).toBe('badWorkspace')
    expect(
      await errorCodeOf(
        t.query(api.listings.details, { workspace: 'a b', imotId: '1' }),
      ),
    ).toBe('badWorkspace')
  })

  test('a step that stops reporting ends, and the queue moves on', async () => {
    const t = setupConvex()
    const first = await startJob(t)
    const second = await startJob(t, WS2)
    vi.setSystemTime(new Date('2026-10-12T10:30:00Z'))
    await t.mutation(internal.imports.watchdog, {})
    const stalled = await job(t, first)
    expect(stalled.status).toBe('error')
    expect(stalled.error?.code).toBe('stalled')
    expect((await job(t, second)).status).toBe('running')
  })
})

describe('saving listings', () => {
  test('cards are saved, and the listing pages that need reading are queued', async () => {
    const t = setupConvex()
    const id = await startJob(t)
    await t.mutation(internal.imports.saveCards, {
      job: id,
      cards: [card('1a1'), card('1a2')],
    })
    const rows = await listings(t)
    expect(rows.map((r) => r.imotId).sort()).toEqual(['1a1', '1a2'])
    expect(rows[0].agencyName).toBe('АГЕНЦИЯ')
    expect(rows[0].searchText).toContain('gabrovo')
    expect(rows[0].searchText).toContain('tuhla') // features
    expect(rows[0].searchText).toContain('brick') // ...and their English terms
    expect(rows[0].photosStored).toBe(1)
    const j = await job(t, id)
    expect(j.result.added).toBe(2)
    expect(j.progress.detailsTotal).toBe(2)
    const details = await t.query(api.listings.details, {
      workspace: WS,
      imotId: '1a1',
    })
    expect(details?.description).toBe('Къща с двор')
    const ws = await t.query(api.workspaces.get, { workspace: WS })
    expect(ws?.listingCount).toBe(2)
  })

  test('a re-import records the new price and keeps the page read before', async () => {
    const t = setupConvex()
    const first = await startJob(t)
    await t.mutation(internal.imports.saveCards, {
      job: first,
      cards: [card('1a1')],
    })
    const [item] = await t.mutation(internal.imports.claimItems, {
      job: first,
      count: 5,
    })
    await t.mutation(internal.imports.saveDetails, {
      job: first,
      results: [
        {
          item: item.item,
          url: item.url,
          outcome: 'ok',
          fields: {
            ...card('1a1').fields,
            description: 'Пълното описание на къщата',
            detailsFetchedAt: '2026-10-12T10:00:00.000Z',
            descriptionFull: true,
            params: [{ label: 'Площ', value: '120 m2' }],
          },
          offline: null,
        },
      ],
    })
    await t.mutation(internal.imports.afterSearch, {
      job: first,
      sources: [],
      manual: false,
      outcome: 'ok',
    })
    await t.mutation(internal.imports.finish, { job: first, status: 'done' })

    vi.setSystemTime(new Date('2026-10-13T10:00:00Z'))
    const second = await startJob(t)
    await t.mutation(internal.imports.saveCards, {
      job: second,
      cards: [card('1a1', { price: 90000, description: 'Кратко…' })],
    })
    const [row] = await listings(t)
    expect(row.price).toBe(90000)
    expect(row.priceHistory.map((p) => p.price)).toEqual([100000, 90000])
    expect(row.firstSeen).toBe('2026-10-12T10:00:00.000Z')
    expect(row.lastSeen).toBe('2026-10-13T10:00:00.000Z')
    const details = await t.query(api.listings.details, {
      workspace: WS,
      imotId: '1a1',
    })
    expect(details?.description).toBe('Пълното описание на къщата')
    expect(details?.params).toEqual([{ label: 'Площ', value: '120 m2' }])
    const j = await job(t, second)
    expect(j.result).toMatchObject({ added: 0, updated: 1, priceChanged: 1 })
    // The price changed, so its page is read again.
    expect(j.progress.detailsTotal).toBe(1)
  })

  test('a pasted listing link whose page is gone leaves nothing behind', async () => {
    const t = setupConvex()
    const url = 'https://www.imot.bg/obiava-1b2-x'
    const id = await startJob(t, WS, url)
    await t.mutation(internal.imports.saveCards, {
      job: id,
      cards: [
        {
          fields: { id: '1b2', url },
          sources: ['manual'],
          manual: true,
          offline: null,
        },
      ],
    })
    expect(await listings(t)).toHaveLength(1)
    const [item] = await t.mutation(internal.imports.claimItems, {
      job: id,
      count: 5,
    })
    expect(item.card).toEqual({ id: '1b2', url })
    await t.mutation(internal.imports.saveDetails, {
      job: id,
      results: [{ item: item.item, url, outcome: 'gone' }],
    })
    expect(await listings(t)).toHaveLength(0)
    expect(
      (await t.query(api.workspaces.get, { workspace: WS }))?.listingCount,
    ).toBe(0)
    const current = await t.query(api.imports.current, { workspace: WS })
    expect(current?.log.map((l) => l.code)).toContain('listingGone')
  })

  test('after the search: to listing pages when some need reading, else to places', async () => {
    const t = setupConvex()
    const id = await startJob(t)
    await t.mutation(internal.imports.saveCards, {
      job: id,
      cards: [card('1a1')],
    })
    await t.mutation(internal.imports.afterSearch, {
      job: id,
      sources: [
        {
          partial: false,
          key: 'src1',
          url: SEARCH,
          input: SEARCH,
          paramsText: 'КЪЩА',
          total: 1,
          capped: false,
          found: 1,
          splits: 0,
        },
      ],
      manual: false,
      outcome: 'ok',
    })
    expect((await job(t, id)).phase).toBe('details')
    const sources = await t.query(api.sources.list, { workspace: WS })
    expect(sources).toMatchObject([
      { key: 'src1', url: SEARCH, lastImportAt: '2026-10-12T10:00:00.000Z' },
    ])

    const other = await startJob(t, WS2)
    await t.mutation(internal.imports.finish, { job: id, status: 'done' })
    await t.mutation(internal.imports.afterSearch, {
      job: other,
      sources: [],
      manual: false,
      outcome: 'ok',
    })
    expect((await job(t, other)).phase).toBe('geocode')
  })

  test('a listing found by two searches of one import keeps both', async () => {
    const t = setupConvex()
    const id = await startJob(t)
    await t.mutation(internal.imports.saveCards, {
      job: id,
      cards: [{ ...card('1a1'), sources: ['srcA', 'srcB'] }],
    })
    const [row] = await listings(t)
    expect(row.sources).toEqual(['srcA', 'srcB'])
  })

  test('a search that stops early keeps what its last complete import recorded', async () => {
    const t = setupConvex()
    const src = {
      partial: false,
      key: 'src1',
      url: SEARCH,
      input: SEARCH,
      paramsText: 'КЪЩА',
      total: 5,
      capped: false,
      found: 5,
      splits: 0,
    }
    const first = await startJob(t)
    await t.mutation(internal.imports.afterSearch, {
      job: first,
      sources: [src],
      manual: false,
      outcome: 'ok',
    })
    await t.mutation(internal.imports.finish, { job: first, status: 'done' })
    vi.setSystemTime(new Date('2026-10-13T10:00:00Z'))
    const second = await startJob(t)
    await t.mutation(internal.imports.afterSearch, {
      job: second,
      sources: [{ ...src, partial: true, found: 0, paramsText: '' }],
      manual: false,
      outcome: 'ok',
    })
    const [row] = await t.query(api.sources.list, { workspace: WS })
    expect(row).toMatchObject({
      found: 5,
      paramsText: 'КЪЩА',
      lastImportAt: '2026-10-12T10:00:00.000Z',
    })
  })

  test('a blocked search keeps what it collected and reports the reason', async () => {
    const t = setupConvex()
    const id = await startJob(t)
    await t.mutation(internal.imports.saveCards, {
      job: id,
      cards: [card('1a1')],
    })
    await t.mutation(internal.imports.afterSearch, {
      job: id,
      sources: [],
      manual: false,
      outcome: 'error',
      error: {
        code: 'blocked',
        message: 'imot.bg refused the request (HTTP 403)',
      },
    })
    const j = await job(t, id)
    expect(j.status).toBe('error')
    expect(j.error?.code).toBe('blocked')
    expect(await listings(t)).toHaveLength(1)
  })
})

describe('removing data', () => {
  async function seed(t: TestConvex) {
    await t.run(async (ctx) => {
      await ctx.db.insert('workspaces', {
        key: WS,
        listingCount: 2,
        dataVersion: 0,
      })
      for (const [imotId, sources] of [
        ['1a1', ['src1']],
        ['1a2', ['src1', 'src2']],
      ] as const) {
        await ctx.db.insert('listings', {
          workspace: WS,
          imotId,
          place: null,
          nbhd: null,
          firstSeen: '2026-10-12T10:00:00.000Z',
          lastSeen: '2026-10-12T10:00:00.000Z',
          sources: [...sources],
          priceHistory: [],
          photosStored: 0,
          searchText: imotId,
        })
        await ctx.db.insert('listingDetails', {
          workspace: WS,
          imotId,
          description: 'x',
        })
      }
      for (const key of ['src1', 'src2'])
        await ctx.db.insert('sources', {
          workspace: WS,
          key,
          url: `${SEARCH}?k=${key}`,
          input: SEARCH,
          paramsText: '',
          total: 1,
          capped: false,
          found: 1,
          splits: 0,
          lastImportAt: '2026-10-12T10:00:00.000Z',
        })
    })
  }

  test('removing a search removes the listings only it brought', async () => {
    const t = setupConvex()
    await seed(t)
    await t.mutation(api.sources.remove, { workspace: WS, key: 'src1' })
    // One deletion at a time: a second one waits for the first to finish.
    expect(
      await errorCodeOf(
        t.mutation(api.sources.remove, { workspace: WS, key: 'src2' }),
      ),
    ).toBe('deleting')
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    const rows = await listings(t)
    expect(rows.map((r) => [r.imotId, r.sources])).toEqual([['1a2', ['src2']]])
    const ws = await t.query(api.workspaces.get, { workspace: WS })
    expect(ws).toEqual({ listingCount: 1, dataVersion: 1, deleting: false })
    expect(
      await t.query(api.listings.details, { workspace: WS, imotId: '1a1' }),
    ).toBeNull()
  })

  test('"Delete all data" empties the workspace, and waits for a running import', async () => {
    const t = setupConvex()
    await seed(t)
    await t.mutation(api.listings.removeAll, { workspace: WS })
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    expect(await listings(t)).toHaveLength(0)
    expect(await t.query(api.sources.list, { workspace: WS })).toEqual([])
    expect(
      (await t.query(api.workspaces.get, { workspace: WS }))?.listingCount,
    ).toBe(0)

    await startJob(t)
    expect(
      await errorCodeOf(t.mutation(api.listings.removeAll, { workspace: WS })),
    ).toBe('busy')
  })
})
