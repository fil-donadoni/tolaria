// PROTOTYPE — throwaway. Split out of touch-builder-surface (one component per file).
import { cn } from "~/lib/utils";
import type { Zone } from "./mock-pool";

export default function TouchTabButton({
    zone,
    active,
    count,
    over,
    armed,
    onClick,
    zoneProps,
}: {
    zone: { id: Zone; label: string };
    active: boolean;
    count: number;
    over: boolean;
    armed: boolean;
    onClick: () => void;
    zoneProps: Record<string, unknown>;
}) {
    return (
        <button
            type="button"
            {...zoneProps}
            onClick={(e) => {
                (
                    zoneProps.onClick as
                        | ((ev: React.MouseEvent) => void)
                        | undefined
                )?.(e);
                if (!armed) onClick();
                e.preventDefault();
            }}
            className={cn(
                "flex min-h-11 items-center justify-center gap-1.5 px-3 font-beleren text-sm transition-colors",
                active
                    ? "border-b-2 border-accent text-accent-strong"
                    : "text-text-muted",
                over && "bg-accent/25 text-parchment",
                armed && !active && "animate-pulse text-signal-pending-strong"
            )}
        >
            {zone.label}
            <span
                className={cn(
                    "rounded-full px-1.5 text-[11px] font-bold",
                    active
                        ? "bg-accent text-surface-base"
                        : "bg-surface-elevated text-text-muted"
                )}
            >
                {count}
            </span>
        </button>
    );
}
