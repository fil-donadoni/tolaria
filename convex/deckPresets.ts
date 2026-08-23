import type { FormatId } from "./formats";

export interface DeckCard {
    cardId: string;
    cardName: string;
}

export interface DeckPreset {
    presetId: string;
    name: string;
    format: FormatId;
    description: string;
    colors: string[];
    cards: DeckCard[];
    // Sideboard: 0–15 cards held aside (PRD #387, issue #391). Optional;
    // absent/empty for presets that ship without one.
    sideboard?: DeckCard[];
}

/**
 * Resolve a deck's Featured Card to a single Card ID (PRD #589, issue #593).
 * The Featured Card represents the deck's art in the lobby. Rules:
 *   - an explicit `featuredCardId` override wins, but only while that card is
 *     still in the Maindeck (`cards`);
 *   - an override pointing at a card no longer in the deck falls back to the
 *     default — the first card inserted into the Maindeck (`cards[0]`);
 *   - an absent override resolves to that same default;
 *   - an empty deck resolves to `null` (no art to show).
 * Lives in this pure, server-free module so BOTH the Convex builders
 * (`convex/decks.ts` re-exports it) and the frontend (`src/lib/deckTypes.ts`)
 * share one resolver without the client pulling in server runtime. Stores and
 * returns a Card ID only — art uses the default printing (edition-specific
 * featured art is out of scope). Not part of legality (ADR 0036).
 */
export function resolveFeaturedCardId(deck: {
    featuredCardId?: string;
    cards: { cardId: string }[];
}): string | null {
    const fid = deck.featuredCardId;
    if (fid && deck.cards.some((c) => c.cardId === fid)) return fid;
    return deck.cards[0]?.cardId ?? null;
}

function times(n: number, cardId: string, cardName: string): DeckCard[] {
    return Array.from({ length: n }, () => ({ cardId, cardName }));
}

// Casual presets run 40 cards; constructed-style presets (Robots) run larger.
// Land count varies per list. Only cards implemented in convex/cards/sets/.

const whiteWeenie: DeckPreset = {
    presetId: "white-weenie",
    name: "White Weenie",
    format: "freeform",
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
    format: "freeform",
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
    format: "freeform",
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
    format: "freeform",
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
    format: "freeform",
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
    format: "freeform",
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
    format: "freeform",
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

// "Robots" — vintage-style artifact aggro: cheap artifact creatures (Su-Chi,
// Triskelion) and big bombs (Colossus of Sardia, Tetravus) accelerated by the
// full Mox/Lotus suite, with UBR support (burn, reanimation, card draw).
// Larger than the 40-card casual presets — kept at its constructed list size.
const robots: DeckPreset = {
    presetId: "robots",
    name: "Robots",
    format: "freeform",
    description:
        "Artifact aggro: fast Moxen into Su-Chi, Triskelion and big bombs.",
    colors: ["U", "B", "R"],
    cards: [
        ...times(
            1,
            "067c44e9-1b23-42fd-9acb-daafb62c32a2",
            "Colossus of Sardia"
        ),
        ...times(
            2,
            "c9fd4054-42fc-4f95-a6f7-369a5da43dd5",
            "Priest of Yawgmoth"
        ),
        ...times(3, "b4ff60ce-073c-46b8-807c-8b40467b960c", "Sage of Lat-Nam"),
        ...times(4, "a64d4f93-0c04-4078-aec0-7e9de92f260f", "Su-Chi"),
        ...times(1, "23eb19f9-2e8f-4bf0-9bf8-868e6da70e2d", "Tetravus"),
        ...times(4, "a79c99e1-722a-44b6-8fa3-2be3f0c193d8", "Triskelion"),
        ...times(1, "b0faa7f2-b547-42c4-a810-839da50dadfe", "Black Lotus"),
        // Chaos Orb → Sol Ring (Chaos Orb not implemented).
        ...times(1, "c4300d24-1cae-4dd5-be7e-38cc677cf5bd", "Sol Ring"),
        ...times(1, "b0e1427c-05cd-465b-be59-97ed6e39f7ba", "Mox Emerald"),
        ...times(1, "92bcd1ce-19b1-4d78-8b09-95242ca08d76", "Mox Jet"),
        ...times(1, "8ebe4be7-e12a-4596-a899-fbd5b152e879", "Mox Pearl"),
        ...times(1, "8945585f-4773-493d-a0fe-d707db910b38", "Mox Ruby"),
        ...times(1, "82da0972-b17b-4600-9efd-e9430a0db04b", "Mox Sapphire"),
        // Skull of Orm → Raise Dead (Skull of Orm not implemented).
        ...times(1, "ce07bede-2219-427c-a61a-56518751de42", "Raise Dead"),
        ...times(1, "70e7ddf2-5604-41e7-bb9d-ddd03d3e9d0b", "Ancestral Recall"),
        ...times(3, "a6a86e6e-bfff-46af-9d36-c912901fea92", "Psionic Blast"),
        ...times(1, "62b19a12-6914-430e-81ce-dcfca47884df", "Braingeyser"),
        ...times(1, "711d4d54-5520-4de8-9b93-79902ed8e562", "Demonic Tutor"),
        // 2 Fireball + 2 Pyrotechnics (unimplemented) → 3 Fireball + 1 Earthquake
        ...times(1, "e68ac362-6cdc-48a6-bdd3-4f8ea32add64", "Earthquake"),
        ...times(3, "b7623c00-144b-4a8f-9c6c-f5e9e4f65ece", "Fireball"),
        ...times(1, "eee9e106-a248-49d2-b8c8-6bbcd56ce739", "Mind Twist"),
        ...times(1, "33296718-0625-4422-a65c-b21cf99c52ec", "Recall"),
        ...times(1, "e0139f60-d48e-46fb-9f5a-1e3d7558c834", "Time Walk"),
        ...times(1, "9a49dc44-616e-4bdd-8220-0bb71eccc512", "Timetwister"),
        ...times(1, "67b369c4-faa8-45c8-a1b9-98f228b69682", "Wheel of Fortune"),
        ...times(3, "8fd7861d-925f-4b4c-a4ab-60be6f43d50b", "Animate Dead"),
        ...times(1, "fd5ed955-1193-4e6a-a3e2-f54c1f9bf063", "Copy Artifact"),
        // Dance of Many → The Hive (Dance of Many not implemented).
        ...times(1, "544a7138-eae8-4ff9-9e17-680bfa717183", "The Hive"),
        ...times(1, "717f6d10-9144-4ade-9ac6-a481cc66b875", "Badlands"),
        ...times(1, "f4e32327-380d-471e-813b-4c27477787ce", "City of Brass"),
        ...times(2, "90a57c0e-fa61-45ef-955d-d296403967d5", "Island"),
        ...times(
            1,
            "ee266113-34ce-4189-84e7-ee2c86a2722c",
            "Library of Alexandria"
        ),
        ...times(
            1,
            "135de5c7-6ac9-4b68-8f1a-97f120a4b125",
            "Mishra's Workshop"
        ),
        ...times(1, "eace2c85-976c-425e-9800-5a6ccbd91b56", "Mountain"),
        ...times(1, "e7880157-7f27-4f1b-9cdc-ab36a6252376", "Strip Mine"),
        ...times(1, "6176936d-72e2-4205-8871-4c5a4f1cb2d8", "Swamp"),
        ...times(4, "ff76ac86-8a8a-47fe-9388-8950ca3e26c3", "Underground Sea"),
        ...times(4, "0324641d-af55-4c53-b4dc-c8262e967da5", "Volcanic Island"),
    ],
};

const erhnamgeddon: DeckPreset = {
    presetId: "erhnamgeddon",
    name: "Erhnamgeddon",
    format: "freeform",
    description:
        "GWU aggro-control: efficient beaters, then Armageddon under a board lead.",
    colors: ["G", "W", "U"],
    cards: [
        ...times(4, "5712e87a-2381-4f5b-a853-6973841f9bf1", "Argothian Pixies"),
        ...times(3, "42bc0c3f-0a52-4bdc-83da-6484bf3102f3", "Erhnam Djinn"),
        ...times(4, "d05b92bd-797e-413f-a8b0-32e0937a1ee0", "Savannah Lions"),
        ...times(2, "f8ac5006-91bd-4803-93da-f87cf196dd2f", "Serra Angel"),
        ...times(1, "b0faa7f2-b547-42c4-a810-839da50dadfe", "Black Lotus"),
        ...times(1, "b0e1427c-05cd-465b-be59-97ed6e39f7ba", "Mox Emerald"),
        ...times(1, "92bcd1ce-19b1-4d78-8b09-95242ca08d76", "Mox Jet"),
        ...times(1, "8ebe4be7-e12a-4596-a899-fbd5b152e879", "Mox Pearl"),
        ...times(1, "82da0972-b17b-4600-9efd-e9430a0db04b", "Mox Sapphire"),
        ...times(1, "c4300d24-1cae-4dd5-be7e-38cc677cf5bd", "Sol Ring"),
        ...times(1, "70e7ddf2-5604-41e7-bb9d-ddd03d3e9d0b", "Ancestral Recall"),
        ...times(1, "0df55e3f-14de-46ef-b6b1-616618724d9e", "Counterspell"),
        ...times(1, "e691adef-3027-4e6a-889f-9f4e2df36a7c", "Mana Drain"),
        ...times(4, "2722d7e2-61c6-4934-9c21-875ee78fd06c", "Disenchant"),
        // Chaos Orb → 2nd Psionic Blast (Chaos Orb out of scope, ADR 0010).
        ...times(2, "a6a86e6e-bfff-46af-9d36-c912901fea92", "Psionic Blast"),
        ...times(
            4,
            "386ea9eb-abc1-4862-aa2d-8fb808d79490",
            "Swords to Plowshares"
        ),
        ...times(1, "5b6ddce7-b9c5-431d-a0b0-46d4aa93cbcb", "Armageddon"),
        ...times(1, "6f9ea46a-411f-40ce-a873-a905180093f4", "Balance"),
        ...times(1, "62b19a12-6914-430e-81ce-dcfca47884df", "Braingeyser"),
        ...times(1, "711d4d54-5520-4de8-9b93-79902ed8e562", "Demonic Tutor"),
        ...times(1, "eee9e106-a248-49d2-b8c8-6bbcd56ce739", "Mind Twist"),
        ...times(1, "badc73ec-3728-4246-90c7-5f4eb7051ed5", "Regrowth"),
        ...times(1, "e0139f60-d48e-46fb-9f5a-1e3d7558c834", "Time Walk"),
        ...times(1, "9a49dc44-616e-4bdd-8220-0bb71eccc512", "Timetwister"),
        ...times(1, "f486df00-7c4a-4ff0-bb0b-c8b5432ac742", "Sylvan Library"),
        ...times(3, "f4e32327-380d-471e-813b-4c27477787ce", "City of Brass"),
        ...times(
            1,
            "ee266113-34ce-4189-84e7-ee2c86a2722c",
            "Library of Alexandria"
        ),
        ...times(4, "a696c5b6-f216-454d-8029-74e84bbd1428", "Mishra's Factory"),
        ...times(3, "94f7e24c-2546-41b6-81ad-5e920b07e64e", "Savannah"),
        ...times(1, "bebe39d4-21fb-46a4-a1ec-b97102e46c15", "Scrubland"),
        ...times(1, "e7880157-7f27-4f1b-9cdc-ab36a6252376", "Strip Mine"),
        ...times(3, "a9c6c759-aabf-44e7-ba8c-33c5df232b56", "Tropical Island"),
        ...times(4, "a03e8c5b-f4ed-4fd7-ba05-db813ccc05eb", "Tundra"),
    ],
};

// ── Ladder environment rung R1: instant-speed interaction (issue #2689,
// decision #1895 §1) ────────────────────────────────────────────────────────

const bgSacrifice: DeckPreset = {
    presetId: "bg-sacrifice",
    name: "Golgari Sacrifice",
    format: "freeform",
    description: "Sacrifice outlets feeding graveyard recursion.",
    colors: ["B", "G"],
    cards: [
        ...times(4, "d4f1cc9e-4f99-4c26-ac1b-8ef069fa8ceb", "Llanowar Elves"),
        ...times(2, "b1420ec5-367c-4514-86c5-3993bf339e37", "Tarpan"),
        ...times(2, "8845e6bd-40ee-45ca-a099-53f19ff20a8a", "Plague Spitter"),
        ...times(2, "336b3b8f-d104-4f06-ad4f-c92b8a9038ca", "Hell's Caretaker"),
        ...times(3, "0f4174e4-0be8-49b5-8c52-22001790f6eb", "Fallen Angel"),
        ...times(1, "c7e10ca7-1e5d-4224-82cf-798a4d436d72", "Eternal Witness"),
        ...times(2, "cdcccb0f-ce96-453b-9e82-41d87f52e58b", "Ashnod's Altar"),
        ...times(4, "ce07bede-2219-427c-a61a-56518751de42", "Raise Dead"),
        ...times(2, "b6cb2549-e485-44d6-9d65-7605c568909e", "Unearth"),
        ...times(2, "badc73ec-3728-4246-90c7-5f4eb7051ed5", "Regrowth"),
        ...times(6, "6176936d-72e2-4205-8871-4c5a4f1cb2d8", "Swamp"),
        ...times(6, "6f1c8cb0-38eb-408b-94e8-16db83999b3b", "Forest"),
        ...times(4, "412ceddd-2b9a-4551-a6bf-ae2830a2010a", "Bayou"),
    ],
};

const uwFlash: DeckPreset = {
    presetId: "uw-flash",
    name: "Azorius Flash",
    format: "freeform",
    description: "Every threat and answer at instant speed.",
    colors: ["W", "U"],
    cards: [
        ...times(3, "9e5b279e-4670-4a1e-87d0-3cab7e4f9e58", "Snapcaster Mage"),
        ...times(
            2,
            "c2c794b9-09da-49be-b258-b0e21f1663e3",
            "Containment Priest"
        ),
        ...times(2, "98cbc1c2-b76e-4da3-aa43-00e10b2ce532", "Cathar Commando"),
        ...times(3, "f8ac5006-91bd-4803-93da-f87cf196dd2f", "Serra Angel"),
        ...times(4, "0df55e3f-14de-46ef-b6b1-616618724d9e", "Counterspell"),
        ...times(2, "abcaf16d-aa02-43e2-aa38-bb1835d47a05", "Mana Leak"),
        ...times(2, "3d2cc591-3a81-468a-91a4-3c3aac83a21a", "Memory Lapse"),
        ...times(2, "5d6a0f3e-457f-41f5-be26-5fb249874f1a", "Absorb"),
        ...times(2, "aeb359c8-209c-455f-84b2-970e5678a9fa", "Exclude"),
        ...times(
            2,
            "386ea9eb-abc1-4862-aa2d-8fb808d79490",
            "Swords to Plowshares"
        ),
        ...times(6, "90a57c0e-fa61-45ef-955d-d296403967d5", "Island"),
        ...times(6, "b1623d57-4729-4796-b3f7-f1837a05c6ed", "Plains"),
        ...times(2, "a03e8c5b-f4ed-4fd7-ba05-db813ccc05eb", "Tundra"),
        ...times(2, "09dd9023-f7ee-4e99-8821-7059deb83730", "Adarkar Wastes"),
    ],
};

const rgKicker: DeckPreset = {
    presetId: "rg-kicker",
    name: "Gruul Kicker",
    format: "freeform",
    description: "Every nonland card has an optional kicker cost.",
    colors: ["R", "G"],
    cards: [
        ...times(4, "d4f1cc9e-4f99-4c26-ac1b-8ef069fa8ceb", "Llanowar Elves"),
        ...times(3, "3e207863-de68-47e1-8c63-413b5fa48943", "Llanowar Elite"),
        ...times(3, "7e6e2e49-7bde-43c1-8caf-43d237dfc052", "Pouncing Kavu"),
        ...times(3, "a2832ad3-ce7f-44d2-beb2-c95d982905a6", "Kavu Aggressor"),
        ...times(
            2,
            "13f24f89-3996-4740-a6c9-d26b8869554b",
            "Thornscape Battlemage"
        ),
        ...times(
            2,
            "d707243e-7f11-44bc-b8b8-af635ab1dc87",
            "Thunderscape Battlemage"
        ),
        ...times(3, "dc7732bc-e168-44d9-923a-db7e985bd6db", "Skizzik"),
        ...times(2, "61a25a35-3ae4-471e-adcd-d8baf2f77b68", "Urza's Rage"),
        ...times(2, "2a85437f-052e-494c-a9ee-265c4624a409", "Scorching Lava"),
        ...times(6, "eace2c85-976c-425e-9800-5a6ccbd91b56", "Mountain"),
        ...times(6, "6f1c8cb0-38eb-408b-94e8-16db83999b3b", "Forest"),
        ...times(2, "60df6592-0b3b-4b87-aeb2-8fa94b4fb7be", "Taiga"),
        ...times(2, "ba6f1263-d598-49fb-b5f8-09f11822ebd0", "Karplusan Forest"),
    ],
};

const monoUTempo: DeckPreset = {
    presetId: "mono-u-tempo",
    name: "Mono-Blue Tempo",
    format: "freeform",
    description: "Bounce as removal — tempo is the only currency.",
    colors: ["U"],
    cards: [
        ...times(4, "25ab9a2b-e248-4ae2-aac3-b49fdb3e260a", "Flying Men"),
        ...times(3, "cf56e862-3169-4f63-acd0-731080fa32f2", "Serendib Efreet"),
        ...times(
            2,
            "425156e6-8eee-4bff-8f2f-86edd9a4f73b",
            "Waterspout Elemental"
        ),
        ...times(4, "8512f2c1-6361-4b79-843f-80b6bceeeb99", "Unsummon"),
        ...times(3, "b8286edd-644b-4135-8dca-af97f3920de3", "Boomerang"),
        ...times(2, "52ddf7bf-de9c-4657-8d5b-79869d36fa63", "Rushing River"),
        ...times(3, "0df55e3f-14de-46ef-b6b1-616618724d9e", "Counterspell"),
        ...times(3, "9d710a97-062f-4773-b6c6-8aeddeb3b6e8", "Impulse"),
        ...times(16, "90a57c0e-fa61-45ef-955d-d296403967d5", "Island"),
    ],
};

// ── Ladder environment rung R2: cube archetypes (issue #2689, decision
// #1895 §1) — combo-infinite / Izzet Twin is a known coverage hole, deferred
// to PRD #2687 (CR 732 loop shortcut); see the note above LADDER_PAIRINGS in
// scripts/lib/ladder/pairings.ts. ─────────────────────────────────────────

const brReanimator: DeckPreset = {
    presetId: "br-reanimator",
    name: "Rakdos Reanimator",
    format: "freeform",
    description: "Discard a fatty, then cheat it onto the battlefield.",
    colors: ["B", "R"],
    cards: [
        ...times(4, "f60a2091-fb97-4f04-911b-fce9b6351044", "Entomb"),
        ...times(
            4,
            "a1b0da17-d595-441d-811c-a2d28d2bb232",
            "Faithless Looting"
        ),
        ...times(4, "ae1ef31c-8ca5-444c-8f39-e1d1827318f5", "Reanimate"),
        ...times(3, "a88b23ce-ce19-47da-b9f2-055a4d6bdc79", "Exhume"),
        ...times(2, "8fd7861d-925f-4b4c-a4ab-60be6f43d50b", "Animate Dead"),
        ...times(2, "311a6257-dd77-4bb6-81cb-c8e7862350f3", "Necromancy"),
        ...times(3, "b51666ae-2aef-4cb1-9cd4-44aec81530f8", "Griselbrand"),
        ...times(
            2,
            "1be9d9a4-d7ee-4854-abc2-85cabf993ec9",
            "Archon of Cruelty"
        ),
        ...times(7, "6176936d-72e2-4205-8871-4c5a4f1cb2d8", "Swamp"),
        ...times(5, "eace2c85-976c-425e-9800-5a6ccbd91b56", "Mountain"),
        ...times(4, "717f6d10-9144-4ade-9ac6-a481cc66b875", "Badlands"),
    ],
};

const monoRAggro: DeckPreset = {
    presetId: "mono-r-aggro",
    name: "Mono-Red Aggro",
    format: "freeform",
    description: "The cube clock — linear pressure with reach.",
    colors: ["R"],
    cards: [
        ...times(
            4,
            "a9738cda-adb1-47fb-9f4c-ecd930228c4d",
            "Ragavan, Nimble Pilferer"
        ),
        ...times(4, "c1ba83ab-83f5-421d-bba1-0f925870b5c8", "Ball Lightning"),
        ...times(3, "2bc1b462-4e3c-47cc-87c5-f6e29dd70c01", "Kavu Runner"),
        ...times(4, "d573ef03-4730-45aa-93dd-e45ac1dbaf4a", "Lightning Bolt"),
        ...times(4, "b5883762-ca0a-4932-8d2a-41a45796a5f8", "Chain Lightning"),
        ...times(3, "b1eb5b2c-1f02-48a6-a287-88eb189d6780", "Fireblast"),
        ...times(
            2,
            "8e5283db-3e22-4862-9d95-56d03d09c2ae",
            "Price of Progress"
        ),
        ...times(16, "eace2c85-976c-425e-9800-5a6ccbd91b56", "Mountain"),
    ],
};

const uwControl: DeckPreset = {
    presetId: "uw-control",
    name: "Azorius Control",
    format: "freeform",
    description: "Seven sweepers, four counterspells, two win conditions.",
    colors: ["W", "U"],
    cards: [
        ...times(3, "a2788d69-6a3a-42f0-8736-cc6b57755ecd", "Wrath of God"),
        ...times(2, "2aa98fca-972b-46c2-bdec-6ace35c988d5", "Day of Judgment"),
        ...times(2, "94bc55ed-b89b-4e22-b3f1-4ce0f8d180d7", "Rout"),
        ...times(
            4,
            "386ea9eb-abc1-4862-aa2d-8fb808d79490",
            "Swords to Plowshares"
        ),
        ...times(4, "0df55e3f-14de-46ef-b6b1-616618724d9e", "Counterspell"),
        ...times(3, "abcaf16d-aa02-43e2-aa38-bb1835d47a05", "Mana Leak"),
        ...times(2, "5d6a0f3e-457f-41f5-be26-5fb249874f1a", "Absorb"),
        ...times(2, "cac8c421-5b92-481d-b2de-560c0231ab58", "Jayemdae Tome"),
        ...times(2, "f8ac5006-91bd-4803-93da-f87cf196dd2f", "Serra Angel"),
        ...times(6, "90a57c0e-fa61-45ef-955d-d296403967d5", "Island"),
        ...times(6, "b1623d57-4729-4796-b3f7-f1837a05c6ed", "Plains"),
        ...times(2, "a03e8c5b-f4ed-4fd7-ba05-db813ccc05eb", "Tundra"),
        ...times(2, "09dd9023-f7ee-4e99-8821-7059deb83730", "Adarkar Wastes"),
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
    robots,
    erhnamgeddon,
    bgSacrifice,
    uwFlash,
    rgKicker,
    monoUTempo,
    brReanimator,
    monoRAggro,
    uwControl,
];
