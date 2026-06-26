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

export const burrowing2ed: CardPrint = {
    printId: "08c109d4-6dd1-42a5-90ed-f8a71b6a0ca5",
    definitionId: "a14c05e4-8df3-450b-8a98-5028e73b14c1", // Burrowing
    setCode: "2ed",
    rarity: "uncommon",
};

export const chaoslace2ed: CardPrint = {
    printId: "f2776675-8720-4a4d-8d7b-96de9ad14533",
    definitionId: "72ea2048-57bc-43d5-8987-33ca727f1a97", // Chaoslace
    setCode: "2ed",
    rarity: "rare",
};

export const disintegrate2ed: CardPrint = {
    printId: "f94878cc-4c0f-42e4-a49f-02a2b269ef06",
    definitionId: "8712c49e-f171-4669-bed9-87575a37af11", // Disintegrate
    setCode: "2ed",
    rarity: "common",
};

export const dragonWhelp2ed: CardPrint = {
    printId: "7ad8ab3d-8a77-4fd3-8d5a-ac1e8a09e3bc",
    definitionId: "6bbf1eab-bc32-4835-b566-8634b1fe81b0", // Dragon Whelp
    setCode: "2ed",
    rarity: "uncommon",
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

export const falseOrders2ed: CardPrint = {
    printId: "a59c24d9-804b-45d0-b60c-cfc7a6af7ef5",
    definitionId: "7eb71ac4-796d-4011-9002-1129bc09c284", // False Orders
    setCode: "2ed",
    rarity: "common",
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

export const fork2ed: CardPrint = {
    printId: "a877d692-018b-4a08-ab6f-9707b267f6fd",
    definitionId: "e6b43916-fe2d-417a-a550-d7c795023297", // Fork
    setCode: "2ed",
    rarity: "rare",
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

export const hillGiant2ed: CardPrint = {
    printId: "df03759e-17a0-4191-bd4d-e823846924ce",
    definitionId: "0ddb98e8-13fe-4786-83f7-b72c56db135a", // Hill Giant
    setCode: "2ed",
    rarity: "common",
};

export const hurloonMinotaur2ed: CardPrint = {
    printId: "8ca4c6df-a456-4eb3-90fc-f1e7ee8c48e4",
    definitionId: "78a9088f-8755-47cb-aa93-51d992ccab90", // Hurloon Minotaur
    setCode: "2ed",
    rarity: "common",
};

export const ironclawOrcs2ed: CardPrint = {
    printId: "0e17623a-5bc0-42d7-a842-394de0a01a01",
    definitionId: "d56421a8-34ae-4033-943f-c59a7bf2b6f9", // Ironclaw Orcs
    setCode: "2ed",
    rarity: "common",
};

export const keldonWarlord2ed: CardPrint = {
    printId: "f2d0bc79-d2f8-43e7-9106-c0d01db31fa2",
    definitionId: "8fe3fd83-969c-4add-888f-86f4306b067c", // Keldon Warlord
    setCode: "2ed",
    rarity: "uncommon",
};

export const lightningBolt2ed: CardPrint = {
    printId: "ff1b8fc5-604a-4449-a73d-861e53642a70",
    definitionId: "d573ef03-4730-45aa-93dd-e45ac1dbaf4a", // Lightning Bolt
    setCode: "2ed",
    rarity: "common",
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

export const monsSGoblinRaiders2ed: CardPrint = {
    printId: "0d3eff55-6a14-4c01-8b05-715094a319b3",
    definitionId: "b4eb3db3-6a7c-488a-9433-d5d1d3133816", // Mons's Goblin Raiders
    setCode: "2ed",
    rarity: "common",
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

export const powerSurge2ed: CardPrint = {
    printId: "98ac9e72-603b-43cf-b959-03552c44ae22",
    definitionId: "62858604-ca5a-4f69-a045-a7515ebfabf2", // Power Surge
    setCode: "2ed",
    rarity: "rare",
};

export const ragingRiver2ed: CardPrint = {
    printId: "7ee63877-056e-413d-932a-a393a4183686",
    definitionId: "61e4f56d-1f4f-49f2-8534-0d09196a3327", // Raging River
    setCode: "2ed",
    rarity: "rare",
};

export const redElementalBlast2ed: CardPrint = {
    printId: "1c69e1c9-e8ed-4497-8098-0d412a09c0f9",
    definitionId: "776ad9be-3309-4f1d-9f27-6219d9477662", // Red Elemental Blast
    setCode: "2ed",
    rarity: "common",
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

export const sedgeTroll2ed: CardPrint = {
    printId: "5a30ed3f-0b21-45ea-83af-339249b4e93e",
    definitionId: "b13bf496-f3c0-4c13-8282-e7abfab6a198", // Sedge Troll
    setCode: "2ed",
    rarity: "rare",
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

export const smoke2ed: CardPrint = {
    printId: "4d2553c0-1105-4eed-baf2-e13f1005dfb7",
    definitionId: "7c67788e-d713-47c3-ab9f-b8a6212ae24f", // Smoke
    setCode: "2ed",
    rarity: "rare",
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

export const tunnel2ed: CardPrint = {
    printId: "a0176176-0530-43e6-85e4-d1f4296f0697",
    definitionId: "b21ebc9f-a93e-4d18-b3e8-8459e3abbf31", // Tunnel
    setCode: "2ed",
    rarity: "uncommon",
};

export const twoHeadedGiantOfForiys2ed: CardPrint = {
    printId: "67299451-5302-4639-a4bc-6109521a2c0c",
    definitionId: "31c687dc-ee0c-4e54-a2b3-5d8e633b3245", // Two-Headed Giant of Foriys
    setCode: "2ed",
    rarity: "rare",
};

export const uthdenTroll2ed: CardPrint = {
    printId: "30bb1158-fe16-49e6-9b7a-44b7bee84737",
    definitionId: "2ff21a6f-83a7-4bf3-a078-294e303232cc", // Uthden Troll
    setCode: "2ed",
    rarity: "uncommon",
};

export const wallOfFire2ed: CardPrint = {
    printId: "74841ee8-2af0-4019-898d-d0ce72fc62c3",
    definitionId: "efcf12cd-fb70-444e-9641-73ffa0e8f16e", // Wall of Fire
    setCode: "2ed",
    rarity: "uncommon",
};

export const wallOfStone2ed: CardPrint = {
    printId: "2a2cab55-fc64-4b3f-bc46-a1a297d2d448",
    definitionId: "140e567c-6e4a-42b0-8084-d6c9695ae802", // Wall of Stone
    setCode: "2ed",
    rarity: "uncommon",
};

export const wheelOfFortune2ed: CardPrint = {
    printId: "4407fb95-0ed2-4c95-91b9-09eb52bf537e",
    definitionId: "67b369c4-faa8-45c8-a1b9-98f228b69682", // Wheel of Fortune
    setCode: "2ed",
    rarity: "rare",
};
