// CR 118.6 — "Some objects have no mana cost. This represents an unpayable
// cost. ... Attempting to cast a spell ... that has an unpayable cost is a
// legal action. However, attempting to pay an unpayable cost is an illegal
// action." CR 118.6a — "If an alternative cost is applied to an unpayable
// cost, including an effect that allows a player to cast a spell without
// paying its mana cost, the alternative cost may be paid."
//
// A card with NO mana cost (Living End, Inevitable Betrayal) is never cast for
// its mana cost, on every surface the hand cast crosses: the GRE gate, the
// hand card's `legalActions` on the wire, and the `announceCast` mutation. A
// printed {0} (`manaCost: {}`) is a real cost and stays castable, and a free
// cast (the waiver is an alternative cost) still is.
import { describe, expect, it } from "vitest";
import { getCardByName, withTemporaryDefinitionAsync } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import type { CardDefinition } from "../../cards/types";
import { announceCast } from "../../game";
import { projectPublicState } from "../../gameProjections";
import {
    gameStateSeed,
    makeMutationCtx,
    runMutation,
    type Handler,
} from "../../__tests__/gameMutationHarness.fixture";
import type { Id } from "../../_generated/dataModel";
import { getLegalActions } from "../rules";
import { getPlayer, type CardInstanceState, type GameState } from "../state";

const SWAMP = getCardByName("Swamp").id;

/** A sorcery with NO mana cost: gains its caster 3 life. */
const NO_COST: CardDefinition = {
    id: "test-unpayable-no-cost",
    name: "Test Unpayable No Cost",
    rarity: "common",
    types: ["Sorcery"],
    effects: [{ op: "gainLife", player: "controller", amount: 3 }],
};

/** The same sorcery with a printed {0}. */
const ZERO_COST: CardDefinition = {
    ...NO_COST,
    id: "test-unpayable-zero-cost",
    name: "Test Unpayable Zero Cost",
    manaCost: {},
};

function inst(
    defId: string,
    id: string,
    zone: CardInstanceState["zone"],
    extra: Partial<CardInstanceState> = {}
): CardInstanceState {
    return makeInstance(defId, {
        id,
        controllerId: "p1",
        ownerId: "p1",
        zone,
        ...extra,
    });
}

/** p1 in their precombat main, priority, empty stack, holding `def` with
 *  four untapped Swamps. */
function board(def: CardDefinition): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                hand: [inst(def.id, "card", "hand")],
                battlefield: [0, 1, 2, 3].map((i) =>
                    inst(SWAMP, `s${i}`, "battlefield")
                ),
            }),
            makePlayer("p2"),
        ],
    });
}

const p1 = (state: GameState) => getPlayer(state, "p1");

function withCards<T>(fn: () => Promise<T>): Promise<T> {
    return withTemporaryDefinitionAsync(NO_COST, () =>
        withTemporaryDefinitionAsync(ZERO_COST, fn)
    );
}

describe("an absent mana cost is unpayable (CR 118.6)", () => {
    it("a card with no mana cost offers no hand cast, with mana open; a printed {0} does", async () => {
        await withCards(async () => {
            const none = board(NO_COST);
            expect(
                getLegalActions(none, p1(none), p1(none).hand[0])
            ).not.toContain("cast");
            const zero = board(ZERO_COST);
            expect(getLegalActions(zero, p1(zero), p1(zero).hand[0])).toContain(
                "cast"
            );
        });
    });

    it("the hand card's legalActions on the wire carry no cast", async () => {
        await withCards(async () => {
            const state = board(NO_COST);
            const hand = projectPublicState(state, 1, "p1").players[0].hand;
            expect(hand[0]?.legalActions ?? []).not.toContain("cast");
        });
    });

    it("the announceCast mutation refuses it", async () => {
        await withCards(async () => {
            const harness = makeMutationCtx("p1", [
                gameStateSeed(board(NO_COST)),
            ]);
            await expect(
                runMutation<object, void>(
                    announceCast as unknown as Handler<object, void>,
                    harness.ctx,
                    {
                        gameId: "game-1" as Id<"games">,
                        playerId: "p1",
                        cardInstanceId: "card",
                    }
                )
            ).rejects.toThrow();
            expect(p1(harness.state()).hand.map((c) => c.id)).toEqual(["card"]);
        });
    });

    it("a graveyard permission that pays its mana cost offers no cast; a free one does (CR 118.6, 118.6a)", async () => {
        await withCards(async () => {
            const state = board(NO_COST);
            const card = p1(state).hand.pop()!;
            p1(state).graveyard.push({
                ...card,
                zone: "graveyard",
                castableFromGraveyardBy: "p1",
            });
            const yard = () => p1(state).graveyard[0];
            expect(getLegalActions(state, p1(state), yard())).not.toContain(
                "cast"
            );
            yard().castFromGraveyardWithoutPayingManaCost = true;
            expect(getLegalActions(state, p1(state), yard())).toContain("cast");
        });
    });

    it("a cast without paying its mana cost is an alternative cost and stays legal (CR 118.6a)", async () => {
        await withCards(async () => {
            const state = board(NO_COST);
            const card = p1(state).hand.pop()!;
            p1(state).exile.push({
                ...card,
                zone: "exile",
                castFromExileWithoutPayingManaCost: true,
            });
            expect(
                getLegalActions(state, p1(state), p1(state).exile[0])
            ).toContain("cast");
        });
    });
});
