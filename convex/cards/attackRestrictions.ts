// Shared, frontend-safe evaluation of battlefield-scanned global attack
// restrictions (CR 508.1c) — Moat, Akron Legionnaire (#481).
//
// Lives under `convex/cards/` (NOT `convex/gre/`) so the React client can call
// it directly to gray out non-eligible attackers, while the GRE
// (`validateAttackerEligibility`) and the bot's move enumeration call it
// server-side. A `global-attack-restriction` static declared by ANY permanent
// can forbid attacks by OTHER creatures — the symmetric analogue of how
// Crusade-style anthems (`pt-buff`) scan all permanents and buff a filtered set.

import { tryGetDefinition } from ".";
import { getColorsFromCost } from "./colors";
import type {
    CardType,
    Color,
    ManaCost,
    PermanentView,
    StaticEffectContext,
} from "./types";

/** Pure, state-free `StaticEffectContext` shared by the engine and the client.
 *  Mirrors `STATIC_EFFECT_CTX` in `gre/layers.ts` but lives here so the React
 *  client (which must not import from `gre/`) can evaluate the same predicates.
 *  Only the helpers needed by the attack-restriction predicates are populated
 *  with real logic; the rest delegate to the same registry lookups. */
export const ATTACK_RESTRICTION_CTX: StaticEffectContext = {
    getColors(card: PermanentView): Color[] {
        const override = (card as { colorOverride?: Color[] }).colorOverride;
        if (override) return override;
        const embedded = (card.card as { manaCost?: ManaCost }).manaCost;
        const cardId = (card.card as { id?: string }).id;
        const cost =
            embedded ??
            (cardId ? tryGetDefinition(cardId)?.manaCost : undefined);
        return getColorsFromCost(cost);
    },
    isCreature(card: PermanentView): boolean {
        return card.types.includes("Creature");
    },
    hasSubtype(card: PermanentView, subtype: string): boolean {
        return card.subtypes.includes(subtype);
    },
    hasSupertype(card: PermanentView, supertype: string): boolean {
        const embedded = (card.card as { supertypes?: string[] }).supertypes;
        if (embedded) return embedded.includes(supertype);
        const cardId = (card.card as { id?: string }).id;
        const def = cardId ? tryGetDefinition(cardId) : undefined;
        return def?.supertypes?.includes(supertype as never) ?? false;
    },
    getManaValue(card: PermanentView): number {
        const embedded = (card.card as { manaCost?: ManaCost }).manaCost;
        const cardId = (card.card as { id?: string }).id;
        const cost =
            embedded ??
            (cardId ? tryGetDefinition(cardId)?.manaCost : undefined);
        if (!cost) return 0;
        let total = 0;
        for (const [k, v] of Object.entries(cost)) {
            // `xFactor` is an X-multiplier, not a mana amount — exclude it.
            if (k === "xFactor") continue;
            if (typeof v === "number") total += v;
        }
        return total;
    },
    getPrintedTypes(card: PermanentView): CardType[] {
        const cardId = (card.card as { id?: string }).id;
        const def = cardId ? tryGetDefinition(cardId) : undefined;
        return (def?.types ?? []) as CardType[];
    },
    getName(card: PermanentView): string {
        const embedded = (card.card as { name?: string }).name;
        if (embedded) return embedded;
        const cardId = (card.card as { id?: string }).id;
        const def = cardId ? tryGetDefinition(cardId) : undefined;
        return def?.name ?? "";
    },
};

/** Minimal board view the scan needs — each player's battlefield as
 *  `PermanentView`-compatible instances. Both `GameState` (server) and the
 *  client's `Player[]` satisfy this structurally. */
export interface AttackRestrictionStateView {
    players: ReadonlyArray<{ battlefield: ReadonlyArray<PermanentView> }>;
}

/** Scans EVERY permanent on the battlefield for `global-attack-restriction`
 *  static effects (CR 508.1c) and returns the matching source's oracle text
 *  when one forbids `attacker`, else `undefined`. Used by the GRE
 *  (`validateAttackerEligibility`), the bot (via the GRE), and the client
 *  (`useBattlefieldVisualState`) so all three agree on attacker legality. */
export function globalAttackProhibitionReason(
    attacker: PermanentView,
    state: AttackRestrictionStateView
): string | undefined {
    for (const player of state.players) {
        for (const source of player.battlefield) {
            const cardId = (source.card as { id?: string }).id;
            if (!cardId) continue;
            const def = tryGetDefinition(cardId);
            if (!def?.staticEffects) continue;
            for (const effect of def.staticEffects) {
                if (effect.kind !== "global-attack-restriction") continue;
                if (
                    effect.forbids(
                        attacker,
                        source,
                        state as never,
                        ATTACK_RESTRICTION_CTX
                    )
                ) {
                    return effect.oracleText;
                }
            }
        }
    }
    return undefined;
}
