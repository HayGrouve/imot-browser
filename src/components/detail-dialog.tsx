import { useEffect, useRef, useState } from 'react'
import { useQuery } from 'convex/react'
import {
  ArrowSquareOutIcon,
  BuildingsIcon,
  CalendarBlankIcon,
  CaretDownIcon,
  CaretLeftIcon,
  CaretRightIcon,
  CaretUpIcon,
  CornersOutIcon,
  EyeIcon,
  EyeSlashIcon,
  FireIcon,
  GpsSlashIcon,
  ImageIcon,
  InfoIcon,
  MapPinIcon,
  PhoneIcon,
  RulerIcon,
  StairsIcon,
  StarIcon,
  TranslateIcon,
  TreeIcon,
  TrendDownIcon,
  TrendUpIcon,
  XIcon,
} from '@phosphor-icons/react'
import { api } from '../../convex/_generated/api'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '#/components/ui/dialog'
import { Button, buttonVariants } from '#/components/ui/button'
import { Skeleton } from '#/components/ui/skeleton'
import { Textarea } from '#/components/ui/textarea'
import { cn } from '#/lib/utils'
import { useApp, useMarks } from './app-context'
import { PriceTrend, Tag } from './results'
import { isUnmapped } from '#/lib/listings'
import type { Listing } from '#/lib/listings'
import {
  floorText,
  hoodName,
  listingPlace,
  oblastLabel,
  placeName,
  yearText,
} from '#/lib/labels'
import { safeUrl, thumbOf } from '#/lib/urls'
import {
  CONSTRUCTION_STATUS,
  dealLabel,
  term,
  typeLabel,
} from '../../shared/vocab'

export function DetailDialog({
  listing,
  index,
  count,
  onClose,
  onStep,
  onToggleHidden,
  onShowOnMap,
}: {
  listing: Listing | null
  index: number
  count: number
  onClose: () => void
  onStep: (delta: number) => void
  onToggleHidden: (id: string) => void
  onShowOnMap: (l: Listing) => void
}) {
  const { t } = useApp()
  const title = useRef<HTMLHeadingElement>(null)
  // Keep showing the last listing while the dialog animates closed.
  const [shown, setShown] = useState(listing)
  useEffect(() => {
    if (listing) setShown(listing)
  }, [listing])
  const l = listing ?? shown

  return (
    <Dialog open={!!listing} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        initialFocus={title}
        className="flex h-[calc(100dvh-32px)] w-[min(1160px,calc(100vw-32px))] max-w-none flex-col gap-0 overflow-hidden rounded-2xl p-0 shadow-[var(--shadow-lift)] max-[720px]:h-dvh max-[720px]:w-screen max-[720px]:rounded-none sm:max-w-none"
        onKeyDown={(e) => {
          const target = e.target as HTMLElement
          if (
            target.closest('textarea,input,select,[data-photo-viewer]') ||
            e.ctrlKey ||
            e.metaKey ||
            e.altKey
          )
            return
          if (e.key === 'PageUp' || e.key === 'k') {
            onStep(-1)
            e.preventDefault()
          } else if (e.key === 'PageDown' || e.key === 'j') {
            onStep(1)
            e.preventDefault()
          }
        }}
      >
        {l ? (
          <DetailBody
            key={l.id}
            l={l}
            index={index}
            count={count}
            titleRef={title}
            onClose={onClose}
            onStep={onStep}
            onToggleHidden={onToggleHidden}
            onShowOnMap={onShowOnMap}
          />
        ) : (
          <DialogTitle className="sr-only">{t('detailTitle')}</DialogTitle>
        )}
      </DialogContent>
    </Dialog>
  )
}

function DetailBody({
  l,
  index,
  count,
  titleRef,
  onClose,
  onStep,
  onToggleHidden,
  onShowOnMap,
}: {
  l: Listing
  index: number
  count: number
  titleRef: React.RefObject<HTMLHeadingElement | null>
  onClose: () => void
  onStep: (delta: number) => void
  onToggleHidden: (id: string) => void
  onShowOnMap: (l: Listing) => void
}) {
  const { t, fmt, lang, workspace } = useApp()
  const { stars, toggleStar, hidden: hiddenIds, notes, setNote } = useMarks()
  const details = useQuery(api.listings.details, { workspace, imotId: l.id })
  const body = useRef<HTMLDivElement>(null)
  const starred = stars.has(l.id)
  const url = safeUrl(l.url)
  const typeText = typeLabel(l.type ?? 'other', l.typeBg, lang)
  const place = listingPlace(l, lang)
  // The title names the place; the subline adds what it leaves out (neighbourhood, town, province).
  const viaHood = l.place?.via === 'neighborhood'
  const hood = viaHood ? null : l.nbhd?.name || l.neighborhood
  const where = [
    hood ? hoodName(hood, lang) : null,
    viaHood ? placeName(l.settlement, l.settlementKind, lang) : null,
    oblastLabel(l.oblast, lang),
  ]
    .filter(Boolean)
    .join(', ')
  const starLabel = t(starred ? 'unstar' : 'star')
  const hidden = hiddenIds.has(l.id)
  const hideLabel = t(hidden ? 'unhide' : 'hide')

  useEffect(() => {
    body.current?.scrollTo({ top: 0 })
  }, [l.id])

  const navBtn =
    'size-9 text-foreground-2 hover:text-foreground max-[560px]:size-[34px]'
  return (
    <>
      <header className="flex flex-none items-center justify-between gap-4 border-b py-3.5 pr-3.5 pl-6 max-[720px]:pt-[max(10px,env(safe-area-inset-top))] max-[560px]:gap-2 max-[560px]:pr-2 max-[560px]:pl-4">
        <div className="min-w-0">
          <DialogTitle
            ref={titleRef}
            tabIndex={-1}
            render={<h2 />}
            className="m-0 text-[19px] leading-[1.3] font-semibold tracking-[-0.02em] [overflow-wrap:anywhere] outline-none max-[560px]:text-base"
          >
            {place ? `${typeText} · ${place}` : typeText}
          </DialogTitle>
          <DialogDescription className="mt-0.5 text-[13.5px] text-muted-foreground max-[560px]:text-[12.5px]">
            {l.deal ? dealLabel(l.deal, lang) : ''}
            {where ? `, ${where}` : ''}
          </DialogDescription>
        </div>
        <div className="flex flex-none items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            aria-pressed={starred}
            title={starLabel}
            aria-label={starLabel}
            onClick={() => toggleStar(l.id)}
            className={cn(navBtn, starred && 'text-star hover:text-star')}
          >
            <StarIcon
              aria-hidden="true"
              weight={starred ? 'fill' : 'regular'}
            />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-pressed={hidden}
            title={hideLabel}
            aria-label={hideLabel}
            onClick={() => onToggleHidden(l.id)}
            className={navBtn}
          >
            {hidden ? (
              <EyeIcon aria-hidden="true" />
            ) : (
              <EyeSlashIcon aria-hidden="true" />
            )}
          </Button>
          <span
            className="mx-1.5 h-5 w-px bg-border max-[560px]:hidden"
            aria-hidden="true"
          />
          <Button
            variant="ghost"
            size="icon"
            className={navBtn}
            disabled={index <= 0}
            title={t('prevListing')}
            aria-label={t('prevListing')}
            onClick={() => onStep(-1)}
          >
            <CaretLeftIcon aria-hidden="true" />
          </Button>
          {index >= 0 && (
            <span className="min-w-[60px] text-center text-[13px] whitespace-nowrap text-muted-foreground tabular max-[560px]:hidden">
              {fmt.num(index + 1)} / {fmt.num(count)}
            </span>
          )}
          <Button
            variant="ghost"
            size="icon"
            className={navBtn}
            disabled={index < 0 || index >= count - 1}
            title={t('nextListing')}
            aria-label={t('nextListing')}
            onClick={() => onStep(1)}
          >
            <CaretRightIcon aria-hidden="true" />
          </Button>
          <span
            className="mx-1.5 h-5 w-px bg-border max-[560px]:hidden"
            aria-hidden="true"
          />
          <Button
            variant="ghost"
            size="icon"
            className={navBtn}
            title={t('close')}
            aria-label={t('close')}
            onClick={onClose}
          >
            <XIcon aria-hidden="true" />
          </Button>
        </div>
      </header>
      <div
        ref={body}
        className="flex-1 overflow-auto overscroll-contain p-6 max-[720px]:pb-[max(24px,env(safe-area-inset-bottom))] max-[560px]:px-4 max-[560px]:pt-4"
      >
        <div className="grid grid-cols-[minmax(0,1fr)_340px] grid-rows-[auto_1fr] items-start gap-x-10 gap-y-9 [grid-template-areas:'gallery_side''main_side'] max-[860px]:grid-cols-[minmax(0,1fr)] max-[860px]:grid-rows-none max-[860px]:gap-7 max-[860px]:[grid-template-areas:'gallery''side''main']">
          <div className="min-w-0 [grid-area:gallery]">
            {details === undefined ? (
              <Skeleton className="aspect-[4/3] w-full rounded-[10px]" />
            ) : (
              <Gallery
                photos={(details?.photos ?? [])
                  .map(safeUrl)
                  .filter((x): x is string => !!x)}
              />
            )}
          </div>
          <aside className="min-w-0 [grid-area:side] max-[860px]:static [@media(min-height:720px)]:sticky [@media(min-height:720px)]:top-0">
            <Summary
              l={l}
              details={details}
              url={url}
              onShowOnMap={onShowOnMap}
            />
          </aside>
          <div className="flex min-w-0 flex-col gap-8 [grid-area:main] [&>section+section]:border-t [&>section+section]:pt-8">
            <Description l={l} text={details?.description ?? null} />
            {details?.features?.length ? (
              <section>
                <h3 className="mb-3 text-[17px] font-semibold tracking-[-0.015em]">
                  {t('features')}
                </h3>
                <div className="flex flex-wrap gap-2">
                  {details.features.map((f) => (
                    <span
                      key={f}
                      title={lang === 'bg' ? undefined : f}
                      className="inline-flex h-8 items-center rounded-full bg-muted px-3.5 text-[13px] text-foreground-2"
                    >
                      {term(f, lang)}
                    </span>
                  ))}
                </div>
              </section>
            ) : null}
            <PriceHistory l={l} />
            <section>
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h3 className="m-0 text-[17px] font-semibold tracking-[-0.015em]">
                  <label htmlFor="noteInput">{t('note')}</label>
                </h3>
                <span
                  id="noteHint"
                  className="text-[12.5px] text-muted-foreground"
                >
                  {t('noteHint')}
                </span>
              </div>
              <Textarea
                id="noteInput"
                rows={3}
                aria-describedby="noteHint"
                placeholder={t('notePlaceholder')}
                defaultValue={notes[l.id] ?? ''}
                onChange={(e) => setNote(l.id, e.target.value)}
                className="min-h-[92px]"
              />
            </section>
          </div>
        </div>
      </div>
    </>
  )
}

function Gallery({ photos }: { photos: Array<string> }) {
  const { t, fmt } = useApp()
  const [i, setI] = useState(0)
  const [broken, setBroken] = useState(false)
  const [src, setSrc] = useState(photos[0] ?? '')
  const [full, setFull] = useState(false)
  const swipeX = useRef<number | null>(null)
  const strip = useRef<HTMLDivElement>(null)
  const n = photos.length
  const step = (d: number) => {
    if (n < 2) return
    setI((x) => (x + d + n) % n)
  }
  useEffect(() => {
    setSrc(photos[i] ?? '')
    setBroken(false)
    const on = strip.current?.querySelector<HTMLElement>(
      '[aria-current="true"]',
    )
    if (on && strip.current)
      strip.current.scrollLeft =
        on.offsetLeft - (strip.current.clientWidth - on.offsetWidth) / 2
    if (n > 1)
      for (const k of [i + 1, i - 1]) new Image().src = photos[(k + n) % n]
  }, [i, photos, n])
  // Arrow keys page through the photos while the dialog (or the full-screen view) has focus. Base UI's dialog
  // stops arrow keys from bubbling, so this listens in the capture phase.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (!target?.closest('[data-slot="dialog-content"]')) return
      if (
        target.closest('textarea,input,select') ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey
      )
        return
      if (e.key === 'ArrowLeft') step(-1)
      else if (e.key === 'ArrowRight') step(1)
      else return
      e.preventDefault()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  })

  if (!n)
    return (
      <div className="flex h-[180px] flex-col items-center justify-center gap-2 rounded-[10px] bg-muted text-[13px] text-muted-foreground">
        <ImageIcon aria-hidden="true" className="size-8" />
        <span>{t('noPhotos')}</span>
      </div>
    )
  // Old ads often lose their full-size photos: fall back to the smaller version, else hide the image.
  const onError = () => {
    const small = safeUrl(thumbOf(src))
    if (small && small !== src) setSrc(small)
    else setBroken(true)
  }
  const nav = (dir: -1 | 1) => (
    <button
      type="button"
      onClick={() => step(dir)}
      title={t(dir < 0 ? 'prevPhoto' : 'nextPhoto')}
      aria-label={t(dir < 0 ? 'prevPhoto' : 'nextPhoto')}
      className={cn(
        'absolute top-1/2 grid size-10 -translate-y-1/2 cursor-pointer place-items-center rounded-full border-0 bg-white/94 text-[#18181b] shadow-[0_1px_2px_rgb(0_0_0/.18),0_6px_16px_-4px_rgb(0_0_0/.3)] transition-[opacity,transform,background-color] hover:scale-[1.06] hover:bg-white focus-visible:opacity-100 active:scale-[.94] max-[560px]:size-9 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/photo:opacity-100',
        dir < 0 ? 'left-3.5' : 'right-3.5',
      )}
    >
      {dir < 0 ? (
        <CaretLeftIcon aria-hidden="true" className="size-[18px]" />
      ) : (
        <CaretRightIcon aria-hidden="true" className="size-[18px]" />
      )}
    </button>
  )
  const counter = (
    <span
      aria-live="polite"
      className="inline-flex h-[26px] items-center gap-1.5 rounded-full bg-[rgb(15_15_17/.7)] px-2.5 text-xs font-medium text-[#fafafa] tabular"
    >
      <ImageIcon aria-hidden="true" className="size-3.5 opacity-85" />
      {fmt.num(i + 1)} / {fmt.num(n)}
    </span>
  )
  // A horizontal swipe on a touch screen pages through the photos.
  const swipe = {
    onPointerDown: (e: React.PointerEvent) => {
      swipeX.current = e.pointerType === 'mouse' ? null : e.clientX
    },
    onPointerUp: (e: React.PointerEvent) => {
      if (swipeX.current === null) return
      const dx = e.clientX - swipeX.current
      swipeX.current = null
      if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1)
    },
  }
  return (
    <div className="flex flex-col gap-2.5">
      <div className="group/photo relative isolate aspect-[4/3] overflow-hidden rounded-[10px] bg-[#0f0f11] max-[560px]:-mx-4 max-[560px]:-mt-4 max-[560px]:rounded-none">
        {!broken && (
          <>
            <img
              src={src}
              alt=""
              className="absolute inset-0 -z-10 size-full scale-125 object-cover blur-[32px] brightness-[.6] saturate-[1.15]"
            />
            <img
              src={src}
              alt={t('photoOf', { i: i + 1, n })}
              onError={onError}
              className="block size-full object-contain"
            />
            <button
              type="button"
              onClick={() => setFull(true)}
              title={t('fullScreen')}
              aria-label={t('fullScreen')}
              className="absolute inset-0 cursor-zoom-in border-0 bg-transparent p-0 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            >
              <span className="absolute top-3 right-3 grid size-8 place-items-center rounded-full bg-[rgb(15_15_17/.7)] text-[#fafafa] transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/photo:opacity-100">
                <CornersOutIcon aria-hidden="true" className="size-4" />
              </span>
            </button>
          </>
        )}
        {n > 1 && (
          <>
            {nav(-1)}
            {nav(1)}
            <span className="absolute right-3 bottom-3">{counter}</span>
          </>
        )}
      </div>
      <Dialog open={full && !broken} onOpenChange={setFull}>
        <DialogContent
          showCloseButton={false}
          data-photo-viewer=""
          className="flex h-dvh w-screen max-w-none items-center justify-center rounded-none bg-[#0a0a0c] p-0 ring-0 sm:max-w-none"
        >
          <DialogTitle className="sr-only">
            {t('photoOf', { i: i + 1, n })}
          </DialogTitle>
          <div
            {...swipe}
            onClick={(e) => e.target === e.currentTarget && setFull(false)}
            className="group/photo absolute inset-0 flex touch-pan-y items-center justify-center p-[max(56px,env(safe-area-inset-top))_16px_max(56px,env(safe-area-inset-bottom))] max-[560px]:px-0"
          >
            <img
              src={src}
              alt={t('photoOf', { i: i + 1, n })}
              onError={onError}
              className="max-h-full max-w-full object-contain select-none"
              draggable={false}
            />
            {n > 1 && (
              <>
                {nav(-1)}
                {nav(1)}
              </>
            )}
          </div>
          <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between p-3 pt-[max(12px,env(safe-area-inset-top))] [&>*]:pointer-events-auto">
            {n > 1 ? counter : <span />}
            <DialogClose
              title={t('close')}
              aria-label={t('close')}
              className="grid size-10 cursor-pointer place-items-center rounded-full border-0 bg-white/12 text-[#fafafa] transition-colors hover:bg-white/22 focus-visible:outline-2 focus-visible:outline-white"
            >
              <XIcon aria-hidden="true" className="size-5" />
            </DialogClose>
          </div>
        </DialogContent>
      </Dialog>
      {n > 1 && (
        <div
          ref={strip}
          className="relative -mx-[3px] flex [scrollbar-width:thin] gap-2 overflow-x-auto p-[3px] motion-safe:scroll-smooth"
        >
          {photos.map((p, k) => (
            <button
              key={p}
              type="button"
              aria-current={k === i ? 'true' : undefined}
              aria-label={t('photoOf', { i: k + 1, n })}
              onClick={() => setI(k)}
              className="flex-none cursor-pointer rounded-[10px] border-0 bg-transparent p-0 opacity-60 outline-2 outline-offset-1 outline-transparent transition-[opacity,outline-color] hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-ring aria-[current=true]:opacity-100 aria-[current=true]:outline-foreground"
            >
              <img
                loading="lazy"
                src={thumbOf(p) ?? p}
                alt=""
                className="block h-[57px] w-[76px] rounded-[10px] bg-muted object-cover max-[560px]:h-12 max-[560px]:w-16"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

type Details = ReturnType<typeof useQuery<typeof api.listings.details>>

function Summary({
  l,
  details,
  url,
  onShowOnMap,
}: {
  l: Listing
  details: Details
  url: string | null
  onShowOnMap: (l: Listing) => void
}) {
  const { t, fmt, lang } = useApp()
  const price =
    l.price != null
      ? fmt.money(l.price, l.currency)
      : t(l.priceOnRequest ? 'priceOnRequest' : 'noPrice')
  const exVat = l.vatNote === 'Цената е без ДДС'
  const status = l.status
    ? (
        CONSTRUCTION_STATUS[l.status] as { bg: string; en: string } | undefined
      )?.[lang]
    : null
  const keyFacts: Array<[typeof RulerIcon, string, string, boolean?]> = [
    [RulerIcon, t('factArea'), l.area ? `${fmt.num(l.area)} ${t('sqm')}` : ''],
    [TreeIcon, t('factYard'), l.yard ? `${fmt.num(l.yard)} ${t('sqm')}` : ''],
    [StairsIcon, t('factFloor'), floorText(l, lang)],
    [CalendarBlankIcon, t('factBuilt'), yearText(l) || l.yearText || ''],
    [FireIcon, t('factHeating'), l.heating ? term(l.heating, lang) : ''],
    [
      BuildingsIcon,
      t('factConstruction'),
      [l.material ? term(l.material, lang) : null, status]
        .filter(Boolean)
        .join(', '),
      true,
    ],
    [MapPinIcon, t('factAddress'), l.address ?? '', true],
  ]
  const agency = details?.agency
  const agencyUrl = safeUrl(agency?.url)
  const broker = details?.broker
  const phone = details?.phone
  const meta: Array<[string, string]> = [
    [t('factId'), l.id],
    [t('factUpdated'), l.updatedAt ? fmt.date(l.updatedAt, true) : ''],
    [t('factViews'), details?.views != null ? fmt.num(details.views) : ''],
    [t('factFirstSeen'), fmt.date(l.firstSeen)],
    [t('factLastSeen'), fmt.date(l.lastSeen)],
    [t('factPromo'), l.promo ?? ''],
  ]
  const block = 'flex flex-col gap-0.5 border-t pt-5 text-[13.5px]'
  return (
    <div className="flex flex-col gap-5 rounded-2xl border bg-card p-[22px] shadow-[var(--shadow-float)] max-[560px]:p-[18px] max-[560px]:shadow-none min-[561px]:max-[860px]:grid min-[561px]:max-[860px]:grid-cols-2 min-[561px]:max-[860px]:gap-x-8">
      <div className="flex flex-col gap-1 min-[561px]:max-[860px]:col-span-2">
        {(l.fresh || l.stale) && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {l.fresh && <Tag kind="new">{t('badgeNew')}</Tag>}
            {l.stale && (
              <Tag kind="stale" title={t('badgeStale')}>
                {t('badgeStaleShort')}
              </Tag>
            )}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[30px] leading-[1.15] font-[650] tracking-[-0.025em] tabular max-[560px]:text-[26px]">
          {price}
          <PriceTrend trend={l.priceTrend} className="text-[22px]" />
          {exVat && (
            <Tag kind="vat" title={t('exVatTitle')}>
              {t('exVat')}
            </Tag>
          )}
        </div>
        {(l.ppm || (l.vatNote && !exVat)) && (
          <div className="text-[13.5px] text-muted-foreground tabular">
            {[
              l.ppm ? `${fmt.money(l.ppm)}/${t('sqm')}` : '',
              l.vatNote && !exVat ? term(l.vatNote, lang) : '',
            ]
              .filter(Boolean)
              .join(', ')}
          </div>
        )}
      </div>
      {keyFacts.some(([, , v]) => v) && (
        <dl className="m-0 grid grid-cols-2 gap-4 border-t pt-5 min-[561px]:max-[860px]:col-span-2 min-[561px]:max-[860px]:grid-cols-3">
          {keyFacts.map(([Icon, label, value, wide]) =>
            value ? (
              <div
                key={label}
                className={cn(
                  'grid grid-cols-[18px_minmax(0,1fr)] content-start gap-x-2.5',
                  wide && 'col-span-full',
                )}
              >
                <Icon
                  aria-hidden="true"
                  className="row-span-2 mt-px size-[18px] text-muted-foreground"
                />
                <dt className="text-xs leading-[1.35] text-muted-foreground">
                  {label}
                </dt>
                <dd className="m-0 text-sm leading-[1.4] font-medium [overflow-wrap:anywhere]">
                  {value}
                </dd>
              </div>
            ) : null,
          )}
        </dl>
      )}
      <div className="flex flex-col gap-2 min-[561px]:max-[860px]:col-span-2 min-[561px]:max-[860px]:flex-row min-[561px]:max-[860px]:items-center min-[561px]:max-[860px]:[&>*]:flex-1">
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              buttonVariants(),
              'h-11 w-full text-[14.5px] text-primary-foreground no-underline',
            )}
          >
            <ArrowSquareOutIcon aria-hidden="true" />
            <span>{t('openOriginal')}</span>
          </a>
        )}
        {isUnmapped(l) ? (
          <span
            title={t('onlyUnmappedTitle')}
            className="inline-flex h-7 items-center gap-1.5 self-center rounded-full bg-muted px-3 text-[12.5px] font-medium text-foreground-2 shadow-[inset_0_0_0_1px_var(--border)]"
          >
            <GpsSlashIcon
              aria-hidden="true"
              className="size-3.5 text-muted-foreground"
            />
            {t('notOnMap')}
          </span>
        ) : (
          <Button
            variant="outline"
            className="h-11 w-full text-[14.5px]"
            onClick={() => onShowOnMap(l)}
          >
            <MapPinIcon aria-hidden="true" />
            <span>{t('showOnMap')}</span>
          </Button>
        )}
      </div>
      {details === undefined ? (
        <Skeleton className="h-16 w-full rounded-[10px]" />
      ) : agency?.name || l.detailsFetchedAt || broker || phone ? (
        <div className={block}>
          <h3 className="m-0 mb-1.5 text-[13.5px] font-semibold">
            {t('contact')}
          </h3>
          {agency?.name ? (
            <>
              <div className="font-semibold [overflow-wrap:anywhere]">
                {agencyUrl ? (
                  <a
                    href={agencyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-inherit underline decoration-border-strong underline-offset-[3px] hover:decoration-current"
                  >
                    {agency.name}
                  </a>
                ) : (
                  agency.name
                )}
              </div>
              {agency.address && (
                <div lang="bg" className="text-[12.5px] text-muted-foreground">
                  {agency.address}
                </div>
              )}
            </>
          ) : l.detailsFetchedAt ? (
            <div className="font-semibold">{t('private')}</div>
          ) : null}
          {broker && (
            <div className="mt-1 text-foreground-2">
              <span className="text-muted-foreground">{t('broker')}</span>{' '}
              <span lang="bg">{broker}</span>
            </div>
          )}
          {phone && (
            <a
              href={`tel:${phone.replace(/[^\d+]/g, '')}`}
              className="mt-2.5 inline-flex h-[34px] items-center gap-2 self-start rounded-full bg-muted pr-3.5 pl-3 font-medium text-foreground tabular no-underline transition-colors hover:bg-surface-3"
            >
              <PhoneIcon
                aria-hidden="true"
                className="size-4 text-foreground-2"
              />
              <span>{phone}</span>
            </a>
          )}
        </div>
      ) : null}
      <dl className="m-0 flex flex-col gap-[5px] border-t pt-[18px] text-[12.5px] min-[561px]:max-[860px]:col-span-2">
        {meta.map(([label, value]) =>
          value ? (
            <div key={label} className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="m-0 text-right [overflow-wrap:anywhere] text-foreground-2 tabular">
                {value}
              </dd>
            </div>
          ) : null,
        )}
      </dl>
    </div>
  )
}

function Description({ l, text }: { l: Listing; text: string | null }) {
  const { t, lang } = useApp()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  if (!text) return null
  const lines = text
    .split('\n')
    .reduce((n, p) => n + Math.max(1, Math.ceil(p.length / 90)), 0)
  const long = lines > 14
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="m-0 text-[17px] font-semibold tracking-[-0.015em]">
          {t('description')}
        </h3>
        {lang === 'en' && (
          <span className="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
            <TranslateIcon aria-hidden="true" className="size-3.5" />
            {t('descriptionOriginal')}
          </span>
        )}
      </div>
      <div
        id="descText"
        ref={box}
        className={cn(
          'text-[14.5px] leading-[1.7]',
          long &&
            !open &&
            'max-h-[17em] overflow-hidden [mask-image:linear-gradient(#000_calc(100%-5em),transparent)]',
        )}
      >
        <p
          lang="bg"
          className="m-0 max-w-[70ch] [overflow-wrap:anywhere] whitespace-pre-line text-foreground-2"
        >
          {text}
        </p>
      </div>
      {long && (
        <Button
          variant="link"
          className="mt-2.5 gap-1 p-0 font-semibold"
          aria-expanded={open}
          aria-controls="descText"
          onClick={() => {
            setOpen(!open)
            if (open) box.current?.scrollIntoView({ block: 'nearest' })
          }}
        >
          <span>{t(open ? 'descLess' : 'descMore')}</span>
          {open ? (
            <CaretUpIcon aria-hidden="true" className="size-3.5" />
          ) : (
            <CaretDownIcon aria-hidden="true" className="size-3.5" />
          )}
        </Button>
      )}
      {!l.descriptionFull && (
        <p className="mt-4 mb-0 flex max-w-[70ch] items-start gap-2 rounded-[10px] bg-muted px-3 py-2.5 text-[12.5px] text-foreground-2">
          <InfoIcon
            aria-hidden="true"
            className="mt-px size-4 flex-none text-muted-foreground"
          />
          <span>{t('descriptionSnippet')}</span>
        </p>
      )}
    </section>
  )
}

function PriceHistory({ l }: { l: Listing }) {
  const { t, fmt } = useApp()
  const hist = l.priceHistory
  if (hist.length < 2) return null
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="m-0 text-[17px] font-semibold tracking-[-0.015em]">
          {t('priceHistory')}
        </h3>
        <span className="text-[12.5px] text-muted-foreground">
          {t('priceHistoryHint')}
        </span>
      </div>
      <ol className="m-0 max-w-[440px] list-none p-0 text-[13.5px] tabular">
        {hist
          .map((h, k) => {
            const prev = hist[k - 1] as (typeof hist)[number] | undefined
            const d =
              prev && (h.currency || 'EUR') === (prev.currency || 'EUR')
                ? h.price - prev.price
                : 0
            return (
              <li
                key={h.at}
                className="grid grid-cols-[minmax(0,1fr)_auto_7.5em] gap-4 py-1.5"
              >
                <span className="text-muted-foreground">{fmt.date(h.at)}</span>
                <span className="text-right font-semibold">
                  {fmt.money(h.price, h.currency)}
                </span>
                <span
                  className={cn(
                    'inline-flex items-center justify-end gap-1 text-[12.5px] font-medium',
                    d < 0 && 'text-good',
                    d > 0 && 'text-destructive',
                  )}
                >
                  {d ? (
                    <>
                      {d < 0 ? (
                        <TrendDownIcon aria-hidden="true" />
                      ) : (
                        <TrendUpIcon aria-hidden="true" />
                      )}
                      {fmt.delta(d, h.currency)}
                    </>
                  ) : null}
                </span>
              </li>
            )
          })
          .reverse()}
      </ol>
    </section>
  )
}
