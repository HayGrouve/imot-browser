// imot.bg browser UI. Works against the local server (/api/*) or, in an
// exported standalone file, against data embedded as window.__IMOT_DATA__.

import { searchKey, transliterate, median } from '/shared/text.mjs';
import { PROPERTY_TYPES, DEALS, typeLabel, dealLabel, term, CONSTRUCTION_STATUS } from '/shared/vocab.mjs';
import { t, setLang, getLang } from './i18n.mjs';
import { icon } from './icons.mjs';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const STORE_KEY = 'imot-browser:';
const EMBEDDED = window.__IMOT_DATA__ || null;
const EUR_PER_BGN = 1 / 1.95583;
const MARKER_RAMP = ['#86b6ef', '#5598e7', '#2875d3', '#1c5cab', '#104281']; // ordinal blue, validated (dataviz); step 3 darkened for 4.5:1 white text
const PAGE = 50; // rows added each time the list grows
const NARROW = matchMedia('(max-width: 1000px)');
const PHONE = matchMedia('(max-width: 720px)');
const DARK = matchMedia('(prefers-color-scheme: dark)');

// ---------------------------------------------------------------- persistence

function loadJson(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(STORE_KEY + key)); return v ?? fallback; } catch { return fallback; }
}
function saveJson(key, value) {
  try { localStorage.setItem(STORE_KEY + key, JSON.stringify(value)); } catch { /* private mode / quota */ }
}

const DEFAULT_FILTERS = { q: '', deal: '', type: '', oblast: '', place: '', priceMin: null, priceMax: null, areaMin: null, areaMax: null, yardMin: null, starred: false, onlyNew: false, hideStale: false, unmapped: false };
const ui = {
  lang: null, sort: { key: 'price', dir: 1 }, groupMode: 'settlement', baseLayer: 'light',
  ...loadJson('ui', {}),
};
// v2 (redesign): the calm "simple" base map is the new default; paging became "load more".
if (ui.v !== 2) { ui.baseLayer = 'light'; ui.v = 2; }
delete ui.pageSize;
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
  listings: [], byId: new Map(), sources: {}, filtered: [], limit: PAGE, loaded: false, loadError: null,
  map: null, layer: null, markerByKey: new Map(), groups: [], fitted: false, mapCtlOpen: false,
  pop: null, popQuery: '', view: 'list',
  job: null, pollTimer: null, lastPhase: null,
  sf: { form: null, loading: null, error: null, note: null, view: 'form', url: null, busy: false, moreOpen: false },
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

function hoodName(n) { return getLang() === 'bg' ? n : transliterate(n.replace(/^м-т\s*/i, '')); }

function typeValue(l) { return l.type === 'other' ? `other:${l.typeBg || ''}` : l.type; }

function floorText(l) {
  if (l.floorNum == null) return l.floor ? (getLang() === 'bg' ? l.floor : term(l.floor, 'en')) : '';
  const f = l.floorNum === 0 ? (getLang() === 'bg' ? 'партер' : 'G') : l.floorNum === -1 ? (getLang() === 'bg' ? 'сутерен' : 'B') : String(l.floorNum);
  return l.floorsTotal ? `${f}/${l.floorsTotal}` : f;
}

function yearText(l) {
  if (l.yearFrom && l.yearTo && l.yearFrom !== l.yearTo) return `${l.yearFrom}-${String(l.yearTo).slice(-2)}`;
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
  S.loaded = true;
  S.loadError = null;
  applyFilters({ keepPage: true });
  renderMapCtl();
  renderSources();
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.error || `HTTP ${res.status}`), { status: res.status, code: json.code });
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
  if (!keepPage) { S.limit = PAGE; $('#listScroll').scrollTop = 0; }
  renderList();
  renderMap();
  renderResultBar();
  renderPills();
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

// ---------------------------------------------------------------- rendering: header, pills & popovers

function applyI18n() {
  document.documentElement.lang = getLang();
  for (const el of $$('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of $$('[data-i18n-placeholder]')) el.placeholder = t(el.dataset.i18nPlaceholder);
  $('#fQ').placeholder = t(PHONE.matches ? 'searchShort' : 'searchPlaceholder');
  for (const el of $$('[data-i18n-title]')) { el.title = t(el.dataset.i18nTitle); el.setAttribute('aria-label', el.title); }
  for (const el of $$('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria));
  for (const el of $$('[data-i18n-html]')) el.innerHTML = t(el.dataset.i18nHtml); // trusted, static strings only
  $('#btnLangLabel').textContent = t('langMenu');
  $('#btnLang').title = t('langToggleTitle');
  $('#fQ').title = t('searchHint');
  document.title = t('appTitle');
  renderSortOptions();
  setView(S.view);
  if (S.readOnly) {
    const banner = $('#banner');
    banner.hidden = false;
    banner.textContent = t('readOnlyBanner', { date: fmtDate(EMBEDDED.exportedAt, true) });
  }
}

function countBy(list, fn) {
  const m = new Map();
  for (const x of list) { const k = fn(x); if (k == null || k === '') continue; m.set(k, (m.get(k) || 0) + 1); }
  return m;
}

const sqm = () => t('sqm');
const typeName = (v) => (v.startsWith('other:') ? v.slice(6) : typeLabel(v, '', getLang()));

/** €49,900 → "€50k"; for compact pill labels. */
function shortMoney(n) {
  if (n >= 1e6) return `€${fmtNum(n / 1e6, 2)}M`;
  if (n >= 1e4) return `€${fmtNum(n / 1e3, 0)}k`;
  if (n >= 1e3) return `€${fmtNum(n / 1e3, 1)}k`;
  return `€${fmtNum(n)}`;
}

function rangeLabel(lo, hi, fmt) {
  if (lo != null && hi != null) return `${fmt(lo)}-${fmt(hi)}`;
  if (lo != null) return `${fmt(lo)}+`;
  if (hi != null) return t('upTo', { v: fmt(hi) });
  return '';
}

/** Place label that stays unique when two settlements share a name (e.g. a town and a village). */
function uniquePlaceLabel(l) {
  const label = listingPlace(l);
  const cacheKey = `${getLang()}|${S.listings.length}`;
  if (S.dupPlaces?.key !== cacheKey) {
    const keysByLabel = new Map();
    for (const x of S.listings) {
      if (!x.place) continue;
      const lab = listingPlace(x);
      if (!keysByLabel.has(lab)) keysByLabel.set(lab, new Set());
      keysByLabel.get(lab).add(x.place.key);
    }
    S.dupPlaces = { key: cacheKey, labels: new Set([...keysByLabel].filter(([, keys]) => keys.size > 1).map(([lab]) => lab)) };
  }
  if (!S.dupPlaces.labels.has(label)) return label;
  const extra = getLang() === 'en' ? KIND_EN[l.place.kind] : null;
  const muni = l.place.municipality && l.place.municipality !== l.place.name ? (getLang() === 'bg' ? `общ. ${l.place.municipality}` : transliterate(l.place.municipality)) : null;
  return `${label} (${[extra, muni || oblastLabel(l.oblast)].filter(Boolean).join(', ')})`;
}

/** Label of the current place filter (a settlement, or a city neighbourhood picked on the map). */
function placeFilterLabel(key) {
  const l = S.listings.find((x) => matchesPlace(x, key));
  if (!l) return key;
  return key.startsWith('nb:') ? `${hoodName(l.nbhd.name)}, ${listingPlace(l)}` : uniquePlaceLabel(l);
}

// Filter keys each pill owns (its × clears them).
const PILLS = {
  type: ['type', 'deal'],
  location: ['place', 'oblast'],
  price: ['priceMin', 'priceMax'],
  size: ['areaMin', 'areaMax', 'yardMin'],
  more: ['onlyNew', 'hideStale', 'unmapped'],
};

function pillState(key) {
  const f = ui.filters;
  switch (key) {
    case 'type': {
      const parts = [f.type ? typeName(f.type) : null, f.deal ? dealLabel(f.deal, getLang()) : null].filter(Boolean);
      return { active: parts.length > 0, label: parts.join(', ') || t('pillType') };
    }
    case 'location':
      if (f.place) return { active: true, label: placeFilterLabel(f.place) };
      if (f.oblast) return { active: true, label: oblastLabel(f.oblast) };
      return { active: false, label: t('pillLocation') };
    case 'price': {
      const label = rangeLabel(num(f.priceMin), num(f.priceMax), shortMoney);
      return { active: !!label, label: label || t('pillPrice') };
    }
    case 'size': {
      const area = rangeLabel(num(f.areaMin), num(f.areaMax), (v) => fmtNum(v));
      const parts = [area ? `${area} ${sqm()}` : null, num(f.yardMin) != null ? t('yardShort', { v: fmtNum(num(f.yardMin)) }) : null].filter(Boolean);
      return { active: parts.length > 0, label: parts.join(', ') || t('pillSize') };
    }
    default: {
      const n = PILLS.more.filter((k) => f[k]).length;
      return { active: n > 0, label: t('pillMore'), n };
    }
  }
}

function moreOptions() {
  const f = ui.filters;
  const nNew = S.listings.filter((l) => l._new).length;
  const nStale = S.listings.filter((l) => l._stale).length;
  const nUnmapped = S.listings.filter(isUnmapped).length;
  return [
    { key: 'onlyNew', label: t('onlyNew'), hint: t('onlyNewHint'), n: nNew, show: nNew > 0 || f.onlyNew },
    { key: 'hideStale', label: t('hideStale'), hint: t('hideStaleHint'), n: nStale, show: nStale > 0 || f.hideStale },
    { key: 'unmapped', label: t('onlyUnmapped'), hint: t('onlyUnmappedTitle'), n: nUnmapped, show: nUnmapped > 0 || f.unmapped },
  ].filter((o) => o.show);
}

function pillVisible(key) {
  if (pillState(key).active) return true;
  if (key === 'type') return countBy(S.listings, typeValue).size > 1 || countBy(S.listings, (l) => l.deal).size > 1;
  if (key === 'location') return new Set(S.listings.map((l) => l.place?.key).filter(Boolean)).size > 1;
  if (key === 'more') return moreOptions().length > 0;
  return S.listings.length > 0;
}

const anyFilter = () => Object.keys(DEFAULT_FILTERS).some((k) => k !== 'q' && ui.filters[k] !== DEFAULT_FILTERS[k] && ui.filters[k] !== '' && ui.filters[k] != null);

function renderPills() {
  const f = ui.filters;
  const html = [];
  for (const key of Object.keys(PILLS)) {
    if (!pillVisible(key)) continue;
    const s = pillState(key);
    const open = S.pop === key;
    const label = `<span>${esc(s.label)}</span>${s.n ? `<span class="badge-n">${fmtNum(s.n)}</span>` : ''}`;
    const clear = s.active ? `<button type="button" class="pill-x" data-pill-clear="${key}" title="${esc(t('clearFilter'))}" aria-label="${esc(`${t('clearFilter')}: ${s.label}`)}">${icon('x')}</button>` : '';
    html.push(`<span class="pill${s.active ? ' is-active' : ''}" data-pill-wrap="${key}"><button type="button" class="pill-main" data-pill="${key}" aria-haspopup="dialog" aria-expanded="${open}" aria-controls="pop">${label}${s.active ? '' : icon('caret-down', 'caret')}</button>${clear}</span>`);
  }
  const nStars = S.listings.reduce((n, l) => n + (stars.has(l.id) ? 1 : 0), 0);
  if (nStars || f.starred) {
    html.push(`<span class="pill toggle${f.starred ? ' is-active' : ''}"><button type="button" class="pill-main" data-starred aria-pressed="${f.starred}">${icon(f.starred ? 'star-fill' : 'star')}<span>${esc(t('pillStarred'))}</span><span class="n">${fmtNum(nStars)}</span></button></span>`);
  }
  if (anyFilter()) html.push(`<button type="button" class="btn link clear-all" data-clear-all>${esc(t('clearAll'))}</button>`);
  $('#pills').innerHTML = html.join('');
  $('#pills').closest('.toolbar').hidden = !html.length;
  if (S.pop) positionPop();
}

function clearPill(key) {
  for (const k of PILLS[key]) ui.filters[k] = DEFAULT_FILTERS[k];
  applyFilters();
}

function clearAll() {
  ui.filters = { ...DEFAULT_FILTERS };
  $('#fQ').value = '';
  closePop(false);
  applyFilters();
  focusPills();
}

/** Keep keyboard focus in the filter row after the focused control went away. */
function focusPills(prefer) {
  ($(prefer || '[data-starred]') || $('#pills button') || $('#fQ')).focus();
}

// --- popover

function optRow(field, value, label, n, on, { close = true } = {}) {
  return `<li><button type="button" data-set="${field}" data-value="${esc(value)}"${close ? ' data-close' : ''} aria-pressed="${on}"><span class="opt-label">${on ? icon('check', 'check-i') : '<span class="check-sp"></span>'}<span>${esc(label)}</span></span>${n != null ? `<span class="n">${fmtNum(n)}</span>` : ''}</button></li>`;
}

function numField(key, label, { suffix, step, placeholder }) {
  const v = ui.filters[key];
  return `<label class="num-field"><span class="hint">${esc(label)}</span><span class="affix"><input type="number" min="0" step="${step}" inputmode="numeric" data-num="${key}" value="${esc(v ?? '')}" placeholder="${esc(placeholder ?? '')}"><span class="sfx">${esc(suffix)}</span></span></label>`;
}

function popFoot() {
  return `<div class="pop-foot"><button type="button" class="btn link" data-pop-clear>${esc(t('clear'))}</button><button type="button" class="btn small primary" data-pop-done>${esc(t('done'))}</button></div>`;
}

function placeOptionsHtml() {
  const f = ui.filters;
  const q = searchKey(S.popQuery);
  const places = new Map();
  for (const l of S.listings) {
    if (isUnmapped(l) || (f.oblast && l.oblast !== f.oblast)) continue; // unmapped ones: see "More"
    const k = l.place.key;
    let e = places.get(k);
    if (!e) {
      const p = l.place;
      e = { n: 0, label: uniquePlaceLabel(l), key: searchKey([p.name, p.nameEn, transliterate(p.name)].join(' ')) };
      places.set(k, e);
    }
    e.n++;
  }
  const collator = new Intl.Collator(locale());
  const list = [...places].filter(([, e]) => !q || e.key.includes(q)).sort((a, b) => collator.compare(a[1].label, b[1].label));
  const rows = [];
  if (!q) rows.push(optRow('place', '', t('allPlaces'), null, !f.place));
  if (f.place.startsWith('nb:')) rows.push(optRow('place', f.place, placeFilterLabel(f.place), S.listings.filter((l) => matchesPlace(l, f.place)).length, true));
  rows.push(...list.map(([k, e]) => optRow('place', k, e.label, e.n, f.place === k)));
  return list.length || !q ? rows.join('') : `<li class="opt-empty">${esc(t('noPlaceMatch'))}</li>`;
}

function popContent(key) {
  const f = ui.filters;
  const lang = getLang();
  if (key === 'type') {
    const deals = countBy(S.listings, (l) => l.deal);
    const order = new Map(PROPERTY_TYPES.map((p, i) => [p.key, i]));
    const types = [...countBy(S.listings, typeValue)].sort((a, b) => (order.get(a[0]) ?? 99) - (order.get(b[0]) ?? 99));
    const deal = deals.size > 1 || f.deal ? `<div class="field"><span class="field-label">${esc(t('dealHeading'))}</span><div class="seg">${
      [['', t('anyDeal')], ...[...deals.keys()].map((k) => [k, dealLabel(k, lang)])]
        .map(([k, label]) => `<button type="button" data-set="deal" data-value="${esc(k)}" aria-pressed="${f.deal === k}">${esc(label)}</button>`).join('')}</div></div>` : '';
    return `<div class="pop-body">${deal}<div class="field"><span class="field-label">${esc(t('typeHeading'))}</span><ul class="opt-list">${
      optRow('type', '', t('allTypes'), S.listings.length, !f.type)}${types.map(([k, n]) => optRow('type', k, typeName(k), n, f.type === k)).join('')}</ul></div></div>`;
  }
  if (key === 'location') {
    const oblasts = countBy(S.listings, (l) => l.oblast);
    const province = oblasts.size > 1 || f.oblast ? `<label class="field"><span class="field-label">${esc(t('province'))}</span><select data-select="oblast"><option value="">${esc(t('allOblasts'))}</option>${
      [...oblasts].sort((a, b) => b[1] - a[1]).map(([k, n]) => `<option value="${esc(k)}"${f.oblast === k ? ' selected' : ''}>${esc(oblastLabel(k))} (${fmtNum(n)})</option>`).join('')}</select></label>` : '';
    return `<div class="pop-body">${province}<div class="field"><span class="field-label" id="placeLbl">${esc(t('place'))}</span>
<span class="pop-search">${icon('magnifying-glass')}<input type="search" data-place-q value="${esc(S.popQuery)}" placeholder="${esc(t('placeSearch'))}" aria-labelledby="placeLbl" autocomplete="off" autofocus></span>
<div class="opt-scroll"><ul class="opt-list" id="placeOpts">${placeOptionsHtml()}</ul></div></div></div>`;
  }
  if (key === 'price') {
    const prices = S.listings.map((l) => l._eur).filter((x) => x != null);
    const lo = prices.length ? Math.min(...prices) : null; const hi = prices.length ? Math.max(...prices) : null;
    return `<div class="pop-body"><div class="field"><span class="field-label">${esc(t('priceHeading'))}</span><div class="range">
${numField('priceMin', t('min'), { suffix: '€', step: 5000, placeholder: lo != null ? fmtNum(lo) : '' })}<span class="range-sep">-</span>${numField('priceMax', t('max'), { suffix: '€', step: 5000, placeholder: hi != null ? fmtNum(hi) : '' })}
</div></div></div>${popFoot()}`;
  }
  if (key === 'size') {
    return `<div class="pop-body"><div class="field"><span class="field-label">${esc(t('areaHeading'))}</span><div class="range">
${numField('areaMin', t('min'), { suffix: sqm(), step: 10 })}<span class="range-sep">-</span>${numField('areaMax', t('max'), { suffix: sqm(), step: 10 })}
</div></div><div class="field"><span class="field-label">${esc(t('yardHeading'))}</span>${numField('yardMin', t('atLeast'), { suffix: sqm(), step: 100 })}</div></div>${popFoot()}`;
  }
  return `<div class="pop-body">${moreOptions().map((o) => `<label class="switch-row"><span class="sw-text"><span>${esc(o.label)} <span class="n">${fmtNum(o.n)}</span></span><span class="sw-hint">${esc(o.hint)}</span></span><input type="checkbox" class="switch" role="switch" data-bool="${o.key}"${f[o.key] ? ' checked' : ''}></label>`).join('')}</div>${popFoot()}`;
}

function renderPop() {
  const pop = $('#pop');
  pop.innerHTML = popContent(S.pop);
  pop.setAttribute('aria-label', t(`pill${S.pop[0].toUpperCase()}${S.pop.slice(1)}`));
}

function openPop(key) {
  closeMenu();
  S.pop = key;
  S.popQuery = '';
  renderPop();
  $('#pop').hidden = false;
  $('#popScrim').hidden = false;
  renderPills();
  $(`[data-pill-wrap="${key}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  const pop = $('#pop');
  (pop.querySelector('[autofocus]') || pop.querySelector('[aria-pressed="true"]') || pop.querySelector('input,select,button'))?.focus({ preventScroll: true });
}

function closePop(returnFocus = true) {
  if (!S.pop) return;
  const key = S.pop;
  S.pop = null;
  $('#pop').hidden = true;
  $('#popScrim').hidden = true;
  renderPills();
  if (returnFocus) $(`[data-pill="${key}"]`)?.focus();
}

function positionPop() {
  const pop = $('#pop');
  const anchor = $(`[data-pill-wrap="${S.pop}"]`);
  if (PHONE.matches || !anchor) { pop.style.left = ''; pop.style.top = ''; return; }
  const r = anchor.getBoundingClientRect();
  pop.style.top = `${Math.round(r.bottom + 8)}px`;
  pop.style.left = `${Math.round(Math.max(12, Math.min(r.left, innerWidth - pop.offsetWidth - 12)))}px`;
}

// --- results

const SORTS = [
  ['price', 1, 'sortPriceAsc'], ['price', -1, 'sortPriceDesc'], ['ppm', 1, 'sortPpmAsc'], ['ppm', -1, 'sortPpmDesc'],
  ['area', -1, 'sortAreaDesc'], ['area', 1, 'sortAreaAsc'], ['yard', -1, 'sortYardDesc'], ['year', -1, 'sortYearDesc'],
  ['updated', -1, 'sortUpdated'], ['place', 1, 'sortPlace'],
];

function renderSortOptions() {
  if (!SORTS.some(([k, d]) => k === ui.sort.key && d === ui.sort.dir)) ui.sort = { key: 'price', dir: 1 };
  $('#sortSel').innerHTML = SORTS.map(([k, d, label]) => `<option value="${k}:${d}"${k === ui.sort.key && d === ui.sort.dir ? ' selected' : ''}>${esc(t(label))}</option>`).join('');
}

function renderResultBar() {
  const total = S.listings.length;
  const shown = S.filtered.length;
  $('.resultbar').hidden = !total;
  $('#count').innerHTML = shown === total ? esc(t('listingsCount', { n: fmtNum(total) }))
    : `${esc(fmtNum(shown))} <span class="of">${esc(t('countOf', { total: fmtNum(total) }))}</span>`;
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
  const where = [!viaHood && (l.nbhd?.name || l.neighborhood) ? hoodName(l.nbhd?.name || l.neighborhood) : null,
    l.place?.municipality && l.place.name !== l.settlement ? placeName(l.settlement, l.settlementKind) : null,
    !l.neighborhood && l.place?.kind && lang === 'en' ? KIND_EN[l.place.kind] : null,
    oblastLabel(l.oblast)].filter(Boolean).join(', ');
  const what = typeLabel(l.type, l.typeBg, lang, true) + (S.multiDeal ? `, ${dealLabel(l.deal, lang).toLowerCase()}` : '');
  const tags = [l._new ? `<span class="tag new">${esc(t('badgeNew'))}</span>` : '',
    l._stale ? `<span class="tag stale">${esc(t('badgeStaleShort'))}</span>` : '',
    isUnmapped(l) ? `<span class="tag nomap">${esc(t('notOnMap'))}</span>` : ''].join('');
  const fact = (cls, ic, label, value) => (value ? `<span class="${cls}">${icon(ic)}${label ? `<span class="sr-only">${esc(label)}: </span>` : ''}${esc(value)}</span>` : '');
  const facts = [
    fact('f-area', 'ruler', t('factArea'), l.area ? `${fmtNum(l.area)} ${sqm()}` : ''),
    fact('f-yard', 'tree', null, l.yard ? t('yardFact', { v: fmtNum(l.yard) }) : ''),
    fact('f-floor', 'stairs', null, floorText(l) ? t('floorFact', { v: floorText(l) }) : ''),
    fact('f-year', 'calendar-blank', getLang() === 'bg' ? t('colYear') : null, yearText(l) ? t('builtFact', { v: yearText(l) }) : ''),
  ].join('');
  const trend = l.priceTrend === 'down' ? `<span class="trend down" title="${esc(t('priceDown'))}">${icon('trend-down')}<span class="sr-only">${esc(t('priceDown'))}</span></span>`
    : l.priceTrend === 'up' ? `<span class="trend up" title="${esc(t('priceUp'))}">${icon('trend-up')}<span class="sr-only">${esc(t('priceUp'))}</span></span>` : '';
  const price = l.price != null ? fmtMoney(l.price, l.currency || 'EUR') : (l.priceOnRequest ? t('priceOnRequest') : '');
  const exVat = l.vatNote === 'Цената е без ДДС' ? `<span class="tag vat" title="${esc(t('exVatTitle'))}">${esc(t('exVat'))}</span>` : '';
  return `<li class="row${l._stale ? ' is-stale' : ''}" data-id="${esc(l.id)}">
<div class="row-media">${thumb ? `<img loading="lazy" src="${esc(thumb)}" alt="" width="136" height="102">` : icon('image')}</div>
<div class="row-main">
  <div class="row-title"><button type="button" class="row-open" data-open="${esc(l.id)}"><span class="name">${esc(listingPlace(l) || what)}</span></button>${tags}</div>
  <div class="row-sub">${esc(what)}${where ? ` · ${esc(where)}` : ''}</div>
  <div class="row-facts">${facts}</div>
</div>
<div class="row-side">
  <div class="row-tools">
    ${url ? `<a class="tool ext" href="${esc(url)}" target="_blank" rel="noopener noreferrer" title="${esc(t('openOriginal'))}" aria-label="${esc(t('openOriginal'))}">${icon('arrow-square-out')}</a>` : ''}
    <button type="button" class="tool star${starred ? ' on' : ''}" data-star="${esc(l.id)}" aria-pressed="${starred}" title="${esc(t(starred ? 'unstar' : 'star'))}" aria-label="${esc(t(starred ? 'unstar' : 'star'))}">${icon(starred ? 'star-fill' : 'star')}</button>
  </div>
  <div class="row-price"><div class="price">${trend}${esc(price)}</div>${l._ppm ? `<div class="ppm">${esc(fmtMoney(l._ppm))}/${esc(sqm())}</div>` : ''}${exVat}</div>
</div>
</li>`;
}

function renderList() {
  S.multiDeal = new Set(S.listings.map((l) => l.deal)).size > 1;
  $('#results').innerHTML = S.filtered.slice(0, S.limit).map(rowHtml).join('');
  renderEmpty();
  renderMore();
}

function loadMore() {
  if (S.limit >= S.filtered.length) return;
  const from = S.limit;
  S.limit += PAGE;
  $('#results').insertAdjacentHTML('beforeend', S.filtered.slice(from, S.limit).map(rowHtml).join(''));
  renderMore();
}

function renderMore() {
  const total = S.filtered.length;
  const shown = Math.min(S.limit, total);
  $('#more').innerHTML = total > shown
    ? `<span>${esc(t('shownOf', { shown: fmtNum(shown), total: fmtNum(total) }))}</span><button type="button" class="btn" data-more>${esc(t('showMore', { n: fmtNum(Math.min(PAGE, total - shown)) }))}</button>`
    : '';
}

function renderEmpty() {
  const el = $('#emptyMsg');
  const show = S.loaded ? S.filtered.length === 0 : !!S.loadError;
  el.hidden = !show || (S.readOnly && !S.listings.length);
  if (!show) return;
  const block = (ic, title, body, action = '') => `<span class="empty-icon">${icon(ic)}</span><h3>${esc(title)}</h3><p>${esc(body)}</p>${action}`;
  if (S.loadError) el.innerHTML = block('warning', t('loadErrorTitle'), t('loadErrorBody', { message: S.loadError }));
  else if (!S.listings.length) {
    el.innerHTML = block('house-simple-fill', t('emptyTitle'), t('emptyBody'),
      `<div class="empty-actions"><button type="button" class="btn primary" data-empty-search>${icon('list-magnifying-glass')}${esc(t('searchImot'))}</button><button type="button" class="btn" data-empty-import>${icon('cloud-arrow-down')}${esc(t('import'))}</button></div>`);
  } else {
    el.innerHTML = block('funnel-simple', t('emptyFilteredTitle'), t('emptyFilteredBody'),
      `<button type="button" class="btn" data-clear-all>${esc(t('clearAll'))}</button>`);
  }
}

/** On narrow screens only one pane shows at a time; the floating button switches. */
function setView(view) {
  S.view = view;
  document.body.classList.toggle('view-map', view === 'map');
  $('#viewToggle').innerHTML = view === 'map' ? `${icon('list-bullets')}<span>${esc(t('viewList'))}</span>` : `${icon('map-trifold')}<span>${esc(t('viewMap'))}</span>`;
  if (view === 'map' && S.map) requestAnimationFrame(() => S.map.invalidateSize());
}

// ---------------------------------------------------------------- rendering: map

// Base maps: free tile services that need no API key (Google's tiles may only be used via its API).
const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';
const ESRI_REF = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference';
const ESRI_CANVAS = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas';
const BASE_LAYERS = {
  light: {
    // Quiet greys that let the markers carry the colour; follows the system light/dark theme.
    label: 'layerLight', url: `${ESRI_CANVAS}/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
    overlays: [`${ESRI_CANVAS}/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`],
    dark: {
      url: `${ESRI_CANVAS}/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
      overlays: [`${ESRI_CANVAS}/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`],
    },
    opts: { maxNativeZoom: 16, attribution: 'Basemap &copy; <a href="https://www.esri.com" target="_blank" rel="noopener">Esri</a>, HERE, Garmin, &copy; OpenStreetMap contributors' },
  },
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
    opts: { subdomains: 'abc', maxNativeZoom: 17, attribution: `${OSM_ATTR}, SRTM, style &copy; <a href="https://opentopomap.org" target="_blank" rel="noopener">OpenTopoMap</a> (CC-BY-SA)` },
  },
};

/** The variant of a base map for the current system theme. */
const themed = (def) => (def.dark && DARK.matches ? def.dark : def);
const tileUrl = (def) => themed(def).url;

function setBaseLayer(key) {
  const name = BASE_LAYERS[key] ? key : 'light';
  const def = BASE_LAYERS[name];
  for (const l of S.base || []) S.map.removeLayer(l);
  const native = def.opts.maxNativeZoom;
  S.base = [
    L.tileLayer(tileUrl(def), { maxZoom: 18, zIndex: 1, ...def.opts }),
    ...(themed(def).overlays || []).map((url) => L.tileLayer(url, { maxZoom: 18, maxNativeZoom: native, zIndex: 2 })),
  ];
  for (const l of S.base) l.addTo(S.map);
  ui.baseLayer = name;
  saveUi();
}

/** Tile of the current map centre for a tile URL template: a live preview, like Google Maps' layer picker. */
function previewTile(url) {
  const c = S.map.getCenter();
  const z = Math.max(5, Math.min(14, Math.round(S.map.getZoom()) - 1));
  const n = 2 ** z;
  const lat = (c.lat * Math.PI) / 180;
  const x = Math.floor(((c.lng + 180) / 360) * n);
  const y = Math.floor(((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * n);
  return L.Util.template(url, { s: 'a', z, x, y, r: '' });
}

/** Top-right map buttons: map options (style + grouping) and zoom-to-results. */
function renderMapCtl(open = S.mapCtlOpen) {
  if (!S.mapCtl) return;
  const hasHoods = S.listings.some((l) => l.nbhd?.lat != null);
  const label = esc(t('mapOptions'));
  S.mapCtl.getContainer().innerHTML = `
<button type="button" class="map-fab" data-layers-toggle aria-expanded="${open}" aria-controls="lsPanel" title="${label}" aria-label="${label}">${icon('stack')}</button>
<button type="button" class="map-fab" data-fit title="${esc(t('fit'))}" aria-label="${esc(t('fit'))}">${icon('corners-out')}</button>
${open ? `<div class="ls-panel" id="lsPanel" role="group" aria-label="${label}">
  <div class="field"><span class="field-label">${esc(t('mapType'))}</span><div class="ls-grid">${Object.entries(BASE_LAYERS).map(([k, def]) => `
<button type="button" class="ls-opt" data-base="${k}" aria-pressed="${k === ui.baseLayer}"><span class="ls-thumb">${[tileUrl(def), ...(themed(def).overlays || [])].map((url) => `<img src="${esc(previewTile(url))}" alt="" width="64" height="64">`).join('')}</span><span>${esc(t(def.label))}</span></button>`).join('')}</div></div>
  ${hasHoods ? `<div class="field"><span class="field-label">${esc(t('groupBy'))}</span><div class="seg">
<button type="button" data-group="settlement" aria-pressed="${ui.groupMode === 'settlement'}">${esc(t('groupSettlement'))}</button>
<button type="button" data-group="neighborhood" aria-pressed="${ui.groupMode === 'neighborhood'}">${esc(t('groupNeighborhood'))}</button></div></div>` : ''}
</div>` : ''}`;
  S.mapCtlOpen = open;
}

function initMap() {
  if (!window.L) { $('#map').textContent = 'Map library failed to load.'; return; }
  // Whole zoom levels only: raster tiles stay pixel-sharp and never show hairline seams.
  const map = L.map('map', { zoomSnap: 1, maxZoom: 18, zoomControl: false }).setView([42.75, 25.3], 7);
  S.map = map;
  map.attributionControl.setPrefix(false);
  map.attributionControl.addAttribution('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
  map.attributionControl.addAttribution('<a href="https://www.geonames.org" target="_blank" rel="noopener">GeoNames</a>');
  const control = (cls, position) => {
    const C = L.Control.extend({
      onAdd() {
        const el = L.DomUtil.create('div', cls);
        L.DomEvent.disableClickPropagation(el);
        L.DomEvent.disableScrollPropagation(el);
        return el;
      },
    });
    return new C({ position }).addTo(map);
  };
  S.mapCtl = control('map-stack', 'topright');
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  S.legend = control('map-bl', 'bottomleft');
  setBaseLayer(ui.baseLayer);
  renderMapCtl(false);
  S.layer = L.layerGroup().addTo(map);
  DARK.addEventListener('change', () => { setBaseLayer(ui.baseLayer); renderMapCtl(); });
  const markerScale = () => {
    const z = map.getZoom();
    map.getContainer().style.setProperty('--mk-scale', z <= 7 ? 0.68 : z === 8 ? 0.76 : z === 9 ? 0.88 : 1);
  };
  map.on('zoomend', markerScale);
  markerScale();

  map.on('click', () => { if (S.mapCtlOpen) renderMapCtl(false); });
  map.getContainer().addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && S.mapCtlOpen) { renderMapCtl(false); $('[data-layers-toggle]').focus(); }
  });
  map.getContainer().addEventListener('click', (e) => {
    const open = e.target.closest('[data-open]');
    if (open) { openDetail(open.dataset.open); return; }
    const place = e.target.closest('[data-filter-place]');
    if (place) {
      ui.filters.place = place.dataset.filterPlace;
      map.closePopup();
      applyFilters();
      setView('list');
      focusPills('[data-pill="location"]');
      return;
    }
    if (e.target.closest('[data-layers-toggle]')) { map.closePopup(); renderMapCtl(!S.mapCtlOpen); return; }
    const base = e.target.closest('[data-base]');
    if (base) { setBaseLayer(base.dataset.base); renderMapCtl(true); $(`[data-base="${ui.baseLayer}"]`)?.focus(); return; }
    const mode = e.target.closest('[data-group]');
    if (mode) { ui.groupMode = mode.dataset.group; renderMap(); renderMapCtl(true); $(`[data-group="${ui.groupMode}"]`)?.focus(); saveUi(); return; }
    if (e.target.closest('[data-unmapped]')) { ui.filters.unmapped = !ui.filters.unmapped; applyFilters(); return; }
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
  // With few places, quintiles coincide; drop duplicates so no band is empty ("2,420-2,420").
  // Compare with the lowest value both before and after rounding, so one place gives one colour.
  const raw = [q(0.2), q(0.4), q(0.6), q(0.8)].filter((x) => x > v[0]);
  return [...new Set(raw.map((x) => Math.round(x / 10) * 10))].filter((x) => x > v[0]);
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
  return [kind, muni, oblastLabel(p.oblast)].filter(Boolean).join(', ');
}

function popupHtml(g) {
  const items = [...g.items].sort((a, b) => (a._eur ?? Infinity) - (b._eur ?? Infinity));
  const shown = items.slice(0, 8);
  const lang = getLang();
  const rows = shown.map((l) => {
    const size = [l.area ? `${fmtNum(l.area)} ${sqm()}` : '', l.yard ? t('yardFact', { v: fmtNum(l.yard) }) : ''].filter(Boolean).join(', ');
    const thumb = thumbFor(l);
    const img = thumb ? `<img loading="lazy" src="${esc(thumb)}" alt="" width="52" height="39">` : '<span class="pop-nophoto" aria-hidden="true"></span>';
    const price = l.price != null ? fmtMoney(l.price, l.currency || 'EUR') : (l.priceOnRequest ? t('priceOnRequest') : '');
    return `<li><button type="button" data-open="${esc(l.id)}">${img}<span class="pop-desc">${esc(typeLabel(l.type, l.typeBg, lang, true))}<br><span class="muted">${esc(size)}</span></span><b>${esc(price)}</b></button></li>`;
  }).join('');
  const more = items.length > shown.length ? `<li class="more-n">${esc(t('popupMore', { n: items.length - shown.length }))}</li>` : '';
  const n = g.items.length;
  return `<div class="pop">
<div class="pop-title">${esc(groupTitle(g))}</div>
<div class="pop-sub">${esc(groupSub(g))}</div>
<div class="pop-stats">
  <div><b>${esc(fmtNum(n))}</b><span>${esc(t('statListings', { n }))}</span></div>
  ${g.medPrice != null ? `<div><b>${esc(fmtMoney(g.medPrice))}</b><span>${esc(t('statMedian'))}</span></div>` : ''}
  ${g.medPpm != null ? `<div><b>${esc(fmtMoney(g.medPpm))}</b><span>${esc(t('statPpm'))}</span></div>` : ''}
</div>
<ul class="pop-list">${rows}${more}</ul>
<button type="button" class="btn small primary" data-filter-place="${esc(g.key)}">${esc(t('popupShowAll', { n: fmtNum(n) }))}</button>
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
    const icon_ = L.divIcon({
      className: 'mk-wrap',
      html: `<div class="mk ${bin < 0 ? 'mk-nodata' : `mk-b${MARKER_RAMP.indexOf(rampColor(bin, breaks))}`} ${selected ? 'mk-selected' : ''}" style="width:${size}px;height:${size}px;${bin >= 0 ? `--mk:${rampColor(bin, breaks)}` : ''}">${n}</div>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
      popupAnchor: [0, -size / 2],
    });
    const m = L.marker([g.lat, g.lon], { icon: icon_, title: `${groupTitle(g)}: ${t('popupCount', { n })}`, alt: groupTitle(g), riseOnHover: true });
    // Clearance so the popup isn't tucked under the map buttons.
    m.bindPopup(() => popupHtml(g), { maxWidth: 340, minWidth: 280, autoPanPaddingTopLeft: [20, 20], autoPanPaddingBottomRight: [70, 20], closeButton: true });
    m.addTo(S.layer);
    S.markerByKey.set(g.key, m);
  }
  renderLegend(breaks, list.some((g) => g.medPpm == null), unmapped);
  if (!S.fitted && list.length) { fitMap(); S.fitted = true; }
}

function fitMap() {
  if (!S.map || !S.groups.length) return;
  const b = L.latLngBounds(S.groups.map((g) => [g.lat, g.lon]));
  S.map.fitBounds(b, { padding: [30, 30], maxZoom: 12 }); // ~ the largest marker's radius
}

/** Bottom-left: the "not on the map" toggle and a compact colour-scale legend. */
function renderLegend(breaks, hasNoData, unmapped) {
  const el = S.legend.getContainer();
  const on = ui.filters.unmapped;
  const chip = unmapped || on ? `<button type="button" class="map-chip" data-unmapped aria-pressed="${on}" title="${esc(t('onlyUnmappedTitle'))}">${icon(on ? 'x' : 'gps-slash')}<span>${esc(on ? t('unmappedActive') : t('unmapped', { n: fmtNum(unmapped) }))}</span></button>` : '';
  let legend = '';
  if (breaks.length) {
    const bins = breaks.length + 1;
    const swatches = Array.from({ length: bins }, (_, i) => `<span style="background:${rampColor(i, breaks)}"></span>`).join('');
    const labels = breaks.map((b, i) => `<span style="left:${(((i + 1) / bins) * 100).toFixed(2)}%">${esc(fmtNum(b))}</span>`).join('');
    legend = `<div class="map-legend" title="${esc(t('legendSize'))}">
<div class="lg-title"><span>${esc(t('legendTitle'))}</span>${hasNoData ? `<span class="lg-nd"><span class="lg-sw"></span>${esc(t('legendNoData'))}</span>` : ''}</div>
<div class="lg-strip" aria-hidden="true">${swatches}</div><div class="lg-labels" aria-hidden="true">${labels}</div>
<span class="sr-only">${esc(t('legendSr', { breaks: breaks.map((b) => fmtNum(b)).join(', ') }))}</span></div>`;
  }
  el.innerHTML = chip + legend;
}

function highlightMarker(id, on) {
  const l = S.byId.get(id);
  const g = l && groupOf(l);
  const m = g && S.markerByKey.get(g.key);
  const el = m?.getElement()?.querySelector('.mk');
  if (!el) return;
  el.classList.toggle('mk-hl', on);
  m.setZIndexOffset(on ? 10000 : 0);
}

function showOnMap(l) {
  const g = groupOf(l);
  if (!g || !S.map) return;
  $('#detailDlg').close();
  setView('map');
  const m = S.markerByKey.get(g.key);
  const zoom = Math.max(S.map.getZoom(), 12);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { S.map.setView([g.lat, g.lon], zoom); m?.openPopup(); return; }
  S.map.flyTo([g.lat, g.lon], zoom, { duration: 0.8 });
  if (m) S.map.once('moveend', () => m.openPopup());
}

// ---------------------------------------------------------------- detail dialog

let descOpen = false; // "Show more" state of the description; survives re-renders of the same listing

/** A listing's photos that are safe to show (imot.bg CDN only). */
const detailPhotos = (l) => (l?.photos || []).map(safeUrl).filter(Boolean);

function openDetail(id) {
  if (!S.byId.has(id)) return;
  const dlg = $('#detailDlg');
  if (id !== S.detailId || !dlg.open) descOpen = false;
  S.detailId = id;
  S.photoIdx = 0;
  renderDetail();
  if (!dlg.open) dlg.showModal();
  $('#detailBody').scrollTop = 0;
}

/** One row of the quiet meta list in the summary card. */
function fact(label, value) {
  return value == null || value === '' ? '' : `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`;
}

/** One cell of the key-facts grid: muted icon, small label, value. */
function keyFact(ic, label, value, wide = false) {
  return value ? `<div class="kf${wide ? ' wide' : ''}">${icon(ic, 'kf-i')}<dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>` : '';
}

function galleryHtml(photos, i) {
  const n = photos.length;
  if (!n) return `<div class="gallery"><div class="empty-gallery">${icon('image')}<span>${esc(t('noPhotos'))}</span></div></div>`;
  const nav = (dir, ic, label) => `<button type="button" class="ph-nav ${dir < 0 ? 'prev' : 'next'}" data-photo-step="${dir}" title="${esc(t(label))}" aria-label="${esc(t(label))}">${icon(ic)}</button>`;
  return `<div class="gallery">
  <div class="main-photo">
    <img class="ph-bg" src="${esc(photos[i])}" alt="">
    <img class="ph-img" src="${esc(photos[i])}" alt="${esc(t('photoOf', { i: i + 1, n }))}">
    ${n > 1 ? `${nav(-1, 'caret-left', 'prevPhoto')}${nav(1, 'caret-right', 'nextPhoto')}
    <span class="ph-count" aria-live="polite">${icon('image')}<span class="ph-count-n">${esc(fmtNum(i + 1))} / ${esc(fmtNum(n))}</span></span>` : ''}
  </div>
  ${n > 1 ? `<div class="thumbs">${photos.map((p, k) => `<button type="button" data-photo="${k}"${k === i ? ' class="on" aria-current="true"' : ''} aria-label="${esc(t('photoOf', { i: k + 1, n }))}"><img loading="lazy" src="${esc(thumbOf(p))}" alt=""></button>`).join('')}</div>` : ''}
</div>`;
}

/** Keep the selected thumbnail in view without scrolling the dialog itself. */
function syncThumbs() {
  const strip = $('#detailBody .thumbs');
  const on = strip?.querySelector('.on');
  if (on) strip.scrollLeft = on.offsetLeft - (strip.clientWidth - on.offsetWidth) / 2;
}

function preloadPhotos(photos, i) {
  const n = photos.length;
  if (n > 1) for (const k of [i + 1, i - 1]) new Image().src = photos[(k + n) % n];
}

/** Show photo S.photoIdx by updating the gallery in place (no flash, focus stays put). */
function renderGallery() {
  const g = $('#detailBody .gallery');
  const photos = detailPhotos(S.byId.get(S.detailId));
  if (!g || photos.length < 2 || !g.querySelector('.ph-img')) { renderDetail(); return; }
  const n = photos.length;
  const i = Math.min(S.photoIdx, n - 1);
  $('.main-photo', g).classList.remove('ph-broken');
  for (const img of $$('.ph-img, .ph-bg', g)) img.src = photos[i];
  $('.ph-img', g).alt = t('photoOf', { i: i + 1, n });
  $('.ph-count-n', g).textContent = `${fmtNum(i + 1)} / ${fmtNum(n)}`;
  for (const b of $$('[data-photo]', g)) {
    const on = Number(b.dataset.photo) === i;
    b.classList.toggle('on', on);
    if (on) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
  }
  syncThumbs();
  preloadPhotos(photos, i);
}

/** A selector for the focused control in the detail dialog, to restore focus after a re-render. */
function detailFocusKey() {
  const a = document.activeElement;
  if (!a || !$('#detailDlg').contains(a)) return null;
  for (const attr of ['data-nav', 'data-photo-step', 'data-photo']) if (a.hasAttribute(attr)) return `[${attr}="${CSS.escape(a.getAttribute(attr))}"]`;
  for (const attr of ['data-star', 'data-close', 'data-show-map', 'data-desc-toggle']) if (a.hasAttribute(attr)) return `[${attr}]`;
  if (a.id === 'noteInput') return '#noteInput';
  return '#detailTitle'; // anything else is re-created; keep focus (and the keyboard shortcuts) inside the dialog
}

function toggleDesc(btn) {
  descOpen = !descOpen;
  const box = $('#descText');
  box?.classList.toggle('clamped', !descOpen);
  btn.setAttribute('aria-expanded', String(descOpen));
  btn.innerHTML = `<span>${esc(t(descOpen ? 'descLess' : 'descMore'))}</span>${icon(descOpen ? 'caret-up' : 'caret-down')}`;
  if (!descOpen) box?.scrollIntoView({ block: 'nearest' });
}

function renderDetail() {
  const l = S.byId.get(S.detailId);
  if (!l) return;
  const focusKey = detailFocusKey();
  const lang = getLang();
  const idx = S.filtered.findIndex((x) => x.id === l.id);
  const photos = detailPhotos(l);
  const i = Math.min(S.photoIdx, Math.max(0, photos.length - 1));
  const starred = stars.has(l.id);
  const url = safeUrl(l.url);
  const typeText = typeLabel(l.type, l.typeBg, lang);
  const place = listingPlace(l);
  // The title names the place; the subline adds what it leaves out (neighbourhood, town, province).
  const viaHood = l.place?.via === 'neighborhood';
  const hood = viaHood ? null : l.nbhd?.name || l.neighborhood;
  const where = [hood ? hoodName(hood) : null, viaHood ? placeName(l.settlement, l.settlementKind) : null, oblastLabel(l.oblast)].filter(Boolean).join(', ');
  const starLabel = esc(t(starred ? 'unstar' : 'star'));

  $('#detailHead').innerHTML = `
<div class="dh-title">
  <h2 id="detailTitle" tabindex="-1" autofocus>${esc(place ? `${typeText} · ${place}` : typeText)}</h2>
  <p class="dh-sub">${esc(dealLabel(l.deal, lang))}${where ? `, ${esc(where)}` : ''}</p>
</div>
<div class="dh-actions">
  <button type="button" class="btn icon ghost star${starred ? ' on' : ''}" data-star="${esc(l.id)}" aria-pressed="${starred}" title="${starLabel}" aria-label="${starLabel}">${icon(starred ? 'star-fill' : 'star')}</button>
  <span class="dh-sep" aria-hidden="true"></span>
  <button type="button" class="btn icon ghost" data-nav="-1" ${idx <= 0 ? 'disabled' : ''} title="${esc(t('prevListing'))}" aria-label="${esc(t('prevListing'))}">${icon('caret-left')}</button>
  ${idx >= 0 ? `<span class="dh-count">${esc(fmtNum(idx + 1))} / ${esc(fmtNum(S.filtered.length))}</span>` : ''}
  <button type="button" class="btn icon ghost" data-nav="1" ${idx < 0 || idx >= S.filtered.length - 1 ? 'disabled' : ''} title="${esc(t('nextListing'))}" aria-label="${esc(t('nextListing'))}">${icon('caret-right')}</button>
  <span class="dh-sep" aria-hidden="true"></span>
  <button type="button" class="btn icon ghost" data-close title="${esc(t('close'))}" aria-label="${esc(t('close'))}">${icon('x')}</button>
</div>`;

  // ---- summary card
  const price = l.price != null ? fmtMoney(l.price, l.currency || 'EUR') : t(l.priceOnRequest ? 'priceOnRequest' : 'noPrice');
  const trendKey = l.priceTrend === 'down' ? 'priceDown' : l.priceTrend === 'up' ? 'priceUp' : null;
  const trend = trendKey ? `<span class="trend ${l.priceTrend === 'down' ? 'down' : 'up'}" title="${esc(t(trendKey))}">${icon(l.priceTrend === 'down' ? 'trend-down' : 'trend-up')}<span class="sr-only">${esc(t(trendKey))}</span></span>` : '';
  const exVat = l.vatNote === 'Цената е без ДДС';
  const tags = [l._new ? `<span class="tag new">${esc(t('badgeNew'))}</span>` : '',
    l._stale ? `<span class="tag stale" title="${esc(t('badgeStale'))}">${esc(t('badgeStaleShort'))}</span>` : ''].join('');
  const status = l.status ? CONSTRUCTION_STATUS[l.status]?.[lang] : null;
  const keyFacts = [
    keyFact('ruler', t('factArea'), l.area ? `${fmtNum(l.area)} ${sqm()}` : ''),
    keyFact('tree', t('factYard'), l.yard ? `${fmtNum(l.yard)} ${sqm()}` : ''),
    keyFact('stairs', t('factFloor'), floorText(l)),
    keyFact('calendar-blank', t('factBuilt'), yearText(l) || l.yearText),
    keyFact('fire', t('factHeating'), l.heating ? term(l.heating, lang) : ''),
    keyFact('buildings', t('factConstruction'), [l.material ? term(l.material, lang) : null, status].filter(Boolean).join(', '), true),
    keyFact('map-pin', t('factAddress'), l.address, true),
  ].join('');
  const actions = `<div class="sum-actions">
    ${url ? `<a class="btn primary" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${icon('arrow-square-out')}<span>${esc(t('openOriginal'))}</span></a>` : ''}
    ${isUnmapped(l) ? `<span class="tag nomap" title="${esc(t('onlyUnmappedTitle'))}">${icon('gps-slash')}${esc(t('notOnMap'))}</span>`
    : `<button type="button" class="btn" data-show-map>${icon('map-pin')}<span>${esc(t('showOnMap'))}</span></button>`}
  </div>`;

  const agencyUrl = safeUrl(l.agency?.url);
  const seller = l.agency?.name
    ? `<div class="ct-name">${agencyUrl ? `<a href="${esc(agencyUrl)}" target="_blank" rel="noopener noreferrer">${esc(l.agency.name)}</a>` : esc(l.agency.name)}</div>${l.agency.address ? `<div class="ct-sub" lang="bg">${esc(l.agency.address)}</div>` : ''}`
    : l.detailsFetchedAt ? `<div class="ct-name">${esc(t('private'))}</div>` : '';
  const contact = seller || l.broker || l.phone ? `<div class="sum-block">
    <h3 class="sum-h">${esc(t('contact'))}</h3>
    ${seller}
    ${l.broker ? `<div class="ct-row"><span class="ct-label">${esc(t('broker'))}</span> <span lang="bg">${esc(l.broker)}</span></div>` : ''}
    ${l.phone ? `<a class="ct-phone" href="tel:${esc(l.phone.replace(/[^\d+]/g, ''))}">${icon('phone')}<span>${esc(l.phone)}</span></a>` : ''}
  </div>` : '';

  const meta = [
    fact(t('factId'), l.id),
    fact(t('factUpdated'), l.updatedAt ? fmtDate(l.updatedAt, true) : ''),
    fact(t('factViews'), l.views != null ? fmtNum(l.views) : ''),
    fact(t('factFirstSeen'), fmtDate(l.firstSeen)),
    fact(t('factLastSeen'), fmtDate(l.lastSeen)),
    fact(t('factPromo'), l.promo),
  ].join('');

  const summary = `<div class="summary">
  <div class="sum-head">
    ${tags ? `<div class="sum-tags">${tags}</div>` : ''}
    <div class="sum-price">${esc(price)}${trend}${exVat ? `<span class="tag vat" title="${esc(t('exVatTitle'))}">${esc(t('exVat'))}</span>` : ''}</div>
    ${l._ppm || (l.vatNote && !exVat) ? `<div class="sum-ppm">${[l._ppm ? `${esc(fmtMoney(l._ppm))}/${esc(sqm())}` : '', l.vatNote && !exVat ? esc(term(l.vatNote, lang)) : ''].filter(Boolean).join(', ')}</div>` : ''}
  </div>
  ${keyFacts ? `<dl class="key-facts">${keyFacts}</dl>` : ''}
  ${actions}
  ${contact}
  ${meta ? `<dl class="sum-meta">${meta}</dl>` : ''}
</div>`;

  // ---- main column
  const descLines = (l.description || '').split('\n').reduce((n, p) => n + Math.max(1, Math.ceil(p.length / 90)), 0);
  const longDesc = descLines > 14;
  const desc = l.description ? `<section class="d-sec">
  <div class="d-sec-head"><h3>${esc(t('description'))}</h3>${lang === 'en' ? `<span class="d-sec-note">${icon('translate')}${esc(t('descriptionOriginal'))}</span>` : ''}</div>
  <div id="descText" class="desc-wrap${longDesc && !descOpen ? ' clamped' : ''}"><p class="desc" lang="bg">${esc(l.description)}</p></div>
  ${longDesc ? `<button type="button" class="btn link desc-toggle" data-desc-toggle aria-expanded="${descOpen}" aria-controls="descText"><span>${esc(t(descOpen ? 'descLess' : 'descMore'))}</span>${icon(descOpen ? 'caret-up' : 'caret-down')}</button>` : ''}
  ${l.descriptionFull ? '' : `<p class="d-note">${icon('info')}<span>${esc(t('descriptionSnippet'))}</span></p>`}
</section>` : '';

  const features = (l.features || []).length
    ? `<section class="d-sec"><h3>${esc(t('features'))}</h3><div class="chips">${l.features.map((f) => `<span class="chip"${lang === 'bg' ? '' : ` title="${esc(f)}"`}>${esc(term(f, lang))}</span>`).join('')}</div></section>` : '';

  const hist = l.priceHistory || [];
  const delta = (h, prev) => (prev && h.price != null && prev.price != null && (h.currency || 'EUR') === (prev.currency || 'EUR') ? h.price - prev.price : 0);
  const fmtDelta = (d, currency) => new Intl.NumberFormat(locale(), { style: 'currency', currency: currency || 'EUR', maximumFractionDigits: 0, signDisplay: 'exceptZero' }).format(d);
  const history = hist.length > 1 ? `<section class="d-sec">
  <div class="d-sec-head"><h3>${esc(t('priceHistory'))}</h3><span class="d-sec-note">${esc(t('priceHistoryHint'))}</span></div>
  <ol class="hist">${hist.map((h, k) => {
    const d = delta(h, hist[k - 1]);
    return `<li><span class="h-date">${esc(fmtDate(h.at))}</span><span class="h-price">${esc(fmtMoney(h.price, h.currency || 'EUR'))}</span><span class="h-delta${d < 0 ? ' down' : d > 0 ? ' up' : ''}">${d ? `${icon(d < 0 ? 'trend-down' : 'trend-up')}${esc(fmtDelta(d, h.currency))}` : ''}</span></li>`;
  }).reverse().join('')}</ol>
</section>` : '';

  const note = `<section class="d-sec">
  <div class="d-sec-head"><h3><label for="noteInput">${esc(t('note'))}</label></h3><span class="d-sec-note" id="noteHint">${esc(t('noteHint'))}</span></div>
  <textarea id="noteInput" rows="3" aria-describedby="noteHint" placeholder="${esc(t('notePlaceholder'))}">${esc(notes[l.id] || '')}</textarea>
</section>`;

  $('#detailBody').innerHTML = `
<div class="detail-grid">
  <div class="d-gallery">${galleryHtml(photos, i)}</div>
  <aside class="d-side">${summary}</aside>
  <div class="d-main">${desc}${features}${history}${note}</div>
</div>`;

  syncThumbs();
  preloadPhotos(photos, i);
  // Warm up the neighbouring listings' first photos so j/k feels instant.
  for (const d of [-1, 1]) { const p = idx >= 0 && detailPhotos(S.filtered[idx + d])[0]; if (p) new Image().src = p; }
  if (focusKey) {
    const el = $(`#detailDlg ${focusKey}`);
    (el && !el.disabled ? el : $('#detailDlg [data-nav]:not(:disabled)') || $('#detailTitle'))?.focus({ preventScroll: true });
  }
}

function stepDetail(delta) {
  const idx = S.filtered.findIndex((x) => x.id === S.detailId);
  const next = S.filtered[idx + delta];
  if (next) openDetail(next.id);
}

function stepPhoto(delta) {
  const n = detailPhotos(S.byId.get(S.detailId)).length;
  if (n < 2) return;
  S.photoIdx = (S.photoIdx + delta + n) % n;
  renderGallery();
}

function toggleStar(id) {
  if (stars.has(id)) stars.delete(id); else stars.add(id);
  saveJson('stars', [...stars]);
  if (ui.filters.starred) {
    applyFilters({ keepPage: true });
    if (!$('#detailDlg').open && document.activeElement === document.body) focusPills();
  }
  else {
    const on = stars.has(id);
    for (const b of $$(`#results [data-star="${CSS.escape(id)}"]`)) {
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
      b.title = t(on ? 'unstar' : 'star');
      b.setAttribute('aria-label', b.title);
      b.innerHTML = icon(on ? 'star-fill' : 'star');
    }
    renderPills();
  }
  if ($('#detailDlg').open && S.detailId === id) renderDetail();
}

// ---------------------------------------------------------------- import dialog

function renderJob() {
  const j = S.job;
  const running = j && (j.status === 'running' || j.status === 'queued');
  $('#btnStart').disabled = !!running;
  $('#btnCancel').hidden = !running;
  $('#btnImport').classList.toggle('busy', !!running);
  sfUpdateFoot();
  if (S.sf.view === 'job') renderSearchInfo();
  // The import dialog and the imot.bg search dialog both show the job.
  for (const box of $$('[data-job-view]')) renderJobInto(box, j, running);
}

function renderJobInto(box, j, running) {
  if (!j) { box.innerHTML = ''; return; }
  // The job view re-renders every second while running: keep the log disclosure and its scroll as they were.
  const oldLog = box.querySelector('.job-log');
  const logOpen = !!box.querySelector('.job-more')?.open;
  const logAtEnd = !oldLog || oldLog.scrollTop + oldLog.clientHeight >= oldLog.scrollHeight - 4;
  const logTop = oldLog?.scrollTop || 0;
  const p = j.progress || {};
  const bar = (label, done, total) => (total ? `<div class="prog"><div class="prog-label"><span>${esc(label)}</span><span class="prog-n">${esc(fmtNum(done))} / ${esc(fmtNum(total))}</span></div><progress max="${esc(total)}" value="${esc(done)}" aria-label="${esc(label)}"></progress></div>` : '');
  const errText = j.error?.code && t(`err_${j.error.code}`) !== `err_${j.error.code}` ? t(`err_${j.error.code}`) : j.error?.message;
  const [ic, title, sub] = running ? [null, t('importRunning'), t(`phase_${j.phase}`)]
    : j.status === 'done' ? ['check', t('importDone'), '']
    : j.status === 'cancelled' ? ['x-circle', t('importCancelled'), t('importCancelledHint')]
    : j.status === 'error' ? ['warning', t('importStopped'), errText || '']
    : ['info', String(j.status || ''), ''];
  const entries = j.log || [];
  const warnings = entries.filter((e) => e.params?.level === 'warn' || e.params?.level === 'error').length;
  const log = entries.slice(-14).map((e) => {
    const params = { ...e.params };
    if ('capped' in params) params.capped = params.capped ? '+' : '';
    if (params.reason) params.reason = t(`reason_${params.reason}`);
    const text = t(`log_${e.code}`, params);
    return `<li class="${esc(params.level || '')}">${esc(text)}</li>`;
  }).join('');
  const found = running && p.found ? `<span class="job-found">${esc(t('progFound', { n: fmtNum(p.found) }))}</span>` : '';
  box.innerHTML = `
<div class="job-card ${esc(j.status)}">
  <div class="job-status" role="status"><span class="job-icon">${running ? '<span class="spinner"></span>' : icon(ic)}</span><span class="job-title">${esc(title)}</span>${found}</div>
  ${sub ? `<p class="job-sub">${esc(sub)}</p>` : ''}
  ${running ? `<div class="progs">${bar(t('progPages'), p.searchPages, p.searchPagesTotal)}${bar(t('progDetails'), p.details, p.detailsTotal)}${bar(t('progGeocode'), p.geocode, p.geocodeTotal)}</div>` : ''}
  ${!running && j.result ? `<p class="job-result">${esc(t('importResult', { ...Object.fromEntries(Object.entries(j.result).map(([k, v]) => [k, fmtNum(v)])) }))}</p>` : ''}
  ${log ? `<details class="job-more"${logOpen ? ' open' : ''}><summary>${icon('caret-right', 'job-caret')}<span>${esc(t('jobDetails'))}</span>${warnings ? `<span class="job-warn">${icon('warning')}${esc(t('jobWarnings', { n: fmtNum(warnings) }))}</span>` : ''}</summary><ul class="job-log" tabindex="0">${log}</ul></details>` : ''}
</div>`;
  const newLog = box.querySelector('.job-log');
  if (newLog && logOpen) newLog.scrollTop = logAtEnd ? newLog.scrollHeight : logTop;
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
      // Listings are saved once all search pages are read, so show them while details load.
      if (prevPhase === 'search' && job.phase !== 'search') reload();
      S.pollTimer = setTimeout(pollJob, 1000);
    } else if (prevPhase && prevPhase !== 'done') {
      await reload();
    }
  } catch (err) {
    S.pollTimer = setTimeout(pollJob, 3000);
  }
}

/** Import options; the switches in the import and search dialogs mirror each other. */
function importOptions() {
  const on = (k) => $(`[data-opt="${k}"]`)?.checked !== false;
  return { details: on('details'), autoSplit: on('autoSplit'), geocodeOnline: on('geocodeOnline') };
}

async function startImport(inputs) {
  const options = importOptions();
  try {
    const { job } = await api('/api/import', { method: 'POST', body: { inputs, options } });
    S.job = job; S.lastPhase = job.phase;
    renderJob();
    pollJob();
  } catch (err) {
    $('#jobView').innerHTML = `<div class="job-card error"><div class="job-status" role="alert"><span class="job-icon">${icon('warning')}</span><span class="job-title">${esc(err.message)}</span></div></div>`;
  }
}

function renderSources() {
  const box = $('#sourcesList');
  if (!box) return;
  const list = Object.values(S.sources).sort((a, b) => String(b.lastImportAt).localeCompare(String(a.lastImportAt)));
  if (!list.length) { box.innerHTML = `<p class="sources-empty">${esc(t('sourcesEmpty'))}</p>`; $('#btnReimportAll').hidden = true; return; }
  $('#btnReimportAll').hidden = !list.some((s) => s.url);
  const count = countBy(S.listings.flatMap((l) => l.sources || []), (s) => s);
  const tool = (attr, id, ic, label, name, cls = '') => `<button type="button" class="btn small icon ghost${cls}" ${attr}="${esc(id)}" title="${esc(label)}" aria-label="${esc(`${label}: ${name}`)}">${icon(ic)}</button>`;
  box.innerHTML = `<ul class="sources">${list.map((s) => {
    const url = safeUrl(s.url);
    const name = s.url ? s.url.replace(/^https?:\/\/(www\.)?/, '') : t('manualSource');
    const params = (s.paramsText || '').replace(/[\s,]+$/, '');
    return `<li class="source">
  <div class="source-main">
    ${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer" class="source-url" title="${esc(s.url)}">${esc(name)}</a>` : `<span class="source-url"${s.url ? ` title="${esc(s.url)}"` : ''}>${esc(name)}</span>`}
    ${params ? `<p class="source-params" title="${esc(params)}"><span class="sp-label">${esc(t('sourceParamsLabel'))}</span> <span lang="bg">${esc(params)}</span></p>` : ''}
    <p class="source-meta"><span>${esc(t('sourceInfo', { n: fmtNum(count.get(s.id) || 0), date: fmtDate(s.lastImportAt, true) }))}</span>${s.splits ? `<span class="tag" title="${esc(t('sourceCappedTitle'))}">${esc(t('sourceCapped'))}</span>` : ''}</p>
  </div>
  <div class="source-actions">
    ${s.url ? tool('data-reimport', s.id, 'arrow-clockwise', t('reimport'), name) : ''}
    ${tool('data-remove-source', s.id, 'trash', t('removeSource'), name, ' remove')}
  </div>
</li>`;
  }).join('')}</ul>`;
}

// ---------------------------------------------------------------- imot.bg search dialog
// Mirrors imot.bg's own search form. The option lists come from the live form (through the
// server), so property-type ids and extra-filter fields always match the chosen deal.

const SEARCH_QUERY = {
  deal: 'sale', types: [], location: '', districts: [], priceMin: '', priceMax: '', currency: 'EUR', ppmMin: '', ppmMax: '',
  areaMin: '', areaMax: '', floorFrom: '', floorTo: '', sort: '', keyword: '', yardMin: '', yardMax: '', status: [],
  yearFrom: '', yearTo: '', extras: {}, photoOnly: false, videoOnly: false,
};
const SF_FIELDS = ['location', 'priceMin', 'priceMax', 'currency', 'ppmMin', 'ppmMax', 'areaMin', 'areaMax', 'floorFrom', 'floorTo',
  'sort', 'keyword', 'yardMin', 'yardMax', 'yearFrom', 'yearTo'];
// Form labels that are not listing types of their own.
const SF_TYPE_LABELS = { 'СТАЯ': ['Room', 'Стая'], 'МЯСТО': ['Plot', 'Място'], 'ГАРАЖ, ПАРКОМЯСТО': ['Garage, parking space', 'Гараж, паркомясто'] };
const SF_PLACE_PREFIX = [[/^гр\.\s*/, 'town'], [/^с\.\s*/, 'village'], [/^к\.к\.\s*/, 'resort'], [/^(?:м-т|местност)\s*/i, 'locality'], [/^в\.з\.\s*/, 'villaZone']];
let sq = { ...SEARCH_QUERY, ...loadJson('searchQuery', {}) };
if (sq.deal !== 'rent') sq.deal = 'sale';

const sfRunning = () => !!S.job && (S.job.status === 'running' || S.job.status === 'queued');

function sfTypeLabel(bg) {
  const lang = getLang();
  if (SF_TYPE_LABELS[bg]) return SF_TYPE_LABELS[bg][lang === 'bg' ? 1 : 0];
  const p = PROPERTY_TYPES.find((x) => x.re.test(bg));
  if (p) return lang === 'bg' ? p.bg : p.en;
  return bg.charAt(0) + bg.slice(1).toLowerCase();
}

/** "град София" -> Sofia, "област София" -> Sofia Province (English); Bulgarian as imot.bg writes it. */
function sfLocationLabel(v) {
  if (getLang() === 'bg') return v;
  const m = v.match(/^(град|област)\s+(.+)$/);
  if (!m) return term(v, 'en');
  return m[1] === 'град' ? transliterate(m[2]) : oblastLabel(m[2]);
}

function sfDistrictLabel(d) {
  if (getLang() === 'bg') return d;
  for (const [re, kind] of SF_PLACE_PREFIX) if (re.test(d)) return `${transliterate(d.replace(re, ''))} (${KIND_EN[kind]})`;
  return transliterate(d);
}

function sfFloorLabel(o) {
  if (getLang() === 'bg') return o.label;
  return { 1000: t('sfTopOnly'), 999: t('sfNotTop'), 0: t('sfGround') }[o.value] ?? o.value;
}

function sfSortLabel(o) {
  const key = `sfSort${o.value}`;
  return getLang() === 'bg' || t(key) === key ? o.label : t(key);
}

/** Extra-filter sections imot.bg shows for the chosen property types. */
function sfSections() {
  const out = new Set();
  for (const id of sq.types) for (const s of S.sf.form?.sectionsByType[id] || []) out.add(s);
  return out;
}

function sfSelect(name, opts, value, { any = t('sfAny'), id = '' } = {}) {
  return `<select name="${esc(name)}"${id ? ` id="${id}"` : ''}>${any != null ? `<option value="">${esc(any)}</option>` : ''}${
    opts.map((o) => `<option value="${esc(o.value)}"${String(value) === o.value ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
}

function sfNum(name, label, suffix, step) {
  return `<label class="num-field"><span class="hint">${esc(label)}</span><span class="affix${suffix.length > 2 ? ' wide' : ''}"><input type="number" name="${name}" min="0" step="${step}" inputmode="decimal" value="${esc(sq[name])}"><span class="sfx"${/^(price|ppm)/.test(name) ? ' data-cur' : ''}>${esc(suffix)}</span></span></label>`;
}

const sfRange = (a, b, suffix, step) => `<div class="range">${sfNum(a, t('sfFrom'), suffix, step)}<span class="range-sep">-</span>${sfNum(b, t('sfTo'), suffix, step)}</div>`;
const sfSelRange = (a, b, optsA, optsB) => `<div class="range"><label class="num-field"><span class="hint">${esc(t('sfFrom'))}</span>${sfSelect(a, optsA, sq[a])}</label><span class="range-sep">-</span><label class="num-field"><span class="hint">${esc(t('sfTo'))}</span>${sfSelect(b, optsB, sq[b])}</label></div>`;
const sfGroup = (id, label, body, attrs = '') => `<div class="sf-field" role="group" aria-labelledby="sfL-${id}"${attrs}><span class="field-label" id="sfL-${id}">${esc(label)}</span>${body}</div>`;
const sfChip = (name, value, label, on) => `<label class="chip"><input type="checkbox" name="${esc(name)}" value="${esc(value)}"${on ? ' checked' : ''}><span>${esc(label)}</span></label>`;
const sfChips = (label, chips, attrs = '') => `<fieldset class="sf-field"${attrs}><legend class="field-label">${esc(label)}</legend><div class="chips">${chips}</div></fieldset>`;
const sfSeg = (name, label, opts, value) => `<div class="seg sf-seg" role="radiogroup" aria-label="${esc(label)}">${
  opts.map(([v, text]) => `<label><input type="radio" name="${name}" value="${esc(v)}"${value === v ? ' checked' : ''}><span>${esc(text)}</span></label>`).join('')}</div>`;

function sfLocationOptions(f) {
  const collator = new Intl.Collator(locale());
  const opt = (v) => `<option value="${esc(v)}"${sq.location === v ? ' selected' : ''}>${esc(sfLocationLabel(v))}</option>`;
  const group = (label, list) => (list.length ? `<optgroup label="${esc(label)}">${list.sort((a, b) => collator.compare(sfLocationLabel(a), sfLocationLabel(b))).map(opt).join('')}</optgroup>` : '');
  const all = f.locations.map((l) => l.value);
  return `<option value="">${esc(t('sfAnywhere'))}</option>${group(t('sfCities'), all.filter((v) => v.startsWith('град ')))}${
    group(t('sfProvinces'), all.filter((v) => v.startsWith('област ')))}${group(t('sfAbroad'), all.filter((v) => !/^(град|област) /.test(v)))}`;
}

function sfPickedHtml() {
  return sq.districts.map((d) => `<button type="button" class="chip removable" data-unpick="${esc(d)}" aria-label="${esc(`${t('clearFilter')}: ${sfDistrictLabel(d)}`)}"><span>${esc(sfDistrictLabel(d))}</span>${icon('x')}</button>`).join('');
}

function sfDistrictsHtml() {
  const f = S.sf.form;
  if (!sq.location || !f) return '';
  if (f.location !== sq.location) return `<p class="sf-loading small"><span class="spinner"></span>${esc(t('sfDistrictsLoading'))}</p>`;
  if (!f.districts.length) return '';
  const city = sq.location.startsWith('град ');
  const collator = new Intl.Collator(locale());
  const list = getLang() === 'bg' ? f.districts : [...f.districts].sort((a, b) => collator.compare(sfDistrictLabel(a), sfDistrictLabel(b)));
  return `<fieldset class="sf-districts"><legend class="field-label">${esc(t(city ? 'sfDistricts' : 'sfPlaces'))} <span class="n" id="sfDistrictCount">${
    esc(sq.districts.length ? t('sfSelected', { n: fmtNum(sq.districts.length) }) : t('sfDistrictsHint'))}</span></legend>
<div class="chips sf-picked" id="sfPicked">${sfPickedHtml()}</div>
<span class="pop-search">${icon('magnifying-glass')}<input type="search" id="sfDistrictQ" placeholder="${esc(t(city ? 'sfDistrictSearch' : 'sfPlaceSearch'))}" aria-label="${esc(t(city ? 'sfDistrictSearch' : 'sfPlaceSearch'))}" autocomplete="off"></span>
<ul class="sf-dlist" id="sfDistrictList">${list.map((d) => `<li data-key="${esc(searchKey(d))}"><label class="check"><input type="checkbox" name="district" value="${esc(d)}"${
    sq.districts.includes(d) ? ' checked' : ''}><span>${esc(sfDistrictLabel(d))}</span></label></li>`).join('')}<li class="opt-empty" id="sfDistrictNone" hidden>${esc(t('sfNoMatch'))}</li></ul></fieldset>`;
}

function sfExtraHtml(f, id, label) {
  const sec = f.extras[id];
  if (!sec || (!sec.checks.length && !sec.selects.length)) return '';
  const lang = getLang();
  const chips = sec.checks.map((c) => sfChip(`x:${c.name}`, c.value, term(c.label, lang), sq.extras[c.name] === c.value)).join('');
  const selects = sec.selects.map((s) => `<label class="sf-inline"><span>${esc(term(s.label, lang))}</span>${
    sfSelect(`x:${s.name}`, s.options.map((o) => ({ value: o.value, label: term(o.label, lang) })), sq.extras[s.name] || '')}</label>`).join('');
  return `<fieldset class="sf-field" data-section="${id}"><legend class="field-label">${esc(label)}</legend>${chips ? `<div class="chips">${chips}</div>` : ''}${selects ? `<div class="sf-selects">${selects}</div>` : ''}</fieldset>`;
}

function sfMoreHtml(f) {
  const tb = f.extras.extritb;
  const years = (list) => list.map((v) => ({ value: v, label: v }));
  const build = `<div class="sf-stack" data-section="extritb">${tb.checks.length ? sfChips(t('sfConstruction'), tb.checks.map((c) => sfChip(`x:${c.name}`, c.value, term(c.label, getLang()), sq.extras[c.name] === c.value)).join('')) : ''}${
    sfChips(t('sfStatus'), ['1', '2'].map((v) => sfChip('status', v, t(`sfStatus${v}`), sq.status.includes(v))).join(''))}${
    f.yearsFrom.length ? sfGroup('year', t('sfYear'), sfSelRange('yearFrom', 'yearTo', years(f.yearsFrom), years(f.yearsTo))) : ''}</div>`;
  return `<details class="opts sf-more" id="sfMore"${S.sf.moreOpen ? ' open' : ''}><summary>${icon('funnel-simple')}<span>${esc(t('sfMore'))}</span><span class="n" id="sfMoreCount"></span>${icon('caret-down', 'opts-caret')}</summary>
<div class="sf-more-body">
<div class="sf-field"><label class="field-label" for="sfKeyword">${esc(t('sfKeyword'))}</label><input type="text" id="sfKeyword" name="keyword" maxlength="40" value="${esc(sq.keyword)}" aria-describedby="sfKeywordHint" lang="bg"><p class="sf-hint" id="sfKeywordHint">${esc(t('sfKeywordHint'))}</p></div>
<p class="sf-hint sf-pick" id="sfPickType">${esc(t('sfPickType'))}</p>
${sfGroup('yard', t('sfYard'), sfRange('yardMin', 'yardMax', sqm(), 50), ' data-section="areah"')}
${build}${sfExtraHtml(f, 'extri1', t('sfFeatures'))}${sfExtraHtml(f, 'extrip', t('sfPlot'))}
${sfChips(t('sfMedia'), sfChip('photoOnly', '1', t('sfPhotoOnly'), sq.photoOnly) + sfChip('videoOnly', '1', t('sfVideoOnly'), sq.videoOnly))}
</div></details>`;
}

function sfFieldsHtml(f) {
  const cur = sq.currency === '$' ? '$' : '€';
  const floors = (list) => list.map((o) => ({ value: o.value, label: sfFloorLabel(o) }));
  const groups = [];
  for (const ty of f.types) {
    let g = groups.find((x) => x.id === ty.group);
    if (!g) groups.push(g = { id: ty.group, types: [] });
    g.types.push(ty);
  }
  const types = `<fieldset class="sf-field"><legend class="field-label">${esc(t('typeHeading'))}</legend><div class="sf-types">${groups.map((g) => `<div class="sf-group" data-group="${g.id}">${
    g.types.map((ty) => `<label class="check"><input type="checkbox" name="type" value="${esc(ty.id)}"${sq.types.includes(ty.id) ? ' checked' : ''}><span>${esc(sfTypeLabel(ty.label))}</span></label>`).join('')}</div>`).join('')}</div><p class="sf-hint">${esc(t('sfTypeHint'))}</p></fieldset>`;
  const currency = f.currencies.length > 1 ? sfSeg('currency', t('sfCurrency'), f.currencies.map((c) => [c, c === '$' ? 'USD' : c]), sq.currency || f.currencies[0]) : '';
  return `${sfSeg('deal', t('sfDeal'), [['sale', t('sfSale')], ['rent', t('sfRent')]], f.deal)}
${types}
<div class="sf-field"><label class="field-label" for="sfLocation">${esc(t('sfLocation'))}</label><select id="sfLocation" name="location">${sfLocationOptions(f)}</select><div id="sfDistricts">${sfDistrictsHtml()}</div></div>
<div class="sf-grid">
<div class="sf-field" role="group" aria-labelledby="sfL-price"><div class="sf-head"><span class="field-label" id="sfL-price">${esc(t(f.deal === 'rent' ? 'sfRentPrice' : 'sfPrice'))}</span>${currency}</div>${sfRange('priceMin', 'priceMax', cur, 1000)}</div>
${sfGroup('ppm', t('sfPpm'), sfRange('ppmMin', 'ppmMax', `${cur}/${sqm()}`, 100))}
${sfGroup('area', t('sfArea'), sfRange('areaMin', 'areaMax', sqm(), 5))}
${sfGroup('floor', t('sfFloor'), sfSelRange('floorFrom', 'floorTo', floors(f.floorsFrom), floors(f.floorsTo)))}
<div class="sf-field"><label class="field-label" for="sfSort">${esc(t('sfSort'))}</label>${sfSelect('sort', f.sorts.map((o) => ({ value: o.value, label: sfSortLabel(o) })), sq.sort || f.sorts[0]?.value, { any: null, id: 'sfSort' })}<p class="sf-hint">${esc(t('sfSortHint'))}</p></div>
</div>
${sfMoreHtml(f)}`;
}

/** Selector for the focused form control, to put focus back after a re-render. */
function sfFocusSelector() {
  const a = document.activeElement;
  if (!a?.closest?.('#sfFields') || !a.name) return a?.id && a.closest?.('#sfFields') ? `#${CSS.escape(a.id)}` : null;
  return `[name="${CSS.escape(a.name)}"]${a.type === 'checkbox' || a.type === 'radio' ? `[value="${CSS.escape(a.value)}"]` : ''}`;
}

function renderSearchFields() {
  const box = $('#sfFields');
  const f = S.sf.form;
  box.classList.remove('is-loading');
  if (!f) {
    box.innerHTML = S.sf.error
      ? `<div class="sf-error" role="alert"><p>${esc(t('sfLoadError', { message: S.sf.error }))}</p><button type="button" class="btn small" data-sf-retry>${icon('arrow-clockwise')}${esc(t('sfRetry'))}</button></div>`
      : `<p class="sf-loading"><span class="spinner"></span>${esc(t('sfLoading'))}</p>`;
  } else {
    const focus = sfFocusSelector();
    box.innerHTML = sfFieldsHtml(f);
    sfApplyRules();
    if (focus) $(focus, box)?.focus();
  }
  sfUpdateFoot();
}

function renderSfDistricts() {
  const box = $('#sfDistricts');
  if (box) box.innerHTML = sfDistrictsHtml();
}

/** imot.bg's rules: only types from one group at a time, and extra filters depend on the types. */
function sfApplyRules() {
  const f = S.sf.form;
  const box = $('#sfFields');
  if (!f || !box) return;
  const group = f.types.find((x) => sq.types.includes(x.id))?.group ?? null;
  for (const g of $$('.sf-group', box)) {
    const locked = group != null && Number(g.dataset.group) !== group;
    g.classList.toggle('is-locked', locked);
    for (const input of $$('input', g)) input.disabled = locked;
  }
  const sections = sfSections();
  let shown = 0;
  for (const el of $$('[data-section]', box)) {
    el.hidden = !sections.has(el.dataset.section);
    if (!el.hidden) shown++;
  }
  $('#sfPickType', box).hidden = shown > 0;
  const n = sfMoreCount();
  $('#sfMoreCount', box).textContent = n ? fmtNum(n) : '';
}

/** Number of "More filters" in effect (hidden sections don't count: they are not sent). */
function sfMoreCount() {
  const q = sfPayload();
  return [q.keyword, q.yardMin || q.yardMax, q.yearFrom || q.yearTo, q.photoOnly, q.videoOnly].filter(Boolean).length
    + q.status.length + Object.keys(q.extras).length;
}

/** Read the form into `sq` (and remember it). */
function sfRead() {
  const form = $('#searchForm');
  if (!S.sf.form || !$('[name="deal"]', form)) return;
  const fd = new FormData(form);
  const q = { ...sq, types: fd.getAll('type').map(String), status: fd.getAll('status').map(String), extras: { ...sq.extras } };
  q.deal = String(fd.get('deal') || sq.deal);
  q.photoOnly = fd.has('photoOnly');
  q.videoOnly = fd.has('videoOnly');
  for (const k of SF_FIELDS) if (fd.has(k)) q[k] = String(fd.get(k)).trim();
  if ($('#sfDistrictList')) q.districts = fd.getAll('district').map(String);
  // Fields of hidden sections keep their values for when the section shows again.
  for (const el of $$('[name^="x:"]', form)) {
    const name = el.name.slice(2);
    if (el.type === 'checkbox') {
      if (el.checked) q.extras[name] = el.value;
      else if (q.extras[name] === el.value) delete q.extras[name];
    } else if (el.value) q.extras[name] = el.value;
    else delete q.extras[name];
  }
  sq = q;
  saveJson('searchQuery', sq);
}

/** The query as sent: only filters imot.bg would apply for the chosen types and place. */
function sfPayload() {
  const f = S.sf.form;
  const sections = sfSections();
  const q = { ...sq, extras: {} };
  for (const [id, sec] of Object.entries(f?.extras || {})) {
    if (!sections.has(id)) continue;
    for (const c of sec.checks) if (sq.extras[c.name] === c.value) q.extras[c.name] = c.value;
    for (const s of sec.selects) if (sq.extras[s.name]) q.extras[s.name] = sq.extras[s.name];
  }
  if (!sections.has('areah')) Object.assign(q, { yardMin: '', yardMax: '' });
  if (!sections.has('extritb')) Object.assign(q, { status: [], yearFrom: '', yearTo: '' });
  if (!q.location) q.districts = [];
  return q;
}

/**
 * Fit the saved query to a newly loaded form. Switching between sales and rentals keeps types and
 * extra filters by their label, since imot.bg numbers them differently.
 */
function sfAdapt(prev, next) {
  if (prev && prev.deal !== next.deal) {
    const label = new Map(prev.types.map((x) => [x.id, x.label]));
    sq.types = sq.types.map((id) => next.types.find((x) => x.label === label.get(id))?.id).filter(Boolean);
    const extras = {};
    for (const id of Object.keys(next.extras)) {
      for (const c of prev.extras[id]?.checks || []) {
        const m = sq.extras[c.name] === c.value && next.extras[id]?.checks.find((x) => x.value === c.value);
        if (m) extras[m.name] = m.value;
      }
      for (const s of prev.extras[id]?.selects || []) {
        const m = sq.extras[s.name] && next.extras[id]?.selects.find((x) => x.label === s.label && x.options.some((o) => o.value === sq.extras[s.name]));
        if (m) extras[m.name] = sq.extras[s.name];
      }
    }
    sq.extras = extras;
  }
  // Drop what the live form doesn't offer (e.g. an old saved query), and keep to one type group.
  const types = sq.types.map((id) => next.types.find((x) => x.id === id)).filter(Boolean);
  sq.types = types.filter((x) => x.group === types[0].group).map((x) => x.id);
  const names = new Set(Object.values(next.extras).flatMap((sec) => [...sec.checks, ...sec.selects].map((x) => x.name)));
  sq.extras = Object.fromEntries(Object.entries(sq.extras).filter(([k]) => names.has(k)));
  if (!next.locations.some((l) => l.value === sq.location)) sq.location = '';
  if (sq.location && next.location === sq.location) sq.districts = sq.districts.filter((d) => next.districts.includes(d));
  if (!next.currencies.includes(sq.currency)) sq.currency = next.currencies[0] || '';
  sq.deal = next.deal;
  saveJson('searchQuery', sq);
}

async function loadSearchForm() {
  const key = `${sq.deal}|${sq.location}`;
  if (S.sf.loading === key) return;
  S.sf.loading = key;
  S.sf.error = null;
  const prev = S.sf.form;
  if (!prev) renderSearchFields();
  else if (prev.deal !== sq.deal) $('#sfFields').classList.add('is-loading');
  else renderSfDistricts();
  sfUpdateFoot();
  try {
    const { form } = await api(`/api/search-form?${new URLSearchParams({ deal: sq.deal, location: sq.location })}`);
    if (S.sf.loading !== key) return;
    S.sf.loading = null;
    sfAdapt(prev, form);
    S.sf.form = form;
    // A full render also clears the dimming of a deal switch that was switched back meanwhile.
    if (prev && prev.deal === form.deal && !$('#sfFields').classList.contains('is-loading')) { renderSfDistricts(); sfUpdateFoot(); } else renderSearchFields();
  } catch (err) {
    if (S.sf.loading !== key) return;
    S.sf.loading = null;
    if (err.status === 400 && sq.location) {
      // A saved place imot.bg no longer lists: search everywhere instead.
      Object.assign(sq, { location: '', districts: [] });
      saveJson('searchQuery', sq);
      loadSearchForm();
    } else if (prev) {
      // Keep the form that works; undo the change that needed another one.
      S.sf.note = { text: t('sfLoadError', { message: sfErrorText(err) }), error: true };
      sq.deal = prev.deal;
      if (sq.location !== prev.location) { sq.location = prev.location; sq.districts = []; }
      saveJson('searchQuery', sq);
      renderSearchFields();
    } else {
      S.sf.error = sfErrorText(err);
      renderSearchFields();
    }
  }
}

/** Translated message for known error codes (e.g. imot.bg blocking requests), else the server's text. */
function sfErrorText(err) {
  const key = `err_${err.code}`;
  return err.code && t(key) !== key ? t(key) : err.message;
}

function sfUpdateFoot() {
  if (!$('#searchDlg')) return;
  const running = sfRunning();
  const jobView = S.sf.view === 'job';
  $('#searchForm').hidden = jobView;
  $('#sfProgress').hidden = !jobView;
  $('#sfReset').hidden = jobView;
  $('#sfGo').hidden = jobView;
  $('#sfEdit').hidden = !jobView;
  $('#sfCancel').hidden = !jobView || !running;
  $('#sfShow').hidden = !jobView || running;
  $('#sfGo').disabled = !S.sf.form || !!S.sf.loading || running || S.sf.busy;
  $('#sfGo').classList.toggle('busy', S.sf.busy);
  const note = $('#sfNote');
  const msg = jobView ? null : S.sf.busy ? { text: t('sfResolving') } : S.sf.note
    || (running ? { text: t('sfBusy') } : S.sf.form && !sq.location ? { text: t('sfNoLocation') } : null);
  note.textContent = msg?.text || '';
  note.classList.toggle('error', !!msg?.error);
  note.setAttribute('role', msg?.error ? 'alert' : 'status');
}

function renderSearchInfo() {
  const url = safeUrl(S.sf.url);
  const params = (S.job?.inputs?.find((i) => i.input === S.sf.url)?.paramsText || '').replace(/[\s,]+$/, '');
  $('#sfSearchInfo').innerHTML = url ? `<a class="sf-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${icon('arrow-square-out')}<span>${esc(t('sfOnImot'))}</span></a>${
    params ? `<p class="source-params"><span class="sp-label">${esc(t('sourceParamsLabel'))}</span> <span lang="bg">${esc(params)}</span></p>` : ''}` : '';
}

function openSearch() {
  closeMenu();
  if (S.sf.view === 'job' && !sfRunning() && S.job?.inputs?.[0]?.input !== S.sf.url) S.sf.view = 'form';
  $('#searchDlg').showModal();
  if (S.sf.form) renderSearchFields();
  if (S.sf.view === 'job') renderSearchInfo();
  sfUpdateFoot();
  if (!S.sf.form || S.sf.form.deal !== sq.deal || (sq.location && S.sf.form.location !== sq.location)) loadSearchForm();
  pollJob();
}

async function submitSearch() {
  sfRead();
  if (!S.sf.form || S.sf.busy || S.sf.loading || sfRunning()) return;
  S.sf.busy = true;
  S.sf.note = null;
  sfUpdateFoot();
  try {
    const { job, url } = await api('/api/search', { method: 'POST', body: { query: sfPayload(), options: importOptions() } });
    S.sf.url = url;
    S.sf.view = 'job';
    S.job = job;
    S.lastPhase = job.phase;
    S.sf.busy = false;
    renderJob();
    renderSearchInfo();
    $('#sfProgress').focus();
    pollJob();
  } catch (err) {
    S.sf.note = { text: sfErrorText(err), error: true };
  } finally {
    S.sf.busy = false;
    sfUpdateFoot();
  }
}

function bindSearchDialog() {
  const dlg = $('#searchDlg');
  const form = $('#searchForm');
  $('#btnSearchImot').addEventListener('click', openSearch);
  form.addEventListener('submit', (e) => { e.preventDefault(); submitSearch(); });
  form.addEventListener('input', (e) => {
    const el = e.target;
    if (el.id === 'sfDistrictQ') {
      const key = searchKey(el.value);
      let n = 0;
      for (const li of $$('#sfDistrictList li[data-key]')) { li.hidden = !!key && !li.dataset.key.includes(key); n += !li.hidden; }
      $('#sfDistrictNone').hidden = n > 0;
      return;
    }
    if (el.matches('input[type="number"], input[type="text"]')) { S.sf.note = null; sfRead(); sfApplyRules(); }
  });
  form.addEventListener('change', (e) => {
    const el = e.target;
    if (el.matches('[data-opt]') || el.id === 'sfDistrictQ' || !el.closest('#sfFields')) return;
    S.sf.note = null;
    const prevLocation = sq.location;
    sfRead();
    if (el.name === 'deal') loadSearchForm();
    else if (el.name === 'location' && sq.location !== prevLocation) {
      sq.districts = [];
      saveJson('searchQuery', sq);
      if (sq.location) loadSearchForm(); else renderSfDistricts();
    } else if (el.name === 'district') {
      $('#sfPicked').innerHTML = sfPickedHtml();
      $('#sfDistrictCount').textContent = sq.districts.length ? t('sfSelected', { n: fmtNum(sq.districts.length) }) : t('sfDistrictsHint');
    } else if (el.name === 'currency') {
      for (const s of $$('[data-cur]', form)) s.textContent = s.textContent.replace(/^[€$]/, sq.currency === '$' ? '$' : '€');
    }
    sfApplyRules();
    sfUpdateFoot();
  });
  form.addEventListener('click', (e) => {
    const un = e.target.closest('[data-unpick]');
    if (un) {
      const box = $(`#sfDistrictList input[value="${CSS.escape(un.dataset.unpick)}"]`);
      if (box) { box.checked = false; box.dispatchEvent(new Event('change', { bubbles: true })); }
      ($('#sfPicked button') || $('#sfDistrictQ'))?.focus();
    } else if (e.target.closest('[data-sf-retry]')) loadSearchForm();
  });
  form.addEventListener('toggle', (e) => { if (e.target.id === 'sfMore') S.sf.moreOpen = e.target.open; }, true);
  $('#sfReset').addEventListener('click', () => {
    sq = { ...SEARCH_QUERY, deal: sq.deal, currency: sq.currency };
    saveJson('searchQuery', sq);
    S.sf.note = null;
    renderSearchFields();
    if (!S.sf.form || S.sf.form.deal !== sq.deal) loadSearchForm();
  });
  $('#sfEdit').addEventListener('click', () => {
    S.sf.view = 'form';
    renderSearchFields();
    $('#sfGo').focus();
  });
  $('#sfCancel').addEventListener('click', () => api('/api/job/cancel', { method: 'POST', body: {} }).catch(() => {}));
  $('#sfShow').addEventListener('click', () => {
    dlg.close();
    setView('list');
    fitMap();
  });
  dlg.addEventListener('close', () => { if (!sfRunning()) S.sf.view = 'form'; });
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

function openMenu() {
  closePop(false);
  $('#appMenu').hidden = false;
  $('#btnMenu').setAttribute('aria-expanded', 'true');
  $('#appMenu [role="menuitem"]')?.focus();
}

function closeMenu() {
  $('#appMenu').hidden = true;
  $('#btnMenu').setAttribute('aria-expanded', 'false');
}

function bindEvents() {
  let qTimer = null;
  $('#fQ').addEventListener('input', (e) => {
    clearTimeout(qTimer);
    qTimer = setTimeout(() => { ui.filters.q = e.target.value; applyFilters(); }, 150);
  });
  $('#sortSel').addEventListener('change', (e) => {
    const [key, dir] = e.target.value.split(':');
    ui.sort = { key, dir: Number(dir) };
    applyFilters();
  });

  // Filter pills
  $('#pills').addEventListener('click', (e) => {
    const clear = e.target.closest('[data-pill-clear]');
    if (clear) { const key = clear.dataset.pillClear; if (S.pop === key) closePop(false); clearPill(key); $(`[data-pill="${key}"]`)?.focus(); return; }
    const pill = e.target.closest('[data-pill]');
    if (pill) { if (S.pop === pill.dataset.pill) closePop(); else openPop(pill.dataset.pill); return; }
    if (e.target.closest('[data-starred]')) { closePop(false); ui.filters.starred = !ui.filters.starred; applyFilters(); focusPills(); return; }
    if (e.target.closest('[data-clear-all]')) clearAll();
  });

  // Filter popover
  const pop = $('#pop');
  let numTimer = null;
  pop.addEventListener('click', (e) => {
    const opt = e.target.closest('[data-set]');
    if (opt) {
      ui.filters[opt.dataset.set] = opt.dataset.value;
      applyFilters();
      if (opt.hasAttribute('data-close')) closePop();
      else { renderPop(); pop.querySelector(`[data-set="${opt.dataset.set}"][aria-pressed="true"]`)?.focus(); }
      return;
    }
    if (e.target.closest('[data-pop-clear]')) {
      clearTimeout(numTimer);
      clearPill(S.pop);
      renderPop();
      pop.querySelector('input')?.focus();
      return;
    }
    if (e.target.closest('[data-pop-done]')) closePop();
  });
  pop.addEventListener('input', (e) => {
    const el = e.target;
    if (el.matches('[data-num]')) {
      clearTimeout(numTimer);
      numTimer = setTimeout(() => { ui.filters[el.dataset.num] = el.value === '' ? null : Number(el.value); applyFilters(); }, 300);
    } else if (el.matches('[data-place-q]')) {
      S.popQuery = el.value;
      $('#placeOpts').innerHTML = placeOptionsHtml();
    }
  });
  pop.addEventListener('change', (e) => {
    const el = e.target;
    if (el.matches('[data-bool]')) { ui.filters[el.dataset.bool] = el.checked; applyFilters(); }
    else if (el.matches('[data-select]')) {
      ui.filters[el.dataset.select] = el.value;
      if (el.dataset.select === 'oblast' && ui.filters.place && !S.listings.some((l) => matchesPlace(l, ui.filters.place) && (!el.value || l.oblast === el.value))) ui.filters.place = '';
      applyFilters();
      $('#placeOpts').innerHTML = placeOptionsHtml();
    }
  });
  pop.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      // The popover lives at the end of <body>; tabbing past either edge returns to the pill row.
      const items = $$('input,select,button,a[href]', pop).filter((x) => !x.disabled && x.offsetParent);
      if (e.shiftKey && e.target === items[0]) { e.preventDefault(); closePop(); }
      else if (!e.shiftKey && e.target === items.at(-1)) closePop(); // default Tab then moves on from the pill
    } else if (e.key === 'Enter' && e.target.matches('[data-num]')) {
      e.preventDefault();
      clearTimeout(numTimer);
      ui.filters[e.target.dataset.num] = e.target.value === '' ? null : Number(e.target.value);
      applyFilters();
      closePop();
    } else if (e.key === 'Enter' && e.target.matches('[data-place-q]')) {
      e.preventDefault();
      $('#placeOpts [data-set]:not([data-value=""])')?.click(); // pick the first match
    } else if (e.key === 'ArrowDown' && e.target.matches('[data-place-q]')) {
      $('#placeOpts button')?.focus();
      e.preventDefault();
    }
  });
  document.addEventListener('click', (e) => {
    const path = e.composedPath();
    if (S.pop && !path.includes(pop) && !path.includes($('#pills'))) closePop(false);
    if (!$('#appMenu').hidden && !path.includes($('.menu'))) closeMenu();
  });
  pop.addEventListener('focusout', (e) => {
    const to = e.relatedTarget;
    if (S.pop && to && !pop.contains(to) && !$('#pills').contains(to)) closePop(false); // tabbed away
  });
  addEventListener('resize', () => { if (S.pop) positionPop(); });
  $('.list-pane').addEventListener('scroll', () => { if (S.pop) positionPop(); }, { capture: true, passive: true });

  // Results
  const results = $('#results');
  results.addEventListener('click', (e) => {
    const star = e.target.closest('[data-star]');
    if (star) { toggleStar(star.dataset.star); return; }
    if (e.target.closest('a')) return;
    const row = e.target.closest('.row[data-id]');
    if (row) openDetail(row.dataset.id);
  });
  let hovered = null;
  results.addEventListener('mouseover', (e) => {
    const id = e.target.closest('.row[data-id]')?.dataset.id || null;
    if (id === hovered) return;
    if (hovered) highlightMarker(hovered, false);
    hovered = id;
    if (id) highlightMarker(id, true);
  });
  results.addEventListener('mouseleave', () => { if (hovered) highlightMarker(hovered, false); hovered = null; });
  for (const [type, on] of [['focusin', true], ['focusout', false]]) {
    results.addEventListener(type, (e) => {
      const id = e.target.closest('.row[data-id]')?.dataset.id;
      if (id && id !== hovered) highlightMarker(id, on);
    });
  }
  $('#more').addEventListener('click', (e) => {
    if (!e.target.closest('[data-more]')) return;
    const first = S.limit;
    loadMore();
    $$('#results .row-open')[first]?.focus();
  });
  // Grow the list as its end scrolls into view; the button stays as a fallback.
  new IntersectionObserver((entries) => { if (entries.some((x) => x.isIntersecting)) loadMore(); }, { root: $('#listScroll'), rootMargin: '600px' })
    .observe($('#more'));
  $('#emptyMsg').addEventListener('click', (e) => {
    if (e.target.closest('[data-clear-all]')) clearAll();
    else if (e.target.closest('[data-empty-import]')) $('#btnImport')?.click();
    else if (e.target.closest('[data-empty-search]')) $('#btnSearchImot')?.click();
  });
  $('#viewToggle').addEventListener('click', () => setView(S.view === 'map' ? 'list' : 'map'));
  $('#popScrim').addEventListener('click', () => closePop());
  // Map view on narrow screens keeps the filter row; the map starts below it.
  new ResizeObserver(() => document.body.style.setProperty('--toolbar-h', `${$('.toolbar').offsetHeight}px`)).observe($('.toolbar'));

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (S.pop) { closePop(); e.preventDefault(); }
      else if (!$('#appMenu').hidden) { closeMenu(); $('#btnMenu').focus(); e.preventDefault(); }
      return;
    }
    if (e.key === '/' && !e.target.closest('input,textarea,select,[contenteditable]') && !$('dialog[open]')) {
      e.preventDefault();
      $('#fQ').focus();
    }
  });

  // Detail dialog
  const dlg = $('#detailDlg');
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) { dlg.close(); return; } // backdrop
    const el = e.target.closest('[data-star],[data-nav],[data-close],[data-photo],[data-photo-step],[data-show-map],[data-desc-toggle]');
    if (!el) return;
    if (el.dataset.star) toggleStar(el.dataset.star);
    else if (el.dataset.nav) stepDetail(Number(el.dataset.nav));
    else if (el.hasAttribute('data-close')) dlg.close();
    else if (el.dataset.photo) { S.photoIdx = Number(el.dataset.photo); renderGallery(); }
    else if (el.dataset.photoStep) stepPhoto(Number(el.dataset.photoStep));
    else if (el.hasAttribute('data-show-map')) showOnMap(S.byId.get(S.detailId));
    else if (el.hasAttribute('data-desc-toggle')) toggleDesc(el);
  });
  // Old ads often lose their full-size photos: fall back to the smaller version, else hide the broken image.
  dlg.addEventListener('error', (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || !img.matches('.ph-img, .ph-bg')) return;
    const small = safeUrl(thumbOf(img.src));
    if (small && small !== img.src) img.src = small;
    else img.closest('.main-photo')?.classList.add('ph-broken');
  }, true);
  dlg.addEventListener('keydown', (e) => {
    if (e.target.closest('textarea,input,select') || e.ctrlKey || e.metaKey || e.altKey) return;
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
    closeMenu();
    ui.lang = getLang() === 'bg' ? 'en' : 'bg';
    setLang(ui.lang);
    saveUi();
    applyI18n();
    for (const l of S.listings) prepare(l);
    closePop(false);
    renderSources();
    applyFilters({ keepPage: true });
    if (S.job) renderJob();
    if (S.sf.form && !S.readOnly) renderSearchFields();
    if ($('#detailDlg').open) renderDetail();
    S.map?.closePopup();
    renderMapCtl(false);
  });
  $('#btnAbout').addEventListener('click', () => { closeMenu(); $('#aboutDlg').showModal(); });
  $('#aboutDlg').addEventListener('close', () => $('#btnMenu').focus());
  $('#btnMenu').addEventListener('click', () => {
    if ($('#appMenu').hidden) openMenu(); else closeMenu();
  });
  $('#appMenu').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = $$('#appMenu [role="menuitem"]');
    const i = items.indexOf(document.activeElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    e.preventDefault();
  });
  $('#btnCsv').addEventListener('click', () => { closeMenu(); exportCsv(); });
  $('#btnHtml')?.addEventListener('click', () => { closeMenu(); window.location.href = `/api/export?lang=${getLang()}`; }); // absent in snapshots

  for (const d of $$('dialog')) {
    d.addEventListener('click', (e) => { if (e.target === d || e.target.closest('[data-dismiss]')) d.close(); });
  }

  if (S.readOnly) return;
  bindSearchDialog();
  document.addEventListener('change', (e) => {
    const opt = e.target.closest('[data-opt]');
    if (!opt) return;
    for (const el of $$(`[data-opt="${opt.dataset.opt}"]`)) el.checked = opt.checked;
    saveJson('importOptions', importOptions());
  });
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
    if (opts) for (const el of $$('[data-opt]')) el.checked = opts[el.dataset.opt] !== false;
  }
  for (const el of $$('[data-icon]')) el.innerHTML = icon(el.dataset.icon);
  document.body.insertAdjacentHTML('beforeend', '<div id="popScrim" class="pop-scrim" hidden></div>');
  $('#fQ').value = ui.filters.q;
  applyI18n();
  bindEvents();
  PHONE.addEventListener('change', () => { $('#fQ').placeholder = t(PHONE.matches ? 'searchShort' : 'searchPlaceholder'); });
  initMap();
  if (S.readOnly) {
    setData(EMBEDDED);
  } else {
    try { await reload(); } catch (err) {
      S.loadError = err.message;
      $('#results').innerHTML = '';
      renderEmpty();
    }
    pollJob();
  }
}

boot();
