import type { CardPrint } from "../types";

// 2ED (Unlimited Edition). Unlimited reprints the full Beta card list with no
// new cards, so this module is entirely CardPrint entries: each declares the
// per-edition Scryfall UUID (printId) and resolves printId -> definitionId ->
// the shared LEA/LEB CardDefinition. See ADR 0014.
//
// Excluded (mirrors LEA/LEB): ante cards (Contract from Below, Darkpact,
// Demonic Attorney) and Chaos Orb are permanently out of scope (ADR 0010);
// Word of Command and Camouflage stay blocked on their not-yet-implemented LEA
// CardDefinition. A 2ED print lands automatically once its LEA def exists.

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

export const animateDead2ed: CardPrint = {
    printId: "0fc3ed63-96ee-420c-bde1-e0c904059931",
    definitionId: "8fd7861d-925f-4b4c-a4ab-60be6f43d50b", // Animate Dead
    setCode: "2ed",
    rarity: "uncommon",
};

export const animateWall2ed: CardPrint = {
    printId: "05d7bed4-950a-4a4e-b79a-50e4aa416fe9",
    definitionId: "d5c83259-9b90-47c2-b48e-c7d78519e792", // Animate Wall
    setCode: "2ed",
    rarity: "rare",
};

export const ankhOfMishra2ed: CardPrint = {
    printId: "808cad10-69d5-4e14-9834-476c53ec97e4",
    definitionId: "f594b7aa-d44e-47c4-989b-565f881e25f1", // Ankh of Mishra
    setCode: "2ed",
    rarity: "rare",
};

export const armageddon2ed: CardPrint = {
    printId: "df2c5d5c-f1c9-4639-bf72-3f6bde554864",
    definitionId: "5b6ddce7-b9c5-431d-a0b0-46d4aa93cbcb", // Armageddon
    setCode: "2ed",
    rarity: "rare",
};

export const aspectOfWolf2ed: CardPrint = {
    printId: "5aa02bb5-7365-4b8d-ac86-13721fb19d01",
    definitionId: "fd9ac9e6-1395-4fbd-80e2-645f0d910c29", // Aspect of Wolf
    setCode: "2ed",
    rarity: "rare",
};

export const badlands2ed: CardPrint = {
    printId: "5804dcd3-d41d-4cbd-9f8f-9736f2d37a64",
    definitionId: "717f6d10-9144-4ade-9ac6-a481cc66b875", // Badlands
    setCode: "2ed",
    rarity: "rare",
};

export const badMoon2ed: CardPrint = {
    printId: "882fe528-1a84-4d34-bd15-330963b684ff",
    definitionId: "43572906-ea74-4411-a549-5dc401591d2a", // Bad Moon
    setCode: "2ed",
    rarity: "rare",
};

export const balance2ed: CardPrint = {
    printId: "8352e8b6-c947-49f3-a653-a6af65d3e9c3",
    definitionId: "6f9ea46a-411f-40ce-a873-a905180093f4", // Balance
    setCode: "2ed",
    rarity: "rare",
};

export const basaltMonolith2ed: CardPrint = {
    printId: "5a72cd4b-5b47-46b8-b230-4b246f97221f",
    definitionId: "66a74c89-6f86-4ec8-af17-391cd5026054", // Basalt Monolith
    setCode: "2ed",
    rarity: "uncommon",
};

export const bayou2ed: CardPrint = {
    printId: "d66e43f0-1558-409f-8248-cc1d76c6bd8e",
    definitionId: "412ceddd-2b9a-4551-a6bf-ae2830a2010a", // Bayou
    setCode: "2ed",
    rarity: "rare",
};

export const benalishHero2ed: CardPrint = {
    printId: "9404e779-2065-4c4f-95d1-6997c7fea156",
    definitionId: "11600105-56c6-4073-a4a6-8469030b39c9", // Benalish Hero
    setCode: "2ed",
    rarity: "common",
};

export const berserk2ed: CardPrint = {
    printId: "fd082697-493f-48e3-a41f-123700435025",
    definitionId: "e173c8ce-2352-405e-ad00-e3bb94ced1ad", // Berserk
    setCode: "2ed",
    rarity: "uncommon",
};

export const birdsOfParadise2ed: CardPrint = {
    printId: "4e50454c-3927-4e7e-b4f6-7f5d5fd9b913",
    definitionId: "55fe6449-1f23-43dc-adee-d144cd505b5c", // Birds of Paradise
    setCode: "2ed",
    rarity: "rare",
};

export const blackKnight2ed: CardPrint = {
    printId: "36b94d0d-fbe5-4f32-af02-bbe3ab2e234a",
    definitionId: "c1662949-0d69-49a3-8c69-daf10717ed4e", // Black Knight
    setCode: "2ed",
    rarity: "uncommon",
};

export const blackLotus2ed: CardPrint = {
    printId: "4a2e428c-dd25-484c-bbc8-2d6ce10ef42c",
    definitionId: "b0faa7f2-b547-42c4-a810-839da50dadfe", // Black Lotus
    setCode: "2ed",
    rarity: "rare",
};

export const blackVise2ed: CardPrint = {
    printId: "5159a2cd-036c-482e-9b5a-b595391deef3",
    definitionId: "76ac72f8-5b1e-4d67-a796-ef69cde27424", // Black Vise
    setCode: "2ed",
    rarity: "uncommon",
};

export const blackWard2ed: CardPrint = {
    printId: "f0cd79e9-1b61-4ad3-8f6d-cb5d3f60ef8e",
    definitionId: "15967a39-303f-457d-bcde-51837c8d63e1", // Black Ward
    setCode: "2ed",
    rarity: "uncommon",
};

export const blazeOfGlory2ed: CardPrint = {
    printId: "2d636573-287d-4f6f-93b0-12ddd8f3e6d1",
    definitionId: "98fba951-c5bb-497c-9292-ce1b2a1e1247", // Blaze of Glory
    setCode: "2ed",
    rarity: "rare",
};

export const blessing2ed: CardPrint = {
    printId: "402e84fb-7c77-4491-9ece-c2d9b8506ece",
    definitionId: "f131fd27-18da-47ca-b59f-135bcac83abd", // Blessing
    setCode: "2ed",
    rarity: "rare",
};

export const blueElementalBlast2ed: CardPrint = {
    printId: "42d1579e-a587-4397-bd9a-cda52fcf6a1b",
    definitionId: "20d666ef-39bf-4fbf-8201-5f1056539da2", // Blue Elemental Blast
    setCode: "2ed",
    rarity: "common",
};

export const blueWard2ed: CardPrint = {
    printId: "1704d11c-569c-4b4e-bbe0-df42af98c4fc",
    definitionId: "93f9f0f2-e1cc-4740-888c-1336c6de0a27", // Blue Ward
    setCode: "2ed",
    rarity: "uncommon",
};

export const bogWraith2ed: CardPrint = {
    printId: "94345aab-b9f2-463e-91ab-acd8b99a7ec0",
    definitionId: "6701874e-986e-4b81-9268-90b6171e6187", // Bog Wraith
    setCode: "2ed",
    rarity: "uncommon",
};

export const braingeyser2ed: CardPrint = {
    printId: "3dbeef5c-f973-480b-a148-28de397b610f",
    definitionId: "62b19a12-6914-430e-81ce-dcfca47884df", // Braingeyser
    setCode: "2ed",
    rarity: "rare",
};

export const burrowing2ed: CardPrint = {
    printId: "08c109d4-6dd1-42a5-90ed-f8a71b6a0ca5",
    definitionId: "a14c05e4-8df3-450b-8a98-5028e73b14c1", // Burrowing
    setCode: "2ed",
    rarity: "uncommon",
};

export const castle2ed: CardPrint = {
    printId: "2ea3db44-85c5-4201-a5c9-ec14a9d244d6",
    definitionId: "b0da8d56-3178-44c2-9344-95d2346d326f", // Castle
    setCode: "2ed",
    rarity: "uncommon",
};

export const celestialPrism2ed: CardPrint = {
    printId: "cb119f5e-a47f-4910-b170-561d6315fdc3",
    definitionId: "a47417cb-1ea7-4f65-ba06-e27a99373114", // Celestial Prism
    setCode: "2ed",
    rarity: "uncommon",
};

export const channel2ed: CardPrint = {
    printId: "6a7a0f8f-f51e-4cfb-a546-87a086d5936a",
    definitionId: "c1862c47-71cc-45a3-8805-a5ddc62e55ea", // Channel
    setCode: "2ed",
    rarity: "uncommon",
};

export const chaoslace2ed: CardPrint = {
    printId: "f2776675-8720-4a4d-8d7b-96de9ad14533",
    definitionId: "72ea2048-57bc-43d5-8987-33ca727f1a97", // Chaoslace
    setCode: "2ed",
    rarity: "rare",
};

export const circleOfProtectionBlack2ed: CardPrint = {
    printId: "1eea1199-6b07-430c-b100-c5825a23d8b0",
    definitionId: "fa47b4cd-8da4-4544-b011-ba92b7009203", // Circle of Protection: Black
    setCode: "2ed",
    rarity: "common",
};

export const circleOfProtectionBlue2ed: CardPrint = {
    printId: "c19c60f7-92b7-4f84-b2c3-64e3d00dcb63",
    definitionId: "848b1a7f-e8ba-40b5-92b7-af1e963a0319", // Circle of Protection: Blue
    setCode: "2ed",
    rarity: "common",
};

export const circleOfProtectionGreen2ed: CardPrint = {
    printId: "108ce265-1b3a-484a-9b0c-cab1094d1521",
    definitionId: "1ae32d20-b438-4f43-b603-e8f706ecfb03", // Circle of Protection: Green
    setCode: "2ed",
    rarity: "common",
};

export const circleOfProtectionRed2ed: CardPrint = {
    printId: "4cc60529-401b-481a-b65c-ad791153afd7",
    definitionId: "b3dd94c5-42f6-4148-be6e-2a3a4226cc0e", // Circle of Protection: Red
    setCode: "2ed",
    rarity: "common",
};

export const circleOfProtectionWhite2ed: CardPrint = {
    printId: "98a1c689-cd8b-4a80-ad6d-e4ff5933f5e7",
    definitionId: "92df19c9-e127-42d9-8dd2-7fa5a7095428", // Circle of Protection: White
    setCode: "2ed",
    rarity: "common",
};

export const clockworkBeast2ed: CardPrint = {
    printId: "c7741816-0bc1-4540-b4b2-006275ffe572",
    definitionId: "27f916a2-0ace-44b5-99dc-72979af34db9", // Clockwork Beast
    setCode: "2ed",
    rarity: "rare",
};

export const clone2ed: CardPrint = {
    printId: "bcf09714-89cf-4feb-b941-74f791bbdf6e",
    definitionId: "f00d33dd-4eb2-4446-9813-1923d8e2d2f3", // Clone
    setCode: "2ed",
    rarity: "uncommon",
};

export const cockatrice2ed: CardPrint = {
    printId: "8392d34d-d14a-43ca-997d-fe59e505034e",
    definitionId: "9cd91814-6177-4a3d-a1c1-a3be7d7c7957", // Cockatrice
    setCode: "2ed",
    rarity: "rare",
};

export const consecrateLand2ed: CardPrint = {
    printId: "9efb29d2-550f-4ede-b024-7b0e15c2e986",
    definitionId: "d2379f78-c03f-447f-b3c9-10a918d556e9", // Consecrate Land
    setCode: "2ed",
    rarity: "uncommon",
};

export const conservator2ed: CardPrint = {
    printId: "744e7821-8bfd-4816-a8af-4e6fe7b35505",
    definitionId: "c7824e2a-4eff-4f72-9216-0db30a4f4252", // Conservator
    setCode: "2ed",
    rarity: "uncommon",
};

export const controlMagic2ed: CardPrint = {
    printId: "076d132a-fa3d-464b-b5f9-a12e46c9f2df",
    definitionId: "7b52f459-c703-4a0b-9114-ff69eec61287", // Control Magic
    setCode: "2ed",
    rarity: "uncommon",
};

export const conversion2ed: CardPrint = {
    printId: "45bf4297-ccf4-4fa0-b7ce-5aaebca50813",
    definitionId: "13186bc9-8d9c-433b-ba15-121ef94dd68a", // Conversion
    setCode: "2ed",
    rarity: "uncommon",
};

export const copperTablet2ed: CardPrint = {
    printId: "c17cb591-916e-4176-aeb9-e2275d68d472",
    definitionId: "30935e4a-013e-4c46-ad05-304df8e5dfa4", // Copper Tablet
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

export const crawWurm2ed: CardPrint = {
    printId: "a5bbaf11-6bf1-42a1-a8be-66bc47485a6c",
    definitionId: "bfed1a95-bd67-4e16-a781-81866028af2f", // Craw Wurm
    setCode: "2ed",
    rarity: "common",
};

export const creatureBond2ed: CardPrint = {
    printId: "1f9e4aa8-4ca7-4893-81d7-98205246f357",
    definitionId: "ee4bd7d1-77e5-46e5-a594-c24469e88c4c", // Creature Bond
    setCode: "2ed",
    rarity: "common",
};

export const crusade2ed: CardPrint = {
    printId: "4b9933e3-2267-4534-a1c6-c463e767480a",
    definitionId: "057986c7-20c0-4157-b4df-beae4ef5c66d", // Crusade
    setCode: "2ed",
    rarity: "rare",
};

export const crystalRod2ed: CardPrint = {
    printId: "00c92601-11b9-4e7c-bc81-882085f3fae6",
    definitionId: "76693233-7961-4b7e-80f2-ed90e494c4aa", // Crystal Rod
    setCode: "2ed",
    rarity: "uncommon",
};

export const cursedLand2ed: CardPrint = {
    printId: "69f37a32-dc03-49fd-b28b-d091563d3690",
    definitionId: "cf5f3c61-1e54-4eea-bf82-311cfa988e6a", // Cursed Land
    setCode: "2ed",
    rarity: "uncommon",
};

export const cyclopeanTomb2ed: CardPrint = {
    printId: "a184cd2e-e27f-44b0-a8ae-9d861280e469",
    definitionId: "894c5cf2-8ae2-427a-bcbc-67df0bdfee9d", // Cyclopean Tomb
    setCode: "2ed",
    rarity: "rare",
};

export const darkRitual2ed: CardPrint = {
    printId: "c4d24ff3-315d-44cd-8c27-d8ad6972e027",
    definitionId: "ebb6664d-23ca-456e-9916-afcd6f26aa7f", // Dark Ritual
    setCode: "2ed",
    rarity: "common",
};

export const deathgrip2ed: CardPrint = {
    printId: "fe9210db-2ab3-42e6-be04-790917092317",
    definitionId: "2371c126-f19a-472a-ba5f-3b1366274ea0", // Deathgrip
    setCode: "2ed",
    rarity: "uncommon",
};

export const deathlace2ed: CardPrint = {
    printId: "c3e02432-b8bd-4091-a520-6895313ff141",
    definitionId: "6ff1cefc-62cb-4525-b0c5-2b09603b4314", // Deathlace
    setCode: "2ed",
    rarity: "rare",
};

export const deathWard2ed: CardPrint = {
    printId: "d7604388-752a-463d-95cd-486752a4bd04",
    definitionId: "fa5466cc-aa57-4a7f-8b21-d92b2fe02e13", // Death Ward
    setCode: "2ed",
    rarity: "common",
};

export const demonicHordes2ed: CardPrint = {
    printId: "812a0a10-0765-499f-8581-c4d7e0e81299",
    definitionId: "6c9bb8b1-fb79-4b99-ba09-c6e6c860de50", // Demonic Hordes
    setCode: "2ed",
    rarity: "rare",
};

export const demonicTutor2ed: CardPrint = {
    printId: "c8d5d6a5-6807-4a80-9460-7633dc430ee9",
    definitionId: "711d4d54-5520-4de8-9b93-79902ed8e562", // Demonic Tutor
    setCode: "2ed",
    rarity: "uncommon",
};

export const dingusEgg2ed: CardPrint = {
    printId: "a804f742-f7cf-427e-ad0a-742587328156",
    definitionId: "65eb6cda-e512-40a8-9c1f-335b713409ff", // Dingus Egg
    setCode: "2ed",
    rarity: "rare",
};

export const disenchant2ed: CardPrint = {
    printId: "73636b95-103d-43c8-bc96-63fad0da34dd",
    definitionId: "2722d7e2-61c6-4934-9c21-875ee78fd06c", // Disenchant
    setCode: "2ed",
    rarity: "common",
};

export const disintegrate2ed: CardPrint = {
    printId: "f94878cc-4c0f-42e4-a49f-02a2b269ef06",
    definitionId: "8712c49e-f171-4669-bed9-87575a37af11", // Disintegrate
    setCode: "2ed",
    rarity: "common",
};

export const disruptingScepter2ed: CardPrint = {
    printId: "0c58f236-0b2c-4b71-8819-1beaea7ded17",
    definitionId: "ca571ee8-07a2-43b8-9acf-89cbfd3cf7c9", // Disrupting Scepter
    setCode: "2ed",
    rarity: "rare",
};

export const dragonWhelp2ed: CardPrint = {
    printId: "7ad8ab3d-8a77-4fd3-8d5a-ac1e8a09e3bc",
    definitionId: "6bbf1eab-bc32-4835-b566-8634b1fe81b0", // Dragon Whelp
    setCode: "2ed",
    rarity: "uncommon",
};

export const drainLife2ed: CardPrint = {
    printId: "d5f7044e-3b91-42ac-91ec-56e17cd72274",
    definitionId: "5d077a49-73d4-4958-b42a-31b814e110e8", // Drain Life
    setCode: "2ed",
    rarity: "common",
};

export const drainPower2ed: CardPrint = {
    printId: "6123f833-236d-4c61-b543-4ac662759336",
    definitionId: "ea3830c5-cc66-453e-9e53-0636e00ee0ee", // Drain Power
    setCode: "2ed",
    rarity: "rare",
};

export const drudgeSkeletons2ed: CardPrint = {
    printId: "4eb88d79-048b-4f7c-9ca0-4d9066af805e",
    definitionId: "23614289-0d73-4747-a849-5cb67cc97d6a", // Drudge Skeletons
    setCode: "2ed",
    rarity: "common",
};

export const dwarvenDemolitionTeam2ed: CardPrint = {
    printId: "a6b2fe92-0521-4a85-9a8d-4203b0e0e118",
    definitionId: "03482c9c-1f25-4d73-9243-17462ea37ac4", // Dwarven Demolition Team
    setCode: "2ed",
    rarity: "uncommon",
};

export const dwarvenWarriors2ed: CardPrint = {
    printId: "113d518a-2ce9-4747-9e6f-c6a464a78a49",
    definitionId: "2d4d87a3-5f8b-4152-9a8b-538ab49d62e8", // Dwarven Warriors
    setCode: "2ed",
    rarity: "common",
};

export const earthbind2ed: CardPrint = {
    printId: "8a05dcd8-4c5d-413c-b1c0-3613f211a284",
    definitionId: "a6d492b7-b0b3-420e-8d00-6dacb11de77e", // Earthbind
    setCode: "2ed",
    rarity: "common",
};

export const earthElemental2ed: CardPrint = {
    printId: "2295ded3-7e72-4f3b-93e2-e9557a10b32e",
    definitionId: "b24b5864-44c0-4bc8-8705-9504f83b2c03", // Earth Elemental
    setCode: "2ed",
    rarity: "uncommon",
};

export const earthquake2ed: CardPrint = {
    printId: "1dba16d3-292d-430c-88cc-c49ded13effb",
    definitionId: "e68ac362-6cdc-48a6-bdd3-4f8ea32add64", // Earthquake
    setCode: "2ed",
    rarity: "rare",
};

export const elvishArchers2ed: CardPrint = {
    printId: "0fad0e0d-f34a-45ff-9f01-e6ac10b6928f",
    definitionId: "1cb9d405-f2b5-4e10-a405-feafd2a87d90", // Elvish Archers
    setCode: "2ed",
    rarity: "rare",
};

export const evilPresence2ed: CardPrint = {
    printId: "19d85c34-2057-4572-a881-29dd35c1ee30",
    definitionId: "0551d66e-8cd4-48f0-aa17-15f26be9d85f", // Evil Presence
    setCode: "2ed",
    rarity: "uncommon",
};

export const falseOrders2ed: CardPrint = {
    printId: "a59c24d9-804b-45d0-b60c-cfc7a6af7ef5",
    definitionId: "7eb71ac4-796d-4011-9002-1129bc09c284", // False Orders
    setCode: "2ed",
    rarity: "common",
};

export const farmstead2ed: CardPrint = {
    printId: "3d79940b-9384-4009-8b74-3d56a2c5a8a5",
    definitionId: "3455b006-9ea5-4aef-8ad2-d0701eb0cacf", // Farmstead
    setCode: "2ed",
    rarity: "rare",
};

export const fastbond2ed: CardPrint = {
    printId: "64b52b42-e2af-4040-b7ba-34cc292af7ef",
    definitionId: "a575a9af-e1de-4a1d-91d8-440585377e4f", // Fastbond
    setCode: "2ed",
    rarity: "rare",
};

export const fear2ed: CardPrint = {
    printId: "e48c7fd2-860e-4266-b8c0-f6d48f52b851",
    definitionId: "0cd927be-e63f-4371-a1d8-7a0489cb187e", // Fear
    setCode: "2ed",
    rarity: "common",
};

export const feedback2ed: CardPrint = {
    printId: "5083317e-8536-41e3-a441-8e6be4d63d50",
    definitionId: "0eb8f591-d763-49bf-8ef9-86265aaa72f7", // Feedback
    setCode: "2ed",
    rarity: "uncommon",
};

export const fireball2ed: CardPrint = {
    printId: "39e05c2d-b4a1-4f59-8743-f1694c803164",
    definitionId: "b7623c00-144b-4a8f-9c6c-f5e9e4f65ece", // Fireball
    setCode: "2ed",
    rarity: "common",
};

export const firebreathing2ed: CardPrint = {
    printId: "dc2bfe7b-9850-4450-9bad-73fa0d678a5f",
    definitionId: "3eb27381-505d-4e47-bf66-9e7ba91a5075", // Firebreathing
    setCode: "2ed",
    rarity: "common",
};

export const fireElemental2ed: CardPrint = {
    printId: "bddeac3f-f4ee-432b-9d69-8533a28e7f46",
    definitionId: "da237992-2919-4e37-8f56-2164095f59b5", // Fire Elemental
    setCode: "2ed",
    rarity: "uncommon",
};

export const flashfires2ed: CardPrint = {
    printId: "c2990a78-54fc-4fae-a6c9-e03c5c39eee3",
    definitionId: "ee8a05a4-0ce3-4abe-bb60-08af53cf08e5", // Flashfires
    setCode: "2ed",
    rarity: "uncommon",
};

export const flight2ed: CardPrint = {
    printId: "5460051e-07fc-4818-82fd-7c424334b7bf",
    definitionId: "67c7784b-6b79-4268-a714-895c82809aff", // Flight
    setCode: "2ed",
    rarity: "common",
};

export const fog2ed: CardPrint = {
    printId: "ba0a14ac-037a-42f2-8fc9-2a41275dc7da",
    definitionId: "cfba606d-bb55-43ba-aa0c-299649958788", // Fog
    setCode: "2ed",
    rarity: "common",
};

export const forcefield2ed: CardPrint = {
    printId: "239a5d29-95cf-468a-8b07-aea1f7dc8d52",
    definitionId: "3f2004c1-8efe-407f-bf48-27b807422eea", // Forcefield
    setCode: "2ed",
    rarity: "rare",
};

export const forceOfNature2ed: CardPrint = {
    printId: "247a2ba4-aa5d-4970-b886-90196f684f80",
    definitionId: "21551cb6-3a53-42dd-9bbd-4bc56304d6d3", // Force of Nature
    setCode: "2ed",
    rarity: "rare",
};

export const forest2ed: CardPrint = {
    printId: "88d0aca2-874c-4d91-8fe9-f8355d71aeb2",
    definitionId: "6f1c8cb0-38eb-408b-94e8-16db83999b3b", // Forest
    setCode: "2ed",
    rarity: "common",
};

export const forest22ed: CardPrint = {
    printId: "679aa578-3b31-4b07-98b3-e00777506e32",
    definitionId: "6f1c8cb0-38eb-408b-94e8-16db83999b3b", // Forest
    setCode: "2ed",
    rarity: "common",
};

export const forest32ed: CardPrint = {
    printId: "79bf50f3-2838-4908-8004-847ccb296fe0",
    definitionId: "6f1c8cb0-38eb-408b-94e8-16db83999b3b", // Forest
    setCode: "2ed",
    rarity: "common",
};

export const fork2ed: CardPrint = {
    printId: "a877d692-018b-4a08-ab6f-9707b267f6fd",
    definitionId: "e6b43916-fe2d-417a-a550-d7c795023297", // Fork
    setCode: "2ed",
    rarity: "rare",
};

export const frozenShade2ed: CardPrint = {
    printId: "485421e0-ee1c-425b-abe0-ec5a7e2c0042",
    definitionId: "d0bd76c8-4cff-4c15-9686-7a299b589814", // Frozen Shade
    setCode: "2ed",
    rarity: "common",
};

export const fungusaur2ed: CardPrint = {
    printId: "1a34fc9e-96cf-40f2-adb9-ac5085d140af",
    definitionId: "5ad89f0d-b09b-40a0-84d6-3ee60dec7e23", // Fungusaur
    setCode: "2ed",
    rarity: "rare",
};

export const gaeaSLiege2ed: CardPrint = {
    printId: "5eb712ea-c9f5-4831-9e1e-22bf5a75d426",
    definitionId: "e2b15221-c8b0-4861-9f8b-8a65834ad499", // Gaea's Liege
    setCode: "2ed",
    rarity: "rare",
};

export const gauntletOfMight2ed: CardPrint = {
    printId: "407650c3-9388-45c3-a599-6929c7d6e5bd",
    definitionId: "da248001-ed75-4b68-9532-37d3cd5afc4c", // Gauntlet of Might
    setCode: "2ed",
    rarity: "rare",
};

export const giantGrowth2ed: CardPrint = {
    printId: "211ba440-1c29-403a-8dd7-aa5792d20a1a",
    definitionId: "367dbefe-3366-408e-9fcf-7dc00f8cc201", // Giant Growth
    setCode: "2ed",
    rarity: "common",
};

export const giantSpider2ed: CardPrint = {
    printId: "a94d08f2-07ac-4887-aa30-ed0579d5113f",
    definitionId: "77636b4c-faea-4bf5-b88c-dd5bb88dc930", // Giant Spider
    setCode: "2ed",
    rarity: "common",
};

export const glassesOfUrza2ed: CardPrint = {
    printId: "c8635a10-12fc-4308-8f1e-6c4bc6acd9b5",
    definitionId: "cafc2350-5d64-4379-9198-79a114654d45", // Glasses of Urza
    setCode: "2ed",
    rarity: "uncommon",
};

export const gloom2ed: CardPrint = {
    printId: "f463412c-ac10-476c-bba1-27724c041d68",
    definitionId: "a8d10bc7-daeb-4c0d-9e4a-8eae8d11699f", // Gloom
    setCode: "2ed",
    rarity: "uncommon",
};

export const goblinBalloonBrigade2ed: CardPrint = {
    printId: "26cbb4d5-bb1b-4b1c-b94d-58e45ba497ca",
    definitionId: "5129b422-7a35-4bc5-b14b-c814012a0d8f", // Goblin Balloon Brigade
    setCode: "2ed",
    rarity: "uncommon",
};

export const goblinKing2ed: CardPrint = {
    printId: "1954e618-b4ac-48d8-9218-b29878bae710",
    definitionId: "5873672d-37ea-4c0f-97f3-12b74fde112d", // Goblin King
    setCode: "2ed",
    rarity: "rare",
};

export const graniteGargoyle2ed: CardPrint = {
    printId: "01116585-a8c7-4619-b0a6-fcfe78fdaf3c",
    definitionId: "f15bf2b2-6848-4fbd-b89a-8d8da8ae1cdc", // Granite Gargoyle
    setCode: "2ed",
    rarity: "rare",
};

export const grayOgre2ed: CardPrint = {
    printId: "e2e956a7-3ed1-4cbb-a6fd-123453360058",
    definitionId: "73ae5276-b607-4f23-a9d2-e8cc7b8e3693", // Gray Ogre
    setCode: "2ed",
    rarity: "common",
};

export const greenWard2ed: CardPrint = {
    printId: "73f6058a-9292-4474-a794-7161ec9a99f0",
    definitionId: "1f6118b2-fe01-425a-a2ed-6d7c42286c8e", // Green Ward
    setCode: "2ed",
    rarity: "uncommon",
};

export const grizzlyBears2ed: CardPrint = {
    printId: "d74cce44-b54b-4922-9cea-f3fda725d24f",
    definitionId: "ce2d603a-3231-4a8c-bf39-1617586ea870", // Grizzly Bears
    setCode: "2ed",
    rarity: "common",
};

export const guardianAngel2ed: CardPrint = {
    printId: "c2b47221-c468-4b77-89c5-79a06443ef81",
    definitionId: "0f84d676-5327-454c-a033-b4498a9d28e2", // Guardian Angel
    setCode: "2ed",
    rarity: "common",
};

export const healingSalve2ed: CardPrint = {
    printId: "a38b2f1c-a69b-467a-a749-d7fbc1fb6dbb",
    definitionId: "e28de37e-84d5-4dc7-b36c-e14da5924729", // Healing Salve
    setCode: "2ed",
    rarity: "common",
};

export const helmOfChatzuk2ed: CardPrint = {
    printId: "b0d2c643-39cc-47f8-9f70-327f004c1373",
    definitionId: "3792c6ef-c4e6-4923-9a51-7d28fbc5c393", // Helm of Chatzuk
    setCode: "2ed",
    rarity: "rare",
};

export const hillGiant2ed: CardPrint = {
    printId: "df03759e-17a0-4191-bd4d-e823846924ce",
    definitionId: "0ddb98e8-13fe-4786-83f7-b72c56db135a", // Hill Giant
    setCode: "2ed",
    rarity: "common",
};

export const holyArmor2ed: CardPrint = {
    printId: "9a7d92de-d663-4919-a23f-38389ba5593e",
    definitionId: "b01041d2-687e-4972-81c8-16690809275b", // Holy Armor
    setCode: "2ed",
    rarity: "common",
};

export const holyStrength2ed: CardPrint = {
    printId: "f25cea1b-22c0-4323-8119-0ca627426aa7",
    definitionId: "e945a4cd-0eb1-4f54-898d-169ce2748a03", // Holy Strength
    setCode: "2ed",
    rarity: "common",
};

export const howlFromBeyond2ed: CardPrint = {
    printId: "78694fa9-85dc-4671-87e9-a2bccdc9fcce",
    definitionId: "67ec17e1-174b-4d07-a27f-91a333c4b2fb", // Howl from Beyond
    setCode: "2ed",
    rarity: "common",
};

export const howlingMine2ed: CardPrint = {
    printId: "c69d4007-d26b-442b-9c34-d3780c46c5f6",
    definitionId: "51f8f6e1-a451-4262-90d3-5107caf54175", // Howling Mine
    setCode: "2ed",
    rarity: "rare",
};

export const hurloonMinotaur2ed: CardPrint = {
    printId: "8ca4c6df-a456-4eb3-90fc-f1e7ee8c48e4",
    definitionId: "78a9088f-8755-47cb-aa93-51d992ccab90", // Hurloon Minotaur
    setCode: "2ed",
    rarity: "common",
};

export const hurricane2ed: CardPrint = {
    printId: "2287bb85-72b1-40ae-9d44-0364a4075e88",
    definitionId: "52f5a19f-16e4-4d35-89e1-969ac8202f88", // Hurricane
    setCode: "2ed",
    rarity: "uncommon",
};

export const hypnoticSpecter2ed: CardPrint = {
    printId: "e12847f4-4ace-4116-bc96-f3e5336eb35f",
    definitionId: "b43b900f-2d9b-442b-9699-058483604ec9", // Hypnotic Specter
    setCode: "2ed",
    rarity: "uncommon",
};

export const iceStorm2ed: CardPrint = {
    printId: "2ec2246d-8bea-43c4-bf7f-2acad363e0af",
    definitionId: "9914836e-2fa6-4390-94b2-431427848a54", // Ice Storm
    setCode: "2ed",
    rarity: "uncommon",
};

export const icyManipulator2ed: CardPrint = {
    printId: "2a7cf252-1af0-4b03-89bc-8287b4052a23",
    definitionId: "29dc1596-a2e7-4d60-9f99-89babaef8a06", // Icy Manipulator
    setCode: "2ed",
    rarity: "uncommon",
};

export const illusionaryMask2ed: CardPrint = {
    printId: "a274a381-4eb0-4e27-aff4-4d94e61b726a",
    definitionId: "62ef2f37-b8ad-47ad-89ca-d6abcb7ff21b", // Illusionary Mask
    setCode: "2ed",
    rarity: "rare",
};

export const instillEnergy2ed: CardPrint = {
    printId: "1ba27e77-00b8-4d6c-acbd-462273212fc2",
    definitionId: "5bd38716-874c-4e3c-a315-837839a6258c", // Instill Energy
    setCode: "2ed",
    rarity: "uncommon",
};

export const invisibility2ed: CardPrint = {
    printId: "de833d23-2abd-42c3-a38f-f16813aaee4e",
    definitionId: "1858ac51-e6a7-48d7-8759-166070ca13d8", // Invisibility
    setCode: "2ed",
    rarity: "common",
};

export const ironclawOrcs2ed: CardPrint = {
    printId: "0e17623a-5bc0-42d7-a842-394de0a01a01",
    definitionId: "d56421a8-34ae-4033-943f-c59a7bf2b6f9", // Ironclaw Orcs
    setCode: "2ed",
    rarity: "common",
};

export const ironrootTreefolk2ed: CardPrint = {
    printId: "f89f3bda-e2fb-496e-a9f3-7260e8ac97fd",
    definitionId: "b93c5869-7777-44bb-967a-e9439b25ced4", // Ironroot Treefolk
    setCode: "2ed",
    rarity: "common",
};

export const ironStar2ed: CardPrint = {
    printId: "3cf0941f-1e23-4af6-a398-d2e96783ecca",
    definitionId: "5786de12-cade-43c2-a6b0-0c5b294b9d0e", // Iron Star
    setCode: "2ed",
    rarity: "uncommon",
};

export const island2ed: CardPrint = {
    printId: "68271f76-eaf9-44cc-bb3d-5c56f36e9af9",
    definitionId: "90a57c0e-fa61-45ef-955d-d296403967d5", // Island
    setCode: "2ed",
    rarity: "common",
};

export const island22ed: CardPrint = {
    printId: "069b4d6c-7542-4a42-8822-031f02131033",
    definitionId: "90a57c0e-fa61-45ef-955d-d296403967d5", // Island
    setCode: "2ed",
    rarity: "common",
};

export const island32ed: CardPrint = {
    printId: "712dc7d6-5543-49fd-bafa-5ffb6c2bb0ce",
    definitionId: "90a57c0e-fa61-45ef-955d-d296403967d5", // Island
    setCode: "2ed",
    rarity: "common",
};

export const islandSanctuary2ed: CardPrint = {
    printId: "d5726f8d-4467-4ab9-8931-432c0cefcbf4",
    definitionId: "c15e8a42-89de-42bc-8d5f-33426d207c3a", // Island Sanctuary
    setCode: "2ed",
    rarity: "rare",
};

export const ivoryCup2ed: CardPrint = {
    printId: "76aaff1a-6796-4728-bdb5-bcdc79c9b98c",
    definitionId: "9964d8d8-dc97-4e5f-9f52-173f7e2c37fd", // Ivory Cup
    setCode: "2ed",
    rarity: "uncommon",
};

export const jadeMonolith2ed: CardPrint = {
    printId: "88c6101a-09af-423e-881f-09aa1e01d2a2",
    definitionId: "4a77e0f1-449d-4a7d-9fa0-ba7598f7a73a", // Jade Monolith
    setCode: "2ed",
    rarity: "rare",
};

export const jadeStatue2ed: CardPrint = {
    printId: "a5354edc-03d7-4176-a211-174374a9d912",
    definitionId: "8d82d94b-ceef-4533-a4f2-b6442a61b839", // Jade Statue
    setCode: "2ed",
    rarity: "uncommon",
};

export const jayemdaeTome2ed: CardPrint = {
    printId: "e470c00b-57ac-48d4-b1e6-74b74872e620",
    definitionId: "cac8c421-5b92-481d-b2de-560c0231ab58", // Jayemdae Tome
    setCode: "2ed",
    rarity: "rare",
};

export const juggernaut2ed: CardPrint = {
    printId: "0cde95ea-ad1a-4acb-a8bd-5457f119aeb7",
    definitionId: "dcd6a291-5282-4f49-8203-d9b416083c48", // Juggernaut
    setCode: "2ed",
    rarity: "uncommon",
};

export const jump2ed: CardPrint = {
    printId: "24b4c4c9-84c1-484c-9f67-1f460585d45c",
    definitionId: "cb3f4b11-ad1b-48e2-a500-787d351b0174", // Jump
    setCode: "2ed",
    rarity: "common",
};

export const karma2ed: CardPrint = {
    printId: "c9aa32e2-aeb0-4104-8603-a56bd8fc0953",
    definitionId: "6f30ad61-fcb7-4d55-ba86-94de1bf545e4", // Karma
    setCode: "2ed",
    rarity: "uncommon",
};

export const keldonWarlord2ed: CardPrint = {
    printId: "f2d0bc79-d2f8-43e7-9106-c0d01db31fa2",
    definitionId: "8fe3fd83-969c-4add-888f-86f4306b067c", // Keldon Warlord
    setCode: "2ed",
    rarity: "uncommon",
};

export const kormusBell2ed: CardPrint = {
    printId: "736e4586-a6c6-42c0-8555-5f09d214e1cb",
    definitionId: "3f4ef7a1-148d-44ac-89ed-0ef379cca0c6", // Kormus Bell
    setCode: "2ed",
    rarity: "rare",
};

export const kudzu2ed: CardPrint = {
    printId: "f92ec34e-e374-462f-aa9c-257558defb1f",
    definitionId: "b2b72dcd-9ea1-4729-baae-ecd262fdff67", // Kudzu
    setCode: "2ed",
    rarity: "rare",
};

export const lance2ed: CardPrint = {
    printId: "e7e9714d-072b-4237-8371-5ce2709c878f",
    definitionId: "ddb633f5-cc4d-4157-8217-def90cb15e24", // Lance
    setCode: "2ed",
    rarity: "uncommon",
};

export const leyDruid2ed: CardPrint = {
    printId: "30c3f2cd-5113-45f5-bb8d-4a7d5c4c76a5",
    definitionId: "f9232508-d363-4ef3-987a-741f6bff331f", // Ley Druid
    setCode: "2ed",
    rarity: "uncommon",
};

export const libraryOfLeng2ed: CardPrint = {
    printId: "502d77d6-c5c9-4def-80cb-7905fbbdefcb",
    definitionId: "2340edcb-8cd5-4ccd-99e2-b9a29f72c495", // Library of Leng
    setCode: "2ed",
    rarity: "uncommon",
};

export const lich2ed: CardPrint = {
    printId: "5bded615-62bc-40f6-9a54-7c9d0d551d4c",
    definitionId: "4250caec-0e37-41be-9ec4-8938deb5f0d0", // Lich
    setCode: "2ed",
    rarity: "rare",
};

export const lifeforce2ed: CardPrint = {
    printId: "58b02fa9-5481-4614-b9b4-5f8857848e3e",
    definitionId: "e292577e-6232-44fa-a9c2-cc09949c6ed3", // Lifeforce
    setCode: "2ed",
    rarity: "uncommon",
};

export const lifelace2ed: CardPrint = {
    printId: "446558ba-2396-4b9e-b56a-cf2014e7a13c",
    definitionId: "38cb601b-a35c-412e-b386-e77dad3daa54", // Lifelace
    setCode: "2ed",
    rarity: "rare",
};

export const lifetap2ed: CardPrint = {
    printId: "64641b90-c72e-4eab-9b99-330786739ab9",
    definitionId: "11add837-7ee4-4104-b031-c161bce459ae", // Lifetap
    setCode: "2ed",
    rarity: "uncommon",
};

export const lightningBolt2ed: CardPrint = {
    printId: "ff1b8fc5-604a-4449-a73d-861e53642a70",
    definitionId: "d573ef03-4730-45aa-93dd-e45ac1dbaf4a", // Lightning Bolt
    setCode: "2ed",
    rarity: "common",
};

export const livingArtifact2ed: CardPrint = {
    printId: "47354179-7048-4329-9c50-ce9d4e714a5b",
    definitionId: "c9e753a2-a7d0-4d37-ae65-b5a1b5039a6e", // Living Artifact
    setCode: "2ed",
    rarity: "rare",
};

export const livingLands2ed: CardPrint = {
    printId: "a0a8474f-279e-44d7-a062-6dcb556c328d",
    definitionId: "80be0580-7948-4d8e-8c0f-5e2797ac411b", // Living Lands
    setCode: "2ed",
    rarity: "rare",
};

export const livingWall2ed: CardPrint = {
    printId: "3035651f-a2b5-49c1-a768-1f510a31a9d8",
    definitionId: "4a98ada6-923a-44a5-bdef-ea6a160b481e", // Living Wall
    setCode: "2ed",
    rarity: "uncommon",
};

export const llanowarElves2ed: CardPrint = {
    printId: "fedd1b24-44ee-493a-b4db-3048ff5c760b",
    definitionId: "d4f1cc9e-4f99-4c26-ac1b-8ef069fa8ceb", // Llanowar Elves
    setCode: "2ed",
    rarity: "common",
};

export const lordOfAtlantis2ed: CardPrint = {
    printId: "fa161987-2dd1-4efe-b934-acbd93653169",
    definitionId: "210c4a90-fc7a-4c76-aeaa-20a005e45386", // Lord of Atlantis
    setCode: "2ed",
    rarity: "rare",
};

export const lordOfThePit2ed: CardPrint = {
    printId: "3ac3a8d8-47a7-4e47-a16c-109aeccd8d1f",
    definitionId: "2926777a-4f6e-4965-ba83-22cf7df02602", // Lord of the Pit
    setCode: "2ed",
    rarity: "rare",
};

export const lure2ed: CardPrint = {
    printId: "f790990a-f47d-4fb0-a361-108037dd7464",
    definitionId: "2a87b26e-0431-42e9-b44f-94ba8546111a", // Lure
    setCode: "2ed",
    rarity: "uncommon",
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

export const manabarbs2ed: CardPrint = {
    printId: "3c424086-8122-404d-8c3a-f36d455271a7",
    definitionId: "6121f72f-680f-4bb4-ae4d-37ee4ebed4d8", // Manabarbs
    setCode: "2ed",
    rarity: "rare",
};

export const manaFlare2ed: CardPrint = {
    printId: "bf770633-612e-41db-a451-7da802c46e4d",
    definitionId: "7fb99a26-beeb-4aca-bb02-b2d2ce0595f9", // Mana Flare
    setCode: "2ed",
    rarity: "rare",
};

export const manaShort2ed: CardPrint = {
    printId: "743e0f1e-55ab-429a-b9f1-769b008ad06a",
    definitionId: "73e3e0b3-5284-464f-8c62-0f7801c966f5", // Mana Short
    setCode: "2ed",
    rarity: "rare",
};

export const manaVault2ed: CardPrint = {
    printId: "778d10e6-251b-4ef3-b9b8-bc23a0d74aed",
    definitionId: "19499cb7-eccb-4e69-af32-6002d447a160", // Mana Vault
    setCode: "2ed",
    rarity: "rare",
};

export const meekstone2ed: CardPrint = {
    printId: "2d1ced0f-a232-4a05-aa59-6e611b52d617",
    definitionId: "13a68a17-22ee-47c9-870a-83e911862b94", // Meekstone
    setCode: "2ed",
    rarity: "rare",
};

export const merfolkOfThePearlTrident2ed: CardPrint = {
    printId: "ab8019a6-0d62-4145-8a4d-87205d3cb9d6",
    definitionId: "2b871039-6a66-4ac3-95e7-24759c1f2f92", // Merfolk of the Pearl Trident
    setCode: "2ed",
    rarity: "common",
};

export const mesaPegasus2ed: CardPrint = {
    printId: "7ff95a24-86e9-4302-bd90-89ca96164032",
    definitionId: "eaac88da-d19e-4771-944c-3709963d04e7", // Mesa Pegasus
    setCode: "2ed",
    rarity: "common",
};

export const mindTwist2ed: CardPrint = {
    printId: "f3d7381b-9075-4c9b-adf5-a0d1c26fab67",
    definitionId: "eee9e106-a248-49d2-b8c8-6bbcd56ce739", // Mind Twist
    setCode: "2ed",
    rarity: "rare",
};

export const monsSGoblinRaiders2ed: CardPrint = {
    printId: "0d3eff55-6a14-4c01-8b05-715094a319b3",
    definitionId: "b4eb3db3-6a7c-488a-9433-d5d1d3133816", // Mons's Goblin Raiders
    setCode: "2ed",
    rarity: "common",
};

export const mountain2ed: CardPrint = {
    printId: "2c3c0f74-485e-4b21-8f41-56666a7d0005",
    definitionId: "eace2c85-976c-425e-9800-5a6ccbd91b56", // Mountain
    setCode: "2ed",
    rarity: "common",
};

export const mountain22ed: CardPrint = {
    printId: "005a993c-5111-4364-9fba-75b3d94a8296",
    definitionId: "eace2c85-976c-425e-9800-5a6ccbd91b56", // Mountain
    setCode: "2ed",
    rarity: "common",
};

export const mountain32ed: CardPrint = {
    printId: "987557ee-8344-4191-b85c-f9dedf4d1614",
    definitionId: "eace2c85-976c-425e-9800-5a6ccbd91b56", // Mountain
    setCode: "2ed",
    rarity: "common",
};

export const moxEmerald2ed: CardPrint = {
    printId: "a4db5af2-9caf-4493-b340-6d64021139e2",
    definitionId: "b0e1427c-05cd-465b-be59-97ed6e39f7ba", // Mox Emerald
    setCode: "2ed",
    rarity: "rare",
};

export const moxJet2ed: CardPrint = {
    printId: "70d6c02e-0f48-4fb0-94f3-1fc92ee1814f",
    definitionId: "92bcd1ce-19b1-4d78-8b09-95242ca08d76", // Mox Jet
    setCode: "2ed",
    rarity: "rare",
};

export const moxPearl2ed: CardPrint = {
    printId: "c84e8a0e-49a7-46f6-8a37-910e32753528",
    definitionId: "8ebe4be7-e12a-4596-a899-fbd5b152e879", // Mox Pearl
    setCode: "2ed",
    rarity: "rare",
};

export const moxRuby2ed: CardPrint = {
    printId: "21b7cbae-6647-4f36-b02d-5535ac88b1a6",
    definitionId: "8945585f-4773-493d-a0fe-d707db910b38", // Mox Ruby
    setCode: "2ed",
    rarity: "rare",
};

export const moxSapphire2ed: CardPrint = {
    printId: "f7d82f1d-631e-4668-9d10-7bf0ee515267",
    definitionId: "82da0972-b17b-4600-9efd-e9430a0db04b", // Mox Sapphire
    setCode: "2ed",
    rarity: "rare",
};

export const naturalSelection2ed: CardPrint = {
    printId: "315a6bfb-5417-465f-97d9-e157f5c3cf79",
    definitionId: "a8917dc8-01c0-4e72-9310-c4d501775411", // Natural Selection
    setCode: "2ed",
    rarity: "rare",
};

export const netherShadow2ed: CardPrint = {
    printId: "18e057ae-8e60-478c-b047-605dab356835",
    definitionId: "f13ad58a-6f9b-420a-bac1-40929f5e616a", // Nether Shadow
    setCode: "2ed",
    rarity: "rare",
};

export const nettlingImp2ed: CardPrint = {
    printId: "96706002-176d-41f7-9788-3d0f7962ea03",
    definitionId: "8105973c-a94d-444c-ba20-ab0fa978bee8", // Nettling Imp
    setCode: "2ed",
    rarity: "uncommon",
};

export const nevinyrralSDisk2ed: CardPrint = {
    printId: "8436c720-ff96-4475-8320-d0d1e0c23f2a",
    definitionId: "12926dc8-8e6f-4a47-a12b-4d674189615a", // Nevinyrral's Disk
    setCode: "2ed",
    rarity: "rare",
};

export const nightmare2ed: CardPrint = {
    printId: "747d4c99-0287-4138-af13-6244f33d2e57",
    definitionId: "b8cdd6a7-f772-4ccb-914f-63f52ed54d6b", // Nightmare
    setCode: "2ed",
    rarity: "rare",
};

export const northernPaladin2ed: CardPrint = {
    printId: "309cd081-13bb-428b-b561-60b7a81c0f1d",
    definitionId: "6303233b-35eb-49ca-b844-ba6b9fe1cbd2", // Northern Paladin
    setCode: "2ed",
    rarity: "rare",
};

export const obsianusGolem2ed: CardPrint = {
    printId: "9646da70-329f-41a2-9453-4ec6a9c9e7e4",
    definitionId: "4c8e9f5c-deba-4443-bf9d-fb2be75c5418", // Obsianus Golem
    setCode: "2ed",
    rarity: "uncommon",
};

export const orcishArtillery2ed: CardPrint = {
    printId: "da899c3d-c424-4901-ae5a-2a8e0c66e631",
    definitionId: "a97208b1-a91b-4129-8a00-2f97b418accc", // Orcish Artillery
    setCode: "2ed",
    rarity: "uncommon",
};

export const orcishOriflamme2ed: CardPrint = {
    printId: "def20e99-7a94-4b24-87fb-758ede816b57",
    definitionId: "911538ea-322c-4c40-a9c3-35e47fe60fce", // Orcish Oriflamme
    setCode: "2ed",
    rarity: "uncommon",
};

export const paralyze2ed: CardPrint = {
    printId: "e21b04cd-2d43-4d64-a1c2-46a9f02508d6",
    definitionId: "be33a155-de26-43d1-88f1-c926f1b7cb7c", // Paralyze
    setCode: "2ed",
    rarity: "common",
};

export const pearledUnicorn2ed: CardPrint = {
    printId: "9254b0be-d350-41c1-8ed9-41a22525adf9",
    definitionId: "6daf1aab-1e58-4a5a-bc66-cb3f7c86e0e8", // Pearled Unicorn
    setCode: "2ed",
    rarity: "common",
};

export const personalIncarnation2ed: CardPrint = {
    printId: "19272824-a0a4-4352-8904-a185516c95e1",
    definitionId: "caf9cef4-0f2d-478a-b119-fe1967687f74", // Personal Incarnation
    setCode: "2ed",
    rarity: "rare",
};

export const pestilence2ed: CardPrint = {
    printId: "2be5a75e-2fef-4205-bdec-5ea0d1dd0733",
    definitionId: "d42a6350-b16b-4e10-a273-e6cbb55dcb7a", // Pestilence
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

export const plagueRats2ed: CardPrint = {
    printId: "f2a5bd30-a11f-4218-aca6-3183d82d02b9",
    definitionId: "b3724e40-0622-4aee-9334-6c9fff88bcd5", // Plague Rats
    setCode: "2ed",
    rarity: "common",
};

export const plains2ed: CardPrint = {
    printId: "034b047d-6363-45ca-9948-8184f822a2cb",
    definitionId: "b1623d57-4729-4796-b3f7-f1837a05c6ed", // Plains
    setCode: "2ed",
    rarity: "common",
};

export const plains22ed: CardPrint = {
    printId: "0e7eede2-e682-43b5-b5b7-a61fb8e98082",
    definitionId: "b1623d57-4729-4796-b3f7-f1837a05c6ed", // Plains
    setCode: "2ed",
    rarity: "common",
};

export const plains32ed: CardPrint = {
    printId: "ee7cfabc-902f-46f7-b1de-fa0a88c8f852",
    definitionId: "b1623d57-4729-4796-b3f7-f1837a05c6ed", // Plains
    setCode: "2ed",
    rarity: "common",
};

export const plateau2ed: CardPrint = {
    printId: "de38f96c-5d17-4cf2-9951-f0866eadd011",
    definitionId: "6eafa00b-c628-40f6-86eb-88e1361fc7a0", // Plateau
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

export const powerSurge2ed: CardPrint = {
    printId: "98ac9e72-603b-43cf-b959-03552c44ae22",
    definitionId: "62858604-ca5a-4f69-a045-a7515ebfabf2", // Power Surge
    setCode: "2ed",
    rarity: "rare",
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

export const purelace2ed: CardPrint = {
    printId: "bd89c79a-668e-4f3c-b248-6f067e6fca65",
    definitionId: "2facf462-55cd-4da4-997f-2cf4add75628", // Purelace
    setCode: "2ed",
    rarity: "rare",
};

export const ragingRiver2ed: CardPrint = {
    printId: "7ee63877-056e-413d-932a-a393a4183686",
    definitionId: "61e4f56d-1f4f-49f2-8534-0d09196a3327", // Raging River
    setCode: "2ed",
    rarity: "rare",
};

export const raiseDead2ed: CardPrint = {
    printId: "990dc823-881d-40ea-9731-d3f19c41aadc",
    definitionId: "ce07bede-2219-427c-a61a-56518751de42", // Raise Dead
    setCode: "2ed",
    rarity: "common",
};

export const redElementalBlast2ed: CardPrint = {
    printId: "1c69e1c9-e8ed-4497-8098-0d412a09c0f9",
    definitionId: "776ad9be-3309-4f1d-9f27-6219d9477662", // Red Elemental Blast
    setCode: "2ed",
    rarity: "common",
};

export const redWard2ed: CardPrint = {
    printId: "03d818b4-4722-4035-a2bc-ebc4c8c90ec0",
    definitionId: "e0c64c01-c2aa-470b-88c6-3d3e4a969649", // Red Ward
    setCode: "2ed",
    rarity: "uncommon",
};

export const regeneration2ed: CardPrint = {
    printId: "b523f013-3dbd-4b5c-9433-cdec7dc737ba",
    definitionId: "b7b7aa34-b4f8-41b4-82ce-ab2e204c3bf4", // Regeneration
    setCode: "2ed",
    rarity: "common",
};

export const regrowth2ed: CardPrint = {
    printId: "2d764cd4-0cec-425c-8cc4-68a81c1f296b",
    definitionId: "badc73ec-3728-4246-90c7-5f4eb7051ed5", // Regrowth
    setCode: "2ed",
    rarity: "uncommon",
};

export const resurrection2ed: CardPrint = {
    printId: "609f6e06-daaa-4b15-a167-dc3ed6ce33cc",
    definitionId: "4fff6e6f-4ebd-4ec8-9443-59efb22d376c", // Resurrection
    setCode: "2ed",
    rarity: "uncommon",
};

export const reverseDamage2ed: CardPrint = {
    printId: "7f83f4fa-9c22-4bcb-8de0-f40f208128d1",
    definitionId: "943baea8-b173-4863-a3ab-dd217d483cd9", // Reverse Damage
    setCode: "2ed",
    rarity: "rare",
};

export const righteousness2ed: CardPrint = {
    printId: "ddb92543-e601-4575-8e17-84ec0b1edd66",
    definitionId: "d0ba7b76-f3d0-47d0-8a35-0c08e67200fb", // Righteousness
    setCode: "2ed",
    rarity: "rare",
};

export const rockHydra2ed: CardPrint = {
    printId: "aae6ce4f-d3ba-4b6c-a9c3-9ecbc7a3d5c8",
    definitionId: "410ac9e6-fbc1-4cc8-84db-84e2eb1bab97", // Rock Hydra
    setCode: "2ed",
    rarity: "rare",
};

export const rocOfKherRidges2ed: CardPrint = {
    printId: "7509b414-aea1-4f87-993a-ee7b9aee509b",
    definitionId: "731a4b86-c213-4d8e-bf01-0a0e8cff0ff1", // Roc of Kher Ridges
    setCode: "2ed",
    rarity: "rare",
};

export const rodOfRuin2ed: CardPrint = {
    printId: "0f047f5b-af97-4662-ab06-698a5f6f5a57",
    definitionId: "af957200-c538-4f52-b105-6db7a7abb4dc", // Rod of Ruin
    setCode: "2ed",
    rarity: "uncommon",
};

export const royalAssassin2ed: CardPrint = {
    printId: "5cceb11b-0f70-4749-8a8c-d698cd01cd6e",
    definitionId: "59590768-fa96-4869-8763-9d5ab6ac22ad", // Royal Assassin
    setCode: "2ed",
    rarity: "rare",
};

export const sacrifice2ed: CardPrint = {
    printId: "288323c1-13f1-481e-940e-5e4ecebb404e",
    definitionId: "12164aee-6a27-4246-8d15-2d6dd20d92e9", // Sacrifice
    setCode: "2ed",
    rarity: "uncommon",
};

export const samiteHealer2ed: CardPrint = {
    printId: "7281e17d-a6e0-4e0e-8ee6-c6d9dec54231",
    definitionId: "efba235e-04e5-449c-906c-0ac33f6d7929", // Samite Healer
    setCode: "2ed",
    rarity: "common",
};

export const savannah2ed: CardPrint = {
    printId: "38937c61-280e-457f-aef9-43139446163a",
    definitionId: "94f7e24c-2546-41b6-81ad-5e920b07e64e", // Savannah
    setCode: "2ed",
    rarity: "rare",
};

export const savannahLions2ed: CardPrint = {
    printId: "3da61fc1-6201-4823-975f-2d4d9f7f3193",
    definitionId: "d05b92bd-797e-413f-a8b0-32e0937a1ee0", // Savannah Lions
    setCode: "2ed",
    rarity: "rare",
};

export const scatheZombies2ed: CardPrint = {
    printId: "08e060d5-85f2-46a7-9f05-8a8c713ea999",
    definitionId: "e9be6dcf-5e25-4b8c-9cd0-badf3771f81e", // Scathe Zombies
    setCode: "2ed",
    rarity: "common",
};

export const scavengingGhoul2ed: CardPrint = {
    printId: "12459e80-2878-4a76-b45a-478ee3b0f7a4",
    definitionId: "426984e0-88e1-4a2d-9a1c-798b95864df3", // Scavenging Ghoul
    setCode: "2ed",
    rarity: "uncommon",
};

export const scrubland2ed: CardPrint = {
    printId: "7e18d625-0950-4062-8d41-f8b681eff234",
    definitionId: "bebe39d4-21fb-46a4-a1ec-b97102e46c15", // Scrubland
    setCode: "2ed",
    rarity: "rare",
};

export const scrybSprites2ed: CardPrint = {
    printId: "e9e2f1fe-4df0-48c8-b469-4175ba5011e8",
    definitionId: "6d929c38-91e6-457c-937a-d1884f4bba44", // Scryb Sprites
    setCode: "2ed",
    rarity: "common",
};

export const seaSerpent2ed: CardPrint = {
    printId: "af430730-2ce8-45c3-b1da-9745fc792d71",
    definitionId: "d0b333b7-db4d-4439-b0de-60414cbf8d7b", // Sea Serpent
    setCode: "2ed",
    rarity: "common",
};

export const sedgeTroll2ed: CardPrint = {
    printId: "5a30ed3f-0b21-45ea-83af-339249b4e93e",
    definitionId: "b13bf496-f3c0-4c13-8282-e7abfab6a198", // Sedge Troll
    setCode: "2ed",
    rarity: "rare",
};

export const sengirVampire2ed: CardPrint = {
    printId: "ffd7ca8e-6437-4b85-81dd-7173200dcec7",
    definitionId: "510840f4-7c0e-4b47-8ebf-23c20cac4bd9", // Sengir Vampire
    setCode: "2ed",
    rarity: "uncommon",
};

export const serraAngel2ed: CardPrint = {
    printId: "1941cf19-b1f6-4148-a1de-6d03531f2f1c",
    definitionId: "f8ac5006-91bd-4803-93da-f87cf196dd2f", // Serra Angel
    setCode: "2ed",
    rarity: "uncommon",
};

export const shanodinDryads2ed: CardPrint = {
    printId: "b25f298a-9784-4192-b640-caec2b94ba4c",
    definitionId: "814cf35c-f1ad-4bf4-8c10-a5592c3b1be8", // Shanodin Dryads
    setCode: "2ed",
    rarity: "common",
};

export const shatter2ed: CardPrint = {
    printId: "80f3aef5-c997-4852-8c13-a4d2c22d9c95",
    definitionId: "50dc7fc1-cb6a-4c68-b993-1a25cf16226e", // Shatter
    setCode: "2ed",
    rarity: "common",
};

export const shivanDragon2ed: CardPrint = {
    printId: "fd4f6e34-3f66-4e10-8170-56039c5f6fcc",
    definitionId: "fefbf149-f988-4f8b-9f53-56f5878116a6", // Shivan Dragon
    setCode: "2ed",
    rarity: "rare",
};

export const simulacrum2ed: CardPrint = {
    printId: "a80e1e4c-4b53-41d2-b038-2f9135d8455d",
    definitionId: "35c3a78d-cc79-4187-929a-8aa1d1469990", // Simulacrum
    setCode: "2ed",
    rarity: "uncommon",
};

export const sinkhole2ed: CardPrint = {
    printId: "485cef94-d7aa-4bb3-b2e6-61d0ccf8007e",
    definitionId: "04b31611-9053-4eaf-b392-21bb644fef5f", // Sinkhole
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

export const smoke2ed: CardPrint = {
    printId: "4d2553c0-1105-4eed-baf2-e13f1005dfb7",
    definitionId: "7c67788e-d713-47c3-ab9f-b8a6212ae24f", // Smoke
    setCode: "2ed",
    rarity: "rare",
};

export const solRing2ed: CardPrint = {
    printId: "e07f656c-97b5-4147-821a-edbb49f34e19",
    definitionId: "c4300d24-1cae-4dd5-be7e-38cc677cf5bd", // Sol Ring
    setCode: "2ed",
    rarity: "uncommon",
};

export const soulNet2ed: CardPrint = {
    printId: "0f586dd9-bb47-411d-9652-05de4651b146",
    definitionId: "2b814198-814b-4619-a158-327af675f8f2", // Soul Net
    setCode: "2ed",
    rarity: "uncommon",
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

export const stoneGiant2ed: CardPrint = {
    printId: "64dad66b-403b-4af6-b6eb-c123567e2b86",
    definitionId: "7ffaedb9-25f8-4304-9085-e12505b93312", // Stone Giant
    setCode: "2ed",
    rarity: "uncommon",
};

export const stoneRain2ed: CardPrint = {
    printId: "cdb490bb-43fe-49ab-a094-438585677801",
    definitionId: "57ff74cb-a2ed-4123-ac42-f72f9820049e", // Stone Rain
    setCode: "2ed",
    rarity: "common",
};

export const streamOfLife2ed: CardPrint = {
    printId: "70e476cb-8b72-434c-b5e9-0fd0319a1bff",
    definitionId: "aa1c4d4b-2645-4cd9-823e-3c9bb2eb48f9", // Stream of Life
    setCode: "2ed",
    rarity: "common",
};

export const sunglassesOfUrza2ed: CardPrint = {
    printId: "b894acd5-818b-4ac5-bbf8-47db2ed9a825",
    definitionId: "c0d433a4-76c0-4f27-836d-4c0c13a511fb", // Sunglasses of Urza
    setCode: "2ed",
    rarity: "rare",
};

export const swamp2ed: CardPrint = {
    printId: "92f7a995-c648-4835-8df3-135d7472cd2d",
    definitionId: "6176936d-72e2-4205-8871-4c5a4f1cb2d8", // Swamp
    setCode: "2ed",
    rarity: "common",
};

export const swamp22ed: CardPrint = {
    printId: "cba6da22-2366-4f16-84ce-47f84ea14523",
    definitionId: "6176936d-72e2-4205-8871-4c5a4f1cb2d8", // Swamp
    setCode: "2ed",
    rarity: "common",
};

export const swamp32ed: CardPrint = {
    printId: "c78bad70-2aec-4580-a777-483d72db8d90",
    definitionId: "6176936d-72e2-4205-8871-4c5a4f1cb2d8", // Swamp
    setCode: "2ed",
    rarity: "common",
};

export const swordsToPlowshares2ed: CardPrint = {
    printId: "50fc5b10-6215-48a9-8993-b61681f61186",
    definitionId: "386ea9eb-abc1-4862-aa2d-8fb808d79490", // Swords to Plowshares
    setCode: "2ed",
    rarity: "uncommon",
};

export const taiga2ed: CardPrint = {
    printId: "01006833-6007-4c16-9ebb-20d31c60a57a",
    definitionId: "60df6592-0b3b-4b87-aeb2-8fa94b4fb7be", // Taiga
    setCode: "2ed",
    rarity: "rare",
};

export const terror2ed: CardPrint = {
    printId: "df3c25cc-5705-4deb-be61-07a8a2716c86",
    definitionId: "21004958-2c7e-4a55-bc80-411c4d780106", // Terror
    setCode: "2ed",
    rarity: "common",
};

export const theHive2ed: CardPrint = {
    printId: "af5534f0-485e-41f2-bcfa-d65c1a9b86bd",
    definitionId: "544a7138-eae8-4ff9-9e17-680bfa717183", // The Hive
    setCode: "2ed",
    rarity: "rare",
};

export const thicketBasilisk2ed: CardPrint = {
    printId: "32401b72-e351-45fa-a16e-33cc818a07e0",
    definitionId: "e92cce01-b3bd-4307-aae5-9a7c8fa386ab", // Thicket Basilisk
    setCode: "2ed",
    rarity: "uncommon",
};

export const thoughtlace2ed: CardPrint = {
    printId: "b8859cf0-e4c3-4044-9674-d0703646d72e",
    definitionId: "23749375-1416-47a4-9251-52f41fe2fae9", // Thoughtlace
    setCode: "2ed",
    rarity: "rare",
};

export const throneOfBone2ed: CardPrint = {
    printId: "5a242eb1-8625-4063-9376-a1df32547b58",
    definitionId: "a2931ae0-7836-4000-b9ec-f2029ebf5d96", // Throne of Bone
    setCode: "2ed",
    rarity: "uncommon",
};

export const timberWolves2ed: CardPrint = {
    printId: "0d24fc87-7b30-4c99-a525-b1746821391c",
    definitionId: "bc2570a4-eef9-430d-b6c2-cd51d29b9d01", // Timber Wolves
    setCode: "2ed",
    rarity: "rare",
};

export const timetwister2ed: CardPrint = {
    printId: "01bda3d7-122a-48a0-bab3-676c4a557b74",
    definitionId: "9a49dc44-616e-4bdd-8220-0bb71eccc512", // Timetwister
    setCode: "2ed",
    rarity: "rare",
};

export const timeVault2ed: CardPrint = {
    printId: "0b64dd0f-2e99-41bd-87aa-f623582d64d0",
    definitionId: "902441dc-c976-4c92-b897-6376eaa0fe38", // Time Vault
    setCode: "2ed",
    rarity: "rare",
};

export const timeWalk2ed: CardPrint = {
    printId: "ade7d00d-4e7b-46e9-ace1-63f628a589fc",
    definitionId: "e0139f60-d48e-46fb-9f5a-1e3d7558c834", // Time Walk
    setCode: "2ed",
    rarity: "rare",
};

export const tranquility2ed: CardPrint = {
    printId: "fc24f763-4c7f-45e4-933b-573d1ace1ddc",
    definitionId: "774cc5a6-3a69-4812-add4-eb5eb6389238", // Tranquility
    setCode: "2ed",
    rarity: "common",
};

export const tropicalIsland2ed: CardPrint = {
    printId: "856bf0ba-e5a5-47eb-9a6a-111935088c31",
    definitionId: "a9c6c759-aabf-44e7-ba8c-33c5df232b56", // Tropical Island
    setCode: "2ed",
    rarity: "rare",
};

export const tsunami2ed: CardPrint = {
    printId: "b8328ddc-d2d9-47d3-a98b-1a7c7b0c75a3",
    definitionId: "9ed67d61-cf47-446b-b454-eb404a8686b7", // Tsunami
    setCode: "2ed",
    rarity: "uncommon",
};

export const tundra2ed: CardPrint = {
    printId: "0d08f5e4-d2d3-4659-86d4-a983d80e3b2c",
    definitionId: "a03e8c5b-f4ed-4fd7-ba05-db813ccc05eb", // Tundra
    setCode: "2ed",
    rarity: "rare",
};

export const tunnel2ed: CardPrint = {
    printId: "a0176176-0530-43e6-85e4-d1f4296f0697",
    definitionId: "b21ebc9f-a93e-4d18-b3e8-8459e3abbf31", // Tunnel
    setCode: "2ed",
    rarity: "uncommon",
};

export const twiddle2ed: CardPrint = {
    printId: "ba01195b-05a0-4de7-807e-934e71feb8c7",
    definitionId: "576e811f-26a3-4a7c-bd13-3b1cc3e184eb", // Twiddle
    setCode: "2ed",
    rarity: "common",
};

export const twoHeadedGiantOfForiys2ed: CardPrint = {
    printId: "67299451-5302-4639-a4bc-6109521a2c0c",
    definitionId: "31c687dc-ee0c-4e54-a2b3-5d8e633b3245", // Two-Headed Giant of Foriys
    setCode: "2ed",
    rarity: "rare",
};

export const undergroundSea2ed: CardPrint = {
    printId: "bc98d888-4af3-43a3-b035-40c651057b6e",
    definitionId: "ff76ac86-8a8a-47fe-9388-8950ca3e26c3", // Underground Sea
    setCode: "2ed",
    rarity: "rare",
};

export const unholyStrength2ed: CardPrint = {
    printId: "7150245a-4fed-47cd-b13f-24507e89449d",
    definitionId: "90563f90-0127-4164-b43b-f0321dc63a1d", // Unholy Strength
    setCode: "2ed",
    rarity: "common",
};

export const unsummon2ed: CardPrint = {
    printId: "0a681487-951d-4ff1-ab08-bc173ea022e8",
    definitionId: "8512f2c1-6361-4b79-843f-80b6bceeeb99", // Unsummon
    setCode: "2ed",
    rarity: "common",
};

export const uthdenTroll2ed: CardPrint = {
    printId: "30bb1158-fe16-49e6-9b7a-44b7bee84737",
    definitionId: "2ff21a6f-83a7-4bf3-a078-294e303232cc", // Uthden Troll
    setCode: "2ed",
    rarity: "uncommon",
};

export const verduranEnchantress2ed: CardPrint = {
    printId: "55454150-de1b-4921-9c23-7d10724c2ee7",
    definitionId: "9f87178b-1221-4d7a-a7a5-20d7f01b8089", // Verduran Enchantress
    setCode: "2ed",
    rarity: "rare",
};

export const vesuvanDoppelganger2ed: CardPrint = {
    printId: "408ec348-183b-43de-abac-7ae9e3843c10",
    definitionId: "768f3a05-bd06-4a23-b9f2-94f6e618fd9f", // Vesuvan Doppelganger
    setCode: "2ed",
    rarity: "rare",
};

export const veteranBodyguard2ed: CardPrint = {
    printId: "8d693da0-039d-462b-a5cb-d2bb179df65e",
    definitionId: "cbd9ab01-a833-4fa4-8dee-151bd9800835", // Veteran Bodyguard
    setCode: "2ed",
    rarity: "rare",
};

export const volcanicEruption2ed: CardPrint = {
    printId: "6d7c78a4-e3db-42bf-8365-d7a08c26f4a9",
    definitionId: "a80582b1-09db-45f8-b362-0e5207a5a8e6", // Volcanic Eruption
    setCode: "2ed",
    rarity: "rare",
};

export const volcanicIsland2ed: CardPrint = {
    printId: "9dc7ab05-a5f5-4a02-87e7-3c47be35b5cb",
    definitionId: "0324641d-af55-4c53-b4dc-c8262e967da5", // Volcanic Island
    setCode: "2ed",
    rarity: "rare",
};

export const wallOfAir2ed: CardPrint = {
    printId: "d672107f-e274-4a0e-888a-c2aa59a2fab5",
    definitionId: "da56fdf3-6a8f-4833-a5c3-197650cc4889", // Wall of Air
    setCode: "2ed",
    rarity: "uncommon",
};

export const wallOfBone2ed: CardPrint = {
    printId: "ed63a624-dc31-4461-9cda-589a84dc5a40",
    definitionId: "ae20d442-a544-4a03-9ebf-5ecb137c67dd", // Wall of Bone
    setCode: "2ed",
    rarity: "uncommon",
};

export const wallOfBrambles2ed: CardPrint = {
    printId: "5ae21e65-fc55-4a90-806e-452ef0ad5e3a",
    definitionId: "af2a4558-db6e-41b2-aff6-b164d93282a0", // Wall of Brambles
    setCode: "2ed",
    rarity: "uncommon",
};

export const wallOfFire2ed: CardPrint = {
    printId: "74841ee8-2af0-4019-898d-d0ce72fc62c3",
    definitionId: "efcf12cd-fb70-444e-9641-73ffa0e8f16e", // Wall of Fire
    setCode: "2ed",
    rarity: "uncommon",
};

export const wallOfIce2ed: CardPrint = {
    printId: "d79867a0-c525-4e91-8942-c61b41f9150c",
    definitionId: "cc743a03-867c-4bb0-8fb0-2bcaa0a8a756", // Wall of Ice
    setCode: "2ed",
    rarity: "uncommon",
};

export const wallOfStone2ed: CardPrint = {
    printId: "2a2cab55-fc64-4b3f-bc46-a1a297d2d448",
    definitionId: "140e567c-6e4a-42b0-8084-d6c9695ae802", // Wall of Stone
    setCode: "2ed",
    rarity: "uncommon",
};

export const wallOfSwords2ed: CardPrint = {
    printId: "0437a9e4-df29-4fbb-8c99-05e5d30a18e3",
    definitionId: "99ec4723-b36c-4015-b361-736a6523e8f5", // Wall of Swords
    setCode: "2ed",
    rarity: "uncommon",
};

export const wallOfWater2ed: CardPrint = {
    printId: "f97f5b6e-7997-498a-9b27-ac2873f425dd",
    definitionId: "41faed1a-ded8-49ee-8e2a-c60d377775d7", // Wall of Water
    setCode: "2ed",
    rarity: "uncommon",
};

export const wallOfWood2ed: CardPrint = {
    printId: "b55d8375-ea70-4dd0-950e-3dbf3dfdd4f6",
    definitionId: "8df80424-3bd9-4982-ad79-e55d9ba3b43d", // Wall of Wood
    setCode: "2ed",
    rarity: "common",
};

export const wanderlust2ed: CardPrint = {
    printId: "3ee3c4fc-342f-48b3-a799-0db4b005195a",
    definitionId: "220a03ca-8c9b-4acb-821d-f6577fbb20fb", // Wanderlust
    setCode: "2ed",
    rarity: "uncommon",
};

export const warMammoth2ed: CardPrint = {
    printId: "c9ee4dea-20b2-43ed-a6d5-f2d62b0e189b",
    definitionId: "c8d6081e-f686-4263-a0a2-21c0d9af5fdb", // War Mammoth
    setCode: "2ed",
    rarity: "common",
};

export const warpArtifact2ed: CardPrint = {
    printId: "d1320d4a-ecfc-4cd5-bc6b-445f63c17b27",
    definitionId: "9e5e07a2-fbdf-4c4c-996a-fce40bab5de5", // Warp Artifact
    setCode: "2ed",
    rarity: "rare",
};

export const waterElemental2ed: CardPrint = {
    printId: "c498c898-1671-4632-b69a-0e1e9b8d05b8",
    definitionId: "8de940d6-98c0-46a9-b5fd-e2b0899ea19e", // Water Elemental
    setCode: "2ed",
    rarity: "uncommon",
};

export const weakness2ed: CardPrint = {
    printId: "b1646d85-2396-445c-9bbb-65bf65b0a63c",
    definitionId: "36ca06a1-9b9a-49a2-9c47-9b72228621bc", // Weakness
    setCode: "2ed",
    rarity: "common",
};

export const web2ed: CardPrint = {
    printId: "6fbbac49-9117-4e15-89e8-98387f7511ed",
    definitionId: "37c7890a-86dc-4a97-a7ce-1436fa22d0c0", // Web
    setCode: "2ed",
    rarity: "rare",
};

export const wheelOfFortune2ed: CardPrint = {
    printId: "4407fb95-0ed2-4c95-91b9-09eb52bf537e",
    definitionId: "67b369c4-faa8-45c8-a1b9-98f228b69682", // Wheel of Fortune
    setCode: "2ed",
    rarity: "rare",
};

export const whiteKnight2ed: CardPrint = {
    printId: "8e4c578c-1c36-4c29-86a5-7a664ffe34d0",
    definitionId: "50abfba8-c9f9-4ebf-965a-4b425fe83129", // White Knight
    setCode: "2ed",
    rarity: "uncommon",
};

export const whiteWard2ed: CardPrint = {
    printId: "77cbc0fa-d5b8-412a-bdca-7f62d8d1ce1e",
    definitionId: "49b22665-1501-420a-82ad-f71f6768bcf8", // White Ward
    setCode: "2ed",
    rarity: "uncommon",
};

export const wildGrowth2ed: CardPrint = {
    printId: "b7425741-5d7c-4016-8d42-ec8b7353116b",
    definitionId: "fd896dfa-66c0-4327-8e5b-489bbe350c95", // Wild Growth
    setCode: "2ed",
    rarity: "common",
};

export const willOTheWisp2ed: CardPrint = {
    printId: "73a2a070-464e-4749-87f1-2df5c8b2a93b",
    definitionId: "a1a6f8e9-7bc1-4151-b55f-acf877b1a7a6", // Will-o'-the-Wisp
    setCode: "2ed",
    rarity: "rare",
};

export const winterOrb2ed: CardPrint = {
    printId: "ee9eb598-d2ef-4b3d-8038-bc33dc5e123e",
    definitionId: "9359f60c-9a27-4e53-b35b-964a121a6fba", // Winter Orb
    setCode: "2ed",
    rarity: "rare",
};

export const woodenSphere2ed: CardPrint = {
    printId: "fb19b35e-e0b9-4575-b146-2682ad8a5175",
    definitionId: "bcae01a2-171b-47cd-87be-f1e4e5314326", // Wooden Sphere
    setCode: "2ed",
    rarity: "uncommon",
};

export const wrathOfGod2ed: CardPrint = {
    printId: "e57404bc-44ba-4909-87da-f4a71673168d",
    definitionId: "a2788d69-6a3a-42f0-8736-cc6b57755ecd", // Wrath of God
    setCode: "2ed",
    rarity: "rare",
};

export const zombieMaster2ed: CardPrint = {
    printId: "d9b2accc-11e8-4bfd-97fc-d2f6bcd94c26",
    definitionId: "3d4255a0-d445-4c00-b936-bbf07851e1c8", // Zombie Master
    setCode: "2ed",
    rarity: "rare",
};
