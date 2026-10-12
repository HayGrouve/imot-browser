import { useEffect, useRef } from 'react'
import {
  ArrowSquareOutIcon,
  ArrowsDownUpIcon,
  CalendarBlankIcon,
  CaretDownIcon,
  EyeIcon,
  EyeSlashIcon,
  FunnelSimpleIcon,
  HouseSimpleIcon,
  ImageIcon,
  ListMagnifyingGlassIcon,
  RulerIcon,
  StairsIcon,
  StarIcon,
  TreeIcon,
  TrendDownIcon,
  TrendUpIcon,
  WarningIcon,
} from '@phosphor-icons/react'
import { Button } from '#/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '#/components/ui/empty'
import { cn } from '#/lib/utils'
import { useApp } from './app-context'
import { SORTS, isUnmapped } from '#/lib/listings'
import type { Listing, Sort } from '#/lib/listings'
import {
  KIND_EN,
  floorText,
  hoodName,
  listingPlace,
  oblastLabel,
  placeName,
  yearText,
} from '#/lib/labels'
import { dealLabel, typeLabel } from '../../shared/vocab'
import { safeUrl, thumbFor } from '#/lib/urls'

export const PAGE = 50 // rows added each time the list grows

export function ResultBar({
  total,
  shown,
  onlyHidden,
  sort,
  onSort,
}: {
  total: number
  shown: number
  onlyHidden: boolean
  sort: Sort
  onSort: (s: Sort) => void
}) {
  const { t, fmt } = useApp()
  if (!total) return null
  return (
    <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-1.5 max-[720px]:px-4 max-[720px]:pt-3.5 max-[720px]:pb-1">
      <h2
        aria-live="polite"
        className="m-0 text-[15px] font-semibold tracking-[-0.01em] tabular"
      >
        {shown === total ? (
          t(onlyHidden ? 'hiddenCount' : 'listingsCount', {
            n: fmt.num(total),
          })
        ) : (
          <>
            {fmt.num(shown)}{' '}
            <span className="font-[450] text-muted-foreground">
              {t(onlyHidden ? 'countOfHidden' : 'countOf', {
                total: fmt.num(total),
              })}
            </span>
          </>
        )}
      </h2>
      <label className="relative inline-flex h-[34px] cursor-pointer items-center gap-1.5 rounded-full pr-2.5 pl-3 text-foreground-2 hover:bg-muted has-[select:focus-visible]:ring-2 has-[select:focus-visible]:ring-ring">
        <span className="sr-only">{t('sortLabel')}</span>
        <ArrowsDownUpIcon aria-hidden="true" className="size-4" />
        <select
          value={`${sort.key}:${sort.dir}`}
          onChange={(e) => {
            const [key, dir] = e.target.value.split(':')
            onSort({
              key: key as Sort['key'],
              dir: Number(dir) === -1 ? -1 : 1,
            })
          }}
          className="[field-sizing:content] h-full cursor-pointer appearance-none rounded-none border-0 bg-transparent pr-[18px] text-[13.5px] font-medium text-foreground outline-none"
        >
          {SORTS.map(([k, d, label]) => (
            <option key={`${k}:${d}`} value={`${k}:${d}`}>
              {t(label)}
            </option>
          ))}
        </select>
        <CaretDownIcon
          aria-hidden="true"
          className="pointer-events-none absolute right-2.5 size-3.5 text-muted-foreground"
        />
      </label>
    </div>
  )
}

function Tag({
  kind,
  children,
  title,
}: {
  kind: 'new' | 'stale' | 'nomap' | 'vat'
  children: React.ReactNode
  title?: string
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex h-5 flex-none items-center rounded-full px-2 text-[11.5px] font-semibold whitespace-nowrap',
        kind === 'new' && 'bg-primary text-primary-foreground',
        kind === 'stale' && 'bg-warn text-warn-foreground',
        (kind === 'nomap' || kind === 'vat') &&
          'bg-muted text-foreground-2 shadow-[inset_0_0_0_1px_var(--border)]',
        kind === 'vat' && 'mt-[3px] h-[18px] px-1.5 text-[11px]',
      )}
    >
      {children}
    </span>
  )
}

export { Tag }

export function PriceTrend({
  trend,
  className,
}: {
  trend: string | null | undefined
  className?: string
}) {
  const { t } = useApp()
  if (trend !== 'down' && trend !== 'up') return null
  const label = t(trend === 'down' ? 'priceDown' : 'priceUp')
  const Icon = trend === 'down' ? TrendDownIcon : TrendUpIcon
  return (
    <span
      title={label}
      className={cn(
        'inline-flex',
        trend === 'down' ? 'text-good' : 'text-destructive',
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-[1em]" />
      <span className="sr-only">{label}</span>
    </span>
  )
}

function Row({
  l,
  multiDeal,
  starred,
  hidden,
  onOpen,
  onStar,
  onHide,
  onHover,
}: {
  l: Listing
  multiDeal: boolean
  starred: boolean
  hidden: boolean
  onOpen: (id: string) => void
  onStar: (id: string) => void
  onHide: (id: string, row: HTMLElement) => void
  onHover: (id: string, on: boolean) => void
}) {
  const { t, fmt, lang } = useApp()
  const thumb = thumbFor(l)
  const url = safeUrl(l.url)
  const viaHood = l.place?.via === 'neighborhood'
  const hood = l.nbhd?.name || l.neighborhood
  const where = [
    !viaHood && hood ? hoodName(hood, lang) : null,
    l.place?.municipality && l.place.name !== l.settlement
      ? placeName(l.settlement, l.settlementKind, lang)
      : null,
    !l.neighborhood && l.place?.kind && lang === 'en'
      ? KIND_EN[l.place.kind]
      : null,
    oblastLabel(l.oblast, lang),
  ]
    .filter(Boolean)
    .join(', ')
  const what =
    typeLabel(l.type ?? 'other', l.typeBg, lang, true) +
    (multiDeal && l.deal ? `, ${dealLabel(l.deal, lang).toLowerCase()}` : '')
  const price =
    l.price != null
      ? fmt.money(l.price, l.currency)
      : l.priceOnRequest
        ? t('priceOnRequest')
        : ''
  const floor = floorText(l, lang)
  const year = yearText(l)
  const fact = (
    cls: string,
    Icon: typeof RulerIcon,
    label: string | null,
    value: string,
  ) =>
    value ? (
      <span
        className={cn(
          'inline-flex items-center gap-[5px] whitespace-nowrap',
          cls,
        )}
      >
        <Icon
          aria-hidden="true"
          className="size-[15px] text-muted-foreground"
        />
        {label && <span className="sr-only">{label}: </span>}
        {value}
      </span>
    ) : null
  const starLabel = t(starred ? 'unstar' : 'star')
  const hideLabel = t(hidden ? 'unhide' : 'hide')
  const HideIcon = hidden ? EyeIcon : EyeSlashIcon
  return (
    <li
      className={cn(
        'group/row relative grid cursor-pointer grid-cols-[136px_minmax(0,1fr)_auto] items-stretch gap-4 rounded-2xl p-3 transition-colors hover:bg-muted',
        "before:absolute before:top-0 before:right-3 before:left-[164px] before:border-t before:border-border before:content-[''] first:before:hidden hover:before:border-transparent [li:hover+&]:before:border-transparent",
        'has-[.row-open:focus-visible]:bg-muted has-[.row-open:focus-visible]:shadow-[inset_0_0_0_2px_var(--ring)]',
        '@max-[560px]:grid-cols-[104px_minmax(0,1fr)_auto] @max-[560px]:gap-3 @max-[560px]:p-2.5 @max-[560px]:before:left-[126px]',
        '@max-[420px]:grid-cols-[88px_minmax(0,1fr)] @max-[420px]:before:left-[110px]',
      )}
      onMouseEnter={() => onHover(l.id, true)}
      onMouseLeave={() => onHover(l.id, false)}
      onFocus={() => onHover(l.id, true)}
      onBlur={() => onHover(l.id, false)}
    >
      <div
        className={cn(
          'grid aspect-[4/3] w-[136px] place-items-center overflow-hidden rounded-[10px] bg-muted text-2xl text-muted-foreground @max-[560px]:w-[104px] @max-[420px]:w-[88px]',
          l.stale && '[&_img]:opacity-55',
        )}
      >
        {thumb ? (
          <img
            loading="lazy"
            src={thumb}
            alt=""
            width={136}
            height={102}
            className="block size-full object-cover transition-transform duration-400 ease-out-soft group-hover/row:scale-[1.03]"
          />
        ) : (
          <ImageIcon aria-hidden="true" />
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-[3px] pt-px">
        <div
          className={cn(
            'flex min-w-0 items-center gap-2 text-[15px] font-semibold tracking-[-0.01em]',
            l.stale && 'opacity-55',
          )}
        >
          <button
            type="button"
            className="row-open min-w-0 cursor-pointer overflow-hidden rounded text-left outline-none after:absolute after:inset-0 after:rounded-2xl after:content-['']"
            onClick={() => onOpen(l.id)}
          >
            <span className="block truncate">
              {listingPlace(l, lang) || what}
            </span>
          </button>
          {l.fresh && <Tag kind="new">{t('badgeNew')}</Tag>}
          {l.stale && <Tag kind="stale">{t('badgeStaleShort')}</Tag>}
          {isUnmapped(l) && <Tag kind="nomap">{t('notOnMap')}</Tag>}
        </div>
        <div className="truncate text-[13px] text-muted-foreground">
          {what}
          {where ? ` · ${where}` : ''}
        </div>
        <div className="mt-auto flex flex-wrap gap-x-3.5 gap-y-1 pt-1.5 text-[13px] text-foreground-2 tabular">
          {fact(
            '',
            RulerIcon,
            t('factArea'),
            l.area ? `${fmt.num(l.area)} ${t('sqm')}` : '',
          )}
          {fact(
            '',
            TreeIcon,
            null,
            l.yard ? t('yardFact', { v: fmt.num(l.yard) }) : '',
          )}
          {fact(
            '@max-[560px]:hidden',
            StairsIcon,
            null,
            floor ? t('floorFact', { v: floor }) : '',
          )}
          {fact(
            '@max-[560px]:hidden',
            CalendarBlankIcon,
            lang === 'bg' ? t('colYear') : null,
            year ? t('builtFact', { v: year }) : '',
          )}
        </div>
      </div>
      <div className="flex min-w-[104px] flex-col items-end justify-between gap-2 @max-[420px]:col-start-2 @max-[420px]:min-w-0 @max-[420px]:flex-row-reverse @max-[420px]:items-center">
        <div className="relative z-[1] -mt-1.5 -mr-1.5 flex gap-0.5 @max-[420px]:m-0 @max-[420px]:-mr-1.5">
          {url && (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              title={t('openOriginal')}
              aria-label={t('openOriginal')}
              className="grid size-[34px] place-items-center rounded-full text-muted-foreground opacity-0 transition-[background-color,color,opacity] group-focus-within/row:opacity-100 group-hover/row:opacity-100 hover:bg-surface-3 hover:text-foreground [@media(hover:none)]:opacity-100"
            >
              <ArrowSquareOutIcon aria-hidden="true" className="size-[18px]" />
            </a>
          )}
          <button
            type="button"
            aria-pressed={hidden}
            title={hideLabel}
            aria-label={hideLabel}
            onClick={(e) => {
              const row = e.currentTarget.closest('li')
              if (row) onHide(l.id, row)
            }}
            className={cn(
              'grid size-[34px] cursor-pointer place-items-center rounded-full text-muted-foreground transition-[background-color,color,opacity,transform] hover:bg-surface-3 hover:text-foreground active:scale-90',
              !hidden &&
                'opacity-0 group-focus-within/row:opacity-100 group-hover/row:opacity-100 [@media(hover:none)]:opacity-100',
            )}
          >
            <HideIcon aria-hidden="true" className="size-[18px]" />
          </button>
          <button
            type="button"
            aria-pressed={starred}
            title={starLabel}
            aria-label={starLabel}
            onClick={() => onStar(l.id)}
            className={cn(
              'grid size-[34px] cursor-pointer place-items-center rounded-full text-muted-foreground transition-[background-color,color,transform] hover:bg-surface-3 hover:text-foreground active:scale-90',
              starred && 'text-star hover:text-star',
            )}
          >
            <StarIcon
              aria-hidden="true"
              weight={starred ? 'fill' : 'regular'}
              className="size-[18px]"
            />
          </button>
        </div>
        <div
          className={cn(
            'text-right tabular @max-[420px]:mr-auto @max-[420px]:flex @max-[420px]:items-baseline @max-[420px]:gap-2 @max-[420px]:text-left',
            l.stale && 'opacity-55',
          )}
        >
          <div className="inline-flex items-center gap-1 text-base font-[650] tracking-[-0.01em] whitespace-nowrap">
            <PriceTrend trend={l.priceTrend} className="text-[15px]" />
            {price}
          </div>
          {l.ppm ? (
            <div className="text-[12.5px] whitespace-nowrap text-muted-foreground">
              {fmt.money(l.ppm)}/{t('sqm')}
            </div>
          ) : null}
          {l.vatNote === 'Цената е без ДДС' && (
            <Tag kind="vat" title={t('exVatTitle')}>
              {t('exVat')}
            </Tag>
          )}
        </div>
      </div>
    </li>
  )
}

export function ResultList({
  rows,
  total,
  limit,
  onMore,
  multiDeal,
  onOpen,
  onHover,
  scrollRoot,
}: {
  rows: Array<Listing>
  total: number
  limit: number
  onMore: () => void
  multiDeal: boolean
  onOpen: (id: string) => void
  onHover: (id: string, on: boolean) => void
  scrollRoot: React.RefObject<HTMLDivElement | null>
}) {
  const { t, fmt, stars, toggleStar, hidden, toggleHidden } = useApp()
  const more = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLOListElement>(null)
  const shown = Math.min(limit, total)

  // Grow the list as its end scrolls into view; the button stays as a fallback.
  useEffect(() => {
    const el = more.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((x) => x.isIntersecting)) onMore()
      },
      { root: scrollRoot.current, rootMargin: '600px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [onMore, scrollRoot, shown])

  // The row leaves the list: keep the keyboard on the one that takes its place.
  const onHide = (id: string, row: HTMLElement) => {
    const open = (el: Element | null) =>
      el?.querySelector<HTMLButtonElement>('.row-open')
    const next =
      open(row.nextElementSibling) ?? open(row.previousElementSibling)
    const hadFocus = row.contains(document.activeElement)
    onHover(id, false)
    toggleHidden(id)
    if (hadFocus) requestAnimationFrame(() => next?.focus())
  }

  return (
    <>
      <ol ref={list} className="m-0 list-none px-2 pt-1 pb-2 max-[720px]:px-1">
        {rows.slice(0, limit).map((l) => (
          <Row
            key={l.id}
            l={l}
            multiDeal={multiDeal}
            starred={stars.has(l.id)}
            hidden={hidden.has(l.id)}
            onOpen={onOpen}
            onStar={toggleStar}
            onHide={onHide}
            onHover={onHover}
          />
        ))}
      </ol>
      <div
        ref={more}
        className="flex flex-col items-center gap-2.5 px-5 pt-2 pb-8 text-[13px] text-muted-foreground empty:hidden max-[1000px]:pb-24"
      >
        {total > shown && (
          <>
            <span>
              {t('shownOf', { shown: fmt.num(shown), total: fmt.num(total) })}
            </span>
            <Button
              variant="outline"
              onClick={() => {
                onMore()
                requestAnimationFrame(() =>
                  list.current
                    ?.querySelectorAll<HTMLButtonElement>('.row-open')
                    [shown]?.focus(),
                )
              }}
            >
              {t('showMore', { n: fmt.num(Math.min(PAGE, total - shown)) })}
            </Button>
          </>
        )}
      </div>
    </>
  )
}

export function ListSkeleton() {
  return (
    <ol className="m-0 list-none px-2 pt-1 pb-2" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <li key={i} className="grid grid-cols-[136px_minmax(0,1fr)] gap-4 p-3">
          <div className="aspect-[4/3] animate-pulse rounded-[10px] bg-muted" />
          <div className="flex flex-col gap-2 pt-1">
            <span className="h-4 w-2/5 animate-pulse rounded-[10px] bg-muted" />
            <span className="h-3 w-3/5 animate-pulse rounded-[10px] bg-muted" />
            <span className="mt-auto h-3 w-3/4 animate-pulse rounded-[10px] bg-muted" />
          </div>
        </li>
      ))}
    </ol>
  )
}

export function EmptyState({
  kind,
  message,
  onSearch,
  onClear,
}: {
  kind: 'error' | 'none' | 'filtered'
  message?: string
  onSearch: () => void
  onClear: () => void
}) {
  const { t } = useApp()
  const [Icon, title, body] =
    kind === 'error'
      ? [WarningIcon, t('loadErrorTitle'), t('loadErrorBody', { message })]
      : kind === 'none'
        ? [HouseSimpleIcon, t('emptyTitle'), t('emptyBody')]
        : [FunnelSimpleIcon, t('emptyFilteredTitle'), t('emptyFilteredBody')]
  return (
    <Empty className="border-0 px-6 pt-14 pb-16 max-[1000px]:pb-24">
      <EmptyHeader>
        <EmptyMedia className="mb-2.5 size-14 rounded-full bg-muted text-[26px] text-muted-foreground">
          <Icon
            aria-hidden="true"
            weight={kind === 'none' ? 'fill' : 'regular'}
          />
        </EmptyMedia>
        <EmptyTitle className="text-base font-semibold tracking-[-0.01em]">
          {title}
        </EmptyTitle>
        <EmptyDescription className="max-w-[40ch]">{body}</EmptyDescription>
      </EmptyHeader>
      {kind !== 'error' && (
        <EmptyContent className="flex-row flex-wrap justify-center">
          {kind === 'none' ? (
            <Button onClick={onSearch}>
              <ListMagnifyingGlassIcon aria-hidden="true" />
              {t('searchImot')}
            </Button>
          ) : (
            <Button variant="outline" onClick={onClear}>
              {t('clearAll')}
            </Button>
          )}
        </EmptyContent>
      )}
    </Empty>
  )
}
