// The `limitedSeats` seam: the ONE module that reads or writes a Limited
// Event seat's heavy card payload (`pool`/`currentPack`/`packQueue`/
// `poolArrangement`), which lives in its own table rather than inline on the
// event row — see `convex/schema.ts`'s `limitedSeats` comment for why (Convex
// bills a read by the whole document's bytes, and a 48 KB event row was being
// re-read by list queries that project none of it, once per draft pick).
//
// Everything above this seam keeps working against a plain reassembled
// `LimitedEventSeat[]`, exactly the shape the pure `convex/limited/**` modules
// (`draftEngine.ts`, `eventLogic.ts`, `eventProjection.ts`, `poolResolution.ts`)
// already expect. Those modules stay Convex-free and untouched; this module is
// the only place that knows the payload is stored separately.
//
// Legacy tolerance: an event row written BEFORE the split still carries its
// payload inline on `seats[]`. Every read here folds an inline copy in when no
// child row exists, so un-migrated events keep working un-migrated
// (`migrateSeatPayload` in `convex/limitedEvents.ts` moves them at leisure).
//
// This module is ALSO the intern/expand boundary for the card payload itself
// (issue #2507), the same shape `compactState`/`expandState`
// (`convex/gre/serialize.ts`, PRD #1776 T5) give a persisted `GameState`. A
// stored card is just its `scryfallId` (+ `pickId` for a pack card); the
// `cardId`/`cardName` every consumer reads are RESOLVED on the way out, by the
// very lookup that produced them (`convex/limitedCardMeta.ts`). Storing a
// lookup's output beside its input cost ~3.8 KB of the 6.3 KB average row, on
// a table `submitPick` reads all 8 seats of per pick.
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type {
    DraftPackCard,
    LimitedEventSeat,
    LimitedPoolCard,
} from "./limited/eventTypes";
import { resolveCardMeta } from "./limitedCardMeta";

/** The four fields that live in `limitedSeats`. Named once so the split's
 *  membership is stated in exactly one place — adding a fifth heavy field
 *  means adding it here, to the schema, and nowhere else. */
const PAYLOAD_KEYS = [
    "pool",
    "currentPack",
    "packQueue",
    "poolArrangement",
] as const;

type PayloadKey = (typeof PAYLOAD_KEYS)[number];
type SeatPayload = Pick<LimitedEventSeat, PayloadKey>;

/** One Pool card AS STORED (issue #2507): `scryfallId` is the only card
 *  identity persisted. `cardId`/`cardName` are LEGACY — written before the
 *  intern, still read (and preferred when present, so a stored row's card
 *  identity never changes underneath an in-flight draft). */
interface StoredPoolCard {
    scryfallId: string;
    cardId?: string;
    cardName?: string;
}

/** One pack card as stored: a {@link StoredPoolCard} plus the `pickId` that
 *  disambiguates duplicate prints within a booster. `pickId` is NOT derivable
 *  from anything and is therefore stored, unlike the other two. */
interface StoredPackCard extends StoredPoolCard {
    pickId: string;
}

/** The `limitedSeats` row's payload as it comes back from the database. */
interface StoredPayload {
    pool?: StoredPoolCard[];
    currentPack?: StoredPackCard[];
    packQueue?: StoredPackCard[][];
    poolArrangement?: LimitedEventSeat["poolArrangement"];
}

/** The seat shape as stored on the event row: identity + small mutable state,
 *  with the payload keys absent (legacy rows aside). */
type StoredSeat = Doc<"limitedEvents">["seats"][number];

function pickPayload(seat: Partial<StoredPayload>): StoredPayload {
    const payload: StoredPayload = {};
    for (const key of PAYLOAD_KEYS) {
        const value = seat[key];
        if (value !== undefined) {
            // Each key's value type is distinct; the loop is the point (one
            // membership list, no four-way copy-paste), so assign through the
            // union rather than repeating the field names.
            (payload as Record<string, unknown>)[key] = value;
        }
    }
    return payload;
}

/** Rebuilds a stored card's `cardId`/`cardName` from its `scryfallId`.
 *
 *  The fallback expression is the producers' own, VERBATIM — `generateSealedPools`
 *  (`convex/limited/eventLogic.ts`), `generateRoundPacks` and
 *  `generateCubeRoundPacks` (`convex/limited/draftEngine.ts`) all write
 *  `meta?.cardId ?? drawn.scryfallId` / `meta?.cardName ?? drawn.scryfallId`,
 *  so a card the registry cannot resolve was ALREADY stored with
 *  `cardId === cardName === scryfallId` and expansion reproduces exactly that.
 *  It must: `poolFromLimitedPoolCards` (`convex/limited/poolResolution.ts`)
 *  dedups the Pool multiset by `cardId`, so a card that changed id between
 *  write and read — or vanished behind a `null`/placeholder — would corrupt a
 *  player's Pool rather than merely look wrong. Fail-closed here means "keep
 *  the card, with the identity the producer gave it", never "drop it".
 *
 *  A legacy row's own `cardId`/`cardName` WIN over a fresh resolve: they are
 *  what that draft has been running on, and a catalogue rename mid-draft must
 *  not reshuffle an existing Pool Arrangement. */
function expandPoolCard(stored: StoredPoolCard): LimitedPoolCard {
    if (stored.cardId !== undefined && stored.cardName !== undefined) {
        return {
            scryfallId: stored.scryfallId,
            cardId: stored.cardId,
            cardName: stored.cardName,
        };
    }
    const meta = resolveCardMeta(stored.scryfallId);
    return {
        scryfallId: stored.scryfallId,
        cardId: meta?.cardId ?? stored.scryfallId,
        cardName: meta?.cardName ?? stored.scryfallId,
    };
}

function expandPackCard(stored: StoredPackCard): DraftPackCard {
    return { ...expandPoolCard(stored), pickId: stored.pickId };
}

/** Stored payload → the `LimitedEventSeat` shape every consumer above this
 *  seam already expects. `poolArrangement` is carried through untouched: it
 *  keys on `poolIndex`, never on card identity. */
function expandPayload(stored: StoredPayload): SeatPayload {
    const payload: SeatPayload = {};
    if (stored.pool !== undefined)
        payload.pool = stored.pool.map(expandPoolCard);
    if (stored.currentPack !== undefined) {
        payload.currentPack = stored.currentPack.map(expandPackCard);
    }
    if (stored.packQueue !== undefined) {
        payload.packQueue = stored.packQueue.map((pack) =>
            pack.map(expandPackCard)
        );
    }
    if (stored.poolArrangement !== undefined) {
        payload.poolArrangement = stored.poolArrangement;
    }
    return payload;
}

/** A seat payload → what actually gets written. Every card entry is rebuilt as
 *  a fresh object literal in a FIXED key order, which is also what makes the
 *  dirty check below safe to run through `JSON.stringify`. */
function internPayload(seat: Partial<StoredPayload>): StoredPayload {
    const payload: StoredPayload = {};
    if (seat.pool !== undefined) {
        payload.pool = seat.pool.map((c) => ({ scryfallId: c.scryfallId }));
    }
    if (seat.currentPack !== undefined) {
        payload.currentPack = seat.currentPack.map((c) => ({
            scryfallId: c.scryfallId,
            pickId: c.pickId,
        }));
    }
    if (seat.packQueue !== undefined) {
        payload.packQueue = seat.packQueue.map((pack) =>
            pack.map((c) => ({ scryfallId: c.scryfallId, pickId: c.pickId }))
        );
    }
    if (seat.poolArrangement !== undefined) {
        payload.poolArrangement = seat.poolArrangement;
    }
    return payload;
}

/** True when nothing in this payload still carries a resolved `cardId` /
 *  `cardName` — i.e. the row is already interned.
 *
 *  This is the marker the intern uses in place of `expandState`'s `v === 2`
 *  version stamp (`convex/gre/serialize.ts`): the absence of the derived
 *  fields IS the version, because they are the only thing the intern removed
 *  and nothing writes them any more. */
function isInterned(stored: StoredPayload): boolean {
    const cards: StoredPoolCard[] = [
        ...(stored.pool ?? []),
        ...(stored.currentPack ?? []),
        ...(stored.packQueue ?? []).flat(),
    ];
    return cards.every(
        (c) => c.cardId === undefined && c.cardName === undefined
    );
}

/** True when the two payloads are identical — the dirty check that keeps a
 *  Pick from rewriting all 8 seats' card data. Deep-compares by serialisation:
 *  the payload is plain JSON data (no dates, no undefined-vs-missing
 *  distinction that survives a DB round trip), the arrays are at most a few
 *  hundred small objects, and the alternative — a hand-written structural
 *  compare per field — is more code to get subtly wrong. Both sides are always
 *  passed through `internPayload` first, so key order is fixed by construction
 *  and cannot make two equal payloads serialise differently. */
function payloadEquals(a: StoredPayload, b: StoredPayload): boolean {
    for (const key of PAYLOAD_KEYS) {
        if (JSON.stringify(a[key] ?? null) !== JSON.stringify(b[key] ?? null)) {
            return false;
        }
    }
    return true;
}

/** Strips the payload keys off a seat, leaving what the event row stores.
 *  `poolCount` is (re)derived here so the slim row always agrees with the
 *  payload it was split from — the list queries read it INSTEAD of the Pool,
 *  so a stale count would be a visible wrong number, not a silent one. */
function toStoredSeat(seat: LimitedEventSeat): StoredSeat {
    const slim: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(seat)) {
        if ((PAYLOAD_KEYS as readonly string[]).includes(key)) continue;
        // `selectedPickId` lives in `limitedSelections` now, and a hydrated
        // seat carries the value READ from there — writing it back would
        // recreate the inline copy this split removed, and worse, that copy
        // would then out-live a subsequent CLEAR (which deletes the selection
        // row) and silently resurrect a selection the player cancelled.
        if (key === "selectedPickId") continue;
        if (value === undefined) continue;
        slim[key] = value;
    }
    if (seat.pool !== undefined) {
        slim.poolCount = seat.pool.length;
    } else if (seat.poolCount !== undefined) {
        slim.poolCount = seat.poolCount;
    }
    // `LimitedEventSeat.userId` is a plain `string` (the opaque-handle
    // convention, CLAUDE.md) while the schema stores a branded `Id<"users">`.
    // Every seat written back originated from a real id, so this is the same
    // type-level reconciliation `limitedEvents.ts`'s `asDbSeats` performs.
    return slim as unknown as StoredSeat;
}

/** Reads the Selected Card rows for `eventId`, keyed by seat index
 *  (`limitedSelections`, see `convex/schema.ts`).
 *
 *  Narrowing matters more here than it does for the payload: a selection row
 *  is ~100 bytes, so this is not about bytes at all — it is about the READ
 *  SET. A narrowed hydration does point lookups, so the viewer's subscription
 *  depends only on the viewer's own selection row and another seat's click
 *  cannot re-execute it. Collecting the whole range would put every seat back
 *  in each other's invalidation path, which is exactly what splitting the
 *  field off the event row was for. */
async function loadSelections(
    ctx: QueryCtx,
    eventId: Id<"limitedEvents">,
    seatIndexes?: readonly number[]
): Promise<Map<number, string>> {
    const byIndex = new Map<number, string>();
    if (seatIndexes !== undefined) {
        for (const seatIndex of seatIndexes) {
            const row = await ctx.db
                .query("limitedSelections")
                .withIndex("by_event", (q) =>
                    q.eq("eventId", eventId).eq("seatIndex", seatIndex)
                )
                .unique();
            if (row) byIndex.set(seatIndex, row.pickId);
        }
        return byIndex;
    }
    const rows = await ctx.db
        .query("limitedSelections")
        .withIndex("by_event", (q) => q.eq("eventId", eventId))
        .collect();
    for (const row of rows) byIndex.set(row.seatIndex, row.pickId);
    return byIndex;
}

/** Sets or clears one seat's Selected Card. `pickId: null` deletes the row.
 *
 *  The ONLY writer of `limitedSelections`, and deliberately not routed through
 *  `saveSeats`: the point of the split is that a click writes ~100 bytes and
 *  touches no shared document, so it must not drag the event row into the
 *  transaction. (`saveSlimSeats`, the "write back only the event row's slim
 *  seats" helper that used to serve `selectDraftPick`, existed for exactly
 *  this call and went with it.) */
export async function saveSelection(
    ctx: MutationCtx,
    eventId: Id<"limitedEvents">,
    seatIndex: number,
    pickId: string | null
): Promise<void> {
    const row = await ctx.db
        .query("limitedSelections")
        .withIndex("by_event", (q) =>
            q.eq("eventId", eventId).eq("seatIndex", seatIndex)
        )
        .unique();
    if (pickId === null) {
        if (row) await ctx.db.delete(row._id);
        return;
    }
    if (row) {
        // Re-selecting the same card is a no-op rather than a write — the UI
        // sends a click, not a diff.
        if (row.pickId !== pickId) await ctx.db.patch(row._id, { pickId });
        return;
    }
    await ctx.db.insert("limitedSelections", { eventId, seatIndex, pickId });
}

/** Reads the child rows for `eventId`, keyed by seat index — EXPANDED, so
 *  what comes back is the `LimitedEventSeat` payload shape, not the stored
 *  one. Nothing outside this module ever sees a stored card. */
async function loadPayloads(
    ctx: QueryCtx,
    eventId: Id<"limitedEvents">,
    seatIndexes?: readonly number[]
): Promise<Map<number, SeatPayload>> {
    const byIndex = new Map<number, SeatPayload>();
    // A targeted hydration (the common case: just the viewer's own seat) does
    // point lookups on the full `(eventId, seatIndex)` index instead of
    // reading every seat of the event — the whole reason the index carries
    // both components.
    if (seatIndexes !== undefined) {
        for (const seatIndex of seatIndexes) {
            const row = await ctx.db
                .query("limitedSeats")
                .withIndex("by_event", (q) =>
                    q.eq("eventId", eventId).eq("seatIndex", seatIndex)
                )
                .unique();
            if (row) byIndex.set(seatIndex, expandPayload(pickPayload(row)));
        }
        return byIndex;
    }
    const rows = await ctx.db
        .query("limitedSeats")
        .withIndex("by_event", (q) => q.eq("eventId", eventId))
        .collect();
    for (const row of rows) {
        byIndex.set(row.seatIndex, expandPayload(pickPayload(row)));
    }
    return byIndex;
}

/** Reassembles `event.seats` with the heavy payload folded back in.
 *
 *  `seatIndexes` limits hydration to the seats whose payload the caller will
 *  actually read — pass it whenever you know (the draft board needs only the
 *  viewer's seat; a list needs none at all). Every other seat comes back slim,
 *  which is not a lie the type system can express: `pool`/`currentPack` are
 *  already optional on `LimitedEventSeat` and absent means "nothing there" to
 *  every existing reader. That makes a too-narrow hydration a REAL risk —
 *  under-hydrating reads as an empty Pool rather than an error — so callers
 *  that run the pure engine (which passes packs between seats) must hydrate
 *  everything, and only read-side projections may narrow. */
export async function hydrateSeats(
    ctx: QueryCtx,
    event: Doc<"limitedEvents">,
    seatIndexes?: readonly number[]
): Promise<LimitedEventSeat[]> {
    const payloads = await loadPayloads(ctx, event._id, seatIndexes);
    const selections = await loadSelections(ctx, event._id, seatIndexes);
    return event.seats.map((seat) => {
        const stored = seat as unknown as LimitedEventSeat;
        // A selection row wins over the inline legacy copy; absent means no
        // selection, and for a seat left slim by a narrowed hydration it also
        // means "not loaded", which reads the same way to every consumer as
        // the stripped payload does.
        const selectedPickId =
            selections.get(seat.seatIndex) ?? stored.selectedPickId;
        if (
            seatIndexes !== undefined &&
            !seatIndexes.includes(seat.seatIndex)
        ) {
            // Deliberately left slim — strip any legacy inline payload too, so
            // a narrowed hydration behaves identically on migrated and
            // un-migrated rows (otherwise an old row would leak another seat's
            // Pool into a projection that assumes it isn't there).
            // `selectedPickId` is stripped on the same grounds: an
            // un-migrated row must not leak another seat's tentative pick
            // where a migrated one shows nothing.
            const {
                pool,
                currentPack,
                packQueue,
                poolArrangement,
                selectedPickId: _selected,
                ...rest
            } = stored;
            void pool;
            void currentPack;
            void packQueue;
            void poolArrangement;
            void _selected;
            return rest;
        }
        const payload = payloads.get(seat.seatIndex);
        // No child row: either a seat whose payload has never been written, or
        // an un-migrated legacy row still carrying it inline. `stored` already
        // holds the inline copy in the latter case, so falling through to it
        // is exactly right for both.
        return {
            ...stored,
            ...(payload ?? {}),
            ...(selectedPickId === undefined ? {} : { selectedPickId }),
        };
    });
}

/** Convenience for the single-seat read path (deck legality, pool resolution):
 *  hydrates ONLY `seatIndex`. */
export async function hydrateSeat(
    ctx: QueryCtx,
    event: Doc<"limitedEvents">,
    seatIndex: number
): Promise<LimitedEventSeat[]> {
    return hydrateSeats(ctx, event, [seatIndex]);
}

/** Writes `seats` back: the slim seats onto the event row, each seat's payload
 *  into its `limitedSeats` row — skipping any child row whose payload is
 *  byte-identical to what's stored, so a Pick rewrites the one or two seats it
 *  touched rather than all 8.
 *
 *  `extraPatch` carries any other event-row fields the caller is changing in
 *  the same transaction (`draftRound`, `updatedAt`, …) so there is exactly one
 *  patch of the event row per mutation.
 *
 *  MUST be given the FULL seat array — the same one a hydration returned,
 *  mutated. Handing it a narrowly-hydrated array would write those seats' slim
 *  (payload-less) shape over real Pools; every caller that writes therefore
 *  hydrates in full. */
export async function saveSeats(
    ctx: MutationCtx,
    eventId: Id<"limitedEvents">,
    seats: LimitedEventSeat[],
    extraPatch: Partial<Omit<Doc<"limitedEvents">, "_id" | "seats">> = {}
): Promise<void> {
    const existing = await ctx.db
        .query("limitedSeats")
        .withIndex("by_event", (q) => q.eq("eventId", eventId))
        .collect();
    const rowByIndex = new Map(existing.map((row) => [row.seatIndex, row]));

    for (const seat of seats) {
        const payload = internPayload(seat);
        const row = rowByIndex.get(seat.seatIndex);
        if (!row) {
            // Don't create a row for a seat that has no payload yet (an open
            // event's empty seats) — an event that never starts then costs
            // nothing beyond its own row.
            if (PAYLOAD_KEYS.every((key) => payload[key] === undefined)) {
                continue;
            }
            await ctx.db.insert("limitedSeats", {
                eventId,
                seatIndex: seat.seatIndex,
                ...payload,
            });
            continue;
        }
        const stored = pickPayload(row);
        // A row still carrying `cardId`/`cardName` is rewritten even when the
        // cards themselves are unchanged — that read-repair IS the intern
        // backfill, and it is idempotent because the rewritten row then
        // satisfies `isInterned` and compares equal on every later save.
        if (
            isInterned(stored) &&
            payloadEquals(internPayload(stored), payload)
        ) {
            continue;
        }
        // `replace`, not `patch`: a field going from present to ABSENT (a
        // Draft seat's `currentPack` clearing when its pack empties) has to
        // actually disappear, and `patch` with an absent key is a no-op.
        await ctx.db.replace(row._id, {
            eventId,
            seatIndex: seat.seatIndex,
            ...payload,
        });
    }

    await ctx.db.patch(eventId, {
        ...extraPatch,
        seats: seats.map(toStoredSeat),
    });
}

/** Does this event row still carry its payload inline (written before the
 *  split)? */
export function eventHasInlinePayload(event: Doc<"limitedEvents">): boolean {
    return event.seats.some((seat) =>
        PAYLOAD_KEYS.some(
            (key) => (seat as Record<string, unknown>)[key] !== undefined
        )
    );
}

/** Read-repair: moves a legacy event's inline payload into `limitedSeats` and
 *  rewrites the event row slim, returning the row as it now stands.
 *
 *  Every write path that rewrites `seats` goes through this FIRST, because the
 *  slim write helpers below strip the payload keys unconditionally — on an
 *  un-migrated row that would delete Pools rather than relocate them. Making
 *  the repair a precondition rather than a special case inside each helper is
 *  what keeps "a slim write never loses cards" true by construction.
 *  Idempotent, and a no-op (one comparison, no writes) for the already-split
 *  rows that are the overwhelmingly common case. */
export async function ensureSeatsMigrated(
    ctx: MutationCtx,
    event: Doc<"limitedEvents">
): Promise<Doc<"limitedEvents">> {
    if (!eventHasInlinePayload(event)) return event;
    const seats = event.seats as unknown as LimitedEventSeat[];
    await saveSeats(ctx, event._id, seats);
    const migrated = await ctx.db.get(event._id);
    if (!migrated) throw new Error("Event vanished mid-migration");
    return migrated;
}

/** Writes a partial payload update for ONE seat, reading and writing only that
 *  seat's child row.
 *
 *  For the single-seat edits that fire at UI cadence — a pool-arrangement drag
 *  — where `saveSeats` would read all 8 seats' payloads to discover 7 of them
 *  are unchanged. `patch` is MERGED over the seat's current payload, so a
 *  caller supplying just `poolArrangement` leaves the Pool alone. */
export async function saveSeatPayload(
    ctx: MutationCtx,
    event: Doc<"limitedEvents">,
    seatIndex: number,
    patch: SeatPayload,
    extraPatch: Partial<Omit<Doc<"limitedEvents">, "_id" | "seats">> = {}
): Promise<void> {
    const migrated = await ensureSeatsMigrated(ctx, event);
    const eventId = migrated._id;
    const row = await ctx.db
        .query("limitedSeats")
        .withIndex("by_event", (q) =>
            q.eq("eventId", eventId).eq("seatIndex", seatIndex)
        )
        .unique();
    // Expand-then-intern rather than merging over the raw stored payload: the
    // patch arrives in the hydrated (`LimitedEventSeat`) shape, and a legacy
    // row merged with it raw would leave the untouched keys fat.
    const next = internPayload({
        ...(row ? expandPayload(pickPayload(row)) : {}),
        ...patch,
    });
    if (row) {
        await ctx.db.replace(row._id, { eventId, seatIndex, ...next });
    } else {
        await ctx.db.insert("limitedSeats", { eventId, seatIndex, ...next });
    }
    if (Object.keys(extraPatch).length > 0) {
        await ctx.db.patch(eventId, extraPatch);
    }
}

/** Does this `limitedSeats` row still store `cardId`/`cardName` beside the
 *  `scryfallId` they are derived from (written before the intern, issue
 *  #2507)? The predicate the eager backfill selects on — the read-repair in
 *  `saveSeats` handles the same rows lazily, but only for events still being
 *  written to. */
export function seatRowNeedsInterning(row: Doc<"limitedSeats">): boolean {
    return !isInterned(pickPayload(row));
}

/** Rewrites one `limitedSeats` row with its card payload interned, leaving
 *  everything else (including `poolArrangement`) byte-identical.
 *
 *  Idempotent by construction: the rewritten row fails
 *  {@link seatRowNeedsInterning}, so a second pass skips it and writes
 *  nothing. */
export async function internSeatRow(
    ctx: MutationCtx,
    row: Doc<"limitedSeats">
): Promise<void> {
    await ctx.db.replace(row._id, {
        eventId: row.eventId,
        seatIndex: row.seatIndex,
        ...internPayload(pickPayload(row)),
    });
}

/** Deletes every `limitedSeats` row of an event — for the event's own
 *  deletion (cancel / GC), which would otherwise orphan the payload. */
export async function deleteSeats(
    ctx: MutationCtx,
    eventId: Id<"limitedEvents">
): Promise<void> {
    const rows = await ctx.db
        .query("limitedSeats")
        .withIndex("by_event", (q) => q.eq("eventId", eventId))
        .collect();
    for (const row of rows) await ctx.db.delete(row._id);
    const selections = await ctx.db
        .query("limitedSelections")
        .withIndex("by_event", (q) => q.eq("eventId", eventId))
        .collect();
    for (const row of selections) await ctx.db.delete(row._id);
}
