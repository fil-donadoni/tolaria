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
import { tryGetCardById } from "../cards";

/** A minimal read-only battlefield view — every game-state shape the engine
 *  passes here (fat `GameState`, projected public state) satisfies it. */
interface BattlefieldView {
    players: ReadonlyArray<{ battlefield: ReadonlyArray<CardInstanceState> }>;
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
 *  `actionSourceTypes` — the card types of the spell/ability source attempting
 *  the guarded action (CR 109.5). Only consulted by guards that carry a
 *  `targetSourceTypeFilter` (Artifact Ward's "abilities from artifact
 *  sources"): such a guard applies only when the source's types intersect the
 *  filter. Unfiltered guards (Guardian Beast) ignore this argument and block
 *  every source. */
export function isGuardedAgainst(
    state: BattlefieldView,
    target: CardInstanceState,
    clause: GuardClause,
    actionSourceTypes?: ReadonlyArray<string>
): boolean {
    for (const player of state.players) {
        for (const source of player.battlefield) {
            const cardId = (source.card as { id?: string }).id;
            const def = cardId ? tryGetCardById(cardId) : null;
            const effects = def?.staticEffects;
            if (!effects) continue;
            for (const effect of effects) {
                if (effect.kind !== "permanent-guard") continue;
                if (!effect[clause]) continue;
                // CR 109.5 source-type narrowing (Artifact Ward): a filtered
                // `cantBeTargeted` guard applies only to sources whose types
                // intersect the filter. With no source types provided (e.g.
                // synthetic / non-targeting callers) a filtered guard can't
                // match and is skipped.
                if (
                    clause === "cantBeTargeted" &&
                    effect.targetSourceTypeFilter
                ) {
                    const types = actionSourceTypes ?? [];
                    const intersects = effect.targetSourceTypeFilter.some((t) =>
                        types.includes(t)
                    );
                    if (!intersects) continue;
                }
                if (effect.applies(target, source, STATIC_EFFECT_CTX)) {
                    return true;
                }
            }
        }
    }
    return false;
}
