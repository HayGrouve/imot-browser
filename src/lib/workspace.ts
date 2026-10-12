// The browser's workspace: a random key made on the first visit. There is no
// sign-in yet, so whoever has the key has the listings; a link with ?w=<key>
// opens the same listings on another device.

import { loadJson, saveJson } from './storage'

const VALID = /^[A-Za-z0-9_-]{16,64}$/

export function resolveWorkspace(): { key: string; switched: boolean } {
  let key = loadJson<string | null>('workspace', null)
  let switched = false
  const url = new URL(window.location.href)
  const fromLink = url.searchParams.get('w')
  if (fromLink !== null) {
    if (VALID.test(fromLink) && fromLink !== key) {
      key = fromLink
      switched = true
      saveJson('workspace', key)
    }
    url.searchParams.delete('w')
    window.history.replaceState(null, '', url)
  }
  if (!key || !VALID.test(key)) {
    key = crypto.randomUUID()
    saveJson('workspace', key)
  }
  return { key, switched }
}

export function workspaceLink(key: string): string {
  return `${window.location.origin}/?w=${encodeURIComponent(key)}`
}
