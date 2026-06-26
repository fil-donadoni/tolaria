// 3ED (Revised Edition) blue cards, split by colour per ADR 0043.
//
// Revised is a 100% reprint set — it introduces no new cards — so this module
// is entirely CardPrint entries: each declares the per-edition Scryfall UUID
// (printId) and resolves printId -> definitionId -> a shared CardDefinition
// already implemented in lea/leb/arn/atq/leg/drk/fem/ice. See ADR 0014.
//
// Generated from data/json/3ED.json; see the 3ed barrel (index.ts) and
// scripts/generate-3ed-prints.mts. Cards are partitioned by colour identity
// derived from mana cost (CR 202.2): lands and artifacts (no coloured cost)
// live in colorless.ts; multicolour cards in multicolor.ts.
//
// Excluded: the 3 ante cards — Contract from Below, Darkpact, Demonic Attorney
// — are permanently out of scope (ADR 0010) and carry no print row.

import type { CardPrint } from "../../types";

export const airElemental3ed: CardPrint = {
    printId: "22905294-4ba6-4567-a21f-f53b8317acda",
    definitionId: "69c3b2a3-0daa-4d42-832d-fcdfda6555ea", // Air Elemental
    setCode: "3ed",
    rarity: "uncommon",
};

export const animateArtifact3ed: CardPrint = {
    printId: "9704b5e2-43e8-4a80-a34b-dfcaad9ec0f9",
    definitionId: "664b46f5-0424-4f4e-9f26-6bd2cf5e0357", // Animate Artifact
    setCode: "3ed",
    rarity: "uncommon",
};

export const blueElementalBlast3ed: CardPrint = {
    printId: "0892ec35-8bab-4fe5-8cc9-a25032d4bc8d",
    definitionId: "20d666ef-39bf-4fbf-8201-5f1056539da2", // Blue Elemental Blast
    setCode: "3ed",
    rarity: "common",
};

export const braingeyser3ed: CardPrint = {
    printId: "f77f61a8-0b20-4f2e-8a24-844dc95c3a9e",
    definitionId: "62b19a12-6914-430e-81ce-dcfca47884df", // Braingeyser
    setCode: "3ed",
    rarity: "rare",
};

export const clone3ed: CardPrint = {
    printId: "b59fde1a-8d41-4f09-a4a1-4a15aaa704c7",
    definitionId: "f00d33dd-4eb2-4446-9813-1923d8e2d2f3", // Clone
    setCode: "3ed",
    rarity: "uncommon",
};

export const controlMagic3ed: CardPrint = {
    printId: "d8ab7fb5-9903-4723-a4a0-d142ef3aae8e",
    definitionId: "7b52f459-c703-4a0b-9114-ff69eec61287", // Control Magic
    setCode: "3ed",
    rarity: "uncommon",
};

export const copyArtifact3ed: CardPrint = {
    printId: "0d42f473-3e3f-4441-b7ee-6819a3a8f52e",
    definitionId: "fd5ed955-1193-4e6a-a3e2-f54c1f9bf063", // Copy Artifact
    setCode: "3ed",
    rarity: "rare",
};

export const counterspell3ed: CardPrint = {
    printId: "0a1b4e2e-5459-4fae-81d9-1e882647daac",
    definitionId: "0df55e3f-14de-46ef-b6b1-616618724d9e", // Counterspell
    setCode: "3ed",
    rarity: "uncommon",
};

export const creatureBond3ed: CardPrint = {
    printId: "131b80ad-1ffe-449d-a595-74c65f6605cd",
    definitionId: "ee4bd7d1-77e5-46e5-a594-c24469e88c4c", // Creature Bond
    setCode: "3ed",
    rarity: "common",
};

export const drainPower3ed: CardPrint = {
    printId: "4a8ffad1-9cb0-4ba6-8ae9-00c3b74b9b3f",
    definitionId: "ea3830c5-cc66-453e-9e53-0636e00ee0ee", // Drain Power
    setCode: "3ed",
    rarity: "rare",
};

export const energyFlux3ed: CardPrint = {
    printId: "9c4e6d03-68d5-4275-a76c-078d0a9a2b54",
    definitionId: "bd1f624b-e8f2-462f-838a-7cb9e8fda988", // Energy Flux
    setCode: "3ed",
    rarity: "uncommon",
};

export const feedback3ed: CardPrint = {
    printId: "dea6644f-cd2d-4d2b-b66e-b6f8285d2fe8",
    definitionId: "0eb8f591-d763-49bf-8ef9-86265aaa72f7", // Feedback
    setCode: "3ed",
    rarity: "uncommon",
};

export const flight3ed: CardPrint = {
    printId: "133aaa10-610b-41be-9327-591f517a4baa",
    definitionId: "67c7784b-6b79-4268-a714-895c82809aff", // Flight
    setCode: "3ed",
    rarity: "common",
};

export const hurkylSRecall3ed: CardPrint = {
    printId: "b871e9a7-ba3a-4891-adc6-68a11a4e4aa6",
    definitionId: "f32373dd-06d8-45d1-8777-3b1411bcb30a", // Hurkyl's Recall
    setCode: "3ed",
    rarity: "rare",
};

export const islandFishJasconius3ed: CardPrint = {
    printId: "11db42ba-f756-439c-bdd3-26e9cd4870a4",
    definitionId: "8537cb0f-4821-417b-80cc-ea57d51ee9b8", // Island Fish Jasconius
    setCode: "3ed",
    rarity: "rare",
};

export const jump3ed: CardPrint = {
    printId: "839b7b38-cb95-4406-af50-4d97884e2489",
    definitionId: "cb3f4b11-ad1b-48e2-a500-787d351b0174", // Jump
    setCode: "3ed",
    rarity: "common",
};

export const lifetap3ed: CardPrint = {
    printId: "f0049925-d95d-40ed-ba02-7f7fbe4cf6b5",
    definitionId: "11add837-7ee4-4104-b031-c161bce459ae", // Lifetap
    setCode: "3ed",
    rarity: "uncommon",
};

export const lordOfAtlantis3ed: CardPrint = {
    printId: "45066539-6bc2-467f-acfb-00938ba837ef",
    definitionId: "210c4a90-fc7a-4c76-aeaa-20a005e45386", // Lord of Atlantis
    setCode: "3ed",
    rarity: "rare",
};

export const magicalHack3ed: CardPrint = {
    printId: "61fb9f2d-be6b-4073-91d8-68ca58046da9",
    definitionId: "2bd4202c-0477-45aa-82fd-83c85d6d4bef", // Magical Hack
    setCode: "3ed",
    rarity: "rare",
};

export const mahamotiDjinn3ed: CardPrint = {
    printId: "4765276e-ad80-4734-b485-36eebf1b6ae1",
    definitionId: "36204ddd-ddf7-4b44-ae3c-b4a5a41ac9cb", // Mahamoti Djinn
    setCode: "3ed",
    rarity: "rare",
};

export const manaShort3ed: CardPrint = {
    printId: "0fec5898-f288-4fb6-a2d3-2ea6d20594bf",
    definitionId: "73e3e0b3-5284-464f-8c62-0f7801c966f5", // Mana Short
    setCode: "3ed",
    rarity: "rare",
};

export const merfolkOfThePearlTrident3ed: CardPrint = {
    printId: "2fad0078-f3cb-48a4-9ed4-b658e983314f",
    definitionId: "2b871039-6a66-4ac3-95e7-24759c1f2f92", // Merfolk of the Pearl Trident
    setCode: "3ed",
    rarity: "common",
};

export const phantasmalForces3ed: CardPrint = {
    printId: "7954f128-7f3d-4c5e-adea-6ff452186ba4",
    definitionId: "0631c7c8-9aa5-4333-8e20-20247fc47033", // Phantasmal Forces
    setCode: "3ed",
    rarity: "uncommon",
};

export const phantasmalTerrain3ed: CardPrint = {
    printId: "b8c578c4-a67f-45ac-aa13-7fba2a5f5f3f",
    definitionId: "1c371aa1-1619-41e3-8364-7bc9b8cf5d14", // Phantasmal Terrain
    setCode: "3ed",
    rarity: "common",
};

export const phantomMonster3ed: CardPrint = {
    printId: "75cb719c-7b7a-449b-bb1e-372a0e20c7f0",
    definitionId: "e46d2cf5-e8d0-4fb2-b950-252d52084b63", // Phantom Monster
    setCode: "3ed",
    rarity: "uncommon",
};

export const pirateShip3ed: CardPrint = {
    printId: "06e11710-fc99-4d86-9ca5-9d8c7ab03b24",
    definitionId: "d0a7cb23-d229-43c5-addd-dcf423984b0c", // Pirate Ship
    setCode: "3ed",
    rarity: "rare",
};

export const powerLeak3ed: CardPrint = {
    printId: "f6623e8b-4f4c-49c8-ad48-257b8695c4fe",
    definitionId: "ccc982b6-35b2-4e33-ace2-86cb79123e4f", // Power Leak
    setCode: "3ed",
    rarity: "common",
};

export const powerSink3ed: CardPrint = {
    printId: "1134aa48-b288-44ab-9d3a-efee12cb98a4",
    definitionId: "1b342dd3-09b9-4108-bf12-a65d4cef4eb9", // Power Sink
    setCode: "3ed",
    rarity: "common",
};

export const prodigalSorcerer3ed: CardPrint = {
    printId: "20f1411b-a5ad-4d49-915b-ad8a21d51342",
    definitionId: "e4dc1103-7bf1-47f6-9006-d3ed9ccd7a6a", // Prodigal Sorcerer
    setCode: "3ed",
    rarity: "common",
};

export const psychicVenom3ed: CardPrint = {
    printId: "47560f18-84fb-4d34-83cf-70e0ed8bf7ff",
    definitionId: "f3f5b68a-6b0e-431e-89f0-ff60f17687a5", // Psychic Venom
    setCode: "3ed",
    rarity: "common",
};

export const reconstruction3ed: CardPrint = {
    printId: "b4ba9d8c-686d-4f93-8001-fca27899651e",
    definitionId: "1aa2d27b-cc25-4baa-86f4-4db45b30e2a4", // Reconstruction
    setCode: "3ed",
    rarity: "common",
};

export const seaSerpent3ed: CardPrint = {
    printId: "4a05cbae-a0a1-452b-a9d1-a29478e705cd",
    definitionId: "d0b333b7-db4d-4439-b0de-60414cbf8d7b", // Sea Serpent
    setCode: "3ed",
    rarity: "common",
};

export const serendibEfreet3ed: CardPrint = {
    printId: "35415199-0f1d-4398-a48f-f78697a51105",
    definitionId: "cf56e862-3169-4f63-acd0-731080fa32f2", // Serendib Efreet
    setCode: "3ed",
    rarity: "rare",
};

export const sirenSCall3ed: CardPrint = {
    printId: "e84406bc-6db7-4672-be8c-307985213cd6",
    definitionId: "d992b336-3b6e-43e1-8662-d85664349b44", // Siren's Call
    setCode: "3ed",
    rarity: "uncommon",
};

export const sleightOfMind3ed: CardPrint = {
    printId: "563194a8-e7b2-4edb-ba02-f84cfd206771",
    definitionId: "d427790c-e322-446e-8d7d-a6b48ad41a42", // Sleight of Mind
    setCode: "3ed",
    rarity: "rare",
};

export const spellBlast3ed: CardPrint = {
    printId: "20fc852a-77b0-48a6-8343-6cf890da9adb",
    definitionId: "845734da-ab03-4dbc-bb5f-96481d3b8e88", // Spell Blast
    setCode: "3ed",
    rarity: "common",
};

export const stasis3ed: CardPrint = {
    printId: "fe4bf26c-cd9c-40e3-8a73-2f17f9a1d0e4",
    definitionId: "b6cef408-5b4b-49f6-9531-be544815b93f", // Stasis
    setCode: "3ed",
    rarity: "rare",
};

export const stealArtifact3ed: CardPrint = {
    printId: "df32e7de-dd96-454e-a229-31912d9600e7",
    definitionId: "83316930-d6ad-46ce-9b40-48eea856d95b", // Steal Artifact
    setCode: "3ed",
    rarity: "uncommon",
};

export const thoughtlace3ed: CardPrint = {
    printId: "851a8475-30d1-466f-b0be-6f1a0f2772b5",
    definitionId: "23749375-1416-47a4-9251-52f41fe2fae9", // Thoughtlace
    setCode: "3ed",
    rarity: "rare",
};

export const unstableMutation3ed: CardPrint = {
    printId: "fc24e53b-5074-4791-9277-46e14a70db3a",
    definitionId: "a79e9236-a39e-471a-b18a-2c2ba16e7774", // Unstable Mutation
    setCode: "3ed",
    rarity: "common",
};

export const unsummon3ed: CardPrint = {
    printId: "e7bf32d8-dad7-4192-8cb6-ae75d8204ba3",
    definitionId: "8512f2c1-6361-4b79-843f-80b6bceeeb99", // Unsummon
    setCode: "3ed",
    rarity: "common",
};

export const vesuvanDoppelganger3ed: CardPrint = {
    printId: "6d528ffd-89b3-44ee-a370-e4b53d6604be",
    definitionId: "768f3a05-bd06-4a23-b9f2-94f6e618fd9f", // Vesuvan Doppelganger
    setCode: "3ed",
    rarity: "rare",
};

export const volcanicEruption3ed: CardPrint = {
    printId: "6663f9e2-f752-42cf-97a0-01a14ca0aa1b",
    definitionId: "a80582b1-09db-45f8-b362-0e5207a5a8e6", // Volcanic Eruption
    setCode: "3ed",
    rarity: "rare",
};

export const wallOfAir3ed: CardPrint = {
    printId: "beb3874f-b3dc-41ca-becc-4dcbb0549b33",
    definitionId: "da56fdf3-6a8f-4833-a5c3-197650cc4889", // Wall of Air
    setCode: "3ed",
    rarity: "uncommon",
};

export const wallOfWater3ed: CardPrint = {
    printId: "14363981-7c27-49d4-91d6-e2a51b679784",
    definitionId: "41faed1a-ded8-49ee-8e2a-c60d377775d7", // Wall of Water
    setCode: "3ed",
    rarity: "uncommon",
};

export const waterElemental3ed: CardPrint = {
    printId: "55368e1d-2573-4779-ad7c-027071380447",
    definitionId: "8de940d6-98c0-46a9-b5fd-e2b0899ea19e", // Water Elemental
    setCode: "3ed",
    rarity: "uncommon",
};
