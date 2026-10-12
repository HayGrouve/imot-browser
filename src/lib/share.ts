// What the share link carries besides the workspace: the view on this screen
// (the shown search, the filters, the sort) and the marks that change which
// listings show (hidden and starred). Without it, another device opens the
// workspace with whatever it showed last.

import {
  DEFAULT_FILTERS,
  validAreaSearches,
  validDrawnArea,
  validShown,
  validSort,
} from './listings'
import type { AreaSearch, DrawnArea, Filters, Sort } from './listings'

export interface SharedView {
  shown: Array<string> | null
  filters: Filters
  sort: Sort
  /** Hidden and starred listings among the shown search's. */
  hidden: Array<string>
  stars: Array<string>
  /** The area search the shown links make, so "Your searches" knows its area. */
  area: AreaSearch | null
}

const NUMBERS = ['priceMin', 'priceMax', 'areaMin', 'areaMax', 'yardMin']
const ID = /^[A-Za-z0-9]{1,40}$/

/** About a metre: Leaflet's 15 decimals would make the link long for nothing. */
const round = (area: DrawnArea): DrawnArea =>
  area.map(([lat, lon]) => [+lat.toFixed(5), +lon.toFixed(5)])

export function encodeView(view: SharedView): string {
  const filters: Partial<Filters> = {}
  for (const k of Object.keys(DEFAULT_FILTERS) as Array<keyof Filters>) {
    const value = view.filters[k]
    if (value === DEFAULT_FILTERS[k]) continue
    Object.assign(filters, {
      [k]: k === 'drawnArea' && value ? round(value as DrawnArea) : value,
    })
  }
  const json = JSON.stringify({
    shown: view.shown,
    filters,
    sort: view.sort,
    hidden: view.hidden,
    stars: view.stars,
    area: view.area && { urls: view.area.urls, area: round(view.area.area) },
  })
  let bin = ''
  for (const b of new TextEncoder().encode(json)) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** The view a link carries, or null when it carries none that reads. */
export function decodeView(text: string | null): SharedView | null {
  if (!text) return null
  let raw: unknown
  try {
    const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
    raw = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object') return null
  const v = raw as Record<string, unknown>
  return {
    shown: validShown(v.shown),
    filters: validFilters(v.filters),
    sort: validSort(v.sort && typeof v.sort === 'object' ? v.sort : {}),
    hidden: validIds(v.hidden),
    stars: validIds(v.stars),
    area: validAreaSearches([v.area])[0] ?? null,
  }
}

function validFilters(v: unknown): Filters {
  const f = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  const out: Filters = { ...DEFAULT_FILTERS }
  for (const k of Object.keys(DEFAULT_FILTERS) as Array<keyof Filters>) {
    const value = f[k]
    if (k === 'drawnArea') out.drawnArea = validDrawnArea(value)
    else if (NUMBERS.includes(k)) {
      if (typeof value === 'number' && Number.isFinite(value))
        Object.assign(out, { [k]: value })
    } else if (typeof value === typeof DEFAULT_FILTERS[k])
      Object.assign(out, { [k]: value })
  }
  return out
}

const validIds = (v: unknown): Array<string> =>
  Array.isArray(v)
    ? v.filter((x): x is string => typeof x === 'string' && ID.test(x))
    : []
