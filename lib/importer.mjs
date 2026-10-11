// Import pipeline: links -> search pages (auto-split past the 1000-result cap)
// -> listing cards -> optional detail pages -> geocoding -> store.

import {
  classifyUrl, parseSearchPage, parseDetailPage, searchPageUrl, getPriceRange, withPriceRange,
  PAGE_SIZE, MAX_PAGES,
} from './parse.mjs';
import { Fetcher } from './http.mjs';
import { sourceIdFor } from './store.mjs';

export const DEFAULT_OPTIONS = {
  details: true,          // fetch every listing page for full data (slower, ~1 request per listing)
  autoSplit: true,        // split searches with 1000+ results into price bands
  geocodeOnline: true,    // use OpenStreetMap Nominatim for places missing from the offline gazetteer
  refreshDetailsDays: 3,  // re-fetch details when older than this (or when the price changed)
  delayMs: 350,           // minimum spacing between requests to imot.bg
  concurrency: 3,
  maxListings: 5000,      // safety valve
};

const MANUAL_SOURCE = 'manual';
let seq = 0;

/** Split a price band in two (overlapping by one value so no listing falls in a gap). */
export function splitRange(min, max) {
  if (max == null) {
    const pivot = min > 0 ? min * 2 : 100000;
    return [[min, pivot], [pivot, null]];
  }
  if (max - min < 2) return null;
  const mid = Math.floor((min + max) / 2);
  return [[min, mid], [mid, max]];
}

async function pool(items, limit, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; await fn(items[k], k); }
  });
  await Promise.all(workers);
}

const SUBVILLAGE = /^(?:с\.|село)\s*([А-Яа-я][А-Яа-я .-]{1,40})$/i;
// A bare name in the sub-location line ("Безден") may also be a village of the municipality.
const BARE_NAME = /^[А-Я][а-я]+(?:[ -][А-Яа-я][а-я]+){0,2}$/;
const NOT_A_VILLAGE = /^(Център|Централна|Идеален|Квартал|Вилна|Местност|Промишлена|Индустриална)/i;

function distKm(a, b) {
  const R = 6371; const r = (d) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lon - a.lon) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export class ImportJob {
  constructor({ inputs, options = {}, store, gazetteer, geocoder }) {
    this.store = store;
    this.gazetteer = gazetteer;
    this.geocoder = geocoder;
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.abort = new AbortController();
    this.state = {
      id: `job-${Date.now().toString(36)}-${++seq}`,
      status: 'queued',
      phase: 'init',
      startedAt: null,
      finishedAt: null,
      options: this.options,
      inputs: inputs.map((input) => ({ input })),
      progress: { searchPages: 0, searchPagesTotal: 0, found: 0, details: 0, detailsTotal: 0, detailsSkipped: 0, geocode: 0, geocodeTotal: 0 },
      result: { added: 0, updated: 0, priceChanged: 0, total: 0, unmapped: 0, requests: 0 },
      warnings: [],
      log: [],
      error: null,
    };
  }

  log(code, params = {}) {
    this.state.log.push({ t: Date.now(), code, params });
    if (this.state.log.length > 300) this.state.log.splice(0, this.state.log.length - 300);
  }

  warn(code, params = {}) {
    this.state.warnings.push({ code, params });
    this.log(code, { ...params, level: 'warn' });
  }

  cancel() { this.abort.abort(new Error('cancelled')); }

  async run() {
    const s = this.state;
    s.status = 'running';
    s.startedAt = new Date().toISOString();
    this.now = s.startedAt;
    this.before = new Map(this.store.listings.map((l) => [l.id, l.price ?? null]));
    this.fetcher = new Fetcher({ minIntervalMs: this.options.delayMs, concurrency: this.options.concurrency, signal: this.abort.signal });
    this.cards = new Map();   // id -> { fields, sourceId }
    try {
      s.phase = 'search';
      for (const src of s.inputs) {
        Object.assign(src, classifyUrl(src.input));
        if (src.kind === 'unsupported') { this.warn('unsupportedUrl', { input: src.input, reason: src.notes[0] }); continue; }
        if (src.notes.includes('removed:plnk') || src.notes.includes('removed:slink')) this.log('sessionParamRemoved', { input: src.input });
        if (src.kind === 'listing') {
          src.sourceId = MANUAL_SOURCE;
          if (!this.cards.has(src.id)) this.cards.set(src.id, { fields: { id: src.id, url: src.url }, sourceId: MANUAL_SOURCE, manual: true });
          src.found = 1;
          continue;
        }
        src.sourceId = sourceIdFor(src.url);
        src.found = 0; src.splits = 0;
        try {
          await this.collectSearch(src);
        } catch (err) {
          if (err.code === 'blocked' || this.abort.signal.aborted) throw err;
          src.error = err.code || 'error';
          this.warn('searchFailed', { input: src.input, message: err.message });
        }
      }
      s.progress.found = this.cards.size;

      // Decide which listings need their detail page, and carry previously fetched
      // details forward (fresh card fields like price/promo override them).
      for (const c of this.cards.values()) {
        const prev = this.store.get(c.fields.id);
        c.needsDetails = this.needsDetails(c, prev);
        if (prev?.detailsFetchedAt && !c.manual) c.fields = { ...prev, ...pickFresh(c.fields) };
      }

      // Save cards right away so a long detail phase doesn't hide everything.
      this.geocodeOffline();
      this.commit();
      await this.store.save();

      if ([...this.cards.values()].some((c) => c.needsDetails)) {
        s.phase = 'details';
        await this.fetchDetails();
      }

      s.phase = 'geocode';
      this.geocodeOffline();
      if (this.options.geocodeOnline) await this.geocodeOnline();

      s.phase = 'saving';
      this.commit();
      await this.store.save();
      s.status = 'done';
    } catch (err) {
      const cancelled = this.abort.signal.aborted;
      s.status = cancelled ? 'cancelled' : 'error';
      if (!cancelled) s.error = { code: err.code || 'error', message: err.message };
      this.log(cancelled ? 'cancelled' : 'failed', { message: err.message, level: 'error' });
      // Keep whatever was collected.
      try { this.geocodeOffline(); this.commit(); await this.store.save(); } catch { /* ignore */ }
    } finally {
      s.result.requests = this.fetcher?.requests ?? 0;
      s.result.total = this.store.listings.length;
      s.phase = 'done';
      s.finishedAt = new Date().toISOString();
      try { await this.geocoder?.save(); } catch { /* ignore */ }
    }
    return s;
  }

  async fetchSearchPage(url, page) {
    const pageUrl = searchPageUrl(url, page);
    const res = await this.fetcher.get(pageUrl);
    if (res.status === 404) {
      const err = new Error(`imot.bg returned "page not found" for ${pageUrl}`);
      err.code = 'searchNotFound';
      throw err;
    }
    const parsed = parseSearchPage(res.html);
    this.state.progress.searchPages++;
    return parsed;
  }

  addCards(src, items) {
    for (const item of items) {
      if (this.cards.size >= this.options.maxListings && !this.cards.has(item.id)) {
        if (!this.maxWarned) { this.warn('maxListings', { max: this.options.maxListings }); this.maxWarned = true; }
        return;
      }
      if (!this.cards.has(item.id)) src.found++;
      this.cards.set(item.id, { fields: item, sourceId: src.sourceId });
    }
    this.state.progress.found = this.cards.size;
  }

  get full() { return this.cards.size >= this.options.maxListings; }

  async collectSearch(src) {
    const visit = async (url, depth) => {
      if (this.full) return;
      const first = await this.fetchSearchPage(url, 1);
      this.state.progress.searchPagesTotal++;
      if (depth === 0) {
        Object.assign(src, { total: first.total, capped: first.capped, paramsText: first.paramsText });
        this.log('searchStarted', { input: src.input, total: first.total, capped: first.capped });
      }
      if (first.capped) {
        const range = getPriceRange(url);
        const parts = this.options.autoSplit && depth < 16 ? splitRange(range.min, range.max) : null;
        if (parts) {
          src.splits++;
          this.log('splitting', { min: range.min, max: range.max });
          for (const [a, b] of parts) await visit(withPriceRange(url, a, b), depth + 1);
          return;
        }
        this.warn(this.options.autoSplit ? 'cappedCannotSplit' : 'capped', { input: src.input, min: range.min, max: range.max });
      }
      this.addCards(src, first.items);
      const pages = first.total ? Math.min(Math.ceil(first.total / PAGE_SIZE), MAX_PAGES) : null;
      if (pages) {
        this.state.progress.searchPagesTotal += pages - 1;
        const rest = Array.from({ length: pages - 1 }, (_, i) => i + 2);
        await pool(rest, this.options.concurrency, async (p) => {
          if (this.full) return;
          const r = await this.fetchSearchPage(url, p);
          this.addCards(src, r.items);
        });
      } else {
        // Unknown total: follow "next" links.
        let page = 1; let cur = first;
        while (cur.hasNext && page < MAX_PAGES && !this.full) {
          page++;
          this.state.progress.searchPagesTotal++;
          cur = await this.fetchSearchPage(url, page);
          this.addCards(src, cur.items);
        }
      }
    };
    await visit(src.url, 0);
    if (!src.found && !src.error) this.warn('noResults', { input: src.input });
    const wasCapped = src.capped && src.splits > 0;
    if (wasCapped) this.log('splitApplied', { input: src.input, splits: src.splits, found: src.found });
    this.store.upsertSource({
      id: src.sourceId, url: src.url, input: src.input, paramsText: src.paramsText || '',
      total: src.total, capped: src.capped, found: src.found, splits: src.splits, lastImportAt: this.now,
    });
  }

  needsDetails(card, prev) {
    if (card.manual) return true;
    if (!this.options.details) return false;
    if (!prev?.detailsFetchedAt) return true;
    if (prev.price !== card.fields.price) return true;
    const ageDays = (Date.parse(this.now) - Date.parse(prev.detailsFetchedAt)) / 864e5;
    return ageDays > this.options.refreshDetailsDays;
  }

  async fetchDetails() {
    const all = [...this.cards.values()];
    const todo = all.filter((c) => c.needsDetails);
    const p = this.state.progress;
    p.detailsTotal = todo.length;
    p.detailsSkipped = all.length - todo.length;
    if (p.detailsSkipped && this.options.details) this.log('detailsSkipped', { count: p.detailsSkipped });
    let failures = 0;
    await pool(todo, this.options.concurrency, async (c) => {
      try {
        const res = await this.fetcher.get(c.fields.url);
        const d = res.status === 404 ? { gone: true } : parseDetailPage(res.html);
        if (!d) throw new Error('unrecognised listing page');
        if (d.gone) {
          if (c.manual) { this.cards.delete(c.fields.id); this.warn('listingGone', { url: c.fields.url }); }
          return;
        }
        c.fields = mergeDetail(c.fields, d);
        c.fields.detailsFetchedAt = this.now;
        c.fields.descriptionFull = !!d.description;
        if (!c.fields.thumb && c.fields.photos?.length) c.fields.thumb = c.fields.photos[0].replace('/big1/', '/');
      } catch (err) {
        if (err.code === 'blocked' || this.abort.signal.aborted) throw err;
        failures++;
        if (failures <= 5) this.warn('detailFailed', { url: c.fields.url, message: err.message });
        if (c.manual) this.cards.delete(c.fields.id);
      } finally {
        p.details++;
      }
    });
    if (failures > 5) this.warn('detailFailedMore', { count: failures - 5 });
  }

  /** Attach `place` (settlement-level coordinates) from the offline gazetteer. */
  geocodeOffline() {
    for (const c of this.cards.values()) {
      const f = c.fields;
      if (!f.settlement) continue;
      const prev = this.store.get(f.id)?.place;
      let place = null;
      const town = this.gazetteer.resolve(f.settlement, f.oblast, f.settlementKind);
      if (f.address && f.settlementKind === 'town') {
        // "гр. Етрополе" + "с.Лопян": the listing is actually in a village of that municipality.
        const sub = f.address.trim().match(SUBVILLAGE);
        const name = sub ? sub[1].trim() : BARE_NAME.test(f.address.trim()) && !NOT_A_VILLAGE.test(f.address) ? f.address.trim() : null;
        const r = name && this.gazetteer.resolve(name, f.oblast, 'village');
        const trusted = r && (r.match === 'exact' || (sub && r.match === 'fuzzy'));
        const near = trusted && r.code !== 'PPLX' && (!town || distKm(r, town) <= (sub ? 40 : 25));
        if (near) place = makePlace(r, name, 'village', f.oblast, f.settlement);
      }
      if (!place && town) place = makePlace(town, f.settlement, f.settlementKind, f.oblast);
      // Keep an earlier online result for the same place (ambiguous/unresolved names).
      const lookup = lookupKey(f.oblast, place?.name || f.settlement, place?.kind || f.settlementKind);
      if (prev && prev.source === 'nominatim' && (!place || place.match === 'ambiguous') && prev.lookup === lookup) place = prev;
      f.place = place;
      if (f.neighborhood && f.settlementKind === 'city') {
        const prevNb = this.store.get(f.id)?.nbhd;
        if (prevNb && prevNb.name === f.neighborhood) f.nbhd = prevNb;
      }
    }
  }

  async geocodeOnline() {
    const g = this.geocoder;
    if (!g) return;
    const signal = this.abort.signal;
    const settlements = new Map();
    const hoods = new Map();
    const add = (map, k, f) => { if (!map.has(k)) map.set(k, []); map.get(k).push(f); };
    for (const c of this.cards.values()) {
      const f = c.fields;
      if (!f.settlement) continue;
      if (!f.place || f.place.match === 'ambiguous') add(settlements, lookupKey(f.oblast, f.place?.name || f.settlement, f.place?.kind || f.settlementKind), f);
      if (f.settlementKind === 'city' && f.neighborhood && !f.nbhd && f.place) add(hoods, `${f.settlement}|${f.neighborhood}`, f);
    }
    const p = this.state.progress;
    p.geocodeTotal = settlements.size + hoods.size;
    p.geocode = 0;
    if (!p.geocodeTotal) return;
    this.log('geocoding', { settlements: settlements.size, neighborhoods: hoods.size });
    try {
      for (const list of settlements.values()) {
        signal.throwIfAborted();
        const f = list[0];
        const ambiguous = f.place?.match === 'ambiguous';
        const name = f.place?.name || f.settlement;
        const kind = f.place?.kind || f.settlementKind;
        const r = await g.settlement(name, f.oblast, kind, { near: ambiguous ? f.place : null, signal });
        if (r) {
          const place = {
            ...(f.place || {}), key: `osm:${r.lat.toFixed(4)},${r.lon.toFixed(4)}`, lookup: lookupKey(f.oblast, name, kind),
            name, nameEn: f.place?.nameEn || null, kind, oblast: f.oblast, lat: r.lat, lon: r.lon,
            source: 'nominatim', match: ambiguous ? 'disambiguated' : 'online',
          };
          for (const x of list) x.place = place;
        }
        p.geocode++;
      }
      for (const list of hoods.values()) {
        signal.throwIfAborted();
        const f = list[0];
        const r = await g.neighborhood(f.neighborhood, f.settlement, f.place, { signal });
        const nbhd = r ? { name: f.neighborhood, lat: r.lat, lon: r.lon, source: 'nominatim' } : { name: f.neighborhood, lat: null, lon: null, source: 'none' };
        for (const x of list) x.nbhd = nbhd;
        p.geocode++;
        if (p.geocode % 25 === 0) await g.save();
      }
    } catch (err) {
      if (signal.aborted) throw err;
      this.warn('geocodeFailed', { message: err.message });
    }
  }

  commit() {
    // Counts are relative to the store as it was when the job started (commit runs more than once).
    let added = 0; let updated = 0; let priceChanged = 0; let unmapped = 0;
    for (const c of this.cards.values()) {
      this.store.upsertListing(c.fields, { sourceId: c.sourceId, now: this.now });
      const before = this.before.get(c.fields.id);
      if (before === undefined) added++;
      else {
        updated++;
        if (before != null && c.fields.price != null && before !== c.fields.price) priceChanged++;
      }
      if (!c.fields.place) unmapped++;
    }
    Object.assign(this.state.result, { added, updated, priceChanged, unmapped });
    if (this.state.inputs.some((s) => s.kind === 'listing')) {
      this.store.upsertSource({ id: MANUAL_SOURCE, url: null, input: 'manual', paramsText: '', lastImportAt: this.now });
    }
  }
}

function lookupKey(oblast, name, kind) { return `${oblast || ''}|${name || ''}|${kind || ''}`; }

function makePlace(r, name, kind, oblast, municipality) {
  return {
    // Display imot.bg's own spelling; GeoNames' Cyrillic names are sometimes variants ("Вакарелска").
    key: `gn:${r.geonameId}`, lookup: lookupKey(oblast, name, kind), name, nameEn: r.nameEn, kind, oblast,
    municipality: municipality || null, lat: r.lat, lon: r.lon, geonameId: r.geonameId,
    source: 'geonames', match: r.match,
  };
}

// Fields a fresh search card always knows better than an older stored detail page.
const CARD_FRESH = ['url', 'title', 'deal', 'type', 'typeBg', 'locationRaw', 'oblast', 'settlement', 'settlementKind',
  'neighborhood', 'price', 'currency', 'priceText', 'priceOnRequest', 'priceTrend', 'vatNote', 'promo', 'isNew', 'thumb', 'photoCount'];

function pickFresh(card) {
  const out = {};
  for (const k of CARD_FRESH) if (card[k] !== undefined) out[k] = card[k];
  return out;
}

const KEEP_FROM_CARD = new Set(['locationRaw', 'oblast', 'settlement', 'settlementKind', 'neighborhood', 'promo', 'priceTrend', 'isNew', 'thumb', 'url']);

/** Merge detail-page fields over search-card fields (cards keep their structured location). */
export function mergeDetail(card, detail) {
  if (!detail) return card;
  const out = { ...card };
  const hasCard = card && card.title;
  for (const [k, v] of Object.entries(detail)) {
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) continue;
    if (hasCard && KEEP_FROM_CARD.has(k) && card[k] != null) continue;
    if (k === 'firstSeen' || k === 'lastSeen' || k === 'sources' || k === 'priceHistory') continue;
    out[k] = v;
  }
  return out;
}
