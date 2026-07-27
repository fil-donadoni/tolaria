// Draft Lab synthetic-mode engine (issue #1612, ADR 0074, PRD #1607 slice 5).
//
// Runs a WHOLE 8-seat bot draft in the browser off the SAME pure modules the
// server picks with (`convex/limited/draftEngine.ts`, `convex/limited/botDrafter.ts`)
// — this file never generates a pack or moves a card between seats itself; it
// only drives those exported functions one pick at a time so the UI can step
// or auto-play. No Convex mutation is imported or called anywhere in this
// module (ADR 0074: "it writes nothing"; `draft-lab-no-mutation.test.ts`
// statically enforces this catalogue-wide across every Draft Lab file).
//
// Determinism (issue #1612 acceptance "same seed ⇒ same draft, every run"):
// every function here is a pure function of its arguments — `startDraft`/
// `applyPick`/`chooseBotPick`/`scorePack` are themselves pure and seeded only
// by the caller-supplied `eventSeed`, and `stepDraftLab`'s only other input is
// the previous `DraftLabState` — so replaying the same seed from a fresh
// `initDraftLab` always produces a byte-identical `DraftLabState` sequence
// (`draftLabEngine.test.ts`).
//
// That property survived issue #1611 making Card Profiles SCORE-BEARING only
// because the profile rows are SNAPSHOTTED into `DraftLabState` at
// `initDraftLab` (`cardProfileRows`) instead of being read from a live
// `useQuery` closure per step — otherwise a draft's picks would depend on
// whether the query had resolved when Start was pressed. See that field's doc
// comment; `useDraftLab.ts` additionally gates Start until the query lands.
import { startDraft, applyPick } from "@convex/limited/draftEngine";
import { getRuntimeBoosterConfig } from "@convex/limited/registry";
import {
    chooseBotPick,
    scorePack,
    type CardEvalMeta,
    type GetPickRating,
    type PickCandidateTrace,
} from "@convex/limited/botDrafter";
import { resolveEventPickRating } from "@convex/limited/cardRatingsCore";
import {
    buildDbProfileLookup,
    resolveEventCardProfile,
    type GetCardProfile,
    type GetDbProfile,
    type ScopedCardProfile,
} from "@convex/limited/cardProfilesCore";
import type {
    DraftPackCard,
    LimitedEventSeat,
} from "@convex/limited/eventTypes";
import {
    buildCubePool,
    isCubeSource,
    maxCubeSeats,
    CUBE_PACK_SIZE,
} from "@convex/limited/cube";
import {
    draftLabResolveCardMeta,
    draftLabGetCardEvalMeta,
} from "./draftLabCardMeta";

/** Seats in a standard Draft table (PRD #1107 / ADR 0054) — the Lab always
 *  fills every seat with a bot (issue #1612: "all seats bots"). A cube table
 *  is clamped below this by `draftLabSeatCount` when the implemented pool
 *  can't fill 8 seats singleton. */
export const DRAFT_LAB_SEAT_COUNT = 8;

/** Standard Draft: 3 Boosters per seat (PRD #1107 story 12). */
export const DRAFT_LAB_ROUND_COUNT = 3;

/** One already-decided pick, kept for the table view + the focused seat's
 *  candidate breakdown (issue #1612: "table view... the pick it made" /
 *  "ranked candidate list with the full term breakdown and its provenance"). */
export interface DraftLabPickRecord {
    /** 1-based, sequential across the WHOLE draft (bot picks interleave
     *  seats, so this is the Lab's own pick-log order, not a per-seat one). */
    pickIndex: number;
    seatIndex: number;
    /** This seat's own 1-based pick number (Pool size before this pick + 1) —
     *  the number the contextual cap ramped against (ADR 0073). */
    seatPickNumber: number;
    pack: readonly DraftPackCard[];
    /** Every candidate's full score breakdown, in pack order — the SAME
     *  traces `botDrafter.ts#scorePack`'s doc comment names the Draft Lab as
     *  reading (`botDrafter.ts`, "a debugging surface (Draft Lab) reads the
     *  SAME traces the pick is made from"). A `null` entry is a candidate
     *  `getCardEvalMeta` could not resolve (same contract as `scorePack`). */
    traces: readonly (PickCandidateTrace | null)[];
    chosenPickId: string;
}

/** The Lab's whole synthetic-draft session state — everything `stepDraftLab`
 *  reads and returns, and everything the UI renders. Plain data, no class,
 *  so two independent runs from the same seed can be compared by value
 *  (the determinism test). */
export interface DraftLabState {
    seed: number;
    packSlots: readonly string[];
    seats: readonly LimitedEventSeat[];
    draftRound: number;
    draftPacksRemaining: number;
    completed: boolean;
    /** Every pack a given seat has been shown so far, oldest first —
     *  `chooseBotPick`'s `packsSeen` (ADR 0073) built up across `stepDraftLab`
     *  calls, mirroring `runBotAutoPicks`'s own per-run bookkeeping
     *  (`draftEngine.ts`). */
    packsSeenBySeat: ReadonlyMap<number, readonly (readonly DraftPackCard[])[]>;
    pickLog: readonly DraftLabPickRecord[];
    /** SNAPSHOT of the cube pool this session deals from (ADR 0062), taken
     *  once at `initDraftLab` — the Lab's analogue of the `cubePool` a real
     *  event freezes on its row. Absent for a non-cube Pack Source. Every
     *  round of one session MUST slice the same shuffle, so the pool is
     *  carried in the state rather than re-derived per `stepDraftLab` call. */
    cubePool?: readonly string[];
    /** SNAPSHOT of the `cardProfiles` DB rows this session scores with (ADR
     *  0072, issue #1611) — taken ONCE, at `initDraftLab`, and never read
     *  from a live query again for the rest of the run.
     *
     *  This is a determinism requirement, not an optimisation. Card Profiles
     *  became SCORE-BEARING in issue #1611: they now feed Archetype Fit,
     *  Capability Fit and Combo Edge, so passing `useDraftLab.ts`'s live
     *  `useQuery` result straight into `stepDraftLab` would make the pick
     *  sequence depend on WHEN that query resolved — a draft started before
     *  the rows landed would score the first N picks with no profiles and the
     *  rest with them, and the same seed would replay differently. Freezing
     *  the rows into the session state at Start restores issue #1612's "same
     *  seed ⇒ same draft, every run" acceptance: `stepDraftLab` is once again
     *  a pure function of `(state, getPickRating)` alone. `useDraftLab.ts`
     *  additionally GATES Start until the query has resolved, so the snapshot
     *  is never an accidentally-empty one. */
    cardProfileRows: readonly ScopedCardProfile[];
}

/** Builds the Lab's layered Pick Rating lookup for a set of pack sources
 *  (`resolveEventPickRating`, mirroring `convex/limitedEvents.ts`'s
 *  `loadEventPickRating` minus the DB layer — `getDbRating` always returns
 *  `null`, which the module's own doc comment states degrades byte-for-byte
 *  to the seed-only layer). No `ctx`, no query: the SAME checked-in seed file
 *  the server falls back to when nothing overrides it in the database. */
export function buildDraftLabPickRating(
    packSlots: readonly string[]
): GetPickRating {
    return resolveEventPickRating(packSlots, () => null);
}

/** Builds the Lab's layered Card Profile lookup (`resolveEventCardProfile`,
 *  `convex/limited/cardProfiles.ts`) the same way `buildDraftLabPickRating`
 *  layers Pick Ratings, with one difference (issue #1612 fixup): the DB
 *  layer is now a REAL read, not a permanent `() => null`. `getDbProfile`
 *  defaults to `() => null` so a caller that genuinely has no live data
 *  (a unit test, e.g.) gets the pre-fixup seed-only behavior unchanged; the
 *  Lab's own caller (`useDraftLab.ts`) passes a `GetDbProfile` built from a
 *  live `useQuery(api.limited.cardProfiles.listScopeCardProfiles, …)`
 *  result via `buildDbProfileLookup` — a READ, never a mutation/action, so
 *  ADR 0074's "the Draft Lab writes nothing" guarantee is untouched.
 *  Surfaces `reviewed` (issue #1612: "surface unreviewed profiles visibly")
 *  for every card the Lab shows.
 *
 *  Determinism (issue #1612's "same seed ⇒ same draft") — UPDATED by issue
 *  #1611. Card Profiles are now SCORE-BEARING (Archetype Fit, Capability Fit,
 *  Combo Edge), so this lookup no longer feeds only the badge: `stepDraftLab`
 *  passes one into `scorePack`/`chooseBotPick`. What keeps the replay
 *  deterministic is that the scoring lookup is built from
 *  `DraftLabState.cardProfileRows` — a SNAPSHOT frozen at `initDraftLab` —
 *  and never from a live `useQuery` result mid-run. A late-arriving query can
 *  therefore still change what a badge shows before the next Start, but can
 *  never change a pick inside a running draft. */
export function buildDraftLabCardProfile(
    packSlots: readonly string[],
    getDbProfile: GetDbProfile = () => null
): GetCardProfile {
    return resolveEventCardProfile(packSlots, getDbProfile);
}

/** Standard packSlots for a Draft table off one Pack Source (issue #1612's
 *  seed input scopes the WHOLE draft to one source, same shape a real Draft
 *  Limited Event's `packSlots` has). */
export function standardPackSlots(sourceKey: string): string[] {
    return Array.from({ length: DRAFT_LAB_ROUND_COUNT }, () => sourceKey);
}

/** The seat count a Lab session can actually deal, given its Pack Source.
 *  Identical in spirit to `createLimitedEvent`'s server-side cube cap, and
 *  computed from the SAME `maxCubeSeats` authority: a cube is singleton, so a
 *  table wider than `floor(poolSize / (15 × rounds))` cannot be dealt without
 *  repeating a card. The Lab used to ask for 8 seats unconditionally, which
 *  overflowed the implemented pool and silently dealt duplicates (the deal now
 *  throws instead — clamping is what keeps the Lab working). Non-cube sources
 *  are sampled WITH replacement per round (ADR 0056) and are never clamped.
 *  Never returns less than 1 seat: a degenerate pool surfaces as the deal's
 *  own error, not as a table with no seats. */
export function draftLabSeatCount(
    requestedSeats: number,
    packSlots: readonly string[],
    cubePoolSize: number
): number {
    if (!packSlots.some(isCubeSource)) return requestedSeats;
    const cap = maxCubeSeats(cubePoolSize, CUBE_PACK_SIZE, packSlots.length);
    return Math.max(1, Math.min(requestedSeats, cap));
}

function createBotSeats(seatCount: number): LimitedEventSeat[] {
    return Array.from({ length: seatCount }, (_, seatIndex) => ({
        seatIndex,
        isBot: true,
        nickname: `Bot ${seatIndex + 1}`,
    }));
}

/** Deals round 0 to a fresh table of `seatCount` bot seats (issue #1612:
 *  "generate a draft from an arbitrary seed, all seats bots"). No timer
 *  config — the Lab has no human seat to time (`assignFreshPack` skips
 *  timer stamping for bot seats regardless, `draftEngine.ts`). */
export function initDraftLab(
    seed: number,
    packSlots: readonly string[],
    seatCount: number = DRAFT_LAB_SEAT_COUNT,
    cardProfileRows: readonly ScopedCardProfile[] = []
): DraftLabState {
    const cubePool = packSlots.some(isCubeSource) ? buildCubePool() : undefined;
    const seats = createBotSeats(
        draftLabSeatCount(seatCount, packSlots, cubePool?.length ?? 0)
    );
    const dealt = startDraft(
        seats,
        packSlots,
        seed,
        getRuntimeBoosterConfig,
        draftLabResolveCardMeta,
        undefined,
        cubePool
    );
    return {
        seed,
        packSlots,
        seats: dealt.seats,
        draftRound: dealt.draftRound,
        draftPacksRemaining: dealt.draftPacksRemaining,
        completed: false,
        packsSeenBySeat: new Map(),
        pickLog: [],
        cardProfileRows,
        ...(cubePool ? { cubePool } : {}),
    };
}

/** Finds the seat `runBotAutoPicks` would act on next: the first bot seat (in
 *  seat order) holding a non-empty `currentPack` — the SAME predicate
 *  `draftEngine.ts#runBotAutoPicks` uses, so single-stepping through
 *  `stepDraftLab` visits seats in exactly the order a real all-bot draft
 *  would (never a re-derived ordering that could disagree). */
function findNextActingSeat(seats: readonly LimitedEventSeat[]): number {
    return seats.findIndex(
        (s) => s.isBot && s.currentPack && s.currentPack.length > 0
    );
}

/** Advances the draft by exactly ONE bot pick (issue #1612: "step... and
 *  auto-play controls"). Scores the acting seat's pack via `scorePack` (the
 *  SAME traces `botDrafter.ts` documents the Lab as reading) and decides the
 *  pick via `chooseBotPick` — both real, pure, exported functions, called
 *  with identical `(pack, pool, options)` inputs, so the displayed breakdown
 *  is never a re-derivation of the decision, just a second (deterministic)
 *  read of it. Then applies the pick via `applyPick`, the same pass/queue/
 *  round-advance logic a human `submitPick` drives.
 *
 *  Returns `state` with `completed: true` (unchanged otherwise) when no bot
 *  seat has a pack to act on — draft over. Idempotent once completed. */
export function stepDraftLab(
    state: DraftLabState,
    getPickRating: GetPickRating
): DraftLabState {
    if (state.completed) return state;

    const seatIndex = findNextActingSeat(state.seats);
    if (seatIndex === -1) return { ...state, completed: true };

    // Built from the session's SNAPSHOT (`state.cardProfileRows`), never from
    // a live query result — see `DraftLabState.cardProfileRows`. Rebuilt per
    // step so `stepDraftLab` stays a pure function of its arguments (a cached
    // closure would have to live outside the state it is derived from); the
    // cost is one Map build over a bounded row set per pick.
    const getCardProfile = buildDraftLabCardProfile(
        state.packSlots,
        buildDbProfileLookup(state.cardProfileRows)
    );

    const seat = state.seats[seatIndex];
    const pack = seat.currentPack!;
    const seenSoFar = state.packsSeenBySeat.get(seatIndex) ?? [];
    const packsSeen = [...seenSoFar, pack];

    const poolMeta = (seat.pool ?? [])
        .map((c) => draftLabGetCardEvalMeta(c.scryfallId))
        .filter((m): m is CardEvalMeta => m !== null);
    // The seat's UNFILTERED Pool size — mirrors `chooseBotPick`'s own
    // pick-number derivation (`botDrafter.ts`: "the pick number comes from
    // the UNFILTERED Pool") so the displayed traces' `pickNumber`/
    // `contextCap` are exactly what decided this pick, never a re-derivation
    // from a filtered count that could disagree.
    const seatPickNumber = (seat.pool?.length ?? 0) + 1;

    const traces = scorePack(pack, poolMeta, draftLabGetCardEvalMeta, {
        packsSeen,
        getPickRating,
        getCardProfile,
        pickNumber: seatPickNumber,
    });
    const chosenPickId = chooseBotPick(
        pack,
        seat.pool ?? [],
        draftLabGetCardEvalMeta,
        { packsSeen, getPickRating, getCardProfile }
    );

    const result = applyPick(
        state.seats,
        state.draftRound,
        state.draftPacksRemaining,
        state.packSlots,
        seatIndex,
        chosenPickId,
        state.seed,
        getRuntimeBoosterConfig,
        draftLabResolveCardMeta,
        undefined,
        // The session's frozen cube pool — this pick may deal the next round,
        // which must slice the same shuffle round 0 came from (ADR 0062).
        state.cubePool
    );

    const nextPacksSeenBySeat = new Map(state.packsSeenBySeat);
    nextPacksSeenBySeat.set(seatIndex, packsSeen);

    const record: DraftLabPickRecord = {
        pickIndex: state.pickLog.length + 1,
        seatIndex,
        seatPickNumber,
        pack,
        traces,
        chosenPickId,
    };

    return {
        ...state,
        seats: result.seats,
        draftRound: result.draftRound,
        draftPacksRemaining: result.draftPacksRemaining,
        completed: result.completed,
        packsSeenBySeat: nextPacksSeenBySeat,
        pickLog: [...state.pickLog, record],
    };
}

/** Safety bound mirroring `draftEngine.ts`'s own `MAX_AUTO_PICK_ITERATIONS` —
 *  8 seats × 3 rounds × a ≤15-card pack is comfortably under this; existing
 *  only so a bug surfaces as a loud error, never a silent infinite loop. */
const MAX_STEPS = 10_000;

/** Runs `stepDraftLab` to completion — the fast path for "auto-play to the
 *  end" and the ONE code path the determinism test replays twice. */
export function runFullDraftLab(
    seed: number,
    packSlots: readonly string[],
    seatCount: number = DRAFT_LAB_SEAT_COUNT,
    cardProfileRows: readonly ScopedCardProfile[] = []
): DraftLabState {
    const getPickRating = buildDraftLabPickRating(packSlots);
    let state = initDraftLab(seed, packSlots, seatCount, cardProfileRows);
    for (let i = 0; i < MAX_STEPS && !state.completed; i++) {
        state = stepDraftLab(state, getPickRating);
        if (i === MAX_STEPS - 1) {
            throw new Error(
                "runFullDraftLab: exceeded the step bound — likely an infinite loop in pass/queue bookkeeping."
            );
        }
    }
    return state;
}
