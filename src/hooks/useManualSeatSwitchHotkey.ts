import { useEffect } from "react";
import { isEditableTarget } from "~/lib/editable-target";

/** The "Switch seat" hotkey (issue #2173, `S`) for a solo Manual Game.
 *
 *  The manual board mounts NO GRE controller hook — the only real keydown
 *  effect in the app lives in `useControllerActions`, and that hook pulls in
 *  GRE-only context (`useGameContext`'s priority/attack-sequence reads) the
 *  manual board's inert context does not support (`manual-game-context.ts`).
 *  So `ControllerAction.shortcut` on the manual path is display-only (the
 *  `[S]` badge `ActionButton` renders) unless something ELSE binds the key —
 *  this hook is that binding, scoped to nothing but the seat switch.
 *
 *  Present only in solo: `onSwitchSeat` is `undefined` in a two-player
 *  Manual Game (`manual-board-container.tsx` never supplies it there), and
 *  this hook no-ops when so — the effect does not even attach a listener,
 *  so a stray `S` keystroke in a text field a two-player game happens to
 *  render is never at risk of hitting a live handler that then bails. */
export function useManualSeatSwitchHotkey(
    onSwitchSeat: (() => void) | undefined
): void {
    useEffect(() => {
        if (!onSwitchSeat) return;
        const switchSeat = onSwitchSeat;
        function onKeyDown(e: KeyboardEvent) {
            // Never hijack `S` while the user is typing — a note field
            // (`manualSetNote`) is a text input and "S" is an ordinary
            // letter a player types into it constantly.
            if (isEditableTarget(e.target)) return;
            if (e.repeat) return;
            if (e.metaKey || e.ctrlKey || e.altKey) return;
            if (e.key !== "s" && e.key !== "S") return;
            e.preventDefault();
            switchSeat();
        }
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [onSwitchSeat]);
}
