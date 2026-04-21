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

// All preset decks: 40 cards total. Land count varies per list. Only cards
// implemented in convex/cards/sets/lea.ts.

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
    colors: ["R", "G"],
    cards: [
        ...times(4, "d4f1cc9e-4f99-4c26-ac1b-8ef069fa8ceb", "Llanowar Elves"),
        ...times(
            2,
            "55fe6449-1f23-43dc-adee-d144cd505b5c",
            "Birds of Paradise"
        ),
        ...times(4, "d573ef03-4730-45aa-93dd-e45ac1dbaf4a", "Lightning Bolt"),
        ...times(4, "b7623c00-144b-4a8f-9c6c-f5e9e4f65ece", "Fireball"),
        ...times(1, "c1862c47-71cc-45a3-8805-a5ddc62e55ea", "Channel"),
        ...times(1, "c4300d24-1cae-4dd5-be7e-38cc677cf5bd", "Sol Ring"),
        ...times(4, "bfed1a95-bd67-4e16-a781-81866028af2f", "Craw Wurm"),
        ...times(4, "c8d6081e-f686-4263-a0a2-21c0d9af5fdb", "War Mammoth"),
        ...times(6, "6f1c8cb0-38eb-408b-94e8-16db83999b3b", "Forest"),
        ...times(6, "eace2c85-976c-425e-9800-5a6ccbd91b56", "Mountain"),
        ...times(4, "60df6592-0b3b-4b87-aeb2-8fa94b4fb7be", "Taiga"),
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

const leDeck: DeckPreset = {
    presetId: "le-deck",
    name: "LE Deck",
    format: "Freeform",
    description: "UW control with Jade Statue finishers and artifact theft.",
    colors: ["W", "U"],
    cards: [
        ...times(3, "0df55e3f-14de-46ef-b6b1-616618724d9e", "Counterspell"),
        ...times(3, "a6a86e6e-bfff-46af-9d36-c912901fea92", "Psionic Blast"),
        ...times(3, "2722d7e2-61c6-4934-9c21-875ee78fd06c", "Disenchant"),
        ...times(
            3,
            "386ea9eb-abc1-4862-aa2d-8fb808d79490",
            "Swords to Plowshares"
        ),
        ...times(3, "8d82d94b-ceef-4533-a4f2-b6442a61b839", "Jade Statue"),
        ...times(1, "e0139f60-d48e-46fb-9f5a-1e3d7558c834", "Time Walk"),
        ...times(1, "62b19a12-6914-430e-81ce-dcfca47884df", "Braingeyser"),
        ...times(1, "6f9ea46a-411f-40ce-a873-a905180093f4", "Balance"),
        ...times(1, "7b52f459-c703-4a0b-9114-ff69eec61287", "Control Magic"),
        ...times(1, "a2788d69-6a3a-42f0-8736-cc6b57755ecd", "Wrath of God"),
        ...times(1, "83316930-d6ad-46ce-9b40-48eea856d95b", "Steal Artifact"),
        ...times(1, "c4300d24-1cae-4dd5-be7e-38cc677cf5bd", "Sol Ring"),
        ...times(3, "f8ac5006-91bd-4803-93da-f87cf196dd2f", "Serra Angel"),
        ...times(7, "90a57c0e-fa61-45ef-955d-d296403967d5", "Island"),
        ...times(7, "b1623d57-4729-4796-b3f7-f1837a05c6ed", "Plains"),
        ...times(1, "a03e8c5b-f4ed-4fd7-ba05-db813ccc05eb", "Tundra"),
    ],
};

const gueddon: DeckPreset = {
    presetId: "gueddon",
    name: "Gueddon",
    format: "Freeform",
    description: "GW aggro with mana dorks, Juggernauts and Armageddon lock.",
    colors: ["G", "W"],
    cards: [
        ...times(2, "d4f1cc9e-4f99-4c26-ac1b-8ef069fa8ceb", "Llanowar Elves"),
        ...times(3, "1cb9d405-f2b5-4e10-a405-feafd2a87d90", "Elvish Archers"),
        ...times(
            3,
            "386ea9eb-abc1-4862-aa2d-8fb808d79490",
            "Swords to Plowshares"
        ),
        ...times(3, "2722d7e2-61c6-4934-9c21-875ee78fd06c", "Disenchant"),
        ...times(3, "dcd6a291-5282-4f49-8203-d9b416083c48", "Juggernaut"),
        ...times(2, "367dbefe-3366-408e-9fcf-7dc00f8cc201", "Giant Growth"),
        ...times(3, "f8ac5006-91bd-4803-93da-f87cf196dd2f", "Serra Angel"),
        ...times(1, "c4300d24-1cae-4dd5-be7e-38cc677cf5bd", "Sol Ring"),
        ...times(1, "cac8c421-5b92-481d-b2de-560c0231ab58", "Jayemdae Tome"),
        ...times(2, "29dc1596-a2e7-4d60-9f99-89babaef8a06", "Icy Manipulator"),
        ...times(1, "9359f60c-9a27-4e53-b35b-964a121a6fba", "Winter Orb"),
        ...times(1, "5b6ddce7-b9c5-431d-a0b0-46d4aa93cbcb", "Armageddon"),
        ...times(7, "6f1c8cb0-38eb-408b-94e8-16db83999b3b", "Forest"),
        ...times(7, "b1623d57-4729-4796-b3f7-f1837a05c6ed", "Plains"),
        ...times(1, "94f7e24c-2546-41b6-81ad-5e920b07e64e", "Savannah"),
    ],
};

const monoBlack: DeckPreset = {
    presetId: "mono-black",
    name: "Mono Black",
    format: "Freeform",
    description: "Disruption, direct drain, and evasive black creatures.",
    colors: ["B"],
    cards: [
        ...times(4, "510840f4-7c0e-4b47-8ebf-23c20cac4bd9", "Sengir Vampire"),
        ...times(4, "c1662949-0d69-49a3-8c69-daf10717ed4e", "Black Knight"),
        ...times(4, "5d077a49-73d4-4958-b42a-31b814e110e8", "Drain Life"),
        ...times(3, "ebb6664d-23ca-456e-9916-afcd6f26aa7f", "Dark Ritual"),
        ...times(3, "b43b900f-2d9b-442b-9699-058483604ec9", "Hypnotic Specter"),
        ...times(1, "04b31611-9053-4eaf-b392-21bb644fef5f", "Sinkhole"),
        ...times(3, "43572906-ea74-4411-a549-5dc401591d2a", "Bad Moon"),
        ...times(1, "b8cdd6a7-f772-4ccb-914f-63f52ed54d6b", "Nightmare"),
        ...times(1, "59590768-fa96-4869-8763-9d5ab6ac22ad", "Royal Assassin"),
        ...times(1, "92bcd1ce-19b1-4d78-8b09-95242ca08d76", "Mox Jet"),
        ...times(1, "711d4d54-5520-4de8-9b93-79902ed8e562", "Demonic Tutor"),
        ...times(14, "6176936d-72e2-4205-8871-4c5a4f1cb2d8", "Swamp"),
    ],
};

export const PRESET_DECKS: DeckPreset[] = [
    whiteWeenie,
    monoRedBurn,
    monoGreenStompy,
    channelFireball,
    leDeck,
    gueddon,
    monoBlack,
];
