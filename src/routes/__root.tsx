import { useEffect, useState } from 'react'
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
} from '@tanstack/react-router'
import { ConvexProvider, ConvexReactClient } from 'convex/react'
import { Toaster } from '#/components/ui/sonner'
import { TooltipProvider } from '#/components/ui/tooltip'
import appCss from '../styles.css?url'

const CONVEX_URL = import.meta.env.VITE_CONVEX_URL as string | undefined
const convex = CONVEX_URL ? new ConvexReactClient(CONVEX_URL) : null

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1, viewport-fit=cover',
      },
      { name: 'color-scheme', content: 'light dark' },
      {
        name: 'theme-color',
        content: '#fcfcfc',
        media: '(prefers-color-scheme: light)',
      },
      {
        name: 'theme-color',
        content: '#131316',
        media: '(prefers-color-scheme: dark)',
      },
      { title: 'Онова за имотите' },
      {
        name: 'description',
        content:
          'Търси в imot.bg и разгледай всички намерени обяви в списък и на карта, с филтри, цени на м² и история на цените.',
      },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
    ],
  }),
  component: RootLayout,
  shellComponent: RootDocument,
})

function RootLayout() {
  // The SPA shell is prerendered without a browser, so the app renders once mounted.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return null
  if (!convex)
    return (
      <p role="alert" className="p-6">
        VITE_CONVEX_URL is not set.
      </p>
    )
  return (
    <ConvexProvider client={convex}>
      <TooltipProvider>
        <Outlet />
        <Toaster position="bottom-center" />
      </TooltipProvider>
    </ConvexProvider>
  )
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="bg">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}
