// Copy effects (CR 706, 707). A copy acquires the "copiable values" of the
// copied object — its printed characteristics as modified by other copy
// effects and copy-changing effects, NOT its counters, damage, tap state,
// attached auras/equipment, control changes, or other continuous effects
// (CR 707.2). Tolaria models this by overwriting the copy instance's
// `card.id` with the copied object's definition id, so that every
// characteristic reader in the engine (ability scans via `getDefinition`,
// colors via mana cost, P/T base, types) observes the copied object for free.
// The instance's directly-read fields (`types`, `subtypes`, `power`,
// `toughness`, `staticAbilities`) are overwritten to match. The original
// printed definition id is preserved in `copiedFrom` so the copy can be
// reverted when it leaves the battlefield.

import { getDefinition, tryGetDefinition } from "../cards";
import type { CopyEffectOptions, TriggeredAbility } from "../cards/types";
import {
    abilityLossTimestamp,
    grantOutrankedByAbilityLoss,
} from "./activatedAbilities";
import type { CardInstanceState } from "./state";

/** Re-exported alias so engine call sites import copy-option typing from the
 *  copy module alongside the functions that consume it. */
export type CopyOptions = CopyEffectOptions;

/** Reads the definition id a card instance currently presents. For a copy
 *  this is already the copied object's id (we overwrite `card.id`); for a
 *  normal permanent it is its own printed id. Use as the source of copiable
 *  values so Clone-of-Clone chains resolve to the deepest copied identity
 *  (CR 707.2 — copiable values are values as modified by other copy effects). */
export function presentedDefId(card: CardInstanceState): string {
    return (card.card as { id?: string }).id ?? "";
}

/** Applies a copy effect to `recipient`, making it a copy of `source`
 *  (CR 707.2). Overwrites the copiable characteristics; preserves the
 *  recipient's printed identity in `copiedFrom` (idempotent across Vesuvan
 *  re-copy so the anchor always points at the true printed card). */
export function applyCopy(
    recipient: CardInstanceState,
    source: CardInstanceState,
    opts: CopyOptions = {}
): void {
    const copyColor = opts.copyColor ?? true;
    const sourceDefId = presentedDefId(source);
    const def = getDefinition(sourceDefId);

    // Preserve the recipient's original printed id the first time it becomes
    // a copy; keep it stable across subsequent re-copies (Vesuvan).
    const printedId = recipient.copiedFrom ?? presentedDefId(recipient);
    recipient.copiedFrom = printedId;
    recipient.card = { ...(recipient.card as object), id: sourceDefId };

    recipient.types = [...def.types, ...(opts.additionalTypes ?? [])];
    recipient.subtypes = [
        ...(def.subtypes ?? []),
        ...(opts.additionalSubtypes ?? []),
    ];
    recipient.power = def.power;
    recipient.toughness = def.toughness;
    recipient.staticAbilities = [...(def.staticAbilities ?? [])];

    if (!copyColor) {
        // CR 707.9d "except it doesn't copy that creature's color": keep the
        // recipient's own colors via a layer-5 override.
        recipient.colorOverride = [...(opts.ownColors ?? [])];
    }

    // CR 707.2 "except" clause granting a NEW triggered ability (Phantasmal
    // Image's self-sacrifice trigger) — routed through the existing
    // anthem-style grant machinery (`grantedTriggeredAbilities`,
    // `effectiveTriggeredAbilities` below) so the trigger scan picks it up
    // with no new code path. Sourced from the recipient's OWN printed id
    // (`printedId`, just anchored above) so the ability rides the copy
    // regardless of what gets copied. Recomputed from `opts` every call —
    // same idempotency shape as `additionalTypes`/`additionalSubtypes` — by
    // dropping any prior own-sourced entries first.
    if (opts.additionalTriggeredAbilityIds) {
        const others = (recipient.grantedTriggeredAbilities ?? []).filter(
            (g) => g.sourceCardId !== printedId
        );
        const mine = opts.additionalTriggeredAbilityIds.map((abilityId) => ({
            sourceCardId: printedId,
            abilityId,
        }));
        const merged = [...others, ...mine];
        recipient.grantedTriggeredAbilities =
            merged.length > 0 ? merged : undefined;
    }
}

/** Reverts a copy when it leaves the battlefield (CR 707.2 — the copy effect
 *  lasts only while the object is on the battlefield). Restores the printed
 *  definition id and base characteristics; clears the copy anchor and any
 *  color override the copy installed. No-op for non-copies. */
export function revertCopy(card: CardInstanceState): void {
    if (!card.copiedFrom) return;
    const printedId = card.copiedFrom;
    const def = tryGetDefinition(printedId);
    card.card = { ...(card.card as object), id: printedId };
    if (def) {
        card.types = [...def.types];
        card.subtypes = [...(def.subtypes ?? [])];
        card.power = def.power;
        card.toughness = def.toughness;
        card.staticAbilities = [...(def.staticAbilities ?? [])];
    }
    // Drop any triggered-ability grant the copy effect itself installed
    // (`CopyEffectOptions.additionalTriggeredAbilityIds` — Phantasmal Image's
    // self-sacrifice trigger). Sourced from this permanent's OWN printed id,
    // so filterable independent of anthem-style grants from OTHER sources
    // (`auraId`), which are left untouched.
    if (card.grantedTriggeredAbilities) {
        const kept = card.grantedTriggeredAbilities.filter(
            (g) => g.sourceCardId !== printedId
        );
        card.grantedTriggeredAbilities = kept.length > 0 ? kept : undefined;
    }
    delete card.copiedFrom;
    delete card.colorOverride;
}

/** Triggered abilities that function for `card` while on the battlefield,
 *  including those retained through a copy effect (CR 707.9d — "except it
 *  has this ability", e.g. Vesuvan Doppelganger's upkeep re-copy). The copied
 *  object's printed triggers come from the presented def; the recipient's own
 *  printed triggers flagged `retainedThroughCopy` are unioned on top. */
export function effectiveTriggeredAbilities(
    card: CardInstanceState
): TriggeredAbility[] {
    // CR 613.1f / 613.7 — a permanent that "loses all abilities" (Titania's
    // Song, Blood Moon) loses its PRINTED triggers outright, and every trigger
    // GRANTED to it before the stripper applied; a grant with a later timestamp
    // survives. This used to return [] on any suppression, dropping later
    // grants the engine's activated-ability reader kept — the two authorities
    // disagreed about the same rule.
    const strippedAt = abilityLossTimestamp(card);
    const granted = grantedTriggeredAbilities(card, strippedAt);
    if (strippedAt !== null) return granted;
    const presented = tryGetDefinition(presentedDefId(card));
    const base = presented?.triggeredAbilities ?? [];
    if (!card.copiedFrom) return [...base, ...granted];
    const printed = tryGetDefinition(card.copiedFrom);
    const retained =
        printed?.triggeredAbilities?.filter((a) => a.retainedThroughCopy) ?? [];
    return [...base, ...retained, ...granted];
}

/** Triggered abilities granted to `card` by an anthem-style static effect
 *  (CR 113.1, 611 — Energy Flux). Each `grantedTriggeredAbilities` entry
 *  references a `triggeredGrantTemplates` template on the granting card's def;
 *  resolved here so both the trigger collector and the resolution lookup
 *  (`findTriggeredAbility`) observe the granted trigger as if it were printed
 *  on the recipient. Templates that no longer exist (def changed) are skipped. */
function grantedTriggeredAbilities(
    card: CardInstanceState,
    strippedAt: number | null
): TriggeredAbility[] {
    const grants = card.grantedTriggeredAbilities;
    if (!grants || grants.length === 0) return [];
    const out: TriggeredAbility[] = [];
    for (const grant of grants) {
        if (grantOutrankedByAbilityLoss(grant.seq, strippedAt)) continue;
        const grantingDef = tryGetDefinition(grant.sourceCardId);
        const template = grantingDef?.triggeredGrantTemplates?.find(
            (a) => a.id === grant.abilityId
        );
        if (template) out.push(template);
    }
    return out;
}

/** Resolves a single triggered ability by id for `card`, honoring abilities
 *  retained through a copy effect. Used at resolution time where the trigger
 *  stack item carries the source's overwritten `card.id` and `copiedFrom`. */
export function findTriggeredAbility(
    card: CardInstanceState,
    abilityId: string
): TriggeredAbility | undefined {
    return effectiveTriggeredAbilities(card).find((a) => a.id === abilityId);
}
