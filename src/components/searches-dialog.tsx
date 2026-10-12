import { useEffect, useMemo, useState } from 'react'
import { useMutation } from 'convex/react'
import {
  ArrowClockwiseIcon,
  PolygonIcon,
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
import { useApp, errorText } from './app-context'
import { JobError, JobView, jobRunning } from './job-view'
import type { Job } from './job-view'
import { areaSearchOf, countBy } from '#/lib/listings'
import type { AreaSearch, Listing, Shown, Source } from '#/lib/listings'
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

/** The saved searches: show, re-run, remove, and "Delete all data". New searches start from the search dialog. */
export function SearchesDialog({
  open,
  onOpenChange,
  job,
  options,
  sources,
  all,
  deleting,
  shown,
  areaSearches,
  onShow,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  job: Job | null | undefined
  /** The saved options: a re-run uses them. */
  options: ImportOptions
  sources: Array<Source>
  all: Array<Listing> | null
  /** "Delete all data" or a removed search is still being deleted. */
  deleting: boolean
  /** The shown search's links (null: every search). */
  shown: Shown
  /** The area searches this browser started: a link shows with the rest of its area. */
  areaSearches: ReadonlyArray<AreaSearch>
  /** Show only this search's listings (with its area's other links), or null for all. */
  onShow: (url: string | null) => void
}) {
  const { t, fmt, workspace } = useApp()
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<
    null | { kind: 'all' } | { kind: 'source'; key: string }
  >(null)
  const start = useMutation(api.imports.start)
  const cancel = useMutation(api.imports.cancel)
  const removeSource = useMutation(api.sources.remove)
  const removeAll = useMutation(api.listings.removeAll)
  const running = jobRunning(job)
  const busy = running || deleting

  // An old error shouldn't hide a later import (one started from the search dialog, say).
  useEffect(() => {
    if (open) setError(null)
  }, [open, job?.id])

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
        aria-labelledby="searchesTitle"
      >
        <DialogHead
          id="searchesTitle"
          title={t('yourSearches')}
          onClose={() => onOpenChange(false)}
        />
        <div className="flex flex-1 flex-col gap-8 overflow-auto overscroll-contain p-6 max-[720px]:pb-[max(24px,env(safe-area-inset-bottom))] max-[560px]:px-4 max-[560px]:pt-4">
          {(running || error) && (
            <section className="flex flex-col gap-3.5">
              {error && <JobError message={error} />}
              {running && (
                <>
                  <JobView job={job} />
                  <Button
                    size="lg"
                    variant="outline"
                    className="self-start"
                    onClick={() => void act(() => cancel({ workspace }))}
                  >
                    {t('cancelImport')}
                  </Button>
                </>
              )}
            </section>
          )}
          <section
            aria-labelledby="sourcesTitle"
            className="flex flex-col gap-1"
          >
            <div className="flex min-h-8 flex-wrap items-center justify-between gap-x-3 gap-y-2">
              <h3
                id="sourcesTitle"
                className="m-0 text-[15px] font-semibold tracking-[-0.01em]"
              >
                {t('sourcesTitle')}
              </h3>
              <div className="flex gap-2">
                {shown && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onShow(null)}
                  >
                    {t('showAllSearches')}
                  </Button>
                )}
                {list.some((s) => s.url) && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
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
                  const isShown = !!s.url && !!shown?.includes(s.url)
                  const inArea = !!areaSearchOf(areaSearches, s.url)
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
                          {inArea && (
                            <span className="inline-flex h-5 items-center gap-1 rounded-full bg-muted px-2 text-[11.5px] font-medium shadow-[inset_0_0_0_1px_var(--border)]">
                              <PolygonIcon
                                aria-hidden="true"
                                className="size-3"
                              />
                              {t('drawnArea')}
                            </span>
                          )}
                          {isShown && (
                            <span className="inline-flex h-5 items-center rounded-full bg-primary px-2 text-[11.5px] font-semibold text-primary-foreground">
                              {t('shownTag')}
                            </span>
                          )}
                        </p>
                      </div>
                      <div className="-mt-1 -mr-1.5 flex flex-none items-center gap-0.5">
                        {s.url && !isShown && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="mr-1"
                            title={t('showSearchTitle')}
                            aria-label={`${t('showSearch')}: ${name}`}
                            onClick={() => onShow(s.url)}
                          >
                            {t('showSearch')}
                          </Button>
                        )}
                        {s.url && (
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            disabled={busy}
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
                          disabled={busy}
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
              {deleting ? t('deleting') : t('deleteAllHint')}
            </p>
            <Button
              size="sm"
              variant="ghost"
              className="flex-none text-destructive max-[560px]:-ml-3"
              disabled={busy || !all?.length}
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
