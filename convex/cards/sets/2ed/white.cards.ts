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

export const animateWall2ed: CardPrint = {
    printId: "05d7bed4-950a-4a4e-b79a-50e4aa416fe9",
    definitionId: "d5c83259-9b90-47c2-b48e-c7d78519e792", // Animate Wall
    setCode: "2ed",
    rarity: "rare",
};

export const armageddon2ed: CardPrint = {
    printId: "df2c5d5c-f1c9-4639-bf72-3f6bde554864",
    definitionId: "5b6ddce7-b9c5-431d-a0b0-46d4aa93cbcb", // Armageddon
    setCode: "2ed",
    rarity: "rare",
};

export const balance2ed: CardPrint = {
    printId: "8352e8b6-c947-49f3-a653-a6af65d3e9c3",
    definitionId: "6f9ea46a-411f-40ce-a873-a905180093f4", // Balance
    setCode: "2ed",
    rarity: "rare",
};

export const benalishHero2ed: CardPrint = {
    printId: "9404e779-2065-4c4f-95d1-6997c7fea156",
    definitionId: "11600105-56c6-4073-a4a6-8469030b39c9", // Benalish Hero
    setCode: "2ed",
    rarity: "common",
};

export const blackWard2ed: CardPrint = {
    printId: "f0cd79e9-1b61-4ad3-8f6d-cb5d3f60ef8e",
    definitionId: "15967a39-303f-457d-bcde-51837c8d63e1", // Black Ward
    setCode: "2ed",
    rarity: "uncommon",
};

export const blazeOfGlory2ed: CardPrint = {
    printId: "2d636573-287d-4f6f-93b0-12ddd8f3e6d1",
    definitionId: "98fba951-c5bb-497c-9292-ce1b2a1e1247", // Blaze of Glory
    setCode: "2ed",
    rarity: "rare",
};

export const blessing2ed: CardPrint = {
    printId: "402e84fb-7c77-4491-9ece-c2d9b8506ece",
    definitionId: "f131fd27-18da-47ca-b59f-135bcac83abd", // Blessing
    setCode: "2ed",
    rarity: "rare",
};

export const blueWard2ed: CardPrint = {
    printId: "1704d11c-569c-4b4e-bbe0-df42af98c4fc",
    definitionId: "93f9f0f2-e1cc-4740-888c-1336c6de0a27", // Blue Ward
    setCode: "2ed",
    rarity: "uncommon",
};

export const castle2ed: CardPrint = {
    printId: "2ea3db44-85c5-4201-a5c9-ec14a9d244d6",
    definitionId: "b0da8d56-3178-44c2-9344-95d2346d326f", // Castle
    setCode: "2ed",
    rarity: "uncommon",
};

export const circleOfProtectionBlack2ed: CardPrint = {
    printId: "1eea1199-6b07-430c-b100-c5825a23d8b0",
    definitionId: "fa47b4cd-8da4-4544-b011-ba92b7009203", // Circle of Protection: Black
    setCode: "2ed",
    rarity: "common",
};

export const circleOfProtectionBlue2ed: CardPrint = {
    printId: "c19c60f7-92b7-4f84-b2c3-64e3d00dcb63",
    definitionId: "848b1a7f-e8ba-40b5-92b7-af1e963a0319", // Circle of Protection: Blue
    setCode: "2ed",
    rarity: "common",
};

export const circleOfProtectionGreen2ed: CardPrint = {
    printId: "108ce265-1b3a-484a-9b0c-cab1094d1521",
    definitionId: "1ae32d20-b438-4f43-b603-e8f706ecfb03", // Circle of Protection: Green
    setCode: "2ed",
    rarity: "common",
};

export const circleOfProtectionRed2ed: CardPrint = {
    printId: "4cc60529-401b-481a-b65c-ad791153afd7",
    definitionId: "b3dd94c5-42f6-4148-be6e-2a3a4226cc0e", // Circle of Protection: Red
    setCode: "2ed",
    rarity: "common",
};

export const circleOfProtectionWhite2ed: CardPrint = {
    printId: "98a1c689-cd8b-4a80-ad6d-e4ff5933f5e7",
    definitionId: "92df19c9-e127-42d9-8dd2-7fa5a7095428", // Circle of Protection: White
    setCode: "2ed",
    rarity: "common",
};

export const consecrateLand2ed: CardPrint = {
    printId: "9efb29d2-550f-4ede-b024-7b0e15c2e986",
    definitionId: "d2379f78-c03f-447f-b3c9-10a918d556e9", // Consecrate Land
    setCode: "2ed",
    rarity: "uncommon",
};

export const conversion2ed: CardPrint = {
    printId: "45bf4297-ccf4-4fa0-b7ce-5aaebca50813",
    definitionId: "13186bc9-8d9c-433b-ba15-121ef94dd68a", // Conversion
    setCode: "2ed",
    rarity: "uncommon",
};

export const crusade2ed: CardPrint = {
    printId: "4b9933e3-2267-4534-a1c6-c463e767480a",
    definitionId: "057986c7-20c0-4157-b4df-beae4ef5c66d", // Crusade
    setCode: "2ed",
    rarity: "rare",
};

export const deathWard2ed: CardPrint = {
    printId: "d7604388-752a-463d-95cd-486752a4bd04",
    definitionId: "fa5466cc-aa57-4a7f-8b21-d92b2fe02e13", // Death Ward
    setCode: "2ed",
    rarity: "common",
};

export const disenchant2ed: CardPrint = {
    printId: "73636b95-103d-43c8-bc96-63fad0da34dd",
    definitionId: "2722d7e2-61c6-4934-9c21-875ee78fd06c", // Disenchant
    setCode: "2ed",
    rarity: "common",
};

export const farmstead2ed: CardPrint = {
    printId: "3d79940b-9384-4009-8b74-3d56a2c5a8a5",
    definitionId: "3455b006-9ea5-4aef-8ad2-d0701eb0cacf", // Farmstead
    setCode: "2ed",
    rarity: "rare",
};

export const greenWard2ed: CardPrint = {
    printId: "73f6058a-9292-4474-a794-7161ec9a99f0",
    definitionId: "1f6118b2-fe01-425a-a2ed-6d7c42286c8e", // Green Ward
    setCode: "2ed",
    rarity: "uncommon",
};

export const guardianAngel2ed: CardPrint = {
    printId: "c2b47221-c468-4b77-89c5-79a06443ef81",
    definitionId: "0f84d676-5327-454c-a033-b4498a9d28e2", // Guardian Angel
    setCode: "2ed",
    rarity: "common",
};

export const healingSalve2ed: CardPrint = {
    printId: "a38b2f1c-a69b-467a-a749-d7fbc1fb6dbb",
    definitionId: "e28de37e-84d5-4dc7-b36c-e14da5924729", // Healing Salve
    setCode: "2ed",
    rarity: "common",
};

export const holyArmor2ed: CardPrint = {
    printId: "9a7d92de-d663-4919-a23f-38389ba5593e",
    definitionId: "b01041d2-687e-4972-81c8-16690809275b", // Holy Armor
    setCode: "2ed",
    rarity: "common",
};

export const holyStrength2ed: CardPrint = {
    printId: "f25cea1b-22c0-4323-8119-0ca627426aa7",
    definitionId: "e945a4cd-0eb1-4f54-898d-169ce2748a03", // Holy Strength
    setCode: "2ed",
    rarity: "common",
};

export const islandSanctuary2ed: CardPrint = {
    printId: "d5726f8d-4467-4ab9-8931-432c0cefcbf4",
    definitionId: "c15e8a42-89de-42bc-8d5f-33426d207c3a", // Island Sanctuary
    setCode: "2ed",
    rarity: "rare",
};

export const karma2ed: CardPrint = {
    printId: "c9aa32e2-aeb0-4104-8603-a56bd8fc0953",
    definitionId: "6f30ad61-fcb7-4d55-ba86-94de1bf545e4", // Karma
    setCode: "2ed",
    rarity: "uncommon",
};

export const lance2ed: CardPrint = {
    printId: "e7e9714d-072b-4237-8371-5ce2709c878f",
    definitionId: "ddb633f5-cc4d-4157-8217-def90cb15e24", // Lance
    setCode: "2ed",
    rarity: "uncommon",
};

export const mesaPegasus2ed: CardPrint = {
    printId: "7ff95a24-86e9-4302-bd90-89ca96164032",
    definitionId: "eaac88da-d19e-4771-944c-3709963d04e7", // Mesa Pegasus
    setCode: "2ed",
    rarity: "common",
};

export const northernPaladin2ed: CardPrint = {
    printId: "309cd081-13bb-428b-b561-60b7a81c0f1d",
    definitionId: "6303233b-35eb-49ca-b844-ba6b9fe1cbd2", // Northern Paladin
    setCode: "2ed",
    rarity: "rare",
};

export const pearledUnicorn2ed: CardPrint = {
    printId: "9254b0be-d350-41c1-8ed9-41a22525adf9",
    definitionId: "6daf1aab-1e58-4a5a-bc66-cb3f7c86e0e8", // Pearled Unicorn
    setCode: "2ed",
    rarity: "common",
};

export const personalIncarnation2ed: CardPrint = {
    printId: "19272824-a0a4-4352-8904-a185516c95e1",
    definitionId: "caf9cef4-0f2d-478a-b119-fe1967687f74", // Personal Incarnation
    setCode: "2ed",
    rarity: "rare",
};

export const purelace2ed: CardPrint = {
    printId: "bd89c79a-668e-4f3c-b248-6f067e6fca65",
    definitionId: "2facf462-55cd-4da4-997f-2cf4add75628", // Purelace
    setCode: "2ed",
    rarity: "rare",
};

export const redWard2ed: CardPrint = {
    printId: "03d818b4-4722-4035-a2bc-ebc4c8c90ec0",
    definitionId: "e0c64c01-c2aa-470b-88c6-3d3e4a969649", // Red Ward
    setCode: "2ed",
    rarity: "uncommon",
};

export const resurrection2ed: CardPrint = {
    printId: "609f6e06-daaa-4b15-a167-dc3ed6ce33cc",
    definitionId: "4fff6e6f-4ebd-4ec8-9443-59efb22d376c", // Resurrection
    setCode: "2ed",
    rarity: "uncommon",
};

export const reverseDamage2ed: CardPrint = {
    printId: "7f83f4fa-9c22-4bcb-8de0-f40f208128d1",
    definitionId: "943baea8-b173-4863-a3ab-dd217d483cd9", // Reverse Damage
    setCode: "2ed",
    rarity: "rare",
};

export const righteousness2ed: CardPrint = {
    printId: "ddb92543-e601-4575-8e17-84ec0b1edd66",
    definitionId: "d0ba7b76-f3d0-47d0-8a35-0c08e67200fb", // Righteousness
    setCode: "2ed",
    rarity: "rare",
};

export const samiteHealer2ed: CardPrint = {
    printId: "7281e17d-a6e0-4e0e-8ee6-c6d9dec54231",
    definitionId: "efba235e-04e5-449c-906c-0ac33f6d7929", // Samite Healer
    setCode: "2ed",
    rarity: "common",
};

export const savannahLions2ed: CardPrint = {
    printId: "3da61fc1-6201-4823-975f-2d4d9f7f3193",
    definitionId: "d05b92bd-797e-413f-a8b0-32e0937a1ee0", // Savannah Lions
    setCode: "2ed",
    rarity: "rare",
};

export const serraAngel2ed: CardPrint = {
    printId: "1941cf19-b1f6-4148-a1de-6d03531f2f1c",
    definitionId: "f8ac5006-91bd-4803-93da-f87cf196dd2f", // Serra Angel
    setCode: "2ed",
    rarity: "uncommon",
};

export const swordsToPlowshares2ed: CardPrint = {
    printId: "50fc5b10-6215-48a9-8993-b61681f61186",
    definitionId: "386ea9eb-abc1-4862-aa2d-8fb808d79490", // Swords to Plowshares
    setCode: "2ed",
    rarity: "uncommon",
};

export const veteranBodyguard2ed: CardPrint = {
    printId: "8d693da0-039d-462b-a5cb-d2bb179df65e",
    definitionId: "cbd9ab01-a833-4fa4-8dee-151bd9800835", // Veteran Bodyguard
    setCode: "2ed",
    rarity: "rare",
};

export const wallOfSwords2ed: CardPrint = {
    printId: "0437a9e4-df29-4fbb-8c99-05e5d30a18e3",
    definitionId: "99ec4723-b36c-4015-b361-736a6523e8f5", // Wall of Swords
    setCode: "2ed",
    rarity: "uncommon",
};

export const whiteKnight2ed: CardPrint = {
    printId: "8e4c578c-1c36-4c29-86a5-7a664ffe34d0",
    definitionId: "50abfba8-c9f9-4ebf-965a-4b425fe83129", // White Knight
    setCode: "2ed",
    rarity: "uncommon",
};

export const whiteWard2ed: CardPrint = {
    printId: "77cbc0fa-d5b8-412a-bdca-7f62d8d1ce1e",
    definitionId: "49b22665-1501-420a-82ad-f71f6768bcf8", // White Ward
    setCode: "2ed",
    rarity: "uncommon",
};

export const wrathOfGod2ed: CardPrint = {
    printId: "e57404bc-44ba-4909-87da-f4a71673168d",
    definitionId: "a2788d69-6a3a-42f0-8736-cc6b57755ecd", // Wrath of God
    setCode: "2ed",
    rarity: "rare",
};
