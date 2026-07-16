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
    type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { assertIsAdmin, getCurrentUser, getCurrentUserId } from "./auth";
import {
    getCardByName,
    getPrintingsForCard,
    resolveDeckCardMeta,
    tryGetDefinition,
} from "./cards";
import { basicLandsForColors, getCardColors } from "./cards/colors";
import type { Color } from "./cards/types";
import { manaValue } from "./gre/constants";
import { freshSeed, makeRng } from "./gre/rng";
import {
    computeBotAutoBuiltDeck,
    type AutoBuildEventContext,
    type AutoBuiltDeck,
    type GetAutoBuildCardMeta,
    type ResolveBasicLand,
} from "./limited/autoBuild";
import { computeEventCompletion } from "./limited/completion";
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
import { getPickRatingByCardId } from "./limited/pickRatings";
import {
    assignFreeSeat,
    buildEmptySeats,
    DEFAULT_SEALED_BOOSTER_COUNT,
    fillBotSeats,
    generateSealedPools,
    type ResolveCardMeta,
} from "./limited/eventLogic";
import {
    projectLimitedEvent,
    type HumanDeckView,
    type LimitedEventSeatView,
    type LimitedEventView,
} from "./limited/eventProjection";
import type { LimitedEventSeat } from "./limited/eventTypes";
import { upsertPoolArrangementEntry } from "./limited/poolArrangement";
import {
    getBoosterConfig,
    getRuntimeBoosterConfig,
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

// Pool Arrangement (ADR 0060, issue #1247) — see `PoolArrangementEntry`'s doc
// comment in `convex/limited/eventTypes.ts`.
const poolArrangementEntryValidator = v.object({
    poolIndex: v.number(),
    column: v.optional(v.number()),
    sideboard: v.optional(v.boolean()),
});

const deckCardValidator = v.object({
    cardId: v.string(),
    cardName: v.string(),
});

// The five true colors a Auto-Built deck can be built in (CR 105.1) — never
// "C": `chooseTwoColors` (`convex/limited/autoBuild.ts`) only ever returns
// two of these.
const colorValidator = v.union(
    v.literal("W"),
    v.literal("U"),
    v.literal("B"),
    v.literal("R"),
    v.literal("G")
);

/** Wire shape of a bot Seat's Auto-Built deck (issue #1115) — the Maindeck +
 *  Sideboard + the two chosen colors (for a compact "R/G" label). Computed
 *  on demand (`computeBotAutoBuiltDeck`), never persisted — see
 *  `convex/limited/autoBuild.ts`'s module comment. */
const autoBuiltDeckValidator = v.object({
    cards: v.array(deckCardValidator),
    sideboard: v.array(deckCardValidator),
    colors: v.array(colorValidator),
});

/** Wire shape of a human seat's submitted `limited` Deck (issue #1116) — the
 *  full-disclosure counterpart to `autoBuiltDeck` below, populated ONLY once
 *  the event is `completed`. `colors` is a free-form `v.array(v.string())`
 *  (a human's `userDecks.colors`, NOT the Auto-Build-derived `colorValidator`
 *  pair) — a human's deck editor never constrains it to exactly two WUBRG
 *  letters. */
const humanDeckValidator = v.object({
    cards: v.array(deckCardValidator),
    sideboard: v.array(deckCardValidator),
    colors: v.array(v.string()),
});

const limitedEventSeatViewValidator = v.object({
    seatIndex: v.number(),
    userId: v.optional(v.string()),
    nickname: v.optional(v.string()),
    isBot: v.boolean(),
    isViewer: v.boolean(),
    poolCount: v.union(v.number(), v.null()),
    // Full Pool contents: the viewer's own seat ALWAYS, every other seat ONLY
    // once the event is `completed` (issue #1116 full-disclosure reveal —
    // see `projectLimitedEvent`'s doc comment). For a DRAFT event, array
    // order IS the seat's pick order (no separate field).
    pool: v.union(v.array(limitedPoolCardValidator), v.null()),
    // This seat's submitted `limited` Deck (issue #1116) — `null` for a bot
    // seat (its deck is `autoBuiltDeck` below instead) or before `completed`.
    humanDeck: v.union(humanDeckValidator, v.null()),
    currentPack: v.union(v.array(draftPackCardValidator), v.null()),
    packQueueCount: v.union(v.number(), v.null()),
    pickDeadline: v.union(v.number(), v.null()),
    poolArrangement: v.union(v.array(poolArrangementEntryValidator), v.null()),
    // Selected Card (ADR 0060, issue #1248) — owner-only, same discipline as
    // `currentPack`/`pickDeadline`/`poolArrangement` above.
    selectedPickId: v.union(v.string(), v.null()),
    // Auto-Build + vs-AI hookup (issue #1115): a bot seat's playable Limited
    // deck once its Pool is final (`isEventPoolFinal`), else `null` — always
    // `null` for a human seat (they build their own via the pool-scoped
    // deckbuilder, issue #1111). Unlike `pool`/`currentPack`, this is NOT
    // stripped for non-owner viewers: it's the derived opponent decklist a
    // human needs to start a vs-AI Match against the table (PRD #1107 story
    // 25), not the hidden Pool itself.
    autoBuiltDeck: v.union(autoBuiltDeckValidator, v.null()),
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
    timerEnabled: v.optional(v.boolean()),
    // Event completion (issue #1116): true exactly when every seat has a
    // Deck — see `convex/limited/completion.ts`'s `computeEventCompletion`.
    completed: v.boolean(),
    // "N/seatCount decks in" progress, live even before `completed`.
    seatsWithDeck: v.number(),
    seats: v.array(limitedEventSeatViewValidator),
    createdAt: v.number(),
    updatedAt: v.number(),
});

// Per-sheet Draftability verdict (ADR 0059, PRD #1242 AC5) — which sheet(s),
// if any, sit below the ≥80% floor, not just the set-level boolean.
const draftableSheetInfoValidator = v.object({
    sheetName: v.string(),
    coverage: v.number(),
    passes: v.boolean(),
});

const draftableSetInfoValidator = v.object({
    setCode: v.string(),
    draftable: v.boolean(),
    missingCardCount: v.number(),
    sheets: v.array(draftableSheetInfoValidator),
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

/** Wires the Pick Heuristic (`convex/limited/botDrafter.ts`) AND the Pick
 *  Rating layer (`convex/limited/pickRatings.ts`, issue #1117, ADR
 *  0054/0055) into `runBotAutoPicks`'s injected `ChooseBotPick` shape — the
 *  only place this module's card-registry-backed `getCardEvalMeta` meets a
 *  bot seat's actual Pool. `getPickRatingByCardId` is registry-agnostic (it
 *  scans every checked-in Pick Rating file by cardId, not by which set this
 *  particular pack was drawn from — see that function's doc comment), so no
 *  set-code plumbing is needed here: a set with no checked-in ratings file
 *  simply never matches, and every lookup falls through to `null`, which
 *  `chooseBotPick` treats as "score via the Pick Heuristic alone" — the
 *  exact pre-Pick-Rating-layer behavior. */
const botChoosePick: ChooseBotPick = (seat, pack) =>
    chooseBotPick(
        pack,
        seat.pool ?? [],
        getCardEvalMeta,
        getPickRatingByCardId
    );

/** Resolves a drawn card's Scryfall id to the printed characteristics
 *  Auto-Build needs (issue #1115, `convex/limited/autoBuild.ts`) — the same
 *  shape as `getCardEvalMeta` above, plus `isLand` (the spell/mana-source
 *  split a deck BUILDER needs that a pack-picking heuristic never did). */
const getAutoBuildCardMeta: GetAutoBuildCardMeta = (scryfallId) => {
    const meta = resolveDeckCardMeta(scryfallId);
    if (!meta) return null;
    const def = tryGetDefinition(meta.cardId);
    if (!def) return null;
    return {
        cardId: meta.cardId,
        colors: getCardColors(def),
        manaValue: manaValue(def.manaCost),
        rarity: meta.rarity,
        isLand: def.types.includes("Land"),
    };
};

/** Resolves ONE basic land of `color` to a `DeckCard` printed in `setCode`
 *  when a printing of that basic exists there, else falls back to the card's
 *  own canonical printing (issue #1115: "basics of the drafted set"). The
 *  only place `convex/limited/autoBuild.ts`'s injected `ResolveBasicLand`
 *  touches the card registry — `basicLandsForColors` (already used by the
 *  debug scenario builder, `convex/game.ts`) resolves a SINGLE color to its
 *  basic land NAME (CR 305.6), then `getPrintingsForCard` finds the
 *  drafted-set printing of that name. */
function resolveBasicLandFor(setCode: string): ResolveBasicLand {
    return (color: Color) => {
        const name = basicLandsForColors([color])[0];
        const def = getCardByName(name);
        const printing = getPrintingsForCard(def.id).find(
            (p) => p.setCode === setCode
        );
        return { cardId: printing?.printId ?? def.id, cardName: name };
    };
}

/** A projected Seat view (`eventProjection.ts`) plus its Auto-Built deck
 *  (issue #1115) — `extends`, not `&`, because intersecting `LimitedEventView`
 *  with a `{ seats: T[] }` override makes `seats` unsatisfiable (TS intersects
 *  the ARRAY ELEMENT types too, and the original `LimitedEventSeatView` has
 *  no `autoBuiltDeck`). */
interface SeatViewWithAutoBuild extends LimitedEventSeatView {
    autoBuiltDeck: AutoBuiltDeck | null;
}

interface EventViewWithAutoBuild extends Omit<LimitedEventView, "seats"> {
    seats: SeatViewWithAutoBuild[];
}

/** Every submitted `limited` Deck tied to `eventId`, keyed by `seatIndex`
 *  (issue #1116) — the DB read `projectLimitedEvent`/`computeEventCompletion`
 *  both need but can never perform themselves (project convention: pure
 *  domain functions, DB access confined to the thin mutation/query shell).
 *  Uses the `by_limitedEvent` index (`convex/schema.ts`) so this is a bounded
 *  read (at most `seatCount` <= 8 rows), never a table scan. When more than
 *  one row somehow references the same seat (nothing server-side stops a
 *  user from calling `userDecks.create` twice for the same event+seat instead
 *  of `update` — the client always avoids this via `pool-deck-builder.tsx`'s
 *  `existingDeck` lookup, but it isn't enforced), the most recently created
 *  row wins — a defensive tie-break, not an expected case. */
async function loadHumanDecksBySeat(
    ctx: QueryCtx,
    eventId: Id<"limitedEvents">
): Promise<Map<number, HumanDeckView>> {
    const rows = await ctx.db
        .query("userDecks")
        .withIndex("by_limitedEvent", (q) => q.eq("limitedEventId", eventId))
        .collect();
    const bySeat = new Map<number, HumanDeckView>();
    for (const row of [...rows].sort(
        (a, b) => b._creationTime - a._creationTime
    )) {
        if (row.limitedSeatId === undefined) continue;
        const seatIndex = Number(row.limitedSeatId);
        if (!Number.isInteger(seatIndex) || bySeat.has(seatIndex)) continue;
        bySeat.set(seatIndex, {
            cards: row.cards,
            sideboard: row.sideboard ?? [],
            colors: row.colors,
        });
    }
    return bySeat;
}

/** Zips `projectLimitedEvent`'s privacy-stripped view with each bot seat's
 *  Auto-Built deck (issue #1115) — kept OUT of `eventProjection.ts` itself
 *  so that module stays a pure privacy projection with no card-registry
 *  dependency (mirrors how `resolveCardMeta`/`getCardEvalMeta` are kept out
 *  of `eventLogic.ts`/`botDrafter.ts`). Every query below routes through
 *  this instead of calling `projectLimitedEvent` directly.
 *
 *  Also the event-completion seam (issue #1116): loads every human seat's
 *  submitted Deck (`loadHumanDecksBySeat`, skipped for a still-`open` event —
 *  it can never have a final Pool, so completion is trivially `false` and the
 *  query is a pure waste of a DB read), computes `computeEventCompletion`,
 *  and threads BOTH the completion flag and the human-deck map into
 *  `projectLimitedEvent` — the single call that decides the full-disclosure
 *  reveal (`pool`/`humanDeck` exposed for every seat once `completed`). */
async function projectEventForViewer(
    ctx: QueryCtx,
    event: Doc<"limitedEvents">,
    viewerUserId: string | null
): Promise<EventViewWithAutoBuild> {
    const eventContext: AutoBuildEventContext = {
        type: event.type,
        status: event.status,
        draftCompletedAt: event.draftCompletedAt,
    };
    const humanDecksBySeat =
        event.status === "started"
            ? await loadHumanDecksBySeat(ctx, event._id)
            : new Map<number, HumanDeckView>();
    const completion = computeEventCompletion(
        event.seats,
        eventContext,
        (seatIndex) => humanDecksBySeat.has(seatIndex)
    );
    const base = projectLimitedEvent(
        event,
        viewerUserId,
        completion.completed,
        completion.seatsWithDeck,
        humanDecksBySeat
    );
    const resolveBasicLand = resolveBasicLandFor(event.packSlots[0] ?? "");
    return {
        ...base,
        seats: base.seats.map((seatView, i) => ({
            ...seatView,
            autoBuiltDeck: computeBotAutoBuiltDeck(
                event.seats[i],
                eventContext,
                getAutoBuildCardMeta,
                resolveBasicLand
            ),
        })),
    };
}

/** Builds the `TimerConfig` `startDraft`/`applyPick`/`runBotAutoPicks` accept
 *  (issue #1114) from an event's stored `timerEnabled` flag (ADR 0060 / issue
 *  #1243: replaced the fixed `timerSeconds` value), or `undefined` when the
 *  event has no timer configured — the single point deciding "is the timer on
 *  for this event" so every draft mutation below agrees. `now` is read ONCE
 *  per mutation invocation (never inside the pure engine) so every deadline
 *  stamped within the same call shares one time reference. The actual
 *  per-pick SECONDS value is no longer decided here at all — it's computed
 *  fresh per stamped pack from the descending schedule
 *  (`pickTimerSchedule.ts`), indexed by cards remaining. */
function buildTimerConfig(
    timerEnabled: boolean | undefined,
    now: number
): TimerConfig | undefined {
    return timerEnabled ? { now } : undefined;
}

/** Schedules exactly one `autoPickSeatTimeout` Auto-Pick per `updates` entry
 *  (issue #1114) — the ONLY place `ctx.scheduler.runAfter` is called for this
 *  feature. Mirrors the GRE priority-timeout pattern (CLAUDE.md): the
 *  schedule is unconditional (Convex has no cheap "cancel a scheduled job"),
 *  and `autoPickSeatTimeout` re-validates `pickSeq` when it actually fires —
 *  seq-based cancellation, not an explicit cancel call. A no-op for a
 *  timer-off event (`timerEnabled` falsy) since `updates` is always empty in
 *  that case (the pure engine never stamps a seat with no `TimerConfig`).
 *  Each entry's delay is `update.pickDeadline - now` (issue #1243: no longer
 *  a single shared `timerSeconds * 1000` for the whole event — every stamped
 *  pack can carry a different countdown length per the descending
 *  schedule). */
async function scheduleSeatTimers(
    ctx: MutationCtx,
    eventId: Id<"limitedEvents">,
    timerEnabled: boolean | undefined,
    now: number,
    updates: readonly SeatTimerUpdate[]
): Promise<void> {
    if (!timerEnabled || updates.length === 0) return;
    for (const update of updates) {
        await ctx.scheduler.runAfter(
            Math.max(0, update.pickDeadline - now),
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
        return Promise.all(
            events.map((event) => projectEventForViewer(ctx, event, null))
        );
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
        return Promise.all(
            events
                .filter((event) => event.seats.some((s) => s.userId === userId))
                .map((event) => projectEventForViewer(ctx, event, userId))
        );
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
        return projectEventForViewer(ctx, event, userId);
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
        // Per-pick timer on/off (issue #1114, PRD #1107 story 5: "configure
        // the per-pick timer, or disable it"; ADR 0060 / issue #1243
        // replaced the admin-chosen seconds value with a clear on/off — the
        // actual per-pick length always follows the official descending
        // schedule). Absent/omitted/false === disabled.
        timerEnabled: v.optional(v.boolean()),
    },
    returns: v.id("limitedEvents"),
    handler: async (ctx, args) => {
        const admin = await assertIsAdmin(ctx);

        if (args.packSlots.length === 0) {
            throw new Error(
                "At least one Pack Source (Draftable Set) is required."
            );
        }
        // Validate every DISTINCT set once (issue #1246) — a 3-element Draft
        // `packSlots` is typically 3 copies of the same set, and a future
        // multi-set block draft (INV/PLS/APC) repeats none of them anyway;
        // deduping just avoids redundant registry lookups for the homogeneous
        // case without changing which lists are accepted.
        for (const setCode of new Set(args.packSlots)) {
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
            timerEnabled: args.timerEnabled,
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
            const timerConfig = buildTimerConfig(event.timerEnabled, now);
            const dealt = startDraft(
                seats,
                event.packSlots,
                seed,
                getRuntimeBoosterConfig,
                resolveCardMeta,
                timerConfig
            );
            const afterBots = runBotAutoPicks(
                dealt.seats,
                dealt.draftRound,
                dealt.draftPacksRemaining,
                event.packSlots,
                seed,
                getRuntimeBoosterConfig,
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
            await scheduleSeatTimers(
                ctx,
                args.eventId,
                event.timerEnabled,
                now,
                [...dealt.timerUpdates, ...afterBots.timerUpdates]
            );
            return null;
        }

        const seats = fillBotSeats(event.seats);
        const seed = freshSeed();
        const rng = makeRng(seed);
        const seededSeats = generateSealedPools(
            seats,
            event.packSlots,
            event.sealedBoosterCount ?? DEFAULT_SEALED_BOOSTER_COUNT,
            getRuntimeBoosterConfig,
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

/** Persists one Pool Arrangement edit for the CALLER's own Seat (ADR 0060,
 *  issue #1247) — a Maindeck/Sideboard toggle and/or a manual Mana-Value
 *  column override for the card at `poolIndex`. `seatIndex` is derived
 *  server-side from `userId`, exactly like `submitPick` below, so a user can
 *  only rearrange their own Pool. `poolIndex` is bounds-checked against the
 *  seat's ACTUAL Pool length — the one piece of trust a client-supplied
 *  index needs, since nothing else about it can be validated against a
 *  fixed shape (unlike `pickId`, no separate authoritative list to check
 *  membership against). Column-override DRAG is wired by issue #1248; this
 *  mutation already accepts `column` so that later change needs no API
 *  change, only a new caller. */
export const setPoolArrangementEntry = mutation({
    args: {
        eventId: v.id("limitedEvents"),
        poolIndex: v.number(),
        sideboard: v.optional(v.boolean()),
        // `null` explicitly clears a manual column override back to auto;
        // `undefined`/omitted leaves any existing override untouched.
        column: v.optional(v.union(v.number(), v.null())),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const user = await getCurrentUser(ctx);
        const event = await ctx.db.get(args.eventId);
        if (!event) throw new Error("Event not found");
        const seatIndex = event.seats.findIndex((s) => s.userId === user._id);
        if (seatIndex === -1) {
            throw new Error("You do not have a Seat in this event.");
        }
        const seat = event.seats[seatIndex];
        const poolSize = seat.pool?.length ?? 0;
        if (
            !Number.isInteger(args.poolIndex) ||
            args.poolIndex < 0 ||
            args.poolIndex >= poolSize
        ) {
            throw new Error("poolIndex is out of range for this seat's Pool.");
        }

        const nextArrangement = upsertPoolArrangementEntry(
            seat.poolArrangement ?? [],
            {
                poolIndex: args.poolIndex,
                sideboard: args.sideboard,
                column: args.column,
            }
        );
        const seats = [...event.seats];
        seats[seatIndex] = { ...seat, poolArrangement: nextArrangement };
        await ctx.db.patch(args.eventId, {
            seats: asDbSeats(seats),
            updatedAt: Date.now(),
        });
        return null;
    },
});

/** Sets or clears the CALLER's own Seat's Selected Card (ADR 0060, issue
 *  #1248) — a single-click SELECTION within the seat's current Booster,
 *  never a commit (that's `submitPick`/the Pick gestures). `seatIndex` is
 *  derived server-side from `userId` — never taken from the client — so a
 *  user can only select within their own pack, mirroring `submitPick`'s
 *  ownership discipline. `pickId: null` explicitly clears the selection (a
 *  card can be deselected, or superseded by selecting a different one — the
 *  mutation always simply overwrites, never toggles). A non-null `pickId`
 *  must actually be present in the seat's `currentPack` — the same
 *  membership check `applyPick` does for a real Pick — so a stale/forged
 *  `pickId` from a previous pack can never be recorded as "selected". */
export const selectDraftPick = mutation({
    args: {
        eventId: v.id("limitedEvents"),
        pickId: v.union(v.string(), v.null()),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const user = await getCurrentUser(ctx);
        const event = await ctx.db.get(args.eventId);
        if (!event) throw new Error("Event not found");
        if (event.type !== "draft") {
            throw new Error("This event is not a Draft.");
        }
        const seatIndex = event.seats.findIndex((s) => s.userId === user._id);
        if (seatIndex === -1) {
            throw new Error("You do not have a Seat in this event.");
        }
        const seat = event.seats[seatIndex];
        if (
            args.pickId !== null &&
            !(seat.currentPack ?? []).some((c) => c.pickId === args.pickId)
        ) {
            throw new Error("That card is not in your current pack.");
        }

        const seats = [...event.seats];
        seats[seatIndex] = {
            ...seat,
            selectedPickId: args.pickId ?? undefined,
        };
        await ctx.db.patch(args.eventId, {
            seats: asDbSeats(seats),
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
        const timerConfig = buildTimerConfig(event.timerEnabled, now);
        const result = applyPick(
            event.seats,
            event.draftRound ?? 0,
            event.draftPacksRemaining ?? event.seats.length,
            event.packSlots,
            seatIndex,
            args.pickId,
            event.seed,
            getRuntimeBoosterConfig,
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
            getRuntimeBoosterConfig,
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
        await scheduleSeatTimers(ctx, args.eventId, event.timerEnabled, now, [
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
        if (event.seed === undefined || !event.timerEnabled) {
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
        const timerConfig = buildTimerConfig(event.timerEnabled, now);
        const result = applyPick(
            event.seats,
            event.draftRound ?? 0,
            event.draftPacksRemaining ?? event.seats.length,
            event.packSlots,
            args.seatIndex,
            pickId,
            event.seed,
            getRuntimeBoosterConfig,
            resolveCardMeta,
            timerConfig
        );
        const afterBots = runBotAutoPicks(
            result.seats,
            result.draftRound,
            result.draftPacksRemaining,
            event.packSlots,
            event.seed,
            getRuntimeBoosterConfig,
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
        await scheduleSeatTimers(ctx, args.eventId, event.timerEnabled, now, [
            ...result.timerUpdates,
            ...afterBots.timerUpdates,
        ]);
        return null;
    },
});
