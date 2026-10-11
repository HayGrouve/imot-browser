// Text helpers shared by the Node importer and the browser UI.
// Keep this file free of Node/DOM APIs and of imports: the export bundler
// inlines it into the standalone HTML by stripping `export` keywords.

// Bulgarian Streamlined System (official romanisation since 2009).
const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u',
  ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sht', ъ: 'a', ь: 'y', ю: 'yu', я: 'ya',
  ѝ: 'i', ё: 'yo', ы: 'y', э: 'e',
};

export function transliterate(text) {
  if (!text) return '';
  // "-ия" at the end of a word is romanised as "-ia" (София -> Sofia).
  const s = String(text).replace(/ия(?=$|[^а-яА-Я])/g, '\u0001')
    .replace(/ИЯ(?=$|[^а-яА-Я])/g, '\u0002');
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\u0001') { out += 'ia'; continue; }
    if (ch === '\u0002') { out += 'IA'; continue; }
    const lower = ch.toLowerCase();
    const t = TRANSLIT[lower];
    if (t === undefined) { out += ch; continue; }
    if (ch === lower) out += t;
    else {
      // Upper case: capitalise first letter, or whole digraph if the next char is upper too.
      const nextUpper = s[i + 1] && s[i + 1] !== s[i + 1].toLowerCase();
      out += nextUpper ? t.toUpperCase() : t.charAt(0).toUpperCase() + t.slice(1);
    }
  }
  return out;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', sup2: '²', deg: '°', euro: '€', laquo: '«', raquo: '»', bdquo: '„', ldquo: '“', rdquo: '”', ndash: '–', mdash: '—', hellip: '…' };

export function decodeEntities(s) {
  if (!s) return '';
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    const v = ENTITIES[e.toLowerCase()];
    return v === undefined ? m : v;
  });
}

/** Strip HTML tags, keep line breaks from <br>/<p>/<div>, decode entities, tidy whitespace. */
export function htmlToText(html) {
  if (!html) return '';
  const s = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  return decodeEntities(s)
    .replace(/ /g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** One-line text: tags removed, whitespace collapsed. */
export function inlineText(html) {
  return htmlToText(html).replace(/\s+/g, ' ').trim();
}

/** Lower-case, Latin-only key for matching (Cyrillic is transliterated). */
export function searchKey(text) {
  return transliterate(String(text || '').toLowerCase())
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Like searchKey but also folds common transliteration variants (ts/tz, y/i, …). */
export function fuzzyKey(text) {
  return searchKey(text)
    .replace(/tz/g, 'ts').replace(/j/g, 'y').replace(/w/g, 'v')
    .replace(/kh/g, 'h').replace(/iy/g, 'i').replace(/ii/g, 'i').replace(/yu/g, 'iu')
    .replace(/ya/g, 'ia').replace(/x/g, 'ks');
}

export function levenshtein(a, b, max = 3) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** Parse "1 234 567,89" / "99 999.99" style numbers. */
export function parseNumber(s) {
  if (s == null) return null;
  const m = String(s).replace(/[\s ]/g, '').match(/-?\d+(?:[.,]\d+)?/);
  if (!m) return null;
  const n = Number(m[0].replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export function median(values) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}
