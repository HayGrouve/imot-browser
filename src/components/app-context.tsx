import { createContext, useContext } from 'react'
import type { Lang } from '../../shared/vocab'
import type { Format } from '#/lib/format'
import type { Params, StringKey } from '#/lib/i18n'

/** What every part of the app reads: it changes only with the language. */
export interface AppContextValue {
  lang: Lang
  t: (key: StringKey, params?: Params) => string
  fmt: Format
  workspace: string
}

export const AppContext = createContext<AppContextValue | null>(null)

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp outside AppContext')
  return ctx
}

/** The marks this browser keeps on listings. Its own context: a star re-renders only what shows marks. */
export interface MarksContextValue {
  stars: ReadonlySet<string>
  toggleStar: (id: string) => void
  hidden: ReadonlySet<string>
  /** Hide a listing from the results, or show it again (with an undo toast). */
  toggleHidden: (id: string) => void
  notes: Readonly<Record<string, string>>
  setNote: (id: string, text: string) => void
}

export const MarksContext = createContext<MarksContextValue | null>(null)

export function useMarks(): MarksContextValue {
  const ctx = useContext(MarksContext)
  if (!ctx) throw new Error('useMarks outside MarksContext')
  return ctx
}

/** An error's wording: a known code in the reader's language, else the message. */
export function errorText(t: AppContextValue['t'], err: unknown): string {
  const data = (err as { data?: unknown } | null)?.data
  const code =
    data && typeof data === 'object' && 'code' in data
      ? String(data.code)
      : (err as { code?: unknown } | null)?.code
  if (typeof code === 'string') {
    const key = `err_${code}`
    const text = t(key)
    if (text !== key) return text
  }
  if (data && typeof data === 'object' && 'message' in data)
    return String(data.message)
  return err instanceof Error ? err.message : String(err)
}

export function errorCode(err: unknown): string | null {
  const data = (err as { data?: unknown } | null)?.data
  if (data && typeof data === 'object' && 'code' in data)
    return String(data.code)
  return null
}
