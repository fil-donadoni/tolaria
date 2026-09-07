import { useEffect } from "react";
import { switchView, viewFromParams } from "./view";
import { refreshLoopStatus } from "./loopStatus";
import {
    isOverlayOpen,
    modalOverlayOpen,
    setOverlayOpen,
    useOpenOverlays,
} from "./overlays";

/**
 * The dashboard's keyboard layer (PRD #3148 S2), ported from
 * `scripts/dashboard/shortcuts.js` (#2635): `1`/`2` switch views, `r`
 * refreshes the visible one, `/` focuses its search box, `?` opens a sheet
 * listing all of this, `Esc` closes it.
 *
 * Bound once, on `document` — a keystroke is a page-level event and there is
 * no element it belongs to.
 *
 * ── WHAT THE PORT CHANGED, AND WHAT IT DID NOT ────────────────────────────
 *
 * The DECISION TABLE below is the vanilla one, unchanged: the same six keys,
 * the same typing-target suppression, the same inertness while a modal is
 * open. What went away is the hand-built sheet — `buildSheet`, its `[hidden]`
 * backdrop, its focus trap and its own Escape branch — because a base-ui
 * dialog has all four, and `dialog.js`'s shared `trapFocus` existed only
 * because that machinery had been written twice.
 *
 * ESCAPE IS NO LONGER HANDLED HERE AT ALL. base-ui binds its own Escape
 * listener on the DOCUMENT, so the sheet closes from wherever focus has
 * drifted to — including onto a text input behind it, the round-2 review's
 * exact repro — without this module having to arbitrate. Which overlay wins
 * when several are open is stated once in `overlays.ts`.
 *
 * ── STATICALLY REACHABLE FROM THE ENTRY — the Now/History data boundary ───
 *
 * `telemetry-serve.test.ts` crawls every module statically reachable from the
 * React entry and asserts none is a History module and none reaches a
 * DB-backed route (#2519: the Now panel must render with no telemetry.db).
 * This module is chrome, so it IS in that closure — which is why History's
 * `refresh()` is reached through a DYNAMIC `import()` in `refreshVisibleView`
 * below, the same sanctioned mechanism `scripts/dashboard/main.js` uses for
 * `history-boot.js`, and for the same reason.
 */

/** One row per shortcut — the single list the sheet renders AND the keydown
 *  switch dispatches from, so a key can never appear in one without the
 *  other. */
export const SHORTCUTS = [
    { key: "1", desc: "Switch to the Now view" },
    { key: "2", desc: "Switch to the History view" },
    { key: "r", desc: "Refresh the visible view" },
    { key: "/", desc: "Focus the visible view's search box" },
    { key: "?", desc: "Show or hide this list" },
    { key: "Esc", desc: "Close this list, or any other open overlay" },
] as const;

const NON_TEXT_INPUT_TYPES = new Set([
    "button",
    "checkbox",
    "color",
    "file",
    "hidden",
    "image",
    "radio",
    "range",
    "reset",
    "submit",
]);

/**
 * Whether `el` is somewhere a keystroke inserts a character OR drives native
 * typeahead rather than triggering a shortcut — the #2635 AC's hard case:
 * typing `1` into History's issue search must filter the table, never jump to
 * the Now view. `<input type="date">`/`type="search"` count exactly as much as
 * a bare text field: the AC's wording is about what an element DOES with a
 * keystroke, not its literal tag.
 *
 * `SELECT` (round 2 review, medium): History renders five native comboboxes
 * where a letter or digit is the browser's own typeahead. Proven with a
 * scratch test: focus `#if-family`, dispatch `1`, and the view switched to Now
 * underneath the still-focused dropdown.
 *
 * Deliberately NOT a blanket `[tabindex]` check, despite that covering
 * `SELECT` and `role="textbox"` for free — the tooltip engine gives every
 * glossary TERM a `tabindex` purely to open a tooltip on focus, and none of
 * those consume a keystroke as text. Suppressing every shortcut while any of
 * them merely holds focus would make `1`/`2`/`r` unusable for most of a
 * keyboard user's time on the page.
 */
export function isTypingTarget(el: Element | null | undefined): boolean {
    if (!el) return false;
    const tag = el.tagName;
    if (tag === "TEXTAREA" || tag === "SELECT") return true;
    if (tag === "INPUT") {
        const type = (el.getAttribute("type") || "text").toLowerCase();
        return !NON_TEXT_INPUT_TYPES.has(type);
    }
    if ((el as HTMLElement).isContentEditable) return true;
    return el.getAttribute("role") === "textbox";
}

const currentView = () => viewFromParams(new URLSearchParams(location.search));

/**
 * `/` focuses the FIRST visible search box in DOM order — History renders two
 * (`#if-text` for Issues, `#sf-text` for Sessions), and the Issues card leads
 * the view. Now has none; querying finds nothing and this is a silent no-op,
 * which is also the correct behaviour for a view that never gets one.
 */
function focusVisibleSearchBox(doc: Document): void {
    const root = doc.getElementById(`view-${currentView()}`);
    const box = root?.querySelector<HTMLInputElement>('input[type="search"]');
    if (!box) return;
    box.focus();
    box.select?.();
}

/**
 * `r` refreshes whichever view is on screen. Now's transport is part of this
 * graph, so that half is a direct call. History's is reached only through a
 * dynamic `import()` — see the module header — and gated on `getMeta()`
 * returning non-null: `refresh()` dereferences it unconditionally, so calling
 * it before `/api/meta` has ever resolved (no telemetry.db, or the fetch still
 * in flight) would throw instead of doing nothing. `#meta-line` already said
 * once that the store is unavailable; refreshing a view with nothing loaded
 * should be quiet, not a second error.
 */
async function refreshVisibleView(): Promise<void> {
    if (currentView() === "now") {
        void refreshLoopStatus();
        return;
    }
    const { getMeta } =
        await import("../../scripts/dashboard/history-state.js");
    if (!getMeta()) return;
    const { refresh } =
        await import("../../scripts/dashboard/history-refresh.js");
    await refresh();
}

export const sheetOpen = (): boolean => isOverlayOpen("shortcuts");
export const openSheet = (): void => setOverlayOpen("shortcuts", true);
export const closeSheet = (): void => setOverlayOpen("shortcuts", false);
export const toggleSheet = (): void =>
    setOverlayOpen("shortcuts", !sheetOpen());

/** Whether the shortcuts sheet is showing, as a subscription. */
export const useSheetOpen = (): boolean =>
    useOpenOverlays().includes("shortcuts");

/**
 * The decision table. Exported so a test can drive it with a hand-built
 * event-like object rather than dispatching a synthetic `keydown` — the
 * wiring is exercised by `useShortcuts`'s own test.
 */
export function handleKeydown(
    e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey"> & {
        preventDefault: () => void;
    },
    doc: Document = document
): void {
    // Cmd/Ctrl/Alt+key are the browser's own shortcuts (Cmd+R reload, etc.);
    // never intercept a modified keypress.
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    // A modal overlay owns the keyboard: `2` pressed while a Release
    // confirmation is open must not switch the view out from under it, and `?`
    // must not stack the sheet on top of it (#2636 review round 1, finding 2).
    // Tab and Escape belong to base-ui; the ONE key still ours is `?` closing
    // the sheet it opened.
    if (modalOverlayOpen()) {
        if (e.key === "?" && sheetOpen()) {
            e.preventDefault();
            closeSheet();
        }
        return;
    }

    if (isTypingTarget(doc.activeElement)) return;

    switch (e.key) {
        case "?":
            e.preventDefault();
            openSheet();
            break;
        case "1":
            e.preventDefault();
            switchView("now");
            break;
        case "2":
            e.preventDefault();
            switchView("history");
            break;
        case "r":
            e.preventDefault();
            void refreshVisibleView();
            break;
        case "/":
            e.preventDefault();
            focusVisibleSearchBox(doc);
            break;
        default:
            break;
    }
}

/** Bind the keyboard layer for as long as the app is mounted. */
export function useShortcuts(): void {
    useEffect(() => {
        const onKeydown = (e: KeyboardEvent) => handleKeydown(e);
        document.addEventListener("keydown", onKeydown);
        return () => document.removeEventListener("keydown", onKeydown);
    }, []);
}
