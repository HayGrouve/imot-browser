import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  classifyUrl, parseSearchPage, parseDetailPage, parseLocation, parseInfoLine, parseConstruction,
  fieldsFromParams, searchPageUrl, withPriceRange, getPriceRange, parseBgDate, bigPhotoUrl,
} from '../lib/parse.mjs';
import { splitRange, mergeDetail } from '../lib/importer.mjs';
import { transliterate, searchKey } from '../shared/text.mjs';
import { classifyTitle } from '../shared/vocab.mjs';

const fixture = (name) => new TextDecoder('windows-1251').decode(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

test('session-bound plnk parameter is stripped from search links', () => {
  const r = classifyUrl('https://www.imot.bg/obiavi/prodazhbi/oblast-sofiya/kashta?price_min=55000&price_max=185000&plnk=625984');
  assert.equal(r.kind, 'search');
  assert.equal(r.url, 'https://www.imot.bg/obiavi/prodazhbi/oblast-sofiya/kashta?price_min=55000&price_max=185000');
  assert.deepEqual(r.notes, ['removed:plnk']);
});

test('link classification', () => {
  assert.equal(classifyUrl('imot.bg/obiava-1j177909167696419-prodava-kashta').kind, 'listing');
  assert.equal(classifyUrl('imot.bg/obiava-1j177909167696419-prodava-kashta').id, '1j177909167696419');
  assert.equal(classifyUrl('https://www.imot.bg/pcgi/imot.cgi?act=5&adv=1a176916093559927').id, '1a176916093559927');
  const mobile = classifyUrl('https://m.imot.bg/obiavi/naemi/grad-plovdiv/p-3');
  assert.equal(mobile.url, 'https://www.imot.bg/obiavi/naemi/grad-plovdiv');
  assert.deepEqual(classifyUrl('https://www.imot.bg/pcgi/imot.cgi?act=3&slink=abc').notes, ['legacySessionSearch']);
  assert.deepEqual(classifyUrl('https://www.imot.bg/obiava-8739-zhilishten-kompleks').notes, ['newBuildingAd']);
  assert.deepEqual(classifyUrl('https://example.com/obiavi/x').notes, ['notImotBg']);
});

test('pagination and price-band URL helpers', () => {
  const base = 'https://www.imot.bg/obiavi/prodazhbi/oblast-sofiya/kashta?price_min=55000&price_max=185000';
  assert.equal(searchPageUrl(base, 3), 'https://www.imot.bg/obiavi/prodazhbi/oblast-sofiya/kashta/p-3?price_min=55000&price_max=185000');
  assert.equal(searchPageUrl(base, 1), base);
  assert.deepEqual(getPriceRange(base), { min: 55000, max: 185000 });
  assert.equal(withPriceRange(base, 55000, 120000), 'https://www.imot.bg/obiavi/prodazhbi/oblast-sofiya/kashta?price_min=55000&price_max=120000');
  assert.equal(withPriceRange(base, 120000, null), 'https://www.imot.bg/obiavi/prodazhbi/oblast-sofiya/kashta?price_min=120000');
});

test('splitRange halves closed bands and grows open ones', () => {
  assert.deepEqual(splitRange(0, 100), [[0, 50], [50, 100]]);
  assert.deepEqual(splitRange(0, null), [[0, 100000], [100000, null]]);
  assert.deepEqual(splitRange(200000, null), [[200000, 400000], [400000, null]]);
  assert.equal(splitRange(10, 11), null);
});

test('search page: totals, cards and fields', () => {
  const page = parseSearchPage(fixture('search-page.html'));
  assert.equal(page.total, 539);
  assert.equal(page.capped, false);
  assert.equal(page.items.length, 40);
  assert.equal(page.hasNext, true);
  assert.match(page.paramsText, /КЪЩА/);
  for (const item of page.items) {
    assert.match(item.id, /^\d[a-z]\d+$/);
    assert.match(item.url, /^https:\/\/www\.imot\.bg\/obiava-/);
    assert.equal(item.type, 'house');
    assert.equal(item.deal, 'sale');
    assert.ok(item.price > 0, `price for ${item.id}`);
    assert.equal(item.currency, 'EUR');
    assert.ok(item.area > 0, `area for ${item.id}`);
    assert.equal(item.oblast, 'София');
    assert.ok(item.settlement);
  }
  const godech = page.items.find((i) => i.id === '1j179135523412065');
  assert.equal(godech.settlement, 'Годеч');
  assert.equal(godech.settlementKind, 'town');
  assert.equal(godech.yard, 540);
  assert.equal(godech.yearFrom, 1970);
  assert.equal(godech.agency.name, 'ИМОТИ ВАСИЛЕВ ТМ');
  assert.equal(godech.promo, 'TOP');
});

test('search page: last page and over-limit page', () => {
  const last = parseSearchPage(fixture('search-last-page.html'));
  assert.equal(last.items.length, 19);
  assert.equal(last.hasNext, false);
  assert.equal(last.to, 539);
  const over = parseSearchPage(fixture('search-over-limit.html'));
  assert.equal(over.capped, true);
  assert.equal(over.overLimit, true);
  assert.equal(over.items.length, 0);
});

test('detail page fields', () => {
  const d = parseDetailPage(fixture('detail-page.html'));
  assert.equal(d.id, '1j177909167696419');
  assert.equal(d.price, 66000);
  assert.equal(d.pricePerM2, 1015);
  assert.equal(d.area, 65);
  assert.equal(d.yard, 2765);
  assert.equal(d.material, 'Тухла');
  assert.equal(d.status, 'completed');
  assert.equal(d.yearFrom, 1970);
  assert.equal(d.updatedAt, '2026-10-11T14:35');
  assert.equal(d.views, 539);
  assert.equal(d.broker, 'Благовест Балдев');
  assert.equal(d.agency.name, 'СОФИЯ ИМОТИ');
  assert.equal(d.phone, '0889866507');
  assert.equal(d.photos.length, 12);
  assert.ok(d.photos.every((p) => p.includes('/big1/1j177909167696419_')));
  assert.match(d.description, /старопланинското селце Бов/);
  assert.deepEqual(d.features, ['Тухла']);
  assert.equal(d.settlement, 'Гара Бов');
});

test('locations in card, detail and big-city formats', () => {
  assert.deepEqual(parseLocation('гр. Своге, област София'), { oblast: 'София', settlement: 'Своге', settlementKind: 'town', neighborhood: null });
  assert.deepEqual(parseLocation('област София, Гара Бов'), { oblast: 'София', settlement: 'Гара Бов', settlementKind: 'other', neighborhood: null });
  assert.deepEqual(parseLocation('град София, Дружба 2'), { oblast: 'София-град', settlement: 'София', settlementKind: 'city', neighborhood: 'Дружба 2' });
  assert.deepEqual(parseLocation('град Пловдив, Каменица 1'), { oblast: 'Пловдив', settlement: 'Пловдив', settlementKind: 'city', neighborhood: 'Каменица 1' });
  assert.equal(parseLocation('м-т Мечката, област София').settlementKind, 'locality');
});

test('info line: structured prefix, description and phone', () => {
  const r = parseInfoLine('180 кв.м, двор 750 кв.м, с.Лопян, 2 ет. от 2, Лок.отопл., Въведен в експлоатация 2015 г., Тухла, Обзаведен ..., тел.: 0889195472');
  assert.equal(r.area, 180);
  assert.equal(r.yard, 750);
  assert.equal(r.phone, '0889195472');
  assert.match(r.description, /с\.Лопян/);
  const apt = parseInfoLine('66 кв.м, 3-ти ет. от 5, Газ, Въведен в експлоатация 2026 г., Готова сграда с Акт 16 ...');
  assert.equal(apt.floorNum, 3);
  assert.equal(apt.floorsTotal, 5);
  assert.equal(apt.heating, 'Газ');
  assert.equal(apt.yearTo, 2026);
});

test('parameter grid: empty yard is not read from the "m2" unit', () => {
  const f = fieldsFromParams({ 'Площ': '90 m2', 'Двор': '--- m2', 'ТЕЦ': 'Лок.отопл.', 'Строителство': 'Тухла, 1950 - 1959 г.' });
  assert.equal(f.area, 90);
  assert.equal(f.yard, null);
  assert.equal(f.heating, 'Лок.отопл.');
  assert.equal(f.yearFrom, 1950);
  assert.equal(f.yearTo, 1959);
  assert.equal(parseConstruction('Сглобяема конструкция, Въведен в експлоатация').material, 'Сглобяема конструкция');
});

test('mergeDetail keeps the structured card location', () => {
  const merged = mergeDetail({ title: 'Продава КЪЩА', settlement: 'Етрополе', settlementKind: 'town', price: 1 },
    { settlement: 'Етрополе', settlementKind: 'town', address: 'с.Лопян', price: 2, agency: null });
  assert.equal(merged.address, 'с.Лопян');
  assert.equal(merged.price, 2);
  assert.equal(merged.settlementKind, 'town');
});

test('misc helpers', () => {
  assert.equal(parseBgDate('Публикувана в 9:05 на 1 септември, 2026 год.'), '2026-09-01T09:05');
  assert.equal(bigPhotoUrl('https://imotstatic3.focus.bg/imot/photosimotbg/1/419/1j1_uW.jpg'), 'https://imotstatic3.focus.bg/imot/photosimotbg/1/419/big1/1j1_uW.jpg');
  assert.equal(bigPhotoUrl('https://imotstatic3.focus.bg/imot/photosimotbg/1/419//big1/1j1_uW.jpg'), 'https://imotstatic3.focus.bg/imot/photosimotbg/1/419/big1/1j1_uW.jpg');
  // Older ads: ".pic" files, large size under /big/ (big1 is 404 for these).
  assert.equal(bigPhotoUrl('https://imotstatic2.focus.bg/imot/photosimotbg/1/902//big/1j143101552165902_4.pic'), 'https://imotstatic2.focus.bg/imot/photosimotbg/1/902/big/1j143101552165902_4.pic');
  assert.equal(bigPhotoUrl('https://imotstatic2.focus.bg/imot/photosimotbg/1/902/1j143101552165902_4.pic'), 'https://imotstatic2.focus.bg/imot/photosimotbg/1/902/big/1j143101552165902_4.pic');
  assert.equal(transliterate('София'), 'Sofia');
  assert.equal(transliterate('Гълъбовци'), 'Galabovtsi');
  assert.equal(transliterate('Щъркелово'), 'Shtarkelovo');
  assert.equal(searchKey('Бов'), searchKey('bov'));
  assert.deepEqual(classifyTitle('Дава под Наем 2-СТАЕН'), { deal: 'rent', type: 'apt2', typeBg: '2-СТАЕН' });
});

test('photos on the cdn3.focus.bg host are picked up too', () => {
  const card = `<div class="item VIP " id="ida1b178092205889992"><div class="photo"><div class="big"><a href="//www.imot.bg/obiava-1b178092205889992-x" class="image saveSlink"><img src="//cdn3.focus.bg/imot/photosimotbg/1/992/1b178092205889992_3s.jpg" class="pic"></a></div></div>
<div class="text"><div class="zaglavie"><a href="//www.imot.bg/obiava-1b178092205889992-x" class="title saveSlink">Продава 2-СТАЕН<location>град София, с. Бистрица</location></a><div class="price "><div>99 000 €</div></div><div class="like"></div></div><div class="info">60 кв.м</div></div></div>`;
  const [item] = parseSearchPage(card).items;
  assert.equal(item.thumb, 'https://cdn3.focus.bg/imot/photosimotbg/1/992/1b178092205889992_3s.jpg');
  assert.equal(item.photos[0], 'https://cdn3.focus.bg/imot/photosimotbg/1/992/big1/1b178092205889992_3s.jpg');
  const detail = parseDetailPage(`<div class="obTitle"><h1>Продава 2-СТАЕН <div>град София, с. Бистрица</div><span>Обява: 1b178092205889992</span></h1></div>
<img src="//cdn3.focus.bg/imot/photosimotbg/1/992//big/1b178092205889992_3s.jpg"><img src="//cdn3.focus.bg/imot/photosimotbg/1/992/1b178092205889992_iY.jpg">`);
  assert.deepEqual(detail.photos, [
    'https://cdn3.focus.bg/imot/photosimotbg/1/992/big1/1b178092205889992_3s.jpg',
    'https://cdn3.focus.bg/imot/photosimotbg/1/992/big1/1b178092205889992_iY.jpg',
  ]);
});

test('detail photos: .pic files and a photo prefix that differs from the listing ID', () => {
  const page = (id, imgs) => `<div class="obTitle"><h1>Продава КЪЩА <div>област София, с. Свидня</div><span>Обява: ${id}</span></h1></div>${imgs}`;
  const pic = parseDetailPage(page('1j143101552165902',
    '<img src="//imotstatic2.focus.bg/imot/photosimotbg/1/902//big/1j143101552165902_4.pic"><img src="//cdn3.focus.bg/imot/photosimotbg/1/023/1j178421042948023_JU.jpg">'));
  assert.deepEqual(pic.photos, ['https://imotstatic2.focus.bg/imot/photosimotbg/1/902/big/1j143101552165902_4.pic']);
  const prefix = parseDetailPage(page('1j178264425726187', '<img src="//cdn3.focus.bg/imot/photosimotbg/1/187/1k178264425726187_1n.jpg">'));
  assert.deepEqual(prefix.photos, ['https://cdn3.focus.bg/imot/photosimotbg/1/187/big1/1k178264425726187_1n.jpg']);
});
