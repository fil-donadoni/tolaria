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

import { tryGetDefinition } from ".";
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
export interface CastRestrictionStateView {
    players: ReadonlyArray<{ battlefield: ReadonlyArray<PermanentView> }>;
    /** CR 601.3a / 514.2 — players under a turn-scoped "can't cast spells this
     *  turn" lock (Xantid Swarm, issue #1057; Abeyance narrows it via
     *  `cardTypes`, issue #1124). A per-player turn flag set by an effect and
     *  cleared at CLEANUP — distinct from the battlefield-scanned,
     *  permanent-sourced `cast-restriction` statics below. Survives the wire
     *  projection (`projectPublicState` spreads it), so the client's cast gate
     *  reads it too. An omitted/empty `cardTypes` forbids every spell. */
    cannotCastSpellsThisTurn?: ReadonlyArray<{
        playerId: string;
        cardTypes?: readonly CardType[];
    }>;
    /** CR 601.3e (Teferi, Time Raveler +1) — per-player "cast spells of these
     *  types as though they had flash" grants. Read by `hasCastTimingFlashGrant`
     *  to widen a sorcery-speed card's timing window. Survives the wire
     *  projection (`projectPublicState` spreads it), so the client's cast gate
     *  reads it too. An omitted/empty `cardTypes` grants flash for every spell. */
    castTimingFlashGrants?: ReadonlyArray<{
        playerId: string;
        cardTypes?: readonly CardType[];
    }>;
}

/** Scans EVERY permanent on the battlefield for `cast-timing-lock` static
 *  effects (CR 601.3a — Teferi, Time Raveler's static: "Each opponent can cast
 *  spells only any time they could cast a sorcery") and returns `true` when one
 *  restricts `casterId` to sorcery-speed casting. The TIMING analogue of
 *  `castProhibitionReason` (which forbids a CLASS of spell). Used by the GRE
 *  (`getLegalActions`), the cast mutation, and the client so all three agree.
 *  The lock narrows WHEN a spell can be cast; the caller (`getLegalActions`)
 *  combines it with the phase/stack/priority timing check it already has. */
export function isCastTimingSorcerySpeedLocked(
    casterId: string,
    state: CastRestrictionStateView
): boolean {
    for (const player of state.players) {
        for (const source of player.battlefield) {
            const cardId = (source.card as { id?: string }).id;
            if (!cardId) continue;
            const def = tryGetDefinition(cardId);
            if (!def?.staticEffects) continue;
            for (const effect of def.staticEffects) {
                if (effect.kind !== "cast-timing-lock") continue;
                if (
                    effect.locks(
                        casterId,
                        source,
                        state as never,
                        CAST_RESTRICTION_CTX
                    )
                ) {
                    return true;
                }
            }
        }
    }
    return false;
}

/** CR 601.3e — `true` when `casterId` holds a `castTimingFlashGrant` (Teferi's
 *  +1) covering `spell`: an entry for that player whose `cardTypes` intersect
 *  the spell's printed types (or an entry with no `cardTypes`, covering every
 *  spell). Lets the caller treat an otherwise sorcery-speed spell as if it had
 *  flash. */
export function hasCastTimingFlashGrant(
    casterId: string,
    spell: PermanentView,
    state: CastRestrictionStateView
): boolean {
    const grants = state.castTimingFlashGrants;
    if (!grants) return false;
    const printedTypes = CAST_RESTRICTION_CTX.getPrintedTypes(spell);
    for (const g of grants) {
        if (g.playerId !== casterId) continue;
        if (!g.cardTypes || g.cardTypes.some((t) => printedTypes.includes(t))) {
            return true;
        }
    }
    return false;
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
    // CR 601.3a (issue #1057) — a turn-scoped per-player cast lock (Xantid
    // Swarm: "defending player can't cast spells this turn"; Abeyance, issue
    // #1124, narrows it to instant/sorcery via `cardTypes`). Unlike the
    // permanent-sourced statics scanned below, this is a PlayerState-turn flag
    // set by an effect and cleared at CLEANUP (CR 514.2), so it is checked
    // directly rather than via a battlefield scan. Lands are unaffected —
    // rules.ts only calls this on the spell-cast path, never on land plays.
    const lock = state.cannotCastSpellsThisTurn?.find(
        (e) => e.playerId === casterId
    );
    if (lock) {
        const printedTypes = CAST_RESTRICTION_CTX.getPrintedTypes(spell);
        if (
            !lock.cardTypes ||
            lock.cardTypes.some((t) => printedTypes.includes(t))
        ) {
            return "That player can't cast spells this turn.";
        }
    }
    for (const player of state.players) {
        for (const source of player.battlefield) {
            const cardId = (source.card as { id?: string }).id;
            if (!cardId) continue;
            const def = tryGetDefinition(cardId);
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
