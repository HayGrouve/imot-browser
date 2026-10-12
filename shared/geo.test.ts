import { expect, test } from 'vitest'
import { Gazetteer } from './gazetteer'
import type { GazetteerData } from './gazetteer'
import { geocodeNeighborhood } from './geocode'
import type { NominatimHit } from './geocode'
import {
  NBHD_VERSION,
  locateOffline,
  lookupHood,
  onlineLookups,
  settleLocation,
} from './importer'
import { parseLocation } from './parse'
import data from './gazetteer-bg.json'
import hoodAnswers from './fixtures/nominatim-hoods.json'

const g = new Gazetteer(data as unknown as GazetteerData)

test('gazetteer resolves towns, villages and station villages', () => {
  expect(g.resolve('Своге', 'София', 'town')?.nameEn).toBe('Svoge')
  expect(g.resolve('Гара Бов', 'София', 'other')?.nameEn).toBe('Gara Bov')
  expect(g.resolve('София', 'София-град', 'city')?.code).toBe('PPLC')
  expect(g.resolve('Градец', 'София', 'village')?.nameEn).toBe('Gradets') // must not strip "Град"
})

test('gazetteer never matches upper/lower (Горни/Долни) pairs', () => {
  // Via the municipality code, despite a wrong admin1 in GeoNames.
  expect(g.resolve('Горни Окол', 'София', 'village')?.nameEn).toBe('Gorni Okol')
})

test('gazetteer flags same-name places it cannot tell apart', () => {
  expect(g.resolve('Костенец', 'София', 'village')?.match).toBe('ambiguous')
})

test('villages inside a city municipality are mapped as villages, not city neighbourhoods', () => {
  const at = (loc: string) => {
    const f = { id: 'x', ...parseLocation(loc) }
    return settleLocation(locateOffline(g, f), f.neighborhood, null)
  }
  const village = at('град София, с. Бистрица')
  expect(village.place?.nameEn).toBe('Bistritsa')
  expect(village.place?.via).toBe('neighborhood')
  expect(village.place?.municipality).toBe('София')
  expect(village.nbhd).toBeNull()
  // An ordinary neighbourhood stays in the city, and is located offline at the quarter itself.
  const hood = at('град София, Симеоново')
  expect(hood.place?.nameEn).toBe('Sofia')
  expect(hood.nbhd?.source).toBe('geonames')
  expect(Math.abs((hood.nbhd?.lat ?? 0) - 42.617)).toBeLessThan(0.01)
  expect(Math.abs((hood.nbhd?.lon ?? 0) - 23.333)).toBeLessThan(0.01)
})

test('a neighbourhood located by older rules is looked up again on the next import', () => {
  const f = { id: 'x', ...parseLocation('град София, Лозенец') }
  const offline = locateOffline(g, f)
  const place = offline?.place ?? null
  const old = {
    name: 'Лозенец',
    lat: null,
    lon: null,
    source: 'none',
    v: NBHD_VERSION - 1,
  }
  // No neighbourhood: the import's "places online" step asks again.
  expect(
    settleLocation(offline, f.neighborhood, { place, nbhd: old }).nbhd,
  ).toBeNull()
  const current = { ...old, lat: 42.68, lon: 23.32, v: NBHD_VERSION }
  expect(
    settleLocation(offline, f.neighborhood, { place, nbhd: current }).nbhd,
  ).toBe(current)
})

test('a sub-village in the address moves a town listing to that village', () => {
  const f = {
    id: 'x',
    ...parseLocation('гр. Етрополе, област София'),
    address: 'с.Лопян',
  }
  expect(locateOffline(g, f)?.place?.nameEn).toBe('Lopyan')
})

test('an earlier online result is kept for a place the gazetteer cannot settle', () => {
  const f = { id: 'x', ...parseLocation('с. Костенец, област София') }
  const offline = locateOffline(g, f)
  expect(offline?.place?.match).toBe('ambiguous')
  const online = {
    ...offline!.place!,
    key: 'osm:42.3,23.8',
    source: 'nominatim' as const,
    match: 'disambiguated',
  }
  expect(
    settleLocation(offline, null, { place: online, nbhd: null }).place,
  ).toBe(online)
})

test('online neighbourhood lookup rejects results named after a different quarter', async () => {
  const center = { lat: 42.6975, lon: 23.3242 }
  const hit = (h: Partial<NominatimHit>): NominatimHit => ({
    lat: 0,
    lon: 0,
    type: '',
    addresstype: '',
    name: '',
    display: '',
    ...h,
  })
  // Real Nominatim answer for "Симеоново, София": best place-type hit is another quarter.
  const answers: Record<string, Array<NominatimHit>> = {
    'Симеоново, София, България': [
      hit({
        name: 'Симеоново',
        addresstype: 'road',
        lat: 42.6721,
        lon: 23.3342,
        display: 'Симеоново, Лозенец, София, България',
      }),
      hit({
        name: 'Симеоново',
        addresstype: 'information',
        lat: 42.6092,
        lon: 23.3304,
        display: 'Симеоново, кв. Симеоново, Студентски, София, България',
      }),
      hit({
        name: 'кв. Драгалевци',
        addresstype: 'suburb',
        lat: 42.6303,
        lon: 23.3132,
        display: 'кв. Драгалевци, Витоша, София, България',
      }),
    ],
    'Детски град, София, България': [
      hit({
        name: 'Англо-американско училище',
        addresstype: 'amenity',
        lat: 42.6154,
        lon: 23.3932,
        display:
          'Англо-американско училище, Веселинов рид, ж.к. Свети Георги, Панчарево, България',
      }),
    ],
  }
  const search = async (q: string) => answers[q] ?? null
  // Inside "кв. Симеоново", not Драгалевци and not a same-named street.
  expect(
    (await geocodeNeighborhood(search, 'Симеоново', 'София', center))?.lat,
  ).toBe(42.6092)
  expect(
    await geocodeNeighborhood(search, 'м-т Детски град', 'София', center),
  ).toBeNull()
})

// Real Nominatim answers (as scripts/build-districts.mjs cached them), by query.
const ANSWERS = hoodAnswers as Record<string, Array<NominatimHit>>
const SOFIA = { lat: 42.69751, lon: 23.32415 }
const asked = async (q: string) => ANSWERS[q] ?? []
/** Only these queries' answers; Nominatim finds nothing for the others. */
const only =
  (...queries: Array<string>) =>
  async (q: string) =>
    queries.includes(q) ? (ANSWERS[q] ?? []) : []

test('a quarter OpenStreetMap names "кв. X" beats the район of that name and what lies in it', async () => {
  // "Витоша" alone finds the район; "ж.к. Витоша" a mall and an office in the район.
  expect(await geocodeNeighborhood(asked, 'Витоша', 'София', SOFIA)).toEqual({
    lat: 42.6468281,
    lon: 23.3292104,
  })
})

test('a street whose address lies in the estate places it when the estate has no node', async () => {
  const streets = 'Гео Милев, София, България'
  // A Гео Милев street of ж.к. Гео Милев, not the one of ж.к. Христо Смирненски.
  expect(
    await geocodeNeighborhood(only(streets), 'Гео Милев', 'София', SOFIA),
  ).toEqual({ lat: 42.6852858, lon: 23.3561887 })
  // The estate's own node comes first.
  expect(
    await geocodeNeighborhood(
      only(streets, 'ж.к. Гео Милев, София, България'),
      'Гео Милев',
      'София',
      SOFIA,
    ),
  ).toEqual({ lat: 42.6799956, lon: 23.3628704 })
})

test('the район of that name is the last resort', async () => {
  expect(
    await geocodeNeighborhood(
      only('Лозенец, София, България'),
      'Лозенец',
      'София',
      SOFIA,
    ),
  ).toEqual({ lat: 42.6597151, lon: 23.3250228 })
})

test('a numbered estate OpenStreetMap does not know takes its base name', async () => {
  // "бл. 2" buildings of ж.к. Овча купел are no "Овча купел 2": ж.к. Овча купел is.
  expect(
    await geocodeNeighborhood(asked, 'Овча купел 2', 'София', SOFIA),
  ).toEqual({ lat: 42.68694, lon: 23.2502201 })
})

test("another town's quarter or village of that name is not the city's", async () => {
  const burgas = g.resolve('Бургас', 'Бургас', 'city')
  // Not the village Свобода (Камено), but кв. Свобода of Поморие, 15 km away…
  expect(await geocodeNeighborhood(asked, 'Свобода', 'Бургас', burgas)).toEqual(
    { lat: 42.5635178, lon: 27.6297643 },
  )
  // …unless the lookup knows Поморие is another municipality, as the import's does.
  expect(
    await lookupHood(g, asked, 'Свобода', 'Бургас', 'Бургас', burgas),
  ).toBeNull()
})

test('the places step looks up online what the gazetteer left unsure', () => {
  const target = (loc: string) => {
    const f = { id: 'x', ...parseLocation(loc) }
    const { place, nbhd } = settleLocation(
      locateOffline(g, f),
      f.neighborhood,
      null,
    )
    return {
      settlement: f.settlement ?? null,
      settlementKind: f.settlementKind ?? null,
      oblast: f.oblast ?? null,
      neighborhood: f.neighborhood ?? null,
      place,
      hasNbhd: !!nbhd?.lat,
    }
  }
  // A city's neighbourhood the gazetteer has no point for.
  expect(onlineLookups(target('град София, Лозенец'))).toEqual({
    settlement: null,
    hood: 'София|Лозенец',
  })
  // One it has: nothing to ask.
  expect(onlineLookups(target('град София, Симеоново'))).toEqual({
    settlement: null,
    hood: null,
  })
  // A village of the city's municipality is a place, not a neighbourhood.
  expect(onlineLookups(target('град София, с. Бистрица')).hood).toBeNull()
  // A name the gazetteer can't tell apart: the settlement, by its lookup key.
  expect(onlineLookups(target('област София, с. Костенец')).settlement).toMatch(
    /^София\|Костенец\|/,
  )
})
