// Manual battlefield interaction (PRD #2162, issue #2169) — the value injected
// into the seam `useBattlefieldInteractionContext` (#2166) opened.
//
// The GRE hook derives every field from priority, targeting, combat and payment
// state. A Manual Game has none of those (ADR 0080 — no rules are enforced), so
// each field collapses to a constant:
//
//  - `getVisualState` — no combat ring, no target glow, no dim. The tap
//    rotation is rendered by `BoardBattlefieldCard` from `card.isTapped`
//    itself, not from this state, so a tapped manual permanent still turns 90°.
//  - `handleClick` / `handleClickWithEvent` — the ONE gesture Manual Mode has:
//    tap / untap.
//  - `getActivatable` — the full manual verb list (`manual-card-verbs.ts`), so
//    the shared ability menu and its touch action sheet carry them.
//  - `clickActsWithAbilities` — the policy flag that keeps the click firing the
//    tap even though the card now has abilities (see that field's doc).
//  - `overlays` — an empty fragment: the mana picker and the validation toast
//    are GRE concepts with no manual counterpart.
//
// This is NOT a React hook: it calls no hook, so `BoardBattlefield` invoking it
// once per mounted seat is trivially rules-of-hooks safe.

import type { BattlefieldInteractionHook } from "~/hooks/useBattlefieldInteractionContext";
import type { CardVisualState } from "~/components/board/battlefield-card";
import {
    dispatchManualCardVerb,
    manualBattlefieldVerbs,
} from "./manual-card-verbs";
import type { ManualRuntime } from "./manual-runtime";

/** Neutral visual state — a manual permanent is always clickable and never
 *  carries a rules-derived ring, badge or dim. */
const MANUAL_VISUAL: CardVisualState = {
    interactive: true,
    enabled: true,
    dimmed: false,
    combatOffset: "",
    ringClass: "",
    badge: null,
};

export function makeManualBattlefieldInteraction(
    runtime: ManualRuntime
): BattlefieldInteractionHook {
    const { cardById, dispatch } = runtime;
    return () => ({
        getVisualState: () => MANUAL_VISUAL,
        canInteract: () => true,
        handleClick: (card) => {
            const manual = cardById.get(card.id);
            if (!manual) return;
            dispatch.setTapped({
                instanceId: manual.id,
                tapped: !manual.isTapped,
            });
        },
        handleClickWithEvent: (card) => {
            const manual = cardById.get(card.id);
            if (!manual) return;
            dispatch.setTapped({
                instanceId: manual.id,
                tapped: !manual.isTapped,
            });
        },
        getActivatable: (card) => {
            const manual = cardById.get(card.id);
            return manual ? manualBattlefieldVerbs(manual) : [];
        },
        handleActivateAbility: (cardInstanceId, abilityId) => {
            const manual = cardById.get(cardInstanceId);
            if (!manual) return;
            dispatchManualCardVerb(manual, abilityId, dispatch);
        },
        isSelectingOnThisBoard: false,
        overlays: <></>,
        clickActsWithAbilities: true,
    });
}
