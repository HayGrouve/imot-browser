// Offline settlement lookup backed by lib/gazetteer-bg.json (GeoNames, CC BY 4.0).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { fuzzyKey, levenshtein } from '../shared/text.mjs';

// imot.bg oblast name -> GeoNames admin1 code.
export const OBLAST_ADMIN1 = {
  'Благоевград': '38', 'Бургас': '39', 'Добрич': '40', 'Габрово': '41', 'София-град': '42',
  'София град': '42', 'София (столица)': '42', 'Хасково': '43', 'Кърджали': '44', 'Кюстендил': '45',
  'Ловеч': '46', 'Монтана': '47', 'Пазарджик': '48', 'Перник': '49', 'Плевен': '50', 'Пловдив': '51',
  'Разград': '52', 'Русе': '53', 'Шумен': '54', 'Силистра': '55', 'Сливен': '56', 'Смолян': '57',
  'София': '58', 'Софийска': '58', 'Стара Загора': '59', 'Търговище': '60', 'Варна': '61',
  'Велико Търново': '62', 'Видин': '63', 'Враца': '64', 'Ямбол': '65',
};

// GeoNames admin1 code -> admin2 (municipality) code prefix. admin1 is occasionally
// wrong in GeoNames (e.g. Горни Окол filed under Razgrad), admin2 is more reliable.
const ADMIN2_PREFIX = {
  38: 'BLG', 39: 'BGS', 40: 'DOB', 41: 'GAB', 42: 'SOF', 43: 'HKV', 44: 'KRZ', 45: 'KNL', 46: 'LOV', 47: 'MON',
  48: 'PAZ', 49: 'PER', 50: 'PVN', 51: 'PDV', 52: 'RAZ', 53: 'RSE', 54: 'SHU', 55: 'SLS', 56: 'SLV', 57: 'SML',
  58: 'SFO', 59: 'SZR', 60: 'TGV', 61: 'VAR', 62: 'VTR', 63: 'VID', 64: 'VRC', 65: 'JAM',
};

const key = (s) => fuzzyKey(s).replace(/ /g, '');

const CODE_RANK = { PPLC: 6, PPLA: 5, PPLA2: 4, PPLA3: 3, PPL: 2, PPLL: 1, PPLW: 0, PPLX: -2, PPLQ: -5, PPLH: -5, PPLCH: -5 };

function score(row, kind) {
  const [, , , , , , , code, pop] = row;
  const rank = CODE_RANK[code] ?? 0;
  if (rank <= -5) return -1e12;
  if (code === 'PPLX') return -1e9 + pop;
  if (kind === 'village') {
    // Prefer genuine villages when a town of the same name exists in the oblast (e.g. с. Костенец vs гр. Костенец).
    return (code === 'PPL' || code === 'PPLL' ? 1e9 : 0) + pop;
  }
  if (kind === 'town' || kind === 'city') return rank * 1e8 + pop;
  return rank * 1e7 + pop;
}

export class Gazetteer {
  constructor(file = path.join(path.dirname(fileURLToPath(import.meta.url)), 'gazetteer-bg.json')) {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    this.attribution = data.attribution;
    this.rows = data.rows;
    this.byKey = new Map(); // fuzzyKey -> rows
    for (const row of this.rows) {
      const keys = new Set([key(row[1]), ...row[2].map(key)]);
      for (const k of keys) {
        if (!k) continue;
        if (!this.byKey.has(k)) this.byKey.set(k, []);
        this.byKey.get(k).push(row);
      }
    }
    this.cache = new Map();
  }

  /**
   * Resolve a settlement. Returns { lat, lon, geonameId, nameEn, nameBg, code, admin1, match } or null.
   * `kind` is the imot.bg settlement kind (city/town/village/other…), used to break ties.
   */
  resolve(name, oblast, kind) {
    if (!name) return null;
    const ck = `${name}|${oblast}|${kind}`;
    if (this.cache.has(ck)) return this.cache.get(ck);
    const res = this.#resolve(name, oblast, kind);
    this.cache.set(ck, res);
    return res;
  }

  #resolve(name, oblast, kind) {
    const admin1 = oblast ? OBLAST_ADMIN1[oblast] ?? null : null;
    const clean = name.replace(/^(гр\.|с\.)\s*/i, '').replace(/\s*\(.*\)\s*$/, '').trim();
    const k = key(clean);
    if (!k) return null;
    const prefix = admin1 && ADMIN2_PREFIX[admin1];
    const inOblast = (rows) => (admin1 ? rows.filter((r) => r[5] === admin1 || (r[6] && r[6].startsWith(prefix))) : rows);

    let match = 'exact';
    let cands = inOblast(this.byKey.get(k) || []);
    // The capital oblast and Sofia oblast are often mixed up in listings.
    if (!cands.length && (admin1 === '42' || admin1 === '58')) {
      cands = (this.byKey.get(k) || []).filter((r) => ['42', '58'].includes(r[5]) || /^(SOF|SFO)/.test(r[6]));
    }
    if (!cands.length && k.length >= 5) {
      // One-letter spelling variants within the same oblast (Гуцал/Gutzal). The first letter must
      // agree so that Горни/Долни (upper/lower) pairs never match each other.
      let bestRows = [];
      for (const [kk, rows] of this.byKey) {
        if (kk[0] !== k[0] || Math.abs(kk.length - k.length) > 1) continue;
        const rs = inOblast(rows);
        if (rs.length && levenshtein(kk, k, 1) <= 1) bestRows = bestRows.concat(rs);
      }
      if (new Set(bestRows.map((r) => r[0])).size === 1) { cands = bestRows; match = 'fuzzy'; }
    }
    if (!cands.length && !admin1) { cands = this.byKey.get(k) || []; match = 'anyOblast'; }
    if (!cands.length) return null;
    const ranked = [...cands].sort((a, b) => score(b, kind) - score(a, kind));
    const best = ranked[0];
    if (score(best, kind) <= -1e12) return null;
    // Two equally ranked places with the same name far apart (гр./с. Костенец): flag it so the
    // online geocoder can disambiguate by place type.
    const tie = ranked[1] && score(ranked[1], kind) === score(best, kind)
      && (Math.abs(ranked[1][3] - best[3]) + Math.abs(ranked[1][4] - best[4]) > 0.03);
    const [geonameId, nameEn, bg, lat, lon, adm1, , code] = best;
    return {
      lat, lon, geonameId, nameEn, nameBg: bg.find((n) => key(n) === k) || bg[0] || clean, code, admin1: adm1,
      match: tie ? 'ambiguous' : match,
    };
  }
}
