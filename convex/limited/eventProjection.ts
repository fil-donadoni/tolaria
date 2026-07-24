// Event projection (PRD #1107, ADR 0054/0055, issue #1110): the privacy
// boundary between the authoritative `limitedEvents` row — which carries
// every seat's full Pool — and what a given viewer is allowed to see over the
// wire. Mirrors the discipline of `convex/gameProjections.ts`'s
// `projectPublicState`: a PURE function of (row, viewer), unit-testable
// without spinning up Convex, so "other seats' Pools are hidden during the
// event" is asserted through the SAME seam the client actually receives —
// never a hand-built view (the project's known recurring bug class, see
// `.claude/rules/gre-development.md` § Frontend wiring analysis).
import type {
    DraftPackCard,
    LimitedEventSeat,
    LimitedEventStatus,
    LimitedEventType,
    LimitedPoolCard,
    PoolArrangementEntry,
} from "./eventTypes";

/** The row shape this module projects — structurally what a `limitedEvents`
 *  Doc satisfies, kept independent of `Doc<"limitedEvents">` so this stays
 *  testable with plain fixtures (no `_generated` import needed). */
export interface LimitedEventRow {
    _id: string;
    createdBy: string;
    type: LimitedEventType;
    status: LimitedEventStatus;
    seatCount: number;
    packSlots: string[];
    sealedBoosterCount?: number;
    draftRound?: number;
    draftPacksRemaining?: number;
    draftCompletedAt?: number;
    /** Per-pick timer on/off (issue #1114, PRD #1107 story 5; ADR 0060 /
     *  issue #1243 replaced the fixed-seconds value with this boolean) —
     *  absent/false === disabled. Not per-seat: it's the event-wide config,
     *  always visible (not hidden information) so every seat's UI knows
     *  whether a countdown should render at all. */
    timerEnabled?: boolean;
    seats: LimitedEventSeat[];
    createdAt: number;
    updatedAt: number;
}

/** A minimal `{ cardId, cardName }` entry — mirrors `DeckCard`
 *  (`convex/deckPresets.ts`) without importing it, keeping this module
 *  dependency-free (project convention, see `LimitedPoolCard`/`DraftPackCard`
 *  above). */
export interface ReviewDeckCard {
    cardId: string;
    cardName: string;
}

/** A human seat's submitted `limited` Deck, projected for the review surface
 *  (issue #1116) — the SAME shape as a bot seat's `AutoBuiltDeck.cards` /
 *  `.sideboard` (`convex/limited/autoBuild.ts`), minus the strict 2-color
 *  tuple (a human's `userDecks.colors` is a free-form `string[]`, not
 *  Auto-Build's derived `[TrueColor, TrueColor]`). Populated ONLY once the
 *  event is `completed` — see `LimitedEventSeatView.humanDeck`. */
export interface HumanDeckView {
    cards: ReviewDeckCard[];
    sideboard: ReviewDeckCard[];
    colors: string[];
}

export interface LimitedEventSeatView {
    seatIndex: number;
    userId?: string;
    nickname?: string;
    isBot: boolean;
    /** True when this seat belongs to the viewer — drives which seat's `pool`
     *  is populated below. */
    isViewer: boolean;
    /** Number of cards in this seat's Pool, always visible once generated —
     *  so a player can see the table opened boosters — `null` before
     *  `startLimitedEvent` runs. */
    poolCount: number | null;
    /** Full Pool contents. Populated for the viewer's own seat ALWAYS, and for
     *  every OTHER seat once the event has reached `completed` (issue #1116:
     *  "full disclosure for study" — the projection is the enforcement point
     *  both ways, `strips during, reveals at completion`). Before completion,
     *  every other seat's Pool is stripped (PRD #1107 story 15: "my picks
     *  hidden from other Seats during the draft"). For a DRAFT event, this
     *  array's element order IS the seat's pick order (`applyPick` appends
     *  one entry per Pick, never reorders) — the review UI numbers it
     *  directly, no separate "pick order" field needed. */
    pool: LimitedPoolCard[] | null;
    /** This seat's submitted `limited` Deck (issue #1116) — `null` for a bot
     *  seat (see `autoBuiltDeck` on `convex/limitedEvents.ts`'s wire shape
     *  instead, computed on demand rather than stored), for a human seat
     *  with no deck submitted yet, or whenever the event isn't `completed`
     *  yet (the SAME full-disclosure-at-completion gate as `pool` above). */
    humanDeck: HumanDeckView | null;
    /** Draft only: the pack currently in front of THIS seat. Populated ONLY
     *  for the viewer's own seat — another seat's current pack is exactly
     *  the hidden information a Draft protects (PRD #1107 story 15). `null`
     *  for a Sealed event, before the draft starts, or a non-viewer seat. */
    currentPack: DraftPackCard[] | null;
    /** Draft only: how many packs are queued behind `currentPack` — viewer's
     *  own seat only (never another seat's, and never a queued pack's
     *  contents, only the count). `null` when not applicable/not the
     *  viewer. */
    packQueueCount: number | null;
    /** Draft only, timer-on events (issue #1114): epoch ms when this seat's
     *  CURRENT `currentPack` pick times out, so the UI can render a live
     *  countdown (`Date.now()` diffed client-side, never a server-ticking
     *  integer). Same "own seat only" discipline as `currentPack` — another
     *  seat's timing is no more the viewer's business than their cards.
     *  `null` when not applicable/not the viewer/no timer configured. */
    pickDeadline: number | null;
    /** This seat's Pool Arrangement (ADR 0060, issue #1247) — see
     *  `PoolArrangementEntry`. Same "own seat only" discipline as
     *  `currentPack`/`pickDeadline` above (never tied to `completed`): it's
     *  private working-deck state, not something a post-mortem study review
     *  needs from another seat. `null` for a non-viewer seat or before any
     *  card has ever been moved (an empty/absent stored array still projects
     *  to `null` there — nothing to disclose either way). */
    poolArrangement: PoolArrangementEntry[] | null;
    /** Selected Card (ADR 0060, issue #1248) — see `LimitedEventSeat.
     *  selectedPickId`. Same "own seat only" discipline as `currentPack`/
     *  `pickDeadline`/`poolArrangement` above: another seat's tentative
     *  selection is exactly the kind of signal a live draft must never leak,
     *  so it is never revealed even after `completed` (unlike `pool`). `null`
     *  for a non-viewer seat or when nothing is selected. */
    selectedPickId: string | null;
    /** Deck-ready indicator (issue #1580): true once THIS seat has a deck —
     *  a human seat once its `limited` deck is submitted, a bot seat once
     *  its Auto-Built deck is computable (Pool final). Deliberately visible
     *  for EVERY seat, always (not gated on `completed`/`isViewer`) — unlike
     *  `pool`/`humanDeck`/`autoBuiltDeck`, this is a pure readiness FLAG, not
     *  the deck's contents, so surfacing it never leaks what another seat
     *  drafted or built; it only answers "is the table still waiting on
     *  this seat". Caller-computed, same injection discipline as
     *  `completed`/`seatsWithDeck` (`computeEventCompletion`'s
     *  `hasDeckBySeat`). */
    hasDeck: boolean;
}

export interface LimitedEventView {
    _id: string;
    createdBy: string;
    type: LimitedEventType;
    status: LimitedEventStatus;
    seatCount: number;
    packSlots: string[];
    sealedBoosterCount?: number;
    draftRound?: number;
    draftPacksRemaining?: number;
    draftCompletedAt?: number;
    timerEnabled?: boolean;
    /** True once every seat has a Deck (issue #1116) — the caller-computed
     *  gate (`convex/limited/completion.ts`'s `computeEventCompletion`) that
     *  ALSO controls the `pool`/`humanDeck` full-disclosure reveal below.
     *  Defaults `false` for a caller that doesn't pass one (keeps every
     *  pre-#1116 test/call site byte-identical). */
    completed: boolean;
    /** How many seats currently have a Deck — "3/4 decks in" progress, live
     *  even before `completed` flips. */
    seatsWithDeck: number;
    seats: LimitedEventSeatView[];
    createdAt: number;
    updatedAt: number;
}

/** Projects a `limitedEvents` row for `viewerUserId` (`null` for an
 *  unauthenticated/anonymous read, which the lobby list never actually issues
 *  since every route requires login — kept for a defensive default).
 *
 *  `completed`/`seatsWithDeck` and `humanDecksBySeat` are CALLER-COMPUTED
 *  (issue #1116): whether the event is complete depends on the separate
 *  `userDecks` table (`computeEventCompletion`, `convex/limited/completion.ts`),
 *  a DB read this module — like the rest of `convex/limited/**` — never
 *  performs itself. Both default to "nothing complete, no decks known" so
 *  this stays call-compatible with every caller written before #1116.
 *
 *  Full-disclosure reveal (PRD #1107 story 26): once `completed` is true,
 *  EVERY seat's `pool` is exposed to EVERY viewer — participant or not — the
 *  same "strip during, reveal after" flip for `humanDeck`. This is
 *  deliberately broader than "only the event's own participants": the PRD's
 *  framing ("As a student of the game, I want all Pools revealed... so I can
 *  review what the table drafted") is a post-mortem study feature, not a
 *  participant perk — hidden-information discipline exists only to protect a
 *  LIVE draft/build from signal leakage, which is moot once every seat's
 *  deck is locked in. */
export function projectLimitedEvent(
    event: LimitedEventRow,
    viewerUserId: string | null,
    completed = false,
    seatsWithDeck = 0,
    humanDecksBySeat: ReadonlyMap<number, HumanDeckView> = new Map(),
    hasDeckBySeat: ReadonlySet<number> = new Set()
): LimitedEventView {
    return {
        _id: event._id,
        createdBy: event.createdBy,
        type: event.type,
        status: event.status,
        seatCount: event.seatCount,
        packSlots: event.packSlots,
        sealedBoosterCount: event.sealedBoosterCount,
        draftRound: event.draftRound,
        draftPacksRemaining: event.draftPacksRemaining,
        draftCompletedAt: event.draftCompletedAt,
        timerEnabled: event.timerEnabled,
        completed,
        seatsWithDeck,
        createdAt: event.createdAt,
        updatedAt: event.updatedAt,
        seats: event.seats.map((seat) => {
            const isViewer =
                viewerUserId !== null && seat.userId === viewerUserId;
            const poolRevealed = isViewer || completed;
            return {
                seatIndex: seat.seatIndex,
                userId: seat.userId,
                nickname: seat.nickname,
                isBot: seat.isBot ?? false,
                isViewer,
                poolCount: seat.pool ? seat.pool.length : null,
                pool: poolRevealed ? (seat.pool ?? null) : null,
                humanDeck:
                    completed && !seat.isBot
                        ? (humanDecksBySeat.get(seat.seatIndex) ?? null)
                        : null,
                currentPack: isViewer ? (seat.currentPack ?? null) : null,
                packQueueCount: isViewer ? (seat.packQueue?.length ?? 0) : null,
                pickDeadline: isViewer ? (seat.pickDeadline ?? null) : null,
                poolArrangement: isViewer
                    ? (seat.poolArrangement ?? null)
                    : null,
                selectedPickId: isViewer ? (seat.selectedPickId ?? null) : null,
                hasDeck: hasDeckBySeat.has(seat.seatIndex),
            };
        }),
    };
}
