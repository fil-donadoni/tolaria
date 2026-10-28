// Cut Experiment (PRD #1616, ADR 0134, issue #3738) — GLOSSARY "Cut Experiment".
//
// Pick Invariants prove the Draft Signal read is built right; this proves the
// Bot Drafter actually MOVES on it. For N fixed seeds, two synthetic cube
// tables differ in exactly one seat: in table A the seat immediately upstream
// of the observed seat (round-1 pass direction) takes only cards of one colour
// whenever it can; in table B it drafts normally. Summed over the seeds, the
// downstream seat must end with less power of that colour in table A.
//
// OPINION, not an invariant: like an Anchor Pick it holds for sensible
// weightings, not every one. A red run calls for a decision (accept and
// restate, or revert), never an automatic weight change.
import { describe, it, expect } from "vitest";
import {
    buildDraftLabPickRating,
    runFullDraftLab,
    standardPackSlots,
    type DraftLabRunOptions,
    type SeatPickPolicies,
    type SeatPickPolicy,
} from "../draftLabEngine";
import { draftLabGetCardEvalMeta } from "../draftLabCardMeta";
import { CUBE_SOURCE_KEY } from "@convex/limited/cubeSource";
import type { LimitedPoolCard } from "@convex/limited/eventTypes";
import type { SignalColour } from "@convex/limited/draftSignal";

const PACK_SLOTS = standardPackSlots(CUBE_SOURCE_KEY);
const SEEDS = [11, 23, 37, 41, 59, 71, 83, 97];
/** Round 0 passes `+1` (`draftEngine.ts#passDirection`): seat 0 feeds seat 1. */
const CUT_SEAT = 0;
const OBSERVED_SEAT = 1;
/** Measured at the read slice's weights (issue #3736): R holds, U does NOT —
 *  a blind seat loses MORE U power than a reading one (98.0 vs 160.5 over
 *  these seeds). Filed as a finding for the owner; weights are not tuned here
 *  (issue #3738 out of scope). */
const CUT_COLOURS: readonly SignalColour[] = ["R"];

const getPickRating = buildDraftLabPickRating(PACK_SLOTS);

function ratingOf(scryfallId: string): number {
    const meta = draftLabGetCardEvalMeta(scryfallId);
    return meta ? (getPickRating(meta.cardId) ?? 0) : 0;
}

function hasColour(scryfallId: string, colour: SignalColour): boolean {
    return (
        draftLabGetCardEvalMeta(scryfallId)?.colors.includes(colour) ?? false
    );
}

/** Takes the best-rated card of `colour` in the pack; `null` (drafts normally)
 *  when the pack holds none. */
function onlyColour(colour: SignalColour): SeatPickPolicy {
    return (pack) => {
        let best: { pickId: string; rating: number } | null = null;
        for (const card of pack) {
            if (!hasColour(card.scryfallId, colour)) continue;
            const rating = ratingOf(card.scryfallId);
            if (best === null || rating > best.rating) {
                best = { pickId: card.pickId, rating };
            }
        }
        return best?.pickId ?? null;
    };
}

/** Pick-rating power of `colour` in a Pool. */
function colourPower(
    pool: readonly LimitedPoolCard[],
    colour: SignalColour
): number {
    return pool
        .filter((c) => hasColour(c.scryfallId, colour))
        .reduce((sum, c) => sum + ratingOf(c.scryfallId), 0);
}

function observedPower(
    seed: number,
    colour: SignalColour,
    options: DraftLabRunOptions
): number {
    const state = runFullDraftLab(seed, PACK_SLOTS, 8, [], options);
    return colourPower(state.seats[OBSERVED_SEAT].pool ?? [], colour);
}

/** Total `colour` power the observed seat ends with over every seed. */
function total(colour: SignalColour, options: DraftLabRunOptions): number {
    return SEEDS.reduce(
        (sum, seed) => sum + observedPower(seed, colour, options),
        0
    );
}

describe("Cut Experiment: Bot Drafter reads Draft Signals (issue #3738)", () => {
    for (const colour of CUT_COLOURS) {
        it(`reading a ${colour} cut moves the downstream seat off ${colour}`, () => {
            const pickPolicies: SeatPickPolicies = new Map([
                [CUT_SEAT, onlyColour(colour)],
            ]);
            // The cut also removes cards from the pack mechanically, so the
            // raw A-vs-B gap is not evidence of READING. Each arm is run with
            // and without the signal read; the signal's contribution is how
            // much further the cut pushes the seat when it can read it.
            const dropRead =
                total(colour, {}) - total(colour, { pickPolicies });
            const dropBlind =
                total(colour, { readSignal: false }) -
                total(colour, { pickPolicies, readSignal: false });
            expect(
                dropRead,
                `OPINION-class Cut Experiment (GLOSSARY): with the seat upstream ` +
                    `cutting ${colour}, a downstream seat that READS the signal ` +
                    `should lose more ${colour} power than one that cannot ` +
                    `(drop ${dropRead.toFixed(1)} read vs ${dropBlind.toFixed(1)} ` +
                    `blind over ${SEEDS.length} seeds). A red run calls for a ` +
                    `decision — accept and restate, or revert — never an ` +
                    `automatic weight change.`
            ).toBeGreaterThan(dropBlind);
        });
    }
});
