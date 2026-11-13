import { createContext, useCallback, useContext, useState } from "react";
import type { PendingChoice } from "~/types/game";
import { deriveChoiceKey } from "~/hooks/usePendingChoiceBuffer";

/** Client-only, per-choice minimize toggle for blocking choice dialogs
 *  (issue #315). Minimizing is purely a view state: it collapses the modal
 *  / banner to a small board indicator while the underlying Pending Choice
 *  (CR 608.2) stays active and priority stays frozen. It is NOT persisted to
 *  `GameState.pendingChoices`, never sent to the opponent, and never touches
 *  the submission flow.
 *
 *  State is per-choice: when the active Pending Choice resolves (its identity
 *  key changes, or the queue empties) the minimized flag resets, so a new
 *  choice always starts expanded. The buffered selection
 *  (`usePendingChoiceBuffer`) is a separate piece of state and survives a
 *  minimize/restore cycle unchanged — this hook only flips a boolean. */
export type MinimizedChoice = {
    /** True when the active choice's dialog is currently collapsed. */
    isMinimized: boolean;
    /** Collapse the active dialog to the board indicator. */
    minimize: () => void;
    /** Restore the full dialog. */
    restore: () => void;
};

export const MinimizedChoiceContext = createContext<MinimizedChoice | null>(
    null
);

/** Owns the minimize flag for the active pending choice. Mounted by the
 *  board so the banner and the library-pick modal share one toggle. Resets
 *  when the choice identity changes (next choice in a chain, or queue
 *  empties). */
export function useMinimizedChoiceState(
    activeChoice: PendingChoice | undefined
): MinimizedChoice {
    const [isMinimized, setIsMinimized] = useState(false);

    const choiceKey = deriveChoiceKey(activeChoice);

    // Reset when the choice identity changes — same render-time pattern the
    // buffer uses. A fresh Pending Choice always starts expanded.
    // https://react.dev/reference/react/useState#storing-information-from-previous-renders
    const [trackedKey, setTrackedKey] = useState<string | null>(choiceKey);
    if (trackedKey !== choiceKey) {
        setTrackedKey(choiceKey);
        setIsMinimized(false);
    }

    const minimize = useCallback(() => setIsMinimized(true), []);
    const restore = useCallback(() => setIsMinimized(false), []);

    return { isMinimized, minimize, restore };
}

export function useMinimizedChoice(): MinimizedChoice {
    const ctx = useContext(MinimizedChoiceContext);
    if (!ctx)
        throw new Error(
            "useMinimizedChoice must be used within MinimizedChoiceContext.Provider"
        );
    return ctx;
}
