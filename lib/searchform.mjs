// imot.bg's own search form, mirrored: the option lists (property types, places, districts,
// floors, sort orders, extra filters) are read from the live form, and a filled-in query is
// turned into a search link by imot.bg's own link builder, the same request its "ТЪРСИ"
// button makes. Option ids differ between sales and rentals, so nothing here is hard-coded
// except the names of the fixed form fields.

import { decodeEntities, parseNumber } from '../shared/text.mjs';
import { classifyUrl, divInner } from './parse.mjs';
import { Fetcher } from './http.mjs';

const BASE = 'https://www.imot.bg';
const BUILDER_URL = `${BASE}/pcgi/subscript.cgi`;

export const SEARCH_DEALS = { sale: { rub: '1', path: 'prodazhbi' }, rent: { rub: '2', path: 'naemi' } };

// Fixed fields of <form name="search"> on imot.bg.
const F = {
  types: 'f7', location: 'f38', districts: 'f40', sort: 'f41', keyword: 'f42',
  priceMin: 'f28', priceMax: 'f29', currency: 'f30', ppmMin: 'f43', ppmMax: 'f44',
  areaMin: 'f26', areaMax: 'f27', yardMin: 'f45', yardMax: 'f46', floorFrom: 'f31', floorTo: 'f32',
  status: 'f57', yearFrom: 'f51', yearTo: 'f52', photoOnly: 'fe1', videoOnly: 'fe9',
};
const FIXED = new Set(Object.values(F));
// imot.bg takes whole numbers, except for the area (its inputs allow "65.5").
const AMOUNTS = { priceMin: 0, priceMax: 0, ppmMin: 0, ppmMax: 0, areaMin: 2, areaMax: 2, yardMin: 0, yardMax: 0 };

// Sections of extra filters that imot.bg shows depending on the chosen property types.
const EXTRA_SECTIONS = ['extritb', 'extri1', 'extrip'];

const clean = (s) => decodeEntities(s).replace(/\s+/g, ' ').trim();

function selectInner(html, attr) {
  return html.match(new RegExp(`<select\\b[^>]*\\b${attr}[^>]*>([\\s\\S]*?)</select>`, 'i'))?.[1] ?? '';
}

/** Options of a <select>, without the empty "any" option. */
function options(selHtml) {
  return [...selHtml.matchAll(/<option\b([^>]*)>([^<]*)/gi)]
    .map(([, attrs, label]) => ({ value: decodeEntities(attrs.match(/\bvalue="([^"]*)"/i)?.[1] ?? ''), label: clean(label), selected: /\bselected\b/i.test(attrs) }))
    .filter((o) => o.value !== '');
}

const plain = (opts) => opts.map(({ value, label }) => ({ value, label }));

/** Checkboxes and labelled selects inside one extra-filter section. */
function extraFields(html) {
  if (!html) return { checks: [], selects: [] };
  const checks = [...html.matchAll(/<input type="checkbox" value="([^"]*)" name="(f\d+)"\s*>([^<]*)/g)]
    .map(([, value, name, label]) => ({ name, value: decodeEntities(value), label: clean(label) }))
    .filter((c) => !FIXED.has(c.name));
  const selects = [...html.matchAll(/([^<>:]+):\s*<select name="(f\d+)"[^>]*>([\s\S]*?)<\/select>/g)]
    .map(([, label, name, inner]) => ({ name, label: clean(label), options: plain(options(inner)) }))
    .filter((s) => !FIXED.has(s.name) && s.options.length);
  return { checks, selects };
}

function jsonAttr(html, id) {
  const raw = html.match(new RegExp(`id='${id}' value='([^']*)'`))?.[1];
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}

/** Parse imot.bg's search form page (/search/prodazhbi[/<place>]) into option lists. */
export function parseSearchForm(html) {
  const form = html.match(/<form name="search"[\s\S]*?<\/form>/)?.[0] ?? '';
  const types = [];
  for (const [, id, group, label] of form.matchAll(/<input type="checkbox" id="vi(\d+)"[^>]*?srcvichange\((\d+)\)[^>]*>([^<]*)/g)) {
    if (!types.some((t) => t.id === id)) types.push({ id, group: Number(group), label: clean(label) });
  }
  const places = options(selectInner(form, 'name="f38"'));
  const extras = {};
  for (const id of EXTRA_SECTIONS) extras[id] = extraFields(divInner(form, new RegExp(`<div id="${id}"[^>]*>`)));
  return {
    types,
    // Property type id -> sections of extra filters it shows, e.g. { "10": ["areah", "extritb", "extri1"] }.
    sectionsByType: jsonAttr(form, 'displvijs') || {},
    // "world" leaves for a different site (worldwide-search.imot.bg).
    locations: plain(places.filter((o) => o.value !== 'world')),
    location: places.find((o) => o.selected)?.value || '',
    districts: options(selectInner(form, 'id="ri"')).map((o) => o.value),
    floorsFrom: plain(options(selectInner(form, 'name="f31"'))),
    floorsTo: plain(options(selectInner(form, 'name="f32"'))),
    sorts: plain(options(selectInner(form, 'name="f41"'))),
    currencies: options(selectInner(form, 'name="f30"')).map((o) => o.value),
    // Year lists use 0 for "any"; floors use 0 for the ground floor.
    yearsFrom: options(selectInner(form, 'name="f51"')).map((o) => o.value).filter((v) => v !== '0'),
    yearsTo: options(selectInner(form, 'name="f52"')).map((o) => o.value).filter((v) => v !== '0'),
    extras,
  };
}

/**
 * Query from the UI -> the fields imot.bg's form would post. Unknown or malformed values are dropped.
 * `extras` maps live-form field names to values, e.g. { f62: "Тухла", f33: "ДА" }.
 */
export function buildSearchParams(q = {}) {
  const deal = SEARCH_DEALS[q.deal] ? q.deal : 'sale';
  const out = { act: '15', actsrc: '3', rub: SEARCH_DEALS[deal].rub, f1: '1' };
  const text = (v, max = 60) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim().slice(0, max) : '');
  const list = (v, re, max = 50) => (Array.isArray(v) ? v : []).map((x) => text(x)).filter((x) => re.test(x)).slice(0, max);
  const match = (v, re) => (re.test(text(v)) ? text(v) : '');
  const set = (name, v) => { if (v) out[name] = v; };

  set(F.types, list(q.types, /^\d{1,3}$/).map((id) => `${id}~`).join(''));
  set(F.location, text(q.location));
  if (out[F.location]) set(F.districts, list(q.districts, /^[^+~]{1,60}$/, 400).map((d) => `${d}+`).join(''));
  for (const [k, digits] of Object.entries(AMOUNTS)) {
    // Number inputs may hold "1e5"; typed text may hold "1 200".
    const raw = text(q[k]);
    const n = raw && Number.isFinite(Number(raw)) ? Number(raw) : parseNumber(raw);
    set(F[k], n > 0 && n < 1e8 ? String(Number(n.toFixed(digits))) : '');
  }
  set(F.currency, match(q.currency, /^(EUR|\$)$/));
  set(F.floorFrom, match(q.floorFrom, /^\d{1,4}$/));
  set(F.floorTo, match(q.floorTo, /^\d{1,4}$/));
  set(F.sort, match(q.sort, /^\d$/));
  set(F.yearFrom, match(q.yearFrom, /^\d{4}$/));
  set(F.yearTo, match(q.yearTo, /^\d{4}$/));
  set(F.keyword, text(q.keyword, 40));
  // "Under construction" also ticks imot.bg's hidden "not completed" box, as its own form does.
  set(F.status, list(q.status, /^[12]$/).flatMap((v) => (v === '2' ? ['2', '3'] : [v])).map((v) => `${v}~`).join(''));
  if (q.photoOnly === true) out[F.photoOnly] = '1';
  if (q.videoOnly === true) out[F.videoOnly] = '1';
  const extras = q.extras && typeof q.extras === 'object' ? Object.entries(q.extras).slice(0, 60) : [];
  for (const [name, v] of extras) if (/^f\d{2,3}$/.test(name) && !FIXED.has(name)) set(name, text(v));
  return out;
}

const badRequest = (message) => Object.assign(new Error(message), { status: 400, code: 'badRequest' });

/** Live imot.bg search form (cached) and its link builder. */
export class ImotSearch {
  constructor({ fetcher = new Fetcher({ minIntervalMs: 350, concurrency: 2 }), ttlMs = 6 * 3600e3 } = {}) {
    this.fetcher = fetcher;
    this.ttlMs = ttlMs;
    this.cache = new Map();
  }

  /** Option lists for a deal, plus the districts of `location` when one is given. */
  async form(deal, location = '') {
    if (!SEARCH_DEALS[deal]) throw badRequest('Unknown deal');
    if (location && !(await this.form(deal)).locations.some((l) => l.value === location)) throw badRequest('Unknown location');
    const key = `${deal}|${location}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.promise;
    const promise = (async () => {
      // A place's form page has its own address (/search/prodazhbi/grad-sofiya), so ask the builder for it.
      const url = location
        ? await this.#build({ act: '15', actsrc: '2', rub: SEARCH_DEALS[deal].rub, f1: '1', [F.location]: location })
        : `${BASE}/search/${SEARCH_DEALS[deal].path}`;
      const res = await this.fetcher.get(url);
      const form = res.status === 200 ? parseSearchForm(res.html) : null;
      if (!form?.types.length) throw new Error(`imot.bg search form not recognised (${url})`);
      return { deal, ...form, location };
    })();
    this.cache.set(key, { at: Date.now(), promise });
    promise.catch(() => this.cache.delete(key));
    return promise;
  }

  /** Search link for a query, e.g. https://www.imot.bg/obiavi/prodazhbi/grad-sofiya/dvustaen?type_home=3~ */
  async searchUrl(query) {
    const href = await this.#build(buildSearchParams(query));
    const c = classifyUrl(href);
    if (c.kind !== 'search') throw new Error(`imot.bg returned an unexpected address: ${href}`);
    return c.url;
  }

  async #build(fields) {
    const res = await this.fetcher.post(BUILDER_URL, fields);
    let result = null;
    try { result = JSON.parse(res.html)?.result; } catch { /* not JSON */ }
    const u = typeof result === 'string' && result ? new URL(result, BASE) : null;
    if (!u || !/(^|\.)imot\.bg$/.test(u.hostname)) throw new Error('imot.bg did not return a search address');
    u.protocol = 'https:';
    return u.href;
  }
}
