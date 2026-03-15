import { times } from "~/lib/utils";
import { emptyManaPool, type Deck, type Player } from "~/types/game";

const player1Deck: Deck = {
    id: "deck-1",
    name: "White Weenie",
    format: "Freeform",
    cards: [
        ...times(4, "d05b92bd-797e-413f-a8b0-32e0937a1ee0", "Savannah Lions"),
        ...times(
            2,
            "386ea9eb-abc1-4862-aa2d-8fb808d79490",
            "Swords to Plowshares"
        ),
        ...times(5, "b1623d57-4729-4796-b3f7-f1837a05c6ed", "Plains"),
    ],
};

const player2Deck: Deck = {
    id: "deck-2",
    name: "Monored",
    format: "Freeform",
    cards: [
        ...times(
            4,
            "5129b422-7a35-4bc5-b14b-c814012a0d8f",
            "Goblin Balloon Brigade"
        ),
        ...times(2, "d573ef03-4730-45aa-93dd-e45ac1dbaf4a", "Lightning Bolt"),
        ...times(5, "eace2c85-976c-425e-9800-5a6ccbd91b56", "Mountain"),
    ],
};

export const startingPlayers: Player[] = [
    {
        id: "1",
        name: "Player 1",
        bgColor: "#4B5A6C",
        life: 20,
        deck: player1Deck,
        hand: [],
        library: [],
        graveyard: [],
        exile: [],
        stack: [],
        battlefield: [],
        manaPool: emptyManaPool,
    },
    {
        id: "2",
        name: "Player 2",
        bgColor: "#63768D",
        life: 20,
        deck: player2Deck,
        hand: [],
        library: [],
        graveyard: [],
        exile: [],
        stack: [],
        battlefield: [],
        manaPool: emptyManaPool,
    },
];
