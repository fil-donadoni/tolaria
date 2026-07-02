// Continuous "permanent-guard" static effects (CR 611 continuous effects).
//
// A `permanent-guard` static effect (convex/cards/types.ts `StaticPermanentGuard`)
// is a battlefield-wide protection bundle that is evaluated LIVE at each gate
// rather than timestamp-applied to the target's `staticAbilities`. This is the
// same live-query model used by `isProtectedFromColors` (CR 702.16b) and
// `isCombatDamageImmune` (Ebony Horse): the guard is queried at the moment the
// protected action is attempted, so its `applies` predicate observes the
// current board state — including mutable source state like tap status.
//
// Guardian Beast (ARN) is the first user: "As long as Guardian Beast is
// untapped, noncreature artifacts you control can't be enchanted, can't be the
// targets of spells or abilities, have indestructible, and their control can't
// be changed." The "as long as ~ is untapped" clause is why this can't reuse
// `keyword-grant`: that machinery applies/reverts on the source's
// enter/leave-the-battlefield only, never on a tap/untap transition, so a
// granted keyword would go stale. A live read of `source.isTapped` is correct
// by construction.
//
// Callers (one per guarded clause):
//   - cantBeTargeted   → rules.ts::getLegalTargets, game.ts::selectTarget
//   - cantBeEnchanted  → state.ts aura-resolution attach gate
//   - indestructible   → state.ts::regenerateOrDestroy
//   - controlCantChange→ state.ts::applyControlChange

import type { CardInstanceState } from "./state";
import type { StaticPermanentGuard } from "../cards/types";
import { STATIC_EFFECT_CTX } from "./layers";
import { tryGetDefinition } from "../cards";

/** A minimal read-only battlefield view — every game-state shape the engine
 *  passes here (fat `GameState`, projected public state) satisfies it. */
interface BattlefieldView {
    players: ReadonlyArray<{ battlefield: ReadonlyArray<CardInstanceState> }>;
}

/** The spell/ability source attempting a guarded targeting action (CR 109.5).
 *  Consulted by `cantBeTargeted` guards that narrow by the source's
 *  characteristics: card types (Artifact Ward), subtypes ("Aura spells" —
 *  Bartel Runeaxe / Tetsuo Umezawa), or spell-vs-ability ("can't be the target
 *  of spells" — Anti-Magic Aura). Unfiltered guards (Guardian Beast / shroud)
 *  ignore every field and block all sources. */
export interface GuardActionSource {
    /** Card types of the source (CR 109.5). */
    types?: ReadonlyArray<string>;
    /** Subtypes of the source (e.g. `["Aura"]` for an Aura spell). */
    subtypes?: ReadonlyArray<string>;
    /** True if the source is a spell on the stack / being cast; false for an
     *  activated or triggered ability. */
    isSpell?: boolean;
}

type GuardClause = keyof Pick<
    StaticPermanentGuard,
    | "cantBeTargeted"
    | "cantBeEnchanted"
    | "indestructible"
    | "controlCantChange"
>;

/** True if any active `permanent-guard` static effect on the battlefield bars
 *  `clause` for `target`. Scans every source permanent, reads its card
 *  definition's `staticEffects`, and evaluates each guard's `applies` predicate
 *  live (so e.g. a tapped Guardian Beast stops guarding without any re-apply
 *  hook). CR 611 — a continuous effect from a source applies only while that
 *  source is on the battlefield, which is exactly the iteration set here.
 *
 *  `actionSource` — the spell/ability source attempting the guarded action
 *  (CR 109.5). Accepts either a bare `string[]` of the source's card types
 *  (legacy callers) or a `GuardActionSource` carrying types, subtypes, and
 *  whether the source is a spell. Only consulted by `cantBeTargeted` guards
 *  that carry a source filter:
 *    - `targetSourceTypeFilter`    — Artifact Ward ("abilities from artifact
 *                                    sources"): source's TYPES must intersect.
 *    - `targetSourceSubtypeFilter` — Bartel Runeaxe / Tetsuo Umezawa ("Aura
 *                                    spells"): source's SUBTYPES must intersect.
 *    - `targetSourceMustBeSpell`   — Anti-Magic Aura ("can't be the target of
 *                                    spells"): source must be a spell.
 *  A filtered guard whose filter can't be satisfied (e.g. no source info, or
 *  an ability when the guard is spell-only) does not match and is skipped.
 *  Unfiltered guards (Guardian Beast / shroud) ignore `actionSource` entirely
 *  and block every source. */
export function isGuardedAgainst(
    state: BattlefieldView,
    target: CardInstanceState,
    clause: GuardClause,
    actionSource?: ReadonlyArray<string> | GuardActionSource
): boolean {
    const src: GuardActionSource = Array.isArray(actionSource)
        ? { types: actionSource as ReadonlyArray<string> }
        : ((actionSource as GuardActionSource | undefined) ?? {});
    for (const player of state.players) {
        for (const source of player.battlefield) {
            const cardId = (source.card as { id?: string }).id;
            const def = cardId ? tryGetDefinition(cardId) : null;
            const effects = def?.staticEffects;
            if (!effects) continue;
            for (const effect of effects) {
                if (effect.kind !== "permanent-guard") continue;
                if (!effect[clause]) continue;
                if (clause === "cantBeTargeted") {
                    // CR 109.5 source-type narrowing (Artifact Ward): a filtered
                    // guard applies only to sources whose types intersect the
                    // filter. No source types ⇒ a typed filter can't match.
                    if (effect.targetSourceTypeFilter) {
                        const types = src.types ?? [];
                        if (
                            !effect.targetSourceTypeFilter.some((t) =>
                                types.includes(t)
                            )
                        )
                            continue;
                    }
                    // CR 109.5 source-subtype narrowing ("Aura spells"): the
                    // source's subtypes must intersect the filter.
                    if (effect.targetSourceSubtypeFilter) {
                        const subtypes = src.subtypes ?? [];
                        if (
                            !effect.targetSourceSubtypeFilter.some((s) =>
                                subtypes.includes(s)
                            )
                        )
                            continue;
                    }
                    // CR 113.3 spell-only narrowing (Anti-Magic Aura): the
                    // guard ignores activated/triggered abilities. When the
                    // caller doesn't say (isSpell undefined) we don't skip, so
                    // the guard stays conservative for synthetic callers.
                    if (
                        effect.targetSourceMustBeSpell &&
                        src.isSpell === false
                    ) {
                        continue;
                    }
                }
                if (effect.applies(target, source, STATIC_EFFECT_CTX)) {
                    return true;
                }
            }
        }
    }
    return false;
}
