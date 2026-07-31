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
// SCOPE — originally narrow, matching issue #1431's literal "resolve()/
// resolveSteps CARD" wording; issue #1519 folds in the two sites #1431
// explicitly deferred:
//   • The CARD-LEVEL (`CardDefinition.resolve`/`resolveSteps`) spell
//     resolution site (issue #1431, `AI_EFFECTS_ALLOWLIST` below).
//   • The declarative `effect` (`EffectShorthand`) card-level site (issue
//     #1519, `EFFECT_SHORTHAND_ALLOWLIST` below) — a card whose entire
//     resolution is a registered shorthand primitive (compiled into a
//     resolve closure at lookup time) is exactly as AI-blind as a bare
//     `resolve()` card: `dslSpellScriptValue`'s `effectiveScript` only reads
//     `effects`/`aiEffects`, never the shorthand.
//   • Ability-level (`ActivatedAbility`/`TriggeredAbility`) `resolve()` /
//     `resolveSteps` bodies with no `effects[]` (issue #1519,
//     `ABILITY_AI_EFFECTS_ALLOWLIST` below), walked per-ability (an
//     offending ability is cleared by its OWN `aiEffects` shadow script, or
//     by the owning CARD's `aiValue` — a card-level `aiValue` override wins
//     outright over the WHOLE card's computed worth, ability scripts
//     included, per `gre/cardValue.ts` `latentValue`, so it also plugs
//     every ability gap on that card).
//   • Modal cards (`modes[]`) remain excluded from the CARD-LEVEL checks
//     above: the card-level `resolve`/`effect` is bypassed for those (each
//     mode supplies its own resolution), so a card-level "no effects[]"
//     reading would be meaningless. A modal card's OWN `activatedAbilities`/
//     `triggeredAbilities` (independent of its modes) are still walked by
//     the ability-level check.

import { describe, it, expect } from "vitest";
import { getAllCards } from "../index";
import type {
    ActivatedAbility,
    CardDefinition,
    DelayedTriggerDef,
    TriggeredAbility,
} from "../types";

/** True when `card`'s top-level spell resolution is a bare `resolve()` /
 *  `resolveSteps` closure with no real Effect Script the value model can
 *  walk (issue #1431 SCOPE — see header comment for the modal/`effect`
 *  shorthand exclusions). */
function isResolveOnlySpell(card: CardDefinition): boolean {
    if (card.modes && card.modes.length > 0) return false;
    if (card.effects && card.effects.length > 0) return false;
    return (
        !!card.resolve || !!(card.resolveSteps && card.resolveSteps.length > 0)
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

/** True when `card`'s top-level spell resolution is the declarative `effect`
 *  shorthand (`EffectShorthand`, issue #1519 SCOPE) with no real Effect
 *  Script the value model can walk. A THIRD alternative to
 *  `resolve`/`resolveSteps`/`effects` (compiled into a resolve closure at
 *  lookup time) — exactly as AI-blind as `isResolveOnlySpell` above, since
 *  `dslSpellScriptValue`'s `effectiveScript` (`gre/ai/cardScriptValue.ts`)
 *  never reads the shorthand. */
function isEffectShorthandSpell(card: CardDefinition): boolean {
    if (card.modes && card.modes.length > 0) return false;
    if (card.effects && card.effects.length > 0) return false;
    return !!card.effect;
}

/** All of `card`'s activated + triggered abilities, PLUS its scheduled
 *  `delayedTriggers[]` template bodies — three ability-level effect sites
 *  walked by the ability-level guard (issue #1519 SCOPE; `delayedTriggers[]`
 *  folded in by PR #2010's review, MINOR 7 — it was previously invisible to
 *  this guard entirely, so a bare `resolve()` delayed-trigger body could ship
 *  with no `aiEffects` and no error). `DelayedTriggerDef` carries `id` /
 *  `resolve` / `effects` / `aiEffects` — the same shape this guard already
 *  reads on `ActivatedAbility`/`TriggeredAbility` — just no `resolveSteps`
 *  (template-path delayed triggers don't have a stepped-resolution variant),
 *  which `isResolveOnlyAbility` below already treats as optional. */
function abilitiesOf(
    card: CardDefinition
): (ActivatedAbility | TriggeredAbility | DelayedTriggerDef)[] {
    return [
        ...(card.activatedAbilities ?? []),
        ...(card.triggeredAbilities ?? []),
        ...(card.delayedTriggers ?? []),
    ];
}

/** Just the activated + triggered abilities — the ORIGINAL `abilitiesOf`
 *  scope (issue #1519), before `delayedTriggers[]` was folded in (PR #2010's
 *  review, MINOR 7). `ABILITY_AI_EFFECTS_ALLOWLIST`'s own EXACT-count test
 *  scopes to this so it isn't polluted by the (separately audited)
 *  `delayedTriggers[]` residue below. */
function abilityOnlyOf(
    card: CardDefinition
): (ActivatedAbility | TriggeredAbility)[] {
    return [
        ...(card.activatedAbilities ?? []),
        ...(card.triggeredAbilities ?? []),
    ];
}

/** Just `card.delayedTriggers[]` — the dedicated scope
 *  `DELAYED_TRIGGER_AI_EFFECTS_ALLOWLIST` (issue #2020) audits. */
function delayedTriggersOf(card: CardDefinition): DelayedTriggerDef[] {
    return card.delayedTriggers ?? [];
}

/** True when `ability`'s own effect is a bare `resolve()`/`resolveSteps`
 *  closure with no real Effect Script the value model can walk — the
 *  ability-level mirror of `isResolveOnlySpell` (issue #1519 SCOPE). */
function isResolveOnlyAbility(
    ability: ActivatedAbility | TriggeredAbility | DelayedTriggerDef
): boolean {
    if (ability.effects && ability.effects.length > 0) return false;
    const resolveSteps =
        "resolveSteps" in ability ? ability.resolveSteps : undefined;
    return !!ability.resolve || !!(resolveSteps && resolveSteps.length > 0);
}

/** True when `ability` already plugs the AI-blind gap on its OWN — an
 *  `aiEffects` shadow script. There is no ability-level `aiValue` scalar;
 *  the owning CARD's `aiValue` (checked separately by the caller) already
 *  overrides the whole card's computed worth, ability scripts included
 *  (`gre/cardValue.ts` `latentValue`), so it plugs every ability gap on that
 *  card too without needing its own per-ability field. */
function abilityHasShadowScript(
    ability: ActivatedAbility | TriggeredAbility | DelayedTriggerDef
): boolean {
    return !!ability.aiEffects && ability.aiEffects.length > 0;
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

interface AbilityAllowlistEntry {
    /** The card's registry id (`CardDefinition.id`). */
    readonly cardId: string;
    /** The card's name — a stale-name assertion below catches an id that has
     *  drifted onto a different card (a rebuilt/renumbered catalogue). */
    readonly name: string;
    /** The offending ability's own id (`ActivatedAbility.id` /
     *  `TriggeredAbility.id`) — a card can carry more than one offending
     *  ability, each getting its own entry. */
    readonly abilityId: string;
    /** The `// no honest shadow script: <why>` disposition. */
    readonly note: string;
}

// Every card whose top-level spell resolution is the declarative `effect`
// shorthand (`EffectShorthand`) with no `effects[]`/`aiEffects`/`aiValue`, AT
// THE TIME this scope extension landed (issue #1519). Same emptying-out
// discipline as `AI_EFFECTS_ALLOWLIST` above: do NOT hand-append for a NEW
// card — ship it with a real `aiEffects` sketch or an `aiValue` override
// instead.
const EFFECT_SHORTHAND_ALLOWLIST: readonly AllowlistEntry[] = [
    {
        cardId: "3d170015-b125-49a6-a15e-8fd116bbcb14",
        name: "Army of Allah",
        note: "no honest shadow script: pre-existing effect-shorthand card, ability/effect-shorthand scope extension tracked by #1519",
    },
    {
        cardId: "0d77c149-cca2-45c7-bc83-5ba1872ad5e0",
        name: "Desert Twister",
        note: "no honest shadow script: pre-existing effect-shorthand card, ability/effect-shorthand scope extension tracked by #1519",
    },
    {
        cardId: "2722d7e2-61c6-4934-9c21-875ee78fd06c",
        name: "Disenchant",
        note: "no honest shadow script: pre-existing effect-shorthand card, ability/effect-shorthand scope extension tracked by #1519",
    },
    {
        cardId: "9914836e-2fa6-4390-94b2-431427848a54",
        name: "Ice Storm",
        note: "no honest shadow script: pre-existing effect-shorthand card, ability/effect-shorthand scope extension tracked by #1519",
    },
    {
        cardId: "c4104546-abd9-4bfb-a65e-5928cdd4522f",
        name: "Morale",
        note: "no honest shadow script: pre-existing effect-shorthand card, ability/effect-shorthand scope extension tracked by #1519",
    },
    {
        cardId: "f649c571-d7ec-4ebc-9e18-b0657cab495b",
        name: "Piety",
        note: "no honest shadow script: pre-existing effect-shorthand card, ability/effect-shorthand scope extension tracked by #1519",
    },
    {
        cardId: "50dc7fc1-cb6a-4c68-b993-1a25cf16226e",
        name: "Shatter",
        note: "no honest shadow script: pre-existing effect-shorthand card, ability/effect-shorthand scope extension tracked by #1519",
    },
    {
        cardId: "04b31611-9053-4eaf-b392-21bb644fef5f",
        name: "Sinkhole",
        note: "no honest shadow script: pre-existing effect-shorthand card, ability/effect-shorthand scope extension tracked by #1519",
    },
    {
        cardId: "57ff74cb-a2ed-4123-ac42-f72f9820049e",
        name: "Stone Rain",
        note: "no honest shadow script: pre-existing effect-shorthand card, ability/effect-shorthand scope extension tracked by #1519",
    },
];

// Every activated/triggered ability whose own effect is a bare
// `resolve()`/`resolveSteps` closure with no `effects[]`/`aiEffects`, on a
// card with no `aiValue` override, AT THE TIME this scope extension landed
// (issue #1519). Same emptying-out discipline: do NOT hand-append for a NEW
// ability — ship it with a real `aiEffects` sketch on the ability, or an
// `aiValue` override on the owning card, instead.
const ABILITY_AI_EFFECTS_ALLOWLIST: readonly AbilityAllowlistEntry[] = [
    {
        cardId: "720fbd87-b1c1-4b3b-97a1-46b943b115e3",
        name: "Aang's Iceberg",
        abilityId: "aangs-iceberg-waterbend",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "0e9ad288-d164-44a6-96ec-4185a1587f1a",
        name: "Abu Ja'far",
        abilityId: "abu-jafar-death",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "fc26f19c-bcf7-4bd8-af42-4757dbe47fb1",
        name: "Abyssal Specter",
        abilityId: "abyssal-specter-discard",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "06673800-22a7-4ee3-92fa-7c7cd4865d30",
        name: "Aerathi Berserker",
        abilityId: "rampage-3",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "f3f26060-0c24-496c-b8e2-4dac7ea6166b",
        name: "Aggression",
        abilityId: "aggression-end-step-destroy",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "8fecc5d2-5298-4d47-b085-f160603f220e",
        name: "Aladdin's Lamp",
        abilityId: "aladdins-lamp-look",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "8fd7861d-925f-4b4c-a4ab-60be6f43d50b",
        name: "Animate Dead",
        abilityId: "anim-dead-ltb",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "9e142435-6930-4596-bc3b-60abde1229df",
        name: "Arcum's Weathervane",
        abilityId: "arcums-weathervane-snow",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "9e142435-6930-4596-bc3b-60abde1229df",
        name: "Arcum's Weathervane",
        abilityId: "arcums-weathervane-unsnow",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "73c07c87-0e44-4a5a-92b7-728350cd02de",
        name: "Arcum's Whistle",
        abilityId: "arcums-whistle-force",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "9d816f98-6cb6-432c-b0a4-a0eed21658ac",
        name: "Armadillo Cloak",
        abilityId: "armadillo-cloak-lifegain",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "44a31889-6a8d-450c-a73d-381a7ff28bf9",
        name: "Armageddon Clock",
        abilityId: "armageddon-clock-ping",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "fccbbc47-99c6-4ba9-95c2-992d5d2a67b2",
        name: "Armor of Faith",
        abilityId: "armor-of-faith-pump",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "2307fb16-8b77-45b5-8a02-51a13214791d",
        name: "Arnjlot's Ascent",
        abilityId: "arnjlots-ascent-cumulative-upkeep",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "587d6ac8-fad8-49e0-862e-636e06628ff9",
        name: "Artifact Possession",
        abilityId: "artifact-possession-ability",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "587d6ac8-fad8-49e0-862e-636e06628ff9",
        name: "Artifact Possession",
        abilityId: "artifact-possession-tapped",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "aeeec853-dd3f-4ac3-8b20-c07fada8888f",
        name: "Ashnod's Battle Gear",
        abilityId: "ashnods-battle-gear-pump",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "7e973a84-7f7d-4524-9f2f-ec9a014d52ee",
        name: "Aurochs",
        abilityId: "aurochs-attack-pump",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "211af1bf-910b-41a5-b928-f378188d1871",
        name: "Azure Beastbinder",
        abilityId: "azure-beastbinder-attack",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "04bc57aa-d4d9-4bd9-ba09-984370c7e23b",
        name: "Backfire",
        abilityId: "backfire-reflect",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "340c5799-4964-44dd-8c48-8f3f3aba5211",
        name: "Badgermole Cub",
        abilityId: "badgermole-cub-mana-doubler",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "74859723-8ddf-4ee6-a0a7-87192c84e8ad",
        name: "Balduvian Shaman",
        abilityId: "balduvian-shaman-grant",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "c1ba83ab-83f5-421d-bba1-0f925870b5c8",
        name: "Ball Lightning",
        abilityId: "ball-lightning-end-step-sac",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "66eaa7d6-48b2-4b35-a834-790edd679e0e",
        name: "Banshee",
        abilityId: "banshee-half-x",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "fe65a045-dacb-4392-bcb6-843394ef98c9",
        name: "Barbarian Guides",
        abilityId: "barbarian-guides-snow-landwalk",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "f979fc86-2c7e-49b3-965e-607a203cbfb1",
        name: "Barrowgoyf",
        abilityId: "barrowgoyf-combat-damage",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "76ac72f8-5b1e-4d67-a796-ef69cde27424",
        name: "Black Vise",
        abilityId: "black-vise-upkeep",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "9db5d6c2-b11f-442a-b172-c0c99c9bec07",
        name: "Blastoderm",
        abilityId: "fading",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "f131fd27-18da-47ca-b59f-135bcac83abd",
        name: "Blessing",
        abilityId: "blessing-pump",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "9ca19b39-4201-463c-bd40-fbffa31c9eda",
        name: "Blight",
        abilityId: "blight-destroy-land",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "c369e4f9-0f2b-446c-9e2d-d3eefab0586d",
        name: "Blizzard",
        abilityId: "blizzard-cumulative-upkeep",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "0a5e3d54-4dc4-482b-8ecc-bb819ba03d2c",
        name: "Bone Shaman",
        abilityId: "bone-shaman-grant-rider",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "ceeb7bbc-2d41-4709-95be-1ceb952ed1fb",
        name: "Brand of Ill Omen",
        abilityId: "cumulative-upkeep",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "e40c9657-fab4-489d-8eb0-960ba2605add",
        name: "Breath of Dreams",
        abilityId: "breath-of-dreams-cumulative-upkeep",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "52eef0d6-24b7-40b7-8403-e8e863d0cd55",
        name: "Bristly Bill, Spine Sower",
        abilityId: "bristly-bill-landfall",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "2bc0e8d3-633b-4281-863f-c51c69eed0b6",
        name: "Celestial Sword",
        abilityId: "celestial-sword-pump",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "ee245922-b380-4b2e-a43f-ab1ba8078943",
        name: "Chaos Lord",
        abilityId: "chaos-lord-parity-control",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "aae0543f-7f8b-4327-b735-ac21244e9936",
        name: "Chaos Moon",
        abilityId: "chaos-moon-parity",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "2657e85b-8f77-41fa-9df2-233443efef43",
        name: "Chromatic Armor",
        abilityId: "chromatic-armor-recolor",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "6a058e68-70af-4a64-859c-c881e5578368",
        name: "Chrome Mox",
        abilityId: "chrome-mox-imprint",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "8cd7d7e1-f928-4429-9a59-ba0590a78e98",
        name: "Chromium",
        abilityId: "rampage-2",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "22ebd5a3-fef8-4097-b038-89a6cb38227d",
        name: "Circle of Protection: Artifacts",
        abilityId: "cop-prevent",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "fa47b4cd-8da4-4544-b011-ba92b7009203",
        name: "Circle of Protection: Black",
        abilityId: "cop-prevent",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "848b1a7f-e8ba-40b5-92b7-af1e963a0319",
        name: "Circle of Protection: Blue",
        abilityId: "cop-prevent",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "1ae32d20-b438-4f43-b603-e8f706ecfb03",
        name: "Circle of Protection: Green",
        abilityId: "cop-prevent",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "b3dd94c5-42f6-4148-be6e-2a3a4226cc0e",
        name: "Circle of Protection: Red",
        abilityId: "cop-prevent",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "92df19c9-e127-42d9-8dd2-7fa5a7095428",
        name: "Circle of Protection: White",
        abilityId: "cop-prevent",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "a7a8b6b8-b95f-4014-b17a-a6d44d965995",
        name: "City of Traitors",
        abilityId: "city-of-traitors-sac",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "dc45d103-0fca-4431-a5c0-869f0f9be93e",
        name: "Cloak of Confusion",
        abilityId: "cloak-of-confusion-unblocked",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "1dea8c2f-4aea-478d-aee7-cba1f74edd6c",
        name: "Clockwork Avian",
        abilityId: "clockwork-avian-recharge",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "27f916a2-0ace-44b5-99dc-72979af34db9",
        name: "Clockwork Beast",
        abilityId: "clockwork-beast-recharge",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "9cd91814-6177-4a3d-a1c1-a3be7d7c7957",
        name: "Cockatrice",
        abilityId: "cockatrice-combat-kill",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "a82c87b1-de37-4423-a1a4-533a1d8108b2",
        name: "Cocoon",
        abilityId: "cocoon-etb",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "a82c87b1-de37-4423-a1a4-533a1d8108b2",
        name: "Cocoon",
        abilityId: "cocoon-upkeep",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "81b87a58-b20c-4f38-afa3-59d398195740",
        name: "Cold Snap",
        abilityId: "cold-snap-cumulative-upkeep",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "13186bc9-8d9c-433b-ba15-121ef94dd68a",
        name: "Conversion",
        abilityId: "conversion-upkeep",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "18bc6ac2-19e0-4765-852b-e303a5bb4040",
        name: "Cosmic Horror",
        abilityId: "cosmic-horror-upkeep",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "707dadf0-735f-445d-9240-e49660913314",
        name: "Craw Giant",
        abilityId: "rampage-2",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "ee4bd7d1-77e5-46e5-a594-c24469e88c4c",
        name: "Creature Bond",
        abilityId: "creature-bond-death",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        // Home-set migration (ADR 0041) moved this card from its old INV id
        // to its earliest paper printing (Tempest, `sets/tmp/red.ts`) — the
        // old INV id no longer resolves to any card. Updated to the live id.
        cardId: "f2c82741-2869-41f9-82f4-6ed88756e2fd",
        name: "Crown of Flames",
        abilityId: "crown-of-flames-pump",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "fce2991f-48e1-4cfe-af0a-18b6d9400493",
        name: "Crown of the Ages",
        abilityId: "crown-of-the-ages-move-aura",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "76693233-7961-4b7e-80f2-ed90e494c4aa",
        name: "Crystal Rod",
        abilityId: "crystal-rod-life",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "7995c3f9-a147-43c9-9f82-470924818a4c",
        name: "Cuombajj Witches",
        abilityId: "cuombajj-witches-pings",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "187b6719-e5ed-4615-a00b-3313ceca055b",
        name: "Currency Converter",
        abilityId: "currency-converter-discard-exile",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "187b6719-e5ed-4615-a00b-3313ceca055b",
        name: "Currency Converter",
        abilityId: "currency-converter-retrieve",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "9fc0d070-8a42-4d5e-8f2b-ceb59147de6f",
        name: "Curse Artifact",
        abilityId: "curse-artifact-upkeep",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "69b381c1-aa71-4d40-a320-70f58a440d51",
        name: "Curse of Marit Lage",
        abilityId: "curse-marit-lage-tap-islands",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "cf5f3c61-1e54-4eea-bf82-311cfa988e6a",
        name: "Cursed Land",
        abilityId: "cursed-land-upkeep",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "720d871d-1e7b-482e-bd1e-8ec79519fb86",
        name: "Cursed Rack",
        abilityId: "cursed-rack-choose-opponent",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "31415b9b-fb30-4132-a9a3-795b4573a901",
        name: "Cursed Scroll",
        abilityId: "cursed-scroll-ping",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "f11684d6-5b74-47a7-a2d0-256c9e437aa6",
        name: "Cyclone",
        abilityId: "cyclone-upkeep",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "479ccc50-2d72-4adc-901e-fbd4eef2cf92",
        name: "Cyclopean Mummy",
        abilityId: "cyclopean-mummy-exile",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "894c5cf2-8ae2-427a-bcbc-67df0bdfee9d",
        name: "Cyclopean Tomb",
        abilityId: "cyclopean-tomb-ltb",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "13453abe-3f05-4956-8493-382d7d2af699",
        name: "Dance of Many",
        abilityId: "dance-of-many-exile-token",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "e7c53ba4-9956-4cd6-85ca-2d6b61a5127c",
        name: "Dance of the Dead",
        abilityId: "dance-of-the-dead-enter-tapped",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "e7c53ba4-9956-4cd6-85ca-2d6b61a5127c",
        name: "Dance of the Dead",
        abilityId: "dance-of-the-dead-ltb",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "e7c53ba4-9956-4cd6-85ca-2d6b61a5127c",
        name: "Dance of the Dead",
        abilityId: "dance-of-the-dead-upkeep",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "72cfe9b9-677d-4ecb-83ab-67fb6481371d",
        name: "Dark Sphere",
        abilityId: "dark-sphere-prevent-half",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "3287775f-7bec-4e8f-bb8d-daf5ce92e4a8",
        name: "Deep Forest Hermit",
        abilityId: "vanishing-last-counter",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "3287775f-7bec-4e8f-bb8d-daf5ce92e4a8",
        name: "Deep Forest Hermit",
        abilityId: "vanishing-upkeep",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "69c9e4a5-735f-471c-ab1a-6e6d50ba5724",
        name: "Deep Spawn",
        abilityId: "deep-spawn-upkeep-mill",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "9dd6a230-6bc0-499c-b7fd-4aaa2569f98f",
        name: "Deep Water",
        abilityId: "deep-water-replace",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "262b8788-c5a0-4c8e-9d58-b769b1b0a2ff",
        name: "Delif's Cone",
        abilityId: "delifs-cone",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "14749600-9eca-4122-b04f-30ddda091b74",
        name: "Delif's Cube",
        abilityId: "delifs-cube-arm",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "65eb6cda-e512-40a8-9c1f-335b713409ff",
        name: "Dingus Egg",
        abilityId: "dingus-egg-land-dies",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "9eae0ba1-1383-4505-b4e7-4f17dd8f20c5",
        name: "Divine Intervention",
        abilityId: "divine-intervention-upkeep",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "6bbf1eab-bc32-4835-b566-8634b1fe81b0",
        name: "Dragon Whelp",
        abilityId: "dragon-whelp-pump",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "93372854-57e7-4db7-a1a6-376c9f49a514",
        name: "Dreams of the Dead",
        abilityId: "dreams-of-the-dead-reanimate",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "26e090d4-e7fe-403c-9aca-05c1b45ed238",
        name: "Drop of Honey",
        abilityId: "drop-of-honey-upkeep",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "1d50bf06-97ab-4874-a484-9289f41dc98e",
        name: "Dwarven Armorer",
        abilityId: "dwarven-armorer-counter",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "a6d492b7-b0b3-420e-8d00-6dacb11de77e",
        name: "Earthbind",
        abilityId: "earthbind-etb",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "a83cb1c4-7c5b-4a5e-b15e-138d644f5cdb",
        name: "Earthlink",
        abilityId: "earthlink-dies-sac-land",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "40451f7a-692a-422d-99d3-d93a4d9315e0",
        name: "Ebon Praetor",
        abilityId: "ebon-praetor-sacrifice",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "c4b610d3-2005-4347-bcda-c30b5b7972e5",
        name: "El-Hajjâj",
        abilityId: "el-hajjaj-lifegain",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "62bbff2a-5109-400a-961b-eacffb9aed67",
        name: "Elemental Augury",
        abilityId: "elemental-augury-look",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "f4c1f5a7-0d28-43ab-9b66-937e963f42cd",
        name: "Elephant Grass",
        abilityId: "elephant-grass-cumulative-upkeep",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "49301c19-55a0-4146-9474-0b86cd320e31",
        name: "Elkin Bottle",
        abilityId: "elkin-bottle-exile",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "f395278e-6d74-4f35-af9d-21bad7b19763",
        name: "Elves of Deep Shadow",
        abilityId: "elves-of-deep-shadow-pain",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "00bd8485-d63a-4077-a3d1-4d0f2f4d8035",
        name: "Elvish Healer",
        abilityId: "elvish-healer-prevent",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "eb0e0404-4846-4891-acfa-bd0951ecf9c6",
        name: "Endurance",
        abilityId: "endurance-etb",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "be77edac-9a8b-4b7f-a859-27df76b10aa6",
        name: "Enduring Renewal",
        abilityId: "enduring-renewal-return",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "3955e358-4285-44e2-9e24-9804346a6e58",
        name: "Energy Storm",
        abilityId: "energy-storm-cumulative-upkeep",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "5f4b6507-89ee-482e-aafd-8e05ada8f1ce",
        name: "Erosion",
        abilityId: "erosion-upkeep-tax",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "13ebb5dd-d7f1-4b06-8585-7004045be542",
        name: "Essence Flare",
        abilityId: "essence-flare-upkeep",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "3455b006-9ea5-4aef-8ad2-d0701eb0cacf",
        name: "Farmstead",
        abilityId: "farmstead-upkeep",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "af092da3-8713-4a59-86d3-827b942d6456",
        name: "Farrel's Mantle",
        abilityId: "farrels-mantle-unblocked",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "0401bd23-9f81-40b7-a6c2-e3f9847d175c",
        name: "Farrel's Zealot",
        abilityId: "farrels-zealot-unblocked",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "e11bf79b-a951-4d0c-acdf-d8ba5290a648",
        name: "Farrelite Priest",
        abilityId: "farrelite-priest-mana",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "a575a9af-e1de-4a1d-91d8-440585377e4f",
        name: "Fastbond",
        abilityId: "fastbond-land-etb",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "8da35f9f-e72c-4154-a212-7de98f84ad7d",
        name: "Fasting",
        abilityId: "fasting-draw-destroy",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "8da35f9f-e72c-4154-a212-7de98f84ad7d",
        name: "Fasting",
        abilityId: "fasting-upkeep-hunger",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "0eb8f591-d763-49bf-8ef9-86265aaa72f7",
        name: "Feedback",
        abilityId: "feedback-upkeep",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "bb6af436-bcfd-4d47-a1aa-e84b587a725a",
        name: "Feldon's Cane",
        abilityId: "feldons-cane-shuffle",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "3eb27381-505d-4e47-bf66-9e7ba91a5075",
        name: "Firebreathing",
        abilityId: "firebreathing-pump",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "6880a4d3-5cbc-4a01-9190-3565617efcc9",
        name: "Flow of Maggots",
        abilityId: "flow-of-maggots-cumulative-upkeep",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "21551cb6-3a53-42dd-9bbd-4bc56304d6d3",
        name: "Force of Nature",
        abilityId: "force-of-nature-upkeep",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "3f2004c1-8efe-407f-bf48-27b807422eea",
        name: "Forcefield",
        abilityId: "forcefield-activate",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "5b1e718a-882a-4bdc-9d62-4dda88da0ba0",
        name: "Freyalise Supplicant",
        abilityId: "freyalise-supplicant-sacrifice-ping",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "b11cd2e0-9419-4267-807e-5b73915c748a",
        name: "Freyalise's Winds",
        abilityId: "freyalises-winds-tapped",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "6955d54f-7b37-4e43-8183-51677fb1ee11",
        name: "Frost Giant",
        abilityId: "rampage-2",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "5ad89f0d-b09b-40a0-84d6-3ee60dec7e23",
        name: "Fungusaur",
        abilityId: "fungusaur-counter",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "3c6358a1-37f0-4b40-93d4-4f1652c38404",
        name: "Fylgja",
        abilityId: "fylgja-prevent",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "3efbe59d-bebc-40b1-85ac-2e4c1ff3731e",
        name: "Fyndhorn Pollen",
        abilityId: "fyndhorn-pollen-cumulative-upkeep",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "ee83d511-57e0-40fb-a4db-62f6c2c39888",
        name: "Gaea's Blessing",
        abilityId: "gaeas-blessing-mill-shuffle",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "0e1ae3d6-6d96-4db6-bbc4-cee91bae6cf7",
        name: "Gaea's Touch",
        abilityId: "gaeas-touch-forest",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "da248001-ed75-4b68-9532-37d3cd5afc4c",
        name: "Gauntlet of Might",
        abilityId: "gauntlet-mana-bonus",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "48401643-ec4b-444a-8f9a-1a5ea471ff4a",
        name: "Gaze of Pain",
        abilityId: "gaze-of-pain-unblocked",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "6a4f5a28-0bd2-4cc4-b67f-324e89193caa",
        name: "General Jarkeld",
        abilityId: "general-jarkeld-reassign-blockers",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "f9d613d5-36a2-4633-b5af-64511bb29cc2",
        name: "Ghazbán Ogre",
        abilityId: "ghazban-ogre-upkeep",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "53ec4a19-0f2f-4713-a869-58832484648d",
        name: "Giant Shark",
        abilityId: "giant-shark-combat-pump",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "53ec4a19-0f2f-4713-a869-58832484648d",
        name: "Giant Shark",
        abilityId: "giant-shark-no-islands",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "3d23f800-7a6f-40e3-b242-9f5955e47a75",
        name: "Glacial Chasm",
        abilityId: "glacial-chasm-cumulative-upkeep",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "cafc2350-5d64-4379-9198-79a114654d45",
        name: "Glasses of Urza",
        abilityId: "glasses-look",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "a0a27ac3-2273-469a-92ba-3f4a3d55de6f",
        name: "Goblin Kites",
        abilityId: "goblin-kites-fly",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "d0fcd8d3-f159-49a1-8dd9-582ae4a0adc3",
        name: "Goblin Patrol",
        abilityId: "goblin-patrol-echo",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "de839540-a7b9-4f91-91df-3fd4f5c0bc4e",
        name: "Goblin Sappers",
        abilityId: "goblin-sappers-rr",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "de839540-a7b9-4f91-91df-3fd4f5c0bc4e",
        name: "Goblin Sappers",
        abilityId: "goblin-sappers-rrrr",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "cd69a6dc-27f3-42aa-9e63-4417796e4ef5",
        name: "Goblin Shrine",
        abilityId: "goblin-shrine-leaves",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "5bbb260a-6763-4d1c-a009-4e34cd572519",
        name: "Goblin Snowman",
        abilityId: "goblin-snowman-ping",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "bbec4aa5-3319-43dc-8347-5633edbd7018",
        name: "Goblin Warrens",
        abilityId: "goblin-warrens-breed",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "fd333b18-b896-4ab8-9c46-eed4efdd94f2",
        name: "Goblins of the Flarg",
        abilityId: "goblins-flarg-dwarf-sac",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "856be1dd-a20b-49c2-be9d-7db76c7efd8b",
        name: "Golgothian Sylex",
        abilityId: "golgothian-sylex-wrath",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "5e236816-0c49-4b48-b18b-03add5a80d72",
        name: "Greater Realm of Preservation",
        abilityId: "cop-prevent",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "2e939761-3542-4044-9038-d1d30c6a38fc",
        name: "Halfdane",
        abilityId: "halfdane-copy-pt",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "b926a189-90b6-47bb-b5d6-b033e57007b4",
        name: "Halls of Mist",
        abilityId: "halls-of-mist-cumulative-upkeep",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "a2f6ef2f-a3a2-4e1f-b7eb-59abc8414114",
        name: "Haunting Wind",
        abilityId: "haunting-wind-ability",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "a2f6ef2f-a3a2-4e1f-b7eb-59abc8414114",
        name: "Haunting Wind",
        abilityId: "haunting-wind-tapped",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "be77b98a-dd79-477c-8ab2-7ebf5637a89e",
        name: "Headliner Scarlett",
        abilityId: "headliner-scarlett-etb",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "be77b98a-dd79-477c-8ab2-7ebf5637a89e",
        name: "Headliner Scarlett",
        abilityId: "headliner-scarlett-upkeep",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "8f59620f-ff9e-44d8-9c4e-be9de1a919e8",
        name: "Hecatomb",
        abilityId: "hecatomb-etb",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "83585337-56a9-44d2-9ed1-8a959bcfb010",
        name: "Hematite Talisman",
        abilityId: "hematite-talisman-untap",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "08ee87a0-a7eb-4472-9045-85d11e8a1501",
        name: "Heroism",
        abilityId: "heroism-prevent",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "b01041d2-687e-4972-81c8-16690809275b",
        name: "Holy Armor",
        abilityId: "holy-armor-pump",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "2cbb62fc-3cd9-41a6-804a-4ff9a766897f",
        name: "Homarid Spawning Bed",
        abilityId: "homarid-spawning-bed-spawn",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "a28ad983-ce91-40b6-a1ce-fe36ec7fbce8",
        name: "Horned Cheetah",
        abilityId: "horned-cheetah-lifegain",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "07d8e501-6857-4a52-a3b9-2bf0bee5b08c",
        name: "Hunding Gjornersen",
        abilityId: "rampage-1",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "b43b900f-2d9b-442b-9699-058483604ec9",
        name: "Hypnotic Specter",
        abilityId: "hypnotic-specter-discard",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "1a3e095a-7056-4df3-bf7d-9c217d591446",
        name: "Ice Cauldron",
        abilityId: "ice-cauldron-add",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "1a3e095a-7056-4df3-bf7d-9c217d591446",
        name: "Ice Cauldron",
        abilityId: "ice-cauldron-charge",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "85ce04fb-e687-41e0-ae9a-16a51df5d943",
        name: "Ice Floe",
        abilityId: "ice-floe-tap-lock",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "c0b10fb7-8667-42bf-aeb6-35767a82917b",
        name: "Ifh-Bíff Efreet",
        abilityId: "ifh-biff-efreet-rain",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "ab02268e-01cf-4729-95ca-5773afd40b56",
        name: "Illusionary Forces",
        abilityId: "illusionary-forces-cumulative-upkeep",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "62ef2f37-b8ad-47ad-89ca-d6abcb7ff21b",
        name: "Illusionary Mask",
        abilityId: "illusionary-mask-cast",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "aa31efed-4a11-4f59-a623-bac45d20091d",
        name: "Illusionary Presence",
        abilityId: "illusionary-presence-cumulative-upkeep",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "691f4a1b-4706-41aa-82da-ae920739f036",
        name: "Illusionary Terrain",
        abilityId: "illusionary-terrain-choose-types",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "691f4a1b-4706-41aa-82da-ae920739f036",
        name: "Illusionary Terrain",
        abilityId: "illusionary-terrain-cumulative-upkeep",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "6430e8e2-fee3-4744-820e-d6e16cb992bd",
        name: "Illusionary Wall",
        abilityId: "illusionary-wall-cumulative-upkeep",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "17eeeef2-2ced-42b8-a5e0-1095c9e13b02",
        name: "Illusions of Grandeur",
        abilityId: "illusions-of-grandeur-cumulative-upkeep",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "17eeeef2-2ced-42b8-a5e0-1095c9e13b02",
        name: "Illusions of Grandeur",
        abilityId: "illusions-of-grandeur-ltb",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "733933dd-c871-4f75-8b08-d7c010dddbe6",
        name: "In the Eye of Chaos",
        abilityId: "in-the-eye-of-chaos-tax",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "f3475eb3-909d-450b-9597-b241b259b425",
        name: "Infernal Darkness",
        abilityId: "infernal-darkness-cumulative-upkeep",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "b63ac9a6-aaa5-4659-97d1-c5f6b0d5ccfe",
        name: "Infernal Denizen",
        abilityId: "infernal-denizen-upkeep",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "dc60077f-d577-4a6c-a78f-697317024c40",
        name: "Infinite Authority",
        abilityId: "infinite-authority-combat-kill",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "5be87527-3b8f-4529-afdb-a61ad4e787e1",
        name: "Initiates of the Ebon Hand",
        abilityId: "initiates-ebon-hand-mana",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "5bd38716-874c-4e3c-a315-837839a6258c",
        name: "Instill Energy",
        abilityId: "instill-energy-untap",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "5786de12-cade-43c2-a6b0-0c5b294b9d0e",
        name: "Iron Star",
        abilityId: "iron-star-life",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "9964d8d8-dc97-4e5f-9f52-173f7e2c37fd",
        name: "Ivory Cup",
        abilityId: "ivory-cup-life",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "a5f23039-45ca-4c15-af50-bfd40ea26453",
        name: "Ivory Tower",
        abilityId: "ivory-tower-life",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "3707ab74-9aec-4d30-86e0-ffa5f72d5b4f",
        name: "Jackal Pup",
        abilityId: "jackal-pup-redirect",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "4a77e0f1-449d-4a7d-9fa0-ba7598f7a73a",
        name: "Jade Monolith",
        abilityId: "jm-redirect",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "daa1ba0c-cb89-4bb2-8a35-6a4a4eecccf7",
        name: "Jester's Mask",
        abilityId: "jesters-mask-rearrange",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "34f7bad2-d28f-42d2-9246-fe3545ef49a7",
        name: "Jeweled Amulet",
        abilityId: "jeweled-amulet-add",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "34f7bad2-d28f-42d2-9246-fe3545ef49a7",
        name: "Jeweled Amulet",
        abilityId: "jeweled-amulet-charge",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "b6c7705a-2987-4ef1-92b1-2c55d989ec6f",
        name: "Jihad",
        abilityId: "jihad-sacrifice",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "64a22e88-f7b1-48c8-a199-e57edcd50654",
        name: "Johtull Wurm",
        abilityId: "johtull-wurm-block-shrink",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "9a6e0c8d-0fc1-4f52-8357-e550b0ac579a",
        name: "Justice",
        abilityId: "justice-reflect",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "c2ffb8e7-7ae3-4846-b3da-ca6b4598eb7c",
        name: "Karmic Justice",
        abilityId: "karmic-justice-destroy",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "7dd9b214-d9fe-4c2e-b45b-7145ad98c408",
        name: "Karplusan Yeti",
        abilityId: "karplusan-yeti-fight",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "18607bf6-ce11-41cb-b001-0c9538406ba0",
        name: "Khabál Ghoul",
        abilityId: "khabal-ghoul-end-step",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "2fccb1d0-b324-4780-bb9e-4533240da06d",
        name: "Kjeldoran Frostbeast",
        abilityId: "kjeldoran-frostbeast-end-of-combat",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "66343008-c38a-48a9-b767-fd2243103690",
        name: "Kjeldoran Royal Guard",
        abilityId: "kjeldoran-royal-guard-redirect",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "bbedca18-a074-4441-b0a9-7b14fdb07412",
        name: "Krovikan Elementalist",
        abilityId: "krovikan-elementalist-fly",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "717c5dda-8e38-4c76-b241-685198402284",
        name: "Krovikan Vampire",
        abilityId: "krovikan-vampire-mark",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "b2b72dcd-9ea1-4729-baae-ecd262fdff67",
        name: "Kudzu",
        abilityId: "kudzu-tapped",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "ce00bb19-983e-427d-be54-ae6daf0ccdde",
        name: "Lapis Lazuli Talisman",
        abilityId: "lapis-lazuli-talisman-untap",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "ad5ba7ee-d6df-4b62-a8a1-c81e6fca392a",
        name: "Leshrac's Sigil",
        abilityId: "leshracs-sigil-green-discard",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "4250caec-0e37-41be-9ec4-8938deb5f0d0",
        name: "Lich",
        abilityId: "lich-damage",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "4250caec-0e37-41be-9ec4-8938deb5f0d0",
        name: "Lich",
        abilityId: "lich-etb",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "4250caec-0e37-41be-9ec4-8938deb5f0d0",
        name: "Lich",
        abilityId: "lich-ltb",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "4ecb1362-9a67-4d4c-8d69-9ac2ebf4d0b0",
        name: "Lifeblood",
        abilityId: "lifeblood-mountain-tapped",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "3d0006f6-2f96-453d-9145-eaefa588efbc",
        name: "Lim-Dûl's Cohort",
        abilityId: "lim-duls-cohort-no-regen",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "af976f42-3d56-4e32-8294-970a276a4bf3",
        name: "Lim-Dûl's Hex",
        abilityId: "lim-duls-hex-upkeep",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "3c31a957-ad1e-40cc-b3c4-2f4caa492b77",
        name: "Living Armor",
        abilityId: "living-armor-counters",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "c9e753a2-a7d0-4d37-ae65-b5a1b5039a6e",
        name: "Living Artifact",
        abilityId: "living-artifact-upkeep",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "c9e753a2-a7d0-4d37-ae65-b5a1b5039a6e",
        name: "Living Artifact",
        abilityId: "living-artifact-vitality",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "59faa45d-868b-4bc7-934c-0e077642e129",
        name: "Loran of the Third Path",
        abilityId: "loran-etb-destroy",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "2926777a-4f6e-4965-ba83-22cf7df02602",
        name: "Lord of the Pit",
        abilityId: "lord-of-the-pit-upkeep",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "0f8fe1e5-69d2-401f-97cb-3cc01064bad3",
        name: "Lost Order of Jarkeld",
        abilityId: "lost-order-choose-opponent",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "fb1189c9-7842-466e-8238-1e02677d8494",
        name: "Lutri, the Spellchaser",
        abilityId: "lutri-etb",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "5277656c-70f5-4660-bd58-7d9261d53fb5",
        name: "Maddening Wind",
        abilityId: "maddening-wind-cumulative-upkeep",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "5277656c-70f5-4660-bd58-7d9261d53fb5",
        name: "Maddening Wind",
        abilityId: "maddening-wind-upkeep-damage",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "95fde48b-e40a-4183-b324-1ec276dde015",
        name: "Magnetic Mountain",
        abilityId: "magnetic-mountain-upkeep",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "86da04e9-b94d-42af-add3-02baf772bd33",
        name: "Magus of the Unseen",
        abilityId: "magus-of-the-unseen-steal",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "63fb8a24-ce53-4a69-be2a-55c6dbba5ee7",
        name: "Malachite Talisman",
        abilityId: "malachite-talisman-untap",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "7fb99a26-beeb-4aca-bb02-b2d2ce0595f9",
        name: "Mana Flare",
        abilityId: "mana-flare-extra",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "f857a00a-82e0-4227-86ee-1f9c7ca232ae",
        name: "Mana Vortex",
        abilityId: "mana-vortex-cast-counter",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "6121f72f-680f-4bb4-ae4d-37ee4ebed4d8",
        name: "Manabarbs",
        abilityId: "manabarbs-damage",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "9efbfd67-e0f5-43e0-9fff-1eb4a2bed0d8",
        name: "Marauding Mako",
        abilityId: "marauding-mako-discard",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "67330004-6720-46d9-9de0-c79230110583",
        name: "Marhault Elsdragon",
        abilityId: "rampage-1",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "109cce7a-96f7-4e67-878a-bd5c93ea8643",
        name: "Marsh Viper",
        abilityId: "marsh-viper-poison",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "7880e815-53e7-43e0-befd-e368f00a75d8",
        name: "Márton Stromgald",
        abilityId: "marton-attack-pump",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "7880e815-53e7-43e0-befd-e368f00a75d8",
        name: "Márton Stromgald",
        abilityId: "marton-block-pump",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "a15d33d6-7213-4482-a1be-ac0a73644af6",
        name: "Memory Jar",
        abilityId: "memory-jar-activate",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "7b28762d-1ab7-460e-b433-27f5fa858959",
        name: "Mercenaries",
        abilityId: "mercenaries-prevent",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "3bf47c0a-5c17-47d0-b663-becff62fbdf8",
        name: "Merieke Ri Berit",
        abilityId: "merieke-ri-berit-on-leave",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "3bf47c0a-5c17-47d0-b663-becff62fbdf8",
        name: "Merieke Ri Berit",
        abilityId: "merieke-ri-berit-on-untap",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "3bf47c0a-5c17-47d0-b663-becff62fbdf8",
        name: "Merieke Ri Berit",
        abilityId: "merieke-ri-berit-steal",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "b1e96895-ef1d-44fa-b263-bce833fc3109",
        name: "Merseine",
        abilityId: "merseine-remove-net",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "ae3df593-e9d5-479d-9a9a-1c7262dd9c6c",
        name: "Mesmeric Trance",
        abilityId: "mesmeric-trance-cumulative-upkeep",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "d3ddbe51-cd1a-4b2c-849a-7c82d622122a",
        name: "Mijae Djinn",
        abilityId: "mijae-djinn-attack-flip",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "3f3ff5fb-4126-4a18-b540-2beaae382e59",
        name: "Mind Whip",
        abilityId: "mind-whip-upkeep",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "61278908-a1b4-4b4c-84f5-498ca41fc6b6",
        name: "Minion of Leshrac",
        abilityId: "minion-of-leshrac-upkeep",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "35d29bda-096c-44d4-b45e-c2c507f8efbe",
        name: "Miracle Worker",
        abilityId: "miracle-worker-destroy-aura",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "a8f05d5e-bb7d-4554-b880-f0c6b4688357",
        name: "Mirror Universe",
        abilityId: "mirror-universe-exchange",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "8a720448-017f-4f4a-9501-678245eaed17",
        name: "Mishra's Bauble",
        abilityId: "mishras-bauble-look",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "8f6b4652-a1d4-418f-a89b-6a977a920a9e",
        name: "Mishra's War Machine",
        abilityId: "mishras-war-machine-upkeep",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "4914f6fc-e3e7-426b-8688-12157c7df9e7",
        name: "Mole Worms",
        abilityId: "mole-worms-tap-lock",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "254fcc50-79a5-40cd-b028-e78dde3f8480",
        name: "Monsoon",
        abilityId: "monsoon-end-step",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "bcc1d589-02a2-4896-a283-9d0385534667",
        name: "Mountain Titan",
        abilityId: "mountain-titan-arm-cast-watch",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "65acce56-8674-471e-9d5e-91b7e3f672c1",
        name: "Mudslide",
        abilityId: "mudslide-untap-escape",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "f5fb426a-5618-4dd4-9c51-0cc847be8c1d",
        name: "Multiversal Passage",
        abilityId: "multiversal-passage-choose-type",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "9f8d2247-a10e-413a-b497-2add3918f991",
        name: "Musician",
        abilityId: "musician-cumulative-upkeep",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "9f8d2247-a10e-413a-b497-2add3918f991",
        name: "Musician",
        abilityId: "musician-music-counter",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "e35d7f08-0687-41bd-8c53-31a49adabb11",
        name: "Mystic Might",
        abilityId: "mystic-might-cumulative-upkeep",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "58e93dff-b774-4765-b7bd-d3957e42ff4a",
        name: "Mystic Remora",
        abilityId: "mystic-remora-cumulative-upkeep",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "06912236-8225-4eb0-8086-c6a163c69892",
        name: "Nacre Talisman",
        abilityId: "nacre-talisman-untap",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "cabadfb2-93cd-4c7a-b901-59c3dd1a7c3c",
        name: "Naked Singularity",
        abilityId: "naked-singularity-cumulative-upkeep",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "893e8e9c-983e-4db1-8d93-10637025a559",
        name: "Necropolis",
        abilityId: "necropolis-counters",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "54d7a0c1-efb4-4a8d-ad92-a96d43835052",
        name: "Necropotence",
        abilityId: "necropotence-discard-exile",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "54d7a0c1-efb4-4a8d-ad92-a96d43835052",
        name: "Necropotence",
        abilityId: "necropotence-pay-life",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "f13ad58a-6f9b-420a-bac1-40929f5e616a",
        name: "Nether Shadow",
        abilityId: "nether-shadow-reanimate",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "2e72f8cb-5bc3-4711-9b7c-a6eea9a0beaf",
        name: "Nether Void",
        abilityId: "nether-void-tax",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "8105973c-a94d-444c-ba20-ab0fa978bee8",
        name: "Nettling Imp",
        abilityId: "nettling-imp-force",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "35abefe6-c39b-4fe5-b2e3-d213f0c4f447",
        name: "Norritt",
        abilityId: "norritt-force-attack",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "f16df768-06de-43a0-b548-44fb0887490b",
        name: "Oath of Lim-Dûl",
        abilityId: "oath-of-lim-dul-life-loss",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "d77fe8e2-8438-473e-ace5-01baddd2c4ed",
        name: "Onulet",
        abilityId: "onulet-life",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "a89b2368-1180-4821-bcb8-8161c18e5538",
        name: "Onyx Talisman",
        abilityId: "onyx-talisman-untap",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "65a10fd5-506e-46bf-87e6-fde134c0dc04",
        name: "Orc General",
        abilityId: "orc-general-pump",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "cd3890d1-563d-4519-ab8c-913031d71918",
        name: "Orcish Spy",
        abilityId: "orcish-spy-look",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "f3ee7bd5-612b-4916-a914-1294805b8f64",
        name: "Orcish Squatters",
        abilityId: "orcish-squatters-steal-land",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "30d1450f-2909-410e-9920-731278fa74de",
        name: "Oubliette",
        abilityId: "oubliette-phase-out",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "78cef262-c753-4658-b3ec-fec8db47f944",
        name: "Palace Jailer",
        abilityId: "palace-jailer-exile",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "7fe593eb-df3c-43e5-97a6-418f91e87cb3",
        name: "Parallax Tide",
        abilityId: "fading",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "cef789e8-e4cc-4f61-bc15-debc2487777f",
        name: "Parallax Wave",
        abilityId: "fading",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "be33a155-de26-43d1-88f1-c926f1b7cb7c",
        name: "Paralyze",
        abilityId: "paralyze-upkeep",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "b8d889a5-f6c7-410d-97f9-acf08b9091c8",
        name: "Pentagram of the Ages",
        abilityId: "pentagram-of-the-ages-prevent",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "caf9cef4-0f2d-478a-b119-fe1967687f74",
        name: "Personal Incarnation",
        abilityId: "pinc-ltb",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "0631c7c8-9aa5-4333-8e20-20247fc47033",
        name: "Phantasmal Forces",
        abilityId: "phantasmal-forces-upkeep",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "55707746-da6e-46e5-a5ca-7ac843fdc38e",
        name: "Phelia, Exuberant Shepherd",
        abilityId: "phelia-attack",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "21a985a9-5612-4844-982e-fd1aa6249770",
        name: "Phyrexian Gremlins",
        abilityId: "phyrexian-gremlins-tap-lock",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "aee01e9c-0445-4228-a73a-3e5744844ed3",
        name: "Polar Kraken",
        abilityId: "polar-kraken-cumulative-upkeep",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "ccc982b6-35b2-4e33-ace2-86cb79123e4f",
        name: "Power Leak",
        abilityId: "power-leak-upkeep",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "62858604-ca5a-4f69-a045-a7515ebfabf2",
        name: "Power Surge",
        abilityId: "power-surge-damage",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "ae1d7b09-3a1f-410f-b330-04ae768b0455",
        name: "Powerleech",
        abilityId: "powerleech-ability",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "ae1d7b09-3a1f-410f-b330-04ae768b0455",
        name: "Powerleech",
        abilityId: "powerleech-tapped",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "1e03d335-d259-4ab4-814f-9333cfd3afc9",
        name: "Preacher",
        abilityId: "preacher-steal",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "1cb86b2f-116d-4952-b35a-1398341baaf5",
        name: "Presence of the Master",
        abilityId: "presence-of-the-master-counter",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "c9fd4054-42fc-4f95-a6f7-369a5da43dd5",
        name: "Priest of Yawgmoth",
        abilityId: "priest-of-yawgmoth-mana",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "a46e47e1-8639-48f7-94c4-5f9e9666839a",
        name: "Primordial Ooze",
        abilityId: "primordial-ooze-upkeep",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "fec3275e-4491-43a8-9f23-d7b48177c103",
        name: "Psychic Allergy",
        abilityId: "psychic-allergy-opponent-upkeep",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "fec3275e-4491-43a8-9f23-d7b48177c103",
        name: "Psychic Allergy",
        abilityId: "psychic-allergy-own-upkeep",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "68924203-c3d9-41ce-8ca8-c6dd491eb3ca",
        name: "Psychic Frog",
        abilityId: "psychic-frog-discard-pump",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "f3f5b68a-6b0e-431e-89f0-ff60f17687a5",
        name: "Psychic Venom",
        abilityId: "psychic-venom-damage",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "d2e9decf-47b7-44e0-b380-8055b6011021",
        name: "Pyramids",
        abilityId: "pyramids-save-land",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "f4c133b8-8383-433f-be96-c47a937287b7",
        name: "Rag Man",
        abilityId: "rag-man-discard",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "61e4f56d-1f4f-49f2-8534-0d09196a3327",
        name: "Raging River",
        abilityId: "raging-river-piles",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "907a3396-706b-4ca2-9973-bca758986032",
        name: "Raiding Party",
        abilityId: "raiding-party-raze",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "1b7e955c-3de2-430c-93b9-0b39ccea5420",
        name: "Reality Twist",
        abilityId: "reality-twist-cumulative-upkeep",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "d551ff93-d8da-4c21-bc3c-6451c0dde07e",
        name: "Reflecting Mirror",
        abilityId: "reflecting-mirror-retarget",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "b7b7aa34-b4f8-41b4-82ce-ab2e204c3bf4",
        name: "Regeneration",
        abilityId: "regeneration-regenerate",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "5c5c01e7-8116-45fc-afc3-d52a31a635cb",
        name: "Ritual of Subdual",
        abilityId: "ritual-of-subdual-cumulative-upkeep",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "0ecbe097-ba51-42e5-957c-382eb66c08f0",
        name: "Robber of the Rich",
        abilityId: "robber-of-the-rich-attack",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "59590768-fa96-4869-8763-9d5ab6ac22ad",
        name: "Royal Assassin",
        abilityId: "royal-assassin-destroy",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "37ae4b01-a9c1-4eec-9204-78cb2508e0df",
        name: "Sacred Ground",
        abilityId: "sacred-ground-return",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "0d48fb47-1bed-4791-a014-504515f3d36f",
        name: "Safe Haven",
        abilityId: "safe-haven-return",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "38fb3014-f631-4a75-92cd-7e626b13a4c3",
        name: "Savaen Elves",
        abilityId: "savaen-elves-destroy-aura",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "93850e74-744c-4261-a84e-01eaced6e49a",
        name: "Scarecrow",
        abilityId: "scarecrow-prevent-flying",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "ac2655e4-3a4d-4f73-820a-02fab675d42e",
        name: "Scarwood Hag",
        abilityId: "scarwood-hag-strip-forestwalk",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "426984e0-88e1-4a2d-9a1c-798b95864df3",
        name: "Scavenging Ghoul",
        abilityId: "scavenging-ghoul-corpse",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "b3dd3c7d-4685-4579-b483-14ddaaaddf5b",
        name: "Scythecat Cub",
        abilityId: "scythecat-cub-landfall",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "c5266aa1-e2ea-46b9-91ab-b94a7bb7e9f9",
        name: "Seasinger",
        abilityId: "seasinger-steal",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "06900a71-34ca-48c6-94ac-fca744356829",
        name: "Season of the Witch",
        abilityId: "season-of-the-witch-end-step",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "06900a71-34ca-48c6-94ac-fca744356829",
        name: "Season of the Witch",
        abilityId: "season-of-the-witch-upkeep",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "da369c86-7e17-43d8-b626-b6842e3d2d50",
        name: "Seizures",
        abilityId: "seizures-tapped",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "ab675291-3189-43f3-b11b-0724eca8b941",
        name: "Seraph",
        abilityId: "seraph-mark",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "0458b733-d689-4cb5-8970-3b675c67fc4d",
        name: "Serendib Djinn",
        abilityId: "serendib-djinn-upkeep",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "cc278af4-b60d-41b7-b9d7-36c8aefca1a7",
        name: "Shapeshifter",
        abilityId: "shapeshifter-upkeep-renumber",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "fddcc557-871d-425b-b4ee-bc0c9bc717aa",
        name: "Shelkin Brownie",
        abilityId: "shelkin-brownie-strip",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "d67be074-cdd4-41d9-ac89-0a0456c4e4b2",
        name: "Sheoldred, the Apocalypse",
        abilityId: "sheoldred-opponent-draw-lose-life",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "8e82044d-88cd-4ee4-8ec9-e71a0a85ed46",
        name: "Slimy Kavu",
        abilityId: "slimy-kavu-swamp",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "9e5b279e-4670-4a1e-87d0-3cab7e4f9e58",
        name: "Snapcaster Mage",
        abilityId: "snapcaster-mage-etb-flashback",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "788ed793-3993-4a63-b9f9-9ac3947c3108",
        name: "Snowfall",
        abilityId: "snowfall-cumulative-upkeep",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "788ed793-3993-4a63-b9f9-9ac3947c3108",
        name: "Snowfall",
        abilityId: "snowfall-island-mana",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "9fabc7b6-e766-4e3c-816e-04cfeceaff09",
        name: "Soldevi Simulacrum",
        abilityId: "soldevi-simulacrum-cumulative-upkeep",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "e7a8eb7a-eb3f-405e-8f44-d8ea64d76386",
        name: "Solitary Confinement",
        abilityId: "solitary-confinement-upkeep",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "47a6234f-309f-4e03-9263-66da48b57153",
        name: "Solitude",
        abilityId: "solitude-etb",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "6f75946b-1690-43cc-993c-d4e451a1a41c",
        name: "Sorrow's Path",
        abilityId: "sorrows-path-swap-blockers",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "6f75946b-1690-43cc-993c-d4e451a1a41c",
        name: "Sorrow's Path",
        abilityId: "sorrows-path-tap-drawback",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "42fbf6a5-86fe-41a3-891e-f72f11ad0aee",
        name: "Soul Kiss",
        abilityId: "soul-kiss-pump",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "d829d9de-83fa-4feb-8efc-0075315163c6",
        name: "Sparring Golem",
        abilityId: "sparring-golem-becomes-blocked",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "5e2d35f8-3cf6-4843-9030-0e9a885d836c",
        name: "Spirit Link",
        abilityId: "spirit-link-lifegain",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "a30bb266-5bd1-4998-ae94-56f0f3354167",
        name: "Spirit Shackle",
        abilityId: "spirit-shackle-tap",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "213d6e0d-5ec9-441e-a38d-50ce44583e4b",
        name: "Spirit Shield",
        abilityId: "spirit-shield-buff",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "7011356e-7516-4ca0-ac54-d30af7ce03a2",
        name: "Spitting Slug",
        abilityId: "spitting-slug-first-strike",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "ac86055d-ce08-4b05-a92c-45e007ca0ba4",
        name: "Spreading Plague",
        abilityId: "spreading-plague-enters",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "b6cef408-5b4b-49f6-9531-be544815b93f",
        name: "Stasis",
        abilityId: "stasis-upkeep",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "7ffaedb9-25f8-4304-9085-e12505b93312",
        name: "Stone Giant",
        abilityId: "stone-giant-fling",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "d23fa1af-78e5-4d23-bbf6-cd62bc54b4e9",
        name: "Stonehands",
        abilityId: "stonehands-pump",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "a64d4f93-0c04-4078-aec0-7e9de92f260f",
        name: "Su-Chi",
        abilityId: "su-chi-mana",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "701256d5-1389-48b7-9581-d6037209bd06",
        name: "Subtlety",
        abilityId: "subtlety-etb",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "79955e27-eef7-43bd-9895-e9209ed1537f",
        name: "Sulfuric Vortex",
        abilityId: "sulfuric-vortex-upkeep-ping",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "f1e0f9ec-2b06-4bda-8b80-a716d82d1f13",
        name: "Sunken City",
        abilityId: "sunken-city-upkeep",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "3035cead-a501-4204-9154-5fd648577d32",
        name: "Tawnos's Weaponry",
        abilityId: "tawnoss-weaponry-pump",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "23eb19f9-2e8f-4bf0-9bf8-868e6da70e2d",
        name: "Tetravus",
        abilityId: "tetravus-counters-to-tokens",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "23eb19f9-2e8f-4bf0-9bf8-868e6da70e2d",
        name: "Tetravus",
        abilityId: "tetravus-tokens-to-counters",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "86a27d68-3e58-4ade-976d-36381beed451",
        name: "The Abyss",
        abilityId: "the-abyss-upkeep-destroy",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "f9ffb265-872f-47b3-974c-92bcbebd557e",
        name: "The Brute",
        abilityId: "the-brute-regenerate",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "ec0686ba-1277-4412-a397-7a6227808311",
        name: "The Rack",
        abilityId: "the-rack-choose-opponent",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "ec0686ba-1277-4412-a397-7a6227808311",
        name: "The Rack",
        abilityId: "the-rack-upkeep-damage",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "9d970195-0a09-4cb4-a2c0-c16fcab5c859",
        name: "Thelon's Chant",
        abilityId: "thelons-chant-swamp-punish",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "9b868846-cc3c-4756-a5dd-2335bb380567",
        name: "Thelon's Curse",
        abilityId: "thelons-curse-untap-escape",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "cd8772dd-513d-4dd0-a5db-5214dc8da4e0",
        name: "Thelonite Druid",
        abilityId: "thelonite-druid-animate-forests",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "5400ff25-c70e-4095-a228-190601b86043",
        name: "Thelonite Monk",
        abilityId: "thelonite-monk-forest",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "e92cce01-b3bd-4307-aae5-9a7c8fa386ab",
        name: "Thicket Basilisk",
        abilityId: "basilisk-combat-kill",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "a2931ae0-7836-4000-b9ec-f2029ebf5d96",
        name: "Throne of Bone",
        abilityId: "throne-of-bone-life",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "d800512b-1492-41d2-931d-57c625044454",
        name: "Thrull Retainer",
        abilityId: "thrull-retainer-regenerate",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "2e820f3f-434e-4d09-91b9-0ebd6966b393",
        name: "Tidal Flats",
        abilityId: "tidal-flats-first-strike",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "902441dc-c976-4c92-b897-6376eaa0fe38",
        name: "Time Vault",
        abilityId: "time-vault-extra-turn",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "902441dc-c976-4c92-b897-6376eaa0fe38",
        name: "Time Vault",
        abilityId: "time-vault-untap",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "d43c01b7-443d-4061-a934-6863d230c9b8",
        name: "Tolaria",
        abilityId: "tolaria-strip",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "0f9668ba-d26d-4484-b4b8-6fb91fbfb617",
        name: "Tormod's Crypt",
        abilityId: "tormods-crypt-exile-graveyard",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "6107388b-ec1e-401e-a407-a821c908ed8d",
        name: "Total War",
        abilityId: "total-war-mass-destroy",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "06883fd2-eccd-47c6-8c34-10d95e923685",
        name: "Tourach's Chant",
        abilityId: "tourachs-chant-forest-punish",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "d77f6401-a9fb-449c-b511-6fb837055bb4",
        name: "Tourach's Gate",
        abilityId: "tourachs-gate-pump",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "d77f6401-a9fb-449c-b511-6fb837055bb4",
        name: "Tourach's Gate",
        abilityId: "tourachs-gate-upkeep",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "64c19977-ac7d-4ce7-925c-33a7503420f5",
        name: "Tower of Coireall",
        abilityId: "tower-of-coireall-evasion",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "35ffc69e-26f2-434f-8c89-2df108dd984a",
        name: "Tracker",
        abilityId: "tracker-fight",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "977f0f82-0542-40c9-9a48-73077941dbd1",
        name: "Traveler's Cloak",
        abilityId: "travelers-cloak-choose-type",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "0047302d-4e3d-4327-9bb2-ecd5b00b00e3",
        name: "Tsabo's Assassin",
        abilityId: "tsabos-assassin-destroy",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "a79e9236-a39e-471a-b18a-2c2ba16e7774",
        name: "Unstable Mutation",
        abilityId: "unstable-mutation-decay",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "11fb92c0-bb1e-463a-a6b6-887a5d0cb873",
        name: "Venarian Gold",
        abilityId: "venarian-gold-etb",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "11fb92c0-bb1e-463a-a6b6-887a5d0cb873",
        name: "Venarian Gold",
        abilityId: "venarian-gold-upkeep",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "768f3a05-bd06-4a23-b9f2-94f6e618fd9f",
        name: "Vesuvan Doppelganger",
        abilityId: "vesuvan-doppelganger-recopy",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "0c9ea118-6a19-4e1b-aa5a-9b2729efc096",
        name: "Vexing Arcanix",
        abilityId: "vexing-arcanix-guess",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "cd962ff0-4aa6-453e-931e-bd36fc034273",
        name: "Vodalian War Machine",
        abilityId: "vodalian-war-machine-attack",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "cba1238c-1969-452d-8112-124cbbd49417",
        name: "Walking Wall",
        abilityId: "walking-wall-mobilize",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "55da1e86-fe18-486a-b510-f941e6f6e378",
        name: "Wall of Tombstones",
        abilityId: "wall-of-tombstones-set-toughness",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "220a03ca-8c9b-4acb-821d-f6577fbb20fb",
        name: "Wanderlust",
        abilityId: "wanderlust-upkeep",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "9e5e07a2-fbdf-4c4c-996a-fce40bab5de5",
        name: "Warp Artifact",
        abilityId: "warp-artifact-upkeep",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "e56146bf-5db0-4bef-83bb-efa5ebec6684",
        name: "Whippoorwill",
        abilityId: "whippoorwill-doom",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "9ee86bf2-6c54-4c6e-8394-eb39f98d5a85",
        name: "Wiitigo",
        abilityId: "wiitigo-block-marker",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "9ee86bf2-6c54-4c6e-8394-eb39f98d5a85",
        name: "Wiitigo",
        abilityId: "wiitigo-upkeep-growth",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "fd896dfa-66c0-4327-8e5b-489bbe350c95",
        name: "Wild Growth",
        abilityId: "wild-growth-extra-green",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "ba5aee52-095e-4c69-93eb-5adac11ed1fc",
        name: "Wolverine Pack",
        abilityId: "rampage-2",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "bcae01a2-171b-47cd-87be-f1e4e5314326",
        name: "Wooden Sphere",
        abilityId: "wooden-sphere-life",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "e10520b2-b5a7-4328-84c8-20443b6f588a",
        name: "Woolly Spider",
        abilityId: "woolly-spider-block-flier",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "65a97821-ca5b-46fb-af08-86de81d0daac",
        name: "Worms of the Earth",
        abilityId: "worms-of-the-earth-upkeep",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "5149ffff-d38f-458e-bcfa-a4b6b332a0b4",
        name: "Xenic Poltergeist",
        abilityId: "xenic-poltergeist-animate",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "04bbd231-0d5f-4cbf-92a7-10d2c5c4b82c",
        name: "Yawgmoth Demon",
        abilityId: "yawgmoth-demon-upkeep",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "efdba2a9-d171-45ed-8dd4-9d0046128f68",
        name: "Ydwen Efreet",
        abilityId: "ydwen-efreet-block-flip",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
    {
        cardId: "4137160b-5248-4fbd-8ae8-25e9afd8fb5c",
        name: "Zelyon Sword",
        abilityId: "zelyon-sword-buff",
        note: "no honest shadow script: pre-existing ability-level resolve()/resolveSteps ability, scope extension tracked by #1519",
    },
];

interface DelayedTriggerAllowlistEntry {
    /** The card's registry id (`CardDefinition.id`). */
    readonly cardId: string;
    /** The card's name — a stale-name assertion below catches an id that has
     *  drifted onto a different card (a rebuilt/renumbered catalogue). */
    readonly name: string;
    /** The offending `DelayedTriggerDef.id` — a card can carry more than one
     *  offending delayed trigger, each getting its own entry. */
    readonly delayedTriggerId: string;
    /** Real, OPEN tracking issue this entry is filed against. Every entry
     *  below is #2020 today; a future PR splitting one off into its own
     *  fix gets its own issue number when it's fixed, not when it's added. */
    readonly issue: number;
    /** The `// no honest shadow script: <why>` disposition. */
    readonly note: string;
}

// `abilitiesOf` now also walks `card.delayedTriggers[]` (PR #2010's review,
// MINOR 7 — a bare `resolve()` delayed-trigger body was previously invisible
// to this guard entirely, so it could ship with no `aiEffects` and no
// error). The 25 entries below are every PRE-EXISTING delayed-trigger body
// this newly reaches, at the moment the scope extension landed (issue
// #2020) — none are new abilities, and none of these 25 sketch trivially:
// each acts on an EXTERNAL object captured via `payload` at scheduling time
// (`ctx.scheduleDelayedTrigger(..., { targetId })`), which the standalone
// `aiEffects` shadow (walked by `OP_VALUERS` with no access to that
// `payload`) has no way to reference — see #2020 for the per-entry detail
// and the fix-or-empty-out discipline (same as `ABILITY_AI_EFFECTS_ALLOWLIST`
// above: remove a row the moment its delayed trigger gets a real shadow
// script or its owning card gets an `aiValue`, never leave a stale one).
const DELAYED_TRIGGER_AI_EFFECTS_ALLOWLIST: readonly DelayedTriggerAllowlistEntry[] =
    [
        {
            cardId: "d992b336-3b6e-43e1-8662-d85664349b44",
            name: "Siren's Call",
            delayedTriggerId: "sirens-call-destroy",
            issue: 2020,
            note: "no honest shadow script: delayed-trigger body acts on an externally-captured payload target, tracked by #2020",
        },
        {
            cardId: "8105973c-a94d-444c-ba20-ab0fa978bee8",
            name: "Nettling Imp",
            delayedTriggerId: "nettling-imp-destroy",
            issue: 2020,
            note: "no honest shadow script: delayed-trigger body acts on an externally-captured payload target, tracked by #2020",
        },
        {
            cardId: "e173c8ce-2352-405e-ad00-e3bb94ced1ad",
            name: "Berserk",
            delayedTriggerId: "destroy-if-attacked",
            issue: 2020,
            note: "no honest shadow script: delayed-trigger body acts on an externally-captured payload target, tracked by #2020",
        },
        {
            cardId: "9cd91814-6177-4a3d-a1c1-a3be7d7c7957",
            name: "Cockatrice",
            delayedTriggerId: "cockatrice-combat-kill-destroy",
            issue: 2020,
            note: "no honest shadow script: delayed-trigger body acts on an externally-captured payload target, tracked by #2020",
        },
        {
            cardId: "e92cce01-b3bd-4307-aae5-9a7c8fa386ab",
            name: "Thicket Basilisk",
            delayedTriggerId: "basilisk-combat-kill-destroy",
            issue: 2020,
            note: "no honest shadow script: delayed-trigger body acts on an externally-captured payload target, tracked by #2020",
        },
        {
            cardId: "dc60077f-d577-4a6c-a78f-697317024c40",
            name: "Infinite Authority",
            delayedTriggerId: "infinite-authority-destroy",
            issue: 2020,
            note: "no honest shadow script: delayed-trigger body acts on an externally-captured payload target, tracked by #2020",
        },
        {
            cardId: "dc60077f-d577-4a6c-a78f-697317024c40",
            name: "Infinite Authority",
            delayedTriggerId: "infinite-authority-counter",
            issue: 2020,
            note: "no honest shadow script: delayed-trigger body acts on an externally-captured payload target, tracked by #2020",
        },
        {
            cardId: "e691adef-3027-4e6a-889f-9f4e2df36a7c",
            name: "Mana Drain",
            delayedTriggerId: "mana-drain-add",
            issue: 2020,
            note: "no honest shadow script: delayed-trigger body acts on an externally-captured payload target, tracked by #2020",
        },
        {
            cardId: "e11bf79b-a951-4d0c-acdf-d8ba5290a648",
            name: "Farrelite Priest",
            delayedTriggerId: "farrelite-priest-sacrifice",
            issue: 2020,
            note: "no honest shadow script: delayed-trigger body acts on an externally-captured payload target, tracked by #2020",
        },
        {
            cardId: "5be87527-3b8f-4529-afdb-a61ad4e787e1",
            name: "Initiates of the Ebon Hand",
            delayedTriggerId: "initiates-ebon-hand-sacrifice",
            issue: 2020,
            note: "no honest shadow script: delayed-trigger body acts on an externally-captured payload target, tracked by #2020",
        },
        {
            cardId: "a0a27ac3-2273-469a-92ba-3f4a3d55de6f",
            name: "Goblin Kites",
            delayedTriggerId: "goblin-kites-flip",
            issue: 2020,
            note: "no honest shadow script: delayed-trigger body acts on an externally-captured payload target, tracked by #2020",
        },
        {
            cardId: "c1b138e1-f8fc-435c-9aed-98004768479c",
            name: "Rainbow Vale",
            delayedTriggerId: "rainbow-vale-handoff",
            issue: 2020,
            note: "no honest shadow script: delayed-trigger body acts on an externally-captured payload target, tracked by #2020",
        },
        {
            cardId: "d721569d-9cf2-4c3c-b11c-4c46c258a0d2",
            name: "Sacred Boon",
            delayedTriggerId: "sacred-boon-counters",
            issue: 2020,
            note: "no honest shadow script: delayed-trigger body acts on an externally-captured payload target, tracked by #2020",
        },
        {
            cardId: "ab675291-3189-43f3-b11b-0724eca8b941",
            name: "Seraph",
            delayedTriggerId: "seraph-reanimate",
            issue: 2020,
            note: "no honest shadow script: delayed-trigger body acts on an externally-captured payload target, tracked by #2020",
        },
        {
            cardId: "a779aca7-ff2c-48d8-9484-6ad04b2c6bcb",
            name: "Winter's Chill",
            delayedTriggerId: "winters-chill-destroy",
            issue: 2020,
            note: "no honest shadow script: delayed-trigger body acts on an externally-captured payload target, tracked by #2020",
        },
        {
            cardId: "717c5dda-8e38-4c76-b241-685198402284",
            name: "Krovikan Vampire",
            delayedTriggerId: "krovikan-vampire-reanimate",
            issue: 2020,
            note: "no honest shadow script: delayed-trigger body acts on an externally-captured payload target, tracked by #2020",
        },
        {
            cardId: "54d7a0c1-efb4-4a8d-ad92-a96d43835052",
            name: "Necropotence",
            delayedTriggerId: "necropotence-return-to-hand",
            issue: 2020,
            note: "no honest shadow script: delayed-trigger body acts on an externally-captured payload target, tracked by #2020",
        },
        {
            cardId: "35abefe6-c39b-4fe5-b2e3-d213f0c4f447",
            name: "Norritt",
            delayedTriggerId: "norritt-destroy",
            issue: 2020,
            note: "no honest shadow script: delayed-trigger body acts on an externally-captured payload target, tracked by #2020",
        },
        {
            cardId: "fe65a045-dacb-4392-bcb6-843394ef98c9",
            name: "Barbarian Guides",
            delayedTriggerId: "barbarian-guides-bounce",
            issue: 2020,
            note: "no honest shadow script: delayed-trigger body acts on an externally-captured payload target, tracked by #2020",
        },
        {
            cardId: "de839540-a7b9-4f91-91df-3fd4f5c0bc4e",
            name: "Goblin Sappers",
            delayedTriggerId: "goblin-sappers-destroy-both",
            issue: 2020,
            note: "no honest shadow script: delayed-trigger body acts on an externally-captured payload target, tracked by #2020",
        },
        {
            cardId: "de839540-a7b9-4f91-91df-3fd4f5c0bc4e",
            name: "Goblin Sappers",
            delayedTriggerId: "goblin-sappers-destroy-target",
            issue: 2020,
            note: "no honest shadow script: delayed-trigger body acts on an externally-captured payload target, tracked by #2020",
        },
        {
            cardId: "73c07c87-0e44-4a5a-92b7-728350cd02de",
            name: "Arcum's Whistle",
            delayedTriggerId: "arcums-whistle-destroy",
            issue: 2020,
            note: "no honest shadow script: delayed-trigger body acts on an externally-captured payload target, tracked by #2020",
        },
        {
            cardId: "2bc0e8d3-633b-4281-863f-c51c69eed0b6",
            name: "Celestial Sword",
            delayedTriggerId: "celestial-sword-sacrifice",
            issue: 2020,
            note: "no honest shadow script: delayed-trigger body acts on an externally-captured payload target, tracked by #2020",
        },
        {
            cardId: "a15d33d6-7213-4482-a1be-ac0a73644af6",
            name: "Memory Jar",
            delayedTriggerId: "memory-jar-return",
            issue: 2020,
            note: "no honest shadow script: delayed-trigger body acts on an externally-captured payload target, tracked by #2020",
        },
        {
            cardId: "55707746-da6e-46e5-a5ca-7ac843fdc38e",
            name: "Phelia, Exuberant Shepherd",
            delayedTriggerId: "phelia-return",
            issue: 2020,
            note: "no honest shadow script: delayed-trigger body acts on an externally-captured payload target, tracked by #2020",
        },
    ];

describe("aiEffects shadow-script guard (issue #1431)", () => {
    it("every resolve()/resolveSteps card with no effects[] carries aiEffects, aiValue, or a well-formed allowlist entry", () => {
        const allowlistIds = new Set(AI_EFFECTS_ALLOWLIST.map((e) => e.cardId));
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

describe("aiEffects shadow-script guard — effect-shorthand cards (issue #1519)", () => {
    it("every effect-shorthand card with no effects[] carries aiEffects, aiValue, or a well-formed allowlist entry", () => {
        const allowlistIds = new Set(
            EFFECT_SHORTHAND_ALLOWLIST.map((e) => e.cardId)
        );
        const offenders: string[] = [];
        for (const card of getAllCards()) {
            if (!isEffectShorthandSpell(card)) continue;
            if (hasShadowScript(card)) continue;
            if (allowlistIds.has(card.id)) continue;
            offenders.push(`${card.id} (${card.name})`);
        }
        expect(
            offenders,
            "effect-shorthand card(s) with no effects[] and no aiEffects/aiValue — " +
                "either sketch an aiEffects shadow script (walked by the same OP_VALUERS a " +
                "real effects[] script uses), set aiValue, or — ONLY for a pre-existing " +
                "backfill straggler, never a NEW card — add a narrow " +
                "EFFECT_SHORTHAND_ALLOWLIST entry in this test file with a real disposition " +
                "(issue #1519)."
        ).toEqual([]);
    });

    it("every EFFECT_SHORTHAND_ALLOWLIST entry is well-formed and non-stale", () => {
        const cards = getAllCards();
        for (const entry of EFFECT_SHORTHAND_ALLOWLIST) {
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
                isEffectShorthandSpell(card!),
                `${entry.cardId} (${entry.name}) is no longer an effect-shorthand-only card (gained effects[] or a modes[] script) — stale allowlist entry, remove it`
            ).toBe(true);
            expect(
                hasShadowScript(card!),
                `${entry.cardId} (${entry.name}) now carries aiEffects/aiValue — stale allowlist entry, remove it`
            ).toBe(false);
        }
    });

    it("EXACT count: the allowlist covers exactly the current effect-shorthand-with-no-shadow-script residue", () => {
        const actual = getAllCards().filter(
            (c) => isEffectShorthandSpell(c) && !hasShadowScript(c)
        ).length;
        expect(
            actual,
            "the live count of effect-shorthand cards with no aiEffects/aiValue no longer " +
                "matches EFFECT_SHORTHAND_ALLOWLIST.length — either a new offender landed " +
                "(see the first test) or an allowlisted card was fixed without removing its " +
                "entry (see the second test)"
        ).toBe(EFFECT_SHORTHAND_ALLOWLIST.length);
    });
});

describe("aiEffects shadow-script guard — ability-level resolve() (issue #1519)", () => {
    it("every ability-level resolve()/resolveSteps site with no effects[] carries aiEffects, the owning card's aiValue, or a well-formed allowlist entry", () => {
        // Ability-level (activated/triggered) offenders are excused by
        // `ABILITY_AI_EFFECTS_ALLOWLIST`; `delayedTriggers[]` offenders (a
        // DISTINCT DelayedTriggerDef shape, no `abilityId` in the same
        // sense) get their OWN dedicated list, `DELAYED_TRIGGER_AI_EFFECTS_
        // ALLOWLIST` (issue #2020) — kept separate so each has its own
        // fix-or-empty-out audit trail rather than one undifferentiated
        // bucket.
        const abilityAllowlistIds = new Set(
            ABILITY_AI_EFFECTS_ALLOWLIST.map(
                (e) => `${e.cardId} ${e.abilityId}`
            )
        );
        const delayedTriggerAllowlistIds = new Set(
            DELAYED_TRIGGER_AI_EFFECTS_ALLOWLIST.map(
                (e) => `${e.cardId} ${e.delayedTriggerId}`
            )
        );
        const offenders: string[] = [];
        for (const card of getAllCards()) {
            if (card.aiValue !== undefined) continue;
            for (const ability of abilitiesOf(card)) {
                if (!isResolveOnlyAbility(ability)) continue;
                if (abilityHasShadowScript(ability)) continue;
                const key = `${card.id} ${ability.id}`;
                if (abilityAllowlistIds.has(key)) continue;
                if (delayedTriggerAllowlistIds.has(key)) continue;
                offenders.push(
                    `${card.id} (${card.name}) ability:${ability.id}`
                );
            }
        }
        expect(
            offenders,
            "activated/triggered/delayed-trigger site(s) with a bare resolve()/resolveSteps " +
                "body, no effects[]/aiEffects, and no owning-card aiValue — either sketch an " +
                "aiEffects shadow script on the site (walked by the same OP_VALUERS a real " +
                "effects[] script uses), set the card's aiValue, or — ONLY for a pre-existing " +
                "backfill straggler, never a NEW ability — add a narrow " +
                "ABILITY_AI_EFFECTS_ALLOWLIST or DELAYED_TRIGGER_AI_EFFECTS_ALLOWLIST entry in " +
                "this test file with a real disposition and a real tracking issue."
        ).toEqual([]);
    });

    it("every ABILITY_AI_EFFECTS_ALLOWLIST entry is well-formed and non-stale", () => {
        const cards = getAllCards();
        for (const entry of ABILITY_AI_EFFECTS_ALLOWLIST) {
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
            const ability = abilityOnlyOf(card!).find(
                (a) => a.id === entry.abilityId
            );
            expect(
                ability,
                `${entry.cardId} (${entry.name}) has no activated/triggered ability with id ${entry.abilityId} — stale allowlist entry, remove it`
            ).toBeDefined();
            expect(
                isResolveOnlyAbility(ability!),
                `${entry.cardId} (${entry.name}) ability ${entry.abilityId} is no longer a resolve()-only ability (gained effects[]) — stale allowlist entry, remove it`
            ).toBe(true);
            expect(
                abilityHasShadowScript(ability!),
                `${entry.cardId} (${entry.name}) ability ${entry.abilityId} now carries aiEffects — stale allowlist entry, remove it`
            ).toBe(false);
            expect(
                card!.aiValue,
                `${entry.cardId} (${entry.name}) now carries a card-level aiValue, which already plugs every ability gap — stale allowlist entry, remove it`
            ).toBeUndefined();
        }
    });

    it("EXACT count: the allowlist covers exactly the current ability-level resolve()-only-with-no-shadow-script residue", () => {
        let actual = 0;
        for (const card of getAllCards()) {
            if (card.aiValue !== undefined) continue;
            for (const ability of abilityOnlyOf(card)) {
                if (
                    isResolveOnlyAbility(ability) &&
                    !abilityHasShadowScript(ability)
                ) {
                    actual++;
                }
            }
        }
        expect(
            actual,
            "the live count of ability-level resolve()-only sites with no aiEffects (and no " +
                "owning-card aiValue) no longer matches ABILITY_AI_EFFECTS_ALLOWLIST.length — " +
                "either a new offender landed (see the first test) or an allowlisted ability " +
                "was fixed without removing its entry (see the second test)"
        ).toBe(ABILITY_AI_EFFECTS_ALLOWLIST.length);
    });
});

describe("aiEffects shadow-script guard — delayedTriggers[] residue (issue #2020)", () => {
    it("every DELAYED_TRIGGER_AI_EFFECTS_ALLOWLIST entry is well-formed and non-stale", () => {
        const cards = getAllCards();
        for (const entry of DELAYED_TRIGGER_AI_EFFECTS_ALLOWLIST) {
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
                entry.issue,
                `${entry.cardId}/${entry.delayedTriggerId} allowlist entry needs a real tracking issue number`
            ).toBeGreaterThan(0);
            const trigger = delayedTriggersOf(card!).find(
                (t) => t.id === entry.delayedTriggerId
            );
            expect(
                trigger,
                `${entry.cardId} (${entry.name}) has no delayedTriggers[] entry with id ${entry.delayedTriggerId} — stale allowlist entry, remove it`
            ).toBeDefined();
            expect(
                isResolveOnlyAbility(trigger!),
                `${entry.cardId} (${entry.name}) delayed trigger ${entry.delayedTriggerId} is no longer a resolve()-only body (gained effects[]) — stale allowlist entry, remove it`
            ).toBe(true);
            expect(
                abilityHasShadowScript(trigger!),
                `${entry.cardId} (${entry.name}) delayed trigger ${entry.delayedTriggerId} now carries aiEffects — stale allowlist entry, remove it`
            ).toBe(false);
            expect(
                card!.aiValue,
                `${entry.cardId} (${entry.name}) now carries a card-level aiValue, which already plugs every ability gap — stale allowlist entry, remove it`
            ).toBeUndefined();
        }
    });

    it("EXACT count: the allowlist covers exactly the current delayedTriggers[] resolve()-only-with-no-shadow-script residue — the list cannot silently grow", () => {
        let actual = 0;
        for (const card of getAllCards()) {
            if (card.aiValue !== undefined) continue;
            for (const trigger of delayedTriggersOf(card)) {
                if (
                    isResolveOnlyAbility(trigger) &&
                    !abilityHasShadowScript(trigger)
                ) {
                    actual++;
                }
            }
        }
        expect(
            actual,
            "the live count of delayedTriggers[] resolve()-only sites with no aiEffects (and no " +
                "owning-card aiValue) no longer matches DELAYED_TRIGGER_AI_EFFECTS_ALLOWLIST.length " +
                "— either a NEW offender landed (never allowed — a new delayed trigger must ship " +
                "with a real aiEffects shadow or the card's aiValue, not a new allowlist row) or an " +
                "allowlisted trigger was fixed without removing its entry (see the first test)"
        ).toBe(DELAYED_TRIGGER_AI_EFFECTS_ALLOWLIST.length);
    });
});

describe("aiEffects shadow-script guard — predicate correctness (fixture, issue #1519)", () => {
    // A synthetic malformed activated ability: a bare resolve() with no
    // effects[]/aiEffects and no owning-card aiValue — the exact shape the
    // catalogue-wide sweep above must never let a NEW ability slip through
    // as (issue #1519 acceptance: "Guard fails on a fixture card whose
    // activated ability has resolve() and no descriptor"). Exercised against
    // the SAME predicates the catalogue sweep uses, not a hand-rolled
    // reimplementation — a fixture-only helper would prove nothing about the
    // real guard.
    const malformedAbility: ActivatedAbility = {
        id: "fixture-malformed-ability",
        cost: { tap: true },
        oracleText: "{T}: Fixture effect with no AI descriptor.",
        useStack: true,
        resolve: () => {
            /* imperative body — deliberately opaque to the DSL walker */
        },
    };

    const fixtureCard: CardDefinition = {
        id: "fixture-card-1519",
        name: "Fixture Ability Offender",
        rarity: "common",
        types: ["Artifact"],
        activatedAbilities: [malformedAbility],
    };

    it("flags a fixture card whose activated ability has resolve() and no aiEffects/aiValue descriptor", () => {
        expect(fixtureCard.aiValue).toBeUndefined();
        const offendingAbilities = abilitiesOf(fixtureCard).filter(
            (a) => isResolveOnlyAbility(a) && !abilityHasShadowScript(a)
        );
        expect(offendingAbilities.map((a) => a.id)).toEqual([
            "fixture-malformed-ability",
        ]);
    });

    it("clears once the ability carries its own aiEffects shadow script", () => {
        const fixedCard: CardDefinition = {
            ...fixtureCard,
            activatedAbilities: [
                {
                    ...malformedAbility,
                    aiEffects: [
                        { op: "dealDamage", amount: 1, to: { target: 0 } },
                    ],
                },
            ],
        };
        const offendingAbilities = abilitiesOf(fixedCard).filter(
            (a) => isResolveOnlyAbility(a) && !abilityHasShadowScript(a)
        );
        expect(offendingAbilities).toEqual([]);
    });

    it("clears once the owning card carries an aiValue override", () => {
        const fixedCard: CardDefinition = { ...fixtureCard, aiValue: 3 };
        // The card-level aiValue override plugs every ability gap on the
        // card (see `abilityHasShadowScript` doc comment) — the sweep's
        // outer loop skips a card entirely once `card.aiValue !== undefined`.
        expect(fixedCard.aiValue).toBeDefined();
        const stillBare = abilitiesOf(fixedCard).some(
            (a) => isResolveOnlyAbility(a) && !abilityHasShadowScript(a)
        );
        // The ability itself is still "bare" in isolation...
        expect(stillBare).toBe(true);
        // ...but the sweep never reaches it because the card is skipped
        // outright once it carries an aiValue (mirrors the real guard's
        // `if (card.aiValue !== undefined) continue;`).
    });

    it("would NOT be silently allowlisted: a fresh fixture id is absent from ABILITY_AI_EFFECTS_ALLOWLIST", () => {
        expect(
            ABILITY_AI_EFFECTS_ALLOWLIST.some(
                (e) => e.cardId === fixtureCard.id
            )
        ).toBe(false);
    });
});
