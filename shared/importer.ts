// The import's rules, without the I/O: price-band splitting past imot.bg's
// 1000-result cap, merging a detail page over a search card, deciding which
// listings need their page re-read, and placing a listing on the map from the
// offline gazetteer. Convex runs the steps (convex/importer.ts).

import type { Gazetteer, Resolved } from './gazetteer'
import { distKm, geocodeNeighborhood, stripHoodPrefix } from './geocode'
import type { GeoPoint, NominatimSearch } from './geocode'
import type { ListingFields, Nbhd, Place } from './types'

// Bump when neighbourhood matching changes, so stored results are re-evaluated (from the cache).
export const NBHD_VERSION = 3

export const MANUAL_SOURCE = 'manual'

export interface ImportOptions {
  /** Fetch every listing page for full data (slower, ~1 request per listing). */
  details: boolean
  /** Split searches with 1000+ results into price bands. */
  autoSplit: boolean
  /** Use OpenStreetMap Nominatim for places missing from the offline gazetteer. */
  geocodeOnline: boolean
}

export const DEFAULT_OPTIONS: ImportOptions = {
  details: true,
  autoSplit: true,
  geocodeOnline: true,
}

/** Re-fetch details when older than this (or when the price changed). */
export const REFRESH_DETAILS_DAYS = 3
/** Safety valve: listings collected by one import. */
export const MAX_LISTINGS = 5000

/** Split a price band in two (overlapping by one value so no listing falls in a gap). */
export function splitRange(
  min: number,
  max: number | null,
): Array<[number, number | null]> | null {
  if (max == null) {
    const pivot = min > 0 ? min * 2 : 100000
    return [
      [min, pivot],
      [pivot, null],
    ]
  }
  if (max - min < 2) return null
  const mid = Math.floor((min + max) / 2)
  return [
    [min, mid],
    [mid, max],
  ]
}

// Fields a fresh search card always knows better than an older stored detail page.
const CARD_FRESH = [
  'url',
  'title',
  'deal',
  'type',
  'typeBg',
  'locationRaw',
  'oblast',
  'settlement',
  'settlementKind',
  'neighborhood',
  'price',
  'currency',
  'priceText',
  'priceOnRequest',
  'priceTrend',
  'vatNote',
  'promo',
  'isNew',
  'thumb',
  'photoCount',
] as const

export function pickFresh(card: ListingFields): Partial<ListingFields> {
  const out: Record<string, unknown> = {}
  for (const k of CARD_FRESH) if (card[k] !== undefined) out[k] = card[k]
  return out
}

const KEEP_FROM_CARD = new Set([
  'locationRaw',
  'oblast',
  'settlement',
  'settlementKind',
  'neighborhood',
  'promo',
  'priceTrend',
  'isNew',
  'thumb',
  'url',
])

/** Merge detail-page fields over search-card fields (cards keep their structured location). */
export function mergeDetail(
  card: ListingFields,
  detail: Partial<ListingFields> | null,
): ListingFields {
  if (!detail) return card
  const out: Record<string, unknown> = { ...card }
  const hasCard = !!card.title
  const c = card as unknown as Record<string, unknown>
  for (const [k, v] of Object.entries(detail)) {
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) continue
    if (hasCard && KEEP_FROM_CARD.has(k) && c[k] != null) continue
    out[k] = v
  }
  return out as unknown as ListingFields
}

/** What a stored listing contributes to the decision. */
export interface StoredForDetails {
  price: number | null
  detailsFetchedAt: string | null
  photosStored: number
}

/** Does this listing's page need reading (again) in this import? */
export function needsDetails(
  card: ListingFields,
  prev: StoredForDetails | null,
  { manual, details, now }: { manual: boolean; details: boolean; now: string },
): boolean {
  if (manual) return true
  if (!details) return false
  if (!prev?.detailsFetchedAt) return true
  if (prev.price !== (card.price ?? null)) return true
  if ((card.photoCount ?? 0) > 0 && !prev.photosStored) return true // photos missed earlier
  const ageDays = (Date.parse(now) - Date.parse(prev.detailsFetchedAt)) / 864e5
  return ageDays > REFRESH_DETAILS_DAYS
}

export function lookupKey(
  oblast: string | null | undefined,
  name: string | null | undefined,
  kind: string | null | undefined,
): string {
  return `${oblast || ''}|${name || ''}|${kind || ''}`
}

function makePlace(
  r: Resolved,
  name: string,
  kind: string | null,
  oblast: string | null,
  municipality?: string | null,
): Place {
  return {
    // Display imot.bg's own spelling; GeoNames' Cyrillic names are sometimes variants ("Вакарелска").
    key: `gn:${r.geonameId}`,
    lookup: lookupKey(oblast, name, kind),
    name,
    nameEn: r.nameEn,
    kind,
    oblast,
    municipality: municipality || null,
    lat: r.lat,
    lon: r.lon,
    geonameId: r.geonameId,
    source: 'geonames',
    match: r.match,
  }
}

const SUBVILLAGE = /^(?:с\.|село)\s*([А-Яа-я][А-Яа-я .-]{1,40})$/i
// A bare name in the sub-location line ("Безден") may also be a village of the municipality.
const BARE_NAME = /^[А-Я][а-я]+(?:[ -][А-Яа-я][а-я]+){0,2}$/
const NOT_A_VILLAGE =
  /^(Център|Централна|Идеален|Квартал|Вилна|Местност|Промишлена|Индустриална)/i

/** Where the gazetteer puts a listing, before earlier online results are considered. */
export interface OfflineLocation {
  place: Place | null
  /** The lookup an online result for this listing would be stored under. */
  lookup: string
  /** A big-city neighbourhood the gazetteer knows, if the listing has one. */
  hood: Nbhd | null
  /** True when the listing is in a big city and names a neighbourhood. */
  cityHood: boolean
}

/**
 * City quarters that GeoNames knows (often former villages, e.g. Симеоново); no network needed.
 * A same-named village of the next municipality (Изгрев by Varna) is no quarter.
 */
function hoodOffline(
  g: Gazetteer,
  name: string,
  oblast: string | null | undefined,
  city: Resolved | null,
): Nbhd | null {
  if (!city) return null
  const r = g.resolve(stripHoodPrefix(name), oblast, 'other')
  if (!r || r.match !== 'exact' || distKm(r, city) > 20) return null
  if (r.admin2 && city.admin2 && r.admin2 !== city.admin2) return null
  return { name, lat: r.lat, lon: r.lon, source: 'geonames', v: NBHD_VERSION }
}

/** A big-city neighbourhood the listing is placed by, not a village of the city's municipality
 *  that it is placed as. */
function isCityHood(
  neighborhood: string | null | undefined,
  kind: string | null,
  place: Place | null,
): boolean {
  return !!neighborhood && kind === 'city' && place?.via !== 'neighborhood'
}

/** A listing as the places step finds it: where the gazetteer put it, and whether its nbhd has a point. */
export interface PlaceTarget {
  settlement: string | null
  settlementKind: string | null
  oblast: string | null
  neighborhood: string | null
  place: Place | null
  hasNbhd: boolean
}

/**
 * What the places step looks up online for a listing, by key (listings that share one share the
 * answer): its settlement when the gazetteer found none or several, and its big-city
 * neighbourhood when that has no point yet and the city was placed.
 */
export function onlineLookups(t: PlaceTarget): {
  settlement: string | null
  hood: string | null
} {
  if (!t.settlement) return { settlement: null, hood: null }
  const settlement =
    !t.place || t.place.match === 'ambiguous'
      ? lookupKey(
          t.oblast,
          t.place?.name || t.settlement,
          t.place?.kind || t.settlementKind,
        )
      : null
  const hood =
    t.place &&
    !t.hasNbhd &&
    isCityHood(t.neighborhood, t.settlementKind, t.place)
      ? `${t.settlement}|${t.neighborhood}`
      : null
  return { settlement, hood }
}

/** Settlement-level coordinates from the offline gazetteer. */
export function locateOffline(
  g: Gazetteer,
  f: ListingFields,
): OfflineLocation | null {
  if (!f.settlement) return null
  const oblast = f.oblast ?? null
  const kind = f.settlementKind ?? null
  let place: Place | null = null
  const town = g.resolve(f.settlement, oblast, kind)
  const address = f.address?.trim() ?? ''
  if (address && kind === 'town') {
    // "гр. Етрополе" + "с.Лопян": the listing is actually in a village of that municipality.
    const sub = address.match(SUBVILLAGE)
    const name = sub
      ? sub[1].trim()
      : BARE_NAME.test(address) && !NOT_A_VILLAGE.test(address)
        ? address
        : null
    const r = name ? g.resolve(name, oblast, 'village') : null
    const trusted = r && (r.match === 'exact' || (sub && r.match === 'fuzzy'))
    const near =
      trusted &&
      r.code !== 'PPLX' &&
      (!town || distKm(r, town) <= (sub ? 40 : 25))
    if (near && name)
      place = makePlace(r, name, 'village', oblast, f.settlement)
  }
  const cityVillage =
    kind === 'city' && f.neighborhood
      ? f.neighborhood.trim().match(SUBVILLAGE)
      : null
  if (cityVillage) {
    // "град София, с. Бистрица": a village inside the city's municipality, often 10–20 km from
    // the centre. Map it as its own village, not as a neighbourhood. (GeoNames files some of
    // these as sections of the city, PPLX, which is fine here.)
    const name = cityVillage[1].trim()
    const r = g.resolve(name, oblast, 'village')
    if (r && r.match !== 'anyOblast' && (!town || distKm(r, town) <= 35)) {
      place = {
        ...makePlace(r, name, 'village', oblast, f.settlement),
        via: 'neighborhood',
      }
    }
  }
  if (!place && town) place = makePlace(town, f.settlement, kind, oblast)
  const cityHood = isCityHood(f.neighborhood, kind, place)
  return {
    place,
    lookup: lookupKey(oblast, place?.name || f.settlement, place?.kind || kind),
    hood:
      cityHood && f.neighborhood
        ? hoodOffline(g, f.neighborhood, oblast, town)
        : null,
    cityHood,
  }
}

/**
 * A big-city neighbourhood looked up online, as the import does it (and the districts file was
 * built): kept to the city's own municipality, whose villages count (Бусманци for Sofia), while
 * кв. Свобода of Поморие, 15 km from Burgas, doesn't. A far-off namesake of a part (the village
 * Чайка of Провадия, for Varna's quarter Чайка) says nothing.
 */
export function lookupHood(
  g: Gazetteer,
  search: NominatimSearch,
  hood: string,
  city: string,
  oblast: string | null,
  center: GeoPoint | null,
): Promise<GeoPoint | null> {
  const own = g.resolve(city, oblast, 'city')
  return geocodeNeighborhood(search, hood, city, center, {
    inCity: (part, at) => {
      const r = g.resolve(part, oblast, 'other')
      if (r?.match !== 'exact' || !r.admin2 || !own?.admin2) return null
      if (r.admin2 === own.admin2) return true
      return distKm(r, at) <= 5 ? false : null
    },
  })
}

/**
 * The listing's place and neighbourhood, keeping an earlier online result for the same place
 * (ambiguous or unresolved names) and an earlier neighbourhood lookup of the same name.
 */
export function settleLocation(
  offline: OfflineLocation | null,
  neighborhood: string | null | undefined,
  prev: { place: Place | null; nbhd: Nbhd | null } | null,
): { place: Place | null; nbhd: Nbhd | null } {
  if (!offline) return { place: prev?.place ?? null, nbhd: prev?.nbhd ?? null }
  let place = offline.place
  const prevPlace = prev?.place
  if (
    prevPlace &&
    prevPlace.source === 'nominatim' &&
    (!place || place.match === 'ambiguous') &&
    prevPlace.lookup === offline.lookup
  )
    place = prevPlace
  let nbhd: Nbhd | null = prev?.nbhd ?? null
  if (place?.via === 'neighborhood') nbhd = null
  else if (offline.cityHood) {
    const prevNb = prev?.nbhd
    nbhd =
      offline.hood ??
      (prevNb && prevNb.name === neighborhood && prevNb.v === NBHD_VERSION
        ? prevNb
        : null)
  }
  return { place, nbhd }
}
