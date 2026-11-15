// A SPLIT half cast under a board permission that waives the mana cost
// (CR 709.3 + CR 118.9a, ADR 0121).
//
// CR 118.9a allows one alternative cost per spell, and the engine says which
// cast option was taken through ONE string. A split card already spends it on
// the half (CR 709.3 — "a player chooses which half of a split card they are
// casting"), so a permission's free cast of that half carries the half inside
// its own id (`castPermissionAltCostId.ts`). These tests walk that id through
// every reader: the option list, the legality gate, the subject, the stamp.
//
// No shipped permission covers a shipped split half (Aluren is creature-only,
// a creature half is CR 709.5's permanent split card), so the permission here
// is a temporary definition. Its filter — instants with mana value 1 or less —
// is what makes the assertions discriminating: Stand ({W}) is covered, Deliver
// ({2}{U}) is not, and the card in hand ({2}{W}{U}, CR 709.4b) is not either.

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { withTemporaryDefinition } from "../../cards/registry";
import { splitHalfDefinitionId } from "../../cards/splitCard";
import type { CardDefinition } from "../../cards/types";
import {
    castOptionAlternativeCosts,
    castPermissionAltCosts,
} from "../castPermissions";
import {
    composeCastPermissionAltCostId,
    faceChoiceComponent,
} from "../castPermissionAltCostId";
import {
    applyCastModeCharacteristics,
    castSubjectDefinition,
} from "../castMode";
import { NO_BOARD_LAYER_VIEW } from "../layers";
import { isSplitCastId, splitCastAltCostId } from "../splitCast";
import { castPermissionRequiredFor, getLegalActions } from "../rules";
import type { CardInstanceState, GameState, StackItem } from "../state";
import { getDefinition } from "../../cards/index";

const aluren = () => getDefinition("268403bc-733d-446e-a7c1-abc957c42bc2");

const STAND_DELIVER = getCardByName("Stand // Deliver");
const LIFE_DEATH = getCardByName("Life // Death");
const HILL_GIANT = getCardByName("Hill Giant").id;
const LEFT_ALT = splitCastAltCostId(STAND_DELIVER, "left");
const RIGHT_ALT = splitCastAltCostId(STAND_DELIVER, "right");
const PERMISSION_ID = "probe-free-cheap-instant";
const FREE_STAND = composeCastPermissionAltCostId(PERMISSION_ID, LEFT_ALT);
const FREE_DELIVER = composeCastPermissionAltCostId(PERMISSION_ID, RIGHT_ALT);

/** Aluren's id, so the registry's cast-permission membership finds it, with
 *  its permission swapped for a noncreature one. */
const permissionSource = (asThoughFlash = false): CardDefinition => ({
    ...aluren(),
    staticEffects: [
        {
            kind: "cast-permission",
            id: PERMISSION_ID,
            grantee: "controller",
            filter: { type: "Instant", manaValueAtMost: 1 },
            withoutPayingManaCost: true,
            ...(asThoughFlash ? { asThoughFlash: true } : {}),
            oracleText:
                "You may cast instant spells with mana value 1 or less without paying their mana costs.",
        },
    ],
});

/** p1 holds `splitId` (Stand // Deliver by default), controls the permission source and NO land: a
 *  cast that is legal here is legal because the permission paid for it. p2's
 *  Hill Giant is a legal target for both halves. */
function position(splitId = STAND_DELIVER.id): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                hand: [
                    makeInstance(splitId, {
                        id: "split",
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "hand",
                    }),
                ],
                battlefield: [
                    makeInstance(aluren().id, {
                        id: "source",
                        controllerId: "p1",
                        ownerId: "p1",
                    }),
                ],
            }),
            makePlayer("p2", {
                battlefield: [
                    makeInstance(HILL_GIANT, {
                        id: "giant",
                        controllerId: "p2",
                        ownerId: "p2",
                    }),
                ],
            }),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "PRECOMBAT_MAIN",
    });
}

const handCard = (state: GameState): CardInstanceState =>
    state.players[0].hand.find((c) => c.id === "split")!;

describe("CR 709.3 + 118.9a — one id says both the half and the permission", () => {
    it("the face component of a permission id is the half it casts", () => {
        expect(faceChoiceComponent(FREE_STAND)).toBe(LEFT_ALT);
        expect(isSplitCastId(STAND_DELIVER, FREE_STAND)).toBe("left");
        expect(isSplitCastId(STAND_DELIVER, FREE_DELIVER)).toBe("right");
        // A permission cast of the printed card names no face.
        const bare = composeCastPermissionAltCostId(PERMISSION_ID);
        expect(isSplitCastId(STAND_DELIVER, bare)).toBeUndefined();
    });
});

describe("CR 709.3a — the permission is asked of each HALF, never the card", () => {
    it("offers a free cast of the covered half only, addressed by the half", () => {
        withTemporaryDefinition(permissionSource(), () => {
            const state = position();
            const card = handCard(state);

            expect(
                castPermissionAltCosts(state, "p1", card).map((a) => a.id)
            ).toEqual([FREE_STAND]);
            // The client picker's list: both paid halves, plus the free one.
            expect(
                castOptionAlternativeCosts(state, state.players[0], card).map(
                    (a) => a.id
                )
            ).toEqual([LEFT_ALT, RIGHT_ALT, FREE_STAND]);
        });
    });

    it("makes the card castable with no mana at all", () => {
        withTemporaryDefinition(permissionSource(), () => {
            const state = position();
            expect(
                getLegalActions(state, state.players[0], handCard(state))
            ).toContain("cast");
        });
    });

    it("the free cast's subject is the half, and it stamps the half onto the stack", () => {
        withTemporaryDefinition(permissionSource(), () => {
            expect(castSubjectDefinition(STAND_DELIVER, FREE_STAND)?.id).toBe(
                splitHalfDefinitionId(STAND_DELIVER.id, "left")
            );
            const state = position();
            const item: StackItem = {
                ...handCard(state),
                zone: "stack",
                castById: "p1",
                targets: [{ type: "permanent", id: "giant" }],
            };
            applyCastModeCharacteristics(NO_BOARD_LAYER_VIEW, item, FREE_STAND);
            // CR 709.3b — only the cast half's characteristics exist.
            expect((item.card as { id?: string }).id).toBe(
                splitHalfDefinitionId(STAND_DELIVER.id, "left")
            );
            expect(item.splitHalfOf).toBe(STAND_DELIVER.id);
        });
    });

    it("is required per half: the covered half off-window, never the other (CR 601.3c / 118.9b)", () => {
        // Life // Death: two SORCERIES, mana value 1 and 2, the card 3 in
        // hand (CR 709.4b). A free-and-flash permission over sorceries of mana
        // value 1 or less licenses Life off the caster's sorcery window, and
        // ONLY under its free cast; Death it does not cover at all. Asking the
        // card instead of the half answers "not covered" for both.
        const sorceryPermission: CardDefinition = {
            ...permissionSource(true),
            staticEffects: [
                {
                    kind: "cast-permission",
                    id: PERMISSION_ID,
                    grantee: "controller",
                    filter: { type: "Sorcery", manaValueAtMost: 1 },
                    withoutPayingManaCost: true,
                    asThoughFlash: true,
                    oracleText:
                        "You may cast sorcery spells with mana value 1 or less without paying their mana costs and as though they had flash.",
                },
            ],
        };
        withTemporaryDefinition(sorceryPermission, () => {
            const state = position(LIFE_DEATH.id);
            state.activePlayerId = "p2";
            const card = handCard(state);
            const life = splitCastAltCostId(LIFE_DEATH, "left");
            const death = splitCastAltCostId(LIFE_DEATH, "right");

            expect(
                castPermissionRequiredFor(state, "p1", card, "hand", life)
            ).toBe(true);
            expect(
                castPermissionRequiredFor(state, "p1", card, "hand", death)
            ).toBe(false);
            expect(
                castPermissionAltCosts(state, "p1", card).map((a) => a.id)
            ).toEqual([composeCastPermissionAltCostId(PERMISSION_ID, life)]);
        });
    });
});
