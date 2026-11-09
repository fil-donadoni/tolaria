import type { GameState } from "~/types/game";
import { deriveChoiceKey } from "~/hooks/usePendingChoiceBuffer";

/** Identity of whatever prompt is currently open on the board (issue #7425):
 *  the active Pending Choice, a payment in progress (cast / activation /
 *  attack mana tax) and the top stack item. The view-only `promptCollapsed`
 *  flag re-expands whenever this string changes, so a NEW prompt never arrives
 *  hidden behind a pill. Pure; reads only the already-public state. */
export function promptCollapseKey(
    state:
        | Pick<
              GameState,
              | "pendingChoices"
              | "pendingCast"
              | "pendingActivation"
              | "stack"
              | "combat"
          >
        | undefined
): string {
    if (!state) return "";
    const choice = deriveChoiceKey(state.pendingChoices?.[0]) ?? "";
    const cast = state.pendingCast
        ? `cast:${state.pendingCast.cardInstanceId}`
        : "";
    const activation = state.pendingActivation
        ? `act:${state.pendingActivation.cardInstanceId}`
        : "";
    const tax = state.combat?.pendingAttackManaTax ? "tax" : "";
    const top = state.stack?.[state.stack.length - 1]?.id ?? "";
    return [choice, cast, activation, tax, top].join("|");
}
