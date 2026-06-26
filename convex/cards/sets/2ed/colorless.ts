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

export const ankhOfMishra2ed: CardPrint = {
    printId: "808cad10-69d5-4e14-9834-476c53ec97e4",
    definitionId: "f594b7aa-d44e-47c4-989b-565f881e25f1", // Ankh of Mishra
    setCode: "2ed",
    rarity: "rare",
};

export const badlands2ed: CardPrint = {
    printId: "5804dcd3-d41d-4cbd-9f8f-9736f2d37a64",
    definitionId: "717f6d10-9144-4ade-9ac6-a481cc66b875", // Badlands
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

export const celestialPrism2ed: CardPrint = {
    printId: "cb119f5e-a47f-4910-b170-561d6315fdc3",
    definitionId: "a47417cb-1ea7-4f65-ba06-e27a99373114", // Celestial Prism
    setCode: "2ed",
    rarity: "uncommon",
};

export const clockworkBeast2ed: CardPrint = {
    printId: "c7741816-0bc1-4540-b4b2-006275ffe572",
    definitionId: "27f916a2-0ace-44b5-99dc-72979af34db9", // Clockwork Beast
    setCode: "2ed",
    rarity: "rare",
};

export const conservator2ed: CardPrint = {
    printId: "744e7821-8bfd-4816-a8af-4e6fe7b35505",
    definitionId: "c7824e2a-4eff-4f72-9216-0db30a4f4252", // Conservator
    setCode: "2ed",
    rarity: "uncommon",
};

export const copperTablet2ed: CardPrint = {
    printId: "c17cb591-916e-4176-aeb9-e2275d68d472",
    definitionId: "30935e4a-013e-4c46-ad05-304df8e5dfa4", // Copper Tablet
    setCode: "2ed",
    rarity: "uncommon",
};

export const crystalRod2ed: CardPrint = {
    printId: "00c92601-11b9-4e7c-bc81-882085f3fae6",
    definitionId: "76693233-7961-4b7e-80f2-ed90e494c4aa", // Crystal Rod
    setCode: "2ed",
    rarity: "uncommon",
};

export const cyclopeanTomb2ed: CardPrint = {
    printId: "a184cd2e-e27f-44b0-a8ae-9d861280e469",
    definitionId: "894c5cf2-8ae2-427a-bcbc-67df0bdfee9d", // Cyclopean Tomb
    setCode: "2ed",
    rarity: "rare",
};

export const dingusEgg2ed: CardPrint = {
    printId: "a804f742-f7cf-427e-ad0a-742587328156",
    definitionId: "65eb6cda-e512-40a8-9c1f-335b713409ff", // Dingus Egg
    setCode: "2ed",
    rarity: "rare",
};

export const disruptingScepter2ed: CardPrint = {
    printId: "0c58f236-0b2c-4b71-8819-1beaea7ded17",
    definitionId: "ca571ee8-07a2-43b8-9acf-89cbfd3cf7c9", // Disrupting Scepter
    setCode: "2ed",
    rarity: "rare",
};

export const forcefield2ed: CardPrint = {
    printId: "239a5d29-95cf-468a-8b07-aea1f7dc8d52",
    definitionId: "3f2004c1-8efe-407f-bf48-27b807422eea", // Forcefield
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

export const gauntletOfMight2ed: CardPrint = {
    printId: "407650c3-9388-45c3-a599-6929c7d6e5bd",
    definitionId: "da248001-ed75-4b68-9532-37d3cd5afc4c", // Gauntlet of Might
    setCode: "2ed",
    rarity: "rare",
};

export const glassesOfUrza2ed: CardPrint = {
    printId: "c8635a10-12fc-4308-8f1e-6c4bc6acd9b5",
    definitionId: "cafc2350-5d64-4379-9198-79a114654d45", // Glasses of Urza
    setCode: "2ed",
    rarity: "uncommon",
};

export const helmOfChatzuk2ed: CardPrint = {
    printId: "b0d2c643-39cc-47f8-9f70-327f004c1373",
    definitionId: "3792c6ef-c4e6-4923-9a51-7d28fbc5c393", // Helm of Chatzuk
    setCode: "2ed",
    rarity: "rare",
};

export const howlingMine2ed: CardPrint = {
    printId: "c69d4007-d26b-442b-9c34-d3780c46c5f6",
    definitionId: "51f8f6e1-a451-4262-90d3-5107caf54175", // Howling Mine
    setCode: "2ed",
    rarity: "rare",
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

export const kormusBell2ed: CardPrint = {
    printId: "736e4586-a6c6-42c0-8555-5f09d214e1cb",
    definitionId: "3f4ef7a1-148d-44ac-89ed-0ef379cca0c6", // Kormus Bell
    setCode: "2ed",
    rarity: "rare",
};

export const libraryOfLeng2ed: CardPrint = {
    printId: "502d77d6-c5c9-4def-80cb-7905fbbdefcb",
    definitionId: "2340edcb-8cd5-4ccd-99e2-b9a29f72c495", // Library of Leng
    setCode: "2ed",
    rarity: "uncommon",
};

export const livingWall2ed: CardPrint = {
    printId: "3035651f-a2b5-49c1-a768-1f510a31a9d8",
    definitionId: "4a98ada6-923a-44a5-bdef-ea6a160b481e", // Living Wall
    setCode: "2ed",
    rarity: "uncommon",
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

export const nevinyrralSDisk2ed: CardPrint = {
    printId: "8436c720-ff96-4475-8320-d0d1e0c23f2a",
    definitionId: "12926dc8-8e6f-4a47-a12b-4d674189615a", // Nevinyrral's Disk
    setCode: "2ed",
    rarity: "rare",
};

export const obsianusGolem2ed: CardPrint = {
    printId: "9646da70-329f-41a2-9453-4ec6a9c9e7e4",
    definitionId: "4c8e9f5c-deba-4443-bf9d-fb2be75c5418", // Obsianus Golem
    setCode: "2ed",
    rarity: "uncommon",
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

export const rodOfRuin2ed: CardPrint = {
    printId: "0f047f5b-af97-4662-ab06-698a5f6f5a57",
    definitionId: "af957200-c538-4f52-b105-6db7a7abb4dc", // Rod of Ruin
    setCode: "2ed",
    rarity: "uncommon",
};

export const savannah2ed: CardPrint = {
    printId: "38937c61-280e-457f-aef9-43139446163a",
    definitionId: "94f7e24c-2546-41b6-81ad-5e920b07e64e", // Savannah
    setCode: "2ed",
    rarity: "rare",
};

export const scrubland2ed: CardPrint = {
    printId: "7e18d625-0950-4062-8d41-f8b681eff234",
    definitionId: "bebe39d4-21fb-46a4-a1ec-b97102e46c15", // Scrubland
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

export const taiga2ed: CardPrint = {
    printId: "01006833-6007-4c16-9ebb-20d31c60a57a",
    definitionId: "60df6592-0b3b-4b87-aeb2-8fa94b4fb7be", // Taiga
    setCode: "2ed",
    rarity: "rare",
};

export const theHive2ed: CardPrint = {
    printId: "af5534f0-485e-41f2-bcfa-d65c1a9b86bd",
    definitionId: "544a7138-eae8-4ff9-9e17-680bfa717183", // The Hive
    setCode: "2ed",
    rarity: "rare",
};

export const throneOfBone2ed: CardPrint = {
    printId: "5a242eb1-8625-4063-9376-a1df32547b58",
    definitionId: "a2931ae0-7836-4000-b9ec-f2029ebf5d96", // Throne of Bone
    setCode: "2ed",
    rarity: "uncommon",
};

export const timeVault2ed: CardPrint = {
    printId: "0b64dd0f-2e99-41bd-87aa-f623582d64d0",
    definitionId: "902441dc-c976-4c92-b897-6376eaa0fe38", // Time Vault
    setCode: "2ed",
    rarity: "rare",
};

export const tropicalIsland2ed: CardPrint = {
    printId: "856bf0ba-e5a5-47eb-9a6a-111935088c31",
    definitionId: "a9c6c759-aabf-44e7-ba8c-33c5df232b56", // Tropical Island
    setCode: "2ed",
    rarity: "rare",
};

export const tundra2ed: CardPrint = {
    printId: "0d08f5e4-d2d3-4659-86d4-a983d80e3b2c",
    definitionId: "a03e8c5b-f4ed-4fd7-ba05-db813ccc05eb", // Tundra
    setCode: "2ed",
    rarity: "rare",
};

export const undergroundSea2ed: CardPrint = {
    printId: "bc98d888-4af3-43a3-b035-40c651057b6e",
    definitionId: "ff76ac86-8a8a-47fe-9388-8950ca3e26c3", // Underground Sea
    setCode: "2ed",
    rarity: "rare",
};

export const volcanicIsland2ed: CardPrint = {
    printId: "9dc7ab05-a5f5-4a02-87e7-3c47be35b5cb",
    definitionId: "0324641d-af55-4c53-b4dc-c8262e967da5", // Volcanic Island
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
