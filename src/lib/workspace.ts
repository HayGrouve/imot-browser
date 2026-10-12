// The browser's workspace: a random key made on the first visit. There is no
// sign-in yet, so whoever has the key has the listings; a link with ?w=<key>
// opens the same listings on another device, and &v=<view> the view they were
// shared with (src/lib/share.ts).

import { loadJson, saveJson } from './storage'
import { decodeView, encodeView } from './share'
import type { SharedView } from './share'

const VALID = /^[A-Za-z0-9_-]{16,64}$/

export function resolveWorkspace(): {
  key: string
  switched: boolean
  view: SharedView | null
} {
  let key = loadJson<string | null>('workspace', null)
  let switched = false
  const url = new URL(window.location.href)
  const fromLink = url.searchParams.get('w')
  let view: SharedView | null = null
  if (fromLink !== null) {
    if (VALID.test(fromLink) && fromLink !== key) {
      key = fromLink
      switched = true
      saveJson('workspace', key)
    }
    if (VALID.test(fromLink)) view = decodeView(url.searchParams.get('v'))
    url.searchParams.delete('w')
    url.searchParams.delete('v')
    window.history.replaceState(null, '', url)
  }
  if (!key || !VALID.test(key)) {
    key = crypto.randomUUID()
    saveJson('workspace', key)
  }
  return { key, switched, view }
}

export function workspaceLink(key: string, view?: SharedView): string {
  const link = `${window.location.origin}/?w=${encodeURIComponent(key)}`
  return view ? `${link}&v=${encodeView(view)}` : link
}
