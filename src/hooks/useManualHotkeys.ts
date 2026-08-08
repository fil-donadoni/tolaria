import { useEffect } from "react";
import { isEditableTarget } from "~/lib/editable-target";

/** The Manual Board's turn hotkeys (manual-mode QA round 3, item 5):
 *  <kbd>Space</kbd> steps the phase marker, <kbd>Enter</kbd> ends the turn.
 *
 *  Why a dedicated hook rather than `ControllerAction.shortcut`: that field is
 *  DISPLAY-ONLY on the manual path. The app's only real keydown effect lives
 *  in `useControllerActions`, and the manual board never mounts that hook —
 *  it injects a plain descriptor function through `ControllerActionsContext`
 *  instead (`manual-controller-actions.ts`), precisely so it doesn't drag in
 *  the GRE priority/attack-sequence reads its inert context can't answer. So
 *  a manual descriptor's `shortcut: "space"` renders the `[Space]` badge and
 *  binds nothing. This hook is the binding, and it is scoped to nothing but
 *  these two keys — the same shape (and the same guards) as
 *  `useManualSeatSwitchHotkey`.
 *
 *  Guards, in order: never while typing (a note field is a text input and
 *  Space is the commonest character in it), never on auto-repeat (holding
 *  Space must not race through the whole turn), never with a modifier
 *  (Cmd/Ctrl+Enter belongs to the browser). */
export function useManualHotkeys({
    enabled,
    onNextPhase,
    onEndTurn,
}: {
    /** False while a manual surface owns the keyboard — the anchored verb
     *  popover (its Confirm button is focusable, so Enter/Space would both
     *  press it AND fire a turn action) or the log overlay. Passed in rather
     *  than sniffed from the DOM: the board already knows both states, and a
     *  querySelector probe would be a second, drifting source of truth. */
    enabled: boolean;
    onNextPhase: () => void;
    onEndTurn: () => void;
}): void {
    useEffect(() => {
        if (!enabled) return;
        function onKeyDown(e: KeyboardEvent) {
            if (isEditableTarget(e.target)) return;
            if (e.repeat) return;
            if (e.metaKey || e.ctrlKey || e.altKey) return;
            // `e.key === " "` is the space bar; `e.code` would also match the
            // spacebar on a layout that remaps it, but every other hotkey in
            // this app reads `key`, so this stays consistent with them.
            if (e.key === " ") {
                e.preventDefault();
                onNextPhase();
                return;
            }
            if (e.key === "Enter") {
                e.preventDefault();
                onEndTurn();
            }
        }
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [enabled, onNextPhase, onEndTurn]);
}
