// A graveyard play permission is priced by what it unlocks (issue #10401).
//
// CR 601.3 — "A player can begin to cast a spell only if a rule or effect
// allows that player to cast it": "you may play lands and cast spells from
// your graveyard" allows as much as the graveyard holds and the turn's mana
// pays for. The flat price it had read an empty graveyard and a stocked one
// as the same card.
import { describe, expect, it } from "vitest";
import { getCardByName, withTemporaryDefinition } from "../../../cards";
import type { CardDefinition } from "../../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../cards/__tests__/setup.helper";
import { evaluateBreakdown } from "../../evaluate";
import type { CardInstanceState, GameState } from "../../state";
import { DEFAULT_EVAL_WEIGHTS } from "../evalWeights";
import { graveyardPlayUnlockWorth } from "../graveyardPlayWorth";

const card = (
    name: string,
    id: string,
    zone: CardInstanceState["zone"],
    tapped = false
) =>
    makeInstance(getCardByName(name).id, {
        id,
        controllerId: "p1",
        ownerId: "p1",
        zone,
        isTapped: tapped,
    });

const lands = (name: string, count: number, tapped = false) =>
    Array.from({ length: count }, (_, i) =>
        card(name, `${name}-${i}`, "battlefield", tapped)
    );

function position(opts: {
    graveyard: string[];
    battlefield: CardInstanceState[];
    hand?: boolean;
}): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                hand:
                    opts.hand === false
                        ? []
                        : [card("Yawgmoth's Will", "will", "hand")],
                graveyard: opts.graveyard.map((name, i) =>
                    card(name, `gy-${i}`, "graveyard")
                ),
                battlefield: opts.battlefield,
            }),
            makePlayer("p2"),
        ],
    });
}

/** The hand term of a hand holding the permission alone: its price. */
const willPrice = (state: GameState) =>
    evaluateBreakdown(state, "p1").self.hand;

const ONE_CARD = DEFAULT_EVAL_WEIGHTS.latent.cardAdvantage;

describe("the price of a graveyard play permission in hand (CR 601.3)", () => {
    it("is low on an empty graveyard: under one drawn card", () => {
        const price = willPrice(
            position({ graveyard: [], battlefield: lands("Swamp", 6) })
        );
        expect(price).toBeGreaterThan(0);
        expect(price).toBeLessThan(ONE_CARD);
    });

    it("is above one card on a graveyard holding several castable spells", () => {
        const price = willPrice(
            position({
                graveyard: ["Dark Ritual", "Hypnotic Specter", "Duress"],
                battlefield: lands("Swamp", 8),
            })
        );
        expect(price).toBeGreaterThan(ONE_CARD);
    });

    it("grows with each castable spell the graveyard adds", () => {
        const battlefield = () => lands("Swamp", 8);
        const one = willPrice(
            position({
                graveyard: ["Hypnotic Specter"],
                battlefield: battlefield(),
            })
        );
        const two = willPrice(
            position({
                graveyard: ["Hypnotic Specter", "Sengir Vampire"],
                battlefield: battlefield(),
            })
        );
        expect(two).toBeGreaterThan(one);
    });

    it("does not count a spell the mana left cannot pay for", () => {
        // {2}{B} for the permission out of three Swamps leaves nothing.
        const stocked = ["Hypnotic Specter", "Sengir Vampire"];
        const starved = willPrice(
            position({ graveyard: stocked, battlefield: lands("Swamp", 3) })
        );
        const empty = willPrice(
            position({ graveyard: [], battlefield: lands("Swamp", 3) })
        );
        expect(starved).toBe(empty);
    });
});

describe("graveyardPlayUnlockWorth — the cards the permission's turn can play", () => {
    const worthOne = () => 1;
    const both = {};

    it("counts spells best-first while the mana left covers them", () => {
        const state = position({
            graveyard: ["Hypnotic Specter", "Sengir Vampire", "Dark Ritual"],
            battlefield: lands("Swamp", 9),
        });
        const p1 = state.players[0];
        const will = p1.hand[0];
        // Nine Swamps less {2}{B}: six left — the Ritual and the Specter fit,
        // the Vampire's five on top of them do not.
        expect(graveyardPlayUnlockWorth(state, p1, both, will, worthOne)).toBe(
            2
        );
        // The permission already paid for: all nine, and all three spells.
        expect(
            graveyardPlayUnlockWorth(state, p1, both, undefined, worthOne)
        ).toBe(3);
    });

    it("counts a spell whose own alternative cost asks for no mana (CR 118.9)", () => {
        // Two tapped Mountains pay Fireblast's sacrifice and no mana at all.
        const state = position({
            graveyard: ["Fireblast"],
            battlefield: lands("Mountain", 2, true),
            hand: false,
        });
        const p1 = state.players[0];
        expect(
            graveyardPlayUnlockWorth(state, p1, both, undefined, worthOne)
        ).toBe(1);
        // One Mountain pays neither cost.
        p1.battlefield.pop();
        expect(
            graveyardPlayUnlockWorth(state, p1, both, undefined, worthOne)
        ).toBe(0);
    });

    it("leaves out a card with no mana cost: an unpayable cost (CR 118.6)", () => {
        const costless: CardDefinition = {
            ...getCardByName("Dark Ritual"),
            id: "test-costless-sorcery",
            name: "Costless Sorcery",
            manaCost: undefined,
        };
        withTemporaryDefinition(costless, () => {
            const state = position({
                graveyard: ["Dark Ritual"],
                battlefield: lands("Swamp", 4),
                hand: false,
            });
            state.players[0].graveyard.push(
                makeInstance(costless.id, {
                    id: "gy-costless",
                    controllerId: "p1",
                    ownerId: "p1",
                    zone: "graveyard",
                })
            );
            expect(
                graveyardPlayUnlockWorth(
                    state,
                    state.players[0],
                    both,
                    undefined,
                    worthOne
                )
            ).toBe(1);
        });
    });

    it("adds one land while the land drop is open, and only under a play-land grant (CR 305.2)", () => {
        const state = position({
            graveyard: ["Swamp", "Mountain"],
            battlefield: [],
            hand: false,
        });
        const p1 = state.players[0];
        expect(
            graveyardPlayUnlockWorth(state, p1, both, undefined, worthOne)
        ).toBe(1);
        expect(
            graveyardPlayUnlockWorth(
                state,
                p1,
                { actions: ["cast"] },
                undefined,
                worthOne
            )
        ).toBe(0);
        p1.landsPlayedThisTurn = 1;
        expect(
            graveyardPlayUnlockWorth(state, p1, both, undefined, worthOne)
        ).toBe(0);
    });

    it("stops at the grant's mana value cap", () => {
        const state = position({
            graveyard: ["Dark Ritual", "Sengir Vampire"],
            battlefield: lands("Swamp", 8),
            hand: false,
        });
        const p1 = state.players[0];
        expect(
            graveyardPlayUnlockWorth(
                state,
                p1,
                { actions: ["cast"], maxManaValue: 2 },
                undefined,
                worthOne
            )
        ).toBe(1);
    });
});
