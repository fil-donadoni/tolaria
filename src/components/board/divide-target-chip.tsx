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
                    <div className="w-16 aspect-[5/7] card-corner overflow-hidden ring-1 ring-black/40 shadow-[0_4px_10px_rgba(0,0,0,0.5)]">
                        <CardImage card={item.card} sizes="64px" />
                    </div>
                ) : (
                    <div className="w-16 aspect-[5/7] card-corner border border-border-subtle bg-surface-elevated flex flex-col items-center justify-center gap-1 px-1 text-center">
                        {/* v4 (ADR 0103 §4, issue #2730): off Beleren onto
                            the chrome display face. */}
                        <span className="text-display text-2xl text-accent-strong tabular-nums leading-none">
                            {item.life}
                        </span>
                        <span className="text-[9px] uppercase tracking-wide text-text-muted leading-tight">
                            {item.name}
                        </span>
                    </div>
                )}
                {assigned > 0 && (
                    // v4 (ADR 0103 §2/§3, issue #2730): `bg-signal-target-
                    // strong` / `ring-text` (design tokens) replace
                    // `bg-red-600` / `ring-parchment` — a raw Tailwind
                    // palette colour and the retired parchment ring, found
                    // adjacent to the stepper this same slice re-skinned.
                    // `signal-target` (not `danger`) because this badge
                    // reports an assignment inside the SAME divide-targeting
                    // flow `TargetSelectionBanner`'s chip already marks with
                    // that hue (ADR 0103 §3 — a signal token keeps its
                    // meaning, and this is the targeting signal, not a
                    // danger one).
                    <div className="absolute -top-2 -left-2 z-10 min-w-6 h-6 px-1 rounded-full bg-signal-target-strong ring-2 ring-text text-surface-base text-sm font-bold flex items-center justify-center shadow-[0_0_8px_rgba(0,0,0,0.9)] tabular-nums">
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
