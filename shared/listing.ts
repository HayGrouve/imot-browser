// How a listing is stored: the light row the list and map read, the heavy
// part read when it is opened, and the text the search box matches.

import { searchKey } from './text'
import { term, typeLabel } from './vocab'
import type { ListingFields, Place } from './types'

export const SLIM_KEYS = [
  'url',
  'title',
  'deal',
  'type',
  'typeBg',
  'oblast',
  'settlement',
  'settlementKind',
  'neighborhood',
  'address',
  'price',
  'currency',
  'priceOnRequest',
  'pricePerM2',
  'vatNote',
  'priceTrend',
  'area',
  'yard',
  'floor',
  'floorNum',
  'floorsTotal',
  'heating',
  'material',
  'status',
  'yearText',
  'yearFrom',
  'yearTo',
  'updatedAt',
  'thumb',
  'photoCount',
  'descriptionFull',
  'detailsFetchedAt',
  'promo',
  'isNew',
  'hasVideo',
] as const

export const HEAVY_KEYS = [
  'locationRaw',
  'priceText',
  'description',
  'features',
  'phone',
  'broker',
  'agency',
  'photos',
  'updatedText',
  'views',
  'params',
] as const

type SlimKey = (typeof SLIM_KEYS)[number]
type HeavyKey = (typeof HEAVY_KEYS)[number]

export type SlimFields = Pick<ListingFields, SlimKey> & {
  agencyName?: string | null
}
export type HeavyFields = Pick<ListingFields, HeavyKey>

function pickDefined<TKey extends keyof ListingFields>(
  f: Partial<ListingFields>,
  keys: ReadonlyArray<TKey>,
): Pick<ListingFields, TKey> {
  const out: Partial<Pick<ListingFields, TKey>> = {}
  for (const k of keys) if (f[k] !== undefined) out[k] = f[k]
  return out as Pick<ListingFields, TKey>
}

/** The fields of the light row that these listing fields state. */
export function slimOf(f: Partial<ListingFields>): SlimFields {
  const out: SlimFields = pickDefined(f, SLIM_KEYS)
  if (f.agency !== undefined) out.agencyName = f.agency?.name || null
  return out
}

/** The light-row fields of a stored row (its other columns left out). */
export function storedSlim(row: SlimFields): SlimFields {
  const out: SlimFields = pickDefined(row, SLIM_KEYS)
  if (row.agencyName !== undefined) out.agencyName = row.agencyName
  return out
}

/** The fields of the heavy part that these listing fields state. */
export function heavyOf(f: Partial<ListingFields>): HeavyFields {
  return pickDefined(f, HEAVY_KEYS)
}

const SEARCH_TEXT_MAX = 4000

/** Latin-only text the search box matches: "bov" finds Бов, "dzhakuzi" finds джакузи. */
export function searchTextOf(
  id: string,
  slim: SlimFields,
  heavy: HeavyFields,
  place: Place | null,
): string {
  const features = heavy.features ?? []
  const parts = [
    id,
    slim.title,
    slim.typeBg,
    slim.type ? typeLabel(slim.type, slim.typeBg, 'en') : null,
    heavy.locationRaw,
    slim.settlement,
    place?.name,
    place?.nameEn,
    place?.municipality,
    slim.neighborhood,
    slim.address,
    slim.oblast,
    slim.agencyName ?? heavy.agency?.name,
    heavy.broker,
    heavy.phone,
    (heavy.phone || '').replace(/\D/g, ''),
    features.join(' '),
    features.map((x) => term(x, 'en')).join(' '),
    heavy.description,
  ]
  return searchKey(parts.filter(Boolean).join(' ')).slice(0, SEARCH_TEXT_MAX)
}

/** The stored price history, with this import's price added when it changed. */
export function nextPriceHistory<
  TPoint extends { at: string; price: number; currency: string | null },
>(
  history: Array<TPoint>,
  price: number | null | undefined,
  currency: string | null | undefined,
  now: string,
): Array<{ at: string; price: number; currency: string | null }> {
  const out: Array<{ at: string; price: number; currency: string | null }> = [
    ...history,
  ]
  if (price != null) {
    const last = out.at(-1)
    if (!last || last.price !== price)
      out.push({ at: now, price, currency: currency ?? null })
  }
  return out
}
