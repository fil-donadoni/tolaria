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

export const animateDead2ed: CardPrint = {
    printId: "0fc3ed63-96ee-420c-bde1-e0c904059931",
    definitionId: "8fd7861d-925f-4b4c-a4ab-60be6f43d50b", // Animate Dead
    setCode: "2ed",
    rarity: "uncommon",
};

export const badMoon2ed: CardPrint = {
    printId: "882fe528-1a84-4d34-bd15-330963b684ff",
    definitionId: "43572906-ea74-4411-a549-5dc401591d2a", // Bad Moon
    setCode: "2ed",
    rarity: "rare",
};

export const blackKnight2ed: CardPrint = {
    printId: "36b94d0d-fbe5-4f32-af02-bbe3ab2e234a",
    definitionId: "c1662949-0d69-49a3-8c69-daf10717ed4e", // Black Knight
    setCode: "2ed",
    rarity: "uncommon",
};

export const bogWraith2ed: CardPrint = {
    printId: "94345aab-b9f2-463e-91ab-acd8b99a7ec0",
    definitionId: "6701874e-986e-4b81-9268-90b6171e6187", // Bog Wraith
    setCode: "2ed",
    rarity: "uncommon",
};

export const cursedLand2ed: CardPrint = {
    printId: "69f37a32-dc03-49fd-b28b-d091563d3690",
    definitionId: "cf5f3c61-1e54-4eea-bf82-311cfa988e6a", // Cursed Land
    setCode: "2ed",
    rarity: "uncommon",
};

export const darkRitual2ed: CardPrint = {
    printId: "c4d24ff3-315d-44cd-8c27-d8ad6972e027",
    definitionId: "ebb6664d-23ca-456e-9916-afcd6f26aa7f", // Dark Ritual
    setCode: "2ed",
    rarity: "common",
};

export const deathgrip2ed: CardPrint = {
    printId: "fe9210db-2ab3-42e6-be04-790917092317",
    definitionId: "2371c126-f19a-472a-ba5f-3b1366274ea0", // Deathgrip
    setCode: "2ed",
    rarity: "uncommon",
};

export const deathlace2ed: CardPrint = {
    printId: "c3e02432-b8bd-4091-a520-6895313ff141",
    definitionId: "6ff1cefc-62cb-4525-b0c5-2b09603b4314", // Deathlace
    setCode: "2ed",
    rarity: "rare",
};

export const demonicHordes2ed: CardPrint = {
    printId: "812a0a10-0765-499f-8581-c4d7e0e81299",
    definitionId: "6c9bb8b1-fb79-4b99-ba09-c6e6c860de50", // Demonic Hordes
    setCode: "2ed",
    rarity: "rare",
};

export const demonicTutor2ed: CardPrint = {
    printId: "c8d5d6a5-6807-4a80-9460-7633dc430ee9",
    definitionId: "711d4d54-5520-4de8-9b93-79902ed8e562", // Demonic Tutor
    setCode: "2ed",
    rarity: "uncommon",
};

export const drainLife2ed: CardPrint = {
    printId: "d5f7044e-3b91-42ac-91ec-56e17cd72274",
    definitionId: "5d077a49-73d4-4958-b42a-31b814e110e8", // Drain Life
    setCode: "2ed",
    rarity: "common",
};

export const drudgeSkeletons2ed: CardPrint = {
    printId: "4eb88d79-048b-4f7c-9ca0-4d9066af805e",
    definitionId: "23614289-0d73-4747-a849-5cb67cc97d6a", // Drudge Skeletons
    setCode: "2ed",
    rarity: "common",
};

export const evilPresence2ed: CardPrint = {
    printId: "19d85c34-2057-4572-a881-29dd35c1ee30",
    definitionId: "0551d66e-8cd4-48f0-aa17-15f26be9d85f", // Evil Presence
    setCode: "2ed",
    rarity: "uncommon",
};

export const fear2ed: CardPrint = {
    printId: "e48c7fd2-860e-4266-b8c0-f6d48f52b851",
    definitionId: "0cd927be-e63f-4371-a1d8-7a0489cb187e", // Fear
    setCode: "2ed",
    rarity: "common",
};

export const frozenShade2ed: CardPrint = {
    printId: "485421e0-ee1c-425b-abe0-ec5a7e2c0042",
    definitionId: "d0bd76c8-4cff-4c15-9686-7a299b589814", // Frozen Shade
    setCode: "2ed",
    rarity: "common",
};

export const gloom2ed: CardPrint = {
    printId: "f463412c-ac10-476c-bba1-27724c041d68",
    definitionId: "a8d10bc7-daeb-4c0d-9e4a-8eae8d11699f", // Gloom
    setCode: "2ed",
    rarity: "uncommon",
};

export const howlFromBeyond2ed: CardPrint = {
    printId: "78694fa9-85dc-4671-87e9-a2bccdc9fcce",
    definitionId: "67ec17e1-174b-4d07-a27f-91a333c4b2fb", // Howl from Beyond
    setCode: "2ed",
    rarity: "common",
};

export const hypnoticSpecter2ed: CardPrint = {
    printId: "e12847f4-4ace-4116-bc96-f3e5336eb35f",
    definitionId: "b43b900f-2d9b-442b-9699-058483604ec9", // Hypnotic Specter
    setCode: "2ed",
    rarity: "uncommon",
};

export const lich2ed: CardPrint = {
    printId: "5bded615-62bc-40f6-9a54-7c9d0d551d4c",
    definitionId: "4250caec-0e37-41be-9ec4-8938deb5f0d0", // Lich
    setCode: "2ed",
    rarity: "rare",
};

export const lordOfThePit2ed: CardPrint = {
    printId: "3ac3a8d8-47a7-4e47-a16c-109aeccd8d1f",
    definitionId: "2926777a-4f6e-4965-ba83-22cf7df02602", // Lord of the Pit
    setCode: "2ed",
    rarity: "rare",
};

export const mindTwist2ed: CardPrint = {
    printId: "f3d7381b-9075-4c9b-adf5-a0d1c26fab67",
    definitionId: "eee9e106-a248-49d2-b8c8-6bbcd56ce739", // Mind Twist
    setCode: "2ed",
    rarity: "rare",
};

export const netherShadow2ed: CardPrint = {
    printId: "18e057ae-8e60-478c-b047-605dab356835",
    definitionId: "f13ad58a-6f9b-420a-bac1-40929f5e616a", // Nether Shadow
    setCode: "2ed",
    rarity: "rare",
};

export const nettlingImp2ed: CardPrint = {
    printId: "96706002-176d-41f7-9788-3d0f7962ea03",
    definitionId: "8105973c-a94d-444c-ba20-ab0fa978bee8", // Nettling Imp
    setCode: "2ed",
    rarity: "uncommon",
};

export const nightmare2ed: CardPrint = {
    printId: "747d4c99-0287-4138-af13-6244f33d2e57",
    definitionId: "b8cdd6a7-f772-4ccb-914f-63f52ed54d6b", // Nightmare
    setCode: "2ed",
    rarity: "rare",
};

export const paralyze2ed: CardPrint = {
    printId: "e21b04cd-2d43-4d64-a1c2-46a9f02508d6",
    definitionId: "be33a155-de26-43d1-88f1-c926f1b7cb7c", // Paralyze
    setCode: "2ed",
    rarity: "common",
};

export const pestilence2ed: CardPrint = {
    printId: "2be5a75e-2fef-4205-bdec-5ea0d1dd0733",
    definitionId: "d42a6350-b16b-4e10-a273-e6cbb55dcb7a", // Pestilence
    setCode: "2ed",
    rarity: "common",
};

export const plagueRats2ed: CardPrint = {
    printId: "f2a5bd30-a11f-4218-aca6-3183d82d02b9",
    definitionId: "b3724e40-0622-4aee-9334-6c9fff88bcd5", // Plague Rats
    setCode: "2ed",
    rarity: "common",
};

export const raiseDead2ed: CardPrint = {
    printId: "990dc823-881d-40ea-9731-d3f19c41aadc",
    definitionId: "ce07bede-2219-427c-a61a-56518751de42", // Raise Dead
    setCode: "2ed",
    rarity: "common",
};

export const royalAssassin2ed: CardPrint = {
    printId: "5cceb11b-0f70-4749-8a8c-d698cd01cd6e",
    definitionId: "59590768-fa96-4869-8763-9d5ab6ac22ad", // Royal Assassin
    setCode: "2ed",
    rarity: "rare",
};

export const sacrifice2ed: CardPrint = {
    printId: "288323c1-13f1-481e-940e-5e4ecebb404e",
    definitionId: "12164aee-6a27-4246-8d15-2d6dd20d92e9", // Sacrifice
    setCode: "2ed",
    rarity: "uncommon",
};

export const scatheZombies2ed: CardPrint = {
    printId: "08e060d5-85f2-46a7-9f05-8a8c713ea999",
    definitionId: "e9be6dcf-5e25-4b8c-9cd0-badf3771f81e", // Scathe Zombies
    setCode: "2ed",
    rarity: "common",
};

export const scavengingGhoul2ed: CardPrint = {
    printId: "12459e80-2878-4a76-b45a-478ee3b0f7a4",
    definitionId: "426984e0-88e1-4a2d-9a1c-798b95864df3", // Scavenging Ghoul
    setCode: "2ed",
    rarity: "uncommon",
};

export const sengirVampire2ed: CardPrint = {
    printId: "ffd7ca8e-6437-4b85-81dd-7173200dcec7",
    definitionId: "510840f4-7c0e-4b47-8ebf-23c20cac4bd9", // Sengir Vampire
    setCode: "2ed",
    rarity: "uncommon",
};

export const simulacrum2ed: CardPrint = {
    printId: "a80e1e4c-4b53-41d2-b038-2f9135d8455d",
    definitionId: "35c3a78d-cc79-4187-929a-8aa1d1469990", // Simulacrum
    setCode: "2ed",
    rarity: "uncommon",
};

export const sinkhole2ed: CardPrint = {
    printId: "485cef94-d7aa-4bb3-b2e6-61d0ccf8007e",
    definitionId: "04b31611-9053-4eaf-b392-21bb644fef5f", // Sinkhole
    setCode: "2ed",
    rarity: "common",
};

export const terror2ed: CardPrint = {
    printId: "df3c25cc-5705-4deb-be61-07a8a2716c86",
    definitionId: "21004958-2c7e-4a55-bc80-411c4d780106", // Terror
    setCode: "2ed",
    rarity: "common",
};

export const unholyStrength2ed: CardPrint = {
    printId: "7150245a-4fed-47cd-b13f-24507e89449d",
    definitionId: "90563f90-0127-4164-b43b-f0321dc63a1d", // Unholy Strength
    setCode: "2ed",
    rarity: "common",
};

export const wallOfBone2ed: CardPrint = {
    printId: "ed63a624-dc31-4461-9cda-589a84dc5a40",
    definitionId: "ae20d442-a544-4a03-9ebf-5ecb137c67dd", // Wall of Bone
    setCode: "2ed",
    rarity: "uncommon",
};

export const warpArtifact2ed: CardPrint = {
    printId: "d1320d4a-ecfc-4cd5-bc6b-445f63c17b27",
    definitionId: "9e5e07a2-fbdf-4c4c-996a-fce40bab5de5", // Warp Artifact
    setCode: "2ed",
    rarity: "rare",
};

export const weakness2ed: CardPrint = {
    printId: "b1646d85-2396-445c-9bbb-65bf65b0a63c",
    definitionId: "36ca06a1-9b9a-49a2-9c47-9b72228621bc", // Weakness
    setCode: "2ed",
    rarity: "common",
};

export const willOTheWisp2ed: CardPrint = {
    printId: "73a2a070-464e-4749-87f1-2df5c8b2a93b",
    definitionId: "a1a6f8e9-7bc1-4151-b55f-acf877b1a7a6", // Will-o'-the-Wisp
    setCode: "2ed",
    rarity: "rare",
};

export const wordOfCommand2ed: CardPrint = {
    printId: "239c8547-207b-41d1-a2be-8825bfc6ef7f",
    definitionId: "96c21429-98d3-416b-be00-6aa9c4c5a006", // Word of Command
    setCode: "2ed",
    rarity: "rare",
};

export const zombieMaster2ed: CardPrint = {
    printId: "d9b2accc-11e8-4bfd-97fc-d2f6bcd94c26",
    definitionId: "3d4255a0-d445-4c00-b936-bbf07851e1c8", // Zombie Master
    setCode: "2ed",
    rarity: "rare",
};
