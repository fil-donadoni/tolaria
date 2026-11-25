// The single authority on what an ACTIVATED-ABILITY stack item looks like
// (CR 602.2a) and on recording one activation against its source (CR 602.5).
//
// Why one module rather than an object literal per site: the ability's stack
// item is built at FOUR commit sites — three on the authoritative mutation path
// (the immediate no-target commit and the deferred
// `tryAutoCommitPendingActivation` commit, both `convex/gre/activation.ts`;
// the targeted `finalizeTargetSelection` commit, `convex/game.ts`) and, since
// issue #1920, one in the
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

import { announcedModeFields } from "./modeSelection";
import type { CardInstanceState, GameState, StackItem } from "./state";
import type { TargetSelection } from "../cards/types";
import {
    getEffectiveActivatedAbilities,
    type GrantedAbilityOrigin,
} from "./activatedAbilities";
import { recordExhaust } from "./exhaust";
import { emitAbilityActivated } from "./state";
import { stackTransformStamp } from "./transform";

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
    /** CR 700.2a / 602.2b (ADR 0094) — modes chosen for a modal ability
     *  (Umezawa's Jitte), printed order, with their per-instance target spans. */
    chosenModeIds?: string[];
    modeTargetCounts?: number[];
    /** CR 107.3 / 601.2b — value chosen for X in the activation cost. */
    chosenX?: number;
    /** CR 113.1 — the granting card's def id when the ability was granted to
     *  the source by another card (Zombie Master's regenerate). */
    grantedSourceCardId?: string;
    /** CR 113.1 — WHICH list on that def holds the template (issue #2943):
     *  omitted for `grantTemplates[]`, `"card-abilities"` for an ability-COPY
     *  grant (Agatha's Soul Cauldron). Without it `resolveTopOfStack` looks in
     *  the wrong list and the item pops as a no-op — the #2468 failure, one
     *  field over. */
    grantedAbilityOrigin?: GrantedAbilityOrigin;
    /** CR 118.8 / 601.2f — snapshot of the permanent sacrificed as an
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
    // The clone is the item: the commit's fields are written onto it, never
    // spread into a second copy (the search commits an activation per
    // applied move, and SpiderMonkey runs an object spread as a self-hosted
    // `CopyDataProperties`). A write to a key the source already holds keeps
    // its position and a new key appends, exactly as the spread ordered them.
    const item = structuredClone(source) as StackItem;
    item.zone = "stack";
    item.castById = commit.castById;
    item.abilityId = commit.abilityId;
    if (commit.targets !== undefined) item.targets = commit.targets;
    if (commit.targetAmounts) item.targetAmounts = commit.targetAmounts;
    const modes = announcedModeFields(commit);
    if (modes.chosenModeIds) item.chosenModeIds = modes.chosenModeIds;
    if (modes.modeTargetCounts) item.modeTargetCounts = modes.modeTargetCounts;
    if (commit.chosenX !== undefined) item.chosenX = commit.chosenX;
    if (commit.grantedSourceCardId) {
        item.grantedSourceCardId = commit.grantedSourceCardId;
    }
    if (commit.grantedAbilityOrigin) {
        item.grantedAbilityOrigin = commit.grantedAbilityOrigin;
    }
    if (commit.additionalSacrificeSnapshot) {
        item.additionalSacrificeSnapshot = commit.additionalSacrificeSnapshot;
    }
    if (commit.notedManaSpent) item.notedManaSpent = commit.notedManaSpent;
    // CR 701.27f (issue #3537) — the moment this ability is put onto the
    // stack, as its source and that source's transform count.
    item.stackTransformStamp = stackTransformStamp(source);
    return item;
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
    // CR 702.177a — an exhaust ability is spent for good by its activation.
    recordExhaust(
        card,
        getEffectiveActivatedAbilities(card).find(
            (entry) => entry.ability.id === abilityId
        )?.ability
    );
    // CR 602.1 — non-{T} activated abilities emit ABILITY_ACTIVATED so
    // "tapped or non-tap ability activated" punishers (Haunting Wind,
    // Powerleech, Artifact Possession) can react. {T} abilities are covered by
    // PERMANENT_TAPPED instead, avoiding a double trigger.
    if (!taps) {
        emitAbilityActivated(state, card, abilityId);
    }
}
