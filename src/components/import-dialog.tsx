import { useMemo, useRef, useState } from 'react'
import { useMutation } from 'convex/react'
import {
  ArrowClockwiseIcon,
  CloudArrowDownIcon,
  TrashIcon,
  XIcon,
} from '@phosphor-icons/react'
import { api } from '../../convex/_generated/api'
import { Button } from '#/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '#/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '#/components/ui/alert-dialog'
import { Textarea } from '#/components/ui/textarea'
import { useApp, errorText } from './app-context'
import { ImportOptionsPanel, JobError, JobView, jobRunning } from './job-view'
import type { Job } from './job-view'
import { countBy } from '#/lib/listings'
import type { Listing, Source } from '#/lib/listings'
import { safeUrl } from '#/lib/urls'
import type { ImportOptions } from '../../shared/importer'

export function DialogHead({
  id,
  title,
  onClose,
}: {
  id?: string
  title: string
  onClose: () => void
}) {
  const { t } = useApp()
  return (
    <header className="flex flex-none items-center justify-between gap-4 border-b py-3.5 pr-3.5 pl-6 max-[720px]:pt-[max(10px,env(safe-area-inset-top))] max-[560px]:pr-2 max-[560px]:pl-4">
      <DialogTitle
        id={id}
        render={<h2 />}
        className="m-0 text-[17px] leading-[1.3] font-semibold tracking-[-0.015em]"
      >
        {title}
      </DialogTitle>
      <Button
        variant="ghost"
        size="icon"
        title={t('close')}
        aria-label={t('close')}
        onClick={onClose}
      >
        <XIcon aria-hidden="true" />
      </Button>
    </header>
  )
}

export const DIALOG =
  'flex max-h-[calc(100dvh-32px)] max-w-none flex-col gap-0 overflow-hidden rounded-2xl p-0 shadow-[var(--shadow-lift)] sm:max-w-none max-[720px]:h-dvh max-[720px]:max-h-dvh max-[720px]:w-screen max-[720px]:rounded-none'

export function Confirm({
  open,
  onOpenChange,
  title,
  confirmLabel,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  confirmLabel: string
  onConfirm: () => void
}) {
  const { t } = useApp()
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="rounded-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-[15px] leading-snug font-semibold">
            {title}
          </AlertDialogTitle>
        </AlertDialogHeader>
        <AlertDialogFooter className="rounded-b-2xl">
          <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              onConfirm()
              onOpenChange(false)
            }}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function ImportDialog({
  open,
  onOpenChange,
  job,
  options,
  onOptions,
  sources,
  all,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  job: Job | null | undefined
  options: ImportOptions
  onOptions: (o: ImportOptions) => void
  sources: Array<Source>
  all: Array<Listing> | null
}) {
  const { t, fmt, workspace } = useApp()
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<
    null | { kind: 'all' } | { kind: 'source'; key: string }
  >(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const start = useMutation(api.imports.start)
  const cancel = useMutation(api.imports.cancel)
  const removeSource = useMutation(api.sources.remove)
  const removeAll = useMutation(api.listings.removeAll)
  const running = jobRunning(job)

  const counts = useMemo(
    () =>
      countBy(
        (all ?? []).flatMap((l) => l.sources),
        (s) => s,
      ),
    [all],
  )
  const list = [...sources].sort((a, b) =>
    String(b.lastImportAt).localeCompare(String(a.lastImportAt)),
  )

  const run = async (inputs: string) => {
    setError(null)
    try {
      await start({ workspace, inputs, options })
    } catch (err) {
      setError(errorText(t, err))
    }
  }
  const act = async (fn: () => Promise<unknown>) => {
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(errorText(t, err))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className={`${DIALOG} w-[min(680px,calc(100vw-32px))]`}
        aria-labelledby="importTitle"
      >
        <DialogHead
          id="importTitle"
          title={t('importTitle')}
          onClose={() => onOpenChange(false)}
        />
        <div className="flex flex-1 flex-col gap-8 overflow-auto overscroll-contain p-6 max-[720px]:pb-[max(24px,env(safe-area-inset-bottom))] max-[560px]:px-4 max-[560px]:pt-4">
          <section className="flex flex-col gap-3.5">
            <p id="importHelp" className="m-0 max-w-[62ch] text-foreground-2">
              {t('importHelp')}
            </p>
            <Textarea
              ref={input}
              rows={4}
              value={text}
              onChange={(e) => setText(e.target.value)}
              spellCheck={false}
              autoComplete="off"
              placeholder={t('importPlaceholder')}
              aria-labelledby="importTitle"
              aria-describedby="importHelp"
              className="min-h-[104px] text-[13.5px]"
            />
            <ImportOptionsPanel options={options} onChange={onOptions} />
            <div className="flex items-center gap-2">
              <Button
                size="lg"
                disabled={running}
                onClick={() => {
                  if (!text.trim()) {
                    input.current?.focus()
                    return
                  }
                  void run(text.trim())
                }}
              >
                <CloudArrowDownIcon aria-hidden="true" />
                {t('startImport')}
              </Button>
              {running && (
                <Button
                  size="lg"
                  variant="outline"
                  onClick={() => void act(() => cancel({ workspace }))}
                >
                  {t('cancelImport')}
                </Button>
              )}
            </div>
            {error ? <JobError message={error} /> : <JobView job={job} />}
          </section>
          <section
            aria-labelledby="sourcesTitle"
            className="flex flex-col gap-1"
          >
            <div className="flex min-h-8 items-center justify-between gap-3">
              <h3
                id="sourcesTitle"
                className="m-0 text-[15px] font-semibold tracking-[-0.01em]"
              >
                {t('sourcesTitle')}
              </h3>
              {list.some((s) => s.url) && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={running}
                  onClick={() =>
                    void run(
                      list
                        .map((s) => s.url)
                        .filter(Boolean)
                        .join('\n'),
                    )
                  }
                >
                  <ArrowClockwiseIcon aria-hidden="true" />
                  {t('reimportAll')}
                </Button>
              )}
            </div>
            {!list.length ? (
              <p className="mt-1 mb-0 text-muted-foreground">
                {t('sourcesEmpty')}
              </p>
            ) : (
              <ul className="m-0 list-none p-0">
                {list.map((s) => {
                  const url = safeUrl(s.url)
                  const name = s.url
                    ? s.url.replace(/^https?:\/\/(www\.)?/, '')
                    : t('manualSource')
                  const params = (s.paramsText || '').replace(/[\s,]+$/, '')
                  return (
                    <li
                      key={s.key}
                      className="flex items-start gap-3 py-3.5 [&+&]:border-t"
                    >
                      <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                        {url ? (
                          <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={s.url ?? ''}
                            className="truncate font-medium text-foreground no-underline hover:underline"
                          >
                            {name}
                          </a>
                        ) : (
                          <span className="truncate font-medium">{name}</span>
                        )}
                        {params && (
                          <p
                            title={params}
                            className="m-0 line-clamp-2 text-[12.5px] text-muted-foreground"
                          >
                            <span className="font-medium text-foreground-2">
                              {t('sourceParamsLabel')}
                            </span>{' '}
                            <span lang="bg">{params}</span>
                          </p>
                        )}
                        <p className="mt-0.5 mb-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-foreground-2 tabular">
                          <span>
                            {t('sourceInfo', {
                              n: fmt.num(counts.get(s.key) ?? 0),
                              date: fmt.date(s.lastImportAt, true),
                            })}
                          </span>
                          {s.splits ? (
                            <span
                              title={t('sourceCappedTitle')}
                              className="inline-flex h-5 items-center rounded-full bg-muted px-2 text-[11.5px] font-medium shadow-[inset_0_0_0_1px_var(--border)]"
                            >
                              {t('sourceCapped')}
                            </span>
                          ) : null}
                        </p>
                      </div>
                      <div className="-mt-1 -mr-1.5 flex flex-none gap-0.5">
                        {s.url && (
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            disabled={running}
                            className="text-muted-foreground hover:text-foreground"
                            title={t('reimport')}
                            aria-label={`${t('reimport')}: ${name}`}
                            onClick={() => void run(s.url ?? '')}
                          >
                            <ArrowClockwiseIcon aria-hidden="true" />
                          </Button>
                        )}
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          disabled={running}
                          className="text-muted-foreground hover:text-destructive"
                          title={t('removeSource')}
                          aria-label={`${t('removeSource')}: ${name}`}
                          onClick={() =>
                            setConfirm({ kind: 'source', key: s.key })
                          }
                        >
                          <TrashIcon aria-hidden="true" />
                        </Button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
          <div className="flex items-center justify-between gap-4 border-t pt-5 max-[560px]:flex-col max-[560px]:items-start max-[560px]:gap-2.5">
            <p className="m-0 max-w-[56ch] text-[12.5px] text-muted-foreground">
              {t('deleteAllHint')}
            </p>
            <Button
              size="sm"
              variant="ghost"
              className="flex-none text-destructive max-[560px]:-ml-3"
              disabled={running || !all?.length}
              onClick={() => setConfirm({ kind: 'all' })}
            >
              <TrashIcon aria-hidden="true" />
              {t('deleteAll')}
            </Button>
          </div>
        </div>
        <Confirm
          open={!!confirm}
          onOpenChange={(o) => !o && setConfirm(null)}
          title={t(
            confirm?.kind === 'all'
              ? 'deleteAllConfirm'
              : 'removeSourceConfirm',
          )}
          confirmLabel={t(
            confirm?.kind === 'all' ? 'deleteAll' : 'removeSource',
          )}
          onConfirm={() => {
            if (!confirm) return
            if (confirm.kind === 'all') void act(() => removeAll({ workspace }))
            else void act(() => removeSource({ workspace, key: confirm.key }))
          }}
        />
      </DialogContent>
    </Dialog>
  )
}
