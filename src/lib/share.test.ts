import { describe, expect, test } from 'vitest'
import { DEFAULT_FILTERS } from './listings'
import { decodeView, encodeView } from './share'
import type { SharedView } from './share'

const VIEW: SharedView = {
  shown: ['https://www.imot.bg/obiavi/prodazhbi/grad-sofiya?raion=Лозенец'],
  filters: {
    ...DEFAULT_FILTERS,
    q: 'тераса',
    type: 'apartment-2',
    priceMax: 250000,
    hideStale: true,
    drawnArea: [
      [42.123456789, 23.987654321],
      [42.2, 23.9],
      [42.1, 23.8],
    ],
  },
  sort: { key: 'ppm', dir: 1 },
  hidden: ['1j177909167696419'],
  stars: ['1a170000000000001', '1b170000000000002'],
  area: {
    urls: ['https://www.imot.bg/a', 'https://www.imot.bg/b'],
    area: [
      [42.1, 23.8],
      [42.2, 23.9],
      [42.3, 23.7],
    ],
  },
}

describe('shared view', () => {
  test('round-trips through a URL-safe link parameter', () => {
    const text = encodeView(VIEW)
    expect(text).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(decodeView(text)).toEqual({
      ...VIEW,
      filters: {
        ...VIEW.filters,
        drawnArea: [
          [42.12346, 23.98765],
          [42.2, 23.9],
          [42.1, 23.8],
        ],
      },
    })
  })

  test('every search, no filters', () => {
    const view = { ...VIEW, shown: null, filters: DEFAULT_FILTERS, area: null }
    expect(decodeView(encodeView(view))).toEqual(view)
  })

  test('a clean map stays clean', () => {
    expect(decodeView(encodeView({ ...VIEW, shown: [] }))?.shown).toEqual([])
  })

  test('drops what does not read', () => {
    expect(decodeView(null)).toBeNull()
    expect(decodeView('not base64!')).toBeNull()
    const json = JSON.stringify({
      shown: 'x',
      filters: { priceMin: '5', starred: 'yes', place: 3, deal: 'rent' },
      sort: { key: 'nope', dir: 1 },
      hidden: ['ok1', '<script>', 7],
      area: { urls: [], area: [] },
    })
    const text = btoa(json).replace(/=+$/, '')
    expect(decodeView(text)).toEqual({
      shown: null,
      filters: { ...DEFAULT_FILTERS, deal: 'rent' },
      sort: { key: 'price', dir: 1 },
      hidden: ['ok1'],
      stars: [],
      area: null,
    })
  })
})
