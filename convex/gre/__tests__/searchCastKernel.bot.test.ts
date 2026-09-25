// The search's ONE cast commit sequence and ONE coarse mana payment
// (issue #4444).
//
// Until issue #4444 the ISMCTS applier (`applyMoveInSearch`), the greedy 1-ply
// sandbox (`applyMoveForSearch`) and the dominance probe (`applyProbeCast`)
// each kept their own copy of "pay the tap plan", and the two appliers each
// kept their own copy of the fourteen-step cast sequence. The copies had
// drifted in two places this file pins, one per shared seam:
//
//   * CR 609.4b / 118.14 (issue #2890) — only the GREEDY copy spent a one-shot
//     "for one spell this turn" mana-substitution grant, so in the tree the Bot
//     actually plays through one North Star activation funded every off-colour
//     cast down a line;
//   * CR 605.1a / 118.3 — the PROBE's tap plan tapped a sacrifice-for-mana
//     source instead of sacrificing it, so the probe board kept a Black Lotus
//     both appliers had already put in the graveyard.
//
// Lives in a `*.bot.test.ts` file because `convex/gre/search.ts` is a declared
// bot module (`bot-suite-boundary.test.ts` / `BOT_MODULE_EXACT`).
import { describe, it, expect } from "vitest";
import { applyMoveInSearch } from "../search";
import { applyMoveForSearch } from "../applyMove";
import { applyProbeCast } from "../ai/dominance";
import type { Move } from "../moves";
import type { GameState } from "../state";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { blackLotus, lightningBolt, mountain } from "../../cards/sets/lea";

type CastMove = Extract<Move, { kind: "cast-spell" }>;

/** p1 holds a Lightning Bolt with a Mountain and a Black Lotus in play. */
function boltPosition(): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: [
                    makeInstance(mountain.id, {
                        id: "mtn",
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "battlefield",
                    }),
                    makeInstance(blackLotus.id, {
                        id: "lotus",
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "battlefield",
                    }),
                ],
                hand: [
                    makeInstance(lightningBolt.id, {
                        id: "bolt",
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "hand",
                    }),
                ],
            }),
            makePlayer("p2"),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "PRECOMBAT_MAIN",
    });
}

function boltAtOpponent(tapPlan: CastMove["tapPlan"]): CastMove {
    return {
        kind: "cast-spell",
        cardInstanceId: "bolt",
        targets: [{ type: "player", id: "p2" }],
        confirmTargets: false,
        tapPlan,
    };
}

/** Both search appliers, normalised to "the state after the move". */
const APPLIERS: [string, (s: GameState, m: Move) => GameState][] = [
    [
        "applyMoveInSearch (ISMCTS)",
        (s, m) => {
            applyMoveInSearch(s, "p1", m);
            return s;
        },
    ],
    ["applyMoveForSearch (greedy)", (s, m) => applyMoveForSearch(s, "p1", m)],
];

describe("CR 609.4b / 118.14 — a cast spends the one-shot mana-substitution grant (issue #4444)", () => {
    for (const [name, apply] of APPLIERS) {
        it(`${name} spends exactly one grant per cast`, () => {
            const state = boltPosition();
            state.spellManaSubstitutionGrants = {
                p1: ["any-color", "any-color"],
            };

            const after = apply(
                state,
                boltAtOpponent([{ cardInstanceId: "mtn" }])
            );

            expect(after.spellManaSubstitutionGrants).toEqual({
                p1: ["any-color"],
            });
        });
    }
});

describe("CR 605.1a / 118.3 — every search sandbox sacrifices a sacrifice-for-mana source (issue #4444)", () => {
    const lotusPlan: CastMove["tapPlan"] = [
        { cardInstanceId: "lotus", manaChoiceIndex: 3 },
    ];
    const lotusZone = (state: GameState) => {
        const p1 = state.players.find((p) => p.id === "p1")!;
        return {
            onBattlefield: p1.battlefield.some((c) => c.id === "lotus"),
            inGraveyard: p1.graveyard.some((c) => c.id === "lotus"),
        };
    };

    for (const [name, apply] of APPLIERS) {
        it(`${name} puts the Lotus in the graveyard`, () => {
            const after = apply(boltPosition(), boltAtOpponent(lotusPlan));
            expect(lotusZone(after)).toEqual({
                onBattlefield: false,
                inGraveyard: true,
            });
        });
    }

    it("the dominance probe (applyProbeCast) puts the Lotus in the graveyard too", () => {
        const probe = boltPosition();
        expect(applyProbeCast(probe, "p1", boltAtOpponent(lotusPlan))).toBe(
            true
        );
        expect(lotusZone(probe)).toEqual({
            onBattlefield: false,
            inGraveyard: true,
        });
    });
});
