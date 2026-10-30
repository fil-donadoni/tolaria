// Issue #7207 — CR 707.9a "except it has this ability" (Thespian's Stage)
// must survive the wire AND be offered by the CLIENT ability views.
//
// The engine half is `convex/gre/__tests__/copyGainedActivatedAbility.test.ts`.
// What is separate here: the gained ability is printed on a card the copy no
// longer presents, so every client surface that looks an ability up on the
// presented definition would drop it silently — the menu
// (`getEffectiveClientAbilities`), the zoom panel (`getDisplayAbilities`) and
// the stack row (`getStackAbilityOracleText`).
//
// Every assertion reads the output of `projectPublicState`, driven through the
// real activation path: a hand-built instance would mask a field the wire
// drops.

import { describe, expect, it } from "vitest";
import {
    getDisplayAbilities,
    getEffectiveClientAbilities,
    getStackAbilityOracleText,
} from "../card-utils";
import type { CardInstance, StackItem } from "~/types/game";
import { projectPublicState } from "@convex/gameProjections";
import { getCardByName, withTemporaryDefinition } from "@convex/cards";
import type { CardDefinition } from "@convex/cards/types";
import { activateAbilityOnState, applyOneTargetSelection } from "@convex/game";
import { resolveTopOfStack, type GameState } from "@convex/gre/state";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup.helper";

// Distinct from the GRE-side suite's id: both files may share a worker.
const STAGE_ID = "client-7207-copy-gains-this-ability";
const COPY_ABILITY = "client-7207-become-copy";
const COPY_TEXT =
    "{T}: This land becomes a copy of target land, except it has this ability.";
const STRIP_MINE = getCardByName("Strip Mine").id;

const STAGE: CardDefinition = {
    ...getCardByName("Strip Mine"),
    id: STAGE_ID,
    name: "Client Test Thespian's Stage",
    oracleText: COPY_TEXT,
    activatedAbilities: [
        {
            id: COPY_ABILITY,
            oracleText: COPY_TEXT,
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
    const stage = makeInstance(STRIP_MINE, { id: "stage", ownerId: "p1" });
    stage.card = { id: STAGE_ID };
    return makeState({
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", { battlefield: [stage] }),
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

function activate(state: GameState, targetId: string): void {
    state.players[0]!.battlefield[0]!.isTapped = false;
    state.priorityPlayerId = "p1";
    activateAbilityOnState(state, {
        playerId: "p1",
        cardInstanceId: "stage",
        abilityId: COPY_ABILITY,
    });
    applyOneTargetSelection(state, "p1", {
        targetType: "permanent",
        targetId,
    });
}

const projectedStage = (state: GameState): CardInstance =>
    projectPublicState(state, 1, "p1")
        .players.flatMap((p) => p.battlefield)
        .find((c) => c.id === "stage") as unknown as CardInstance;

describe("copy-gained activated ability on the client (CR 707.9a, issue #7207)", () => {
    it("the menu and the zoom panel offer the gained ability on the copy", () => {
        withTemporaryDefinition(STAGE, () => {
            const state = board();
            activate(state, "mine");
            resolveTopOfStack(state);
            const card = projectedStage(state);

            expect(card.card.id).toBe(STRIP_MINE);
            expect(
                getEffectiveClientAbilities(card).map((a) => a.id)
            ).toContain(COPY_ABILITY);
            expect(
                getDisplayAbilities(STRIP_MINE, card).activated.map(
                    (a) => a.oracleText
                )
            ).toContain(COPY_TEXT);
        });
    });

    it("the stack row prints the gained ability's text when the copy activates it", () => {
        withTemporaryDefinition(STAGE, () => {
            const state = board();
            activate(state, "mine");
            resolveTopOfStack(state);
            // Activated again — now off the Strip Mine copy.
            activate(state, "mine");
            const item = projectPublicState(state, 1, "p1").stack.at(
                -1
            ) as unknown as StackItem;

            expect(item.card.id).toBe(STRIP_MINE);
            expect(getStackAbilityOracleText(item)).toBe(COPY_TEXT);
        });
    });
});
