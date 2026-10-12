// Writing listings: a fresh search card or a read detail page, merged into
// what the workspace already has (first/last seen, sources, price history).

import type { MutationCtx } from '../_generated/server'
import type { Doc } from '../_generated/dataModel'
import { needsDetails, pickFresh, settleLocation } from '../../shared/importer'
import {
  heavyOf,
  nextPriceHistory,
  searchTextOf,
  slimOf,
  storedSlim,
} from '../../shared/listing'
import type { HeavyFields } from '../../shared/listing'
import type { ListingFields } from '../../shared/types'
import type { ListingFieldsValue, Offline } from '../validators'

/** A workspace may hold this many listings; an import stops adding at the limit. */
export const WORKSPACE_LISTINGS_MAX = 10000

export async function findListing(
  ctx: MutationCtx,
  workspace: string,
  imotId: string,
) {
  return await ctx.db
    .query('listings')
    .withIndex('by_workspace_imot', (q) =>
      q.eq('workspace', workspace).eq('imotId', imotId),
    )
    .unique()
}

export async function findDetails(
  ctx: MutationCtx,
  workspace: string,
  imotId: string,
) {
  return await ctx.db
    .query('listingDetails')
    .withIndex('by_workspace_imot', (q) =>
      q.eq('workspace', workspace).eq('imotId', imotId),
    )
    .unique()
}

function storedHeavy(row: Doc<'listingDetails'> | null): HeavyFields {
  if (!row) return {}
  const { _id, _creationTime, workspace, imotId, ...heavy } = row
  ;(void _id, void _creationTime, void workspace, void imotId)
  return heavy
}

async function writeDetails(
  ctx: MutationCtx,
  workspace: string,
  imotId: string,
  heavy: HeavyFields,
  prev: Doc<'listingDetails'> | null,
) {
  if (!Object.keys(heavy).length) return
  if (prev) await ctx.db.patch('listingDetails', prev._id, heavy)
  else await ctx.db.insert('listingDetails', { workspace, imotId, ...heavy })
}

export async function removeListing(ctx: MutationCtx, row: Doc<'listings'>) {
  const details = await findDetails(ctx, row.workspace, row.imotId)
  if (details) await ctx.db.delete('listingDetails', details._id)
  await ctx.db.delete('listings', row._id)
}

export interface Card {
  fields: ListingFieldsValue
  /** The searches (or `manual`) that found it in this import. */
  sources: Array<string>
  manual: boolean
  offline: Offline
}

export type CardOutcome =
  | { kind: 'skipped' }
  | {
      kind: 'saved'
      added: boolean
      priceChanged: boolean
      needsDetails: boolean
      reused: boolean
    }

/**
 * Save a search card (or a pasted listing link). A listing whose page was read before keeps
 * that page's fields; the card only refreshes what it knows better (price, promo, photo…).
 */
export async function saveCard(
  ctx: MutationCtx,
  job: Doc<'imports'>,
  card: Card,
  room: boolean,
): Promise<CardOutcome> {
  const f = card.fields as ListingFields
  const prev = await findListing(ctx, job.workspace, f.id)
  if (!prev && !room) return { kind: 'skipped' }
  const prevDetails = prev ? await findDetails(ctx, job.workspace, f.id) : null
  const reuse = !!prev?.detailsFetchedAt && !card.manual
  const fields = reuse ? pickFresh(f) : f
  const slim = { ...(prev ? storedSlim(prev) : {}), ...slimOf(fields) }
  const fresh = reuse ? {} : heavyOf(fields)
  const heavy = { ...storedHeavy(prevDetails), ...fresh }
  const location = settleLocation(
    card.offline,
    slim.neighborhood,
    prev ? { place: prev.place, nbhd: prev.nbhd } : null,
  )
  const need = needsDetails(
    f,
    prev
      ? {
          price: prev.price ?? null,
          detailsFetchedAt: prev.detailsFetchedAt ?? null,
          photosStored: prev.photosStored,
        }
      : null,
    { manual: card.manual, details: job.options.details, now: job.now },
  )
  const row = {
    ...slim,
    place: location.place,
    nbhd: location.nbhd,
    firstSeen: prev?.firstSeen ?? job.now,
    lastSeen: job.now,
    sources: [...new Set([...(prev?.sources ?? []), ...card.sources])],
    priceHistory: nextPriceHistory(
      prev?.priceHistory ?? [],
      slim.price,
      slim.currency,
      job.now,
    ),
    photosStored: heavy.photos?.length ?? 0,
    searchText: searchTextOf(f.id, slim, heavy, location.place),
    lastJob: job._id,
  }
  if (prev) await ctx.db.patch('listings', prev._id, row)
  else
    await ctx.db.insert('listings', {
      workspace: job.workspace,
      imotId: f.id,
      ...row,
    })
  await writeDetails(ctx, job.workspace, f.id, fresh, prevDetails)
  return {
    kind: 'saved',
    added: !prev,
    priceChanged:
      prev?.price != null && f.price != null && prev.price !== f.price,
    needsDetails: need,
    reused: reuse && !need,
  }
}

/** Save a listing's page, read and merged over its card by the importer. */
export async function saveDetailPage(
  ctx: MutationCtx,
  job: Doc<'imports'>,
  fields: ListingFieldsValue,
  offline: Offline,
): Promise<void> {
  const f = fields as ListingFields
  const prev = await findListing(ctx, job.workspace, f.id)
  if (!prev) return // removed meanwhile
  const prevDetails = await findDetails(ctx, job.workspace, f.id)
  const slim = { ...storedSlim(prev), ...slimOf(f) }
  const fresh = heavyOf(f)
  const heavy = { ...storedHeavy(prevDetails), ...fresh }
  const location = settleLocation(offline, slim.neighborhood, {
    place: prev.place,
    nbhd: prev.nbhd,
  })
  await ctx.db.patch('listings', prev._id, {
    ...slim,
    place: location.place,
    nbhd: location.nbhd,
    lastSeen: job.now,
    priceHistory: nextPriceHistory(
      prev.priceHistory,
      slim.price,
      slim.currency,
      job.now,
    ),
    photosStored: heavy.photos?.length ?? 0,
    searchText: searchTextOf(f.id, slim, heavy, location.place),
    lastJob: job._id,
  })
  await writeDetails(ctx, job.workspace, f.id, fresh, prevDetails)
}
