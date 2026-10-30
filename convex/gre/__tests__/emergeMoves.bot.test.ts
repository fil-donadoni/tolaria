// Bot-lane half of Emerge (CR 702.119, issue #3218): the cast mode has to be
// VISIBLE to the search and charged there exactly as the server charges it.
// `emerge.test.ts` proves the HUMAN path (gate + mutations); this file proves
// the enumerator and the search sandbox.
//
// Before this, `searchPayableOwnAlternativeCosts` refused every alternative
// cost carrying BOTH a mana leg and a permanent leg, and the cast-option
// filter refused a permanent leg beside a non-empty tap plan — emerge is both,
// so the Bot could never emerge. Pinned here:
//   1. the emerge cast is enumerated when ONLY the reduced emerge cost is
//      affordable, naming the LARGEST-mana-value victim (`planCastCostPicks`)
//      and tapping for the cost THAT victim leaves (CR 702.119a);
//   2. the search sandbox sacrifices exactly that one victim and puts the
//      spell on the stack — never a second, auto-resolved one beside it, even
//      when the tap plan makes two once-distinct artifacts look fungible.

import { describe, it, expect } from "vitest";
import { registerTokenDefinition } from "../../cards";
import type { CardDefinition } from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { enumerateMoves, type Move } from "../moves";
import { applyMoveForSearch } from "../applyMove";
import type { GameState } from "../state";
import { solRing, swamp } from "../../cards/sets/lea/index.cards";
import { triskelion } from "../../cards/sets/atq/colorless.cards";

// Crabomination's numbers: printed {4}{B}{B}, "Emerge from artifact {5}{B}{B}".
const PROBE_ID = "test:emerge-moves-probe";
const probe: CardDefinition = {
    id: PROBE_ID,
    rarity: "common",
    name: "Emerge Moves Probe",
    manaCost: { X: 4, B: 2 },
    emerge: {
        id: "emerge",
        description: "Emerge from artifact {5}{B}{B}",
        mana: { X: 5, B: 2 },
        permanent: {
            action: "sacrifice",
            count: 1,
            filter: { types: "Artifact" },
        },
    },
    types: ["Creature"],
    subtypes: ["Crab", "Demon"],
    power: 5,
    toughness: 5,
};
registerTokenDefinition(probe);

/** Two untapped Swamps — {B}{B}, a third of the printed cost — and two TAPPED
 *  artifacts of different mana value (Triskelion 6, Sol Ring 1), so the victim
 *  is a real choice the server parks for and the Move must name. */
function emergeBoard(): GameState {
    const own = (cardId: string, id: string, isTapped = false) =>
        makeInstance(cardId, {
            id,
            controllerId: "p1",
            ownerId: "p1",
            isTapped,
        });
    return makeState({
        players: [
            makePlayer("p1", {
                hand: [
                    makeInstance(PROBE_ID, {
                        id: "probe",
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "hand",
                    }),
                ],
                battlefield: [
                    own(swamp().id, "swamp-0"),
                    own(swamp().id, "swamp-1"),
                    own(triskelion().id, "tris", true),
                    own(solRing().id, "ring", true),
                ],
            }),
            makePlayer("p2"),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
}

function probeCasts(state: GameState): Extract<Move, { kind: "cast-spell" }>[] {
    return enumerateMoves(state, "p1").filter(
        (m): m is Extract<Move, { kind: "cast-spell" }> =>
            m.kind === "cast-spell" && m.cardInstanceId === "probe"
    );
}

describe("Emerge — the Bot enumerates and pays the emerge cast (CR 702.119a/c)", () => {
    it("enumerates the emerge cast on {B}{B}, naming the largest-mana-value victim and tapping for the reduced cost", () => {
        const casts = probeCasts(emergeBoard());
        // The printed {4}{B}{B} is out of reach on two Swamps: emerge is the
        // ONLY way in.
        expect(casts).toHaveLength(1);
        const [cast] = casts;
        expect(cast.alternativeCostId).toBe("emerge");
        expect(cast.castCostPicks?.sacrificeIds).toEqual(["tris"]);
        // {5}{B}{B} − 6 = {B}{B}: both Swamps, nothing else.
        expect(cast.tapPlan.map((t) => t.cardInstanceId).sort()).toEqual([
            "swamp-0",
            "swamp-1",
        ]);
    });

    it("the search sandbox sacrifices exactly the named victim and casts the spell", () => {
        const state = emergeBoard();
        const [cast] = probeCasts(state);
        const next = applyMoveForSearch(state, "p1", cast);
        const p1 = next.players.find((p) => p.id === "p1")!;
        expect(p1.graveyard.map((c) => c.id)).toEqual(["tris"]);
        expect(p1.battlefield.some((c) => c.id === "ring")).toBe(true);
        expect(p1.hand.some((c) => c.id === "probe")).toBe(false);
    });

    it("a tap plan that makes the candidates fungible still costs ONE victim — the named one", () => {
        // Two Sol Rings: "ring-a" TAPPED, "ring-b" untapped, so the server
        // sees two distinguishable candidates and parks; the Move names
        // ring-a (tied mana value 1, lowest id). The tap plan then taps
        // ring-b for mana, after which BOTH are tapped and the sandbox's own
        // auto-resolve would call them fungible and pick ring-b (first on the
        // battlefield) — beside the named ring-a, two victims for a
        // one-permanent cost.
        const own = (cardId: string, id: string, isTapped = false) =>
            makeInstance(cardId, {
                id,
                controllerId: "p1",
                ownerId: "p1",
                isTapped,
            });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [
                        makeInstance(PROBE_ID, {
                            id: "probe",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "hand",
                        }),
                    ],
                    battlefield: [
                        own(solRing().id, "ring-b"),
                        own(solRing().id, "ring-a", true),
                        ...[0, 1, 2, 3].map((i) =>
                            own(swamp().id, `swamp-${i}`)
                        ),
                    ],
                }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
        const cast = probeCasts(state).find(
            (m) =>
                m.alternativeCostId === "emerge" &&
                m.tapPlan.some((t) => t.cardInstanceId === "ring-b")
        );
        expect(cast?.castCostPicks?.sacrificeIds).toEqual(["ring-a"]);
        const next = applyMoveForSearch(state, "p1", cast!);
        const p1 = next.players.find((p) => p.id === "p1")!;
        expect(p1.graveyard.map((c) => c.id)).toEqual(["ring-a"]);
        expect(p1.battlefield.some((c) => c.id === "ring-b")).toBe(true);
    });
});
