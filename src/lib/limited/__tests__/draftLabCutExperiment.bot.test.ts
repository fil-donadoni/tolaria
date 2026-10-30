// Cut Experiment (ADR 0134, issue #3738) — GLOSSARY "Cut Experiment".
//
// For N fixed seeds, two synthetic cube tables differ in exactly one seat: in
// table A the seat immediately upstream of the observed seat (round-1 pass
// direction) takes only cards of one colour whenever it can; in table B it
// drafts normally.
//
// The OPINION half — a downstream seat that READS the Draft Signal loses more
// of the cut colour than one drafting blind — is RETIRED from the gate (owner
// ruling 2026-10-30): at the current weights it held for no
// colour (G last, flipped to 100.5 read vs 120.5 blind by a one-row cube
// addition), and any cube addition reshuffles the seeds' packs. It returns
// here as a gate once issue #7418's weights hold it. What stays is the
// harness, which is not an opinion: the cut reaches the observed seat.
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
const CUT_COLOURS: readonly SignalColour[] = ["G"];

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

describe("Cut Experiment: the upstream cut reaches the observed seat (issue #3738)", () => {
    for (const colour of CUT_COLOURS) {
        it(`a ${colour} cut upstream leaves the blind downstream seat less ${colour}`, () => {
            const pickPolicies: SeatPickPolicies = new Map([
                [CUT_SEAT, onlyColour(colour)],
            ]);
            // Blind on both arms: the drop is the cut's mechanical effect on
            // the packs, with no Draft Signal read in it.
            const blind: DraftLabRunOptions = { readSignal: false };
            const dropBlind =
                total(colour, blind) -
                total(colour, { ...blind, pickPolicies });
            expect(
                dropBlind,
                `the seat upstream cutting ${colour} must leave the observed ` +
                    `seat with less ${colour} power over ${SEEDS.length} seeds ` +
                    `(drop ${dropBlind.toFixed(1)}) — else the pick policy never ` +
                    `reached the table`
            ).toBeGreaterThan(0);
        });
    }
});
