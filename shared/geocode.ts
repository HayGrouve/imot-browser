// Online fallback geocoding (OpenStreetMap Nominatim): the matching rules.
// Used only for places the offline gazetteer cannot resolve, ambiguous
// town/village names, and big-city neighbourhoods. The caller supplies the
// (cached, throttled) search, so this file stays pure.

import { fuzzyKey } from './text'

export const NOMINATIM_ENDPOINT = 'https://nominatim.openstreetmap.org/search'
const BG_BBOX = { minLat: 41.2, maxLat: 44.25, minLon: 22.3, maxLon: 28.7 }

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
      /^(ж\.?\s?к\.?|кв\.|квартал|м-т|местност|в\.\s?з\.|вилна зона)\s*/i,
      '',
    )
    .trim()
const hoodKey = (s: string) => fuzzyKey(stripHoodPrefix(s)).replace(/ /g, '')

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
 * Neighbourhood inside a city; must lie within `maxKm` of the city centre and actually carry the
 * neighbourhood's name (Nominatim happily returns a *different* quarter as its best guess).
 */
export async function geocodeNeighborhood(
  search: NominatimSearch,
  name: string,
  city: string,
  center: GeoPoint | null,
  { maxKm = 20 }: { maxKm?: number } = {},
): Promise<GeoPoint | null> {
  const clean = stripHoodPrefix(name)
  const results = await search(`${clean}, ${city}, България`)
  if (!results || !results.length) return null
  const want = hoodKey(clean)
  const near = results.filter((r) => !center || distKm(r, center) <= maxKm)
  const named = (r: NominatimHit) => hoodKey(r.name) === want
  // Address hierarchy mentions the quarter, e.g. "…, кв. Симеоново, София, …".
  const inside = (r: NominatimHit) =>
    r.display
      .split(',')
      .slice(1)
      .some((part) => hoodKey(part) === want)
  const best =
    near.find((r) => PLACE_TYPES.has(r.addresstype) && named(r)) ??
    near.find((r) => r.addresstype !== 'road' && inside(r))
  return best ? { lat: best.lat, lon: best.lon } : null
}
