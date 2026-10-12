import rateLimiter from '@convex-dev/rate-limiter/convex.config.js'
import { defineApp } from 'convex/server'

const app = defineApp()

// Limits on imports and imot.bg form reads (convex/lib/rateLimit.ts).
app.use(rateLimiter)

export default app
