// "Export filtered as CSV": the listings in view, with their notes and stars.

import { transliterate } from '../../shared/text'
import { typeLabel } from '../../shared/vocab'
import type { StoredDetails } from '../../shared/listing'
import type { Listing } from './listings'

type Row = {
  l: Listing
  d: StoredDetails | null
  starred: boolean
  note: string | undefined
}

const COLUMNS: Array<[string, (r: Row) => unknown]> = [
  ['id', (r) => r.l.id],
  ['url', (r) => r.l.url],
  ['deal', (r) => r.l.deal],
  ['type', (r) => typeLabel(r.l.type ?? 'other', r.l.typeBg, 'en')],
  ['type_bg', (r) => r.l.typeBg],
  ['settlement', (r) => r.l.place?.name || r.l.settlement],
  [
    'settlement_en',
    (r) => r.l.place?.nameEn || transliterate(r.l.settlement || ''),
  ],
  ['municipality_town', (r) => (r.l.place?.municipality ? r.l.settlement : '')],
  ['neighborhood', (r) => r.l.nbhd?.name || r.l.neighborhood],
  ['address', (r) => r.l.address],
  ['oblast', (r) => r.l.oblast],
  ['price', (r) => r.l.price],
  ['currency', (r) => r.l.currency],
  ['price_eur', (r) => r.l.eur],
  ['price_per_m2_eur', (r) => r.l.ppm],
  ['area_m2', (r) => r.l.area],
  ['yard_m2', (r) => r.l.yard],
  ['floor', (r) => r.l.floor],
  ['year_from', (r) => r.l.yearFrom],
  ['year_to', (r) => r.l.yearTo],
  ['construction', (r) => r.l.material],
  ['status', (r) => r.l.status],
  ['heating', (r) => r.l.heating],
  ['features', (r) => (r.d?.features ?? []).join('; ')],
  ['agency', (r) => r.d?.agency?.name ?? r.l.agencyName],
  ['broker', (r) => r.d?.broker],
  ['phone', (r) => r.d?.phone],
  ['updated_on_imot_bg', (r) => r.l.updatedAt],
  ['first_seen', (r) => r.l.firstSeen],
  ['last_seen', (r) => r.l.lastSeen],
  ['no_longer_listed', (r) => (r.l.stale ? 'yes' : '')],
  ['lat', (r) => r.l.place?.lat],
  ['lon', (r) => r.l.place?.lon],
  ['location_precision', (r) => (r.l.place ? 'settlement' : 'none')],
  ['starred', (r) => (r.starred ? 'yes' : '')],
  ['note', (r) => r.note],
  ['description', (r) => r.d?.description],
]

const cell = (v: unknown) => {
  if (v == null) return ''
  const s = String(v)
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(rows: Array<Row>): string {
  return (
    '﻿' +
    [
      COLUMNS.map((c) => c[0]).join(','),
      ...rows.map((r) => COLUMNS.map((c) => cell(c[1](r))).join(',')),
    ].join('\r\n')
  )
}

export function download(text: string, name: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(
    new Blob([text], { type: 'text/csv;charset=utf-8' }),
  )
  a.download = name
  document.body.append(a)
  a.click()
  setTimeout(() => {
    URL.revokeObjectURL(a.href)
    a.remove()
  }, 1000)
}
