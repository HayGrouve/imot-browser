// Only ever render links and images that point at imot.bg or its photo CDN.

export const safeUrl = (u: unknown): string | null =>
  typeof u === 'string' &&
  /^https:\/\/([a-z0-9-]+\.)*(imot\.bg|focus\.bg)(\/|$)/i.test(u)
    ? u
    : null

/** Large photo URL -> thumbnail URL. */
export const thumbOf = (url: string | null | undefined): string | null =>
  url ? url.replace(/\/big1?\//, '/') : null

/** Small photo for a listing (its search-card thumbnail). */
export const thumbFor = (l: { thumb?: string | null }): string | null =>
  safeUrl(l.thumb)
