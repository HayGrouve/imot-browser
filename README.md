# imot.bg browser

A local, bilingual (English / Bulgarian) browser for real-estate listings from [imot.bg](https://www.imot.bg).
Search imot.bg from inside the app (or paste search links), and it imports every listing found into a searchable,
sortable list and an interactive map grouped by city / village, with full listing details and links back to the originals.

No dependencies beyond Node.js, so there is no `npm install` step.

## Quick start

```bash
node server.mjs            # → http://127.0.0.1:8787
```

1. Click **Search imot.bg** and fill in imot.bg's own search form: sale or rent, property types, city or province and
   its districts, price, price per m², area, floor, and under **More filters** construction, year, features and more.
   Press **Search and import**.
   Or click **Import** and paste one or more links (one per line), e.g.
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

- **Search imot.bg**: a dialog with the filters of imot.bg's own search form. The option lists (property types, places,
  districts, floors, sort orders, extra filters) are read from the live form, because sales and rentals number them
  differently. The dialog follows the site's rules: types from different groups can't be combined, and construction,
  feature and plot filters appear for the types that have them. Pressing Search sends the form to imot.bg's own link
  builder, the same request its “ТЪРСИ” button makes, and imports the resulting `/obiavi/...` link. The search then
  shows under Import → Imported searches, so it can be re-imported later. The last search is remembered.
- **Search and filters**: one search box (Latin or Cyrillic, so `bov` finds `Бов`; press `/` to jump to it)
  and a row of filter pills: Type, Location, Price, Size, More and Starred. Each pill opens a small popover,
  so only the filters you use take up space. More holds “new since last import”, “hide no longer listed” and
  “only listings not on the map”.
- **Listing list**: one row per listing with a photo, place, key facts and price, and a sort menu (price,
  €/m², area, yard, year built, last update, place). More listings load as you scroll.
- **Map** (Leaflet): one circle per city/village (or per neighbourhood in big cities). Size shows the number
  of listings, colour shows the median €/m². Click a circle for the place's listings, or show them in the
  list. Hovering a row highlights its place on the map. The map options panel switches the base map (Simple,
  Map, Satellite with roads and place names, Terrain) and how markers are grouped. Simple is a quiet grey map
  (Esri World Light / Dark Gray Canvas) that follows the system light or dark theme.
- **Narrow screens** show the list or the map, with a floating switch between them.
- **Listing details**: photo gallery, price and €/m², key facts (area, yard, floor, year built, heating,
  construction), features, full description, agency, broker and phone, price history across imports, a link
  to the original, and a private note. ←/→ step through photos, j/k (or PageUp/PageDown) through listings.
- **English / Bulgarian** interface. Property types and common features are translated, and place names are
  transliterated using the official Bulgarian system. Light and dark mode follow the system setting.
- **Re-import** refreshes a search. Price changes are recorded, and listings that disappeared are flagged.
  Listing pages fetched in the last 3 days are reused, unless the price changed.
- **Export** (in the ⋯ menu) the filtered listings as CSV (UTF-8, opens in Excel), or the whole set as one
  **standalone HTML file** that opens from disk without the server (read-only; map tiles and photos still
  need internet).
- Stars and notes are kept in the browser (`localStorage`), not in the data file.

## Limitations of extracting data from imot.bg links

imot.bg has no public API, so the importer reads the same HTML pages a browser sees.

**Search dialog**

- It depends on the markup of imot.bg's search form and on its internal link builder (`/pcgi/subscript.cgi`). If
  either changes, the dialog shows an error; pasting links still works.
- Not mirrored: business types, “price advantage” compared with the area average, and the agency filter.

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
with details takes about 3-4 minutes (~550 requests). Use the data for personal research. The listings belong to
imot.bg and the advertisers.

## Layout

```
server.mjs              local HTTP server (UI + JSON API), binds 127.0.0.1
cli.mjs                 command-line import / export / stats / reparse
lib/parse.mjs           imot.bg HTML + URL parsing
lib/searchform.mjs      imot.bg's search form: live option lists and its search-link builder
lib/importer.mjs        import pipeline: pagination, price-band splitting, details, geocoding
lib/http.mjs            throttled fetch with retries, windows-1251 decoding, block detection
lib/gazetteer.mjs       offline settlement lookup (GeoNames)
lib/geocode.mjs         Nominatim fallback with cache
lib/store.mjs           data/listings.json persistence
lib/export.mjs          standalone HTML bundler
shared/                 code used by both server and browser (text helpers, vocabulary)
public/                 the UI (index.html, app.mjs, i18n.mjs, icons.mjs, styles.css, vendored Leaflet 1.9.4 and Geist)
scripts/build-gazetteer.mjs   regenerate lib/gazetteer-bg.json from GeoNames
test/                   node:test suites with real-page fixtures
```

## Credits

Place data © [GeoNames](https://www.geonames.org) (CC BY 4.0). Map data and geocoding ©
[OpenStreetMap contributors](https://www.openstreetmap.org/copyright) (ODbL). Satellite imagery © Esri, Maxar,
Earthstar Geographics; terrain © [OpenTopoMap](https://opentopomap.org) (CC-BY-SA); simple map © Esri, HERE,
Garmin and OpenStreetMap contributors (Esri World Light / Dark Gray Canvas, no API key needed).
[Leaflet](https://leafletjs.com) (BSD-2-Clause). Icons: [Phosphor](https://phosphoricons.com) (MIT).
Font: [Geist](https://vercel.com/font) (SIL Open Font License).
