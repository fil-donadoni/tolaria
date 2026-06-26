// 2ED (Unlimited Edition). Unlimited reprints the full Beta card list with no
// new cards, so this module is entirely CardPrint entries: each declares the
// per-edition Scryfall UUID (printId) and resolves printId -> definitionId ->
// the shared LEA/LEB CardDefinition. See ADR 0014.
//
// Excluded (mirrors LEA/LEB): ante cards (Contract from Below, Darkpact,
// Demonic Attorney) and Chaos Orb are permanently out of scope (ADR 0010).
// Camouflage shipped (#563, pile combat) and Word of Command shipped
// (#576 / #577, ADR 0037). A 2ED print lands automatically once its LEA def
// exists — see `camouflage2ed` / `wordOfCommand2ed` below.

import type { CardPrint } from "../../types";

export const airElemental2ed: CardPrint = {
    printId: "ef5b8140-a157-4c20-a428-fa7250ab34e1",
    definitionId: "69c3b2a3-0daa-4d42-832d-fcdfda6555ea", // Air Elemental
    setCode: "2ed",
    rarity: "uncommon",
};

export const ancestralRecall2ed: CardPrint = {
    printId: "2dd41293-d7c8-4422-9f0c-b3e96350f5c9",
    definitionId: "70e7ddf2-5604-41e7-bb9d-ddd03d3e9d0b", // Ancestral Recall
    setCode: "2ed",
    rarity: "rare",
};

export const animateArtifact2ed: CardPrint = {
    printId: "caf1ee51-2852-44c0-a5d4-d0e415381738",
    definitionId: "664b46f5-0424-4f4e-9f26-6bd2cf5e0357", // Animate Artifact
    setCode: "2ed",
    rarity: "uncommon",
};

export const blueElementalBlast2ed: CardPrint = {
    printId: "42d1579e-a587-4397-bd9a-cda52fcf6a1b",
    definitionId: "20d666ef-39bf-4fbf-8201-5f1056539da2", // Blue Elemental Blast
    setCode: "2ed",
    rarity: "common",
};

export const braingeyser2ed: CardPrint = {
    printId: "3dbeef5c-f973-480b-a148-28de397b610f",
    definitionId: "62b19a12-6914-430e-81ce-dcfca47884df", // Braingeyser
    setCode: "2ed",
    rarity: "rare",
};

export const camouflage2ed: CardPrint = {
    printId: "09243dc6-c56c-42a8-969b-2ecffe89e1ca",
    definitionId: "3838c2a3-7fab-4976-9c1b-2891aee24e52", // Camouflage
    setCode: "2ed",
    rarity: "uncommon",
};

export const clone2ed: CardPrint = {
    printId: "bcf09714-89cf-4feb-b941-74f791bbdf6e",
    definitionId: "f00d33dd-4eb2-4446-9813-1923d8e2d2f3", // Clone
    setCode: "2ed",
    rarity: "uncommon",
};

export const controlMagic2ed: CardPrint = {
    printId: "076d132a-fa3d-464b-b5f9-a12e46c9f2df",
    definitionId: "7b52f459-c703-4a0b-9114-ff69eec61287", // Control Magic
    setCode: "2ed",
    rarity: "uncommon",
};

export const copyArtifact2ed: CardPrint = {
    printId: "dde40c1f-5ccc-435b-ac35-62eb58ffeea2",
    definitionId: "fd5ed955-1193-4e6a-a3e2-f54c1f9bf063", // Copy Artifact
    setCode: "2ed",
    rarity: "rare",
};

export const counterspell2ed: CardPrint = {
    printId: "7c666b4b-c4ff-40ca-9d16-c76aafebaa83",
    definitionId: "0df55e3f-14de-46ef-b6b1-616618724d9e", // Counterspell
    setCode: "2ed",
    rarity: "uncommon",
};

export const creatureBond2ed: CardPrint = {
    printId: "1f9e4aa8-4ca7-4893-81d7-98205246f357",
    definitionId: "ee4bd7d1-77e5-46e5-a594-c24469e88c4c", // Creature Bond
    setCode: "2ed",
    rarity: "common",
};

export const drainPower2ed: CardPrint = {
    printId: "6123f833-236d-4c61-b543-4ac662759336",
    definitionId: "ea3830c5-cc66-453e-9e53-0636e00ee0ee", // Drain Power
    setCode: "2ed",
    rarity: "rare",
};

export const feedback2ed: CardPrint = {
    printId: "5083317e-8536-41e3-a441-8e6be4d63d50",
    definitionId: "0eb8f591-d763-49bf-8ef9-86265aaa72f7", // Feedback
    setCode: "2ed",
    rarity: "uncommon",
};

export const flight2ed: CardPrint = {
    printId: "5460051e-07fc-4818-82fd-7c424334b7bf",
    definitionId: "67c7784b-6b79-4268-a714-895c82809aff", // Flight
    setCode: "2ed",
    rarity: "common",
};

export const invisibility2ed: CardPrint = {
    printId: "de833d23-2abd-42c3-a38f-f16813aaee4e",
    definitionId: "1858ac51-e6a7-48d7-8759-166070ca13d8", // Invisibility
    setCode: "2ed",
    rarity: "common",
};

export const jump2ed: CardPrint = {
    printId: "24b4c4c9-84c1-484c-9f67-1f460585d45c",
    definitionId: "cb3f4b11-ad1b-48e2-a500-787d351b0174", // Jump
    setCode: "2ed",
    rarity: "common",
};

export const lifetap2ed: CardPrint = {
    printId: "64641b90-c72e-4eab-9b99-330786739ab9",
    definitionId: "11add837-7ee4-4104-b031-c161bce459ae", // Lifetap
    setCode: "2ed",
    rarity: "uncommon",
};

export const lordOfAtlantis2ed: CardPrint = {
    printId: "fa161987-2dd1-4efe-b934-acbd93653169",
    definitionId: "210c4a90-fc7a-4c76-aeaa-20a005e45386", // Lord of Atlantis
    setCode: "2ed",
    rarity: "rare",
};

export const magicalHack2ed: CardPrint = {
    printId: "7abc2b06-3613-4e42-bf51-d340d1e70a78",
    definitionId: "2bd4202c-0477-45aa-82fd-83c85d6d4bef", // Magical Hack
    setCode: "2ed",
    rarity: "rare",
};

export const mahamotiDjinn2ed: CardPrint = {
    printId: "66d5effc-dc31-485c-91c0-e9a8e2b098af",
    definitionId: "36204ddd-ddf7-4b44-ae3c-b4a5a41ac9cb", // Mahamoti Djinn
    setCode: "2ed",
    rarity: "rare",
};

export const manaShort2ed: CardPrint = {
    printId: "743e0f1e-55ab-429a-b9f1-769b008ad06a",
    definitionId: "73e3e0b3-5284-464f-8c62-0f7801c966f5", // Mana Short
    setCode: "2ed",
    rarity: "rare",
};

export const merfolkOfThePearlTrident2ed: CardPrint = {
    printId: "ab8019a6-0d62-4145-8a4d-87205d3cb9d6",
    definitionId: "2b871039-6a66-4ac3-95e7-24759c1f2f92", // Merfolk of the Pearl Trident
    setCode: "2ed",
    rarity: "common",
};

export const phantasmalForces2ed: CardPrint = {
    printId: "e8244a80-3d9a-4392-ac62-739b3e330638",
    definitionId: "0631c7c8-9aa5-4333-8e20-20247fc47033", // Phantasmal Forces
    setCode: "2ed",
    rarity: "uncommon",
};

export const phantasmalTerrain2ed: CardPrint = {
    printId: "c521f86e-f1bb-4e63-ab12-5ecebba2701b",
    definitionId: "1c371aa1-1619-41e3-8364-7bc9b8cf5d14", // Phantasmal Terrain
    setCode: "2ed",
    rarity: "common",
};

export const phantomMonster2ed: CardPrint = {
    printId: "cd480428-de3e-4e98-8483-684f0572c400",
    definitionId: "e46d2cf5-e8d0-4fb2-b950-252d52084b63", // Phantom Monster
    setCode: "2ed",
    rarity: "uncommon",
};

export const pirateShip2ed: CardPrint = {
    printId: "d6119988-4797-4993-a75f-e7015c2c6354",
    definitionId: "d0a7cb23-d229-43c5-addd-dcf423984b0c", // Pirate Ship
    setCode: "2ed",
    rarity: "rare",
};

export const powerLeak2ed: CardPrint = {
    printId: "436fd628-c545-4cbf-8100-4e6aa8475868",
    definitionId: "ccc982b6-35b2-4e33-ace2-86cb79123e4f", // Power Leak
    setCode: "2ed",
    rarity: "common",
};

export const powerSink2ed: CardPrint = {
    printId: "f0313c44-d4ca-4021-866a-3d5cf58b0e76",
    definitionId: "1b342dd3-09b9-4108-bf12-a65d4cef4eb9", // Power Sink
    setCode: "2ed",
    rarity: "common",
};

export const prodigalSorcerer2ed: CardPrint = {
    printId: "4cfb5638-4502-44ed-b54c-27276d45d1ad",
    definitionId: "e4dc1103-7bf1-47f6-9006-d3ed9ccd7a6a", // Prodigal Sorcerer
    setCode: "2ed",
    rarity: "common",
};

export const psionicBlast2ed: CardPrint = {
    printId: "8a1dff82-de5c-4b1d-b87f-6ddb4551f820",
    definitionId: "a6a86e6e-bfff-46af-9d36-c912901fea92", // Psionic Blast
    setCode: "2ed",
    rarity: "uncommon",
};

export const psychicVenom2ed: CardPrint = {
    printId: "b36e0fba-f6a4-4400-b685-3178431c292f",
    definitionId: "f3f5b68a-6b0e-431e-89f0-ff60f17687a5", // Psychic Venom
    setCode: "2ed",
    rarity: "common",
};

export const seaSerpent2ed: CardPrint = {
    printId: "af430730-2ce8-45c3-b1da-9745fc792d71",
    definitionId: "d0b333b7-db4d-4439-b0de-60414cbf8d7b", // Sea Serpent
    setCode: "2ed",
    rarity: "common",
};

export const sirenSCall2ed: CardPrint = {
    printId: "0c907ef4-a2cf-4e7a-acf6-f187308ff303",
    definitionId: "d992b336-3b6e-43e1-8662-d85664349b44", // Siren's Call
    setCode: "2ed",
    rarity: "uncommon",
};

export const sleightOfMind2ed: CardPrint = {
    printId: "d1349af8-a709-4535-b532-eb769289906d",
    definitionId: "d427790c-e322-446e-8d7d-a6b48ad41a42", // Sleight of Mind
    setCode: "2ed",
    rarity: "rare",
};

export const spellBlast2ed: CardPrint = {
    printId: "9ec03950-80f7-4783-9b65-f2538436c9be",
    definitionId: "845734da-ab03-4dbc-bb5f-96481d3b8e88", // Spell Blast
    setCode: "2ed",
    rarity: "common",
};

export const stasis2ed: CardPrint = {
    printId: "5902c2aa-c77c-4c6a-9a1e-77cb9bb53aa1",
    definitionId: "b6cef408-5b4b-49f6-9531-be544815b93f", // Stasis
    setCode: "2ed",
    rarity: "rare",
};

export const stealArtifact2ed: CardPrint = {
    printId: "04a1a6f4-a73b-4593-b14e-8c87f94debc1",
    definitionId: "83316930-d6ad-46ce-9b40-48eea856d95b", // Steal Artifact
    setCode: "2ed",
    rarity: "uncommon",
};

export const thoughtlace2ed: CardPrint = {
    printId: "b8859cf0-e4c3-4044-9674-d0703646d72e",
    definitionId: "23749375-1416-47a4-9251-52f41fe2fae9", // Thoughtlace
    setCode: "2ed",
    rarity: "rare",
};

export const timetwister2ed: CardPrint = {
    printId: "01bda3d7-122a-48a0-bab3-676c4a557b74",
    definitionId: "9a49dc44-616e-4bdd-8220-0bb71eccc512", // Timetwister
    setCode: "2ed",
    rarity: "rare",
};

export const timeWalk2ed: CardPrint = {
    printId: "ade7d00d-4e7b-46e9-ace1-63f628a589fc",
    definitionId: "e0139f60-d48e-46fb-9f5a-1e3d7558c834", // Time Walk
    setCode: "2ed",
    rarity: "rare",
};

export const twiddle2ed: CardPrint = {
    printId: "ba01195b-05a0-4de7-807e-934e71feb8c7",
    definitionId: "576e811f-26a3-4a7c-bd13-3b1cc3e184eb", // Twiddle
    setCode: "2ed",
    rarity: "common",
};

export const unsummon2ed: CardPrint = {
    printId: "0a681487-951d-4ff1-ab08-bc173ea022e8",
    definitionId: "8512f2c1-6361-4b79-843f-80b6bceeeb99", // Unsummon
    setCode: "2ed",
    rarity: "common",
};

export const vesuvanDoppelganger2ed: CardPrint = {
    printId: "408ec348-183b-43de-abac-7ae9e3843c10",
    definitionId: "768f3a05-bd06-4a23-b9f2-94f6e618fd9f", // Vesuvan Doppelganger
    setCode: "2ed",
    rarity: "rare",
};

export const volcanicEruption2ed: CardPrint = {
    printId: "6d7c78a4-e3db-42bf-8365-d7a08c26f4a9",
    definitionId: "a80582b1-09db-45f8-b362-0e5207a5a8e6", // Volcanic Eruption
    setCode: "2ed",
    rarity: "rare",
};

export const wallOfAir2ed: CardPrint = {
    printId: "d672107f-e274-4a0e-888a-c2aa59a2fab5",
    definitionId: "da56fdf3-6a8f-4833-a5c3-197650cc4889", // Wall of Air
    setCode: "2ed",
    rarity: "uncommon",
};

export const wallOfWater2ed: CardPrint = {
    printId: "f97f5b6e-7997-498a-9b27-ac2873f425dd",
    definitionId: "41faed1a-ded8-49ee-8e2a-c60d377775d7", // Wall of Water
    setCode: "2ed",
    rarity: "uncommon",
};

export const waterElemental2ed: CardPrint = {
    printId: "c498c898-1671-4632-b69a-0e1e9b8d05b8",
    definitionId: "8de940d6-98c0-46a9-b5fd-e2b0899ea19e", // Water Elemental
    setCode: "2ed",
    rarity: "uncommon",
};
