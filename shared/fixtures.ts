// Saved imot.bg pages (windows-1251, as served) for the parser tests.
import { readFileSync } from 'node:fs'

export const fixture = (name: string) =>
  new TextDecoder('windows-1251').decode(
    readFileSync(new URL(`./fixtures/${name}`, import.meta.url)),
  )
