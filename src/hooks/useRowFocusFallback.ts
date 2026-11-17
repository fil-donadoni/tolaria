import { useLayoutEffect, useRef, type RefObject } from "react";

/** Selector for a row's focusable controls (disabled ones cannot take focus). */
const FOCUSABLE = "button:not(:disabled)";

type FocusedSlot = { el: HTMLElement; rowId: string; slot: number };

/**
 * Keeps keyboard focus inside a list dialog when the focused row (or control)
 * disappears (issue #9819). Without it the browser drops focus to `<body>` and
 * base-ui hands it back to the dialog Popup; the neighbour policy here is the
 * next row, else the previous, else `fallback` (the dialog title).
 *
 * The list's rows carry `data-row-id`; `rowIds` is their current order. The
 * same control slot (nth enabled button) is kept in the neighbour row so a
 * keyboard user can repeat the same action down the list.
 */
export default function useRowFocusFallback(
    listRef: RefObject<HTMLElement | null>,
    rowIds: string[],
    fallback: () => HTMLElement | null | undefined
): void {
    const focused = useRef<FocusedSlot | null>(null);
    const prevIds = useRef<string[]>(rowIds);
    // The list element unmounts when it empties and remounts when it refills:
    // re-attach the listener across that edge.
    const hasRows = rowIds.length > 0;
    const fallbackRef = useRef(fallback);
    useLayoutEffect(() => {
        fallbackRef.current = fallback;
    });

    // Track the focused row/slot through native focus events (React's
    // `onFocus` would force a prop on every consumer).
    useLayoutEffect(() => {
        const list = listRef.current;
        if (!list) return;
        const onFocusIn = (e: FocusEvent) => {
            const target = e.target as HTMLElement;
            const row = target.closest<HTMLElement>("[data-row-id]");
            if (!row || !list.contains(row)) return;
            focused.current = {
                el: target,
                rowId: row.dataset.rowId ?? "",
                slot: Math.max(
                    0,
                    Array.from(row.querySelectorAll(FOCUSABLE)).indexOf(target)
                ),
            };
        };
        list.addEventListener("focusin", onFocusIn);
        return () => list.removeEventListener("focusin", onFocusIn);
    }, [listRef, hasRows]);

    useLayoutEffect(() => {
        const before = prevIds.current;
        prevIds.current = rowIds;
        const last = focused.current;
        if (!last) return;
        // The tracked control is still alive and enabled: focus left it by the
        // user's own doing (or went to the other list), nothing to repair.
        // Without this a stale slot in one list steals focus after a removal
        // in its sibling list.
        const el = last.el;
        if (el.isConnected && !(el as HTMLButtonElement).disabled) return;
        const list = listRef.current;
        const active = document.activeElement;
        // Focus still on a live control in this list: nothing to repair.
        if (list && active && active !== document.body && list.contains(active))
            return;
        // Focus went somewhere deliberate outside the list: leave it.
        if (active && active !== document.body && !isDialogPopup(active))
            return;

        const focusSlot = (row: HTMLElement | null | undefined) => {
            const controls = row?.querySelectorAll<HTMLElement>(FOCUSABLE);
            if (!controls?.length) return false;
            controls[Math.min(last.slot, controls.length - 1)].focus();
            return true;
        };
        const rowEl = (id: string) =>
            list?.querySelector<HTMLElement>(
                `[data-row-id="${CSS.escape(id)}"]`
            );

        if (rowIds.includes(last.rowId)) {
            // Row survived but its control was disabled (e.g. "move all").
            if (focusSlot(rowEl(last.rowId))) return;
        }
        const at = before.indexOf(last.rowId);
        const live = (id: string) => rowIds.includes(id);
        const next = before.slice(at + 1).find(live);
        const prev = before.slice(0, Math.max(at, 0)).reverse().find(live);
        for (const id of [next, prev]) {
            if (id !== undefined && focusSlot(rowEl(id))) return;
        }
        focused.current = null;
        fallbackRef.current()?.focus();
    }, [rowIds, listRef]);
}

function isDialogPopup(el: Element): boolean {
    return el.getAttribute("data-slot") === "dialog-content";
}
