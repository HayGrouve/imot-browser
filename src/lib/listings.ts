// What the list, the map and the filters do with the workspace's listings.
// Pure: the components hand in the listings, filters and language.

import type { FunctionReturnType } from 'convex/server'
import type { api } from '../../convex/_generated/api'
import { median, searchKey } from '../../shared/text'
import { PROPERTY_TYPES, typeLabel } from '../../shared/vocab'
import type { Lang } from '../../shared/vocab'
import type { Place } from '../../shared/types'
import { listingPlace } from './labels'

export type RawListing = FunctionReturnType<
  typeof api.listings.page
>['page'][number]
export type Source = FunctionReturnType<typeof api.sources.list>[number]

const EUR_PER_BGN = 1 / 1.95583

/** A listing with what the UI derives from it. */
export interface Listing extends RawListing {
  id: string
  /** Price in euro (BGN converted; USD left out). */
  eur: number | null
  /** Price per m² in euro. */
  ppm: number | null
  year: number | null
  /** Missing from the latest import of every search it came from. */
  stale: boolean
  /** Added by the latest import of one of its searches. */
  fresh: boolean
}

export function prepare(l: RawListing, sources: Map<string, Source>): Listing {
  const eur =
    l.price == null
      ? null
      : l.currency === 'BGN'
        ? Math.round(l.price * EUR_PER_BGN)
        : l.currency === 'USD'
          ? null
          : l.price
  const real = l.sources
    .filter((s) => s !== 'manual')
    .map((s) => sources.get(s))
    .filter((s): s is Source => !!s)
  return {
    ...l,
    id: l.imotId,
    eur,
    ppm: l.pricePerM2 ?? (eur && l.area ? Math.round(eur / l.area) : null),
    year: l.yearTo ?? l.yearFrom ?? null,
    stale: real.length > 0 && real.every((s) => s.lastImportAt > l.lastSeen),
    fresh: real.some((s) => !!s.prevImportAt && l.firstSeen === s.lastImportAt),
  }
}

// ---------------------------------------------------------------- filters

export interface Filters {
  q: string
  deal: string
  type: string
  oblast: string
  place: string
  priceMin: number | null
  priceMax: number | null
  areaMin: number | null
  areaMax: number | null
  yardMin: number | null
  starred: boolean
  onlyNew: boolean
  hideStale: boolean
  unmapped: boolean
  /** Show the listings the reader hid, instead of the others. */
  hidden: boolean
  /** An area drawn on the map: only the listings inside it. */
  drawnArea: DrawnArea | null
}

export const DEFAULT_FILTERS: Filters = {
  q: '',
  deal: '',
  type: '',
  oblast: '',
  place: '',
  priceMin: null,
  priceMax: null,
  areaMin: null,
  areaMax: null,
  yardMin: null,
  starred: false,
  onlyNew: false,
  hideStale: false,
  unmapped: false,
  hidden: false,
  drawnArea: null,
}

export function typeValue(l: Pick<Listing, 'type' | 'typeBg'>): string {
  return l.type === 'other' || !l.type ? `other:${l.typeBg || ''}` : l.type
}

/** No coordinates at all (not even the settlement could be located), so the listing is not on the map. */
export const isUnmapped = (l: Pick<Listing, 'place'>) => !l.place

export type GroupMode = 'settlement' | 'neighborhood'

export interface GroupKey {
  key: string
  lat: number
  lon: number
  hood?: string
  place: Place
}

export function groupOf(
  l: Pick<Listing, 'place' | 'nbhd'>,
  mode: GroupMode,
): GroupKey | null {
  const p = l.place
  if (!p) return null
  if (
    mode === 'neighborhood' &&
    l.nbhd &&
    l.nbhd.lat != null &&
    l.nbhd.lon != null
  ) {
    return {
      key: `nb:${p.key}|${l.nbhd.name}`,
      lat: l.nbhd.lat,
      lon: l.nbhd.lon,
      hood: l.nbhd.name,
      place: p,
    }
  }
  return { key: p.key, lat: p.lat, lon: p.lon, place: p }
}

/** A polygon drawn on the map, as [lat, lon] corners. */
export type DrawnArea = Array<[number, number]>

/** A saved drawn area, or null when it isn't one (at least three [lat, lon] corners). */
export function validDrawnArea(v: unknown): DrawnArea | null {
  if (!Array.isArray(v) || v.length < 3) return null
  const ok = v.every(
    (p) =>
      Array.isArray(p) &&
      p.length === 2 &&
      p.every((x) => typeof x === 'number' && Number.isFinite(x)),
  )
  return ok ? (v as DrawnArea) : null
}

/** Ray casting (even-odd, like the drawn shape's fill). */
export function insidePolygon(lat: number, lon: number, poly: DrawnArea) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i]
    const [yj, xj] = poly[j]
    if (
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
    )
      inside = !inside
  }
  return inside
}

/** Whether the listing's best-known point (its neighbourhood, else its settlement) is in the area. */
export function inDrawnArea(
  l: Pick<Listing, 'place' | 'nbhd'>,
  area: DrawnArea,
): boolean {
  const g = groupOf(l, 'neighborhood')
  return !!g && insidePolygon(g.lat, g.lon, area)
}

export function matchesPlace(l: Listing, key: string): boolean {
  if (key.startsWith('nb:')) return groupOf(l, 'neighborhood')?.key === key
  return l.place?.key === key
}

/** The listings the filters pick from: the hidden ones, or all the others. */
export function poolOf(
  list: Array<Listing>,
  hidden: ReadonlySet<string>,
  onlyHidden: boolean,
): Array<Listing> {
  return list.filter((l) => hidden.has(l.id) === onlyHidden)
}

export function applyFilters(
  list: Array<Listing>,
  f: Filters,
  stars: ReadonlySet<string>,
): Array<Listing> {
  const terms = searchKey(f.q).split(' ').filter(Boolean)
  return list.filter((l) => {
    if (f.deal && l.deal !== f.deal) return false
    if (f.type && typeValue(l) !== f.type) return false
    if (f.oblast && l.oblast !== f.oblast) return false
    if (f.place && !matchesPlace(l, f.place)) return false
    if (f.priceMin != null && !(l.eur != null && l.eur >= f.priceMin))
      return false
    if (f.priceMax != null && !(l.eur != null && l.eur <= f.priceMax))
      return false
    if (f.areaMin != null && !(l.area != null && l.area >= f.areaMin))
      return false
    if (f.areaMax != null && !(l.area != null && l.area <= f.areaMax))
      return false
    if (f.yardMin != null && !(l.yard != null && l.yard >= f.yardMin))
      return false
    if (f.starred && !stars.has(l.id)) return false
    if (f.onlyNew && !l.fresh) return false
    if (f.hideStale && l.stale) return false
    if (f.unmapped && !isUnmapped(l)) return false
    if (f.drawnArea && !inDrawnArea(l, f.drawnArea)) return false
    for (const term of terms) if (!l.searchText.includes(term)) return false
    return true
  })
}

/** Filter keys each pill owns (its × clears them). */
export const PILLS = {
  type: ['type', 'deal'],
  location: ['place', 'oblast'],
  price: ['priceMin', 'priceMax'],
  size: ['areaMin', 'areaMax', 'yardMin'],
  more: ['onlyNew', 'hideStale', 'unmapped', 'hidden'],
} as const satisfies Record<string, ReadonlyArray<keyof Filters>>

export type PillKey = keyof typeof PILLS

export function anyFilter(f: Filters): boolean {
  return (Object.keys(DEFAULT_FILTERS) as Array<keyof Filters>).some(
    (k) =>
      k !== 'q' && f[k] !== DEFAULT_FILTERS[k] && f[k] !== '' && f[k] != null,
  )
}

// ---------------------------------------------------------------- sorting

export type SortKey =
  'price' | 'ppm' | 'area' | 'yard' | 'year' | 'updated' | 'place' | 'type'

export interface Sort {
  key: SortKey
  dir: 1 | -1
}

export const SORTS: Array<[SortKey, 1 | -1, string]> = [
  ['price', 1, 'sortPriceAsc'],
  ['price', -1, 'sortPriceDesc'],
  ['ppm', 1, 'sortPpmAsc'],
  ['ppm', -1, 'sortPpmDesc'],
  ['area', -1, 'sortAreaDesc'],
  ['area', 1, 'sortAreaAsc'],
  ['yard', -1, 'sortYardDesc'],
  ['year', -1, 'sortYearDesc'],
  ['updated', -1, 'sortUpdated'],
  ['place', 1, 'sortPlace'],
]

export const validSort = (s: Partial<Sort> | undefined): Sort =>
  SORTS.some(([k, d]) => k === s?.key && d === s.dir)
    ? (s as Sort)
    : { key: 'price', dir: 1 }

export function sortListings(
  list: Array<Listing>,
  sort: Sort,
  lang: Lang,
): Array<Listing> {
  const get: Record<
    SortKey,
    (l: Listing) => string | number | null | undefined
  > = {
    type: (l) => typeLabel(l.type ?? 'other', l.typeBg, lang),
    place: (l) => listingPlace(l, lang),
    price: (l) => l.eur,
    ppm: (l) => l.ppm,
    area: (l) => l.area,
    yard: (l) => l.yard,
    year: (l) => l.year,
    updated: (l) => l.updatedAt || l.firstSeen,
  }
  const key = get[sort.key]
  const collator = new Intl.Collator(lang === 'bg' ? 'bg-BG' : 'en-GB', {
    numeric: true,
    sensitivity: 'base',
  })
  return [...list].sort((a, b) => {
    const va = key(a)
    const vb = key(b)
    const na = va == null || va === ''
    const nb = vb == null || vb === ''
    if (na || nb) return na === nb ? 0 : na ? 1 : -1 // empty values always last
    const c =
      typeof va === 'number' && typeof vb === 'number'
        ? va - vb
        : collator.compare(String(va), String(vb))
    return c * sort.dir || a.id.localeCompare(b.id)
  })
}

// ---------------------------------------------------------------- map groups

export interface Group extends GroupKey {
  items: Array<Listing>
  medPpm: number | null
  medPrice: number | null
}

export function computeGroups(
  filtered: Array<Listing>,
  mode: GroupMode,
): { list: Array<Group>; unmapped: number } {
  const groups = new Map<string, Group>()
  let unmapped = 0
  for (const l of filtered) {
    const g = groupOf(l, mode)
    if (!g) {
      unmapped++
      continue
    }
    let e = groups.get(g.key)
    if (!e) {
      e = { ...g, items: [], medPpm: null, medPrice: null }
      groups.set(g.key, e)
    }
    e.items.push(l)
  }
  const list = [...groups.values()]
  for (const g of list) {
    g.medPpm = median(g.items.map((x) => x.ppm))
    g.medPrice = median(g.items.map((x) => x.eur))
  }
  return { list, unmapped }
}

// Ordinal blue, validated for contrast; step 3 darkened for 4.5:1 white text.
export const MARKER_RAMP = [
  '#86b6ef',
  '#5598e7',
  '#2875d3',
  '#1c5cab',
  '#104281',
]

/** Quintile thresholds of the groups' median €/m² (ordinal bins for the colour ramp). */
export function ppmBreaks(groups: Array<Pick<Group, 'medPpm'>>): Array<number> {
  const v = groups
    .map((g) => g.medPpm)
    .filter((x): x is number => x != null)
    .sort((a, b) => a - b)
  if (!v.length) return []
  const q = (p: number) => v[Math.min(v.length - 1, Math.floor(p * v.length))]
  // With few places, quintiles coincide; drop duplicates so no band is empty ("2,420-2,420").
  // Compare with the lowest value both before and after rounding, so one place gives one colour.
  const raw = [q(0.2), q(0.4), q(0.6), q(0.8)].filter((x) => x > v[0])
  return [...new Set(raw.map((x) => Math.round(x / 10) * 10))].filter(
    (x) => x > v[0],
  )
}

/** Ramp colour for bin i of (breaks.length + 1) bins, spread over the full light→dark ramp. */
export function rampColor(i: number, breaks: Array<number>): string {
  const bins = breaks.length + 1
  return MARKER_RAMP[
    bins === 1 ? 2 : Math.round((i * (MARKER_RAMP.length - 1)) / (bins - 1))
  ]
}

export function binOf(value: number | null, breaks: Array<number>): number {
  if (value == null) return -1
  let b = 0
  while (b < breaks.length && value >= breaks[b]) b++
  return b
}

/** The order the type filter lists property types in. */
export const TYPE_ORDER = new Map(PROPERTY_TYPES.map((p, i) => [p.key, i]))

export function countBy<T>(
  list: Array<T>,
  fn: (x: T) => string | null | undefined,
): Map<string, number> {
  const m = new Map<string, number>()
  for (const x of list) {
    const k = fn(x)
    if (k == null || k === '') continue
    m.set(k, (m.get(k) ?? 0) + 1)
  }
  return m
}
