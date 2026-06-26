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

import type { CardPrint, CardDefinition } from "../../types";
import { makeCircleOfProtection } from "../../abilities";

export const animateWallLeb: CardPrint = {
    printId: "5c5b4738-20bb-465d-b67e-c6146dce9d0b",
    definitionId: "d5c83259-9b90-47c2-b48e-c7d78519e792", // animateWall (stub)
    setCode: "leb",
    rarity: "rare",
};

export const armageddonLeb: CardPrint = {
    printId: "02c4edfa-7822-40bc-88d1-d051b3a64df1",
    definitionId: "5b6ddce7-b9c5-431d-a0b0-46d4aa93cbcb", // armageddon
    setCode: "leb",
    rarity: "rare",
};

export const balanceLeb: CardPrint = {
    printId: "0f2c32a0-ee97-4239-94e3-aabab91dab83",
    definitionId: "6f9ea46a-411f-40ce-a873-a905180093f4", // balance
    setCode: "leb",
    rarity: "rare",
};

export const benalishHeroLeb: CardPrint = {
    printId: "f62c68d0-9b1e-4abe-991d-a645effeb676",
    definitionId: "11600105-56c6-4073-a4a6-8469030b39c9", // benalishHero (stub)
    setCode: "leb",
    rarity: "common",
};

export const blackWardLeb: CardPrint = {
    printId: "30d5d3fe-5741-40f7-8f45-dadb818d79b0",
    definitionId: "15967a39-303f-457d-bcde-51837c8d63e1", // blackWard
    setCode: "leb",
    rarity: "uncommon",
};

export const blazeOfGloryLeb: CardPrint = {
    printId: "f78aef20-e3bb-484c-9fa1-d2859408b04a",
    definitionId: "98fba951-c5bb-497c-9292-ce1b2a1e1247", // blazeOfGlory (stub)
    setCode: "leb",
    rarity: "rare",
};

export const blessingLeb: CardPrint = {
    printId: "bcd624c8-f06e-4181-865e-6a14ffc9302f",
    definitionId: "f131fd27-18da-47ca-b59f-135bcac83abd", // blessing (stub)
    setCode: "leb",
    rarity: "rare",
};

export const blueWardLeb: CardPrint = {
    printId: "aafae6f4-0880-4532-9224-44545bfa5eb4",
    definitionId: "93f9f0f2-e1cc-4740-888c-1336c6de0a27", // blueWard
    setCode: "leb",
    rarity: "uncommon",
};

export const castleLeb: CardPrint = {
    printId: "a8ba6b09-b24f-40cb-b219-ad8a1fd6692c",
    definitionId: "b0da8d56-3178-44c2-9344-95d2346d326f", // castle
    setCode: "leb",
    rarity: "uncommon",
};

// Circle of Protection: Black — Beta-original (no Alpha printing). Completes
// the CoP cycle; same factory as the LEA CoPs (CR 615). Single printing, so
// the def id is its own LEB Scryfall id — no separate CardPrint needed.
export const circleOfProtectionBlack: CardDefinition = makeCircleOfProtection({
    id: "fa47b4cd-8da4-4544-b011-ba92b7009203",
    rarity: "common", // matches the LEA Circle of Protection cycle
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
    rarity: "common",
};

export const circleOfProtectionGreenLeb: CardPrint = {
    printId: "e041b0ea-4a57-4950-9f8e-72d6e6ab2968",
    definitionId: "1ae32d20-b438-4f43-b603-e8f706ecfb03", // circleOfProtectionGreen
    setCode: "leb",
    rarity: "common",
};

export const circleOfProtectionRedLeb: CardPrint = {
    printId: "5de9dc85-d566-4cb0-a2e3-1ed4e5fe2f14",
    definitionId: "b3dd94c5-42f6-4148-be6e-2a3a4226cc0e", // circleOfProtectionRed
    setCode: "leb",
    rarity: "common",
};

export const circleOfProtectionWhiteLeb: CardPrint = {
    printId: "671aca82-6c55-43ef-b452-d6a2e706a7ae",
    definitionId: "92df19c9-e127-42d9-8dd2-7fa5a7095428", // circleOfProtectionWhite
    setCode: "leb",
    rarity: "common",
};

export const consecrateLandLeb: CardPrint = {
    printId: "077cf242-f866-497f-a23c-70e1b04a748e",
    definitionId: "d2379f78-c03f-447f-b3c9-10a918d556e9", // consecrateLand
    setCode: "leb",
    rarity: "uncommon",
};

export const conversionLeb: CardPrint = {
    printId: "4d9a5bb5-23cd-4f9a-8c8e-d009fb7bdf59",
    definitionId: "13186bc9-8d9c-433b-ba15-121ef94dd68a", // conversion (stub)
    setCode: "leb",
    rarity: "uncommon",
};

export const crusadeLeb: CardPrint = {
    printId: "2d5fbd9d-48bf-4600-8ca4-2ce2ca48128e",
    definitionId: "057986c7-20c0-4157-b4df-beae4ef5c66d", // crusade
    setCode: "leb",
    rarity: "rare",
};

export const deathWardLeb: CardPrint = {
    printId: "b119edd8-7801-475e-943a-6cbf10f2d303",
    definitionId: "fa5466cc-aa57-4a7f-8b21-d92b2fe02e13", // deathWard
    setCode: "leb",
    rarity: "common",
};

export const disenchantLeb: CardPrint = {
    printId: "9d61d0a5-7e92-4413-9121-925e1876b64d",
    definitionId: "2722d7e2-61c6-4934-9c21-875ee78fd06c", // disenchant
    setCode: "leb",
    rarity: "common",
};

export const farmsteadLeb: CardPrint = {
    printId: "c49ecc66-dccb-4026-8c6e-0b275a635a1f",
    definitionId: "3455b006-9ea5-4aef-8ad2-d0701eb0cacf", // farmstead
    setCode: "leb",
    rarity: "rare",
};

export const greenWardLeb: CardPrint = {
    printId: "a488ce63-1adb-4051-9521-703bad8d02f6",
    definitionId: "1f6118b2-fe01-425a-a2ed-6d7c42286c8e", // greenWard
    setCode: "leb",
    rarity: "uncommon",
};

export const guardianAngelLeb: CardPrint = {
    printId: "9c4e8259-b369-4b59-85fa-fe9edb1887c5",
    definitionId: "0f84d676-5327-454c-a033-b4498a9d28e2", // guardianAngel (stub)
    setCode: "leb",
    rarity: "common",
};

export const healingSalveLeb: CardPrint = {
    printId: "9c9f2eeb-fea5-4b33-9723-8be3c1914f63",
    definitionId: "e28de37e-84d5-4dc7-b36c-e14da5924729", // healingSalve (stub)
    setCode: "leb",
    rarity: "common",
};

export const holyArmorLeb: CardPrint = {
    printId: "6ab1d885-989c-4d71-8139-9e35d2f16d03",
    definitionId: "b01041d2-687e-4972-81c8-16690809275b", // holyArmor (stub)
    setCode: "leb",
    rarity: "common",
};

export const holyStrengthLeb: CardPrint = {
    printId: "de989395-50bf-458a-a010-e12abe2e15a6",
    definitionId: "e945a4cd-0eb1-4f54-898d-169ce2748a03", // holyStrength
    setCode: "leb",
    rarity: "common",
};

export const islandSanctuaryLeb: CardPrint = {
    printId: "273fb2b6-3d11-4f0d-9fb0-0364353c2060",
    definitionId: "c15e8a42-89de-42bc-8d5f-33426d207c3a", // islandSanctuary (stub)
    setCode: "leb",
    rarity: "rare",
};

export const karmaLeb: CardPrint = {
    printId: "1bea2eb6-dfae-4bdc-9ab3-b2b491c69c59",
    definitionId: "6f30ad61-fcb7-4d55-ba86-94de1bf545e4", // karma
    setCode: "leb",
    rarity: "uncommon",
};

export const lanceLeb: CardPrint = {
    printId: "a7aa3a93-3765-49f0-8ff2-b6843509c34a",
    definitionId: "ddb633f5-cc4d-4157-8217-def90cb15e24", // lance
    setCode: "leb",
    rarity: "uncommon",
};

export const mesaPegasusLeb: CardPrint = {
    printId: "55bff46a-6725-4918-9bdf-38efaaf50236",
    definitionId: "eaac88da-d19e-4771-944c-3709963d04e7", // mesaPegasus (stub)
    setCode: "leb",
    rarity: "common",
};

export const northernPaladinLeb: CardPrint = {
    printId: "4ba8493c-ae69-48d1-a050-a887ae27c83f",
    definitionId: "6303233b-35eb-49ca-b844-ba6b9fe1cbd2", // northernPaladin (stub)
    setCode: "leb",
    rarity: "rare",
};

export const pearledUnicornLeb: CardPrint = {
    printId: "47024d6d-dc55-4c35-b2bb-1b8bb0ee4e38",
    definitionId: "6daf1aab-1e58-4a5a-bc66-cb3f7c86e0e8", // pearledUnicorn
    setCode: "leb",
    rarity: "common",
};

export const personalIncarnationLeb: CardPrint = {
    printId: "f7bb9f31-0818-4422-8533-99a4e6845a02",
    definitionId: "caf9cef4-0f2d-478a-b119-fe1967687f74", // personalIncarnation (stub)
    setCode: "leb",
    rarity: "rare",
};

export const purelaceLeb: CardPrint = {
    printId: "af11986e-42bd-4f54-8624-7b34b1783a40",
    definitionId: "2facf462-55cd-4da4-997f-2cf4add75628", // purelace (stub)
    setCode: "leb",
    rarity: "rare",
};

export const redWardLeb: CardPrint = {
    printId: "057237bb-e1e6-4bcc-8639-ca0dcdd4846c",
    definitionId: "e0c64c01-c2aa-470b-88c6-3d3e4a969649", // redWard
    setCode: "leb",
    rarity: "uncommon",
};

export const resurrectionLeb: CardPrint = {
    printId: "50e3c741-5095-48a6-bd93-b9c4db265004",
    definitionId: "4fff6e6f-4ebd-4ec8-9443-59efb22d376c", // resurrection (stub)
    setCode: "leb",
    rarity: "uncommon",
};

export const reverseDamageLeb: CardPrint = {
    printId: "46cf22e4-cc5c-4723-a9cb-ae7ce7a55a1a",
    definitionId: "943baea8-b173-4863-a3ab-dd217d483cd9", // reverseDamage (stub)
    setCode: "leb",
    rarity: "rare",
};

export const righteousnessLeb: CardPrint = {
    printId: "b847a2d1-5912-4f88-a68f-06790d0795dc",
    definitionId: "d0ba7b76-f3d0-47d0-8a35-0c08e67200fb",
    setCode: "leb",
    rarity: "rare",
};

export const samiteHealerLeb: CardPrint = {
    printId: "3fbfb106-29d8-4065-b306-51dba0ed11a4",
    definitionId: "efba235e-04e5-449c-906c-0ac33f6d7929", // samiteHealer (stub)
    setCode: "leb",
    rarity: "common",
};

export const savannahLionsLeb: CardPrint = {
    printId: "67d1945d-d228-4dc3-a593-859408b2016b",
    definitionId: "d05b92bd-797e-413f-a8b0-32e0937a1ee0", // savannahLions
    setCode: "leb",
    rarity: "rare",
};

export const serraAngelLeb: CardPrint = {
    printId: "5669f9c8-2e94-47e2-a551-7efff317fb34",
    definitionId: "f8ac5006-91bd-4803-93da-f87cf196dd2f", // serraAngel
    setCode: "leb",
    rarity: "uncommon",
};

export const swordsToPlowsharesLeb: CardPrint = {
    printId: "255099be-c64e-4f6a-8463-4fc058d6908d",
    definitionId: "386ea9eb-abc1-4862-aa2d-8fb808d79490", // swordsToPlowshares
    setCode: "leb",
    rarity: "uncommon",
};

export const veteranBodyguardLeb: CardPrint = {
    printId: "d8d888b7-26e2-465d-b5ee-bb2f2af5c621",
    definitionId: "cbd9ab01-a833-4fa4-8dee-151bd9800835", // veteranBodyguard (stub)
    setCode: "leb",
    rarity: "rare",
};

export const wallOfSwordsLeb: CardPrint = {
    printId: "be955e9a-e722-4cd7-8e3d-bab1889c255b",
    definitionId: "99ec4723-b36c-4015-b361-736a6523e8f5", // wallOfSwords
    setCode: "leb",
    rarity: "uncommon",
};

export const whiteKnightLeb: CardPrint = {
    printId: "a231e0b8-b3e3-4f4a-8baa-c56626b01685",
    definitionId: "50abfba8-c9f9-4ebf-965a-4b425fe83129", // whiteKnight
    setCode: "leb",
    rarity: "uncommon",
};

export const whiteWardLeb: CardPrint = {
    printId: "4988dc3e-2ed8-4de3-9d1b-838003c9c9e3",
    definitionId: "49b22665-1501-420a-82ad-f71f6768bcf8", // whiteWard
    setCode: "leb",
    rarity: "uncommon",
};

export const wrathOfGodLeb: CardPrint = {
    printId: "96dd2d61-a43d-4582-b730-71d4fac0fa23",
    definitionId: "a2788d69-6a3a-42f0-8736-cc6b57755ecd", // wrathOfGod
    setCode: "leb",
    rarity: "rare",
};
