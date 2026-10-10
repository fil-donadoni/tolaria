// PROTOTYPE — throwaway. Shared root for every variant: sets the pile card
// size custom properties (`--cw`, `--peek`) for the current viewport rung.
import type { CSSProperties, ReactNode } from "react";
import { cn } from "~/lib/utils";

export default function BuilderFrame({
    cardW,
    className,
    children,
}: {
    cardW: number;
    className?: string;
    children: ReactNode;
}) {
    return (
        <div
            className={cn(
                "mx-auto flex w-full max-w-[1400px] min-w-0 flex-col",
                className
            )}
            style={
                {
                    "--cw": `${cardW}px`,
                    "--peek": "calc(var(--cw) * 0.18)",
                } as CSSProperties
            }
        >
            {children}
        </div>
    );
}
