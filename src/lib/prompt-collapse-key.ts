import type {
    PendingActivation,
    PendingCast,
    PendingChoice,
} from "~/types/game";
import { deriveChoiceKey } from "~/hooks/usePendingChoiceBuffer";

/** The slice of game state the key reads (structural, so the public and the
 *  full projection both fit). */
export type PromptCollapseSource = {
    pendingChoices?: PendingChoice[] | null;
    pendingCast?: PendingCast | null;
    pendingActivation?: PendingActivation | null;
    stack?: { id: string }[] | null;
    combat?: { pendingAttackManaTax?: unknown } | null;
};

/** Identity of whatever prompt is currently open on the board (issue #7425):
 *  the active Pending Choice, a payment in progress (cast / activation /
 *  attack mana tax) and the top stack item. The view-only `promptCollapsed`
 *  flag re-expands whenever this string changes, so a NEW prompt never arrives
 *  hidden behind a pill. Pure; reads only the already-public state. */
export function promptCollapseKey(
    state: PromptCollapseSource | null | undefined
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
