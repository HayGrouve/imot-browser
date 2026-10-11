// Parsers for imot.bg HTML (search result pages and listing detail pages)
// plus URL helpers. Pure functions: input is already-decoded HTML text.

import { htmlToText, inlineText, parseNumber, decodeEntities } from '../shared/text.mjs';
import { classifyTitle } from '../shared/vocab.mjs';

export const PAGE_SIZE = 40;
export const MAX_PAGES = 25; // imot.bg serves at most 1000 results (25 × 40) per search
export const RESULT_CAP = PAGE_SIZE * MAX_PAGES;

// Query parameters that only make sense inside the browser session that created them.
const SESSION_PARAMS = ['plnk', 'slink', 'f1', 'fromdesktop', 'utm_source', 'utm_medium', 'utm_campaign', 'fbclid', 'gclid'];

/**
 * Classify a pasted link. Returns { kind: 'search' | 'listing' | 'unsupported', url, id?, notes[] }.
 */
export function classifyUrl(input) {
  const notes = [];
  let raw = String(input || '').trim();
  if (!raw) return { kind: 'unsupported', url: raw, notes: ['empty'] };
  if (raw.startsWith('//')) raw = 'https:' + raw;
  if (!/^https?:\/\//i.test(raw)) raw = 'https://' + raw;
  let u;
  try { u = new URL(raw); } catch { return { kind: 'unsupported', url: input, notes: ['invalidUrl'] }; }
  const host = u.hostname.toLowerCase();
  if (!/(^|\.)imot\.bg$/.test(host)) return { kind: 'unsupported', url: u.href, notes: ['notImotBg'] };
  u.protocol = 'https:';
  if (host === 'imot.bg' || host === 'm.imot.bg') {
    if (host === 'm.imot.bg') notes.push('mobileConverted');
    u.hostname = 'www.imot.bg';
  }

  // Single listing: /obiava-<id>-slug or legacy /pcgi/imot.cgi?act=5&adv=<id>
  const m = u.pathname.match(/\/obiava-([0-9a-z]+)(?:-|$)/i);
  if (m && /^\d[a-z]\d+$/i.test(m[1])) {
    u.hash = ''; u.search = '';
    return { kind: 'listing', id: m[1].toLowerCase(), url: u.href, notes };
  }
  if (m) return { kind: 'unsupported', url: u.href, notes: ['newBuildingAd'] };
  if (/imot\.cgi$/i.test(u.pathname) && u.searchParams.get('adv')) {
    const id = u.searchParams.get('adv').toLowerCase();
    return { kind: 'listing', id, url: `https://www.imot.bg/pcgi/imot.cgi?act=5&adv=${id}`, notes };
  }
  if (/imot\.cgi$/i.test(u.pathname) && (u.searchParams.get('act') === '3' || u.searchParams.get('slink'))) {
    return { kind: 'unsupported', url: u.href, notes: ['legacySessionSearch'] };
  }
  if (/^\/obiavi\//i.test(u.pathname)) {
    const n = normalizeSearchUrl(u.href);
    return { kind: 'search', url: n.url, notes: [...notes, ...n.notes] };
  }
  return { kind: 'unsupported', url: u.href, notes: ['unknownPage'] };
}

/** Strip session-bound params and pagination so the URL can be replayed from a fresh session. */
export function normalizeSearchUrl(href) {
  const u = new URL(href);
  const notes = [];
  for (const p of SESSION_PARAMS) {
    if (u.searchParams.has(p)) { u.searchParams.delete(p); notes.push(`removed:${p}`); }
  }
  u.searchParams.delete('page');
  u.pathname = u.pathname.replace(/\/p-\d+\/?$/, '').replace(/\/+$/, '');
  u.hash = '';
  return { url: u.href, notes };
}

export function searchPageUrl(base, page) {
  const u = new URL(base);
  u.pathname = u.pathname.replace(/\/p-\d+\/?$/, '').replace(/\/+$/, '');
  if (page > 1) u.pathname += `/p-${page}`;
  return u.href;
}

export function getPriceRange(href) {
  const u = new URL(href);
  const min = parseNumber(u.searchParams.get('price_min'));
  const max = parseNumber(u.searchParams.get('price_max'));
  return { min: min ?? 0, max: max ?? null };
}

export function withPriceRange(href, min, max) {
  const u = new URL(href);
  if (min > 0) u.searchParams.set('price_min', String(Math.round(min))); else u.searchParams.delete('price_min');
  if (max != null && Number.isFinite(max)) u.searchParams.set('price_max', String(Math.round(max)));
  else u.searchParams.delete('price_max');
  return u.href;
}

function abs(href) {
  if (!href) return null;
  const h = decodeEntities(href.trim());
  if (h.startsWith('//')) return 'https:' + h;
  if (h.startsWith('/')) return 'https://www.imot.bg' + h;
  return h;
}

const MONTHS = ['януари', 'февруари', 'март', 'април', 'май', 'юни', 'юли', 'август', 'септември', 'октомври', 'ноември', 'декември'];

/** "Коригирана в 14:35 на 11 октомври, 2026 год." -> ISO string (Europe/Sofia local time, no TZ). */
export function parseBgDate(text) {
  const m = String(text || '').match(/(\d{1,2}):(\d{2})\s+на\s+(\d{1,2})\s+([а-я]+),?\s+(\d{4})/i);
  if (!m) return null;
  const month = MONTHS.indexOf(m[4].toLowerCase());
  if (month < 0) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return `${m[5]}-${pad(month + 1)}-${pad(m[3])}T${pad(m[1])}:${m[2]}`;
}

export function parsePrice(text) {
  const t = inlineText(text);
  if (!t) return { price: null, currency: null, priceText: '' };
  if (/запитване|договаряне/i.test(t) && !/\d/.test(t)) return { price: null, currency: null, priceText: t, priceOnRequest: true };
  const m = t.match(/(\d[\d\s.,]*)\s*(€|EUR|лв\.?|BGN|\$|USD)/i);
  if (!m) return { price: null, currency: null, priceText: t };
  const num = parseNumber(m[1].replace(/\s/g, ''));
  const c = m[2].toLowerCase();
  const currency = c === '€' || c === 'eur' ? 'EUR' : c.startsWith('лв') || c === 'bgn' ? 'BGN' : 'USD';
  return { price: num, currency, priceText: t };
}

/**
 * Location strings look like:
 *   "гр. Своге, област София"  (search card)
 *   "област София, Гара Бов"   (detail page)
 *   "град София, Дружба 2"     (big cities: neighbourhood after the comma)
 */
export function parseLocation(text) {
  const parts = inlineText(text).split(/\s*,\s*/).filter(Boolean);
  let oblast = null; let settlement = null; let kind = null; const rest = [];
  for (const p of parts) {
    let m;
    if ((m = p.match(/^област\s+(.+)$/i))) { oblast = m[1].trim(); continue; }
    if (!settlement) {
      if ((m = p.match(/^град\s+(.+)$/i))) { settlement = m[1].trim(); kind = 'city'; continue; }
      if ((m = p.match(/^гр\.\s*(.+)$/i))) { settlement = m[1].trim(); kind = 'town'; continue; }
      if ((m = p.match(/^(?:с\.|село)\s*(.+)$/i))) { settlement = m[1].trim(); kind = 'village'; continue; }
      if ((m = p.match(/^к\.к\.\s*(.+)$/i))) { settlement = m[1].trim(); kind = 'resort'; continue; }
      if ((m = p.match(/^(?:м-т|местност)\s*(.+)$/i))) { settlement = m[1].trim(); kind = 'locality'; continue; }
      if ((m = p.match(/^(?:в\.з\.|вилна зона)\s*(.+)$/i))) { settlement = m[1].trim(); kind = 'villaZone'; continue; }
    }
    rest.push(p);
  }
  if (!settlement && rest.length) { settlement = rest.shift(); kind = 'other'; }
  // "град София" belongs to the capital oblast; other "град X" to oblast X.
  if (!oblast && kind === 'city') oblast = settlement === 'София' ? 'София-град' : settlement;
  return { oblast, settlement, settlementKind: kind, neighborhood: rest.join(', ') || null };
}

/** "3-ти от 6" | "2 ет. от 2" | "Партер от 8" | "1 ет." -> { floor, floorNum, floorsTotal } */
export function parseFloor(text) {
  const t = inlineText(text);
  const m = t.match(/^(Партер|Сутерен|Последен|Мансарда|Полуетаж|\d+)(?:-?(?:ви|ри|ти|ми|ви))?\s*(?:ет\.?)?(?:\s*от\s*(\d+))?$/i);
  if (!m) return null;
  const word = m[1];
  const floorNum = /^\d+$/.test(word) ? Number(word) : /партер/i.test(word) ? 0 : /сутерен/i.test(word) ? -1 : null;
  return { floor: t, floorNum, floorsTotal: m[2] ? Number(m[2]) : null };
}

function applyYear(out, yt) {
  if (!yt) return;
  out.yearText = yt;
  const ys = yt.match(/\d{4}/g);
  if (!ys) return;
  if (/преди/i.test(yt)) { out.yearTo = Number(ys[0]); out.yearFrom = null; return; }
  out.yearFrom = Number(ys[0]); out.yearTo = Number(ys[ys.length - 1]);
}

/** "Тухла, Въведен в експлоатация 1970 - 1979 г." -> { material, status, yearText, yearFrom, yearTo } */
export function parseConstruction(text) {
  const out = {};
  for (const part of inlineText(text).split(/\s*,\s*/).filter(Boolean)) {
    const m = part.match(/^(Въведен в експлоатация|Не е въведен в експлоатация|Ще бъде въведен в експлоатация)\s*(.*?)\s*(?:г\.)?$/i);
    const y = part.match(/^((?:Преди\s+)?\d{4}(?:\s*-\s*\d{4})?)\s*(?:г\.?)?$/i);
    if (m) {
      out.status = /^не/i.test(m[1]) ? 'notCompleted' : /^ще/i.test(m[1]) ? 'planned' : 'completed';
      applyYear(out, m[2].trim());
    } else if (y) applyYear(out, y[1]);
    else if (MATERIAL_RE.test(part) && part.length < 30) out.material = part;
  }
  return out;
}

const MATERIAL_RE = /^(Тухла|Панел|ЕПК|ПК|Гредоред|Кирпич|Сглобяема|Монолит|Камък|Дървена|Метална)/;

/** Number at the very start of a string ("90 m2" -> 90, "--- m2" -> null). */
export function leadingNumber(s) {
  const m = String(s ?? '').match(/^\s*(\d[\d\s]*(?:[.,]\d+)?)/);
  return m ? parseNumber(m[1].replace(/\s/g, '')) : null;
}

/**
 * Derive structured fields from the detail page's parameter grid (kept raw in `params`
 * so fields can be re-derived after parser fixes without re-downloading pages).
 */
export function fieldsFromParams(params = {}) {
  const out = {};
  if (params['Площ'] != null) out.area = leadingNumber(params['Площ']);
  if (params['Двор'] != null) out.yard = leadingNumber(params['Двор']);
  if (params['Етаж']) Object.assign(out, parseFloor(params['Етаж']) || { floor: params['Етаж'] });
  if (params['Строителство']) Object.assign(out, parseConstruction(params['Строителство']));
  const tec = params['ТЕЦ']; const gas = params['Газ'];
  if (tec === 'ДА') out.heating = 'ТЕЦ';
  else if (gas === 'ДА') out.heating = 'Газ';
  else if (tec && tec !== 'НЕ') out.heating = tec; // e.g. "Лок.отопл."
  return out;
}
const HEATING = new Set(['Лок.отопл.', 'ТЕЦ', 'ТEЦ', 'Газ']);
const CARD_FEATURES = new Set(['Интернет връзка', 'Обзаведен', 'Полуобзаведен', 'Необзаведен', 'Саниран', 'Лизинг',
  'Асансьор', 'Регулация', 'Ток', 'Вода', 'Канализация', 'С гараж', 'Гараж', 'Паркинг', 'Охрана', 'Видео наблюдение',
  'Контрол на достъпа', 'Климатик', 'Камина', 'Басейн', 'Ипотека', 'Бартер', 'Лукс', 'Възможност за дан. кредит']);

/**
 * The search-card summary line, e.g.
 * "180 кв.м, двор 750 кв.м, 2 ет. от 2, Лок.отопл., Въведен в експлоатация 2015 г., Тухла, Обзаведен, <description> ..., тел.: 0889 195 472"
 * Structured tokens come first; the first unrecognised token starts the free-text description.
 */
export function parseInfoLine(text) {
  let t = inlineText(text);
  const out = { features: [] };
  const tel = t.match(/,?\s*тел\.?:\s*([\d\s+/,-]+)$/);
  if (tel) { out.phone = tel[1].trim().replace(/[,\s]+$/, ''); t = t.slice(0, tel.index); }
  const tokens = t.split(/,\s+/);
  let i = 0;
  for (; i < tokens.length; i++) {
    const tok = tokens[i].trim();
    let m;
    if (i === 0 && (m = tok.match(/^(\d+(?:[.,]\d+)?)\s*кв\.м$/))) { out.area = parseNumber(m[1]); continue; }
    if ((m = tok.match(/^двор\s+(\d+(?:[.,]\d+)?)\s*кв\.м$/))) { out.yard = parseNumber(m[1]); continue; }
    if (out.floor == null) {
      const f = parseFloor(tok);
      if (f && (/ет\.|от|Партер|Сутерен/i.test(tok))) { Object.assign(out, f); continue; }
    }
    if (HEATING.has(tok)) { out.heating = tok === 'ТEЦ' ? 'ТЕЦ' : tok; continue; }
    if (/експлоатация/.test(tok) && tok.length < 60) { Object.assign(out, parseConstruction(tok)); continue; }
    if (MATERIAL_RE.test(tok) && tok.length < 30) { out.material = tok; continue; }
    if (CARD_FEATURES.has(tok)) { out.features.push(tok); continue; }
    if (/^(ул\.|бул\.|ж\.к\.|кв\.)\s/.test(tok) && tok.length < 50) { out.address = tok; continue; }
    break;
  }
  const desc = tokens.slice(i).join(', ').replace(/\s*\.\.\.\s*$/, '…').trim();
  if (desc) out.description = desc;
  return out;
}

function pick(re, s, group = 1) {
  const m = s.match(re);
  return m ? m[group] : null;
}

/**
 * Inner HTML of the <div> whose opening tag matches `openRe` (balanced, so nested
 * divs are handled). Returns null if not found.
 */
export function divInner(html, openRe, from = 0) {
  const re = new RegExp(openRe.source, openRe.flags.replace('g', '') + 'g');
  re.lastIndex = from;
  const m = re.exec(html);
  if (!m) return null;
  const start = m.index + m[0].length;
  const tag = /<(\/?)div\b[^>]*>/gi;
  tag.lastIndex = start;
  let depth = 1; let t;
  while ((t = tag.exec(html))) {
    depth += t[1] ? -1 : 1;
    if (depth === 0) return html.slice(start, t.index);
  }
  return html.slice(start);
}

/** Inner HTML of every direct child <div> of a fragment. */
function childDivs(html) {
  const out = [];
  const tag = /<(\/?)div\b[^>]*>/gi;
  let depth = 0; let start = -1; let t;
  while ((t = tag.exec(html))) {
    if (!t[1]) { if (depth === 0) start = t.index + t[0].length; depth++; }
    else { depth--; if (depth === 0 && start >= 0) { out.push(html.slice(start, t.index)); start = -1; } }
  }
  return out;
}

function uniq(arr) {
  return [...new Set(arr.filter(Boolean))];
}

/** Thumbnail URL -> large photo URL (imotstatic*.focus.bg/.../<dir>/<id>_<k>.jpg -> .../<dir>/big1/<id>_<k>.jpg). */
export function bigPhotoUrl(url) {
  return url.replace(/\/(big1?\/)?([^/]+\.jpg)$/i, '/big1/$2').replace(/\/\/big1\//, '/big1/');
}

/** Parse a search results page. */
export function parseSearchPage(html) {
  const infoLine = inlineText(pick(/<div class="SearchInfoLine">([\s\S]*?)<\/div>/, html) || '');
  let total = null; let capped = false;
  const tm = infoLine.match(/от общо\s+([\d\s]+)(\+)?/);
  if (tm) { total = Number(tm[1].replace(/\s/g, '')); capped = !!tm[2]; }
  const overLimit = /над\s+1000\s+обяви/i.test(infoLine);
  if (overLimit) { capped = true; total = total ?? RESULT_CAP; }
  const range = infoLine.match(/(\d+)\s*-\s*(\d+)\s+от/);
  const paramsText = inlineText((pick(/<div class="params" id="paramsFromSearchText">([\s\S]*?)<\/div>/, html) || '').replace(/<br\s*\/?>/g, ' '));
  const notFound = /Страницата не е намерена/.test(html);
  const noResults = /Няма намерени обяви|не са намерени обяви/i.test(html) && !/class="item /.test(html);

  const items = [];
  const starts = [];
  const re = /<div class="item\s+([A-Za-z]*)\s*" id="ida([0-9a-z]+)">/g;
  let m;
  while ((m = re.exec(html))) starts.push({ index: m.index, promo: m[1] || null, id: m[2] });
  for (let k = 0; k < starts.length; k++) {
    let end = k + 1 < starts.length ? starts[k + 1].index : html.length;
    const tail = html.slice(starts[k].index, end);
    const stop = tail.search(/<div class="(item fakti|pagination-wrapper|ads2023)/);
    const chunk = stop > 0 ? tail.slice(0, stop) : tail;
    const item = parseSearchItem(chunk, starts[k]);
    if (item) items.push(item);
  }
  return {
    total, capped, overLimit, notFound, noResults, paramsText,
    from: range ? Number(range[1]) : null, to: range ? Number(range[2]) : null,
    hasNext: /class="saveSlink next"/.test(html),
    items,
  };
}

function parseSearchItem(chunk, { id, promo }) {
  const title = pick(/class="title saveSlink">([\s\S]*?)<location>/, chunk);
  const href = pick(/<a href="([^"]+)" class="title saveSlink">/, chunk);
  if (!title || !href) return null;
  const locationRaw = inlineText(pick(/<location>([\s\S]*?)<\/location>/, chunk) || '');
  const trendClass = pick(/<div class="price\s*([A-Za-z]*)\s*">/, chunk);
  const priceHtml = divInner(chunk, /<div class="price\s*[A-Za-z]*\s*">/) || '';
  const priceInner = pick(/<div>([\s\S]*?)<\/div>/, priceHtml) || '';
  const vat = inlineText(pick(/<span>([\s\S]*?)<\/span>/, priceHtml) || '');
  const info = parseInfoLine(divInner(chunk, /<div class="info">/) || '');
  const sellerHtml = divInner(chunk, /<div class="seller">/) || '';
  const sellerName = inlineText(pick(/<div class="name">\s*<a[^>]*>([\s\S]*?)<\/a>/, sellerHtml) || '');
  const sellerUrl = abs(pick(/<div class="name">\s*<a href="([^"]+)"/, sellerHtml));
  const sellerLogo = abs(pick(/<div class="logo">[\s\S]*?<img src="([^"]+)"/, sellerHtml));
  const photos = uniq([...chunk.matchAll(/<img src="(\/\/imotstatic[^"]+\.jpg)"/g)].map((x) => abs(x[1])));
  const photoCount = Number(pick(/и\s+(\d+)\s+снимки/, chunk)) || photos.length;
  const { deal, type, typeBg } = classifyTitle(inlineText(title));
  const loc = parseLocation(locationRaw);
  const price = parsePrice(priceInner);
  const trend = trendClass ? trendClass.toLowerCase() : null;

  return {
    id,
    url: abs(href).replace(/#.*$/, ''),
    title: inlineText(title),
    deal, type, typeBg,
    locationRaw,
    ...loc,
    ...price,
    vatNote: vat || null,
    priceTrend: trend === 'up' || trend === 'down' ? trend : null,
    area: info.area ?? null,
    yard: info.yard ?? null,
    floor: info.floor ?? null,
    floorNum: info.floorNum ?? null,
    floorsTotal: info.floorsTotal ?? null,
    heating: info.heating ?? null,
    material: info.material ?? null,
    status: info.status ?? null,
    yearText: info.yearText ?? null,
    yearFrom: info.yearFrom ?? null,
    yearTo: info.yearTo ?? null,
    address: info.address ?? null,
    features: info.features,
    description: info.description ?? null,
    phone: info.phone ?? null,
    agency: sellerName ? { name: sellerName, url: sellerUrl, logo: sellerLogo } : null,
    photos: photos.map(bigPhotoUrl),
    thumb: photos[0] || null,
    photoCount,
    hasVideo: /class="video saveSlink"/.test(chunk),
    isNew: /НОВА ОБЯВА/.test(chunk),
    promo: promo || null,
  };
}

/** Parse a listing detail page into the fields that are richer than the search card. */
export function parseDetailPage(html) {
  const ob = pick(/<div class="obTitle"[^>]*>([\s\S]*?)<\/h1>/, html);
  if (!ob) {
    if (/Страницата не е намерена/.test(html)) return { gone: true };
    if (/обявата е изтрита|не е активна|изтекла/i.test(html)) return { gone: true };
    return null;
  }
  const id = pick(/Обява:\s*([0-9a-z]+)/i, ob);
  const titleText = inlineText(ob.replace(/<div[\s\S]*$/, ''));
  const divs = [...ob.matchAll(/<div([^>]*)>([\s\S]*?)<\/div>/g)];
  const locationRaw = divs[0] ? inlineText(divs[0][2]) : '';
  const subLocation = divs.find((d) => /font-weight:\s*normal/.test(d[1]));
  const loc = parseLocation(locationRaw);
  const out = {
    id, title: titleText, locationRaw, ...classifyTitle(titleText), ...loc,
    address: subLocation ? inlineText(subLocation[2]) : null,
  };

  const priceArea = divInner(html, /<div class="adPrice">/) || '';
  Object.assign(out, parsePrice(pick(/<div class="cena">([\s\S]*?)<\/div>/, priceArea) || ''));
  const perM2 = pick(/\(([\d\s.,]+)\s*(?:€|лв\.?)\/m/, priceArea);
  if (perM2) out.pricePerM2 = parseNumber(perM2.replace(/\s/g, ''));
  const vat = priceArea.match(/(Не се начислява ДДС|Цената е без ДДС|Цената е с ДДС|Цената е с включено ДДС)/);
  if (vat) out.vatNote = vat[1];
  const infoHtml = divInner(priceArea, /<div class="info">/) || '';
  const updatedText = inlineText(pick(/<div>((?:Коригирана|Публикувана)[\s\S]*?)<\/div>/, infoHtml) || '');
  if (updatedText) { out.updatedText = updatedText; out.updatedAt = parseBgDate(updatedText); }
  const views = pick(/посетена\s*<span>(\d+)<\/span>/, infoHtml);
  if (views) out.views = Number(views);

  // Parameter grid: <div>Label:<br/><strong>value</strong>…</div>
  const params = {};
  for (const cell of childDivs(divInner(html, /<div class="adParams">/) || '')) {
    const pm = cell.match(/^\s*([^<:]+):\s*<br\s*\/?>([\s\S]*)$/);
    if (pm) params[pm[1].trim().replace('ТEЦ', 'ТЕЦ')] = inlineText(pm[2]).replace(/,\s*$/, '');
  }
  out.params = params;
  Object.assign(out, fieldsFromParams(params));

  const moreInfo = divInner(html, /<div class="moreInfo">/);
  const desc = moreInfo && divInner(moreInfo, /<div class="text">/);
  if (desc) out.description = htmlToText(desc);
  const extras = divInner(html, /<div class="carExtri">/);
  const items = extras && divInner(extras, /<div class="items">/);
  if (items) out.features = uniq(childDivs(items).map(inlineText));

  const contactIdx = html.indexOf('За контакт:');
  const phone = contactIdx > 0 ? inlineText(divInner(html, /<div class="phone[^"]*"[^>]*>/, contactIdx) || '') : '';
  if (phone) out.phone = phone;
  const brokerBox = divInner(html, /<div class="dealer2023 borderBox broker[^"]*">/);
  const broker = brokerBox && divInner(brokerBox, /<div class="name">/);
  if (broker) out.broker = inlineText(broker);
  const dealer = divInner(html, /<div class="dealer">/);
  if (dealer) {
    out.agency = {
      name: inlineText(pick(/<div class="name">([\s\S]*?)<\/div>/, dealer) || ''),
      url: abs(pick(/<a href="([^"]+)"/, dealer)),
      logo: abs(pick(/<img src="([^"]+)"/, dealer)),
      address: inlineText(pick(/<div class="location">([\s\S]*?)<\/div>/, dealer) || '') || null,
    };
  } else {
    out.agency = null;
  }
  const photos = uniq([...html.matchAll(/(\/\/imotstatic\d*\.focus\.bg\/imot\/photosimotbg\/[^"'\s)]+?\.jpg)/g)]
    .map((x) => bigPhotoUrl(abs(x[1]))))
    .filter((u) => !id || u.includes(id)); // the page also shows other listings' photos
  if (photos.length) { out.photos = photos; out.photoCount = photos.length; }
  out.hasVideo = /id="playertag"|youtube\.com\/embed|class="video/.test(html);
  return out;
}
