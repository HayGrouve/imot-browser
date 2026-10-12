import { describe, expect, test } from 'vitest'
import {
  DEFAULT_FILTERS,
  applyFilters,
  areaSearchOf,
  binOf,
  computeGroups,
  poolOf,
  ppmBreaks,
  prepare,
  rampColor,
  rememberAreaSearch,
  shownOf,
  sortListings,
  validAreaSearches,
  validDrawnArea,
  validShown,
} from './listings'
import type { DrawnArea, Listing, RawListing, Source } from './listings'
import {
  invalidRange,
  moreCount,
  payloadOf,
  sanitizeQuery,
  SEARCH_QUERY,
} from './search-query'
import { parseSearchForm } from '../../shared/searchform'
import type { SearchForm } from '../../shared/searchform'
import { fixture } from '../../shared/fixtures'
import type { Place } from '../../shared/types'

const place = (key: string, name: string, lat = 42.87, lon = 25.32): Place => ({
  key,
  lookup: `|${name}|`,
  name,
  nameEn: null,
  kind: 'town',
  oblast: 'Габрово',
  lat,
  lon,
  source: 'geonames',
  match: 'exact',
})

function raw(id: string, extra: Partial<RawListing> = {}): RawListing {
  return {
    imotId: id,
    deal: 'sale',
    type: 'house',
    typeBg: 'КЪЩА',
    price: 100000,
    currency: 'EUR',
    area: 100,
    place: place('gn:1', 'Габрово'),
    nbhd: null,
    firstSeen: '2026-10-12T10:00:00.000Z',
    lastSeen: '2026-10-12T10:00:00.000Z',
    sources: ['s1'],
    priceHistory: [],
    searchText: `${id} gabrovo kashta`,
    ...extra,
  }
}

const SOURCES = new Map<string, Source>([
  [
    's1',
    {
      key: 's1',
      url: 'https://www.imot.bg/obiavi/prodazhbi/x',
      input: '',
      paramsText: '',
      total: 3,
      capped: false,
      found: 3,
      splits: 0,
      lastImportAt: '2026-10-13T10:00:00.000Z',
      prevImportAt: '2026-10-12T10:00:00.000Z',
    },
  ],
])

describe('listings', () => {
  test('prepare: euro price, €/m², stale and new since the last import', () => {
    const fresh = prepare(
      raw('a', {
        firstSeen: '2026-10-13T10:00:00.000Z',
        lastSeen: '2026-10-13T10:00:00.000Z',
      }),
      SOURCES,
    )
    expect(fresh).toMatchObject({
      id: 'a',
      eur: 100000,
      ppm: 1000,
      fresh: true,
      stale: false,
    })
    const gone = prepare(raw('b', { currency: 'BGN', price: 195583 }), SOURCES)
    expect(gone).toMatchObject({ eur: 100000, stale: true, fresh: false })
    expect(prepare(raw('c', { currency: 'USD' }), SOURCES).eur).toBeNull()
  })

  test('filters: price band, text in either alphabet, stars', () => {
    const all: Array<Listing> = [
      prepare(raw('a', { price: 50000 }), SOURCES),
      prepare(
        raw('b', { price: 150000, searchText: 'b sofia lozenets' }),
        SOURCES,
      ),
    ]
    const ids = (
      f: Partial<typeof DEFAULT_FILTERS>,
      stars = new Set<string>(),
    ) => applyFilters(all, { ...DEFAULT_FILTERS, ...f }, stars).map((l) => l.id)
    expect(ids({ priceMin: 100000 })).toEqual(['b'])
    expect(ids({ q: 'Лозенец' })).toEqual(['b'])
    expect(ids({ q: 'lozen sofia' })).toEqual(['b'])
    expect(ids({ starred: true }, new Set(['a']))).toEqual(['a'])
  })

  test('hidden listings leave the results, and are all that shows when asked for', () => {
    const all = ['a', 'b', 'c'].map((id) => prepare(raw(id), SOURCES))
    const hidden = new Set(['b', 'gone'])
    expect(poolOf(all, hidden, false).map((l) => l.id)).toEqual(['a', 'c'])
    expect(poolOf(all, hidden, true).map((l) => l.id)).toEqual(['b'])
  })

  test('shown search: every search, only the shown links, or a clean map', () => {
    const src = (key: string, url: string | null): Source => ({
      ...SOURCES.get('s1')!,
      key,
      url,
    })
    const sources = [
      src('s1', 'https://www.imot.bg/obiavi/a'),
      src('s2', 'https://www.imot.bg/obiavi/b'),
      src('manual', null),
    ]
    const all = [
      prepare(raw('a', { sources: ['s1'] }), SOURCES),
      prepare(raw('b', { sources: ['s2'] }), SOURCES),
      prepare(raw('ab', { sources: ['s2', 's1'] }), SOURCES),
      prepare(raw('m', { sources: ['manual'] }), SOURCES),
    ]
    const ids = (shown: Array<string> | null) =>
      shownOf(all, sources, shown).map((l) => l.id)
    expect(ids(null)).toEqual(['a', 'b', 'ab', 'm'])
    expect(ids([])).toEqual([])
    expect(ids(['https://www.imot.bg/obiavi/a'])).toEqual(['a', 'ab'])
    expect(
      ids(['https://www.imot.bg/obiavi/a', 'https://www.imot.bg/obiavi/b']),
    ).toEqual(['a', 'b', 'ab'])
    // Just started: no source yet, so nothing until the import saves its listings.
    expect(ids(['https://www.imot.bg/obiavi/new'])).toEqual([])
    expect(validShown(['x'])).toEqual(['x'])
    expect(validShown([])).toEqual([])
    expect(validShown(['x', 1])).toBeNull()
    expect(validShown(undefined)).toBeNull()
  })

  test('area searches: remembered together with their area, newest first', () => {
    const area: DrawnArea = [
      [42.7, 23.3],
      [42.6, 23.4],
      [42.6, 23.2],
    ]
    const one = { urls: ['u1', 'u2'], area }
    const two = { urls: ['u3'], area }
    let list = rememberAreaSearch([], one)
    list = rememberAreaSearch(list, two)
    expect(list).toEqual([two, one])
    expect(areaSearchOf(list, 'u2')).toBe(one)
    expect(areaSearchOf(list, 'u9')).toBeUndefined()
    expect(areaSearchOf(list, null)).toBeUndefined()
    // The same search again replaces the old entry.
    const again = { urls: ['u2', 'u4'], area }
    expect(rememberAreaSearch(list, again)).toEqual([again, two])
    expect(rememberAreaSearch(list, again, 1)).toEqual([again])
    expect(
      validAreaSearches([
        one,
        { urls: [], area },
        { urls: ['u5'], area: [[1, 2]] },
        null,
      ]),
    ).toEqual([one])
    expect(validAreaSearches('nope')).toEqual([])
  })

  test('sorting puts listings without the value last', () => {
    const all = [
      prepare(raw('a', { area: null }), SOURCES),
      prepare(raw('b', { area: 50 }), SOURCES),
      prepare(raw('c', { area: 80 }), SOURCES),
    ]
    expect(
      sortListings(all, { key: 'area', dir: -1 }, 'en').map((l) => l.id),
    ).toEqual(['c', 'b', 'a'])
    expect(
      sortListings(all, { key: 'area', dir: 1 }, 'en').map((l) => l.id),
    ).toEqual(['b', 'c', 'a'])
  })

  test('map groups: one marker per place, or per neighbourhood when chosen', () => {
    const hood = {
      name: 'Лозенец',
      lat: 42.67,
      lon: 23.33,
      source: 'nominatim',
      v: 2,
    }
    const all = [
      prepare(raw('a', { nbhd: hood }), SOURCES),
      prepare(raw('b'), SOURCES),
      prepare(raw('c', { place: null }), SOURCES),
    ]
    const bySettlement = computeGroups(all, 'settlement')
    expect(bySettlement.list.map((g) => [g.key, g.items.length])).toEqual([
      ['gn:1', 2],
    ])
    expect(bySettlement.unmapped).toBe(1)
    const byHood = computeGroups(all, 'neighborhood')
    expect(byHood.list.map((g) => g.key).sort()).toEqual([
      'gn:1',
      'nb:gn:1|Лозенец',
    ])
  })

  test('drawn area: listings at a neighbourhood inside it, or else a settlement inside it', () => {
    // A box around Sofia's south (Lozenets), clear of the city's centre point.
    const area: DrawnArea = [
      [42.68, 23.3],
      [42.68, 23.36],
      [42.64, 23.36],
      [42.64, 23.3],
    ]
    const hood = {
      name: 'Лозенец',
      lat: 42.67,
      lon: 23.33,
      source: 'nominatim',
      v: 2,
    }
    const sofia = place('gn:2', 'София', 42.6975, 23.3242)
    const all = [
      prepare(raw('a', { place: sofia, nbhd: hood }), SOURCES),
      prepare(raw('b', { place: sofia }), SOURCES),
      prepare(
        raw('c', { place: place('gn:3', 'Бистрица', 42.66, 23.34) }),
        SOURCES,
      ),
      prepare(raw('d', { place: null }), SOURCES),
    ]
    const ids = applyFilters(
      all,
      { ...DEFAULT_FILTERS, drawnArea: area },
      new Set(),
    ).map((l) => l.id)
    expect(ids).toEqual(['a', 'c'])
  })

  test('drawn area: a saved one is kept only when it is a polygon', () => {
    const tri = [
      [42.7, 23.3],
      [42.6, 23.4],
      [42.6, 23.2],
    ]
    expect(validDrawnArea(tri)).toEqual(tri)
    expect(validDrawnArea(tri.slice(0, 2))).toBeNull()
    expect(
      validDrawnArea([
        [42.7, 23.3],
        [42.6, 'x'],
        [1, 2],
      ]),
    ).toBeNull()
    expect(validDrawnArea('nope')).toBeNull()
  })

  test('colour bands: quintiles of the places, never an empty band', () => {
    const groups = [500, 800, 1000, 1200, 2000].map((medPpm) => ({ medPpm }))
    const breaks = ppmBreaks(groups)
    expect(breaks).toEqual([800, 1000, 1200, 2000])
    expect(binOf(500, breaks)).toBe(0)
    expect(binOf(2000, breaks)).toBe(4)
    expect(binOf(null, breaks)).toBe(-1)
    expect(ppmBreaks([{ medPpm: 900 }])).toEqual([])
    expect(rampColor(0, [])).toBe('#2875d3') // one place, one middle colour
  })
})

describe('the search dialog query', () => {
  const sale: SearchForm = {
    deal: 'sale',
    ...parseSearchForm(fixture('search-form-sale.html')),
  }

  test('only the filters imot.bg shows for the chosen types are sent', () => {
    const q = {
      ...SEARCH_QUERY,
      types: ['2'], // 2-СТАЕН: no yard, no plot filters
      yardMin: '100',
      keyword: 'гараж',
      districts: ['Лозенец'],
      extras: { f62: 'Тухла' },
    }
    const p = payloadOf(q, sale)
    expect(p.yardMin).toBe('')
    expect(p.districts).toEqual([]) // no place chosen
    expect(p.extras).toEqual({ f62: 'Тухла' }) // construction applies to flats
    expect(moreCount(p)).toBe(2)
    const house = payloadOf({ ...q, types: ['10'] }, sale)
    expect(house.yardMin).toBe('100')
  })

  test('a "from" above its "to" is caught, with the field named', () => {
    expect(
      invalidRange({ ...SEARCH_QUERY, areaMin: '90', areaMax: '60' }),
    ).toEqual({
      field: 'areaMin',
      label: 'sfArea',
    })
    expect(
      invalidRange({
        ...SEARCH_QUERY,
        deal: 'rent',
        priceMin: '9',
        priceMax: '1',
      })?.label,
    ).toBe('sfRentPrice')
    expect(
      invalidRange({ ...SEARCH_QUERY, priceMin: '1', priceMax: '' }),
    ).toBeNull()
  })

  test('a saved query is cleaned of anything unexpected', () => {
    const q = sanitizeQuery({
      deal: 'swap',
      types: ['2', 3],
      extras: { f62: 'Тухла', f1: 5 },
      photoOnly: 'yes',
    })
    expect(q.deal).toBe('sale')
    expect(q.types).toEqual(['2'])
    expect(q.extras).toEqual({ f62: 'Тухла' })
    expect(q.photoOnly).toBe(false)
  })
})
