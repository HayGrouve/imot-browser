# Онова за имотите

Search [imot.bg](https://www.imot.bg), import every listing it finds, and browse them as a filterable list and a map
grouped by city, village or neighbourhood. English and Bulgarian.

Live: https://onova-za-imotite.vercel.app

There is no sign-in yet. Each browser gets its own private set of listings (a random key kept in the browser), and
**⋯ → Open on another device** gives a link that opens the same listings elsewhere.

## Using it

1. **New search** starts from a clean map: draw the area you want, and the search dialog opens for it. Or **Search
   by place** for a whole city or province and its districts.
2. The search dialog is imot.bg's own search form: sale or rent, property types, price, price per m², area, floor,
   and under **More filters** construction, year, features and more. **Search and import** asks imot.bg for the
   search link and imports every page of it. The search is then kept under **⋯ → Your searches**.
3. Only the new search's listings show. They appear as soon as the search pages are read; the listing pages, with
   full descriptions, all photos and contacts, fill in while the import continues. Earlier searches are hidden, not
   deleted: **Show all searches** above the list brings them back.

Then:

- **Filters**: one search box (Latin or Cyrillic, so `bov` finds `Бов`; press `/` to jump to it) and filter pills for
  type, location, price, size, new or removed listings, listings not on the map, and stars.
- **List**: photo, place, key facts and price per listing, sorted by price, €/m², area, yard, year, update or place.
- **Map**: one circle per place (or per neighbourhood in big cities), sized by the number of listings and coloured by
  median €/m². Four base maps; the simple one follows the system light or dark theme.
- **Drawn area**: draw around the part of the map you want. On a clean map it is searched; over listings, only the
  ones inside it show, and **Search this area** imports just that area from imot.bg. Either way that is one search
  per city or province it reaches into, limited to the neighbourhoods, towns and villages whose centre is inside.
- **Listing details**: gallery, key facts, features, description, agency and phone, price history across imports, a link
  to the original and a private note. ←/→ step through photos, j/k through listings.
- **⋯ → Your searches** lists the saved searches: **Show** one to see only its listings (an area search with its
  area), **Refresh** one (or all) to update it, or remove it. Price changes are recorded, and listings that
  disappeared are flagged. Listing pages read in the last 3 days are reused unless the price changed.

## How it works

The browser talks to [Convex](https://www.convex.dev) directly; Vercel only serves the app.

- An import runs as a chain of Convex actions, each well inside the 10-minute action limit: the search pages (with
  automatic price-band splitting past imot.bg's 1,000-result cap), then the listing pages in batches, then the places
  the offline gazetteer can't settle, looked up on OpenStreetMap.
- Only one import runs at a time for everyone, for imot.bg's sake; the next one waits in a queue. Requests are spaced
  350 ms apart, at most 3 at a time. If imot.bg refuses requests (403/429 or a Cloudflare challenge), the import stops
  and keeps what it collected. Imports are rate-limited per browser and overall.
- The "Search imot.bg" dialog reads the option lists from imot.bg's live form (sales and rentals number their types
  and features differently) and builds the link with imot.bg's own link builder (`/pcgi/subscript.cgi`), the request its
  "ТЪРСИ" button makes.
- Places come from an offline [GeoNames](https://www.geonames.org) gazetteer of 7,000+ Bulgarian settlements
  (`shared/gazetteer-bg.json`), and OpenStreetMap Nominatim for the rest and for big-city neighbourhoods (cached, at
  most one request a second).
- An area search uses `shared/districts-bg.json`: every district imot.bg's form offers for its 27 cities and 27
  provinces, with the point an imported listing there gets. `pnpm districts` rebuilds it.

## Limitations

imot.bg has no public API, so the importer reads the same HTML pages a browser sees.

- **Session-bound links.** `plnk=…` and `slink=…` identify a search stored in *your* imot.bg session; anyone else gets
  "page not found". They are removed and the search is rebuilt from the path and visible filters, so filters that
  exist only in the session are lost. Each saved search shows imot.bg's own filter summary to check against. Old
  `pcgi/imot.cgi?act=3&slink=…` links can't be replayed at all.
- **1,000-result cap.** Bigger searches are split into price bands. Listings without a price ("при запитване") don't
  match price filters, so a split search can miss them. One import stops at 5,000 listings, one browser at 10,000.
- **No exact locations.** Listings name only the settlement and, in big cities, the neighbourhood, so markers sit at
  the settlement or neighbourhood centre. Some hamlets and named rural areas (*местности*) can't be located.
- **Area search is by district.** imot.bg searches whole neighbourhoods, towns and villages, so an area search takes
  each one whose centre is inside the drawn area, all of it. Districts that couldn't be placed on the map are left
  out, and one area can be at most 8 searches.
- Some prices exclude VAT ("+VAT") while imot.bg filters on the VAT-inclusive price.
- Descriptions stay in Bulgarian; labels, property types and common features are translated and place names
  transliterated. The same property listed by several agencies appears several times.
- The search dialog depends on imot.bg's form markup and link builder. Not mirrored: business types, "price advantage"
  and the agency filter.
- Photos are hot-linked from imot.bg's servers and disappear when an ad is removed.

Use the data for personal research. The listings belong to imot.bg and the advertisers.

## Development

Stack: TanStack Start (SPA) on Vite, React 19, Tailwind CSS 4, shadcn/ui (Base UI, Phosphor icons), Leaflet, Convex,
Vercel. Package manager: pnpm. See [AGENTS.md](./AGENTS.md) for commands, layout and rules.

```bash
pnpm install
npx convex dev        # dev deployment, pushes on save
pnpm dev              # http://localhost:3000
pnpm test             # parsers on saved imot.bg pages, UI logic, Convex functions (convex-test)
pnpm ci:preflight     # format, lint, typecheck, knip, tests, build
```

The previous local version (a Node server with a JSON file, CLI and standalone HTML export) is tagged `v1-local`.
