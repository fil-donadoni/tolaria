// Modal cardinality C (issue #2265) — the deterministic blade position for a
// multi-mode announcement, driven through the REAL search (`runBladeScenario` →
// `selectRootMove`), fixed iterations, explicit seeds.
//
// The position: the opponent is at 6 life and the bot holds a mode list that
// may choose "3 damage to any target" twice (CR 700.2d). Two instances at the
// opponent's face is lethal; no single mode is. So the right pick is not a
// preference but a forced win — and it is a move that exists ONLY if the
// enumerator offers the combination: a mode-at-a-time enumeration offers three
// damage at most and the search can never find the kill.
//
// It lives here rather than in the blade registry because no shipped card
// declares a `modeSelection` yet (slice D, issue #2266, ships them): the
// fixture is Darigaaz's Charm with a repeatable two-mode count, registered for
// the run through `withTemporaryDefinition`. A registry `must` entry naming a
// real card belongs with that card.

import { describe, expect, it } from "vitest";
import { getCardByName, withTemporaryDefinition } from "../../cards";
import { runBladeScenario } from "../ai/blade/runner";
import type { BladeScenario } from "../ai/blade/types";

const CHARM = getCardByName("Darigaaz's Charm");

const LETHAL_ONLY_AS_A_PAIR: BladeScenario = {
    label: "must: a repeatable two-mode burn list takes both damage instances at the face for lethal",
    spec: {
        cards: [
            { name: "Darigaaz's Charm", owner: "me", zone: "hand" },
            { name: "Swamp", owner: "me", zone: "battlefield" },
            { name: "Mountain", owner: "me", zone: "battlefield" },
            { name: "Forest", owner: "me", zone: "battlefield" },
        ],
        phase: "PRECOMBAT_MAIN",
        turn: 3,
        libraryCount: 20,
        life: { opp: 6 },
    },
    bot: "me",
    budget: { iterations: 200 },
    seeds: [0xb1ade, 1, 2, 3, 4],
    tier: "must",
    expect: {
        moves: [
            { kind: "cast-spell", card: "Darigaaz's Charm", target: "opp" },
        ],
    },
};

describe("blade: multi-mode announcement (issue #2265)", () => {
    it(LETHAL_ONLY_AS_A_PAIR.label, () => {
        const result = withTemporaryDefinition(
            { ...CHARM, modeSelection: { min: 2, max: 2, repeats: true } },
            () => runBladeScenario(LETHAL_ONLY_AS_A_PAIR)
        );
        expect(result.ok, result.failureMessage).toBe(true);
        // The matcher above cannot see modes; the pick that wins is the PAIR.
        for (const seed of result.seeds) {
            const move = seed.move;
            expect(move?.kind, seed.moveDescription).toBe("cast-spell");
            if (move?.kind !== "cast-spell") continue;
            expect(move.chosenModeIds, seed.moveDescription).toEqual([
                "damage",
                "damage",
            ]);
            expect(move.targets).toHaveLength(2);
            expect(move.modeTargetCounts).toEqual([1, 1]);
        }
    });
});
