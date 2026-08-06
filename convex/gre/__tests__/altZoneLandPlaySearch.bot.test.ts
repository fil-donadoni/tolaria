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
