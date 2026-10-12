import { describe, expect, test } from 'vitest'
import {
  bigPhotoUrl,
  classifyUrl,
  fieldsFromParams,
  getPriceRange,
  parseBgDate,
  parseConstruction,
  parseDetailPage,
  parseInfoLine,
  parseLocation,
  parseSearchPage,
  searchPageUrl,
  withPriceRange,
} from './parse'
import type { ListingFields } from './types'
import { mergeDetail, needsDetails, splitRange } from './importer'
import { searchKey, transliterate } from './text'
import { classifyTitle } from './vocab'
import { fixture } from './fixtures'

const detail = (html: string) => {
  const d = parseDetailPage(html)
  if (!d || d.gone) throw new Error('expected a listing page')
  return d
}

describe('links', () => {
  test('session-bound plnk parameter is stripped from search links', () => {
    const r = classifyUrl(
      'https://www.imot.bg/obiavi/prodazhbi/oblast-sofiya/kashta?price_min=55000&price_max=185000&plnk=625984',
    )
    expect(r.kind).toBe('search')
    expect(r.url).toBe(
      'https://www.imot.bg/obiavi/prodazhbi/oblast-sofiya/kashta?price_min=55000&price_max=185000',
    )
    expect(r.notes).toEqual(['removed:plnk'])
  })

  test('link classification', () => {
    expect(
      classifyUrl('imot.bg/obiava-1j177909167696419-prodava-kashta').kind,
    ).toBe('listing')
    expect(
      classifyUrl('imot.bg/obiava-1j177909167696419-prodava-kashta').id,
    ).toBe('1j177909167696419')
    expect(
      classifyUrl(
        'https://www.imot.bg/pcgi/imot.cgi?act=5&adv=1a176916093559927',
      ).id,
    ).toBe('1a176916093559927')
    const mobile = classifyUrl(
      'https://m.imot.bg/obiavi/naemi/grad-plovdiv/p-3',
    )
    expect(mobile.url).toBe('https://www.imot.bg/obiavi/naemi/grad-plovdiv')
    expect(
      classifyUrl('https://www.imot.bg/pcgi/imot.cgi?act=3&slink=abc').notes,
    ).toEqual(['legacySessionSearch'])
    expect(
      classifyUrl('https://www.imot.bg/obiava-8739-zhilishten-kompleks').notes,
    ).toEqual(['newBuildingAd'])
    expect(classifyUrl('https://example.com/obiavi/x').notes).toEqual([
      'notImotBg',
    ])
  })

  test('pagination and price-band URL helpers', () => {
    const base =
      'https://www.imot.bg/obiavi/prodazhbi/oblast-sofiya/kashta?price_min=55000&price_max=185000'
    expect(searchPageUrl(base, 3)).toBe(
      'https://www.imot.bg/obiavi/prodazhbi/oblast-sofiya/kashta/p-3?price_min=55000&price_max=185000',
    )
    expect(searchPageUrl(base, 1)).toBe(base)
    expect(getPriceRange(base)).toEqual({ min: 55000, max: 185000 })
    expect(withPriceRange(base, 55000, 120000)).toBe(
      'https://www.imot.bg/obiavi/prodazhbi/oblast-sofiya/kashta?price_min=55000&price_max=120000',
    )
    expect(withPriceRange(base, 120000, null)).toBe(
      'https://www.imot.bg/obiavi/prodazhbi/oblast-sofiya/kashta?price_min=120000',
    )
  })

  test('splitRange halves closed bands and grows open ones', () => {
    expect(splitRange(0, 100)).toEqual([
      [0, 50],
      [50, 100],
    ])
    expect(splitRange(0, null)).toEqual([
      [0, 100000],
      [100000, null],
    ])
    expect(splitRange(200000, null)).toEqual([
      [200000, 400000],
      [400000, null],
    ])
    expect(splitRange(10, 11)).toBeNull()
  })
})

describe('search pages', () => {
  test('totals, cards and fields', () => {
    const page = parseSearchPage(fixture('search-page.html'))
    expect(page.total).toBe(539)
    expect(page.capped).toBe(false)
    expect(page.items).toHaveLength(40)
    expect(page.hasNext).toBe(true)
    expect(page.paramsText).toMatch(/КЪЩА/)
    for (const item of page.items) {
      expect(item.id).toMatch(/^\d[a-z]\d+$/)
      expect(item.url).toMatch(/^https:\/\/www\.imot\.bg\/obiava-/)
      expect(item.type).toBe('house')
      expect(item.deal).toBe('sale')
      expect(item.price).toBeGreaterThan(0)
      expect(item.currency).toBe('EUR')
      expect(item.area).toBeGreaterThan(0)
      expect(item.oblast).toBe('София')
      expect(item.settlement).toBeTruthy()
    }
    const godech = page.items.find((i) => i.id === '1j179135523412065')
    expect(godech?.settlement).toBe('Годеч')
    expect(godech?.settlementKind).toBe('town')
    expect(godech?.yard).toBe(540)
    expect(godech?.yearFrom).toBe(1970)
    expect(godech?.agency?.name).toBe('ИМОТИ ВАСИЛЕВ ТМ')
    expect(godech?.promo).toBe('TOP')
  })

  test('last page and over-limit page', () => {
    const last = parseSearchPage(fixture('search-last-page.html'))
    expect(last.items).toHaveLength(19)
    expect(last.hasNext).toBe(false)
    expect(last.to).toBe(539)
    const over = parseSearchPage(fixture('search-over-limit.html'))
    expect(over.capped).toBe(true)
    expect(over.overLimit).toBe(true)
    expect(over.items).toHaveLength(0)
  })

  test('photos on the cdn3.focus.bg host are picked up too', () => {
    const card = `<div class="item VIP " id="ida1b178092205889992"><div class="photo"><div class="big"><a href="//www.imot.bg/obiava-1b178092205889992-x" class="image saveSlink"><img src="//cdn3.focus.bg/imot/photosimotbg/1/992/1b178092205889992_3s.jpg" class="pic"></a></div></div>
<div class="text"><div class="zaglavie"><a href="//www.imot.bg/obiava-1b178092205889992-x" class="title saveSlink">Продава 2-СТАЕН<location>град София, с. Бистрица</location></a><div class="price "><div>99 000 €</div></div><div class="like"></div></div><div class="info">60 кв.м</div></div></div>`
    const [item] = parseSearchPage(card).items
    expect(item.thumb).toBe(
      'https://cdn3.focus.bg/imot/photosimotbg/1/992/1b178092205889992_3s.jpg',
    )
    expect(item.photos?.[0]).toBe(
      'https://cdn3.focus.bg/imot/photosimotbg/1/992/big1/1b178092205889992_3s.jpg',
    )
    const d =
      detail(`<div class="obTitle"><h1>Продава 2-СТАЕН <div>град София, с. Бистрица</div><span>Обява: 1b178092205889992</span></h1></div>
<img src="//cdn3.focus.bg/imot/photosimotbg/1/992//big/1b178092205889992_3s.jpg"><img src="//cdn3.focus.bg/imot/photosimotbg/1/992/1b178092205889992_iY.jpg">`)
    expect(d.photos).toEqual([
      'https://cdn3.focus.bg/imot/photosimotbg/1/992/big1/1b178092205889992_3s.jpg',
      'https://cdn3.focus.bg/imot/photosimotbg/1/992/big1/1b178092205889992_iY.jpg',
    ])
  })
})

describe('detail pages', () => {
  test('fields', () => {
    const d = detail(fixture('detail-page.html'))
    expect(d.id).toBe('1j177909167696419')
    expect(d.price).toBe(66000)
    expect(d.pricePerM2).toBe(1015)
    expect(d.area).toBe(65)
    expect(d.yard).toBe(2765)
    expect(d.material).toBe('Тухла')
    expect(d.status).toBe('completed')
    expect(d.yearFrom).toBe(1970)
    expect(d.updatedAt).toBe('2026-10-11T14:35')
    expect(d.views).toBe(539)
    expect(d.broker).toBe('Благовест Балдев')
    expect(d.agency?.name).toBe('СОФИЯ ИМОТИ')
    expect(d.phone).toBe('0889866507')
    expect(d.photos).toHaveLength(12)
    expect(d.photos?.every((p) => p.includes('/big1/1j177909167696419_'))).toBe(
      true,
    )
    expect(d.description).toMatch(/старопланинското селце Бов/)
    expect(d.features).toEqual(['Тухла'])
    expect(d.settlement).toBe('Гара Бов')
  })

  test('photos: .pic files and a photo prefix that differs from the listing ID', () => {
    const page = (id: string, imgs: string) =>
      `<div class="obTitle"><h1>Продава КЪЩА <div>област София, с. Свидня</div><span>Обява: ${id}</span></h1></div>${imgs}`
    const pic = detail(
      page(
        '1j143101552165902',
        '<img src="//imotstatic2.focus.bg/imot/photosimotbg/1/902//big/1j143101552165902_4.pic"><img src="//cdn3.focus.bg/imot/photosimotbg/1/023/1j178421042948023_JU.jpg">',
      ),
    )
    expect(pic.photos).toEqual([
      'https://imotstatic2.focus.bg/imot/photosimotbg/1/902/big/1j143101552165902_4.pic',
    ])
    const prefix = detail(
      page(
        '1j178264425726187',
        '<img src="//cdn3.focus.bg/imot/photosimotbg/1/187/1k178264425726187_1n.jpg">',
      ),
    )
    expect(prefix.photos).toEqual([
      'https://cdn3.focus.bg/imot/photosimotbg/1/187/big1/1k178264425726187_1n.jpg',
    ])
  })

  test('a removed listing reads as gone', () => {
    expect(parseDetailPage('<p>Страницата не е намерена</p>')).toEqual({
      gone: true,
    })
    expect(parseDetailPage('<p>something else</p>')).toBeNull()
  })
})

describe('fields', () => {
  test('locations in card, detail and big-city formats', () => {
    expect(parseLocation('гр. Своге, област София')).toEqual({
      oblast: 'София',
      settlement: 'Своге',
      settlementKind: 'town',
      neighborhood: null,
    })
    expect(parseLocation('област София, Гара Бов')).toEqual({
      oblast: 'София',
      settlement: 'Гара Бов',
      settlementKind: 'other',
      neighborhood: null,
    })
    expect(parseLocation('град София, Дружба 2')).toEqual({
      oblast: 'София-град',
      settlement: 'София',
      settlementKind: 'city',
      neighborhood: 'Дружба 2',
    })
    expect(parseLocation('град Пловдив, Каменица 1')).toEqual({
      oblast: 'Пловдив',
      settlement: 'Пловдив',
      settlementKind: 'city',
      neighborhood: 'Каменица 1',
    })
    expect(parseLocation('м-т Мечката, област София').settlementKind).toBe(
      'locality',
    )
  })

  test('info line: structured prefix, description and phone', () => {
    const r = parseInfoLine(
      '180 кв.м, двор 750 кв.м, с.Лопян, 2 ет. от 2, Лок.отопл., Въведен в експлоатация 2015 г., Тухла, Обзаведен ..., тел.: 0889195472',
    )
    expect(r.area).toBe(180)
    expect(r.yard).toBe(750)
    expect(r.phone).toBe('0889195472')
    expect(r.description).toMatch(/с\.Лопян/)
    const apt = parseInfoLine(
      '66 кв.м, 3-ти ет. от 5, Газ, Въведен в експлоатация 2026 г., Готова сграда с Акт 16 ...',
    )
    expect(apt.floorNum).toBe(3)
    expect(apt.floorsTotal).toBe(5)
    expect(apt.heating).toBe('Газ')
    expect(apt.yearTo).toBe(2026)
  })

  test('parameter grid: empty yard is not read from the "m2" unit', () => {
    const f = fieldsFromParams({
      Площ: '90 m2',
      Двор: '--- m2',
      ТЕЦ: 'Лок.отопл.',
      Строителство: 'Тухла, 1950 - 1959 г.',
    })
    expect(f.area).toBe(90)
    expect(f.yard).toBeNull()
    expect(f.heating).toBe('Лок.отопл.')
    expect(f.yearFrom).toBe(1950)
    expect(f.yearTo).toBe(1959)
    expect(
      parseConstruction('Сглобяема конструкция, Въведен в експлоатация')
        .material,
    ).toBe('Сглобяема конструкция')
  })

  test('mergeDetail keeps the structured card location', () => {
    const merged = mergeDetail(
      {
        id: 'x',
        title: 'Продава КЪЩА',
        settlement: 'Етрополе',
        settlementKind: 'town',
        price: 1,
      },
      {
        settlement: 'Етрополе',
        settlementKind: 'town',
        address: 'с.Лопян',
        price: 2,
        agency: null,
      },
    )
    expect(merged.address).toBe('с.Лопян')
    expect(merged.price).toBe(2)
    expect(merged.settlementKind).toBe('town')
  })

  test('needsDetails: new, repriced, photo-less and stale listings are re-read', () => {
    const now = '2026-10-12T10:00:00.000Z'
    const card: ListingFields = { id: 'x', price: 100, photoCount: 4 }
    const opts = { manual: false, details: true, now }
    const fresh = {
      price: 100,
      detailsFetchedAt: '2026-10-11T10:00:00.000Z',
      photosStored: 4,
    }
    expect(needsDetails(card, null, opts)).toBe(true)
    expect(needsDetails(card, fresh, opts)).toBe(false)
    expect(needsDetails({ ...card, price: 90 }, fresh, opts)).toBe(true)
    expect(needsDetails(card, { ...fresh, photosStored: 0 }, opts)).toBe(true)
    expect(
      needsDetails(
        card,
        { ...fresh, detailsFetchedAt: '2026-10-01T10:00:00.000Z' },
        opts,
      ),
    ).toBe(true)
    expect(needsDetails(card, null, { ...opts, details: false })).toBe(false)
    expect(
      needsDetails(card, fresh, { ...opts, details: false, manual: true }),
    ).toBe(true)
  })

  test('misc helpers', () => {
    expect(parseBgDate('Публикувана в 9:05 на 1 септември, 2026 год.')).toBe(
      '2026-09-01T09:05',
    )
    expect(
      bigPhotoUrl(
        'https://imotstatic3.focus.bg/imot/photosimotbg/1/419/1j1_uW.jpg',
      ),
    ).toBe(
      'https://imotstatic3.focus.bg/imot/photosimotbg/1/419/big1/1j1_uW.jpg',
    )
    expect(
      bigPhotoUrl(
        'https://imotstatic3.focus.bg/imot/photosimotbg/1/419//big1/1j1_uW.jpg',
      ),
    ).toBe(
      'https://imotstatic3.focus.bg/imot/photosimotbg/1/419/big1/1j1_uW.jpg',
    )
    // Older ads: ".pic" files, large size under /big/ (big1 is 404 for these).
    expect(
      bigPhotoUrl(
        'https://imotstatic2.focus.bg/imot/photosimotbg/1/902//big/1j143101552165902_4.pic',
      ),
    ).toBe(
      'https://imotstatic2.focus.bg/imot/photosimotbg/1/902/big/1j143101552165902_4.pic',
    )
    expect(
      bigPhotoUrl(
        'https://imotstatic2.focus.bg/imot/photosimotbg/1/902/1j143101552165902_4.pic',
      ),
    ).toBe(
      'https://imotstatic2.focus.bg/imot/photosimotbg/1/902/big/1j143101552165902_4.pic',
    )
    expect(transliterate('София')).toBe('Sofia')
    expect(transliterate('Гълъбовци')).toBe('Galabovtsi')
    expect(transliterate('Щъркелово')).toBe('Shtarkelovo')
    expect(searchKey('Бов')).toBe(searchKey('bov'))
    expect(classifyTitle('Дава под Наем 2-СТАЕН')).toEqual({
      deal: 'rent',
      type: 'apt2',
      typeBg: '2-СТАЕН',
    })
  })
})
