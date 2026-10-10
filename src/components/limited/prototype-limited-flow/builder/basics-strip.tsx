// PROTOTYPE — throwaway. "Add Basic": five big distinct tiles in one row at
// every width, plus the printing picker they open.
import { useState } from "react";
import { BASICS, type BasicKey } from "./builder-data";
import BasicPrintingDialog from "./basic-printing-dialog";
import BasicRow from "./basic-row";
import BasicTile from "./basic-tile";
import type { Builder } from "./useBuilder";

export default function BasicsStrip({
    b,
    compact = false,
    vertical = false,
}: {
    b: Builder;
    compact?: boolean;
    /** A narrow side rail: one wide row per basic instead of five columns. */
    vertical?: boolean;
}) {
    const [open, setOpen] = useState<BasicKey | null>(null);
    const basic = BASICS.find((x) => x.key === open) ?? null;
    return (
        <section className="flex flex-col gap-2">
            {!compact && (
                <header className="flex items-baseline gap-2">
                    <h3 className="font-display text-sm tracking-wide text-parchment">
                        Basic lands
                    </h3>
                    <span className="text-[11px] tabular-nums text-text-muted">
                        {b.basicsTotal}
                    </span>
                    <span className="ml-auto text-[11px] text-text-disabled">
                        Tap the art to change printing
                    </span>
                </header>
            )}
            <div
                className={
                    vertical
                        ? "flex flex-col gap-2"
                        : "grid grid-cols-5 gap-1.5 sm:gap-3"
                }
            >
                {BASICS.map((x) => {
                    const Tile = vertical ? BasicRow : BasicTile;
                    return (
                        <Tile
                            key={x.key}
                            basic={x}
                            printId={b.printing[x.key]}
                            count={b.basics[x.key]}
                            compact={compact}
                            onOpenArt={() => setOpen(x.key)}
                            onBump={(d) => b.bumpBasic(x.key, d)}
                        />
                    );
                })}
            </div>
            <BasicPrintingDialog
                basic={basic}
                current={open ? b.printing[open] : null}
                count={open ? b.basics[open] : 0}
                onPick={(id) => open && b.pickPrinting(open, id)}
                onClose={() => setOpen(null)}
            />
        </section>
    );
}
