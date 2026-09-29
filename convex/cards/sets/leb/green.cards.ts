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

export const aspectOfWolfLeb: CardPrint = {
    printId: "36f7dc8e-e02a-4ceb-8767-2875f86e6811",
    definitionId: "fd9ac9e6-1395-4fbd-80e2-645f0d910c29", // aspectOfWolf (stub)
    setCode: "leb",
    rarity: "rare",
};

export const berserkLeb: CardPrint = {
    printId: "88d6f431-a7ea-4508-a52c-86d33e12e4e4",
    definitionId: "e173c8ce-2352-405e-ad00-e3bb94ced1ad", // berserk
    setCode: "leb",
    rarity: "uncommon",
};

export const birdsOfParadiseLeb: CardPrint = {
    printId: "852d7a68-8682-4073-a44b-f10f5613879c",
    definitionId: "55fe6449-1f23-43dc-adee-d144cd505b5c", // birdsOfParadise
    setCode: "leb",
    rarity: "rare",
};

export const channelLeb: CardPrint = {
    printId: "6fa6468a-335a-467d-aef6-e537af9d5c1c",
    definitionId: "c1862c47-71cc-45a3-8805-a5ddc62e55ea", // channel
    setCode: "leb",
    rarity: "uncommon",
};

export const cockatriceLeb: CardPrint = {
    printId: "fc71dd0f-dffe-4671-b9e3-ddec70626688",
    definitionId: "9cd91814-6177-4a3d-a1c1-a3be7d7c7957", // cockatrice (stub)
    setCode: "leb",
    rarity: "rare",
};

export const crawWurmLeb: CardPrint = {
    printId: "17d5c1c7-a882-479a-9077-0784e83b462d",
    definitionId: "bfed1a95-bd67-4e16-a781-81866028af2f", // crawWurm
    setCode: "leb",
    rarity: "common",
};

export const elvishArchersLeb: CardPrint = {
    printId: "c3240d5e-b3d4-4368-b09b-c309bc935152",
    definitionId: "1cb9d405-f2b5-4e10-a405-feafd2a87d90", // elvishArchers
    setCode: "leb",
    rarity: "rare",
};

export const fastbondLeb: CardPrint = {
    printId: "f48ed192-c1a1-437a-80dd-647a616b46e3",
    definitionId: "a575a9af-e1de-4a1d-91d8-440585377e4f", // fastbond (stub)
    setCode: "leb",
    rarity: "rare",
};

export const fogLeb: CardPrint = {
    printId: "f4e9597a-4489-47e9-8b15-888acb402ddd",
    definitionId: "cfba606d-bb55-43ba-aa0c-299649958788", // fog (stub)
    setCode: "leb",
    rarity: "common",
};

export const forceOfNatureLeb: CardPrint = {
    printId: "c25a61b3-c828-491c-868d-e4eff770c1bb",
    definitionId: "21551cb6-3a53-42dd-9bbd-4bc56304d6d3", // forceOfNature (stub)
    setCode: "leb",
    rarity: "rare",
};

export const fungusaurLeb: CardPrint = {
    printId: "75a58f0b-c772-4254-8686-182d26889f9c",
    definitionId: "5ad89f0d-b09b-40a0-84d6-3ee60dec7e23", // fungusaur (stub)
    setCode: "leb",
    rarity: "rare",
};

export const gaeasLiegeLeb: CardPrint = {
    printId: "554362d7-97b3-4a55-9292-15e90435088d",
    definitionId: "e2b15221-c8b0-4861-9f8b-8a65834ad499", // gaeasLiege (stub)
    setCode: "leb",
    rarity: "rare",
};

export const giantGrowthLeb: CardPrint = {
    printId: "755a45bd-8fe6-4e4d-8065-024a2836751b",
    definitionId: "367dbefe-3366-408e-9fcf-7dc00f8cc201", // giantGrowth
    setCode: "leb",
    rarity: "common",
};

export const giantSpiderLeb: CardPrint = {
    printId: "52ea35ce-8aa1-4818-8ad5-7e462452f10e",
    definitionId: "77636b4c-faea-4bf5-b88c-dd5bb88dc930", // giantSpider (stub)
    setCode: "leb",
    rarity: "common",
};

export const grizzlyBearsLeb: CardPrint = {
    printId: "e7aa2b93-0a84-4318-bf2d-58164f0a846f",
    definitionId: "ce2d603a-3231-4a8c-bf39-1617586ea870", // grizzlyBears
    setCode: "leb",
    rarity: "common",
};

export const hurricaneLeb: CardPrint = {
    printId: "b3939f72-1ec6-4b2c-b37e-b1ebb024bb8f",
    definitionId: "52f5a19f-16e4-4d35-89e1-969ac8202f88", // hurricane
    setCode: "leb",
    rarity: "uncommon",
};

export const iceStormLeb: CardPrint = {
    printId: "7c439c5a-b4a5-411b-9e68-fb8438ccdfb0",
    definitionId: "9914836e-2fa6-4390-94b2-431427848a54", // iceStorm (stub)
    setCode: "leb",
    rarity: "uncommon",
};

export const instillEnergyLeb: CardPrint = {
    printId: "58334cf9-5186-4fba-963c-fffb21f2b8de",
    definitionId: "5bd38716-874c-4e3c-a315-837839a6258c", // instillEnergy (stub)
    setCode: "leb",
    rarity: "uncommon",
};

export const ironrootTreefolkLeb: CardPrint = {
    printId: "1d9479ae-2b42-4137-9e62-ef4d7fd17d0c",
    definitionId: "b93c5869-7777-44bb-967a-e9439b25ced4", // ironrootTreefolk
    setCode: "leb",
    rarity: "common",
};

export const kudzuLeb: CardPrint = {
    printId: "ced83afa-9718-4b8a-961b-394f8595c480",
    definitionId: "b2b72dcd-9ea1-4729-baae-ecd262fdff67", // kudzu (stub)
    setCode: "leb",
    rarity: "rare",
};

export const leyDruidLeb: CardPrint = {
    printId: "b58867ec-0b1a-4804-bc2e-1c88d338c29e",
    definitionId: "f9232508-d363-4ef3-987a-741f6bff331f", // leyDruid (stub)
    setCode: "leb",
    rarity: "uncommon",
};

export const lifeforceLeb: CardPrint = {
    printId: "3715abe2-5a8e-4bf4-ac02-6c755d86bb4c",
    definitionId: "e292577e-6232-44fa-a9c2-cc09949c6ed3", // lifeforce (stub)
    setCode: "leb",
    rarity: "uncommon",
};

export const lifelaceLeb: CardPrint = {
    printId: "9379e159-43ac-4bd2-8b33-f3de8e20cfe0",
    definitionId: "38cb601b-a35c-412e-b386-e77dad3daa54", // lifelace (stub)
    setCode: "leb",
    rarity: "rare",
};

export const livingArtifactLeb: CardPrint = {
    printId: "8bbf6678-f597-407d-9a95-02bbe6c4bcf3",
    definitionId: "c9e753a2-a7d0-4d37-ae65-b5a1b5039a6e", // livingArtifact (stub)
    setCode: "leb",
    rarity: "rare",
};

export const livingLandsLeb: CardPrint = {
    printId: "f132acbd-53e5-430a-8f93-8b7469633c0e",
    definitionId: "80be0580-7948-4d8e-8c0f-5e2797ac411b", // livingLands (stub)
    setCode: "leb",
    rarity: "rare",
};

export const llanowarElvesLeb: CardPrint = {
    printId: "abd80204-e9ba-483f-9b75-a69712545ba9",
    definitionId: "d4f1cc9e-4f99-4c26-ac1b-8ef069fa8ceb", // llanowarElves
    setCode: "leb",
    rarity: "common",
};

export const lureLeb: CardPrint = {
    printId: "e31495ab-e6ed-40a6-b82d-aa6092b049e2",
    definitionId: "2a87b26e-0431-42e9-b44f-94ba8546111a", // lure (stub)
    setCode: "leb",
    rarity: "uncommon",
};

export const naturalSelectionLeb: CardPrint = {
    printId: "a594299e-fc3a-4d46-bd58-1a9cf7ddbdd7",
    definitionId: "a8917dc8-01c0-4e72-9310-c4d501775411", // naturalSelection (stub)
    setCode: "leb",
    rarity: "rare",
};

export const regenerationLeb: CardPrint = {
    printId: "42ad2d7f-34a5-4b17-ae11-16b322601d73",
    definitionId: "b7b7aa34-b4f8-41b4-82ce-ab2e204c3bf4", // regeneration
    setCode: "leb",
    rarity: "common",
};

export const regrowthLeb: CardPrint = {
    printId: "898cd314-9060-4f1c-a821-1d61a292a12b",
    definitionId: "badc73ec-3728-4246-90c7-5f4eb7051ed5", // regrowth
    setCode: "leb",
    rarity: "uncommon",
};

export const scrybSpritesLeb: CardPrint = {
    printId: "fafe9639-e9d0-4aa2-8a16-f4ec24c140c0",
    definitionId: "6d929c38-91e6-457c-937a-d1884f4bba44", // scrybSprites
    setCode: "leb",
    rarity: "common",
};

export const shanodinDryadsLeb: CardPrint = {
    printId: "1ac8bdb0-2dfd-4531-a4d9-420f2f2a90be",
    definitionId: "814cf35c-f1ad-4bf4-8c10-a5592c3b1be8", // shanodinDryads
    setCode: "leb",
    rarity: "common",
};

export const streamOfLifeLeb: CardPrint = {
    printId: "da18a2c9-850e-400d-b0b3-edd8a946e380",
    definitionId: "aa1c4d4b-2645-4cd9-823e-3c9bb2eb48f9", // streamOfLife (stub)
    setCode: "leb",
    rarity: "common",
};

export const thicketBasiliskLeb: CardPrint = {
    printId: "6321e16b-0b4b-4d36-ab94-97bf5816acf4",
    definitionId: "e92cce01-b3bd-4307-aae5-9a7c8fa386ab", // thicketBasilisk (stub)
    setCode: "leb",
    rarity: "uncommon",
};

export const timberWolvesLeb: CardPrint = {
    printId: "aa598db8-c0c7-4a9a-bd89-6d3da0d3dfba",
    definitionId: "bc2570a4-eef9-430d-b6c2-cd51d29b9d01", // timberWolves (stub)
    setCode: "leb",
    rarity: "rare",
};

export const tranquilityLeb: CardPrint = {
    printId: "ee21b620-4dfa-4e06-872e-8d8ffce12f76",
    definitionId: "774cc5a6-3a69-4812-add4-eb5eb6389238", // tranquility
    setCode: "leb",
    rarity: "common",
};

export const tsunamiLeb: CardPrint = {
    printId: "1f4b6f5a-1ba2-409d-9b9b-91e2c1470f62",
    definitionId: "9ed67d61-cf47-446b-b454-eb404a8686b7", // tsunami
    setCode: "leb",
    rarity: "uncommon",
};

export const verduranEnchantressLeb: CardPrint = {
    printId: "da3f051c-6be3-4f92-8f66-9f72d75dbcf5",
    definitionId: "9f87178b-1221-4d7a-a7a5-20d7f01b8089", // verduranEnchantress (stub)
    setCode: "leb",
    rarity: "rare",
};

export const wallOfBramblesLeb: CardPrint = {
    printId: "c2fca52b-80b3-4b6b-9a49-110c66557894",
    definitionId: "af2a4558-db6e-41b2-aff6-b164d93282a0", // wallOfBrambles (stub)
    setCode: "leb",
    rarity: "uncommon",
};

export const wallOfIceLeb: CardPrint = {
    printId: "cc05a648-7719-4ed3-aa3b-648463ee2869",
    definitionId: "cc743a03-867c-4bb0-8fb0-2bcaa0a8a756", // wallOfIce
    setCode: "leb",
    rarity: "uncommon",
};

export const wallOfWoodLeb: CardPrint = {
    printId: "1a5054a4-599d-49df-9a80-77eeed47891f",
    definitionId: "8df80424-3bd9-4982-ad79-e55d9ba3b43d", // wallOfWood
    setCode: "leb",
    rarity: "common",
};

export const wanderlustLeb: CardPrint = {
    printId: "393f08a2-7aa8-443f-aab5-4287240e9167",
    definitionId: "220a03ca-8c9b-4acb-821d-f6577fbb20fb", // wanderlust (stub)
    setCode: "leb",
    rarity: "uncommon",
};

export const warMammothLeb: CardPrint = {
    printId: "9f67175d-ac5c-4947-b243-d5206b552bdc",
    definitionId: "c8d6081e-f686-4263-a0a2-21c0d9af5fdb", // warMammoth
    setCode: "leb",
    rarity: "common",
};

export const webLeb: CardPrint = {
    printId: "f7f84dc2-5a29-447d-97ab-a10afd9ee538",
    definitionId: "37c7890a-86dc-4a97-a7ce-1436fa22d0c0", // web (stub)
    setCode: "leb",
    rarity: "rare",
};

export const wildGrowthLeb: CardPrint = {
    printId: "64f299eb-9cd6-40bc-ad44-22e3aeb5c930",
    definitionId: "fd896dfa-66c0-4327-8e5b-489bbe350c95", // wildGrowth (stub)
    setCode: "leb",
    rarity: "common",
};
