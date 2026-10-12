import { describe, expect, test } from 'vitest'
import { DEFAULT_FILTERS, prepare } from './listings'
import type { AreaSearch, Listing, RawListing, Source } from './listings'
import { decodeView, encodeView } from './share'
import {
  clearFilters,
  initialAreaSearches,
  initialMarks,
  initialView,
  newSearch,
  screenOf,
  sharedViewOf,
  showPicked,
  shownJob,
  visibleListings,
} from './view'
import type { Marks, View } from './view'

const A = 'https://www.imot.bg/obiavi/prodazhbi/grad-sofiya?raion=a'
const B = 'https://www.imot.bg/obiavi/prodazhbi/grad-sofiya?raion=b'
const C = 'https://www.imot.bg/obiavi/naemi/grad-plovdiv'

function source(key: string, url: string): Source {
  return {
    key,
    url,
    input: url,
    paramsText: '',
    total: 1,
    capped: false,
    found: 1,
    splits: 0,
    lastImportAt: '2026-10-13T10:00:00.000Z',
  }
}

const SOURCES = [source('sa', A), source('sb', B), source('sc', C)]
const BY_KEY = new Map(SOURCES.map((s) => [s.key, s]))

function listing(
  id: string,
  sources: Array<string>,
  extra: Partial<RawListing> = {},
): Listing {
  const raw: RawListing = {
    imotId: id,
    deal: 'sale',
    type: 'house',
    typeBg: 'КЪЩА',
    price: 100000,
    currency: 'EUR',
    area: 100,
    place: null,
    nbhd: null,
    firstSeen: '2026-10-13T10:00:00.000Z',
    lastSeen: '2026-10-13T10:00:00.000Z',
    sources,
    priceHistory: [],
    searchText: id,
    ...extra,
  }
  return prepare(raw, BY_KEY)
}

const ALL = [
  listing('a1', ['sa'], { price: 300 }),
  listing('a2', ['sa'], { price: 100 }),
  listing('b1', ['sb'], { price: 200 }),
  listing('c1', ['sc'], { deal: 'rent', price: 50 }),
]

const VIEW: View = {
  shown: null,
  filters: DEFAULT_FILTERS,
  sort: { key: 'price', dir: 1 },
}
const NO_MARKS: Marks = { stars: new Set(), hidden: new Set() }
const TRIANGLE: AreaSearch['area'] = [
  [42.7, 23.3],
  [42.6, 23.4],
  [42.6, 23.2],
]

const ids = (list: Array<Listing>) => list.map((l) => l.id)

describe('the view a page starts with', () => {
  const saved = {
    shown: [A],
    sort: { key: 'ppm', dir: -1 },
    filters: { priceMax: 500, deal: 'sale', starred: 'yes', drawnArea: [1] },
  }

  test('this browser’s saved view, with anything that isn’t one dropped', () => {
    expect(initialView(saved, { switched: false, view: null })).toEqual({
      shown: [A],
      sort: { key: 'ppm', dir: -1 },
      filters: { ...DEFAULT_FILTERS, priceMax: 500, deal: 'sale' },
    })
    expect(initialView('junk', { switched: false, view: null })).toEqual(VIEW)
  })

  test('another workspace: every search, no filters, the sort kept', () => {
    expect(initialView(saved, { switched: true, view: null })).toEqual({
      shown: null,
      filters: DEFAULT_FILTERS,
      sort: { key: 'ppm', dir: -1 },
    })
  })

  test('a shared view wins over everything saved', () => {
    const view = decodeView(
      encodeView({
        shown: [B],
        filters: { ...DEFAULT_FILTERS, q: 'тераса' },
        sort: { key: 'area', dir: -1 },
        hidden: ['h1'],
        stars: ['s1'],
        area: { urls: [B, C], area: TRIANGLE },
      }),
    )
    for (const switched of [true, false]) {
      const opened = { switched, view }
      expect(initialView(saved, opened)).toEqual({
        shown: [B],
        filters: { ...DEFAULT_FILTERS, q: 'тераса' },
        sort: { key: 'area', dir: -1 },
      })
      expect(initialAreaSearches([], opened)).toEqual([
        { urls: [B, C], area: TRIANGLE },
      ])
    }
    expect([...initialMarks(['x', 7], view?.hidden)]).toEqual(['x', 'h1'])
  })
})

describe('what the list and the map show', () => {
  test('shown search, then hidden, then filters, then sort; counts from each', () => {
    const marks: Marks = {
      stars: new Set(['a1', 'c1']),
      hidden: new Set(['a2', 'c1']),
    }
    const v = visibleListings(
      ALL,
      SOURCES,
      { ...VIEW, shown: [A, B] },
      marks,
      'en',
    )
    expect(ids(v.scoped)).toEqual(['a1', 'a2', 'b1'])
    expect(ids(v.filtered)).toEqual(['b1', 'a1'])
    expect(v.starCount).toBe(1) // c1 is in another search
    expect(v.hiddenCount).toBe(1) // a2; c1 is in another search
    expect(v.earlier).toBe(2) // a1, b1: every search, not hidden
    expect(v.multiDeal).toBe(false)

    const onlyHidden = visibleListings(
      ALL,
      SOURCES,
      { ...VIEW, filters: { ...DEFAULT_FILTERS, hidden: true } },
      marks,
      'en',
    )
    expect(ids(onlyHidden.filtered)).toEqual(['c1', 'a2'])
    expect(onlyHidden.multiDeal).toBe(true)

    const starred = visibleListings(
      ALL,
      SOURCES,
      { ...VIEW, filters: { ...DEFAULT_FILTERS, starred: true } },
      marks,
      'en',
    )
    expect(ids(starred.filtered)).toEqual(['a1'])
  })

  test('what the list says with no rows', () => {
    const show = (view: View, importing = false) =>
      screenOf(
        visibleListings(ALL, SOURCES, view, NO_MARKS, 'en'),
        view.shown,
        {
          error: false,
          importing,
        },
      )
    expect(screenOf(null, null, { error: false, importing: false })).toBeNull()
    expect(screenOf(null, null, { error: true, importing: false })).toBe(
      'error',
    )
    expect(show(VIEW)).toBeNull()
    expect(show(newSearch(VIEW))).toBe('start')
    expect(show(newSearch(VIEW), true)).toBe('start') // nothing shown is searching
    const pending = { ...VIEW, shown: ['https://www.imot.bg/new'] }
    expect(show(pending, true)).toBe('searching')
    expect(show(pending)).toBe('nothing')
    expect(show({ ...VIEW, filters: { ...DEFAULT_FILTERS, q: 'zzz' } })).toBe(
      'filtered',
    )
  })

  test('the shown search’s import is the one reading one of its links', () => {
    const job = { inputs: [{ input: A }] }
    expect(shownJob([A, B], job)).toBe(job)
    expect(shownJob([C], job)).toBeNull()
    expect(shownJob(null, job)).toBeNull()
    expect(shownJob([], job)).toBeNull()
  })
})

describe('changing the view', () => {
  const area: AreaSearch = { urls: [A, B], area: TRIANGLE }

  test('an area search picked under "Your searches" shows all its links, in its area', () => {
    const v = showPicked(
      { ...VIEW, filters: { ...DEFAULT_FILTERS, priceMax: 9 } },
      B,
      [area],
    )
    expect(v.shown).toEqual([A, B])
    expect(v.filters).toEqual({
      ...DEFAULT_FILTERS,
      priceMax: 9,
      drawnArea: TRIANGLE,
    })
    expect(showPicked(v, C, [area]).shown).toEqual([C])
    expect(showPicked(v, C, [area]).filters.drawnArea).toBeNull()
    expect(showPicked(v, null, [area]).shown).toBeNull()
  })

  test('a new search: a clean map, no filters, the sort kept', () => {
    const v = newSearch({
      shown: [A],
      filters: { ...DEFAULT_FILTERS, q: 'x', drawnArea: TRIANGLE },
      sort: { key: 'area', dir: -1 },
    })
    expect(v).toEqual({
      shown: [],
      filters: DEFAULT_FILTERS,
      sort: { key: 'area', dir: -1 },
    })
  })

  test('clearing the filters keeps the search words only when asked', () => {
    const v = { ...VIEW, filters: { ...DEFAULT_FILTERS, q: 'x', priceMin: 1 } }
    expect(clearFilters(v).filters).toEqual(DEFAULT_FILTERS)
    expect(clearFilters(v, true).filters).toEqual({
      ...DEFAULT_FILTERS,
      q: 'x',
    })
  })

  test('the shared view opens the same listings on another device', () => {
    const marks: Marks = {
      stars: new Set(['a1', 'c1']),
      hidden: new Set(['b1']),
    }
    const view: View = {
      ...VIEW,
      shown: [A, B],
      filters: { ...DEFAULT_FILTERS, drawnArea: TRIANGLE },
    }
    const visible = visibleListings(ALL, SOURCES, view, marks, 'en')
    const shared = sharedViewOf(view, visible, marks, [area])
    expect(shared.stars).toEqual(['a1']) // only the shown search's marks travel
    expect(shared.hidden).toEqual(['b1'])
    expect(shared.area).toEqual(area)

    const there = decodeView(encodeView(shared))
    const opened = { switched: true, view: there }
    const theirs = visibleListings(
      ALL,
      SOURCES,
      initialView({}, opened),
      {
        stars: initialMarks([], there?.stars),
        hidden: initialMarks([], there?.hidden),
      },
      'en',
    )
    expect(ids(theirs.filtered)).toEqual(ids(visible.filtered))
  })
})
