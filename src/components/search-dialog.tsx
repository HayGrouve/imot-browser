import { useEffect, useRef, useState } from 'react'
import { useAction, useMutation } from 'convex/react'
import {
  ArrowClockwiseIcon,
  ArrowSquareOutIcon,
  CaretDownIcon,
  CaretLeftIcon,
  FunnelSimpleIcon,
  ListMagnifyingGlassIcon,
  MagnifyingGlassIcon,
  XIcon,
} from '@phosphor-icons/react'
import { api } from '../../convex/_generated/api'
import { Button } from '#/components/ui/button'
import { Dialog, DialogContent } from '#/components/ui/dialog'
import { Checkbox } from '#/components/ui/checkbox'
import { Input } from '#/components/ui/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from '#/components/ui/input-group'
import {
  NativeSelect,
  NativeSelectOptGroup,
  NativeSelectOption,
} from '#/components/ui/native-select'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '#/components/ui/collapsible'
import { cn } from '#/lib/utils'
import { errorCode, errorText, useApp } from './app-context'
import { DIALOG, DialogHead } from './import-dialog'
import { Segmented } from './filter-bar'
import { ImportOptionsPanel, JobView, jobRunning } from './job-view'
import type { Job } from './job-view'
import { loadJson, saveJson } from '#/lib/storage'
import { districtLabel, locationLabel } from '#/lib/labels'
import { safeUrl } from '#/lib/urls'
import {
  RANGES,
  SEARCH_QUERY,
  formTypeLabel,
  invalidRange,
  moreCount,
  payloadOf,
  sanitizeQuery,
  sectionsFor,
} from '#/lib/search-query'
import type { SearchQueryState } from '#/lib/search-query'
import { adaptQuery } from '../../shared/searchform'
import type {
  ExtraSection,
  Option,
  SearchDeal,
  SearchForm,
} from '../../shared/searchform'
import { searchKey } from '../../shared/text'
import { term } from '../../shared/vocab'
import type { ImportOptions } from '../../shared/importer'

type Note = { text: string; error?: boolean } | null

export function SearchDialog({
  open,
  onOpenChange,
  job,
  options,
  onOptions,
  onShowListings,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  job: Job | null | undefined
  options: ImportOptions
  onOptions: (o: ImportOptions) => void
  onShowListings: () => void
}) {
  const { t, workspace } = useApp()
  const getForm = useAction(api.searchForm.get)
  const startSearch = useAction(api.searchForm.startSearch)
  const cancel = useMutation(api.imports.cancel)
  const [sq, setSq] = useState<SearchQueryState>(() =>
    sanitizeQuery(loadJson('searchQuery', {})),
  )
  const [form, setForm] = useState<SearchForm | null>(null)
  const [loading, setLoading] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [note, setNote] = useState<Note>(null)
  const [view, setView] = useState<'form' | 'job'>('form')
  const [url, setUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [invalid, setInvalid] = useState<string | null>(null)
  const formEl = useRef<HTMLFormElement>(null)
  const progressEl = useRef<HTMLDivElement>(null)
  const loadKey = useRef<string | null>(null)
  const latest = useRef({ form, sq })
  latest.current = { form, sq }
  const running = jobRunning(job)

  useEffect(() => saveJson('searchQuery', sq), [sq])

  /** Read imot.bg's form for a deal (and place); keep the query in step with it. */
  const load = async (deal: SearchDeal, location: string): Promise<void> => {
    const key = `${deal}|${location}`
    if (loadKey.current === key) return
    loadKey.current = key
    setLoading(key)
    setLoadError(null)
    const prev = latest.current.form
    try {
      const next = JSON.parse(await getForm({ deal, location })) as SearchForm
      if (loadKey.current !== key) return
      loadKey.current = null
      setLoading(null)
      setSq((q) => adaptQuery({ ...q, deal, location }, prev, next))
      setForm(next)
    } catch (err) {
      if (loadKey.current !== key) return
      loadKey.current = null
      setLoading(null)
      if (errorCode(err) === 'unknownLocation' && location) {
        // A saved place imot.bg no longer lists: search everywhere instead.
        setSq((q) => ({ ...q, location: '', districts: [] }))
        await load(deal, '')
      } else if (prev) {
        // Keep the form that works; undo the change that needed another one.
        setNote({
          text: t('sfLoadError', { message: errorText(t, err) }),
          error: true,
        })
        setSq((q) => ({
          ...q,
          deal: prev.deal,
          ...(q.location !== prev.location
            ? { location: prev.location, districts: [] }
            : {}),
        }))
      } else setLoadError(errorText(t, err))
    }
  }

  useEffect(() => {
    if (!open) return
    if (view === 'job' && !running && job?.searchUrl !== url) setView('form')
    const { form: f, sq: q } = latest.current
    if (!f || f.deal !== q.deal || (q.location && f.location !== q.location))
      void load(q.deal, q.location)
    // Only when the dialog opens.
  }, [open])

  const update = (patch: Partial<SearchQueryState>) => {
    setNote(null)
    setInvalid(null)
    setSq((q) => ({ ...q, ...patch }))
  }

  const submit = async () => {
    if (!form || busy || loading || running) return
    setInvalid(null)
    const p = payloadOf(sq, form)
    const label = (key: string | null) =>
      t(key ?? (p.deal === 'rent' ? 'sfRentPrice' : 'sfPrice'))
    let bad: { name: string; text: string } | null = null
    for (const el of formEl.current?.querySelectorAll<HTMLInputElement>(
      'input[type="number"]',
    ) ?? []) {
      const range = RANGES.find((r) => r[0] === el.name || r[1] === el.name)
      if (!range) continue
      const value = p[el.name as keyof SearchQueryState]
      if (
        el.validity.badInput ||
        (value !== '' && el.validity.rangeUnderflow)
      ) {
        bad = {
          name: el.name,
          text: t('sfNumberError', { field: label(range[2]) }),
        }
        break
      }
    }
    const range = bad ? null : invalidRange(p)
    if (range)
      bad = {
        name: range.field,
        text: t('sfRangeError', { field: t(range.label) }),
      }
    if (bad) {
      const name = bad.name
      setInvalid(name)
      setNote({ text: bad.text, error: true })
      if (['yardMin', 'yardMax', 'yearFrom', 'yearTo'].includes(name))
        setMoreOpen(true)
      requestAnimationFrame(() =>
        formEl.current?.querySelector<HTMLElement>(`[name="${name}"]`)?.focus(),
      )
      return
    }
    setBusy(true)
    setNote(null)
    try {
      const res = await startSearch({ workspace, query: p, options })
      setUrl(res.url)
      setView('job')
      requestAnimationFrame(() => progressEl.current?.focus())
    } catch (err) {
      setNote({ text: errorText(t, err), error: true })
    } finally {
      setBusy(false)
    }
  }

  const jobView = view === 'job'
  const msg: Note = jobView
    ? null
    : busy
      ? { text: t('sfResolving') }
      : (note ??
        (running
          ? { text: t('sfBusy') }
          : form && !sq.location
            ? { text: t('sfNoLocation') }
            : null))
  const params = (
    job?.inputs.find((i) => i.input === url)?.paramsText ?? ''
  ).replace(/[\s,]+$/, '')
  const link = safeUrl(url)

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o)
        if (!o && !running) setView('form')
      }}
    >
      <DialogContent
        showCloseButton={false}
        aria-labelledby="searchTitle"
        className={`${DIALOG} h-[min(940px,calc(100dvh-32px))] w-[min(820px,calc(100vw-32px))]`}
      >
        <DialogHead
          id="searchTitle"
          title={t('searchImot')}
          onClose={() => onOpenChange(false)}
        />
        {!jobView ? (
          <form
            id="searchForm"
            ref={formEl}
            noValidate
            autoComplete="off"
            onSubmit={(e) => {
              e.preventDefault()
              void submit()
            }}
            className="flex flex-1 flex-col gap-6 overflow-auto overscroll-contain p-6 max-[560px]:px-4 max-[560px]:pt-4"
          >
            <p className="m-0 max-w-[64ch] text-foreground-2">{t('sfIntro')}</p>
            {form ? (
              <Fields
                form={form}
                sq={sq}
                dim={!!loading && form.deal !== sq.deal}
                invalid={invalid}
                moreOpen={moreOpen}
                onMoreOpen={setMoreOpen}
                onChange={update}
                onDeal={(deal) => {
                  update({ deal })
                  void load(deal, sq.location)
                }}
                onLocation={(location) => {
                  update({ location, districts: [] })
                  if (location) void load(sq.deal, location)
                }}
              />
            ) : loadError ? (
              <div
                role="alert"
                className="flex flex-col items-start gap-2.5 text-destructive"
              >
                <p className="m-0">
                  {t('sfLoadError', { message: loadError })}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  type="button"
                  onClick={() => void load(sq.deal, sq.location)}
                >
                  <ArrowClockwiseIcon aria-hidden="true" />
                  {t('sfRetry')}
                </Button>
              </div>
            ) : (
              <p className="m-0 flex items-center gap-2.5 text-foreground-2">
                <span className="size-4 animate-spin rounded-full border-2 border-surface-3 border-t-primary" />
                {t('sfLoading')}
              </p>
            )}
            <ImportOptionsPanel options={options} onChange={onOptions} />
          </form>
        ) : (
          <div
            ref={progressEl}
            tabIndex={-1}
            className="flex flex-1 flex-col gap-4 overflow-auto p-6 outline-none max-[560px]:px-4 max-[560px]:pt-4"
          >
            {link && (
              <div className="flex flex-col gap-1.5">
                <a
                  href={link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 self-start font-medium"
                >
                  <ArrowSquareOutIcon aria-hidden="true" className="size-4" />
                  <span>{t('sfOnImot')}</span>
                </a>
                {params && (
                  <p className="m-0 line-clamp-2 text-[12.5px] text-muted-foreground">
                    <span className="font-medium text-foreground-2">
                      {t('sourceParamsLabel')}
                    </span>{' '}
                    <span lang="bg">{params}</span>
                  </p>
                )}
              </div>
            )}
            <JobView job={job} />
          </div>
        )}
        <footer className="flex flex-none items-center justify-end gap-2 border-t bg-background py-3 pr-4 pl-6 max-[560px]:flex-wrap max-[560px]:px-4 max-[560px]:pb-[max(10px,env(safe-area-inset-bottom))]">
          <p
            role={msg?.error ? 'alert' : 'status'}
            aria-live="polite"
            className={cn(
              'm-0 mr-auto max-w-[52ch] text-[12.5px] text-muted-foreground max-[560px]:basis-full',
              msg?.error && 'text-destructive',
            )}
          >
            {msg?.text ?? ''}
          </p>
          {!jobView ? (
            <>
              <Button
                key="clear"
                type="button"
                variant="ghost"
                size="lg"
                onClick={() => {
                  setNote(null)
                  setInvalid(null)
                  setSq((q) => ({
                    ...SEARCH_QUERY,
                    deal: q.deal,
                    currency: q.currency,
                  }))
                  if (!form || form.deal !== sq.deal) void load(sq.deal, '')
                }}
              >
                {t('clear')}
              </Button>
              <Button
                key="go"
                type="submit"
                form="searchForm"
                size="lg"
                disabled={!form || !!loading || running || busy}
                className={cn(
                  busy &&
                    'after:size-2.5 after:animate-spin after:rounded-full after:border-2 after:border-current after:border-r-transparent',
                )}
              >
                <ListMagnifyingGlassIcon aria-hidden="true" />
                {t('sfGo')}
              </Button>
            </>
          ) : (
            <>
              <Button
                key="edit"
                type="button"
                variant="outline"
                size="lg"
                onClick={() => setView('form')}
              >
                <CaretLeftIcon aria-hidden="true" />
                {t('sfEdit')}
              </Button>
              {running ? (
                <Button
                  key="cancel"
                  type="button"
                  variant="outline"
                  size="lg"
                  onClick={() => void cancel({ workspace })}
                >
                  {t('cancelImport')}
                </Button>
              ) : (
                <Button
                  key="show"
                  type="button"
                  size="lg"
                  onClick={() => {
                    onOpenChange(false)
                    setView('form')
                    onShowListings()
                  }}
                >
                  {t('sfShow')}
                </Button>
              )}
            </>
          )}
        </footer>
      </DialogContent>
    </Dialog>
  )
}

const FieldLabel = ({
  children,
  id,
  htmlFor,
}: {
  children: React.ReactNode
  id?: string
  htmlFor?: string
}) =>
  htmlFor ? (
    <label
      id={id}
      htmlFor={htmlFor}
      className="flex min-h-7 items-center text-[13px] font-semibold"
    >
      {children}
    </label>
  ) : (
    <span
      id={id}
      className="flex min-h-7 items-center text-[13px] font-semibold"
    >
      {children}
    </span>
  )

function Chip({
  checked,
  onChange,
  children,
}: {
  checked: boolean
  onChange: (on: boolean) => void
  children: React.ReactNode
}) {
  return (
    <label className="relative inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border border-border-strong bg-background px-3 text-[13px] font-medium transition-colors select-none hover:bg-muted has-checked:border-primary has-checked:bg-primary has-checked:text-primary-foreground has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring">
      <input
        type="checkbox"
        className="pointer-events-none absolute opacity-0"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{children}</span>
    </label>
  )
}

function Fields({
  form,
  sq,
  dim,
  invalid,
  moreOpen,
  onMoreOpen,
  onChange,
  onDeal,
  onLocation,
}: {
  form: SearchForm
  sq: SearchQueryState
  dim: boolean
  invalid: string | null
  moreOpen: boolean
  onMoreOpen: (open: boolean) => void
  onChange: (patch: Partial<SearchQueryState>) => void
  onDeal: (deal: SearchDeal) => void
  onLocation: (location: string) => void
}) {
  const { t, fmt, lang } = useApp()
  const sections = sectionsFor(form, sq.types)
  const lockedGroup =
    form.types.find((x) => sq.types.includes(x.id))?.group ?? null
  const cur = sq.currency === '$' ? '$' : '€'
  const sqm = t('sqm')
  const groups: Array<{ id: number; types: SearchForm['types'] }> = []
  for (const ty of form.types) {
    const g = groups.find((x) => x.id === ty.group)
    if (g) g.types.push(ty)
    else groups.push({ id: ty.group, types: [ty] })
  }
  const floorLabel = (o: Option) =>
    lang === 'bg'
      ? o.label
      : ((
          {
            1000: t('sfTopOnly'),
            999: t('sfNotTop'),
            0: t('sfGround'),
          } as Record<string, string>
        )[o.value] ?? o.value)
  const sortLabel = (o: Option) => {
    const key = `sfSort${o.value}`
    return lang === 'bg' || t(key) === key ? o.label : t(key)
  }
  const payload = payloadOf(sq, form)
  const nMore = moreCount(payload)

  const num = (
    name: keyof SearchQueryState,
    label: string,
    suffix: string,
    step: number,
  ) => (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <InputGroup>
        <InputGroupInput
          type="number"
          name={name}
          min={0}
          step={step}
          inputMode="decimal"
          value={sq[name] as string}
          aria-invalid={invalid === name || undefined}
          onChange={(e) => onChange({ [name]: e.target.value.trim() })}
          className="tabular"
        />
        <InputGroupAddon align="inline-end">
          <InputGroupText className="text-[13px]">{suffix}</InputGroupText>
        </InputGroupAddon>
      </InputGroup>
    </label>
  )
  const range = (
    a: keyof SearchQueryState,
    b: keyof SearchQueryState,
    suffix: string,
    step: number,
  ) => (
    <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
      {num(a, t('sfFrom'), suffix, step)}
      <span className="pb-2.5 text-muted-foreground">-</span>
      {num(b, t('sfTo'), suffix, step)}
    </div>
  )
  const select = (
    name: keyof SearchQueryState,
    opts: Array<Option>,
    { any = t('sfAny'), id }: { any?: string | null; id?: string } = {},
  ) => (
    <NativeSelect
      id={id}
      name={name}
      className="w-full"
      value={sq[name] as string}
      aria-invalid={invalid === name || undefined}
      onChange={(e) => onChange({ [name]: e.target.value })}
    >
      {any != null && <NativeSelectOption value="">{any}</NativeSelectOption>}
      {opts.map((o) => (
        <NativeSelectOption key={o.value} value={o.value}>
          {o.label}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  )
  const selRange = (
    a: keyof SearchQueryState,
    b: keyof SearchQueryState,
    optsA: Array<Option>,
    optsB: Array<Option>,
  ) => (
    <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
      <label className="flex min-w-0 flex-col gap-1">
        <span className="text-xs text-muted-foreground">{t('sfFrom')}</span>
        {select(a, optsA)}
      </label>
      <span className="pb-2.5 text-muted-foreground">-</span>
      <label className="flex min-w-0 flex-col gap-1">
        <span className="text-xs text-muted-foreground">{t('sfTo')}</span>
        {select(b, optsB)}
      </label>
    </div>
  )
  const extraChips = (sec: ExtraSection) =>
    sec.checks.map((c) => (
      <Chip
        key={`${c.name}:${c.value}`}
        checked={sq.extras[c.name] === c.value}
        onChange={(on) => {
          const extras = { ...sq.extras }
          if (on) extras[c.name] = c.value
          else if (extras[c.name] === c.value) delete extras[c.name]
          onChange({ extras })
        }}
      >
        {term(c.label, lang)}
      </Chip>
    ))
  const extraSelects = (sec: ExtraSection) =>
    sec.selects.length ? (
      <div className="mt-3.5 flex flex-wrap gap-x-6 gap-y-3">
        {sec.selects.map((s) => (
          <label
            key={s.name}
            className="flex items-center gap-2.5 text-[13.5px]"
          >
            <span>{term(s.label, lang)}</span>
            <NativeSelect
              className="min-w-[150px]"
              value={sq.extras[s.name] ?? ''}
              onChange={(e) => {
                const extras = { ...sq.extras }
                if (e.target.value) extras[s.name] = e.target.value
                else delete extras[s.name]
                onChange({ extras })
              }}
            >
              <NativeSelectOption value="">{t('sfAny')}</NativeSelectOption>
              {s.options.map((o) => (
                <NativeSelectOption key={o.value} value={o.value}>
                  {term(o.label, lang)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
        ))}
      </div>
    ) : null
  const extraSection = (id: string, label: string) => {
    const sec = form.extras[id] as ExtraSection | undefined
    if (
      !sec ||
      !sections.has(id) ||
      (!sec.checks.length && !sec.selects.length)
    )
      return null
    return (
      <fieldset className="m-0 min-w-0 border-0 p-0">
        <legend className="mb-2.5 p-0 text-[13px] font-semibold">
          {label}
        </legend>
        {sec.checks.length > 0 && (
          <div className="flex flex-wrap gap-1.5">{extraChips(sec)}</div>
        )}
        {extraSelects(sec)}
      </fieldset>
    )
  }
  const years = (list: Array<string>) =>
    list.map((v) => ({ value: v, label: v }))
  const floors = (list: Array<Option>) =>
    list.map((o) => ({ value: o.value, label: floorLabel(o) }))
  const collator = new Intl.Collator(fmt.locale)
  const locs = form.locations.map((l) => l.value)
  const locGroup = (label: string, list: Array<string>) =>
    list.length ? (
      <NativeSelectOptGroup label={label}>
        {[...list]
          .sort((a, b) =>
            collator.compare(locationLabel(a, lang), locationLabel(b, lang)),
          )
          .map((v) => (
            <NativeSelectOption key={v} value={v}>
              {locationLabel(v, lang)}
            </NativeSelectOption>
          ))}
      </NativeSelectOptGroup>
    ) : null
  const anySections = ['areah', 'extritb', 'extri1', 'extrip'].some((s) =>
    sections.has(s),
  )

  return (
    <div
      className={cn(
        'flex flex-col gap-7 transition-opacity',
        dim && 'pointer-events-none opacity-50',
      )}
    >
      <Segmented
        label={t('sfDeal')}
        value={sq.deal}
        options={[
          ['sale', t('sfSale')],
          ['rent', t('sfRent')],
        ]}
        onChange={(v) => onDeal(v === 'rent' ? 'rent' : 'sale')}
      />
      <fieldset className="m-0 min-w-0 border-0 p-0">
        <legend className="mb-2.5 p-0 text-[13px] font-semibold">
          {t('typeHeading')}
        </legend>
        <div className="[columns:3_180px] gap-x-2.5 max-[640px]:[columns:2_140px]">
          {groups.map((g) => {
            const locked = lockedGroup != null && g.id !== lockedGroup
            return (
              <div
                key={g.id}
                className={cn(
                  'mb-2.5 flex break-inside-avoid flex-col rounded-[10px] bg-muted px-3 py-1.5 transition-opacity',
                  locked && 'opacity-45',
                )}
              >
                {g.types.map((ty) => (
                  <label
                    key={ty.id}
                    className={cn(
                      'flex cursor-pointer items-center gap-2.5 py-[5px] text-[13.5px]',
                      locked && 'cursor-not-allowed',
                    )}
                  >
                    <Checkbox
                      name="type"
                      value={ty.id}
                      disabled={locked}
                      checked={sq.types.includes(ty.id)}
                      onCheckedChange={(on) =>
                        onChange({
                          types: on
                            ? [...sq.types, ty.id]
                            : sq.types.filter((x) => x !== ty.id),
                        })
                      }
                    />
                    <span>{formTypeLabel(ty.label, lang)}</span>
                  </label>
                ))}
              </div>
            )
          })}
        </div>
        <p className="m-0 text-[12.5px] text-muted-foreground">
          {t('sfTypeHint')}
        </p>
      </fieldset>
      <div className="flex min-w-0 flex-col gap-2">
        <FieldLabel htmlFor="sfLocation">{t('sfLocation')}</FieldLabel>
        <NativeSelect
          id="sfLocation"
          name="location"
          className="w-full"
          value={sq.location}
          onChange={(e) => onLocation(e.target.value)}
        >
          <NativeSelectOption value="">{t('sfAnywhere')}</NativeSelectOption>
          {locGroup(
            t('sfCities'),
            locs.filter((v) => v.startsWith('град ')),
          )}
          {locGroup(
            t('sfProvinces'),
            locs.filter((v) => v.startsWith('област ')),
          )}
          {locGroup(
            t('sfAbroad'),
            locs.filter((v) => !/^(град|област) /.test(v)),
          )}
        </NativeSelect>
        <Districts form={form} sq={sq} onChange={onChange} />
      </div>
      <div className="grid grid-cols-2 items-start gap-x-8 gap-y-6 max-[640px]:grid-cols-1">
        <div
          role="group"
          aria-labelledby="sfL-price"
          className="flex min-w-0 flex-col gap-2"
        >
          <div className="flex min-h-7 items-center justify-between gap-3">
            <span id="sfL-price" className="text-[13px] font-semibold">
              {t(form.deal === 'rent' ? 'sfRentPrice' : 'sfPrice')}
            </span>
            {form.currencies.length > 1 && (
              <Segmented
                small
                label={t('sfCurrency')}
                value={sq.currency || form.currencies[0]}
                options={form.currencies.map((c): [string, string] => [
                  c,
                  c === '$' ? 'USD' : c,
                ])}
                onChange={(currency) => onChange({ currency })}
              />
            )}
          </div>
          {range('priceMin', 'priceMax', cur, 1000)}
        </div>
        <div
          role="group"
          aria-labelledby="sfL-ppm"
          className="flex min-w-0 flex-col gap-2"
        >
          <FieldLabel id="sfL-ppm">{t('sfPpm')}</FieldLabel>
          {range('ppmMin', 'ppmMax', `${cur}/${sqm}`, 100)}
        </div>
        <div
          role="group"
          aria-labelledby="sfL-area"
          className="flex min-w-0 flex-col gap-2"
        >
          <FieldLabel id="sfL-area">{t('sfArea')}</FieldLabel>
          {range('areaMin', 'areaMax', sqm, 5)}
        </div>
        <div
          role="group"
          aria-labelledby="sfL-floor"
          className="flex min-w-0 flex-col gap-2"
        >
          <FieldLabel id="sfL-floor">{t('sfFloor')}</FieldLabel>
          {selRange(
            'floorFrom',
            'floorTo',
            floors(form.floorsFrom),
            floors(form.floorsTo),
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <FieldLabel htmlFor="sfSort">{t('sfSort')}</FieldLabel>
          {select(
            'sort',
            form.sorts.map((o) => ({ value: o.value, label: sortLabel(o) })),
            { any: null, id: 'sfSort' },
          )}
          <p className="m-0 text-[12.5px] text-muted-foreground">
            {t('sfSortHint')}
          </p>
        </div>
      </div>
      <Collapsible open={moreOpen} onOpenChange={onMoreOpen}>
        <CollapsibleTrigger className="-ml-2.5 inline-flex h-8 cursor-pointer items-center gap-2 rounded-full pr-3 pl-2.5 text-[13.5px] font-medium text-foreground-2 hover:bg-muted hover:text-foreground">
          <FunnelSimpleIcon aria-hidden="true" className="size-4" />
          <span>{t('sfMore')}</span>
          {nMore > 0 && (
            <span className="inline-grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1.5 text-[11.5px] font-semibold text-primary-foreground tabular">
              {fmt.num(nMore)}
            </span>
          )}
          <CaretDownIcon
            aria-hidden="true"
            className={cn(
              'size-4 text-muted-foreground transition-transform',
              moreOpen && 'rotate-180',
            )}
          />
        </CollapsibleTrigger>
        <CollapsibleContent keepMounted>
          <div className="mt-2.5 flex flex-col gap-6 rounded-2xl border p-5 max-[560px]:p-4">
            <div className="flex flex-col gap-2">
              <FieldLabel htmlFor="sfKeyword">{t('sfKeyword')}</FieldLabel>
              <Input
                id="sfKeyword"
                name="keyword"
                maxLength={40}
                lang="bg"
                value={sq.keyword}
                aria-describedby="sfKeywordHint"
                onChange={(e) => onChange({ keyword: e.target.value })}
              />
              <p
                id="sfKeywordHint"
                className="m-0 text-[12.5px] text-muted-foreground"
              >
                {t('sfKeywordHint')}
              </p>
            </div>
            {!anySections && (
              <p className="m-0 rounded-[10px] bg-muted px-3.5 py-3 text-[12.5px] text-muted-foreground">
                {t('sfPickType')}
              </p>
            )}
            {sections.has('areah') && (
              <div
                role="group"
                aria-labelledby="sfL-yard"
                className="flex flex-col gap-2"
              >
                <FieldLabel id="sfL-yard">{t('sfYard')}</FieldLabel>
                {range('yardMin', 'yardMax', sqm, 50)}
              </div>
            )}
            {sections.has('extritb') && (
              <div className="flex flex-col gap-6">
                {form.extras.extritb.checks.length > 0 && (
                  <fieldset className="m-0 min-w-0 border-0 p-0">
                    <legend className="mb-2.5 p-0 text-[13px] font-semibold">
                      {t('sfConstruction')}
                    </legend>
                    <div className="flex flex-wrap gap-1.5">
                      {extraChips(form.extras.extritb)}
                    </div>
                  </fieldset>
                )}
                <fieldset className="m-0 min-w-0 border-0 p-0">
                  <legend className="mb-2.5 p-0 text-[13px] font-semibold">
                    {t('sfStatus')}
                  </legend>
                  <div className="flex flex-wrap gap-1.5">
                    {['1', '2'].map((v) => (
                      <Chip
                        key={v}
                        checked={sq.status.includes(v)}
                        onChange={(on) =>
                          onChange({
                            status: on
                              ? [...sq.status, v]
                              : sq.status.filter((x) => x !== v),
                          })
                        }
                      >
                        {t(`sfStatus${v}`)}
                      </Chip>
                    ))}
                  </div>
                </fieldset>
                {form.yearsFrom.length > 0 && (
                  <div
                    role="group"
                    aria-labelledby="sfL-year"
                    className="flex flex-col gap-2"
                  >
                    <FieldLabel id="sfL-year">{t('sfYear')}</FieldLabel>
                    {selRange(
                      'yearFrom',
                      'yearTo',
                      years(form.yearsFrom),
                      years(form.yearsTo),
                    )}
                  </div>
                )}
              </div>
            )}
            {extraSection('extri1', t('sfFeatures'))}
            {extraSection('extrip', t('sfPlot'))}
            <fieldset className="m-0 min-w-0 border-0 p-0">
              <legend className="mb-2.5 p-0 text-[13px] font-semibold">
                {t('sfMedia')}
              </legend>
              <div className="flex flex-wrap gap-1.5">
                <Chip
                  checked={sq.photoOnly}
                  onChange={(photoOnly) => onChange({ photoOnly })}
                >
                  {t('sfPhotoOnly')}
                </Chip>
                <Chip
                  checked={sq.videoOnly}
                  onChange={(videoOnly) => onChange({ videoOnly })}
                >
                  {t('sfVideoOnly')}
                </Chip>
              </div>
            </fieldset>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}

function Districts({
  form,
  sq,
  onChange,
}: {
  form: SearchForm
  sq: SearchQueryState
  onChange: (patch: Partial<SearchQueryState>) => void
}) {
  const { t, fmt, lang } = useApp()
  const [query, setQuery] = useState('')
  const picked = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)
  if (!sq.location) return null
  if (form.location !== sq.location)
    return (
      <p className="m-0 mt-1 flex items-center gap-2.5 text-xs text-foreground-2">
        <span className="size-4 animate-spin rounded-full border-2 border-surface-3 border-t-primary" />
        {t('sfDistrictsLoading')}
      </p>
    )
  if (!form.districts.length) return null
  const city = sq.location.startsWith('град ')
  const collator = new Intl.Collator(fmt.locale)
  const list =
    lang === 'bg'
      ? form.districts
      : [...form.districts].sort((a, b) =>
          collator.compare(districtLabel(a, lang), districtLabel(b, lang)),
        )
  const key = searchKey(query)
  const shown = list.filter(
    (d) =>
      !key ||
      searchKey(d).includes(key) ||
      searchKey(districtLabel(d, lang)).includes(key),
  )
  const searchLabel = t(city ? 'sfDistrictSearch' : 'sfPlaceSearch')
  return (
    <fieldset className="m-0 mt-3.5 flex min-w-0 flex-col gap-2.5 border-0 p-0">
      <legend className="mb-2.5 p-0 text-[13px] font-semibold">
        {t(city ? 'sfDistricts' : 'sfPlaces')}{' '}
        <span className="ml-1 font-[450] text-muted-foreground">
          {sq.districts.length
            ? t('sfSelected', { n: fmt.num(sq.districts.length) })
            : t('sfDistrictsHint')}
        </span>
      </legend>
      {sq.districts.length > 0 && (
        <div ref={picked} className="flex flex-wrap gap-1.5">
          {sq.districts.map((d) => (
            <button
              key={d}
              type="button"
              aria-label={`${t('clearFilter')}: ${districtLabel(d, lang)}`}
              onClick={() => {
                onChange({ districts: sq.districts.filter((x) => x !== d) })
                requestAnimationFrame(() =>
                  (
                    picked.current?.querySelector('button') ?? search.current
                  )?.focus(),
                )
              }}
              className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full bg-muted pr-2 pl-3 text-[13px] font-medium hover:bg-surface-3"
            >
              <span>{districtLabel(d, lang)}</span>
              <XIcon
                aria-hidden="true"
                className="size-3.5 text-muted-foreground"
              />
            </button>
          ))}
        </div>
      )}
      <span className="relative block">
        <MagnifyingGlassIcon
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <input
          ref={search}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={searchLabel}
          aria-label={searchLabel}
          autoComplete="off"
          className="h-10 w-full rounded-[10px] border border-input bg-background pr-3 pl-9 outline-none placeholder:text-muted-foreground focus-visible:border-foreground focus-visible:ring-3 focus-visible:ring-ring/22"
        />
      </span>
      <ul className="m-0 grid max-h-[236px] list-none grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-x-4 overflow-auto overscroll-contain rounded-[10px] border px-3 py-1.5">
        {shown.map((d) => (
          <li key={d}>
            <label className="flex cursor-pointer items-center gap-2.5 py-[5px] text-[13.5px]">
              <Checkbox
                name="district"
                value={d}
                checked={sq.districts.includes(d)}
                onCheckedChange={(on) =>
                  onChange({
                    districts: on
                      ? [...sq.districts, d]
                      : sq.districts.filter((x) => x !== d),
                  })
                }
              />
              <span>{districtLabel(d, lang)}</span>
            </label>
          </li>
        ))}
        {!shown.length && (
          <li className="col-span-full px-2.5 py-2 text-[13px] text-muted-foreground">
            {t('sfNoMatch')}
          </li>
        )}
      </ul>
    </fieldset>
  )
}
