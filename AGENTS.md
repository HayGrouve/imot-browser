# Agent workflow

How to run, test and verify this repo. Words for things are in [`CONTEXT.md`](./CONTEXT.md).

> **Status:** a merge to `main` deploys production (https://onova-za-imotite.vercel.app). There is no sign-in yet:
> data belongs to a **workspace**, a random key the browser keeps. Update this file in the same PR that changes a
> command.

## Layout

| Folder | Holds | Rule |
| --- | --- | --- |
| `shared/` | Pure TS: imot.bg parsers (`parse.ts`), the search form (`searchform.ts`), the import's rules (`importer.ts`), the area search plan (`area.ts`), gazetteer, Nominatim matching, text and vocabulary | No Convex or browser imports. Tested against saved real pages in `shared/fixtures/` |
| `convex/` | Schema and functions. `importer.ts` and `searchForm.ts` are `"use node"` actions (they fetch imot.bg; the V8 runtime has no windows-1251 decoder); `imports.ts` is the queue and every write of an import | Public functions take a `workspace` and check it (`convex/lib/workspace.ts`) |
| `src/routes/` | TanStack file routes (one page) | `src/routeTree.gen.ts` is generated: commit it, never edit it |
| `src/components/` | The app. `ui/` holds shadcn components | Add `ui/` components with `npx shadcn@latest add`, never by hand |
| `src/lib/` | UI logic (filters, sorting, map groups, the search dialog's query), EN/BG strings (`i18n.ts`) | Pure where possible, with tests |
| `scripts/` | CI preflight, the Vercel build, the gazetteer and districts builders | Run with plain Node: they import `shared/` TypeScript as is, so no parameter properties or enums there |

## Run

```bash
pnpm install
npx convex dev                      # dev deployment, pushes on save (writes .env.local)
pnpm dev                            # http://localhost:3000
npx convex run imports:current '{"workspace":"<key>"}'    # an import's state
npx convex logs                     # the import steps' logs
pnpm districts                      # rebuild shared/districts-bg.json (see below)
```

Data files, committed:
- `shared/gazetteer-bg.json`: GeoNames' Bulgarian settlements (`pnpm gazetteer`).
- `shared/districts-bg.json`: imot.bg's districts per city and province, with points (`pnpm districts`). It reads
  imot.bg's live form (a request a second) and looks up what the gazetteer can't on Nominatim exactly as an import
  does (at most a request a second, ~30 minutes from scratch). Answers are cached in `/tmp/districts-cache.json`, so a
  stopped run resumes; `--seed <file>` adds a deployment's cache (`npx convex data geocache --format jsonl`). Rebuild it
  when imot.bg's districts or the import's place rules change, and check the per-place counts it prints. The browser
  loads it only for an area search (its own chunk in the build).

Env:
- `.env.local` gets `CONVEX_DEPLOYMENT` and `VITE_CONVEX_URL` from `npx convex dev`. Never print a secret or commit an
  `.env*` file.
- Vercel production has `CONVEX_DEPLOY_KEY` (a production deploy key, `npx convex deployment token create … --prod`).
  Preview builds have no deploy key: they build against the dev deployment's `VITE_CONVEX_URL` and push nothing.
- Deploys: `vercel.json` runs `scripts/vercel-build.sh`, which runs `npx convex deploy --cmd 'pnpm build'` when a deploy
  key is set, else `pnpm build`. `npx convex deploy` by hand needs the owner's confirmation.

## Test and verify

```bash
pnpm test                 # Vitest: shared/, src/lib/, convex/ (convex-test, edge-runtime)
pnpm typecheck            # app and convex/
pnpm lint && pnpm knip
pnpm format               # Prettier, then eslint --fix
pnpm ci:preflight         # all of the above plus the build, as CI runs it
```

- Parser changes: run the tests against `shared/fixtures/` (real pages, windows-1251), and save a new fixture when
  imot.bg's markup changes.
- Import changes: run a small real import on the dev deployment (rentals in one city are a few hundred listings) and
  watch `imports:current`. Keep imot.bg's pacing (350 ms, 3 at a time, one import at a time).
- UI changes: check in a real browser (`agent-browser`), light and dark, desktop and phone (390 px).

## Rules that are easy to get wrong

- Convex field names must be ASCII: imot.bg's Bulgarian labels go in values (e.g. `params` is a list of
  `{ label, value }`), never in object keys.
- Leaflet draws its own markup: map styles live in `src/styles.css`, and the map pane is `isolate`d so Leaflet's
  z-indexes stay below dialogs.
- Only link to and load images from imot.bg and its photo CDN (`src/lib/urls.ts`).
- Strings go in `src/lib/i18n.ts` in both languages. Listing text stays Bulgarian.

## Ask before

Production deploys, `npx convex deploy`, merging a PR, deleting data on the production deployment.
