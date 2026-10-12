# Context

The words this app uses, in code, copy and PRs.

- **Listing**: one imot.bg ad, keyed by its imot.bg ID (`imotId`, e.g. `1j177909167696419`). Stored as a light row
  (`listings`: what the list, map and filters need) and a heavy part (`listingDetails`: description, photos, features,
  contacts, the parameter grid), read when the listing is opened.
- **Card**: what a search results page says about a listing (short description, a few photos).
- **Listing page**: the listing's own page on imot.bg, read for the full data ("Fetch each listing's page").
- **Source** (a saved search, under "Your searches"): a search link that was imported, keyed by a hash of its normalised
  URL. Listings from the old paste-links import, which is gone from the UI, belong to the source `manual`.
- **Import** (`imports`): one run over a search (a new one from the search dialog, or a refresh from "Your searches").
  Steps: search pages → listing pages → places
  online → done. Only one runs at a time for everyone; the others are queued.
- **Workspace**: the random key a browser makes on its first visit. All listings, sources and imports belong to one.
  There is no sign-in yet; the key in a link (`?w=`) opens the same workspace on another device.
- **Place**: the settlement a listing is in, located by the offline gazetteer (GeoNames) or OpenStreetMap. **Nbhd**:
  a big-city neighbourhood, located the same way.
- **Drawn area**: a shape drawn on the map; only the listings inside it show. A listing counts as inside when its
  nbhd is (or, with no nbhd, its place), and the map groups by nbhd while an area is drawn. Saved in this browser.
- **District**: what imot.bg's search form lists under a place (`f40`): a city's neighbourhoods, or a province's towns
  and villages. `shared/districts-bg.json` holds each one's point, the one its listings get.
- **Area search**: searching imot.bg inside the drawn area: per place it reaches into, one search with the districts
  whose point is inside (`shared/area.ts`; the server plans it again rather than trust the browser). All the searches
  make one import.
- **Price band**: a `price_min`/`price_max` slice of a search, used to get past imot.bg's 1,000-result cap.
- **New** (since the last import) and **no longer listed** (stale: missing from the latest import of every search it
  came from).
- **Search form**: imot.bg's own search form, read live per deal (sale, rent) and place; its **link builder** turns a
  filled-in form into a search link.
