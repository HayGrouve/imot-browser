import { v } from 'convex/values'
import type { GenericValidator, Infer } from 'convex/values'

/** A field a page may not state: absent, or null. */
const maybe = <T extends GenericValidator>(x: T) =>
  v.optional(v.union(v.null(), x))

export const placeV = v.object({
  key: v.string(),
  lookup: v.string(),
  name: v.string(),
  nameEn: v.union(v.null(), v.string()),
  kind: v.union(v.null(), v.string()),
  oblast: v.union(v.null(), v.string()),
  municipality: maybe(v.string()),
  lat: v.number(),
  lon: v.number(),
  geonameId: maybe(v.number()),
  source: v.string(),
  match: v.string(),
  via: maybe(v.string()),
})

export const nbhdV = v.object({
  name: v.string(),
  lat: v.union(v.null(), v.number()),
  lon: v.union(v.null(), v.number()),
  source: v.string(),
  v: v.number(),
})

export const agencyV = v.object({
  name: v.string(),
  url: v.union(v.null(), v.string()),
  logo: v.union(v.null(), v.string()),
  address: maybe(v.string()),
})

export const pricePointV = v.object({
  at: v.string(),
  price: v.number(),
  currency: v.union(v.null(), v.string()),
})

/** The listing fields that list, map, filters and sorting need (the `listings` table). */
export const slimFields = {
  url: v.optional(v.string()),
  title: v.optional(v.string()),
  deal: v.optional(v.string()),
  type: v.optional(v.string()),
  typeBg: v.optional(v.string()),
  oblast: maybe(v.string()),
  settlement: maybe(v.string()),
  settlementKind: maybe(v.string()),
  neighborhood: maybe(v.string()),
  address: maybe(v.string()),
  price: maybe(v.number()),
  currency: maybe(v.string()),
  priceOnRequest: v.optional(v.boolean()),
  pricePerM2: maybe(v.number()),
  vatNote: maybe(v.string()),
  priceTrend: maybe(v.string()),
  area: maybe(v.number()),
  yard: maybe(v.number()),
  floor: maybe(v.string()),
  floorNum: maybe(v.number()),
  floorsTotal: maybe(v.number()),
  heating: maybe(v.string()),
  material: maybe(v.string()),
  status: maybe(v.string()),
  yearText: maybe(v.string()),
  yearFrom: maybe(v.number()),
  yearTo: maybe(v.number()),
  updatedAt: maybe(v.string()),
  thumb: maybe(v.string()),
  photoCount: v.optional(v.number()),
  agencyName: maybe(v.string()),
  descriptionFull: v.optional(v.boolean()),
  detailsFetchedAt: maybe(v.string()),
  promo: maybe(v.string()),
  isNew: v.optional(v.boolean()),
  hasVideo: v.optional(v.boolean()),
}

/** The rest of a listing, read only when it is opened (the `listingDetails` table). */
export const heavyFields = {
  locationRaw: v.optional(v.string()),
  priceText: v.optional(v.string()),
  description: maybe(v.string()),
  features: v.optional(v.array(v.string())),
  phone: maybe(v.string()),
  broker: maybe(v.string()),
  agency: maybe(agencyV),
  photos: v.optional(v.array(v.string())),
  updatedText: v.optional(v.string()),
  views: v.optional(v.number()),
  params: v.optional(
    v.array(v.object({ label: v.string(), value: v.string() })),
  ),
}

/** Everything the parsers read about one listing (shared/types.ts ListingFields). */
export const listingFieldsV = v.object({
  id: v.string(),
  ...slimFields,
  ...heavyFields,
})

export const offlineV = v.union(
  v.null(),
  v.object({
    place: v.union(v.null(), placeV),
    lookup: v.string(),
    hood: v.union(v.null(), nbhdV),
    cityHood: v.boolean(),
  }),
)

export const optionsV = v.object({
  details: v.boolean(),
  autoSplit: v.boolean(),
  geocodeOnline: v.boolean(),
})

/** A log line: a message code and its parameters (the UI words it, in either language). */
export const logParamsV = v.record(
  v.string(),
  v.union(v.string(), v.number(), v.boolean(), v.null()),
)

export const progressV = v.object({
  searchPages: v.number(),
  searchPagesTotal: v.number(),
  found: v.number(),
  details: v.number(),
  detailsTotal: v.number(),
  detailsSkipped: v.number(),
  geocode: v.number(),
  geocodeTotal: v.number(),
})

export const resultV = v.object({
  added: v.number(),
  updated: v.number(),
  priceChanged: v.number(),
  total: v.number(),
  requests: v.number(),
})

export const jobInputV = v.object({
  input: v.string(),
  paramsText: v.optional(v.string()),
})

export const jobStatusV = v.union(
  v.literal('queued'),
  v.literal('running'),
  v.literal('done'),
  v.literal('cancelled'),
  v.literal('error'),
)

export const jobPhaseV = v.union(
  v.literal('queued'),
  v.literal('search'),
  v.literal('details'),
  v.literal('geocode'),
  v.literal('done'),
)

export type ListingFieldsValue = Infer<typeof listingFieldsV>
export type Offline = Infer<typeof offlineV>
export type Progress = Infer<typeof progressV>
export type LogParams = Infer<typeof logParamsV>
