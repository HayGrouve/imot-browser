import { expect, test } from 'vitest'
import { Gazetteer } from './gazetteer'
import type { GazetteerData } from './gazetteer'
import { geocodeNeighborhood } from './geocode'
import type { NominatimHit } from './geocode'
import { locateOffline, settleLocation } from './importer'
import { parseLocation } from './parse'
import data from './gazetteer-bg.json'

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
