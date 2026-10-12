import { useEffect, useRef, useState } from 'react'
import {
  CloudArrowDownIcon,
  DevicesIcon,
  DotsThreeIcon,
  FileCsvIcon,
  HouseSimpleIcon,
  InfoIcon,
  ListMagnifyingGlassIcon,
  MagnifyingGlassIcon,
  TranslateIcon,
} from '@phosphor-icons/react'
import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { Kbd } from '#/components/ui/kbd'
import { useApp } from './app-context'
import { cn } from '#/lib/utils'

export function Topbar({
  query,
  onQuery,
  busy,
  onSearchImot,
  onImport,
  onCsv,
  onToggleLang,
  onShare,
  onAbout,
}: {
  query: string
  onQuery: (q: string) => void
  busy: boolean
  onSearchImot: () => void
  onImport: () => void
  onCsv: () => void
  onToggleLang: () => void
  onShare: () => void
  onAbout: () => void
}) {
  const { t } = useApp()
  const [value, setValue] = useState(query)
  const input = useRef<HTMLInputElement>(null)
  const phone = useMedia('(max-width: 720px)')

  // The box is typed into faster than the list filters: apply after a pause.
  useEffect(() => {
    if (value === query) return
    const id = setTimeout(() => onQuery(value), 150)
    return () => clearTimeout(id)
  }, [value, query, onQuery])
  useEffect(() => setValue(query), [query])

  // "/" jumps to the search box from anywhere but a field or a dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return
      if (target?.closest('input,textarea,select,[contenteditable]')) return
      if (
        document.querySelector(
          '[role="dialog"][data-open], [role="alertdialog"]',
        )
      )
        return
      e.preventDefault()
      input.current?.focus()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  return (
    <header className="relative z-30 grid h-16 flex-none grid-cols-[minmax(0,1fr)_minmax(0,560px)_minmax(0,1fr)] items-center gap-4 border-b bg-background px-5 max-[960px]:grid-cols-[auto_minmax(0,1fr)_auto] max-[720px]:h-[60px] max-[720px]:gap-2.5 max-[720px]:px-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <span
          className="grid size-[30px] flex-none place-items-center rounded-[9px] bg-primary text-primary-foreground"
          aria-hidden="true"
        >
          <HouseSimpleIcon weight="fill" className="size-[18px]" />
        </span>
        <h1 className="m-0 truncate text-base font-semibold tracking-[-0.015em] max-[960px]:sr-only">
          {t('appTitle')}
        </h1>
      </div>
      <label className="relative block">
        <MagnifyingGlassIcon
          className="pointer-events-none absolute top-1/2 left-4 size-[18px] -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <span className="sr-only">{t('searchLabel')}</span>
        <input
          ref={input}
          type="search"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t(phone ? 'searchShort' : 'searchPlaceholder')}
          title={t('searchHint')}
          autoComplete="off"
          spellCheck={false}
          className="peer h-11 w-full min-w-0 rounded-full border border-transparent bg-muted pr-11 pl-[46px] text-[15px] transition-[border-color,background-color] outline-none placeholder:text-muted-foreground hover:border-border-strong focus-visible:border-foreground focus-visible:bg-background focus-visible:ring-3 focus-visible:ring-ring/20 max-[720px]:h-[42px] [&::-webkit-search-cancel-button]:cursor-pointer"
        />
        <Kbd
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 peer-focus:hidden peer-[:not(:placeholder-shown)]:hidden max-[720px]:hidden"
        >
          /
        </Kbd>
      </label>
      <div className="flex items-center justify-end gap-1.5">
        <Button
          variant="outline"
          onClick={onSearchImot}
          title={t('searchImot')}
          aria-label={t('searchImot')}
          className="max-[960px]:w-[38px] max-[960px]:px-0"
        >
          <ListMagnifyingGlassIcon aria-hidden="true" />
          <span className="max-[960px]:hidden">{t('searchImot')}</span>
        </Button>
        <Button
          variant="outline"
          onClick={onImport}
          title={t('import')}
          aria-label={t('import')}
          className={cn(
            'max-[960px]:w-[38px] max-[960px]:px-0',
            busy &&
              'after:size-2.5 after:animate-spin after:rounded-full after:border-2 after:border-current after:border-r-transparent',
          )}
        >
          <CloudArrowDownIcon aria-hidden="true" />
          <span className="max-[960px]:hidden">{t('import')}</span>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="outline"
                size="icon"
                title={t('moreActions')}
                aria-label={t('moreActions')}
              />
            }
          >
            <DotsThreeIcon aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[248px]">
            <DropdownMenuItem onClick={onCsv}>
              <FileCsvIcon aria-hidden="true" />
              {t('exportCsv')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onShare}>
              <DevicesIcon aria-hidden="true" />
              {t('shareData')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={onToggleLang}
              title={t('langToggleTitle')}
            >
              <TranslateIcon aria-hidden="true" />
              {t('langMenu')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onAbout}>
              <InfoIcon aria-hidden="true" />
              {t('about')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}

export function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  )
  useEffect(() => {
    const m = window.matchMedia(query)
    const on = () => setMatches(m.matches)
    on()
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [query])
  return matches
}
