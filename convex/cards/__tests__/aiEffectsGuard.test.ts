// aiEffects shadow-script guard (PRD #1423, issue #1431). Root-cause fix for
// the "AI-blind resolve() card" class: a `resolve()`/`resolveSteps` card with
// no `effects[]` script gives the bot's card-quality signal (`cardValueById`
// → `latentValue`, `convex/gre/cardValue.ts`) nothing to walk, so it silently
// falls back to the blind `base + MV` floor — a burn/removal spell scores the
// same as a do-nothing spell of equal mana value.
//
// The MECHANISM this ticket ships: `CardDefinition.aiEffects` (an
// `EffectOp[]` shadow script, NEVER executed, walked by the SAME
// `OP_VALUERS` a real `effects[]` script uses — `convex/gre/ai/opValuers.ts`
// via `dslSpellScriptValue`, `convex/gre/ai/cardScriptValue.ts`) or the
// scalar `aiValue` override plug the gap per card.
//
// This guard is the "stop the population from GROWING" half (the BACKFILL of
// the current residue is issue #1436, a separate ticket): every card in the
// live catalogue whose top-level spell resolution is a bare `resolve()` /
// `resolveSteps` closure with no `effects[]` MUST carry `aiEffects`,
// `aiValue`, or be a narrow, well-formed entry in `AI_EFFECTS_ALLOWLIST`
// below. Ships with EVERY current offender pre-allowlisted (so CI is green
// day 1) — the guard's value is that a NEW resolve() card landing after this
// ticket has NO allowlist entry to hide behind and must comply immediately.
// As the resolve()→effects[] migration (or a future #1436 backfill pass)
// drains a card onto a real `effects[]` script or an `aiEffects`/`aiValue`
// annotation, it stops matching the offender predicate and its allowlist
// entry goes stale — caught by the well-formedness test below, mirroring the
// KEYWORD_ALLOWLIST (`mechanicsRegistry.test.ts`, issue #962) and
// DRAW_PRIMITIVE_ALLOWLIST (`drawPrimitiveGuard.test.ts`, issue #1264)
// precedents: an emptying-out list, never a standing escape hatch.
//
// SCOPE — deliberately narrow, matching the issue's literal "resolve()/
// resolveSteps CARD" wording:
//   • Only the CARD-LEVEL (`CardDefinition.resolve`/`resolveSteps`) spell
//     resolution site. Ability-level (`ActivatedAbility`/`TriggeredAbility`)
//     `resolve()` bodies also gained an `aiEffects` field (types.ts) for the
//     same mechanism, but are NOT covered by this guard — folding
//     ability-level coverage in is a much larger surface than "mechanism
//     only" calls for; left to a follow-up.
//   • Modal cards (`modes[]`) are excluded: the card-level `resolve` is
//     bypassed for those (each mode supplies its own resolution), so a
//     card-level "no effects[]" reading would be meaningless.
//   • The declarative `effect` (`EffectShorthand`) site is excluded: it is a
//     THIRD, distinct alternative to `resolve`/`resolveSteps`/`effects` (not
//     itself an opaque imperative closure), out of scope for this ticket.

import { describe, it, expect } from "vitest";
import { getAllCards } from "../index";
import type { CardDefinition } from "../types";

/** True when `card`'s top-level spell resolution is a bare `resolve()` /
 *  `resolveSteps` closure with no real Effect Script the value model can
 *  walk (issue #1431 SCOPE — see header comment for the modal/`effect`
 *  shorthand exclusions). */
function isResolveOnlySpell(card: CardDefinition): boolean {
    if (card.modes && card.modes.length > 0) return false;
    if (card.effects && card.effects.length > 0) return false;
    return (
        !!card.resolve ||
        !!(card.resolveSteps && card.resolveSteps.length > 0)
    );
}

/** True when `card` already plugs the AI-blind gap: an `aiEffects` shadow
 *  script, or the coarser `aiValue` scalar override. */
function hasShadowScript(card: CardDefinition): boolean {
    return (
        (!!card.aiEffects && card.aiEffects.length > 0) ||
        card.aiValue !== undefined
    );
}

interface AllowlistEntry {
    /** The card's registry id (`CardDefinition.id`). */
    readonly cardId: string;
    /** The card's name — a stale-name assertion below catches an id that has
     *  drifted onto a different card (a rebuilt/renumbered catalogue). */
    readonly name: string;
    /** The `// no honest shadow script: <why>` disposition (ADR-style, per
     *  the acceptance criteria). Every current entry shares the same
     *  disposition: it predates this guard and its backfill is tracked by
     *  issue #1436 — a future hand-authored entry should give a card-specific
     *  reason instead. */
    readonly note: string;
}

// Every resolve()-only card in the catalogue AT THE TIME this guard landed
// (issue #1431). Generated from a one-off catalogue scan — see the PR
// description for the exact predicate used. Do NOT hand-append to this list
// for a NEW card: a new resolve() card must ship with a real `aiEffects`
// sketch or an `aiValue` override instead (that's the whole point of this
// guard). This list only shrinks, as the #1436 backfill (or the ongoing
// resolve()→effects[] migration) lands.
const AI_EFFECTS_ALLOWLIST: readonly AllowlistEntry[] = [
    {
        cardId: "75d5b014-8675-4d91-a539-ac5c31d44b35",
        name: "Altar of Bone",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "e07df65c-ebcc-4873-b928-d99040d1f2f6",
        name: "Amnesia",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "6f9ea46a-411f-40ce-a873-a905180093f4",
        name: "Balance",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "a85ae675-56ca-4a00-83d2-ee035f33d6d1",
        name: "Battle Frenzy",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "e173c8ce-2352-405e-ad00-e3bb94ced1ad",
        name: "Berserk",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "98fba951-c5bb-497c-9292-ce1b2a1e1247",
        name: "Blaze of Glory",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "fbbf1a9c-8b94-4ee7-92db-65b531149990",
        name: "Blood Lust",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "480bb7e3-df03-454d-ada0-592ef8a4a6f0",
        name: "Breath of Darigaaz",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "1dae52a2-3af7-4b97-9d2e-2448b7c413fb",
        name: "Burnt Offering",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "3838c2a3-7fab-4976-9c1b-2891aee24e52",
        name: "Camouflage",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "b5883762-ca0a-4932-8d2a-41a45796a5f8",
        name: "Chain Lightning",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "30f6b4a2-5780-46e9-b239-459d2cf37743",
        name: "Chain of Vapor",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "c1862c47-71cc-45a3-8805-a5ddc62e55ea",
        name: "Channel",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "46740353-e2ba-4d80-a97d-1368bc67bf30",
        name: "Clairvoyance",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "f00d33dd-4eb2-4446-9813-1923d8e2d2f3",
        name: "Clone",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "fd5ed955-1193-4e6a-a3e2-f54c1f9bf063",
        name: "Copy Artifact",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "26c68473-70ca-40ba-b5c6-71ec30f88a2c",
        name: "Damnation",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "1005a00a-6a0e-44cb-abea-37e2e53125e2",
        name: "Deflection",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "8d727b9b-6114-414d-9172-16b6e1db41cc",
        name: "Demonic Consultation",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "ffd7eb90-ae95-49df-898a-9510187bce1c",
        name: "Detonate",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "1ea01324-1cfb-498c-8299-f690373864bd",
        name: "Diabolic Vision",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "8712c49e-f171-4669-bed9-87575a37af11",
        name: "Disintegrate",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "4be2aa3b-207b-4d21-abfb-6788520c7676",
        name: "Drafna's Restoration",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "ea3830c5-cc66-453e-9e53-0636e00ee0ee",
        name: "Drain Power",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "8c1c6932-638a-4df7-bf9b-8d921f7484d9",
        name: "Dwarven Catapult",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "e68ac362-6cdc-48a6-bdd3-4f8ea32add64",
        name: "Earthquake",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "37e69940-bdc8-48ff-a296-540343910adf",
        name: "Energy Tap",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "32e670da-7563-4f6a-a7db-4c126a440eb8",
        name: "Erode",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "fe07e496-5070-4116-a91a-a3bbe19c12af",
        name: "Essence Vortex",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "d646feea-3c20-4737-8d20-ffad42258ced",
        name: "Eternal Flame",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "31b770cc-09e7-4c0b-b2a4-462ab4f7200d",
        name: "Expressive Iteration",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "2933ca2a-097b-44f4-ae56-ad524d26fd06",
        name: "Eye for an Eye",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "7eb71ac4-796d-4011-9002-1129bc09c284",
        name: "False Orders",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "b5e81649-9954-424c-89d1-f87d73b66047",
        name: "Fatal Push",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "b7623c00-144b-4a8f-9c6c-f5e9e4f65ece",
        name: "Fireball",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "aa2d778d-d74b-45ec-a86b-5d52ffad6ba5",
        name: "Fissure",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "fb01dd39-a957-4c1a-86cf-f31a699a154a",
        name: "Forgotten Lore",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "e6b43916-fe2d-417a-a550-d7c795023297",
        name: "Fork",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "32aa6e33-221f-414c-9b51-850d97a7e051",
        name: "Galvanic Discharge",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "08265332-2c0e-4c42-8c51-83ac20462eed",
        name: "Game of Chaos",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "48401643-ec4b-444a-8f9a-1a5ea471ff4a",
        name: "Gaze of Pain",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "995486ce-58bb-4753-a812-0ca73ef1a235",
        name: "Gitaxian Probe",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "ba1384e5-d140-4074-9548-250af09cb413",
        name: "Glyph of Life",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "8837eaba-9602-4f63-9897-85583fcdcf51",
        name: "Goblin Grenade",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "4782fd4f-2474-4d0d-8301-e0b52af93746",
        name: "Gravebind",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "879a8653-1538-4f78-a3d3-a900a4d9499b",
        name: "Great Defender",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "362f1fe9-20af-434c-9957-7a1a564d89e6",
        name: "Hellfire",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "4686bbb9-517f-4cce-aa7a-5db41e22c02b",
        name: "High Tide",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "c3c8a850-bc99-4679-a316-45ecdea696b2",
        name: "Holy Light",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "52f5a19f-16e4-4d35-89e1-969ac8202f88",
        name: "Hurricane",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "14b4dd4d-c617-4603-8a87-761ec6fc6883",
        name: "Icequake",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "5f133f06-6398-4db1-8577-66c16fd3e00d",
        name: "Inquisition",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "96794470-31ea-478f-b11c-dc8342a508e2",
        name: "Liberate",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "72955141-d990-459f-adbe-7d3d0f5f6c95",
        name: "Mana Clash",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "e691adef-3027-4e6a-889f-9f4e2df36a7c",
        name: "Mana Drain",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "73e3e0b3-5284-464f-8c62-0f7801c966f5",
        name: "Mana Short",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "e2c9f463-d1cc-4f11-aad2-d4a4520aa978",
        name: "Martyr's Cry",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "b13a064d-bff4-4a48-a158-1b61951b0ac3",
        name: "Melee",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "0ee810a5-f0f9-4b73-8194-3d1344784050",
        name: "Mind Bomb",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "de150cd6-0bbc-47f7-a781-cd1aa10eabc6",
        name: "Mind Warp",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "348a467a-4661-4fdb-af1d-9171a1a930d9",
        name: "Nameless Race",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "a8917dc8-01c0-4e72-9310-c4d501775411",
        name: "Natural Selection",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "cdabde40-2143-4677-b7b4-ea8fbf9b1f25",
        name: "Obliterate",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "6920c895-bc98-4871-a53f-219fa27a74e5",
        name: "Occult Epiphany",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "29b7a8b1-b98e-483a-87a4-73bd831c03d4",
        name: "Path to Exile",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "d2e27911-87cb-49a0-a34f-6afe4bddd592",
        name: "Phyrexian Metamorph",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "e040be83-3fb5-4da5-ba7a-4923b8854b74",
        name: "Portent",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "1b342dd3-09b9-4108-bf12-a65d4cef4eb9",
        name: "Power Sink",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "a914138c-a593-414c-bbcb-83d3c1bc4f6f",
        name: "Pox",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "ab9d0e3f-cf7c-41f8-bcd7-bb08ea8cc2f8",
        name: "Primal Clay",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "e1e9f80e-5d75-45b7-9c66-c0f30996f4dc",
        name: "Rally",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "e26e7c9c-e6de-47f4-8394-7e853408f84c",
        name: "Rapid Fire",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "638abe5f-2a8a-42ca-bcdf-a52a3df66946",
        name: "Ray of Command",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "33296718-0625-4422-a65c-b21cf99c52ec",
        name: "Recall",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "bf2e3a8a-b386-474d-b8e9-4c2d56a2b742",
        name: "Remove Enchantments",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "943baea8-b173-4863-a3ab-dd217d483cd9",
        name: "Reverse Damage",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "da7ed8ba-3886-4779-a9b3-6892a7ed3527",
        name: "Reverse Polarity",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "d721569d-9cf2-4c3c-b11c-4c46c258a0d2",
        name: "Sacred Boon",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "12164aee-6a27-4246-8d15-2d6dd20d92e9",
        name: "Sacrifice",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "73cba9cd-73d9-442e-bd99-9cba9f398b64",
        name: "Sandstorm",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "7e68f4df-88ce-4e09-a03c-7edf40bff167",
        name: "Sevinne's Reclamation",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "cc278af4-b60d-41b7-b9d7-36c8aefca1a7",
        name: "Shapeshifter",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "35c3a78d-cc79-4187-929a-8aa1d1469990",
        name: "Simulacrum",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "d992b336-3b6e-43e1-8662-d85664349b44",
        name: "Siren's Call",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "18a3cca1-e50e-49b6-9e1a-f86640e3b177",
        name: "Snuff Out",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "6cff3547-8c72-439a-91fe-ebe729dab748",
        name: "Songs of the Damned",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "eb8e00d2-2381-4d45-bed8-c9bf738a9419",
        name: "Soul Burn",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "9f73597d-f453-4d37-b2ef-c54ef683a884",
        name: "Soul Exchange",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "fd368eb6-72f0-42d4-afa5-3daa7de949ff",
        name: "Spoils of Evil",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "b38af8bd-d927-46d0-a1b1-fb437ea9ea66",
        name: "Spoils of War",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "1691a9f4-4ea7-440f-9bdc-4214ab3c90f0",
        name: "Spore Cloud",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "bc8265a1-4621-4d25-8f7f-f0179951a694",
        name: "Stampede",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "4c7065a2-f819-4cbe-b453-a55e904f0461",
        name: "Stench of Evil",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "3b66d0cc-84d7-41ad-b0e7-74ebf604543f",
        name: "Storm Seeker",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "f3d62dbd-63db-4ac9-950f-9852627f23f2",
        name: "Time Spiral",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "6eab6765-eba3-4844-81ca-ae37a6e903df",
        name: "Transmute Artifact",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "3067e7af-7bbd-48c1-9f1d-df2a91a0ec54",
        name: "Vertigo",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "768f3a05-bd06-4a23-b9f2-94f6e618fd9f",
        name: "Vesuvan Doppelganger",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "21d00299-e183-4b3d-b015-18808e7135b9",
        name: "Visions",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "a80582b1-09db-45f8-b362-0e5207a5a8e6",
        name: "Volcanic Eruption",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "a8645e4f-eaa8-4420-a6a3-eb53c311fab1",
        name: "Whiteout",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "186fd917-8d65-4de5-8546-a32a5f6d3bab",
        name: "Winds of Change",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "fb846366-2105-4999-8af1-a11687f42e17",
        name: "Winter Blast",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "a779aca7-ff2c-48d8-9484-6ad04b2c6bcb",
        name: "Winter's Chill",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "96c21429-98d3-416b-be00-6aa9c4c5a006",
        name: "Word of Command",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
    {
        cardId: "22b04476-5a5d-4843-a948-82db209c4218",
        name: "Word of Undoing",
        note: "no honest shadow script: pre-existing resolve() card, backfill tracked by #1436",
    },
];

describe("aiEffects shadow-script guard (issue #1431)", () => {
    it("every resolve()/resolveSteps card with no effects[] carries aiEffects, aiValue, or a well-formed allowlist entry", () => {
        const allowlistIds = new Set(
            AI_EFFECTS_ALLOWLIST.map((e) => e.cardId)
        );
        const offenders: string[] = [];
        for (const card of getAllCards()) {
            if (!isResolveOnlySpell(card)) continue;
            if (hasShadowScript(card)) continue;
            if (allowlistIds.has(card.id)) continue;
            offenders.push(`${card.id} (${card.name})`);
        }
        expect(
            offenders,
            "resolve()/resolveSteps card(s) with no effects[] and no aiEffects/aiValue — " +
                "either sketch an aiEffects shadow script (walked by the same OP_VALUERS a " +
                "real effects[] script uses), set aiValue, or — ONLY for a pre-existing " +
                "backfill straggler, never a NEW card — add a narrow AI_EFFECTS_ALLOWLIST " +
                "entry in this test file with a real disposition (issue #1431)."
        ).toEqual([]);
    });

    it("every AI_EFFECTS_ALLOWLIST entry is well-formed and non-stale", () => {
        const cards = getAllCards();
        for (const entry of AI_EFFECTS_ALLOWLIST) {
            const card = cards.find((c) => c.id === entry.cardId);
            expect(
                card,
                `no card with id ${entry.cardId} (${entry.name}) — stale allowlist entry`
            ).toBeDefined();
            expect(
                card!.name,
                `allowlist entry name "${entry.name}" no longer matches card ${entry.cardId} (now "${card!.name}") — stale allowlist entry`
            ).toBe(entry.name);
            expect(
                entry.note.length,
                `${entry.cardId} (${entry.name}) allowlist entry needs a non-empty disposition note`
            ).toBeGreaterThan(0);
            expect(
                isResolveOnlySpell(card!),
                `${entry.cardId} (${entry.name}) is no longer a resolve()-only card (gained effects[] or a modes[] script) — stale allowlist entry, remove it`
            ).toBe(true);
            expect(
                hasShadowScript(card!),
                `${entry.cardId} (${entry.name}) now carries aiEffects/aiValue — stale allowlist entry, remove it`
            ).toBe(false);
        }
    });

    it("EXACT count: the allowlist covers exactly the current resolve()-only-with-no-shadow-script residue", () => {
        const actual = getAllCards().filter(
            (c) => isResolveOnlySpell(c) && !hasShadowScript(c)
        ).length;
        expect(
            actual,
            "the live count of resolve()-only cards with no aiEffects/aiValue no longer " +
                "matches AI_EFFECTS_ALLOWLIST.length — either a new offender landed (see the " +
                "first test) or an allowlisted card was fixed without removing its entry (see " +
                "the second test)"
        ).toBe(AI_EFFECTS_ALLOWLIST.length);
    });
});
