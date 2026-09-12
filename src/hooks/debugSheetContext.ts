import { createContext, useContext } from "react";

/** The debug sheet's open flag, shared with the board area (issue #3493).
 *
 *  The sheet is `position: fixed`, so at desktop widths it can only stop
 *  covering the board if something else gives up the space — and that
 *  something is the game route's board wrapper, which is a SIBLING of the
 *  sheet, not a descendant. A context is what lets the debug module keep
 *  owning the flag (persistence, the shortcut, the open/close decision) while
 *  a wrapper outside it reacts to the value. */
export type DebugSheetContextValue = {
    open: boolean;
    setOpen: (next: boolean | ((prev: boolean) => boolean)) => void;
};

export const DebugSheetContext = createContext<DebugSheetContextValue | null>(
    null
);

/** Subscribe to the sheet's open flag. Returns `null` outside a provider — a
 *  player with no debug affordance mounts no provider, and the board area
 *  must then behave exactly as it did before the sheet existed. */
export function useDebugSheet(): DebugSheetContextValue | null {
    return useContext(DebugSheetContext);
}

/** The open flag alone, defaulting to CLOSED outside a provider. */
export function useDebugSheetOpen(): boolean {
    return useContext(DebugSheetContext)?.open ?? false;
}
