// Online fallback geocoding (OpenStreetMap Nominatim): the matching rules.
// Used only for places the offline gazetteer cannot resolve, ambiguous
// town/village names, and big-city neighbourhoods. The caller supplies the
// (cached, throttled) search, so this file stays pure.

import { fuzzyKey } from './text'

export const NOMINATIM_ENDPOINT = 'https://nominatim.openstreetmap.org/search'
/** Nominatim's usage policy asks for an identifying User-Agent. */
export const NOMINATIM_UA =
  'onova-za-imotite/1.0 (+https://github.com/HayGrouve/onova-za-imotite)'
export const BG_BBOX = {
  minLat: 41.2,
  maxLat: 44.25,
  minLon: 22.3,
  maxLon: 28.7,
}

export interface NominatimHit {
  lat: number
  lon: number
  type: string
  addresstype: string
  name: string
  display: string
}

/** A cached Nominatim search: null when online lookups are off and the query isn't cached. */
export type NominatimSearch = (
  query: string,
) => Promise<Array<NominatimHit> | null>

export interface GeoPoint {
  lat: number
  lon: number
}

export const stripHoodPrefix = (s: string | null | undefined) =>
  String(s || '')
    .trim()
    .replace(
      /^(ж\.?\s?к\.?|ж\.?\s?гр\.?|кв\.|квартал|м-т|местност|в\.\s?з\.|вилна зона|к\.\s?к\.)\s*/i,
      '',
    )
    .trim()
const hoodKey = (s: string) => fuzzyKey(stripHoodPrefix(s)).replace(/ /g, '')
// A locality, villa zone or resort is no housing estate (ж.к.) or quarter (кв.).
const NOT_A_QUARTER = /^(м-т|местност|в\.\s?з\.|вилна зона|к\.\s?к\.)/i
// A numbered or lettered estate ("Люлин 7", "Левски Г", "Младост 1А") and its base name.
const NUMBERED = /^(.+?)\s+(?:\d+[А-Яа-я]?|[А-Я])$/

// Nominatim's names for Bulgarian provinces match imot.bg's except Sofia Province.
const nominatimState = (oblast: string | null | undefined) =>
  oblast === 'София' ? 'Софийска' : oblast || null

const PLACE_TYPES = new Set([
  'city',
  'town',
  'village',
  'hamlet',
  'isolated_dwelling',
  'locality',
  'suburb',
  'quarter',
  'neighbourhood',
  'city_district',
  'residential',
  'farm',
  'allotments',
  'municipality',
  'place',
])

// A quarter is part of its city: a city, town or village of that name is another settlement
// (Изгрев by Varna is a village of Суворово).
const SETTLEMENTS = new Set(['city', 'town', 'village'])
// Administrative areas: a city's район can share its name with the квартал imot.bg means.
const ADMIN_TYPES = new Set([
  'county',
  'state_district',
  'district',
  'borough',
  'city_district',
  'suburb',
  'quarter',
  'municipality',
])

const KIND_TYPES: Record<string, Array<string>> = {
  city: ['city', 'town'],
  town: ['town', 'city'],
  village: ['village', 'hamlet', 'isolated_dwelling'],
}

export function distKm(a: GeoPoint, b: GeoPoint): number {
  const R = 6371
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** The Nominatim search URL for a query (Bulgaria only, Bulgarian names). */
export function nominatimUrl(query: string): string {
  const u = new URL(NOMINATIM_ENDPOINT)
  u.searchParams.set('q', query)
  u.searchParams.set('format', 'jsonv2')
  u.searchParams.set('countrycodes', 'bg')
  u.searchParams.set('accept-language', 'bg')
  u.searchParams.set('limit', '5')
  return u.href
}

/** Nominatim's JSON answer -> hits inside Bulgaria. */
export function parseNominatim(json: unknown): Array<NominatimHit> {
  if (!Array.isArray(json)) return []
  return (json as Array<Record<string, unknown>>)
    .map((r) => ({
      lat: Number(r.lat),
      lon: Number(r.lon),
      type: String(r.type ?? ''),
      addresstype: String(r.addresstype ?? ''),
      name: String(r.name ?? ''),
      display: String(r.display_name ?? ''),
    }))
    .filter(
      (r) =>
        r.lat >= BG_BBOX.minLat &&
        r.lat <= BG_BBOX.maxLat &&
        r.lon >= BG_BBOX.minLon &&
        r.lon <= BG_BBOX.maxLon,
    )
}

/** Settlement by name + oblast; `kind` picks town vs village; `near` keeps results close to a hint. */
export async function geocodeSettlement(
  search: NominatimSearch,
  name: string,
  oblast: string | null | undefined,
  kind: string | null | undefined,
  { near, maxKm = 60 }: { near?: GeoPoint | null; maxKm?: number } = {},
): Promise<GeoPoint | null> {
  const state = nominatimState(oblast)
  const wanted = kind ? KIND_TYPES[kind] : undefined
  const accept = (rs: Array<NominatimHit> | null, requireState: boolean) =>
    (rs ?? []).filter(
      (r) =>
        PLACE_TYPES.has(r.addresstype) &&
        (!near || distKm(r, near) <= maxKm) &&
        (!requireState || !state || r.display.includes(state)),
    )
  const typedOf = (rs: Array<NominatimHit>) =>
    wanted ? rs.filter((r) => wanted.includes(r.addresstype)) : rs

  const first = accept(
    await search([name, state, 'България'].filter(Boolean).join(', ')),
    false,
  )
  let best = typedOf(first).at(0)
  if (!best) {
    // Without the oblast Nominatim ranks differently (e.g. finds "с. Костенец" next to "гр. Костенец").
    const second = accept(await search(`${name}, България`), true)
    best = typedOf(second).at(0) ?? first.at(0) ?? second.at(0)
  }
  return best ? { lat: best.lat, lon: best.lon } : null
}

/**
 * Neighbourhood inside a city, within `maxKm` of the city centre. Nominatim happily returns a
 * street, a bus stop or a *different* quarter as its best guess, so the first acceptable answer
 * of these wins:
 * 1. a place carrying the neighbourhood's name;
 * 2. the same, asked as a housing estate ("ж.к. X") and as a quarter ("кв. X"), which is how
 *    OpenStreetMap often names them;
 * 3. anything, a street or a stop too, whose address lies in the neighbourhood;
 * 4. an administrative area of that name (a район can be far bigger than its квартал);
 * 5. for a numbered estate ("Люлин 7"), all of the above for its base name ("Люлин").
 * Later questions are asked only when the earlier answers don't do. `inCity` tells whether an
 * address part is a settlement of the city's own municipality (true), another municipality's
 * settlement at that spot (false), or neither (null): an answer whose first such part is false
 * lies in another town.
 */
export async function geocodeNeighborhood(
  search: NominatimSearch,
  name: string,
  city: string,
  center: GeoPoint | null,
  {
    maxKm = 20,
    inCity,
  }: {
    maxKm?: number
    inCity?: (part: string, at: GeoPoint) => boolean | null
  } = {},
): Promise<GeoPoint | null> {
  const clean = stripHoodPrefix(name)
  const quarter = !NOT_A_QUARTER.test(name.trim())
  const base = clean.match(NUMBERED)?.[1]
  const find = (n: string) =>
    findHood(search, n, city, center, { maxKm, quarter, inCity })
  return (await find(clean)) ?? (base ? await find(base) : null)
}

/** A hit's address after its own name, which may hold a comma itself ("Кв. Банево, Център"). */
function addressParts(r: NominatimHit): Array<string> {
  const comma = r.display.indexOf(',')
  const rest =
    r.name && r.display.startsWith(`${r.name},`)
      ? r.display.slice(r.name.length + 1)
      : comma < 0
        ? ''
        : r.display.slice(comma + 1)
  return rest.split(',').map((part) => part.trim())
}

async function findHood(
  search: NominatimSearch,
  clean: string,
  city: string,
  center: GeoPoint | null,
  {
    maxKm,
    quarter,
    inCity,
  }: {
    maxKm: number
    quarter: boolean
    inCity?: (part: string, at: GeoPoint) => boolean | null
  },
): Promise<GeoPoint | null> {
  const want = hoodKey(clean)
  const named = (r: NominatimHit) => hoodKey(r.name) === want
  // Address hierarchy mentions the quarter, e.g. "Гео Милев, ж.к. Гео Милев, София, …".
  const inside = (r: NominatimHit) =>
    addressParts(r).some((part) => hoodKey(part) === want)
  // "кв. Свобода, Поморие, Бургас": Поморие's quarter, not Burgas'. The quarter's own name is
  // no settlement here, even where a village elsewhere carries it.
  const local = (r: NominatimHit) => {
    for (const part of addressParts(r)) {
      const own = inCity && hoodKey(part) !== want ? inCity(part, r) : null
      if (own != null) return own
    }
    return true
  }
  const seen: Array<NominatimHit> = []
  for (const q of quarter
    ? [clean, `ж.к. ${clean}`, `кв. ${clean}`]
    : [clean]) {
    const near = ((await search(`${q}, ${city}, България`)) ?? []).filter(
      (r) => (!center || distKm(r, center) <= maxKm) && local(r),
    )
    const hit = near.find(
      (r) =>
        PLACE_TYPES.has(r.addresstype) &&
        !SETTLEMENTS.has(r.addresstype) &&
        named(r),
    )
    if (hit) return { lat: hit.lat, lon: hit.lon }
    seen.push(...near)
  }
  const best =
    seen.find(inside) ??
    seen.find((r) => ADMIN_TYPES.has(r.addresstype) && named(r))
  return best ? { lat: best.lat, lon: best.lon } : null
}
