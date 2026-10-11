import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import os from 'node:os';
import path from 'node:path';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Gazetteer } from '../lib/gazetteer.mjs';
import { buildStandaloneHtml } from '../lib/export.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const g = new Gazetteer();

test('gazetteer resolves towns, villages and station villages', () => {
  assert.equal(g.resolve('Своге', 'София', 'town').nameEn, 'Svoge');
  assert.equal(g.resolve('Гара Бов', 'София', 'other').nameEn, 'Gara Bov');
  assert.equal(g.resolve('София', 'София-град', 'city').code, 'PPLC');
  assert.equal(g.resolve('Градец', 'София', 'village').nameEn, 'Gradets'); // must not strip "Град"
});

test('gazetteer never matches upper/lower (Горни/Долни) pairs', () => {
  const r = g.resolve('Горни Окол', 'София', 'village');
  assert.equal(r.nameEn, 'Gorni Okol'); // via the municipality code, despite a wrong admin1 in GeoNames
});

test('gazetteer flags same-name places it cannot tell apart', () => {
  assert.equal(g.resolve('Костенец', 'София', 'village').match, 'ambiguous');
});

test('standalone export is one self-contained, parseable HTML file', async () => {
  const data = { listings: [{ id: 'x1', title: '</script><script>alert(1)</script>', price: 1 }], sources: {}, updatedAt: null };
  const html = await buildStandaloneHtml({ root: ROOT, data, lang: 'bg' });
  assert.ok(!/src="(?!data:)[^"]+\.m?js"/.test(html), 'no external scripts');
  assert.ok(!/<link rel="stylesheet" href=/.test(html), 'no external styles');
  assert.ok(!html.includes('</script><script>alert(1)'), 'data cannot break out of the script element');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.ok(scripts.length >= 3);
  for (const s of scripts) assert.doesNotThrow(() => new vm.Script(s), 'inline script parses');
  assert.ok(!/^\s*(import|export)\s/m.test(scripts.at(-1)), 'module syntax stripped');
});

test('standalone export embeds the vendored font instead of linking vendor/ files', async () => {
  const data = { listings: [], sources: {}, updatedAt: null };
  const real = await buildStandaloneHtml({ root: ROOT, data });
  assert.ok(!real.includes('url("vendor/'), 'real export has no url("vendor/...") references');
  // Same build with a stylesheet that is guaranteed to reference the font (twice).
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'imot-export-'));
  try {
    for (const dir of ['public', 'shared']) await cp(path.join(ROOT, dir), path.join(tmp, dir), { recursive: true });
    const face = '@font-face { font-family: "Geist"; src: url("vendor/geist/Geist-Variable.woff2") format("woff2"); }\n';
    const css = await readFile(path.join(ROOT, 'public/styles.css'), 'utf8');
    await writeFile(path.join(tmp, 'public/styles.css'), face + face + css);
    const html = await buildStandaloneHtml({ root: tmp, data });
    assert.ok(!html.includes('url("vendor/'), 'no url("vendor/...") left');
    const urls = [...html.matchAll(/url\("data:font\/woff2;base64,([A-Za-z0-9+/=]+)"\)/g)];
    const own = (css.match(/url\("vendor\/geist\//g) || []).length; // the real stylesheet's own references
    assert.equal(urls.length, 2 + own);
    const font = await readFile(path.join(ROOT, 'public/vendor/geist/Geist-Variable.woff2'));
    assert.ok(Buffer.from(urls[0][1], 'base64').equals(font), 'embedded bytes match the woff2 file');
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('villages inside a city municipality are mapped as villages, not city neighbourhoods', async () => {
  const { ImportJob } = await import('../lib/importer.mjs');
  const { parseLocation } = await import('../lib/parse.mjs');
  const store = { get: () => undefined };
  const job = new ImportJob({ inputs: [], store, gazetteer: g });
  const card = (id, loc) => ({ fields: { id, ...parseLocation(loc) } });
  job.cards = new Map([['a', card('a', 'град София, с. Бистрица')], ['b', card('b', 'град София, Симеоново')]]);
  job.geocodeOffline();
  const village = job.cards.get('a').fields;
  assert.equal(village.place.nameEn, 'Bistritsa');
  assert.equal(village.place.via, 'neighborhood');
  assert.equal(village.place.municipality, 'София');
  const hood = job.cards.get('b').fields; // ordinary neighbourhood: stays in the city…
  assert.equal(hood.place.nameEn, 'Sofia');
  assert.equal(hood.neighborhood, 'Симеоново');
  assert.equal(hood.nbhd.source, 'geonames'); // …and is located offline at the quarter itself
  assert.ok(Math.abs(hood.nbhd.lat - 42.617) < 0.01 && Math.abs(hood.nbhd.lon - 23.333) < 0.01);
});

test('online neighbourhood lookup rejects results named after a different quarter', async () => {
  const { Geocoder } = await import('../lib/geocode.mjs');
  const geo = new Geocoder({ enabled: false });
  const center = { lat: 42.6975, lon: 23.3242 };
  // Real Nominatim answer for "Симеоново, София": best place-type hit is another quarter.
  geo.cache['Симеоново, София, България'] = [
    { name: 'Симеоново', addresstype: 'road', lat: 42.6721, lon: 23.3342, display: 'Симеоново, Лозенец, София, България' },
    { name: 'Симеоново', addresstype: 'information', lat: 42.6092, lon: 23.3304, display: 'Симеоново, кв. Симеоново, Студентски, София, България' },
    { name: 'кв. Драгалевци', addresstype: 'suburb', lat: 42.6303, lon: 23.3132, display: 'кв. Драгалевци, Витоша, София, България' },
  ];
  const r = await geo.neighborhood('Симеоново', 'София', center);
  assert.equal(r.lat, 42.6092); // inside "кв. Симеоново", not Драгалевци and not a same-named street
  geo.cache['Детски град, София, България'] = [
    { name: 'Англо-американско училище', addresstype: 'amenity', lat: 42.6154, lon: 23.3932, display: 'Англо-американско училище, Веселинов рид, ж.к. Свети Георги, Панчарево, България' },
  ];
  assert.equal(await geo.neighborhood('м-т Детски град', 'София', center), null);
});
