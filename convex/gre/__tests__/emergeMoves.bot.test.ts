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
import { isSacrificeSelectionComplete } from "../sacrificeChoice";
import { announceCast, selectSacrifice } from "../../game";
import {
    makeMutationCtx,
    gameStateSeed,
    runMutation,
    type Handler,
} from "../../__tests__/gameMutationHarness.fixture";
import type { Id } from "../../_generated/dataModel";
import { solRing, swamp } from "../../cards/sets/lea/index.cards";
import { triskelion } from "../../cards/sets/atq/colorless.cards";
import { drought } from "../../cards/sets/ice/white.cards";

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

// CR 118.9d / 601.2f: Drought owes two Swamps on this {B}{B} card, on top of the
// emerge cost, and the plan and the sandbox charge the pair as ONE selection.
describe("Emerge beside Drought's tax — the Bot plans and pays the pair (CR 118.9d)", () => {
    const own = (cardId: string, id: string, isTapped = false) =>
        makeInstance(cardId, {
            id,
            controllerId: "p1",
            ownerId: "p1",
            isTapped,
        });
    const droughtBoard = (battlefield: ReturnType<typeof own>[]) =>
        makeState({
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
                    battlefield: [own(drought().id, "drought"), ...battlefield],
                }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
    const graveyardAfter = (state: GameState, move: Move) => {
        const next = applyMoveForSearch(state, "p1", move);
        const p1 = next.players.find((p) => p.id === "p1")!;
        expect(p1.hand.some((c) => c.id === "probe")).toBe(false);
        return p1.graveyard.map((c) => c.id).sort();
    };

    it("a real victim choice names the victim first, then the Swamps, and the sandbox pays each once", () => {
        const state = droughtBoard([
            own(swamp().id, "swamp-0"),
            own(swamp().id, "swamp-1"),
            own(swamp().id, "swamp-2"),
            own(triskelion().id, "tris", true),
            own(solRing().id, "ring", true),
        ]);
        const casts = probeCasts(state);
        expect(casts).toHaveLength(1);
        const [cast] = casts;
        expect(cast.castCostPicks?.announcedSacrificeIds).toBeUndefined();
        expect(cast.castCostPicks?.sacrificeIds?.[0]).toBe("tris");
        expect(cast.castCostPicks?.sacrificeIds).toHaveLength(3);
        expect(graveyardAfter(state, cast)).toEqual(
            [...cast.castCostPicks!.sacrificeIds!].sort()
        );
    });

    it("an auto-resolved plan survives a tap plan that splits the fungible Swamps", () => {
        // Three untapped Swamps are fungible at announcement. The tap plan taps
        // two of them, so the sandbox could no longer re-derive those victims.
        const state = droughtBoard([
            own(swamp().id, "swamp-0"),
            own(swamp().id, "swamp-1"),
            own(swamp().id, "swamp-2"),
            own(triskelion().id, "tris", true),
        ]);
        const [cast] = probeCasts(state);
        expect(cast.tapPlan).toHaveLength(2);
        expect(cast.castCostPicks?.announcedSacrificeIds).toEqual([
            "tris",
            "swamp-0",
            "swamp-1",
        ]);
        expect(cast.castCostPicks?.sacrificeIds).toBeUndefined();
        expect(graveyardAfter(state, cast)).toEqual([
            "swamp-0",
            "swamp-1",
            "tris",
        ]);
    });

    it("the plan matches what the announcement parks, so the executor's submissions complete it", async () => {
        const state = droughtBoard([
            own(swamp().id, "swamp-0"),
            own(swamp().id, "swamp-1", true),
            own(swamp().id, "swamp-2"),
            own(swamp().id, "swamp-3"),
            own(triskelion().id, "tris", true),
        ]);
        const [cast] = probeCasts(state);
        const harness = makeMutationCtx("p1", [gameStateSeed(state)]);
        await runMutation<Record<string, unknown>, void>(
            announceCast as unknown as Handler<Record<string, unknown>, void>,
            harness.ctx,
            {
                gameId: "game-1" as Id<"games">,
                playerId: "p1",
                cardInstanceId: "probe",
                alternativeCostId: "emerge",
            }
        );
        expect(harness.state().pendingCast?.sacrificeSelection?.picked).toEqual(
            cast.castCostPicks?.announcedSacrificeIds
        );
        for (const id of cast.castCostPicks?.sacrificeIds ?? []) {
            await runMutation<Record<string, unknown>, void>(
                selectSacrifice as unknown as Handler<
                    Record<string, unknown>,
                    void
                >,
                harness.ctx,
                {
                    gameId: "game-1" as Id<"games">,
                    playerId: "p1",
                    cardInstanceId: id,
                }
            );
        }
        const sel = harness.state().pendingCast?.sacrificeSelection;
        expect(sel && isSacrificeSelectionComplete(sel)).toBe(true);
    });

    it("withholds the cast on a board one Swamp short of the tax", () => {
        const state = droughtBoard([
            own(swamp().id, "swamp-0"),
            own(triskelion().id, "tris", true),
        ]);
        expect(probeCasts(state)).toEqual([]);
    });
});
