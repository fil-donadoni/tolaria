// Limited Event skeleton + Sealed flow (PRD #1107, ADR 0054/0055, issue
// #1110). Every mutation here is a thin DB-read/write shell: the actual
// decisions (seat assignment, bot fill, Sealed Pool generation, the privacy
// projection) are pure functions in `convex/limited/eventLogic.ts` and
// `convex/limited/eventProjection.ts`, so they're unit-testable without a
// convex-test harness (the project has none — see
// `convex/__tests__/adminAuth.test.ts`).
import { v, type Infer } from "convex/values";
import { internal } from "./_generated/api";
import {
    internalMutation,
    mutation,
    query,
    type MutationCtx,
    type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { getCurrentUser, getCurrentUserId, isAdminUser } from "./auth";
import {
    deleteSeats,
    ensureSeatsMigrated,
    eventHasInlinePayload,
    hydrateSeats,
    saveSeatPayload,
    saveSeats,
    saveSlimSeats,
} from "./limitedSeatStore";
import {
    getCardByName,
    getPrintingsForCard,
    resolveDeckCardMeta,
    tryGetDefinition,
} from "./cards";
import {
    basicLandsForColors,
    getCardColorIdentity,
    getPipCountsFromCost,
} from "./cards/colors";
import type { Color } from "./cards/types";
import { getDefinitionProducibleColors, manaValue } from "./gre/constants";
import { freshSeed, makeRng } from "./gre/rng";
import {
    computeBotAutoBuiltDeck,
    isEventPoolFinal,
    type AutoBuildEventContext,
    type AutoBuiltDeck,
    type GetAutoBuildCardMeta,
    type ResolveBasicLand,
} from "./limited/autoBuild";
import { computeEventCompletion } from "./limited/completion";
import { SCORER_VERSION } from "./limited/scorerVersion";
import {
    applyPick,
    resolveAutoPickTimeout,
    runBotAutoPicks,
    startDraft,
    type ChooseBotPick,
    type SeatTimerUpdate,
    type TimerConfig,
} from "./limited/draftEngine";
import {
    chooseBotPick,
    type GetCardEvalMeta,
    type GetPickRating,
} from "./limited/botDrafter";
import {
    resolveEventPickRating,
    type GetDbRating,
} from "./limited/cardRatingsCore";
import {
    resolveEventCardProfile,
    type CardProfile,
    type GetCardProfile,
    type GetDbProfile,
} from "./limited/cardProfilesCore";
import {
    assignFreeSeat,
    buildEmptySeats,
    DEFAULT_SEALED_BOOSTER_COUNT,
    fillBotSeats,
    generateSealedPools,
    MAX_SEATS,
    MIN_SEATS,
    releaseSeat,
    type ResolveCardMeta,
} from "./limited/eventLogic";
import { evaluateDeckStrength, type DeckStrength } from "./limited/matchSim";
import { openRound, type ResolveSeatStrength } from "./limited/rounds";
import {
    projectLimitedEvent,
    type HumanDeckView,
    type LimitedEventSeatView,
    type LimitedEventView,
} from "./limited/eventProjection";
import type { LimitedEventSeat, LimitedRound } from "./limited/eventTypes";
import {
    arePoolsDealt,
    areDraftPicksLegal,
    areRoundsRunning,
    isEventConcluded,
    isSeatingOpen,
} from "./limited/eventStatus";
import {
    isValidRoundDeadlineMinutes,
    resolveMatchFormat,
    MAX_ROUND_DEADLINE_MINUTES,
    MIN_ROUND_DEADLINE_MINUTES,
} from "./limited/matchFormat";
import {
    projectViewerChallenges,
    type ChallengeGame,
    type ViewerChallenges,
} from "./limited/challenge";
import { upsertPoolArrangementEntry } from "./limited/poolArrangement";
import {
    getBoosterConfig,
    getRuntimeBoosterConfig,
    isDraftableSet,
    listDraftableSets,
} from "./limited/registry";
import {
    isCubeSource,
    cubePoolSize,
    maxCubeSeats,
    CUBE_PACK_SIZE,
} from "./limited/cube";

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

/** The same type-level reconciliation for Rounds (PRD #1628, ADR 0076):
 *  `LimitedPairing.matchId` is a plain `string` — `convex/limited/**` never
 *  depends on `_generated` — while the schema stores a branded
 *  `Id<"matches">`. Every `matchId` this module writes originates from a real
 *  `ctx.db.insert("matches", …)`, never from client input. */
function asDbRounds(
    rounds: LimitedRound[]
): NonNullable<Doc<"limitedEvents">["rounds"]> {
    return rounds as unknown as NonNullable<Doc<"limitedEvents">["rounds"]>;
}

const eventTypeValidator = v.union(v.literal("sealed"), v.literal("draft"));
// Lifecycle status on the wire (PRD #1628, ADR 0076) — the same four members
// as the schema. `convex/limited/eventStatus.ts` is the authority on what each
// one PERMITS; this only declares the shape.
const eventStatusValidator = v.union(
    v.literal("open"),
    v.literal("started"),
    v.literal("playing"),
    v.literal("finished")
);
const matchFormatValidator = v.union(v.literal("bo1"), v.literal("bo3"));
const pairingResultValidator = v.object({
    winsA: v.number(),
    winsB: v.number(),
    source: v.union(
        v.literal("played"),
        v.literal("simulated"),
        v.literal("bye"),
        v.literal("timeout")
    ),
});
const roundValidator = v.object({
    roundNumber: v.number(),
    startedAt: v.number(),
    deadlineAt: v.optional(v.number()),
    pairings: v.array(
        v.object({
            seatA: v.number(),
            seatB: v.optional(v.number()),
            // The wire carries the Match id as a plain string — the pure
            // projection module never depends on `_generated` (see
            // `LimitedPairing.matchId`).
            matchId: v.optional(v.string()),
            result: v.optional(pairingResultValidator),
        })
    ),
});

// Standings row (PRD #1628 stories 22-24/47, issue #1643) — see
// `convex/limited/standings.ts`'s `StandingsRow` for the field-by-field doc.
const standingsRowValidator = v.object({
    seatIndex: v.number(),
    points: v.number(),
    matchWins: v.number(),
    matchLosses: v.number(),
    matchDraws: v.number(),
    gameWins: v.number(),
    gameLosses: v.number(),
    gameWinPct: v.number(),
    opponentMatchWinPct: v.number(),
});

// The viewer's own pairing in the CURRENT round (PRD #1628 story 7, issue
// #1644) — see `convex/limited/eventProjection.ts`'s
// `LimitedViewerPairingView` for the field-by-field doc. `null` before the
// play phase, when the viewer holds no seat, or when their seat isn't paired.
const viewerPairingValidator = v.union(
    v.object({
        roundNumber: v.number(),
        seatIndex: v.number(),
        opponentSeatIndex: v.union(v.number(), v.null()),
        opponentNickname: v.union(v.string(), v.null()),
        opponentIsBot: v.boolean(),
        isBye: v.boolean(),
        result: v.union(pairingResultValidator, v.null()),
        gameWins: v.union(v.number(), v.null()),
        gameLosses: v.union(v.number(), v.null()),
        outcome: v.union(
            v.literal("win"),
            v.literal("loss"),
            v.literal("draw"),
            v.null()
        ),
        matchId: v.union(v.string(), v.null()),
        roundComplete: v.boolean(),
    }),
    v.null()
);

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

// Pool Arrangement (ADR 0060, issue #1247; Lands as a manual column target,
// issue #1573) — see `PoolArrangementEntry`'s doc comment in
// `convex/limited/eventTypes.ts`.
const poolArrangementEntryValidator = v.object({
    poolIndex: v.number(),
    column: v.optional(v.union(v.number(), v.literal("lands"))),
    sideboard: v.optional(v.boolean()),
});

const deckCardValidator = v.object({
    cardId: v.string(),
    cardName: v.string(),
});

// The five true colors a Auto-Built deck can be built in (CR 105.1) — never
// "C": `chooseDeckColors` (`convex/limited/autoBuild.ts`) only ever returns
// two or three of these (the count is DERIVED from the Pool's mana base,
// issue #1615 — hence `v.array`, not a fixed-length tuple).
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
    // for an ADMIN viewer once the event is `completed` (issue #1583 admin-
    // gated debug detail, narrowing #1116 — see `projectLimitedEvent`'s doc
    // comment). For a DRAFT event, array order IS the seat's pick order (no
    // separate field).
    pool: v.union(v.array(limitedPoolCardValidator), v.null()),
    // This seat's submitted `limited` Deck (issue #1116) — `null` for a bot
    // seat (its deck is `autoBuiltDeck` below instead), before `completed`, or
    // for another seat when the viewer isn't an admin (issue #1583).
    humanDeck: v.union(humanDeckValidator, v.null()),
    // Compact deck summary (issue #1583) — colors + maindeck/sideboard counts,
    // never the card list. Ungated: populated for every seat that has a deck
    // (human: submitted; bot: Auto-Build computable), so the compact review
    // summary renders for every viewer without leaking any seat's contents.
    deckSummary: v.union(
        v.object({
            colors: v.array(v.string()),
            maindeckCount: v.number(),
            sideboardCount: v.number(),
        }),
        v.null()
    ),
    currentPack: v.union(v.array(draftPackCardValidator), v.null()),
    packQueueCount: v.union(v.number(), v.null()),
    pickDeadline: v.union(v.number(), v.null()),
    poolArrangement: v.union(v.array(poolArrangementEntryValidator), v.null()),
    // Selected Card (ADR 0060, issue #1248) — owner-only, same discipline as
    // `currentPack`/`pickDeadline`/`poolArrangement` above.
    selectedPickId: v.union(v.string(), v.null()),
    // Deck-ready indicator (issue #1580) — true once THIS seat has a deck
    // (human: submitted; bot: Auto-Build computable). Always visible for
    // every seat, unlike `pool`/`humanDeck`/`autoBuiltDeck`: it's a readiness
    // flag, not the deck's contents, so it identifies the blocking seat
    // without leaking what anyone drafted or built.
    hasDeck: v.boolean(),
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
 *  stripped view instead of leaving it undeclared.
 *
 *  EXPORTED for `convex/__tests__/limitedEventViewValidator.test.ts`, which
 *  runs the real projection's output through this exact validator. Convex only
 *  registers exports that are Convex functions, so a plain const export here is
 *  inert on the wire (same as `game.ts`'s `STARTING_HAND_SIZE`). Keeping it
 *  private would leave the ONLY check on this validator the handler's own
 *  TypeScript type — which is precisely the check that cannot see the drift
 *  (the handler type is `EventViewWithAutoBuild`, not `Infer<>` of this). */
export const limitedEventViewValidator = v.object({
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
    // Play phase (PRD #1628, issue #1640). `matchFormat` is REQUIRED on the
    // wire even though the stored field is optional — `projectLimitedEvent`
    // resolves the default, so the client always receives a concrete Bo1/Bo3.
    matchFormat: matchFormatValidator,
    roundDeadlineMinutes: v.optional(v.number()),
    currentRound: v.optional(v.number()),
    // Always an array (`[]` before the play phase) — pairings and results are
    // public; pools/decks keep their per-seat stripping.
    rounds: v.array(roundValidator),
    // Standings (PRD #1628 stories 22-24/47, issue #1643) — derived, never
    // stored (ADR 0076). Always one row per seat, zeroed before any round is
    // decided — never absent.
    standings: v.array(standingsRowValidator),
    // The viewer's own pairing in the current round (issue #1644) — derived
    // from `rounds`/`seats`, a convenience rather than a privacy boundary.
    viewerPairing: viewerPairingValidator,
    // Event RNG seed (issue #1613, ADR 0074 replay mode) — `null` unless the
    // event is a COMPLETED DRAFT and the viewer is an admin. The seed
    // regenerates every pack, so on a Sealed event it would hand any viewer
    // every seat's Pool, and `completed` stays true right through the play
    // phase; see `eventProjection.ts`'s `LimitedEventView.seed` doc comment.
    seed: v.union(v.number(), v.null()),
    // Bot Drafter scorer version at `startEvent` (issue #1613) — absent for
    // an event created before this field existed.
    scorerVersion: v.optional(v.number()),
    // Event completion (issue #1116): true exactly when every seat has a
    // Deck — see `convex/limited/completion.ts`'s `computeEventCompletion`.
    completed: v.boolean(),
    // "N/seatCount decks in" progress, live even before `completed`.
    seatsWithDeck: v.number(),
    seats: v.array(limitedEventSeatViewValidator),
    // Pending human-vs-human challenges relevant to THIS viewer (issue #1577) —
    // viewer-scoped, same privacy discipline as the per-seat Pool: challenges
    // ADDRESSED to the viewer (`viewerIncomingChallenges`, accepted with their
    // own Limited deck) and the viewer's OWN outstanding challenge
    // (`viewerOutgoingChallenge`, at most one). Never another seat's pairing.
    viewerIncomingChallenges: v.array(
        v.object({
            gameId: v.string(),
            challengerSeatIndex: v.number(),
        })
    ),
    viewerOutgoingChallenge: v.union(
        v.object({
            gameId: v.string(),
            challengedSeatIndex: v.number(),
        }),
        v.null()
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
});

/** Wire shape of a LIST row (`listOpenLimitedEvents`/`myLimitedEvents`) — a
 *  deliberately narrower view than `limitedEventViewValidator` above, carrying
 *  only what a row in the events list renders: the event's name inputs
 *  (`type`/`packSlots`), its phase (`status`/`draftCompletedAt`/`completed` —
 *  `limitedEventStatusHint`'s inputs), and enough per-seat identity to count
 *  filled seats and tell whether the viewer already holds one.
 *
 *  It is narrow so the list queries can be answered from the event row ALONE,
 *  with no `limitedSeats` read (`convex/schema.ts`): the fat fields the full
 *  view carries — every seat's Pool, its Auto-Built deck, its arrangement —
 *  are exactly the ones that would drag the payload back into a query that
 *  re-runs on every draft pick. A separate TYPE rather than the same one with
 *  nulls, so a component that reaches for a Pool on a list row fails to
 *  compile instead of silently rendering nothing. */
const limitedEventSummarySeatValidator = v.object({
    seatIndex: v.number(),
    userId: v.optional(v.string()),
    nickname: v.optional(v.string()),
    isBot: v.boolean(),
    isViewer: v.boolean(),
    /** Pool SIZE only (never its contents) — read off the event row's
     *  denormalised `poolCount`, so this costs no extra read. */
    poolCount: v.union(v.number(), v.null()),
    hasDeck: v.boolean(),
});

const limitedEventSummaryValidator = v.object({
    _id: v.string(),
    createdBy: v.string(),
    type: eventTypeValidator,
    status: eventStatusValidator,
    seatCount: v.number(),
    packSlots: v.array(v.string()),
    draftCompletedAt: v.optional(v.number()),
    matchFormat: matchFormatValidator,
    completed: v.boolean(),
    seatsWithDeck: v.number(),
    seats: v.array(limitedEventSummarySeatValidator),
    createdAt: v.number(),
    updatedAt: v.number(),
});

/** The list-row view, derived from its validator so the two can't drift. */
type LimitedEventSummary = Infer<typeof limitedEventSummaryValidator>;

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
    // Vintage Cube pool source (ADR 0062) — present only on the cube entry.
    isCube: v.optional(v.boolean()),
    availableCardCount: v.optional(v.number()),
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
 *  and mana value come from the resolved `CardDefinition`.
 *
 *  `pips`/`producedColors` (ADR 0073, issue #1610) are the mana-base fix:
 *  `colors` is mana-cost-derived (CR 202.2) so a dual land, a Mox, a Signet
 *  all read `[]` there — `producedColors` (`getDefinitionProducibleColors`)
 *  reads what the card PRODUCES instead, and `pips` (`getPipCountsFromCost`)
 *  carries the coloured PIP COUNT a plain `colors` presence check can't. */
const getCardEvalMeta: GetCardEvalMeta = (scryfallId) => {
    const meta = resolveDeckCardMeta(scryfallId);
    if (!meta) return null;
    const def = tryGetDefinition(meta.cardId);
    if (!def) return null;
    return {
        cardId: meta.cardId,
        colors: getCardColorIdentity(def),
        manaValue: manaValue(def.manaCost),
        rarity: meta.rarity,
        pips: getPipCountsFromCost(def.manaCost),
        producedColors: [...getDefinitionProducibleColors(def)],
    };
};

/** Wires the Pick Heuristic (`convex/limited/botDrafter.ts`) AND the Pick
 *  Rating layer into `runBotAutoPicks`'s injected `ChooseBotPick` shape — the
 *  only place this module's card-registry-backed `getCardEvalMeta` meets a
 *  bot seat's actual Pool. `getPickRating` is the LAYERED lookup built once
 *  per mutation call by `loadEventPickRating` below (database override over
 *  the checked-in seed file, `convex/limited/cardRatings.ts`'s
 *  `resolveEventPickRating`, PRD #1296 Slice A, issue #1297) — replacing the
 *  old registry-agnostic `pickRatings.ts#getPickRatingByCardId`. A `null`
 *  from either layer falls through to the quality heuristic mapped onto the
 *  SAME rating scale (`heuristicAsRating`, ADR 0073).
 *
 *  `packsSeen` (ADR 0073 / issue #1609) is forwarded from the engine straight
 *  into `chooseBotPick` — every bot-pick path in this module
 *  (`startLimitedEvent`, `submitPick`, `autoPickSeatTimeout`) goes through
 *  THIS adapter, so the parameter is threaded once for all three. Nothing
 *  reads it yet: Draft Signal reading is a later slice of PRD #1607.
 *
 *  `getCardProfile` (ADR 0072, issue #1611) is the SECOND layered lookup built
 *  once per mutation call, by `loadEventCardProfile` below — it feeds the
 *  scorer's three synergy terms (Archetype Fit, Capability Fit, Combo Edge).
 *  For a scope with no `cardProfiles` rows and no seed file it resolves `null`
 *  for every card and all three terms contribute exactly 0, which is ADR
 *  0072's stated "set and block environments keep working with no profiles
 *  authored at all". */
function makeBotChoosePick(
    getPickRating: GetPickRating,
    getCardProfile: GetCardProfile
): ChooseBotPick {
    return (seat, pack, packsSeen) =>
        chooseBotPick(pack, seat.pool ?? [], getCardEvalMeta, {
            packsSeen,
            getPickRating,
            getCardProfile,
        });
}

/** Loads this event's Pick Rating layer (PRD #1296 Slice A, issue #1297):
 *  every `cardRatings` row for each of the event's DISTINCT `packSlots`
 *  scopes, folded into the layered `GetPickRating` via
 *  `resolveEventPickRating`. The only place this module touches the
 *  `cardRatings` table directly — every bot-pick call site below calls this
 *  once per mutation invocation, then feeds the result into
 *  `makeBotChoosePick`. Uses the `by_scope` index, so this is bounded per
 *  scope (never a full-table scan) and cheap even for a multi-round Draft on
 *  a single set (one distinct scope, queried once, not once per round). */
async function loadEventPickRating(
    ctx: QueryCtx | MutationCtx,
    packSlots: readonly string[]
): Promise<GetPickRating> {
    const scopes = Array.from(
        new Set(packSlots.map((scope) => scope.toLowerCase()))
    );
    const dbRatings = new Map<string, number>();
    for (const scope of scopes) {
        const rows = await ctx.db
            .query("cardRatings")
            .withIndex("by_scope", (q) => q.eq("scope", scope))
            .collect();
        for (const row of rows) {
            dbRatings.set(`${scope}::${row.cardId}`, row.rating);
        }
    }
    const getDbRating: GetDbRating = (scope, cardId) =>
        dbRatings.get(`${scope}::${cardId}`) ?? null;
    return resolveEventPickRating(scopes, getDbRating);
}

/** Loads this event's Card Profile layer (ADR 0072, PRD #1607 slice 4, issue
 *  #1611) — the exact sibling of `loadEventPickRating` above, one table over:
 *  every `cardProfiles` row for each of the event's DISTINCT `packSlots`
 *  scopes, folded into the layered `GetCardProfile` via
 *  `resolveEventCardProfile` (database rows over the checked-in seed file).
 *  The only place this module touches the `cardProfiles` table directly, and
 *  the only thing that makes the scorer's three synergy terms non-zero in a
 *  real Limited Event. Uses the `by_scope` index, so it is bounded per scope
 *  and cheap even for a multi-round Draft on a single set. */
async function loadEventCardProfile(
    ctx: QueryCtx | MutationCtx,
    packSlots: readonly string[]
): Promise<GetCardProfile> {
    const scopes = Array.from(
        new Set(packSlots.map((scope) => scope.toLowerCase()))
    );
    const dbProfiles = new Map<string, CardProfile>();
    for (const scope of scopes) {
        const rows = await ctx.db
            .query("cardProfiles")
            .withIndex("by_scope", (q) => q.eq("scope", scope))
            .collect();
        for (const row of rows) {
            dbProfiles.set(`${scope}::${row.cardId}`, {
                archetypes: row.archetypes,
                provides: row.provides,
                requires: row.requires,
                comboEdges: row.comboEdges,
                reviewed: row.reviewed,
            });
        }
    }
    const getDbProfile: GetDbProfile = (scope, cardId) =>
        dbProfiles.get(`${scope}::${cardId}`) ?? null;
    return resolveEventCardProfile(scopes, getDbProfile);
}

/** Resolves a drawn card's Scryfall id to the printed characteristics
 *  Auto-Build needs (issue #1115, `convex/limited/autoBuild.ts`) — the same
 *  shape as `getCardEvalMeta` above (`AutoBuildCardMeta` literally EXTENDS
 *  `CardEvalMeta`, issue #1615, so the pip/produced-colour arithmetic is
 *  shared code), plus the two builder-only facts: `isLand` (the spell /
 *  mana-source split) and `isBasicLand` (CR 205.4a — a basic is not fixing,
 *  so it can never be the evidence that unlocks a third colour). */
const getAutoBuildCardMeta: GetAutoBuildCardMeta = (scryfallId) => {
    const meta = resolveDeckCardMeta(scryfallId);
    if (!meta) return null;
    const def = tryGetDefinition(meta.cardId);
    if (!def) return null;
    return {
        cardId: meta.cardId,
        colors: getCardColorIdentity(def),
        manaValue: manaValue(def.manaCost),
        rarity: meta.rarity,
        pips: getPipCountsFromCost(def.manaCost),
        producedColors: [...getDefinitionProducibleColors(def)],
        isLand: def.types.includes("Land"),
        isBasicLand:
            def.types.includes("Land") &&
            (def.supertypes?.includes("Basic") ?? false),
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
    // Viewer-scoped pending challenges (issue #1577) — injected by the query
    // shell (`projectEventForViewer`), not by the pure `projectLimitedEvent`,
    // because challenges live in the `games` table, not the event row (mirrors
    // how `autoBuiltDeck` is zipped in here rather than in `eventProjection`).
    viewerIncomingChallenges: ViewerChallenges["incoming"];
    viewerOutgoingChallenge: ViewerChallenges["outgoing"];
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
/** Every PENDING (`waiting`) challenge Game bound to `eventId` (issue #1577),
 *  flattened to `ChallengeGame[]` for the viewer-scoped projection. Uses the
 *  `by_limited_event` index (`convex/schema.ts`) so this is a bounded read.
 *  Only ever called for a `started` event (a challenge can't exist before the
 *  Pool is final), so the list queries over `open` events pay nothing. The
 *  challenger is the sole seated player in the waiting Game (`players[0]`). */
async function loadEventChallenges(
    ctx: QueryCtx,
    eventId: Id<"limitedEvents">
): Promise<ChallengeGame[]> {
    const games = await ctx.db
        .query("games")
        .withIndex("by_limited_event", (q) => q.eq("limitedEventId", eventId))
        .collect();
    const challenges: ChallengeGame[] = [];
    for (const game of games) {
        if (game.status !== "waiting" || !game.limitedChallenge) continue;
        const challengerUserId = game.players[0]?.id;
        if (!challengerUserId) continue;
        challenges.push({
            gameId: game._id,
            challengerUserId,
            challengerSeatIndex: game.limitedChallenge.challengerSeatIndex,
            challengedUserId: game.limitedChallenge.challengedUserId,
            challengedSeatIndex: game.limitedChallenge.challengedSeatIndex,
        });
    }
    return challenges;
}

async function projectEventForViewer(
    ctx: QueryCtx,
    event: Doc<"limitedEvents">,
    viewerUserId: string | null,
    // Whether the viewer is an admin (issue #1583) — threads through to
    // `projectLimitedEvent`'s admin-gated debug-detail reveal so another seat's
    // pool/deck contents are populated on the wire ONLY for an admin.
    isAdmin = false
): Promise<EventViewWithAutoBuild> {
    const eventContext: AutoBuildEventContext = {
        type: event.type,
        status: event.status,
        draftCompletedAt: event.draftCompletedAt,
    };
    // How much of the seat payload this projection will actually read
    // (`convex/limitedSeatStore.ts`): the viewer's own seat always — it's the
    // only one whose Pool/pack/arrangement survives the privacy strip — plus
    // EVERY seat once the Pool is final, because `computeBotAutoBuiltDeck`
    // below needs each bot seat's Pool to derive its deck summary. While a
    // draft is still running that second clause is false, so the query that
    // re-fires on every pick loads one seat's cards instead of eight.
    const viewerSeatIndex = event.seats.find(
        (s) => viewerUserId !== null && s.userId === viewerUserId
    )?.seatIndex;
    const seats = await hydrateSeats(
        ctx,
        event,
        isEventPoolFinal(eventContext)
            ? undefined
            : viewerSeatIndex === undefined
              ? []
              : [viewerSeatIndex]
    );
    const hydrated = { ...event, seats: asDbSeats(seats) };
    // Decks exist for as long as Pools do — through the play phase and past
    // the event's end (ADR 0076), not only while `status === "started"`. A
    // literal comparison here would have blanked every seat's deck (and, via
    // `computeEventCompletion`, un-completed the event) the moment the rounds
    // started.
    const humanDecksBySeat = arePoolsDealt(event.status)
        ? await loadHumanDecksBySeat(ctx, event._id)
        : new Map<number, HumanDeckView>();
    const completion = computeEventCompletion(
        event.seats,
        eventContext,
        (seatIndex) => humanDecksBySeat.has(seatIndex)
    );
    const base = projectLimitedEvent(
        hydrated,
        viewerUserId,
        completion.completed,
        completion.seatsWithDeck,
        humanDecksBySeat,
        completion.hasDeckBySeat,
        isAdmin
    );
    const resolveBasicLand = resolveBasicLandFor(event.packSlots[0] ?? "");
    // Challenges (issue #1577) only exist once Pools do — skip the games read
    // entirely for `open` events (the lobby list's common case).
    const challenges = arePoolsDealt(event.status)
        ? await loadEventChallenges(ctx, event._id)
        : [];
    const viewerChallenges = projectViewerChallenges(challenges, viewerUserId);
    // Card Profiles feed Auto-Build's Capability term (ADR 0072, issue #1615)
    // — the SAME layered seam the Pick Heuristic reads, so a Pool drafted
    // around an enabler is BUILT around it too. Loaded only once Pools exist
    // (an `open` event has no deck to build, so the lobby list never pays for
    // the scan).
    const getCardProfile = arePoolsDealt(event.status)
        ? await loadEventCardProfile(ctx, event.packSlots)
        : undefined;
    return {
        ...base,
        seats: base.seats.map((seatView, i) => {
            const autoBuiltDeck = computeBotAutoBuiltDeck(
                seats[i],
                eventContext,
                getAutoBuildCardMeta,
                resolveBasicLand,
                { getCardProfile }
            );
            return {
                ...seatView,
                autoBuiltDeck,
                // Bot seats have no `humanDeck`, so `projectLimitedEvent`
                // leaves `deckSummary` null for them — fill it from the
                // Auto-Built deck here (colors + counts only, still ungated).
                deckSummary:
                    seatView.deckSummary ??
                    (autoBuiltDeck
                        ? {
                              colors: autoBuiltDeck.colors,
                              maindeckCount: autoBuiltDeck.cards.length,
                              sideboardCount: autoBuiltDeck.sideboard.length,
                          }
                        : null),
            };
        }),
        viewerIncomingChallenges: viewerChallenges.incoming,
        viewerOutgoingChallenge: viewerChallenges.outgoing,
    };
}

/** Opens the event's PLAY PHASE the moment the table is ready (PRD #1628, ADR
 *  0076, issue #1644): the event flips to `playing`, round 1 is paired, and
 *  every pairing nobody can sit down and play — bot-vs-bot, and the bye on an
 *  odd table — is decided in this same transaction.
 *
 *  A thin SHELL, in this module's established discipline: the whole decision
 *  lives in `convex/limited/rounds.ts`'s pure `openRound`, and everything here
 *  is a DB read, an injected resolver, or the single write at the end.
 *
 *  **Idempotent and self-gating.** It re-reads the row, asks `eventStatus.ts`'s
 *  PHASE PREDICATES (never a literal status comparison — ADR 0076 decision 1)
 *  whether the event is still in the draft/deckbuild phase, and re-derives
 *  completion from the database. So every call site below can simply call it
 *  after its own write: a second call once the rounds are running returns
 *  `false` without touching anything, and it can never re-pair a round that
 *  already exists.
 *
 *  Called from every path that can make `computeEventCompletion` flip — all
 *  four of them:
 *  - `userDecks.create` — the last seat submitting its deck, the headline case.
 *  - `submitPick` and `autoPickSeatTimeout` — the two draft-completing paths,
 *    which flip it when the final pick lands a Pool for humans who had already
 *    built (the continuous draft→build surface, ADR 0060, lets a seat submit a
 *    deck before the draft ends).
 *  - `startLimitedEvent` (BOTH branches) — an ALL-BOT table is complete the
 *    instant it starts, so completion flips INSIDE that mutation and none of
 *    the three above will ever run: Sealed deals every bot seat a Pool (each
 *    immediately Auto-Build-ready), and a draft's `runBotAutoPicks` drives the
 *    whole draft to `draftCompletedAt` in the same transaction. Without this
 *    call site such an event sticks in `started` with `completed: true`
 *    forever.
 *
 *  Returns whether it actually opened the phase. */
export async function openPlayPhaseIfReady(
    ctx: MutationCtx,
    eventId: Id<"limitedEvents">,
    now: number
): Promise<boolean> {
    const event = await ctx.db.get(eventId);
    if (!event) return false;
    // Phase QUESTIONS, not literals: the play phase opens exactly once, out of
    // the draft/deckbuild phase — Pools dealt, rounds not yet running, event
    // not concluded.
    if (
        !arePoolsDealt(event.status) ||
        areRoundsRunning(event.status) ||
        isEventConcluded(event.status)
    ) {
        return false;
    }
    // Defensive: `pairRound` refuses a table outside `MIN_SEATS..MAX_SEATS`,
    // and a mutation that throws here would roll back the caller's own write
    // (the player's deck!). Event creation already bounds `seatCount`, so this
    // is unreachable for a well-formed row.
    if (event.seats.length < MIN_SEATS || event.seats.length > MAX_SEATS) {
        return false;
    }

    const eventContext: AutoBuildEventContext = {
        type: event.type,
        status: event.status,
        draftCompletedAt: event.draftCompletedAt,
    };
    const humanDecksBySeat = await loadHumanDecksBySeat(ctx, eventId);
    const completion = computeEventCompletion(
        event.seats,
        eventContext,
        (seatIndex) => humanDecksBySeat.has(seatIndex)
    );
    if (!completion.completed) return false;

    // Bot deck strength, resolved lazily and memoised: `openRound` only asks
    // for a seat it is about to simulate, so a table with few bot-vs-bot
    // pairings never pays for Auto-Building the seats it doesn't need. The
    // SAME card-value seams the Bot Drafter picks with (PRD story 50) —
    // `getCardEvalMeta` keys on a deck-card id exactly as it does on a pack
    // card's (`resolveDeckCardMeta` resolves a `printId` or a canonical id
    // alike), and the layered Pick Ratings come from `loadEventPickRating`.
    const getPickRating = await loadEventPickRating(ctx, event.packSlots);
    const resolveBasicLand = resolveBasicLandFor(event.packSlots[0] ?? "");
    // Bot deck strength is Auto-Built from the seat's POOL, which no longer
    // lives on the event row (`convex/schema.ts`'s `limitedSeats`) — so this
    // is one of the paths that must hydrate in FULL. A slim `event.seats` here
    // would silently evaluate every bot seat as an empty deck and decide the
    // bot-vs-bot pairings on nothing at all.
    const hydratedSeats = await hydrateSeats(ctx, event);
    const strengthCache = new Map<number, DeckStrength>();
    const seatStrength: ResolveSeatStrength = (seatIndex) => {
        const cached = strengthCache.get(seatIndex);
        if (cached) return cached;
        const seat = hydratedSeats.find((s) => s.seatIndex === seatIndex);
        const deck = seat
            ? computeBotAutoBuiltDeck(
                  seat,
                  eventContext,
                  getAutoBuildCardMeta,
                  resolveBasicLand
              )
            : null;
        const strength = evaluateDeckStrength(
            deck?.cards ?? [],
            getCardEvalMeta,
            getPickRating
        );
        strengthCache.set(seatIndex, strength);
        return strength;
    };

    const round = openRound({
        eventId,
        roundNumber: 1,
        seats: event.seats,
        previousRounds: [],
        matchFormat: resolveMatchFormat(event.matchFormat),
        startedAt: now,
        roundDeadlineMinutes: event.roundDeadlineMinutes,
        seatStrength,
    });

    await ctx.db.patch(eventId, {
        // A status WRITE names the phase being entered — ADR 0076's explicit
        // exemption from the no-literals rule (it isn't a phase question).
        status: "playing",
        currentRound: round.roundNumber,
        rounds: asDbRounds([round]),
        updatedAt: now,
    });
    return true;
}

/** Projects one event for a LIST row — see `limitedEventSummaryValidator`.
 *
 *  Reads NOTHING beyond the event row itself and the (indexed, per-event)
 *  `userDecks` rows completion needs: no `limitedSeats`, no challenges, no
 *  Auto-Build. That is the whole point — these two queries scan multiple
 *  events and re-run on every write to any of them, so anything they load per
 *  event is paid once per draft pick, per subscribed client. */
async function projectEventSummary(
    ctx: QueryCtx,
    event: Doc<"limitedEvents">,
    viewerUserId: string | null
): Promise<LimitedEventSummary> {
    const humanDecksBySeat = arePoolsDealt(event.status)
        ? await loadHumanDecksBySeat(ctx, event._id)
        : new Map<number, HumanDeckView>();
    const completion = computeEventCompletion(
        event.seats,
        {
            type: event.type,
            status: event.status,
            draftCompletedAt: event.draftCompletedAt,
        },
        (seatIndex) => humanDecksBySeat.has(seatIndex)
    );
    return {
        _id: event._id,
        createdBy: event.createdBy,
        type: event.type,
        status: event.status,
        seatCount: event.seatCount,
        packSlots: event.packSlots,
        draftCompletedAt: event.draftCompletedAt,
        matchFormat: resolveMatchFormat(event.matchFormat),
        completed: completion.completed,
        seatsWithDeck: completion.seatsWithDeck,
        createdAt: event.createdAt,
        updatedAt: event.updatedAt,
        seats: event.seats.map((seat) => ({
            seatIndex: seat.seatIndex,
            userId: seat.userId,
            nickname: seat.nickname,
            isBot: seat.isBot ?? false,
            isViewer: viewerUserId !== null && seat.userId === viewerUserId,
            // The denormalised count, never a Pool read. A legacy row written
            // before the split has no `poolCount` but still carries its Pool
            // inline, so fall back to it rather than reporting `null`.
            poolCount: seat.poolCount ?? seat.pool?.length ?? null,
            hasDeck: completion.hasDeckBySeat.has(seat.seatIndex),
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
    returns: v.array(limitedEventSummaryValidator),
    handler: async (ctx) => {
        const userId = await getCurrentUserId(ctx);
        const events = await ctx.db
            .query("limitedEvents")
            .withIndex("by_status", (q) => q.eq("status", "open"))
            .collect();
        return Promise.all(
            events.map((event) => projectEventSummary(ctx, event, userId))
        );
    },
});

/** Every event (any status) the current user occupies a Seat in — how a
 *  player finds their way back to a started event's Pool view after leaving
 *  the lobby list (which only shows "open" events). No index can select
 *  "seats containing this userId" (seats is an embedded array), so this scans
 *  the `MY_EVENTS_SCAN_LIMIT` most-recently-created events — a bound, not a
 *  true index, but comfortably covers every event a user could still be
 *  seated in.
 *
 *  That scan is affordable only because an event row is SLIM: the per-seat
 *  card payload lives in `limitedSeats` (`convex/schema.ts`) and this query
 *  reads none of it. Before the split each scanned row carried up to 48 KB of
 *  Pools, and since the query re-runs on every write to any event, a single
 *  draft re-read the whole table once per pick. Keep it projecting through
 *  `projectEventSummary` — reaching for `projectEventForViewer` here would
 *  restore exactly that. */
export const myLimitedEvents = query({
    args: {},
    returns: v.array(limitedEventSummaryValidator),
    handler: async (ctx) => {
        const user = await getCurrentUser(ctx);
        const userId = user._id;
        const events = await ctx.db
            .query("limitedEvents")
            .order("desc")
            .take(MY_EVENTS_SCAN_LIMIT);
        return Promise.all(
            events
                .filter((event) => event.seats.some((s) => s.userId === userId))
                .map((event) => projectEventSummary(ctx, event, userId))
        );
    },
});

/** One event, projected for the current viewer — strips every other seat's
 *  Pool (PRD #1107 story 15/26, ADR 0054/0055). Returns `null` (never throws)
 *  when the id doesn't resolve — a bad id, OR the event's creator just
 *  `cancelLimitedEvent`'d it out from under a live viewer (issue #1579): this
 *  query is a single-document REACTIVE subscription (unlike the delete-preset
 *  flow, which is list-based and simply drops the row), so a viewer still on
 *  the detail page when it's deleted gets a re-push of this same query — a
 *  thrown error there has no ErrorBoundary to land in (none exists app-wide)
 *  and would hard-crash their page. `null` lets `LimitedEventDetail` render a
 *  "no longer exists" state instead. */
export const getLimitedEvent = query({
    args: { eventId: v.id("limitedEvents") },
    returns: v.union(v.null(), limitedEventViewValidator),
    handler: async (ctx, args) => {
        const user = await getCurrentUser(ctx);
        const event = await ctx.db.get(args.eventId);
        if (!event) return null;
        return projectEventForViewer(ctx, event, user._id, isAdminUser(user));
    },
});

// --- Mutations ---------------------------------------------------------------

/** Any authenticated user creates an event with `seatCount` empty Seats (PRD
 *  #1107 story 1-6; the original admin gate was lifted — hosting a table is a
 *  normal player action, and the creator already owns it via `createdBy` for
 *  `startLimitedEvent`/`cancelLimitedEvent`). Every `packSlots` entry must
 *  resolve to a currently-Draftable Set — defense-in-depth behind the create
 *  dialog's picker (`listLimitedDraftableSets` is the reason surfaced there;
 *  this is the server-side gate the client can't bypass). */
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
        // Match Format of the event's round matches (PRD #1628 stories 1-2,
        // issue #1640). Omitted === the Bo3 default, so an existing client
        // that doesn't send it still creates a real-Limited-shaped event.
        matchFormat: v.optional(matchFormatValidator),
        // Optional round deadline in MINUTES (PRD #1628 stories 3-4). Omitted
        // === no deadline; a relaxed table is never cut short by a timer.
        roundDeadlineMinutes: v.optional(v.number()),
    },
    returns: v.id("limitedEvents"),
    handler: async (ctx, args) => {
        const creator = await getCurrentUser(ctx);

        // Range-check the client-supplied deadline against the SAME bounds the
        // create dialog's number input uses (an unbounded number would
        // otherwise store `NaN`/`Infinity`/a negative and yield a `deadlineAt`
        // that is either instantly expired or unreachable).
        if (
            args.roundDeadlineMinutes !== undefined &&
            !isValidRoundDeadlineMinutes(args.roundDeadlineMinutes)
        ) {
            throw new Error(
                `The round deadline must be a whole number of minutes between ${MIN_ROUND_DEADLINE_MINUTES} and ${MAX_ROUND_DEADLINE_MINUTES}.`
            );
        }

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
            if (isCubeSource(setCode)) {
                // The Vintage Cube is a curated POOL, Draft-only (ADR 0062 §4):
                // it deliberately bypasses the per-set Draftability gate, but
                // must be rejected server-side for Sealed — `generateSealedPools`
                // has no cube path (defense-in-depth; the dialog already blocks
                // it, but the mutation must not rely on the client).
                if (args.type === "sealed") {
                    throw new Error(
                        "The Vintage Cube is Draft-only — it cannot be used for a Sealed event."
                    );
                }
                // Singleton capacity cap (ADR 0062 rev, issue: cube one-copy-max).
                // A cube is a POOL of singletons — every card exists once. Rather
                // than dealing the same card twice when the table can't be filled
                // from the implemented pool (the old with-replacement "top-up"),
                // reject an oversized config at creation. `roundCount` is the
                // pack count (`packSlots.length`, DRAFT_BOOSTER_COUNT copies of
                // the cube key). The cap lifts automatically as cube cards land.
                const roundCount = args.packSlots.length;
                const poolSize = cubePoolSize();
                const maxSeats = maxCubeSeats(
                    poolSize,
                    CUBE_PACK_SIZE,
                    roundCount
                );
                if (args.seatCount > maxSeats) {
                    throw new Error(
                        `The Vintage Cube's implemented pool (${poolSize} cards) supports at most ${maxSeats} seats over ${roundCount} boosters without repeating a card. Reduce the seat count to ${maxSeats} or fewer.`
                    );
                }
                continue;
            }
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
            createdBy: creator._id,
            type: args.type,
            status: "open",
            seatCount: args.seatCount,
            packSlots: args.packSlots,
            sealedBoosterCount:
                args.sealedBoosterCount ?? DEFAULT_SEALED_BOOSTER_COUNT,
            timerEnabled: args.timerEnabled,
            // Persisted CONCRETE (never left absent to be defaulted later):
            // the tolerant `resolveMatchFormat` read exists for rows written
            // before the play phase, not as a licence for new rows to be
            // ambiguous about what the creator chose.
            matchFormat: resolveMatchFormat(args.matchFormat),
            roundDeadlineMinutes: args.roundDeadlineMinutes,
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
        if (!isSeatingOpen(event.status)) {
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

/** An occupant leaves their Seat while the event is still OPEN (issue #1579):
 *  the Seat returns to unclaimed (`releaseSeat`), so anyone else — including
 *  the same user later — can `joinLimitedEvent` it again. Rejected once the
 *  event has `started` (mirrors `joinLimitedEvent`'s guard — a Seat mid-Draft
 *  or holding a dealt Sealed Pool can't just vanish; CLAUDE.md issue #1579's
 *  "out of scope: dropping from a started event") and for a caller who holds
 *  no Seat here (`releaseSeat` throws, defense-in-depth beyond the UI gate). */
export const leaveLimitedEvent = mutation({
    args: { eventId: v.id("limitedEvents") },
    returns: v.null(),
    handler: async (ctx, args) => {
        const user = await getCurrentUser(ctx);
        const event = await ctx.db.get(args.eventId);
        if (!event) throw new Error("Event not found");
        if (!isSeatingOpen(event.status)) {
            throw new Error("This event has already started.");
        }
        const seats = releaseSeat(event.seats, user._id);
        await ctx.db.patch(args.eventId, {
            seats: asDbSeats(seats),
            updatedAt: Date.now(),
        });
        return null;
    },
});

/** The event's creator cancels the whole event while it's still OPEN (issue
 *  #1579): a hard delete, same as an admin's preset delete
 *  (`decks.deletePreset`) — an open event that never started carries no
 *  Pool/Draft state worth keeping around, so there's nothing to archive.
 *  Removing the row drops it from `listOpenLimitedEvents` (by_status index)
 *  and every occupant's `myLimitedEvents` reactively. Rejected once the
 *  event has `started` (an in-progress/completed event's Pools/decks are
 *  real player work — cancelling it is a different, undesigned, action) and
 *  for anyone but the creator. */
export const cancelLimitedEvent = mutation({
    args: { eventId: v.id("limitedEvents") },
    returns: v.null(),
    handler: async (ctx, args) => {
        const user = await getCurrentUser(ctx);
        const event = await ctx.db.get(args.eventId);
        if (!event) throw new Error("Event not found");
        if (event.createdBy !== user._id) {
            throw new Error("Only the event's creator can cancel it.");
        }
        if (!isSeatingOpen(event.status)) {
            throw new Error("This event has already started.");
        }
        // An open event has no Pools, so there is normally nothing to clean
        // up — but delete unconditionally rather than assume it, since an
        // orphaned `limitedSeats` row would be unreachable forever.
        await deleteSeats(ctx, args.eventId);
        await ctx.db.delete(args.eventId);
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
        if (!isSeatingOpen(event.status)) {
            throw new Error("This event has already started.");
        }

        if (event.type === "draft") {
            const seats = fillBotSeats(event.seats);
            const seed = freshSeed();
            const now = Date.now();
            const timerConfig = buildTimerConfig(event.timerEnabled, now);
            const getPickRating = await loadEventPickRating(
                ctx,
                event.packSlots
            );
            const getCardProfile = await loadEventCardProfile(
                ctx,
                event.packSlots
            );
            const botChoosePick = makeBotChoosePick(
                getPickRating,
                getCardProfile
            );
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
            await saveSeats(ctx, args.eventId, afterBots.seats, {
                status: "started",
                seed,
                scorerVersion: SCORER_VERSION,
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
            // An ALL-BOT table finishes here: `runBotAutoPicks` drives the
            // whole draft to `draftCompletedAt` in this same mutation, so
            // completion flips inside `startLimitedEvent` and none of the
            // other call sites (`userDecks.create`, `submitPick`,
            // `autoPickSeatTimeout`) will ever run. Self-gating, so this is a
            // no-op for a normal table with a human still to build.
            await openPlayPhaseIfReady(ctx, args.eventId, now);
            return null;
        }

        const seats = fillBotSeats(event.seats);
        const seed = freshSeed();
        const rng = makeRng(seed);
        const now = Date.now();
        const seededSeats = generateSealedPools(
            seats,
            event.packSlots,
            event.sealedBoosterCount ?? DEFAULT_SEALED_BOOSTER_COUNT,
            getRuntimeBoosterConfig,
            resolveCardMeta,
            rng
        );

        await saveSeats(ctx, args.eventId, seededSeats, {
            status: "started",
            seed,
            scorerVersion: SCORER_VERSION,
            updatedAt: now,
        });
        // Same all-bot case as the draft branch above: dealing the Pools makes
        // every bot seat deck-ready immediately, so an all-bot Sealed table is
        // complete the instant it starts. No-op for a table with a human seat.
        await openPlayPhaseIfReady(ctx, args.eventId, now);
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
        // `undefined`/omitted leaves any existing override untouched. The
        // literal "lands" pins the card into the Lands column regardless of
        // its own type (issue #1573).
        column: v.optional(v.union(v.number(), v.literal("lands"), v.null())),
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
        // Only the caller's own seat is loaded: an arrangement edit reads and
        // writes exactly one seat's payload, and this fires on every drag in
        // the pool builder.
        const seats = await hydrateSeats(ctx, event, [seatIndex]);
        const seat = seats[seatIndex];
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
        await saveSeatPayload(
            ctx,
            event,
            seatIndex,
            { poolArrangement: nextArrangement },
            { updatedAt: Date.now() }
        );
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
        // Only the caller's own seat is loaded — the membership check below is
        // the sole reason this mutation needs any card data at all, and it
        // fires on every click in a Booster.
        const seats = await hydrateSeats(ctx, event, [seatIndex]);
        const seat = seats[seatIndex];
        if (
            args.pickId !== null &&
            !(seat.currentPack ?? []).some((c) => c.pickId === args.pickId)
        ) {
            throw new Error("That card is not in your current pack.");
        }

        seats[seatIndex] = {
            ...seat,
            selectedPickId: args.pickId ?? undefined,
        };
        // `selectedPickId` lives on the event row, so the write touches no
        // seat payload at all — a selection never rewrites a Pool.
        await saveSlimSeats(ctx, event, seats, { updatedAt: Date.now() });
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
        if (!areDraftPicksLegal(event.status)) {
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

        // FULL hydration: the pure engine passes packs between seats, so it
        // needs every seat's payload — a narrowed load would read another
        // seat's missing pack as an empty one.
        const hydratedSeats = await hydrateSeats(ctx, event);

        const now = Date.now();
        const timerConfig = buildTimerConfig(event.timerEnabled, now);
        const result = applyPick(
            hydratedSeats,
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
        const getPickRating = await loadEventPickRating(ctx, event.packSlots);
        const getCardProfile = await loadEventCardProfile(ctx, event.packSlots);
        const botChoosePick = makeBotChoosePick(getPickRating, getCardProfile);
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

        await saveSeats(ctx, args.eventId, afterBots.seats, {
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
        // The final pick can complete the table outright when every human had
        // already built off their growing Pool (ADR 0060's continuous
        // draft→build surface) — self-gating, so a no-op otherwise.
        await openPlayPhaseIfReady(ctx, args.eventId, now);
        return null;
    },
});

/** One-shot backfill for the `limitedSeats` split (`convex/schema.ts`): moves
 *  every already-stored event's inline seat payload into child rows.
 *
 *  Not strictly required for correctness — `ensureSeatsMigrated` read-repairs
 *  a legacy row the first time anything writes to it, and every read path
 *  tolerates the inline shape — but a row nobody writes to would stay fat
 *  forever, and a fat row is exactly what the list queries scan. Run once per
 *  deployment after deploying:
 *
 *      bunx convex run limitedEvents:migrateSeatPayload '{}'
 *
 *  Idempotent: an already-split event is detected by `eventHasInlinePayload`
 *  and
 *  skipped without a write, so re-running is free and safe. `limit` bounds one
 *  invocation's transaction; the returned `remaining` says whether to run it
 *  again. */
export const migrateSeatPayload = internalMutation({
    args: { limit: v.optional(v.number()) },
    returns: v.object({ migrated: v.number(), remaining: v.number() }),
    handler: async (ctx, args) => {
        const limit = args.limit ?? 25;
        // Bounded like `myLimitedEvents`' scan: a backfill has no index to
        // narrow by (there is no "is legacy" field to index), so it walks the
        // table under an explicit cap rather than an unbounded `collect`.
        const events = await ctx.db
            .query("limitedEvents")
            .take(MY_EVENTS_SCAN_LIMIT);
        let migrated = 0;
        let remaining = 0;
        for (const event of events) {
            if (!eventHasInlinePayload(event)) continue;
            if (migrated >= limit) {
                remaining++;
                continue;
            }
            await ensureSeatsMigrated(ctx, event);
            migrated++;
        }
        return { migrated, remaining };
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
        if (event.type !== "draft" || !areDraftPicksLegal(event.status)) {
            return null;
        }
        if (event.draftCompletedAt !== undefined) return null;
        if (event.seed === undefined || !event.timerEnabled) {
            return null;
        }

        // Cheap seq pre-check against the event row's slim seat, BEFORE any
        // payload is loaded. `resolveAutoPickTimeout` re-checks the same thing
        // (it stays the authority — this is not a second rule, it's the same
        // one asked early); most firings are stale schedules, and a stale one
        // should cost a single small read, not eight Pools.
        const slimSeat = event.seats[args.seatIndex];
        if (!slimSeat || slimSeat.isBot) return null;
        if ((slimSeat.pickSeq ?? 0) !== args.expectedSeq) return null;

        const hydratedSeats = await hydrateSeats(ctx, event);
        const getPickRating = await loadEventPickRating(ctx, event.packSlots);
        const getCardProfile = await loadEventCardProfile(ctx, event.packSlots);
        const botChoosePick = makeBotChoosePick(getPickRating, getCardProfile);
        const pickId = resolveAutoPickTimeout(
            hydratedSeats,
            args.seatIndex,
            args.expectedSeq,
            botChoosePick
        );
        if (pickId === null) return null; // stale schedule — no-op

        const now = Date.now();
        const timerConfig = buildTimerConfig(event.timerEnabled, now);
        const result = applyPick(
            hydratedSeats,
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

        await saveSeats(ctx, args.eventId, afterBots.seats, {
            draftRound: afterBots.draftRound,
            draftPacksRemaining: afterBots.draftPacksRemaining,
            updatedAt: now,
            ...(afterBots.completed ? { draftCompletedAt: now } : {}),
        });
        await scheduleSeatTimers(ctx, args.eventId, event.timerEnabled, now, [
            ...result.timerUpdates,
            ...afterBots.timerUpdates,
        ]);
        // Same completion seam as `submitPick` — an Auto-Picked final pick
        // finishes the table just as a human's does.
        await openPlayPhaseIfReady(ctx, args.eventId, now);
        return null;
    },
});
