import { useEffect, useRef, useState } from 'react'
import type { FunctionReturnType } from 'convex/server'
import {
  CaretDownIcon,
  CaretRightIcon,
  CheckIcon,
  SlidersHorizontalIcon,
  WarningIcon,
  XCircleIcon,
} from '@phosphor-icons/react'
import type { api } from '../../convex/_generated/api'
import { Progress } from '#/components/ui/progress'
import { Switch } from '#/components/ui/switch'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '#/components/ui/collapsible'
import { cn } from '#/lib/utils'
import { useApp } from './app-context'
import type { ImportOptions } from '../../shared/importer'

export type Job = NonNullable<FunctionReturnType<typeof api.imports.current>>

export const jobRunning = (job: Job | null | undefined) =>
  job?.status === 'running' || job?.status === 'queued'

function Bar({
  label,
  done,
  total,
}: {
  label: string
  done: number
  total: number
}) {
  const { fmt } = useApp()
  if (!total) return null
  return (
    <div>
      <div className="mb-1.5 flex justify-between gap-3 text-[12.5px] text-foreground-2">
        <span>{label}</span>
        <span className="text-muted-foreground tabular">
          {fmt.num(done)} / {fmt.num(total)}
        </span>
      </div>
      <Progress
        value={Math.min(done, total)}
        max={total}
        aria-label={label}
        className="[&_[data-slot=progress-indicator]]:duration-400 [&_[data-slot=progress-track]]:bg-surface-3"
      />
    </div>
  )
}

/** The import's state: progress while it runs, then the result and its log. */
export function JobView({ job }: { job: Job | null | undefined }) {
  const { t, fmt } = useApp()
  const [logOpen, setLogOpen] = useState(false)
  const log = useRef<HTMLUListElement>(null)
  const atEnd = useRef(true)

  // Keep the log scrolled to its end while new lines come in, unless scrolled up.
  useEffect(() => {
    const el = log.current
    if (el && atEnd.current) el.scrollTop = el.scrollHeight
  }, [job?.log, logOpen])

  if (!job) return null
  const running = jobRunning(job)
  const p = job.progress
  const errText = (() => {
    if (!job.error) return ''
    const key = `err_${job.error.code}`
    const text = t(key)
    return text !== key ? text : job.error.message
  })()
  const [Icon, title, sub] = running
    ? [
        null,
        t('importRunning'),
        job.status === 'queued'
          ? [
              t('phase_queued'),
              job.ahead ? t('queueAhead', { n: job.ahead }) : '',
            ]
              .filter(Boolean)
              .join(' · ')
          : t(`phase_${job.phase}`),
      ]
    : job.status === 'done'
      ? [CheckIcon, t('importDone'), '']
      : job.status === 'cancelled'
        ? [XCircleIcon, t('importCancelled'), t('importCancelledHint')]
        : [WarningIcon, t('importStopped'), errText]
  const entries = job.log
  const warnings = job.warnings
  const lines = entries.map((e) => {
    const params: Record<string, string | number | boolean | null> = {
      ...e.params,
    }
    if ('capped' in params) params.capped = params.capped ? '+' : ''
    if (params.reason) params.reason = t(`reason_${params.reason}`)
    for (const k of [
      'min',
      'max',
      'total',
      'found',
      'count',
      'settlements',
      'neighborhoods',
    ])
      if (typeof params[k] === 'number') params[k] = fmt.num(params[k])
    return {
      key: e.id,
      level: String(e.params.level ?? ''),
      text: t(`log_${e.code}`, params),
    }
  })

  return (
    <div
      className={cn('flex flex-col gap-2.5 rounded-2xl border px-[18px] py-4')}
    >
      <div
        role="status"
        className="flex items-center gap-2.5 text-[14.5px] font-semibold"
      >
        <span
          className={cn(
            'grid size-6 flex-none place-items-center rounded-full text-sm',
            job.status === 'done' && 'bg-good/15 text-good',
            job.status === 'error' && 'bg-destructive/14 text-destructive',
            job.status === 'cancelled' && 'bg-muted text-foreground-2',
          )}
        >
          {Icon ? (
            <Icon aria-hidden="true" className="size-3.5" weight="bold" />
          ) : (
            <span className="size-4 animate-spin rounded-full border-2 border-surface-3 border-t-primary" />
          )}
        </span>
        <span>{title}</span>
        {running && p.found ? (
          <span className="ml-auto text-[13px] font-[450] whitespace-nowrap text-muted-foreground tabular">
            {t('progFound', { n: fmt.num(p.found) })}
          </span>
        ) : null}
      </div>
      {sub && (
        <p className="m-0 -mt-1.5 ml-[34px] text-[13px] text-foreground-2">
          {sub}
        </p>
      )}
      {running && (
        <div className="my-0.5 ml-[34px] flex flex-col gap-3">
          <Bar
            label={t('progPages')}
            done={p.searchPages}
            total={p.searchPagesTotal}
          />
          <Bar
            label={t('progDetails')}
            done={p.details}
            total={p.detailsTotal}
          />
          <Bar
            label={t('progGeocode')}
            done={p.geocode}
            total={p.geocodeTotal}
          />
        </div>
      )}
      {!running && job.status !== 'queued' && (
        <p className="m-0 ml-[34px] text-[13px] text-foreground-2">
          {t(
            'importResult',
            Object.fromEntries(
              Object.entries(job.result).map(([k, v]) => [k, fmt.num(v)]),
            ),
          )}
        </p>
      )}
      {lines.length > 0 && (
        <Collapsible
          open={logOpen}
          onOpenChange={setLogOpen}
          className="ml-[34px]"
        >
          <CollapsibleTrigger className="-ml-1.5 inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full pr-2.5 pl-1.5 text-[13px] font-medium text-foreground-2 hover:bg-muted hover:text-foreground">
            <CaretRightIcon
              aria-hidden="true"
              className={cn(
                'size-[13px] transition-transform',
                logOpen && 'rotate-90',
              )}
            />
            <span>{t('jobDetails')}</span>
            {warnings > 0 && (
              <span className="ml-1 inline-flex items-center gap-1 text-warn-foreground">
                <WarningIcon aria-hidden="true" className="size-3.5" />
                {t('jobWarnings', { n: fmt.num(warnings) })}
              </span>
            )}
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul
              ref={log}
              tabIndex={0}
              onScroll={(e) => {
                const el = e.currentTarget
                atEnd.current =
                  el.scrollTop + el.clientHeight >= el.scrollHeight - 4
              }}
              className="mt-2 mb-0 max-h-[200px] list-disc overflow-auto rounded-[10px] bg-muted py-2.5 pr-3.5 pl-7 text-xs leading-[1.55] [overflow-wrap:anywhere] text-foreground-2 focus-visible:outline-offset-[-2px]"
            >
              {lines.map((l) => (
                <li
                  key={l.key}
                  className={cn(
                    l.level === 'warn' && 'text-warn-foreground',
                    l.level === 'error' && 'text-destructive',
                  )}
                >
                  {l.text}
                </li>
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  )
}

export function JobError({ message }: { message: string }) {
  return (
    <div className="flex flex-col gap-2.5 rounded-2xl border px-[18px] py-4">
      <div
        role="alert"
        className="flex items-center gap-2.5 text-[14.5px] font-semibold"
      >
        <span className="grid size-6 flex-none place-items-center rounded-full bg-destructive/14 text-destructive">
          <WarningIcon aria-hidden="true" className="size-3.5" weight="bold" />
        </span>
        <span>{message}</span>
      </div>
    </div>
  )
}

/** Import options; the switches in the import and search dialogs share one setting. */
export function ImportOptionsPanel({
  options,
  onChange,
}: {
  options: ImportOptions
  onChange: (o: ImportOptions) => void
}) {
  const { t } = useApp()
  const [open, setOpen] = useState(false)
  const rows: Array<[keyof ImportOptions, string, string]> = [
    ['details', t('optDetails'), t('optDetailsHint')],
    ['autoSplit', t('optAutoSplit'), t('optAutoSplitHint')],
    ['geocodeOnline', t('optGeocode'), t('optGeocodeHint')],
  ]
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="-ml-2.5 inline-flex h-8 cursor-pointer items-center gap-2 rounded-full pr-3 pl-2.5 text-[13.5px] font-medium text-foreground-2 hover:bg-muted hover:text-foreground">
        <SlidersHorizontalIcon aria-hidden="true" className="size-4" />
        <span>{t('importOptions')}</span>
        <CaretDownIcon
          aria-hidden="true"
          className={cn(
            'size-4 text-muted-foreground transition-transform',
            open && 'rotate-180',
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 flex flex-col rounded-2xl border px-4 py-0.5">
          {rows.map(([key, label, hint]) => (
            <label
              key={key}
              className="flex cursor-pointer items-center justify-between gap-4 py-3 [&+&]:border-t"
            >
              <span className="flex flex-col gap-0.5 text-[13.5px] font-medium">
                <span>{label}</span>
                <span className="text-[12.5px] font-normal text-muted-foreground">
                  {hint}
                </span>
              </span>
              <Switch
                checked={options[key]}
                onCheckedChange={(checked) =>
                  onChange({ ...options, [key]: checked })
                }
              />
            </label>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
