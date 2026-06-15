import type { CardDefinition, CardPrint } from "../types";
import { makeCircleOfProtection, makeDualLand } from "../abilities";

// LEB (Limited Edition Beta). Like every set file, this is a mix of:
//   • CardPrint entries — reprints of cards whose mechanics already live on a
//     LEA CardDefinition. A print only declares the per-edition Scryfall UUID
//     (printId) used for image lookup; the registry resolves printId →
//     definitionId → the shared LEA CardDefinition.
//   • CardDefinition entries — cards first implemented in this set (the two
//     Beta-original cards below, which never existed in Alpha). See ADR 0014.
//
// Cards declared permanently out of scope (ADR 0010) and cards blocked on an
// open issue stay commented with a back-reference, so "LEB complete" reads as
// "complete minus the named exclusions". A commented stub whose definitionId
// points at a not-yet-implemented LEA stub is uncommented once that LEA def
// lands.

export const airElementalLeb: CardPrint = {
    printId: "36a94a6d-26b1-4486-9444-ec366e6f4d6e",
    definitionId: "69c3b2a3-0daa-4d42-832d-fcdfda6555ea", // airElemental
    setCode: "leb",
};

export const ancestralRecallLeb: CardPrint = {
    printId: "46b0a5c2-ac85-448e-9e87-12fc74fd4147",
    definitionId: "70e7ddf2-5604-41e7-bb9d-ddd03d3e9d0b", // ancestralRecall
    setCode: "leb",
};

export const animateArtifactLeb: CardPrint = {
    printId: "cb575b27-d2ca-4d90-a650-dc670484f607",
    definitionId: "664b46f5-0424-4f4e-9f26-6bd2cf5e0357", // animateArtifact (stub)
    setCode: "leb",
};

export const animateDeadLeb: CardPrint = {
    printId: "20d5059a-60a4-4135-863f-85a48bff8731",
    definitionId: "8fd7861d-925f-4b4c-a4ab-60be6f43d50b", // animateDead (stub)
    setCode: "leb",
};

export const animateWallLeb: CardPrint = {
    printId: "5c5b4738-20bb-465d-b67e-c6146dce9d0b",
    definitionId: "d5c83259-9b90-47c2-b48e-c7d78519e792", // animateWall (stub)
    setCode: "leb",
};

export const ankhOfMishraLeb: CardPrint = {
    printId: "a0367e54-eb07-475a-b06b-f869a046a86c",
    definitionId: "f594b7aa-d44e-47c4-989b-565f881e25f1", // ankhOfMishra (stub)
    setCode: "leb",
};

export const armageddonLeb: CardPrint = {
    printId: "02c4edfa-7822-40bc-88d1-d051b3a64df1",
    definitionId: "5b6ddce7-b9c5-431d-a0b0-46d4aa93cbcb", // armageddon
    setCode: "leb",
};

export const aspectOfWolfLeb: CardPrint = {
    printId: "36f7dc8e-e02a-4ceb-8767-2875f86e6811",
    definitionId: "fd9ac9e6-1395-4fbd-80e2-645f0d910c29", // aspectOfWolf (stub)
    setCode: "leb",
};

export const badMoonLeb: CardPrint = {
    printId: "bf812f48-633c-46ab-b0c3-4819ab1b4e49",
    definitionId: "43572906-ea74-4411-a549-5dc401591d2a", // badMoon
    setCode: "leb",
};

export const badlandsLeb: CardPrint = {
    printId: "a3393436-3426-4903-8f41-7abcbf6c18c2",
    definitionId: "717f6d10-9144-4ade-9ac6-a481cc66b875", // badlands
    setCode: "leb",
};

export const balanceLeb: CardPrint = {
    printId: "0f2c32a0-ee97-4239-94e3-aabab91dab83",
    definitionId: "6f9ea46a-411f-40ce-a873-a905180093f4", // balance
    setCode: "leb",
};

export const basaltMonolithLeb: CardPrint = {
    printId: "81d73362-43c1-4dd0-87dd-9aa7ae13ff2f",
    definitionId: "66a74c89-6f86-4ec8-af17-391cd5026054", // basaltMonolith (stub)
    setCode: "leb",
};

export const bayouLeb: CardPrint = {
    printId: "17db2b6a-eaa8-4a08-9e86-370bbd058574",
    definitionId: "412ceddd-2b9a-4551-a6bf-ae2830a2010a", // bayou
    setCode: "leb",
};

export const benalishHeroLeb: CardPrint = {
    printId: "f62c68d0-9b1e-4abe-991d-a645effeb676",
    definitionId: "11600105-56c6-4073-a4a6-8469030b39c9", // benalishHero (stub)
    setCode: "leb",
};

export const berserkLeb: CardPrint = {
    printId: "88d6f431-a7ea-4508-a52c-86d33e12e4e4",
    definitionId: "e173c8ce-2352-405e-ad00-e3bb94ced1ad", // berserk
    setCode: "leb",
};

export const birdsOfParadiseLeb: CardPrint = {
    printId: "852d7a68-8682-4073-a44b-f10f5613879c",
    definitionId: "55fe6449-1f23-43dc-adee-d144cd505b5c", // birdsOfParadise
    setCode: "leb",
};

export const blackKnightLeb: CardPrint = {
    printId: "1eced352-d49c-4e91-a368-52904d77a69d",
    definitionId: "c1662949-0d69-49a3-8c69-daf10717ed4e", // blackKnight
    setCode: "leb",
};

export const blackLotusLeb: CardPrint = {
    printId: "b3a69a1c-c80f-4413-a6fd-ae54cabbce28",
    definitionId: "b0faa7f2-b547-42c4-a810-839da50dadfe", // blackLotus
    setCode: "leb",
};

export const blackViseLeb: CardPrint = {
    printId: "d234f3d7-2f15-4fbf-92db-16c3433d644b",
    definitionId: "76ac72f8-5b1e-4d67-a796-ef69cde27424", // blackVise (stub)
    setCode: "leb",
};

export const blackWardLeb: CardPrint = {
    printId: "30d5d3fe-5741-40f7-8f45-dadb818d79b0",
    definitionId: "15967a39-303f-457d-bcde-51837c8d63e1", // blackWard
    setCode: "leb",
};

export const blazeOfGloryLeb: CardPrint = {
    printId: "f78aef20-e3bb-484c-9fa1-d2859408b04a",
    definitionId: "98fba951-c5bb-497c-9292-ce1b2a1e1247", // blazeOfGlory (stub)
    setCode: "leb",
};

export const blessingLeb: CardPrint = {
    printId: "bcd624c8-f06e-4181-865e-6a14ffc9302f",
    definitionId: "f131fd27-18da-47ca-b59f-135bcac83abd", // blessing (stub)
    setCode: "leb",
};

export const blueElementalBlastLeb: CardPrint = {
    printId: "7f07e272-6cc7-46d6-ad5c-473d1021c179",
    definitionId: "20d666ef-39bf-4fbf-8201-5f1056539da2", // blueElementalBlast (stub)
    setCode: "leb",
};

export const blueWardLeb: CardPrint = {
    printId: "aafae6f4-0880-4532-9224-44545bfa5eb4",
    definitionId: "93f9f0f2-e1cc-4740-888c-1336c6de0a27", // blueWard
    setCode: "leb",
};

export const bogWraithLeb: CardPrint = {
    printId: "da26289f-e0e6-4aae-8782-ebdbabf39819",
    definitionId: "6701874e-986e-4b81-9268-90b6171e6187", // bogWraith
    setCode: "leb",
};

export const braingeyserLeb: CardPrint = {
    printId: "a5dd8dbb-9538-4786-b20c-0ea2f446f323",
    definitionId: "62b19a12-6914-430e-81ce-dcfca47884df", // braingeyser
    setCode: "leb",
};

export const burrowingLeb: CardPrint = {
    printId: "8795bab7-ced2-4a1d-8c57-636bc4c0a977",
    definitionId: "a14c05e4-8df3-450b-8a98-5028e73b14c1", // burrowing (stub)
    setCode: "leb",
};

// Out of scope — see ADR 0010 (hidden-assignment pile combat with randomness).
// export const camouflageLeb: CardPrint = {
//     printId: "2f55ff95-32a3-43ba-82e5-a5a3bc2cc9e5",
//     definitionId: "3838c2a3-7fab-4976-9c1b-2891aee24e52", // camouflage (stub)
//     setCode: "leb",
// };

export const castleLeb: CardPrint = {
    printId: "a8ba6b09-b24f-40cb-b219-ad8a1fd6692c",
    definitionId: "b0da8d56-3178-44c2-9344-95d2346d326f", // castle
    setCode: "leb",
};

export const celestialPrismLeb: CardPrint = {
    printId: "243c5460-8d4c-47a7-8a9c-ab626daa520a",
    definitionId: "a47417cb-1ea7-4f65-ba06-e27a99373114", // celestialPrism (stub)
    setCode: "leb",
};

export const channelLeb: CardPrint = {
    printId: "6fa6468a-335a-467d-aef6-e537af9d5c1c",
    definitionId: "c1862c47-71cc-45a3-8805-a5ddc62e55ea", // channel
    setCode: "leb",
};

// Out of scope — see ADR 0010 (physical-dexterity card, irrealizable).
// export const chaosOrbLeb: CardPrint = {
//     printId: "6bec436c-2869-432a-b3cf-633a58af6d4c",
//     definitionId: "92274971-7c4a-4326-b0fe-75e2d124f718", // chaosOrb (stub)
//     setCode: "leb",
// };

export const chaoslaceLeb: CardPrint = {
    printId: "d980e9c0-db88-41f9-8dbf-89f0e1ac6c20",
    definitionId: "72ea2048-57bc-43d5-8987-33ca727f1a97", // chaoslace (stub)
    setCode: "leb",
};

// Circle of Protection: Black — Beta-original (no Alpha printing). Completes
// the CoP cycle; same factory as the LEA CoPs (CR 615). Single printing, so
// the def id is its own LEB Scryfall id — no separate CardPrint needed.
export const circleOfProtectionBlack: CardDefinition = makeCircleOfProtection({
    id: "fa47b4cd-8da4-4544-b011-ba92b7009203",
    name: "Circle of Protection: Black",
    oracleText:
        "{1}: The next time a black source of your choice would deal damage to you this turn, prevent that damage.",
    color: "B",
    colorWord: "Black",
});

export const circleOfProtectionBlueLeb: CardPrint = {
    printId: "07a86eb1-f6a0-4a4e-bd59-e19e22ec487d",
    definitionId: "848b1a7f-e8ba-40b5-92b7-af1e963a0319", // circleOfProtectionBlue
    setCode: "leb",
};

export const circleOfProtectionGreenLeb: CardPrint = {
    printId: "e041b0ea-4a57-4950-9f8e-72d6e6ab2968",
    definitionId: "1ae32d20-b438-4f43-b603-e8f706ecfb03", // circleOfProtectionGreen
    setCode: "leb",
};

export const circleOfProtectionRedLeb: CardPrint = {
    printId: "5de9dc85-d566-4cb0-a2e3-1ed4e5fe2f14",
    definitionId: "b3dd94c5-42f6-4148-be6e-2a3a4226cc0e", // circleOfProtectionRed
    setCode: "leb",
};

export const circleOfProtectionWhiteLeb: CardPrint = {
    printId: "671aca82-6c55-43ef-b452-d6a2e706a7ae",
    definitionId: "92df19c9-e127-42d9-8dd2-7fa5a7095428", // circleOfProtectionWhite
    setCode: "leb",
};

export const clockworkBeastLeb: CardPrint = {
    printId: "6c6efe95-ae57-4ff1-8f8a-0d6f3bd36d9c",
    definitionId: "27f916a2-0ace-44b5-99dc-72979af34db9", // clockworkBeast (stub)
    setCode: "leb",
};

export const cloneLeb: CardPrint = {
    printId: "af53b5fc-c31a-4f26-93bf-0c45c1f4e1e5",
    definitionId: "f00d33dd-4eb2-4446-9813-1923d8e2d2f3", // clone (stub)
    setCode: "leb",
};

export const cockatriceLeb: CardPrint = {
    printId: "fc71dd0f-dffe-4671-b9e3-ddec70626688",
    definitionId: "9cd91814-6177-4a3d-a1c1-a3be7d7c7957", // cockatrice (stub)
    setCode: "leb",
};

export const consecrateLandLeb: CardPrint = {
    printId: "077cf242-f866-497f-a23c-70e1b04a748e",
    definitionId: "d2379f78-c03f-447f-b3c9-10a918d556e9", // consecrateLand
    setCode: "leb",
};

export const conservatorLeb: CardPrint = {
    printId: "d4f54af3-7c85-43da-b0ce-df4a44af4736",
    definitionId: "c7824e2a-4eff-4f72-9216-0db30a4f4252", // conservator (stub)
    setCode: "leb",
};

// Out of scope — see ADR 0010 (ante; game mode not modelled).
// export const contractFromBelowLeb: CardPrint = {
//     printId: "62f96e43-aebd-4de2-969a-37cd1d62f127",
//     definitionId: "9853b0ce-4763-4877-9741-f9145a3659c6", // contractFromBelow (stub)
//     setCode: "leb",
// };

export const controlMagicLeb: CardPrint = {
    printId: "133315bd-3c46-4eff-938e-4dba63631c1b",
    definitionId: "7b52f459-c703-4a0b-9114-ff69eec61287", // controlMagic
    setCode: "leb",
};

export const conversionLeb: CardPrint = {
    printId: "4d9a5bb5-23cd-4f9a-8c8e-d009fb7bdf59",
    definitionId: "13186bc9-8d9c-433b-ba15-121ef94dd68a", // conversion (stub)
    setCode: "leb",
};

export const copperTabletLeb: CardPrint = {
    printId: "93842064-a0a8-4e4d-9c8a-e8a86448d225",
    definitionId: "30935e4a-013e-4c46-ad05-304df8e5dfa4", // copperTablet (stub)
    setCode: "leb",
};

export const copyArtifactLeb: CardPrint = {
    printId: "e24fe07d-1328-4165-b7a0-622b60cec481",
    definitionId: "fd5ed955-1193-4e6a-a3e2-f54c1f9bf063", // copyArtifact (stub)
    setCode: "leb",
};

export const counterspellLeb: CardPrint = {
    printId: "9e11bf7c-f439-4529-b29a-d711359807ef",
    definitionId: "0df55e3f-14de-46ef-b6b1-616618724d9e", // counterspell
    setCode: "leb",
};

export const crawWurmLeb: CardPrint = {
    printId: "17d5c1c7-a882-479a-9077-0784e83b462d",
    definitionId: "bfed1a95-bd67-4e16-a781-81866028af2f", // crawWurm
    setCode: "leb",
};

export const creatureBondLeb: CardPrint = {
    printId: "4ce48b24-a65e-42d9-a147-8f89028fada7",
    definitionId: "ee4bd7d1-77e5-46e5-a594-c24469e88c4c", // creatureBond (stub)
    setCode: "leb",
};

export const crusadeLeb: CardPrint = {
    printId: "2d5fbd9d-48bf-4600-8ca4-2ce2ca48128e",
    definitionId: "057986c7-20c0-4157-b4df-beae4ef5c66d", // crusade
    setCode: "leb",
};

export const crystalRodLeb: CardPrint = {
    printId: "e44d892f-a975-4062-8a54-5777d2600504",
    definitionId: "76693233-7961-4b7e-80f2-ed90e494c4aa", // crystalRod (stub)
    setCode: "leb",
};

export const cursedLandLeb: CardPrint = {
    printId: "1eea8122-00c2-4d00-b87b-12eea86b16ba",
    definitionId: "cf5f3c61-1e54-4eea-bf82-311cfa988e6a", // cursedLand (stub)
    setCode: "leb",
};

export const cyclopeanTombLeb: CardPrint = {
    printId: "00775f44-fbe6-41ee-9977-d13d1fb5b6fb",
    definitionId: "894c5cf2-8ae2-427a-bcbc-67df0bdfee9d", // cyclopeanTomb (stub)
    setCode: "leb",
};

export const darkRitualLeb: CardPrint = {
    printId: "0690f724-eb95-416b-b064-f1239e2a30e8",
    definitionId: "ebb6664d-23ca-456e-9916-afcd6f26aa7f", // darkRitual
    setCode: "leb",
};

// Out of scope — see ADR 0010 (ante; game mode not modelled).
// export const darkpactLeb: CardPrint = {
//     printId: "09b12bcb-a935-48be-a5e8-abbb890e91ca",
//     definitionId: "e78db688-93a2-47f5-9aa5-9158a72cd973", // darkpact (stub)
//     setCode: "leb",
// };

export const deathWardLeb: CardPrint = {
    printId: "b119edd8-7801-475e-943a-6cbf10f2d303",
    definitionId: "fa5466cc-aa57-4a7f-8b21-d92b2fe02e13", // deathWard
    setCode: "leb",
};

export const deathgripLeb: CardPrint = {
    printId: "c942a9af-e449-4f10-916c-6eb9e944de6a",
    definitionId: "2371c126-f19a-472a-ba5f-3b1366274ea0", // deathgrip (stub)
    setCode: "leb",
};

export const deathlaceLeb: CardPrint = {
    printId: "e16fc59a-17da-462a-86ea-31f8a9ac18a1",
    definitionId: "6ff1cefc-62cb-4525-b0c5-2b09603b4314", // deathlace (stub)
    setCode: "leb",
};

// Out of scope — see ADR 0010 (ante; game mode not modelled).
// export const demonicAttorneyLeb: CardPrint = {
//     printId: "60f37eac-e8fa-48d3-b936-74461ea1853c",
//     definitionId: "fd891fc6-d9d6-494e-ae65-8bea8f44b575", // demonicAttorney (stub)
//     setCode: "leb",
// };

export const demonicHordesLeb: CardPrint = {
    printId: "dc20c19b-7216-4f23-a3bb-70d4dcd3865e",
    definitionId: "6c9bb8b1-fb79-4b99-ba09-c6e6c860de50", // demonicHordes (stub)
    setCode: "leb",
};

export const demonicTutorLeb: CardPrint = {
    printId: "a5e571ef-1645-4584-ab53-e7ea5d443dea",
    definitionId: "711d4d54-5520-4de8-9b93-79902ed8e562", // demonicTutor
    setCode: "leb",
};

export const dingusEggLeb: CardPrint = {
    printId: "fe8ecaee-0de3-45ee-8428-09dc400d63d8",
    definitionId: "65eb6cda-e512-40a8-9c1f-335b713409ff", // dingusEgg (stub)
    setCode: "leb",
};

export const disenchantLeb: CardPrint = {
    printId: "9d61d0a5-7e92-4413-9121-925e1876b64d",
    definitionId: "2722d7e2-61c6-4934-9c21-875ee78fd06c", // disenchant
    setCode: "leb",
};

export const disintegrateLeb: CardPrint = {
    printId: "cfb3a6b9-a119-49c0-9baf-b552fdd00b28",
    definitionId: "8712c49e-f171-4669-bed9-87575a37af11", // disintegrate (stub)
    setCode: "leb",
};

export const disruptingScepterLeb: CardPrint = {
    printId: "ae91e07c-ad6d-41d9-bd65-184f92761334",
    definitionId: "ca571ee8-07a2-43b8-9acf-89cbfd3cf7c9", // disruptingScepter (stub)
    setCode: "leb",
};

export const dragonWhelpLeb: CardPrint = {
    printId: "2e009adf-aded-4d64-ba3e-ddc3448c967a",
    definitionId: "6bbf1eab-bc32-4835-b566-8634b1fe81b0",
    setCode: "leb",
};

export const drainLifeLeb: CardPrint = {
    printId: "9fbc6761-c4fc-4b4c-afb5-94ad4d21bc05",
    definitionId: "5d077a49-73d4-4958-b42a-31b814e110e8", // drainLife
    setCode: "leb",
};

export const drainPowerLeb: CardPrint = {
    printId: "9672caeb-5cf8-4b40-a371-005c911a67d9",
    definitionId: "b4f0660a-40e6-4d6e-9e1b-4d26e2e7de47",
    setCode: "leb",
};

export const drudgeSkeletonsLeb: CardPrint = {
    printId: "b1f3a1b9-d192-49d9-87bb-ca50e99edbd1",
    definitionId: "23614289-0d73-4747-a849-5cb67cc97d6a", // drudgeSkeletons (stub)
    setCode: "leb",
};

export const dwarvenDemolitionTeamLeb: CardPrint = {
    printId: "e552dfb6-b8a5-419d-b098-5aedc0500684",
    definitionId: "03482c9c-1f25-4d73-9243-17462ea37ac4", // dwarvenDemolitionTeam (stub)
    setCode: "leb",
};

export const dwarvenWarriorsLeb: CardPrint = {
    printId: "c0de88cf-b9e5-4611-a16f-2787d8d9d269",
    definitionId: "2d4d87a3-5f8b-4152-9a8b-538ab49d62e8", // dwarvenWarriors (stub)
    setCode: "leb",
};

export const earthElementalLeb: CardPrint = {
    printId: "c427e8cc-d908-4b88-931d-a540fc8bfe74",
    definitionId: "b24b5864-44c0-4bc8-8705-9504f83b2c03", // earthElemental
    setCode: "leb",
};

export const earthbindLeb: CardPrint = {
    printId: "e5955a9d-8a0e-4e57-9433-ed3392b2f308",
    definitionId: "a6d492b7-b0b3-420e-8d00-6dacb11de77e", // earthbind (stub)
    setCode: "leb",
};

export const earthquakeLeb: CardPrint = {
    printId: "86435875-ac92-4348-b41e-19570cf62a1c",
    definitionId: "e68ac362-6cdc-48a6-bdd3-4f8ea32add64", // earthquake
    setCode: "leb",
};

export const elvishArchersLeb: CardPrint = {
    printId: "c3240d5e-b3d4-4368-b09b-c309bc935152",
    definitionId: "1cb9d405-f2b5-4e10-a405-feafd2a87d90", // elvishArchers
    setCode: "leb",
};

export const evilPresenceLeb: CardPrint = {
    printId: "9e995f4b-efd3-4ac7-8fec-adb913294815",
    definitionId: "0551d66e-8cd4-48f0-aa17-15f26be9d85f", // evilPresence (stub)
    setCode: "leb",
};

export const falseOrdersLeb: CardPrint = {
    printId: "e4ebc485-f1b7-436d-8c90-9acf2f7d92e5",
    definitionId: "7eb71ac4-796d-4011-9002-1129bc09c284", // falseOrders (stub)
    setCode: "leb",
};

export const farmsteadLeb: CardPrint = {
    printId: "c49ecc66-dccb-4026-8c6e-0b275a635a1f",
    definitionId: "3455b006-9ea5-4aef-8ad2-d0701eb0cacf", // farmstead
    setCode: "leb",
};

export const fastbondLeb: CardPrint = {
    printId: "f48ed192-c1a1-437a-80dd-647a616b46e3",
    definitionId: "a575a9af-e1de-4a1d-91d8-440585377e4f", // fastbond (stub)
    setCode: "leb",
};

export const fearLeb: CardPrint = {
    printId: "67830531-970a-4339-8673-40954376455d",
    definitionId: "0cd927be-e63f-4371-a1d8-7a0489cb187e", // fear (stub)
    setCode: "leb",
};

export const feedbackLeb: CardPrint = {
    printId: "644288e8-e0b1-418f-b105-01a557a3e497",
    definitionId: "0eb8f591-d763-49bf-8ef9-86265aaa72f7", // feedback
    setCode: "leb",
};

export const fireElementalLeb: CardPrint = {
    printId: "376cb9e5-89fb-4091-8a20-140bb6de0ef6",
    definitionId: "da237992-2919-4e37-8f56-2164095f59b5", // fireElemental
    setCode: "leb",
};

export const fireballLeb: CardPrint = {
    printId: "a285ab2e-836e-45b0-894e-574f733cf3db",
    definitionId: "b7623c00-144b-4a8f-9c6c-f5e9e4f65ece", // fireball
    setCode: "leb",
};

export const firebreathingLeb: CardPrint = {
    printId: "235e4321-0216-4d6a-a57b-72ebff427b09",
    definitionId: "3eb27381-505d-4e47-bf66-9e7ba91a5075", // firebreathing (stub)
    setCode: "leb",
};

export const flashfiresLeb: CardPrint = {
    printId: "5a2a91b9-c45f-4e3d-b3c4-944493bdd86a",
    definitionId: "ee8a05a4-0ce3-4abe-bb60-08af53cf08e5", // flashfires
    setCode: "leb",
};

export const flightLeb: CardPrint = {
    printId: "24584ffa-8ed1-4930-b6d8-ac1d02738ed0",
    definitionId: "67c7784b-6b79-4268-a714-895c82809aff", // flight
    setCode: "leb",
};

export const fogLeb: CardPrint = {
    printId: "f4e9597a-4489-47e9-8b15-888acb402ddd",
    definitionId: "cfba606d-bb55-43ba-aa0c-299649958788", // fog (stub)
    setCode: "leb",
};

export const forceOfNatureLeb: CardPrint = {
    printId: "c25a61b3-c828-491c-868d-e4eff770c1bb",
    definitionId: "21551cb6-3a53-42dd-9bbd-4bc56304d6d3", // forceOfNature (stub)
    setCode: "leb",
};

export const forcefieldLeb: CardPrint = {
    printId: "34855fa8-959d-45a2-ad91-8b17019755be",
    definitionId: "3f2004c1-8efe-407f-bf48-27b807422eea", // forcefield (stub)
    setCode: "leb",
};

export const forestLeb300: CardPrint = {
    printId: "b5a922eb-49c7-45f0-92bc-671d7a8758f4",
    definitionId: "6f1c8cb0-38eb-408b-94e8-16db83999b3b", // forest
    setCode: "leb",
};

export const forestLeb301: CardPrint = {
    printId: "89ad91fc-50c2-44e0-b88e-2c13610377f9",
    definitionId: "6f1c8cb0-38eb-408b-94e8-16db83999b3b", // forest
    setCode: "leb",
};

export const forestLeb302: CardPrint = {
    printId: "b4075bbc-dbad-4a1e-a992-70aed713a459",
    definitionId: "6f1c8cb0-38eb-408b-94e8-16db83999b3b", // forest
    setCode: "leb",
};

export const forkLeb: CardPrint = {
    printId: "8144418b-e3e5-459f-8db2-f2e348fba4da",
    definitionId: "e6b43916-fe2d-417a-a550-d7c795023297", // fork (stub)
    setCode: "leb",
};

export const frozenShadeLeb: CardPrint = {
    printId: "89b6a352-40f5-4d7c-b2b6-2617539a1c1c",
    definitionId: "d0bd76c8-4cff-4c15-9686-7a299b589814", // frozenShade (stub)
    setCode: "leb",
};

export const fungusaurLeb: CardPrint = {
    printId: "75a58f0b-c772-4254-8686-182d26889f9c",
    definitionId: "5ad89f0d-b09b-40a0-84d6-3ee60dec7e23", // fungusaur (stub)
    setCode: "leb",
};

export const gaeasLiegeLeb: CardPrint = {
    printId: "554362d7-97b3-4a55-9292-15e90435088d",
    definitionId: "e2b15221-c8b0-4861-9f8b-8a65834ad499", // gaeasLiege (stub)
    setCode: "leb",
};

export const gauntletOfMightLeb: CardPrint = {
    printId: "63c0e240-07b0-45fb-90af-f4fce18c604e",
    definitionId: "da248001-ed75-4b68-9532-37d3cd5afc4c", // gauntletOfMight (stub)
    setCode: "leb",
};

export const giantGrowthLeb: CardPrint = {
    printId: "755a45bd-8fe6-4e4d-8065-024a2836751b",
    definitionId: "367dbefe-3366-408e-9fcf-7dc00f8cc201", // giantGrowth
    setCode: "leb",
};

export const giantSpiderLeb: CardPrint = {
    printId: "52ea35ce-8aa1-4818-8ad5-7e462452f10e",
    definitionId: "77636b4c-faea-4bf5-b88c-dd5bb88dc930", // giantSpider (stub)
    setCode: "leb",
};

export const glassesOfUrzaLeb: CardPrint = {
    printId: "eb6953fd-ee48-49dc-9c9c-bfb9a9dc06d0",
    definitionId: "cafc2350-5d64-4379-9198-79a114654d45", // glassesOfUrza (stub)
    setCode: "leb",
};

export const gloomLeb: CardPrint = {
    printId: "640770d9-c0f8-40fd-9467-ebc099a27a4b",
    definitionId: "a8d10bc7-daeb-4c0d-9e4a-8eae8d11699f", // gloom (stub)
    setCode: "leb",
};

export const goblinBalloonBrigadeLeb: CardPrint = {
    printId: "3fdb52dd-4fc5-4594-b53b-ea169325be0b",
    definitionId: "5129b422-7a35-4bc5-b14b-c814012a0d8f", // goblinBalloonBrigade (stub)
    setCode: "leb",
};

export const goblinKingLeb: CardPrint = {
    printId: "65705a8d-6bb1-4289-b8b0-8546ccc478dc",
    definitionId: "5873672d-37ea-4c0f-97f3-12b74fde112d", // goblinKing (stub)
    setCode: "leb",
};

export const graniteGargoyleLeb: CardPrint = {
    printId: "affb57f4-273a-425c-a1b3-d0a5407f43d5",
    definitionId: "f15bf2b2-6848-4fbd-b89a-8d8da8ae1cdc", // graniteGargoyle (stub)
    setCode: "leb",
};

export const grayOgreLeb: CardPrint = {
    printId: "41023495-d3cb-4cb0-b95c-f717480a76a5",
    definitionId: "73ae5276-b607-4f23-a9d2-e8cc7b8e3693", // grayOgre
    setCode: "leb",
};

export const greenWardLeb: CardPrint = {
    printId: "a488ce63-1adb-4051-9521-703bad8d02f6",
    definitionId: "1f6118b2-fe01-425a-a2ed-6d7c42286c8e", // greenWard
    setCode: "leb",
};

export const grizzlyBearsLeb: CardPrint = {
    printId: "e7aa2b93-0a84-4318-bf2d-58164f0a846f",
    definitionId: "ce2d603a-3231-4a8c-bf39-1617586ea870", // grizzlyBears
    setCode: "leb",
};

export const guardianAngelLeb: CardPrint = {
    printId: "9c4e8259-b369-4b59-85fa-fe9edb1887c5",
    definitionId: "0f84d676-5327-454c-a033-b4498a9d28e2", // guardianAngel (stub)
    setCode: "leb",
};

export const healingSalveLeb: CardPrint = {
    printId: "9c9f2eeb-fea5-4b33-9723-8be3c1914f63",
    definitionId: "e28de37e-84d5-4dc7-b36c-e14da5924729", // healingSalve (stub)
    setCode: "leb",
};

export const helmOfChatzukLeb: CardPrint = {
    printId: "559d3329-9053-4301-b867-1b49c248fe31",
    definitionId: "3792c6ef-c4e6-4923-9a51-7d28fbc5c393", // helmOfChatzuk (stub)
    setCode: "leb",
};

export const hillGiantLeb: CardPrint = {
    printId: "4905e98f-0c5a-4ec7-b85b-dc2c3549d5d0",
    definitionId: "0ddb98e8-13fe-4786-83f7-b72c56db135a", // hillGiant
    setCode: "leb",
};

export const holyArmorLeb: CardPrint = {
    printId: "6ab1d885-989c-4d71-8139-9e35d2f16d03",
    definitionId: "b01041d2-687e-4972-81c8-16690809275b", // holyArmor (stub)
    setCode: "leb",
};

export const holyStrengthLeb: CardPrint = {
    printId: "de989395-50bf-458a-a010-e12abe2e15a6",
    definitionId: "e945a4cd-0eb1-4f54-898d-169ce2748a03", // holyStrength
    setCode: "leb",
};

export const howlFromBeyondLeb: CardPrint = {
    printId: "f6018459-d09b-489a-81be-933fd7d854c1",
    definitionId: "67ec17e1-174b-4d07-a27f-91a333c4b2fb", // howlFromBeyond (stub)
    setCode: "leb",
};

export const howlingMineLeb: CardPrint = {
    printId: "37634ffe-788f-4262-88e8-5ab7c7ca74d6",
    definitionId: "51f8f6e1-a451-4262-90d3-5107caf54175", // howlingMine
    setCode: "leb",
};

export const hurloonMinotaurLeb: CardPrint = {
    printId: "8ef29573-99a1-42fc-8941-2466cda2465f",
    definitionId: "78a9088f-8755-47cb-aa93-51d992ccab90", // hurloonMinotaur
    setCode: "leb",
};

export const hurricaneLeb: CardPrint = {
    printId: "b3939f72-1ec6-4b2c-b37e-b1ebb024bb8f",
    definitionId: "52f5a19f-16e4-4d35-89e1-969ac8202f88", // hurricane
    setCode: "leb",
};

export const hypnoticSpecterLeb: CardPrint = {
    printId: "edcc56a0-1dc0-4261-8f9c-5a88ce83f9e9",
    definitionId: "b43b900f-2d9b-442b-9699-058483604ec9", // hypnoticSpecter
    setCode: "leb",
};

export const iceStormLeb: CardPrint = {
    printId: "7c439c5a-b4a5-411b-9e68-fb8438ccdfb0",
    definitionId: "9914836e-2fa6-4390-94b2-431427848a54", // iceStorm (stub)
    setCode: "leb",
};

export const icyManipulatorLeb: CardPrint = {
    printId: "d27608e7-6539-4813-95b6-d8847cdc6a12",
    definitionId: "29dc1596-a2e7-4d60-9f99-89babaef8a06", // icyManipulator
    setCode: "leb",
};

export const illusionaryMaskLeb: CardPrint = {
    printId: "61ea96b1-4428-4951-88d4-f79338955981",
    definitionId: "62ef2f37-b8ad-47ad-89ca-d6abcb7ff21b", // illusionaryMask (stub)
    setCode: "leb",
};

export const instillEnergyLeb: CardPrint = {
    printId: "58334cf9-5186-4fba-963c-fffb21f2b8de",
    definitionId: "5bd38716-874c-4e3c-a315-837839a6258c", // instillEnergy (stub)
    setCode: "leb",
};

export const invisibilityLeb: CardPrint = {
    printId: "dde97b8f-7c10-48d3-8ae2-9f86158973ec",
    definitionId: "1858ac51-e6a7-48d7-8759-166070ca13d8", // invisibility (stub)
    setCode: "leb",
};

export const ironStarLeb: CardPrint = {
    printId: "b08fff47-c3c8-40a9-b3d3-296954aa4ed4",
    definitionId: "5786de12-cade-43c2-a6b0-0c5b294b9d0e", // ironStar (stub)
    setCode: "leb",
};

export const ironclawOrcsLeb: CardPrint = {
    printId: "a7be8a25-a744-426e-8e66-7fdff2789af4",
    definitionId: "d56421a8-34ae-4033-943f-c59a7bf2b6f9", // ironclawOrcs (stub)
    setCode: "leb",
};

export const ironrootTreefolkLeb: CardPrint = {
    printId: "1d9479ae-2b42-4137-9e62-ef4d7fd17d0c",
    definitionId: "b93c5869-7777-44bb-967a-e9439b25ced4", // ironrootTreefolk
    setCode: "leb",
};

export const islandLeb291: CardPrint = {
    printId: "bff33e91-8e52-43f2-b8ae-603b456b08fc",
    definitionId: "90a57c0e-fa61-45ef-955d-d296403967d5", // island
    setCode: "leb",
};

export const islandLeb292: CardPrint = {
    printId: "d0c5cf64-9844-4b5b-8e6b-b97c50cce053",
    definitionId: "90a57c0e-fa61-45ef-955d-d296403967d5", // island
    setCode: "leb",
};

export const islandLeb293: CardPrint = {
    printId: "c0a612c4-b4ac-4dd2-a06e-92516599fafd",
    definitionId: "90a57c0e-fa61-45ef-955d-d296403967d5", // island
    setCode: "leb",
};

export const islandSanctuaryLeb: CardPrint = {
    printId: "273fb2b6-3d11-4f0d-9fb0-0364353c2060",
    definitionId: "c15e8a42-89de-42bc-8d5f-33426d207c3a", // islandSanctuary (stub)
    setCode: "leb",
};

export const ivoryCupLeb: CardPrint = {
    printId: "32516ab8-43be-4207-a7d5-4916933ce155",
    definitionId: "9964d8d8-dc97-4e5f-9f52-173f7e2c37fd", // ivoryCup (stub)
    setCode: "leb",
};

export const jadeMonolithLeb: CardPrint = {
    printId: "eeea32ba-dfe4-4a9b-b403-43c2abc80b78",
    definitionId: "4a77e0f1-449d-4a7d-9fa0-ba7598f7a73a", // jadeMonolith (stub)
    setCode: "leb",
};

export const jadeStatueLeb: CardPrint = {
    printId: "985164ba-0c30-42b1-a8b6-3be19251359c",
    definitionId: "8d82d94b-ceef-4533-a4f2-b6442a61b839", // jadeStatue
    setCode: "leb",
};

export const jayemdaeTomeLeb: CardPrint = {
    printId: "e48b1c51-c0fd-4c08-8631-80f507b04d28",
    definitionId: "cac8c421-5b92-481d-b2de-560c0231ab58", // jayemdaeTome
    setCode: "leb",
};

export const juggernautLeb: CardPrint = {
    printId: "870eb49c-f62d-4986-b492-601feb68a307",
    definitionId: "dcd6a291-5282-4f49-8203-d9b416083c48", // juggernaut
    setCode: "leb",
};

export const jumpLeb: CardPrint = {
    printId: "e51e8a6e-1da8-4e6f-8433-9f0695926f04",
    definitionId: "cb3f4b11-ad1b-48e2-a500-787d351b0174", // jump
    setCode: "leb",
};

export const karmaLeb: CardPrint = {
    printId: "1bea2eb6-dfae-4bdc-9ab3-b2b491c69c59",
    definitionId: "6f30ad61-fcb7-4d55-ba86-94de1bf545e4", // karma
    setCode: "leb",
};

export const keldonWarlordLeb: CardPrint = {
    printId: "b07deb9b-5b88-4658-8ae8-041568992019",
    definitionId: "8fe3fd83-969c-4add-888f-86f4306b067c", // keldonWarlord (stub)
    setCode: "leb",
};

export const kormusBellLeb: CardPrint = {
    printId: "0cd2a4f9-8f80-4ee3-8068-73e686d6eeb9",
    definitionId: "3f4ef7a1-148d-44ac-89ed-0ef379cca0c6", // kormusBell (stub)
    setCode: "leb",
};

export const kudzuLeb: CardPrint = {
    printId: "ced83afa-9718-4b8a-961b-394f8595c480",
    definitionId: "b2b72dcd-9ea1-4729-baae-ecd262fdff67", // kudzu (stub)
    setCode: "leb",
};

export const lanceLeb: CardPrint = {
    printId: "a7aa3a93-3765-49f0-8ff2-b6843509c34a",
    definitionId: "ddb633f5-cc4d-4157-8217-def90cb15e24", // lance
    setCode: "leb",
};

export const leyDruidLeb: CardPrint = {
    printId: "b58867ec-0b1a-4804-bc2e-1c88d338c29e",
    definitionId: "f9232508-d363-4ef3-987a-741f6bff331f", // leyDruid (stub)
    setCode: "leb",
};

export const libraryOfLengLeb: CardPrint = {
    printId: "0254bff2-a3a7-434e-980a-2d30355793fc",
    definitionId: "2340edcb-8cd5-4ccd-99e2-b9a29f72c495", // libraryOfLeng (stub)
    setCode: "leb",
};

export const lichLeb: CardPrint = {
    printId: "e5a9c089-0aad-4c14-9bfc-c0b39c976777",
    definitionId: "4250caec-0e37-41be-9ec4-8938deb5f0d0", // lich (stub)
    setCode: "leb",
};

export const lifeforceLeb: CardPrint = {
    printId: "3715abe2-5a8e-4bf4-ac02-6c755d86bb4c",
    definitionId: "e292577e-6232-44fa-a9c2-cc09949c6ed3", // lifeforce (stub)
    setCode: "leb",
};

export const lifelaceLeb: CardPrint = {
    printId: "9379e159-43ac-4bd2-8b33-f3de8e20cfe0",
    definitionId: "38cb601b-a35c-412e-b386-e77dad3daa54", // lifelace (stub)
    setCode: "leb",
};

export const lifetapLeb: CardPrint = {
    printId: "74e7775b-b03b-4fc0-bcd9-3681cce5e70c",
    definitionId: "11add837-7ee4-4104-b031-c161bce459ae", // lifetap (stub)
    setCode: "leb",
};

export const lightningBoltLeb: CardPrint = {
    printId: "b5d3dcab-2260-479d-9ef6-dfb92d4f6061",
    definitionId: "d573ef03-4730-45aa-93dd-e45ac1dbaf4a", // lightningBolt
    setCode: "leb",
};

export const livingArtifactLeb: CardPrint = {
    printId: "8bbf6678-f597-407d-9a95-02bbe6c4bcf3",
    definitionId: "c9e753a2-a7d0-4d37-ae65-b5a1b5039a6e", // livingArtifact (stub)
    setCode: "leb",
};

export const livingLandsLeb: CardPrint = {
    printId: "f132acbd-53e5-430a-8f93-8b7469633c0e",
    definitionId: "80be0580-7948-4d8e-8c0f-5e2797ac411b", // livingLands (stub)
    setCode: "leb",
};

export const livingWallLeb: CardPrint = {
    printId: "0c2cd1c8-8734-4534-ae92-def4d94ef5bc",
    definitionId: "4a98ada6-923a-44a5-bdef-ea6a160b481e", // livingWall (stub)
    setCode: "leb",
};

export const llanowarElvesLeb: CardPrint = {
    printId: "abd80204-e9ba-483f-9b75-a69712545ba9",
    definitionId: "d4f1cc9e-4f99-4c26-ac1b-8ef069fa8ceb", // llanowarElves
    setCode: "leb",
};

export const lordOfAtlantisLeb: CardPrint = {
    printId: "27d7ac1f-2243-4c70-95a4-2b7343c8d92d",
    definitionId: "210c4a90-fc7a-4c76-aeaa-20a005e45386", // lordOfAtlantis (stub)
    setCode: "leb",
};

export const lordOfThePitLeb: CardPrint = {
    printId: "24626988-81df-44c9-9a8e-ecb9f82c383b",
    definitionId: "2926777a-4f6e-4965-ba83-22cf7df02602", // lordOfThePit (stub)
    setCode: "leb",
};

export const lureLeb: CardPrint = {
    printId: "e31495ab-e6ed-40a6-b82d-aa6092b049e2",
    definitionId: "2a87b26e-0431-42e9-b44f-94ba8546111a", // lure (stub)
    setCode: "leb",
};

export const magicalHackLeb: CardPrint = {
    printId: "0aa81390-4e0b-484b-a5be-a9449cd41860",
    definitionId: "2bd4202c-0477-45aa-82fd-83c85d6d4bef", // magicalHack (stub)
    setCode: "leb",
};

export const mahamotiDjinnLeb: CardPrint = {
    printId: "083f76c8-3e6d-4de5-b408-2f2394faed5c",
    definitionId: "36204ddd-ddf7-4b44-ae3c-b4a5a41ac9cb", // mahamotiDjinn
    setCode: "leb",
};

export const manaFlareLeb: CardPrint = {
    printId: "b44d3087-ced3-40e8-a63b-1733b7e7f34c",
    definitionId: "7fb99a26-beeb-4aca-bb02-b2d2ce0595f9", // manaFlare (stub)
    setCode: "leb",
};

export const manaShortLeb: CardPrint = {
    printId: "4da4f9a8-024b-4707-b300-ccb11bd87cea",
    definitionId: "a0486cfc-b33f-4e20-a28e-c2a7e92e3a17",
    setCode: "leb",
};

export const manaVaultLeb: CardPrint = {
    printId: "a11f55e8-7f86-4ca9-b737-9a920d9cf282",
    definitionId: "19499cb7-eccb-4e69-af32-6002d447a160", // manaVault (stub)
    setCode: "leb",
};

export const manabarbsLeb: CardPrint = {
    printId: "7c01cae0-4d61-4bf7-a145-82d9bb11d816",
    definitionId: "6121f72f-680f-4bb4-ae4d-37ee4ebed4d8", // manabarbs (stub)
    setCode: "leb",
};

export const meekstoneLeb: CardPrint = {
    printId: "74b22007-9def-4c0f-921c-555483cc3deb",
    definitionId: "13a68a17-22ee-47c9-870a-83e911862b94", // meekstone (stub)
    setCode: "leb",
};

export const merfolkOfThePearlTridentLeb: CardPrint = {
    printId: "cca142de-906d-4143-8f77-4acea1f1e6b1",
    definitionId: "2b871039-6a66-4ac3-95e7-24759c1f2f92", // merfolkOfThePearlTrident
    setCode: "leb",
};

export const mesaPegasusLeb: CardPrint = {
    printId: "55bff46a-6725-4918-9bdf-38efaaf50236",
    definitionId: "eaac88da-d19e-4771-944c-3709963d04e7", // mesaPegasus (stub)
    setCode: "leb",
};

export const mindTwistLeb: CardPrint = {
    printId: "0cb6cbbe-c3e9-4d14-a6b8-fb74e6a02b33",
    definitionId: "eee9e106-a248-49d2-b8c8-6bbcd56ce739", // mindTwist (stub)
    setCode: "leb",
};

export const monssGoblinRaidersLeb: CardPrint = {
    printId: "2fbf039d-0ab9-4c42-a0a3-cbfa3ea1dd6e",
    definitionId: "b4eb3db3-6a7c-488a-9433-d5d1d3133816", // monssGoblinRaiders
    setCode: "leb",
};

export const mountainLeb297: CardPrint = {
    printId: "7af9c715-8d72-4eae-b412-fc89138ff588",
    definitionId: "eace2c85-976c-425e-9800-5a6ccbd91b56", // mountain
    setCode: "leb",
};

export const mountainLeb298: CardPrint = {
    printId: "7cb88a03-7092-4d31-a9f1-4f16e39bc537",
    definitionId: "eace2c85-976c-425e-9800-5a6ccbd91b56", // mountain
    setCode: "leb",
};

export const mountainLeb299: CardPrint = {
    printId: "af9ad645-e605-4048-bf4c-d636584f315b",
    definitionId: "eace2c85-976c-425e-9800-5a6ccbd91b56", // mountain
    setCode: "leb",
};

export const moxEmeraldLeb: CardPrint = {
    printId: "ea5d9476-76be-48e7-b6a0-49ced25cb092",
    definitionId: "b0e1427c-05cd-465b-be59-97ed6e39f7ba", // moxEmerald
    setCode: "leb",
};

export const moxJetLeb: CardPrint = {
    printId: "133204e4-fef8-4851-aa50-c96ffa35b802",
    definitionId: "92bcd1ce-19b1-4d78-8b09-95242ca08d76", // moxJet
    setCode: "leb",
};

export const moxPearlLeb: CardPrint = {
    printId: "4da892c5-071f-416f-9e42-c4bff102eb88",
    definitionId: "8ebe4be7-e12a-4596-a899-fbd5b152e879", // moxPearl
    setCode: "leb",
};

export const moxRubyLeb: CardPrint = {
    printId: "fdac742b-16db-4e03-be8f-c600dbd522d5",
    definitionId: "8945585f-4773-493d-a0fe-d707db910b38", // moxRuby
    setCode: "leb",
};

export const moxSapphireLeb: CardPrint = {
    printId: "1eb3178b-dac5-4b34-9d3e-4f5a170d1c87",
    definitionId: "82da0972-b17b-4600-9efd-e9430a0db04b", // moxSapphire
    setCode: "leb",
};

export const naturalSelectionLeb: CardPrint = {
    printId: "a594299e-fc3a-4d46-bd58-1a9cf7ddbdd7",
    definitionId: "a8917dc8-01c0-4e72-9310-c4d501775411", // naturalSelection (stub)
    setCode: "leb",
};

export const netherShadowLeb: CardPrint = {
    printId: "38396ae3-a48f-44c7-96bf-ea41b5aaeebc",
    definitionId: "f13ad58a-6f9b-420a-bac1-40929f5e616a", // netherShadow (stub)
    setCode: "leb",
};

export const nettlingImpLeb: CardPrint = {
    printId: "576220c3-1e6b-43f3-a47e-5e8246ee7d46",
    definitionId: "8105973c-a94d-444c-ba20-ab0fa978bee8",
    setCode: "leb",
};

export const nevinyrralsDiskLeb: CardPrint = {
    printId: "dbb21f21-668a-4d57-8d05-8db11fb82d99",
    definitionId: "12926dc8-8e6f-4a47-a12b-4d674189615a", // nevinyrralsDisk
    setCode: "leb",
};

export const nightmareLeb: CardPrint = {
    printId: "fc78dced-27d2-441a-b63b-32356bc33747",
    definitionId: "b8cdd6a7-f772-4ccb-914f-63f52ed54d6b", // nightmare
    setCode: "leb",
};

export const northernPaladinLeb: CardPrint = {
    printId: "4ba8493c-ae69-48d1-a050-a887ae27c83f",
    definitionId: "6303233b-35eb-49ca-b844-ba6b9fe1cbd2", // northernPaladin (stub)
    setCode: "leb",
};

export const obsianusGolemLeb: CardPrint = {
    printId: "e9ed6669-e340-46d5-906b-e24e76464e75",
    definitionId: "4c8e9f5c-deba-4443-bf9d-fb2be75c5418", // obsianusGolem
    setCode: "leb",
};

export const orcishArtilleryLeb: CardPrint = {
    printId: "4d2354ee-2ce0-4adb-b48c-0e30b952e545",
    definitionId: "a97208b1-a91b-4129-8a00-2f97b418accc", // orcishArtillery (stub)
    setCode: "leb",
};

export const orcishOriflammeLeb: CardPrint = {
    printId: "f2752cf2-9a48-49a8-98ff-2e32a9121d78",
    definitionId: "911538ea-322c-4c40-a9c3-35e47fe60fce",
    setCode: "leb",
};

export const paralyzeLeb: CardPrint = {
    printId: "106d8401-f0e2-461e-b8ea-16d475db98da",
    definitionId: "be33a155-de26-43d1-88f1-c926f1b7cb7c", // paralyze (stub)
    setCode: "leb",
};

export const pearledUnicornLeb: CardPrint = {
    printId: "47024d6d-dc55-4c35-b2bb-1b8bb0ee4e38",
    definitionId: "6daf1aab-1e58-4a5a-bc66-cb3f7c86e0e8", // pearledUnicorn
    setCode: "leb",
};

export const personalIncarnationLeb: CardPrint = {
    printId: "f7bb9f31-0818-4422-8533-99a4e6845a02",
    definitionId: "caf9cef4-0f2d-478a-b119-fe1967687f74", // personalIncarnation (stub)
    setCode: "leb",
};

export const pestilenceLeb: CardPrint = {
    printId: "1313b7e6-4acb-435a-bde5-1def5e5350ac",
    definitionId: "d42a6350-b16b-4e10-a273-e6cbb55dcb7a", // pestilence (stub)
    setCode: "leb",
};

export const phantasmalForcesLeb: CardPrint = {
    printId: "b0c6d792-0abb-474e-8c05-c4e843242ef0",
    definitionId: "0631c7c8-9aa5-4333-8e20-20247fc47033", // phantasmalForces (stub)
    setCode: "leb",
};

export const phantasmalTerrainLeb: CardPrint = {
    printId: "9c29369c-d909-45a7-be70-3181ddac9728",
    definitionId: "1c371aa1-1619-41e3-8364-7bc9b8cf5d14", // phantasmalTerrain (stub)
    setCode: "leb",
};

export const phantomMonsterLeb: CardPrint = {
    printId: "b0782e90-383b-4aed-8fa0-99c8cf8b2cec",
    definitionId: "e46d2cf5-e8d0-4fb2-b950-252d52084b63", // phantomMonster
    setCode: "leb",
};

export const pirateShipLeb: CardPrint = {
    printId: "925ce0a7-ae09-4220-9e67-314dbc231c94",
    definitionId: "d0a7cb23-d229-43c5-addd-dcf423984b0c", // pirateShip
    setCode: "leb",
};

export const plagueRatsLeb: CardPrint = {
    printId: "995b58e6-5c69-4fdf-9c41-61cef7a610c4",
    definitionId: "b3724e40-0622-4aee-9334-6c9fff88bcd5", // plagueRats (stub)
    setCode: "leb",
};

export const plainsLeb288: CardPrint = {
    printId: "b7331b03-be66-419c-94bc-ed494c042ea3",
    definitionId: "b1623d57-4729-4796-b3f7-f1837a05c6ed", // plains
    setCode: "leb",
};

export const plainsLeb289: CardPrint = {
    printId: "52ff493a-6336-416e-af5e-1eb6d10c080e",
    definitionId: "b1623d57-4729-4796-b3f7-f1837a05c6ed", // plains
    setCode: "leb",
};

export const plainsLeb290: CardPrint = {
    printId: "38e2b0ff-8fdf-4db0-85c0-c1010bacd36b",
    definitionId: "b1623d57-4729-4796-b3f7-f1837a05c6ed", // plains
    setCode: "leb",
};

export const plateauLeb: CardPrint = {
    printId: "fad0bbc4-f760-47a2-aab6-0dbb66ee3a95",
    definitionId: "6eafa00b-c628-40f6-86eb-88e1361fc7a0", // plateau
    setCode: "leb",
};

export const powerLeakLeb: CardPrint = {
    printId: "86fdfb7b-1bcf-485a-be70-0130fc1fceef",
    definitionId: "ccc982b6-35b2-4e33-ace2-86cb79123e4f", // powerLeak (stub)
    setCode: "leb",
};

export const powerSinkLeb: CardPrint = {
    printId: "954b04e3-861a-45c9-8897-9cb4a99f04c3",
    definitionId: "1b342dd3-09b9-4108-bf12-a65d4cef4eb9", // powerSink (stub)
    setCode: "leb",
};

export const powerSurgeLeb: CardPrint = {
    printId: "f52eb10a-a9eb-44b7-95ae-12fb551c8fa5",
    definitionId: "62858604-ca5a-4f69-a045-a7515ebfabf2", // powerSurge (stub)
    setCode: "leb",
};

export const prodigalSorcererLeb: CardPrint = {
    printId: "c420abf2-05ec-4623-8a6c-353736a4edeb",
    definitionId: "e4dc1103-7bf1-47f6-9006-d3ed9ccd7a6a", // prodigalSorcerer
    setCode: "leb",
};

export const psionicBlastLeb: CardPrint = {
    printId: "73b6b789-00c5-4d72-8fb3-6808bfbf0144",
    definitionId: "a6a86e6e-bfff-46af-9d36-c912901fea92", // psionicBlast
    setCode: "leb",
};

export const psychicVenomLeb: CardPrint = {
    printId: "e5c8a81f-bf05-4504-ac87-4fd4b41e88c1",
    definitionId: "f3f5b68a-6b0e-431e-89f0-ff60f17687a5", // psychicVenom (stub)
    setCode: "leb",
};

export const purelaceLeb: CardPrint = {
    printId: "af11986e-42bd-4f54-8624-7b34b1783a40",
    definitionId: "2facf462-55cd-4da4-997f-2cf4add75628", // purelace (stub)
    setCode: "leb",
};

export const ragingRiverLeb: CardPrint = {
    printId: "c14746bb-aa00-4be2-9740-d87f976296d2",
    definitionId: "61e4f56d-1f4f-49f2-8534-0d09196a3327", // ragingRiver (stub)
    setCode: "leb",
};

export const raiseDeadLeb: CardPrint = {
    printId: "0066c7a6-7775-43ba-81cd-35fbc5621bc3",
    definitionId: "ce07bede-2219-427c-a61a-56518751de42", // raiseDead (stub)
    setCode: "leb",
};

export const redElementalBlastLeb: CardPrint = {
    printId: "4fafd3f9-f7de-4d6e-8824-6b60866fc50f",
    definitionId: "776ad9be-3309-4f1d-9f27-6219d9477662", // redElementalBlast (stub)
    setCode: "leb",
};

export const redWardLeb: CardPrint = {
    printId: "057237bb-e1e6-4bcc-8639-ca0dcdd4846c",
    definitionId: "e0c64c01-c2aa-470b-88c6-3d3e4a969649", // redWard
    setCode: "leb",
};

export const regenerationLeb: CardPrint = {
    printId: "42ad2d7f-34a5-4b17-ae11-16b322601d73",
    definitionId: "b7b7aa34-b4f8-41b4-82ce-ab2e204c3bf4", // regeneration
    setCode: "leb",
};

export const regrowthLeb: CardPrint = {
    printId: "898cd314-9060-4f1c-a821-1d61a292a12b",
    definitionId: "badc73ec-3728-4246-90c7-5f4eb7051ed5", // regrowth
    setCode: "leb",
};

export const resurrectionLeb: CardPrint = {
    printId: "50e3c741-5095-48a6-bd93-b9c4db265004",
    definitionId: "4fff6e6f-4ebd-4ec8-9443-59efb22d376c", // resurrection (stub)
    setCode: "leb",
};

export const reverseDamageLeb: CardPrint = {
    printId: "46cf22e4-cc5c-4723-a9cb-ae7ce7a55a1a",
    definitionId: "943baea8-b173-4863-a3ab-dd217d483cd9", // reverseDamage (stub)
    setCode: "leb",
};

export const righteousnessLeb: CardPrint = {
    printId: "b847a2d1-5912-4f88-a68f-06790d0795dc",
    definitionId: "d0ba7b76-f3d0-47d0-8a35-0c08e67200fb",
    setCode: "leb",
};

export const rocOfKherRidgesLeb: CardPrint = {
    printId: "f1b9e3ae-c7e9-455f-abfe-220262719beb",
    definitionId: "731a4b86-c213-4d8e-bf01-0a0e8cff0ff1", // rocOfKherRidges
    setCode: "leb",
};

export const rockHydraLeb: CardPrint = {
    printId: "c17a982d-466d-4fec-b85a-a44161e5dad5",
    definitionId: "410ac9e6-fbc1-4cc8-84db-84e2eb1bab97", // rockHydra (stub)
    setCode: "leb",
};

export const rodOfRuinLeb: CardPrint = {
    printId: "45810c0a-0a35-4bd4-ba66-5a45f8973fa4",
    definitionId: "af957200-c538-4f52-b105-6db7a7abb4dc", // rodOfRuin (stub)
    setCode: "leb",
};

export const royalAssassinLeb: CardPrint = {
    printId: "b6e33c5e-6d99-4e7e-b611-4b271a47b4d2",
    definitionId: "59590768-fa96-4869-8763-9d5ab6ac22ad", // royalAssassin
    setCode: "leb",
};

export const sacrificeLeb: CardPrint = {
    printId: "8abe7d62-6a99-4d1f-9b81-cff0485997a8",
    definitionId: "12164aee-6a27-4246-8d15-2d6dd20d92e9", // sacrifice (stub)
    setCode: "leb",
};

export const samiteHealerLeb: CardPrint = {
    printId: "3fbfb106-29d8-4065-b306-51dba0ed11a4",
    definitionId: "efba235e-04e5-449c-906c-0ac33f6d7929", // samiteHealer (stub)
    setCode: "leb",
};

export const savannahLeb: CardPrint = {
    printId: "0e9aeaa8-9a75-4719-992f-cbb316f72175",
    definitionId: "94f7e24c-2546-41b6-81ad-5e920b07e64e", // savannah
    setCode: "leb",
};

export const savannahLionsLeb: CardPrint = {
    printId: "67d1945d-d228-4dc3-a593-859408b2016b",
    definitionId: "d05b92bd-797e-413f-a8b0-32e0937a1ee0", // savannahLions
    setCode: "leb",
};

export const scatheZombiesLeb: CardPrint = {
    printId: "a30abb09-2f80-46cf-a839-b4dac5c23dce",
    definitionId: "e9be6dcf-5e25-4b8c-9cd0-badf3771f81e", // scatheZombies
    setCode: "leb",
};

export const scavengingGhoulLeb: CardPrint = {
    printId: "e2bfa6bb-cf7b-4a79-83f5-178a633c499e",
    definitionId: "426984e0-88e1-4a2d-9a1c-798b95864df3", // scavengingGhoul (stub)
    setCode: "leb",
};

export const scrublandLeb: CardPrint = {
    printId: "8cf99186-3167-4092-8efb-e7448609ceba",
    definitionId: "bebe39d4-21fb-46a4-a1ec-b97102e46c15", // scrubland
    setCode: "leb",
};

export const scrybSpritesLeb: CardPrint = {
    printId: "fafe9639-e9d0-4aa2-8a16-f4ec24c140c0",
    definitionId: "6d929c38-91e6-457c-937a-d1884f4bba44", // scrybSprites
    setCode: "leb",
};

export const seaSerpentLeb: CardPrint = {
    printId: "11b21f91-51fd-407d-bab2-63c11f23b680",
    definitionId: "d0b333b7-db4d-4439-b0de-60414cbf8d7b", // seaSerpent
    setCode: "leb",
};

export const sedgeTrollLeb: CardPrint = {
    printId: "02ec317b-52a6-4490-80e5-a56826b06771",
    definitionId: "b13bf496-f3c0-4c13-8282-e7abfab6a198", // sedgeTroll (stub)
    setCode: "leb",
};

export const sengirVampireLeb: CardPrint = {
    printId: "5fbd5fbb-f689-4ff0-8f23-17e4cb0925a2",
    definitionId: "510840f4-7c0e-4b47-8ebf-23c20cac4bd9", // sengirVampire
    setCode: "leb",
};

export const serraAngelLeb: CardPrint = {
    printId: "5669f9c8-2e94-47e2-a551-7efff317fb34",
    definitionId: "f8ac5006-91bd-4803-93da-f87cf196dd2f", // serraAngel
    setCode: "leb",
};

export const shanodinDryadsLeb: CardPrint = {
    printId: "1ac8bdb0-2dfd-4531-a4d9-420f2f2a90be",
    definitionId: "814cf35c-f1ad-4bf4-8c10-a5592c3b1be8", // shanodinDryads
    setCode: "leb",
};

export const shatterLeb: CardPrint = {
    printId: "76ddf3f4-1305-4599-bf4c-f9e148bdda4d",
    definitionId: "50dc7fc1-cb6a-4c68-b993-1a25cf16226e", // shatter (stub)
    setCode: "leb",
};

export const shivanDragonLeb: CardPrint = {
    printId: "5e64822a-6817-4e1e-8155-3e95f8e3763f",
    definitionId: "fefbf149-f988-4f8b-9f53-56f5878116a6", // shivanDragon (stub)
    setCode: "leb",
};

export const simulacrumLeb: CardPrint = {
    printId: "5bcda143-55f8-4d02-918f-975d9090d03f",
    definitionId: "35c3a78d-cc79-4187-929a-8aa1d1469990", // simulacrum (stub)
    setCode: "leb",
};

export const sinkholeLeb: CardPrint = {
    printId: "52ea4387-f23c-430c-99d6-0248a4ab1713",
    definitionId: "04b31611-9053-4eaf-b392-21bb644fef5f", // sinkhole
    setCode: "leb",
};

export const sirensCallLeb: CardPrint = {
    printId: "00ce03f3-ddc0-4cf3-8f07-551c960e8639",
    definitionId: "d992b336-3b6e-43e1-8662-d85664349b44", // sirensCall (stub)
    setCode: "leb",
};

export const sleightOfMindLeb: CardPrint = {
    printId: "fb4da609-6c08-4a18-b7d9-fb2f9b11bab2",
    definitionId: "d427790c-e322-446e-8d7d-a6b48ad41a42", // sleightOfMind
    setCode: "leb",
};

export const smokeLeb: CardPrint = {
    printId: "7eb0cb82-d930-43c3-a6d6-f947018d45d6",
    definitionId: "7c67788e-d713-47c3-ab9f-b8a6212ae24f", // smoke (stub)
    setCode: "leb",
};

export const solRingLeb: CardPrint = {
    printId: "c0fb91ec-20a8-4c13-9469-18885b1ecca3",
    definitionId: "c4300d24-1cae-4dd5-be7e-38cc677cf5bd", // solRing
    setCode: "leb",
};

export const soulNetLeb: CardPrint = {
    printId: "08ba41ec-4fff-4192-80ff-2afcd706ea59",
    definitionId: "2b814198-814b-4619-a158-327af675f8f2", // soulNet (stub)
    setCode: "leb",
};

export const spellBlastLeb: CardPrint = {
    printId: "3f599b73-1d55-4acc-8931-f5ab39d1d4e9",
    definitionId: "845734da-ab03-4dbc-bb5f-96481d3b8e88", // spellBlast (stub)
    setCode: "leb",
};

export const stasisLeb: CardPrint = {
    printId: "73c76f5d-d866-4eb7-b2d2-fc6ecf982f8e",
    definitionId: "b6cef408-5b4b-49f6-9531-be544815b93f", // stasis (stub)
    setCode: "leb",
};

export const stealArtifactLeb: CardPrint = {
    printId: "92c14d4d-abaa-411a-aaa1-0b79fccee8c1",
    definitionId: "83316930-d6ad-46ce-9b40-48eea856d95b", // stealArtifact
    setCode: "leb",
};

export const stoneGiantLeb: CardPrint = {
    printId: "a2b5f545-a87d-4292-880f-5cd2f6755748",
    definitionId: "7ffaedb9-25f8-4304-9085-e12505b93312",
    setCode: "leb",
};

export const stoneRainLeb: CardPrint = {
    printId: "901831ad-1840-4287-b6a0-bea310598dc2",
    definitionId: "57ff74cb-a2ed-4123-ac42-f72f9820049e", // stoneRain (stub)
    setCode: "leb",
};

export const streamOfLifeLeb: CardPrint = {
    printId: "da18a2c9-850e-400d-b0b3-edd8a946e380",
    definitionId: "aa1c4d4b-2645-4cd9-823e-3c9bb2eb48f9", // streamOfLife (stub)
    setCode: "leb",
};

export const sunglassesOfUrzaLeb: CardPrint = {
    printId: "49fcf47d-0f1d-469e-a8c4-d5c97be7a1ef",
    definitionId: "c0d433a4-76c0-4f27-836d-4c0c13a511fb", // sunglassesOfUrza (stub)
    setCode: "leb",
};

export const swampLeb294: CardPrint = {
    printId: "d1309a80-a761-4b80-8cf1-1a8b83190511",
    definitionId: "6176936d-72e2-4205-8871-4c5a4f1cb2d8", // swamp
    setCode: "leb",
};

export const swampLeb295: CardPrint = {
    printId: "25ad2444-9985-423c-ad36-387218866409",
    definitionId: "6176936d-72e2-4205-8871-4c5a4f1cb2d8", // swamp
    setCode: "leb",
};

export const swampLeb296: CardPrint = {
    printId: "a3544148-49b2-4320-8e3a-5bab81e0f7fd",
    definitionId: "6176936d-72e2-4205-8871-4c5a4f1cb2d8", // swamp
    setCode: "leb",
};

export const swordsToPlowsharesLeb: CardPrint = {
    printId: "255099be-c64e-4f6a-8463-4fc058d6908d",
    definitionId: "386ea9eb-abc1-4862-aa2d-8fb808d79490", // swordsToPlowshares
    setCode: "leb",
};

export const taigaLeb: CardPrint = {
    printId: "30ce1bf0-7561-418f-a217-3ce10f28be82",
    definitionId: "60df6592-0b3b-4b87-aeb2-8fa94b4fb7be", // taiga
    setCode: "leb",
};

export const terrorLeb: CardPrint = {
    printId: "58d8598b-35e5-414f-aee0-52137236f642",
    definitionId: "21004958-2c7e-4a55-bc80-411c4d780106", // terror (stub)
    setCode: "leb",
};

export const theHiveLeb: CardPrint = {
    printId: "84b83106-a10d-469a-99eb-56110ef34ba1",
    definitionId: "544a7138-eae8-4ff9-9e17-680bfa717183", // theHive (stub)
    setCode: "leb",
};

export const thicketBasiliskLeb: CardPrint = {
    printId: "6321e16b-0b4b-4d36-ab94-97bf5816acf4",
    definitionId: "e92cce01-b3bd-4307-aae5-9a7c8fa386ab", // thicketBasilisk (stub)
    setCode: "leb",
};

export const thoughtlaceLeb: CardPrint = {
    printId: "fc2b2b9e-5abf-4c41-a85c-ef95e6ab84d6",
    definitionId: "23749375-1416-47a4-9251-52f41fe2fae9", // thoughtlace (stub)
    setCode: "leb",
};

export const throneOfBoneLeb: CardPrint = {
    printId: "655b6265-3030-4c68-af5b-b9e636b1a778",
    definitionId: "a2931ae0-7836-4000-b9ec-f2029ebf5d96", // throneOfBone (stub)
    setCode: "leb",
};

export const timberWolvesLeb: CardPrint = {
    printId: "aa598db8-c0c7-4a9a-bd89-6d3da0d3dfba",
    definitionId: "bc2570a4-eef9-430d-b6c2-cd51d29b9d01", // timberWolves (stub)
    setCode: "leb",
};

export const timeVaultLeb: CardPrint = {
    printId: "1164f22f-2706-4f35-9f58-d0eb8c344396",
    definitionId: "c01a4081-dbb0-4a40-a27b-26e9a1b48803",
    setCode: "leb",
};

export const timeWalkLeb: CardPrint = {
    printId: "54992fda-45a9-4ed1-b380-34d167feec90",
    definitionId: "e0139f60-d48e-46fb-9f5a-1e3d7558c834", // timeWalk
    setCode: "leb",
};

export const timetwisterLeb: CardPrint = {
    printId: "09f1958a-50cc-43cc-80e1-988800e44ca8",
    definitionId: "9a49dc44-616e-4bdd-8220-0bb71eccc512", // timetwister
    setCode: "leb",
};

export const tranquilityLeb: CardPrint = {
    printId: "ee21b620-4dfa-4e06-872e-8d8ffce12f76",
    definitionId: "774cc5a6-3a69-4812-add4-eb5eb6389238", // tranquility
    setCode: "leb",
};

export const tropicalIslandLeb: CardPrint = {
    printId: "ac19c5a1-ca13-4443-920b-83b567167ed4",
    definitionId: "a9c6c759-aabf-44e7-ba8c-33c5df232b56", // tropicalIsland
    setCode: "leb",
};

export const tsunamiLeb: CardPrint = {
    printId: "1f4b6f5a-1ba2-409d-9b9b-91e2c1470f62",
    definitionId: "9ed67d61-cf47-446b-b454-eb404a8686b7", // tsunami
    setCode: "leb",
};

export const tundraLeb: CardPrint = {
    printId: "1b93ce48-219c-49ea-9ad0-b7357bea4606",
    definitionId: "a03e8c5b-f4ed-4fd7-ba05-db813ccc05eb", // tundra
    setCode: "leb",
};

export const tunnelLeb: CardPrint = {
    printId: "cc738025-a771-4186-b08c-7b37c0e9713b",
    definitionId: "b21ebc9f-a93e-4d18-b3e8-8459e3abbf31", // tunnel (stub)
    setCode: "leb",
};

export const twiddleLeb: CardPrint = {
    printId: "34bd24da-f156-494e-86cb-80707863e40b",
    definitionId: "576e811f-26a3-4a7c-bd13-3b1cc3e184eb", // twiddle
    setCode: "leb",
};

export const twoHeadedGiantOfForiysLeb: CardPrint = {
    printId: "30fcbb16-f8e7-4f6e-a806-541ef54aa025",
    definitionId: "31c687dc-ee0c-4e54-a2b3-5d8e633b3245", // twoHeadedGiantOfForiys (stub)
    setCode: "leb",
};

export const undergroundSeaLeb: CardPrint = {
    printId: "5e91ce41-053e-4203-8860-49cbf854cc18",
    definitionId: "ff76ac86-8a8a-47fe-9388-8950ca3e26c3", // undergroundSea
    setCode: "leb",
};

export const unholyStrengthLeb: CardPrint = {
    printId: "1c1c781d-1f27-40e3-9d79-0ebb6677e835",
    definitionId: "90563f90-0127-4164-b43b-f0321dc63a1d", // unholyStrength (stub)
    setCode: "leb",
};

export const unsummonLeb: CardPrint = {
    printId: "686843c8-8c8a-4af6-bca8-e7f7583cc886",
    definitionId: "8512f2c1-6361-4b79-843f-80b6bceeeb99", // unsummon
    setCode: "leb",
};

export const uthdenTrollLeb: CardPrint = {
    printId: "91f46e9a-6075-4fa5-8f60-f81e2024b13d",
    definitionId: "2ff21a6f-83a7-4bf3-a078-294e303232cc", // uthdenTroll (stub)
    setCode: "leb",
};

export const verduranEnchantressLeb: CardPrint = {
    printId: "da3f051c-6be3-4f92-8f66-9f72d75dbcf5",
    definitionId: "9f87178b-1221-4d7a-a7a5-20d7f01b8089", // verduranEnchantress (stub)
    setCode: "leb",
};

export const vesuvanDoppelgangerLeb: CardPrint = {
    printId: "d18e952b-ab4d-4f90-bf5e-4db490e4e203",
    definitionId: "768f3a05-bd06-4a23-b9f2-94f6e618fd9f", // vesuvanDoppelganger (stub)
    setCode: "leb",
};

export const veteranBodyguardLeb: CardPrint = {
    printId: "d8d888b7-26e2-465d-b5ee-bb2f2af5c621",
    definitionId: "cbd9ab01-a833-4fa4-8dee-151bd9800835", // veteranBodyguard (stub)
    setCode: "leb",
};

export const volcanicEruptionLeb: CardPrint = {
    printId: "ca669988-e009-4b3e-af20-ee5885554d34",
    definitionId: "a80582b1-09db-45f8-b362-0e5207a5a8e6", // volcanicEruption
    setCode: "leb",
};

// Volcanic Island — Beta-original (no Alpha printing). The tenth ABUR dual;
// taps for {U} or {R} (CR 305.6). Same factory as the LEA duals. Single
// printing, so the def id is its own LEB Scryfall id.
export const volcanicIsland: CardDefinition = makeDualLand({
    id: "0324641d-af55-4c53-b4dc-c8262e967da5",
    name: "Volcanic Island",
    oracleText: "({T}: Add {U} or {R}.)",
    colors: ["U", "R"],
});

export const wallOfAirLeb: CardPrint = {
    printId: "71904b59-55dd-4074-9d50-c5bb0fb7266f",
    definitionId: "da56fdf3-6a8f-4833-a5c3-197650cc4889", // wallOfAir
    setCode: "leb",
};

export const wallOfBoneLeb: CardPrint = {
    printId: "7930666c-12ac-420b-8ced-0e924925b075",
    definitionId: "ae20d442-a544-4a03-9ebf-5ecb137c67dd", // wallOfBone (stub)
    setCode: "leb",
};

export const wallOfBramblesLeb: CardPrint = {
    printId: "c2fca52b-80b3-4b6b-9a49-110c66557894",
    definitionId: "af2a4558-db6e-41b2-aff6-b164d93282a0", // wallOfBrambles (stub)
    setCode: "leb",
};

export const wallOfFireLeb: CardPrint = {
    printId: "88baaea5-69ec-4756-86c2-9c9d73ca8ef1",
    definitionId: "efcf12cd-fb70-444e-9641-73ffa0e8f16e", // wallOfFire (stub)
    setCode: "leb",
};

export const wallOfIceLeb: CardPrint = {
    printId: "cc05a648-7719-4ed3-aa3b-648463ee2869",
    definitionId: "cc743a03-867c-4bb0-8fb0-2bcaa0a8a756", // wallOfIce
    setCode: "leb",
};

export const wallOfStoneLeb: CardPrint = {
    printId: "329ba196-a107-41ac-b02a-5f8b10ecd130",
    definitionId: "140e567c-6e4a-42b0-8084-d6c9695ae802", // wallOfStone
    setCode: "leb",
};

export const wallOfSwordsLeb: CardPrint = {
    printId: "be955e9a-e722-4cd7-8e3d-bab1889c255b",
    definitionId: "99ec4723-b36c-4015-b361-736a6523e8f5", // wallOfSwords
    setCode: "leb",
};

export const wallOfWaterLeb: CardPrint = {
    printId: "34887689-0adb-4ead-87a5-1d8fd77b6278",
    definitionId: "41faed1a-ded8-49ee-8e2a-c60d377775d7", // wallOfWater (stub)
    setCode: "leb",
};

export const wallOfWoodLeb: CardPrint = {
    printId: "1a5054a4-599d-49df-9a80-77eeed47891f",
    definitionId: "8df80424-3bd9-4982-ad79-e55d9ba3b43d", // wallOfWood
    setCode: "leb",
};

export const wanderlustLeb: CardPrint = {
    printId: "393f08a2-7aa8-443f-aab5-4287240e9167",
    definitionId: "220a03ca-8c9b-4acb-821d-f6577fbb20fb", // wanderlust (stub)
    setCode: "leb",
};

export const warMammothLeb: CardPrint = {
    printId: "9f67175d-ac5c-4947-b243-d5206b552bdc",
    definitionId: "c8d6081e-f686-4263-a0a2-21c0d9af5fdb", // warMammoth
    setCode: "leb",
};

export const warpArtifactLeb: CardPrint = {
    printId: "4a289787-2d30-4e0b-ac97-3767818d0387",
    definitionId: "9e5e07a2-fbdf-4c4c-996a-fce40bab5de5", // warpArtifact (stub)
    setCode: "leb",
};

export const waterElementalLeb: CardPrint = {
    printId: "66f729e2-565b-4cdb-8b6f-0a14babe5680",
    definitionId: "8de940d6-98c0-46a9-b5fd-e2b0899ea19e", // waterElemental
    setCode: "leb",
};

export const weaknessLeb: CardPrint = {
    printId: "16137fa6-1b5c-49e7-ad79-dda4b7019a59",
    definitionId: "36ca06a1-9b9a-49a2-9c47-9b72228621bc", // weakness (stub)
    setCode: "leb",
};

export const webLeb: CardPrint = {
    printId: "f7f84dc2-5a29-447d-97ab-a10afd9ee538",
    definitionId: "37c7890a-86dc-4a97-a7ce-1436fa22d0c0", // web (stub)
    setCode: "leb",
};

export const wheelOfFortuneLeb: CardPrint = {
    printId: "9052369f-840f-438e-b86d-e2f8d6339585",
    definitionId: "67b369c4-faa8-45c8-a1b9-98f228b69682", // wheelOfFortune
    setCode: "leb",
};

export const whiteKnightLeb: CardPrint = {
    printId: "a231e0b8-b3e3-4f4a-8baa-c56626b01685",
    definitionId: "50abfba8-c9f9-4ebf-965a-4b425fe83129", // whiteKnight
    setCode: "leb",
};

export const whiteWardLeb: CardPrint = {
    printId: "4988dc3e-2ed8-4de3-9d1b-838003c9c9e3",
    definitionId: "49b22665-1501-420a-82ad-f71f6768bcf8", // whiteWard
    setCode: "leb",
};

export const wildGrowthLeb: CardPrint = {
    printId: "64f299eb-9cd6-40bc-ad44-22e3aeb5c930",
    definitionId: "fd896dfa-66c0-4327-8e5b-489bbe350c95", // wildGrowth (stub)
    setCode: "leb",
};

export const willotheWispLeb: CardPrint = {
    printId: "4b60630c-f97c-43be-8410-53a68613b735",
    definitionId: "a1a6f8e9-7bc1-4151-b55f-acf877b1a7a6", // willOTheWisp (stub)
    setCode: "leb",
};

export const winterOrbLeb: CardPrint = {
    printId: "847de6a4-a268-492e-a4d2-5b12237bc130",
    definitionId: "9359f60c-9a27-4e53-b35b-964a121a6fba", // winterOrb
    setCode: "leb",
};

export const woodenSphereLeb: CardPrint = {
    printId: "02eee156-54bd-46fc-8804-a73aab87f0ba",
    definitionId: "bcae01a2-171b-47cd-87be-f1e4e5314326", // woodenSphere (stub)
    setCode: "leb",
};

// Out of scope — see ADR 0010 (whole-opponent control, CR 720).
// export const wordOfCommandLeb: CardPrint = {
//     printId: "7d37b529-8a41-4177-abef-614f363e69d1",
//     definitionId: "96c21429-98d3-416b-be00-6aa9c4c5a006", // wordOfCommand (stub)
//     setCode: "leb",
// };

export const wrathOfGodLeb: CardPrint = {
    printId: "96dd2d61-a43d-4582-b730-71d4fac0fa23",
    definitionId: "a2788d69-6a3a-42f0-8736-cc6b57755ecd", // wrathOfGod
    setCode: "leb",
};

export const zombieMasterLeb: CardPrint = {
    printId: "a1bfda92-b932-46d8-b549-e2bc2b584a17",
    definitionId: "3d4255a0-d445-4c00-b936-bbf07851e1c8", // zombieMaster (stub)
    setCode: "leb",
};
