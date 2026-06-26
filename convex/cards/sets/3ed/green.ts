// 3ED (Revised Edition) green cards, split by colour per ADR 0043.
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

export const aspectOfWolf3ed: CardPrint = {
    printId: "7248db64-c901-4e87-9322-e122d2d32ddc",
    definitionId: "fd9ac9e6-1395-4fbd-80e2-645f0d910c29", // Aspect of Wolf
    setCode: "3ed",
    rarity: "rare",
};

export const birdsOfParadise3ed: CardPrint = {
    printId: "01e7b0bc-1c6c-48f4-8b72-1a809f536c6c",
    definitionId: "55fe6449-1f23-43dc-adee-d144cd505b5c", // Birds of Paradise
    setCode: "3ed",
    rarity: "rare",
};

export const channel3ed: CardPrint = {
    printId: "bc0cea66-7c61-4308-af2f-3622fbb82983",
    definitionId: "c1862c47-71cc-45a3-8805-a5ddc62e55ea", // Channel
    setCode: "3ed",
    rarity: "uncommon",
};

export const cockatrice3ed: CardPrint = {
    printId: "3c5d9117-135f-4a88-950a-41bf164ebc21",
    definitionId: "9cd91814-6177-4a3d-a1c1-a3be7d7c7957", // Cockatrice
    setCode: "3ed",
    rarity: "rare",
};

export const crawWurm3ed: CardPrint = {
    printId: "a5e4a23b-3b05-4240-9565-bdd8f3f3ef12",
    definitionId: "bfed1a95-bd67-4e16-a781-81866028af2f", // Craw Wurm
    setCode: "3ed",
    rarity: "common",
};

export const crumble3ed: CardPrint = {
    printId: "32123652-4f71-4f0b-b317-39e6df039b4f",
    definitionId: "d2101f86-8d3c-4ba8-ac42-bd3df0644280", // Crumble
    setCode: "3ed",
    rarity: "uncommon",
};

export const desertTwister3ed: CardPrint = {
    printId: "88cbcf7e-9d66-4e1b-b056-8edf708fca84",
    definitionId: "0d77c149-cca2-45c7-bc83-5ba1872ad5e0", // Desert Twister
    setCode: "3ed",
    rarity: "uncommon",
};

export const elvishArchers3ed: CardPrint = {
    printId: "24547919-0272-4502-9b3a-e9a0eb6a90d2",
    definitionId: "1cb9d405-f2b5-4e10-a405-feafd2a87d90", // Elvish Archers
    setCode: "3ed",
    rarity: "rare",
};

export const fastbond3ed: CardPrint = {
    printId: "c71123b5-6be5-4c3c-972a-0aad3db1a694",
    definitionId: "a575a9af-e1de-4a1d-91d8-440585377e4f", // Fastbond
    setCode: "3ed",
    rarity: "rare",
};

export const fog3ed: CardPrint = {
    printId: "637cbc3f-f2c0-42db-b9f9-6c084846cb03",
    definitionId: "cfba606d-bb55-43ba-aa0c-299649958788", // Fog
    setCode: "3ed",
    rarity: "common",
};

export const forceOfNature3ed: CardPrint = {
    printId: "56cb88db-2c6b-4d17-be16-2a89218efe4c",
    definitionId: "21551cb6-3a53-42dd-9bbd-4bc56304d6d3", // Force of Nature
    setCode: "3ed",
    rarity: "rare",
};

export const fungusaur3ed: CardPrint = {
    printId: "6f80ad09-ebff-47cb-93ab-9bc7e0e10056",
    definitionId: "5ad89f0d-b09b-40a0-84d6-3ee60dec7e23", // Fungusaur
    setCode: "3ed",
    rarity: "rare",
};

export const gaeaSLiege3ed: CardPrint = {
    printId: "6c36ac7d-2ff0-4350-9b10-968f94b19842",
    definitionId: "e2b15221-c8b0-4861-9f8b-8a65834ad499", // Gaea's Liege
    setCode: "3ed",
    rarity: "rare",
};

export const giantGrowth3ed: CardPrint = {
    printId: "d33fe386-d165-4874-aa6b-07b7df9b6209",
    definitionId: "367dbefe-3366-408e-9fcf-7dc00f8cc201", // Giant Growth
    setCode: "3ed",
    rarity: "common",
};

export const giantSpider3ed: CardPrint = {
    printId: "5440ff00-e7fa-46ac-b46c-3fa4e10712b0",
    definitionId: "77636b4c-faea-4bf5-b88c-dd5bb88dc930", // Giant Spider
    setCode: "3ed",
    rarity: "common",
};

export const grizzlyBears3ed: CardPrint = {
    printId: "886959ca-83fd-4b50-a99a-08ef0c5415db",
    definitionId: "ce2d603a-3231-4a8c-bf39-1617586ea870", // Grizzly Bears
    setCode: "3ed",
    rarity: "common",
};

export const hurricane3ed: CardPrint = {
    printId: "bfba7442-ffdf-43cf-97b3-c69ff80e6fde",
    definitionId: "52f5a19f-16e4-4d35-89e1-969ac8202f88", // Hurricane
    setCode: "3ed",
    rarity: "uncommon",
};

export const instillEnergy3ed: CardPrint = {
    printId: "d919330b-5023-4b9c-b82f-20095354326c",
    definitionId: "5bd38716-874c-4e3c-a315-837839a6258c", // Instill Energy
    setCode: "3ed",
    rarity: "uncommon",
};

export const ironrootTreefolk3ed: CardPrint = {
    printId: "6e6cfaae-ea9e-4c54-858e-381f8bf441a9",
    definitionId: "b93c5869-7777-44bb-967a-e9439b25ced4", // Ironroot Treefolk
    setCode: "3ed",
    rarity: "common",
};

export const kudzu3ed: CardPrint = {
    printId: "b1466b4c-407d-4220-b5ee-474d7d8a24a7",
    definitionId: "b2b72dcd-9ea1-4729-baae-ecd262fdff67", // Kudzu
    setCode: "3ed",
    rarity: "rare",
};

export const leyDruid3ed: CardPrint = {
    printId: "ea2c2bf3-357d-4595-9b24-3451bd2d0179",
    definitionId: "f9232508-d363-4ef3-987a-741f6bff331f", // Ley Druid
    setCode: "3ed",
    rarity: "uncommon",
};

export const lifeforce3ed: CardPrint = {
    printId: "ca28f9ec-897a-46fd-8e3d-16330ad43d24",
    definitionId: "e292577e-6232-44fa-a9c2-cc09949c6ed3", // Lifeforce
    setCode: "3ed",
    rarity: "uncommon",
};

export const lifelace3ed: CardPrint = {
    printId: "5fc40d6f-1f1c-4f50-8971-9de5f477038b",
    definitionId: "38cb601b-a35c-412e-b386-e77dad3daa54", // Lifelace
    setCode: "3ed",
    rarity: "rare",
};

export const livingArtifact3ed: CardPrint = {
    printId: "e62fec16-b5a0-47a6-9ccf-cebe79043627",
    definitionId: "c9e753a2-a7d0-4d37-ae65-b5a1b5039a6e", // Living Artifact
    setCode: "3ed",
    rarity: "rare",
};

export const livingLands3ed: CardPrint = {
    printId: "aa710039-5378-440c-b584-e9d72d1683c9",
    definitionId: "80be0580-7948-4d8e-8c0f-5e2797ac411b", // Living Lands
    setCode: "3ed",
    rarity: "rare",
};

export const llanowarElves3ed: CardPrint = {
    printId: "6d6deae3-3ed4-47eb-bf4a-4a766ce18135",
    definitionId: "d4f1cc9e-4f99-4c26-ac1b-8ef069fa8ceb", // Llanowar Elves
    setCode: "3ed",
    rarity: "common",
};

export const lure3ed: CardPrint = {
    printId: "3561cc9a-9270-4c75-90ca-1425b2724abc",
    definitionId: "2a87b26e-0431-42e9-b44f-94ba8546111a", // Lure
    setCode: "3ed",
    rarity: "uncommon",
};

export const regeneration3ed: CardPrint = {
    printId: "6cd37ba7-b821-444e-b31b-aa667a8914e9",
    definitionId: "b7b7aa34-b4f8-41b4-82ce-ab2e204c3bf4", // Regeneration
    setCode: "3ed",
    rarity: "common",
};

export const regrowth3ed: CardPrint = {
    printId: "396aae79-41d5-4b16-8903-5af8fde65eee",
    definitionId: "badc73ec-3728-4246-90c7-5f4eb7051ed5", // Regrowth
    setCode: "3ed",
    rarity: "uncommon",
};

export const scrybSprites3ed: CardPrint = {
    printId: "1b9e1d37-47cd-41d7-9fee-b8504c689462",
    definitionId: "6d929c38-91e6-457c-937a-d1884f4bba44", // Scryb Sprites
    setCode: "3ed",
    rarity: "common",
};

export const shanodinDryads3ed: CardPrint = {
    printId: "bf1889aa-59e9-4d67-ab53-9aec071ab67a",
    definitionId: "814cf35c-f1ad-4bf4-8c10-a5592c3b1be8", // Shanodin Dryads
    setCode: "3ed",
    rarity: "common",
};

export const streamOfLife3ed: CardPrint = {
    printId: "bab7e4b7-acdd-4316-ae64-b182e4d9cacd",
    definitionId: "aa1c4d4b-2645-4cd9-823e-3c9bb2eb48f9", // Stream of Life
    setCode: "3ed",
    rarity: "common",
};

export const thicketBasilisk3ed: CardPrint = {
    printId: "05a60435-7b5e-47c1-8186-1ca30a243992",
    definitionId: "e92cce01-b3bd-4307-aae5-9a7c8fa386ab", // Thicket Basilisk
    setCode: "3ed",
    rarity: "uncommon",
};

export const timberWolves3ed: CardPrint = {
    printId: "3aea108b-367b-43d9-b50d-c18954b2a82d",
    definitionId: "bc2570a4-eef9-430d-b6c2-cd51d29b9d01", // Timber Wolves
    setCode: "3ed",
    rarity: "rare",
};

export const titaniaSSong3ed: CardPrint = {
    printId: "c022abd7-bb1a-4f61-b4e1-6b802d337484",
    definitionId: "583a53af-2e2a-4f3f-8eab-bd874c6ed80a", // Titania's Song
    setCode: "3ed",
    rarity: "rare",
};

export const tranquility3ed: CardPrint = {
    printId: "5722c349-bf3d-4ac0-8fdd-bf170401c419",
    definitionId: "774cc5a6-3a69-4812-add4-eb5eb6389238", // Tranquility
    setCode: "3ed",
    rarity: "common",
};

export const tsunami3ed: CardPrint = {
    printId: "6a578955-7f77-42f1-a3e3-5e2b46216c43",
    definitionId: "9ed67d61-cf47-446b-b454-eb404a8686b7", // Tsunami
    setCode: "3ed",
    rarity: "uncommon",
};

export const verduranEnchantress3ed: CardPrint = {
    printId: "354de08d-41a8-4d6c-85d6-2413393ac181",
    definitionId: "9f87178b-1221-4d7a-a7a5-20d7f01b8089", // Verduran Enchantress
    setCode: "3ed",
    rarity: "rare",
};

export const wallOfBrambles3ed: CardPrint = {
    printId: "b27862c3-8589-41ab-8f84-34727e5a93be",
    definitionId: "af2a4558-db6e-41b2-aff6-b164d93282a0", // Wall of Brambles
    setCode: "3ed",
    rarity: "uncommon",
};

export const wallOfIce3ed: CardPrint = {
    printId: "b0af9d4c-b3e5-4953-b4ca-7f34f67bdbeb",
    definitionId: "cc743a03-867c-4bb0-8fb0-2bcaa0a8a756", // Wall of Ice
    setCode: "3ed",
    rarity: "uncommon",
};

export const wallOfWood3ed: CardPrint = {
    printId: "9d4f8eb6-2c3c-49e7-a41d-33c138d853c9",
    definitionId: "8df80424-3bd9-4982-ad79-e55d9ba3b43d", // Wall of Wood
    setCode: "3ed",
    rarity: "common",
};

export const wanderlust3ed: CardPrint = {
    printId: "3fd08a5d-0dad-4bce-86c0-dea431038859",
    definitionId: "220a03ca-8c9b-4acb-821d-f6577fbb20fb", // Wanderlust
    setCode: "3ed",
    rarity: "uncommon",
};

export const warMammoth3ed: CardPrint = {
    printId: "5c99e36f-b11d-4270-8b88-66be8907c9bd",
    definitionId: "c8d6081e-f686-4263-a0a2-21c0d9af5fdb", // War Mammoth
    setCode: "3ed",
    rarity: "common",
};

export const web3ed: CardPrint = {
    printId: "00012bd8-ed68-4978-a22d-f450c8a6e048",
    definitionId: "37c7890a-86dc-4a97-a7ce-1436fa22d0c0", // Web
    setCode: "3ed",
    rarity: "rare",
};

export const wildGrowth3ed: CardPrint = {
    printId: "8000c8f8-d4c3-4dbc-a73e-9b82b0478061",
    definitionId: "fd896dfa-66c0-4327-8e5b-489bbe350c95", // Wild Growth
    setCode: "3ed",
    rarity: "common",
};
