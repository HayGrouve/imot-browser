// The shapes a listing takes on its way from imot.bg's pages to the browser.

/** A settlement located on the map (offline gazetteer or OpenStreetMap). */
export interface Place {
  key: string
  lookup: string
  name: string
  nameEn: string | null
  kind: string | null
  oblast: string | null
  municipality?: string | null
  lat: number
  lon: number
  geonameId?: number | null
  /** 'geonames' (offline) or 'nominatim' (OpenStreetMap). */
  source: string
  match: string
  /** Set when the place came from the neighbourhood line ("град София, с. Бистрица"). */
  via?: string | null
}

/** A big-city neighbourhood, located online or from the gazetteer. */
export interface Nbhd {
  name: string
  lat: number | null
  lon: number | null
  source: string
  v: number
}

export interface Agency {
  name: string
  url: string | null
  logo: string | null
  address?: string | null
}

/**
 * Everything the parsers read about one listing: a search-result card, a
 * detail page, or both merged. Fields are null when the page doesn't say.
 */
export interface ListingFields {
  id: string
  url?: string
  title?: string
  deal?: string
  type?: string
  typeBg?: string
  locationRaw?: string
  oblast?: string | null
  settlement?: string | null
  settlementKind?: string | null
  neighborhood?: string | null
  address?: string | null
  price?: number | null
  currency?: string | null
  priceText?: string
  priceOnRequest?: boolean
  pricePerM2?: number | null
  vatNote?: string | null
  /** 'up' or 'down' when imot.bg marks a price change. */
  priceTrend?: string | null
  area?: number | null
  yard?: number | null
  floor?: string | null
  floorNum?: number | null
  floorsTotal?: number | null
  heating?: string | null
  material?: string | null
  status?: string | null
  yearText?: string | null
  yearFrom?: number | null
  yearTo?: number | null
  features?: Array<string>
  description?: string | null
  descriptionFull?: boolean
  phone?: string | null
  broker?: string | null
  agency?: Agency | null
  photos?: Array<string>
  thumb?: string | null
  photoCount?: number
  hasVideo?: boolean
  isNew?: boolean
  promo?: string | null
  updatedText?: string
  updatedAt?: string | null
  views?: number
  /** The page's parameter grid, as label/value pairs (Convex keys must be ASCII). */
  params?: Array<{ label: string; value: string }>
  detailsFetchedAt?: string | null
}
