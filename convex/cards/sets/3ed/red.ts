// 3ED (Revised Edition) red cards, split by colour per ADR 0043.
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

export const atog3ed: CardPrint = {
    printId: "976121fd-a21d-42cd-a7d0-310c8648e307",
    definitionId: "2249fc40-4412-48fd-800a-7ea3678aee3f", // Atog
    setCode: "3ed",
    rarity: "common",
};

export const burrowing3ed: CardPrint = {
    printId: "c2b99b30-a972-4e5d-a772-06884719ac7c",
    definitionId: "a14c05e4-8df3-450b-8a98-5028e73b14c1", // Burrowing
    setCode: "3ed",
    rarity: "uncommon",
};

export const chaoslace3ed: CardPrint = {
    printId: "37df20a7-9299-434c-84ca-8019851ee31b",
    definitionId: "72ea2048-57bc-43d5-8987-33ca727f1a97", // Chaoslace
    setCode: "3ed",
    rarity: "rare",
};

export const disintegrate3ed: CardPrint = {
    printId: "ce71d4c8-3835-4065-8089-82a64846dbcb",
    definitionId: "8712c49e-f171-4669-bed9-87575a37af11", // Disintegrate
    setCode: "3ed",
    rarity: "common",
};

export const dragonWhelp3ed: CardPrint = {
    printId: "643d6f5b-6a17-434d-945a-6b9a05015493",
    definitionId: "6bbf1eab-bc32-4835-b566-8634b1fe81b0", // Dragon Whelp
    setCode: "3ed",
    rarity: "uncommon",
};

export const dwarvenWarriors3ed: CardPrint = {
    printId: "6caeadf8-1b40-497d-be7c-667fbb98f848",
    definitionId: "2d4d87a3-5f8b-4152-9a8b-538ab49d62e8", // Dwarven Warriors
    setCode: "3ed",
    rarity: "common",
};

export const dwarvenWeaponsmith3ed: CardPrint = {
    printId: "c83929b1-4826-4b84-823d-0997560b6bdc",
    definitionId: "0848d94a-2704-460f-986b-b192dd6d26b7", // Dwarven Weaponsmith
    setCode: "3ed",
    rarity: "uncommon",
};

export const earthElemental3ed: CardPrint = {
    printId: "e2285cf5-f1c0-42d2-8203-297d2a5b9ec2",
    definitionId: "b24b5864-44c0-4bc8-8705-9504f83b2c03", // Earth Elemental
    setCode: "3ed",
    rarity: "uncommon",
};

export const earthbind3ed: CardPrint = {
    printId: "7ec1650e-8ecb-460a-9319-0f59de48c824",
    definitionId: "a6d492b7-b0b3-420e-8d00-6dacb11de77e", // Earthbind
    setCode: "3ed",
    rarity: "common",
};

export const earthquake3ed: CardPrint = {
    printId: "603d1f86-2098-4af5-a038-c5a314ba7184",
    definitionId: "e68ac362-6cdc-48a6-bdd3-4f8ea32add64", // Earthquake
    setCode: "3ed",
    rarity: "rare",
};

export const fireElemental3ed: CardPrint = {
    printId: "63539181-5393-41b8-baf3-9a690d17f4ce",
    definitionId: "da237992-2919-4e37-8f56-2164095f59b5", // Fire Elemental
    setCode: "3ed",
    rarity: "uncommon",
};

export const fireball3ed: CardPrint = {
    printId: "dafb512f-536f-4f96-8440-03f1d20d8a5a",
    definitionId: "b7623c00-144b-4a8f-9c6c-f5e9e4f65ece", // Fireball
    setCode: "3ed",
    rarity: "common",
};

export const firebreathing3ed: CardPrint = {
    printId: "16682a6e-8d86-4ad6-a6b1-3171000cc708",
    definitionId: "3eb27381-505d-4e47-bf66-9e7ba91a5075", // Firebreathing
    setCode: "3ed",
    rarity: "common",
};

export const flashfires3ed: CardPrint = {
    printId: "7b23de17-d867-41f8-b965-9b3eb00db701",
    definitionId: "ee8a05a4-0ce3-4abe-bb60-08af53cf08e5", // Flashfires
    setCode: "3ed",
    rarity: "uncommon",
};

export const fork3ed: CardPrint = {
    printId: "a33a1695-db21-4dc5-9dc1-dd05d12e6b40",
    definitionId: "e6b43916-fe2d-417a-a550-d7c795023297", // Fork
    setCode: "3ed",
    rarity: "rare",
};

export const goblinBalloonBrigade3ed: CardPrint = {
    printId: "c31c14c0-71a4-40e0-b447-6c7124c84059",
    definitionId: "5129b422-7a35-4bc5-b14b-c814012a0d8f", // Goblin Balloon Brigade
    setCode: "3ed",
    rarity: "uncommon",
};

export const goblinKing3ed: CardPrint = {
    printId: "e3094187-d666-414b-a1fd-ae0ef55c3fcb",
    definitionId: "5873672d-37ea-4c0f-97f3-12b74fde112d", // Goblin King
    setCode: "3ed",
    rarity: "rare",
};

export const graniteGargoyle3ed: CardPrint = {
    printId: "03dfa7f7-8f08-49f6-96fd-eebf16ceb499",
    definitionId: "f15bf2b2-6848-4fbd-b89a-8d8da8ae1cdc", // Granite Gargoyle
    setCode: "3ed",
    rarity: "rare",
};

export const grayOgre3ed: CardPrint = {
    printId: "e26041ad-b326-40e6-a7fd-eacfcb0ab17e",
    definitionId: "73ae5276-b607-4f23-a9d2-e8cc7b8e3693", // Gray Ogre
    setCode: "3ed",
    rarity: "common",
};

export const hillGiant3ed: CardPrint = {
    printId: "c987a3ec-a775-4140-ad49-18025e59dc3d",
    definitionId: "0ddb98e8-13fe-4786-83f7-b72c56db135a", // Hill Giant
    setCode: "3ed",
    rarity: "common",
};

export const hurloonMinotaur3ed: CardPrint = {
    printId: "f6de6b0d-dd8c-4ab9-8de3-b083a36b24b7",
    definitionId: "78a9088f-8755-47cb-aa93-51d992ccab90", // Hurloon Minotaur
    setCode: "3ed",
    rarity: "common",
};

export const keldonWarlord3ed: CardPrint = {
    printId: "ad3abbfb-320a-41ad-808c-dd93964efb44",
    definitionId: "8fe3fd83-969c-4add-888f-86f4306b067c", // Keldon Warlord
    setCode: "3ed",
    rarity: "uncommon",
};

export const kirdApe3ed: CardPrint = {
    printId: "967a26e0-8dca-4215-9935-b77a7dd4dde0",
    definitionId: "ebe8845e-df1c-481c-949c-aab84af99a05", // Kird Ape
    setCode: "3ed",
    rarity: "common",
};

export const lightningBolt3ed: CardPrint = {
    printId: "cb9b9a9d-ae4c-4e04-bf9d-cae48f01292c",
    definitionId: "d573ef03-4730-45aa-93dd-e45ac1dbaf4a", // Lightning Bolt
    setCode: "3ed",
    rarity: "common",
};

export const magneticMountain3ed: CardPrint = {
    printId: "dc95e03d-5521-4a01-8028-200b8467ce86",
    definitionId: "95fde48b-e40a-4183-b324-1ec276dde015", // Magnetic Mountain
    setCode: "3ed",
    rarity: "rare",
};

export const manaFlare3ed: CardPrint = {
    printId: "b59d2329-5a0c-407b-aed2-2e19feaf70ed",
    definitionId: "7fb99a26-beeb-4aca-bb02-b2d2ce0595f9", // Mana Flare
    setCode: "3ed",
    rarity: "rare",
};

export const manabarbs3ed: CardPrint = {
    printId: "8b16d8b7-3ff8-4481-bd4a-aa283b78bead",
    definitionId: "6121f72f-680f-4bb4-ae4d-37ee4ebed4d8", // Manabarbs
    setCode: "3ed",
    rarity: "rare",
};

export const mijaeDjinn3ed: CardPrint = {
    printId: "7e0c6c15-fba2-447a-a84c-01bb837b912e",
    definitionId: "d3ddbe51-cd1a-4b2c-849a-7c82d622122a", // Mijae Djinn
    setCode: "3ed",
    rarity: "rare",
};

export const monsSGoblinRaiders3ed: CardPrint = {
    printId: "6e81e219-c840-4844-be87-0449ab0fa645",
    definitionId: "b4eb3db3-6a7c-488a-9433-d5d1d3133816", // Mons's Goblin Raiders
    setCode: "3ed",
    rarity: "common",
};

export const orcishArtillery3ed: CardPrint = {
    printId: "574650db-2af2-4e80-a83a-a20584e3a8a9",
    definitionId: "a97208b1-a91b-4129-8a00-2f97b418accc", // Orcish Artillery
    setCode: "3ed",
    rarity: "uncommon",
};

export const orcishOriflamme3ed: CardPrint = {
    printId: "71a941f4-3bdc-40b6-8b24-d73136283f51",
    definitionId: "911538ea-322c-4c40-a9c3-35e47fe60fce", // Orcish Oriflamme
    setCode: "3ed",
    rarity: "uncommon",
};

export const powerSurge3ed: CardPrint = {
    printId: "9f521a52-f4e3-4043-9db3-a3c89afce3b9",
    definitionId: "62858604-ca5a-4f69-a045-a7515ebfabf2", // Power Surge
    setCode: "3ed",
    rarity: "rare",
};

export const redElementalBlast3ed: CardPrint = {
    printId: "2d83a2a3-5495-4457-8eb7-9f9a75da6cc3",
    definitionId: "776ad9be-3309-4f1d-9f27-6219d9477662", // Red Elemental Blast
    setCode: "3ed",
    rarity: "common",
};

export const rocOfKherRidges3ed: CardPrint = {
    printId: "ad034b0a-655b-465b-a8bb-3d4eee59abdf",
    definitionId: "731a4b86-c213-4d8e-bf01-0a0e8cff0ff1", // Roc of Kher Ridges
    setCode: "3ed",
    rarity: "rare",
};

export const rockHydra3ed: CardPrint = {
    printId: "c2a08993-d6c5-45ad-82dc-093c8b912a56",
    definitionId: "410ac9e6-fbc1-4cc8-84db-84e2eb1bab97", // Rock Hydra
    setCode: "3ed",
    rarity: "rare",
};

export const sedgeTroll3ed: CardPrint = {
    printId: "485d3707-59ce-4350-9ec8-9df232f88c04",
    definitionId: "b13bf496-f3c0-4c13-8282-e7abfab6a198", // Sedge Troll
    setCode: "3ed",
    rarity: "rare",
};

export const shatter3ed: CardPrint = {
    printId: "93ff3216-aaaf-4c8f-8355-82e1fc61a747",
    definitionId: "50dc7fc1-cb6a-4c68-b993-1a25cf16226e", // Shatter
    setCode: "3ed",
    rarity: "common",
};

export const shatterstorm3ed: CardPrint = {
    printId: "52e5e508-afc6-409d-b912-33cf1d2351d1",
    definitionId: "0987461a-45c0-4956-8627-cd27a7e038d0", // Shatterstorm
    setCode: "3ed",
    rarity: "uncommon",
};

export const shivanDragon3ed: CardPrint = {
    printId: "69199dd2-dbac-4039-b4da-eb2b0671645f",
    definitionId: "fefbf149-f988-4f8b-9f53-56f5878116a6", // Shivan Dragon
    setCode: "3ed",
    rarity: "rare",
};

export const smoke3ed: CardPrint = {
    printId: "7b20087c-355d-4157-bd4e-b4dc2be49b69",
    definitionId: "7c67788e-d713-47c3-ab9f-b8a6212ae24f", // Smoke
    setCode: "3ed",
    rarity: "rare",
};

export const stoneGiant3ed: CardPrint = {
    printId: "a3b8a84d-44d8-4ad3-b04d-a94634e25453",
    definitionId: "7ffaedb9-25f8-4304-9085-e12505b93312", // Stone Giant
    setCode: "3ed",
    rarity: "uncommon",
};

export const stoneRain3ed: CardPrint = {
    printId: "35c7176a-694c-4e1d-8dca-dcd718d94250",
    definitionId: "57ff74cb-a2ed-4123-ac42-f72f9820049e", // Stone Rain
    setCode: "3ed",
    rarity: "common",
};

export const tunnel3ed: CardPrint = {
    printId: "7b379eeb-4d7e-4421-8fc4-b5255eb373f5",
    definitionId: "b21ebc9f-a93e-4d18-b3e8-8459e3abbf31", // Tunnel
    setCode: "3ed",
    rarity: "uncommon",
};

export const uthdenTroll3ed: CardPrint = {
    printId: "0403aef5-b5f3-4d07-a350-4874801b27e8",
    definitionId: "2ff21a6f-83a7-4bf3-a078-294e303232cc", // Uthden Troll
    setCode: "3ed",
    rarity: "uncommon",
};

export const wallOfFire3ed: CardPrint = {
    printId: "f7fbd53b-d1b2-41b7-a402-91227670a1d7",
    definitionId: "efcf12cd-fb70-444e-9641-73ffa0e8f16e", // Wall of Fire
    setCode: "3ed",
    rarity: "uncommon",
};

export const wallOfStone3ed: CardPrint = {
    printId: "667c227f-a3b7-4040-8b67-75a6fc209e67",
    definitionId: "140e567c-6e4a-42b0-8084-d6c9695ae802", // Wall of Stone
    setCode: "3ed",
    rarity: "uncommon",
};

export const wheelOfFortune3ed: CardPrint = {
    printId: "c14c07d4-6971-483a-add1-f3cdf18feae9",
    definitionId: "67b369c4-faa8-45c8-a1b9-98f228b69682", // Wheel of Fortune
    setCode: "3ed",
    rarity: "rare",
};
