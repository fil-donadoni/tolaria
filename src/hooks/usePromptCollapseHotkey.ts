import { useEffect } from "react";
import { isEditableTarget } from "~/lib/editable-target";
import { HOTKEYS, matchesHotkey } from "~/lib/hotkeys";

/** `C` collapses / re-opens the open prompt (issue #7425). No modifiers, not
 *  in an editable target, not on key repeat. `onToggle` decides what the
 *  keystroke drives (choice minimize vs. the payment / stack flag). */
export function usePromptCollapseHotkey(onToggle: () => void): void {
    useEffect(() => {
        function onKeyDown(e: KeyboardEvent) {
            if (!matchesHotkey(e, HOTKEYS.collapsePrompt)) return;
            if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
            if (isEditableTarget(e.target)) return;
            e.preventDefault();
            onToggle();
        }
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [onToggle]);
}
