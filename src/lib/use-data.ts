// The workspace's listings: read in pages once, and again whenever the
// backend says they changed in bulk (its dataVersion), as an import saves.

import { useEffect, useState } from 'react'
import { useConvex, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import type { RawListing } from './listings'

const PAGE_SIZE = 500

export function useWorkspaceData(workspace: string) {
  const convex = useConvex()
  const ws = useQuery(api.workspaces.get, { workspace })
  const sources = useQuery(api.sources.list, { workspace })
  const [listings, setListings] = useState<Array<RawListing> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const version =
    ws === undefined ? undefined : ws === null ? -1 : ws.dataVersion

  useEffect(() => {
    if (version === undefined) return
    if (version === -1) {
      setListings([])
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
      if (run.cancelled) return
      setListings(out)
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
    listings,
    sources: sources ?? [],
    error,
    deleting: !!ws?.deleting,
  }
}
