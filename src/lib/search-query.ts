// The "Search imot.bg" dialog's query and imot.bg's rules for it: which extra
// filters the chosen property types show, what is sent, and range checks.

import { PROPERTY_TYPES } from '../../shared/vocab'
import type { Lang } from '../../shared/vocab'
import type { SearchDeal, SearchForm } from '../../shared/searchform'

export interface SearchQueryState {
  deal: SearchDeal
  types: Array<string>
  location: string
  districts: Array<string>
  priceMin: string
  priceMax: string
  currency: string
  ppmMin: string
  ppmMax: string
  areaMin: string
  areaMax: string
  floorFrom: string
  floorTo: string
  sort: string
  keyword: string
  yardMin: string
  yardMax: string
  status: Array<string>
  yearFrom: string
  yearTo: string
  extras: Record<string, string>
  photoOnly: boolean
  videoOnly: boolean
}

export const SEARCH_QUERY: SearchQueryState = {
  deal: 'sale',
  types: [],
  location: '',
  districts: [],
  priceMin: '',
  priceMax: '',
  currency: 'EUR',
  ppmMin: '',
  ppmMax: '',
  areaMin: '',
  areaMax: '',
  floorFrom: '',
  floorTo: '',
  sort: '',
  keyword: '',
  yardMin: '',
  yardMax: '',
  status: [],
  yearFrom: '',
  yearTo: '',
  extras: {},
  photoOnly: false,
  videoOnly: false,
}

const STRING_KEYS = [
  'location',
  'priceMin',
  'priceMax',
  'currency',
  'ppmMin',
  'ppmMax',
  'areaMin',
  'areaMax',
  'floorFrom',
  'floorTo',
  'sort',
  'keyword',
  'yardMin',
  'yardMax',
  'yearFrom',
  'yearTo',
] as const

const strings = (v: unknown) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []

/** A saved query, cleaned of anything an older version (or a hand edit) left in it. */
export function sanitizeQuery(saved: unknown): SearchQueryState {
  const s = (saved && typeof saved === 'object' ? saved : {}) as Record<
    string,
    unknown
  >
  const q: SearchQueryState = { ...SEARCH_QUERY }
  q.deal = s.deal === 'rent' ? 'rent' : 'sale'
  for (const k of STRING_KEYS) if (typeof s[k] === 'string') q[k] = s[k]
  q.types = strings(s.types)
  q.districts = strings(s.districts)
  q.status = strings(s.status)
  q.photoOnly = s.photoOnly === true
  q.videoOnly = s.videoOnly === true
  if (s.extras && typeof s.extras === 'object')
    q.extras = Object.fromEntries(
      Object.entries(s.extras as Record<string, unknown>).filter(
        (e): e is [string, string] => typeof e[1] === 'string',
      ),
    )
  return q
}

/** Extra-filter sections imot.bg shows for the chosen property types. */
export function sectionsFor(
  form: SearchForm | null,
  types: Array<string>,
): Set<string> {
  const out = new Set<string>()
  for (const id of types)
    for (const s of form?.sectionsByType[id] ?? []) out.add(s)
  return out
}

/** The query as sent: only filters imot.bg would apply for the chosen types and place. */
export function payloadOf(
  q: SearchQueryState,
  form: SearchForm | null,
): SearchQueryState {
  const sections = sectionsFor(form, q.types)
  const out: SearchQueryState = { ...q, extras: {} }
  for (const [id, sec] of Object.entries(form?.extras ?? {})) {
    if (!sections.has(id)) continue
    for (const c of sec.checks)
      if (q.extras[c.name] === c.value) out.extras[c.name] = c.value
    for (const s of sec.selects) {
      const v = q.extras[s.name] as string | undefined
      if (v) out.extras[s.name] = v
    }
  }
  if (!sections.has('areah')) Object.assign(out, { yardMin: '', yardMax: '' })
  if (!sections.has('extritb'))
    Object.assign(out, { status: [], yearFrom: '', yearTo: '' })
  if (!out.location) out.districts = []
  return out
}

/** Number of "More filters" in effect (hidden sections don't count: they are not sent). */
export function moreCount(p: SearchQueryState): number {
  return (
    [
      p.keyword,
      p.yardMin || p.yardMax,
      p.yearFrom || p.yearTo,
      p.photoOnly,
      p.videoOnly,
    ].filter(Boolean).length +
    p.status.length +
    Object.keys(p.extras).length
  )
}

/** Range fields and the label of each, to point at the first one imot.bg would get wrong. */
export const RANGES: Array<
  [keyof SearchQueryState, keyof SearchQueryState, string | null]
> = [
  ['priceMin', 'priceMax', null],
  ['ppmMin', 'ppmMax', 'sfPpm'],
  ['areaMin', 'areaMax', 'sfArea'],
  ['yardMin', 'yardMax', 'sfYard'],
  ['yearFrom', 'yearTo', 'sfYear'],
]

/** The first range whose "from" is above its "to": { field, label }, or null. */
export function invalidRange(
  p: SearchQueryState,
): { field: keyof SearchQueryState; label: string } | null {
  for (const [a, b, key] of RANGES) {
    const lo = p[a]
    const hi = p[b]
    if (
      typeof lo !== 'string' ||
      typeof hi !== 'string' ||
      lo === '' ||
      hi === ''
    )
      continue
    if (Number(lo) > Number(hi))
      return {
        field: a,
        label: key ?? (p.deal === 'rent' ? 'sfRentPrice' : 'sfPrice'),
      }
  }
  return null
}

// Form labels that are not listing types of their own.
const TYPE_LABELS: Record<string, [string, string]> = {
  СТАЯ: ['Room', 'Стая'],
  МЯСТО: ['Plot', 'Място'],
  'ГАРАЖ, ПАРКОМЯСТО': ['Garage, parking space', 'Гараж, паркомясто'],
}

export function formTypeLabel(bg: string, lang: Lang): string {
  const own = TYPE_LABELS[bg] as [string, string] | undefined
  if (own) return own[lang === 'bg' ? 1 : 0]
  const p = PROPERTY_TYPES.find((x) => x.re.test(bg))
  if (p) return lang === 'bg' ? p.bg : p.en
  return bg.charAt(0) + bg.slice(1).toLowerCase()
}
