// 3ED (Revised Edition) black cards, split by colour per ADR 0043.
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

export const animateDead3ed: CardPrint = {
    printId: "eed73f84-ad08-44f8-a4fe-cd324ec1da92",
    definitionId: "8fd7861d-925f-4b4c-a4ab-60be6f43d50b", // Animate Dead
    setCode: "3ed",
    rarity: "uncommon",
};

export const badMoon3ed: CardPrint = {
    printId: "9cb767eb-2161-4068-be80-c3cf68945393",
    definitionId: "43572906-ea74-4411-a549-5dc401591d2a", // Bad Moon
    setCode: "3ed",
    rarity: "rare",
};

export const blackKnight3ed: CardPrint = {
    printId: "eaa55b3c-acf4-4d2a-9f32-c7fce6672f3d",
    definitionId: "c1662949-0d69-49a3-8c69-daf10717ed4e", // Black Knight
    setCode: "3ed",
    rarity: "uncommon",
};

export const bogWraith3ed: CardPrint = {
    printId: "1173349b-beb9-44c8-aeb2-534ecf54fea0",
    definitionId: "6701874e-986e-4b81-9268-90b6171e6187", // Bog Wraith
    setCode: "3ed",
    rarity: "uncommon",
};

export const cursedLand3ed: CardPrint = {
    printId: "9640785c-be0d-4502-9995-f93ac00f1b2f",
    definitionId: "cf5f3c61-1e54-4eea-bf82-311cfa988e6a", // Cursed Land
    setCode: "3ed",
    rarity: "uncommon",
};

export const darkRitual3ed: CardPrint = {
    printId: "48cb9467-657e-453f-afc8-1bf7121570ad",
    definitionId: "ebb6664d-23ca-456e-9916-afcd6f26aa7f", // Dark Ritual
    setCode: "3ed",
    rarity: "common",
};

export const deathgrip3ed: CardPrint = {
    printId: "e42c32a2-9bbb-4701-85af-eb9686edce73",
    definitionId: "2371c126-f19a-472a-ba5f-3b1366274ea0", // Deathgrip
    setCode: "3ed",
    rarity: "uncommon",
};

export const deathlace3ed: CardPrint = {
    printId: "e4265106-78a8-4a10-a2fb-6440a8a7f5ce",
    definitionId: "6ff1cefc-62cb-4525-b0c5-2b09603b4314", // Deathlace
    setCode: "3ed",
    rarity: "rare",
};

export const demonicHordes3ed: CardPrint = {
    printId: "b4cfeebf-d893-4fdf-b3fc-f1f9528f4d04",
    definitionId: "6c9bb8b1-fb79-4b99-ba09-c6e6c860de50", // Demonic Hordes
    setCode: "3ed",
    rarity: "rare",
};

export const demonicTutor3ed: CardPrint = {
    printId: "881e5922-b464-4a1a-b074-664bd6c0a7f6",
    definitionId: "711d4d54-5520-4de8-9b93-79902ed8e562", // Demonic Tutor
    setCode: "3ed",
    rarity: "uncommon",
};

export const drainLife3ed: CardPrint = {
    printId: "d89c1d2f-87a1-4463-af21-b837da3e7d74",
    definitionId: "5d077a49-73d4-4958-b42a-31b814e110e8", // Drain Life
    setCode: "3ed",
    rarity: "common",
};

export const drudgeSkeletons3ed: CardPrint = {
    printId: "59145073-2cfd-4153-a6d8-47ad42e739c3",
    definitionId: "23614289-0d73-4747-a849-5cb67cc97d6a", // Drudge Skeletons
    setCode: "3ed",
    rarity: "common",
};

export const elHajjâj3ed: CardPrint = {
    printId: "c3591170-645f-4645-bc39-b90b7b6ddac7",
    definitionId: "c4b610d3-2005-4347-bcda-c30b5b7972e5", // El-Hajjâj
    setCode: "3ed",
    rarity: "rare",
};

export const ergRaiders3ed: CardPrint = {
    printId: "02104733-fb20-43bb-8370-1993528abbdf",
    definitionId: "35c73a97-531d-4dd5-8236-39b89c183c38", // Erg Raiders
    setCode: "3ed",
    rarity: "common",
};

export const evilPresence3ed: CardPrint = {
    printId: "d84730b2-53e4-45eb-9ac7-4557a59be5d4",
    definitionId: "0551d66e-8cd4-48f0-aa17-15f26be9d85f", // Evil Presence
    setCode: "3ed",
    rarity: "uncommon",
};

export const fear3ed: CardPrint = {
    printId: "6c6b2afc-d4f5-47fb-abda-fc3de8bdacaa",
    definitionId: "0cd927be-e63f-4371-a1d8-7a0489cb187e", // Fear
    setCode: "3ed",
    rarity: "common",
};

export const frozenShade3ed: CardPrint = {
    printId: "6cba931e-94b5-4fcc-8d5f-eb60664baf31",
    definitionId: "d0bd76c8-4cff-4c15-9686-7a299b589814", // Frozen Shade
    setCode: "3ed",
    rarity: "common",
};

export const gloom3ed: CardPrint = {
    printId: "fb2ce26e-8c53-4687-a80c-ba6a1c76299a",
    definitionId: "a8d10bc7-daeb-4c0d-9e4a-8eae8d11699f", // Gloom
    setCode: "3ed",
    rarity: "uncommon",
};

export const howlFromBeyond3ed: CardPrint = {
    printId: "d954e8a7-6b22-4f53-9435-ff1f7782a3d4",
    definitionId: "67ec17e1-174b-4d07-a27f-91a333c4b2fb", // Howl from Beyond
    setCode: "3ed",
    rarity: "common",
};

export const hypnoticSpecter3ed: CardPrint = {
    printId: "2c8bd2bc-f48d-43c4-b2aa-5a0905656e90",
    definitionId: "b43b900f-2d9b-442b-9699-058483604ec9", // Hypnotic Specter
    setCode: "3ed",
    rarity: "uncommon",
};

export const lordOfThePit3ed: CardPrint = {
    printId: "5b61cb02-7eb7-4d85-8ced-7978cb1a81d2",
    definitionId: "2926777a-4f6e-4965-ba83-22cf7df02602", // Lord of the Pit
    setCode: "3ed",
    rarity: "rare",
};

export const mindTwist3ed: CardPrint = {
    printId: "3230ac66-cb75-43cc-b652-b28e2962d163",
    definitionId: "eee9e106-a248-49d2-b8c8-6bbcd56ce739", // Mind Twist
    setCode: "3ed",
    rarity: "rare",
};

export const netherShadow3ed: CardPrint = {
    printId: "cd07c415-4f39-4011-b94a-4aab56dca7d7",
    definitionId: "f13ad58a-6f9b-420a-bac1-40929f5e616a", // Nether Shadow
    setCode: "3ed",
    rarity: "rare",
};

export const nettlingImp3ed: CardPrint = {
    printId: "94c40a45-6439-4405-8562-11a9000a1061",
    definitionId: "8105973c-a94d-444c-ba20-ab0fa978bee8", // Nettling Imp
    setCode: "3ed",
    rarity: "uncommon",
};

export const nightmare3ed: CardPrint = {
    printId: "659c0edb-3afa-4f87-8a94-9fe10578ea1a",
    definitionId: "b8cdd6a7-f772-4ccb-914f-63f52ed54d6b", // Nightmare
    setCode: "3ed",
    rarity: "rare",
};

export const paralyze3ed: CardPrint = {
    printId: "dbe8939d-c2f0-4dbc-b7dd-0483208f6876",
    definitionId: "be33a155-de26-43d1-88f1-c926f1b7cb7c", // Paralyze
    setCode: "3ed",
    rarity: "common",
};

export const pestilence3ed: CardPrint = {
    printId: "b6647e7d-b0ad-4170-8dce-ea4c89897c6a",
    definitionId: "d42a6350-b16b-4e10-a273-e6cbb55dcb7a", // Pestilence
    setCode: "3ed",
    rarity: "common",
};

export const plagueRats3ed: CardPrint = {
    printId: "47e21390-c661-4717-bbb9-71eb63c6f01e",
    definitionId: "b3724e40-0622-4aee-9334-6c9fff88bcd5", // Plague Rats
    setCode: "3ed",
    rarity: "common",
};

export const raiseDead3ed: CardPrint = {
    printId: "6f3c2902-e2c5-4618-9d4e-3fca34b610c8",
    definitionId: "ce07bede-2219-427c-a61a-56518751de42", // Raise Dead
    setCode: "3ed",
    rarity: "common",
};

export const royalAssassin3ed: CardPrint = {
    printId: "4945ec9e-eda7-42ad-88b7-ba14f9d95e54",
    definitionId: "59590768-fa96-4869-8763-9d5ab6ac22ad", // Royal Assassin
    setCode: "3ed",
    rarity: "rare",
};

export const sacrifice3ed: CardPrint = {
    printId: "76bc3b43-158c-420e-a3fb-7413334699ca",
    definitionId: "12164aee-6a27-4246-8d15-2d6dd20d92e9", // Sacrifice
    setCode: "3ed",
    rarity: "uncommon",
};

export const scatheZombies3ed: CardPrint = {
    printId: "6cbe576f-03d5-4d22-947a-187d9e20425d",
    definitionId: "e9be6dcf-5e25-4b8c-9cd0-badf3771f81e", // Scathe Zombies
    setCode: "3ed",
    rarity: "common",
};

export const scavengingGhoul3ed: CardPrint = {
    printId: "33a5daf6-ce4f-4d00-8458-b7d1a9e037bc",
    definitionId: "426984e0-88e1-4a2d-9a1c-798b95864df3", // Scavenging Ghoul
    setCode: "3ed",
    rarity: "uncommon",
};

export const sengirVampire3ed: CardPrint = {
    printId: "fa35113b-5242-41f4-a989-42f2cd8002b6",
    definitionId: "510840f4-7c0e-4b47-8ebf-23c20cac4bd9", // Sengir Vampire
    setCode: "3ed",
    rarity: "uncommon",
};

export const simulacrum3ed: CardPrint = {
    printId: "bc1b6d40-fdb0-40c3-983d-67a7bfb96cea",
    definitionId: "35c3a78d-cc79-4187-929a-8aa1d1469990", // Simulacrum
    setCode: "3ed",
    rarity: "uncommon",
};

export const sorceressQueen3ed: CardPrint = {
    printId: "b83d7331-e573-4dea-901a-de9150d4b5c0",
    definitionId: "94742003-f0f1-4483-b1a0-e7163995db1b", // Sorceress Queen
    setCode: "3ed",
    rarity: "rare",
};

export const terror3ed: CardPrint = {
    printId: "0eaf0ac8-f5a7-4689-8d3e-dd865763df44",
    definitionId: "21004958-2c7e-4a55-bc80-411c4d780106", // Terror
    setCode: "3ed",
    rarity: "common",
};

export const unholyStrength3ed: CardPrint = {
    printId: "3ac35077-91e9-446c-9cb2-e2cfb9fa2962",
    definitionId: "90563f90-0127-4164-b43b-f0321dc63a1d", // Unholy Strength
    setCode: "3ed",
    rarity: "common",
};

export const wallOfBone3ed: CardPrint = {
    printId: "4f9d6c2b-3492-4360-90cf-649608d4910f",
    definitionId: "ae20d442-a544-4a03-9ebf-5ecb137c67dd", // Wall of Bone
    setCode: "3ed",
    rarity: "uncommon",
};

export const warpArtifact3ed: CardPrint = {
    printId: "948a03b0-ce48-4fac-816f-8224b7ae936a",
    definitionId: "9e5e07a2-fbdf-4c4c-996a-fce40bab5de5", // Warp Artifact
    setCode: "3ed",
    rarity: "rare",
};

export const weakness3ed: CardPrint = {
    printId: "6774a228-ec9e-47d0-bc43-a92f5caf8398",
    definitionId: "36ca06a1-9b9a-49a2-9c47-9b72228621bc", // Weakness
    setCode: "3ed",
    rarity: "common",
};

export const willOTheWisp3ed: CardPrint = {
    printId: "551e5fdd-ed3a-4f44-b4d1-97900ef46373",
    definitionId: "a1a6f8e9-7bc1-4151-b55f-acf877b1a7a6", // Will-o'-the-Wisp
    setCode: "3ed",
    rarity: "rare",
};

export const zombieMaster3ed: CardPrint = {
    printId: "e868767f-b62e-4bb4-95e5-62feac05ff9d",
    definitionId: "3d4255a0-d445-4c00-b936-bbf07851e1c8", // Zombie Master
    setCode: "3ed",
    rarity: "rare",
};
