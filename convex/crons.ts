import { cronJobs } from 'convex/server'
import { internal } from './_generated/api'

const crons = cronJobs()

// An import whose step died stops blocking the queue (convex/imports.ts watchdog).
crons.interval('import watchdog', { minutes: 2 }, internal.imports.watchdog, {})

export default crons
