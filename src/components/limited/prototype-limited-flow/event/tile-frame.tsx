// PROTOTYPE — throwaway. Bento tile frame: small-caps title, optional right
// slot, body.
import type { ReactNode } from "react";
import { cn } from "~/lib/utils";

export default function TileFrame({
    title,
    right,
    className,
    children,
}: {
    title: string;
    right?: ReactNode;
    className?: string;
    children: ReactNode;
}) {
    return (
        <section
            className={cn(
                "flex min-w-0 flex-col gap-3 rounded-[var(--panel-radius)] border border-border-strong bg-surface/80 p-4",
                className
            )}
        >
            <div className="flex items-center justify-between gap-2">
                <h3 className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-muted">
                    {title}
                </h3>
                {right}
            </div>
            {children}
        </section>
    );
}
