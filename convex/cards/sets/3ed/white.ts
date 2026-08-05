// 3ED (Revised Edition) white cards, split by colour per ADR 0043.
//
// Revised is a 100% reprint set — it introduces no new cards — so this module
// is entirely CardPrint entries: each declares the per-edition Scryfall UUID
// (printId) and resolves printId -> definitionId -> a shared CardDefinition
// already implemented in lea/leb/arn/atq/leg/drk/fem/ice. See ADR 0014.
//
// Generated from data/json/3ED.json; see the 3ed barrel (index.ts) and
// scripts/generate-print-set.mts 3ed. Cards are partitioned by colour identity
// derived from mana cost (CR 202.2): lands and artifacts (no coloured cost)
// live in colorless.ts; multicolour cards in multicolor.ts.
//
// Excluded: the 3 ante cards — Contract from Below, Darkpact, Demonic Attorney
// — are permanently out of scope (ADR 0010) and carry no print row.

import type { CardPrint } from "../../types";

export const animateWall3ed: CardPrint = {
    printId: "dffd3a5f-066b-40c2-99e0-dba1771c899d",
    definitionId: "d5c83259-9b90-47c2-b48e-c7d78519e792", // Animate Wall
    setCode: "3ed",
    rarity: "rare",
};

export const armageddon3ed: CardPrint = {
    printId: "605e9a62-53e4-4771-9730-56c78237004a",
    definitionId: "5b6ddce7-b9c5-431d-a0b0-46d4aa93cbcb", // Armageddon
    setCode: "3ed",
    rarity: "rare",
};

export const balance3ed: CardPrint = {
    printId: "a21b08d4-b43d-4c93-99e7-39dfe83ced91",
    definitionId: "6f9ea46a-411f-40ce-a873-a905180093f4", // Balance
    setCode: "3ed",
    rarity: "rare",
};

export const benalishHero3ed: CardPrint = {
    printId: "63e06cd7-9f00-4343-86c2-9f74945193c2",
    definitionId: "11600105-56c6-4073-a4a6-8469030b39c9", // Benalish Hero
    setCode: "3ed",
    rarity: "common",
};

export const blackWard3ed: CardPrint = {
    printId: "c5b6b0a4-bda8-422c-bddb-b2a0ba545596",
    definitionId: "15967a39-303f-457d-bcde-51837c8d63e1", // Black Ward
    setCode: "3ed",
    rarity: "uncommon",
};

export const blessing3ed: CardPrint = {
    printId: "f64f6100-c26a-4b22-9fa6-ab3f287a94aa",
    definitionId: "f131fd27-18da-47ca-b59f-135bcac83abd", // Blessing
    setCode: "3ed",
    rarity: "rare",
};

export const blueWard3ed: CardPrint = {
    printId: "9b79eaa0-8a15-4828-9ab7-16c2aab5f19f",
    definitionId: "93f9f0f2-e1cc-4740-888c-1336c6de0a27", // Blue Ward
    setCode: "3ed",
    rarity: "uncommon",
};

export const castle3ed: CardPrint = {
    printId: "434f2329-ea4c-41ba-ab62-857076d76442",
    definitionId: "b0da8d56-3178-44c2-9344-95d2346d326f", // Castle
    setCode: "3ed",
    rarity: "uncommon",
};

export const circleOfProtectionBlack3ed: CardPrint = {
    printId: "c498313d-bb29-4ab9-ab2f-31bdc3d9f78a",
    definitionId: "fa47b4cd-8da4-4544-b011-ba92b7009203", // Circle of Protection: Black
    setCode: "3ed",
    rarity: "common",
};

export const circleOfProtectionBlue3ed: CardPrint = {
    printId: "539809fc-fdeb-4345-a920-37fdb782fdd8",
    definitionId: "848b1a7f-e8ba-40b5-92b7-af1e963a0319", // Circle of Protection: Blue
    setCode: "3ed",
    rarity: "common",
};

export const circleOfProtectionGreen3ed: CardPrint = {
    printId: "251e0407-b49a-4ee5-83a1-1523ff03a7a7",
    definitionId: "1ae32d20-b438-4f43-b603-e8f706ecfb03", // Circle of Protection: Green
    setCode: "3ed",
    rarity: "common",
};

export const circleOfProtectionRed3ed: CardPrint = {
    printId: "b66cadb3-705d-44d3-9277-5d53cd42dae1",
    definitionId: "b3dd94c5-42f6-4148-be6e-2a3a4226cc0e", // Circle of Protection: Red
    setCode: "3ed",
    rarity: "common",
};

export const circleOfProtectionWhite3ed: CardPrint = {
    printId: "7f113b87-8569-45b2-b644-fb3f4890c2ca",
    definitionId: "92df19c9-e127-42d9-8dd2-7fa5a7095428", // Circle of Protection: White
    setCode: "3ed",
    rarity: "common",
};

export const conversion3ed: CardPrint = {
    printId: "70182de2-253f-47d4-ac46-bec4a88b578e",
    definitionId: "13186bc9-8d9c-433b-ba15-121ef94dd68a", // Conversion
    setCode: "3ed",
    rarity: "uncommon",
};

export const crusade3ed: CardPrint = {
    printId: "5670c4c0-b8c3-4100-8cd9-c176b29fe01c",
    definitionId: "057986c7-20c0-4157-b4df-beae4ef5c66d", // Crusade
    setCode: "3ed",
    rarity: "rare",
};

export const deathWard3ed: CardPrint = {
    printId: "555011ea-f03a-4815-b593-cc5d92bba7bd",
    definitionId: "fa5466cc-aa57-4a7f-8b21-d92b2fe02e13", // Death Ward
    setCode: "3ed",
    rarity: "common",
};

export const disenchant3ed: CardPrint = {
    printId: "41859c6f-1017-42ae-9061-050fe0db9731",
    definitionId: "2722d7e2-61c6-4934-9c21-875ee78fd06c", // Disenchant
    setCode: "3ed",
    rarity: "common",
};

export const eyeForAnEye3ed: CardPrint = {
    printId: "23c35f2c-0442-46f3-966b-667bad6e0e27",
    definitionId: "2933ca2a-097b-44f4-ae56-ad524d26fd06", // Eye for an Eye
    setCode: "3ed",
    rarity: "rare",
};

export const farmstead3ed: CardPrint = {
    printId: "75a45b69-1b8d-4b66-a0bf-6142172c7d27",
    definitionId: "3455b006-9ea5-4aef-8ad2-d0701eb0cacf", // Farmstead
    setCode: "3ed",
    rarity: "rare",
};

export const greenWard3ed: CardPrint = {
    printId: "c1270551-607c-4ef3-88e7-45b4e2445045",
    definitionId: "1f6118b2-fe01-425a-a2ed-6d7c42286c8e", // Green Ward
    setCode: "3ed",
    rarity: "uncommon",
};

export const guardianAngel3ed: CardPrint = {
    printId: "74da83ea-8302-4927-a355-331636950572",
    definitionId: "0f84d676-5327-454c-a033-b4498a9d28e2", // Guardian Angel
    setCode: "3ed",
    rarity: "common",
};

export const healingSalve3ed: CardPrint = {
    printId: "3300b080-a6f5-4a4a-8faf-0206fbfe8988",
    definitionId: "e28de37e-84d5-4dc7-b36c-e14da5924729", // Healing Salve
    setCode: "3ed",
    rarity: "common",
};

export const holyArmor3ed: CardPrint = {
    printId: "e53412cc-2246-47b5-a212-edee7fac4a54",
    definitionId: "b01041d2-687e-4972-81c8-16690809275b", // Holy Armor
    setCode: "3ed",
    rarity: "common",
};

export const holyStrength3ed: CardPrint = {
    printId: "37414560-8187-4c5b-8245-05d77b25c454",
    definitionId: "e945a4cd-0eb1-4f54-898d-169ce2748a03", // Holy Strength
    setCode: "3ed",
    rarity: "common",
};

export const islandSanctuary3ed: CardPrint = {
    printId: "9973e59d-09ca-4647-85dd-15838cf63c2d",
    definitionId: "c15e8a42-89de-42bc-8d5f-33426d207c3a", // Island Sanctuary
    setCode: "3ed",
    rarity: "rare",
};

export const karma3ed: CardPrint = {
    printId: "b316838d-2414-4d0c-a25f-132b7462064a",
    definitionId: "6f30ad61-fcb7-4d55-ba86-94de1bf545e4", // Karma
    setCode: "3ed",
    rarity: "uncommon",
};

export const lance3ed: CardPrint = {
    printId: "d023e930-f974-40a8-8832-9357350bc7ae",
    definitionId: "ddb633f5-cc4d-4157-8217-def90cb15e24", // Lance
    setCode: "3ed",
    rarity: "uncommon",
};

export const mesaPegasus3ed: CardPrint = {
    printId: "ce7e6bfb-9038-48b5-bfaf-9450c503c69e",
    definitionId: "eaac88da-d19e-4771-944c-3709963d04e7", // Mesa Pegasus
    setCode: "3ed",
    rarity: "common",
};

export const northernPaladin3ed: CardPrint = {
    printId: "5ef69d3f-cbad-4069-82dc-4dbfb35377f4",
    definitionId: "6303233b-35eb-49ca-b844-ba6b9fe1cbd2", // Northern Paladin
    setCode: "3ed",
    rarity: "rare",
};

export const pearledUnicorn3ed: CardPrint = {
    printId: "a450ce98-4854-4378-8809-27019b3800c2",
    definitionId: "6daf1aab-1e58-4a5a-bc66-cb3f7c86e0e8", // Pearled Unicorn
    setCode: "3ed",
    rarity: "common",
};

export const personalIncarnation3ed: CardPrint = {
    printId: "e82a9dd8-653a-4410-b78f-303aaf69d11e",
    definitionId: "caf9cef4-0f2d-478a-b119-fe1967687f74", // Personal Incarnation
    setCode: "3ed",
    rarity: "rare",
};

export const purelace3ed: CardPrint = {
    printId: "b9e9b348-121b-42d3-b7be-d6a83dca9157",
    definitionId: "2facf462-55cd-4da4-997f-2cf4add75628", // Purelace
    setCode: "3ed",
    rarity: "rare",
};

export const redWard3ed: CardPrint = {
    printId: "e6a8157a-4c5e-4a08-83e3-c8fafa7a828b",
    definitionId: "e0c64c01-c2aa-470b-88c6-3d3e4a969649", // Red Ward
    setCode: "3ed",
    rarity: "uncommon",
};

export const resurrection3ed: CardPrint = {
    printId: "c159804d-8757-4172-a661-4f9ee068fce1",
    definitionId: "4fff6e6f-4ebd-4ec8-9443-59efb22d376c", // Resurrection
    setCode: "3ed",
    rarity: "uncommon",
};

export const reverseDamage3ed: CardPrint = {
    printId: "04e97dbe-39e1-4bf7-815a-839048463682",
    definitionId: "943baea8-b173-4863-a3ab-dd217d483cd9", // Reverse Damage
    setCode: "3ed",
    rarity: "rare",
};

export const reversePolarity3ed: CardPrint = {
    printId: "e77b2e9b-4db2-4dd2-ae55-bddb22ff87e5",
    definitionId: "da7ed8ba-3886-4779-a9b3-6892a7ed3527", // Reverse Polarity
    setCode: "3ed",
    rarity: "uncommon",
};

export const righteousness3ed: CardPrint = {
    printId: "d85954b4-306e-46d3-b913-240e16acdcac",
    definitionId: "d0ba7b76-f3d0-47d0-8a35-0c08e67200fb", // Righteousness
    setCode: "3ed",
    rarity: "rare",
};

export const samiteHealer3ed: CardPrint = {
    printId: "7545fe51-dbe5-4d4c-87a8-86d54734bf33",
    definitionId: "efba235e-04e5-449c-906c-0ac33f6d7929", // Samite Healer
    setCode: "3ed",
    rarity: "common",
};

export const savannahLions3ed: CardPrint = {
    printId: "ad41b1aa-1482-4d71-990b-031b30685cb1",
    definitionId: "d05b92bd-797e-413f-a8b0-32e0937a1ee0", // Savannah Lions
    setCode: "3ed",
    rarity: "rare",
};

export const serraAngel3ed: CardPrint = {
    printId: "97fa5f07-46ba-408d-a861-bdb1791cc188",
    definitionId: "f8ac5006-91bd-4803-93da-f87cf196dd2f", // Serra Angel
    setCode: "3ed",
    rarity: "uncommon",
};

export const swordsToPlowshares3ed: CardPrint = {
    printId: "057d2410-30d3-4b7a-9dc3-f2512c1cf31c",
    definitionId: "386ea9eb-abc1-4862-aa2d-8fb808d79490", // Swords to Plowshares
    setCode: "3ed",
    rarity: "uncommon",
};

export const veteranBodyguard3ed: CardPrint = {
    printId: "d55a1479-6654-4e8e-9a27-44e23753f8be",
    definitionId: "cbd9ab01-a833-4fa4-8dee-151bd9800835", // Veteran Bodyguard
    setCode: "3ed",
    rarity: "rare",
};

export const wallOfSwords3ed: CardPrint = {
    printId: "4390978b-f647-4720-8caa-00eeecff8471",
    definitionId: "99ec4723-b36c-4015-b361-736a6523e8f5", // Wall of Swords
    setCode: "3ed",
    rarity: "uncommon",
};

export const whiteKnight3ed: CardPrint = {
    printId: "ce573cee-40e0-4740-8b86-538ad8a16bce",
    definitionId: "50abfba8-c9f9-4ebf-965a-4b425fe83129", // White Knight
    setCode: "3ed",
    rarity: "uncommon",
};

export const whiteWard3ed: CardPrint = {
    printId: "bb38dcd5-4f12-461c-96a8-867a5b63c5c1",
    definitionId: "49b22665-1501-420a-82ad-f71f6768bcf8", // White Ward
    setCode: "3ed",
    rarity: "uncommon",
};

export const wrathOfGod3ed: CardPrint = {
    printId: "1c687a4e-a3f9-4d2d-9931-bf60e97f4095",
    definitionId: "a2788d69-6a3a-42f0-8736-cc6b57755ecd", // Wrath of God
    setCode: "3ed",
    rarity: "rare",
};
