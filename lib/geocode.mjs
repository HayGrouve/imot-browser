// Online fallback geocoder (OpenStreetMap Nominatim) with a persistent cache.
// Used only for places the offline gazetteer cannot resolve, ambiguous
// town/village names, and big-city neighbourhoods. Nominatim's usage policy
// allows at most 1 request/second and requires caching — both are enforced here.

import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';

const ENDPOINT = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'imot-browser/1.0 (local personal real-estate browser)';
const BG_BBOX = { minLat: 41.2, maxLat: 44.25, minLon: 22.3, maxLon: 28.7 };

// Nominatim's names for Bulgarian provinces match imot.bg's except Sofia Province.
const nominatimState = (oblast) => (oblast === 'София' ? 'Софийска' : oblast || null);

const PLACE_TYPES = new Set(['city', 'town', 'village', 'hamlet', 'isolated_dwelling', 'locality', 'suburb', 'quarter',
  'neighbourhood', 'city_district', 'residential', 'farm', 'allotments', 'municipality', 'place']);

const KIND_TYPES = {
  city: ['city', 'town'],
  town: ['town', 'city'],
  village: ['village', 'hamlet', 'isolated_dwelling'],
};

function distKm(a, b) {
  const R = 6371; const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat); const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export class Geocoder {
  constructor({ cacheFile, enabled = true, minIntervalMs = 1100 } = {}) {
    this.cacheFile = cacheFile;
    this.enabled = enabled;
    this.minIntervalMs = minIntervalMs;
    this.cache = {};
    this.last = 0;
    this.chain = Promise.resolve();
    this.dirty = false;
  }

  async load() {
    try { this.cache = JSON.parse(await readFile(this.cacheFile, 'utf8')); } catch { this.cache = {}; }
    return this;
  }

  async save() {
    if (!this.dirty || !this.cacheFile) return;
    await mkdir(path.dirname(this.cacheFile), { recursive: true });
    const tmp = `${this.cacheFile}.tmp`;
    await writeFile(tmp, JSON.stringify(this.cache));
    await rename(tmp, this.cacheFile);
    this.dirty = false;
  }

  has(query) { return Object.hasOwn(this.cache, query); }

  // Serialise requests and keep them ≥ minIntervalMs apart.
  #throttle(fn) {
    const run = this.chain.then(async () => {
      const wait = this.last + this.minIntervalMs - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.last = Date.now();
      return fn();
    });
    this.chain = run.catch(() => {});
    return run;
  }

  /** Raw search, cached. Returns an array of { lat, lon, type, addresstype, name, display }. */
  async search(query, { signal } = {}) {
    if (this.has(query)) return this.cache[query];
    if (!this.enabled) return null;
    const results = await this.#throttle(async () => {
      const u = new URL(ENDPOINT);
      u.searchParams.set('q', query);
      u.searchParams.set('format', 'jsonv2');
      u.searchParams.set('countrycodes', 'bg');
      u.searchParams.set('accept-language', 'bg');
      u.searchParams.set('limit', '5');
      const res = await fetch(u, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal });
      if (res.status === 429 || res.status >= 500) throw new Error(`Nominatim HTTP ${res.status}`);
      if (!res.ok) return [];
      const json = await res.json();
      return json.map((r) => ({
        lat: Number(r.lat), lon: Number(r.lon), type: r.type, addresstype: r.addresstype,
        name: r.name, display: r.display_name,
      })).filter((r) => r.lat >= BG_BBOX.minLat && r.lat <= BG_BBOX.maxLat && r.lon >= BG_BBOX.minLon && r.lon <= BG_BBOX.maxLon);
    });
    this.cache[query] = results;
    this.dirty = true;
    return results;
  }

  /** Settlement by name + oblast; `kind` picks town vs village; `near` keeps results close to a hint. */
  async settlement(name, oblast, kind, { near, maxKm = 60, signal } = {}) {
    const state = nominatimState(oblast);
    const wanted = KIND_TYPES[kind];
    const accept = (rs, requireState) => (rs || []).filter((r) => PLACE_TYPES.has(r.addresstype)
      && (!near || distKm(r, near) <= maxKm)
      && (!requireState || !state || r.display.includes(state)));
    const typedOf = (rs) => (wanted ? rs.filter((r) => wanted.includes(r.addresstype)) : rs);

    const first = accept(await this.search([name, state, 'България'].filter(Boolean).join(', '), { signal }), false);
    let best = typedOf(first)[0];
    if (!best) {
      // Without the oblast Nominatim ranks differently (e.g. finds "с. Костенец" next to "гр. Костенец").
      const second = accept(await this.search(`${name}, България`, { signal }), true);
      best = typedOf(second)[0] || first[0] || second[0];
    }
    return best ? { lat: best.lat, lon: best.lon, display: best.display, source: 'nominatim' } : null;
  }

  /** Neighbourhood inside a city; must lie within `maxKm` of the city centre. */
  async neighborhood(name, city, center, { maxKm = 20, signal } = {}) {
    const clean = name.replace(/^(ж\.?к\.?|кв\.)\s*/i, '').trim();
    const results = await this.search(`${clean}, ${city}, България`, { signal });
    if (!results || !results.length) return null;
    const near = results.filter((r) => !center || distKm(r, center) <= maxKm);
    const best = near.find((r) => PLACE_TYPES.has(r.addresstype)) || near[0];
    return best ? { lat: best.lat, lon: best.lon, display: best.display, source: 'nominatim' } : null;
  }
}
