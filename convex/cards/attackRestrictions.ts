// Shared, frontend-safe evaluation of battlefield-scanned global combat
// declaration restrictions — the per-creature attack prohibitions of CR 508.1c
// (Moat, Akron Legionnaire, #481) and the declared-set count caps of
// CR 508.1a / 509.1a (Caverns of Despair, Dueling Grounds, #1127).
//
// Lives under `convex/cards/` (NOT `convex/gre/`) so the React client can call
// it directly to gray out non-eligible attackers, while the GRE
// (`validateAttackerEligibility`) and the bot's move enumeration call it
// server-side. A `global-attack-restriction` static declared by ANY permanent
// can forbid attacks by OTHER creatures — the symmetric analogue of how
// Crusade-style anthems (`pt-buff`) scan all permanents and buff a filtered set.

import { tryGetDefinition } from ".";
import { getEffectiveColors } from "./effectiveColors";
import type {
    CardType,
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
    // CR 613.1d layer 5 — the single colour authority
    // (`./effectiveColors.ts`). It also folds in `grantedColors`, which this
    // copy used to drop: a Goblin turned black by Dralnu's Crusade must be
    // stopped by a "black creatures can't attack" restriction.
    getColors: getEffectiveColors,
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
    getCounterCount(card: PermanentView, type: string): number {
        return card.counters?.[type] ?? 0;
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

/** The binding declared-attacker / declared-blocker count cap and the Oracle
 *  sentence that imposes it. */
export interface CombatDeclarationCap {
    /** Inclusive upper bound on the number of distinct creatures declarable. */
    max: number;
    /** Rejection reason shown when the cap binds. */
    oracleText: string;
}

/** Scans EVERY permanent on the battlefield for `combat-declaration-cap` static
 *  effects on `side` (CR 508.1a attackers / 509.1a blockers) and returns the
 *  MOST RESTRICTIVE one, or `undefined` when nothing caps the declaration.
 *
 *  Each cap is an independent restriction and a declaration must obey them all,
 *  so two sources in play bind at the smaller `max` (a Dueling Grounds under a
 *  Caverns of Despair allows one attacker, not two).
 *
 *  The ONE authority every consumer reads: the incremental toggle gates in
 *  `convex/game.ts`, the confirmation-time whole-set checks
 *  (`validateDeclaredAttackers` / `validateDeclaredBlockers`, `gre/combat.ts`),
 *  the bot's declaration enumeration (`gre/moves.ts`) and the client's board
 *  affordance (`useBattlefieldVisualState`) — so the board can never gray a
 *  creature the server would accept, or offer one it would reject. Lives here
 *  rather than in `gre/` precisely so the React client can call it. */
export function combatDeclarationCap(
    state: AttackRestrictionStateView,
    side: "attack" | "block"
): CombatDeclarationCap | undefined {
    let binding: CombatDeclarationCap | undefined;
    for (const player of state.players) {
        for (const source of player.battlefield) {
            const cardId = (source.card as { id?: string }).id;
            if (!cardId) continue;
            const def = tryGetDefinition(cardId);
            if (!def?.staticEffects) continue;
            for (const effect of def.staticEffects) {
                if (effect.kind !== "combat-declaration-cap") continue;
                if (effect.side !== side) continue;
                if (binding === undefined || effect.max < binding.max) {
                    binding = {
                        max: effect.max,
                        oracleText: effect.oracleText,
                    };
                }
            }
        }
    }
    return binding;
}
