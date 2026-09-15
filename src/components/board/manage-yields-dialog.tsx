import GameDialog from "~/components/ui/game-dialog";
import { useSeatYields } from "~/hooks/useYieldPreferences";
import { V4_EYEBROW } from "~/lib/board-chrome-v4";
import { formatOracleText } from "~/lib/oracle-text";
import { triggerOrderSourceNames, yieldRows } from "~/lib/yield-labels";
import ManageYieldsRow from "./manage-yields-row";

/** The "Manage yields" box (issue #3629): the VIEWING seat's **Yields** and
 *  remembered **Auto-order** entries, each removable on its own. Reads and
 *  writes only through `useSeatYields`, so in solo mode it follows the seat
 *  that owes input exactly like every other **Yield** surface.
 *
 *  Removal never closes it; once the last entry is gone it says so instead of
 *  rendering an empty frame. */
export default function ManageYieldsDialog({
    open,
    onOpenChange,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const seat = useSeatYields();
    const rows = yieldRows(seat.keys);
    const orders = seat.autoOrder.orders;
    const empty = rows.length === 0 && orders.length === 0;

    return (
        <GameDialog
            open={open}
            onOpenChange={onOpenChange}
            title="Manage yields"
            showCloseButton
            dismissable
        >
            <div data-manage-yields-box className="mt-2 flex flex-col gap-4">
                {empty && (
                    <p
                        data-manage-yields-empty
                        className="text-sm text-text-muted"
                    >
                        No yields and no remembered trigger orders.
                    </p>
                )}
                {rows.length > 0 && (
                    <section
                        aria-labelledby="manage-yields-yields"
                        className="flex flex-col gap-2"
                    >
                        <h3 id="manage-yields-yields" className={V4_EYEBROW}>
                            Yields
                        </h3>
                        <ul className="flex flex-col gap-1.5">
                            {rows.map((row) => (
                                <ManageYieldsRow
                                    key={row.key}
                                    title={row.title}
                                    detail={
                                        row.detail
                                            ? formatOracleText(row.detail)
                                            : undefined
                                    }
                                    removeLabel={`Remove yield: ${row.title}`}
                                    onRemove={() => seat.removeYield(row.key)}
                                />
                            ))}
                        </ul>
                    </section>
                )}
                {orders.length > 0 && (
                    <section
                        aria-labelledby="manage-yields-orders"
                        className="flex flex-col gap-2"
                    >
                        <h3 id="manage-yields-orders" className={V4_EYEBROW}>
                            Auto-order
                        </h3>
                        <p className="text-xs text-text-muted">
                            Put on the stack left to right — the last one
                            resolves first.
                        </p>
                        <ul className="flex flex-col gap-1.5">
                            {orders.map((order) => {
                                const title =
                                    triggerOrderSourceNames(order).join(" → ");
                                return (
                                    <ManageYieldsRow
                                        key={order.join("\n")}
                                        title={title}
                                        removeLabel={`Forget order: ${title}`}
                                        onRemove={() =>
                                            seat.forgetTriggerOrder(order)
                                        }
                                    />
                                );
                            })}
                        </ul>
                    </section>
                )}
            </div>
        </GameDialog>
    );
}
