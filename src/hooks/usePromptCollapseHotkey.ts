import { useEffect } from "react";
import { isEditableTarget } from "~/lib/editable-target";

/** `C` collapses / re-opens the open prompt (issue #7425). No modifiers, not
 *  in an editable target, not on key repeat. `onToggle` decides what the
 *  keystroke drives (choice minimize vs. the payment / stack flag). */
export function usePromptCollapseHotkey(onToggle: () => void): void {
    useEffect(() => {
        function onKeyDown(e: KeyboardEvent) {
            if (e.key !== "c" && e.key !== "C") return;
            if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
            if (isEditableTarget(e.target)) return;
            e.preventDefault();
            onToggle();
        }
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [onToggle]);
}
