import { memo, useMemo, useRef, useState } from 'react'
import {
  CaretDownIcon,
  CheckIcon,
  MagnifyingGlassIcon,
  PolygonIcon,
  StarIcon,
  XIcon,
} from '@phosphor-icons/react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '#/components/ui/popover'
import { Button } from '#/components/ui/button'
import { Switch } from '#/components/ui/switch'
import { NativeSelect, NativeSelectOption } from '#/components/ui/native-select'
import { cn } from '#/lib/utils'
import { useApp } from './app-context'
import { NumberField } from './number-field'
import {
  DEFAULT_FILTERS,
  PILLS,
  TYPE_ORDER,
  anyFilter,
  countBy,
  isUnmapped,
  matchesPlace,
  typeValue,
} from '#/lib/listings'
import type { Filters, Listing, PillKey } from '#/lib/listings'
import { hoodName, listingPlace, oblastLabel, KIND_EN } from '#/lib/labels'
import { searchKey, transliterate } from '../../shared/text'
import { translate } from '#/lib/i18n'
import { dealLabel, typeLabel } from '../../shared/vocab'
import type { Lang } from '../../shared/vocab'

const typeName = (v: string, lang: Lang) =>
  v.startsWith('other:') ? v.slice(6) : typeLabel(v, '', lang)

/** Place labels that stay unique when two settlements share a name (a town and a village). */
function usePlaceLabels(all: Array<Listing>, lang: Lang) {
  return useMemo(() => {
    const keysByLabel = new Map<string, Set<string>>()
    for (const l of all) {
      if (!l.place) continue
      const label = listingPlace(l, lang)
      const set = keysByLabel.get(label) ?? new Set<string>()
      set.add(l.place.key)
      keysByLabel.set(label, set)
    }
    const dup = new Set(
      [...keysByLabel]
        .filter(([, keys]) => keys.size > 1)
        .map(([label]) => label),
    )
    return (l: Listing) => {
      const label = listingPlace(l, lang)
      if (!dup.has(label) || !l.place) return label
      const extra = lang === 'en' && l.place.kind ? KIND_EN[l.place.kind] : null
      const muni =
        l.place.municipality && l.place.municipality !== l.place.name
          ? translate(lang, 'municipalityShort', {
              name:
                lang === 'bg'
                  ? l.place.municipality
                  : transliterate(l.place.municipality),
            })
          : null
      return `${label} (${[extra, muni || oblastLabel(l.oblast, lang)].filter(Boolean).join(', ')})`
    }
  }, [all, lang])
}

/** Memoised: a star changes its star count, and the rest of the bar stays as it was. */
export const FilterBar = memo(function FilterBar({
  all,
  pool,
  filters,
  onChange,
  starCount,
  hiddenCount,
}: {
  all: Array<Listing>
  /** What the filters pick from (all but the hidden ones, or only those): the counts. */
  pool: Array<Listing>
  filters: Filters
  onChange: (patch: Partial<Filters>) => void
  starCount: number
  hiddenCount: number
}) {
  const { t, fmt, lang } = useApp()
  const [open, setOpen] = useState<PillKey | null>(null)
  const uniqueLabel = usePlaceLabels(all, lang)
  const f = filters

  const placeFilterLabel = (key: string) => {
    const l = all.find((x) => matchesPlace(x, key))
    if (!l) return key
    return key.startsWith('nb:') && l.nbhd
      ? `${hoodName(l.nbhd.name, lang)}, ${listingPlace(l, lang)}`
      : uniqueLabel(l)
  }

  const rangeLabel = (
    lo: number | null,
    hi: number | null,
    show: (v: number) => string,
  ) => {
    if (lo != null && hi != null) return `${show(lo)}-${show(hi)}`
    if (lo != null) return `${show(lo)}+`
    if (hi != null) return t('upTo', { v: show(hi) })
    return ''
  }

  const moreOptions = useMemo(() => {
    const nNew = pool.filter((l) => l.fresh).length
    const nStale = pool.filter((l) => l.stale).length
    const nUnmapped = pool.filter(isUnmapped).length
    return [
      {
        key: 'onlyNew' as const,
        label: t('onlyNew'),
        hint: t('onlyNewHint'),
        n: nNew,
        show: nNew > 0 || f.onlyNew,
      },
      {
        key: 'hideStale' as const,
        label: t('hideStale'),
        hint: t('hideStaleHint'),
        n: nStale,
        show: nStale > 0 || f.hideStale,
      },
      {
        key: 'unmapped' as const,
        label: t('onlyUnmapped'),
        hint: t('onlyUnmappedTitle'),
        n: nUnmapped,
        show: nUnmapped > 0 || f.unmapped,
      },
      {
        key: 'hidden' as const,
        label: t('onlyHidden'),
        hint: t('onlyHiddenHint'),
        n: hiddenCount,
        show: hiddenCount > 0 || f.hidden,
      },
    ].filter((o) => o.show)
  }, [pool, hiddenCount, f.onlyNew, f.hideStale, f.unmapped, f.hidden, t])

  const pillState = (
    key: PillKey,
  ): { active: boolean; label: string; n?: number } => {
    switch (key) {
      case 'type': {
        const parts = [
          f.type ? typeName(f.type, lang) : null,
          f.deal ? dealLabel(f.deal, lang) : null,
        ].filter(Boolean)
        return {
          active: parts.length > 0,
          label: parts.join(', ') || t('pillType'),
        }
      }
      case 'location':
        if (f.place) return { active: true, label: placeFilterLabel(f.place) }
        if (f.oblast)
          return { active: true, label: oblastLabel(f.oblast, lang) }
        return { active: false, label: t('pillLocation') }
      case 'price': {
        const label = rangeLabel(f.priceMin, f.priceMax, fmt.shortMoney)
        return { active: !!label, label: label || t('pillPrice') }
      }
      case 'size': {
        const area = rangeLabel(f.areaMin, f.areaMax, (v) => fmt.num(v))
        const parts = [
          area ? `${area} ${t('sqm')}` : null,
          f.yardMin != null ? t('yardShort', { v: fmt.num(f.yardMin) }) : null,
        ].filter(Boolean)
        return {
          active: parts.length > 0,
          label: parts.join(', ') || t('pillSize'),
        }
      }
      default: {
        const n = PILLS.more.filter((k) => f[k]).length
        return { active: n > 0, label: t('pillMore'), n }
      }
    }
  }

  const pillVisible = (key: PillKey) => {
    if (pillState(key).active) return true
    if (key === 'type')
      return (
        countBy(pool, typeValue).size > 1 ||
        countBy(pool, (l) => l.deal).size > 1
      )
    if (key === 'location')
      return new Set(pool.map((l) => l.place?.key).filter(Boolean)).size > 1
    if (key === 'more') return moreOptions.length > 0
    return pool.length > 0
  }

  const clearPill = (key: PillKey) => {
    const patch: Partial<Filters> = {}
    for (const k of PILLS[key])
      Object.assign(patch, { [k]: DEFAULT_FILTERS[k] })
    onChange(patch)
  }

  const keys = (Object.keys(PILLS) as Array<PillKey>).filter(pillVisible)
  const showStars = starCount > 0 || f.starred
  const showClear = anyFilter(f)
  if (!keys.length && !showStars && !showClear) return null

  return (
    <div
      className="flex flex-wrap items-center gap-2 max-[720px]:[scrollbar-width:none] max-[720px]:flex-nowrap max-[720px]:overflow-x-auto max-[720px]:px-3 @max-[640px]:gap-1.5"
      role="group"
      aria-label={t('filters')}
    >
      {/* First: it was set on the map, so say so where a phone shows it. */}
      {f.drawnArea && (
        <span className="inline-flex h-9 flex-none items-center rounded-full border border-foreground bg-muted shadow-[inset_0_0_0_1px_var(--foreground)]">
          <span className="inline-flex items-center gap-1.5 pr-1 pl-3.5 text-[13.5px] font-semibold whitespace-nowrap @max-[640px]:pl-[11px] @max-[640px]:text-[13px]">
            <PolygonIcon aria-hidden="true" className="size-[15px]" />
            {t('drawnArea')}
          </span>
          <button
            type="button"
            className="inline-flex h-full cursor-pointer items-center rounded-full pr-2.5 pl-1.5 text-foreground-2 hover:text-foreground"
            title={t('clearDrawnArea')}
            aria-label={t('clearDrawnArea')}
            onClick={() => onChange({ drawnArea: null })}
          >
            <XIcon aria-hidden="true" className="size-[15px]" />
          </button>
        </span>
      )}
      {keys.map((key) => {
        const s = pillState(key)
        return (
          <span
            key={key}
            className={cn(
              'inline-flex h-9 flex-none items-center rounded-full border border-border-strong bg-background transition-[border-color,background-color,box-shadow] hover:border-foreground-2',
              s.active &&
                'border-foreground bg-muted shadow-[inset_0_0_0_1px_var(--foreground)]',
            )}
          >
            <Popover
              open={open === key}
              onOpenChange={(o) => setOpen(o ? key : null)}
            >
              <PopoverTrigger
                className={cn(
                  'inline-flex h-full cursor-pointer items-center gap-1.5 rounded-full px-3.5 text-[13.5px] font-medium whitespace-nowrap @max-[640px]:px-[11px] @max-[640px]:text-[13px]',
                  s.active && 'pr-1 font-semibold',
                )}
              >
                <span>{s.label}</span>
                {s.n ? (
                  <span className="inline-grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1.5 text-[11.5px] font-semibold text-primary-foreground tabular">
                    {fmt.num(s.n)}
                  </span>
                ) : null}
                {!s.active && (
                  <CaretDownIcon
                    aria-hidden="true"
                    className={cn(
                      'size-[15px] text-muted-foreground transition-transform',
                      open === key && 'rotate-180',
                    )}
                  />
                )}
              </PopoverTrigger>
              <PopoverContent
                align="start"
                sideOffset={8}
                aria-label={t(`pill${key[0].toUpperCase()}${key.slice(1)}`)}
                className="w-[340px] max-w-[calc(100vw-24px)] gap-0 overflow-hidden rounded-2xl p-0 shadow-[var(--shadow-float)]"
              >
                <PopBody
                  pill={key}
                  all={pool}
                  filters={f}
                  onChange={onChange}
                  onClose={() => setOpen(null)}
                  onClear={() => clearPill(key)}
                  uniqueLabel={uniqueLabel}
                  placeFilterLabel={placeFilterLabel}
                  moreOptions={moreOptions}
                />
              </PopoverContent>
            </Popover>
            {s.active && (
              <button
                type="button"
                className="inline-flex h-full cursor-pointer items-center rounded-full pr-2.5 pl-1.5 text-foreground-2 hover:text-foreground"
                title={t('clearFilter')}
                aria-label={`${t('clearFilter')}: ${s.label}`}
                onClick={() => clearPill(key)}
              >
                <XIcon aria-hidden="true" className="size-[15px]" />
              </button>
            )}
          </span>
        )
      })}
      {showStars && (
        <button
          type="button"
          aria-pressed={f.starred}
          onClick={() => onChange({ starred: !f.starred })}
          className={cn(
            'inline-flex h-9 flex-none cursor-pointer items-center gap-1.5 rounded-full border border-border-strong bg-background px-3.5 text-[13.5px] font-medium whitespace-nowrap hover:border-foreground-2',
            f.starred &&
              'border-foreground bg-muted font-semibold shadow-[inset_0_0_0_1px_var(--foreground)]',
          )}
        >
          <StarIcon
            aria-hidden="true"
            weight={f.starred ? 'fill' : 'regular'}
            className={cn('size-[15px]', f.starred && 'text-star')}
          />
          <span>{t('pillStarred')}</span>
          <span className="font-medium text-muted-foreground tabular">
            {fmt.num(starCount)}
          </span>
        </button>
      )}
      {showClear && (
        <Button
          variant="link"
          className="ml-1 text-[13.5px]"
          onClick={() => onChange({ ...DEFAULT_FILTERS, q: f.q })}
        >
          {t('clearAll')}
        </Button>
      )}
    </div>
  )
})

function OptRow({
  label,
  n,
  on,
  onPick,
}: {
  label: string
  n?: number | null
  on: boolean
  onPick: () => void
}) {
  const { fmt } = useApp()
  return (
    <li>
      <button
        type="button"
        aria-pressed={on}
        onClick={onPick}
        className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-[10px] px-2.5 py-2 text-left outline-none hover:bg-muted focus-visible:bg-muted aria-pressed:font-semibold"
      >
        <span className="inline-flex min-w-0 items-center gap-2">
          {on ? (
            <CheckIcon
              aria-hidden="true"
              className="-ml-0.5 size-4 flex-none"
            />
          ) : (
            <span className="w-4 flex-none" />
          )}
          <span>{label}</span>
        </span>
        {n != null && (
          <span className="text-[12.5px] font-normal text-muted-foreground tabular">
            {fmt.num(n)}
          </span>
        )}
      </button>
    </li>
  )
}

function PopFoot({
  onClear,
  onDone,
}: {
  onClear: () => void
  onDone: () => void
}) {
  const { t } = useApp()
  return (
    <div className="mt-3 flex items-center justify-between gap-2 border-t px-[18px] pt-3 pb-3.5">
      <Button variant="link" onClick={onClear}>
        {t('clear')}
      </Button>
      <Button size="sm" onClick={onDone}>
        {t('done')}
      </Button>
    </div>
  )
}

const FieldLabel = ({
  children,
  id,
}: {
  children: React.ReactNode
  id?: string
}) => (
  <span id={id} className="text-[13px] font-semibold">
    {children}
  </span>
)

function PopBody({
  pill,
  all,
  filters: f,
  onChange,
  onClose,
  onClear,
  uniqueLabel,
  placeFilterLabel,
  moreOptions,
}: {
  pill: PillKey
  all: Array<Listing>
  filters: Filters
  onChange: (patch: Partial<Filters>) => void
  onClose: () => void
  onClear: () => void
  uniqueLabel: (l: Listing) => string
  placeFilterLabel: (key: string) => string
  moreOptions: Array<{
    key: 'onlyNew' | 'hideStale' | 'unmapped' | 'hidden'
    label: string
    hint: string
    n: number
  }>
}) {
  const { t, fmt, lang } = useApp()
  const body =
    'flex flex-col gap-[18px] overflow-auto px-[18px] pt-[18px] pb-1.5 max-h-[min(440px,calc(100dvh-200px))]'

  if (pill === 'type') {
    const deals = countBy(all, (l) => l.deal)
    const types = [...countBy(all, typeValue)].sort(
      (a, b) => (TYPE_ORDER.get(a[0]) ?? 99) - (TYPE_ORDER.get(b[0]) ?? 99),
    )
    const pick = (patch: Partial<Filters>) => {
      onChange(patch)
      onClose()
    }
    return (
      <div className={body}>
        {(deals.size > 1 || f.deal) && (
          <div className="flex flex-col gap-2">
            <FieldLabel>{t('dealHeading')}</FieldLabel>
            <Segmented
              value={f.deal}
              options={[
                ['', t('anyDeal')],
                ...[...deals.keys()].map((k): [string, string] => [
                  k,
                  dealLabel(k, lang),
                ]),
              ]}
              onChange={(deal) => onChange({ deal })}
            />
          </div>
        )}
        <div className="flex flex-col gap-2">
          <FieldLabel>{t('typeHeading')}</FieldLabel>
          <ul className="-mx-2 flex list-none flex-col p-0">
            <OptRow
              label={t('allTypes')}
              n={all.length}
              on={!f.type}
              onPick={() => pick({ type: '' })}
            />
            {types.map(([k, n]) => (
              <OptRow
                key={k}
                label={typeName(k, lang)}
                n={n}
                on={f.type === k}
                onPick={() => pick({ type: k })}
              />
            ))}
          </ul>
        </div>
      </div>
    )
  }

  if (pill === 'location') {
    return (
      <LocationBody
        all={all}
        filters={f}
        onChange={onChange}
        onClose={onClose}
        uniqueLabel={uniqueLabel}
        placeFilterLabel={placeFilterLabel}
        className={body}
      />
    )
  }

  if (pill === 'price' || pill === 'size') {
    const prices = all.map((l) => l.eur).filter((x): x is number => x != null)
    const num = (
      key: 'priceMin' | 'priceMax' | 'areaMin' | 'areaMax' | 'yardMin',
      label: string,
      suffix: string,
      step: number,
      placeholder = '',
    ) => (
      <NumberField
        label={label}
        suffix={suffix}
        step={step}
        placeholder={placeholder}
        value={f[key]}
        onCommit={(v) => onChange({ [key]: v })}
        onEnter={onClose}
      />
    )
    return (
      <>
        <div className={body}>
          {pill === 'price' ? (
            <div className="flex flex-col gap-2">
              <FieldLabel>{t('priceHeading')}</FieldLabel>
              <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
                {num(
                  'priceMin',
                  t('min'),
                  '€',
                  5000,
                  prices.length ? fmt.num(Math.min(...prices)) : '',
                )}
                <span className="pb-2.5 text-muted-foreground">-</span>
                {num(
                  'priceMax',
                  t('max'),
                  '€',
                  5000,
                  prices.length ? fmt.num(Math.max(...prices)) : '',
                )}
              </div>
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-2">
                <FieldLabel>{t('areaHeading')}</FieldLabel>
                <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
                  {num('areaMin', t('min'), t('sqm'), 10)}
                  <span className="pb-2.5 text-muted-foreground">-</span>
                  {num('areaMax', t('max'), t('sqm'), 10)}
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <FieldLabel>{t('yardHeading')}</FieldLabel>
                {num('yardMin', t('atLeast'), t('sqm'), 100)}
              </div>
            </>
          )}
        </div>
        <PopFoot onClear={onClear} onDone={onClose} />
      </>
    )
  }

  return (
    <>
      <div className={body}>
        {moreOptions.map((o) => (
          <label
            key={o.key}
            className="flex cursor-pointer items-center justify-between gap-4"
          >
            <span className="flex flex-col">
              <span>
                {o.label}{' '}
                <span className="font-medium text-muted-foreground tabular">
                  {fmt.num(o.n)}
                </span>
              </span>
              <span className="text-[12.5px] text-muted-foreground">
                {o.hint}
              </span>
            </span>
            <Switch
              checked={f[o.key]}
              onCheckedChange={(checked) => onChange({ [o.key]: checked })}
            />
          </label>
        ))}
      </div>
      <PopFoot onClear={onClear} onDone={onClose} />
    </>
  )
}

function LocationBody({
  all,
  filters: f,
  onChange,
  onClose,
  uniqueLabel,
  placeFilterLabel,
  className,
}: {
  all: Array<Listing>
  filters: Filters
  onChange: (patch: Partial<Filters>) => void
  onClose: () => void
  uniqueLabel: (l: Listing) => string
  placeFilterLabel: (key: string) => string
  className: string
}) {
  const { t, fmt, lang } = useApp()
  const [query, setQuery] = useState('')
  const list = useRef<HTMLUListElement>(null)
  const oblasts = countBy(all, (l) => l.oblast)
  const places = useMemo(() => {
    const q = searchKey(query)
    const map = new Map<string, { n: number; label: string; key: string }>()
    for (const l of all) {
      if (isUnmapped(l) || !l.place || (f.oblast && l.oblast !== f.oblast))
        continue // unmapped ones: see "More"
      const k = l.place.key
      let e = map.get(k)
      if (!e) {
        const p = l.place
        e = {
          n: 0,
          label: uniqueLabel(l),
          key: searchKey([p.name, p.nameEn, transliterate(p.name)].join(' ')),
        }
        map.set(k, e)
      }
      e.n++
    }
    const collator = new Intl.Collator(fmt.locale)
    return [...map]
      .filter(([, e]) => !q || e.key.includes(q))
      .sort((a, b) => collator.compare(a[1].label, b[1].label))
  }, [all, query, f.oblast, uniqueLabel, fmt.locale])

  const pick = (place: string) => {
    onChange({ place })
    onClose()
  }

  return (
    <div className={className}>
      {(oblasts.size > 1 || f.oblast) && (
        <label className="flex flex-col gap-2">
          <FieldLabel>{t('province')}</FieldLabel>
          <NativeSelect
            className="w-full"
            value={f.oblast}
            onChange={(e) => {
              const oblast = e.target.value
              const keep =
                !f.place ||
                all.some(
                  (l) =>
                    matchesPlace(l, f.place) &&
                    (!oblast || l.oblast === oblast),
                )
              onChange({ oblast, ...(keep ? {} : { place: '' }) })
            }}
          >
            <NativeSelectOption value="">{t('allOblasts')}</NativeSelectOption>
            {[...oblasts]
              .sort((a, b) => b[1] - a[1])
              .map(([k, n]) => (
                <NativeSelectOption key={k} value={k}>
                  {oblastLabel(k, lang)} ({fmt.num(n)})
                </NativeSelectOption>
              ))}
          </NativeSelect>
        </label>
      )}
      <div className="flex flex-col gap-2">
        <FieldLabel id="placeLbl">{t('place')}</FieldLabel>
        <span className="relative block">
          <MagnifyingGlassIcon
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="search"
            value={query}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                if (places[0]) pick(places[0][0]) // pick the first match
              } else if (e.key === 'ArrowDown') {
                e.preventDefault()
                list.current?.querySelector('button')?.focus()
              }
            }}
            placeholder={t('placeSearch')}
            aria-labelledby="placeLbl"
            autoComplete="off"
            className="h-10 w-full rounded-[10px] border border-input bg-background pr-3 pl-9 outline-none placeholder:text-muted-foreground focus-visible:border-foreground focus-visible:ring-3 focus-visible:ring-ring/22"
          />
        </span>
        <div className="-mx-[18px] max-h-[280px] overflow-auto px-[18px]">
          <ul ref={list} className="-mx-2 flex list-none flex-col p-0">
            {!query && (
              <OptRow
                label={t('allPlaces')}
                on={!f.place}
                onPick={() => pick('')}
              />
            )}
            {f.place.startsWith('nb:') && (
              <OptRow
                label={placeFilterLabel(f.place)}
                n={all.filter((l) => matchesPlace(l, f.place)).length}
                on
                onPick={() => pick(f.place)}
              />
            )}
            {places.map(([k, e]) => (
              <OptRow
                key={k}
                label={e.label}
                n={e.n}
                on={f.place === k}
                onPick={() => pick(k)}
              />
            ))}
            {query && !places.length && (
              <li className="px-2.5 py-2 text-[13px] text-muted-foreground">
                {t('noPlaceMatch')}
              </li>
            )}
          </ul>
        </div>
      </div>
    </div>
  )
}

/** A row of mutually exclusive choices (imot.bg-style "Sale / Rent" switch). */
export function Segmented({
  value,
  options,
  onChange,
  label,
  className,
  small = false,
}: {
  value: string
  options: Array<[string, string]>
  onChange: (value: string) => void
  label?: string
  className?: string
  small?: boolean
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        'inline-flex flex-wrap gap-0.5 self-start rounded-full bg-muted p-[3px]',
        small && 'p-0.5',
        className,
      )}
    >
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
            e.preventDefault()
            const i = options.findIndex(([x]) => x === v)
            const next =
              options[
                (i + (e.key === 'ArrowRight' ? 1 : -1) + options.length) %
                  options.length
              ]
            onChange(next[0])
            const group = e.currentTarget.parentElement
            requestAnimationFrame(() =>
              (
                group?.querySelector(
                  '[aria-checked="true"]',
                ) as HTMLElement | null
              )?.focus(),
            )
          }}
          tabIndex={value === v ? 0 : -1}
          className={cn(
            'cursor-pointer rounded-full px-3.5 py-1.5 text-[13px] font-medium text-foreground-2 aria-checked:bg-background aria-checked:font-semibold aria-checked:text-foreground aria-checked:shadow-[0_1px_2px_rgb(24_24_27/0.06)]',
            small && 'px-2.5 py-0.5 text-xs leading-5',
          )}
        >
          {text}
        </button>
      ))}
    </div>
  )
}
