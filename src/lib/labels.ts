// Place, floor and year wording for a listing, in either language. Listing
// text stays Bulgarian; English transliterates place names.

import { transliterate } from '../../shared/text'
import { term } from '../../shared/vocab'
import type { Lang } from '../../shared/vocab'
import type { Place } from '../../shared/types'

const KIND_PREFIX_BG: Record<string, string> = {
  city: 'гр.',
  town: 'гр.',
  village: 'с.',
  resort: 'к.к.',
  locality: 'м-т',
  villaZone: 'в.з.',
}
export const KIND_EN: Record<string, string> = {
  city: 'city',
  town: 'town',
  village: 'village',
  resort: 'resort',
  locality: 'locality',
  villaZone: 'villa zone',
}

export function oblastLabel(o: string | null | undefined, lang: Lang): string {
  if (!o) return ''
  if (lang === 'bg') return o === 'София-град' ? 'София-град' : `обл. ${o}`
  if (o === 'София-град') return 'Sofia City'
  if (o === 'София') return 'Sofia Province'
  return `${transliterate(o)} Province`
}

export function placeName(
  name: string | null | undefined,
  kind: string | null | undefined,
  lang: Lang,
  nameEn?: string | null,
): string {
  if (!name) return ''
  if (lang === 'bg') {
    const prefix = kind ? KIND_PREFIX_BG[kind] : undefined
    return prefix ? `${prefix} ${name}` : name
  }
  return nameEn || transliterate(name)
}

export function listingPlace(
  l: {
    place: Place | null
    settlement?: string | null
    settlementKind?: string | null
  },
  lang: Lang,
): string {
  const p = l.place
  return p
    ? placeName(p.name, p.kind, lang, p.nameEn)
    : placeName(l.settlement, l.settlementKind, lang)
}

export function hoodName(n: string, lang: Lang): string {
  return lang === 'bg' ? n : transliterate(n.replace(/^м-т\s*/i, ''))
}

export function floorText(
  l: {
    floor?: string | null
    floorNum?: number | null
    floorsTotal?: number | null
  },
  lang: Lang,
): string {
  if (l.floorNum == null)
    return l.floor ? (lang === 'bg' ? l.floor : term(l.floor, 'en')) : ''
  const f =
    l.floorNum === 0
      ? lang === 'bg'
        ? 'партер'
        : 'G'
      : l.floorNum === -1
        ? lang === 'bg'
          ? 'сутерен'
          : 'B'
        : String(l.floorNum)
  return l.floorsTotal ? `${f}/${l.floorsTotal}` : f
}

export function yearText(l: {
  yearFrom?: number | null
  yearTo?: number | null
}): string {
  if (l.yearFrom && l.yearTo && l.yearFrom !== l.yearTo)
    return `${l.yearFrom}-${String(l.yearTo).slice(-2)}`
  return String(l.yearTo || l.yearFrom || '')
}

/** "град София" -> Sofia, "област София" -> Sofia Province (English); Bulgarian as imot.bg writes it. */
export function locationLabel(v: string, lang: Lang): string {
  if (lang === 'bg') return v
  const m = v.match(/^(град|област)\s+(.+)$/)
  if (!m) return term(v, 'en')
  return m[1] === 'град' ? transliterate(m[2]) : oblastLabel(m[2], lang)
}

const PLACE_PREFIX: Array<[RegExp, string]> = [
  [/^гр\.\s*/, 'town'],
  [/^с\.\s*/, 'village'],
  [/^к\.к\.\s*/, 'resort'],
  [/^(?:м-т|местност)\s*/i, 'locality'],
  [/^в\.з\.\s*/, 'villaZone'],
]

/** A district or village of imot.bg's search form, in either language. */
export function districtLabel(d: string, lang: Lang): string {
  if (lang === 'bg') return d
  for (const [re, kind] of PLACE_PREFIX)
    if (re.test(d))
      return `${transliterate(d.replace(re, ''))} (${KIND_EN[kind]})`
  return transliterate(d)
}
