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

export const burrowingLeb: CardPrint = {
    printId: "8795bab7-ced2-4a1d-8c57-636bc4c0a977",
    definitionId: "a14c05e4-8df3-450b-8a98-5028e73b14c1", // burrowing (stub)
    setCode: "leb",
    rarity: "uncommon",
};

export const chaoslaceLeb: CardPrint = {
    printId: "d980e9c0-db88-41f9-8dbf-89f0e1ac6c20",
    definitionId: "72ea2048-57bc-43d5-8987-33ca727f1a97", // chaoslace (stub)
    setCode: "leb",
    rarity: "rare",
};

export const disintegrateLeb: CardPrint = {
    printId: "cfb3a6b9-a119-49c0-9baf-b552fdd00b28",
    definitionId: "8712c49e-f171-4669-bed9-87575a37af11", // disintegrate (stub)
    setCode: "leb",
    rarity: "common",
};

export const dragonWhelpLeb: CardPrint = {
    printId: "2e009adf-aded-4d64-ba3e-ddc3448c967a",
    definitionId: "6bbf1eab-bc32-4835-b566-8634b1fe81b0",
    setCode: "leb",
    rarity: "uncommon",
};

export const dwarvenDemolitionTeamLeb: CardPrint = {
    printId: "e552dfb6-b8a5-419d-b098-5aedc0500684",
    definitionId: "03482c9c-1f25-4d73-9243-17462ea37ac4", // dwarvenDemolitionTeam (stub)
    setCode: "leb",
    rarity: "uncommon",
};

export const dwarvenWarriorsLeb: CardPrint = {
    printId: "c0de88cf-b9e5-4611-a16f-2787d8d9d269",
    definitionId: "2d4d87a3-5f8b-4152-9a8b-538ab49d62e8", // dwarvenWarriors (stub)
    setCode: "leb",
    rarity: "common",
};

export const earthElementalLeb: CardPrint = {
    printId: "c427e8cc-d908-4b88-931d-a540fc8bfe74",
    definitionId: "b24b5864-44c0-4bc8-8705-9504f83b2c03", // earthElemental
    setCode: "leb",
    rarity: "uncommon",
};

export const earthbindLeb: CardPrint = {
    printId: "e5955a9d-8a0e-4e57-9433-ed3392b2f308",
    definitionId: "a6d492b7-b0b3-420e-8d00-6dacb11de77e", // earthbind (stub)
    setCode: "leb",
    rarity: "common",
};

export const earthquakeLeb: CardPrint = {
    printId: "86435875-ac92-4348-b41e-19570cf62a1c",
    definitionId: "e68ac362-6cdc-48a6-bdd3-4f8ea32add64", // earthquake
    setCode: "leb",
    rarity: "rare",
};

export const falseOrdersLeb: CardPrint = {
    printId: "e4ebc485-f1b7-436d-8c90-9acf2f7d92e5",
    definitionId: "7eb71ac4-796d-4011-9002-1129bc09c284", // falseOrders (stub)
    setCode: "leb",
    rarity: "common",
};

export const fireElementalLeb: CardPrint = {
    printId: "376cb9e5-89fb-4091-8a20-140bb6de0ef6",
    definitionId: "da237992-2919-4e37-8f56-2164095f59b5", // fireElemental
    setCode: "leb",
    rarity: "uncommon",
};

export const fireballLeb: CardPrint = {
    printId: "a285ab2e-836e-45b0-894e-574f733cf3db",
    definitionId: "b7623c00-144b-4a8f-9c6c-f5e9e4f65ece", // fireball
    setCode: "leb",
    rarity: "common",
};

export const firebreathingLeb: CardPrint = {
    printId: "235e4321-0216-4d6a-a57b-72ebff427b09",
    definitionId: "3eb27381-505d-4e47-bf66-9e7ba91a5075", // firebreathing (stub)
    setCode: "leb",
    rarity: "common",
};

export const flashfiresLeb: CardPrint = {
    printId: "5a2a91b9-c45f-4e3d-b3c4-944493bdd86a",
    definitionId: "ee8a05a4-0ce3-4abe-bb60-08af53cf08e5", // flashfires
    setCode: "leb",
    rarity: "uncommon",
};

export const forkLeb: CardPrint = {
    printId: "8144418b-e3e5-459f-8db2-f2e348fba4da",
    definitionId: "e6b43916-fe2d-417a-a550-d7c795023297", // fork (stub)
    setCode: "leb",
    rarity: "rare",
};

export const goblinBalloonBrigadeLeb: CardPrint = {
    printId: "3fdb52dd-4fc5-4594-b53b-ea169325be0b",
    definitionId: "5129b422-7a35-4bc5-b14b-c814012a0d8f", // goblinBalloonBrigade (stub)
    setCode: "leb",
    rarity: "uncommon",
};

export const goblinKingLeb: CardPrint = {
    printId: "65705a8d-6bb1-4289-b8b0-8546ccc478dc",
    definitionId: "5873672d-37ea-4c0f-97f3-12b74fde112d", // goblinKing (stub)
    setCode: "leb",
    rarity: "rare",
};

export const graniteGargoyleLeb: CardPrint = {
    printId: "affb57f4-273a-425c-a1b3-d0a5407f43d5",
    definitionId: "f15bf2b2-6848-4fbd-b89a-8d8da8ae1cdc", // graniteGargoyle (stub)
    setCode: "leb",
    rarity: "rare",
};

export const grayOgreLeb: CardPrint = {
    printId: "41023495-d3cb-4cb0-b95c-f717480a76a5",
    definitionId: "73ae5276-b607-4f23-a9d2-e8cc7b8e3693", // grayOgre
    setCode: "leb",
    rarity: "common",
};

export const hillGiantLeb: CardPrint = {
    printId: "4905e98f-0c5a-4ec7-b85b-dc2c3549d5d0",
    definitionId: "0ddb98e8-13fe-4786-83f7-b72c56db135a", // hillGiant
    setCode: "leb",
    rarity: "common",
};

export const hurloonMinotaurLeb: CardPrint = {
    printId: "8ef29573-99a1-42fc-8941-2466cda2465f",
    definitionId: "78a9088f-8755-47cb-aa93-51d992ccab90", // hurloonMinotaur
    setCode: "leb",
    rarity: "common",
};

export const ironclawOrcsLeb: CardPrint = {
    printId: "a7be8a25-a744-426e-8e66-7fdff2789af4",
    definitionId: "d56421a8-34ae-4033-943f-c59a7bf2b6f9", // ironclawOrcs (stub)
    setCode: "leb",
    rarity: "common",
};

export const keldonWarlordLeb: CardPrint = {
    printId: "b07deb9b-5b88-4658-8ae8-041568992019",
    definitionId: "8fe3fd83-969c-4add-888f-86f4306b067c", // keldonWarlord (stub)
    setCode: "leb",
    rarity: "uncommon",
};

export const lightningBoltLeb: CardPrint = {
    printId: "b5d3dcab-2260-479d-9ef6-dfb92d4f6061",
    definitionId: "d573ef03-4730-45aa-93dd-e45ac1dbaf4a", // lightningBolt
    setCode: "leb",
    rarity: "common",
};

export const manaFlareLeb: CardPrint = {
    printId: "b44d3087-ced3-40e8-a63b-1733b7e7f34c",
    definitionId: "7fb99a26-beeb-4aca-bb02-b2d2ce0595f9", // manaFlare (stub)
    setCode: "leb",
    rarity: "rare",
};

export const manabarbsLeb: CardPrint = {
    printId: "7c01cae0-4d61-4bf7-a145-82d9bb11d816",
    definitionId: "6121f72f-680f-4bb4-ae4d-37ee4ebed4d8", // manabarbs (stub)
    setCode: "leb",
    rarity: "rare",
};

export const monssGoblinRaidersLeb: CardPrint = {
    printId: "2fbf039d-0ab9-4c42-a0a3-cbfa3ea1dd6e",
    definitionId: "b4eb3db3-6a7c-488a-9433-d5d1d3133816", // monssGoblinRaiders
    setCode: "leb",
    rarity: "common",
};

export const orcishArtilleryLeb: CardPrint = {
    printId: "4d2354ee-2ce0-4adb-b48c-0e30b952e545",
    definitionId: "a97208b1-a91b-4129-8a00-2f97b418accc", // orcishArtillery (stub)
    setCode: "leb",
    rarity: "uncommon",
};

export const orcishOriflammeLeb: CardPrint = {
    printId: "f2752cf2-9a48-49a8-98ff-2e32a9121d78",
    definitionId: "911538ea-322c-4c40-a9c3-35e47fe60fce",
    setCode: "leb",
    rarity: "uncommon",
};

export const powerSurgeLeb: CardPrint = {
    printId: "f52eb10a-a9eb-44b7-95ae-12fb551c8fa5",
    definitionId: "62858604-ca5a-4f69-a045-a7515ebfabf2", // powerSurge (stub)
    setCode: "leb",
    rarity: "rare",
};

export const ragingRiverLeb: CardPrint = {
    printId: "c14746bb-aa00-4be2-9740-d87f976296d2",
    definitionId: "61e4f56d-1f4f-49f2-8534-0d09196a3327", // ragingRiver (stub)
    setCode: "leb",
    rarity: "rare",
};

export const redElementalBlastLeb: CardPrint = {
    printId: "4fafd3f9-f7de-4d6e-8824-6b60866fc50f",
    definitionId: "776ad9be-3309-4f1d-9f27-6219d9477662", // redElementalBlast (stub)
    setCode: "leb",
    rarity: "common",
};

export const rocOfKherRidgesLeb: CardPrint = {
    printId: "f1b9e3ae-c7e9-455f-abfe-220262719beb",
    definitionId: "731a4b86-c213-4d8e-bf01-0a0e8cff0ff1", // rocOfKherRidges
    setCode: "leb",
    rarity: "rare",
};

export const rockHydraLeb: CardPrint = {
    printId: "c17a982d-466d-4fec-b85a-a44161e5dad5",
    definitionId: "410ac9e6-fbc1-4cc8-84db-84e2eb1bab97", // rockHydra (stub)
    setCode: "leb",
    rarity: "rare",
};

export const sedgeTrollLeb: CardPrint = {
    printId: "02ec317b-52a6-4490-80e5-a56826b06771",
    definitionId: "b13bf496-f3c0-4c13-8282-e7abfab6a198", // sedgeTroll (stub)
    setCode: "leb",
    rarity: "rare",
};

export const shatterLeb: CardPrint = {
    printId: "76ddf3f4-1305-4599-bf4c-f9e148bdda4d",
    definitionId: "50dc7fc1-cb6a-4c68-b993-1a25cf16226e", // shatter (stub)
    setCode: "leb",
    rarity: "common",
};

export const shivanDragonLeb: CardPrint = {
    printId: "5e64822a-6817-4e1e-8155-3e95f8e3763f",
    definitionId: "fefbf149-f988-4f8b-9f53-56f5878116a6", // shivanDragon (stub)
    setCode: "leb",
    rarity: "rare",
};

export const smokeLeb: CardPrint = {
    printId: "7eb0cb82-d930-43c3-a6d6-f947018d45d6",
    definitionId: "7c67788e-d713-47c3-ab9f-b8a6212ae24f", // smoke (stub)
    setCode: "leb",
    rarity: "rare",
};

export const stoneGiantLeb: CardPrint = {
    printId: "a2b5f545-a87d-4292-880f-5cd2f6755748",
    definitionId: "7ffaedb9-25f8-4304-9085-e12505b93312",
    setCode: "leb",
    rarity: "uncommon",
};

export const stoneRainLeb: CardPrint = {
    printId: "901831ad-1840-4287-b6a0-bea310598dc2",
    definitionId: "57ff74cb-a2ed-4123-ac42-f72f9820049e", // stoneRain (stub)
    setCode: "leb",
    rarity: "common",
};

export const tunnelLeb: CardPrint = {
    printId: "cc738025-a771-4186-b08c-7b37c0e9713b",
    definitionId: "b21ebc9f-a93e-4d18-b3e8-8459e3abbf31", // tunnel (stub)
    setCode: "leb",
    rarity: "uncommon",
};

export const twoHeadedGiantOfForiysLeb: CardPrint = {
    printId: "30fcbb16-f8e7-4f6e-a806-541ef54aa025",
    definitionId: "31c687dc-ee0c-4e54-a2b3-5d8e633b3245", // twoHeadedGiantOfForiys (stub)
    setCode: "leb",
    rarity: "rare",
};

export const uthdenTrollLeb: CardPrint = {
    printId: "91f46e9a-6075-4fa5-8f60-f81e2024b13d",
    definitionId: "2ff21a6f-83a7-4bf3-a078-294e303232cc", // uthdenTroll (stub)
    setCode: "leb",
    rarity: "uncommon",
};

export const wallOfFireLeb: CardPrint = {
    printId: "88baaea5-69ec-4756-86c2-9c9d73ca8ef1",
    definitionId: "efcf12cd-fb70-444e-9641-73ffa0e8f16e", // wallOfFire (stub)
    setCode: "leb",
    rarity: "uncommon",
};

export const wallOfStoneLeb: CardPrint = {
    printId: "329ba196-a107-41ac-b02a-5f8b10ecd130",
    definitionId: "140e567c-6e4a-42b0-8084-d6c9695ae802", // wallOfStone
    setCode: "leb",
    rarity: "uncommon",
};

export const wheelOfFortuneLeb: CardPrint = {
    printId: "9052369f-840f-438e-b86d-e2f8d6339585",
    definitionId: "67b369c4-faa8-45c8-a1b9-98f228b69682", // wheelOfFortune
    setCode: "leb",
    rarity: "rare",
};
