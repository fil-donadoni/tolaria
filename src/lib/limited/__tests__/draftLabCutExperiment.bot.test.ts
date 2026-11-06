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
//
// It is asserted on the pack that seat receives, never on its final Pool (issue
// #8515). The whole-draft sum is chaotic: on one test, untouched, it read 177,
// 65.5, 173, -1 and 141 as cards joined the catalogue, and -1 redded the base.
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
import type { DraftPackCard } from "@convex/limited/eventTypes";
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

/** Pick-rating power of `colour` in a pack. */
function colourPower(
    pack: readonly DraftPackCard[],
    colour: SignalColour
): number {
    return pack
        .filter((c) => hasColour(c.scryfallId, colour))
        .reduce((sum, c) => sum + ratingOf(c.scryfallId), 0);
}

/** The `colour` power in the pack the observed seat faces at its second pick:
 *  the cut seat's first pack minus the card that seat took. */
function secondPickPower(
    seed: number,
    colour: SignalColour,
    options: DraftLabRunOptions
): number {
    const state = runFullDraftLab(seed, PACK_SLOTS, 8, [], options);
    const pick = state.pickLog.find(
        (r) => r.seatIndex === OBSERVED_SEAT && r.seatPickNumber === 2
    );
    if (!pick) throw new Error(`seed ${seed}: no second pick for the seat`);
    return colourPower(pick.pack, colour);
}

describe("Cut Experiment: the upstream cut reaches the observed seat (issue #3738)", () => {
    for (const colour of CUT_COLOURS) {
        it(`a ${colour} cut upstream leaves the blind downstream seat a pack with less ${colour}`, () => {
            const pickPolicies: SeatPickPolicies = new Map([
                [CUT_SEAT, onlyColour(colour)],
            ]);
            // Blind on both arms: the drop is the cut's mechanical effect on
            // the pack, with no Draft Signal read in it.
            const blind: DraftLabRunOptions = { readSignal: false };
            const drops = SEEDS.map(
                (seed) =>
                    secondPickPower(seed, colour, blind) -
                    secondPickPower(seed, colour, {
                        ...blind,
                        pickPolicies,
                    })
            );
            // The bound holds per seed: the policy removes the best card of
            // the colour, and a normal pick removes that card or a lesser one.
            for (const [i, drop] of drops.entries()) {
                expect(
                    drop,
                    `seed ${SEEDS[i]}: the cut cannot leave more ${colour}`
                ).toBeGreaterThanOrEqual(0);
            }
            expect(
                Math.max(...drops),
                `the seat upstream cutting ${colour} must leave the observed ` +
                    `seat less ${colour} on some seed (drops ${drops.join(", ")}) ` +
                    `— else the pick policy never reached the table`
            ).toBeGreaterThan(0);
        });
    }
});
