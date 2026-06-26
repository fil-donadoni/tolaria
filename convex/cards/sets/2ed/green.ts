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

export const aspectOfWolf2ed: CardPrint = {
    printId: "5aa02bb5-7365-4b8d-ac86-13721fb19d01",
    definitionId: "fd9ac9e6-1395-4fbd-80e2-645f0d910c29", // Aspect of Wolf
    setCode: "2ed",
    rarity: "rare",
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

export const channel2ed: CardPrint = {
    printId: "6a7a0f8f-f51e-4cfb-a546-87a086d5936a",
    definitionId: "c1862c47-71cc-45a3-8805-a5ddc62e55ea", // Channel
    setCode: "2ed",
    rarity: "uncommon",
};

export const cockatrice2ed: CardPrint = {
    printId: "8392d34d-d14a-43ca-997d-fe59e505034e",
    definitionId: "9cd91814-6177-4a3d-a1c1-a3be7d7c7957", // Cockatrice
    setCode: "2ed",
    rarity: "rare",
};

export const crawWurm2ed: CardPrint = {
    printId: "a5bbaf11-6bf1-42a1-a8be-66bc47485a6c",
    definitionId: "bfed1a95-bd67-4e16-a781-81866028af2f", // Craw Wurm
    setCode: "2ed",
    rarity: "common",
};

export const elvishArchers2ed: CardPrint = {
    printId: "0fad0e0d-f34a-45ff-9f01-e6ac10b6928f",
    definitionId: "1cb9d405-f2b5-4e10-a405-feafd2a87d90", // Elvish Archers
    setCode: "2ed",
    rarity: "rare",
};

export const fastbond2ed: CardPrint = {
    printId: "64b52b42-e2af-4040-b7ba-34cc292af7ef",
    definitionId: "a575a9af-e1de-4a1d-91d8-440585377e4f", // Fastbond
    setCode: "2ed",
    rarity: "rare",
};

export const fog2ed: CardPrint = {
    printId: "ba0a14ac-037a-42f2-8fc9-2a41275dc7da",
    definitionId: "cfba606d-bb55-43ba-aa0c-299649958788", // Fog
    setCode: "2ed",
    rarity: "common",
};

export const forceOfNature2ed: CardPrint = {
    printId: "247a2ba4-aa5d-4970-b886-90196f684f80",
    definitionId: "21551cb6-3a53-42dd-9bbd-4bc56304d6d3", // Force of Nature
    setCode: "2ed",
    rarity: "rare",
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

export const grizzlyBears2ed: CardPrint = {
    printId: "d74cce44-b54b-4922-9cea-f3fda725d24f",
    definitionId: "ce2d603a-3231-4a8c-bf39-1617586ea870", // Grizzly Bears
    setCode: "2ed",
    rarity: "common",
};

export const hurricane2ed: CardPrint = {
    printId: "2287bb85-72b1-40ae-9d44-0364a4075e88",
    definitionId: "52f5a19f-16e4-4d35-89e1-969ac8202f88", // Hurricane
    setCode: "2ed",
    rarity: "uncommon",
};

export const iceStorm2ed: CardPrint = {
    printId: "2ec2246d-8bea-43c4-bf7f-2acad363e0af",
    definitionId: "9914836e-2fa6-4390-94b2-431427848a54", // Ice Storm
    setCode: "2ed",
    rarity: "uncommon",
};

export const instillEnergy2ed: CardPrint = {
    printId: "1ba27e77-00b8-4d6c-acbd-462273212fc2",
    definitionId: "5bd38716-874c-4e3c-a315-837839a6258c", // Instill Energy
    setCode: "2ed",
    rarity: "uncommon",
};

export const ironrootTreefolk2ed: CardPrint = {
    printId: "f89f3bda-e2fb-496e-a9f3-7260e8ac97fd",
    definitionId: "b93c5869-7777-44bb-967a-e9439b25ced4", // Ironroot Treefolk
    setCode: "2ed",
    rarity: "common",
};

export const kudzu2ed: CardPrint = {
    printId: "f92ec34e-e374-462f-aa9c-257558defb1f",
    definitionId: "b2b72dcd-9ea1-4729-baae-ecd262fdff67", // Kudzu
    setCode: "2ed",
    rarity: "rare",
};

export const leyDruid2ed: CardPrint = {
    printId: "30c3f2cd-5113-45f5-bb8d-4a7d5c4c76a5",
    definitionId: "f9232508-d363-4ef3-987a-741f6bff331f", // Ley Druid
    setCode: "2ed",
    rarity: "uncommon",
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

export const llanowarElves2ed: CardPrint = {
    printId: "fedd1b24-44ee-493a-b4db-3048ff5c760b",
    definitionId: "d4f1cc9e-4f99-4c26-ac1b-8ef069fa8ceb", // Llanowar Elves
    setCode: "2ed",
    rarity: "common",
};

export const lure2ed: CardPrint = {
    printId: "f790990a-f47d-4fb0-a361-108037dd7464",
    definitionId: "2a87b26e-0431-42e9-b44f-94ba8546111a", // Lure
    setCode: "2ed",
    rarity: "uncommon",
};

export const naturalSelection2ed: CardPrint = {
    printId: "315a6bfb-5417-465f-97d9-e157f5c3cf79",
    definitionId: "a8917dc8-01c0-4e72-9310-c4d501775411", // Natural Selection
    setCode: "2ed",
    rarity: "rare",
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

export const scrybSprites2ed: CardPrint = {
    printId: "e9e2f1fe-4df0-48c8-b469-4175ba5011e8",
    definitionId: "6d929c38-91e6-457c-937a-d1884f4bba44", // Scryb Sprites
    setCode: "2ed",
    rarity: "common",
};

export const shanodinDryads2ed: CardPrint = {
    printId: "b25f298a-9784-4192-b640-caec2b94ba4c",
    definitionId: "814cf35c-f1ad-4bf4-8c10-a5592c3b1be8", // Shanodin Dryads
    setCode: "2ed",
    rarity: "common",
};

export const streamOfLife2ed: CardPrint = {
    printId: "70e476cb-8b72-434c-b5e9-0fd0319a1bff",
    definitionId: "aa1c4d4b-2645-4cd9-823e-3c9bb2eb48f9", // Stream of Life
    setCode: "2ed",
    rarity: "common",
};

export const thicketBasilisk2ed: CardPrint = {
    printId: "32401b72-e351-45fa-a16e-33cc818a07e0",
    definitionId: "e92cce01-b3bd-4307-aae5-9a7c8fa386ab", // Thicket Basilisk
    setCode: "2ed",
    rarity: "uncommon",
};

export const timberWolves2ed: CardPrint = {
    printId: "0d24fc87-7b30-4c99-a525-b1746821391c",
    definitionId: "bc2570a4-eef9-430d-b6c2-cd51d29b9d01", // Timber Wolves
    setCode: "2ed",
    rarity: "rare",
};

export const tranquility2ed: CardPrint = {
    printId: "fc24f763-4c7f-45e4-933b-573d1ace1ddc",
    definitionId: "774cc5a6-3a69-4812-add4-eb5eb6389238", // Tranquility
    setCode: "2ed",
    rarity: "common",
};

export const tsunami2ed: CardPrint = {
    printId: "b8328ddc-d2d9-47d3-a98b-1a7c7b0c75a3",
    definitionId: "9ed67d61-cf47-446b-b454-eb404a8686b7", // Tsunami
    setCode: "2ed",
    rarity: "uncommon",
};

export const verduranEnchantress2ed: CardPrint = {
    printId: "55454150-de1b-4921-9c23-7d10724c2ee7",
    definitionId: "9f87178b-1221-4d7a-a7a5-20d7f01b8089", // Verduran Enchantress
    setCode: "2ed",
    rarity: "rare",
};

export const wallOfBrambles2ed: CardPrint = {
    printId: "5ae21e65-fc55-4a90-806e-452ef0ad5e3a",
    definitionId: "af2a4558-db6e-41b2-aff6-b164d93282a0", // Wall of Brambles
    setCode: "2ed",
    rarity: "uncommon",
};

export const wallOfIce2ed: CardPrint = {
    printId: "d79867a0-c525-4e91-8942-c61b41f9150c",
    definitionId: "cc743a03-867c-4bb0-8fb0-2bcaa0a8a756", // Wall of Ice
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

export const web2ed: CardPrint = {
    printId: "6fbbac49-9117-4e15-89e8-98387f7511ed",
    definitionId: "37c7890a-86dc-4a97-a7ce-1436fa22d0c0", // Web
    setCode: "2ed",
    rarity: "rare",
};

export const wildGrowth2ed: CardPrint = {
    printId: "b7425741-5d7c-4016-8d42-ec8b7353116b",
    definitionId: "fd896dfa-66c0-4327-8e5b-489bbe350c95", // Wild Growth
    setCode: "2ed",
    rarity: "common",
};
