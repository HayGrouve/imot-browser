// imot.bg's own search form, mirrored: the option lists (property types, places, districts,
// floors, sort orders, extra filters) are read from the live form, and a filled-in query is
// turned into a search link by imot.bg's own link builder, the same request its "ТЪРСИ"
// button makes. Option ids differ between sales and rentals, so nothing here is hard-coded
// except the names of the fixed form fields.

import { decodeEntities, parseNumber } from './text'
import { divInner } from './parse'

export const IMOT_BASE = 'https://www.imot.bg'
export const BUILDER_URL = `${IMOT_BASE}/pcgi/subscript.cgi`

export type SearchDeal = 'sale' | 'rent'

export const SEARCH_DEALS: Record<SearchDeal, { rub: string; path: string }> = {
  sale: { rub: '1', path: 'prodazhbi' },
  rent: { rub: '2', path: 'naemi' },
}

export const isSearchDeal = (d: unknown): d is SearchDeal =>
  d === 'sale' || d === 'rent'

// Fixed fields of <form name="search"> on imot.bg.
export const F = {
  types: 'f7',
  location: 'f38',
  districts: 'f40',
  sort: 'f41',
  keyword: 'f42',
  priceMin: 'f28',
  priceMax: 'f29',
  currency: 'f30',
  ppmMin: 'f43',
  ppmMax: 'f44',
  areaMin: 'f26',
  areaMax: 'f27',
  yardMin: 'f45',
  yardMax: 'f46',
  floorFrom: 'f31',
  floorTo: 'f32',
  status: 'f57',
  yearFrom: 'f51',
  yearTo: 'f52',
  photoOnly: 'fe1',
  videoOnly: 'fe9',
} as const
const FIXED = new Set<string>(Object.values(F))
// imot.bg takes whole numbers, except for the area (its inputs allow "65.5").
const AMOUNTS = {
  priceMin: 0,
  priceMax: 0,
  ppmMin: 0,
  ppmMax: 0,
  areaMin: 2,
  areaMax: 2,
  yardMin: 0,
  yardMax: 0,
} as const

// Sections of extra filters that imot.bg shows depending on the chosen property types.
const EXTRA_SECTIONS = ['extritb', 'extri1', 'extrip'] as const

export interface Option {
  value: string
  label: string
}

export interface ExtraCheck {
  name: string
  value: string
  label: string
}

export interface ExtraSelect {
  name: string
  label: string
  options: Array<Option>
}

export interface ExtraSection {
  checks: Array<ExtraCheck>
  selects: Array<ExtraSelect>
}

export interface SearchFormSchema {
  types: Array<{ id: string; group: number; label: string }>
  /** Property type id -> sections of extra filters it shows, e.g. { "10": ["areah", "extritb", "extri1"] }. */
  sectionsByType: Record<string, Array<string>>
  locations: Array<Option>
  location: string
  districts: Array<string>
  floorsFrom: Array<Option>
  floorsTo: Array<Option>
  sorts: Array<Option>
  currencies: Array<string>
  yearsFrom: Array<string>
  yearsTo: Array<string>
  extras: Record<string, ExtraSection>
}

/** The form as the app uses it: for one deal and, optionally, one place. */
export interface SearchForm extends SearchFormSchema {
  deal: SearchDeal
}

const clean = (s: string) => decodeEntities(s).replace(/\s+/g, ' ').trim()

function selectInner(html: string, attr: string): string {
  return (
    html.match(
      new RegExp(`<select\\b[^>]*\\b${attr}[^>]*>([\\s\\S]*?)</select>`, 'i'),
    )?.[1] ?? ''
  )
}

/** Options of a <select>, without the empty "any" option. */
function options(selHtml: string): Array<Option & { selected: boolean }> {
  return [...selHtml.matchAll(/<option\b([^>]*)>([^<]*)/gi)]
    .map(([, attrs, label]) => ({
      value: decodeEntities(attrs.match(/\bvalue="([^"]*)"/i)?.[1] ?? ''),
      label: clean(label),
      selected: /\bselected\b/i.test(attrs),
    }))
    .filter((o) => o.value !== '')
}

const plain = (opts: Array<Option>): Array<Option> =>
  opts.map(({ value, label }) => ({ value, label }))

/** Checkboxes and labelled selects inside one extra-filter section. */
function extraFields(html: string | null): ExtraSection {
  if (!html) return { checks: [], selects: [] }
  const checks = [
    ...html.matchAll(
      /<input type="checkbox" value="([^"]*)" name="(f\d+)"\s*>([^<]*)/g,
    ),
  ]
    .map(([, value, name, label]) => ({
      name,
      value: decodeEntities(value),
      label: clean(label),
    }))
    .filter((c) => !FIXED.has(c.name))
  const selects = [
    ...html.matchAll(
      /([^<>:]+):\s*<select name="(f\d+)"[^>]*>([\s\S]*?)<\/select>/g,
    ),
  ]
    .map(([, label, name, inner]) => ({
      name,
      label: clean(label),
      options: plain(options(inner)),
    }))
    .filter((s) => !FIXED.has(s.name) && s.options.length)
  return { checks, selects }
}

function jsonAttr(html: string, id: string): unknown {
  const raw = html.match(new RegExp(`id='${id}' value='([^']*)'`))?.[1]
  try {
    return raw ? (JSON.parse(raw) as unknown) : null
  } catch {
    return null
  }
}

/** Parse imot.bg's search form page (/search/prodazhbi[/<place>]) into option lists. */
export function parseSearchForm(html: string): SearchFormSchema {
  const form = html.match(/<form name="search"[\s\S]*?<\/form>/)?.[0] ?? ''
  const types: SearchFormSchema['types'] = []
  for (const [, id, group, label] of form.matchAll(
    /<input type="checkbox" id="vi(\d+)"[^>]*?srcvichange\((\d+)\)[^>]*>([^<]*)/g,
  )) {
    if (!types.some((t) => t.id === id))
      types.push({ id, group: Number(group), label: clean(label) })
  }
  const places = options(selectInner(form, 'name="f38"'))
  const extras: Record<string, ExtraSection> = {}
  for (const id of EXTRA_SECTIONS)
    extras[id] = extraFields(
      divInner(form, new RegExp(`<div id="${id}"[^>]*>`)),
    )
  const sections = jsonAttr(form, 'displvijs')
  return {
    types,
    sectionsByType:
      sections && typeof sections === 'object'
        ? (sections as Record<string, Array<string>>)
        : {},
    // "world" leaves for a different site (worldwide-search.imot.bg).
    locations: plain(places.filter((o) => o.value !== 'world')),
    location: places.find((o) => o.selected)?.value || '',
    districts: options(selectInner(form, 'id="ri"')).map((o) => o.value),
    floorsFrom: plain(options(selectInner(form, 'name="f31"'))),
    floorsTo: plain(options(selectInner(form, 'name="f32"'))),
    sorts: plain(options(selectInner(form, 'name="f41"'))),
    currencies: options(selectInner(form, 'name="f30"')).map((o) => o.value),
    // Year lists use 0 for "any"; floors use 0 for the ground floor.
    yearsFrom: options(selectInner(form, 'name="f51"'))
      .map((o) => o.value)
      .filter((v) => v !== '0'),
    yearsTo: options(selectInner(form, 'name="f52"'))
      .map((o) => o.value)
      .filter((v) => v !== '0'),
    extras,
  }
}

/** What the search dialog sends: the filled-in form. */
export interface SearchQuery {
  deal?: string
  types?: Array<string>
  location?: string
  districts?: Array<string>
  priceMin?: string | number
  priceMax?: string | number
  currency?: string
  ppmMin?: string | number
  ppmMax?: string | number
  areaMin?: string | number
  areaMax?: string | number
  yardMin?: string | number
  yardMax?: string | number
  floorFrom?: string
  floorTo?: string
  sort?: string
  keyword?: string
  status?: Array<string>
  yearFrom?: string
  yearTo?: string
  /** Live-form field names to values, e.g. { f62: "Тухла", f33: "ДА" }. */
  extras?: Record<string, string>
  photoOnly?: boolean
  videoOnly?: boolean
}

/**
 * Query from the UI -> the fields imot.bg's form would post. Unknown or malformed values are dropped.
 */
export function buildSearchParams(q: SearchQuery = {}): Record<string, string> {
  const deal: SearchDeal = isSearchDeal(q.deal) ? q.deal : 'sale'
  const out: Record<string, string> = {
    act: '15',
    actsrc: '3',
    rub: SEARCH_DEALS[deal].rub,
    f1: '1',
  }
  const text = (v: unknown, max = 60) =>
    typeof v === 'string' || typeof v === 'number'
      ? String(v).trim().slice(0, max)
      : ''
  const list = (v: unknown, re: RegExp, max = 50) =>
    (Array.isArray(v) ? v : [])
      .map((x) => text(x))
      .filter((x) => re.test(x))
      .slice(0, max)
  const match = (v: unknown, re: RegExp) => (re.test(text(v)) ? text(v) : '')
  const set = (name: string, v: string) => {
    if (v) out[name] = v
  }

  set(
    F.types,
    list(q.types, /^\d{1,3}$/)
      .map((id) => `${id}~`)
      .join(''),
  )
  set(F.location, text(q.location))
  if (out[F.location])
    set(
      F.districts,
      list(q.districts, /^[^+~]{1,60}$/, 400)
        .map((d) => `${d}+`)
        .join(''),
    )
  for (const [k, digits] of Object.entries(AMOUNTS) as Array<
    [keyof typeof AMOUNTS, number]
  >) {
    // Number inputs may hold "1e5"; typed text may hold "1 200".
    const raw = text(q[k])
    const n =
      raw && Number.isFinite(Number(raw)) ? Number(raw) : parseNumber(raw)
    set(
      F[k],
      n != null && n > 0 && n < 1e8 ? String(Number(n.toFixed(digits))) : '',
    )
  }
  set(F.currency, match(q.currency, /^(EUR|\$)$/))
  set(F.floorFrom, match(q.floorFrom, /^\d{1,4}$/))
  set(F.floorTo, match(q.floorTo, /^\d{1,4}$/))
  set(F.sort, match(q.sort, /^\d$/))
  set(F.yearFrom, match(q.yearFrom, /^\d{4}$/))
  set(F.yearTo, match(q.yearTo, /^\d{4}$/))
  set(F.keyword, text(q.keyword, 40))
  // "Under construction" also ticks imot.bg's hidden "not completed" box, as its own form does.
  set(
    F.status,
    list(q.status, /^[12]$/)
      .flatMap((v) => (v === '2' ? ['2', '3'] : [v]))
      .map((v) => `${v}~`)
      .join(''),
  )
  if (q.photoOnly === true) out[F.photoOnly] = '1'
  if (q.videoOnly === true) out[F.videoOnly] = '1'
  const extras =
    q.extras && typeof q.extras === 'object'
      ? Object.entries(q.extras).slice(0, 60)
      : []
  for (const [name, v] of extras)
    if (/^f\d{2,3}$/.test(name) && !FIXED.has(name)) set(name, text(v))
  return out
}

/** Fields that ask the builder for a place's own form page (/search/prodazhbi/grad-sofiya). */
export function locationFormParams(
  deal: SearchDeal,
  location: string,
): Record<string, string> {
  return {
    act: '15',
    actsrc: '2',
    rub: SEARCH_DEALS[deal].rub,
    f1: '1',
    [F.location]: location,
  }
}

/** The builder's answer ({"result":"//www.imot.bg/obiavi/..."}) as an https imot.bg address. */
export function builderResult(body: string): string | null {
  let result: unknown = null
  try {
    result = (JSON.parse(body) as { result?: unknown } | null)?.result
  } catch {
    /* not JSON */
  }
  if (typeof result !== 'string' || !result) return null
  let u: URL
  try {
    u = new URL(result, IMOT_BASE)
  } catch {
    return null
  }
  if (!/(^|\.)imot\.bg$/.test(u.hostname)) return null
  u.protocol = 'https:'
  return u.href
}

/**
 * Fit a saved query to a newly loaded form. Switching between sales and rentals keeps types and
 * extra filters by their label, since imot.bg numbers them differently. Drops what the live form
 * doesn't offer (e.g. an old saved query), and keeps to one type group.
 */
export function adaptQuery<
  TQuery extends {
    deal: string
    types: Array<string>
    extras: Record<string, string>
    location: string
    districts: Array<string>
    currency: string
  },
>(query: TQuery, prev: SearchForm | null, next: SearchForm): TQuery {
  const q = { ...query, extras: { ...query.extras } }
  if (prev && prev.deal !== next.deal) {
    const label = new Map(prev.types.map((x) => [x.id, x.label]))
    q.types = q.types
      .map((id) => next.types.find((x) => x.label === label.get(id))?.id)
      .filter((x): x is string => !!x)
    const extras: Record<string, string> = {}
    const section = (f: SearchForm, id: string) =>
      f.extras[id] as ExtraSection | undefined
    for (const id of Object.keys(next.extras)) {
      for (const c of section(prev, id)?.checks ?? []) {
        const m =
          q.extras[c.name] === c.value &&
          section(next, id)?.checks.find((x) => x.value === c.value)
        if (m) extras[m.name] = m.value
      }
      for (const s of section(prev, id)?.selects ?? []) {
        const v = q.extras[s.name] as string | undefined
        const m =
          v &&
          section(next, id)?.selects.find(
            (x) => x.label === s.label && x.options.some((o) => o.value === v),
          )
        if (m && v) extras[m.name] = v
      }
    }
    q.extras = extras
  }
  const types = q.types
    .map((id) => next.types.find((x) => x.id === id))
    .filter((x): x is SearchForm['types'][number] => !!x)
  q.types = types.filter((x) => x.group === types[0].group).map((x) => x.id)
  const names = new Set(
    Object.values(next.extras).flatMap((sec) =>
      [...sec.checks, ...sec.selects].map((x) => x.name),
    ),
  )
  q.extras = Object.fromEntries(
    Object.entries(q.extras).filter(([k]) => names.has(k)),
  )
  if (!next.locations.some((l) => l.value === q.location)) q.location = ''
  if (q.location && next.location === q.location)
    q.districts = q.districts.filter((d) => next.districts.includes(d))
  if (!next.currencies.includes(q.currency))
    q.currency = next.currencies[0] || ''
  q.deal = next.deal
  return q
}
