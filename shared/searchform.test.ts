import { expect, test } from 'vitest'
import {
  adaptQuery,
  buildSearchParams,
  builderResult,
  locationFormParams,
  parseSearchForm,
} from './searchform'
import type { SearchForm } from './searchform'
import { fixture } from './fixtures'

const SALE = fixture('search-form-sale.html')
const RENT_SOFIA = fixture('search-form-rent-sofia.html')

test('sales search form: types, places, floors, sort orders and extra filters', () => {
  const f = parseSearchForm(SALE)
  expect(f.types).toHaveLength(20)
  expect(f.types.find((t) => t.label === 'КЪЩА')).toEqual({
    id: '10',
    group: 3,
    label: 'КЪЩА',
  })
  expect(f.types.find((t) => t.label === '2-СТАЕН')).toEqual({
    id: '2',
    group: 1,
    label: '2-СТАЕН',
  })
  expect(f.sectionsByType['10']).toEqual(['areah', 'extritb', 'extri1'])
  expect(f.location).toBe('')
  expect(f.districts).toEqual([])
  expect(f.locations.some((l) => l.value === 'град София')).toBe(true)
  expect(
    f.locations.some(
      (l) => l.value === 'област София' && l.label === 'област София',
    ),
  ).toBe(true)
  expect(f.locations.some((l) => l.value === 'world')).toBe(false) // the worldwide site is not a location
  expect(f.floorsFrom.slice(0, 3)).toEqual([
    { value: '1000', label: 'Само последен' },
    { value: '0', label: 'Партер' },
    { value: '1', label: '1-ви' },
  ])
  expect(f.floorsTo[0].value).toBe('999')
  expect(f.sorts.map((s) => s.value)).toEqual(['1', '2', '3', '4', '5'])
  expect(f.currencies).toEqual(['EUR', '$'])
  expect(f.yearsFrom[0]).toBe('2040')
  expect(f.yearsFrom).not.toContain('0')
  expect(f.extras.extritb.checks.find((c) => c.value === 'Тухла')).toEqual({
    name: 'f62',
    value: 'Тухла',
    label: 'Тухла',
  })
  expect(f.extras.extritb.selects).toHaveLength(0) // year selects are fixed fields, not extras
  const tec = f.extras.extri1.selects.find((s) => s.name === 'f33')
  expect(tec?.label).toBe('ТЕЦ')
  expect(tec?.options.map((o) => o.value)).toEqual(['ДА', 'НЕ', 'ЛО', 'ПР'])
  expect(f.extras.extrip.selects.map((s) => s.label)).toEqual([
    'Ток',
    'Вода',
    'Регулация',
  ])
})

test('rentals search form for a city: own type ids, districts and feature fields', () => {
  const f = parseSearchForm(RENT_SOFIA)
  // Rentals number their types differently from sales (СТАЯ comes first).
  expect(f.types[0]).toEqual({ id: '1', group: 1, label: 'СТАЯ' })
  expect(f.types.find((t) => t.label === '2-СТАЕН')?.id).toBe('3')
  expect(f.location).toBe('град София')
  expect(f.districts.length).toBeGreaterThan(150)
  expect(f.districts).toContain('Лозенец')
  expect(f.extras.extritb.checks).toEqual([])
  // ...and reuse field names for different features.
  expect(f.extras.extri1.checks.find((c) => c.name === 'f67')?.value).toBe(
    'Обзаведен',
  )
  expect(f.sectionsByType['19']).toEqual(['extrip'])
})

test('search query -> imot.bg form fields', () => {
  const p = buildSearchParams({
    deal: 'rent',
    types: ['2', '3', 'x'],
    location: 'град София',
    districts: ['Лозенец', 'Белите брези', 'a+b'],
    priceMin: '300',
    priceMax: '1 200',
    currency: '$',
    areaMin: '45.5',
    ppmMin: '0',
    floorFrom: '0',
    floorTo: '999',
    sort: '5',
    keyword: '  гараж ',
    status: ['2'],
    yearFrom: '2000',
    yearTo: 'soon',
    extras: { f67: 'Обзаведен', f38: 'град Варна', act: '3', f33: 'ДА' },
    photoOnly: true,
    // @ts-expect-error a malformed value from an old saved query is ignored
    videoOnly: 'yes',
  })
  expect(p).toEqual({
    act: '15',
    actsrc: '3',
    rub: '2',
    f1: '1',
    f7: '2~3~',
    f38: 'град София',
    f40: 'Лозенец+Белите брези+',
    f28: '300',
    f29: '1200',
    f30: '$',
    f26: '45.5',
    f31: '0',
    f32: '999',
    f41: '5',
    f51: '2000',
    f42: 'гараж',
    f57: '2~3~',
    fe1: '1',
    f67: 'Обзаведен',
    f33: 'ДА',
  })
})

test('amounts: whole numbers except the area; number-input notation; nonsense dropped', () => {
  const p = buildSearchParams({
    priceMin: '1e5',
    priceMax: '250000.6',
    areaMin: '65.456',
    ppmMax: '-5',
    yardMin: 'lots',
    areaMax: '1e12',
  })
  expect(p.f28).toBe('100000')
  expect(p.f29).toBe('250001')
  expect(p.f26).toBe('65.46')
  expect(p.f44).toBeUndefined()
  expect(p.f45).toBeUndefined()
  expect(p.f27).toBeUndefined()
})

test('an empty query is a search of all sales; districts need a location', () => {
  expect(buildSearchParams({})).toEqual({
    act: '15',
    actsrc: '3',
    rub: '1',
    f1: '1',
  })
  expect(buildSearchParams({ districts: ['Лозенец'] }).f40).toBeUndefined()
  expect(buildSearchParams({ deal: 'swap' }).rub).toBe('1')
})

test('the link builder: a place form request, and only imot.bg answers are kept', () => {
  expect(locationFormParams('rent', 'град София')).toEqual({
    act: '15',
    actsrc: '2',
    rub: '2',
    f1: '1',
    f38: 'град София',
  })
  expect(
    builderResult('{"result":"//www.imot.bg/obiavi/prodazhbi/grad-sofiya"}'),
  ).toBe('https://www.imot.bg/obiavi/prodazhbi/grad-sofiya')
  expect(
    builderResult('{"showmsg":"Възникна грешка е41.","result":0}'),
  ).toBeNull()
  expect(builderResult('{"result":"//evil.example/obiavi/x"}')).toBeNull()
  expect(builderResult('<html>')).toBeNull()
})

test('switching deals keeps types and extra filters by their label', () => {
  const sale: SearchForm = { deal: 'sale', ...parseSearchForm(SALE) }
  const rent: SearchForm = { deal: 'rent', ...parseSearchForm(RENT_SOFIA) }
  const q = {
    deal: 'sale',
    types: ['2'],
    extras: { f62: 'Тухла' },
    location: 'град София',
    districts: ['Лозенец', 'Атлантида'],
    currency: 'EUR',
  }
  const next = adaptQuery(q, sale, rent)
  expect(next.deal).toBe('rent')
  expect(next.types).toEqual(['3']) // 2-СТАЕН in rentals
  expect(next.extras).toEqual({}) // rentals have no construction filter
  expect(next.districts).toEqual(['Лозенец'])
  expect(q.types).toEqual(['2']) // the input is left alone
})
