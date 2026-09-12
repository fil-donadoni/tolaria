import { useCallback, useEffect, useMemo, useState } from "react";
import {
    DebugSheetContext,
    type DebugSheetContextValue,
} from "~/hooks/debugSheetContext";

/** Persisted open flag, per device (issue #3403). "1" = open. */
const OPEN_KEY = "tolaria:debugSheetOpen";

/** The keyboard shortcut that toggles the sheet. Backquote is the classic
 *  dev-console key and is the one printable character no gameplay surface
 *  binds — Escape belongs to the pause menu (`board.tsx`), and every
 *  `Ctrl/Cmd+Shift+<letter>` a debug panel would want is already claimed by
 *  the browser itself (`Ctrl+Shift+D` bookmarks every open tab in Chrome, and
 *  a page cannot preventDefault a browser-level chord). */
export const DEBUG_SHEET_SHORTCUT_KEY = "`";

function readOpen(): boolean {
    try {
        return localStorage.getItem(OPEN_KEY) === "1";
    } catch {
        return false;
    }
}

/** Whether a keystroke landed in something the user is TYPING into — the
 *  scenario editor inside the sheet is full of text fields, and a bare
 *  printable shortcut that fires while you type a card name is a shortcut that
 *  eats your input. */
function isTypingTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    if (target.isContentEditable) return true;
    const tag = target.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/**
 * Owns the debug sheet's open flag (issue #3493), lifted out of
 * {@link DebugSheet} so the board area — a SIBLING of the sheet, since the
 * sheet is `position: fixed` — can reserve space for it at desktop widths.
 *
 * `enabled` is the whole reason this is a provider with a prop rather than an
 * unconditional one: the route mounts the sheet only for a tester, and the
 * open flag is PERSISTED. Mounting the provider for a regular player would
 * restore a `"1"` written by a tester session on the same device and push the
 * board aside for a sheet that is not there. Disabled, it reports closed, binds
 * no shortcut and writes nothing.
 */
export default function DebugSheetProvider({
    enabled,
    children,
}: {
    /** Whether this viewer may open the sheet at all. */
    enabled: boolean;
    children: React.ReactNode;
}) {
    // Read the persisted flag UNCONDITIONALLY, and gate only what is EXPOSED
    // (below) and what is WRITTEN (the effect). A lazy initializer runs once,
    // and `enabled` is `import.meta.env.DEV || canUseDebugSheet(currentUser)`
    // — `currentUser` is `undefined` until its Convex round trip resolves, so
    // in a production build the first render of a reloaded board is reliably
    // `enabled: false`. Gating the INITIALIZER on it therefore dropped a
    // tester's persisted-open sheet on every reload, permanently, because the
    // initializer never re-runs when the flag flips (PR #3505 review).
    const [open, setOpenState] = useState(readOpen);

    const setOpen = useCallback(
        (next: boolean | ((prev: boolean) => boolean)) => {
            if (!enabled) return;
            setOpenState(next);
        },
        [enabled]
    );

    useEffect(() => {
        if (!enabled) return;
        try {
            localStorage.setItem(OPEN_KEY, open ? "1" : "0");
        } catch {
            // storage unavailable — session-only state is fine
        }
    }, [enabled, open]);

    useEffect(() => {
        if (!enabled) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== DEBUG_SHEET_SHORTCUT_KEY) return;
            // OS key-repeat fires every ~30ms once the key is held, and a
            // toggle bound to it would flicker the sheet and land on whatever
            // the repeat count's parity happened to be. Only the first press
            // is a decision.
            if (event.repeat) return;
            if (event.metaKey || event.ctrlKey || event.altKey) return;
            if (isTypingTarget(event.target)) return;
            event.preventDefault();
            setOpenState((v) => !v);
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [enabled]);

    // `enabled &&` here, not in the state: a viewer who cannot open the sheet
    // reports it closed no matter what this device's storage holds, and the
    // moment `enabled` resolves true the persisted value is already there.
    const value = useMemo<DebugSheetContextValue>(
        () => ({ open: enabled && open, setOpen }),
        [enabled, open, setOpen]
    );

    return (
        <DebugSheetContext.Provider value={value}>
            {children}
        </DebugSheetContext.Provider>
    );
}
