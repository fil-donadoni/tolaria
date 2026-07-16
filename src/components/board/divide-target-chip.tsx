import CardImage from "../cards/card-image";
import DivideTargetStepper from "./divide-target-stepper";
import { useDivideBuffer } from "~/hooks/useDivideBuffer";
import type { DivideTargetItem } from "~/hooks/useDivideTargets";

/** One divide target inside the dialog (CR 601.2d): a mini card image for a
 *  permanent or a labelled face chip for a player, its assigned-share pip, and
 *  its own inline `[−] N [+]` stepper. Reads/writes the shared divide buffer
 *  directly, so a chip is self-contained regardless of which side-group renders
 *  it. */
export default function DivideTargetChip({ item }: { item: DivideTargetItem }) {
    const divide = useDivideBuffer();
    const assigned = divide.get(item.id);

    return (
        <div className="flex flex-col items-center gap-2.5">
            <div className="relative w-16">
                {item.type === "permanent" ? (
                    <div className="w-16 aspect-[5/7] rounded-sm overflow-hidden ring-1 ring-black/40 shadow-[0_4px_10px_rgba(0,0,0,0.5)]">
                        <CardImage card={item.card} sizes="64px" />
                    </div>
                ) : (
                    <div className="w-16 aspect-[5/7] rounded-sm border border-border-subtle bg-surface-2 flex flex-col items-center justify-center gap-1 px-1 text-center">
                        <span className="text-2xl font-beleren text-accent-strong tabular-nums leading-none">
                            {item.life}
                        </span>
                        <span className="text-[9px] uppercase tracking-wide text-text-muted leading-tight">
                            {item.name}
                        </span>
                    </div>
                )}
                {assigned > 0 && (
                    <div className="absolute -top-2 -left-2 z-10 min-w-6 h-6 px-1 rounded-full bg-red-600 ring-2 ring-white text-white text-sm font-bold flex items-center justify-center shadow-[0_0_8px_rgba(0,0,0,0.9)] tabular-nums">
                        {assigned}
                    </div>
                )}
            </div>
            <DivideTargetStepper
                n={assigned}
                canMinus={assigned > 0}
                canPlus={divide.remaining > 0}
                onMinus={() => divide.dec(item.id)}
                onPlus={() => divide.inc(item.id, item.type)}
            />
        </div>
    );
}
