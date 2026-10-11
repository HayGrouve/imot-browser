import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import path from 'node:path';
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
