// Bot reachability for the CR 612.6 full-text effect (issue #6741): the search
// enumerates the abilities of the card a permanent PRESENTS, and the retained
// text, through the same `getEffectiveActivatedAbilities` authority the
// activation seam reads. The engine half is `fullText.test.ts`.
import { describe, expect, it } from "vitest";
import { enumerateMoves } from "../moves";
import { recomputeContinuousEffects, type GameState } from "../state";
import { withTemporaryDefinition } from "../../cards/registry";
import type { CardDefinition } from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";

const SHAPESHIFTER = "test-full-text-shapeshifter";
const DISCARD = "test-full-text-shapeshifter-discard";
/** Frozen Shade — `{B}: This creature gets +1/+1 until end of turn.` */
const SHADE = "d0bd76c8-4cff-4c15-9686-7a299b589814";
const SHADE_PUMP = "frozen-shade-ability";
const BOLT = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a"; // Lightning Bolt

const shapeshifterDef: CardDefinition = {
    id: SHAPESHIFTER,
    name: "Full Text Test Shapeshifter",
    rarity: "rare",
    manaCost: { X: 1, U: 2 },
    types: ["Creature"],
    subtypes: ["Phyrexian", "Shapeshifter"],
    power: 0,
    toughness: 1,
    fullText: {
        from: "controller-graveyard-top",
        requiresType: "Creature",
        retainedActivatedAbilityIds: [DISCARD],
    },
    activatedAbilities: [
        {
            id: DISCARD,
            oracleText: "{2}: Discard a card.",
            cost: { mana: { X: 2 } },
            useStack: true,
            effects: [
                {
                    op: "choice",
                    kind: "choose-hand-card",
                    player: "controller",
                    zone: "hand",
                    count: 1,
                    prompt: "Discard a card.",
                    bind: "$discard",
                },
                {
                    op: "discard",
                    player: "controller",
                    cards: { ref: "$discard" },
                },
            ],
        },
    ],
};

function board(topCardId: string): GameState {
    const state = makeState({
        phase: "PRECOMBAT_MAIN",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", {
                battlefield: [
                    makeInstance(SHAPESHIFTER, {
                        id: "shifter",
                        isSummoningSick: false,
                    }),
                ],
                graveyard: [
                    makeInstance(topCardId, { id: "top", zone: "graveyard" }),
                ],
                hand: [makeInstance(BOLT, { id: "bolt", zone: "hand" })],
                manaPool: { W: 0, U: 0, B: 1, R: 0, G: 0, C: 2 },
            }),
            makePlayer("p2"),
        ],
    });
    recomputeContinuousEffects(state);
    return state;
}

function activatedIds(state: GameState): string[] {
    return enumerateMoves(state, "p1").flatMap((m) =>
        m.kind === "activate-ability" && m.cardInstanceId === "shifter"
            ? [m.abilityId]
            : []
    );
}

describe("full-text effect — Bot reachability (CR 612.6)", () => {
    it("enumerates the presented card's ability and the retained text", () => {
        withTemporaryDefinition(shapeshifterDef, () => {
            const ids = activatedIds(board(SHADE));
            expect(ids).toContain(SHADE_PUMP);
            expect(ids).toContain(DISCARD);
        });
    });

    it("enumerates only the printed text when the top card is not a creature", () => {
        withTemporaryDefinition(shapeshifterDef, () => {
            const ids = activatedIds(board(BOLT));
            expect(ids).not.toContain(SHADE_PUMP);
            expect(ids).toContain(DISCARD);
        });
    });
});
