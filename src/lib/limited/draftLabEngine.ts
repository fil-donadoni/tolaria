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
import { startDraft, applyPick } from "@convex/limited/draftEngine";
import { getRuntimeBoosterConfig } from "@convex/limited/registry";
import {
    chooseBotPick,
    scorePack,
    type CardEvalMeta,
    type GetPickRating,
    type PickCandidateTrace,
} from "@convex/limited/botDrafter";
import { resolveEventPickRating } from "@convex/limited/cardRatings";
import {
    resolveEventCardProfile,
    type GetCardProfile,
} from "@convex/limited/cardProfiles";
import type {
    DraftPackCard,
    LimitedEventSeat,
} from "@convex/limited/eventTypes";
import {
    draftLabResolveCardMeta,
    draftLabGetCardEvalMeta,
} from "./draftLabCardMeta";

/** Seats in a standard Draft table (PRD #1107 / ADR 0054) — the Lab always
 *  fills every seat with a bot (issue #1612: "all seats bots"). */
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
 *  `convex/limited/cardProfiles.ts`) the same way — DB layer always `null`,
 *  seed layer live. Surfaces `reviewed` (issue #1612: "surface unreviewed
 *  profiles visibly") for every card the Lab shows, independent of whether
 *  the scorer itself reads Card Profiles yet (PRD #1607 slice 4 is separate
 *  from this slice). */
export function buildDraftLabCardProfile(
    packSlots: readonly string[]
): GetCardProfile {
    return resolveEventCardProfile(packSlots, () => null);
}

/** Standard packSlots for a Draft table off one Pack Source (issue #1612's
 *  seed input scopes the WHOLE draft to one source, same shape a real Draft
 *  Limited Event's `packSlots` has). */
export function standardPackSlots(sourceKey: string): string[] {
    return Array.from({ length: DRAFT_LAB_ROUND_COUNT }, () => sourceKey);
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
    seatCount: number = DRAFT_LAB_SEAT_COUNT
): DraftLabState {
    const seats = createBotSeats(seatCount);
    const dealt = startDraft(
        seats,
        packSlots,
        seed,
        getRuntimeBoosterConfig,
        draftLabResolveCardMeta
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
        pickNumber: seatPickNumber,
    });
    const chosenPickId = chooseBotPick(
        pack,
        seat.pool ?? [],
        draftLabGetCardEvalMeta,
        { packsSeen, getPickRating }
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
        draftLabResolveCardMeta
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
    seatCount: number = DRAFT_LAB_SEAT_COUNT
): DraftLabState {
    const getPickRating = buildDraftLabPickRating(packSlots);
    let state = initDraftLab(seed, packSlots, seatCount);
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
