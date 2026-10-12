import { createContext, useContext } from 'react'
import type { Lang } from '../../shared/vocab'
import type { Format } from '#/lib/format'
import type { Params, StringKey } from '#/lib/i18n'

export interface AppContextValue {
  lang: Lang
  t: (key: StringKey, params?: Params) => string
  fmt: Format
  workspace: string
  stars: ReadonlySet<string>
  toggleStar: (id: string) => void
  hidden: ReadonlySet<string>
  /** Hide a listing from the results, or show it again (with an undo toast). */
  toggleHidden: (id: string) => void
  notes: Readonly<Record<string, string>>
  setNote: (id: string, text: string) => void
}

export const AppContext = createContext<AppContextValue | null>(null)

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp outside AppContext')
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
