import type { ReactNode } from "react";
import BottomSheet from "~/components/ui/bottom-sheet";

/**
 * The basic-lands BOTTOM SHEET (issue #2584, PRD #2405 slice 5).
 *
 * `PoolBasicLandsBar` is the ONE basics bar both builders already share
 * (#1627/#1629) and it stays that — this only changes WHERE it is mounted on a
 * phone. Inline, it is a permanent band of five steppers plus an art picker
 * competing with the card panes for a 844px-tall screen; behind the bottom
 * bar's `Lands` button it costs nothing until asked for.
 *
 * Modal, unlike the Peek Panel: adding lands is a deliberate detour, not the
 * "tap the next card" flow the panel has to stay out of the way of. A tap on
 * the scrim closes it.
 *
 * The sheet MACHINERY (portal, scrim, title row, 70dvh cap, Escape) moved to
 * `ui/bottom-sheet.tsx` in issue #2585, when the filters needed the same shape
 * — one sheet primitive, two callers, rather than a third bespoke copy.
 */
export default function DeckBasicsSheet({
    open,
    onClose,
    children,
}: {
    open: boolean;
    onClose: () => void;
    children: ReactNode;
}) {
    return (
        <BottomSheet
            open={open}
            onClose={onClose}
            title="Basic lands"
            marker="data-basics-sheet"
        >
            {children}
        </BottomSheet>
    );
}
