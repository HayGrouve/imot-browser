// Offline settlement lookup backed by gazetteer-bg.json (GeoNames, CC BY 4.0).

import { fuzzyKey, levenshtein } from './text'

/** [geonameId, nameEn, bgNames, lat, lon, admin1, admin2, featureCode, population] */
export type GazetteerRow = [
  number,
  string,
  Array<string>,
  number,
  number,
  string,
  string,
  string,
  number,
]

export interface GazetteerData {
  attribution: string
  rows: Array<GazetteerRow>
}

export interface Resolved {
  lat: number
  lon: number
  geonameId: number
  nameEn: string
  nameBg: string
  code: string
  admin1: string
  /** The municipality, e.g. "SOF46" (Столична); may be empty. */
  admin2: string
  match: 'exact' | 'fuzzy' | 'anyOblast' | 'ambiguous'
}

// imot.bg oblast name -> GeoNames admin1 code.
const OBLAST_ADMIN1: Record<string, string> = {
  Благоевград: '38',
  Бургас: '39',
  Добрич: '40',
  Габрово: '41',
  'София-град': '42',
  'София град': '42',
  'София (столица)': '42',
  Хасково: '43',
  Кърджали: '44',
  Кюстендил: '45',
  Ловеч: '46',
  Монтана: '47',
  Пазарджик: '48',
  Перник: '49',
  Плевен: '50',
  Пловдив: '51',
  Разград: '52',
  Русе: '53',
  Шумен: '54',
  Силистра: '55',
  Сливен: '56',
  Смолян: '57',
  София: '58',
  Софийска: '58',
  'Стара Загора': '59',
  Търговище: '60',
  Варна: '61',
  'Велико Търново': '62',
  Видин: '63',
  Враца: '64',
  Ямбол: '65',
}

// GeoNames admin1 code -> admin2 (municipality) code prefix. admin1 is occasionally
// wrong in GeoNames (e.g. Горни Окол filed under Razgrad), admin2 is more reliable.
const ADMIN2_PREFIX: Record<string, string> = {
  38: 'BLG',
  39: 'BGS',
  40: 'DOB',
  41: 'GAB',
  42: 'SOF',
  43: 'HKV',
  44: 'KRZ',
  45: 'KNL',
  46: 'LOV',
  47: 'MON',
  48: 'PAZ',
  49: 'PER',
  50: 'PVN',
  51: 'PDV',
  52: 'RAZ',
  53: 'RSE',
  54: 'SHU',
  55: 'SLS',
  56: 'SLV',
  57: 'SML',
  58: 'SFO',
  59: 'SZR',
  60: 'TGV',
  61: 'VAR',
  62: 'VTR',
  63: 'VID',
  64: 'VRC',
  65: 'JAM',
}

const key = (s: string) => fuzzyKey(s).replace(/ /g, '')

const CODE_RANK: Record<string, number> = {
  PPLC: 6,
  PPLA: 5,
  PPLA2: 4,
  PPLA3: 3,
  PPL: 2,
  PPLL: 1,
  PPLW: 0,
  PPLX: -2,
  PPLQ: -5,
  PPLH: -5,
  PPLCH: -5,
}

function score(row: GazetteerRow, kind: string | null | undefined): number {
  const code = row[7]
  const pop = row[8]
  const rank = (CODE_RANK[code] as number | undefined) ?? 0
  if (rank <= -5) return -1e12
  if (code === 'PPLX') return -1e9 + pop
  if (kind === 'village') {
    // Prefer genuine villages when a town of the same name exists in the oblast (e.g. с. Костенец vs гр. Костенец).
    return (code === 'PPL' || code === 'PPLL' ? 1e9 : 0) + pop
  }
  if (kind === 'town' || kind === 'city') return rank * 1e8 + pop
  return rank * 1e7 + pop
}

export class Gazetteer {
  readonly attribution: string
  private byKey = new Map<string, Array<GazetteerRow>>()
  private cache = new Map<string, Resolved | null>()

  constructor(data: GazetteerData) {
    this.attribution = data.attribution
    for (const row of data.rows) {
      const keys = new Set([key(row[1]), ...row[2].map(key)])
      for (const k of keys) {
        if (!k) continue
        const list = this.byKey.get(k)
        if (list) list.push(row)
        else this.byKey.set(k, [row])
      }
    }
  }

  /**
   * Resolve a settlement. `kind` is the imot.bg settlement kind (city/town/village/other…),
   * used to break ties.
   */
  resolve(
    name: string | null | undefined,
    oblast: string | null | undefined,
    kind: string | null | undefined,
  ): Resolved | null {
    if (!name) return null
    const ck = `${name}|${oblast}|${kind}`
    const hit = this.cache.get(ck)
    if (hit !== undefined) return hit
    const res = this.find(name, oblast, kind)
    this.cache.set(ck, res)
    return res
  }

  private find(
    name: string,
    oblast: string | null | undefined,
    kind: string | null | undefined,
  ): Resolved | null {
    const admin1 = oblast ? (OBLAST_ADMIN1[oblast] ?? null) : null
    const clean = name
      .replace(/^(гр\.|с\.)\s*/i, '')
      .replace(/\s*\(.*\)\s*$/, '')
      .trim()
    const k = key(clean)
    if (!k) return null
    const prefix = admin1 ? ADMIN2_PREFIX[admin1] : undefined
    const inOblast = (rows: Array<GazetteerRow>) =>
      admin1
        ? rows.filter(
            (r) =>
              r[5] === admin1 || (prefix && r[6] && r[6].startsWith(prefix)),
          )
        : rows

    let match: Resolved['match'] = 'exact'
    let cands = inOblast(this.byKey.get(k) ?? [])
    // The capital oblast and Sofia oblast are often mixed up in listings.
    if (!cands.length && (admin1 === '42' || admin1 === '58')) {
      cands = (this.byKey.get(k) ?? []).filter(
        (r) => ['42', '58'].includes(r[5]) || /^(SOF|SFO)/.test(r[6]),
      )
    }
    if (!cands.length && k.length >= 5) {
      // One-letter spelling variants within the same oblast (Гуцал/Gutzal). The first letter must
      // agree so that Горни/Долни (upper/lower) pairs never match each other.
      let bestRows: Array<GazetteerRow> = []
      for (const [kk, rows] of this.byKey) {
        if (kk[0] !== k[0] || Math.abs(kk.length - k.length) > 1) continue
        const rs = inOblast(rows)
        if (rs.length && levenshtein(kk, k, 1) <= 1)
          bestRows = bestRows.concat(rs)
      }
      if (new Set(bestRows.map((r) => r[0])).size === 1) {
        cands = bestRows
        match = 'fuzzy'
      }
    }
    if (!cands.length && !admin1) {
      cands = this.byKey.get(k) ?? []
      match = 'anyOblast'
    }
    if (!cands.length) return null
    const ranked = [...cands].sort((a, b) => score(b, kind) - score(a, kind))
    const best = ranked[0]
    if (score(best, kind) <= -1e12) return null
    // Two equally ranked places with the same name far apart (гр./с. Костенец): flag it so the
    // online geocoder can disambiguate by place type.
    const second = ranked[1] as GazetteerRow | undefined
    const tie =
      second &&
      score(second, kind) === score(best, kind) &&
      Math.abs(second[3] - best[3]) + Math.abs(second[4] - best[4]) > 0.03
    const [geonameId, nameEn, bg, lat, lon, adm1, adm2, code] = best
    return {
      lat,
      lon,
      geonameId,
      nameEn,
      nameBg: bg.find((n) => key(n) === k) || bg[0] || clean,
      code,
      admin1: adm1,
      admin2: adm2,
      match: tie ? 'ambiguous' : match,
    }
  }
}
