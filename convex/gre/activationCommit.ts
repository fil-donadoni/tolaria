// The single authority on what an ACTIVATED-ABILITY stack item looks like
// (CR 602.2a) and on recording one activation against its source (CR 602.5).
//
// Why one module rather than an object literal per site: the ability's stack
// item is built at FOUR commit sites — three on the authoritative mutation path
// (`convex/game.ts`: the immediate no-target commit, the targeted
// `finalizeTargetSelection` commit, and the deferred
// `tryAutoCommitPendingActivation` commit) and, since issue #1920, one in the
// ISMCTS search's move sandbox (`applyMoveInSearch`, `gre/search.ts`).
// `resolveTopOfStack` reads these fields to build the ability's `SpellContext`,
// so a search-side item of a DIFFERENT shape makes the tree optimise a fiction
// that live play will not reproduce — the search would score a mode, an X, or a
// noted-mana battery the server resolves differently. Four hand-copied literals
// are exactly how that drift arrives, silently, so the shape lives here and
// every site spreads it.
//
// PURE: `buildActivatedAbilityStackItem` returns a fresh item and never mutates
// its inputs; `recordActivation` mutates only the card it is handed (plus the
// state's pending-trigger queue, via the shared emitter).

import type { CardInstanceState, GameState, StackItem } from "./state";
import type { TargetSelection } from "../cards/types";
import { emitAbilityActivated } from "./state";

/** Everything an activation contributes to its stack item BEYOND the source
 *  permanent's own snapshot. Every field is optional except the two that make
 *  the item an activated ability at all (`castById` / `abilityId`), and each
 *  optional one is omitted from the built item when absent — so the item a
 *  no-frills `{T}` activation produces carries exactly two extra keys, as it
 *  did when each commit site wrote its own literal. */
export type ActivatedAbilityCommit = {
    /** CR 602.1 — the ACTIVATING player, which is not necessarily the source's
     *  controller ("any player may activate", CR 113.3c). */
    castById: string;
    abilityId: string;
    /** Targets locked in at announcement (CR 602.2b). Passed through when
     *  defined — including an explicitly empty tuple, which the targeted commit
     *  path relies on — and omitted entirely when `undefined`. */
    targets?: TargetSelection[];
    /** CR 601.2d / 120.4 — divide-as-you-choose split (Arc Mage). */
    targetAmounts?: Record<string, number>;
    /** CR 700.2 / 602.2b — mode chosen for a modal ability (Umezawa's Jitte). */
    chosenModeId?: string;
    /** CR 107.3 / 601.2b — value chosen for X in the activation cost. */
    chosenX?: number;
    /** CR 113.1 — the granting card's def id when the ability was granted to
     *  the source by another card (Zombie Master's regenerate). */
    grantedSourceCardId?: string;
    /** CR 117.9 / 601.2f — snapshot of the permanent sacrificed as an
     *  additional cost, captured at commit because it is gone by resolution. */
    additionalSacrificeSnapshot?: StackItem["additionalSacrificeSnapshot"];
    /** CR 106.10 — the mana-pool delta noted for a battery (Jeweled Amulet). */
    notedManaSpent?: Record<string, number>;
};

/** Build the stack item for one activated ability (CR 602.2a): a snapshot of
 *  the source permanent plus the announcement data, in the stack zone.
 *
 *  The snapshot is a `structuredClone` because the SOURCE stays where it is —
 *  on the battlefield (or, for a sacrifice/exile cost, already gone) — while
 *  the item on the stack must keep the characteristics the ability was
 *  activated with (CR 608.2h last-known information). Callers therefore pass
 *  the source AFTER paying costs, exactly as the mutation path does, so a
 *  self-sacrifice is reflected in the snapshot identically on both paths. */
export function buildActivatedAbilityStackItem(
    source: CardInstanceState,
    commit: ActivatedAbilityCommit
): StackItem {
    return {
        ...structuredClone(source),
        zone: "stack" as const,
        castById: commit.castById,
        abilityId: commit.abilityId,
        ...(commit.targets !== undefined ? { targets: commit.targets } : {}),
        ...(commit.targetAmounts
            ? { targetAmounts: commit.targetAmounts }
            : {}),
        ...(commit.chosenModeId ? { chosenModeId: commit.chosenModeId } : {}),
        ...(commit.chosenX !== undefined ? { chosenX: commit.chosenX } : {}),
        ...(commit.grantedSourceCardId
            ? { grantedSourceCardId: commit.grantedSourceCardId }
            : {}),
        ...(commit.additionalSacrificeSnapshot
            ? {
                  additionalSacrificeSnapshot:
                      commit.additionalSacrificeSnapshot,
              }
            : {}),
        ...(commit.notedManaSpent
            ? { notedManaSpent: commit.notedManaSpent }
            : {}),
    };
}

/** Records one activation of `abilityId` against `card` for the current turn
 *  (CR 602.5 — `oncePerTurn` enforcement) and emits the cluster-B
 *  `ABILITY_ACTIVATED` event for non-{T} abilities (CR 602.1). Initialises the
 *  counter map on first activation. Called at every activation commit site —
 *  the single shared anchor, so every path (immediate, targeted, deferred
 *  payment, and the search sandbox) fires the event exactly once.
 *
 *  The event is emitted only when the ability has NO {T} component: a {T}
 *  ability already emitted `PERMANENT_TAPPED` from its tap, and the two events
 *  are complements (see `AbilityActivatedEvent` doc). Passing `taps` makes the
 *  gate explicit at every call site.
 *
 *  The search sandbox calls this too (issue #1920): the tally is read by the
 *  move enumerator's once-per-turn gate (`moves.ts`) and by card-declared
 *  `canActivate` predicates, so a search that pushed the ability without
 *  recording it would let a rollout re-activate a once-per-turn ability without
 *  limit and over-rate it. */
export function recordActivation(
    state: GameState,
    card: CardInstanceState,
    abilityId: string,
    taps: boolean
): void {
    const map: Record<string, number> = card.activationsThisTurn ?? {};
    map[abilityId] = (map[abilityId] ?? 0) + 1;
    card.activationsThisTurn = map;
    // CR 602.1 — non-{T} activated abilities emit ABILITY_ACTIVATED so
    // "tapped or non-tap ability activated" punishers (Haunting Wind,
    // Powerleech, Artifact Possession) can react. {T} abilities are covered by
    // PERMANENT_TAPPED instead, avoiding a double trigger.
    if (!taps) {
        emitAbilityActivated(state, card, abilityId);
    }
}
