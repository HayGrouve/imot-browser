// The view: which listings the list and the map show, and why. The shown search
// comes first, then the hidden listings (or only them), then the filters and the
// sort. Pure: app.tsx keeps the state, saves it, and hands it in here.

import type { SharedView } from './share'
import {
  DEFAULT_FILTERS,
  applyFilters,
  areaSearchOf,
  poolOf,
  rememberAreaSearch,
  shownOf,
  sortListings,
  validAreaSearches,
  validFilters,
  validShown,
  validSort,
} from './listings'
import type {
  AreaSearch,
  DrawnArea,
  Filters,
  Listing,
  Sort,
  Source,
} from './listings'
import type { Lang } from '../../shared/vocab'

export interface View {
  /** The shown search: the links whose listings show, null for every search's, none for a clean map. */
  shown: Array<string> | null
  filters: Filters
  sort: Sort
}

/** How this page was opened: from a link to another workspace (`switched`), with the view it was shared with. */
export interface Opened {
  switched: boolean
  view: SharedView | null
}

/**
 * The view this page starts with. A shared view wins; another workspace starts with all of its
 * searches shown and no filters (this one's drawn area or price would hide its listings); else
 * the view saved in this browser, with anything that isn't one dropped.
 */
export function initialView(saved: unknown, opened: Opened): View {
  const s = (saved && typeof saved === 'object' ? saved : {}) as Record<
    string,
    unknown
  >
  const sort = validSort(s.sort && typeof s.sort === 'object' ? s.sort : {})
  if (opened.view)
    return {
      shown: opened.view.shown,
      filters: opened.view.filters,
      sort: opened.view.sort,
    }
  if (opened.switched) return { shown: null, filters: DEFAULT_FILTERS, sort }
  return { shown: validShown(s.shown), filters: validFilters(s.filters), sort }
}

/** Saved marks (stars, hidden) with a shared view's added: it brings them along. */
export function initialMarks(
  saved: unknown,
  shared: ReadonlyArray<string> | undefined,
): Set<string> {
  const ids = Array.isArray(saved)
    ? saved.filter((x): x is string => typeof x === 'string')
    : []
  return new Set([...ids, ...(shared ?? [])])
}

/** Saved area searches, with a shared view's. */
export function initialAreaSearches(
  saved: unknown,
  opened: Opened,
): Array<AreaSearch> {
  const list = validAreaSearches(saved)
  return opened.view?.area ? rememberAreaSearch(list, opened.view.area) : list
}

// ---------------------------------------------------------------- changes

export const setFilters = (v: View, patch: Partial<Filters>): View => ({
  ...v,
  filters: { ...v.filters, ...patch },
})

/** Show these searches' listings (null: every search's), in the area they were drawn as. */
export const showSearch = (
  v: View,
  urls: Array<string> | null,
  drawnArea: DrawnArea | null = null,
): View => ({ ...v, shown: urls, filters: { ...v.filters, drawnArea } })

/** Show a search picked under "Your searches": an area search's links all together, in its area. */
export const showPicked = (
  v: View,
  url: string | null,
  areaSearches: ReadonlyArray<AreaSearch>,
): View => {
  if (url == null) return showSearch(v, null)
  const group = areaSearchOf(areaSearches, url)
  return showSearch(v, group?.urls ?? [url], group?.area)
}

/** A clean map, and the filters as they start. The sort stays. */
export const newSearch = (v: View): View => ({
  ...v,
  shown: [],
  filters: DEFAULT_FILTERS,
})

/** Every filter as it starts; the search words too unless `keepQuery`. */
export const clearFilters = (v: View, keepQuery = false): View => ({
  ...v,
  filters: { ...DEFAULT_FILTERS, q: keepQuery ? v.filters.q : '' },
})

// ---------------------------------------------------------------- what shows

export interface Marks {
  stars: ReadonlySet<string>
  hidden: ReadonlySet<string>
}

export interface Visible {
  /** The shown search's listings. */
  scoped: Array<Listing>
  /** The ones the filters pick from: the hidden ones, or all the others. */
  pool: Array<Listing>
  /** Filtered and sorted: what the list and the map show. */
  filtered: Array<Listing>
  /** Starred in the pool; hidden in the shown search. */
  starCount: number
  hiddenCount: number
  /** Not hidden, in every search: what "Show earlier searches" brings back. */
  earlier: number
  /** More than one deal (sale, rent) in the shown search: rows say which. */
  multiDeal: boolean
  /** Some of the shown search's listings have a placed neighbourhood. */
  hasHoods: boolean
  /** Nothing in the shown search: an area drawn now is drawn to be searched. */
  clean: boolean
}

export function visibleListings(
  all: Array<Listing>,
  sources: ReadonlyArray<Source>,
  view: View,
  marks: Marks,
  lang: Lang,
): Visible {
  const scoped = shownOf(all, sources, view.shown)
  const pool = poolOf(scoped, marks.hidden, view.filters.hidden)
  const filtered = sortListings(
    applyFilters(pool, view.filters, marks.stars),
    view.sort,
    lang,
  )
  const count = (list: Array<Listing>, set: ReadonlySet<string>) =>
    list.reduce((n, l) => n + (set.has(l.id) ? 1 : 0), 0)
  return {
    scoped,
    pool,
    filtered,
    starCount: count(pool, marks.stars),
    hiddenCount: count(scoped, marks.hidden),
    earlier: all.length - count(all, marks.hidden),
    multiDeal: new Set(scoped.map((l) => l.deal)).size > 1,
    hasHoods: scoped.some((l) => l.nbhd?.lat != null),
    clean: scoped.length === 0,
  }
}

/** The import of one of the shown links, if `job` is one. */
export function shownJob<TJob extends { inputs: Array<{ input: string }> }>(
  shown: View['shown'],
  job: TJob | null | undefined,
): TJob | null {
  return shown?.length && job?.inputs.some((i) => shown.includes(i.input))
    ? job
    : null
}

/** What the list says when it shows no rows, or null when it shows them (or is loading). */
export type Screen = 'error' | 'searching' | 'nothing' | 'start' | 'filtered'

export function screenOf(
  visible: Visible | null,
  shown: View['shown'],
  { error, importing }: { error: boolean; importing: boolean },
): Screen | null {
  if (!visible) return error ? 'error' : null
  if (visible.clean) {
    // A search just started: its listings are on their way.
    if (shown?.length && importing) return 'searching'
    return shown?.length ? 'nothing' : 'start'
  }
  return visible.filtered.length ? null : 'filtered'
}

/**
 * What the share link opens on another device: this view, and the marks among the shown
 * search's listings that change what it shows, and the area search the shown links make.
 */
export function sharedViewOf(
  view: View,
  visible: Visible | null,
  marks: Marks,
  areaSearches: ReadonlyArray<AreaSearch>,
): SharedView {
  const ids = (visible?.scoped ?? []).map((l) => l.id)
  return {
    shown: view.shown,
    filters: view.filters,
    sort: view.sort,
    hidden: ids.filter((id) => marks.hidden.has(id)),
    stars: ids.filter((id) => marks.stars.has(id)),
    area:
      (view.shown?.length && areaSearchOf(areaSearches, view.shown[0])) || null,
  }
}
