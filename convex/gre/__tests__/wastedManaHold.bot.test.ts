// Wasted-mana hold — the root tie-break that stops the bot burning a ritual
// for mana nothing can spend (CR 106.4: unused mana is lost as the step ends).
//
// Reported from a real game: the bot cast Metamorphosis with an otherwise
// empty hand, sacrificing a Grizzly Bears as the additional cost, for three
// creature-only mana it had no creature spell to pay for — a creature, a card
// and a land's mana for nothing.
//
// The leaf evaluation was never the problem: `pass` scores 218 there against
// the cast's −12. The ROOT pick is settled on the accumulated `meanMargin`,
// and the `pass` edge's own subtree contains the same blunder one ply deeper,
// which drags its mean BELOW the cast's — so the cast won the material
// tie-break at every budget, `hard` (1200 iterations) included. Dark Ritual
// into an empty hand is the same shape without the sacrifice cost, which is
// why the seam is keyed on the POSITION (does any legal move spend the mana?)
// and never on a card.
//
// Each futile case is stated with its negative control: add a spender and the
// hold must have exactly zero effect.

import { describe, expect, it } from "vitest";
import type { GameState } from "../state";
import { buildBladeState } from "../ai/blade/runner";
import type { BladeScenario } from "../ai/blade/types";
import { searchWithTrace } from "../search";
import {
    setRootDecisionSink,
    type RootDecisionRecord,
} from "../ai/decisionTelemetry";

/** Build a position from a bare `ScenarioSpec`, reusing the blade harness so
 *  these tests and the blade registry entries describe boards the same way. */
function build(spec: BladeScenario["spec"]): GameState {
    return buildBladeState({
        label: "wasted-mana-unit",
        spec,
        bot: "me",
        budget: { iterations: 1 },
        tier: "must",
        expect: { moves: [{ kind: "pass" }] },
    });
}

const HARD = 1200;

/** Run the real search and report the chosen move's kind plus every root
 *  decision the telemetry sink recorded (one per search). */
function decide(
    state: GameState,
    seed: number
): { kind: string | undefined; label: string; mechanisms: string[] } {
    const records: RootDecisionRecord[] = [];
    setRootDecisionSink((r) => records.push(r));
    try {
        const { move, trace } = searchWithTrace(
            state,
            state.players[0].id,
            { iterations: HARD },
            seed
        );
        return {
            kind: move?.kind,
            label: trace?.chosen ?? "",
            mechanisms: records.map((r) => r.mechanism),
        };
    } finally {
        setRootDecisionSink(null);
    }
}

const SEEDS = [0xb1ade, 1, 2];

describe("wasted-mana hold (CR 106.4)", () => {
    it("holds Metamorphosis when no creature spell can spend its mana", () => {
        for (const seed of SEEDS) {
            const state = build({
                cards: [
                    { name: "Metamorphosis", owner: "me", zone: "hand" },
                    {
                        name: "Grizzly Bears",
                        owner: "me",
                        zone: "battlefield",
                        summoningSick: false,
                    },
                    {
                        name: "Craw Wurm",
                        owner: "me",
                        zone: "library",
                        count: 10,
                    },
                ],
                phase: "PRECOMBAT_MAIN",
                turn: 5,
                landCount: 4,
                libraryCount: 20,
            });
            const { kind, mechanisms } = decide(state, seed);
            expect(kind).toBe("pass");
            expect(mechanisms).toContain("wasted-mana-hold");
        }
    }, 120000);

    it("holds Dark Ritual with an empty hand — the same class without a sacrifice cost", () => {
        for (const seed of SEEDS) {
            const state = build({
                cards: [{ name: "Dark Ritual", owner: "me", zone: "hand" }],
                phase: "PRECOMBAT_MAIN",
                turn: 5,
                landCount: 4,
                libraryCount: 20,
            });
            const { kind, mechanisms } = decide(state, seed);
            expect(kind).toBe("pass");
            expect(mechanisms).toContain("wasted-mana-hold");
        }
    }, 120000);

    it("NEGATIVE CONTROL: still casts Dark Ritual when it turns on a Craw Wurm", () => {
        for (const seed of SEEDS) {
            // One Swamp pays the Ritual; its three black mana plus the three
            // remaining lands exactly cover the 6-MV Wurm, so a spender is in
            // the position and the hold must not fire.
            const state = build({
                cards: [
                    { name: "Dark Ritual", owner: "me", zone: "hand" },
                    { name: "Craw Wurm", owner: "me", zone: "hand" },
                ],
                phase: "PRECOMBAT_MAIN",
                turn: 5,
                landCount: 4,
                libraryCount: 20,
            });
            const { kind, mechanisms } = decide(state, seed);
            expect(kind).toBe("cast-spell");
            expect(mechanisms).not.toContain("wasted-mana-hold");
        }
    }, 120000);
});
