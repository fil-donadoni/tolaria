// Event projection (PRD #1107, ADR 0054/0055, issue #1110): the privacy
// boundary between the authoritative `limitedEvents` row — which carries
// every seat's full Pool — and what a given viewer is allowed to see over the
// wire. Mirrors the discipline of `convex/gameProjections.ts`'s
// `projectPublicState`: a PURE function of (row, viewer), unit-testable
// without spinning up Convex, so "other seats' Pools are hidden during the
// event" is asserted through the SAME seam the client actually receives —
// never a hand-built view (the project's known recurring bug class, see
// `.claude/rules/gre-development.md` § Frontend wiring analysis).
import { isDroppedSeat } from "./droppedSeat";
import type {
    DraftPackCard,
    LimitedEventSeat,
    LimitedEventStatus,
    LimitedEventType,
    LimitedGamesFormat,
    LimitedPairingResult,
    LimitedPoolCard,
    LimitedRound,
    PoolArrangementEntry,
} from "./eventTypes";
import type { Rarity } from "../cards/types";
import {
    areDraftPicksLegal,
    areRoundsRunning,
    isEventConcluded,
} from "./eventStatus";
import { resolveEventBotDifficulty } from "./botDifficulty";
import { resolveEventGamesFormat } from "./gamesFormat";
import type { Difficulty } from "../gre/difficulty";
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
    /** Open Decklists (issue #5386, `GLOSSARY.md`) — absent on every event
     *  created before the setting existed, read as off. See
     *  `areOtherSeatsRevealed`. */
    openDecklists?: boolean;
    /** Play phase (PRD #1628, ADR 0076). All four are OPTIONAL on the row: an
     *  event created before the play phase existed carries none of them, and a
     *  live event only gains `currentRound`/`rounds` when it starts playing.
     *  `gamesFormat` is the one the projection makes DEFINITE on the wire —
     *  see `LimitedEventView.gamesFormat`. */
    gamesFormat?: LimitedGamesFormat;
    /** Bot difficulty of the event's vs-AI Matches (issue #6916) — absent on
     *  legacy rows, resolved to "medium" by `resolveEventBotDifficulty`. */
    botDifficulty?: Difficulty;
    /** Pre-rename key (issue #5337): read-only, see `resolveEventGamesFormat`. */
    matchFormat?: LimitedGamesFormat;
    roundDeadlineMinutes?: number;
    currentRound?: number;
    rounds?: LimitedRound[];
    /** Event RNG seed (ADR 0055). See `LimitedEventView.seed` for why this
     *  projects only once `completed` (issue #1613, ADR 0074 replay mode). */
    seed?: number;
    /** The frozen Vintage Cube pool (ADR 0062). See `LimitedEventView.cubePool`
     *  for why the projection gates it exactly like `seed`. */
    cubePool?: string[];
    /** Bot Drafter scorer version (issue #1613) —
     *  `convex/limited/scorerVersion.ts`'s `SCORER_VERSION` at the moment
     *  `startEvent` ran. Not privacy-sensitive (unlike `seed`, it names a code
     *  version, not entropy that regenerates hidden Pools), so it projects
     *  unconditionally, same as `gamesFormat`/`packSlots`. */
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
    /** The Card Definition `cardId` prints, when a saved entry's `cardId` is
     *  the opened PRINT (ADR 0140 §5, issue #5473) — the review classifies by
     *  it and renders `cardId`. */
    definitionId?: string;
}

/** A human seat's submitted `limited` Deck, projected for the review surface
 *  (issue #1116) — the SAME shape as a bot seat's `AutoBuiltDeck.cards` /
 *  `.sideboard` (`convex/limited/autoBuild.ts`), minus the strict 2-color
 *  tuple (a human's `userDecks.colors` is a free-form `string[]`, not
 *  Auto-Build's derived `[TrueColor, TrueColor]`). Gated like `pool` — see
 *  `LimitedEventSeatView.humanDeck`. */
export interface HumanDeckView {
    cards: ReviewDeckCard[];
    sideboard: ReviewDeckCard[];
    colors: string[];
}

/** A seat's compact deck summary (issue #1583): deck colors plus the maindeck
 *  and sideboard COUNTS — never the card list. Deliberately UNGATED (like
 *  `hasDeck`): colors + counts leak nothing about what a seat drafted or
 *  built, so the compact "Review the Table" summary renders one per seat for
 *  EVERY viewer, while the full card list (`pool`/`humanDeck`) stays behind
 *  `areOtherSeatsRevealed`. */
export interface DeckSummaryView {
    colors: string[];
    maindeckCount: number;
    sideboardCount: number;
}

/** A `currentPack` card as the client receives it: the stored card plus the
 *  dealt PRINTING's `rarity` (issue #5936), injected by the query shell
 *  (`projectEventForViewer`) — absent here, and on the wire for a card whose
 *  rarity cannot be resolved. */
export interface DraftPackCardView extends DraftPackCard {
    rarity?: Rarity;
}

export interface LimitedEventSeatView {
    seatIndex: number;
    userId?: string;
    nickname?: string;
    isBot: boolean;
    /** True once the occupant dropped from the started event (`droppedAt`,
     *  `droppedSeat.ts`) — the standings' "Dropped" marker. */
    isDropped: boolean;
    /** True when this seat belongs to the viewer — drives which seat's `pool`
     *  is populated below. */
    isViewer: boolean;
    /** Number of cards in this seat's Pool, always visible once generated —
     *  so a player can see the table opened boosters — `null` before
     *  `startLimitedEvent` runs. */
    poolCount: number | null;
    /** Full Pool contents. Populated for the viewer's own seat ALWAYS, and for
     *  every OTHER seat exactly when `areOtherSeatsRevealed` holds (issue
     *  #5386: once the event is finished, or from the Play Phase on with Open
     *  Decklists — never during the Draft, PRD #1107 story 15: "my picks
     *  hidden from other Seats during the draft"). For a DRAFT event, this
     *  array's element order IS the seat's pick order (`applyPick` appends
     *  one entry per Pick, never reorders) — the review UI numbers it
     *  directly, no separate "pick order" field needed. */
    pool: LimitedPoolCard[] | null;
    /** This seat's submitted `limited` Deck (issue #1116) — `null` for a bot
     *  seat (see `autoBuiltDeck` on `convex/limitedEvents.ts`'s wire shape
     *  instead, computed on demand rather than stored), for a human seat
     *  with no deck submitted yet, or for another seat while
     *  `areOtherSeatsRevealed` is false (the SAME gate as `pool` above —
     *  issue #5386 removed #1583's admin-only gate). The viewer's own deck is
     *  always populated. */
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
    currentPack: DraftPackCardView[] | null;
    /** Draft only: how many packs are queued behind `currentPack` — a COUNT,
     *  never a queued pack's contents. Public for EVERY seat while the Draft
     *  is live (issue #5390: the table ring's queued-packs badge); outside a
     *  live Draft it stays the viewer's own seat only, `null` for the rest. */
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
    /** Default Pick (ADR 0095, issue #2271) — see `LimitedEventSeat.
     *  defaultPickId`. Same "own seat only" discipline as `currentPack`/
     *  `pickDeadline`/`selectedPickId` above: another seat's Default Pick is
     *  exactly the kind of standing recommendation a live draft must never
     *  leak, disclosure or not. `null` for a non-viewer seat or whenever no
     *  default is currently stamped. */
    defaultPickId: string | null;
    /** Unattended Pick indices (ADR 0095, issue #2271) — see
     *  `LimitedEventSeat.unattendedPickIndices`. Own seat only, same
     *  discipline as the fields above. `null` for a non-viewer seat or when
     *  nothing is currently marked. */
    unattendedPickIndices: number[] | null;
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
    /** Open Decklists (issue #5386) — DEFINITE on the wire: a legacy row with
     *  nothing stored reads `false`, so the review banner and the Join
     *  warning never re-implement the default. */
    openDecklists: boolean;
    /** The event's Games Format (PRD #1628 stories 1-2) — Bo1 or Bo3, chosen
     *  at creation. DEFINITE on the wire even though the stored field is
     *  optional: the projection resolves it through `resolveGamesFormat`, so a
     *  client (and the event page's format line) never has to know that events
     *  predating the play phase stored nothing, nor re-implement the default. */
    gamesFormat: LimitedGamesFormat;
    /** The difficulty every vs-AI Match of this event plays at (issue #6916) —
     *  DEFINITE on the wire, resolved through `resolveEventBotDifficulty`. */
    botDifficulty: Difficulty;
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
    /** Event RNG seed (ADR 0055), exposed ONLY for a `completed` DRAFT event,
     *  ONLY once `areOtherSeatsRevealed` holds (issue #5386), and ONLY to an
     *  admin viewer (issue #1613 fixup, tightening the original ADR 0074
     *  "Draft Lab: replay mode" reveal). `null` in every other case:
     *  - any event whose Pools are still hidden — a running draft, or a Play
     *    Phase without Open Decklists (`completed` stays true right through
     *    the Play Phase): seed + `packSlots` regenerate every pack, so the
     *    seed can never open earlier than the Pools it reconstructs;
     *  - a SEALED event, ever: `generateSealedPools` (`eventLogic.ts`) is a
     *    PURE function of `makeRng(seed)` + `packSlots` +
     *    `sealedBoosterCount` — all three project unconditionally — and a
     *    revealed Sealed Pool is already on the wire, so the replay surface
     *    has no use for it;
     *  - a non-admin viewer: the Draft Lab replay surface is admin-only.
     *  For a revealed DRAFT event viewed by an admin, there is nothing left
     *  to spoil: the seed plus every seat's `pool` is everything the replay
     *  surface needs to regenerate the packs and recompute every bot pick. */
    seed: number | null;
    /** The Vintage Cube pool this draft was dealt from (ADR 0062), frozen on
     *  the event at `startEvent`. `null` for a non-cube event, and gated
     *  EXACTLY like `seed` above — pool + seed together regenerate every pack,
     *  so revealing it earlier or wider would reopen the hidden-information
     *  hole that doc comment closes. The replay surface needs it because the
     *  implemented cube pool GROWS: replaying a past cube draft against
     *  today's `buildCubePool()` would reshuffle the permutation and
     *  reconstruct packs that were never dealt. */
    cubePool: string[] | null;
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

/** The one revelation rule (issue #5386, PRD #5383): another seat's Pool,
 *  pick order and built Deck are visible to a viewer when the event is
 *  finished, or when Open Decklists is on and the event has reached the Play
 *  Phase. Never during the Draft or deckbuild (`started`), whatever the
 *  setting. Asked through the named status predicates (ADR 0076), never a
 *  literal status comparison. The viewer's OWN seat is outside this rule —
 *  always fully visible. */
export function areOtherSeatsRevealed(
    status: LimitedEventStatus,
    openDecklists: boolean
): boolean {
    if (isEventConcluded(status)) return true;
    return openDecklists && areRoundsRunning(status);
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
 *  Revelation (issue #5386): every OTHER seat's `pool` and `humanDeck` are
 *  exposed exactly when `areOtherSeatsRevealed` holds — to every viewer, admin
 *  or not (the admin-only gate of issue #1583 is gone; `isAdmin` now gates
 *  only `seed`/`cubePool`). A viewer ALWAYS keeps their OWN seat's data
 *  (`isViewer`). Every viewer still gets each seat's compact `deckSummary`
 *  (colors + counts) and `poolCount`. */
export function projectLimitedEvent(
    event: LimitedEventRow,
    viewerUserId: string | null,
    completed = false,
    seatsWithDeck = 0,
    humanDecksBySeat: ReadonlyMap<number, HumanDeckView> = new Map(),
    hasDeckBySeat: ReadonlySet<number> = new Set(),
    isAdmin = false
): LimitedEventView {
    const othersRevealed = areOtherSeatsRevealed(
        event.status,
        event.openDecklists ?? false
    );
    // The Draft is running: picks are legal and the last pack is not yet taken.
    const draftLive =
        event.type === "draft" &&
        areDraftPicksLegal(event.status) &&
        event.draftCompletedAt === undefined;
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
        openDecklists: event.openDecklists ?? false,
        // Play phase (PRD #1628). `gamesFormat` is resolved here — the one
        // place the "absent means bo3" tolerance lives — so the wire shape is
        // definite; `rounds` normalises to `[]` for the same reason.
        gamesFormat: resolveEventGamesFormat(event),
        botDifficulty: resolveEventBotDifficulty(event),
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
        // `isAdmin`, and (issue #5386) never before every Pool is revealed by
        // `areOtherSeatsRevealed` — seed + pack slots regenerate every pack,
        // so it can never open earlier than the pools it reconstructs. See `LimitedEventView.seed`'s doc comment for why a
        // SEALED event (whose Pools the bare seed can regenerate
        // UNCONDITIONALLY, `generateSealedPools`/`packSlots`/
        // `sealedBoosterCount` all project regardless of viewer) and a
        // non-admin viewer (who cannot use the seed for anything — their
        // `reconstructDraftReplay` run stops at "hidden-pool" the moment it
        // hits a bot seat's `null` pool) must never receive it.
        seed:
            completed && othersRevealed && event.type === "draft" && isAdmin
                ? (event.seed ?? null)
                : null,
        cubePool:
            completed && othersRevealed && event.type === "draft" && isAdmin
                ? (event.cubePool ?? null)
                : null,
        scorerVersion: event.scorerVersion,
        completed,
        seatsWithDeck,
        createdAt: event.createdAt,
        updatedAt: event.updatedAt,
        seats: event.seats.map((seat) => {
            const isViewer =
                viewerUserId !== null && seat.userId === viewerUserId;
            // Pool (pick order) + built deck: the viewer's OWN seat always,
            // any OTHER seat under the one revelation rule (issue #5386).
            const detailRevealed = isViewer || othersRevealed;
            const humanDeckForSeat = seat.isBot
                ? null
                : (humanDecksBySeat.get(seat.seatIndex) ?? null);
            return {
                seatIndex: seat.seatIndex,
                userId: seat.userId,
                nickname: seat.nickname,
                isBot: seat.isBot ?? false,
                isDropped: isDroppedSeat(seat),
                isViewer,
                // `pool` when it's loaded, else the denormalised `poolCount`
                // the event row carries (`convex/schema.ts`'s `limitedSeats`
                // split): a caller that deliberately didn't load another
                // seat's Pool still projects the right count. `null` only
                // when the seat genuinely has no Pool yet.
                poolCount: seat.pool
                    ? seat.pool.length
                    : (seat.poolCount ?? null),
                pool: detailRevealed ? (seat.pool ?? null) : null,
                humanDeck: detailRevealed ? humanDeckForSeat : null,
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
                // Count only, never contents: during the Draft every seat's
                // queued-pack count is public (the table ring's "who is
                // holding the table up" badge, issue #5390); outside it,
                // viewer-only as before.
                packQueueCount:
                    isViewer || draftLive
                        ? (seat.packQueue?.length ?? 0)
                        : null,
                pickDeadline: isViewer ? (seat.pickDeadline ?? null) : null,
                poolArrangement: isViewer
                    ? (seat.poolArrangement ?? null)
                    : null,
                selectedPickId: isViewer ? (seat.selectedPickId ?? null) : null,
                defaultPickId: isViewer ? (seat.defaultPickId ?? null) : null,
                unattendedPickIndices: isViewer
                    ? (seat.unattendedPickIndices ?? null)
                    : null,
                hasDeck: hasDeckBySeat.has(seat.seatIndex),
            };
        }),
    };
}
