// Comparative each-step triggers in the search (issue #8734) — CR 603.3d: a
// standing trigger whose PLAYER target is comparative ("target player who
// controls more creatures than they do", Oath of Druids) does nothing until a
// board crosses the threshold, and a move that crosses it arms the trigger
// for whichever player is now out-creatured.
//
// `armedStepTargetGates` names the armed (permanent, player-step) pairs; the
// tree below the root stops exploring a mover's move that arms an opponent's
// pair for less than `pass` (`withoutOpposingGateArms`), and the rollout's
// random draw never draws a gate flip (`flipsStepTargetGate`). Driven through
// the registry's own blade position, so the board here is the one the `must`
// entry pins.

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import { armedStepTargetGates } from "../ai/latentBoard";
import { buildBladeState } from "../ai/blade/build";
import { seatPlayerId } from "../ai/blade/matcher";
import { runBladeScenario } from "../ai/blade/runner";
import { BLADE_SCENARIOS } from "../ai/blade/scenarios";
import type { BladeScenario } from "../ai/blade/types";
import type { GameState } from "../state";

const ANCHOR =
    "comparative each-step trigger: Oko does not out-creature the opponent under its Oath of Druids, nor Dismember its own creature (issue #8734)";
const SIBLING =
    "comparative each-step trigger: without the Oath of Druids, Oko's +1 on its own Chromatic Star stays a free body (issue #8734)";

function entry(label: string): BladeScenario {
    const found = BLADE_SCENARIOS.find((s) => s.label === label);
    if (!found) throw new Error(`no blade entry "${label}"`);
    return found;
}

const OATH = getCardByName("Oath of Druids").id;

function oathInstanceId(state: GameState): string {
    for (const p of state.players) {
        const oath = p.battlefield.find((c) => c.card.id === OATH);
        if (oath) return oath.id;
    }
    throw new Error("no Oath of Druids on the battlefield");
}

describe("armedStepTargetGates (CR 603.3d)", () => {
    it("reads no permanent with a comparative each-step trigger as undefined", () => {
        expect(armedStepTargetGates(buildBladeState(entry(SIBLING)))).toBe(
            undefined
        );
    });

    it("arms the Oath for nobody while creatures are level", () => {
        expect(armedStepTargetGates(buildBladeState(entry(ANCHOR)))).toEqual(
            []
        );
    });

    it("arms the Oath on the opponent's step once the bot out-creatures it", () => {
        const anchor = entry(ANCHOR);
        const ahead: BladeScenario = {
            ...anchor,
            spec: {
                ...anchor.spec,
                cards: [
                    ...anchor.spec.cards,
                    {
                        name: "Grizzly Bears",
                        owner: "me",
                        zone: "battlefield",
                    },
                ],
            },
        };
        const state = buildBladeState(ahead);
        expect(armedStepTargetGates(state)).toEqual([
            `${oathInstanceId(state)}:${seatPlayerId(state, "opp")}`,
        ]);
    });
});

describe("search: a move arming the opponent's Oath (issue #8734)", () => {
    // Two of the `must` entry's seeds (the blade suite runs all of them):
    // 0xb1ade alone goes wrong under each of the three mechanisms removed,
    // seed 2 under two. A 400-iteration search probes every Oko activation
    // for loyalty-tick dominance at each enumeration, so even two seeds pass
    // the 60 s default under runner load: the budget is explicit (fixed
    // iterations, never time).
    it("Oko takes its +2, keeping creatures level, on the discriminating seeds", () => {
        const result = runBladeScenario({
            ...entry(ANCHOR),
            seeds: [0xb1ade, 2],
        });
        expect(result.ok, result.failureMessage).toBe(true);
        expect(result.seeds.map((s) => s.seed)).toEqual([0xb1ade, 2]);
        for (const seed of result.seeds) {
            expect(seed.move, seed.moveDescription).toMatchObject({
                kind: "activate-ability",
                abilityId: "oko-thief-of-crowns-plus2",
            });
        }
    }, 240_000);
});
