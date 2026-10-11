// imot.bg browser — UI. Works against the local server (/api/*) or, in an
// exported standalone file, against data embedded as window.__IMOT_DATA__.

import { searchKey, transliterate, median } from '/shared/text.mjs';
import { PROPERTY_TYPES, DEALS, typeLabel, dealLabel, term, CONSTRUCTION_STATUS } from '/shared/vocab.mjs';
import { t, setLang, getLang } from './i18n.mjs';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const STORE_KEY = 'imot-browser:';
const EMBEDDED = window.__IMOT_DATA__ || null;
const EUR_PER_BGN = 1 / 1.95583;
const MARKER_RAMP = ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#104281']; // ordinal blue, validated (dataviz)
const PAGE_SIZES = [25, 50, 100, 250];

// ---------------------------------------------------------------- persistence

function loadJson(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(STORE_KEY + key)); return v ?? fallback; } catch { return fallback; }
}
function saveJson(key, value) {
  try { localStorage.setItem(STORE_KEY + key, JSON.stringify(value)); } catch { /* private mode / quota */ }
}

const DEFAULT_FILTERS = { q: '', deal: '', type: '', oblast: '', place: '', priceMin: null, priceMax: null, areaMin: null, areaMax: null, yardMin: null, starred: false, onlyNew: false, hideStale: false, unmapped: false };
const ui = {
  lang: null, sort: { key: 'price', dir: 1 }, pageSize: 50, groupMode: 'settlement', baseLayer: 'map',
  ...loadJson('ui', {}),
};
ui.filters = { ...DEFAULT_FILTERS, ...(ui.filters || {}) };
// Older versions filtered unmapped listings through the place dropdown.
if (ui.filters.place === '__none') { ui.filters.place = ''; ui.filters.unmapped = true; }
const stars = new Set(loadJson('stars', []));
const notes = loadJson('notes', {});
let saveUiTimer = null;
function saveUi() {
  clearTimeout(saveUiTimer);
  saveUiTimer = setTimeout(() => saveJson('ui', ui), 200);
}

const S = {
  listings: [], byId: new Map(), sources: {}, filtered: [], page: 1,
  map: null, layer: null, markerByKey: new Map(), groups: [], fitted: false,
  job: null, pollTimer: null, lastPhase: null,
  detailId: null, photoIdx: 0, readOnly: !!EMBEDDED,
};

// ---------------------------------------------------------------- helpers

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
// Only ever render links/images that point at imot.bg or its photo CDN.
const safeUrl = (u) => (typeof u === 'string' && /^https:\/\/([a-z0-9-]+\.)*(imot\.bg|focus\.bg)(\/|$)/i.test(u) ? u : null);
const locale = () => (getLang() === 'bg' ? 'bg-BG' : 'en-GB');
const fmtNum = (n, digits = 0) => (n == null || !Number.isFinite(n) ? '' : new Intl.NumberFormat(locale(), { maximumFractionDigits: digits }).format(n));
const fmtMoney = (n, currency = 'EUR') => (n == null || !Number.isFinite(n) ? ''
  : new Intl.NumberFormat(locale(), { style: 'currency', currency, maximumFractionDigits: 0 }).format(n));
const fmtDate = (iso, withTime = false) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric', ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}) });
};
const thumbOf = (url) => (url ? url.replace(/\/big1?\//, '/') : null);
/** Small photo for a listing (search-card thumbnail, else the first gallery photo scaled down). */
const thumbFor = (l) => safeUrl(l.thumb) || safeUrl(thumbOf(l.photos?.[0]));

const KIND_PREFIX_BG = { city: 'гр.', town: 'гр.', village: 'с.', resort: 'к.к.', locality: 'м-т', villaZone: 'в.з.' };
const KIND_EN = { city: 'city', town: 'town', village: 'village', resort: 'resort', locality: 'locality', villaZone: 'villa zone' };

function oblastLabel(o) {
  if (!o) return '';
  if (getLang() === 'bg') return o === 'София-град' ? 'София-град' : `обл. ${o}`;
  if (o === 'София-град') return 'Sofia City';
  if (o === 'София') return 'Sofia Province';
  return `${transliterate(o)} Province`;
}

function placeName(name, kind, nameEn) {
  if (!name) return '';
  if (getLang() === 'bg') return KIND_PREFIX_BG[kind] ? `${KIND_PREFIX_BG[kind]} ${name}` : name;
  return nameEn || transliterate(name);
}

function listingPlace(l) {
  const p = l.place;
  return p ? placeName(p.name, p.kind, p.nameEn) : placeName(l.settlement, l.settlementKind);
}

function hoodName(n) { return getLang() === 'bg' ? n : transliterate(n); }

function typeValue(l) { return l.type === 'other' ? `other:${l.typeBg || ''}` : l.type; }

function floorText(l) {
  if (l.floorNum == null) return l.floor ? (getLang() === 'bg' ? l.floor : term(l.floor, 'en')) : '';
  const f = l.floorNum === 0 ? (getLang() === 'bg' ? 'партер' : 'G') : l.floorNum === -1 ? (getLang() === 'bg' ? 'сутерен' : 'B') : String(l.floorNum);
  return l.floorsTotal ? `${f}/${l.floorsTotal}` : f;
}

function yearText(l) {
  if (l.yearFrom && l.yearTo && l.yearFrom !== l.yearTo) return `${l.yearFrom}–${String(l.yearTo).slice(-2)}`;
  return l.yearTo || l.yearFrom || '';
}

// ---------------------------------------------------------------- data

function prepare(l) {
  l._eur = l.price == null ? null : l.currency === 'BGN' ? Math.round(l.price * EUR_PER_BGN) : l.currency === 'USD' ? null : l.price;
  l._ppm = l.pricePerM2 ?? (l._eur && l.area ? Math.round(l._eur / l.area) : null);
  l._year = l.yearTo ?? l.yearFrom ?? null;
  const real = (l.sources || []).filter((s) => s !== 'manual' && S.sources[s]);
  l._stale = real.length > 0 && real.every((s) => S.sources[s].lastImportAt > l.lastSeen);
  l._new = real.some((s) => S.sources[s].prevImportAt && l.firstSeen === S.sources[s].lastImportAt);
  const hist = l.priceHistory || [];
  l._priceDelta = hist.length > 1 && hist[0].price ? hist[hist.length - 1].price - hist[0].price : 0;
  l._search = searchKey([
    l.id, l.title, l.typeBg, typeLabel(l.type, l.typeBg, 'en'), l.locationRaw, l.settlement, l.place?.name, l.place?.nameEn,
    l.place?.municipality, l.neighborhood, l.address, l.oblast, l.agency?.name, l.broker, l.phone,
    (l.phone || '').replace(/\D/g, ''), (l.features || []).join(' '), (l.features || []).map((f) => term(f, 'en')).join(' '),
    l.description,
  ].filter(Boolean).join(' '));
}

function setData(payload) {
  S.sources = payload.sources || {};
  S.listings = payload.listings || [];
  S.byId = new Map(S.listings.map((l) => [l.id, l]));
  for (const l of S.listings) prepare(l);
  renderFilterOptions();
  applyFilters();
  renderStats();
  renderSources();
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

async function reload() {
  if (S.readOnly) return;
  setData(await api('/api/listings'));
}

// ---------------------------------------------------------------- filtering & sorting

function groupOf(l, mode = ui.groupMode) {
  const p = l.place;
  if (!p || p.lat == null) return null;
  if (mode === 'neighborhood' && l.nbhd && l.nbhd.lat != null) {
    return { key: `nb:${p.key}|${l.nbhd.name}`, lat: l.nbhd.lat, lon: l.nbhd.lon, hood: l.nbhd.name, place: p };
  }
  return { key: p.key, lat: p.lat, lon: p.lon, place: p };
}

/** No coordinates at all (not even the settlement could be located), so the listing is not on the map. */
const isUnmapped = (l) => !l.place || l.place.lat == null;

function matchesPlace(l, key) {
  if (key.startsWith('nb:')) return groupOf(l, 'neighborhood')?.key === key;
  return l.place?.key === key;
}

const num = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));

function applyFilters({ keepPage = false } = {}) {
  const f = ui.filters;
  const terms = searchKey(f.q).split(' ').filter(Boolean);
  const pMin = num(f.priceMin); const pMax = num(f.priceMax);
  const aMin = num(f.areaMin); const aMax = num(f.areaMax); const yMin = num(f.yardMin);
  S.filtered = S.listings.filter((l) => {
    if (f.deal && l.deal !== f.deal) return false;
    if (f.type && typeValue(l) !== f.type) return false;
    if (f.oblast && l.oblast !== f.oblast) return false;
    if (f.place && !matchesPlace(l, f.place)) return false;
    if (pMin != null && !(l._eur >= pMin)) return false;
    if (pMax != null && !(l._eur != null && l._eur <= pMax)) return false;
    if (aMin != null && !(l.area >= aMin)) return false;
    if (aMax != null && !(l.area != null && l.area <= aMax)) return false;
    if (yMin != null && !(l.yard >= yMin)) return false;
    if (f.starred && !stars.has(l.id)) return false;
    if (f.onlyNew && !l._new) return false;
    if (f.hideStale && l._stale) return false;
    if (f.unmapped && !isUnmapped(l)) return false;
    for (const term_ of terms) if (!l._search.includes(term_)) return false;
    return true;
  });
  sortFiltered();
  const pages = Math.max(1, Math.ceil(S.filtered.length / ui.pageSize));
  S.page = keepPage ? Math.min(S.page, pages) : 1;
  renderTable();
  renderMap();
  renderResultBar();
  saveUi();
}

const SORT_KEYS = {
  type: (l) => typeLabel(l.type, l.typeBg, getLang()),
  place: (l) => listingPlace(l),
  price: (l) => l._eur,
  ppm: (l) => l._ppm,
  area: (l) => l.area,
  yard: (l) => l.yard,
  floor: (l) => l.floorNum,
  year: (l) => l._year,
  seller: (l) => l.agency?.name || null,
  updated: (l) => l.updatedAt || l.firstSeen,
};

function sortFiltered() {
  const get = SORT_KEYS[ui.sort.key] || SORT_KEYS.price;
  const dir = ui.sort.dir;
  const collator = new Intl.Collator(locale(), { numeric: true, sensitivity: 'base' });
  S.filtered.sort((a, b) => {
    const va = get(a); const vb = get(b);
    const na = va == null || va === ''; const nb = vb == null || vb === '';
    if (na || nb) return na === nb ? 0 : na ? 1 : -1; // empty values always last
    const c = typeof va === 'number' && typeof vb === 'number' ? va - vb : collator.compare(String(va), String(vb));
    return c * dir || a.id.localeCompare(b.id);
  });
}

// ---------------------------------------------------------------- rendering: header & filters

function applyI18n() {
  document.documentElement.lang = getLang();
  for (const el of $$('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of $$('[data-i18n-placeholder]')) el.placeholder = t(el.dataset.i18nPlaceholder);
  for (const el of $$('[data-i18n-title]')) { el.title = t(el.dataset.i18nTitle); el.setAttribute('aria-label', el.title); }
  for (const el of $$('[data-i18n-html]')) el.innerHTML = t(el.dataset.i18nHtml); // trusted, static strings only
  $('#btnLang').textContent = t('langToggle');
  $('#btnLang').title = t('langToggleTitle');
  document.title = t('appTitle');
  if (S.readOnly) {
    const banner = $('#banner');
    banner.hidden = false;
    banner.textContent = t('readOnlyBanner', { date: fmtDate(EMBEDDED.exportedAt, true) });
  }
}

function renderStats() {
  const places = new Set(S.listings.map((l) => l.place?.key).filter(Boolean));
  $('#stats').textContent = S.listings.length
    ? `${t('listingsCount', { n: fmtNum(S.listings.length) })} · ${t('placesCount', { n: fmtNum(places.size) })}`
    : '';
}

function countBy(list, fn) {
  const m = new Map();
  for (const x of list) { const k = fn(x); if (k == null || k === '') continue; m.set(k, (m.get(k) || 0) + 1); }
  return m;
}

function setOptions(select, allLabel, entries, value) {
  select.innerHTML = `<option value="">${esc(allLabel)}</option>`
    + entries.map(([v, label, n]) => `<option value="${esc(v)}">${esc(label)}${n != null ? ` (${fmtNum(n)})` : ''}</option>`).join('');
  select.value = entries.some(([v]) => v === value) ? value : '';
}

function renderFilterOptions() {
  const f = ui.filters;
  const lang = getLang();
  const deals = countBy(S.listings, (l) => l.deal);
  setOptions($('#fDeal'), t('allDeals'),
    [...deals].map(([k, n]) => [k, dealLabel(k, lang), n]), f.deal);
  $('#fDeal').hidden = deals.size < 2 && !f.deal;

  const order = new Map(PROPERTY_TYPES.map((p, i) => [p.key, i]));
  const types = countBy(S.listings, typeValue);
  setOptions($('#fType'), t('allTypes'),
    [...types].sort((a, b) => (order.get(a[0]) ?? 99) - (order.get(b[0]) ?? 99))
      .map(([k, n]) => [k, k.startsWith('other:') ? k.slice(6) : typeLabel(k, '', lang), n]), f.type);

  const oblasts = countBy(S.listings, (l) => l.oblast);
  setOptions($('#fOblast'), t('allOblasts'), [...oblasts].sort((a, b) => b[1] - a[1]).map(([k, n]) => [k, oblastLabel(k), n]), f.oblast);
  $('#fOblast').hidden = oblasts.size < 2 && !f.oblast;

  const places = new Map();
  for (const l of S.listings) {
    if (isUnmapped(l)) continue; // covered by the "Not on map" toggle
    const k = l.place.key;
    const e = places.get(k) || { n: 0, label: listingPlace(l) };
    e.n++; places.set(k, e);
  }
  const collator = new Intl.Collator(locale());
  setOptions($('#fPlace'), t('allPlaces'),
    [...places].sort((a, b) => collator.compare(a[1].label, b[1].label))
      .map(([k, e]) => [k, e.label, e.n]), f.place.startsWith('nb:') ? '' : f.place);

  $('#fQ').value = f.q;
  for (const [id, key] of [['#fPriceMin', 'priceMin'], ['#fPriceMax', 'priceMax'], ['#fAreaMin', 'areaMin'], ['#fAreaMax', 'areaMax'], ['#fYardMin', 'yardMin']]) {
    $(id).value = f[key] ?? '';
  }
  $('#fStarred').checked = f.starred;
  $('#fNew').checked = f.onlyNew;
  $('#fHideStale').checked = f.hideStale;
  $('#fNewWrap').hidden = !S.listings.some((l) => l._new) && !f.onlyNew;
  $('#fStaleWrap').hidden = !S.listings.some((l) => l._stale) && !f.hideStale;
  const unmappedCount = S.listings.filter(isUnmapped).length;
  $('#fUnmapped').checked = f.unmapped;
  $('#fUnmappedLabel').textContent = t('onlyUnmapped', { n: fmtNum(unmappedCount) });
  $('#fUnmappedWrap').hidden = !unmappedCount && !f.unmapped;
  $('#fUnmappedWrap').title = t('onlyUnmappedTitle');
}

function renderResultBar() {
  $('#count').textContent = t('showing', { shown: fmtNum(S.filtered.length), total: fmtNum(S.listings.length) });
  const chip = $('#placeChip');
  const key = ui.filters.place;
  if (!key) { chip.hidden = true; return; }
  let label = $('#fPlace').selectedOptions[0]?.textContent || '';
  if (key.startsWith('nb:')) {
    const l = S.listings.find((x) => matchesPlace(x, key));
    label = l ? `${hoodName(l.nbhd.name)}, ${listingPlace(l)}` : key;
  }
  chip.hidden = false;
  chip.innerHTML = `${esc(t('placeChip', { name: label.replace(/\s\(\S+\)$/, '') }))} <button type="button" class="chip-x" data-clear-place title="${esc(t('clearPlace'))}" aria-label="${esc(t('clearPlace'))}">×</button>`;
}

// ---------------------------------------------------------------- rendering: table

const COLUMNS = [
  { key: 'star', cls: 'c-star' },
  { key: 'photo', cls: 'c-photo' },
  { key: 'type', label: 'colType', sortable: true, cls: 'c-type' },
  { key: 'place', label: 'colPlace', sortable: true, cls: 'c-place' },
  { key: 'price', label: 'colPrice', sortable: true, num: true, cls: 'c-price' },
  { key: 'ppm', label: 'colPpm', sortable: true, num: true, cls: 'c-ppm' },
  { key: 'area', label: 'colArea', sortable: true, num: true, cls: 'c-area' },
  { key: 'yard', label: 'colYard', sortable: true, num: true, cls: 'c-yard' },
  { key: 'floor', label: 'colFloor', sortable: true, num: true, cls: 'c-floor' },
  { key: 'year', label: 'colYear', sortable: true, num: true, cls: 'c-year' },
  { key: 'seller', label: 'colSeller', sortable: true, cls: 'c-seller' },
  { key: 'updated', label: 'colUpdated', sortable: true, cls: 'c-upd' },
  { key: 'link', cls: 'c-link' },
];

function renderHead() {
  $('#table thead').innerHTML = `<tr>${COLUMNS.map((c) => {
    if (!c.sortable) return `<th class="${c.cls || ''}" scope="col"><span class="sr-only">${esc(c.key)}</span></th>`;
    const active = ui.sort.key === c.key;
    const aria = active ? (ui.sort.dir > 0 ? 'ascending' : 'descending') : 'none';
    return `<th scope="col" class="${c.cls} ${c.num ? 'num' : ''}" aria-sort="${aria}"><button type="button" class="sort ${active ? 'active' : ''}" data-sort="${c.key}">${esc(t(c.label))}<span class="arrow" aria-hidden="true">${active ? (ui.sort.dir > 0 ? '▲' : '▼') : '↕'}</span></button></th>`;
  }).join('')}</tr>`;
}

function sellerText(l) {
  if (l.agency?.name) return l.agency.name;
  return l.detailsFetchedAt ? t('private') : t('unknownSeller');
}

function rowHtml(l) {
  const starred = stars.has(l.id);
  const thumb = thumbFor(l);
  const url = safeUrl(l.url);
  const lang = getLang();
  const viaHood = l.place?.via === 'neighborhood';
  const sub = [!viaHood && (l.nbhd?.name || l.neighborhood) ? hoodName(l.nbhd?.name || l.neighborhood) : null,
    l.place?.municipality && l.place.name !== l.settlement ? placeName(l.settlement, l.settlementKind) : null,
    !l.neighborhood && l.place?.kind && lang === 'en' ? KIND_EN[l.place.kind] : null,
    oblastLabel(l.oblast)].filter(Boolean).join(' · ');
  const trend = l.priceTrend === 'down' ? `<span class="trend down" title="${esc(t('priceDown'))}" aria-label="${esc(t('priceDown'))}">▼</span>`
    : l.priceTrend === 'up' ? `<span class="trend up" title="${esc(t('priceUp'))}" aria-label="${esc(t('priceUp'))}">▲</span>` : '';
  const badges = [l._new ? `<span class="badge new">${esc(t('badgeNew'))}</span>` : '',
    l._stale ? `<span class="badge stale" title="${esc(t('badgeStale'))}">${esc(t('badgeStale'))}</span>` : '',
    !l.place ? `<span class="badge nomap">${esc(t('notOnMap'))}</span>` : ''].join('');
  const price = l.price != null ? fmtMoney(l.price, l.currency || 'EUR') : (l.priceOnRequest ? t('priceOnRequest') : '');
  const exVat = l.vatNote === 'Цената е без ДДС' ? `<div class="secondary" title="${esc(t('exVatTitle'))}">${esc(t('exVat'))}</div>` : '';
  return `<tr data-id="${esc(l.id)}" class="${l._stale ? 'is-stale' : ''}" tabindex="0">
<td class="c-star"><button type="button" class="star ${starred ? 'on' : ''}" data-star="${esc(l.id)}" aria-pressed="${starred}" title="${esc(t(starred ? 'unstar' : 'star'))}" aria-label="${esc(t(starred ? 'unstar' : 'star'))}">${starred ? '★' : '☆'}</button></td>
<td class="c-photo">${thumb ? `<img loading="lazy" src="${esc(thumb)}" alt="" width="64" height="48">` : '<span class="nophoto" aria-hidden="true"></span>'}</td>
<td class="c-type" title="${esc(typeLabel(l.type, l.typeBg, lang))}"><div class="primary">${esc(typeLabel(l.type, l.typeBg, lang, true))}</div><div class="secondary">${esc(dealLabel(l.deal, lang))}${badges}</div></td>
<td class="c-place"><div class="primary">${esc(listingPlace(l))}</div><div class="secondary">${esc(sub)}</div></td>
<td class="num c-price"><span class="price">${esc(price)}</span>${trend}${exVat}</td>
<td class="num c-ppm">${esc(fmtNum(l._ppm))}</td>
<td class="num c-area">${esc(fmtNum(l.area))}</td>
<td class="num c-yard">${esc(fmtNum(l.yard))}</td>
<td class="num c-floor">${esc(floorText(l))}</td>
<td class="num c-year">${esc(yearText(l))}</td>
<td class="c-seller" title="${esc(sellerText(l))}">${esc(sellerText(l))}</td>
<td class="c-upd">${esc(fmtDate(l.updatedAt || l.firstSeen))}</td>
<td class="c-link">${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer" title="${esc(t('openOriginal'))}" aria-label="${esc(t('openOriginal'))}">↗</a>` : ''}</td>
</tr>`;
}

function renderTable() {
  renderHead();
  const start = (S.page - 1) * ui.pageSize;
  const rows = S.filtered.slice(start, start + ui.pageSize);
  $('#table tbody').innerHTML = rows.map(rowHtml).join('');
  const empty = $('#emptyMsg');
  empty.hidden = rows.length > 0;
  empty.textContent = S.listings.length ? t('emptyFiltered') : (S.readOnly ? '' : t('empty'));
  renderPager();
}

function renderPager() {
  const pages = Math.max(1, Math.ceil(S.filtered.length / ui.pageSize));
  $('#pager').innerHTML = `
<button type="button" class="btn small" data-page="prev" ${S.page <= 1 ? 'disabled' : ''} aria-label="${esc(t('prevPage'))}">‹</button>
<span>${esc(t('pageOf', { page: fmtNum(S.page), pages: fmtNum(pages) }))}</span>
<button type="button" class="btn small" data-page="next" ${S.page >= pages ? 'disabled' : ''} aria-label="${esc(t('nextPage'))}">›</button>
<label class="pagesize">${esc(t('pageSize'))}
<select id="pageSize">${PAGE_SIZES.map((n) => `<option ${n === ui.pageSize ? 'selected' : ''}>${n}</option>`).join('')}</select></label>`;
}

// ---------------------------------------------------------------- rendering: map

// Base maps — free tile services that need no API key (Google's tiles may only be used via its API).
const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';
const ESRI_REF = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference';
const BASE_LAYERS = {
  map: {
    label: 'layerMap', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    opts: { maxNativeZoom: 19, attribution: OSM_ATTR },
  },
  satellite: {
    label: 'layerSatellite', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    opts: { maxNativeZoom: 18, attribution: 'Imagery &copy; <a href="https://www.esri.com" target="_blank" rel="noopener">Esri</a>, Maxar, Earthstar Geographics' },
    // Roads and place names on top of the imagery, like Google's satellite view.
    overlays: [`${ESRI_REF}/World_Transportation/MapServer/tile/{z}/{y}/{x}`, `${ESRI_REF}/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`],
  },
  terrain: {
    label: 'layerTerrain', url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    opts: { subdomains: 'abc', maxNativeZoom: 17, attribution: `${OSM_ATTR}, SRTM · style &copy; <a href="https://opentopomap.org" target="_blank" rel="noopener">OpenTopoMap</a> (CC-BY-SA)` },
  },
  light: {
    label: 'layerLight', url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    opts: { subdomains: 'abcd', maxNativeZoom: 20, attribution: `${OSM_ATTR} &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>` },
  },
};

function setBaseLayer(key) {
  const name = BASE_LAYERS[key] ? key : 'map';
  const def = BASE_LAYERS[name];
  for (const l of S.base || []) S.map.removeLayer(l);
  S.base = [
    L.tileLayer(def.url, { maxZoom: 18, zIndex: 1, ...def.opts }),
    ...(def.overlays || []).map((url) => L.tileLayer(url, { maxZoom: 18, maxNativeZoom: 18, zIndex: 2 })),
  ];
  for (const l of S.base) l.addTo(S.map);
  ui.baseLayer = name;
  saveUi();
  renderLayerSwitch();
}

/** Tile of the current map centre in a given style — a live preview, like Google Maps' layer picker. */
function previewTile(def) {
  const c = S.map.getCenter();
  const z = Math.max(5, Math.min(14, Math.round(S.map.getZoom()) - 1));
  const n = 2 ** z;
  const lat = (c.lat * Math.PI) / 180;
  const x = Math.floor(((c.lng + 180) / 360) * n);
  const y = Math.floor(((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * n);
  return L.Util.template(def.url, { s: 'a', z, x, y, r: '' });
}

function renderLayerSwitch(open = false) {
  const el = S.layerSwitch.getContainer();
  const icon = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 3 2 8.5l10 5.5 10-5.5L12 3Z" fill="currentColor"/><path d="m2 12.5 10 5.5 10-5.5M2 16.5 12 22l10-5.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';
  el.innerHTML = `
<button type="button" class="ls-toggle" data-layers-toggle aria-expanded="${open}" aria-controls="lsPanel" title="${esc(t('mapType'))}" aria-label="${esc(t('mapType'))}">${icon}</button>
${open ? `<div class="ls-panel" id="lsPanel" role="group" aria-label="${esc(t('mapType'))}">${Object.entries(BASE_LAYERS).map(([k, def]) => `
<button type="button" class="ls-opt" data-base="${k}" aria-pressed="${k === ui.baseLayer}"><img src="${esc(previewTile(def))}" alt="" width="64" height="64"><span>${esc(t(def.label))}</span></button>`).join('')}
</div>` : ''}`;
  S.layerSwitchOpen = open;
}

function initMap() {
  if (!window.L) { $('#map').textContent = 'Map library failed to load.'; return; }
  const map = L.map('map', { zoomSnap: 0.5, maxZoom: 18 }).setView([42.75, 25.3], 7);
  S.map = map;
  map.attributionControl.addAttribution('<a href="https://www.geonames.org" target="_blank" rel="noopener">GeoNames</a>');
  const LayerSwitch = L.Control.extend({
    onAdd() {
      const el = L.DomUtil.create('div', 'layer-switch');
      L.DomEvent.disableClickPropagation(el);
      L.DomEvent.disableScrollPropagation(el);
      return el;
    },
  });
  S.layerSwitch = new LayerSwitch({ position: 'topleft' }).addTo(map);
  setBaseLayer(ui.baseLayer);
  map.on('click', () => { if (S.layerSwitchOpen) renderLayerSwitch(false); });
  map.getContainer().addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && S.layerSwitchOpen) { renderLayerSwitch(false); $('[data-layers-toggle]').focus(); }
  });
  S.layer = L.layerGroup().addTo(map);

  const Tools = L.Control.extend({
    onAdd() {
      const el = L.DomUtil.create('div', 'map-tools leaflet-bar');
      L.DomEvent.disableClickPropagation(el);
      return el;
    },
  });
  S.tools = new Tools({ position: 'topright' }).addTo(map);
  const Legend = L.Control.extend({
    onAdd() {
      const el = L.DomUtil.create('div', 'map-legend');
      L.DomEvent.disableClickPropagation(el);
      return el;
    },
  });
  S.legend = new Legend({ position: 'bottomright' }).addTo(map);

  map.getContainer().addEventListener('click', (e) => {
    const open = e.target.closest('[data-open]');
    if (open) { openDetail(open.dataset.open); return; }
    const place = e.target.closest('[data-filter-place]');
    if (place) {
      ui.filters.place = place.dataset.filterPlace;
      map.closePopup();
      renderFilterOptions();
      applyFilters();
      $('.list-pane').scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (e.target.closest('[data-layers-toggle]')) { renderLayerSwitch(!S.layerSwitchOpen); return; }
    const base = e.target.closest('[data-base]');
    if (base) { setBaseLayer(base.dataset.base); return; }
    const mode = e.target.closest('[data-group]');
    if (mode) { ui.groupMode = mode.dataset.group; renderMap(); saveUi(); return; }
    if (e.target.closest('[data-fit]')) fitMap();
  });
  new ResizeObserver(() => map.invalidateSize()).observe($('#map'));
}

function computeGroups() {
  const groups = new Map();
  let unmapped = 0;
  for (const l of S.filtered) {
    const g = groupOf(l);
    if (!g) { unmapped++; continue; }
    let e = groups.get(g.key);
    if (!e) { e = { ...g, items: [] }; groups.set(g.key, e); }
    e.items.push(l);
  }
  const list = [...groups.values()];
  for (const g of list) {
    g.medPpm = median(g.items.map((x) => x._ppm));
    g.medPrice = median(g.items.map((x) => x._eur));
    const prices = g.items.map((x) => x._eur).filter((x) => x != null);
    g.min = prices.length ? Math.min(...prices) : null;
    g.max = prices.length ? Math.max(...prices) : null;
  }
  return { list, unmapped };
}

/** Quintile thresholds of the groups' median €/m² (ordinal bins for the colour ramp). */
function ppmBreaks(groups) {
  const v = groups.map((g) => g.medPpm).filter((x) => x != null).sort((a, b) => a - b);
  if (!v.length) return [];
  const q = (p) => v[Math.min(v.length - 1, Math.floor(p * v.length))];
  // With few places, quintiles coincide; drop duplicates so no band is empty ("2,420–2,420").
  return [...new Set([q(0.2), q(0.4), q(0.6), q(0.8)].map((x) => Math.round(x / 10) * 10))].filter((x) => x > v[0]);
}

/** Ramp colour for bin i of (breaks.length + 1) bins, spread over the full light→dark ramp. */
function rampColor(i, breaks) {
  const bins = breaks.length + 1;
  return MARKER_RAMP[bins === 1 ? 2 : Math.round((i * (MARKER_RAMP.length - 1)) / (bins - 1))];
}

function binOf(value, breaks) {
  if (value == null) return -1;
  let b = 0;
  while (b < breaks.length && value >= breaks[b]) b++;
  return b;
}

function groupTitle(g) {
  const p = g.place;
  const base = placeName(p.name, p.kind, p.nameEn);
  return g.hood ? `${hoodName(g.hood)}, ${base}` : base;
}

function groupSub(g) {
  const p = g.place;
  const kind = getLang() === 'en' && p.kind && !g.hood ? KIND_EN[p.kind] : '';
  const muni = p.municipality ? (getLang() === 'bg' ? `общ. ${p.municipality}` : `${transliterate(p.municipality)} municipality`) : '';
  return [kind, muni, oblastLabel(p.oblast)].filter(Boolean).join(' · ');
}

function popupHtml(g) {
  const items = [...g.items].sort((a, b) => (a._eur ?? Infinity) - (b._eur ?? Infinity));
  const shown = items.slice(0, 8);
  const lang = getLang();
  const rows = shown.map((l) => {
    const bits = [typeLabel(l.type, l.typeBg, lang, true), l.area ? `${fmtNum(l.area)} m²` : '', l.yard ? `${t('colYard').replace(/ m²| м²/, '')} ${fmtNum(l.yard)}` : ''].filter(Boolean).join(' · ');
    const thumb = thumbFor(l);
    const img = thumb ? `<img loading="lazy" src="${esc(thumb)}" alt="" width="48" height="36">` : '<span class="pop-nophoto" aria-hidden="true"></span>';
    return `<li><button type="button" data-open="${esc(l.id)}">${img}<span class="pop-desc">${esc(bits)}</span><b>${esc(l.price != null ? fmtMoney(l.price, l.currency || 'EUR') : '—')}</b></button></li>`;
  }).join('');
  const more = items.length > shown.length ? `<li class="more">${esc(t('popupMore', { n: items.length - shown.length }))}</li>` : '';
  return `<div class="pop">
<div class="pop-title">${esc(groupTitle(g))}</div>
<div class="pop-sub">${esc(groupSub(g))}</div>
<div class="pop-stats"><strong>${esc(t('popupCount', { n: fmtNum(g.items.length) }))}</strong> · ${esc(t('popupMedian', { price: fmtMoney(g.medPrice), ppm: g.medPpm != null ? fmtMoney(g.medPpm) : '—' }))}${g.min != null && g.items.length > 1 ? `<br>${esc(t('popupRange', { min: fmtMoney(g.min), max: fmtMoney(g.max) }))}` : ''}</div>
<ul class="pop-list">${rows}${more}</ul>
<button type="button" class="btn small primary" data-filter-place="${esc(g.key)}">${esc(t('popupShowAll', { n: fmtNum(g.items.length) }))}</button>
<div class="pop-note">${esc(t('precisionSettlement'))}</div>
</div>`;
}

function renderMap() {
  if (!S.map) return;
  const { list, unmapped } = computeGroups();
  S.groups = list;
  const breaks = ppmBreaks(list);
  S.layer.clearLayers();
  S.markerByKey.clear();
  // Largest first so small groups stay clickable on top.
  for (const g of [...list].sort((a, b) => b.items.length - a.items.length)) {
    const n = g.items.length;
    const size = Math.round(Math.min(58, 22 + 6.5 * Math.log2(n)));
    const bin = binOf(g.medPpm, breaks);
    const selected = ui.filters.place === g.key;
    const icon = L.divIcon({
      className: 'mk-wrap',
      html: `<div class="mk ${bin < 0 ? 'mk-nodata' : `mk-b${MARKER_RAMP.indexOf(rampColor(bin, breaks))}`} ${selected ? 'mk-selected' : ''}" style="width:${size}px;height:${size}px;${bin >= 0 ? `--mk:${rampColor(bin, breaks)}` : ''}">${n}</div>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
      popupAnchor: [0, -size / 2],
    });
    const m = L.marker([g.lat, g.lon], { icon, title: `${groupTitle(g)} — ${t('popupCount', { n })}`, alt: groupTitle(g), riseOnHover: true });
    // Extra top clearance so the popup isn't tucked under the "Group by" control.
    m.bindPopup(() => popupHtml(g), { maxWidth: 340, minWidth: 260, autoPanPaddingTopLeft: [20, 70], autoPanPaddingBottomRight: [20, 20] });
    m.addTo(S.layer);
    S.markerByKey.set(g.key, m);
  }
  renderMapTools();
  renderLegend(breaks, list.some((g) => g.medPpm == null));
  // Clickable note: switches the "Not on map" filter on/off.
  const note = $('#unmapped');
  note.hidden = !unmapped;
  note.textContent = ui.filters.unmapped ? t('unmappedActive') : t('unmapped', { n: fmtNum(unmapped) });
  note.setAttribute('aria-pressed', String(ui.filters.unmapped));
  if (!S.fitted && list.length) { fitMap(); S.fitted = true; }
}

function fitMap() {
  if (!S.map || !S.groups.length) return;
  const b = L.latLngBounds(S.groups.map((g) => [g.lat, g.lon]));
  S.map.fitBounds(b.pad(0.08), { maxZoom: 12 });
}

function renderMapTools() {
  const hasHoods = S.listings.some((l) => l.nbhd?.lat != null);
  S.tools.getContainer().innerHTML = `
${hasHoods ? `<div class="seg" role="group" aria-label="${esc(t('groupBy'))}"><span class="seg-label">${esc(t('groupBy'))}</span>
<button type="button" data-group="settlement" aria-pressed="${ui.groupMode === 'settlement'}">${esc(t('groupSettlement'))}</button>
<button type="button" data-group="neighborhood" aria-pressed="${ui.groupMode === 'neighborhood'}">${esc(t('groupNeighborhood'))}</button></div>` : ''}
<button type="button" class="fit" data-fit title="${esc(t('fit'))}" aria-label="${esc(t('fit'))}">⤢</button>`;
}

function renderLegend(breaks, hasNoData) {
  const el = S.legend.getContainer();
  if (!breaks.length) { el.hidden = true; return; }
  el.hidden = false;
  const labels = [];
  for (let i = 0; i <= breaks.length; i++) {
    const lo = i === 0 ? null : breaks[i - 1];
    const hi = i < breaks.length ? breaks[i] : null;
    labels.push(lo == null ? `< ${fmtNum(hi)}` : hi == null ? `≥ ${fmtNum(lo)}` : `${fmtNum(lo)}–${fmtNum(hi)}`);
  }
  el.innerHTML = `<div class="lg-title">${esc(t('legendTitle'))}</div>
${labels.map((lab, i) => `<div class="lg-row"><span class="lg-sw" style="background:${rampColor(i, breaks)}"></span>${esc(lab)} €</div>`).join('')}
${hasNoData ? `<div class="lg-row"><span class="lg-sw nodata"></span>${esc(t('legendNoData'))}</div>` : ''}
<div class="lg-note">${esc(t('legendSize'))}</div>`;
}

function highlightMarker(id, on) {
  const l = S.byId.get(id);
  const g = l && groupOf(l);
  const m = g && S.markerByKey.get(g.key);
  const el = m?.getElement()?.querySelector('.mk');
  if (el) el.classList.toggle('mk-hl', on);
}

function showOnMap(l) {
  const g = groupOf(l);
  if (!g || !S.map) return;
  $('#detailDlg').close();
  $('.map-pane').scrollIntoView({ behavior: 'smooth', block: 'start' });
  S.map.flyTo([g.lat, g.lon], Math.max(S.map.getZoom(), 12), { duration: 0.8 });
  const m = S.markerByKey.get(g.key);
  if (m) S.map.once('moveend', () => m.openPopup());
}

// ---------------------------------------------------------------- detail dialog

function openDetail(id) {
  if (!S.byId.has(id)) return;
  S.detailId = id;
  S.photoIdx = 0;
  renderDetail();
  const dlg = $('#detailDlg');
  if (!dlg.open) dlg.showModal();
  $('#detailBody').scrollTop = 0;
}

function fact(label, value) {
  return value == null || value === '' ? '' : `<dt>${esc(label)}</dt><dd>${esc(value)}</dd>`;
}

function renderDetail() {
  const l = S.byId.get(S.detailId);
  if (!l) return;
  const lang = getLang();
  const idx = S.filtered.findIndex((x) => x.id === l.id);
  const photos = (l.photos || []).map(safeUrl).filter(Boolean);
  const i = Math.min(S.photoIdx, Math.max(0, photos.length - 1));
  const starred = stars.has(l.id);
  const url = safeUrl(l.url);
  const status = l.status ? CONSTRUCTION_STATUS[l.status]?.[lang] : null;
  const construction = [l.material ? term(l.material, lang) : null, status, l.yearText ? `${l.yearText} ${lang === 'bg' ? 'г.' : ''}`.trim() : null].filter(Boolean).join(', ');
  const hood = l.place?.via === 'neighborhood' ? null : l.nbhd?.name || l.neighborhood;
  const location = [hood ? hoodName(hood) : null, listingPlace(l),
    l.place?.via === 'neighborhood' ? placeName(l.settlement, l.settlementKind) : null, oblastLabel(l.oblast)].filter(Boolean).join(', ');
  const price = l.price != null ? fmtMoney(l.price, l.currency || 'EUR') : (l.priceOnRequest ? t('priceOnRequest') : '—');

  $('#detailHead').innerHTML = `
<div class="dh-title">
  <h2 id="detailTitle">${esc(typeLabel(l.type, l.typeBg, lang))} · ${esc(listingPlace(l))}</h2>
  <div class="muted">${esc(dealLabel(l.deal, lang))} · ${esc(location)}${l.promo ? ` · ${esc(t('promo', { p: l.promo }))}` : ''}</div>
</div>
<div class="dh-actions">
  <button type="button" class="btn icon star ${starred ? 'on' : ''}" data-star="${esc(l.id)}" aria-pressed="${starred}" title="${esc(t(starred ? 'unstar' : 'star'))}" aria-label="${esc(t(starred ? 'unstar' : 'star'))}">${starred ? '★' : '☆'}</button>
  <button type="button" class="btn icon" data-nav="-1" ${idx <= 0 ? 'disabled' : ''} title="${esc(t('prevListing'))}" aria-label="${esc(t('prevListing'))}">‹</button>
  <span class="muted small">${idx >= 0 ? `${fmtNum(idx + 1)} / ${fmtNum(S.filtered.length)}` : ''}</span>
  <button type="button" class="btn icon" data-nav="1" ${idx < 0 || idx >= S.filtered.length - 1 ? 'disabled' : ''} title="${esc(t('nextListing'))}" aria-label="${esc(t('nextListing'))}">›</button>
  <button type="button" class="btn icon" data-close title="${esc(t('close'))}" aria-label="${esc(t('close'))}">✕</button>
</div>`;

  const gallery = photos.length ? `
<div class="gallery">
  <div class="main-photo">
    <img src="${esc(photos[i])}" alt="${esc(t('photoOf', { i: i + 1, n: photos.length }))}">
    ${photos.length > 1 ? `<button type="button" class="ph-nav prev" data-photo-step="-1" aria-label="‹">‹</button><button type="button" class="ph-nav next" data-photo-step="1" aria-label="›">›</button>` : ''}
    <span class="ph-count">${esc(t('photoOf', { i: i + 1, n: photos.length }))}</span>
  </div>
  <div class="thumbs">${photos.map((p, k) => `<button type="button" data-photo="${k}" class="${k === i ? 'on' : ''}" aria-label="${esc(t('photoOf', { i: k + 1, n: photos.length }))}"><img loading="lazy" src="${esc(thumbOf(p))}" alt=""></button>`).join('')}</div>
</div>` : `<div class="gallery empty-gallery">${esc(t('noPhotos'))}</div>`;

  const facts = [
    fact(t('factPpm'), l._ppm ? `${fmtMoney(l._ppm)}/m²` : ''),
    fact(t('factArea'), l.area ? `${fmtNum(l.area)} m²` : ''),
    fact(t('factYard'), l.yard ? `${fmtNum(l.yard)} m²` : ''),
    fact(t('factFloor'), floorText(l)),
    fact(t('factConstruction'), construction),
    fact(t('factHeating'), l.heating ? term(l.heating, lang) : ''),
    fact(t('factVat'), l.vatNote ? term(l.vatNote, lang) : ''),
    fact(t('factAddress'), l.address),
    fact(t('factId'), l.id),
    fact(t('factUpdated'), l.updatedAt ? fmtDate(l.updatedAt, true) : ''),
    fact(t('factViews'), l.views != null ? fmtNum(l.views) : ''),
    fact(t('factFirstSeen'), fmtDate(l.firstSeen)),
    fact(t('factLastSeen'), fmtDate(l.lastSeen) + (l._stale ? ` — ${t('badgeStale')}` : '')),
  ].join('');

  const features = (l.features || []).length
    ? `<section><h3>${esc(t('features'))}</h3><div class="chips">${l.features.map((f) => `<span class="chip" title="${esc(f)}">${esc(term(f, lang))}</span>`).join('')}</div></section>` : '';

  const desc = l.description
    ? `<section><h3>${esc(t('description'))}${lang === 'en' ? ` <span class="muted small">— ${esc(t('descriptionOriginal'))}</span>` : ''}</h3>
<p class="desc" lang="bg">${esc(l.description)}</p>${l.descriptionFull ? '' : `<p class="note">${esc(t('descriptionSnippet'))}</p>`}</section>` : '';

  const agencyUrl = safeUrl(l.agency?.url);
  const contact = (l.agency || l.broker || l.phone) ? `<section><h3>${esc(t('contact'))}</h3><dl class="kv">
${l.agency?.name ? `<dt>${esc(t('agency'))}</dt><dd>${agencyUrl ? `<a href="${esc(agencyUrl)}" target="_blank" rel="noopener noreferrer">${esc(l.agency.name)}</a>` : esc(l.agency.name)}${l.agency.address ? `<div class="muted small">${esc(l.agency.address)}</div>` : ''}</dd>` : ''}
${fact(t('broker'), l.broker)}
${l.phone ? `<dt>${esc(t('phone'))}</dt><dd><a href="tel:${esc(l.phone.replace(/[^\d+]/g, ''))}">${esc(l.phone)}</a></dd>` : ''}
</dl></section>` : '';

  const hist = l.priceHistory || [];
  const history = hist.length > 1 ? `<section><h3>${esc(t('priceHistory'))}</h3><table class="mini"><tbody>
${hist.map((h) => `<tr><td>${esc(fmtDate(h.at))}</td><td class="num">${esc(fmtMoney(h.price, h.currency || 'EUR'))}</td></tr>`).join('')}</tbody></table></section>` : '';

  $('#detailBody').innerHTML = `
<div class="detail-top">
  ${gallery}
  <div class="facts">
    <div class="price-big">${esc(price)}${l.priceTrend ? ` <span class="trend ${esc(l.priceTrend)}" title="${esc(t(l.priceTrend === 'down' ? 'priceDown' : 'priceUp'))}">${l.priceTrend === 'down' ? '▼' : '▲'}</span>` : ''}</div>
    <dl class="kv">${facts}</dl>
    <div class="detail-links">
      ${url ? `<a class="btn primary" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(t('openOriginal'))} ↗</a>` : ''}
      ${l.place ? `<button type="button" class="btn" data-show-map>${esc(t('showOnMap'))}</button>` : `<span class="badge nomap">${esc(t('notOnMap'))}</span>`}
    </div>
  </div>
</div>
${features}${desc}${contact}${history}
<section><h3><label for="noteInput">${esc(t('note'))}</label></h3>
<textarea id="noteInput" rows="3" placeholder="${esc(t('notePlaceholder'))}">${esc(notes[l.id] || '')}</textarea></section>`;
}

function stepDetail(delta) {
  const idx = S.filtered.findIndex((x) => x.id === S.detailId);
  const next = S.filtered[idx + delta];
  if (next) openDetail(next.id);
}

function stepPhoto(delta) {
  const l = S.byId.get(S.detailId);
  const n = (l?.photos || []).length;
  if (n < 2) return;
  S.photoIdx = (S.photoIdx + delta + n) % n;
  renderDetail();
}

function toggleStar(id) {
  if (stars.has(id)) stars.delete(id); else stars.add(id);
  saveJson('stars', [...stars]);
  if (ui.filters.starred) applyFilters({ keepPage: true }); else renderTable();
  if ($('#detailDlg').open && S.detailId === id) renderDetail();
}

// ---------------------------------------------------------------- import dialog

function renderJob() {
  const box = $('#jobView');
  const j = S.job;
  const running = j && (j.status === 'running' || j.status === 'queued');
  $('#btnStart').disabled = !!running;
  $('#btnCancel').hidden = !running;
  $('#btnImport').classList.toggle('busy', !!running);
  if (!j) { box.innerHTML = ''; return; }
  const p = j.progress;
  const bar = (label, done, total) => (total ? `<div class="prog"><div class="prog-label">${esc(label)} <span>${fmtNum(done)} / ${fmtNum(total)}</span></div><progress max="${total}" value="${done}"></progress></div>` : '');
  const status = j.status === 'done' ? t('importDone') : j.status === 'cancelled' ? t('importCancelled')
    : j.status === 'error' ? t('importError', { message: j.error?.code && t(`err_${j.error.code}`) !== `err_${j.error.code}` ? t(`err_${j.error.code}`) : j.error?.message }) : `${t('importRunning')} ${t(`phase_${j.phase}`)}`;
  const log = j.log.slice(-14).map((e) => {
    const params = { ...e.params };
    if ('capped' in params) params.capped = params.capped ? '+' : '';
    if (params.reason) params.reason = t(`reason_${params.reason}`);
    const text = t(`log_${e.code}`, params);
    return `<li class="${esc(params.level || '')}">${esc(text)}</li>`;
  }).join('');
  box.innerHTML = `
<div class="job-status ${esc(j.status)}" role="status">${esc(status)}</div>
${running ? `<div class="muted small">${esc(t('progFound', { n: fmtNum(p.found) }))}</div>` : ''}
${running ? bar(t('progPages'), p.searchPages, p.searchPagesTotal) + bar(t('progDetails'), p.details, p.detailsTotal) + bar(t('progGeocode'), p.geocode, p.geocodeTotal) : ''}
${!running && j.result ? `<div class="job-result">${esc(t('importResult', { ...Object.fromEntries(Object.entries(j.result).map(([k, v]) => [k, fmtNum(v)])) }))}</div>` : ''}
${log ? `<ul class="job-log">${log}</ul>` : ''}`;
}

async function pollJob() {
  clearTimeout(S.pollTimer);
  try {
    const { job } = await api('/api/job');
    const prevPhase = S.lastPhase;
    S.job = job;
    S.lastPhase = job?.phase;
    renderJob();
    if (job && (job.status === 'running' || job.status === 'queued')) {
      // Listings are saved once all search pages are read — show them while details load.
      if (prevPhase === 'search' && job.phase !== 'search') reload();
      S.pollTimer = setTimeout(pollJob, 1000);
    } else if (prevPhase && prevPhase !== 'done') {
      await reload();
    }
  } catch (err) {
    S.pollTimer = setTimeout(pollJob, 3000);
  }
}

async function startImport(inputs) {
  const options = { details: $('#optDetails').checked, autoSplit: $('#optSplit').checked, geocodeOnline: $('#optGeocode').checked };
  saveJson('importOptions', options);
  try {
    const { job } = await api('/api/import', { method: 'POST', body: { inputs, options } });
    S.job = job; S.lastPhase = job.phase;
    renderJob();
    pollJob();
  } catch (err) {
    $('#jobView').innerHTML = `<div class="job-status error" role="alert">${esc(err.message)}</div>`;
  }
}

function renderSources() {
  const box = $('#sourcesList');
  if (!box) return;
  const list = Object.values(S.sources).sort((a, b) => String(b.lastImportAt).localeCompare(String(a.lastImportAt)));
  if (!list.length) { box.innerHTML = `<p class="muted">${esc(t('sourcesEmpty'))}</p>`; $('#btnReimportAll').hidden = true; return; }
  $('#btnReimportAll').hidden = !list.some((s) => s.url);
  const count = countBy(S.listings.flatMap((l) => l.sources || []), (s) => s);
  box.innerHTML = list.map((s) => `
<div class="source">
  <div class="source-main">
    ${s.url ? `<a href="${esc(safeUrl(s.url) || '#')}" target="_blank" rel="noopener noreferrer" class="source-url">${esc(s.url.replace(/^https:\/\/www\./, ''))}</a>` : `<span class="source-url">${esc(t('manualSource'))}</span>`}
    ${s.paramsText ? `<div class="small muted">imot.bg: ${esc(s.paramsText)}</div>` : ''}
    <div class="small">${esc(t('sourceInfo', { n: fmtNum(count.get(s.id) || 0), date: fmtDate(s.lastImportAt, true) }))}${s.splits ? ` · ${esc(t('sourceCapped'))}` : ''}</div>
  </div>
  <div class="source-actions">
    ${s.url ? `<button type="button" class="btn small" data-reimport="${esc(s.id)}">${esc(t('reimport'))}</button>` : ''}
    <button type="button" class="btn small danger" data-remove-source="${esc(s.id)}">${esc(t('removeSource'))}</button>
  </div>
</div>`).join('');
}

// ---------------------------------------------------------------- exports

function exportCsv() {
  const cols = [
    ['id', (l) => l.id], ['url', (l) => l.url], ['deal', (l) => l.deal], ['type', (l) => typeLabel(l.type, l.typeBg, 'en')],
    ['type_bg', (l) => l.typeBg], ['settlement', (l) => l.place?.name || l.settlement], ['settlement_en', (l) => l.place?.nameEn || transliterate(l.settlement || '')],
    ['municipality_town', (l) => (l.place?.municipality ? l.settlement : '')], ['neighborhood', (l) => l.nbhd?.name || l.neighborhood],
    ['address', (l) => l.address], ['oblast', (l) => l.oblast], ['price', (l) => l.price], ['currency', (l) => l.currency],
    ['price_eur', (l) => l._eur], ['price_per_m2_eur', (l) => l._ppm], ['area_m2', (l) => l.area], ['yard_m2', (l) => l.yard],
    ['floor', (l) => l.floor], ['year_from', (l) => l.yearFrom], ['year_to', (l) => l.yearTo], ['construction', (l) => l.material],
    ['status', (l) => l.status], ['heating', (l) => l.heating], ['features', (l) => (l.features || []).join('; ')],
    ['agency', (l) => l.agency?.name], ['broker', (l) => l.broker], ['phone', (l) => l.phone],
    ['updated_on_imot_bg', (l) => l.updatedAt], ['first_seen', (l) => l.firstSeen], ['last_seen', (l) => l.lastSeen],
    ['no_longer_listed', (l) => (l._stale ? 'yes' : '')], ['lat', (l) => l.place?.lat], ['lon', (l) => l.place?.lon],
    ['location_precision', (l) => (l.place ? 'settlement' : 'none')], ['starred', (l) => (stars.has(l.id) ? 'yes' : '')],
    ['note', (l) => notes[l.id]], ['description', (l) => l.description],
  ];
  const cell = (v) => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = '﻿' + [cols.map((c) => c[0]).join(','), ...S.filtered.map((l) => cols.map((c) => cell(c[1](l))).join(','))].join('\r\n');
  download(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `imot-listings-${new Date().toISOString().slice(0, 10)}.csv`);
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// ---------------------------------------------------------------- events

function bindEvents() {
  const onFilter = (key, read, { debounce = 0 } = {}) => (e) => {
    clearTimeout(onFilter.timer);
    const run = () => { ui.filters[key] = read(e.target); applyFilters(); };
    if (debounce) onFilter.timer = setTimeout(run, debounce); else run();
  };
  $('#fQ').addEventListener('input', onFilter('q', (el) => el.value, { debounce: 150 }));
  for (const [id, key] of [['#fDeal', 'deal'], ['#fType', 'type'], ['#fOblast', 'oblast'], ['#fPlace', 'place']]) {
    $(id).addEventListener('change', onFilter(key, (el) => el.value));
  }
  for (const [id, key] of [['#fPriceMin', 'priceMin'], ['#fPriceMax', 'priceMax'], ['#fAreaMin', 'areaMin'], ['#fAreaMax', 'areaMax'], ['#fYardMin', 'yardMin']]) {
    $(id).addEventListener('input', onFilter(key, (el) => (el.value === '' ? null : Number(el.value)), { debounce: 300 }));
  }
  $('#fStarred').addEventListener('change', onFilter('starred', (el) => el.checked));
  $('#fNew').addEventListener('change', onFilter('onlyNew', (el) => el.checked));
  $('#fHideStale').addEventListener('change', onFilter('hideStale', (el) => el.checked));
  $('#fUnmapped').addEventListener('change', onFilter('unmapped', (el) => el.checked));
  $('#unmapped').addEventListener('click', () => {
    ui.filters.unmapped = !ui.filters.unmapped;
    renderFilterOptions();
    applyFilters();
  });
  $('#btnReset').addEventListener('click', () => {
    ui.filters = { ...DEFAULT_FILTERS };
    renderFilterOptions();
    applyFilters();
  });
  $('#placeChip').addEventListener('click', (e) => {
    if (!e.target.closest('[data-clear-place]')) return;
    ui.filters.place = '';
    renderFilterOptions();
    applyFilters();
  });

  $('#table thead').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sort]');
    if (!b) return;
    const key = b.dataset.sort;
    ui.sort = ui.sort.key === key ? { key, dir: -ui.sort.dir } : { key, dir: ['updated'].includes(key) ? -1 : 1 };
    applyFilters({ keepPage: false });
  });
  const tbody = $('#table tbody');
  tbody.addEventListener('click', (e) => {
    const star = e.target.closest('[data-star]');
    if (star) { toggleStar(star.dataset.star); return; }
    if (e.target.closest('a')) return;
    const tr = e.target.closest('tr[data-id]');
    if (tr) openDetail(tr.dataset.id);
  });
  tbody.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.target.closest('button,a')) return;
    const tr = e.target.closest('tr[data-id]');
    if (tr) openDetail(tr.dataset.id);
  });
  let hovered = null;
  tbody.addEventListener('mouseover', (e) => {
    const id = e.target.closest('tr[data-id]')?.dataset.id || null;
    if (id === hovered) return;
    if (hovered) highlightMarker(hovered, false);
    hovered = id;
    if (id) highlightMarker(id, true);
  });
  tbody.addEventListener('mouseleave', () => { if (hovered) highlightMarker(hovered, false); hovered = null; });

  $('#pager').addEventListener('click', (e) => {
    const b = e.target.closest('[data-page]');
    if (!b) return;
    S.page += b.dataset.page === 'next' ? 1 : -1;
    renderTable();
    $('.table-wrap').scrollTop = 0;
  });
  $('#pager').addEventListener('change', (e) => {
    if (e.target.id !== 'pageSize') return;
    ui.pageSize = Number(e.target.value);
    applyFilters();
  });

  // Detail dialog
  const dlg = $('#detailDlg');
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) { dlg.close(); return; } // backdrop
    const el = e.target.closest('[data-star],[data-nav],[data-close],[data-photo],[data-photo-step],[data-show-map]');
    if (!el) return;
    if (el.dataset.star) toggleStar(el.dataset.star);
    else if (el.dataset.nav) stepDetail(Number(el.dataset.nav));
    else if (el.hasAttribute('data-close')) dlg.close();
    else if (el.dataset.photo) { S.photoIdx = Number(el.dataset.photo); renderDetail(); }
    else if (el.dataset.photoStep) stepPhoto(Number(el.dataset.photoStep));
    else if (el.hasAttribute('data-show-map')) showOnMap(S.byId.get(S.detailId));
  });
  dlg.addEventListener('keydown', (e) => {
    if (e.target.closest('textarea,input,select')) return;
    if (e.key === 'ArrowLeft') { stepPhoto(-1); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { stepPhoto(1); e.preventDefault(); }
    else if (e.key === 'PageUp' || e.key === 'k') { stepDetail(-1); e.preventDefault(); }
    else if (e.key === 'PageDown' || e.key === 'j') { stepDetail(1); e.preventDefault(); }
  });
  dlg.addEventListener('input', (e) => {
    if (e.target.id !== 'noteInput') return;
    const v = e.target.value.trim();
    if (v) notes[S.detailId] = e.target.value; else delete notes[S.detailId];
    saveJson('notes', notes);
    const l = S.byId.get(S.detailId);
    if (l) prepare(l);
  });

  // Header
  $('#btnLang').addEventListener('click', () => {
    ui.lang = getLang() === 'bg' ? 'en' : 'bg';
    setLang(ui.lang);
    saveUi();
    applyI18n();
    for (const l of S.listings) prepare(l);
    renderFilterOptions();
    renderStats();
    renderSources();
    applyFilters({ keepPage: true });
    if (S.job) renderJob();
    if ($('#detailDlg').open) renderDetail();
    S.map?.closePopup();
    if (S.map) renderLayerSwitch(false);
  });
  $('#btnAbout').addEventListener('click', () => $('#aboutDlg').showModal());
  const menu = $('#exportMenu');
  $('#btnExport').addEventListener('click', (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
    $('#btnExport').setAttribute('aria-expanded', String(!menu.hidden));
  });
  document.addEventListener('click', () => { menu.hidden = true; $('#btnExport').setAttribute('aria-expanded', 'false'); });
  $('#btnCsv').addEventListener('click', exportCsv);
  $('#btnHtml')?.addEventListener('click', () => { window.location.href = `/api/export?lang=${getLang()}`; }); // absent in snapshots

  for (const d of $$('dialog')) {
    d.addEventListener('click', (e) => { if (e.target === d || e.target.closest('[data-dismiss]')) d.close(); });
  }

  if (S.readOnly) return;
  $('#btnImport').addEventListener('click', () => { $('#importDlg').showModal(); pollJob(); });
  $('#btnStart').addEventListener('click', () => {
    const inputs = $('#importInput').value.trim();
    if (!inputs) { $('#importInput').focus(); return; }
    startImport(inputs);
  });
  $('#btnCancel').addEventListener('click', () => api('/api/job/cancel', { method: 'POST', body: {} }).catch(() => {}));
  $('#btnReimportAll').addEventListener('click', () => {
    const urls = Object.values(S.sources).map((s) => s.url).filter(Boolean);
    if (urls.length) startImport(urls.join('\n'));
  });
  $('#sourcesList').addEventListener('click', async (e) => {
    const re = e.target.closest('[data-reimport]');
    if (re) { startImport(S.sources[re.dataset.reimport].url); return; }
    const rm = e.target.closest('[data-remove-source]');
    if (rm && confirm(t('removeSourceConfirm'))) {
      try { await api('/api/sources/delete', { method: 'POST', body: { id: rm.dataset.removeSource } }); await reload(); }
      catch (err) { alert(err.message); }
    }
  });
  $('#btnDeleteAll').addEventListener('click', async () => {
    if (!confirm(t('deleteAllConfirm'))) return;
    try { await api('/api/listings/delete', { method: 'POST', body: { all: true } }); S.fitted = false; await reload(); }
    catch (err) { alert(err.message); }
  });
}

// ---------------------------------------------------------------- boot

async function boot() {
  setLang(ui.lang || EMBEDDED?.lang || (navigator.language?.toLowerCase().startsWith('bg') ? 'bg' : 'en'));
  if (S.readOnly) {
    document.body.classList.add('read-only');
    for (const el of $$('[data-server-only]')) el.remove();
  } else {
    const opts = loadJson('importOptions', null);
    if (opts) {
      $('#optDetails').checked = opts.details !== false;
      $('#optSplit').checked = opts.autoSplit !== false;
      $('#optGeocode').checked = opts.geocodeOnline !== false;
    }
  }
  applyI18n();
  bindEvents();
  initMap();
  if (S.readOnly) {
    setData(EMBEDDED);
  } else {
    try { await reload(); } catch (err) {
      $('#emptyMsg').hidden = false;
      $('#emptyMsg').textContent = `Could not reach the local server: ${err.message}`;
    }
    pollJob();
  }
}

boot();
