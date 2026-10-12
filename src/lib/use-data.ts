// The workspace's listings and searches: read once, and again whenever the
// backend says they changed in bulk (its dataVersion), as an import saves.
// They are read together, so a search's new import time never meets the
// listings' old "last seen" (which would flag them as no longer listed).

import { useEffect, useState } from 'react'
import { useConvex, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import type { RawListing, Source } from './listings'

const PAGE_SIZE = 500
const NO_SOURCES: Array<Source> = []

export function useWorkspaceData(workspace: string) {
  const convex = useConvex()
  const ws = useQuery(api.workspaces.get, { workspace })
  const [data, setData] = useState<{
    listings: Array<RawListing>
    sources: Array<Source>
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const version =
    ws === undefined ? undefined : ws === null ? -1 : ws.dataVersion

  useEffect(() => {
    if (version === undefined) return
    if (version === -1) {
      setData({ listings: [], sources: [] })
      setError(null)
      return
    }
    const run = { cancelled: false }
    void (async () => {
      const out: Array<RawListing> = []
      let cursor: string | null = null
      for (;;) {
        const page: {
          page: Array<RawListing>
          isDone: boolean
          continueCursor: string
        } = await convex.query(api.listings.page, {
          workspace,
          paginationOpts: { numItems: PAGE_SIZE, cursor },
        })
        out.push(...page.page)
        if (page.isDone) break
        cursor = page.continueCursor
      }
      const sources = await convex.query(api.sources.list, { workspace })
      if (run.cancelled) return
      setData({ listings: out, sources })
      setError(null)
    })().catch((err: unknown) => {
      if (!run.cancelled)
        setError(err instanceof Error ? err.message : String(err))
    })
    return () => {
      run.cancelled = true
    }
  }, [convex, workspace, version])

  return {
    listings: data?.listings ?? null,
    sources: data?.sources ?? NO_SOURCES,
    error,
    deleting: !!ws?.deleting,
  }
}
