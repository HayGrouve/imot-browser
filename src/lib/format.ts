import type { Lang } from '../../shared/vocab'

export interface Format {
  locale: string
  num: (n: number | null | undefined, digits?: number) => string
  money: (n: number | null | undefined, currency?: string | null) => string
  /** Signed change, e.g. "−€2,000". */
  delta: (n: number, currency?: string | null) => string
  date: (iso: string | null | undefined, withTime?: boolean) => string
  /** €49,900 → "€50k"; for compact pill labels. */
  shortMoney: (n: number) => string
}

export function makeFormat(lang: Lang): Format {
  const locale = lang === 'bg' ? 'bg-BG' : 'en-GB'
  const numbers = new Map<number, Intl.NumberFormat>()
  const moneys = new Map<string, Intl.NumberFormat>()
  const num = (n: number | null | undefined, digits = 0) => {
    if (n == null || !Number.isFinite(n)) return ''
    let f = numbers.get(digits)
    if (!f) {
      f = new Intl.NumberFormat(locale, { maximumFractionDigits: digits })
      numbers.set(digits, f)
    }
    return f.format(n)
  }
  const money = (n: number | null | undefined, currency?: string | null) => {
    if (n == null || !Number.isFinite(n)) return ''
    const c = currency || 'EUR'
    let f = moneys.get(c)
    if (!f) {
      f = new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: c,
        maximumFractionDigits: 0,
      })
      moneys.set(c, f)
    }
    return f.format(n)
  }
  return {
    locale,
    num,
    money,
    delta: (n, currency) =>
      new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: currency || 'EUR',
        maximumFractionDigits: 0,
        signDisplay: 'exceptZero',
      }).format(n),
    date: (iso, withTime = false) => {
      if (!iso) return ''
      const d = new Date(iso)
      if (Number.isNaN(d.getTime())) return ''
      return d.toLocaleDateString(locale, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
      })
    },
    shortMoney: (n) => {
      if (n >= 1e6) return `€${num(n / 1e6, 2)}M`
      if (n >= 1e4) return `€${num(n / 1e3, 0)}k`
      if (n >= 1e3) return `€${num(n / 1e3, 1)}k`
      return `€${num(n)}`
    },
  }
}
