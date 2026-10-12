import { describe, expect, test } from 'vitest'
import { MAX_AREA_SEARCHES, insidePolygon, planArea, validArea } from './area'
import type { DistrictsData, DrawnArea } from './area'
import districtsData from './districts-bg.json'

// A box around Sofia's south: Lozenets and Hipodruma, clear of the city's centre.
const SOUTH: DrawnArea = [
  [42.68, 23.29],
  [42.68, 23.34],
  [42.66, 23.34],
  [42.66, 23.29],
]

const DATA: DistrictsData = {
  attribution: '',
  locations: {
    'град София': [
      ['Лозенец', 42.67, 23.33],
      ['Център', 42.6975, 23.3242],
      ['Хиподрума', 42.675, 23.295],
      ['Зона Б-5-3', null, null],
    ],
    'област София': [
      ['гр. Своге', 42.96667, 23.35],
      ['с. Бов', 43.01, 23.36],
    ],
  },
}

describe('area search', () => {
  test('a point is inside by the even-odd rule, like the drawn fill', () => {
    expect(insidePolygon(42.67, 23.33, SOUTH)).toBe(true)
    expect(insidePolygon(42.67, 23.37, SOUTH)).toBe(false)
    // A stroke that crosses itself: two triangles meeting at a point, and nothing beside it.
    const bow: DrawnArea = [
      [0, 0],
      [2, 2],
      [2, 0],
      [0, 2],
    ]
    expect(insidePolygon(1.9, 1, bow)).toBe(true)
    expect(insidePolygon(1, 0.2, bow)).toBe(false)
  })

  test('per place, the districts whose point is inside; unplaced ones are counted, not searched', () => {
    const plan = planArea(SOUTH, DATA)
    expect(plan.places).toEqual([
      {
        location: 'град София',
        districts: ['Лозенец', 'Хиподрума'],
        total: 4,
        unplaced: 1,
      },
    ])
    expect(plan.searches).toEqual([
      { location: 'град София', districts: ['Лозенец', 'Хиподрума'] },
    ])
  })

  test('every placed district inside still lists them, so the unplaced stay out', () => {
    const all: DrawnArea = [
      [43.1, 23.2],
      [43.1, 23.5],
      [42.6, 23.5],
      [42.6, 23.2],
    ]
    const plan = planArea(all, DATA)
    expect(plan.searches).toEqual([
      {
        location: 'град София',
        districts: ['Лозенец', 'Център', 'Хиподрума'],
      },
      { location: 'област София', districts: ['гр. Своге', 'с. Бов'] },
    ])
  })

  test('a place with more districts inside than one search takes is searched in parts', () => {
    const big: DrawnArea = [
      [43.1, 23.2],
      [43.1, 23.5],
      [42.6, 23.5],
      [42.6, 23.2],
    ]
    expect(
      planArea(big, DATA, 2).searches.map((s) => [s.location, s.districts]),
    ).toEqual([
      ['град София', ['Лозенец', 'Център']],
      ['град София', ['Хиподрума']],
      ['област София', ['гр. Своге', 'с. Бов']],
    ])
  })

  test('an area with no district centre inside plans nothing', () => {
    const sea: DrawnArea = [
      [43.2, 28.5],
      [43.2, 28.6],
      [43.1, 28.6],
    ]
    expect(planArea(sea, DATA)).toEqual({ places: [], searches: [] })
  })

  test('only a polygon near Bulgaria is searched', () => {
    expect(validArea(SOUTH)).toEqual(SOUTH)
    expect(validArea(SOUTH.slice(0, 2))).toBeNull()
    expect(
      validArea([
        [48.85, 2.35],
        [48.9, 2.4],
        [48.8, 2.4],
      ]),
    ).toBeNull()
    expect(validArea([...SOUTH, [42.6, Number.NaN]])).toBeNull()
    expect(
      validArea(Array.from({ length: 501 }, (_, i) => [42 + i / 1e4, 23])),
    ).toBeNull()
    expect(validArea('nope')).toBeNull()
  })

  test('the real data: Lozenets and Mladost are in boxes around them, and every place has its districts', () => {
    const data = districtsData as unknown as DistrictsData
    expect(Object.keys(data.locations)).toHaveLength(54)
    const sofia = data.locations['град София']
    expect(sofia.length).toBeGreaterThan(150)
    expect(sofia.filter((r) => r[1] != null).length).toBeGreaterThan(
      sofia.length * 0.75,
    )
    const box = (s: number, w: number, n: number, e: number): DrawnArea => [
      [n, w],
      [n, e],
      [s, e],
      [s, w],
    ]
    const mladost = planArea(box(42.638, 23.36, 42.665, 23.392), data)
    expect(mladost.places.map((p) => p.location)).toEqual(['град София'])
    expect(mladost.places[0].districts).toEqual(
      expect.arrayContaining(['Младост 1', 'Младост 2', 'Младост 3']),
    )
    expect(
      planArea(box(42.665, 23.31, 42.685, 23.34), data).places[0].districts,
    ).toContain('Лозенец')
    // The whole country is far more than one import.
    const bg: DrawnArea = [
      [44.3, 22.3],
      [44.3, 28.7],
      [41.2, 28.7],
      [41.2, 22.3],
    ]
    expect(planArea(bg, data).searches.length).toBeGreaterThan(
      MAX_AREA_SEARCHES,
    )
  })
})
