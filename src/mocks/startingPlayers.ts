import { times } from "~/lib/utils";
import { emptyManaPool, type Deck, type Player } from "~/types/game";

export const whiteWeenieDeck: Deck = {
    id: "deck-1",
    name: "White Weenie",
    format: "Freeform",
    cards: [
        // Artifacts
        ...times(1, "b0faa7f2-b547-42c4-a810-839da50dadfe", "Black Lotus"),
        ...times(1, "8ebe4be7-e12a-4596-a899-fbd5b152e879", "Mox Pearl"),
        ...times(1, "82da0972-b17b-4600-9efd-e9430a0db04b", "Mox Sapphire"),
        ...times(1, "92bcd1ce-19b1-4d78-8b09-95242ca08d76", "Mox Jet"),
        ...times(1, "8945585f-4773-493d-a0fe-d707db910b38", "Mox Ruby"),
        ...times(1, "b0e1427c-05cd-465b-be59-97ed6e39f7ba", "Mox Emerald"),
        // Creatures
        ...times(4, "d05b92bd-797e-413f-a8b0-32e0937a1ee0", "Savannah Lions"),
        ...times(2, "99ec4723-b36c-4015-b361-736a6523e8f5", "Wall of Swords"),
        ...times(3, "2722d7e2-61c6-4934-9c21-875ee78fd06c", "Disenchant"),
        ...times(4, "f8ac5006-91bd-4803-93da-f87cf196dd2f", "Serra Angel"),
        // Lands
        ...times(6, "b1623d57-4729-4796-b3f7-f1837a05c6ed", "Plains"),
    ],
};

export const monoredDeck: Deck = {
    id: "deck-2",
    name: "Monored",
    format: "Freeform",
    cards: [
        // ...times(
        //     4,
        //     "5129b422-7a35-4bc5-b14b-c814012a0d8f",
        //     "Goblin Balloon Brigade"
        // ),
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
        deck: whiteWeenieDeck,
        hand: [],
        library: [],
        graveyard: [],
        exile: [],

        battlefield: [],
        manaPool: emptyManaPool,
    },
];
