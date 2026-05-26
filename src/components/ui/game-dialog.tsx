import * as React from "react";
import {
    Dialog,
    DialogContent,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type GameDialogSize = "default" | "wide";

type GameDialogProps = {
    open: boolean;
    onOpenChange?: (open: boolean) => void;
    title: string;
    subtitle?: string;
    icon?: React.ReactNode;
    size?: GameDialogSize;
    dismissable?: boolean;
    showCloseButton?: boolean;
    className?: string;
    children: React.ReactNode;
};

const sizeClasses: Record<GameDialogSize, string> = {
    default: "max-w-md w-[calc(100vw-2rem)]",
    wide: "max-w-[90vw] w-[calc(100vw-2rem)]",
};

function CornerAccent({ className }: { className: string }) {
    return (
        <div
            className={cn(
                "absolute w-4 h-4 after:absolute after:w-1 after:h-1 after:bg-zinc-400/40",
                className
            )}
        />
    );
}

function SunburstIcon({ children }: { children: React.ReactNode }) {
    return (
        <div className="relative flex-shrink-0 w-28 h-28 sm:w-36 sm:h-36 flex items-center justify-center overflow-hidden rounded-full border border-zinc-800/30 bg-zinc-950/40">
            <div
                className="absolute inset-0 opacity-35 mix-blend-color-dodge animate-[spin_80s_linear_infinite]"
                style={{
                    backgroundImage:
                        "repeating-conic-gradient(from 0deg, #d97706 0deg 4deg, transparent 4deg 12deg)",
                }}
            />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_10%,#0c0d12_70%)]" />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(245,158,11,0.2)_0%,transparent_60%)]" />
            <div className="relative z-10 flex items-center justify-center drop-shadow-[0_0_20px_rgba(245,158,11,0.5)]">
                {children}
            </div>
        </div>
    );
}

export default function GameDialog({
    open,
    onOpenChange,
    title,
    subtitle,
    icon,
    size = "default",
    dismissable = true,
    showCloseButton = false,
    className,
    children,
}: GameDialogProps) {
    const handleOpenChange = (next: boolean) => {
        if (!next && !dismissable) return;
        onOpenChange?.(next);
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent
                showCloseButton={false}
                className={cn(
                    "border-none bg-transparent shadow-none p-0 overflow-visible flex justify-center items-center",
                    sizeClasses[size],
                    className
                )}
            >
                <div className="relative w-full bg-[#0c0d12]/90 border border-zinc-800/80 backdrop-blur-md rounded-sm p-4 sm:p-6 text-white shadow-[0_0_50px_rgba(0,0,0,0.8)] select-none">
                    {/* Corner accents */}
                    <CornerAccent className="top-2 left-2 border-t border-l border-zinc-500/40 after:top-1 after:left-1" />
                    <CornerAccent className="top-2 right-2 border-t border-r border-zinc-500/40 after:top-1 after:right-1" />
                    <CornerAccent className="bottom-2 left-2 border-b border-l border-zinc-500/40 after:bottom-1 after:left-1" />
                    <CornerAccent className="bottom-2 right-2 border-b border-r border-zinc-500/40 after:bottom-1 after:right-1" />

                    <div
                        className={cn(
                            "flex gap-4 sm:gap-6",
                            icon
                                ? "flex-col sm:flex-row items-center"
                                : "flex-col"
                        )}
                    >
                        {icon && <SunburstIcon>{icon}</SunburstIcon>}

                        <div className="flex-1 flex flex-col w-full min-w-0">
                            {/* Title — Beleren font, centered */}
                            <DialogTitle className="text-xl sm:text-2xl font-bold tracking-wide text-[#f1f1e8] font-beleren text-center drop-shadow-[0_2px_4px_rgba(0,0,0,0.6)]">
                                {title}
                            </DialogTitle>

                            {subtitle && (
                                <p className="text-zinc-400 text-sm text-center mt-1">
                                    {subtitle}
                                </p>
                            )}

                            {/* Gradient divider — symmetric */}
                            <div className="h-[1px] w-full bg-gradient-to-r from-transparent via-zinc-500/40 to-transparent my-2" />

                            {/* sr-only description for a11y */}
                            <DialogDescription className="sr-only">
                                {subtitle ?? title}
                            </DialogDescription>

                            {children}
                        </div>
                    </div>

                    {showCloseButton && (
                        <button
                            type="button"
                            onClick={() => onOpenChange?.(false)}
                            className="absolute top-3 right-3 w-6 h-6 flex items-center justify-center text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer"
                        >
                            ✕
                        </button>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}

export { SunburstIcon };
