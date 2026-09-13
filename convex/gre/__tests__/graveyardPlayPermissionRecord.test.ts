// ADR 0093 (issue #2244) — the one graveyard play permission record and its
// single resolver, on the axes no single shipped card isolates:
//   - uses keyed by SOURCE: two once-per-turn sources grant two uses
//   - one use covers BOTH actions (Serra Paragon's shape, issue #1239)
//   - the land-play consumption, on the immediate AND the suspended
//     (CR 614.12 pay-choice) path
//   - the own-turn / once-per-turn gates as DATA on either form of the record
//   - the deterministic selection between an unlimited and a once-per-turn
//     permission covering the same cast (no prompt — maintainer decision)
// CR 601.3 — a permission is what lets a spell begin to be cast at all;
// CR 305.1 — playing a land is a special action.
import { describe, it, expect } from "vitest";
import type {
    CardDefinition,
    GraveyardPlayPermission,
    MayPayCost,
} from "../../cards/types";
import { CASTABLE_PERMANENT_TYPES } from "../../cards/types";
import { withTemporaryDefinition } from "../../cards/registry";
import { getPlayer, type CardInstanceState } from "../state";
import {
    applyPlayLandFromAnyZone,
    applyPlayLandFromGraveyard,
    finalizeLandEntry,
} from "../playLand";
import {
    canCastFromGraveyardByPermission,
    canPlayLandsFromGraveyard,
    getGraveyardPlayPermissions,
    markGraveyardPlayPermissionUsed,
    selectGraveyardPlayPermission,
} from "../rules";
import { locateCastSource } from "../../game";
import { projectPublicState } from "../../gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { mountain, savannahLions } from "../../cards/sets/lea";
import { crucibleOfWorlds } from "../../cards/sets/5dn/colorless";
import { wateryGrave } from "../../cards/sets/rav/colorless";
import { lurrus } from "../../cards/sets/iko/multicolor";

const SOURCE_DEF_ID = "test-graveyard-play-permission-source";

/** A synthetic, NON-legendary permanent declaring `permission` — the holder
 *  no shipped card provides (Lurrus is Legendary, so two of her can never
 *  share a battlefield). */
function permissionSource(permission: GraveyardPlayPermission): CardDefinition {
    return {
        ...crucibleOfWorlds,
        id: SOURCE_DEF_ID,
        name: "Test Graveyard Permission Source",
        graveyardPlayPermission: permission,
    };
}

/** Serra Paragon's shape (issue #1239): either action, one use per turn. */
const ONCE_PER_TURN_EITHER_ACTION: GraveyardPlayPermission = {
    actions: ["play-land", "cast"],
    cardTypes: [...CASTABLE_PERMANENT_TYPES],
    maxManaValue: 3,
    oncePerTurn: true,
    yourTurnOnly: true,
};

function p1Card(
    defId: string,
    id: string,
    zone: CardInstanceState["zone"]
): CardInstanceState {
    return makeInstance(defId, { id, controllerId: "p1", ownerId: "p1", zone });
}

function board(battlefield: string[], graveyard: [string, string][]) {
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: battlefield.map((id) =>
                    p1Card(SOURCE_DEF_ID, id, "battlefield")
                ),
                graveyard: graveyard.map(([defId, id]) =>
                    p1Card(defId, id, "graveyard")
                ),
            }),
            makePlayer("p2"),
        ],
    });
}

describe("graveyard play permission record (ADR 0093, CR 601.3)", () => {
    it("two once-per-turn sources under one controller grant two uses — spending one leaves the other", () => {
        withTemporaryDefinition(
            permissionSource(ONCE_PER_TURN_EITHER_ACTION),
            () => {
                const state = board(
                    ["source-a", "source-b"],
                    [
                        [savannahLions.id, "lions-1"],
                        [savannahLions.id, "lions-2"],
                        [savannahLions.id, "lions-3"],
                    ]
                );
                const p1 = getPlayer(state, "p1");
                expect(
                    getGraveyardPlayPermissions(state, p1).map(
                        (p) => p.sourceId
                    )
                ).toEqual(["source-a", "source-b"]);

                const first = locateCastSource(state, p1, "lions-1");
                expect(first.graveyardPermission?.sourceId).toBe("source-a");
                markGraveyardPlayPermissionUsed(
                    state,
                    "p1",
                    first.graveyardPermission!
                );

                const second = locateCastSource(state, p1, "lions-2");
                expect(second.graveyardPermission?.sourceId).toBe("source-b");
                markGraveyardPlayPermissionUsed(
                    state,
                    "p1",
                    second.graveyardPermission!
                );

                // Both uses spent: the third card has no permission left, on
                // the server path and through the real projection alike.
                expect(locateCastSource(state, p1, "lions-3").card).toBe(
                    undefined
                );
                const slim = projectPublicState(state, 1, "p1")
                    .players.find((p) => p.id === "p1")!
                    .graveyard.find((c) => c.id === "lions-3")!;
                expect(slim.castKind).toBeUndefined();
                expect(slim.legalActions).toBeUndefined();
            }
        );
    });

    it("the wire affordance is present while a once-per-turn use is unspent (baseline for the case above)", () => {
        withTemporaryDefinition(
            permissionSource(ONCE_PER_TURN_EITHER_ACTION),
            () => {
                const state = board(
                    ["source-a"],
                    [[savannahLions.id, "lions-1"]]
                );
                const slim = projectPublicState(state, 1, "p1")
                    .players.find((p) => p.id === "p1")!
                    .graveyard.find((c) => c.id === "lions-1")!;
                // No mana on board, so the affordance is present but its
                // actions are unpayable — `castKind` is the discriminator.
                expect(slim.castKind).toBe("graveyard-permission");
                expect(slim.legalActions).toBeDefined();
            }
        );
    });

    it("one use covers either action — a land played with it closes the cast for the turn", () => {
        withTemporaryDefinition(
            permissionSource(ONCE_PER_TURN_EITHER_ACTION),
            () => {
                const state = board(
                    ["source-a"],
                    [
                        [mountain.id, "gy-mountain"],
                        [savannahLions.id, "gy-lions"],
                    ]
                );
                const p1 = getPlayer(state, "p1");
                expect(canPlayLandsFromGraveyard(state, p1)).toBe(true);
                expect(
                    applyPlayLandFromAnyZone(state, p1, "gy-mountain")
                ).not.toBeNull();
                expect(state.graveyardPlayPermissionUsesThisTurn).toEqual([
                    { playerId: "p1", sourceId: "source-a" },
                ]);
                expect(locateCastSource(state, p1, "gy-lions").card).toBe(
                    undefined
                );
            }
        );
    });

    it("one use covers either action — a cast with it closes the land play for the turn", () => {
        withTemporaryDefinition(
            permissionSource(ONCE_PER_TURN_EITHER_ACTION),
            () => {
                const state = board(
                    ["source-a"],
                    [
                        [mountain.id, "gy-mountain"],
                        [savannahLions.id, "gy-lions"],
                    ]
                );
                const p1 = getPlayer(state, "p1");
                const src = locateCastSource(state, p1, "gy-lions");
                expect(src.graveyardPermission?.sourceId).toBe("source-a");
                markGraveyardPlayPermissionUsed(
                    state,
                    "p1",
                    src.graveyardPermission!
                );
                expect(canPlayLandsFromGraveyard(state, p1)).toBe(false);
            }
        );
    });

    it("a graveyard land play parked on its CR 614.12 pay-choice has spent the use when the play was taken, exactly once", () => {
        withTemporaryDefinition(
            permissionSource({ actions: ["play-land"], oncePerTurn: true }),
            () => {
                const state = board(
                    ["source-a"],
                    [
                        [wateryGrave.id, "gy-grave"],
                        [mountain.id, "gy-mountain"],
                    ]
                );
                const p1 = getPlayer(state, "p1");
                expect(
                    applyPlayLandFromAnyZone(state, p1, "gy-grave")
                ).toBeNull();
                const choice = state.pendingChoices?.find(
                    (c) => c.kind === "land-entry-tapped"
                );
                expect(choice).toBeDefined();
                // The special action is taken; the choice only decides how the
                // land enters.
                expect(state.graveyardPlayPermissionUsesThisTurn).toEqual([
                    { playerId: "p1", sourceId: "source-a" },
                ]);

                finalizeLandEntry(
                    state,
                    "p1",
                    "gy-grave",
                    choice!.cost as MayPayCost,
                    false,
                    "graveyard"
                );
                expect(p1.battlefield.some((c) => c.id === "gy-grave")).toBe(
                    true
                );
                expect(state.graveyardPlayPermissionUsesThisTurn).toEqual([
                    { playerId: "p1", sourceId: "source-a" },
                ]);
                expect(canPlayLandsFromGraveyard(state, p1)).toBe(false);
            }
        );
    });

    it("a graveyard land play an EFFECT licenses (not the permission) spends nothing", () => {
        withTemporaryDefinition(
            permissionSource({ actions: ["play-land"], oncePerTurn: true }),
            () => {
                const state = board(
                    ["source-a"],
                    [[mountain.id, "gy-mountain"]]
                );
                const p1 = getPlayer(state, "p1");
                // `playLandForPlayer` (a resolving effect's own licence) goes
                // straight to the zone settle, never through the dispatcher.
                expect(
                    applyPlayLandFromGraveyard(state, p1, "gy-mountain")
                ).not.toBeNull();
                expect(state.graveyardPlayPermissionUsesThisTurn).toBe(
                    undefined
                );
                expect(canPlayLandsFromGraveyard(state, p1)).toBe(true);
            }
        );
    });

    it("the own-turn and once-per-turn gates are data on EITHER form — a turn-scoped grant carrying them is gated like a battlefield one", () => {
        const state = makeState({
            activePlayerId: "p2",
            graveyardPlayPermissionThisTurn: [
                {
                    playerId: "p1",
                    sourceId: "grant-a",
                    ...ONCE_PER_TURN_EITHER_ACTION,
                },
            ],
        });
        const p1 = getPlayer(state, "p1");
        // CR 601.3 — off the grantee's turn the permission does not exist.
        expect(getGraveyardPlayPermissions(state, p1)).toEqual([]);

        state.activePlayerId = "p1";
        const [live] = getGraveyardPlayPermissions(state, p1);
        expect(live?.sourceId).toBe("grant-a");
        markGraveyardPlayPermissionUsed(state, "p1", live!);
        expect(getGraveyardPlayPermissions(state, p1)).toEqual([]);
    });

    it("selects an unlimited permission over a once-per-turn one covering the same cast — Yawgmoth's Will spares Lurrus's use", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        p1Card(lurrus.id, "lurrus-p1", "battlefield"),
                    ],
                    graveyard: [
                        p1Card(savannahLions.id, "gy-lions", "graveyard"),
                    ],
                }),
                makePlayer("p2"),
            ],
            graveyardPlayPermissionThisTurn: [
                {
                    playerId: "p1",
                    sourceId: "yawgmoths-will",
                    actions: ["play-land", "cast"],
                },
            ],
        });
        const p1 = getPlayer(state, "p1");
        const lions = p1.graveyard[0];
        expect(
            getGraveyardPlayPermissions(state, p1).map((p) => p.sourceId)
        ).toEqual(["lurrus-p1", "yawgmoths-will"]);
        expect(
            selectGraveyardPlayPermission(state, p1, "cast", lions)?.sourceId
        ).toBe("yawgmoths-will");

        const src = locateCastSource(state, p1, "gy-lions");
        markGraveyardPlayPermissionUsed(state, "p1", src.graveyardPermission!);
        expect(state.graveyardPlayPermissionUsesThisTurn).toBeUndefined();
        expect(canCastFromGraveyardByPermission(state, p1, lions)).toBe(true);
    });
});
