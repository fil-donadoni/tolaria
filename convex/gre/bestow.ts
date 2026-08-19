// Bestow (CR 702.103) — the FIRST cast mode in this engine that changes the
// spell's own CHARACTERISTICS, not just its cost.
//
// CR 702.103a: "Bestow [cost]" means "As you cast this spell, you may choose
//   to cast it bestowed. If you do, you pay [cost] rather than its mana cost."
//   Casting a spell using its bestow ability follows the rules for paying
//   alternative costs (see 601.2b and 601.2f–h).
// CR 702.103b: As a spell cast bestowed is put onto the stack, it becomes an
//   Aura enchantment and gains enchant creature. It is a bestowed Aura spell,
//   and the permanent it becomes as it resolves will be a bestowed Aura. These
//   effects last until the spell or the permanent it becomes ceases to be
//   bestowed. Because the spell is an Aura spell, its controller must choose a
//   legal target for that spell as defined by its enchant creature ability.
// CR 702.103e: As a bestowed Aura spell begins resolving, if its target is
//   illegal, it ceases to be bestowed and the effect making it an Aura spell
//   ends. It continues resolving as a creature spell (CR 608.3b).
// CR 702.103f: If a bestowed Aura becomes unattached, it ceases to be
//   bestowed. If a bestowed Aura is attached to an illegal object or player,
//   it becomes unattached and ceases to be bestowed. This is an exception to
//   rule 704.5m.
//
// SPLIT OF RESPONSIBILITY, mirroring the shipped keyword-cast precedents:
//
//  - the COST half is not here at all. `CardDefinition.bestow` reuses the
//    `AlternativeCost` shape (CR 118.9 already governs paying it, CR 702.103a
//    says so explicitly) exactly the way `CardDefinition.evoke` (CR 702.74a)
//    and `CardDefinition.dash` (CR 702.109a) do, and is resolved by
//    `convex/gre/alternativeCost.ts`'s `getAlternativeCost` /
//    `affordableAlternativeCosts` alongside the generic `alternativeCosts[]`
//    array. Nothing about paying a bestow cost is special.
//
//  - the CHARACTERISTIC half is this file, and it is what has no precedent.
//    Type/subtype changes in this engine are DIRECT IN-PLACE MUTATION of
//    `card.types` / `card.subtypes` (the `transform.ts` / `animateAsCreature`
//    idiom — `gre/layers.ts` is P/T-only and has no layer-4 machinery), so a
//    bestow cast mutates the stack item and `revertBestow` splices the
//    mutation back out. `revertBestow` restores from the CARD DEFINITION
//    rather than from a saved anchor, exactly as `clearZoneCharacteristics`
//    does: the printed type line is the only thing bestow overwrote, and
//    reading it back off the (possibly copy-rewritten) `card.id` keeps a
//    Clone-style identity swap consistent.

import type {
    AlternativeCost,
    CardDefinition,
    CardType,
    EnchantRestriction,
    TargetRequirement,
} from "../cards/types";
import { tryGetDefinition } from "../cards/registry";
import { composeMaterializedSubtypes, isCreature } from "./constants";
import type { CardInstanceState, GameState } from "./state";

/** CR 702.103b — the enchant ability a bestowed spell GAINS ("enchant
 *  creature"). Stamped onto the instance as `grantedEnchantRestriction`, the
 *  same runtime-grant channel a Necromancy-style "it becomes an Aura with
 *  enchant creature" effect uses, so the CR 303.4c / 704.5m attachment
 *  legality sites (`resolveEnchantRestriction`, `hostMatchesEnchantRestriction`)
 *  read it with no bestow-specific code. */
export const BESTOW_ENCHANT_RESTRICTION: EnchantRestriction = {
    types: ["Creature"],
    players: false,
};

/** CR 702.103b / 303.4a / 601.2c — the target requirement a bestowed cast
 *  takes on, derived from the gained "enchant creature" ability. Replaces the
 *  card's own `targetRequirement` (a bestow creature has none) for the
 *  duration of that cast — the same "a cast-time choice swaps the target
 *  requirement" shape `CardDefinition.kickedTargetRequirement` already has
 *  (CR 702.33). */
export const BESTOW_TARGET_REQUIREMENT: TargetRequirement = {
    type: "Creature",
    count: 1,
};

/** CR 702.103a — is `altCost` THIS card's bestow cost? Compared by REFERENCE,
 *  the same discriminator `announceCast` uses for `def.evoke` / `def.dash`:
 *  `getAlternativeCost` hands back the very object stored on the definition,
 *  so identity is exact and no id string has to be agreed on twice. */
export function isBestowAlternativeCost(
    def: CardDefinition | undefined,
    altCost: AlternativeCost | undefined
): boolean {
    return altCost !== undefined && def?.bestow === altCost;
}

/** CR 702.103b — apply the bestow characteristic change to a spell being put
 *  onto the stack.
 *
 *  CR 205.1a governs the shape: "the new card type(s) replaces any existing
 *  card types … when an effect sets one or more of an object's subtypes, the
 *  new subtype(s) replaces any existing subtypes from the appropriate set."
 *  So a bestowed Springheart Nantuko is an `Enchantment — Aura`, NOT an
 *  `Enchantment Creature — Insect Monk Aura`: it is not a creature while
 *  bestowed (which is also what makes CR 303.4d's "an Aura that's also a
 *  creature can't enchant anything" a non-issue), and it has no power or
 *  toughness.
 *
 *  Idempotent: a card already marked `bestowed` is left alone, so a re-walked
 *  commit path can never double-apply.
 *
 *  NOTE the marker is `bestowed?: true` on `CardInstanceState`, NOT on
 *  `StackItem` — a stack item IS its `CardInstanceState`, and the marker must
 *  ride onto the permanent the spell becomes (CR 702.103b: "the permanent it
 *  becomes as it resolves will be a bestowed Aura"), exactly like `escaped`
 *  (CR 702.138b) and `dashed` (CR 702.109a) already do. */
export function applyBestowCharacteristics(card: CardInstanceState): void {
    if (card.bestowed) return;
    card.bestowed = true;
    card.types = ["Enchantment"];
    card.subtypes = ["Aura"];
    card.power = undefined;
    card.toughness = undefined;
    card.grantedEnchantRestriction = { ...BESTOW_ENCHANT_RESTRICTION };
}

/** CR 702.103e / 702.103f — the object CEASES to be bestowed: the effect
 *  making it an Aura ends and its printed type line comes back.
 *
 *  Called from every boundary at which a bestowed object stops being one:
 *   - CR 702.103e / 608.3b — a bestowed Aura SPELL whose target is illegal as
 *     it begins resolving (`finalizeSpellResolution`): it continues resolving
 *     as a CREATURE spell rather than fizzling.
 *   - CR 702.103f — a bestowed Aura PERMANENT that becomes unattached or is
 *     attached to an illegal object (`checkAuraAttachmentSBA`, the documented
 *     exception to CR 704.5m): it stays on the battlefield as a creature.
 *   - CR 400.7 — every zone change that makes it a new object:
 *     `resetStackTransientState` (a countered / redirected spell leaving the
 *     stack), `removePermanentTo` (a permanent leaving the battlefield) and
 *     `resetBattlefieldTransientState` (the shared entry-side reset).
 *
 *  Restores from the card DEFINITION, not from a saved anchor — see the file
 *  header. A no-op on an object that is not bestowed, and on one whose card id
 *  no longer resolves (synthetic test fixtures), which is why the marker is
 *  cleared unconditionally first.
 *
 *  CR 613.1d — the printed line is the layer-1 BASE, not the answer. On the
 *  CR 702.103f road the object stays on the battlefield, so any layer-4
 *  card-type / subtype effect from a source that is still there still applies
 *  and has to be replayed over the restored base — a bare assignment would
 *  silently drop a `type-add` while leaving its `grantedTypes` origin entry
 *  behind, so the materialized line and its own provenance record would
 *  disagree (and the entry's later unapply would "remove" a type that is no
 *  longer there). Same replay-over-a-new-base shape, and for the same reason,
 *  as `gre/identitySwap.ts`'s `replayLayer4Types` / `replayLayer4Subtypes`
 *  after a copy-identity swap. */
export function revertBestow(card: CardInstanceState): void {
    if (!card.bestowed) return;
    delete card.bestowed;
    delete card.grantedEnchantRestriction;
    card.attachedTo = undefined;
    const cardId = (card.card as { id?: string } | undefined)?.id;
    const def = cardId ? tryGetDefinition(cardId) : undefined;
    if (!def) return;
    card.power = def.power;
    card.toughness = def.toughness;
    // Layer 4 (CR 613.1d), additive then subtractive — the `grantedTypes` /
    // `suppressedTypes` surrogates are keyed by SOURCE and name the type
    // itself, so they are identity-independent and replay verbatim.
    const types: CardType[] = [...def.types];
    for (const granted of card.grantedTypes ?? []) {
        const type = granted.type as CardType;
        if (!types.includes(type)) types.push(type);
    }
    for (const suppressed of card.suppressedTypes ?? []) {
        const idx = types.indexOf(suppressed.type as CardType);
        if (idx !== -1) types.splice(idx, 1);
    }
    card.types = types;
    // CR 305.7 / 613.7 — subtypes go through the ONE composer, whose layer-1
    // anchor is `printedSubtypes`; re-anchor it on the printed line first (the
    // bestow mutation may have been the value it was captured from).
    const printedSubtypes = [...(def.subtypes ?? [])];
    card.subtypes = printedSubtypes;
    if (card.printedSubtypes) card.printedSubtypes = [...printedSubtypes];
    card.subtypes = composeMaterializedSubtypes(card);
}

/** CR 601.2c / 702.103b — is there any creature a bestowed cast could legally
 *  target right now? Gates whether the bestow variant is OFFERED at all
 *  (`affordableAlternativeCosts`), so the cast-option picker never shows a
 *  mode `announceCast` would reject for having no legal target.
 *
 *  Deliberately a coarse "is there a creature on any battlefield" scan rather
 *  than a full `getLegalTargets` run: this predicate is on a CLIENT RENDER
 *  path (`affordableAltCostsForCard`, ADR 0074) where the viewer-projected
 *  state carries no targeting source, and the authoritative per-target gate
 *  (shroud / protection / `cantBeEnchanted`, CR 608.2b) still runs at
 *  announcement and again at resolution. Scanning BOTH battlefields is
 *  correct: "enchant creature" names no controller. */
export function hasLegalBestowHost(state: GameState): boolean {
    return state.players.some((p) => p.battlefield.some((c) => isCreature(c)));
}
