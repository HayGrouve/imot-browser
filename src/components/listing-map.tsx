import { useEffect, useImperativeHandle, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type * as Leaflet from 'leaflet'
import {
  CornersOutIcon,
  GpsSlashIcon,
  ListMagnifyingGlassIcon,
  PolygonIcon,
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
import type { DrawnArea, Group, GroupMode, Listing } from '#/lib/listings'
import {
  KIND_EN,
  floorText,
  hoodName,
  oblastLabel,
  placeName,
  yearText,
} from '#/lib/labels'
import { thumbFor } from '#/lib/urls'
import { cn } from '#/lib/utils'
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

// Phosphor's EyeSlash and Eye (regular): the popup is plain HTML, not React.
const ICON_PATHS = {
  hide: 'M53.92,34.62A8,8,0,1,0,42.08,45.38L61.32,66.55C25,88.84,9.38,123.2,8.69,124.76a8,8,0,0,0,0,6.5c.35.79,8.82,19.57,27.65,38.4C61.43,194.74,93.12,208,128,208a127.11,127.11,0,0,0,52.07-10.83l22,24.21a8,8,0,1,0,11.84-10.76Zm47.33,75.84,41.67,45.85a32,32,0,0,1-41.67-45.85ZM128,192c-30.78,0-57.67-11.19-79.93-33.25A133.16,133.16,0,0,1,25,128c4.69-8.79,19.66-33.39,47.35-49.38l18,19.75a48,48,0,0,0,63.66,70l14.73,16.2A112,112,0,0,1,128,192Zm6-95.43a8,8,0,0,1,3-15.72,48.16,48.16,0,0,1,38.77,42.64,8,8,0,0,1-7.22,8.71,6.39,6.39,0,0,1-.75,0,8,8,0,0,1-8-7.26A32.09,32.09,0,0,0,134,96.57Zm113.28,34.69c-.42.94-10.55,23.37-33.36,43.8a8,8,0,1,1-10.67-11.92A132.77,132.77,0,0,0,231.05,128a133.15,133.15,0,0,0-23.12-30.77C185.67,75.19,158.78,64,128,64a118.37,118.37,0,0,0-19.36,1.57A8,8,0,1,1,106,49.79,134,134,0,0,1,128,48c34.88,0,66.57,13.26,91.66,38.35,18.83,18.83,27.3,37.62,27.65,38.41A8,8,0,0,1,247.31,131.26Z',
  unhide:
    'M247.31,124.76c-.35-.79-8.82-19.58-27.65-38.41C194.57,61.26,162.88,48,128,48S61.43,61.26,36.34,86.35C17.51,105.18,9,124,8.69,124.76a8,8,0,0,0,0,6.5c.35.79,8.82,19.57,27.65,38.4C61.43,194.74,93.12,208,128,208s66.57-13.26,91.66-38.34c18.83-18.83,27.3-37.61,27.65-38.4A8,8,0,0,0,247.31,124.76ZM128,192c-30.78,0-57.67-11.19-79.93-33.25A133.47,133.47,0,0,1,25,128,133.33,133.33,0,0,1,48.07,97.25C70.33,75.19,97.22,64,128,64s57.67,11.19,79.93,33.25A133.46,133.46,0,0,1,231.05,128C223.84,141.46,192.43,192,128,192Zm0-112a48,48,0,1,0,48,48A48.05,48.05,0,0,0,128,80Zm0,80a32,32,0,1,1,32-32A32,32,0,0,1,128,160Z',
}
const svgIcon = (d: string) =>
  `<svg viewBox="0 0 256 256" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="${d}"/></svg>`

function popupHtml(
  g: Group,
  {
    t,
    fmt,
    lang,
    hidden,
    stars,
  }: Pick<AppContextValue, 't' | 'fmt' | 'lang' | 'hidden' | 'stars'>,
) {
  const items = [...g.items].sort(
    (a, b) => (a.eur ?? Infinity) - (b.eur ?? Infinity),
  )
  const shown = items.slice(0, 10)
  const rows = shown
    .map((l) => {
      const floor = floorText(l, lang)
      const year = yearText(l)
      const facts = [
        l.area ? `${fmt.num(l.area)} ${t('sqm')}` : '',
        l.yard ? t('yardFact', { v: fmt.num(l.yard) }) : '',
        floor ? t('floorFact', { v: floor }) : '',
        year ? t('builtFact', { v: year }) : '',
      ]
        .filter(Boolean)
        .join(', ')
      // As in the list: a neighbourhood is named only on a settlement marker, and not when it is the place itself.
      const hood = l.nbhd?.name || l.neighborhood
      const where =
        !g.hood && hood && l.place?.via !== 'neighborhood'
          ? hoodName(hood, lang)
          : ''
      const thumb = thumbFor(l)
      const img = thumb
        ? `<img loading="lazy" src="${esc(thumb)}" alt="" width="84" height="63">`
        : '<span class="pop-nophoto" aria-hidden="true"></span>'
      const price =
        l.price != null
          ? fmt.money(l.price, l.currency)
          : l.priceOnRequest
            ? t('priceOnRequest')
            : ''
      const ppm = l.ppm
        ? `<span class="pop-ppm">${esc(fmt.money(l.ppm))}/${esc(t('sqm'))}</span>`
        : ''
      const badges = [
        l.fresh
          ? `<span class="pop-tag pop-tag-new">${esc(t('badgeNew'))}</span>`
          : '',
        l.stale
          ? `<span class="pop-tag pop-tag-stale">${esc(t('badgeStaleShort'))}</span>`
          : '',
        stars.has(l.id)
          ? `<span class="pop-star"><span aria-hidden="true">★</span><span class="sr-only">${esc(t('pillStarred'))}</span></span>`
          : '',
      ].join('')
      const hide = hidden.has(l.id) ? 'unhide' : 'hide'
      return `<li><button type="button" class="pop-row${l.stale ? ' pop-stale' : ''}" data-open="${esc(l.id)}">${img}<span class="pop-desc"><span class="pop-kind">${esc(typeLabel(l.type ?? 'other', l.typeBg, lang, true))}${badges}</span>${facts ? `<span class="muted">${esc(facts)}</span>` : ''}${where ? `<span class="muted">${esc(where)}</span>` : ''}</span><span class="pop-price"><b>${esc(price)}</b>${ppm}</span></button><button type="button" class="pop-hide" data-hide="${esc(l.id)}" aria-pressed="${hide === 'unhide'}" title="${esc(t(hide))}" aria-label="${esc(t(hide))}">${svgIcon(ICON_PATHS[hide])}</button></li>`
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
  groupMode: chosenMode,
  baseLayer,
  selectedPlace,
  unmappedActive,
  drawnArea,
  onOpen,
  onFilterPlace,
  onToggleUnmapped,
  onDrawnArea,
  onSearchArea,
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
  drawnArea: DrawnArea | null
  onOpen: (id: string) => void
  onFilterPlace: (key: string) => void
  onToggleUnmapped: () => void
  onDrawnArea: (area: DrawnArea | null) => void
  /** Search imot.bg inside the drawn area. */
  onSearchArea: () => void
  onBaseLayer: (key: string) => void
  onGroupMode: (mode: GroupMode) => void
}) {
  const app = useApp()
  const { t, fmt, lang, hidden, stars, toggleHidden } = app
  const box = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<MapState | null>(null)
  const [drawing, setDrawing] = useState(false)
  const markers = useRef(new Map<string, Leaflet.Marker>())
  const groups = useRef<Array<Group>>([])
  const fitted = useRef(false)
  /** The group whose popup is open, so it stays open when its listings change. */
  const openKey = useRef<string | null>(null)
  /** The popup's hide button that was pressed, to put focus back on its row. */
  const refocus = useRef<number | null>(null)
  // A drawn area matches listings by their neighbourhood when it is known: so do the markers.
  const groupMode: GroupMode = drawnArea ? 'neighborhood' : chosenMode
  const groupModeRef = useRef(groupMode)
  groupModeRef.current = groupMode
  const callbacks = useRef({ onOpen, onFilterPlace, toggleHidden, onDrawnArea })
  callbacks.current = { onOpen, onFilterPlace, toggleHidden, onDrawnArea }
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
        const hide = target.closest<HTMLElement>('[data-hide]')
        if (hide?.dataset.hide) {
          const buttons = [
            ...m.getContainer().querySelectorAll('.leaflet-popup [data-hide]'),
          ]
          refocus.current = e.detail === 0 ? buttons.indexOf(hide) : null
          callbacks.current.toggleHidden(hide.dataset.hide)
          return
        }
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
      m.on('popupopen', (e) => {
        const key = [...markers.current].find(
          ([, mk]) => mk.getPopup() === e.popup,
        )?.[0]
        openKey.current = key ?? null
      })
      m.on('popupclose', () => (openKey.current = null))
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
    // Never wider than the screen: 20 px clear on the left, 70 on the right (the map's buttons).
    const room = window.innerWidth - 90
    const breaks = ppmBreaks(list)
    const reopen = openKey.current
    const scrollTop =
      map.getContainer().querySelector('.leaflet-popup .pop-list')?.scrollTop ??
      0
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
      // Clearance so the popup isn't tucked under the map buttons, or the legend below it.
      m.bindPopup(() => popupHtml(g, { t, fmt, lang, hidden, stars }), {
        maxWidth: Math.min(420, room),
        minWidth: Math.min(360, room),
        autoPanPaddingTopLeft: [20, 20],
        autoPanPaddingBottomRight: [70, 100],
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
    // A listing hidden from the popup: the popup stays, with the place's other listings.
    const still = reopen ? markers.current.get(reopen) : undefined
    if (still) {
      still.openPopup()
      const el = still.getPopup()?.getElement()
      const pop = el?.querySelector('.pop-list')
      if (pop) pop.scrollTop = scrollTop
      if (refocus.current != null) {
        const buttons = el?.querySelectorAll<HTMLElement>('[data-hide]') ?? []
        buttons[Math.min(refocus.current, buttons.length - 1)]?.focus()
      }
    } else map.closePopup()
    refocus.current = null
  }, [state, filtered, groupMode, selectedPlace, lang, t, fmt, hidden, stars])

  // The drawn area, under the markers.
  useEffect(() => {
    if (!state || !drawnArea) return
    const shape = state.L.polygon(drawnArea, {
      className: 'draw-area',
      interactive: false,
    }).addTo(state.map)
    return () => {
      shape.remove()
    }
  }, [state, drawnArea])

  // Drawing an area: press and drag around it (mouse, pen or finger) while the map holds still.
  useEffect(() => {
    if (!state || !drawing) return
    const { L, map } = state
    const el = map.getContainer()
    const handlers = [
      map.dragging,
      map.touchZoom,
      map.doubleClickZoom,
      map.boxZoom,
    ].filter((h) => h.enabled())
    for (const h of handlers) h.disable()
    map.closePopup()
    el.classList.add('map-drawing')
    let pointer: number | null = null
    let pts: Array<Leaflet.Point> = []
    let line: Leaflet.Polyline | null = null
    const stop = () => {
      pointer = null
      pts = []
      line?.remove()
      line = null
    }
    const onDown = (e: PointerEvent) => {
      if (pointer != null || e.button !== 0) return
      if ((e.target as HTMLElement).closest('.leaflet-control')) return
      e.preventDefault()
      pointer = e.pointerId
      el.setPointerCapture(pointer)
      pts = [map.mouseEventToContainerPoint(e)]
      line = L.polyline([map.containerPointToLatLng(pts[0])], {
        className: 'draw-line',
        interactive: false,
      }).addTo(map)
    }
    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== pointer || !line) return
      const p = map.mouseEventToContainerPoint(e)
      if (p.distanceTo(pts[pts.length - 1]) < 4) return
      pts.push(p)
      line.addLatLng(map.containerPointToLatLng(p))
    }
    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== pointer) return
      const size = L.bounds(pts).getSize()
      const corners = L.LineUtil.simplify(pts, 2)
      stop()
      // A tap or a short stroke is not an area: keep drawing.
      if (corners.length < 3 || size.x + size.y < 40) return
      const round = (x: number) => Math.round(x * 1e5) / 1e5
      callbacks.current.onDrawnArea(
        corners.map((p) => {
          const ll = map.containerPointToLatLng(p)
          return [round(ll.lat), round(ll.lng)]
        }),
      )
      setDrawing(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawing(false)
    }
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', stop)
    document.addEventListener('keydown', onKey)
    return () => {
      stop()
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', stop)
      document.removeEventListener('keydown', onKey)
      el.classList.remove('map-drawing')
      for (const h of handlers) h.enable()
    }
  }, [state, drawing])

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
            hasHoods={hasHoods && !drawnArea}
            baseLayer={baseLayer}
            groupMode={groupMode}
            onBaseLayer={onBaseLayer}
            onGroupMode={onGroupMode}
            onFit={() => fitTo(state, groups.current)}
            drawing={drawing}
            hasArea={!!drawnArea}
            onDraw={() => setDrawing(!drawing)}
          />,
          state.controls,
        )}
      {state &&
        createPortal(
          <MapLegend
            {...legendData}
            unmappedActive={unmappedActive}
            onToggleUnmapped={onToggleUnmapped}
            hasArea={!!drawnArea}
            onClearArea={() => onDrawnArea(null)}
            onSearchArea={onSearchArea}
          />,
          state.legend,
        )}
      {drawing && (
        <div className="pointer-events-none absolute top-3 right-[60px] left-3 z-[1000] flex justify-center">
          <div
            role="status"
            className="pointer-events-auto flex max-w-[460px] animate-in items-center gap-3 rounded-2xl bg-background py-2 pr-2 pl-4 text-foreground shadow-[var(--shadow-float)] fade-in-0 slide-in-from-top-2"
          >
            <div className="flex min-w-0 flex-col">
              <span className="text-[13.5px] font-semibold">
                {t('drawHint')}
              </span>
              <span className="text-[12px] text-muted-foreground">
                {t('drawNote')}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setDrawing(false)}
              className="h-8 flex-none cursor-pointer rounded-full border-0 bg-muted px-3.5 text-[13px] font-medium text-foreground hover:bg-surface-3"
            >
              {t('cancel')}
            </button>
          </div>
        </div>
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
  drawing,
  hasArea,
  onDraw,
}: {
  state: MapState
  dark: boolean
  hasHoods: boolean
  baseLayer: string
  groupMode: GroupMode
  onBaseLayer: (key: string) => void
  onGroupMode: (mode: GroupMode) => void
  onFit: () => void
  drawing: boolean
  hasArea: boolean
  onDraw: () => void
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
      <button
        type="button"
        className={cn(
          FAB,
          'aria-pressed:bg-primary aria-pressed:text-primary-foreground',
        )}
        aria-pressed={drawing}
        title={t(hasArea ? 'drawAreaAgain' : 'drawArea')}
        aria-label={t(hasArea ? 'drawAreaAgain' : 'drawArea')}
        onClick={() => {
          setOpen(false)
          onDraw()
        }}
      >
        <PolygonIcon aria-hidden="true" className="size-[19px]" />
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
  hasArea,
  onClearArea,
  onSearchArea,
}: {
  breaks: Array<number>
  noData: boolean
  unmapped: number
  unmappedActive: boolean
  onToggleUnmapped: () => void
  hasArea: boolean
  onClearArea: () => void
  onSearchArea: () => void
}) {
  const { t, fmt } = useApp()
  const bins = breaks.length + 1
  return (
    <div className="flex flex-col items-start">
      {hasArea && (
        <div className="mb-2 flex flex-wrap gap-2">
          <button
            type="button"
            title={t('searchAreaTitle')}
            onClick={onSearchArea}
            className="inline-flex h-[34px] cursor-pointer items-center gap-2 rounded-full border-0 bg-primary pr-3.5 pl-3 text-[12.5px] font-medium whitespace-nowrap text-primary-foreground shadow-[var(--shadow-float)] hover:bg-primary/90"
          >
            <ListMagnifyingGlassIcon aria-hidden="true" className="size-4" />
            <span>{t('searchArea')}</span>
          </button>
          <button
            type="button"
            title={t('clearDrawnArea')}
            onClick={onClearArea}
            className="inline-flex h-[34px] cursor-pointer items-center gap-2 rounded-full border-0 bg-background pr-3.5 pl-3 text-[12.5px] font-medium whitespace-nowrap text-foreground shadow-[var(--shadow-float)] hover:bg-muted max-[720px]:w-[34px] max-[720px]:justify-center max-[720px]:px-0"
          >
            <XIcon
              aria-hidden="true"
              className="size-4 text-muted-foreground"
            />
            {/* Phones keep the map clear: just the ×. */}
            <span className="max-[720px]:sr-only">{t('clearDrawnArea')}</span>
          </button>
        </div>
      )}
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
