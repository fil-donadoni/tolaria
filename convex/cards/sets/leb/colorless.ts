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
import { makeDualLand } from "../../abilities";

export const ankhOfMishraLeb: CardPrint = {
    printId: "a0367e54-eb07-475a-b06b-f869a046a86c",
    definitionId: "f594b7aa-d44e-47c4-989b-565f881e25f1", // ankhOfMishra (stub)
    setCode: "leb",
    rarity: "rare",
};

export const badlandsLeb: CardPrint = {
    printId: "a3393436-3426-4903-8f41-7abcbf6c18c2",
    definitionId: "717f6d10-9144-4ade-9ac6-a481cc66b875", // badlands
    setCode: "leb",
    rarity: "rare",
};

export const basaltMonolithLeb: CardPrint = {
    printId: "81d73362-43c1-4dd0-87dd-9aa7ae13ff2f",
    definitionId: "66a74c89-6f86-4ec8-af17-391cd5026054", // basaltMonolith (stub)
    setCode: "leb",
    rarity: "uncommon",
};

export const bayouLeb: CardPrint = {
    printId: "17db2b6a-eaa8-4a08-9e86-370bbd058574",
    definitionId: "412ceddd-2b9a-4551-a6bf-ae2830a2010a", // bayou
    setCode: "leb",
    rarity: "rare",
};

export const blackLotusLeb: CardPrint = {
    printId: "b3a69a1c-c80f-4413-a6fd-ae54cabbce28",
    definitionId: "b0faa7f2-b547-42c4-a810-839da50dadfe", // blackLotus
    setCode: "leb",
    rarity: "rare",
};

export const blackViseLeb: CardPrint = {
    printId: "d234f3d7-2f15-4fbf-92db-16c3433d644b",
    definitionId: "76ac72f8-5b1e-4d67-a796-ef69cde27424", // blackVise (stub)
    setCode: "leb",
    rarity: "uncommon",
};

export const celestialPrismLeb: CardPrint = {
    printId: "243c5460-8d4c-47a7-8a9c-ab626daa520a",
    definitionId: "a47417cb-1ea7-4f65-ba06-e27a99373114", // celestialPrism (stub)
    setCode: "leb",
    rarity: "uncommon",
};

// Out of scope — see ADR 0010 (physical-dexterity card, irrealizable).
// export const chaosOrbLeb: CardPrint = {
//     printId: "6bec436c-2869-432a-b3cf-633a58af6d4c",
//     definitionId: "92274971-7c4a-4326-b0fe-75e2d124f718", // chaosOrb (stub)
//     setCode: "leb",
// };

export const clockworkBeastLeb: CardPrint = {
    printId: "6c6efe95-ae57-4ff1-8f8a-0d6f3bd36d9c",
    definitionId: "27f916a2-0ace-44b5-99dc-72979af34db9", // clockworkBeast (stub)
    setCode: "leb",
    rarity: "rare",
};

export const conservatorLeb: CardPrint = {
    printId: "d4f54af3-7c85-43da-b0ce-df4a44af4736",
    definitionId: "c7824e2a-4eff-4f72-9216-0db30a4f4252", // conservator (stub)
    setCode: "leb",
    rarity: "uncommon",
};

export const copperTabletLeb: CardPrint = {
    printId: "93842064-a0a8-4e4d-9c8a-e8a86448d225",
    definitionId: "30935e4a-013e-4c46-ad05-304df8e5dfa4", // copperTablet (stub)
    setCode: "leb",
    rarity: "uncommon",
};

export const crystalRodLeb: CardPrint = {
    printId: "e44d892f-a975-4062-8a54-5777d2600504",
    definitionId: "76693233-7961-4b7e-80f2-ed90e494c4aa", // crystalRod (stub)
    setCode: "leb",
    rarity: "uncommon",
};

export const cyclopeanTombLeb: CardPrint = {
    printId: "00775f44-fbe6-41ee-9977-d13d1fb5b6fb",
    definitionId: "894c5cf2-8ae2-427a-bcbc-67df0bdfee9d", // cyclopeanTomb (stub)
    setCode: "leb",
    rarity: "rare",
};

export const dingusEggLeb: CardPrint = {
    printId: "fe8ecaee-0de3-45ee-8428-09dc400d63d8",
    definitionId: "65eb6cda-e512-40a8-9c1f-335b713409ff", // dingusEgg (stub)
    setCode: "leb",
    rarity: "rare",
};

export const disruptingScepterLeb: CardPrint = {
    printId: "ae91e07c-ad6d-41d9-bd65-184f92761334",
    definitionId: "ca571ee8-07a2-43b8-9acf-89cbfd3cf7c9", // disruptingScepter (stub)
    setCode: "leb",
    rarity: "rare",
};

export const forcefieldLeb: CardPrint = {
    printId: "34855fa8-959d-45a2-ad91-8b17019755be",
    definitionId: "3f2004c1-8efe-407f-bf48-27b807422eea", // forcefield (stub)
    setCode: "leb",
    rarity: "rare",
};

export const forestLeb300: CardPrint = {
    printId: "b5a922eb-49c7-45f0-92bc-671d7a8758f4",
    definitionId: "6f1c8cb0-38eb-408b-94e8-16db83999b3b", // forest
    setCode: "leb",
    rarity: "common",
};

export const forestLeb301: CardPrint = {
    printId: "89ad91fc-50c2-44e0-b88e-2c13610377f9",
    definitionId: "6f1c8cb0-38eb-408b-94e8-16db83999b3b", // forest
    setCode: "leb",
    rarity: "common",
};

export const forestLeb302: CardPrint = {
    printId: "b4075bbc-dbad-4a1e-a992-70aed713a459",
    definitionId: "6f1c8cb0-38eb-408b-94e8-16db83999b3b", // forest
    setCode: "leb",
    rarity: "common",
};

export const gauntletOfMightLeb: CardPrint = {
    printId: "63c0e240-07b0-45fb-90af-f4fce18c604e",
    definitionId: "da248001-ed75-4b68-9532-37d3cd5afc4c", // gauntletOfMight (stub)
    setCode: "leb",
    rarity: "rare",
};

export const glassesOfUrzaLeb: CardPrint = {
    printId: "eb6953fd-ee48-49dc-9c9c-bfb9a9dc06d0",
    definitionId: "cafc2350-5d64-4379-9198-79a114654d45", // glassesOfUrza (stub)
    setCode: "leb",
    rarity: "uncommon",
};

export const helmOfChatzukLeb: CardPrint = {
    printId: "559d3329-9053-4301-b867-1b49c248fe31",
    definitionId: "3792c6ef-c4e6-4923-9a51-7d28fbc5c393", // helmOfChatzuk (stub)
    setCode: "leb",
    rarity: "rare",
};

export const howlingMineLeb: CardPrint = {
    printId: "37634ffe-788f-4262-88e8-5ab7c7ca74d6",
    definitionId: "51f8f6e1-a451-4262-90d3-5107caf54175", // howlingMine
    setCode: "leb",
    rarity: "rare",
};

export const icyManipulatorLeb: CardPrint = {
    printId: "d27608e7-6539-4813-95b6-d8847cdc6a12",
    definitionId: "29dc1596-a2e7-4d60-9f99-89babaef8a06", // icyManipulator
    setCode: "leb",
    rarity: "uncommon",
};

export const illusionaryMaskLeb: CardPrint = {
    printId: "61ea96b1-4428-4951-88d4-f79338955981",
    definitionId: "62ef2f37-b8ad-47ad-89ca-d6abcb7ff21b", // illusionaryMask (stub)
    setCode: "leb",
    rarity: "rare",
};

export const ironStarLeb: CardPrint = {
    printId: "b08fff47-c3c8-40a9-b3d3-296954aa4ed4",
    definitionId: "5786de12-cade-43c2-a6b0-0c5b294b9d0e", // ironStar (stub)
    setCode: "leb",
    rarity: "uncommon",
};

export const islandLeb291: CardPrint = {
    printId: "bff33e91-8e52-43f2-b8ae-603b456b08fc",
    definitionId: "90a57c0e-fa61-45ef-955d-d296403967d5", // island
    setCode: "leb",
    rarity: "common",
};

export const islandLeb292: CardPrint = {
    printId: "d0c5cf64-9844-4b5b-8e6b-b97c50cce053",
    definitionId: "90a57c0e-fa61-45ef-955d-d296403967d5", // island
    setCode: "leb",
    rarity: "common",
};

export const islandLeb293: CardPrint = {
    printId: "c0a612c4-b4ac-4dd2-a06e-92516599fafd",
    definitionId: "90a57c0e-fa61-45ef-955d-d296403967d5", // island
    setCode: "leb",
    rarity: "common",
};

export const ivoryCupLeb: CardPrint = {
    printId: "32516ab8-43be-4207-a7d5-4916933ce155",
    definitionId: "9964d8d8-dc97-4e5f-9f52-173f7e2c37fd", // ivoryCup (stub)
    setCode: "leb",
    rarity: "uncommon",
};

export const jadeMonolithLeb: CardPrint = {
    printId: "eeea32ba-dfe4-4a9b-b403-43c2abc80b78",
    definitionId: "4a77e0f1-449d-4a7d-9fa0-ba7598f7a73a", // jadeMonolith (stub)
    setCode: "leb",
    rarity: "rare",
};

export const jadeStatueLeb: CardPrint = {
    printId: "985164ba-0c30-42b1-a8b6-3be19251359c",
    definitionId: "8d82d94b-ceef-4533-a4f2-b6442a61b839", // jadeStatue
    setCode: "leb",
    rarity: "uncommon",
};

export const jayemdaeTomeLeb: CardPrint = {
    printId: "e48b1c51-c0fd-4c08-8631-80f507b04d28",
    definitionId: "cac8c421-5b92-481d-b2de-560c0231ab58", // jayemdaeTome
    setCode: "leb",
    rarity: "rare",
};

export const juggernautLeb: CardPrint = {
    printId: "870eb49c-f62d-4986-b492-601feb68a307",
    definitionId: "dcd6a291-5282-4f49-8203-d9b416083c48", // juggernaut
    setCode: "leb",
    rarity: "uncommon",
};

export const kormusBellLeb: CardPrint = {
    printId: "0cd2a4f9-8f80-4ee3-8068-73e686d6eeb9",
    definitionId: "3f4ef7a1-148d-44ac-89ed-0ef379cca0c6", // kormusBell (stub)
    setCode: "leb",
    rarity: "rare",
};

export const libraryOfLengLeb: CardPrint = {
    printId: "0254bff2-a3a7-434e-980a-2d30355793fc",
    definitionId: "2340edcb-8cd5-4ccd-99e2-b9a29f72c495", // libraryOfLeng (stub)
    setCode: "leb",
    rarity: "uncommon",
};

export const livingWallLeb: CardPrint = {
    printId: "0c2cd1c8-8734-4534-ae92-def4d94ef5bc",
    definitionId: "4a98ada6-923a-44a5-bdef-ea6a160b481e", // livingWall (stub)
    setCode: "leb",
    rarity: "uncommon",
};

export const manaVaultLeb: CardPrint = {
    printId: "a11f55e8-7f86-4ca9-b737-9a920d9cf282",
    definitionId: "19499cb7-eccb-4e69-af32-6002d447a160", // manaVault (stub)
    setCode: "leb",
    rarity: "rare",
};

export const meekstoneLeb: CardPrint = {
    printId: "74b22007-9def-4c0f-921c-555483cc3deb",
    definitionId: "13a68a17-22ee-47c9-870a-83e911862b94", // meekstone (stub)
    setCode: "leb",
    rarity: "rare",
};

export const mountainLeb297: CardPrint = {
    printId: "7af9c715-8d72-4eae-b412-fc89138ff588",
    definitionId: "eace2c85-976c-425e-9800-5a6ccbd91b56", // mountain
    setCode: "leb",
    rarity: "common",
};

export const mountainLeb298: CardPrint = {
    printId: "7cb88a03-7092-4d31-a9f1-4f16e39bc537",
    definitionId: "eace2c85-976c-425e-9800-5a6ccbd91b56", // mountain
    setCode: "leb",
    rarity: "common",
};

export const mountainLeb299: CardPrint = {
    printId: "af9ad645-e605-4048-bf4c-d636584f315b",
    definitionId: "eace2c85-976c-425e-9800-5a6ccbd91b56", // mountain
    setCode: "leb",
    rarity: "common",
};

export const moxEmeraldLeb: CardPrint = {
    printId: "ea5d9476-76be-48e7-b6a0-49ced25cb092",
    definitionId: "b0e1427c-05cd-465b-be59-97ed6e39f7ba", // moxEmerald
    setCode: "leb",
    rarity: "rare",
};

export const moxJetLeb: CardPrint = {
    printId: "133204e4-fef8-4851-aa50-c96ffa35b802",
    definitionId: "92bcd1ce-19b1-4d78-8b09-95242ca08d76", // moxJet
    setCode: "leb",
    rarity: "rare",
};

export const moxPearlLeb: CardPrint = {
    printId: "4da892c5-071f-416f-9e42-c4bff102eb88",
    definitionId: "8ebe4be7-e12a-4596-a899-fbd5b152e879", // moxPearl
    setCode: "leb",
    rarity: "rare",
};

export const moxRubyLeb: CardPrint = {
    printId: "fdac742b-16db-4e03-be8f-c600dbd522d5",
    definitionId: "8945585f-4773-493d-a0fe-d707db910b38", // moxRuby
    setCode: "leb",
    rarity: "rare",
};

export const moxSapphireLeb: CardPrint = {
    printId: "1eb3178b-dac5-4b34-9d3e-4f5a170d1c87",
    definitionId: "82da0972-b17b-4600-9efd-e9430a0db04b", // moxSapphire
    setCode: "leb",
    rarity: "rare",
};

export const nevinyrralsDiskLeb: CardPrint = {
    printId: "dbb21f21-668a-4d57-8d05-8db11fb82d99",
    definitionId: "12926dc8-8e6f-4a47-a12b-4d674189615a", // nevinyrralsDisk
    setCode: "leb",
    rarity: "rare",
};

export const obsianusGolemLeb: CardPrint = {
    printId: "e9ed6669-e340-46d5-906b-e24e76464e75",
    definitionId: "4c8e9f5c-deba-4443-bf9d-fb2be75c5418", // obsianusGolem
    setCode: "leb",
    rarity: "uncommon",
};

export const plainsLeb288: CardPrint = {
    printId: "b7331b03-be66-419c-94bc-ed494c042ea3",
    definitionId: "b1623d57-4729-4796-b3f7-f1837a05c6ed", // plains
    setCode: "leb",
    rarity: "common",
};

export const plainsLeb289: CardPrint = {
    printId: "52ff493a-6336-416e-af5e-1eb6d10c080e",
    definitionId: "b1623d57-4729-4796-b3f7-f1837a05c6ed", // plains
    setCode: "leb",
    rarity: "common",
};

export const plainsLeb290: CardPrint = {
    printId: "38e2b0ff-8fdf-4db0-85c0-c1010bacd36b",
    definitionId: "b1623d57-4729-4796-b3f7-f1837a05c6ed", // plains
    setCode: "leb",
    rarity: "common",
};

export const plateauLeb: CardPrint = {
    printId: "fad0bbc4-f760-47a2-aab6-0dbb66ee3a95",
    definitionId: "6eafa00b-c628-40f6-86eb-88e1361fc7a0", // plateau
    setCode: "leb",
    rarity: "rare",
};

export const rodOfRuinLeb: CardPrint = {
    printId: "45810c0a-0a35-4bd4-ba66-5a45f8973fa4",
    definitionId: "af957200-c538-4f52-b105-6db7a7abb4dc", // rodOfRuin (stub)
    setCode: "leb",
    rarity: "uncommon",
};

export const savannahLeb: CardPrint = {
    printId: "0e9aeaa8-9a75-4719-992f-cbb316f72175",
    definitionId: "94f7e24c-2546-41b6-81ad-5e920b07e64e", // savannah
    setCode: "leb",
    rarity: "rare",
};

export const scrublandLeb: CardPrint = {
    printId: "8cf99186-3167-4092-8efb-e7448609ceba",
    definitionId: "bebe39d4-21fb-46a4-a1ec-b97102e46c15", // scrubland
    setCode: "leb",
    rarity: "rare",
};

export const solRingLeb: CardPrint = {
    printId: "c0fb91ec-20a8-4c13-9469-18885b1ecca3",
    definitionId: "c4300d24-1cae-4dd5-be7e-38cc677cf5bd", // solRing
    setCode: "leb",
    rarity: "uncommon",
};

export const soulNetLeb: CardPrint = {
    printId: "08ba41ec-4fff-4192-80ff-2afcd706ea59",
    definitionId: "2b814198-814b-4619-a158-327af675f8f2", // soulNet (stub)
    setCode: "leb",
    rarity: "uncommon",
};

export const sunglassesOfUrzaLeb: CardPrint = {
    printId: "49fcf47d-0f1d-469e-a8c4-d5c97be7a1ef",
    definitionId: "c0d433a4-76c0-4f27-836d-4c0c13a511fb", // sunglassesOfUrza (stub)
    setCode: "leb",
    rarity: "rare",
};

export const swampLeb294: CardPrint = {
    printId: "d1309a80-a761-4b80-8cf1-1a8b83190511",
    definitionId: "6176936d-72e2-4205-8871-4c5a4f1cb2d8", // swamp
    setCode: "leb",
    rarity: "common",
};

export const swampLeb295: CardPrint = {
    printId: "25ad2444-9985-423c-ad36-387218866409",
    definitionId: "6176936d-72e2-4205-8871-4c5a4f1cb2d8", // swamp
    setCode: "leb",
    rarity: "common",
};

export const swampLeb296: CardPrint = {
    printId: "a3544148-49b2-4320-8e3a-5bab81e0f7fd",
    definitionId: "6176936d-72e2-4205-8871-4c5a4f1cb2d8", // swamp
    setCode: "leb",
    rarity: "common",
};

export const taigaLeb: CardPrint = {
    printId: "30ce1bf0-7561-418f-a217-3ce10f28be82",
    definitionId: "60df6592-0b3b-4b87-aeb2-8fa94b4fb7be", // taiga
    setCode: "leb",
    rarity: "rare",
};

export const theHiveLeb: CardPrint = {
    printId: "84b83106-a10d-469a-99eb-56110ef34ba1",
    definitionId: "544a7138-eae8-4ff9-9e17-680bfa717183", // theHive (stub)
    setCode: "leb",
    rarity: "rare",
};

export const throneOfBoneLeb: CardPrint = {
    printId: "655b6265-3030-4c68-af5b-b9e636b1a778",
    definitionId: "a2931ae0-7836-4000-b9ec-f2029ebf5d96", // throneOfBone (stub)
    setCode: "leb",
    rarity: "uncommon",
};

export const timeVaultLeb: CardPrint = {
    printId: "1164f22f-2706-4f35-9f58-d0eb8c344396",
    definitionId: "902441dc-c976-4c92-b897-6376eaa0fe38",
    setCode: "leb",
    rarity: "rare",
};

export const tropicalIslandLeb: CardPrint = {
    printId: "ac19c5a1-ca13-4443-920b-83b567167ed4",
    definitionId: "a9c6c759-aabf-44e7-ba8c-33c5df232b56", // tropicalIsland
    setCode: "leb",
    rarity: "rare",
};

export const tundraLeb: CardPrint = {
    printId: "1b93ce48-219c-49ea-9ad0-b7357bea4606",
    definitionId: "a03e8c5b-f4ed-4fd7-ba05-db813ccc05eb", // tundra
    setCode: "leb",
    rarity: "rare",
};

export const undergroundSeaLeb: CardPrint = {
    printId: "5e91ce41-053e-4203-8860-49cbf854cc18",
    definitionId: "ff76ac86-8a8a-47fe-9388-8950ca3e26c3", // undergroundSea
    setCode: "leb",
    rarity: "rare",
};

// Volcanic Island — Beta-original (no Alpha printing). The tenth ABUR dual;
// taps for {U} or {R} (CR 305.6). Same factory as the LEA duals. Single
// printing, so the def id is its own LEB Scryfall id.
export const volcanicIsland: CardDefinition = makeDualLand({
    id: "0324641d-af55-4c53-b4dc-c8262e967da5",
    rarity: "rare", // matches the LEA ABUR dual cycle
    name: "Volcanic Island",
    oracleText: "({T}: Add {U} or {R}.)",
    colors: ["U", "R"],
});

export const winterOrbLeb: CardPrint = {
    printId: "847de6a4-a268-492e-a4d2-5b12237bc130",
    definitionId: "9359f60c-9a27-4e53-b35b-964a121a6fba", // winterOrb
    setCode: "leb",
    rarity: "rare",
};

export const woodenSphereLeb: CardPrint = {
    printId: "02eee156-54bd-46fc-8804-a73aab87f0ba",
    definitionId: "bcae01a2-171b-47cd-87be-f1e4e5314326", // woodenSphere (stub)
    setCode: "leb",
    rarity: "uncommon",
};
