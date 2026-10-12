import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from 'convex/react'
import { ListBulletsIcon, MapTrifoldIcon } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { api } from '../../convex/_generated/api'
import { cn } from '#/lib/utils'
import { AppContext } from './app-context'
import type { AppContextValue } from './app-context'
import { Topbar, useMedia } from './topbar'
import { FilterBar } from './filter-bar'
import {
  EmptyState,
  ListSkeleton,
  PAGE,
  ResultBar,
  ResultList,
} from './results'
import { BASE_LAYERS, ListingMap } from './listing-map'
import type { MapHandle } from './listing-map'
import { DetailDialog } from './detail-dialog'
import { SearchesDialog } from './searches-dialog'
import { SearchDialog } from './search-dialog'
import { AboutDialog } from './about-dialog'
import { ShareDialog } from './share-dialog'
import { jobRunning } from './job-view'
import { translate } from '#/lib/i18n'
import type { Lang, Params, StringKey } from '#/lib/i18n'
import { makeFormat } from '#/lib/format'
import { loadJson, saveJson } from '#/lib/storage'
import { resolveWorkspace } from '#/lib/workspace'
import { useWorkspaceData } from '#/lib/use-data'
import {
  DEFAULT_FILTERS,
  applyFilters,
  poolOf,
  prepare,
  sortListings,
  validDrawnArea,
  validSort,
} from '#/lib/listings'
import type { Filters, GroupMode, Sort } from '#/lib/listings'
import { DEFAULT_OPTIONS } from '../../shared/importer'
import type { ImportOptions } from '../../shared/importer'

interface Prefs {
  lang: Lang
  sort: Sort
  groupMode: GroupMode
  baseLayer: string
  filters: Filters
}

function initialPrefs(): Prefs {
  const saved = loadJson<Partial<Prefs>>('ui', {})
  const lang: Lang =
    saved.lang === 'bg' || saved.lang === 'en'
      ? saved.lang
      : navigator.language.toLowerCase().startsWith('bg')
        ? 'bg'
        : 'en'
  return {
    lang,
    sort: validSort(saved.sort),
    groupMode:
      saved.groupMode === 'neighborhood' ? 'neighborhood' : 'settlement',
    baseLayer:
      saved.baseLayer && saved.baseLayer in BASE_LAYERS
        ? saved.baseLayer
        : 'light',
    filters: {
      ...DEFAULT_FILTERS,
      ...saved.filters,
      drawnArea: validDrawnArea(saved.filters?.drawnArea),
    },
  }
}

/** State that outlives a reload, saved a moment after it changes. */
function usePersisted<T>(
  key: string,
  init: () => T,
  toJson: (v: T) => unknown = (v) => v,
) {
  const [value, setValue] = useState(init)
  const serialize = useRef(toJson)
  useEffect(() => {
    const id = setTimeout(() => saveJson(key, serialize.current(value)), 200)
    return () => clearTimeout(id)
  }, [key, value])
  return [value, setValue] as const
}

const NO_STARS: ReadonlySet<string> = new Set()

export function App() {
  const [ws] = useState(resolveWorkspace)
  const workspace = ws.key
  const [prefs, setPrefs] = usePersisted('ui', initialPrefs)
  const [stars, setStars] = usePersisted(
    'stars',
    () => new Set(loadJson<Array<string>>('stars', [])),
    (s) => [...s],
  )
  const [hidden, setHidden] = usePersisted(
    'hidden',
    () => new Set(loadJson<Array<string>>('hidden', [])),
    (s) => [...s],
  )
  const [notes, setNotes] = usePersisted('notes', () =>
    loadJson<Record<string, string>>('notes', {}),
  )
  const [options, setOptions] = usePersisted<ImportOptions>(
    'importOptions',
    () => ({
      ...DEFAULT_OPTIONS,
      ...loadJson<Partial<ImportOptions>>('importOptions', {}),
    }),
  )
  const [view, setView] = useState<'list' | 'map'>('list')
  const [detailId, setDetailId] = useState<string | null>(null)
  const [dialog, setDialog] = useState<
    null | 'searches' | 'search' | 'about' | 'share'
  >(null)
  const [limit, setLimit] = useState(PAGE)
  const mapRef = useRef<MapHandle>(null)
  // "Show listings" right after an import: fit again when its listings arrive.
  const fitRequested = useRef(0)
  const scroll = useRef<HTMLDivElement>(null)
  const toolbar = useRef<HTMLDivElement>(null)
  const narrow = useMedia('(max-width: 1000px)')

  const lang = prefs.lang
  const t = useCallback(
    (key: StringKey, params?: Params) => translate(lang, key, params),
    [lang],
  )
  const fmt = useMemo(() => makeFormat(lang), [lang])

  const {
    listings: raw,
    sources,
    error,
    deleting,
  } = useWorkspaceData(workspace)
  const job = useQuery(api.imports.current, { workspace })
  const sourceMap = useMemo(
    () => new Map(sources.map((s) => [s.key, s])),
    [sources],
  )
  const all = useMemo(
    () => (raw ? raw.map((l) => prepare(l, sourceMap)) : null),
    [raw, sourceMap],
  )
  const onlyHidden = prefs.filters.hidden
  const pool = useMemo(
    () => (all ? poolOf(all, hidden, onlyHidden) : null),
    [all, hidden, onlyHidden],
  )
  const starsForFilter = prefs.filters.starred ? stars : NO_STARS
  const filtered = useMemo(
    () =>
      pool
        ? sortListings(
            applyFilters(pool, prefs.filters, starsForFilter),
            prefs.sort,
            lang,
          )
        : [],
    [pool, prefs.filters, starsForFilter, prefs.sort, lang],
  )
  const multiDeal = useMemo(
    () => new Set((all ?? []).map((l) => l.deal)).size > 1,
    [all],
  )
  const hasHoods = useMemo(
    () => (all ?? []).some((l) => l.nbhd?.lat != null),
    [all],
  )
  const starCount = useMemo(
    () => (pool ?? []).reduce((n, l) => n + (stars.has(l.id) ? 1 : 0), 0),
    [pool, stars],
  )
  const hiddenCount = useMemo(
    () => (all ?? []).reduce((n, l) => n + (hidden.has(l.id) ? 1 : 0), 0),
    [all, hidden],
  )

  useEffect(() => {
    if (Date.now() - fitRequested.current < 5000) mapRef.current?.fit()
  }, [all])

  useEffect(() => {
    document.documentElement.lang = lang
    document.title = t('appTitle')
  }, [lang, t])

  useEffect(() => {
    if (ws.switched) toast.success(translate(lang, 'workspaceSwitched'))
    // Once, for the link that opened this page.
  }, [])

  const toggleStar = useCallback(
    (id: string) =>
      setStars((s) => {
        const next = new Set(s)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      }),
    [setStars],
  )
  const setHiddenOne = useCallback(
    (id: string, on: boolean) =>
      setHidden((s) => {
        if (s.has(id) === on) return s
        const next = new Set(s)
        if (on) next.add(id)
        else next.delete(id)
        return next
      }),
    [setHidden],
  )
  const toggleHidden = useCallback(
    (id: string) => {
      const hide = !hidden.has(id)
      setHiddenOne(id, hide)
      toast(t(hide ? 'hiddenToast' : 'unhiddenToast'), {
        action: { label: t('undo'), onClick: () => setHiddenOne(id, !hide) },
      })
    },
    [hidden, setHiddenOne, t],
  )
  const setNote = useCallback(
    (id: string, text: string) =>
      setNotes((n) => {
        const next = { ...n }
        if (text.trim()) next[id] = text
        else delete next[id]
        return next
      }),
    [setNotes],
  )
  const ctx = useMemo<AppContextValue>(
    () => ({
      lang,
      t,
      fmt,
      workspace,
      stars,
      toggleStar,
      hidden,
      toggleHidden,
      notes,
      setNote,
    }),
    [
      lang,
      t,
      fmt,
      workspace,
      stars,
      toggleStar,
      hidden,
      toggleHidden,
      notes,
      setNote,
    ],
  )

  const setFilters = useCallback(
    (patch: Partial<Filters>) => {
      setPrefs((p) => ({ ...p, filters: { ...p.filters, ...patch } }))
      setLimit(PAGE)
      scroll.current?.scrollTo({ top: 0 })
    },
    [setPrefs],
  )
  const onQuery = useCallback((q: string) => setFilters({ q }), [setFilters])
  const onMore = useCallback(
    () => setLimit((n) => (n < filtered.length ? n + PAGE : n)),
    [filtered.length],
  )
  const onHover = useCallback(
    (id: string, on: boolean) => mapRef.current?.highlight(id, on),
    [],
  )

  // Narrow screens show one pane at a time; the map starts below the filter row.
  useEffect(() => {
    const el = toolbar.current
    if (!el) {
      document.body.style.setProperty('--toolbar-h', '0px')
      return
    }
    const ro = new ResizeObserver(() =>
      document.body.style.setProperty('--toolbar-h', `${el.offsetHeight}px`),
    )
    ro.observe(el)
    return () => ro.disconnect()
  }, [all])

  const detailIndex = detailId
    ? filtered.findIndex((l) => l.id === detailId)
    : -1
  const detail = detailId ? (all?.find((l) => l.id === detailId) ?? null) : null

  const empty = all
    ? filtered.length === 0
      ? all.length === 0
        ? 'none'
        : 'filtered'
      : null
    : error
      ? 'error'
      : null

  return (
    <AppContext.Provider value={ctx}>
      <div className="flex h-dvh flex-col overflow-hidden">
        <Topbar
          query={prefs.filters.q}
          onQuery={onQuery}
          busy={jobRunning(job)}
          onSearchImot={() => setDialog('search')}
          onSearches={() => setDialog('searches')}
          onToggleLang={() =>
            setPrefs((p) => ({ ...p, lang: p.lang === 'bg' ? 'en' : 'bg' }))
          }
          onShare={() => setDialog('share')}
          onAbout={() => setDialog('about')}
        />
        <main className="relative min-h-0 flex-1 min-[1001px]:grid min-[1001px]:grid-cols-[minmax(440px,min(780px,56%))_minmax(0,1fr)]">
          <section
            aria-labelledby="count"
            className={cn(
              '@container flex min-h-0 flex-col bg-background max-[1000px]:absolute max-[1000px]:inset-0 min-[1001px]:relative min-[1001px]:border-r',
              narrow && view === 'map' && 'invisible z-[2]',
            )}
          >
            <a
              href="#map"
              className="absolute top-2 left-5 z-[5] -translate-y-[160%] rounded-full bg-primary px-3.5 py-2 font-semibold text-primary-foreground no-underline focus-visible:translate-y-0"
              onClick={(e) => {
                e.preventDefault()
                setView('map')
                document.getElementById('map')?.focus()
              }}
            >
              {t('skipToMap')}
            </a>
            {all && all.length > 0 && (
              <div
                ref={toolbar}
                className={cn(
                  'relative flex-none border-b px-5 pt-3.5 pb-3 max-[720px]:px-0 max-[720px]:py-2.5',
                  narrow && view === 'map' && 'visible bg-background',
                )}
              >
                <FilterBar
                  all={all}
                  pool={pool ?? all}
                  filters={prefs.filters}
                  onChange={setFilters}
                  starCount={starCount}
                  hiddenCount={hiddenCount}
                />
              </div>
            )}
            <div
              ref={scroll}
              className="min-h-0 flex-1 scroll-pt-3 overflow-auto overscroll-contain"
            >
              <span id="count" className="sr-only">
                {all
                  ? t('listingsCount', { n: fmt.num(all.length) })
                  : t('appTitle')}
              </span>
              {pool && (
                <ResultBar
                  total={pool.length}
                  shown={filtered.length}
                  onlyHidden={onlyHidden}
                  sort={prefs.sort}
                  onSort={(sort) => setPrefs((p) => ({ ...p, sort }))}
                />
              )}
              {!all && !error && <ListSkeleton />}
              {all && filtered.length > 0 && (
                <ResultList
                  rows={filtered}
                  total={filtered.length}
                  limit={limit}
                  onMore={onMore}
                  multiDeal={multiDeal}
                  onOpen={setDetailId}
                  onHover={onHover}
                  scrollRoot={scroll}
                />
              )}
              {empty && (
                <EmptyState
                  kind={empty}
                  message={error ?? undefined}
                  onSearch={() => setDialog('search')}
                  onClear={() => setFilters({ ...DEFAULT_FILTERS, q: '' })}
                />
              )}
            </div>
          </section>
          <section
            id="map"
            tabIndex={-1}
            aria-label={t('viewMap')}
            className={cn(
              'relative isolate min-h-0 bg-muted outline-none max-[1000px]:absolute max-[1000px]:inset-0',
              narrow && view !== 'map' && 'invisible',
              narrow &&
                view === 'map' &&
                'map-raised max-[1000px]:top-[var(--toolbar-h,0px)]',
            )}
          >
            <ListingMap
              ref={mapRef}
              filtered={filtered}
              hasHoods={hasHoods}
              groupMode={prefs.groupMode}
              baseLayer={prefs.baseLayer}
              selectedPlace={prefs.filters.place}
              unmappedActive={prefs.filters.unmapped}
              drawnArea={prefs.filters.drawnArea}
              onOpen={setDetailId}
              onFilterPlace={(place) => {
                setFilters({ place })
                setView('list')
              }}
              onToggleUnmapped={() =>
                setFilters({ unmapped: !prefs.filters.unmapped })
              }
              onDrawnArea={(drawnArea) => setFilters({ drawnArea })}
              onBaseLayer={(baseLayer) =>
                setPrefs((p) => ({ ...p, baseLayer }))
              }
              onGroupMode={(groupMode) =>
                setPrefs((p) => ({ ...p, groupMode }))
              }
            />
          </section>
        </main>
        {narrow && (
          <button
            type="button"
            onClick={() => setView(view === 'map' ? 'list' : 'map')}
            className={cn(
              'fixed bottom-[calc(20px+env(safe-area-inset-bottom))] left-1/2 z-40 inline-flex h-[46px] -translate-x-1/2 cursor-pointer items-center gap-2 rounded-full border-0 bg-primary px-5 font-semibold text-primary-foreground shadow-[var(--shadow-lift)] transition-transform active:scale-[.96]',
              view === 'map' &&
                'bottom-[calc(44px+env(safe-area-inset-bottom))]',
            )}
          >
            {view === 'map' ? (
              <ListBulletsIcon aria-hidden="true" className="size-[18px]" />
            ) : (
              <MapTrifoldIcon aria-hidden="true" className="size-[18px]" />
            )}
            <span>{t(view === 'map' ? 'viewList' : 'viewMap')}</span>
          </button>
        )}
      </div>
      <DetailDialog
        listing={detail}
        index={detailIndex}
        count={filtered.length}
        onClose={() => setDetailId(null)}
        onStep={(d) => {
          const next = filtered[detailIndex + d] as
            (typeof filtered)[number] | undefined
          if (next) setDetailId(next.id)
        }}
        onToggleHidden={(id) => {
          toggleHidden(id)
          // It leaves the list it was opened from: go on to the next one.
          if (detailIndex < 0) return
          const next = (filtered[detailIndex + 1] ??
            filtered[detailIndex - 1]) as (typeof filtered)[number] | undefined
          setDetailId(next?.id ?? null)
        }}
        onShowOnMap={(l) => {
          setDetailId(null)
          setView('map')
          mapRef.current?.showOnMap(l)
        }}
      />
      <SearchesDialog
        open={dialog === 'searches'}
        onOpenChange={(o) => setDialog(o ? 'searches' : null)}
        job={job}
        options={options}
        sources={sources}
        all={all}
        deleting={deleting}
      />
      <SearchDialog
        open={dialog === 'search'}
        onOpenChange={(o) => setDialog(o ? 'search' : null)}
        job={job}
        options={options}
        onOptions={setOptions}
        onShowListings={() => {
          setView('list')
          mapRef.current?.fit()
          fitRequested.current = Date.now()
        }}
      />
      <AboutDialog
        open={dialog === 'about'}
        onOpenChange={(o) => setDialog(o ? 'about' : null)}
      />
      <ShareDialog
        open={dialog === 'share'}
        onOpenChange={(o) => setDialog(o ? 'share' : null)}
      />
    </AppContext.Provider>
  )
}
