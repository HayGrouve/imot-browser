// JSON-file persistence for imported listings and their import sources.

import { readFile, writeFile, rename, mkdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

export const sourceIdFor = (url) => createHash('sha1').update(url).digest('hex').slice(0, 10);

export class Store {
  constructor(file) {
    this.file = file;
    this.data = { version: 1, updatedAt: null, listings: {}, sources: {} };
    this.saving = Promise.resolve();
  }

  async load() {
    try {
      const d = JSON.parse(await readFile(this.file, 'utf8'));
      this.data = { version: 1, listings: {}, sources: {}, ...d };
      this.mtime = (await stat(this.file)).mtimeMs;
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    return this;
  }

  /** Pick up changes written by another process (e.g. `node cli.mjs import`). */
  async reloadIfChanged() {
    await this.saving;
    try {
      const { mtimeMs } = await stat(this.file);
      if (mtimeMs !== this.mtime) await this.load();
    } catch { /* no file yet */ }
  }

  save() {
    // Serialise writes; each write is atomic (tmp file + rename).
    this.saving = this.saving.then(async () => {
      this.data.updatedAt = new Date().toISOString();
      await mkdir(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      await writeFile(tmp, JSON.stringify(this.data));
      await rename(tmp, this.file);
      this.mtime = (await stat(this.file)).mtimeMs;
    });
    return this.saving;
  }

  get listings() { return Object.values(this.data.listings); }
  get(id) { return this.data.listings[id]; }

  upsertSource(src) {
    const prev = this.data.sources[src.id] || {};
    const next = { ...prev, ...src };
    // Remember the previous import so the UI can flag listings that are new since then.
    if (prev.lastImportAt && src.lastImportAt && prev.lastImportAt !== src.lastImportAt) next.prevImportAt = prev.lastImportAt;
    this.data.sources[src.id] = next;
    return next;
  }

  /**
   * Merge freshly scraped fields into a listing. Tracks first/last seen, the sources a listing
   * came from, and a price history whenever the price changes between imports.
   */
  upsertListing(fields, { sourceId, now }) {
    const prev = this.data.listings[fields.id];
    const next = { ...(prev || {}), ...stripUndefined(fields) };
    next.firstSeen = prev?.firstSeen || now;
    next.lastSeen = now;
    next.sources = [...new Set([...(prev?.sources || []), ...(sourceId ? [sourceId] : [])])];
    const history = prev?.priceHistory ? [...prev.priceHistory] : [];
    if (next.price != null) {
      const last = history[history.length - 1];
      if (!last || last.price !== next.price) history.push({ at: now, price: next.price, currency: next.currency });
    }
    next.priceHistory = history;
    this.data.listings[fields.id] = next;
    return { listing: next, added: !prev, priceChanged: !!prev && prev.price !== next.price && prev.price != null };
  }

  remove(ids) {
    let n = 0;
    for (const id of ids) {
      if (Object.hasOwn(this.data.listings, id)) { delete this.data.listings[id]; n++; }
    }
    return n;
  }

  removeSource(sourceId, { withListings = true } = {}) {
    delete this.data.sources[sourceId];
    let removed = 0;
    for (const l of this.listings) {
      if (!l.sources?.includes(sourceId)) continue;
      l.sources = l.sources.filter((s) => s !== sourceId);
      if (withListings && !l.sources.length) { delete this.data.listings[l.id]; removed++; }
    }
    return removed;
  }

  clear() {
    this.data.listings = {};
    this.data.sources = {};
  }
}

function stripUndefined(o) {
  const out = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out;
}
