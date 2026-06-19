import * as React from "react";
import { Minus } from "lucide-react";
import {
    Dialog,
    DialogContent,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { Panel, SunburstIcon } from "@/components/ui/panel";

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
    /** Minimize affordance (issue #315). When provided, a minimize control is
     *  shown in the top-right; clicking it invokes this callback. Used by the
     *  blocking library-pick modal so the chooser can collapse it to the board
     *  indicator without dismissing the underlying Pending Choice. */
    onMinimize?: () => void;
    className?: string;
    children: React.ReactNode;
};

const sizeClasses: Record<GameDialogSize, string> = {
    default: "max-w-md w-[calc(100vw-2rem)]",
    wide: "max-w-[90vw] w-[calc(100vw-2rem)]",
};

export default function GameDialog({
    open,
    onOpenChange,
    title,
    subtitle,
    icon,
    size = "default",
    dismissable = true,
    showCloseButton = false,
    onMinimize,
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
                    "border-none bg-transparent shadow-none ring-0 p-0 overflow-hidden flex justify-center items-center",
                    sizeClasses[size],
                    className
                )}
            >
                <Panel tone="neutral" className="max-w-full overflow-hidden">
                    <div
                        className={cn(
                            "flex gap-4 sm:gap-6",
                            icon
                                ? "flex-col sm:flex-row items-center"
                                : "flex-col"
                        )}
                    >
                        {icon && <SunburstIcon>{icon}</SunburstIcon>}

                        <div className="flex-1 flex flex-col w-full min-w-0 max-h-[80vh]">
                            <DialogTitle className="heading-panel shrink-0">
                                {title}
                            </DialogTitle>

                            {subtitle && (
                                <p className="text-text-muted text-sm text-center mt-1 shrink-0">
                                    {subtitle}
                                </p>
                            )}

                            <div className="divider-gradient my-2 shrink-0" />

                            <DialogDescription className="sr-only">
                                {subtitle ?? title}
                            </DialogDescription>

                            <div className="overflow-auto min-h-0">
                                {children}
                            </div>
                        </div>
                    </div>

                    {onMinimize && (
                        <button
                            type="button"
                            onClick={onMinimize}
                            aria-label="Minimize choice dialog"
                            title="Minimize"
                            className={cn(
                                "absolute top-3 flex items-center justify-center w-6 h-6 text-text-disabled hover:text-text-muted transition-colors cursor-pointer",
                                showCloseButton ? "right-10" : "right-3"
                            )}
                        >
                            <Minus className="h-4 w-4" />
                        </button>
                    )}

                    {showCloseButton && (
                        <button
                            type="button"
                            onClick={() => onOpenChange?.(false)}
                            className="absolute top-3 right-3 w-6 h-6 flex items-center justify-center text-text-disabled hover:text-text-muted transition-colors cursor-pointer"
                        >
                            ✕
                        </button>
                    )}
                </Panel>
            </DialogContent>
        </Dialog>
    );
}

export { SunburstIcon };
