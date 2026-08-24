// CR 305.9 — the two search leaves must play a land from whichever zone the
// permission actually allows, not from hand unconditionally.
//
// `enumerateMoves` now offers a `play-land` move for a graveyard land under
// `playsLandsFromGraveyard` (Icetill Explorer / Crucible of Worlds / Ramunap
// Excavator, #1190) and for the top library land under
// `playsLandsFromTopOfLibrary` (Courser of Kruphix). Both leaves —
// `applyMoveForSearch` (the greedy 1-ply sandbox) and `applyMoveInSearch` (the
// ISMCTS tree leaf) — used to hard-code `"hand"` as the source zone, so such a
// move THREW `Card <id> not found in hand` the moment it reached them. Both now
// route through `resolvePlayLandSourceZone` (`gre/playLand.ts`), the same
// resolver the authoritative `playCard` mutation uses, so the simulated and
// real paths cannot drift.
//
// Note the enumeration gap this closes was NOT new with Courser: the graveyard
// permission had shipped for three cards and was already unreachable by the
// Bot, because the enumerator only ever fed `getLegalActions` hand cards.

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import { applyMoveForSearch } from "../applyMove";
import { applyMoveInSearch } from "../search";
import { enumerateMoves } from "../moves";
import { getPlayer, type GameState } from "../state";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";

const COURSER = getCardByName("Courser of Kruphix").id;
const ICETILL = getCardByName("Icetill Explorer").id;
const FOREST = getCardByName("Forest").id;
const SHOCK = getCardByName("Steam Vents").id;

/** p1 controls `permanentId` and holds one Forest in the named alternate zone. */
function altZoneBoard(
    permanentId: string,
    zone: "library" | "graveyard"
): GameState {
    const land = makeInstance(FOREST, {
        controllerId: "p1",
        ownerId: "p1",
        id: "alt-land",
        zone,
    });
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: [
                    makeInstance(permanentId, {
                        controllerId: "p1",
                        ownerId: "p1",
                        id: "source",
                    }),
                ],
                ...(zone === "library"
                    ? { library: [land] }
                    : { graveyard: [land] }),
            }),
            makePlayer("p2"),
        ],
    });
}

describe("alternate-zone land plays reach the search leaves (CR 305.9)", () => {
    for (const [label, permanentId, zone] of [
        ["top of library (Courser of Kruphix)", COURSER, "library"],
        ["graveyard (Icetill Explorer)", ICETILL, "graveyard"],
    ] as const) {
        describe(label, () => {
            it("enumerateMoves offers the play-land move", () => {
                const moves = enumerateMoves(
                    altZoneBoard(permanentId, zone),
                    "p1"
                );
                expect(moves).toContainEqual({
                    kind: "play-land",
                    cardInstanceId: "alt-land",
                });
            });

            it("applyMoveForSearch puts the land onto the battlefield instead of throwing", () => {
                const next = applyMoveForSearch(
                    altZoneBoard(permanentId, zone),
                    "p1",
                    { kind: "play-land", cardInstanceId: "alt-land" }
                );
                const player = getPlayer(next, "p1");
                expect(player.battlefield.map((c) => c.id)).toContain(
                    "alt-land"
                );
                expect(player[zone].map((c) => c.id)).not.toContain("alt-land");
                expect(player.landsPlayedThisTurn).toBe(1);
            });

            it("applyMoveInSearch puts the land onto the battlefield instead of throwing", () => {
                const state = altZoneBoard(permanentId, zone);
                applyMoveInSearch(state, "p1", {
                    kind: "play-land",
                    cardInstanceId: "alt-land",
                });
                const player = getPlayer(state, "p1");
                expect(player.battlefield.map((c) => c.id)).toContain(
                    "alt-land"
                );
                expect(player[zone].map((c) => c.id)).not.toContain("alt-land");
                expect(player.landsPlayedThisTurn).toBe(1);
            });
        });
    }

    // issue #1980 — the exile and graveyard origins now SUSPEND on the CR
    // 614.12 pay-choice for a shock land, exactly like hand and library-top.
    // A suspend the 1-ply leaf cannot answer is a frozen bot (the standing
    // rule: the bot never freezes a game), and a suspend `finalizeLandEntry`
    // cannot locate is a THROW mid-rollout. `autoFinalizeLandEntryChoices`
    // drains it with the ADR 0016 minimal-legal default (pay iff affordable),
    // reading the choice's own `landSourceZone` to find the land again.
    describe("shock land from an alternate zone does not stall the search leaf (CR 614.12)", () => {
        /** p1 holds a Steam Vents playable from `zone`. */
        function shockBoard(zone: "graveyard" | "exile"): GameState {
            const shock = makeInstance(SHOCK, {
                controllerId: "p1",
                ownerId: "p1",
                id: "alt-land",
                zone,
                ...(zone === "exile"
                    ? {
                          castableFromExileBy: "p1",
                          castableFromExileIncludesLand: true,
                      }
                    : {}),
            });
            return makeState({
                players: [
                    makePlayer("p1", {
                        life: 20,
                        battlefield:
                            zone === "graveyard"
                                ? [
                                      makeInstance(ICETILL, {
                                          controllerId: "p1",
                                          ownerId: "p1",
                                          id: "source",
                                      }),
                                  ]
                                : [],
                        ...(zone === "graveyard"
                            ? { graveyard: [shock] }
                            : { exile: [shock] }),
                    }),
                    makePlayer("p2"),
                ],
            });
        }

        for (const zone of ["graveyard", "exile"] as const) {
            it(`${zone}: the leaf drains the pay-choice and pays the 2 life`, () => {
                const next = applyMoveForSearch(shockBoard(zone), "p1", {
                    kind: "play-land",
                    cardInstanceId: "alt-land",
                });
                const player = getPlayer(next, "p1");
                // Drained, not left owed — nothing for the rollout to stall on.
                expect(next.pendingChoices ?? []).toHaveLength(0);
                expect(player.battlefield.map((c) => c.id)).toContain(
                    "alt-land"
                );
                expect(player[zone].map((c) => c.id)).not.toContain("alt-land");
                expect(player.landsPlayedThisTurn).toBe(1);
                // Affordable at 20 life → the default pays and enters untapped.
                expect(
                    player.battlefield.find((c) => c.id === "alt-land")!
                        .isTapped
                ).toBe(false);
                expect(player.life).toBe(18);
            });

            it(`${zone}: at 1 life the leaf declines and the land enters tapped`, () => {
                const board = shockBoard(zone);
                getPlayer(board, "p1").life = 1;
                const next = applyMoveForSearch(board, "p1", {
                    kind: "play-land",
                    cardInstanceId: "alt-land",
                });
                const player = getPlayer(next, "p1");
                expect(next.pendingChoices ?? []).toHaveLength(0);
                expect(
                    player.battlefield.find((c) => c.id === "alt-land")!
                        .isTapped
                ).toBe(true);
                expect(player.life).toBe(1);
            });
        }
    });

    it("applyMoveInSearch is a no-op for a stale move whose card no permitted zone holds", () => {
        const state = altZoneBoard(COURSER, "library");
        applyMoveInSearch(state, "p1", {
            kind: "play-land",
            cardInstanceId: "does-not-exist",
        });
        expect(getPlayer(state, "p1").battlefield.map((c) => c.id)).toEqual([
            "source",
        ]);
    });
});
