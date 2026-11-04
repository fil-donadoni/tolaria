// Conspire on the client (CR 702.78a, issue #4012): every gate runs on the
// PROJECTED view, because the cast-cost dialog prices the toggle from it and the
// battlefield highlights the picks from it.
import { describe, it, expect } from "vitest";
import { getCardByName } from "@convex/cards";
import { conspireCost } from "@convex/cards/abilities/conspire";
import { withTemporaryDefinition } from "@convex/cards/registry";
import { lightningBolt } from "@convex/cards/sets/lea/index.cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup.helper";
import { projectPublicState } from "@convex/gameProjections";
import { finalizeTargetSelection } from "@convex/game";
import { matchesPermanentFilter } from "@convex/cards/filters";
import type { CardDefinition } from "@convex/cards/types";
import type { GameState } from "@convex/gre/state";
import {
    affordableKickersForCard,
    getTriggeredAbilityOracleText,
} from "../card-utils";
import { describeSacrificeChoice } from "../sacrifice-selection";
import type { CardInstance, Player } from "~/types/game";

const SPELL: CardDefinition = {
    ...lightningBolt(),
    id: "conspire-spell",
    name: "Conspire Spell",
    manaCost: { R: 1 },
    staticAbilities: ["conspire"],
    kickers: [conspireCost()],
};
const HILL_GIANT = getCardByName("Hill Giant").id;
const GRIZZLY_BEARS = getCardByName("Grizzly Bears").id;

function board(cardIds: string[]): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                hand: [
                    makeInstance(SPELL.id, {
                        id: "spell",
                        zone: "hand",
                        controllerId: "p1",
                        ownerId: "p1",
                    }),
                ],
                battlefield: cardIds.map((cardId, i) =>
                    makeInstance(cardId, {
                        id: `c${i}`,
                        zone: "battlefield",
                        controllerId: "p1",
                        ownerId: "p1",
                    })
                ),
                manaPool: { W: 0, U: 0, B: 0, R: 1, G: 0, C: 0 },
            }),
            makePlayer("p2"),
        ],
    });
}

function offered(state: GameState): string[] {
    const view = projectPublicState(state, 1, "p1");
    const players = view.players as unknown as Player[];
    const card = players[0].hand.find(
        (c) => c?.id === "spell"
    ) as unknown as CardInstance;
    return affordableKickersForCard(card, "p1", players, "p1").map((k) => k.id);
}

describe("Conspire — the cast-cost dialog's toggle (CR 702.78a)", () => {
    it("is offered with two creatures sharing the spell's colour", () =>
        withTemporaryDefinition(SPELL, () => {
            expect(offered(board([HILL_GIANT, HILL_GIANT]))).toEqual([
                "conspire",
            ]);
        }));

    it("is hidden when only one of them shares it", () =>
        withTemporaryDefinition(SPELL, () => {
            expect(offered(board([HILL_GIANT, GRIZZLY_BEARS]))).toEqual([]);
        }));
});

describe("Conspire — the picker (CR 702.78a)", () => {
    it("names the verb, and its filter highlights only legal creatures", () =>
        withTemporaryDefinition(SPELL, () => {
            const state = board([HILL_GIANT, HILL_GIANT, GRIZZLY_BEARS]);
            finalizeTargetSelection(
                state,
                {
                    playerId: "p1",
                    cardInstanceId: "spell",
                    targetType: "any",
                    count: 1,
                    selected: [{ type: "player", id: "p2" }],
                    kickerPayments: { conspire: 1 },
                },
                "p1"
            );
            const view = projectPublicState(state, 1, "p1");
            const sel = view.pendingCast?.sacrificeSelection;
            if (!sel) throw new Error("the selection did not cross the wire");
            expect(describeSacrificeChoice(sel)).toBe("tap a creature (0/2)");
            const filter = sel.requirements[0].filter;
            const legal = (colors: ("R" | "G")[]) =>
                matchesPermanentFilter(
                    {
                        id: "x",
                        types: ["Creature"],
                        controllerId: "p1",
                        colors,
                    } as never,
                    filter
                );
            expect(legal(["R"])).toBe(true);
            expect(legal(["G"])).toBe(false);
        }));
});

describe("Conspire — the stack label (ADR 0052)", () => {
    it("reads the keyword's own text, not a card's", () => {
        expect(getTriggeredAbilityOracleText("anything", "conspire")).toContain(
            "if its conspire cost was paid, copy it"
        );
    });
});
