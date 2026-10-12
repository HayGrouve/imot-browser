import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'
import {
  heavyFields,
  jobInputV,
  jobPhaseV,
  jobStatusV,
  logParamsV,
  nbhdV,
  optionsV,
  placeV,
  pricePointV,
  progressV,
  resultV,
  slimFields,
} from './validators'

/**
 * Everything belongs to a workspace: a random key the browser makes on its
 * first visit (there is no sign-in yet). The caches are shared.
 */
export default defineSchema({
  workspaces: defineTable({
    key: v.string(),
    listingCount: v.number(),
    /** Bumped when listings change in bulk, so open browsers reload them. */
    dataVersion: v.number(),
    /** Set while "Delete all data" or removing a search is still deleting. */
    deleting: v.optional(v.boolean()),
  }).index('by_key', ['key']),

  /** Imported searches (and "manual" for listing links pasted one by one). */
  sources: defineTable({
    workspace: v.string(),
    key: v.string(),
    url: v.union(v.null(), v.string()),
    input: v.string(),
    paramsText: v.string(),
    total: v.union(v.null(), v.number()),
    capped: v.boolean(),
    found: v.number(),
    splits: v.number(),
    lastImportAt: v.string(),
    prevImportAt: v.optional(v.string()),
  }).index('by_workspace_key', ['workspace', 'key']),

  /** One row per listing: what the list, the map and the filters read. */
  listings: defineTable({
    workspace: v.string(),
    imotId: v.string(),
    ...slimFields,
    place: v.union(v.null(), placeV),
    nbhd: v.union(v.null(), nbhdV),
    firstSeen: v.string(),
    lastSeen: v.string(),
    sources: v.array(v.string()),
    priceHistory: v.array(pricePointV),
    /** Photos stored in listingDetails, so an import can tell if they were missed. */
    photosStored: v.number(),
    /** Latin-only text the search box matches (shared/listing.ts searchTextOf). */
    searchText: v.string(),
    lastJob: v.optional(v.id('imports')),
  })
    .index('by_workspace_imot', ['workspace', 'imotId'])
    .index('by_lastJob', ['lastJob']),

  /** The heavy part of a listing, read when it is opened. */
  listingDetails: defineTable({
    workspace: v.string(),
    imotId: v.string(),
    ...heavyFields,
  }).index('by_workspace_imot', ['workspace', 'imotId']),

  imports: defineTable({
    workspace: v.string(),
    status: jobStatusV,
    phase: jobPhaseV,
    /** The import's timestamp (ISO): first/last seen and price history use it. */
    now: v.string(),
    startedAt: v.optional(v.number()),
    finishedAt: v.optional(v.number()),
    heartbeatAt: v.number(),
    options: optionsV,
    inputs: v.array(jobInputV),
    progress: progressV,
    result: resultV,
    warnings: v.number(),
    /** Listing pages that could not be read (the first 5 are logged). */
    detailFailures: v.number(),
    error: v.optional(v.object({ code: v.string(), message: v.string() })),
    cancelRequested: v.boolean(),
    /** For a search from the dialog: the link imot.bg built for it. */
    searchUrl: v.optional(v.string()),
  })
    .index('by_status', ['status'])
    .index('by_workspace', ['workspace']),

  importLogs: defineTable({
    job: v.id('imports'),
    t: v.number(),
    code: v.string(),
    params: logParamsV,
  }).index('by_job', ['job']),

  /** Listing pages an import still has to read. */
  importItems: defineTable({
    job: v.id('imports'),
    imotId: v.string(),
    url: v.string(),
    manual: v.boolean(),
    claimed: v.boolean(),
  }).index('by_job_claimed', ['job', 'claimed']),

  /** OpenStreetMap Nominatim answers (its usage policy asks for caching). */
  geocache: defineTable({
    query: v.string(),
    results: v.array(
      v.object({
        lat: v.number(),
        lon: v.number(),
        type: v.string(),
        addresstype: v.string(),
        name: v.string(),
        display: v.string(),
      }),
    ),
  }).index('by_query', ['query']),

  /** imot.bg's search form, parsed (JSON), per deal and place. */
  searchForms: defineTable({
    key: v.string(),
    form: v.string(),
    fetchedAt: v.number(),
  }).index('by_key', ['key']),
})
