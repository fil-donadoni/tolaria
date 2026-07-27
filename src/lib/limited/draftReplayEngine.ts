// Draft Lab replay mode (issue #1613, ADR 0074, PRD #1607 slice 6).
//
// Reconstructs a REAL completed Draft Limited Event from its `seed` plus
// every seat's stored `pool` — no persistence beyond what already exists
// (ADR 0074: "no draft log table exists"). This module never generates a
// pack or moves a card between seats itself; it drives the SAME pure,
// server-side functions the Draft Lab's synthetic mode already imports
// (`convex/limited/draftEngine.ts`, `convex/limited/botDrafter.ts` —
// `draftLabEngine.ts`), so it cannot drift from real Bot Drafter behaviour.
// No Convex mutation is imported or called anywhere in this module (ADR
// 0074's "it writes nothing" — `draft-lab-no-mutation.test.ts` statically
// enforces this catalogue-wide across every Draft Lab file, including this
// one, which lives in the same scanned `src/lib/limited/` directory).
//
// Reconstruction ALWAYS drives pack generation/passing off the REAL
// historical pick at every seat's turn — the pack card matching that seat's
// next `pool` entry, whether the seat is the human or a bot. This is what
// makes "replaying an unmodified event reproduces its stored pools exactly"
// true BY CONSTRUCTION: the same seed regenerates the same packs
// (`draftEngine.ts`'s `generateRoundPacks`/`roundSeed`, a pure function of
// the seed, no `Math.random`/`Date.now` anywhere in the path), and applying
// the SAME historical pick at every turn can only reproduce the SAME final
// per-seat pools.
//
// For every BOT seat's turn, the CURRENT `chooseBotPick` (`botDrafter.ts`) is
// ALSO run against that exact same real pack/pool context — purely as an
// independent annotation, never used to drive the simulation forward. That is
// the historical-vs-recomputed comparison the ADR names as the tuning signal
// ("see which of the 360 picks moved"), and it stays well-defined precisely
// because the CONTEXT it is asked from (the real historical pack) never
// changes, whether or not the recomputed pick agrees with history.
//
// A HUMAN seat's own pick has no "recomputed" analogue (`recomputedCardId:
// null`, `diverged: false` always) — a human decision isn't something a
// scorer predicts.
//
// Divergence point (ADR 0074 — the slice's sharpest requirement): the FIRST
// pick (in global order) where a BOT seat's recomputed pick differs from its
// historical one. Every entry from that point on is still computed and shown
// (nothing is silently dropped — "a replay tool that quietly keeps rendering
// after it has stopped describing reality is actively misleading"), but past
// that index the comparison is no longer a faithful preview of what a fully
// retuned redraft would actually have produced: a bot retuned from pick 1
// onward would have seen DIFFERENT downstream packs the instant its own pick
// changed, and this reconstruction deliberately does not simulate that
// counterfactual fork — it only ever replays the packs that were REALLY
// passed. `firstDivergedPickIndex` is exactly the marker the UI surfaces to
// say so.
import { startDraft, applyPick } from "@convex/limited/draftEngine";
import { getRuntimeBoosterConfig } from "@convex/limited/registry";
import {
    chooseBotPick,
    type GetCardEvalMeta,
    type GetPickRating,
} from "@convex/limited/botDrafter";
import type { GetCardProfile } from "@convex/limited/cardProfilesCore";
import type {
    DraftPackCard,
    LimitedEventSeat,
    LimitedPoolCard,
} from "@convex/limited/eventTypes";
import { draftLabResolveCardMeta } from "./draftLabCardMeta";

/** One reconstructed pick: historical fact beside the current scorer's
 *  recomputation (bot seats only). */
export interface ReplayPickEntry {
    /** 1-based, global across the whole draft (bot picks interleave seats —
     *  mirrors `DraftLabPickRecord.pickIndex`'s own numbering). */
    pickIndex: number;
    seatIndex: number;
    /** 1-based, per seat — the number the contextual cap (ADR 0073) ramped
     *  against for a bot's recomputed pick. */
    seatPickNumber: number;
    isBot: boolean;
    pack: readonly DraftPackCard[];
    /** The card ID this seat's stored `pool` actually recorded at this
     *  position — historical fact, never recomputed. */
    historicalCardId: string;
    /** What `chooseBotPick` (the CURRENT scorer) would choose from this SAME
     *  real pack/pool context — `null` for a human seat, which has no
     *  scorer-predicted analogue. */
    recomputedCardId: string | null;
    /** `recomputedCardId !== null && recomputedCardId !== historicalCardId`. */
    diverged: boolean;
}

/** Why reconstruction stopped before the whole draft replayed:
 *  - `"hidden-pool"` — this viewer cannot see the acting seat's `pool` (the
 *    same admin-gated privacy `eventProjection.ts` already enforces for
 *    every OTHER seat's pool — this module adds no new gate, it just can't
 *    proceed without the ground truth).
 *  - `"pool-mismatch"` — the seat's stored `pool` entry at this position
 *    doesn't match ANY card in the regenerated pack. This should never
 *    happen for an unmodified event/seed; it signals the seed or pack
 *    source recorded on the event no longer regenerates the SAME packs
 *    (e.g. a Draftable Set's card list changed under it). */
export type ReplayStopReason = "hidden-pool" | "pool-mismatch";

export interface ReplayResult {
    picks: readonly ReplayPickEntry[];
    /** `pickIndex` of the first entry with `diverged: true`, or `null` if
     *  none diverged. See the module doc for what this means for every entry
     *  from this point on. */
    firstDivergedPickIndex: number | null;
    /** `true` iff every pick replayed through to the draft's natural end. */
    complete: boolean;
    /** Set (non-null) iff `complete` is `false`. */
    stopReason: ReplayStopReason | null;
    /** The seat whose turn `stopReason` fired on, set iff `complete` is
     *  `false`. */
    stoppedAtSeat: number | null;
}

/** One seat's replay inputs: its role (bot/human) and its REAL stored `pool`,
 *  exactly as this viewer received it off the event projection — `null` when
 *  hidden (another seat's Pool, non-admin viewer). This module performs no
 *  privacy computation of its own; it consumes whatever `pool` the existing
 *  `eventProjection.ts` gate already decided this viewer may see. */
export interface ReplayEventSeatInput {
    seatIndex: number;
    isBot: boolean;
    pool: readonly LimitedPoolCard[] | null;
}

/** Mirrors `draftLabEngine.ts`'s own bound — 8 seats × 3 rounds × a ≤15-card
 *  pack is comfortably under this; it exists only so a bug in pass/queue
 *  bookkeeping surfaces as a loud error, never a silent infinite loop. */
const MAX_STEPS = 10_000;

/** Finds the seat whose turn is next: the first seat (in seat order) holding
 *  a non-empty `currentPack` — human or bot, unlike the synthetic-mode-only
 *  `findNextActingSeat` in `draftLabEngine.ts` (which only ever looks at bot
 *  seats, since synthetic mode has none). The specific interleaving order
 *  among simultaneously-ready seats doesn't affect any seat's FINAL pool —
 *  each seat's pack is disjoint from every other seat's at any given moment,
 *  so which ready seat resolves "first" changes nothing about what any seat
 *  ends up with; it only has to be a fixed, deterministic order (this one
 *  matches the real engine's own `runBotAutoPicks` predicate). */
function findNextActingSeat(seats: readonly LimitedEventSeat[]): number {
    return seats.findIndex((s) => s.currentPack && s.currentPack.length > 0);
}

function stopped(
    picks: readonly ReplayPickEntry[],
    stopReason: ReplayStopReason,
    stoppedAtSeat: number
): ReplayResult {
    return {
        picks,
        firstDivergedPickIndex:
            picks.find((p) => p.diverged)?.pickIndex ?? null,
        complete: false,
        stopReason,
        stoppedAtSeat,
    };
}

/** Reconstructs a completed Draft Limited Event from its `seed` and every
 *  seat's real stored `pool` (issue #1613). Pure — the only inputs are the
 *  arguments themselves, so the same arguments always reproduce the same
 *  `ReplayResult` (same-seed-same-reconstruction, every run). Draft only:
 *  a Sealed event has no picks/passing to replay. */
export function reconstructDraftReplay(
    seed: number,
    packSlots: readonly string[],
    seats: readonly ReplayEventSeatInput[],
    getCardEvalMeta: GetCardEvalMeta,
    getPickRating: GetPickRating,
    /** The event's LAYERED Card Profile lookup (PRD #1607, ADR 0072) — the
     *  second scoring layer `chooseBotPick` reads, alongside `getPickRating`.
     *  Omit ONLY to recompute deliberately profile-blind; every real caller
     *  passes the same `resolveEventCardProfile(packSlots, …)` lookup
     *  `convex/limitedEvents.ts`'s `loadEventCardProfile` built when the
     *  event was actually drafted, because a recomputed pick scored WITHOUT
     *  the layer the historical pick was scored WITH diverges for reasons
     *  that have nothing to do with the scorer changing — the whole point of
     *  `firstDivergedPickIndex`. */
    getCardProfile?: GetCardProfile,
    /** The FROZEN cube pool the event was dealt from (`limitedEvents.cubePool`,
     *  ADR 0062) — required to replay a cube event, ignored for a per-set one.
     *  Not defaulted to `buildCubePool()`: the implemented cube pool grows, and
     *  a pool one card larger reshuffles the entire permutation, so replaying
     *  against today's pool would reconstruct packs that were never dealt and
     *  report every pick as diverged for reasons that have nothing to do with
     *  the scorer. */
    cubePool?: readonly string[]
): ReplayResult {
    const seatShells: LimitedEventSeat[] = seats.map((s) => ({
        seatIndex: s.seatIndex,
        isBot: s.isBot,
    }));
    const dealt = startDraft(
        seatShells,
        packSlots,
        seed,
        getRuntimeBoosterConfig,
        draftLabResolveCardMeta,
        undefined,
        cubePool
    );
    let draftSeats = dealt.seats;
    let draftRound = dealt.draftRound;
    let draftPacksRemaining = dealt.draftPacksRemaining;

    const packsSeenBySeat = new Map<number, DraftPackCard[][]>();
    const picks: ReplayPickEntry[] = [];

    for (let step = 0; step < MAX_STEPS; step++) {
        const seatIndex = findNextActingSeat(draftSeats);
        if (seatIndex === -1) {
            return {
                picks,
                firstDivergedPickIndex:
                    picks.find((p) => p.diverged)?.pickIndex ?? null,
                complete: true,
                stopReason: null,
                stoppedAtSeat: null,
            };
        }

        const seat = draftSeats[seatIndex];
        const seatInput = seats[seatIndex];
        const pack = seat.currentPack!;
        const seatPickNumber = (seat.pool?.length ?? 0) + 1;

        const historicalPool = seatInput.pool;
        if (!historicalPool || historicalPool.length < seatPickNumber) {
            return stopped(picks, "hidden-pool", seatIndex);
        }
        const historicalEntry = historicalPool[seatPickNumber - 1];
        const historicalPackCard = pack.find(
            (c) =>
                c.scryfallId === historicalEntry.scryfallId &&
                c.cardId === historicalEntry.cardId
        );
        if (!historicalPackCard) {
            return stopped(picks, "pool-mismatch", seatIndex);
        }

        const seenSoFar = packsSeenBySeat.get(seatIndex) ?? [];
        const packsSeen = [...seenSoFar, pack];
        packsSeenBySeat.set(seatIndex, packsSeen);

        let recomputedCardId: string | null = null;
        if (seatInput.isBot) {
            const recomputedPickId = chooseBotPick(
                pack,
                seat.pool ?? [],
                getCardEvalMeta,
                { packsSeen, getPickRating, getCardProfile }
            );
            const recomputedPackCard = pack.find(
                (c) => c.pickId === recomputedPickId
            );
            recomputedCardId = recomputedPackCard?.cardId ?? null;
        }

        picks.push({
            pickIndex: picks.length + 1,
            seatIndex,
            seatPickNumber,
            isBot: seatInput.isBot,
            pack,
            historicalCardId: historicalEntry.cardId,
            recomputedCardId,
            diverged:
                recomputedCardId !== null &&
                recomputedCardId !== historicalEntry.cardId,
        });

        // ALWAYS drives the simulation forward with the REAL historical
        // pick (never the recomputed one) — see the module doc: this is
        // what guarantees the reconstruction reproduces the stored pools
        // exactly, and what keeps every downstream pack the REAL one that
        // was really passed, regardless of whether a bot's recomputed pick
        // diverges from history at this turn.
        const result = applyPick(
            draftSeats,
            draftRound,
            draftPacksRemaining,
            packSlots,
            seatIndex,
            historicalPackCard.pickId,
            seed,
            getRuntimeBoosterConfig,
            draftLabResolveCardMeta,
            undefined,
            cubePool
        );
        draftSeats = result.seats;
        draftRound = result.draftRound;
        draftPacksRemaining = result.draftPacksRemaining;
    }

    throw new Error(
        "reconstructDraftReplay: exceeded the step bound — likely an infinite loop in pass/queue bookkeeping."
    );
}
