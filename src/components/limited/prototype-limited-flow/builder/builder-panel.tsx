// PROTOTYPE — throwaway. The bordered panel surface the builder sections sit on.
import type { ReactNode } from "react";
import { cn } from "~/lib/utils";

export default function BuilderPanel({
    className,
    children,
}: {
    className?: string;
    children: ReactNode;
}) {
    return (
        <div
            className={cn(
                "min-w-0 rounded-[var(--panel-radius)] border border-border-strong bg-surface-base/60 p-3 sm:p-4",
                className
            )}
        >
            {children}
        </div>
    );
}
