import { useState } from "react";
import { useSeatYields } from "~/hooks/useYieldPreferences";
import ManageYieldsDialog from "./manage-yields-dialog";

/** "Manage yields (N)" — opens the box that removes ONE **Yield** or ONE
 *  remembered **Auto-order** at a time (issue #3629). Mounted beside
 *  `ClearYieldsButton` in both of its homes (the **Stack** panel and the Game
 *  Menu) and counted by the same rule, `SeatYields.resetCount`, so the two
 *  controls appear and disappear together.
 *
 *  The dialog sits OUTSIDE the count gate: removing the last entry hides this
 *  control but leaves the open box on its empty state, instead of unmounting
 *  it under the player's finger. */
export default function ManageYieldsButton({
    variant = "panel",
}: {
    variant?: "panel" | "menu";
}) {
    const seat = useSeatYields();
    const [open, setOpen] = useState(false);

    return (
        <>
            {seat.resetCount > 0 && (
                <button
                    type="button"
                    data-manage-yields={variant}
                    onClick={() => setOpen(true)}
                    className={
                        variant === "menu"
                            ? "w-full rounded-[var(--panel-radius)] border border-border-strong px-3 py-2 text-sm text-text hover:bg-accent-soft/20"
                            : "w-full rounded-sm border border-border-subtle px-2 py-1 text-center text-[10px] text-accent-strong hover:bg-accent-soft/20"
                    }
                >
                    Manage yields ({seat.resetCount})
                </button>
            )}
            <ManageYieldsDialog open={open} onOpenChange={setOpen} />
        </>
    );
}
