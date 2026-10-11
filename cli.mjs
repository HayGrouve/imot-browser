#!/usr/bin/env node
// Command-line access to the importer (same data folder as the server).
//
//   node cli.mjs import <url> [<url>…] [--no-details] [--no-split] [--no-geocode] [--max 5000]
//   node cli.mjs stats
//   node cli.mjs reparse        (re-derive fields from stored raw data after parser fixes; no network)
//   node cli.mjs export <file.html> [--lang bg]

import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Store } from './lib/store.mjs';
import { Gazetteer } from './lib/gazetteer.mjs';
import { Geocoder } from './lib/geocode.mjs';
import { ImportJob } from './lib/importer.mjs';
import { buildStandaloneHtml } from './lib/export.mjs';
import { fieldsFromParams } from './lib/parse.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (f) => argv.includes(f);
const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const dataDir = path.resolve(opt('--data') || path.join(ROOT, 'data'));
const positional = argv.filter((a, i) => !a.startsWith('--') && !['--data', '--lang', '--max'].includes(argv[i - 1]));
const [cmd, ...rest] = positional;

const store = await new Store(path.join(dataDir, 'listings.json')).load();

if (cmd === 'import') {
  if (!rest.length) { console.error('Usage: node cli.mjs import <url> [<url>…]'); process.exit(2); }
  const geocoder = await new Geocoder({ cacheFile: path.join(dataDir, 'geocache.json'), enabled: !flag('--no-geocode') }).load();
  const job = new ImportJob({
    inputs: rest, store, gazetteer: new Gazetteer(), geocoder,
    options: {
      details: !flag('--no-details'), autoSplit: !flag('--no-split'), geocodeOnline: !flag('--no-geocode'),
      ...(Number(opt('--max')) > 0 ? { maxListings: Number(opt('--max')) } : {}),
    },
  });
  process.on('SIGINT', () => job.cancel());
  let lastLog = 0;
  const timer = setInterval(() => {
    const s = job.state; const p = s.progress;
    for (const l of s.log.slice(lastLog)) console.log(`  · ${l.code} ${JSON.stringify(l.params)}`);
    lastLog = s.log.length;
    process.stdout.write(`[${s.phase}] pages ${p.searchPages}/${p.searchPagesTotal} · found ${p.found} · details ${p.details}/${p.detailsTotal} · geocode ${p.geocode}/${p.geocodeTotal}\n`);
  }, 3000);
  const s = await job.run();
  clearInterval(timer);
  for (const l of s.log.slice(lastLog)) console.log(`  · ${l.code} ${JSON.stringify(l.params)}`);
  console.log(`\n${s.status.toUpperCase()}: ${JSON.stringify(s.result)}`);
  for (const w of s.warnings) console.log(`  ! ${w.code} ${JSON.stringify(w.params)}`);
  if (s.error) console.log(`  ✗ ${s.error.code}: ${s.error.message}`);
  process.exit(s.status === 'done' ? 0 : 1);
} else if (cmd === 'stats') {
  const ls = store.listings;
  const places = new Set(ls.map((l) => l.place?.key).filter(Boolean));
  console.log(`${ls.length} listings · ${places.size} places · ${ls.filter((l) => !l.place).length} unmapped · ${ls.filter((l) => l.detailsFetchedAt).length} with details`);
  for (const s of Object.values(store.data.sources)) console.log(`  source ${s.id}: ${s.found ?? '?'} found, total ${s.total ?? '?'}${s.capped ? '+' : ''} — ${s.input}`);
} else if (cmd === 'reparse') {
  const job = new ImportJob({ inputs: [], store, gazetteer: new Gazetteer() });
  job.cards = new Map(store.listings.map((l) => [l.id, { fields: { ...l, ...(l.params ? fieldsFromParams(l.params) : {}) } }]));
  job.geocodeOffline();
  for (const c of job.cards.values()) store.data.listings[c.fields.id] = c.fields;
  await store.save();
  console.log(`Re-derived ${job.cards.size} listings`);
} else if (cmd === 'export') {
  const file = rest[0];
  if (!file) { console.error('Usage: node cli.mjs export <file.html>'); process.exit(2); }
  const html = await buildStandaloneHtml({
    root: ROOT, lang: opt('--lang') === 'bg' ? 'bg' : 'en',
    data: { listings: store.listings, sources: store.data.sources, updatedAt: store.data.updatedAt, attribution: new Gazetteer().attribution },
  });
  await writeFile(file, html);
  console.log(`Wrote ${file} (${(html.length / 1e6).toFixed(1)} MB, ${store.listings.length} listings)`);
} else {
  console.log('Usage:\n  node cli.mjs import <url> [<url>…] [--no-details] [--no-split] [--no-geocode]\n  node cli.mjs stats\n  node cli.mjs reparse\n  node cli.mjs export <file.html> [--lang bg]');
  process.exit(cmd ? 2 : 0);
}
