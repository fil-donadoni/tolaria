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

export const animateDeadLeb: CardPrint = {
    printId: "20d5059a-60a4-4135-863f-85a48bff8731",
    definitionId: "8fd7861d-925f-4b4c-a4ab-60be6f43d50b", // animateDead (stub)
    setCode: "leb",
    rarity: "uncommon",
};

export const badMoonLeb: CardPrint = {
    printId: "bf812f48-633c-46ab-b0c3-4819ab1b4e49",
    definitionId: "43572906-ea74-4411-a549-5dc401591d2a", // badMoon
    setCode: "leb",
    rarity: "rare",
};

export const blackKnightLeb: CardPrint = {
    printId: "1eced352-d49c-4e91-a368-52904d77a69d",
    definitionId: "c1662949-0d69-49a3-8c69-daf10717ed4e", // blackKnight
    setCode: "leb",
    rarity: "uncommon",
};

export const bogWraithLeb: CardPrint = {
    printId: "da26289f-e0e6-4aae-8782-ebdbabf39819",
    definitionId: "6701874e-986e-4b81-9268-90b6171e6187", // bogWraith
    setCode: "leb",
    rarity: "uncommon",
};

// Out of scope — see ADR 0010 (ante; game mode not modelled).
// export const contractFromBelowLeb: CardPrint = {
//     printId: "62f96e43-aebd-4de2-969a-37cd1d62f127",
//     definitionId: "9853b0ce-4763-4877-9741-f9145a3659c6", // contractFromBelow (stub)
//     setCode: "leb",
// };

export const cursedLandLeb: CardPrint = {
    printId: "1eea8122-00c2-4d00-b87b-12eea86b16ba",
    definitionId: "cf5f3c61-1e54-4eea-bf82-311cfa988e6a", // cursedLand (stub)
    setCode: "leb",
    rarity: "uncommon",
};

export const darkRitualLeb: CardPrint = {
    printId: "0690f724-eb95-416b-b064-f1239e2a30e8",
    definitionId: "ebb6664d-23ca-456e-9916-afcd6f26aa7f", // darkRitual
    setCode: "leb",
    rarity: "common",
};

// Out of scope — see ADR 0010 (ante; game mode not modelled).
// export const darkpactLeb: CardPrint = {
//     printId: "09b12bcb-a935-48be-a5e8-abbb890e91ca",
//     definitionId: "e78db688-93a2-47f5-9aa5-9158a72cd973", // darkpact (stub)
//     setCode: "leb",
// };

export const deathgripLeb: CardPrint = {
    printId: "c942a9af-e449-4f10-916c-6eb9e944de6a",
    definitionId: "2371c126-f19a-472a-ba5f-3b1366274ea0", // deathgrip (stub)
    setCode: "leb",
    rarity: "uncommon",
};

export const deathlaceLeb: CardPrint = {
    printId: "e16fc59a-17da-462a-86ea-31f8a9ac18a1",
    definitionId: "6ff1cefc-62cb-4525-b0c5-2b09603b4314", // deathlace (stub)
    setCode: "leb",
    rarity: "rare",
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
    rarity: "rare",
};

export const demonicTutorLeb: CardPrint = {
    printId: "a5e571ef-1645-4584-ab53-e7ea5d443dea",
    definitionId: "711d4d54-5520-4de8-9b93-79902ed8e562", // demonicTutor
    setCode: "leb",
    rarity: "uncommon",
};

export const drainLifeLeb: CardPrint = {
    printId: "9fbc6761-c4fc-4b4c-afb5-94ad4d21bc05",
    definitionId: "5d077a49-73d4-4958-b42a-31b814e110e8", // drainLife
    setCode: "leb",
    rarity: "common",
};

export const drudgeSkeletonsLeb: CardPrint = {
    printId: "b1f3a1b9-d192-49d9-87bb-ca50e99edbd1",
    definitionId: "23614289-0d73-4747-a849-5cb67cc97d6a", // drudgeSkeletons (stub)
    setCode: "leb",
    rarity: "common",
};

export const evilPresenceLeb: CardPrint = {
    printId: "9e995f4b-efd3-4ac7-8fec-adb913294815",
    definitionId: "0551d66e-8cd4-48f0-aa17-15f26be9d85f", // evilPresence (stub)
    setCode: "leb",
    rarity: "uncommon",
};

export const fearLeb: CardPrint = {
    printId: "67830531-970a-4339-8673-40954376455d",
    definitionId: "0cd927be-e63f-4371-a1d8-7a0489cb187e", // fear (stub)
    setCode: "leb",
    rarity: "common",
};

export const frozenShadeLeb: CardPrint = {
    printId: "89b6a352-40f5-4d7c-b2b6-2617539a1c1c",
    definitionId: "d0bd76c8-4cff-4c15-9686-7a299b589814", // frozenShade (stub)
    setCode: "leb",
    rarity: "common",
};

export const gloomLeb: CardPrint = {
    printId: "640770d9-c0f8-40fd-9467-ebc099a27a4b",
    definitionId: "a8d10bc7-daeb-4c0d-9e4a-8eae8d11699f", // gloom (stub)
    setCode: "leb",
    rarity: "uncommon",
};

export const howlFromBeyondLeb: CardPrint = {
    printId: "f6018459-d09b-489a-81be-933fd7d854c1",
    definitionId: "67ec17e1-174b-4d07-a27f-91a333c4b2fb", // howlFromBeyond (stub)
    setCode: "leb",
    rarity: "common",
};

export const hypnoticSpecterLeb: CardPrint = {
    printId: "edcc56a0-1dc0-4261-8f9c-5a88ce83f9e9",
    definitionId: "b43b900f-2d9b-442b-9699-058483604ec9", // hypnoticSpecter
    setCode: "leb",
    rarity: "uncommon",
};

export const lichLeb: CardPrint = {
    printId: "e5a9c089-0aad-4c14-9bfc-c0b39c976777",
    definitionId: "4250caec-0e37-41be-9ec4-8938deb5f0d0", // lich (stub)
    setCode: "leb",
    rarity: "rare",
};

export const lordOfThePitLeb: CardPrint = {
    printId: "24626988-81df-44c9-9a8e-ecb9f82c383b",
    definitionId: "2926777a-4f6e-4965-ba83-22cf7df02602", // lordOfThePit (stub)
    setCode: "leb",
    rarity: "rare",
};

export const mindTwistLeb: CardPrint = {
    printId: "0cb6cbbe-c3e9-4d14-a6b8-fb74e6a02b33",
    definitionId: "eee9e106-a248-49d2-b8c8-6bbcd56ce739", // mindTwist (stub)
    setCode: "leb",
    rarity: "rare",
};

export const netherShadowLeb: CardPrint = {
    printId: "38396ae3-a48f-44c7-96bf-ea41b5aaeebc",
    definitionId: "f13ad58a-6f9b-420a-bac1-40929f5e616a", // netherShadow (stub)
    setCode: "leb",
    rarity: "rare",
};

export const nettlingImpLeb: CardPrint = {
    printId: "576220c3-1e6b-43f3-a47e-5e8246ee7d46",
    definitionId: "8105973c-a94d-444c-ba20-ab0fa978bee8",
    setCode: "leb",
    rarity: "uncommon",
};

export const nightmareLeb: CardPrint = {
    printId: "fc78dced-27d2-441a-b63b-32356bc33747",
    definitionId: "b8cdd6a7-f772-4ccb-914f-63f52ed54d6b", // nightmare
    setCode: "leb",
    rarity: "rare",
};

export const paralyzeLeb: CardPrint = {
    printId: "106d8401-f0e2-461e-b8ea-16d475db98da",
    definitionId: "be33a155-de26-43d1-88f1-c926f1b7cb7c", // paralyze (stub)
    setCode: "leb",
    rarity: "common",
};

export const pestilenceLeb: CardPrint = {
    printId: "1313b7e6-4acb-435a-bde5-1def5e5350ac",
    definitionId: "d42a6350-b16b-4e10-a273-e6cbb55dcb7a", // pestilence (stub)
    setCode: "leb",
    rarity: "common",
};

export const plagueRatsLeb: CardPrint = {
    printId: "995b58e6-5c69-4fdf-9c41-61cef7a610c4",
    definitionId: "b3724e40-0622-4aee-9334-6c9fff88bcd5", // plagueRats (stub)
    setCode: "leb",
    rarity: "common",
};

export const raiseDeadLeb: CardPrint = {
    printId: "0066c7a6-7775-43ba-81cd-35fbc5621bc3",
    definitionId: "ce07bede-2219-427c-a61a-56518751de42", // raiseDead (stub)
    setCode: "leb",
    rarity: "common",
};

export const royalAssassinLeb: CardPrint = {
    printId: "b6e33c5e-6d99-4e7e-b611-4b271a47b4d2",
    definitionId: "59590768-fa96-4869-8763-9d5ab6ac22ad", // royalAssassin
    setCode: "leb",
    rarity: "rare",
};

export const sacrificeLeb: CardPrint = {
    printId: "8abe7d62-6a99-4d1f-9b81-cff0485997a8",
    definitionId: "12164aee-6a27-4246-8d15-2d6dd20d92e9", // sacrifice (stub)
    setCode: "leb",
    rarity: "uncommon",
};

export const scatheZombiesLeb: CardPrint = {
    printId: "a30abb09-2f80-46cf-a839-b4dac5c23dce",
    definitionId: "e9be6dcf-5e25-4b8c-9cd0-badf3771f81e", // scatheZombies
    setCode: "leb",
    rarity: "common",
};

export const scavengingGhoulLeb: CardPrint = {
    printId: "e2bfa6bb-cf7b-4a79-83f5-178a633c499e",
    definitionId: "426984e0-88e1-4a2d-9a1c-798b95864df3", // scavengingGhoul (stub)
    setCode: "leb",
    rarity: "uncommon",
};

export const sengirVampireLeb: CardPrint = {
    printId: "5fbd5fbb-f689-4ff0-8f23-17e4cb0925a2",
    definitionId: "510840f4-7c0e-4b47-8ebf-23c20cac4bd9", // sengirVampire
    setCode: "leb",
    rarity: "uncommon",
};

export const simulacrumLeb: CardPrint = {
    printId: "5bcda143-55f8-4d02-918f-975d9090d03f",
    definitionId: "35c3a78d-cc79-4187-929a-8aa1d1469990", // simulacrum (stub)
    setCode: "leb",
    rarity: "uncommon",
};

export const sinkholeLeb: CardPrint = {
    printId: "52ea4387-f23c-430c-99d6-0248a4ab1713",
    definitionId: "04b31611-9053-4eaf-b392-21bb644fef5f", // sinkhole
    setCode: "leb",
    rarity: "common",
};

export const terrorLeb: CardPrint = {
    printId: "58d8598b-35e5-414f-aee0-52137236f642",
    definitionId: "21004958-2c7e-4a55-bc80-411c4d780106", // terror (stub)
    setCode: "leb",
    rarity: "common",
};

export const unholyStrengthLeb: CardPrint = {
    printId: "1c1c781d-1f27-40e3-9d79-0ebb6677e835",
    definitionId: "90563f90-0127-4164-b43b-f0321dc63a1d", // unholyStrength (stub)
    setCode: "leb",
    rarity: "common",
};

export const wallOfBoneLeb: CardPrint = {
    printId: "7930666c-12ac-420b-8ced-0e924925b075",
    definitionId: "ae20d442-a544-4a03-9ebf-5ecb137c67dd", // wallOfBone (stub)
    setCode: "leb",
    rarity: "uncommon",
};

export const warpArtifactLeb: CardPrint = {
    printId: "4a289787-2d30-4e0b-ac97-3767818d0387",
    definitionId: "9e5e07a2-fbdf-4c4c-996a-fce40bab5de5", // warpArtifact (stub)
    setCode: "leb",
    rarity: "rare",
};

export const weaknessLeb: CardPrint = {
    printId: "16137fa6-1b5c-49e7-ad79-dda4b7019a59",
    definitionId: "36ca06a1-9b9a-49a2-9c47-9b72228621bc", // weakness (stub)
    setCode: "leb",
    rarity: "common",
};

export const willotheWispLeb: CardPrint = {
    printId: "4b60630c-f97c-43be-8410-53a68613b735",
    definitionId: "a1a6f8e9-7bc1-4151-b55f-acf877b1a7a6", // willOTheWisp (stub)
    setCode: "leb",
    rarity: "rare",
};

// Out of scope — see ADR 0010 (whole-opponent control, CR 720).
// export const wordOfCommandLeb: CardPrint = {
//     printId: "7d37b529-8a41-4177-abef-614f363e69d1",
//     definitionId: "96c21429-98d3-416b-be00-6aa9c4c5a006", // wordOfCommand (stub)
//     setCode: "leb",
// };

export const zombieMasterLeb: CardPrint = {
    printId: "a1bfda92-b932-46d8-b549-e2bc2b584a17",
    definitionId: "3d4255a0-d445-4c00-b936-bbf07851e1c8", // zombieMaster (stub)
    setCode: "leb",
    rarity: "rare",
};
