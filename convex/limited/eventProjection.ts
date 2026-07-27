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
    LimitedMatchFormat,
    LimitedPairingResult,
    LimitedPoolCard,
    LimitedRound,
    PoolArrangementEntry,
} from "./eventTypes";
import { resolveMatchFormat } from "./matchFormat";
import { findSeatPairing, isRoundComplete } from "./rounds";
import {
    classifyPairingResult,
    computeStandings,
    type StandingsRow,
} from "./standings";

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
    /** Play phase (PRD #1628, ADR 0076). All four are OPTIONAL on the row: an
     *  event created before the play phase existed carries none of them, and a
     *  live event only gains `currentRound`/`rounds` when it starts playing.
     *  `matchFormat` is the one the projection makes DEFINITE on the wire —
     *  see `LimitedEventView.matchFormat`. */
    matchFormat?: LimitedMatchFormat;
    roundDeadlineMinutes?: number;
    currentRound?: number;
    rounds?: LimitedRound[];
    /** Event RNG seed (ADR 0055). See `LimitedEventView.seed` for why this
     *  projects only once `completed` (issue #1613, ADR 0074 replay mode). */
    seed?: number;
    /** Bot Drafter scorer version (issue #1613) —
     *  `convex/limited/scorerVersion.ts`'s `SCORER_VERSION` at the moment
     *  `startEvent` ran. Not privacy-sensitive (unlike `seed`, it names a code
     *  version, not entropy that regenerates hidden Pools), so it projects
     *  unconditionally, same as `matchFormat`/`packSlots`. */
    scorerVersion?: number;
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

/** A seat's compact deck summary (issue #1583): deck colors plus the maindeck
 *  and sideboard COUNTS — never the card list. Deliberately UNGATED (like
 *  `hasDeck`): colors + counts leak nothing about what a seat drafted or
 *  built, so the compact "Review the Table" summary renders one per seat for
 *  EVERY viewer, while the full card list (`pool`/`humanDeck`) stays
 *  admin-gated below. */
export interface DeckSummaryView {
    colors: string[];
    maindeckCount: number;
    sideboardCount: number;
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
     *  yet (the SAME full-disclosure-at-completion gate as `pool` above).
     *  Admin-gated (issue #1583): another seat's built deck is a debug detail
     *  populated only for an admin viewer — a non-admin only ever receives
     *  their OWN seat's `humanDeck`. */
    humanDeck: HumanDeckView | null;
    /** Compact per-seat deck summary (issue #1583) — colors + maindeck /
     *  sideboard COUNTS, never the card list. UNGATED (populated for every
     *  seat that has a deck, any viewer): it's what the compact review
     *  summary shows in place of the raw card lists. A human seat's is derived
     *  here from `humanDecksBySeat`; a bot seat's is filled by the query shell
     *  (`convex/limitedEvents.ts`'s `projectEventForViewer`) from its
     *  Auto-Built deck (`autoBuiltDeck`), so it projects to `null` here. */
    deckSummary: DeckSummaryView | null;
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

/** How the viewer's own pairing turned out, from the VIEWER's side (PRD #1628
 *  story 7/26, issue #1644). `null` while the pairing is still undecided —
 *  which is the state the round panel renders as "your match is waiting". */
export type ViewerPairingOutcome = "win" | "loss" | "draw";

/** The viewer's own pairing in the CURRENT round (PRD #1628 story 7, issue
 *  #1644) — the one thing every seat needs off the round state, pre-resolved
 *  here rather than re-derived by each client: which round it is, who they
 *  face, whether that opponent is a human or a bot, and whether the pairing is
 *  already decided.
 *
 *  Derived from `rounds`/`seats`, both of which the wire already carries in
 *  full — this is a CONVENIENCE, not a privacy boundary (pairings and results
 *  are public; only pools and decks are per-seat stripped). It exists because a
 *  client re-deriving "which pairing is mine, and did I win it" is a client
 *  re-implementing `classifyPairingResult`, which is exactly the drift ADR 0076
 *  made that function the single authority to prevent. */
export interface LimitedViewerPairingView {
    roundNumber: number;
    /** The viewer's own seat. */
    seatIndex: number;
    /** The seat the viewer faces — `null` when the viewer holds the round's
     *  bye (PRD story 27), which is also what `isBye` says. */
    opponentSeatIndex: number | null;
    opponentNickname: string | null;
    /** Whether the opponent is a Bot Drafter seat (PRD story 7: "opponent
     *  seat, human or bot"). `false` for a bye — there is no opponent. */
    opponentIsBot: boolean;
    isBye: boolean;
    /** The recorded result, `null` while the pairing is undecided. Carries
     *  `source`, so the UI can say HOW it was decided (story 26). RAW — its
     *  `winsA`/`winsB` are seat-A-relative, which is NOT necessarily the
     *  viewer's side; read `gameWins`/`gameLosses` below to render a score. */
    result: LimitedPairingResult | null;
    /** The game score from the VIEWER's side, `null` while undecided. Exists
     *  because `result.winsA` belongs to whichever seat the pairing calls A,
     *  and which side the viewer is on is deliberately not on the wire — a
     *  client flipping the score itself is one more place it can be flipped
     *  wrongly. */
    gameWins: number | null;
    gameLosses: number | null;
    /** The result read from the VIEWER's side — `null` while undecided. A bye
     *  is always a `"win"`; every other decided pairing is classified by
     *  `classifyPairingResult` (so a double-no-show `"timeout"` reads `"loss"`
     *  for both seats, never `"draw"`). */
    outcome: ViewerPairingOutcome | null;
    /** The Match this pairing is played through, once one exists. Always
     *  `null` in this slice — creating the Match is the next one. */
    matchId: string | null;
    /** Is every OTHER pairing of the round decided too? Lets the panel
     *  distinguish "the table is waiting on YOU" from "you're waiting on
     *  another seat" (PRD story 21). */
    roundComplete: boolean;
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
    /** The event's Match Format (PRD #1628 stories 1-2) — Bo1 or Bo3, chosen
     *  at creation. DEFINITE on the wire even though the stored field is
     *  optional: the projection resolves it through `resolveMatchFormat`, so a
     *  client (and the event page's format line) never has to know that events
     *  predating the play phase stored nothing, nor re-implement the default. */
    matchFormat: LimitedMatchFormat;
    /** Configured round deadline in minutes (PRD #1628 stories 3-4). Absent =
     *  no deadline. Public, not viewer-scoped: every seat needs to know whether
     *  the table is on a clock before it starts drafting. */
    roundDeadlineMinutes?: number;
    /** 1-based round currently being played; absent before the play phase. */
    currentRound?: number;
    /** Every round opened so far, with its pairings and decided results.
     *  PUBLIC (PRD #1628: pairings and results are public — pools and decks
     *  keep the per-seat stripping above). Always an ARRAY on the wire, `[]`
     *  before the play phase, so no client branches on absence. */
    rounds: LimitedRound[];
    /** The standings table (PRD #1628 stories 22-24/47, issue #1643) —
     *  DERIVED here at read time from `rounds`/`seats`, never stored (ADR
     *  0076): the table can never disagree with the results it's computed
     *  from. Public (like `rounds` above): pairings and results are public,
     *  only pools/decks are per-seat stripped. One row per seat, sorted
     *  points desc / game-win % desc / opponent match-win % desc
     *  (`computeStandings`'s own doc comment). Always populated, even before
     *  the play phase — an event with no rounds yet renders a zeroed table,
     *  not an absent one (issue #1643 AC). */
    standings: StandingsRow[];
    /** The viewer's own pairing in the current round (PRD #1628 story 7, issue
     *  #1644) — see `LimitedViewerPairingView`. `null` before the play phase,
     *  for a viewer with no seat at this table (a spectator or an admin), or
     *  for a seat somehow absent from the current round's pairings. */
    viewerPairing: LimitedViewerPairingView | null;
    /** Event RNG seed (ADR 0055), exposed ONLY for a `completed` DRAFT event
     *  AND ONLY to an admin viewer (issue #1613 fixup, tightening the
     *  original ADR 0074 "Draft Lab: replay mode" reveal). `null` in every
     *  other case:
     *  - a running event, where the same seed would let a live seat compute
     *    the packs it is about to be passed (the exact hidden information
     *    the privacy projection protects everywhere else);
     *  - a SEALED event, `completed` or not: `generateSealedPools`
     *    (`eventLogic.ts`) is a PURE function of `makeRng(seed)` +
     *    `packSlots` + `sealedBoosterCount` — all three already project
     *    unconditionally — so the seed alone lets ANY viewer regenerate
     *    EVERY seat's exact Pool client-side, defeating the admin gate on
     *    `pool`/`humanDeck` below (issue #1583). Worse, `completed` only
     *    means "every seat has a Deck" — PRD #1628's play phase keeps a
     *    Sealed event `completed` while matches are still being played
     *    (`projectEventForViewer`'s `arePoolsDealt`/`computeEventCompletion`
     *    gate is independent of the round/play-phase state), so an
     *    unconditional reveal would leak opponents' full pools DURING live
     *    matches, not just after the event is fully over;
     *  - a non-admin viewer of a completed DRAFT event: a non-admin gains
     *    nothing from the seed anyway (bot seats' `pool` stays `null` for
     *    them, so `reconstructDraftReplay` stops at `"hidden-pool"` on the
     *    first bot pick), so gating this to admin costs zero function while
     *    closing the leak.
     *  For a completed DRAFT event viewed by an admin, there is nothing left
     *  to spoil: the seed plus every seat's already-stored `pool` (which
     *  `pool`/`humanDeck` above ALSO only reveal to an admin at completion)
     *  is everything the Draft Lab replay surface needs to regenerate the
     *  packs and recompute every bot pick. */
    seed: number | null;
    /** Bot Drafter scorer version at the moment this event started
     *  (`convex/limited/scorerVersion.ts`). `undefined` for an event created
     *  before this field existed — the replay surface treats that as
     *  "unknown", never "version 0". Not gated on `completed`: naming a code
     *  version leaks nothing. */
    scorerVersion?: number;
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

/** Resolves the viewer's own pairing in the event's CURRENT round (issue
 *  #1644). Pure, and deliberately tolerant in every direction that isn't a
 *  real state: no play phase yet, no seat for this viewer, a `currentRound`
 *  naming a round that isn't in `rounds`, or a seat that somehow isn't paired
 *  — each returns `null` rather than throwing, because a projection runs on
 *  every read and must never be the thing that breaks the event page. */
function projectViewerPairing(
    event: LimitedEventRow,
    viewerSeat: LimitedEventSeat | undefined
): LimitedViewerPairingView | null {
    if (!viewerSeat || event.currentRound === undefined) return null;
    const round = event.rounds?.find(
        (r) => r.roundNumber === event.currentRound
    );
    if (!round) return null;
    const pairing = findSeatPairing(round, viewerSeat.seatIndex);
    if (!pairing) return null;

    const isBye = pairing.seatB === undefined;
    const viewerIsSeatA = pairing.seatA === viewerSeat.seatIndex;
    const opponentSeatIndex = isBye
        ? null
        : viewerIsSeatA
          ? pairing.seatB!
          : pairing.seatA;
    const opponentSeat =
        opponentSeatIndex === null
            ? undefined
            : event.seats.find((s) => s.seatIndex === opponentSeatIndex);

    const result = pairing.result ?? null;
    let outcome: ViewerPairingOutcome | null = null;
    if (result) {
        if (isBye) {
            // A bye is a match win for its seat regardless of the recorded
            // games (PRD story 28) — `classifyPairingResult` is explicitly
            // only for two-sided pairings.
            outcome = "win";
        } else {
            switch (classifyPairingResult(result)) {
                case "draw":
                    outcome = "draw";
                    break;
                case "doubleLoss":
                    outcome = "loss";
                    break;
                case "winA":
                    outcome = viewerIsSeatA ? "win" : "loss";
                    break;
                case "winB":
                    outcome = viewerIsSeatA ? "loss" : "win";
                    break;
            }
        }
    }

    return {
        roundNumber: round.roundNumber,
        seatIndex: viewerSeat.seatIndex,
        opponentSeatIndex,
        opponentNickname: opponentSeat?.nickname ?? null,
        opponentIsBot: opponentSeat?.isBot ?? false,
        isBye,
        result,
        // A bye's recorded games always belong to `seatA`, which for a bye IS
        // the viewer — so the same seat-A-relative flip covers both cases.
        gameWins:
            result === null
                ? null
                : viewerIsSeatA
                  ? result.winsA
                  : result.winsB,
        gameLosses:
            result === null
                ? null
                : viewerIsSeatA
                  ? result.winsB
                  : result.winsA,
        outcome,
        matchId: pairing.matchId ?? null,
        roundComplete: isRoundComplete(round),
    };
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
 *  Admin-gated full-disclosure reveal (issue #1583, narrowing PRD #1107 story
 *  26): once `completed` is true, every OTHER seat's `pool` and `humanDeck`
 *  are exposed ONLY to an admin viewer (`isAdmin`). These lists exist to debug
 *  the bot drafter / deckbuilder, so they're admin-only debug detail — a
 *  non-admin never receives another seat's pool or deck contents on the wire,
 *  completed or not. A viewer ALWAYS keeps their OWN seat's data (`isViewer`),
 *  admin or not. Every viewer still gets each seat's compact `deckSummary`
 *  (colors + counts) and `poolCount` — the summary the redesigned review
 *  renders in place of the raw lists. (Before #1583 the reveal was
 *  unconditional at completion; the hidden-information discipline that
 *  protects a LIVE draft/build is unchanged.) */
export function projectLimitedEvent(
    event: LimitedEventRow,
    viewerUserId: string | null,
    completed = false,
    seatsWithDeck = 0,
    humanDecksBySeat: ReadonlyMap<number, HumanDeckView> = new Map(),
    hasDeckBySeat: ReadonlySet<number> = new Set(),
    isAdmin = false
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
        // Play phase (PRD #1628). `matchFormat` is resolved here — the one
        // place the "absent means bo3" tolerance lives — so the wire shape is
        // definite; `rounds` normalises to `[]` for the same reason.
        matchFormat: resolveMatchFormat(event.matchFormat),
        roundDeadlineMinutes: event.roundDeadlineMinutes,
        currentRound: event.currentRound,
        rounds: event.rounds ?? [],
        // `computeStandings` is structurally compatible with `LimitedRound[]`/
        // `LimitedEventSeat[]` (both declare their own dependency-free shapes,
        // like `swiss.ts`/`completion.ts` do) — no adapter needed.
        standings: computeStandings(event.seats, event.rounds ?? []),
        viewerPairing: projectViewerPairing(
            event,
            viewerUserId === null
                ? undefined
                : event.seats.find((seat) => seat.userId === viewerUserId)
        ),
        // Issue #1613 fixup: gated on `completed` AND `type === "draft"` AND
        // `isAdmin` — see `LimitedEventView.seed`'s doc comment for why a
        // SEALED event (whose Pools the bare seed can regenerate
        // UNCONDITIONALLY, `generateSealedPools`/`packSlots`/
        // `sealedBoosterCount` all project regardless of viewer) and a
        // non-admin viewer (who cannot use the seed for anything — their
        // `reconstructDraftReplay` run stops at "hidden-pool" the moment it
        // hits a bot seat's `null` pool) must never receive it. Same
        // admin-gate discipline as `pool`/`humanDeck` below, not the
        // "everyone once completed" reveal this used to be.
        seed:
            completed && event.type === "draft" && isAdmin
                ? (event.seed ?? null)
                : null,
        scorerVersion: event.scorerVersion,
        completed,
        seatsWithDeck,
        createdAt: event.createdAt,
        updatedAt: event.updatedAt,
        seats: event.seats.map((seat) => {
            const isViewer =
                viewerUserId !== null && seat.userId === viewerUserId;
            // Debug detail (pool card list + built deck) reveals for the
            // viewer's OWN seat always, and for any OTHER seat only to an
            // admin at a completed event (issue #1583).
            const detailRevealed = isViewer || (completed && isAdmin);
            const humanDeckForSeat = seat.isBot
                ? null
                : (humanDecksBySeat.get(seat.seatIndex) ?? null);
            return {
                seatIndex: seat.seatIndex,
                userId: seat.userId,
                nickname: seat.nickname,
                isBot: seat.isBot ?? false,
                isViewer,
                poolCount: seat.pool ? seat.pool.length : null,
                pool: detailRevealed ? (seat.pool ?? null) : null,
                humanDeck:
                    completed && detailRevealed ? humanDeckForSeat : null,
                // Ungated compact summary — colors + counts only, for every
                // seat that has a submitted human deck. Bot seats are filled
                // by the query shell from `autoBuiltDeck` (null here).
                deckSummary: humanDeckForSeat
                    ? {
                          colors: humanDeckForSeat.colors,
                          maindeckCount: humanDeckForSeat.cards.length,
                          sideboardCount: humanDeckForSeat.sideboard.length,
                      }
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
