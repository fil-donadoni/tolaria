import DivideTargetChip from "./divide-target-chip";
import { useDivideBuffer } from "~/hooks/useDivideBuffer";
import { useDivideTargets } from "~/hooks/useDivideTargets";

/** In-dialog target grid for divide-as-you-choose damage (CR 601.2d), split
 *  vertically into the opponent's targets (top row, mirroring the board's
 *  opponent-on-top layout) and the viewer's own (bottom row). A player that is
 *  itself a legal target (Fireball / Fire Covenant — CR 115.4) rides in its own
 *  side's row as a face chip. Moving the steppers off the board (they used to
 *  overlay each target permanent) removes the overlap with neighbouring cards
 *  that hid the controls. */
export default function DivideTargetList() {
    const divide = useDivideBuffer();
    const targets = useDivideTargets();

    if (!divide.active || targets.length === 0) return null;

    const opponents = targets.filter((t) => !t.mine);
    const mine = targets.filter((t) => t.mine);

    const group = (label: string, items: typeof targets) =>
        items.length === 0 ? null : (
            <div className="flex flex-col gap-1.5">
                <span className="text-[10px] uppercase tracking-[0.2em] text-text-muted">
                    {label}
                </span>
                <div className="flex flex-wrap items-start gap-4">
                    {items.map((t) => (
                        <DivideTargetChip key={t.id} item={t} />
                    ))}
                </div>
            </div>
        );

    return (
        <div className="flex flex-col gap-4 max-w-[min(80vw,560px)] border-t border-border-subtle pt-3">
            {group("Opponent", opponents)}
            {group("You", mine)}
        </div>
    );
}
