import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSearchForm, buildSearchParams, ImotSearch } from '../lib/searchform.mjs';

const fixture = (name) => new TextDecoder('windows-1251').decode(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
const SALE = fixture('search-form-sale.html');
const RENT_SOFIA = fixture('search-form-rent-sofia.html');

test('sales search form: types, places, floors, sort orders and extra filters', () => {
  const f = parseSearchForm(SALE);
  assert.equal(f.types.length, 20);
  assert.deepEqual(f.types.find((t) => t.label === 'КЪЩА'), { id: '10', group: 3, label: 'КЪЩА' });
  assert.deepEqual(f.types.find((t) => t.label === '2-СТАЕН'), { id: '2', group: 1, label: '2-СТАЕН' });
  assert.deepEqual(f.sectionsByType['10'], ['areah', 'extritb', 'extri1']);
  assert.equal(f.location, '');
  assert.deepEqual(f.districts, []);
  assert.ok(f.locations.some((l) => l.value === 'град София'));
  assert.ok(f.locations.some((l) => l.value === 'област София' && l.label === 'област София'));
  assert.ok(!f.locations.some((l) => l.value === 'world'), 'the worldwide site is not a location');
  assert.deepEqual(f.floorsFrom.slice(0, 3), [{ value: '1000', label: 'Само последен' }, { value: '0', label: 'Партер' }, { value: '1', label: '1-ви' }]);
  assert.equal(f.floorsTo[0].value, '999');
  assert.deepEqual(f.sorts.map((s) => s.value), ['1', '2', '3', '4', '5']);
  assert.deepEqual(f.currencies, ['EUR', '$']);
  assert.equal(f.yearsFrom[0], '2040');
  assert.ok(!f.yearsFrom.includes('0'));
  assert.deepEqual(f.extras.extritb.checks.find((c) => c.value === 'Тухла'), { name: 'f62', value: 'Тухла', label: 'Тухла' });
  assert.equal(f.extras.extritb.selects.length, 0, 'year selects are fixed fields, not extras');
  const tec = f.extras.extri1.selects.find((s) => s.name === 'f33');
  assert.equal(tec.label, 'ТЕЦ');
  assert.deepEqual(tec.options.map((o) => o.value), ['ДА', 'НЕ', 'ЛО', 'ПР']);
  assert.deepEqual(f.extras.extrip.selects.map((s) => s.label), ['Ток', 'Вода', 'Регулация']);
});

test('rentals search form for a city: own type ids, districts and feature fields', () => {
  const f = parseSearchForm(RENT_SOFIA);
  // Rentals number their types differently from sales (СТАЯ comes first).
  assert.deepEqual(f.types[0], { id: '1', group: 1, label: 'СТАЯ' });
  assert.equal(f.types.find((t) => t.label === '2-СТАЕН').id, '3');
  assert.equal(f.location, 'град София');
  assert.ok(f.districts.length > 150);
  assert.ok(f.districts.includes('Лозенец'));
  assert.deepEqual(f.extras.extritb.checks, []);
  // ...and reuse field names for different features.
  assert.equal(f.extras.extri1.checks.find((c) => c.name === 'f67').value, 'Обзаведен');
  assert.deepEqual(f.sectionsByType['19'], ['extrip']);
});

test('search query -> imot.bg form fields', () => {
  const p = buildSearchParams({
    deal: 'rent', types: ['2', '3', 'x'], location: 'град София', districts: ['Лозенец', 'Белите брези', 'a+b'],
    priceMin: '300', priceMax: '1 200', currency: '$', areaMin: '45.5', ppmMin: '0', floorFrom: '0', floorTo: '999',
    sort: '5', keyword: '  гараж ', status: ['2'], yearFrom: '2000', yearTo: 'soon',
    extras: { f67: 'Обзаведен', f38: 'град Варна', act: '3', f33: 'ДА' }, photoOnly: true, videoOnly: 'yes',
  });
  assert.deepEqual(p, {
    act: '15', actsrc: '3', rub: '2', f1: '1',
    f7: '2~3~', f38: 'град София', f40: 'Лозенец+Белите брези+',
    f28: '300', f29: '1200', f30: '$', f26: '45.5', f31: '0', f32: '999', f41: '5', f51: '2000', f42: 'гараж',
    f57: '2~3~', fe1: '1', f67: 'Обзаведен', f33: 'ДА',
  });
});

test('an empty query is a search of all sales; districts need a location', () => {
  assert.deepEqual(buildSearchParams({}), { act: '15', actsrc: '3', rub: '1', f1: '1' });
  assert.equal(buildSearchParams({ districts: ['Лозенец'] }).f40, undefined);
  assert.equal(buildSearchParams({ deal: 'swap' }).rub, '1');
});

function fakeFetcher({ result = '//www.imot.bg/obiavi/prodazhbi/grad-sofiya/dvustaen?type_home=3~' } = {}) {
  const calls = [];
  return {
    calls,
    async get(url) { calls.push(['GET', url]); return { status: 200, html: url.endsWith('/grad-sofiya') ? RENT_SOFIA : SALE }; },
    async post(url, fields) { calls.push(['POST', url, fields]); return { status: 200, html: JSON.stringify({ result: fields.actsrc === '2' ? '//www.imot.bg/search/naemi/grad-sofiya' : result }) }; },
  };
}

test('ImotSearch.form: reads the live form once, then serves it from the cache', async () => {
  const fetcher = fakeFetcher();
  const s = new ImotSearch({ fetcher });
  const a = await s.form('sale');
  const b = await s.form('sale');
  assert.equal(a, b);
  assert.deepEqual(fetcher.calls, [['GET', 'https://www.imot.bg/search/prodazhbi']]);
  const sofia = await s.form('rent', 'град София');
  assert.equal(sofia.deal, 'rent');
  assert.ok(sofia.districts.includes('Лозенец'));
  assert.deepEqual(fetcher.calls.slice(1).map((c) => c.slice(0, 2)), [
    ['GET', 'https://www.imot.bg/search/naemi'],
    ['POST', 'https://www.imot.bg/pcgi/subscript.cgi'],
    ['GET', 'https://www.imot.bg/search/naemi/grad-sofiya'],
  ]);
  await assert.rejects(s.form('rent', 'Атлантида'), { status: 400 });
  await assert.rejects(s.form('swap'), { status: 400 });
});

test('ImotSearch.searchUrl: returns the search link imot.bg builds', async () => {
  const fetcher = fakeFetcher();
  const url = await new ImotSearch({ fetcher }).searchUrl({ deal: 'sale', types: ['2'], location: 'град София' });
  assert.equal(url, 'https://www.imot.bg/obiavi/prodazhbi/grad-sofiya/dvustaen?type_home=3%7E'); // normalised like pasted links
  assert.deepEqual(fetcher.calls[0][2], { act: '15', actsrc: '3', rub: '1', f1: '1', f7: '2~', f38: 'град София' });
  await assert.rejects(new ImotSearch({ fetcher: fakeFetcher({ result: 0 }) }).searchUrl({}), /did not return a search address/);
  await assert.rejects(new ImotSearch({ fetcher: fakeFetcher({ result: '//evil.example/obiavi/x' }) }).searchUrl({}), /did not return a search address/);
  await assert.rejects(new ImotSearch({ fetcher: fakeFetcher({ result: '//www.imot.bg/obiava-1j1-x' }) }).searchUrl({}), /unexpected address/);
});
