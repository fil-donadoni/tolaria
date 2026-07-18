// Companion (CR 702.139, ADR 0064) — deck-construction condition predicates,
// the sideboard -> slot selector, and the `summon-companion` special-action
// (CR 116.2) legality predicate.
//
// A companion's condition is a `(deck) => boolean` predicate evaluated ONCE,
// at game init, against the player's MAINDECK — it is deckbuild logic, not an
// on-resolution effect, so DSL-first (ADR 0045) does not govern this module
// (issue #701 / ADR 0064). The `companion` keyword itself is a single
// Mechanics Registry row (`convex/cards/mechanicsRegistry.ts`); the per-card
// condition predicate is separate engine data, kept here.
//
// Companion is modeled as a SINGLE per-player slot (`PlayerState.companion`),
// not a general "outside the game" zone (ADR 0064) — code that enumerates
// GameState zones must not treat it as one.

import type { CardDefinition } from "../cards/types";
import { tryGetDefinition } from "../cards";
import type { GameState, PlayerState } from "./state";
import { getManaSubstitutions } from "./state";
import { isSorceryTiming } from "./phases";
import { buildAutoTapSources, solveSmartAutoTap } from "./autoTap";

/** CR 702.139a — a companion's deck-construction condition: true when `deck`
 *  (the player's maindeck, resolved to full `CardDefinition`s) satisfies it.
 *  Evaluated once at game init (`buildInitialGameState` / `buildPlayerState`
 *  in `convex/game.ts`) against the Match deck's maindeck snapshot; never
 *  re-evaluated mid-game (a Bo3 re-scans per Game, after sideboarding). */
export type CompanionCondition = (deck: readonly CardDefinition[]) => boolean;

/** CR 702.139d — Lutri, the Spellchaser's condition, MODERN Oracle wording
 *  (post-erratum, ADR "modern Scryfall Oracle text" convention): "Each
 *  nonland card in your starting deck has a different name." Unlike the
 *  original printed text ("no duplicate cards, except basic lands"), the
 *  current wording exempts EVERY land (not only basics) — only nonland cards
 *  must be unique by name. */
export const singleton: CompanionCondition = (deck) => {
    const seen = new Set<string>();
    for (const def of deck) {
        if (def.types.includes("Land")) continue;
        if (seen.has(def.name)) return false;
        seen.add(def.name);
    }
    return true;
};

/** Lutri, the Spellchaser's card id (IKO). NOT imported by the card
 *  definition (`convex/cards/sets/iko/multicolor.ts`) — that would form a
 *  real import CYCLE (multicolor.ts → this module → `../cards` registry →
 *  multicolor.ts, since `selectCompanion` below needs `tryGetDefinition`),
 *  and a circular-load object-literal property snapshot can freeze at
 *  `undefined` depending on import order. The card file keeps its own
 *  literal copy of this SAME id with a cross-reference comment; the pair is
 *  exercised end-to-end by `companion.test.ts`'s `selectCompanion` tests
 *  (which import the real `lutri` CardDefinition and assert it round-trips
 *  through the sideboard→slot selector) — a drift between the two literals
 *  would show up there as Lutri failing to auto-declare. */
export const LUTRI_ID = "fb1189c9-7842-466e-8238-1e02677d8494";

/** Per-card companion condition lookup (CR 702.139a), keyed by
 *  `CardDefinition.id`. Kept separate from the Mechanics Registry — which
 *  only tracks the `companion` KEYWORD name (CR 702) — because the condition
 *  is card-specific deckbuild logic, not part of the keyword's own binding
 *  (ADR 0064). Grows by one entry per shipped companion (Lurrus next,
 *  #1392; Zirda stays a stub pending activated-ability cost reduction). */
const COMPANION_CONDITIONS: Record<string, CompanionCondition> = {
    [LUTRI_ID]: singleton,
};

/** CR 702.139c — the sideboard -> slot selector: scans `sideboardCardIds`
 *  for a Companion-keyword card whose condition `maindeckCardIds` (resolved
 *  to full definitions) satisfies, and returns its `CardDefinition` — or
 *  `undefined` when no companion qualifies (missing keyword, unregistered
 *  condition, or a failing condition). At most one companion is ever legal
 *  per deck (each companion is itself singleton — at most one physical copy
 *  in the 100-card pool), so the first qualifying match wins. */
export function selectCompanion(
    sideboardCardIds: readonly string[],
    maindeckCardIds: readonly string[]
): CardDefinition | undefined {
    const maindeck: CardDefinition[] = [];
    for (const id of maindeckCardIds) {
        const def = tryGetDefinition(id);
        if (def) maindeck.push(def);
    }
    for (const cardId of sideboardCardIds) {
        const def = tryGetDefinition(cardId);
        if (!def) continue;
        const isCompanion = def.staticAbilities?.some(
            (a) => a.toLowerCase() === "companion"
        );
        if (!isCompanion) continue;
        const condition = COMPANION_CONDITIONS[def.id];
        if (!condition) continue;
        if (condition(maindeck)) return def;
    }
    return undefined;
}

// ---------------------------------------------------------------------------
// Summon special action (CR 116.2 / 702.139f)
// ---------------------------------------------------------------------------

/** The companion summon's fixed cost: generic {3} (CR 702.139f), normalized
 *  the same way every other mana cost in the engine is (`{ X: N }` for the
 *  generic portion) so it can be handed straight to `solveSmartAutoTap`/
 *  `payManaCost`. */
export const COMPANION_SUMMON_COST: Record<string, number> = { X: 3 };

/** CR 116.2 / 702.139f — true iff `player` may currently take the
 *  `summon-companion` special action: their own main phase, empty stack,
 *  holding priority, with no other action already in progress, an unused
 *  companion in the slot, and {3} affordable via the shared auto-tap solver
 *  (the same one `pendingCast` payments use, ADR 0064). Special actions
 *  don't use the stack (CR 116.2a) and may be taken only when a player has
 *  priority AND isn't mid-payment on something else — mirrors the "ordinary
 *  priority window" gate `enumerateMoves` (moves.ts) applies before offering
 *  any other macro-move. Single source of truth shared by the enumerator
 *  (moves.ts), the legal-actions surface (legalActions.ts, via moves.ts),
 *  and the authoritative `summonCompanion` mutation (game.ts). */
export function canSummonCompanion(
    state: GameState,
    player: PlayerState
): boolean {
    if (!player.companion || player.companion.used) return false;
    if (state.priorityPlayerId !== player.id) return false;
    if (!isSorceryTiming(state)) return false;
    if (
        state.pendingCast ||
        state.pendingActivation ||
        state.pendingCompanionPay ||
        state.pendingTarget ||
        (state.pendingChoices && state.pendingChoices.length > 0)
    ) {
        return false;
    }
    const subs = getManaSubstitutions(state, player.id);
    const sources = buildAutoTapSources(player.battlefield);
    return (
        solveSmartAutoTap(
            player.manaPool,
            COMPANION_SUMMON_COST,
            subs,
            sources
        ) !== null
    );
}
