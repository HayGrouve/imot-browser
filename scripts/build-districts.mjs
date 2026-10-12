#!/usr/bin/env node
// Builds shared/districts-bg.json: the districts imot.bg's search form offers for
// each city ("град X": its neighbourhoods) and province ("област X": its towns
// and villages), each with the point an imported listing there gets on the map,
// so that a drawn area can be searched district by district (shared/area.ts).
// Usage: node scripts/build-districts.mjs [--seed geocache.jsonl]
//
// imot.bg is asked one page at a time, a second apart. Places come from the
// offline gazetteer, the rest from OpenStreetMap Nominatim exactly as the
// import's "places online" step asks it (convex/importer.ts runGeocode): at most
// one request a second, every answer cached in $DISTRICTS_CACHE (default
// /tmp/districts-cache.json), so a stopped run resumes. --seed adds answers the
// deployment already has (`npx convex data geocache --format jsonl`).

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Node runs the app's TypeScript as is, but its imports have no extensions.
registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context)
    } catch (err) {
      if (/^\.\.?\//.test(specifier) && !/\.\w+$/.test(specifier))
        return next(`${specifier}.ts`, context)
      throw err
    }
  },
})

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'shared', 'districts-bg.json')
const CACHE =
  process.env.DISTRICTS_CACHE || path.join(tmpdir(), 'districts-cache.json')
const FORM_TTL_MS = 24 * 3600_000

const { Fetcher } = await import('../convex/lib/fetcher.ts')
const { Gazetteer } = await import('../shared/gazetteer.ts')
const { locateOffline } = await import('../shared/importer.ts')
const { parseLocation } = await import('../shared/parse.ts')
const {
  NOMINATIM_UA,
  geocodeNeighborhood,
  geocodeSettlement,
  nominatimUrl,
  parseNominatim,
} = await import('../shared/geocode.ts')
const {
  BUILDER_URL,
  IMOT_BASE,
  SEARCH_DEALS,
  builderResult,
  locationFormParams,
  parseSearchForm,
} = await import('../shared/searchform.ts')

const cache = existsSync(CACHE)
  ? JSON.parse(readFileSync(CACHE, 'utf8'))
  : { forms: {}, nominatim: {} }
const save = () => writeFileSync(CACHE, JSON.stringify(cache))

const seedAt = process.argv.indexOf('--seed')
if (seedAt > 0) {
  const lines = readFileSync(process.argv[seedAt + 1], 'utf8').split('\n')
  let n = 0
  for (const line of lines.filter(Boolean)) {
    const { query, results } = JSON.parse(line)
    if (!(query in cache.nominatim)) {
      cache.nominatim[query] = results
      n++
    }
  }
  save()
  console.log(`Seeded ${n} Nominatim answers`)
}

// ---------------------------------------------------------------- imot.bg's districts

const fetcher = new Fetcher({ minIntervalMs: 1000, concurrency: 1 })

/** The form's places (no location), or a place's districts. */
async function formList(deal, location) {
  const key = `${deal}|${location}`
  const hit = cache.forms[key]
  if (hit && Date.now() - hit.at < FORM_TTL_MS) return hit.list
  const url = location
    ? builderResult(
        (await fetcher.post(BUILDER_URL, locationFormParams(deal, location)))
          .html,
      )
    : `${IMOT_BASE}/search/${SEARCH_DEALS[deal].path}`
  if (!url) throw new Error(`imot.bg's link builder gave no address for ${key}`)
  const form = parseSearchForm((await fetcher.get(url)).html)
  if (!form.types.length || form.location !== location)
    throw new Error(`Not the search form of ${key}: ${url}`)
  const list = location ? form.districts : form.locations.map((l) => l.value)
  cache.forms[key] = { at: Date.now(), list }
  save()
  return list
}

const places = (await formList('sale', '')).filter((v) =>
  /^(град|област) /.test(v),
)
const lists = new Map()
for (const location of places) {
  // Sales and rentals have had the same lists; take both in case one gains a district.
  const sale = await formList('sale', location)
  const rent = await formList('rent', location)
  const extra = rent.filter((d) => !sale.includes(d))
  if (extra.length || rent.length !== sale.length)
    console.log(`${location}: sale ${sale.length}, rent ${rent.length}`)
  lists.set(location, [...sale, ...extra])
}
console.log(
  `${places.length} places, ${[...lists.values()].flat().length} districts`,
)

// ---------------------------------------------------------------- points

const g = new Gazetteer(
  JSON.parse(
    readFileSync(path.join(ROOT, 'shared', 'gazetteer-bg.json'), 'utf8'),
  ),
)
let last = 0
let asked = 0
const search = async (query) => {
  if (query in cache.nominatim) return cache.nominatim[query]
  const wait = last + 1100 - Date.now()
  if (wait > 0) await new Promise((res) => setTimeout(res, wait))
  last = Date.now()
  const res = await fetch(nominatimUrl(query), {
    headers: { 'User-Agent': NOMINATIM_UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status} for ${query}`)
  cache.nominatim[query] = parseNominatim(await res.json())
  save()
  if (++asked % 50 === 0) console.log(`${asked} Nominatim requests`)
  return cache.nominatim[query]
}

/** Where an import puts a listing of this district: its neighbourhood, else its place. */
async function pointOf(location, district) {
  // The location line of such a listing's search card ("град София, Лозенец", "гр. Своге, област София").
  const f = parseLocation(
    location.startsWith('град ')
      ? `${location}, ${district}`
      : `${district}, ${location}`,
  )
  const off = locateOffline(g, f)
  if (!off) return null
  let place = off.place
  if (!place || place.match === 'ambiguous') {
    const found = await geocodeSettlement(
      search,
      place?.name || f.settlement,
      f.oblast,
      place?.kind || f.settlementKind,
      { near: place?.match === 'ambiguous' ? place : null },
    )
    if (found) place = { ...place, ...found }
  }
  if (!off.cityHood) return place
  if (off.hood) return off.hood
  // A neighbourhood OpenStreetMap doesn't know leaves its listings at the city's centre: not placed.
  return place && place.via !== 'neighborhood'
    ? await geocodeNeighborhood(search, f.neighborhood, f.settlement, place)
    : null
}

const round = (x) => Math.round(x * 1e5) / 1e5
const locations = {}
let located = 0
let total = 0
for (const [location, list] of lists) {
  const rows = []
  for (const d of list) {
    const p = await pointOf(location, d)
    rows.push(p ? [d, round(p.lat), round(p.lon)] : [d, null, null])
  }
  const n = rows.filter((r) => r[1] != null).length
  console.log(`${location}: ${n} of ${rows.length} placed`)
  located += n
  total += rows.length
  locations[location] = rows
}

const out = {
  attribution:
    'Districts: imot.bg search form. Points: GeoNames (https://www.geonames.org), CC BY 4.0; © OpenStreetMap contributors (ODbL)',
  generated: new Date().toISOString().slice(0, 10),
  fields: ['name', 'lat', 'lon'],
  locations,
}
writeFileSync(OUT, JSON.stringify(out))
console.log(
  `Wrote ${located} of ${total} districts with a point to ${path.relative(process.cwd(), OUT)}`,
)
