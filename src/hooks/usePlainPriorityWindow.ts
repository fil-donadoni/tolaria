import { useGameContext } from "~/hooks/useGameContext";
import { isPlainPriorityWindow } from "~/lib/card-actionable";

/** Whether the viewer holds Priority in a plain window (issue #6917) — the
 *  gate every `actionable` ring and its click share. */
export function usePlainPriorityWindow(): boolean {
    return isPlainPriorityWindow(useGameContext());
}
