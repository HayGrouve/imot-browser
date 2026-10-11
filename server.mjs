#!/usr/bin/env node
// Local server for the imot.bg browser: serves the UI and runs imports.
// A server is required because browsers cannot fetch imot.bg pages directly
// (no CORS headers, windows-1251 encoding, session-bound links).
//
//   node server.mjs [--port 8787] [--host 127.0.0.1] [--data ./data]

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './lib/store.mjs';
import { Gazetteer } from './lib/gazetteer.mjs';
import { Geocoder } from './lib/geocode.mjs';
import { ImportJob, DEFAULT_OPTIONS } from './lib/importer.mjs';
import { buildStandaloneHtml } from './lib/export.mjs';
import { ImotSearch } from './lib/searchform.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const arg = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : process.env[name.toUpperCase()] || def;
};
const PORT = Number(arg('port', 8787));
const HOST = arg('host', '127.0.0.1');
const DATA_DIR = path.resolve(arg('data', path.join(ROOT, 'data')));

const store = await new Store(path.join(DATA_DIR, 'listings.json')).load();
const gazetteer = new Gazetteer();
const geocoder = await new Geocoder({ cacheFile: path.join(DATA_DIR, 'geocache.json') }).load();
const imotSearch = new ImotSearch();
let currentJob = null;
let lastJob = null;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2',
};
const STATIC_DIRS = { '/shared/': path.join(ROOT, 'shared'), '/': path.join(ROOT, 'public') };

function send(res, status, body, headers = {}) {
  const isJson = typeof body !== 'string' && !Buffer.isBuffer(body);
  res.writeHead(status, {
    'Content-Type': isJson ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(isJson ? JSON.stringify(body) : body);
}

async function readJson(req, limit = 1e6) {
  let size = 0; const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw Object.assign(new Error('Body too large'), { status: 413 });
    chunks.push(c);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
}

// Only answer requests addressed to this machine (blocks DNS-rebinding), and only accept
// state-changing requests from our own page (blocks cross-site form posts / CSRF).
function guard(req) {
  const host = (req.headers.host || '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  const allowedHosts = new Set(['localhost', '127.0.0.1', '::1', HOST]);
  if (!allowedHosts.has(host)) return 'Unexpected Host header';
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const origin = req.headers.origin;
    if (origin && origin !== `http://${req.headers.host}`) return 'Cross-origin request refused';
    if (!/^application\/json/.test(req.headers['content-type'] || '')) return 'Expected application/json';
  }
  return null;
}

async function serveStatic(req, res, pathname) {
  if (pathname === '/') pathname = '/index.html';
  for (const [prefix, dir] of Object.entries(STATIC_DIRS)) {
    if (!pathname.startsWith(prefix)) continue;
    const file = path.resolve(dir, '.' + decodeURIComponent(pathname.slice(prefix.length - 1)));
    if (!file.startsWith(dir + path.sep)) return send(res, 403, 'Forbidden');
    try {
      const st = await stat(file);
      if (!st.isFile()) continue;
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(await readFile(file));
      return;
    } catch { /* try next */ }
  }
  send(res, 404, 'Not found');
}

function startJob(inputs, rawOptions) {
  const options = {};
  for (const k of ['details', 'autoSplit', 'geocodeOnline']) if (typeof rawOptions?.[k] === 'boolean') options[k] = rawOptions[k];
  geocoder.enabled = options.geocodeOnline ?? DEFAULT_OPTIONS.geocodeOnline;
  const job = new ImportJob({ inputs, options, store, gazetteer, geocoder });
  currentJob = job;
  job.run().finally(() => { lastJob = job; currentJob = null; });
  return job;
}

/** imot.bg answered, but not usefully (blocked, changed markup): a gateway error, not ours. */
async function fromImot(fn) {
  try { return await fn(); } catch (err) {
    if (err.status === 400) throw err;
    throw Object.assign(new Error(err.message), { status: 502 });
  }
}

function listingsPayload() {
  return {
    listings: store.listings,
    sources: store.data.sources,
    updatedAt: store.data.updatedAt,
    attribution: gazetteer.attribution,
  };
}

const routes = {
  'GET /api/listings': async () => {
    if (!currentJob) await store.reloadIfChanged();
    return listingsPayload();
  },

  'GET /api/job': async () => ({ job: (currentJob || lastJob)?.state || null, defaults: DEFAULT_OPTIONS }),

  'POST /api/import': async (req) => {
    if (currentJob) return [409, { error: 'An import is already running' }];
    await store.reloadIfChanged();
    const body = await readJson(req);
    const raw = Array.isArray(body.inputs) ? body.inputs.join('\n') : String(body.inputs || '');
    // Every pasted token goes to the job, so non-imot.bg links are reported as skipped rather than vanishing.
    const inputs = [...new Set(raw.split(/\s+/).map((s) => s.trim()).filter(Boolean))].slice(0, 200);
    if (!inputs.some((s) => /imot\.bg/i.test(s))) return [400, { error: 'Paste at least one imot.bg link' }];
    return { job: startJob(inputs, body.options).state };
  },

  // Option lists of imot.bg's own search form, for the "Search imot.bg" dialog.
  'GET /api/search-form': async (req, url) => {
    const deal = url.searchParams.get('deal') || 'sale';
    const location = url.searchParams.get('location') || '';
    return { form: await fromImot(() => imotSearch.form(deal, location)) };
  },

  // Turn a filled-in search form into an imot.bg search link and import it.
  'POST /api/search': async (req) => {
    if (currentJob) return [409, { error: 'An import is already running' }];
    const body = await readJson(req);
    const url = await fromImot(() => imotSearch.searchUrl(body.query || {}));
    if (currentJob) return [409, { error: 'An import is already running' }];
    await store.reloadIfChanged();
    return { url, job: startJob([url], body.options).state };
  },

  'POST /api/job/cancel': async () => {
    if (!currentJob) return [404, { error: 'No import running' }];
    currentJob.cancel();
    return { ok: true };
  },

  'POST /api/listings/delete': async (req) => {
    if (currentJob) return [409, { error: 'Wait for the running import to finish' }];
    const body = await readJson(req);
    let removed = 0;
    if (body.all === true) { removed = store.listings.length; store.clear(); }
    else if (Array.isArray(body.ids)) removed = store.remove(body.ids.map(String));
    await store.save();
    return { removed };
  },

  'POST /api/sources/delete': async (req) => {
    if (currentJob) return [409, { error: 'Wait for the running import to finish' }];
    const body = await readJson(req);
    const removed = store.removeSource(String(body.id || ''), { withListings: body.withListings !== false });
    await store.save();
    return { removed };
  },

  'GET /api/export': async (req, url) => {
    const lang = url.searchParams.get('lang') === 'bg' ? 'bg' : 'en';
    const html = await buildStandaloneHtml({ root: ROOT, data: listingsPayload(), lang });
    const name = `imot-browser-${new Date().toISOString().slice(0, 10)}.html`;
    return [200, html, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"` }];
  },
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const refused = guard(req);
  if (refused) return send(res, 403, { error: refused });
  const handler = routes[`${req.method} ${url.pathname}`];
  try {
    if (handler) {
      const out = await handler(req, url);
      if (Array.isArray(out)) return send(res, out[0], out[1], out[2]);
      return send(res, 200, out);
    }
    if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'Unknown endpoint' });
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
    return await serveStatic(req, res, url.pathname);
  } catch (err) {
    send(res, err.status || 500, { error: err.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`imot.bg browser running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`Data: ${path.relative(process.cwd(), DATA_DIR) || '.'}/listings.json (${store.listings.length} listings)`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    currentJob?.cancel();
    await Promise.allSettled([store.saving, geocoder.save()]);
    process.exit(0);
  });
}
