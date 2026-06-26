// 3ED (Revised Edition) colorless cards, split by colour per ADR 0043.
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

export const aladdinSLamp3ed: CardPrint = {
    printId: "2c7e444a-dba1-406f-bfdc-1a54102083a8",
    definitionId: "8fecc5d2-5298-4d47-b085-f160603f220e", // Aladdin's Lamp
    setCode: "3ed",
    rarity: "rare",
};

export const aladdinSRing3ed: CardPrint = {
    printId: "40cb7c36-135b-40d0-bc7b-62fbcd508f49",
    definitionId: "bb2b74a2-cb74-4b54-b9c6-78c63f14cf5b", // Aladdin's Ring
    setCode: "3ed",
    rarity: "rare",
};

export const ankhOfMishra3ed: CardPrint = {
    printId: "617599f1-69d9-4767-9656-982739728df0",
    definitionId: "f594b7aa-d44e-47c4-989b-565f881e25f1", // Ankh of Mishra
    setCode: "3ed",
    rarity: "rare",
};

export const armageddonClock3ed: CardPrint = {
    printId: "ee486c26-f0bc-4275-ab1b-a9e57721f036",
    definitionId: "44a31889-6a8d-450c-a73d-381a7ff28bf9", // Armageddon Clock
    setCode: "3ed",
    rarity: "rare",
};

export const basaltMonolith3ed: CardPrint = {
    printId: "4f0b7b8e-45b0-4947-9a95-bccc6b725a37",
    definitionId: "66a74c89-6f86-4ec8-af17-391cd5026054", // Basalt Monolith
    setCode: "3ed",
    rarity: "uncommon",
};

export const blackVise3ed: CardPrint = {
    printId: "1bae1867-d5bb-4204-9fb1-59d6663bc161",
    definitionId: "76ac72f8-5b1e-4d67-a796-ef69cde27424", // Black Vise
    setCode: "3ed",
    rarity: "uncommon",
};

export const bottleOfSuleiman3ed: CardPrint = {
    printId: "6c1c2ea2-09ba-4a0e-b5b6-c06068f0da75",
    definitionId: "c474cd6b-5610-49eb-ac98-918d900efe8b", // Bottle of Suleiman
    setCode: "3ed",
    rarity: "rare",
};

export const brassMan3ed: CardPrint = {
    printId: "0ba1daee-a5ac-4d9e-b681-3e3c7a3eb095",
    definitionId: "1a364362-e42b-415c-9d95-b6ec7139f5e7", // Brass Man
    setCode: "3ed",
    rarity: "uncommon",
};

export const celestialPrism3ed: CardPrint = {
    printId: "2bc5e073-2903-4a28-9c23-07a0482ae09a",
    definitionId: "a47417cb-1ea7-4f65-ba06-e27a99373114", // Celestial Prism
    setCode: "3ed",
    rarity: "uncommon",
};

export const clockworkBeast3ed: CardPrint = {
    printId: "8224d6e3-c9de-4129-ae3e-300a82c4bd00",
    definitionId: "27f916a2-0ace-44b5-99dc-72979af34db9", // Clockwork Beast
    setCode: "3ed",
    rarity: "rare",
};

export const conservator3ed: CardPrint = {
    printId: "2e7d8bc5-9d87-43e3-9b81-311d01fdf0e5",
    definitionId: "c7824e2a-4eff-4f72-9216-0db30a4f4252", // Conservator
    setCode: "3ed",
    rarity: "uncommon",
};

export const crystalRod3ed: CardPrint = {
    printId: "f973046b-ce81-4e35-89f3-a6e857d751b8",
    definitionId: "76693233-7961-4b7e-80f2-ed90e494c4aa", // Crystal Rod
    setCode: "3ed",
    rarity: "uncommon",
};

export const dancingScimitar3ed: CardPrint = {
    printId: "e3d92537-7934-4191-8836-2f61ff6ab2fa",
    definitionId: "1eb2e494-1414-4d1f-91d2-7cb20acdb128", // Dancing Scimitar
    setCode: "3ed",
    rarity: "rare",
};

export const dingusEgg3ed: CardPrint = {
    printId: "ce56c997-202c-4175-809b-2dd65cd2ab2a",
    definitionId: "65eb6cda-e512-40a8-9c1f-335b713409ff", // Dingus Egg
    setCode: "3ed",
    rarity: "rare",
};

export const disruptingScepter3ed: CardPrint = {
    printId: "af4f8926-9a9e-4b2d-8224-118655f12809",
    definitionId: "ca571ee8-07a2-43b8-9acf-89cbfd3cf7c9", // Disrupting Scepter
    setCode: "3ed",
    rarity: "rare",
};

export const dragonEngine3ed: CardPrint = {
    printId: "42c1fd91-001d-4c94-bb0a-d3fc570c7f12",
    definitionId: "07793a71-1106-4303-b620-e403bd378020", // Dragon Engine
    setCode: "3ed",
    rarity: "rare",
};

export const ebonyHorse3ed: CardPrint = {
    printId: "396360d2-3604-499c-9fc3-75b75970c047",
    definitionId: "9ae81ec7-2b7d-4301-8114-032be5e6b663", // Ebony Horse
    setCode: "3ed",
    rarity: "rare",
};

export const flyingCarpet3ed: CardPrint = {
    printId: "7e46b461-a38e-44f8-8e15-7cefe8aea46a",
    definitionId: "4b71ff49-ee0a-4065-9131-380468d62a30", // Flying Carpet
    setCode: "3ed",
    rarity: "rare",
};

export const glassesOfUrza3ed: CardPrint = {
    printId: "a7d975c6-ca94-4255-8ac5-56113da9f97e",
    definitionId: "cafc2350-5d64-4379-9198-79a114654d45", // Glasses of Urza
    setCode: "3ed",
    rarity: "uncommon",
};

export const helmOfChatzuk3ed: CardPrint = {
    printId: "1a3068eb-2250-4c7b-8ed5-2366ff6cd0e1",
    definitionId: "3792c6ef-c4e6-4923-9a51-7d28fbc5c393", // Helm of Chatzuk
    setCode: "3ed",
    rarity: "rare",
};

export const howlingMine3ed: CardPrint = {
    printId: "fc6fbf54-698d-4a99-ad98-b0115df403a0",
    definitionId: "51f8f6e1-a451-4262-90d3-5107caf54175", // Howling Mine
    setCode: "3ed",
    rarity: "rare",
};

export const ironStar3ed: CardPrint = {
    printId: "5ffb4de8-505e-4e83-8a8b-05c968a03f04",
    definitionId: "5786de12-cade-43c2-a6b0-0c5b294b9d0e", // Iron Star
    setCode: "3ed",
    rarity: "uncommon",
};

export const ivoryCup3ed: CardPrint = {
    printId: "b1dd930a-a7d8-4cdd-9c4f-78b2b249ce38",
    definitionId: "9964d8d8-dc97-4e5f-9f52-173f7e2c37fd", // Ivory Cup
    setCode: "3ed",
    rarity: "uncommon",
};

export const ivoryTower3ed: CardPrint = {
    printId: "2bd6f6a8-153f-4263-941a-e3387c2a22ad",
    definitionId: "a5f23039-45ca-4c15-af50-bfd40ea26453", // Ivory Tower
    setCode: "3ed",
    rarity: "rare",
};

export const jadeMonolith3ed: CardPrint = {
    printId: "4ff44808-a1a9-4173-a39c-d726c51490fb",
    definitionId: "4a77e0f1-449d-4a7d-9fa0-ba7598f7a73a", // Jade Monolith
    setCode: "3ed",
    rarity: "rare",
};

export const jandorSRing3ed: CardPrint = {
    printId: "2b56c9ed-c912-4829-9be0-e80303759c9c",
    definitionId: "71504078-a16f-4dc4-9626-0ecc42b1e93b", // Jandor's Ring
    setCode: "3ed",
    rarity: "rare",
};

export const jandorSSaddlebags3ed: CardPrint = {
    printId: "af96e332-1c77-4650-b66b-417e6c47bc3b",
    definitionId: "bc4f4b92-7d4e-4b03-8cb4-e6b356c338b4", // Jandor's Saddlebags
    setCode: "3ed",
    rarity: "rare",
};

export const jayemdaeTome3ed: CardPrint = {
    printId: "e8661e0a-faf8-4c16-b988-55622707de6f",
    definitionId: "cac8c421-5b92-481d-b2de-560c0231ab58", // Jayemdae Tome
    setCode: "3ed",
    rarity: "rare",
};

export const juggernaut3ed: CardPrint = {
    printId: "490fafd4-3cd0-4cd8-9f07-01a92121d39d",
    definitionId: "dcd6a291-5282-4f49-8203-d9b416083c48", // Juggernaut
    setCode: "3ed",
    rarity: "uncommon",
};

export const kormusBell3ed: CardPrint = {
    printId: "7071d294-842c-4539-aba1-c68cd5c79848",
    definitionId: "3f4ef7a1-148d-44ac-89ed-0ef379cca0c6", // Kormus Bell
    setCode: "3ed",
    rarity: "rare",
};

export const libraryOfLeng3ed: CardPrint = {
    printId: "0634ab23-4691-4c77-9b8f-bfd9d99b31a1",
    definitionId: "2340edcb-8cd5-4ccd-99e2-b9a29f72c495", // Library of Leng
    setCode: "3ed",
    rarity: "uncommon",
};

export const livingWall3ed: CardPrint = {
    printId: "516858c9-7679-4a65-a787-36a2cf175ede",
    definitionId: "4a98ada6-923a-44a5-bdef-ea6a160b481e", // Living Wall
    setCode: "3ed",
    rarity: "uncommon",
};

export const manaVault3ed: CardPrint = {
    printId: "5cbc686e-a8ef-40de-b79a-803ef42f8384",
    definitionId: "19499cb7-eccb-4e69-af32-6002d447a160", // Mana Vault
    setCode: "3ed",
    rarity: "rare",
};

export const meekstone3ed: CardPrint = {
    printId: "56854867-d135-4bed-8d3a-dcc24d757558",
    definitionId: "13a68a17-22ee-47c9-870a-83e911862b94", // Meekstone
    setCode: "3ed",
    rarity: "rare",
};

export const millstone3ed: CardPrint = {
    printId: "21aabfa6-c299-4cf8-b8b5-097ef6f4029a",
    definitionId: "107646bc-2181-49f4-8821-1eaa46291855", // Millstone
    setCode: "3ed",
    rarity: "rare",
};

export const mishraSWarMachine3ed: CardPrint = {
    printId: "1a93e9bd-6c31-4363-93b0-b7d355bd2867",
    definitionId: "8f6b4652-a1d4-418f-a89b-6a977a920a9e", // Mishra's War Machine
    setCode: "3ed",
    rarity: "rare",
};

export const nevinyrralSDisk3ed: CardPrint = {
    printId: "ba5fcfc5-0715-4c6c-8325-3b54a138634e",
    definitionId: "12926dc8-8e6f-4a47-a12b-4d674189615a", // Nevinyrral's Disk
    setCode: "3ed",
    rarity: "rare",
};

export const obsianusGolem3ed: CardPrint = {
    printId: "ef24fb75-49c7-48eb-a0b3-dc08d7f691ec",
    definitionId: "4c8e9f5c-deba-4443-bf9d-fb2be75c5418", // Obsianus Golem
    setCode: "3ed",
    rarity: "uncommon",
};

export const onulet3ed: CardPrint = {
    printId: "0d84e378-dc64-4e69-a49d-1c210ca3506c",
    definitionId: "d77fe8e2-8438-473e-ace5-01baddd2c4ed", // Onulet
    setCode: "3ed",
    rarity: "rare",
};

export const ornithopter3ed: CardPrint = {
    printId: "b3654fd6-f8ac-471a-8559-ba4ed0fe75c3",
    definitionId: "59cc9bdb-7cf2-4795-bac7-ffff605c9eb0", // Ornithopter
    setCode: "3ed",
    rarity: "uncommon",
};

export const primalClay3ed: CardPrint = {
    printId: "d057a91c-d2a7-48ec-aa16-f033499de166",
    definitionId: "ab9d0e3f-cf7c-41f8-bcd7-bb08ea8cc2f8", // Primal Clay
    setCode: "3ed",
    rarity: "rare",
};

export const rocketLauncher3ed: CardPrint = {
    printId: "919f184b-421c-413c-a95c-05bb145f93ba",
    definitionId: "d5bb2093-78a8-4a6c-abe7-9a5afc181ec5", // Rocket Launcher
    setCode: "3ed",
    rarity: "rare",
};

export const rodOfRuin3ed: CardPrint = {
    printId: "964abd0f-812e-418d-a01b-73dc724c8429",
    definitionId: "af957200-c538-4f52-b105-6db7a7abb4dc", // Rod of Ruin
    setCode: "3ed",
    rarity: "uncommon",
};

export const solRing3ed: CardPrint = {
    printId: "803fd65f-4ca6-4fe4-abc2-72aa32ebb3a5",
    definitionId: "c4300d24-1cae-4dd5-be7e-38cc677cf5bd", // Sol Ring
    setCode: "3ed",
    rarity: "uncommon",
};

export const soulNet3ed: CardPrint = {
    printId: "3a80be5d-cf6f-487d-8602-9396d9b6252b",
    definitionId: "2b814198-814b-4619-a158-327af675f8f2", // Soul Net
    setCode: "3ed",
    rarity: "uncommon",
};

export const sunglassesOfUrza3ed: CardPrint = {
    printId: "4babb2a9-b6b3-4a85-8add-90828726adb4",
    definitionId: "c0d433a4-76c0-4f27-836d-4c0c13a511fb", // Sunglasses of Urza
    setCode: "3ed",
    rarity: "rare",
};

export const theHive3ed: CardPrint = {
    printId: "09b82c6b-9b14-4607-95d5-2964b926ec37",
    definitionId: "544a7138-eae8-4ff9-9e17-680bfa717183", // The Hive
    setCode: "3ed",
    rarity: "rare",
};

export const theRack3ed: CardPrint = {
    printId: "2a600805-dd79-419d-9866-f8c29643f0f8",
    definitionId: "ec0686ba-1277-4412-a397-7a6227808311", // The Rack
    setCode: "3ed",
    rarity: "uncommon",
};

export const throneOfBone3ed: CardPrint = {
    printId: "8b08a20c-59ee-4323-8a00-af88b82d6b76",
    definitionId: "a2931ae0-7836-4000-b9ec-f2029ebf5d96", // Throne of Bone
    setCode: "3ed",
    rarity: "uncommon",
};

export const winterOrb3ed: CardPrint = {
    printId: "f5c6d64b-f49c-4b41-bd25-3d29c896a9a8",
    definitionId: "9359f60c-9a27-4e53-b35b-964a121a6fba", // Winter Orb
    setCode: "3ed",
    rarity: "rare",
};

export const woodenSphere3ed: CardPrint = {
    printId: "157a28e2-61f6-4c95-b377-e945fc8dade2",
    definitionId: "bcae01a2-171b-47cd-87be-f1e4e5314326", // Wooden Sphere
    setCode: "3ed",
    rarity: "uncommon",
};

export const badlands3ed: CardPrint = {
    printId: "56058359-3c0b-49db-a0ce-9ded4c3f4372",
    definitionId: "717f6d10-9144-4ade-9ac6-a481cc66b875", // Badlands
    setCode: "3ed",
    rarity: "rare",
};

export const bayou3ed: CardPrint = {
    printId: "56355ff3-2232-4a11-b868-aec9a50b9ee5",
    definitionId: "412ceddd-2b9a-4551-a6bf-ae2830a2010a", // Bayou
    setCode: "3ed",
    rarity: "rare",
};

export const plateau3ed: CardPrint = {
    printId: "c6ae9cff-8646-4069-8761-df734e067beb",
    definitionId: "6eafa00b-c628-40f6-86eb-88e1361fc7a0", // Plateau
    setCode: "3ed",
    rarity: "rare",
};

export const savannah3ed: CardPrint = {
    printId: "5ae71290-c133-406c-8b17-9ea22b437806",
    definitionId: "94f7e24c-2546-41b6-81ad-5e920b07e64e", // Savannah
    setCode: "3ed",
    rarity: "rare",
};

export const scrubland3ed: CardPrint = {
    printId: "472034a2-0ba9-4876-ab7a-aa7013d603bb",
    definitionId: "bebe39d4-21fb-46a4-a1ec-b97102e46c15", // Scrubland
    setCode: "3ed",
    rarity: "rare",
};

export const taiga3ed: CardPrint = {
    printId: "54c5c65a-a444-4e0f-ae44-a3722cdd32a1",
    definitionId: "60df6592-0b3b-4b87-aeb2-8fa94b4fb7be", // Taiga
    setCode: "3ed",
    rarity: "rare",
};

export const tropicalIsland3ed: CardPrint = {
    printId: "a0f5c6bc-65dc-42a1-a62d-a0b101310a1f",
    definitionId: "a9c6c759-aabf-44e7-ba8c-33c5df232b56", // Tropical Island
    setCode: "3ed",
    rarity: "rare",
};

export const tundra3ed: CardPrint = {
    printId: "9c9d5f72-e199-4d5b-ae7e-cc5b9bdfae99",
    definitionId: "a03e8c5b-f4ed-4fd7-ba05-db813ccc05eb", // Tundra
    setCode: "3ed",
    rarity: "rare",
};

export const undergroundSea3ed: CardPrint = {
    printId: "1f35877c-e66c-4ef0-842a-f68cd233ae4b",
    definitionId: "ff76ac86-8a8a-47fe-9388-8950ca3e26c3", // Underground Sea
    setCode: "3ed",
    rarity: "rare",
};

export const volcanicIsland3ed: CardPrint = {
    printId: "b12e5430-0e80-47dd-80ac-85728b656a24",
    definitionId: "0324641d-af55-4c53-b4dc-c8262e967da5", // Volcanic Island
    setCode: "3ed",
    rarity: "rare",
};

export const plains3ed: CardPrint = {
    printId: "275c03f9-f9d2-45c5-a332-b3bee54e7065",
    definitionId: "b1623d57-4729-4796-b3f7-f1837a05c6ed", // Plains
    setCode: "3ed",
    rarity: "common",
};

export const plains23ed: CardPrint = {
    printId: "cc0bcdbe-be63-446a-8838-8790bda308a3",
    definitionId: "b1623d57-4729-4796-b3f7-f1837a05c6ed", // Plains
    setCode: "3ed",
    rarity: "common",
};

export const plains33ed: CardPrint = {
    printId: "a4901260-073a-4d06-8167-c322c55ab210",
    definitionId: "b1623d57-4729-4796-b3f7-f1837a05c6ed", // Plains
    setCode: "3ed",
    rarity: "common",
};

export const island3ed: CardPrint = {
    printId: "22f6e971-349d-498b-ae01-ab81ce21772c",
    definitionId: "90a57c0e-fa61-45ef-955d-d296403967d5", // Island
    setCode: "3ed",
    rarity: "common",
};

export const island23ed: CardPrint = {
    printId: "a000777b-e8fe-4fd6-a455-01bc9056a873",
    definitionId: "90a57c0e-fa61-45ef-955d-d296403967d5", // Island
    setCode: "3ed",
    rarity: "common",
};

export const island33ed: CardPrint = {
    printId: "bec8018f-a12c-4adf-9735-c2093298062d",
    definitionId: "90a57c0e-fa61-45ef-955d-d296403967d5", // Island
    setCode: "3ed",
    rarity: "common",
};

export const swamp3ed: CardPrint = {
    printId: "95e936cf-3bbb-4f3b-8e1a-4be1d4702b99",
    definitionId: "6176936d-72e2-4205-8871-4c5a4f1cb2d8", // Swamp
    setCode: "3ed",
    rarity: "common",
};

export const swamp23ed: CardPrint = {
    printId: "459d175e-2b9c-4f30-be03-4e05cd3c68ef",
    definitionId: "6176936d-72e2-4205-8871-4c5a4f1cb2d8", // Swamp
    setCode: "3ed",
    rarity: "common",
};

export const swamp33ed: CardPrint = {
    printId: "515eff31-24f6-462e-bbd4-b49540421a75",
    definitionId: "6176936d-72e2-4205-8871-4c5a4f1cb2d8", // Swamp
    setCode: "3ed",
    rarity: "common",
};

export const mountain3ed: CardPrint = {
    printId: "30345500-d430-4280-bfe3-de297309f136",
    definitionId: "eace2c85-976c-425e-9800-5a6ccbd91b56", // Mountain
    setCode: "3ed",
    rarity: "common",
};

export const mountain23ed: CardPrint = {
    printId: "5a240d1b-8430-4986-850d-32afa0e812b2",
    definitionId: "eace2c85-976c-425e-9800-5a6ccbd91b56", // Mountain
    setCode: "3ed",
    rarity: "common",
};

export const mountain33ed: CardPrint = {
    printId: "1b0f41e8-cf27-489b-812a-d566a75cf7f7",
    definitionId: "eace2c85-976c-425e-9800-5a6ccbd91b56", // Mountain
    setCode: "3ed",
    rarity: "common",
};

export const forest3ed: CardPrint = {
    printId: "b6e1c2e9-5572-4242-985d-f509d628092b",
    definitionId: "6f1c8cb0-38eb-408b-94e8-16db83999b3b", // Forest
    setCode: "3ed",
    rarity: "common",
};

export const forest23ed: CardPrint = {
    printId: "4d1e4241-42ef-4b51-8f9b-2ab6aca31dbb",
    definitionId: "6f1c8cb0-38eb-408b-94e8-16db83999b3b", // Forest
    setCode: "3ed",
    rarity: "common",
};

export const forest33ed: CardPrint = {
    printId: "b38ce16b-3258-4019-9e86-156e4738aa89",
    definitionId: "6f1c8cb0-38eb-408b-94e8-16db83999b3b", // Forest
    setCode: "3ed",
    rarity: "common",
};
