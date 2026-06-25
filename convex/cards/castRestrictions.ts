// Shared, frontend-safe evaluation of battlefield-scanned, player-scoped
// casting restrictions (CR 601.3a / 601.2) — Brand of Ill Omen (#669).
//
// Lives under `convex/cards/` (NOT `convex/gre/`) so the React client can call
// it directly to gray out a hand card the player can't legally cast, while the
// GRE (`getLegalActions`) and the cast mutation (`playCard` / cast path) call it
// server-side. A `cast-restriction` static declared by ANY permanent can forbid
// a player from casting a class of spell — the player-scoped analogue of how
// `global-attack-restriction` (Moat) scans all permanents to forbid attacks.
//
// Mirrors `attackRestrictions.ts`: the same shared, state-free
// `StaticEffectContext` and the same "scan every battlefield, return the first
// matching source's oracle text" shape. Read-time only: a `cast-restriction`
// never mutates a permanent (`applySourceStaticEffects` ignores the kind), so
// it carries no per-instance flag and auto-reverts when the source leaves play.

import { tryGetCardById } from ".";
import { getColorsFromCost } from "./colors";
import type {
    CardType,
    Color,
    ManaCost,
    PermanentView,
    StaticEffectContext,
} from "./types";

/** Pure, state-free `StaticEffectContext` shared by the engine and the client
 *  for cast-restriction predicates. Mirrors `ATTACK_RESTRICTION_CTX` in
 *  `attackRestrictions.ts` — only the helpers a cast-restriction predicate
 *  needs (`isCreature`, `getPrintedTypes`, `getColors`, `getName`) carry real
 *  logic; the rest delegate to the same registry lookups. */
export const CAST_RESTRICTION_CTX: StaticEffectContext = {
    getColors(card: PermanentView): Color[] {
        const override = (card as { colorOverride?: Color[] }).colorOverride;
        if (override) return override;
        const embedded = (card.card as { manaCost?: ManaCost }).manaCost;
        const cardId = (card.card as { id?: string }).id;
        const cost =
            embedded ?? (cardId ? tryGetCardById(cardId)?.manaCost : undefined);
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
        const def = cardId ? tryGetCardById(cardId) : undefined;
        return def?.supertypes?.includes(supertype as never) ?? false;
    },
    getManaValue(card: PermanentView): number {
        const embedded = (card.card as { manaCost?: ManaCost }).manaCost;
        const cardId = (card.card as { id?: string }).id;
        const cost =
            embedded ?? (cardId ? tryGetCardById(cardId)?.manaCost : undefined);
        if (!cost) return 0;
        let total = 0;
        for (const [k, v] of Object.entries(cost)) {
            if (k === "xFactor") continue;
            if (typeof v === "number") total += v;
        }
        return total;
    },
    getPrintedTypes(card: PermanentView): CardType[] {
        const cardId = (card.card as { id?: string }).id;
        const def = cardId ? tryGetCardById(cardId) : undefined;
        return (def?.types ?? []) as CardType[];
    },
    getName(card: PermanentView): string {
        const embedded = (card.card as { name?: string }).name;
        if (embedded) return embedded;
        const cardId = (card.card as { id?: string }).id;
        const def = cardId ? tryGetCardById(cardId) : undefined;
        return def?.name ?? "";
    },
};

/** Minimal board view the scan needs — each player's battlefield as
 *  `PermanentView`-compatible instances. Both `GameState` (server) and the
 *  client's `Player[]` satisfy this structurally. */
export interface CastRestrictionStateView {
    players: ReadonlyArray<{ battlefield: ReadonlyArray<PermanentView> }>;
}

/** Scans EVERY permanent on the battlefield for `cast-restriction` static
 *  effects (CR 601.3a) and returns the matching source's oracle text when one
 *  forbids `casterId` from casting `spell`, else `undefined`. Used by the GRE
 *  (`getLegalActions`), the cast mutation, and the client so all three agree on
 *  cast legality. */
export function castProhibitionReason(
    casterId: string,
    spell: PermanentView,
    state: CastRestrictionStateView
): string | undefined {
    for (const player of state.players) {
        for (const source of player.battlefield) {
            const cardId = (source.card as { id?: string }).id;
            if (!cardId) continue;
            const def = tryGetCardById(cardId);
            if (!def?.staticEffects) continue;
            for (const effect of def.staticEffects) {
                if (effect.kind !== "cast-restriction") continue;
                if (
                    effect.forbids(
                        casterId,
                        spell,
                        source,
                        state as never,
                        CAST_RESTRICTION_CTX
                    )
                ) {
                    return effect.oracleText;
                }
            }
        }
    }
    return undefined;
}
