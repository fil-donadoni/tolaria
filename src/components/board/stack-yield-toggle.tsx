import type { StackItem } from "~/types/game";
import { useSeatYields } from "~/hooks/useYieldPreferences";
import { yieldKeyForStackItem } from "~/lib/yields";

/** The per-ability **Yield** toggle that rides every **Stack** row (issue
 *  #3556 §1) — own objects and the opponent's alike, on **Spells**,
 *  **Activated Abilities**, **Triggered Abilities** and delayed triggers.
 *
 *  A SIBLING of the row's `<button>`, never a child of it: the row itself is a
 *  targetable button (CR 601.2c spell targeting), and a control nested inside
 *  another control is invalid HTML and an axe `nested-interactive` violation.
 *  It is positioned over the row's own `relative` wrapper instead.
 *
 *  Renders its current state, so an ability yielded from an earlier instance
 *  shows as yielded the moment the next instance hits the stack — the key is
 *  the ABILITY, not the object (`yieldKeyForStackItem`). */
export default function StackYieldToggle({ item }: { item: StackItem }) {
    const seat = useSeatYields();
    const key = yieldKeyForStackItem(item);
    // A card-less inline trigger with no designation has no stable identity to
    // key a yield on; it gets no toggle rather than a toggle that covers the
    // wrong things.
    if (!key) return null;

    const yielded = seat.isYielded(key);
    return (
        <button
            type="button"
            data-stack-yield-toggle={key}
            aria-pressed={yielded}
            aria-label={
                yielded
                    ? "Stop yielding to this ability"
                    : "Yield to this ability"
            }
            title={
                yielded
                    ? "Yielding — you are not stopped while this ability is on top of the stack"
                    : "Yield: stop being handed priority for this ability"
            }
            onClick={() => seat.toggle(key)}
            // The BOX is `--control-h` — 32px on a fine pointer, 44px on a
            // coarse one (`src/index.css`, the `pointer: coarse` branch) — so
            // the tap target meets WCAG 2.5.8 on every touch viewport. The
            // check:ui lane measured the earlier bare-24px version as real
            // sub-44px debt (`game-debug-sheet-ai @ 820x1180x2: small 11 > 9`).
            // The box is transparent and anchors the VISUAL pill to the row's
            // top-right corner, extending its hit area inward rather than
            // growing the mark.
            className="absolute top-0 right-0 z-10 flex h-[var(--control-h)] w-[var(--control-h)] items-start justify-end p-1"
        >
            {/* Visibly persistent in BOTH states (§1): the off state is a
                quiet-but-present outline, not a hover-only affordance — a
                control that appears on hover is unreachable on touch. */}
            <span
                aria-hidden
                className={`flex h-6 w-6 items-center justify-center rounded-full border text-[11px] leading-none font-bold ${
                    yielded
                        ? "border-accent bg-accent text-surface-base"
                        : "border-border-strong bg-surface-elevated/90 text-text-muted hover:text-text"
                }`}
            >
                {yielded ? "⏭" : "⏸"}
            </span>
        </button>
    );
}
