import { useEffect, useImperativeHandle, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type * as Leaflet from 'leaflet'
import {
  CornersOutIcon,
  GpsSlashIcon,
  StackIcon,
  XIcon,
} from '@phosphor-icons/react'
import { useApp } from './app-context'
import type { AppContextValue } from './app-context'
import { Segmented } from './filter-bar'
import { useMedia } from './topbar'
import {
  MARKER_RAMP,
  binOf,
  computeGroups,
  groupOf,
  ppmBreaks,
  rampColor,
} from '#/lib/listings'
import type { Group, GroupMode, Listing } from '#/lib/listings'
import { KIND_EN, hoodName, oblastLabel, placeName } from '#/lib/labels'
import { thumbFor } from '#/lib/urls'
import { transliterate } from '../../shared/text'
import { typeLabel } from '../../shared/vocab'

// Base maps: free tile services that need no API key (Google's tiles may only be used via its API).
const OSM_ATTR =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
const ESRI_REF =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Reference'
const ESRI_CANVAS =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas'

interface TileDef {
  url: string
  overlays?: Array<string>
}

interface BaseLayerDef extends TileDef {
  label: string
  dark?: TileDef
  opts: Leaflet.TileLayerOptions & { maxNativeZoom: number }
}

export const BASE_LAYERS: Record<string, BaseLayerDef> = {
  light: {
    // Quiet greys that let the markers carry the colour; follows the system light/dark theme.
    label: 'layerLight',
    url: `${ESRI_CANVAS}/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
    overlays: [
      `${ESRI_CANVAS}/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`,
    ],
    dark: {
      url: `${ESRI_CANVAS}/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
      overlays: [
        `${ESRI_CANVAS}/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`,
      ],
    },
    opts: {
      maxNativeZoom: 16,
      attribution:
        'Basemap &copy; <a href="https://www.esri.com" target="_blank" rel="noopener">Esri</a>, HERE, Garmin, &copy; OpenStreetMap contributors',
    },
  },
  map: {
    label: 'layerMap',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    opts: { maxNativeZoom: 19, attribution: OSM_ATTR },
  },
  satellite: {
    label: 'layerSatellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    opts: {
      maxNativeZoom: 18,
      attribution:
        'Imagery &copy; <a href="https://www.esri.com" target="_blank" rel="noopener">Esri</a>, Maxar, Earthstar Geographics',
    },
    // Roads and place names on top of the imagery, like Google's satellite view.
    overlays: [
      `${ESRI_REF}/World_Transportation/MapServer/tile/{z}/{y}/{x}`,
      `${ESRI_REF}/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`,
    ],
  },
  terrain: {
    label: 'layerTerrain',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    opts: {
      subdomains: 'abc',
      maxNativeZoom: 17,
      attribution: `${OSM_ATTR}, SRTM, style &copy; <a href="https://opentopomap.org" target="_blank" rel="noopener">OpenTopoMap</a> (CC-BY-SA)`,
    },
  },
}

const themed = (def: BaseLayerDef, dark: boolean): TileDef =>
  def.dark && dark ? def.dark : def

const ESC: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c])

function groupTitle(g: Group, lang: AppContextValue['lang']) {
  const p = g.place
  const base = placeName(p.name, p.kind, lang, p.nameEn)
  return g.hood ? `${hoodName(g.hood, lang)}, ${base}` : base
}

function groupSub(g: Group, { t, lang }: Pick<AppContextValue, 't' | 'lang'>) {
  const p = g.place
  const kind = lang === 'en' && p.kind && !g.hood ? KIND_EN[p.kind] : ''
  const muni = p.municipality
    ? t('municipality', {
        name: lang === 'bg' ? p.municipality : transliterate(p.municipality),
      })
    : ''
  return [kind, muni, oblastLabel(p.oblast, lang)].filter(Boolean).join(', ')
}

function popupHtml(
  g: Group,
  { t, fmt, lang }: Pick<AppContextValue, 't' | 'fmt' | 'lang'>,
) {
  const items = [...g.items].sort(
    (a, b) => (a.eur ?? Infinity) - (b.eur ?? Infinity),
  )
  const shown = items.slice(0, 8)
  const rows = shown
    .map((l) => {
      const size = [
        l.area ? `${fmt.num(l.area)} ${t('sqm')}` : '',
        l.yard ? t('yardFact', { v: fmt.num(l.yard) }) : '',
      ]
        .filter(Boolean)
        .join(', ')
      const thumb = thumbFor(l)
      const img = thumb
        ? `<img loading="lazy" src="${esc(thumb)}" alt="" width="52" height="39">`
        : '<span class="pop-nophoto" aria-hidden="true"></span>'
      const price =
        l.price != null
          ? fmt.money(l.price, l.currency)
          : l.priceOnRequest
            ? t('priceOnRequest')
            : ''
      return `<li><button type="button" data-open="${esc(l.id)}">${img}<span class="pop-desc">${esc(typeLabel(l.type ?? 'other', l.typeBg, lang, true))}<br><span class="muted">${esc(size)}</span></span><b>${esc(price)}</b></button></li>`
    })
    .join('')
  const more =
    items.length > shown.length
      ? `<li class="more-n">${esc(t('popupMore', { n: items.length - shown.length }))}</li>`
      : ''
  const n = g.items.length
  return `<div class="pop">
<div class="pop-title">${esc(groupTitle(g, lang))}</div>
<div class="pop-sub">${esc(groupSub(g, { t, lang }))}</div>
<div class="pop-stats">
  <div><b>${esc(fmt.num(n))}</b><span>${esc(t('statListings', { n }))}</span></div>
  ${g.medPrice != null ? `<div><b>${esc(fmt.money(g.medPrice))}</b><span>${esc(t('statMedian'))}</span></div>` : ''}
  ${g.medPpm != null ? `<div><b>${esc(fmt.money(g.medPpm))}</b><span>${esc(t('statPpm'))}</span></div>` : ''}
</div>
<ul class="pop-list">${rows}${more}</ul>
<button type="button" class="pop-show" data-filter-place="${esc(g.key)}">${esc(t('popupShowAll', { n: fmt.num(n) }))}</button>
<div class="pop-note">${esc(t('precisionSettlement'))}</div>
</div>`
}

export interface MapHandle {
  highlight: (id: string, on: boolean) => void
  showOnMap: (l: Listing) => void
  fit: () => void
}

interface MapState {
  L: typeof Leaflet
  map: Leaflet.Map
  layer: Leaflet.LayerGroup
  controls: HTMLElement
  legend: HTMLElement
}

export function ListingMap({
  ref,
  filtered,
  hasHoods,
  groupMode,
  baseLayer,
  selectedPlace,
  unmappedActive,
  onOpen,
  onFilterPlace,
  onToggleUnmapped,
  onBaseLayer,
  onGroupMode,
}: {
  ref: React.Ref<MapHandle>
  filtered: Array<Listing>
  hasHoods: boolean
  groupMode: GroupMode
  baseLayer: string
  selectedPlace: string
  unmappedActive: boolean
  onOpen: (id: string) => void
  onFilterPlace: (key: string) => void
  onToggleUnmapped: () => void
  onBaseLayer: (key: string) => void
  onGroupMode: (mode: GroupMode) => void
}) {
  const app = useApp()
  const { t, fmt, lang } = app
  const box = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<MapState | null>(null)
  const markers = useRef(new Map<string, Leaflet.Marker>())
  const groups = useRef<Array<Group>>([])
  const fitted = useRef(false)
  const groupModeRef = useRef(groupMode)
  groupModeRef.current = groupMode
  const callbacks = useRef({ onOpen, onFilterPlace })
  callbacks.current = { onOpen, onFilterPlace }
  const dark = useMedia('(prefers-color-scheme: dark)')
  const [legendData, setLegendData] = useState<{
    breaks: Array<number>
    noData: boolean
    unmapped: number
  }>({ breaks: [], noData: false, unmapped: 0 })

  // The map itself: Leaflet only runs in the browser, so it loads on demand.
  useEffect(() => {
    let disposed = false
    let map: Leaflet.Map | null = null
    let resize: ResizeObserver | null = null
    void import('leaflet').then((mod) => {
      const L = (mod as unknown as { default?: typeof Leaflet }).default ?? mod
      if (disposed || !box.current) return
      // Whole zoom levels only: raster tiles stay pixel-sharp and never show hairline seams.
      map = L.map(box.current, {
        zoomSnap: 1,
        maxZoom: 18,
        zoomControl: false,
      }).setView([42.75, 25.3], 7)
      const m = map
      m.attributionControl.setPrefix(false)
      m.attributionControl.addAttribution(
        '<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>',
      )
      m.attributionControl.addAttribution(
        '<a href="https://www.geonames.org" target="_blank" rel="noopener">GeoNames</a>',
      )
      const control = (cls: string, position: Leaflet.ControlPosition) => {
        const el = L.DomUtil.create('div', cls)
        L.DomEvent.disableClickPropagation(el)
        L.DomEvent.disableScrollPropagation(el)
        const C = L.Control.extend({ onAdd: () => el })
        new C({ position }).addTo(m)
        return el
      }
      const controls = control('map-stack', 'topright')
      L.control.zoom({ position: 'bottomright' }).addTo(m)
      const legend = control('map-bl', 'bottomleft')
      const layer = L.layerGroup().addTo(m)
      const markerScale = () => {
        const z = m.getZoom()
        m.getContainer().style.setProperty(
          '--mk-scale',
          String(z <= 7 ? 0.68 : z === 8 ? 0.76 : z === 9 ? 0.88 : 1),
        )
      }
      m.on('zoomend', markerScale)
      markerScale()
      m.getContainer().addEventListener('click', (e) => {
        const target = e.target as HTMLElement
        const open = target.closest<HTMLElement>('[data-open]')
        if (open?.dataset.open) {
          callbacks.current.onOpen(open.dataset.open)
          return
        }
        const place = target.closest<HTMLElement>('[data-filter-place]')
        if (place?.dataset.filterPlace) {
          m.closePopup()
          callbacks.current.onFilterPlace(place.dataset.filterPlace)
        }
      })
      resize = new ResizeObserver(() => m.invalidateSize())
      resize.observe(box.current)
      setState({ L, map: m, layer, controls, legend })
    })
    return () => {
      disposed = true
      resize?.disconnect()
      map?.remove()
    }
  }, [])

  // Base map, light or dark with the system.
  useEffect(() => {
    if (!state) return
    const { L, map } = state
    const def = BASE_LAYERS[baseLayer] ?? BASE_LAYERS.light
    const tiles = themed(def, dark)
    const native = def.opts.maxNativeZoom
    const layers = [
      L.tileLayer(tiles.url, { maxZoom: 18, zIndex: 1, ...def.opts }),
      ...(tiles.overlays ?? []).map((url) =>
        L.tileLayer(url, { maxZoom: 18, maxNativeZoom: native, zIndex: 2 }),
      ),
    ]
    for (const l of layers) l.addTo(map)
    return () => {
      for (const l of layers) map.removeLayer(l)
    }
  }, [state, baseLayer, dark])

  // Markers: one per settlement (or neighbourhood), sized by count, coloured by median €/m².
  useEffect(() => {
    if (!state) return
    const { L, map, layer } = state
    const { list, unmapped } = computeGroups(filtered, groupMode)
    groups.current = list
    const breaks = ppmBreaks(list)
    layer.clearLayers()
    markers.current.clear()
    // Largest first so small groups stay clickable on top.
    for (const g of [...list].sort((a, b) => b.items.length - a.items.length)) {
      const n = g.items.length
      const size = Math.round(Math.min(58, 22 + 6.5 * Math.log2(n)))
      const bin = binOf(g.medPpm, breaks)
      const color = bin >= 0 ? rampColor(bin, breaks) : null
      const icon = L.divIcon({
        className: 'mk-wrap',
        html: `<div class="mk ${color ? `mk-b${MARKER_RAMP.indexOf(color)}` : 'mk-nodata'} ${selectedPlace === g.key ? 'mk-selected' : ''}" style="width:${size}px;height:${size}px;${color ? `--mk:${color}` : ''}">${n}</div>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
        popupAnchor: [0, -size / 2],
      })
      const title = groupTitle(g, lang)
      const m = L.marker([g.lat, g.lon], {
        icon,
        title: `${title}: ${t('popupCount', { n })}`,
        alt: title,
        riseOnHover: true,
      })
      // Clearance so the popup isn't tucked under the map buttons.
      m.bindPopup(() => popupHtml(g, { t, fmt, lang }), {
        maxWidth: 340,
        minWidth: 280,
        autoPanPaddingTopLeft: [20, 20],
        autoPanPaddingBottomRight: [70, 20],
        closeButton: true,
      })
      m.addTo(layer)
      markers.current.set(g.key, m)
    }
    setLegendData({
      breaks,
      noData: list.some((g) => g.medPpm == null),
      unmapped,
    })
    // Fit once to the first listings, and again after the map was emptied (data deleted).
    if (!list.length) fitted.current = false
    else if (!fitted.current) {
      fitted.current = true
      fitTo(state, list)
    }
    map.closePopup()
  }, [state, filtered, groupMode, selectedPlace, lang, t, fmt])

  useImperativeHandle(
    ref,
    () => ({
      highlight(id, on) {
        const l = filtered.find((x) => x.id === id)
        const g = l && groupOf(l, groupModeRef.current)
        const m = g && markers.current.get(g.key)
        const el = m?.getElement()?.querySelector('.mk')
        if (!m || !el) return
        el.classList.toggle('mk-hl', on)
        m.setZIndexOffset(on ? 10000 : 0)
      },
      showOnMap(l) {
        const g = groupOf(l, groupModeRef.current)
        if (!g || !state) return
        const { map } = state
        const m = markers.current.get(g.key)
        const zoom = Math.max(map.getZoom(), 12)
        requestAnimationFrame(() => {
          map.invalidateSize()
          if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            map.setView([g.lat, g.lon], zoom)
            m?.openPopup()
            return
          }
          map.flyTo([g.lat, g.lon], zoom, { duration: 0.8 })
          if (m) map.once('moveend', () => m.openPopup())
        })
      },
      fit() {
        if (state) fitTo(state, groups.current)
      },
    }),
    [filtered, state],
  )

  return (
    <>
      <div ref={box} className="absolute inset-0 bg-[var(--map-bg)]" />
      {state &&
        createPortal(
          <MapControls
            state={state}
            dark={dark}
            hasHoods={hasHoods}
            baseLayer={baseLayer}
            groupMode={groupMode}
            onBaseLayer={onBaseLayer}
            onGroupMode={onGroupMode}
            onFit={() => fitTo(state, groups.current)}
          />,
          state.controls,
        )}
      {state &&
        createPortal(
          <MapLegend
            {...legendData}
            unmappedActive={unmappedActive}
            onToggleUnmapped={onToggleUnmapped}
          />,
          state.legend,
        )}
      <span className="sr-only">{t('viewMap')}</span>
    </>
  )
}

function fitTo(state: MapState, list: Array<Pick<Group, 'lat' | 'lon'>>) {
  if (!list.length) return
  const b = state.L.latLngBounds(
    list.map((g) => [g.lat, g.lon] as [number, number]),
  )
  state.map.fitBounds(b, { padding: [30, 30], maxZoom: 12 }) // ~ the largest marker's radius
}

/** Tile of the current map centre for a tile URL template: a live preview, like Google Maps' layer picker. */
function previewTile(state: MapState, url: string) {
  const c = state.map.getCenter()
  const z = Math.max(5, Math.min(14, Math.round(state.map.getZoom()) - 1))
  const n = 2 ** z
  const lat = (c.lat * Math.PI) / 180
  const x = Math.floor(((c.lng + 180) / 360) * n)
  const y = Math.floor(
    ((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * n,
  )
  return state.L.Util.template(url, { s: 'a', z, x, y, r: '' })
}

const FAB =
  'grid size-10 cursor-pointer place-items-center rounded-full border-0 bg-background text-[19px] text-foreground shadow-[var(--shadow-float)] transition-[background-color,transform] hover:bg-muted active:scale-[.94] aria-expanded:bg-muted'

function MapControls({
  state,
  dark,
  hasHoods,
  baseLayer,
  groupMode,
  onBaseLayer,
  onGroupMode,
  onFit,
}: {
  state: MapState
  dark: boolean
  hasHoods: boolean
  baseLayer: string
  groupMode: GroupMode
  onBaseLayer: (key: string) => void
  onGroupMode: (mode: GroupMode) => void
  onFit: () => void
}) {
  const { t } = useApp()
  const [open, setOpen] = useState(false)
  const toggle = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    state.map.on('click', close)
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      toggle.current?.focus()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      state.map.off('click', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, state])
  const label = t('mapOptions')
  return (
    <div className="relative flex flex-col gap-2">
      <button
        ref={toggle}
        type="button"
        className={FAB}
        aria-expanded={open}
        aria-controls="lsPanel"
        title={label}
        aria-label={label}
        onClick={() => {
          state.map.closePopup()
          setOpen(!open)
        }}
      >
        <StackIcon aria-hidden="true" className="size-[19px]" />
      </button>
      <button
        type="button"
        className={FAB}
        title={t('fit')}
        aria-label={t('fit')}
        onClick={onFit}
      >
        <CornersOutIcon aria-hidden="true" className="size-[19px]" />
      </button>
      {open && (
        <div
          id="lsPanel"
          role="group"
          aria-label={label}
          className="absolute top-0 right-[50px] flex w-[300px] max-w-[calc(100vw-80px)] origin-top-right animate-in cursor-default flex-col gap-4 rounded-2xl border bg-popover p-4 text-popover-foreground shadow-[var(--shadow-float)] fade-in-0 zoom-in-95"
        >
          <div className="flex flex-col gap-2">
            <span className="text-[13px] font-semibold">{t('mapType')}</span>
            <div className="grid grid-cols-4 gap-2">
              {Object.entries(BASE_LAYERS).map(([k, def]) => {
                const tiles = themed(def, dark)
                return (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={k === baseLayer}
                    onClick={(e) => {
                      onBaseLayer(k)
                      e.currentTarget.focus()
                    }}
                    className="group/ls flex cursor-pointer flex-col items-center gap-1.5 border-0 bg-transparent p-0 text-xs text-foreground-2 aria-pressed:font-semibold aria-pressed:text-foreground"
                  >
                    <span className="relative block aspect-square w-full overflow-hidden rounded-[10px] bg-muted shadow-[0_0_0_1px_var(--border)] outline-2 outline-offset-2 outline-transparent transition-[outline-color] group-hover/ls:outline-border-strong group-aria-pressed/ls:outline-foreground">
                      {[tiles.url, ...(tiles.overlays ?? [])].map((url) => (
                        <img
                          key={url}
                          src={previewTile(state, url)}
                          alt=""
                          width={64}
                          height={64}
                          className="absolute inset-0 block size-full object-cover"
                        />
                      ))}
                    </span>
                    <span>{t(def.label)}</span>
                  </button>
                )
              })}
            </div>
          </div>
          {hasHoods && (
            <div className="flex flex-col gap-2">
              <span className="text-[13px] font-semibold">{t('groupBy')}</span>
              <Segmented
                className="flex w-full [&>button]:flex-1"
                label={t('groupBy')}
                value={groupMode}
                options={[
                  ['settlement', t('groupSettlement')],
                  ['neighborhood', t('groupNeighborhood')],
                ]}
                onChange={(v) =>
                  onGroupMode(
                    v === 'neighborhood' ? 'neighborhood' : 'settlement',
                  )
                }
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function MapLegend({
  breaks,
  noData,
  unmapped,
  unmappedActive,
  onToggleUnmapped,
}: {
  breaks: Array<number>
  noData: boolean
  unmapped: number
  unmappedActive: boolean
  onToggleUnmapped: () => void
}) {
  const { t, fmt } = useApp()
  const bins = breaks.length + 1
  return (
    <div className="flex flex-col items-start">
      {(unmapped > 0 || unmappedActive) && (
        <button
          type="button"
          aria-pressed={unmappedActive}
          title={t('onlyUnmappedTitle')}
          onClick={onToggleUnmapped}
          className="mb-2 inline-flex h-[34px] cursor-pointer items-center gap-2 rounded-full border-0 bg-background pr-3.5 pl-3 text-[12.5px] font-medium whitespace-nowrap text-foreground shadow-[var(--shadow-float)] hover:bg-muted aria-pressed:bg-primary aria-pressed:text-primary-foreground"
        >
          {unmappedActive ? (
            <XIcon aria-hidden="true" className="size-4" />
          ) : (
            <GpsSlashIcon
              aria-hidden="true"
              className="size-4 text-muted-foreground"
            />
          )}
          <span>
            {unmappedActive
              ? t('unmappedActive')
              : t('unmapped', { n: fmt.num(unmapped) })}
          </span>
        </button>
      )}
      {breaks.length > 0 && (
        <div
          title={t('legendSize')}
          className="w-[220px] rounded-2xl bg-background/94 px-3 pt-2.5 pb-2 text-[11.5px] text-foreground shadow-[var(--shadow-float)] backdrop-blur-md max-[720px]:w-[216px]"
        >
          <div className="mb-2 flex justify-between gap-2 text-xs font-semibold">
            <span>{t('legendTitle')}</span>
            {noData && (
              <span className="inline-flex items-center gap-[5px] font-[450] text-muted-foreground">
                <span className="inline-block size-2.5 rounded-full bg-[#bdbab3]" />
                {t('legendNoData')}
              </span>
            )}
          </div>
          <div className="flex h-2 gap-0.5" aria-hidden="true">
            {Array.from({ length: bins }, (_, i) => (
              <span
                key={i}
                className="flex-1 first:rounded-l last:rounded-r"
                style={{ background: rampColor(i, breaks) }}
              />
            ))}
          </div>
          <div
            className="relative mt-1 h-4 text-muted-foreground tabular max-[720px]:text-[10.5px]"
            aria-hidden="true"
          >
            {breaks.map((b, i) => (
              <span
                key={b}
                className="absolute top-0 -translate-x-1/2 whitespace-nowrap"
                style={{ left: `${(((i + 1) / bins) * 100).toFixed(2)}%` }}
              >
                {fmt.num(b)}
              </span>
            ))}
          </div>
          <span className="sr-only">
            {t('legendSr', {
              breaks: breaks.map((b) => fmt.num(b)).join(', '),
            })}
          </span>
        </div>
      )}
    </div>
  )
}
