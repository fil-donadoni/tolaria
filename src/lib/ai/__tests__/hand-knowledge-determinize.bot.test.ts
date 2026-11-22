// FULL PATH — an opponent hand card the Bot has LOOKED at survives from the
// engine to the search world (issue #10436, ADR 0026).
//
// Both Worker paths: every shipped preset knows the opponent
// (`DIFFICULTY_KNOWS_OPPONENT`), so a live game with the human's decklist
// takes `determinize`'s INFORMED branch; a seat with no decklist takes the
// no-decklist one. The production loss was the adapter hop — the informed
// branch already kept `knownTo` hand cards, but the wire had stripped them.
//
//   grantKnowledge (the primitive `lookHand` calls — Deep-Cavern Bat,
//     Tidehollow Sculler, …)
//     → projectPublicState   (the shown card crosses the wire face-up, raw
//       `knownTo` stripped)
//     → projectedToGameState (must put `knownTo` back for the viewer)
//     → determinize          (must keep that card in the hand, with its id)
//
// Before this, the last two steps threw it away: every ISMCTS world pooled the
// shown card with the library, so an open "you may exile a card from it" pick
// found none of its candidates in hand and only the decline survived.
import { describe, expect, it } from "vitest";
import { getCardByName } from "@convex/cards";
import { projectPublicState } from "@convex/gameProjections";
import { grantKnowledge } from "@convex/gre/state";
import { determinize } from "@convex/gre/determinize";
import { makeRng } from "@convex/gre/rng";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup.helper";
import { projectedToGameState } from "../state-adapter";

const SHIVAN = getCardByName("Shivan Dragon").id;
const MOUNTAIN = getCardByName("Mountain").id;
const BEARS = getCardByName("Grizzly Bears").id;

const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);

/** The bot seat's own decklist only — `deckKnowledge.blind`. */
const DECK_KNOWLEDGE = [
    { playerId: "bot", cardIds: Array.from({ length: 10 }, () => BEARS) },
];
/** Plus the human's decklist — `deckKnowledge.informed`, what a knowing
 *  preset hands the Worker. */
const INFORMED = [
    ...DECK_KNOWLEDGE,
    {
        playerId: "human",
        cardIds: [SHIVAN, ...Array.from({ length: 13 }, () => MOUNTAIN)],
    },
];

function lookedAtState() {
    const zone = (owner: string, z: "hand" | "library", ids: string[]) =>
        ids.map((cardId, i) =>
            makeInstance(cardId, {
                controllerId: owner,
                ownerId: owner,
                id: `${owner}-${z}-${i}`,
                zone: z,
            })
        );
    const state = makeState({
        turn: 5,
        players: [
            makePlayer("bot", {
                library: zone(
                    "bot",
                    "library",
                    Array.from({ length: 10 }, () => BEARS)
                ),
            }),
            makePlayer("human", {
                hand: zone("human", "hand", [SHIVAN, MOUNTAIN]),
                library: zone(
                    "human",
                    "library",
                    Array.from({ length: 12 }, () => MOUNTAIN)
                ),
            }),
        ],
    });
    // The Bat's look, through the engine's own primitive.
    grantKnowledge(state, "human", ["human-hand-0", "human-hand-1"], "bot");
    return state;
}

function searchWorld(
    state: ReturnType<typeof lookedAtState>,
    knowledge = DECK_KNOWLEDGE
) {
    return projectedToGameState(
        projectPublicState(state, 1, "bot"),
        knowledge,
        "bot"
    );
}

describe("full path — a looked-at opponent hand survives determinization (issue #10436)", () => {
    it.each([
        ["no decklist", DECK_KNOWLEDGE],
        ["informed", INFORMED],
    ])(
        "keeps every shown hand card in the opponent's hand with its own id, every seed (%s)",
        (_, knowledge) => {
            const state = lookedAtState();
            const root = searchWorld(state, knowledge);
            for (const seed of SEEDS) {
                const world = determinize(
                    root,
                    "bot",
                    makeRng(seed),
                    knowledge
                );
                const human = world.players.find((p) => p.id === "human")!;
                expect(human.hand.map((c) => c.id).sort()).toEqual([
                    "human-hand-0",
                    "human-hand-1",
                ]);
                expect(
                    human.hand.find((c) => c.id === "human-hand-0")?.card.id
                ).toBe(SHIVAN);
                expect(human.library).toHaveLength(12);
            }
        }
    );

    it("restores `knownTo` only on the opponent's shown cards, never without a viewer", () => {
        const state = lookedAtState();
        const projected = projectPublicState(state, 1, "bot");
        const withViewer = projectedToGameState(
            projected,
            DECK_KNOWLEDGE,
            "bot"
        );
        const human = withViewer.players.find((p) => p.id === "human")!;
        expect(human.hand.every((c) => c.knownTo?.includes("bot"))).toBe(true);
        const enumerateOnly = projectedToGameState(projected, DECK_KNOWLEDGE);
        expect(
            enumerateOnly.players
                .find((p) => p.id === "human")!
                .hand.some((c) => c.knownTo !== undefined)
        ).toBe(false);
    });

    it("stamps nothing on a hand the Bot has NOT looked at", () => {
        const state = lookedAtState();
        for (const card of state.players[1].hand) card.knownTo = undefined;
        const root = searchWorld(state);
        const hand = root.players.find((p) => p.id === "human")!.hand;
        expect(hand.every((c) => c.knownTo === undefined)).toBe(true);
    });
});
