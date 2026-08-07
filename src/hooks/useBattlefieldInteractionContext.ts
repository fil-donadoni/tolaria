import { createContext, useContext } from "react";
import type { Player } from "~/types/game";
import { useBattlefieldInteraction } from "~/hooks/useBattlefieldInteraction";

/** The shape `useBattlefieldInteraction` returns — the single source of truth
 *  for what a battlefield interaction hook must produce, so an injected
 *  substitute (the Manual Game, PRD #2162) is checked against the real one by
 *  the type system rather than by convention. */
export type BattlefieldInteractionResult = ReturnType<
    typeof useBattlefieldInteraction
> & {
    /** Click POLICY for a permanent that also carries activatable abilities
     *  (issue #2169). The GRE hook never sets it, so it is `undefined` there
     *  and `BoardBattlefieldCard` keeps today's rule verbatim: when a
     *  permanent has abilities, a left click opens the ability menu and the
     *  card's own tap/pay handler is deliberately NOT bound ("a permanent that
     *  has both a tap and an ability is never tapped by a stray click" —
     *  `useAbilityCardClick`).
     *
     *  A Manual Game inverts that: EVERY permanent carries the full manual
     *  verb list, and tapping is the primary gesture, so suppressing the click
     *  would leave a manual board with no way to tap at all. Setting this
     *  makes a desktop left click fire the card's own click handler AND still
     *  bubble to the menu trigger — exactly what the hand-written manual board
     *  did before the swap. Touch is unaffected: the tap still opens the
     *  action sheet. */
    clickActsWithAbilities?: boolean;
};

/** A battlefield interaction hook: a function of the seat's `Player` that
 *  returns {@link BattlefieldInteractionResult}. The context carries the HOOK
 *  ITSELF, never its result — `BoardBattlefield` mounts once per seat behind
 *  `BoardSurface`'s `{opponent && …}` / `{me && …}` conditionals, so the call
 *  must happen unconditionally inside `BoardBattlefield`'s own render, at the
 *  exact spot the real hook is called today. Hoisting a pre-computed RESULT up
 *  into `BoardSurface` would put a hook call behind those conditionals and
 *  break the rules-of-hooks contract the moment a seat appears or disappears
 *  mid-game (issue #2166). */
export type BattlefieldInteractionHook = (
    player: Player
) => BattlefieldInteractionResult;

/** `null` (no provider) means "use the real hook" — see
 *  {@link useBattlefieldInteractionHook}. */
const BattlefieldInteractionContext =
    createContext<BattlefieldInteractionHook | null>(null);

/** Supplies an alternate battlefield interaction hook to every
 *  `BoardBattlefield` beneath it (the Manual Game, PRD #2162 — not wired by
 *  this issue). Absent, `BoardBattlefield` falls back to the real
 *  {@link useBattlefieldInteraction}, byte-for-byte today's behaviour. */
export const BattlefieldInteractionProvider =
    BattlefieldInteractionContext.Provider;

/** Returns the interaction hook `BoardBattlefield` must call — the
 *  provider-supplied one when present, else the real
 *  {@link useBattlefieldInteraction}. The CALLER is responsible for invoking
 *  the returned function unconditionally, once, at its own top level: this
 *  hook only selects WHICH function to call, it never calls it. */
export function useBattlefieldInteractionHook(): BattlefieldInteractionHook {
    const injected = useContext(BattlefieldInteractionContext);
    return injected ?? useBattlefieldInteraction;
}
