// Builds a single self-contained HTML file (UI + Leaflet + data) that opens
// from disk with no server. Map tiles and listing photos still need internet.

import { readFile } from 'node:fs/promises';
import path from 'node:path';

// Browser modules in load order. They are inlined as one classic script, so
// top-level names must be unique across these files.
const MODULES = ['shared/text.mjs', 'shared/vocab.mjs', 'public/i18n.mjs', 'public/app.mjs'];

function stripModuleSyntax(src) {
  return src
    .replace(/^import\s[\s\S]*?\sfrom\s+['"][^'"]+['"];?\s*$/gm, '')
    .replace(/^export\s+(?=(?:async\s+)?(?:function|const|let|class)\b)/gm, '');
}

// Prevent "</script>" (or "<!--") inside inlined code/data from ending the script element.
const safeScript = (s) => s.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');

export async function buildStandaloneHtml({ root, data, lang = 'en' }) {
  const read = (p) => readFile(path.join(root, p), 'utf8');
  const [html, css, leafletCss, leafletJs, ...mods] = await Promise.all([
    read('public/index.html'), read('public/styles.css'), read('public/vendor/leaflet/leaflet.css'),
    read('public/vendor/leaflet/leaflet.js'), ...MODULES.map(read),
  ]);
  const app = mods.map((m, i) => `// ---- ${MODULES[i]}\n${stripModuleSyntax(m)}`).join('\n');
  const snapshot = { ...data, exportedAt: new Date().toISOString(), lang };
  const dataScript = `window.__IMOT_DATA__ = ${JSON.stringify(snapshot)};`;

  const replaceOnce = (s, needle, value) => {
    const i = s.indexOf(needle);
    if (i < 0) throw new Error(`export: marker not found: ${needle}`);
    return s.slice(0, i) + value + s.slice(i + needle.length);
  };
  let out = html;
  out = replaceOnce(out, '<link rel="stylesheet" href="vendor/leaflet/leaflet.css">', `<style>${leafletCss}</style>`);
  out = replaceOnce(out, '<link rel="stylesheet" href="styles.css">', `<style>${css}</style>`);
  out = replaceOnce(out, '<script src="vendor/leaflet/leaflet.js"></script>', `<script>${safeScript(leafletJs)}</script>`);
  out = replaceOnce(out, '<script type="module" src="app.mjs"></script>',
    `<script>${safeScript(dataScript)}</script>\n<script>(function(){\n${safeScript(app)}\n})();</script>`);
  return out;
}
