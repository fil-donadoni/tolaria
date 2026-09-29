// LEB (Limited Edition Beta), split by colour per ADR 0043. Like every set,
// these are a mix of:
//   • CardPrint entries — reprints of cards whose mechanics already live on a
//     LEA CardDefinition. A print only declares the per-edition Scryfall UUID
//     (printId) used for image lookup; the registry resolves printId →
//     definitionId → the shared LEA CardDefinition.
//   • CardDefinition entries — cards first implemented in this set (the two
//     Beta-original cards: Volcanic Island, Circle of Protection: Black, which
//     never existed in Alpha). See ADR 0014.
//
// Cards declared permanently out of scope (ADR 0010) and cards blocked on an
// open issue stay commented with a back-reference, so "LEB complete" reads as
// "complete minus the named exclusions". A commented stub whose definitionId
// points at a not-yet-implemented LEA stub is uncommented once that LEA def
// lands.

import type { CardPrint } from "../../types";

export const airElementalLeb: CardPrint = {
    printId: "36a94a6d-26b1-4486-9444-ec366e6f4d6e",
    definitionId: "69c3b2a3-0daa-4d42-832d-fcdfda6555ea", // airElemental
    setCode: "leb",
    rarity: "uncommon",
};

export const ancestralRecallLeb: CardPrint = {
    printId: "46b0a5c2-ac85-448e-9e87-12fc74fd4147",
    definitionId: "70e7ddf2-5604-41e7-bb9d-ddd03d3e9d0b", // ancestralRecall
    setCode: "leb",
    rarity: "rare",
};

export const animateArtifactLeb: CardPrint = {
    printId: "cb575b27-d2ca-4d90-a650-dc670484f607",
    definitionId: "664b46f5-0424-4f4e-9f26-6bd2cf5e0357", // animateArtifact (stub)
    setCode: "leb",
    rarity: "uncommon",
};

export const blueElementalBlastLeb: CardPrint = {
    printId: "7f07e272-6cc7-46d6-ad5c-473d1021c179",
    definitionId: "20d666ef-39bf-4fbf-8201-5f1056539da2", // blueElementalBlast (stub)
    setCode: "leb",
    rarity: "common",
};

export const braingeyserLeb: CardPrint = {
    printId: "a5dd8dbb-9538-4786-b20c-0ea2f446f323",
    definitionId: "62b19a12-6914-430e-81ce-dcfca47884df", // braingeyser
    setCode: "leb",
    rarity: "rare",
};

// Out of scope — see ADR 0010 (hidden-assignment pile combat with randomness).
// export const camouflageLeb: CardPrint = {
//     printId: "2f55ff95-32a3-43ba-82e5-a5a3bc2cc9e5",
//     definitionId: "3838c2a3-7fab-4976-9c1b-2891aee24e52", // camouflage (stub)
//     setCode: "leb",
// };

export const cloneLeb: CardPrint = {
    printId: "af53b5fc-c31a-4f26-93bf-0c45c1f4e1e5",
    definitionId: "f00d33dd-4eb2-4446-9813-1923d8e2d2f3", // clone (stub)
    setCode: "leb",
    rarity: "uncommon",
};

export const controlMagicLeb: CardPrint = {
    printId: "133315bd-3c46-4eff-938e-4dba63631c1b",
    definitionId: "7b52f459-c703-4a0b-9114-ff69eec61287", // controlMagic
    setCode: "leb",
    rarity: "uncommon",
};

export const copyArtifactLeb: CardPrint = {
    printId: "e24fe07d-1328-4165-b7a0-622b60cec481",
    definitionId: "fd5ed955-1193-4e6a-a3e2-f54c1f9bf063", // copyArtifact (stub)
    setCode: "leb",
    rarity: "rare",
};

export const counterspellLeb: CardPrint = {
    printId: "9e11bf7c-f439-4529-b29a-d711359807ef",
    definitionId: "0df55e3f-14de-46ef-b6b1-616618724d9e", // counterspell
    setCode: "leb",
    rarity: "uncommon",
};

export const creatureBondLeb: CardPrint = {
    printId: "4ce48b24-a65e-42d9-a147-8f89028fada7",
    definitionId: "ee4bd7d1-77e5-46e5-a594-c24469e88c4c", // creatureBond (stub)
    setCode: "leb",
    rarity: "common",
};

export const drainPowerLeb: CardPrint = {
    printId: "9672caeb-5cf8-4b40-a371-005c911a67d9",
    definitionId: "ea3830c5-cc66-453e-9e53-0636e00ee0ee",
    setCode: "leb",
    rarity: "rare",
};

export const feedbackLeb: CardPrint = {
    printId: "644288e8-e0b1-418f-b105-01a557a3e497",
    definitionId: "0eb8f591-d763-49bf-8ef9-86265aaa72f7", // feedback
    setCode: "leb",
    rarity: "uncommon",
};

export const flightLeb: CardPrint = {
    printId: "24584ffa-8ed1-4930-b6d8-ac1d02738ed0",
    definitionId: "67c7784b-6b79-4268-a714-895c82809aff", // flight
    setCode: "leb",
    rarity: "common",
};

export const invisibilityLeb: CardPrint = {
    printId: "dde97b8f-7c10-48d3-8ae2-9f86158973ec",
    definitionId: "1858ac51-e6a7-48d7-8759-166070ca13d8", // invisibility (stub)
    setCode: "leb",
    rarity: "common",
};

export const jumpLeb: CardPrint = {
    printId: "e51e8a6e-1da8-4e6f-8433-9f0695926f04",
    definitionId: "cb3f4b11-ad1b-48e2-a500-787d351b0174", // jump
    setCode: "leb",
    rarity: "common",
};

export const lifetapLeb: CardPrint = {
    printId: "74e7775b-b03b-4fc0-bcd9-3681cce5e70c",
    definitionId: "11add837-7ee4-4104-b031-c161bce459ae", // lifetap (stub)
    setCode: "leb",
    rarity: "uncommon",
};

export const lordOfAtlantisLeb: CardPrint = {
    printId: "27d7ac1f-2243-4c70-95a4-2b7343c8d92d",
    definitionId: "210c4a90-fc7a-4c76-aeaa-20a005e45386", // lordOfAtlantis (stub)
    setCode: "leb",
    rarity: "rare",
};

export const magicalHackLeb: CardPrint = {
    printId: "0aa81390-4e0b-484b-a5be-a9449cd41860",
    definitionId: "2bd4202c-0477-45aa-82fd-83c85d6d4bef", // magicalHack (stub)
    setCode: "leb",
    rarity: "rare",
};

export const mahamotiDjinnLeb: CardPrint = {
    printId: "083f76c8-3e6d-4de5-b408-2f2394faed5c",
    definitionId: "36204ddd-ddf7-4b44-ae3c-b4a5a41ac9cb", // mahamotiDjinn
    setCode: "leb",
    rarity: "rare",
};

export const manaShortLeb: CardPrint = {
    printId: "4da4f9a8-024b-4707-b300-ccb11bd87cea",
    definitionId: "73e3e0b3-5284-464f-8c62-0f7801c966f5",
    setCode: "leb",
    rarity: "rare",
};

export const merfolkOfThePearlTridentLeb: CardPrint = {
    printId: "cca142de-906d-4143-8f77-4acea1f1e6b1",
    definitionId: "2b871039-6a66-4ac3-95e7-24759c1f2f92", // merfolkOfThePearlTrident
    setCode: "leb",
    rarity: "common",
};

export const phantasmalForcesLeb: CardPrint = {
    printId: "b0c6d792-0abb-474e-8c05-c4e843242ef0",
    definitionId: "0631c7c8-9aa5-4333-8e20-20247fc47033", // phantasmalForces (stub)
    setCode: "leb",
    rarity: "uncommon",
};

export const phantasmalTerrainLeb: CardPrint = {
    printId: "9c29369c-d909-45a7-be70-3181ddac9728",
    definitionId: "1c371aa1-1619-41e3-8364-7bc9b8cf5d14", // phantasmalTerrain (stub)
    setCode: "leb",
    rarity: "common",
};

export const phantomMonsterLeb: CardPrint = {
    printId: "b0782e90-383b-4aed-8fa0-99c8cf8b2cec",
    definitionId: "e46d2cf5-e8d0-4fb2-b950-252d52084b63", // phantomMonster
    setCode: "leb",
    rarity: "uncommon",
};

export const pirateShipLeb: CardPrint = {
    printId: "925ce0a7-ae09-4220-9e67-314dbc231c94",
    definitionId: "d0a7cb23-d229-43c5-addd-dcf423984b0c", // pirateShip
    setCode: "leb",
    rarity: "rare",
};

export const powerLeakLeb: CardPrint = {
    printId: "86fdfb7b-1bcf-485a-be70-0130fc1fceef",
    definitionId: "ccc982b6-35b2-4e33-ace2-86cb79123e4f", // powerLeak (stub)
    setCode: "leb",
    rarity: "common",
};

export const powerSinkLeb: CardPrint = {
    printId: "954b04e3-861a-45c9-8897-9cb4a99f04c3",
    definitionId: "1b342dd3-09b9-4108-bf12-a65d4cef4eb9", // powerSink (stub)
    setCode: "leb",
    rarity: "common",
};

export const prodigalSorcererLeb: CardPrint = {
    printId: "c420abf2-05ec-4623-8a6c-353736a4edeb",
    definitionId: "e4dc1103-7bf1-47f6-9006-d3ed9ccd7a6a", // prodigalSorcerer
    setCode: "leb",
    rarity: "common",
};

export const psionicBlastLeb: CardPrint = {
    printId: "73b6b789-00c5-4d72-8fb3-6808bfbf0144",
    definitionId: "a6a86e6e-bfff-46af-9d36-c912901fea92", // psionicBlast
    setCode: "leb",
    rarity: "uncommon",
};

export const psychicVenomLeb: CardPrint = {
    printId: "e5c8a81f-bf05-4504-ac87-4fd4b41e88c1",
    definitionId: "f3f5b68a-6b0e-431e-89f0-ff60f17687a5", // psychicVenom (stub)
    setCode: "leb",
    rarity: "common",
};

export const seaSerpentLeb: CardPrint = {
    printId: "11b21f91-51fd-407d-bab2-63c11f23b680",
    definitionId: "d0b333b7-db4d-4439-b0de-60414cbf8d7b", // seaSerpent
    setCode: "leb",
    rarity: "common",
};

export const sirensCallLeb: CardPrint = {
    printId: "00ce03f3-ddc0-4cf3-8f07-551c960e8639",
    definitionId: "d992b336-3b6e-43e1-8662-d85664349b44", // sirensCall (stub)
    setCode: "leb",
    rarity: "uncommon",
};

export const sleightOfMindLeb: CardPrint = {
    printId: "fb4da609-6c08-4a18-b7d9-fb2f9b11bab2",
    definitionId: "d427790c-e322-446e-8d7d-a6b48ad41a42", // sleightOfMind
    setCode: "leb",
    rarity: "rare",
};

export const spellBlastLeb: CardPrint = {
    printId: "3f599b73-1d55-4acc-8931-f5ab39d1d4e9",
    definitionId: "845734da-ab03-4dbc-bb5f-96481d3b8e88", // spellBlast (stub)
    setCode: "leb",
    rarity: "common",
};

export const stasisLeb: CardPrint = {
    printId: "73c76f5d-d866-4eb7-b2d2-fc6ecf982f8e",
    definitionId: "b6cef408-5b4b-49f6-9531-be544815b93f", // stasis (stub)
    setCode: "leb",
    rarity: "rare",
};

export const stealArtifactLeb: CardPrint = {
    printId: "92c14d4d-abaa-411a-aaa1-0b79fccee8c1",
    definitionId: "83316930-d6ad-46ce-9b40-48eea856d95b", // stealArtifact
    setCode: "leb",
    rarity: "uncommon",
};

export const thoughtlaceLeb: CardPrint = {
    printId: "fc2b2b9e-5abf-4c41-a85c-ef95e6ab84d6",
    definitionId: "23749375-1416-47a4-9251-52f41fe2fae9", // thoughtlace (stub)
    setCode: "leb",
    rarity: "rare",
};

export const timeWalkLeb: CardPrint = {
    printId: "54992fda-45a9-4ed1-b380-34d167feec90",
    definitionId: "e0139f60-d48e-46fb-9f5a-1e3d7558c834", // timeWalk
    setCode: "leb",
    rarity: "rare",
};

export const timetwisterLeb: CardPrint = {
    printId: "09f1958a-50cc-43cc-80e1-988800e44ca8",
    definitionId: "9a49dc44-616e-4bdd-8220-0bb71eccc512", // timetwister
    setCode: "leb",
    rarity: "rare",
};

export const twiddleLeb: CardPrint = {
    printId: "34bd24da-f156-494e-86cb-80707863e40b",
    definitionId: "576e811f-26a3-4a7c-bd13-3b1cc3e184eb", // twiddle
    setCode: "leb",
    rarity: "common",
};

export const unsummonLeb: CardPrint = {
    printId: "686843c8-8c8a-4af6-bca8-e7f7583cc886",
    definitionId: "8512f2c1-6361-4b79-843f-80b6bceeeb99", // unsummon
    setCode: "leb",
    rarity: "common",
};

export const vesuvanDoppelgangerLeb: CardPrint = {
    printId: "d18e952b-ab4d-4f90-bf5e-4db490e4e203",
    definitionId: "768f3a05-bd06-4a23-b9f2-94f6e618fd9f", // vesuvanDoppelganger (stub)
    setCode: "leb",
    rarity: "rare",
};

export const volcanicEruptionLeb: CardPrint = {
    printId: "ca669988-e009-4b3e-af20-ee5885554d34",
    definitionId: "a80582b1-09db-45f8-b362-0e5207a5a8e6", // volcanicEruption
    setCode: "leb",
    rarity: "rare",
};

export const wallOfAirLeb: CardPrint = {
    printId: "71904b59-55dd-4074-9d50-c5bb0fb7266f",
    definitionId: "da56fdf3-6a8f-4833-a5c3-197650cc4889", // wallOfAir
    setCode: "leb",
    rarity: "uncommon",
};

export const wallOfWaterLeb: CardPrint = {
    printId: "34887689-0adb-4ead-87a5-1d8fd77b6278",
    definitionId: "41faed1a-ded8-49ee-8e2a-c60d377775d7", // wallOfWater (stub)
    setCode: "leb",
    rarity: "uncommon",
};

export const waterElementalLeb: CardPrint = {
    printId: "66f729e2-565b-4cdb-8b6f-0a14babe5680",
    definitionId: "8de940d6-98c0-46a9-b5fd-e2b0899ea19e", // waterElemental
    setCode: "leb",
    rarity: "uncommon",
};
