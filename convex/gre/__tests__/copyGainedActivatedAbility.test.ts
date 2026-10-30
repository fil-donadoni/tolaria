// CR 707.9a — "Some copy effects cause the copy to gain an ability as part of
// the copying process. This ability becomes part of the copiable values for
// the copy, along with any other abilities that were copied." Issue #7207:
// Thespian's Stage's "{2}, {T}: This land becomes a copy of target land,
// except it has this ability", authored as `becomeCopy` with
// `except.additionalActivatedAbilityIds`.
//
// Driven through the real activation entry points (`activateAbilityOnState`,
// `applyOneTargetSelection`, `resolveTopOfStack`): the gained ability is read
// back through `getEffectiveActivatedAbilities`, the one authority activation,
// mana probes, the Bot's move enumeration and the client views share.

import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { getCardByName, withTemporaryDefinition } from "../../cards";
import type { CardDefinition } from "../../cards/types";
import { activateAbilityOnState, applyOneTargetSelection } from "../../game";
import { getEffectiveActivatedAbilities } from "../activatedAbilities";
import { applyCopy, presentedDefId } from "../copy";
import { validateAbilityEffectScript } from "../effects/validate";
import {
    removePermanentTo,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
} from "../state";

const STAGE_ID = "test-7207-copy-gains-this-ability";
const COPY_ABILITY = "test-7207-become-copy";
const STRIP_MINE = getCardByName("Strip Mine").id;
const FOREST = getCardByName("Forest").id;

/** Thespian's Stage's shape — its copy ability, cost reduced to {T} so the
 *  test pays nothing but a tap (the cost is not what is under test). */
const STAGE: CardDefinition = {
    ...getCardByName("Strip Mine"),
    id: STAGE_ID,
    name: "Test Thespian's Stage",
    oracleText:
        "{T}: Add {C}.\n{T}: This land becomes a copy of target land, except it has this ability.",
    activatedAbilities: [
        {
            id: "test-7207-mana",
            oracleText: "{T}: Add {C}.",
            cost: { tap: true },
            useStack: false,
            effects: [{ op: "addMana", mana: { C: 1 } }],
            manaProduced: { C: 1 },
        },
        {
            id: COPY_ABILITY,
            oracleText:
                "{T}: This land becomes a copy of target land, except it has this ability.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: "Land", count: 1 },
            effects: [
                {
                    op: "becomeCopy",
                    target: { ref: "$source" },
                    source: { target: 0 },
                    except: { additionalActivatedAbilityIds: [COPY_ABILITY] },
                },
            ],
        },
    ],
};

function board(): GameState {
    return makeState({
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", {
                battlefield: [
                    makeInstance(STRIP_MINE, { id: "stage", ownerId: "p1" }),
                    makeInstance(FOREST, { id: "forest", ownerId: "p1" }),
                ],
            }),
            makePlayer("p2", {
                battlefield: [
                    makeInstance(STRIP_MINE, {
                        id: "mine",
                        controllerId: "p2",
                        ownerId: "p2",
                    }),
                ],
            }),
        ],
    });
}

/** `board()` with the Stage presenting its own (temporary) definition. */
function stageBoard(): GameState {
    const state = board();
    const stage = find(state, "stage");
    stage.card = { id: STAGE_ID };
    return state;
}

const find = (s: GameState, id: string): CardInstanceState =>
    s.players.flatMap((p) => p.battlefield).find((c) => c.id === id)!;

const abilityIds = (card: CardInstanceState) =>
    getEffectiveActivatedAbilities(card).map((e) => e.ability.id);

/** Activate the copy ability of `sourceId` aimed at `targetId`, resolve it. */
function copyOnto(state: GameState, sourceId: string, targetId: string) {
    find(state, sourceId).isTapped = false;
    state.priorityPlayerId = "p1";
    activateAbilityOnState(state, {
        playerId: "p1",
        cardInstanceId: sourceId,
        abilityId: COPY_ABILITY,
    });
    applyOneTargetSelection(state, "p1", {
        targetType: "permanent",
        targetId,
    });
    resolveTopOfStack(state);
}

describe("copy effect gains an activated ability — CR 707.9a (issue #7207)", () => {
    it("the copy presents the target land AND keeps the copy ability", () => {
        withTemporaryDefinition(STAGE, () => {
            const state = stageBoard();
            copyOnto(state, "stage", "mine");

            const stage = find(state, "stage");
            expect(presentedDefId(stage)).toBe(STRIP_MINE);
            // Strip Mine's two abilities, plus the gained one — and not the
            // Stage's own mana ability, which the copy overwrote (CR 707.2).
            expect(abilityIds(stage)).toEqual([
                "strip-mine-mana",
                "strip-mine-destroy",
                COPY_ABILITY,
            ]);
            expect(stage.copyExcept?.additionalActivatedAbilities).toEqual([
                { sourceCardId: STAGE_ID, abilityId: COPY_ABILITY },
            ]);
        });
    });

    it("the gained ability activates from the copy, and re-copying keeps it exactly once", () => {
        withTemporaryDefinition(STAGE, () => {
            const state = stageBoard();
            copyOnto(state, "stage", "mine");
            // Activated off the Strip Mine copy: the ability is printed on the
            // Stage's definition, not on the card the copy presents.
            copyOnto(state, "stage", "forest");

            const stage = find(state, "stage");
            expect(presentedDefId(stage)).toBe(FOREST);
            expect(abilityIds(stage)).toEqual([COPY_ABILITY]);
            expect(stage.copyExcept?.additionalActivatedAbilities).toEqual([
                { sourceCardId: STAGE_ID, abilityId: COPY_ABILITY },
            ]);
        });
    });

    it("a copy OF the copy inherits the gained ability (CR 707.3)", () => {
        withTemporaryDefinition(STAGE, () => {
            const state = stageBoard();
            copyOnto(state, "stage", "mine");
            const forest = find(state, "forest");
            applyCopy(state, forest, find(state, "stage"));

            expect(presentedDefId(forest)).toBe(STRIP_MINE);
            expect(abilityIds(forest)).toContain(COPY_ABILITY);
        });
    });

    it("an uncopied Stage, or one copying a Stage, never lists the ability twice", () => {
        withTemporaryDefinition(STAGE, () => {
            const state = stageBoard();
            expect(abilityIds(find(state, "stage"))).toEqual([
                "test-7207-mana",
                COPY_ABILITY,
            ]);
            const other = find(state, "mine");
            other.card = { id: STAGE_ID };
            copyOnto(state, "stage", "mine");
            expect(abilityIds(find(state, "stage"))).toEqual([
                "test-7207-mana",
                COPY_ABILITY,
            ]);
        });
    });

    it("is lost to a 'loses all abilities' effect like any copiable ability (CR 613.1f)", () => {
        withTemporaryDefinition(STAGE, () => {
            const state = stageBoard();
            copyOnto(state, "stage", "mine");
            const stage = find(state, "stage");
            stage.abilitiesSuppressedBy = [{ sourceId: "humility", seq: 99 }];
            expect(abilityIds(stage)).toEqual([]);
        });
    });

    it("ends with the copy effect when the permanent leaves (CR 707.2 / 400.7)", () => {
        withTemporaryDefinition(STAGE, () => {
            const state = stageBoard();
            copyOnto(state, "stage", "mine");
            removePermanentTo(state, "stage", "graveyard");
            const card = state.players[0]!.graveyard.find(
                (c) => c.id === "stage"
            )!;
            expect(card.copyExcept).toBeUndefined();
            expect(abilityIds(card)).toEqual(["test-7207-mana", COPY_ABILITY]);
        });
    });

    it("the validator accepts the clause and refuses an empty id list", () => {
        const ability = STAGE.activatedAbilities![1]!;
        expect(validateAbilityEffectScript(ability, "stage")).toEqual([]);
        const bad = {
            ...ability,
            effects: [
                {
                    op: "becomeCopy" as const,
                    target: { ref: "$source" },
                    source: { target: 0 },
                    except: { additionalActivatedAbilityIds: [] },
                },
            ],
        };
        expect(validateAbilityEffectScript(bad, "stage")).not.toEqual([]);
    });
});
