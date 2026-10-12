import { defineConfig } from 'vitest/config'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'

const isVitest = Boolean(process.env.VITEST)

// Map tiles and listing photos come from these hosts; Convex is the only API.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data: blob: https://*.focus.bg https://*.imot.bg https://server.arcgisonline.com https://tile.openstreetmap.org https://*.tile.opentopomap.org",
  "connect-src 'self' https://*.convex.cloud wss://*.convex.cloud",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ')

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '.worktrees/**'],
    // Convex function tests (`convex/*.test.ts`) run on convex-test.
    server: { deps: { inline: ['convex-test'] } },
  },
  plugins: [
    tailwindcss(),
    tanstackStart({ spa: { enabled: true } }),
    // Nitro's server runtime is for dev and build only. Under Vitest it loads
    // CJS React in an ESM runner and keeps the process alive.
    ...(isVitest
      ? []
      : [
          nitro({
            preset: 'vercel',
            routeRules: {
              '/**': {
                headers: {
                  'X-Frame-Options': 'DENY',
                  'X-Content-Type-Options': 'nosniff',
                  'Referrer-Policy': 'strict-origin-when-cross-origin',
                  'Permissions-Policy':
                    'camera=(), microphone=(), geolocation=()',
                  'Content-Security-Policy': CONTENT_SECURITY_POLICY,
                },
              },
            },
          }),
        ]),
    viteReact(),
  ],
})
