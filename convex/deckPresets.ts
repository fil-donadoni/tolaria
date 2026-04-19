export interface DeckCard {
    cardId: string;
    cardName: string;
}

export interface DeckPreset {
    presetId: string;
    name: string;
    format: string;
    description: string;
    colors: string[];
    cards: DeckCard[];
}

function times(n: number, cardId: string, cardName: string): DeckCard[] {
    return Array.from({ length: n }, () => ({ cardId, cardName }));
}

// All preset decks: 40 cards total, 16 lands (40%). Only cards implemented in
// convex/cards/sets/lea.ts.

const whiteWeenie: DeckPreset = {
    presetId: "white-weenie",
    name: "White Weenie",
    format: "Freeform",
    description: "Small creatures backed by removal.",
    colors: ["W"],
    cards: [
        ...times(4, "d05b92bd-797e-413f-a8b0-32e0937a1ee0", "Savannah Lions"),
        ...times(4, "6daf1aab-1e58-4a5a-bc66-cb3f7c86e0e8", "Pearled Unicorn"),
        ...times(2, "99ec4723-b36c-4015-b361-736a6523e8f5", "Wall of Swords"),
        ...times(4, "f8ac5006-91bd-4803-93da-f87cf196dd2f", "Serra Angel"),
        ...times(3, "2722d7e2-61c6-4934-9c21-875ee78fd06c", "Disenchant"),
        ...times(
            3,
            "386ea9eb-abc1-4862-aa2d-8fb808d79490",
            "Swords to Plowshares"
        ),
        ...times(2, "a2788d69-6a3a-42f0-8736-cc6b57755ecd", "Wrath of God"),
        ...times(2, "b0da8d56-3178-44c2-9344-95d2346d326f", "Castle"),
        ...times(16, "b1623d57-4729-4796-b3f7-f1837a05c6ed", "Plains"),
    ],
};

const monoRedBurn: DeckPreset = {
    presetId: "mono-red-burn",
    name: "Mono Red Burn",
    format: "Freeform",
    description: "Fast creatures and direct damage.",
    colors: ["R"],
    cards: [
        ...times(4, "d573ef03-4730-45aa-93dd-e45ac1dbaf4a", "Lightning Bolt"),
        ...times(
            4,
            "b4eb3db3-6a7c-488a-9433-d5d1d3133816",
            "Mons's Goblin Raiders"
        ),
        ...times(4, "0ddb98e8-13fe-4786-83f7-b72c56db135a", "Hill Giant"),
        ...times(4, "78a9088f-8755-47cb-aa93-51d992ccab90", "Hurloon Minotaur"),
        ...times(2, "73ae5276-b607-4f23-a9d2-e8cc7b8e3693", "Gray Ogre"),
        ...times(
            2,
            "731a4b86-c213-4d8e-bf01-0a0e8cff0ff1",
            "Roc of Kher Ridges"
        ),
        ...times(2, "da237992-2919-4e37-8f56-2164095f59b5", "Fire Elemental"),
        ...times(2, "b24b5864-44c0-4bc8-8705-9504f83b2c03", "Earth Elemental"),
        ...times(16, "eace2c85-976c-425e-9800-5a6ccbd91b56", "Mountain"),
    ],
};

const channelFireball: DeckPreset = {
    presetId: "channel-fireball",
    name: "RG Channel Fireball",
    format: "Freeform",
    description: "Cast big X Spells.",
    colors: ["G"],
    cards: [
        ...times(4, "d4f1cc9e-4f99-4c26-ac1b-8ef069fa8ceb", "Llanowar Elves"),
        ...times(
            2,
            "55fe6449-1f23-43dc-adee-d144cd505b5c",
            "Birds of Paradise"
        ),
        ...times(3, "d573ef03-4730-45aa-93dd-e45ac1dbaf4a", "Lightning Bolt"),
        // 1 sol ring
        // 1 hurricane
        // 4 fireball
        // 3 juggernaut
        // 1 channel
        // 2 icy manipulator
        // 2 jade statue
        // 6 forest
        // 6 mountain
        // 4 taiga
    ],
};

const monoGreenStompy: DeckPreset = {
    presetId: "mono-green-stompy",
    name: "Mono Green Stompy",
    format: "Freeform",
    description: "Mana ramp into big creatures.",
    colors: ["G"],
    cards: [
        ...times(4, "d4f1cc9e-4f99-4c26-ac1b-8ef069fa8ceb", "Llanowar Elves"),
        ...times(
            2,
            "55fe6449-1f23-43dc-adee-d144cd505b5c",
            "Birds of Paradise"
        ),
        ...times(4, "ce2d603a-3231-4a8c-bf39-1617586ea870", "Grizzly Bears"),
        ...times(2, "6d929c38-91e6-457c-937a-d1884f4bba44", "Scryb Sprites"),
        ...times(2, "8df80424-3bd9-4982-ad79-e55d9ba3b43d", "Wall of Wood"),
        ...times(
            2,
            "b93c5869-7777-44bb-967a-e9439b25ced4",
            "Ironroot Treefolk"
        ),
        ...times(4, "c8d6081e-f686-4263-a0a2-21c0d9af5fdb", "War Mammoth"),
        ...times(2, "bfed1a95-bd67-4e16-a781-81866028af2f", "Craw Wurm"),
        ...times(2, "367dbefe-3366-408e-9fcf-7dc00f8cc201", "Giant Growth"),
        ...times(16, "6f1c8cb0-38eb-408b-94e8-16db83999b3b", "Forest"),
    ],
};

export const PRESET_DECKS: DeckPreset[] = [
    whiteWeenie,
    monoRedBurn,
    monoGreenStompy,
    channelFireball,
];
