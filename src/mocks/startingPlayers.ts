import { times } from "~/lib/utils";
import { emptyManaPool, type Deck, type Player } from "~/types/game";

export const whiteWeenieDeck: Deck = {
    id: "deck-1",
    name: "White Weenie",
    format: "Freeform",
    cards: [
        // Enchantments
        ...times(4, "057986c7-20c0-4157-b4df-beae4ef5c66d", "Crusade"),
        ...times(2, "b0da8d56-3178-44c2-9344-95d2346d326f", "Castle"),
        ...times(2, "ddb633f5-cc4d-4157-8217-def90cb15e24", "Lance"),
        // Instants
        ...times(
            4,
            "386ea9eb-abc1-4862-aa2d-8fb808d79490",
            "Swords to Plowshares"
        ),
        ...times(4, "2722d7e2-61c6-4934-9c21-875ee78fd06c", "Disenchant"),
        // Sorceries
        ...times(2, "5b6ddce7-b9c5-431d-a0b0-46d4aa93cbcb", "Armageddon"),
        ...times(2, "a2788d69-6a3a-42f0-8736-cc6b57755ecd", "Wrath of God"),
        // Creatures
        ...times(4, "d05b92bd-797e-413f-a8b0-32e0937a1ee0", "Savannah Lions"),
        ...times(2, "efba235e-04e5-449c-906c-0ac33f6d7929", "Samite Healer"),
        ...times(2, "99ec4723-b36c-4015-b361-736a6523e8f5", "Wall of Swords"),
        ...times(4, "50abfba8-c9f9-4ebf-965a-4b425fe83129", "White Knight"),
        ...times(4, "f8ac5006-91bd-4803-93da-f87cf196dd2f", "Serra Angel"),
        // Lands
        ...times(24, "b1623d57-4729-4796-b3f7-f1837a05c6ed", "Plains"),
    ],
};

export const monoredDeck: Deck = {
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
        deck: whiteWeenieDeck,
        hand: [],
        library: [],
        graveyard: [],
        exile: [],

        battlefield: [],
        manaPool: emptyManaPool,
    },
    {
        id: "2",
        name: "Player 2",
        bgColor: "#63768D",
        life: 20,
        deck: monoredDeck,
        hand: [],
        library: [],
        graveyard: [],
        exile: [],

        battlefield: [],
        manaPool: emptyManaPool,
    },
];
