# imot.bg browser

A local, bilingual (English / Bulgarian) browser for real-estate listings from [imot.bg](https://www.imot.bg).
Paste search links, and it imports every listing behind them into a searchable, sortable table and an
interactive map grouped by city / village, with full listing details and links back to the originals.

No dependencies beyond Node.js — no `npm install` needed.

## Quick start

```bash
node server.mjs            # → http://127.0.0.1:8787
```

1. Click **Import** and paste one or more links (one per line), e.g.
   `https://www.imot.bg/obiavi/prodazhbi/oblast-sofiya/kashta?price_min=55000&price_max=185000&plnk=625984`
2. Leave “Fetch each listing’s page” on for full descriptions, all photos, features and last-updated dates.
3. Listings appear as soon as the search pages are read; details fill in while the import continues.

Requires Node.js ≥ 20 (uses the built-in `fetch` and the `windows-1251` text decoder that official Node builds include).
The server listens on `127.0.0.1` only. Use `--port 9000` or `--data /path/to/folder` to change defaults.

### What you can paste

| Link | Result |
|---|---|
| Search results (`/obiavi/prodazhbi/...`, `/obiavi/naemi/...`, with any filters, any page) | Every page of the search is imported |
| Single listing (`/obiava-1j17...`, `pcgi/imot.cgi?act=5&adv=...`) | That listing |
| Mobile links (`m.imot.bg/...`) | Converted to the desktop site |
| Several of the above, one per line | Merged; listings are de-duplicated by imot.bg ID |

### Command line

```bash
node cli.mjs import "<url>" ["<url>" …] [--no-details] [--no-split] [--no-geocode] [--max 5000]
node cli.mjs stats
node cli.mjs export imot.html [--lang bg]   # standalone HTML snapshot
node cli.mjs reparse                        # re-derive fields after a parser fix (no network)
npm test
```

An import stops at 5,000 listings (`--max` changes it) so a too-broad link can't crawl the whole site.
The CLI and the server share `data/`. The server picks up changes made by the CLI on its next request.

## Features

- **Table**: full-text search (Latin or Cyrillic, so `bov` finds `Бов`), sort by any column, filters for
  property type, place, province, price, area and yard, starred-only, “new since last import”,
  “hide no longer listed”, and “only listings not on the map” (also toggled by clicking the map's
  “could not be placed” note). Columns collapse on narrow screens.
- **Map** (Leaflet + OpenStreetMap): one circle per city/village (or per neighbourhood in big cities). Size shows
  the number of listings, colour shows the median €/m². Click a circle for the place's listings, or filter the
  table to it. Hovering a table row highlights its place on the map.
- **Listing details**: photo gallery, price and €/m², area, yard, floor, construction, heating, features,
  full description, agency / broker / phone, price history across imports, a link to the original, and a
  private note.
- **English / Bulgarian** interface. Property types and common features are translated, and place names are
  transliterated using the official Bulgarian system.
- **Re-import** refreshes a search. Price changes are recorded, and listings that disappeared are flagged.
  Listing pages fetched in the last 3 days are reused, unless the price changed.
- **Export** the filtered rows as CSV (UTF-8, opens in Excel), or the whole set as one **standalone HTML file**
  that opens from disk without the server (read-only; map tiles and photos still need internet).
- Stars and notes are kept in the browser (`localStorage`), not in the data file.

## Limitations of extracting data from imot.bg links

imot.bg has no public API, so the importer reads the same HTML pages a browser sees.

**Links**

- **Session-bound parameters.** `plnk=…` (and `slink=…`) identify a search stored in *your* browser session.
  Any other client gets “page not found” for them (verified: the example link returns HTTP 404 with `plnk`, and
  200 without it). The importer removes them and rebuilds the search from the path and the visible query
  parameters. **Filters that exist only in the session, and not in the URL, are lost.** Each imported search
  shows the filter summary imot.bg reports (“Вид имот: КЪЩА, Местоположение: област София, Цена: от 55000 EUR
  до 185000 EUR”) so you can check it.
- Old-style search links (`pcgi/imot.cgi?act=3&slink=…`) cannot be replayed at all. Open the search on
  imot.bg and copy the `/obiavi/...` address instead.
- **1,000-result cap.** imot.bg serves at most 25 pages × 40 = 1,000 results per search (“Намерени са над 1000
  обяви”). The importer then automatically splits the search into price bands (`price_min`/`price_max`) until
  each band fits. Listings without a price (“при запитване”) don't match price filters, so they can be missed in
  split searches.
- Prices are stored as shown. Some ads say “Цената е без ДДС” (excludes VAT), while imot.bg filters on the
  VAT-inclusive price. Those listings may show a price below your search minimum and are marked “+VAT”.

**Data**

- **No exact coordinates.** imot.bg shows the map only to logged-in users, and listings name only the settlement
  (and, in big cities, the neighbourhood). Markers are placed at the settlement centre:
  - offline [GeoNames](https://www.geonames.org) gazetteer for 7,000+ Bulgarian settlements, bundled in
    `lib/gazetteer-bg.json`;
  - OpenStreetMap Nominatim for the rest, and for neighbourhoods, cached in `data/geocache.json` and
    limited to 1 request/second.

  When a town listing names a village in its sub-location line (e.g. гр. Етрополе + “с.Лопян”), the village
  is used. The same goes for villages inside a city's municipality (“град София, с. Бистрица”), which get
  their own marker instead of being treated as a city neighbourhood. Named rural areas (*местности*) and some hamlets cannot be located; they are listed as “not on map”.
- Without the detail pages (`--no-details`), data comes from the search cards only: a truncated description,
  4 photos, and features guessed from the summary line.
- Descriptions stay in the original Bulgarian. Only labels, property types and common terms are translated.
- The same property listed by several agencies appears several times (different imot.bg IDs).
- Data is a snapshot. Re-import to refresh it. Photos are hot-linked from imot.bg's servers, so they disappear
  when an ad is removed.
- Markup changes on imot.bg can break parsing. Tests in `test/` run the parser against saved real pages.
  `node cli.mjs reparse` re-derives fields from stored raw data after a fix.

**Fair use**

Requests are spaced ~350 ms apart (at most 3 in flight) and retried with back-off. If imot.bg starts refusing
requests (HTTP 403/429 or a Cloudflare challenge), the import stops and keeps what it has. A 500-listing search
with details takes about 3–4 minutes (~550 requests). Use the data for personal research. The listings belong to
imot.bg and the advertisers.

## Layout

```
server.mjs              local HTTP server (UI + JSON API), binds 127.0.0.1
cli.mjs                 command-line import / export / stats / reparse
lib/parse.mjs           imot.bg HTML + URL parsing
lib/importer.mjs        import pipeline: pagination, price-band splitting, details, geocoding
lib/http.mjs            throttled fetch with retries, windows-1251 decoding, block detection
lib/gazetteer.mjs       offline settlement lookup (GeoNames)
lib/geocode.mjs         Nominatim fallback with cache
lib/store.mjs           data/listings.json persistence
lib/export.mjs          standalone HTML bundler
shared/                 code used by both server and browser (text helpers, vocabulary)
public/                 the UI (index.html, app.mjs, i18n.mjs, styles.css, vendored Leaflet 1.9.4)
scripts/build-gazetteer.mjs   regenerate lib/gazetteer-bg.json from GeoNames
test/                   node:test suites with real-page fixtures
```

## Credits

Place data © [GeoNames](https://www.geonames.org) (CC BY 4.0). Map data and geocoding ©
[OpenStreetMap contributors](https://www.openstreetmap.org/copyright) (ODbL). [Leaflet](https://leafletjs.com) (BSD-2-Clause).
