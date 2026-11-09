import { createContext, useCallback, useContext, useState } from "react";

/** View-only `promptCollapsed` flag (issue #7425): one hotkey (`C`) collapses
 *  the open prompt — payment banner, attack mana tax banner, stack panel — to
 *  a one-line pill so the board underneath is readable. Never game state,
 *  never sent anywhere. Pending Choice dialogs keep their own per-choice
 *  minimize (`useMinimizedChoice`, issue #315); the hotkey drives that one
 *  when a choice is open. */
export type PromptCollapsed = {
    collapsed: boolean;
    toggle: () => void;
    expand: () => void;
};

export const PromptCollapsedContext = createContext<PromptCollapsed | null>(
    null
);

/** Owns the flag. `promptKey` identifies the open prompt
 *  ({@link promptCollapseKey}); a change resets to expanded (render-time
 *  pattern, same as `useMinimizedChoiceState`). */
export function usePromptCollapsedState(promptKey: string): PromptCollapsed {
    const [collapsed, setCollapsed] = useState(false);
    const [trackedKey, setTrackedKey] = useState(promptKey);
    if (trackedKey !== promptKey) {
        setTrackedKey(promptKey);
        setCollapsed(false);
    }
    const toggle = useCallback(() => setCollapsed((v) => !v), []);
    const expand = useCallback(() => setCollapsed(false), []);
    return { collapsed, toggle, expand };
}

/** Optional read: a bare panel (a test) has no provider and is never
 *  collapsed. */
export function usePromptCollapsed(): PromptCollapsed | null {
    return useContext(PromptCollapsedContext);
}
