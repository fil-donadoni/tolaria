import { useSeatYields } from "~/hooks/useYieldPreferences";

/** "Clear all yields (N)" — the **Yield** reset (issue #3556 §5). It also
 *  turns **Auto-order** off and forgets every remembered trigger order (issue
 *  #3617), so N counts both, and the control stays reachable while the seat
 *  holds remembered orders but zero yields. Renders NOTHING while there is
 *  nothing of either to undo, and always names the count.
 *
 *  Mounted twice on purpose: in the **Stack** panel header, and in the in-game
 *  Game Menu so it stays reachable while the panel is collapsed. `variant`
 *  is the only difference between the two. */
export default function ClearYieldsButton({
    variant = "panel",
}: {
    variant?: "panel" | "menu";
}) {
    const seat = useSeatYields();
    const count = seat.count + seat.rememberedOrderCount;
    if (count === 0) return null;

    return (
        <button
            type="button"
            data-clear-yields={variant}
            onClick={() => seat.clearAll()}
            className={
                variant === "menu"
                    ? "w-full rounded-[var(--panel-radius)] border border-border-strong px-3 py-2 text-sm text-text hover:bg-accent-soft/20"
                    : "w-full rounded-sm border border-border-subtle px-2 py-1 text-center text-[10px] text-accent-strong hover:bg-accent-soft/20"
            }
        >
            Clear all yields ({count})
        </button>
    );
}
