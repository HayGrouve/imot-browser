import { describe, expect, test } from 'vitest'
import {
  invalidRange,
  moreCount,
  payloadOf,
  sanitizeQuery,
  SEARCH_QUERY,
} from './search-query'
import { parseSearchForm } from '../../shared/searchform'
import type { SearchForm } from '../../shared/searchform'
import { fixture } from '../../shared/fixtures'

describe('the search dialog query', () => {
  const sale: SearchForm = {
    deal: 'sale',
    ...parseSearchForm(fixture('search-form-sale.html')),
  }

  test('only the filters imot.bg shows for the chosen types are sent', () => {
    const q = {
      ...SEARCH_QUERY,
      types: ['2'], // 2-СТАЕН: no yard, no plot filters
      yardMin: '100',
      keyword: 'гараж',
      districts: ['Лозенец'],
      extras: { f62: 'Тухла' },
    }
    const p = payloadOf(q, sale)
    expect(p.yardMin).toBe('')
    expect(p.districts).toEqual([]) // no place chosen
    expect(p.extras).toEqual({ f62: 'Тухла' }) // construction applies to flats
    expect(moreCount(p)).toBe(2)
    const house = payloadOf({ ...q, types: ['10'] }, sale)
    expect(house.yardMin).toBe('100')
  })

  test('a "from" above its "to" is caught, with the field named', () => {
    expect(
      invalidRange({ ...SEARCH_QUERY, areaMin: '90', areaMax: '60' }),
    ).toEqual({
      field: 'areaMin',
      label: 'sfArea',
    })
    expect(
      invalidRange({
        ...SEARCH_QUERY,
        deal: 'rent',
        priceMin: '9',
        priceMax: '1',
      })?.label,
    ).toBe('sfRentPrice')
    expect(
      invalidRange({ ...SEARCH_QUERY, priceMin: '1', priceMax: '' }),
    ).toBeNull()
  })

  test('a saved query is cleaned of anything unexpected', () => {
    const q = sanitizeQuery({
      deal: 'swap',
      types: ['2', 3],
      extras: { f62: 'Тухла', f1: 5 },
      photoOnly: 'yes',
    })
    expect(q.deal).toBe('sale')
    expect(q.types).toEqual(['2'])
    expect(q.extras).toEqual({ f62: 'Тухла' })
    expect(q.photoOnly).toBe(false)
  })
})
