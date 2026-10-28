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
const CUT_COLOURS: readonly SignalColour[] = ["R", "U"];

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
    policies?: SeatPickPolicies
): number {
    const state = runFullDraftLab(seed, PACK_SLOTS, 8, [], policies);
    return colourPower(state.seats[OBSERVED_SEAT].pool ?? [], colour);
}

describe("Cut Experiment: Bot Drafter reads Draft Signals (issue #3738)", () => {
    for (const colour of CUT_COLOURS) {
        it(`seat downstream of a ${colour} cut ends with less ${colour} power`, () => {
            const policies: SeatPickPolicies = new Map([
                [CUT_SEAT, onlyColour(colour)],
            ]);
            let cut = 0;
            let normal = 0;
            for (const seed of SEEDS) {
                cut += observedPower(seed, colour, policies);
                normal += observedPower(seed, colour);
            }
            expect(
                cut,
                `OPINION-class Cut Experiment (GLOSSARY): with the seat upstream ` +
                    `cutting ${colour}, the downstream seat should end with LESS ` +
                    `${colour} power (cut ${cut.toFixed(1)} vs normal ` +
                    `${normal.toFixed(1)} over ${SEEDS.length} seeds). A red run ` +
                    `calls for a decision — accept and restate, or revert — never ` +
                    `an automatic weight change.`
            ).toBeLessThan(normal);
        });
    }
});
