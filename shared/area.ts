// A drawn area, and the imot.bg searches that cover it. imot.bg searches one
// place at a time (a city or a province) and, within it, a list of districts (a
// city's neighbourhoods, a province's towns and villages). So an area is searched
// as the districts whose point lies inside it, place by place. The points are the
// ones imported listings get (scripts/build-districts.mjs), so the drawn-area
// filter keeps what the search brings in.

import { BG_BBOX } from './geocode'
import { MAX_DISTRICTS } from './searchform'

/** A polygon drawn on the map, as [lat, lon] corners. */
export type DrawnArea = Array<[number, number]>

/** shared/districts-bg.json: each place's districts as [name, lat, lon]; null when not placed. */
export interface DistrictsData {
  attribution: string
  locations: Record<string, Array<[string, number | null, number | null]>>
}

/** A drawn shape has a few dozen corners; this leaves room without letting anything through. */
const MAX_CORNERS = 500
/** Searches one area may become: one import reads them one after the other. */
export const MAX_AREA_SEARCHES = 8

/** Ray casting (even-odd, like the drawn shape's fill). */
export function insidePolygon(lat: number, lon: number, poly: DrawnArea) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i]
    const [yj, xj] = poly[j]
    if (
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
    )
      inside = !inside
  }
  return inside
}

/** A saved or shared drawn area, or null when it isn't one (at least three [lat, lon] corners).
 *  Looser than `validArea`: it only has to filter listings, not be searched. */
export function validDrawnArea(v: unknown): DrawnArea | null {
  if (!Array.isArray(v) || v.length < 3) return null
  const ok = v.every(
    (p) =>
      Array.isArray(p) &&
      p.length === 2 &&
      p.every((x) => typeof x === 'number' && Number.isFinite(x)),
  )
  return ok ? (v as DrawnArea) : null
}

/** About a metre: Leaflet's 15 decimals would make links and saved areas long for nothing. */
export const roundArea = (area: DrawnArea): DrawnArea =>
  area.map(([lat, lon]) => [+lat.toFixed(5), +lon.toFixed(5)])

/** An area sent to be searched, or null: 3 to 500 corners, none far outside Bulgaria. */
export function validArea(v: unknown): DrawnArea | null {
  if (!Array.isArray(v) || v.length < 3 || v.length > MAX_CORNERS) return null
  const near = (x: unknown, min: number, max: number) =>
    typeof x === 'number' && x >= min - 1 && x <= max + 1
  const ok = v.every(
    (p) =>
      Array.isArray(p) &&
      p.length === 2 &&
      near(p[0], BG_BBOX.minLat, BG_BBOX.maxLat) &&
      near(p[1], BG_BBOX.minLon, BG_BBOX.maxLon),
  )
  return ok ? (v as DrawnArea) : null
}

/** One of imot.bg's places the area reaches into. */
export interface AreaPlace {
  /** imot.bg's place, e.g. "град София" or "област София". */
  location: string
  /** Its districts inside the area, in imot.bg's order. */
  districts: Array<string>
  /** All its districts. */
  total: number
  /** Its districts with no known point: never searched. */
  unplaced: number
}

export interface AreaPlan {
  /** Most districts inside first. */
  places: Array<AreaPlace>
  /** One imot.bg search each. */
  searches: Array<{ location: string; districts: Array<string> }>
}

/** Why a plan can't be searched (the server's error code), or null when it can. */
export function planProblem(plan: AreaPlan): 'areaEmpty' | 'areaTooBig' | null {
  if (!plan.searches.length) return 'areaEmpty'
  return plan.searches.length > MAX_AREA_SEARCHES ? 'areaTooBig' : null
}

/**
 * The searches that cover an area: per place, the districts whose point is inside. They are
 * always listed, even when that is all of a place's placed districts: the unplaced ones may lie
 * outside. A place with more districts inside than one search takes is searched in parts.
 */
export function planArea(
  area: DrawnArea,
  data: DistrictsData,
  perSearch = MAX_DISTRICTS,
): AreaPlan {
  const lats = area.map((p) => p[0])
  const lons = area.map((p) => p[1])
  const [s, n] = [Math.min(...lats), Math.max(...lats)]
  const [w, e] = [Math.min(...lons), Math.max(...lons)]
  const places: Array<AreaPlace> = []
  for (const [location, rows] of Object.entries(data.locations)) {
    const districts: Array<string> = []
    let unplaced = 0
    for (const [name, lat, lon] of rows) {
      if (lat == null || lon == null) unplaced++
      else if (
        lat >= s &&
        lat <= n &&
        lon >= w &&
        lon <= e &&
        insidePolygon(lat, lon, area)
      )
        districts.push(name)
    }
    if (districts.length)
      places.push({ location, districts, total: rows.length, unplaced })
  }
  places.sort((a, b) => b.districts.length - a.districts.length)
  const searches = places.flatMap(({ location, districts }) =>
    Array.from({ length: Math.ceil(districts.length / perSearch) }, (_, i) => ({
      location,
      districts: districts.slice(i * perSearch, (i + 1) * perSearch),
    })),
  )
  return { places, searches }
}
