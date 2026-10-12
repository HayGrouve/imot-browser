import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from 'convex/react'
import { ListBulletsIcon, MapTrifoldIcon } from '@phosphor-icons/react'
import { toast } from 'sonner'
import type { GroupImperativeHandle, Layout } from 'react-resizable-panels'
import { api } from '../../convex/_generated/api'
import { cn } from '#/lib/utils'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '#/components/ui/resizable'
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
  SearchingState,
  StartState,
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
import type { SharedView } from '#/lib/share'
import { useWorkspaceData } from '#/lib/use-data'
import {
  DEFAULT_FILTERS,
  applyFilters,
  areaSearchOf,
  poolOf,
  prepare,
  rememberAreaSearch,
  shownOf,
  sortListings,
  validAreaSearches,
  validDrawnArea,
  validShown,
  validSort,
} from '#/lib/listings'
import type { DrawnArea, Filters, GroupMode, Sort } from '#/lib/listings'
import { DEFAULT_OPTIONS } from '../../shared/importer'
import type { ImportOptions } from '../../shared/importer'

interface Prefs {
  lang: Lang
  sort: Sort
  groupMode: GroupMode
  baseLayer: string
  filters: Filters
  /** The shown search: the links whose listings show, null for every search's. */
  shown: Array<string> | null
}

/** `switched`: a link opened another workspace, which starts with all of its searches shown
 *  and no filters, unless the link carries the `view` it was shared with. */
function initialPrefs(switched: boolean, view: SharedView | null): Prefs {
  const saved = loadJson<Partial<Prefs>>('ui', {})
  const lang: Lang =
    saved.lang === 'bg' || saved.lang === 'en'
      ? saved.lang
      : navigator.language.toLowerCase().startsWith('bg')
        ? 'bg'
        : 'en'
  return {
    lang,
    sort: view?.sort ?? validSort(saved.sort),
    groupMode:
      saved.groupMode === 'neighborhood' ? 'neighborhood' : 'settlement',
    baseLayer:
      saved.baseLayer && saved.baseLayer in BASE_LAYERS
        ? saved.baseLayer
        : 'light',
    // Another workspace's filters (a drawn area, a price) would hide this one's listings.
    filters:
      view?.filters ??
      (switched
        ? DEFAULT_FILTERS
        : {
            ...DEFAULT_FILTERS,
            ...saved.filters,
            drawnArea: validDrawnArea(saved.filters?.drawnArea),
          }),
    shown: view ? view.shown : switched ? null : validShown(saved.shown),
  }
}

/** Wide screens: the list is `px` wide, by default the width it was last
 *  dragged to in this browser (at first min(780px, 56%)), and the map takes
 *  the rest of the window. */
function paneLayout(px?: number): Layout {
  const width = window.innerWidth
  const saved = loadJson<unknown>('listWidth', null)
  px ??=
    typeof saved === 'number' && saved > 0
      ? saved
      : Math.round(Math.min(780, width * 0.56))
  const list = Math.min(100, (100 * px) / width)
  return { 'list-pane': list, 'map-pane': 100 - list }
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
  const [prefs, setPrefs] = usePersisted('ui', () =>
    initialPrefs(ws.switched, ws.view),
  )
  // A shared view brings its stars and hidden listings along.
  const [stars, setStars] = usePersisted(
    'stars',
    () =>
      new Set([
        ...loadJson<Array<string>>('stars', []),
        ...(ws.view?.stars ?? []),
      ]),
    (s) => [...s],
  )
  const [hidden, setHidden] = usePersisted(
    'hidden',
    () =>
      new Set([
        ...loadJson<Array<string>>('hidden', []),
        ...(ws.view?.hidden ?? []),
      ]),
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
  // The area searches started here, so showing one again shows all its links and its area.
  const [areaSearches, setAreaSearches] = usePersisted('areaSearches', () => {
    const list = validAreaSearches(loadJson('areaSearches', []))
    return ws.view?.area ? rememberAreaSearch(list, ws.view.area) : list
  })
  // The import a search just started, until `job` is that one: its listings are on their way.
  const [startedJob, setStartedJob] = useState<string | null>(null)
  const [view, setView] = useState<'list' | 'map'>('list')
  const [detailId, setDetailId] = useState<string | null>(null)
  const [dialog, setDialog] = useState<
    null | 'searches' | 'searchArea' | 'searchPlace' | 'about' | 'share'
  >(null)
  const [limit, setLimit] = useState(PAGE)
  const mapRef = useRef<MapHandle>(null)
  // "Show listings" right after an import: fit again when its listings arrive.
  const fitRequested = useRef(0)
  const scroll = useRef<HTMLDivElement>(null)
  const toolbar = useRef<HTMLDivElement>(null)
  const narrow = useMedia('(max-width: 1000px)')
  const panes = useRef<GroupImperativeHandle>(null)
  const [initialPanes] = useState(paneLayout)

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
  // The shown search comes first: the filters, counts and map work on its listings.
  const shown = prefs.shown
  const scoped = useMemo(
    () => (all ? shownOf(all, sources, shown) : null),
    [all, sources, shown],
  )
  const onlyHidden = prefs.filters.hidden
  const pool = useMemo(
    () => (scoped ? poolOf(scoped, hidden, onlyHidden) : null),
    [scoped, hidden, onlyHidden],
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
    () => new Set((scoped ?? []).map((l) => l.deal)).size > 1,
    [scoped],
  )
  const hasHoods = useMemo(
    () => (scoped ?? []).some((l) => l.nbhd?.lat != null),
    [scoped],
  )
  const starCount = useMemo(
    () => (pool ?? []).reduce((n, l) => n + (stars.has(l.id) ? 1 : 0), 0),
    [pool, stars],
  )
  const hiddenCount = useMemo(
    () => (scoped ?? []).reduce((n, l) => n + (hidden.has(l.id) ? 1 : 0), 0),
    [scoped, hidden],
  )
  // What "Show earlier searches" brings back.
  const earlier = useMemo(
    () => (all ?? []).reduce((n, l) => n + (hidden.has(l.id) ? 0 : 1), 0),
    [all, hidden],
  )
  // Nothing in the shown search: an area drawn now is drawn to be searched.
  const clean = scoped?.length === 0
  const hasToolbar = !!scoped && !clean
  // The shown search's import, while nothing of it has arrived.
  const scopeJob =
    shown?.length && job?.inputs.some((i) => shown.includes(i.input))
      ? job
      : null
  const searching =
    !!shown?.length && clean && (startedJob != null || jobRunning(scopeJob))

  useEffect(() => {
    if (job && job.id === startedJob) setStartedJob(null)
  }, [job, startedJob])

  useEffect(() => {
    if (Date.now() - fitRequested.current < 5000) mapRef.current?.fit()
  }, [all])

  // Another search shown: fit the map to it (the map fits by itself to listings that arrive later).
  useEffect(() => {
    mapRef.current?.fit()
  }, [shown])

  useEffect(() => {
    document.documentElement.lang = lang
    document.title = t('appTitle')
  }, [lang, t])

  useEffect(() => {
    if (ws.switched || ws.view)
      toast.success(translate(lang, 'workspaceSwitched'))
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

  /** Show these searches' listings (null: every search's), in the area they were drawn as. */
  const showSearch = useCallback(
    (urls: Array<string> | null, drawnArea: DrawnArea | null = null) => {
      setPrefs((p) => ({
        ...p,
        shown: urls,
        filters: { ...p.filters, drawnArea },
      }))
      setLimit(PAGE)
      scroll.current?.scrollTo({ top: 0 })
    },
    [setPrefs],
  )
  const drawToSearch = () => {
    if (narrow) setView('map')
    mapRef.current?.startDrawing()
  }
  // A clean map, the filters as they start (the sort stays), and the pen down.
  const newSearch = () => {
    setPrefs((p) => ({ ...p, shown: [], filters: DEFAULT_FILTERS }))
    setLimit(PAGE)
    scroll.current?.scrollTo({ top: 0 })
    drawToSearch()
  }
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
  }, [hasToolbar])

  // Wide again: the list gets back the width a narrow screen squeezed.
  useEffect(() => {
    if (!narrow) panes.current?.setLayout(paneLayout())
  }, [narrow])

  // What the share link opens on another device: this view, and the marks
  // (among the shown search's listings) that change what it shows.
  const shareView = useMemo<SharedView | null>(() => {
    if (dialog !== 'share') return null
    const ids = (scoped ?? []).map((l) => l.id)
    return {
      shown,
      filters: prefs.filters,
      sort: prefs.sort,
      hidden: ids.filter((id) => hidden.has(id)),
      stars: ids.filter((id) => stars.has(id)),
      area: (shown?.length && areaSearchOf(areaSearches, shown[0])) || null,
    }
  }, [
    dialog,
    scoped,
    shown,
    prefs.filters,
    prefs.sort,
    hidden,
    stars,
    areaSearches,
  ])

  const detailIndex = detailId
    ? filtered.findIndex((l) => l.id === detailId)
    : -1
  const detail = detailId ? (all?.find((l) => l.id === detailId) ?? null) : null

  const empty = !all
    ? error
      ? 'error'
      : null
    : searching
      ? 'searching'
      : clean
        ? shown?.length
          ? 'nothing'
          : 'start'
        : filtered.length === 0
          ? 'filtered'
          : null

  return (
    <AppContext.Provider value={ctx}>
      <div className="flex h-dvh flex-col overflow-hidden">
        <Topbar
          query={prefs.filters.q}
          onQuery={onQuery}
          busy={jobRunning(job)}
          onNewSearch={newSearch}
          onSearches={() => setDialog('searches')}
          onToggleLang={() =>
            setPrefs((p) => ({ ...p, lang: p.lang === 'bg' ? 'en' : 'bg' }))
          }
          onShare={() => setDialog('share')}
          onAbout={() => setDialog('about')}
        />
        <main className="relative min-h-0 flex-1">
          {/* One tree on every screen, so the map is never re-created: narrow
              screens stack both panes over <main> and hide the handle. The
              library makes the panes pan-y only (no pinch-zoom); the handle
              alone needs that, and gets touch-none. */}
          <ResizablePanelGroup
            groupRef={panes}
            defaultLayout={initialPanes}
            onLayoutChanged={(layout, { isUserInteraction }) => {
              const px = (layout['list-pane'] * window.innerWidth) / 100
              if (isUserInteraction) saveJson('listWidth', Math.round(px))
              // Whole pixels: map tiles at a fractional offset show seams.
              if (!narrow && Math.abs(px - Math.round(px)) > 0.05)
                panes.current?.setLayout(paneLayout(Math.round(px)))
            }}
            disabled={narrow}
            className="touch-auto!"
          >
            <ResizablePanel
              id="list-pane"
              minSize="400px"
              groupResizeBehavior="preserve-pixel-size"
              className="touch-auto!"
            >
              <section
                aria-labelledby="count"
                className={cn(
                  '@container flex min-h-0 flex-col bg-background max-[1000px]:absolute max-[1000px]:inset-0 min-[1001px]:relative min-[1001px]:h-full',
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
                {hasToolbar && (
                  <div
                    ref={toolbar}
                    className={cn(
                      'relative flex-none border-b px-5 pt-3.5 pb-3 max-[720px]:px-0 max-[720px]:py-2.5',
                      narrow && view === 'map' && 'visible bg-background',
                    )}
                  >
                    <FilterBar
                      all={scoped}
                      pool={pool ?? scoped}
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
                    {scoped
                      ? t('listingsCount', { n: fmt.num(scoped.length) })
                      : t('appTitle')}
                  </span>
                  {pool && (
                    <ResultBar
                      total={pool.length}
                      shown={filtered.length}
                      onlyHidden={onlyHidden}
                      sort={prefs.sort}
                      onSort={(sort) => setPrefs((p) => ({ ...p, sort }))}
                      onShowAll={shown?.length ? () => showSearch(null) : null}
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
                  {empty === 'searching' && (
                    <SearchingState
                      job={jobRunning(scopeJob) ? scopeJob : null}
                    />
                  )}
                  {(empty === 'start' || empty === 'nothing') && (
                    <StartState
                      nothing={empty === 'nothing'}
                      earlier={earlier}
                      onDraw={drawToSearch}
                      onSearchPlace={() => setDialog('searchPlace')}
                      onShowAll={() => showSearch(null)}
                    />
                  )}
                  {(empty === 'error' || empty === 'filtered') && (
                    <EmptyState
                      kind={empty}
                      message={error ?? undefined}
                      onClear={() => setFilters({ ...DEFAULT_FILTERS, q: '' })}
                    />
                  )}
                </div>
              </section>
            </ResizablePanel>
            <ResizableHandle
              withHandle
              aria-label={t('resizePanes')}
              onDoubleClick={() => {
                saveJson('listWidth', null)
                panes.current?.setLayout(paneLayout())
              }}
              // No width of its own, so the panes stay whole pixels: the line
              // is the list's last pixel, as its border was.
              className={cn(
                'z-10 w-0 touch-none after:w-2.5 max-[1000px]:hidden pointer-coarse:after:w-5',
                'before:absolute before:inset-y-0 before:right-0 before:w-px before:bg-border data-[separator=active]:before:-right-px data-[separator=active]:before:w-0.5 data-[separator=active]:before:bg-border-strong data-[separator=hover]:before:-right-px data-[separator=hover]:before:w-0.5 data-[separator=hover]:before:bg-border-strong',
                '*:h-8 *:w-1.5 *:bg-muted-foreground/60 *:opacity-0 *:transition-opacity focus-visible:*:bg-ring focus-visible:*:opacity-100 data-[separator=active]:*:opacity-100 data-[separator=hover]:*:opacity-100',
              )}
            />
            <ResizablePanel
              id="map-pane"
              minSize="420px"
              className="touch-auto!"
            >
              <section
                id="map"
                tabIndex={-1}
                aria-label={t('viewMap')}
                className={cn(
                  'relative isolate min-h-0 bg-muted outline-none max-[1000px]:absolute max-[1000px]:inset-0 min-[1001px]:h-full',
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
                  clean={clean}
                  onOpen={setDetailId}
                  onFilterPlace={(place) => {
                    setFilters({ place })
                    setView('list')
                  }}
                  onToggleUnmapped={() =>
                    setFilters({ unmapped: !prefs.filters.unmapped })
                  }
                  onDrawnArea={(drawnArea) => {
                    setFilters({ drawnArea })
                    // Drawn on a clean map: to be searched.
                    if (drawnArea && clean) setDialog('searchArea')
                  }}
                  onSearchArea={() => setDialog('searchArea')}
                  onSearchPlace={() => setDialog('searchPlace')}
                  onBaseLayer={(baseLayer) =>
                    setPrefs((p) => ({ ...p, baseLayer }))
                  }
                  onGroupMode={(groupMode) =>
                    setPrefs((p) => ({ ...p, groupMode }))
                  }
                />
              </section>
            </ResizablePanel>
          </ResizablePanelGroup>
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
        shown={shown}
        areaSearches={areaSearches}
        onShow={(url) => {
          const group = areaSearchOf(areaSearches, url)
          if (url == null) showSearch(null)
          else showSearch(group?.urls ?? [url], group?.area)
          setDialog(null)
          setView('list')
        }}
      />
      <SearchDialog
        open={dialog === 'searchArea' || dialog === 'searchPlace'}
        onOpenChange={(o) => !o && setDialog(null)}
        area={prefs.filters.drawnArea}
        start={dialog === 'searchPlace' ? 'place' : 'area'}
        job={job}
        options={options}
        onOptions={setOptions}
        onShowListings={() => {
          setView('list')
          mapRef.current?.fit()
          fitRequested.current = Date.now()
        }}
        onStarted={({ urls, area, job: id }) => {
          setStartedJob(id)
          if (area)
            setAreaSearches((list) => rememberAreaSearch(list, { urls, area }))
          showSearch(urls, area)
        }}
      />
      <AboutDialog
        open={dialog === 'about'}
        onOpenChange={(o) => setDialog(o ? 'about' : null)}
      />
      <ShareDialog
        open={dialog === 'share'}
        onOpenChange={(o) => setDialog(o ? 'share' : null)}
        view={shareView}
      />
    </AppContext.Provider>
  )
}
