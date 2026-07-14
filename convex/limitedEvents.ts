// Limited Event skeleton + Sealed flow (PRD #1107, ADR 0054/0055, issue
// #1110). Every mutation here is a thin DB-read/write shell: the actual
// decisions (seat assignment, bot fill, Sealed Pool generation, the privacy
// projection) are pure functions in `convex/limited/eventLogic.ts` and
// `convex/limited/eventProjection.ts`, so they're unit-testable without a
// convex-test harness (the project has none — see
// `convex/__tests__/adminAuth.test.ts`).
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { assertIsAdmin, getCurrentUser, getCurrentUserId } from "./auth";
import { resolveDeckCardMeta, tryGetDefinition } from "./cards";
import { freshSeed, makeRng } from "./gre/rng";
import { applyPick, startDraft } from "./limited/draftEngine";
import {
    assertDraftSeatsFilled,
    assignFreeSeat,
    buildEmptySeats,
    DEFAULT_SEALED_BOOSTER_COUNT,
    fillBotSeats,
    generateSealedPools,
    type ResolveCardMeta,
} from "./limited/eventLogic";
import { projectLimitedEvent } from "./limited/eventProjection";
import type { LimitedEventSeat } from "./limited/eventTypes";
import {
    getBoosterConfig,
    isDraftableSet,
    listDraftableSets,
} from "./limited/registry";

/** `eventLogic.ts` stays Convex-decoupled: `LimitedEventSeat.userId` is a
 *  plain `string` (mirrors `players[].id`'s opaque-handle convention,
 *  CLAUDE.md), while the schema stores a branded `Id<"users">`. Every seat
 *  this module ever writes back originated from a real `Id<"users">` (either
 *  `getCurrentUser(ctx)._id` or a value already read off the stored row), so
 *  this is a type-level reconciliation only, never an unchecked cast of
 *  client input. */
function asDbSeats(seats: LimitedEventSeat[]): Doc<"limitedEvents">["seats"] {
    return seats as unknown as Doc<"limitedEvents">["seats"];
}

const eventTypeValidator = v.union(v.literal("sealed"), v.literal("draft"));
const eventStatusValidator = v.union(v.literal("open"), v.literal("started"));

const limitedPoolCardValidator = v.object({
    scryfallId: v.string(),
    cardId: v.string(),
    cardName: v.string(),
});

const draftPackCardValidator = v.object({
    scryfallId: v.string(),
    cardId: v.string(),
    cardName: v.string(),
    pickId: v.string(),
});

const limitedEventSeatViewValidator = v.object({
    seatIndex: v.number(),
    userId: v.optional(v.string()),
    nickname: v.optional(v.string()),
    isBot: v.boolean(),
    isViewer: v.boolean(),
    poolCount: v.union(v.number(), v.null()),
    pool: v.union(v.array(limitedPoolCardValidator), v.null()),
    currentPack: v.union(v.array(draftPackCardValidator), v.null()),
    packQueueCount: v.union(v.number(), v.null()),
});

/** Wire shape of `projectLimitedEvent`'s return value — declared once here so
 *  every query below can pin its `returns:` validator to the actual privacy-
 *  stripped view instead of leaving it undeclared. */
const limitedEventViewValidator = v.object({
    _id: v.string(),
    createdBy: v.string(),
    type: eventTypeValidator,
    status: eventStatusValidator,
    seatCount: v.number(),
    packSlots: v.array(v.string()),
    sealedBoosterCount: v.optional(v.number()),
    draftRound: v.optional(v.number()),
    draftPacksRemaining: v.optional(v.number()),
    draftCompletedAt: v.optional(v.number()),
    seats: v.array(limitedEventSeatViewValidator),
    createdAt: v.number(),
    updatedAt: v.number(),
});

const draftableSetInfoValidator = v.object({
    setCode: v.string(),
    draftable: v.boolean(),
    missingCardCount: v.number(),
});

// Bound on the full-table scan `myLimitedEvents` does (no index can select
// "seats containing this userId" — seats is an embedded array). An event pod
// is short-lived and capped at 8 seats; 500 most-recent events comfortably
// covers every event a user could still be seated in.
const MY_EVENTS_SCAN_LIMIT = 500;

/** Resolves a drawn Booster card's Scryfall id to the canonical Card ID +
 *  display name a Pool entry carries (the `ResolveCardMeta` injection
 *  `generateSealedPools` needs) — the only place this module touches the card
 *  registry directly. */
const resolveCardMeta: ResolveCardMeta = (scryfallId) => {
    const def = tryGetDefinition(scryfallId);
    if (!def) return null;
    const meta = resolveDeckCardMeta(scryfallId);
    return meta ? { cardId: meta.cardId, cardName: def.name } : null;
};

// --- Queries ---------------------------------------------------------------

/** Every checked-in Draftable Set plus WHY a non-Draftable one isn't (PRD
 *  #1107 story 4) — feeds the admin create-event Pack Source picker. Any
 *  authenticated user may read it (informational, not admin-gated) so a
 *  non-admin can still see what's playable before an admin sets up an event. */
export const listLimitedDraftableSets = query({
    args: {},
    returns: v.array(draftableSetInfoValidator),
    handler: async (ctx) => {
        await getCurrentUserId(ctx);
        return listDraftableSets();
    },
});

/** Open events (still accepting Seats) — the lobby list (PRD #1107 story 7).
 *  Projected with no viewer identity: an open event has no Pools yet, so
 *  there is nothing to strip. */
export const listOpenLimitedEvents = query({
    args: {},
    returns: v.array(limitedEventViewValidator),
    handler: async (ctx) => {
        await getCurrentUserId(ctx);
        const events = await ctx.db
            .query("limitedEvents")
            .withIndex("by_status", (q) => q.eq("status", "open"))
            .collect();
        return events.map((event) => projectLimitedEvent(event, null));
    },
});

/** Every event (any status) the current user occupies a Seat in — how a
 *  player finds their way back to a started event's Pool view after leaving
 *  the lobby list (which only shows "open" events). No index can select
 *  "seats containing this userId" (seats is an embedded array), so this scans
 *  the `MY_EVENTS_SCAN_LIMIT` most-recently-created events — a bound, not a
 *  true index, but comfortably covers every event a user could still be
 *  seated in. */
export const myLimitedEvents = query({
    args: {},
    returns: v.array(limitedEventViewValidator),
    handler: async (ctx) => {
        const userId = await getCurrentUserId(ctx);
        const events = await ctx.db
            .query("limitedEvents")
            .order("desc")
            .take(MY_EVENTS_SCAN_LIMIT);
        return events
            .filter((event) => event.seats.some((s) => s.userId === userId))
            .map((event) => projectLimitedEvent(event, userId));
    },
});

/** One event, projected for the current viewer — strips every other seat's
 *  Pool (PRD #1107 story 15/26, ADR 0054/0055). */
export const getLimitedEvent = query({
    args: { eventId: v.id("limitedEvents") },
    returns: limitedEventViewValidator,
    handler: async (ctx, args) => {
        const userId = await getCurrentUserId(ctx);
        const event = await ctx.db.get(args.eventId);
        if (!event) throw new Error("Event not found");
        return projectLimitedEvent(event, userId);
    },
});

// --- Mutations ---------------------------------------------------------------

/** Admin-gated (PRD #1107 story 1-6): creates an event with `seatCount` empty
 *  Seats. Every `packSlots` entry must resolve to a currently-Draftable Set —
 *  defense-in-depth behind the admin UI's picker (`listLimitedDraftableSets`
 *  is the reason surfaced there; this is the server-side gate the client
 *  can't bypass). */
export const createLimitedEvent = mutation({
    args: {
        type: eventTypeValidator,
        seatCount: v.number(),
        packSlots: v.array(v.string()),
        sealedBoosterCount: v.optional(v.number()),
    },
    returns: v.id("limitedEvents"),
    handler: async (ctx, args) => {
        const admin = await assertIsAdmin(ctx);

        if (args.packSlots.length === 0) {
            throw new Error(
                "At least one Pack Source (Draftable Set) is required."
            );
        }
        for (const setCode of args.packSlots) {
            if (!isDraftableSet(setCode)) {
                const config = getBoosterConfig(setCode);
                if (!config) {
                    throw new Error(
                        `Unknown set "${setCode}" — no checked-in Booster Config.`
                    );
                }
                throw new Error(
                    `Set "${setCode}" is not a Draftable Set — it has cards with no implemented definition.`
                );
            }
        }

        const seats = buildEmptySeats(args.seatCount);
        const now = Date.now();
        return await ctx.db.insert("limitedEvents", {
            createdBy: admin._id,
            type: args.type,
            status: "open",
            seatCount: args.seatCount,
            packSlots: args.packSlots,
            sealedBoosterCount:
                args.sealedBoosterCount ?? DEFAULT_SEALED_BOOSTER_COUNT,
            seats: asDbSeats(seats),
            createdAt: now,
            updatedAt: now,
        });
    },
});

/** Any authenticated user takes the first free Seat (PRD #1107 story 7). */
export const joinLimitedEvent = mutation({
    args: { eventId: v.id("limitedEvents") },
    returns: v.null(),
    handler: async (ctx, args) => {
        const user = await getCurrentUser(ctx);
        const event = await ctx.db.get(args.eventId);
        if (!event) throw new Error("Event not found");
        if (event.status !== "open") {
            throw new Error("This event has already started.");
        }
        const seats = assignFreeSeat(event.seats, user._id, user.nickname);
        await ctx.db.patch(args.eventId, {
            seats: asDbSeats(seats),
            updatedAt: Date.now(),
        });
        return null;
    },
});

/** The event's creator starts it (PRD #1107 story 1). Sealed: every
 *  still-empty Seat becomes a Bot Drafter (story 8), then every Seat's Pool
 *  is dealt in full (story 17, ADR 0055). Draft: bot drafting is a separate,
 *  unshipped feature (#1113) — no driver ever calls `submitPick` for a bot
 *  seat, so a bot-filled seat would deadlock the draft forever waiting on a
 *  pick that never comes. Draft therefore requires every Seat to already be
 *  human-occupied and does NOT fill bots; round 0's boosters are then dealt
 *  to every Seat's `currentPack` (issue #1112, PRD #1107 stories 10-12).
 *  Both paths use a fresh `seed` stored on the event row so either is
 *  reproducible/replayable. */
export const startLimitedEvent = mutation({
    args: { eventId: v.id("limitedEvents") },
    returns: v.null(),
    handler: async (ctx, args) => {
        const user = await getCurrentUser(ctx);
        const event = await ctx.db.get(args.eventId);
        if (!event) throw new Error("Event not found");
        if (event.createdBy !== user._id) {
            throw new Error("Only the event's creator can start it.");
        }
        if (event.status !== "open") {
            throw new Error("This event has already started.");
        }

        if (event.type === "draft") {
            // Bot drafting is out of scope for #1112 (tracked separately as
            // #1113) — require every seat to be human-occupied before a
            // draft can start; do NOT `fillBotSeats` on this path.
            assertDraftSeatsFilled(event.seats);

            const seed = freshSeed();
            const {
                seats: draftSeats,
                draftRound,
                draftPacksRemaining,
            } = startDraft(
                event.seats,
                event.packSlots,
                seed,
                getBoosterConfig,
                resolveCardMeta
            );
            await ctx.db.patch(args.eventId, {
                seats: asDbSeats(draftSeats),
                status: "started",
                seed,
                draftRound,
                draftPacksRemaining,
                updatedAt: Date.now(),
            });
            return null;
        }

        const seats = fillBotSeats(event.seats);
        const seed = freshSeed();
        const rng = makeRng(seed);
        const seededSeats = generateSealedPools(
            seats,
            event.packSlots,
            event.sealedBoosterCount ?? DEFAULT_SEALED_BOOSTER_COUNT,
            getBoosterConfig,
            resolveCardMeta,
            rng
        );

        await ctx.db.patch(args.eventId, {
            seats: asDbSeats(seededSeats),
            status: "started",
            seed,
            updatedAt: Date.now(),
        });
        return null;
    },
});

/** Submits a Pick for the CALLER's own Seat (issue #1112, PRD #1107 stories
 *  10-13). `seatIndex` is derived server-side from `userId` — never taken
 *  from the client — so a user can only pick from their own seat's current
 *  pack; `applyPick` re-validates `pickId` membership regardless. */
export const submitPick = mutation({
    args: { eventId: v.id("limitedEvents"), pickId: v.string() },
    returns: v.null(),
    handler: async (ctx, args) => {
        const user = await getCurrentUser(ctx);
        const event = await ctx.db.get(args.eventId);
        if (!event) throw new Error("Event not found");
        if (event.type !== "draft") {
            throw new Error("This event is not a Draft.");
        }
        if (event.status !== "started") {
            throw new Error("This event has not started yet.");
        }
        if (event.draftCompletedAt !== undefined) {
            throw new Error("The draft has already finished.");
        }
        if (event.seed === undefined) {
            throw new Error(
                "This event has no RNG seed — it wasn't started via startLimitedEvent."
            );
        }
        const seatIndex = event.seats.findIndex((s) => s.userId === user._id);
        if (seatIndex === -1) {
            throw new Error("You do not have a Seat in this event.");
        }

        const result = applyPick(
            event.seats,
            event.draftRound ?? 0,
            event.draftPacksRemaining ?? event.seats.length,
            event.packSlots,
            seatIndex,
            args.pickId,
            event.seed,
            getBoosterConfig,
            resolveCardMeta
        );

        await ctx.db.patch(args.eventId, {
            seats: asDbSeats(result.seats),
            draftRound: result.draftRound,
            draftPacksRemaining: result.draftPacksRemaining,
            updatedAt: Date.now(),
            ...(result.completed ? { draftCompletedAt: Date.now() } : {}),
        });
        return null;
    },
});
