import { useEffect } from "react";
import type { DraftPackCard } from "@convex/limited/eventTypes";
import { acceptsShortcut } from "~/lib/keyboard-shortcuts";

/**
 * Keyboard picking in the Draft Room (ADR 0101 §6, issue #2587): arrows step
 * the Selected Card through the pack, Enter commits it, `S` commits it to the
 * sideboard.
 *
 * IT GOES THROUGH THE SAME HANDLERS AS EVERY OTHER GESTURE. The three
 * callbacks are exactly the ones the pack tile's click/double-click, the
 * context menu, the Peek Panel CTA row and the drag all call — so "pick via
 * CTA, drag and Enter all go through the same mutation" is structural here,
 * not a thing three code paths have to remember to keep agreeing on. A
 * keyboard path that called `submitPick` itself would be a fourth opinion
 * about what a pick is.
 *
 * Selection is SERVER state (`selectDraftPick`, ADR 0060) — the arrows do not
 * keep a local cursor, they move the same Selected Card the mouse sets, which
 * is what makes Enter's meaning identical whichever one moved it last.
 */
export function useDraftKeyboardPicks({
    enabled,
    pack,
    selectedPickId,
    onSelect,
    onPick,
    onPickToSideboard,
}: {
    /** Off while a pick is in flight, or when there is nothing to pick. */
    enabled: boolean;
    pack: readonly DraftPackCard[];
    selectedPickId: string | null;
    onSelect: (pickId: string) => void;
    onPick: (pickId: string) => void;
    onPickToSideboard: (pickId: string) => void;
}): void {
    useEffect(() => {
        if (!enabled || pack.length === 0) return;

        const onKeyDown = (event: KeyboardEvent) => {
            // `acceptsShortcut` (issue #2593) is the shared admission test:
            // already handled, a modifier chord, a key typed into a field, or a
            // dialog (Table Ring, Inspect Overlay) owning the keyboard while it
            // is open — picking blind behind a modal is never intended.
            if (!acceptsShortcut(event)) return;

            const at = pack.findIndex((c) => c.pickId === selectedPickId);
            const step = (delta: number) => {
                event.preventDefault();
                const next =
                    at === -1
                        ? delta > 0
                            ? 0
                            : pack.length - 1
                        : (at + delta + pack.length) % pack.length;
                onSelect(pack[next].pickId);
            };

            switch (event.key) {
                case "ArrowRight":
                case "ArrowDown":
                    step(1);
                    return;
                case "ArrowLeft":
                case "ArrowUp":
                    step(-1);
                    return;
                case "Enter":
                    if (at === -1) return;
                    event.preventDefault();
                    onPick(pack[at].pickId);
                    return;
                case "s":
                case "S":
                    if (at === -1) return;
                    event.preventDefault();
                    onPickToSideboard(pack[at].pickId);
                    return;
                default:
                    return;
            }
        };

        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [enabled, pack, selectedPickId, onSelect, onPick, onPickToSideboard]);
}
