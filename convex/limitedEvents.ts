// Limited Event skeleton + Sealed flow (PRD #1107, ADR 0054/0055, issue
// #1110). Every mutation here is a thin DB-read/write shell: the actual
// decisions (seat assignment, bot fill, Sealed Pool generation, the privacy
// projection) are pure functions in `convex/limited/eventLogic.ts` and
// `convex/limited/eventProjection.ts`, so they're unit-testable without a
// convex-test harness (the project has none — see
// `convex/__tests__/adminAuth.test.ts`).
import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
    internalMutation,
    mutation,
    query,
    type MutationCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { assertIsAdmin, getCurrentUser, getCurrentUserId } from "./auth";
import { resolveDeckCardMeta, tryGetDefinition } from "./cards";
import { getCardColors } from "./cards/colors";
import { manaValue } from "./gre/constants";
import { freshSeed, makeRng } from "./gre/rng";
import {
    applyPick,
    resolveAutoPickTimeout,
    runBotAutoPicks,
    startDraft,
    type ChooseBotPick,
    type SeatTimerUpdate,
    type TimerConfig,
} from "./limited/draftEngine";
import { chooseBotPick, type GetCardEvalMeta } from "./limited/botDrafter";
import {
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
    pickDeadline: v.union(v.number(), v.null()),
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
    timerSeconds: v.optional(v.number()),
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

/** Resolves a drawn card's Scryfall id to the printed characteristics the Bot
 *  Drafter's Pick Heuristic scores on (issue #1113, PRD #1107 story 29) — the
 *  only place `convex/limited/botDrafter.ts` needs the card registry, kept
 *  out of that module the same way `resolveCardMeta` above is kept out of
 *  `eventLogic.ts`. Rarity comes from the exact printing (`resolveDeckCardMeta`,
 *  CR 206 — a reprint can carry a different rarity than its home set); colors
 *  and mana value come from the resolved `CardDefinition`. */
const getCardEvalMeta: GetCardEvalMeta = (scryfallId) => {
    const meta = resolveDeckCardMeta(scryfallId);
    if (!meta) return null;
    const def = tryGetDefinition(meta.cardId);
    if (!def) return null;
    return {
        cardId: meta.cardId,
        colors: getCardColors(def),
        manaValue: manaValue(def.manaCost),
        rarity: meta.rarity,
    };
};

/** Wires the Pick Heuristic (`convex/limited/botDrafter.ts`) into
 *  `runBotAutoPicks`'s injected `ChooseBotPick` shape — the only place this
 *  module's card-registry-backed `getCardEvalMeta` meets a bot seat's actual
 *  Pool. */
const botChoosePick: ChooseBotPick = (seat, pack) =>
    chooseBotPick(pack, seat.pool ?? [], getCardEvalMeta);

/** Builds the `TimerConfig` `startDraft`/`applyPick`/`runBotAutoPicks` accept
 *  (issue #1114) from an event's stored `timerSeconds`, or `undefined` when
 *  the event has no timer configured — the single point deciding "is the
 *  timer on for this event" so every draft mutation below agrees. `now` is
 *  read ONCE per mutation invocation (never inside the pure engine) so every
 *  deadline stamped within the same call shares one time reference. */
function buildTimerConfig(
    timerSeconds: number | undefined,
    now: number
): TimerConfig | undefined {
    return timerSeconds ? { timerSeconds, now } : undefined;
}

/** Schedules exactly one `autoPickSeatTimeout` Auto-Pick per `updates` entry
 *  (issue #1114) — the ONLY place `ctx.scheduler.runAfter` is called for this
 *  feature. Mirrors the GRE priority-timeout pattern (CLAUDE.md): the
 *  schedule is unconditional (Convex has no cheap "cancel a scheduled job"),
 *  and `autoPickSeatTimeout` re-validates `pickSeq` when it actually fires —
 *  seq-based cancellation, not an explicit cancel call. A no-op for a
 *  timer-off event (`timerSeconds` undefined) since `updates` is always empty
 *  in that case (the pure engine never stamps a seat with no `TimerConfig`). */
async function scheduleSeatTimers(
    ctx: MutationCtx,
    eventId: Id<"limitedEvents">,
    timerSeconds: number | undefined,
    updates: readonly SeatTimerUpdate[]
): Promise<void> {
    if (!timerSeconds || updates.length === 0) return;
    for (const update of updates) {
        await ctx.scheduler.runAfter(
            timerSeconds * 1000,
            internal.limitedEvents.autoPickSeatTimeout,
            {
                eventId,
                seatIndex: update.seatIndex,
                expectedSeq: update.pickSeq,
            }
        );
    }
}

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
        // Per-pick timer, seconds (issue #1114, PRD #1107 story 5: "configure
        // the per-pick timer, or disable it"). Absent/omitted === disabled.
        timerSeconds: v.optional(v.number()),
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
        if (
            args.timerSeconds !== undefined &&
            (!Number.isInteger(args.timerSeconds) || args.timerSeconds <= 0)
        ) {
            throw new Error(
                "The per-pick timer must be a positive whole number of seconds, or omitted to disable it."
            );
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
            timerSeconds: args.timerSeconds,
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
 *  is dealt in full (story 17, ADR 0055). Draft: every still-empty Seat ALSO
 *  becomes a Bot Drafter (issue #1113 — this is what closes the "solo draft,
 *  1 human + 7 bots" primary use case, PRD #1107 story 9); round 0's boosters
 *  are dealt to every Seat's `currentPack` (issue #1112, PRD #1107 stories
 *  10-12), and every bot seat's pending pick is immediately resolved via
 *  `runBotAutoPicks` so the draft never deadlocks waiting on a seat nobody
 *  drives (PRD #1107 story 27: picks happen server-side, no client needed).
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
            const seats = fillBotSeats(event.seats);
            const seed = freshSeed();
            const now = Date.now();
            const timerConfig = buildTimerConfig(event.timerSeconds, now);
            const dealt = startDraft(
                seats,
                event.packSlots,
                seed,
                getBoosterConfig,
                resolveCardMeta,
                timerConfig
            );
            const afterBots = runBotAutoPicks(
                dealt.seats,
                dealt.draftRound,
                dealt.draftPacksRemaining,
                event.packSlots,
                seed,
                getBoosterConfig,
                resolveCardMeta,
                botChoosePick,
                false,
                timerConfig
            );
            await ctx.db.patch(args.eventId, {
                seats: asDbSeats(afterBots.seats),
                status: "started",
                seed,
                draftRound: afterBots.draftRound,
                draftPacksRemaining: afterBots.draftPacksRemaining,
                updatedAt: now,
                ...(afterBots.completed ? { draftCompletedAt: now } : {}),
            });
            await scheduleSeatTimers(ctx, args.eventId, event.timerSeconds, [
                ...dealt.timerUpdates,
                ...afterBots.timerUpdates,
            ]);
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

        const now = Date.now();
        const timerConfig = buildTimerConfig(event.timerSeconds, now);
        const result = applyPick(
            event.seats,
            event.draftRound ?? 0,
            event.draftPacksRemaining ?? event.seats.length,
            event.packSlots,
            seatIndex,
            args.pickId,
            event.seed,
            getBoosterConfig,
            resolveCardMeta,
            timerConfig
        );

        // The human's pick can pass a pack straight onto a bot seat, or empty
        // the round and deal a fresh one into every seat including bots
        // (issue #1113) — resolve every such pending bot pick immediately so
        // the draft never stalls on a seat nobody drives (PRD #1107 story
        // 27). A no-op when no bot seat currently holds a pack.
        const afterBots = runBotAutoPicks(
            result.seats,
            result.draftRound,
            result.draftPacksRemaining,
            event.packSlots,
            event.seed,
            getBoosterConfig,
            resolveCardMeta,
            botChoosePick,
            result.completed,
            timerConfig
        );

        await ctx.db.patch(args.eventId, {
            seats: asDbSeats(afterBots.seats),
            draftRound: afterBots.draftRound,
            draftPacksRemaining: afterBots.draftPacksRemaining,
            updatedAt: now,
            ...(afterBots.completed ? { draftCompletedAt: now } : {}),
        });
        // The human's own pick just superseded any Auto-Pick schedule that
        // was pending for THIS seat (its pickSeq only advances here if it
        // dequeued a new pack — see `assignFreshPack`); a stale schedule from
        // before this call self-invalidates via the seq guard in
        // `autoPickSeatTimeout`, so nothing needs cancelling here — only the
        // freshly-created deadlines from this call need a NEW schedule.
        await scheduleSeatTimers(ctx, args.eventId, event.timerSeconds, [
            ...result.timerUpdates,
            ...afterBots.timerUpdates,
        ]);
        return null;
    },
});

/** Auto-Pick timeout (issue #1114, PRD #1107 stories 5, 14, 16, 27): fires
 *  when a human seat's per-pick timer expires. `internalMutation` — reachable
 *  ONLY via `ctx.scheduler.runAfter` (scheduled by `startLimitedEvent` /
 *  `submitPick` / this mutation itself), never by any client-facing API —
 *  which is what makes "a client can't force an Auto-Pick on another seat"
 *  true by construction: there is no public mutation a client could call to
 *  reach this path for an arbitrary seat.
 *
 *  `expectedSeq` is the seat's `pickSeq` AT SCHEDULING TIME. If the live
 *  value no longer matches — the human already picked, or a previous
 *  Auto-Pick already resolved this exact schedule — `resolveAutoPickTimeout`
 *  returns `null` and this is a no-op (the seq-based cancellation guard,
 *  since Convex has no cheap "cancel a scheduled job" primitive to reach for
 *  instead). Otherwise it picks with the SAME `chooseBotPick` a real Bot
 *  Drafter seat uses (never randomly) and advances the queue exactly like a
 *  human `submitPick` — including resolving any bot picks the Auto-Pick
 *  itself unblocks and scheduling fresh timeouts for whichever human seat(s)
 *  just received a new pack. */
export const autoPickSeatTimeout = internalMutation({
    args: {
        eventId: v.id("limitedEvents"),
        seatIndex: v.number(),
        expectedSeq: v.number(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const event = await ctx.db.get(args.eventId);
        if (!event) return null;
        if (event.type !== "draft" || event.status !== "started") return null;
        if (event.draftCompletedAt !== undefined) return null;
        if (event.seed === undefined || event.timerSeconds === undefined) {
            return null;
        }

        const pickId = resolveAutoPickTimeout(
            event.seats,
            args.seatIndex,
            args.expectedSeq,
            botChoosePick
        );
        if (pickId === null) return null; // stale schedule — no-op

        const now = Date.now();
        const timerConfig = buildTimerConfig(event.timerSeconds, now);
        const result = applyPick(
            event.seats,
            event.draftRound ?? 0,
            event.draftPacksRemaining ?? event.seats.length,
            event.packSlots,
            args.seatIndex,
            pickId,
            event.seed,
            getBoosterConfig,
            resolveCardMeta,
            timerConfig
        );
        const afterBots = runBotAutoPicks(
            result.seats,
            result.draftRound,
            result.draftPacksRemaining,
            event.packSlots,
            event.seed,
            getBoosterConfig,
            resolveCardMeta,
            botChoosePick,
            result.completed,
            timerConfig
        );

        await ctx.db.patch(args.eventId, {
            seats: asDbSeats(afterBots.seats),
            draftRound: afterBots.draftRound,
            draftPacksRemaining: afterBots.draftPacksRemaining,
            updatedAt: now,
            ...(afterBots.completed ? { draftCompletedAt: now } : {}),
        });
        await scheduleSeatTimers(ctx, args.eventId, event.timerSeconds, [
            ...result.timerUpdates,
            ...afterBots.timerUpdates,
        ]);
        return null;
    },
});
